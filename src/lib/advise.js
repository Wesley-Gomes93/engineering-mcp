import * as store from "./store.js";
import { hintFor } from "../intel/index.js";

async function knowledgeFor(ticket) {
  if (!ticket) return [];
  const seeds = [
    ticket.component,
    ...String(ticket.tags || "")
      .split(",")
      .map((t) => t.trim()),
    ...String(ticket.title || "")
      .split(/\s+/)
      .filter((w) => w.length > 4),
  ].filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const seed of seeds.slice(0, 5)) {
    const items = await store.searchKnowledge({ query: seed, limit: 3 });
    for (const item of items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    if (out.length >= 3) break;
  }
  return out.slice(0, 3);
}

/** Só passos derivados do estado. Sem sinal → null (não interrompe). */
export function nextStep(ticket, qa, investigations, timeRow) {
  if (!ticket) return "Diga o que está fazendo, ex: “Comecei um bug: timeout no checkout”.";

  const fails = (qa?.runs || []).filter((r) => r.status === "fail" || r.status === "flaky");
  const open = (investigations || []).filter((i) => i.status === "open");
  const concluded = (investigations || []).filter((i) => i.status === "concluded");
  const hasRun = Boolean((qa?.runs || []).length);
  const hasEvidence = Boolean((qa?.evidence || []).length);
  const isSpike = ticket.type === "spike";
  const noTime = !timeRow || timeRow.actual === 0;
  const active = ticket.status !== "done" && ticket.status !== "backlog";

  if (ticket.status === "review" && !hasRun) {
    return "Review sem run de QA. Anexa o pass/fail antes do handoff.";
  }
  if (!isSpike && !hasRun && !hasEvidence) {
    return "Ainda não tem evidência. Anexa o fail, o log ou o print.";
  }
  if (fails.length && !open.length && !concluded.length) {
    return "Tem fail sem RCA. Diz a hipótese.";
  }
  if (open.length) {
    const findings = open[0].findings || [];
    if (!findings.length) return "Investigação aberta e vazia. Adiciona hipótese ou evidência.";
    return "Investigação aberta. Fecha com causa raiz quando souber.";
  }
  if (isSpike && noTime && active) {
    return "Spike sem hora lançada. Ex: “40 min”.";
  }
  if (timeRow && timeRow.estimated > 0 && timeRow.actual === 0) {
    return "Tem estimativa e zero hora. Diz quanto já gastou (ex: 40 min).";
  }
  if (timeRow?.overrun) {
    return "Real passou o estimado. Quebre o restante ou recalie a próxima faixa.";
  }
  if (ticket.status === "doing" && noTime) {
    return "Em doing sem tempo lançado. Ex: “40 min”.";
  }
  return null;
}

function hintQuery(ticket, event, text) {
  const fromTicket = [ticket?.title, ticket?.tags, ticket?.component].filter(Boolean).join(" ");
  if (event === "run" || event === "evidence" || event === "bug") {
    return [fromTicket, text].filter(Boolean).join(" ");
  }
  return fromTicket;
}

/**
 * Sussurro do OS. Sem playbook, caso parecido ou next derivado do estado → vazio.
 */
export async function advise({ ticket_id, event, text } = {}) {
  let ticket = null;
  if (ticket_id) ticket = await store.getTicket(ticket_id);
  if (!ticket) ticket = await store.getFocus();

  const qa = ticket ? await store.listQa({ ticket_id: ticket.id }) : { runs: [], bugs: [], evidence: [] };
  const investigations = ticket ? await store.listInvestigations({ ticket_id: ticket.id }) : [];
  const time = ticket ? await store.timeMetrics({ ticket_id: ticket.id }) : null;
  const timeRow = time?.tickets?.[0] || null;
  const similar = ticket
    ? await store.similarTickets({ ticket_id: ticket.id, limit: 3 })
    : { tickets: [], knowledge: [] };
  const knowledge = ticket ? await knowledgeFor(ticket) : [];
  const hint = hintFor(hintQuery(ticket, event, text));
  const next = nextStep(ticket, qa, investigations, timeRow);

  return {
    ticket_id: ticket?.id || null,
    event: event || null,
    next,
    hint: knowledge.length ? null : hint,
    similar: similar.tickets.slice(0, 3),
    knowledge: knowledge.slice(0, 3),
  };
}

export function hasSignal(advice) {
  if (!advice) return false;
  return Boolean(
    advice.next ||
      advice.hint ||
      advice.similar?.length ||
      advice.knowledge?.length
  );
}

