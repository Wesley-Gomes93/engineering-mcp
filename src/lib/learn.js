import { many, one } from "./db.js";
import * as store from "./store.js";
import { absorb } from "../intel/index.js";

const FAIL_WINDOW_DAYS = 14;
const FAIL_STREAK = 3;

function windowSince() {
  return new Date(Date.now() - FAIL_WINDOW_DAYS * 86400000).toISOString();
}

async function maybeOpenImprovementTicket(row, pattern) {
  if (!row.ticket_id) return;
  const ticket = await store.getTicket(row.ticket_id);
  if (!ticket?.project_id) return;
  const title = `Melhoria: ${pattern.title}`;
  const already = await one("SELECT id FROM tickets WHERE title = ?", [title]);
  if (already) return;
  await store.upsertTicket({
    project_id: ticket.project_id,
    title,
    type: "task",
    status: "backlog",
    priority: "p2",
    description: `Aprendido automaticamente (improvement). Pattern ${pattern.id}. Ticket origem ${row.ticket_id}.`,
  });
}

async function learnFailStreaks(learned) {
  const rows = await many(
    `SELECT ticket_id, suite, COUNT(*) AS n
     FROM qa_runs
     WHERE status IN ('fail', 'flaky') AND created_at >= ?
     GROUP BY ticket_id, suite
     HAVING n >= ?`,
    [windowSince(), FAIL_STREAK]
  );
  for (const row of rows) {
    const suite = row.suite || "suite";
    const title = `${suite}: padrão de falha`;
    const existing = await store.findKnowledgeByTitle(title, "pattern");
    const item = await store.saveKnowledge({
      title,
      kind: "pattern",
      body: `${row.n} fails/flaky em ${suite} no ticket ${row.ticket_id || "—"} (janela ${FAIL_WINDOW_DAYS}d). Esperar animação / seletor estável / data-testid.`,
      tags: ["learned", "fail-streak", suite, row.ticket_id].filter(Boolean),
      ticket_id: row.ticket_id || undefined,
      source: "learned",
    });
    learned.push({ kind: "pattern", id: item.id, created: !existing });
    if (existing) await maybeOpenImprovementTicket(row, item);
    await absorb("qa_run", { status: "fail" }, {
      pain: "fail_streak",
      solution: existing ? "improvement_ticket" : "pattern",
    });
  }
}

async function learnInvestigations(learned) {
  const concluded = await many("SELECT * FROM investigations WHERE status = 'concluded'");
  for (const inv of concluded) {
    if (!inv.root_cause) continue;
    const linked = await one("SELECT id FROM knowledge WHERE investigation_id = ?", [inv.id]);
    if (linked) continue;
    const title = `RCA: ${inv.title}`;
    const existing = await store.findKnowledgeByTitle(title, "lesson");
    const item = await store.saveKnowledge({
      title,
      kind: "lesson",
      body: inv.root_cause,
      tags: ["learned", "rca", inv.classification].filter(Boolean),
      investigation_id: inv.id,
      ticket_id: inv.ticket_id || undefined,
      source: "learned",
    });
    learned.push({ kind: "lesson", id: item.id, created: !existing });
    await absorb("investigation_concluded", { classification: inv.classification }, { solution: "lesson" });
  }
}

async function learnOverruns(learned) {
  const metrics = await store.timeMetrics();
  for (const t of metrics.tickets.filter((row) => row.overrun)) {
    const title = `Estimativa estourou: ${t.ticket_id}`;
    const existing = await store.findKnowledgeByTitle(title, "lesson");
    const item = await store.saveKnowledge({
      title,
      kind: "lesson",
      body: `${t.ticket_id} ${t.title}: estimado ${t.estimated}h / real ${t.actual}h. Recalibrar próxima estimativa nesta área.`,
      tags: ["learned", "overrun", t.ticket_id],
      ticket_id: t.ticket_id,
      source: "learned",
    });
    learned.push({ kind: "lesson", id: item.id, created: !existing });
    await absorb("time_log", {}, { pain: "overrun", solution: "lesson" });
  }
}

export async function learnTick(_input = {}) {
  const learned = [];
  await learnFailStreaks(learned);
  await learnInvestigations(learned);
  await learnOverruns(learned);
  return {
    learned: learned.length,
    created: learned.filter((x) => x.created).length,
    items: learned,
  };
}
