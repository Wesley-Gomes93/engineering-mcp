import * as store from "./store.js";
import { advise, formatAdvice, formatContext } from "./advise.js";

export { formatContext };

const CLASS_HINTS = [
  ["flaky", "flaky"],
  ["regression", "regression"],
  ["infra", "infra"],
  ["bug", "bug"],
];

export function extractDuration(text) {
  const t = String(text || "")
    .toLowerCase()
    .replace(",", ".");
  let match = t.match(/(\d+(?:\.\d+)?)\s*(minutos?|mins?|min)\b/);
  if (match) {
    const minutes = Number(match[1]);
    return { minutes, hours: Number((minutes / 60).toFixed(4)) };
  }
  match = t.match(/(\d+(?:\.\d+)?)\s*(horas?|hours?|hrs?|h)\b/);
  if (match) {
    const hours = Number(match[1]);
    return { minutes: Number((hours * 60).toFixed(2)), hours };
  }
  return null;
}

function afterLabel(text, labels) {
  const lower = String(text || "");
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*[:\\-–]?\\s*(.+)`, "i");
    const match = lower.match(re);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function guessType(text) {
  const lower = String(text || "").toLowerCase();
  if (/\b(bug|defeito|erro)\b/.test(lower)) return "bug";
  if (/\bspike\b/.test(lower)) return "spike";
  if (/\b(story|hist[oó]ria)\b/.test(lower)) return "story";
  if (/\bepic\b/.test(lower)) return "epic";
  return "task";
}

function guessPriority(text) {
  const match = String(text || "").toLowerCase().match(/\bp([0-3])\b/);
  return match ? `p${match[1]}` : undefined;
}

function titleFromStart(raw, ticketId) {
  let s = String(raw || "");
  s = s.replace(
    /\b(comecei|começo|começar|comecar|iniciei|início|inicio|vou trabalhar|trabalhando (?:em|no)|foco(?:\s+(?:no|em))?|started|working on|start(?:ing)?)\b/gi,
    " "
  );
  if (ticketId) s = s.replace(new RegExp(ticketId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), " ");
  s = s.replace(/^\s*(o|a|um|uma|the|an)\s+/i, "");
  s = s.replace(/^(bug|task|spike|story|epic|defeito|ticket|issue)\s*[:\-–]?\s*/i, "");
  s = s.replace(/[?.!]+$/g, "").replace(/\s+/g, " ").trim();
  return s;
}

function guessClassification(text) {
  const lower = String(text || "").toLowerCase();
  for (const [needle, value] of CLASS_HINTS) {
    if (lower.includes(needle)) return value;
  }
  return undefined;
}

function guessEvidenceKind(text) {
  const lower = String(text || "").toLowerCase();
  if (lower.includes("screenshot") || lower.includes("print")) return "screenshot";
  if (lower.includes("report")) return "report";
  if (/\burl\b|http/.test(lower)) return "url";
  if (/\blog\b/.test(lower)) return "log";
  return "note";
}

/**
 * Interpreta uma frase em PT/EN e devolve uma ação estruturada.
 * Não executa — use dispatch().
 */
export function parseUtterance(text, { focus } = {}) {
  const raw = String(text || "").trim();
  const lower = raw.toLowerCase();
  const mentioned = store.extractTicketId(raw);
  const ticket_id = mentioned || focus || null;
  const duration = extractDuration(raw);

  if (/\b(daily|standup|stand-up)\b/.test(lower) || /prepara(?:r)?(?:\s+\w+){0,3}\s+daily/.test(lower)) {
    return { action: "daily", ticket_id, task: raw };
  }

  if (/\b(j[aá]\s+vimos|similar|parecid[oa]s?|visto isso|vimos isso)\b/.test(lower)) {
    return { action: "similar", ticket_id, query: raw, task: raw };
  }

  if (
    /\b(comecei|começo|comecar|começar|inici[eio]|vou trabalhar|trabalhando (?:em|no)|foco(?:\s+no)?|started|working on)\b/.test(
      lower
    )
  ) {
    return {
      action: "focus",
      ticket_id: mentioned,
      title: titleFromStart(raw, mentioned),
      type: guessType(lower),
      priority: guessPriority(lower),
      task: raw,
    };
  }

  if (/\b(fechei|finalizei|marquei como done|status done|\bdone\b|conclu[ií](?:do)?)\b/.test(lower)) {
    return { action: "done", ticket_id, task: raw };
  }

  if (
    /\b(o que aconteceu|o que rolou|contexto|hist[oó]ria|pacote|report(?:ar)?(?:\s+o)?\s+ticket|me d[aá] o pacote)\b/.test(
      lower
    )
  ) {
    return { action: "context", ticket_id, task: raw };
  }

  if (/\b(causa raiz|root cause|classifica(?:r)?)\b/.test(lower)) {
    return {
      action: "conclude",
      ticket_id,
      root_cause: afterLabel(raw, ["causa raiz", "root cause", "fecha(?:r)?(?: como)?"]) || raw,
      classification: guessClassification(raw),
      task: raw,
    };
  }

  if (/\b(hip[oó]tese|hypothesis|finding|observa(?:ção|cao))\b/.test(lower)) {
    const kind = /\bhip[oó]tese|hypothesis\b/.test(lower)
      ? "hypothesis"
      : /\bevid/.test(lower)
        ? "evidence"
        : "observation";
    return {
      action: "finding",
      ticket_id,
      kind,
      body: afterLabel(raw, ["hipótese", "hipotese", "hypothesis", "finding", "observação", "observacao"]) || raw,
      task: raw,
    };
  }

  if (/\b(estima(?:r|tiva)|estimate)\b/.test(lower) && duration) {
    return { action: "estimate", ticket_id, hours: duration.hours, task: raw };
  }

  if (duration && /\b(min|hora|hour|log|apont|trabalhei|gastei|sess[aã]o|time)\b/.test(lower)) {
    return {
      action: "session",
      ticket_id,
      minutes: duration.minutes,
      hours: duration.hours,
      note: raw,
      task: raw,
    };
  }

  if (/\b(playbook|li[cç][aã]o|lesson|lembrar|conhecimento|padr[aã]o)\b/.test(lower)) {
    if (/\b(busca|search|procura|temos|j[aá] tem)\b/.test(lower)) {
      return { action: "knowledge_search", query: raw, ticket_id, task: raw };
    }
    return {
      action: "knowledge_save",
      ticket_id,
      title: afterLabel(raw, ["playbook", "lição", "licao", "lesson"]) || raw.slice(0, 80),
      body: raw,
      task: raw,
    };
  }

  if (/\b(bug|defeito)\b/.test(lower) && /\b(registr|grava|abre|novo)\b/.test(lower)) {
    return {
      action: "bug",
      ticket_id,
      title: afterLabel(raw, ["bug", "defeito"]) || raw,
      task: raw,
    };
  }

  if (
    /\b(evid[eê]ncia|anexa|screenshot|print|fail|falhou|run|401|500|log)\b/.test(lower)
  ) {
    const fail = /\b(fail|falhou|falha|erro|401|500)\b/.test(lower);
    return {
      action: fail ? "run" : "evidence",
      ticket_id,
      status: fail ? "fail" : undefined,
      kind: guessEvidenceKind(raw),
      path_or_url: (raw.match(/https?:\/\/\S+/) || [])[0] || raw,
      note: raw,
      suite: afterLabel(raw, ["suite", "spec"]) || undefined,
      task: raw,
    };
  }

  if (duration) {
    return {
      action: "session",
      ticket_id,
      minutes: duration.minutes,
      hours: duration.hours,
      note: raw,
      task: raw,
    };
  }

  if (ticket_id) return { action: "context", ticket_id, task: raw };
  return { action: "unknown", ticket_id, task: raw };
}

const SKIP_WHISPER = new Set(["context", "daily", "similar", "unknown"]);

export async function dispatch(text) {
  const focus = await store.getFocus();
  const parsed = parseUtterance(text, { focus: focus?.id });
  const result = await execute(parsed);
  let extra = null;
  let advice = null;
  if (!SKIP_WHISPER.has(parsed.action)) {
    const ticketId =
      result.data?.ticket?.id ||
      result.data?.investigation?.ticket_id ||
      result.data?.run?.ticket_id ||
      result.data?.evidence?.ticket_id ||
      result.data?.session?.ticket_id ||
      result.data?.log?.ticket_id ||
      parsed.ticket_id ||
      (await store.getFocus())?.id;
    advice = await advise({ ticket_id: ticketId, event: parsed.action, text });
    extra = formatAdvice(advice);
  }
  return {
    parsed,
    extra,
    advice,
    ...result,
    text: [result.text, extra].filter(Boolean).join("\n\n"),
  };
}

async function execute(parsed) {
  switch (parsed.action) {
    case "focus": {
      const ticket = await store.startWork({
        ticket_id: parsed.ticket_id,
        title: parsed.title,
        type: parsed.type,
        priority: parsed.priority,
      });
      const created = parsed.ticket_id && parsed.ticket_id !== ticket.id;
      return {
        domain: "work",
        data: { ticket },
        text: created
          ? `${parsed.ticket_id} não existia. Foco em ${ticket.id} [${ticket.status}] ${ticket.title}`
          : `Foco em ${ticket.id} [${ticket.status}] ${ticket.title}`,
      };
    }
    case "done": {
      const id = await store.resolveTicketId(parsed.ticket_id);
      const ticket = await store.upsertTicket({ id, status: "done" });
      return {
        domain: "work",
        data: { ticket },
        text: `${ticket.id} marcado como done — ${ticket.title}`,
      };
    }
    case "context": {
      const ctx = await store.ticketContext(parsed.ticket_id);
      const advice = await advise({ ticket_id: ctx.ticket.id, event: "context" });
      return {
        domain: "reporting",
        data: { context: ctx, advice },
        text: formatContext(ctx, advice),
      };
    }
    case "similar": {
      const id = parsed.ticket_id || (await store.getFocus())?.id;
      const leftover = String(parsed.query || parsed.task || "")
        .replace(/\b(j[aá]\s+vimos(?:\s+isso)?|similar|parecid[oa]s?|visto isso)\b/gi, "")
        .replace(/[?!.]/g, "")
        .trim();
      const similar = await store.similarTickets({
        ticket_id: id,
        query: leftover || undefined,
      });
      return { domain: "knowledge", data: { similar }, text: formatSimilar(similar) };
    }
    case "daily": {
      const report = await store.dailyReport({ days: 1 });
      return { domain: "reporting", data: { report }, text: formatDaily(report) };
    }
    case "session": {
      const logged = await store.logWorkSession({
        ticket_id: parsed.ticket_id,
        minutes: parsed.minutes,
        note: parsed.note,
      });
      return {
        domain: "time",
        data: logged,
        text: `+${parsed.minutes} min em ${logged.session.ticket_id} (${logged.log.hours}h)`,
      };
    }
    case "estimate": {
      const id = await store.resolveTicketId(parsed.ticket_id);
      const estimate = await store.setEstimate({ ticket_id: id, hours: parsed.hours });
      return {
        domain: "time",
        data: { estimate },
        text: `${id}: ${estimate.hours}h estimadas`,
      };
    }
    case "finding": {
      const out = await store.addFindingToTicket({
        ticket_id: parsed.ticket_id,
        kind: parsed.kind,
        body: parsed.body,
      });
      return {
        domain: "investigation",
        data: out,
        text: `Finding [${out.finding.kind}] em ${out.investigation.id}: ${out.finding.body}`,
      };
    }
    case "conclude": {
      const investigation = await store.concludeOpenInvestigation({
        ticket_id: parsed.ticket_id,
        root_cause: parsed.root_cause,
        classification: parsed.classification,
      });
      return {
        domain: "investigation",
        data: { investigation },
        text: `${investigation.id} concluída [${investigation.classification}]: ${investigation.root_cause}`,
      };
    }
    case "run": {
      const id = await store.resolveTicketId(parsed.ticket_id);
      const run = await store.recordRun({
        ticket_id: id,
        status: parsed.status || "fail",
        suite: parsed.suite || "",
        summary: parsed.note || parsed.task,
        source: "manual",
      });
      const evidence = await store.attachEvidence({
        ticket_id: id,
        run_id: run.id,
        kind: parsed.kind || "note",
        path_or_url: parsed.path_or_url || parsed.task,
        note: parsed.note,
      });
      return {
        domain: "qa",
        data: { run, evidence },
        text: `${run.id} [${run.status}] + evidência ${evidence.id} em ${id}`,
      };
    }
    case "evidence": {
      const id = await store.resolveTicketId(parsed.ticket_id);
      const evidence = await store.attachEvidence({
        ticket_id: id,
        kind: parsed.kind || "note",
        path_or_url: parsed.path_or_url || parsed.task,
        note: parsed.note,
      });
      return {
        domain: "qa",
        data: { evidence },
        text: `${evidence.id} [${evidence.kind}] em ${id}: ${evidence.path_or_url}`,
      };
    }
    case "bug": {
      const id = await store.resolveTicketId(parsed.ticket_id);
      const bug = await store.recordBug({ ticket_id: id, title: parsed.title });
      return {
        domain: "qa",
        data: { bug },
        text: `${bug.id} [${bug.severity}] ${bug.title} ← ${id}`,
      };
    }
    case "knowledge_save": {
      const item = await store.saveKnowledge({
        title: parsed.title,
        body: parsed.body,
        ticket_id: parsed.ticket_id,
        kind: "lesson",
      });
      return {
        domain: "knowledge",
        data: { knowledge: item },
        text: `${item.id} [${item.kind}] ${item.title}`,
      };
    }
    case "knowledge_search": {
      const items = await store.searchKnowledge({ query: parsed.query });
      return {
        domain: "knowledge",
        data: { items },
        text: items.length
          ? items.map((k) => `- ${k.id} [${k.kind}] ${k.title}`).join("\n")
          : "Nada encontrado no conhecimento.",
      };
    }
    default: {
      const focusNow = await store.getFocus();
      return {
        domain: "work",
        data: { parsed, focus: focusNow },
        text: [
          "Não executei nada — falta um verbo claro.",
          focusNow ? `Foco atual: ${focusNow.id} ${focusNow.title}` : "Nada em foco.",
          "Exemplos: “Comecei um bug: timeout no checkout”, “Comecei o ENG-1”, “anexa evidência 401”, “40 min”, “hipótese: …”, “o que aconteceu?”, “me prepara para a daily”.",
        ].join("\n"),
      };
    }
  }
}

export function formatDaily(report) {
  return [
    `# Daily  (${report.since.slice(0, 10)})`,
    `Horas hoje: ${report.hours}h  |  Tickets tocados: ${report.tickets.length}  |  Em doing: ${report.doing.length}`,
    `QA: ${report.qa_runs.length} runs  |  Bugs novos: ${report.bugs.length}  |  Investigações abertas: ${report.open_investigations.length}`,
    report.tickets.length
      ? "Tickets:\n" + report.tickets.map((t) => `- ${t.id} [${t.status}] ${t.title}`).join("\n")
      : "Nenhum ticket tocado hoje.",
    report.doing.length
      ? "Em andamento:\n" + report.doing.map((t) => `- ${t.id} ${t.title}`).join("\n")
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatSimilar(similar) {
  const tickets = similar.tickets || [];
  const knowledge = similar.knowledge || [];
  if (!tickets.length && !knowledge.length) return "Não achei caso parecido ainda.";
  return [
    tickets.length
      ? "Tickets parecidos:\n" + tickets.map((t) => `- ${t.id} [${t.status}] ${t.title} (score ${t.score})`).join("\n")
      : "Nenhum ticket parecido.",
    knowledge.length
      ? "Conhecimento:\n" + knowledge.map((k) => `- ${k.id} [${k.kind}] ${k.title}`).join("\n")
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}