export function formatAdvice(advice) {
  if (!hasSignal(advice)) return null;
  const parts = [];
  if (advice.similar?.length) {
    parts.push(`Já vimos: ${advice.similar.map((t) => `${t.id} ${t.title}`).join("; ")}`);
  }
  for (const item of advice.knowledge || []) {
    const body = String(item.body || "").replace(/\s+/g, " ").slice(0, 140);
    parts.push(`Playbook: ${item.title}${body ? ` — ${body}` : ""}`);
  }
  if (advice.hint) parts.push(`Dica: ${advice.hint}`);
  if (advice.next) parts.push(`Próximo: ${advice.next}`);
  if (!parts.length) return null;
  return ["Memória", ...parts].join("\n");
}

function mark(kind, text) {
  if (!text) return null;
  return `[${kind}] ${text}`;
}

function section(title, rows) {
  const body = rows.filter(Boolean);
  if (!body.length) return null;
  return [title, ...body].join("\n");
}

/** Contexto compacto para o LLM: fato / inferência / conhecimento. */
export function formatContext(ctx, advice = {}) {
  const t = ctx.ticket;
  const time = ctx.time?.tickets?.[0] || { estimated: 0, actual: 0, variance: 0 };
  const qa = ctx.qa || { runs: [], bugs: [], evidence: [] };
  const fails = (qa.runs || []).filter((r) => r.status === "fail" || r.status === "flaky");
  const investigations = ctx.investigations || [];
  const similar = ctx.similar?.tickets || advice.similar || [];
  const knowledge = [
    ...(advice.knowledge || []),
    ...(ctx.similar?.knowledge || []),
    ...(ctx.knowledge || []),
  ];
  const seenKnow = new Set();
  const knowUnique = [];
  for (const item of knowledge) {
    if (!item?.id || seenKnow.has(item.id)) continue;
    seenKnow.add(item.id);
    knowUnique.push(item);
  }

  const state = [
    mark(
      "fact",
      `${t.id} ${t.status}/${t.type}/${t.priority} — ${t.title}${ctx.focused ? " · foco" : ""}`
    ),
    t.component || t.tags
      ? mark(
          "fact",
          [t.component && `component ${t.component}`, t.tags && `tags ${t.tags}`].filter(Boolean).join(" · ")
        )
      : null,
    t.external_key ? mark("fact", `external ${t.external_key}`) : null,
  ];

  const evidence = [
    mark(
      "fact",
      `${qa.runs.length} runs (${fails.length} fail/flaky) · ${qa.bugs.length} bugs · ${qa.evidence.length} evidências`
    ),
    ...qa.runs.slice(0, 3).map((r) => mark("fact", `run ${r.status} ${r.suite || r.summary || r.id}`)),
    ...qa.bugs.slice(0, 2).map((b) => mark("fact", `bug ${b.status} ${b.title}`)),
  ];

  const invRows = [];
  if (!investigations.length) {
    invRows.push(mark("fact", "nenhuma investigação"));
  } else {
    for (const inv of investigations.slice(0, 2)) {
      invRows.push(
        mark(
          "fact",
          `${inv.status}${inv.classification ? `/${inv.classification}` : ""} ${inv.title}${
            inv.root_cause ? ` · RCA: ${inv.root_cause}` : ""
          }`
        )
      );
      if (inv.hypothesis) invRows.push(mark("fact", `hipótese: ${inv.hypothesis}`));
      for (const f of (inv.findings || []).slice(-4)) {
        invRows.push(mark("fact", `${f.kind}: ${String(f.body).replace(/\s+/g, " ").slice(0, 120)}`));
      }
    }
  }

  const mem = [
    ...similar.slice(0, 3).map((s) => mark("inference", `similar ${s.id} ${s.title} (score ${s.score})`)),
    ...knowUnique
      .slice(0, 3)
      .map((k) =>
        mark("knowledge", `${k.kind} ${k.title} — ${String(k.body || "").replace(/\s+/g, " ").slice(0, 100)}`)
      ),
  ];
  if (advice.hint && !knowUnique.length) mem.push(mark("inference", advice.hint));
  if (!mem.length) mem.push(mark("fact", "sem memória relacionada"));

  const next = advice.next ? [mark("inference", advice.next)] : [];

  return [
    section("CURRENT_STATE", state),
    section("EVIDENCE", evidence),
    section("INVESTIGATION", invRows),
    section("TIME", [
      mark("fact", `est ${time.estimated || 0}h / real ${time.actual || 0}h / Δ ${time.variance || 0}h`),
    ]),
    section("RELATED_MEMORY", mem),
    section("NEXT_STEP", next),
  ]
    .filter(Boolean)
    .join("\n\n");
}
