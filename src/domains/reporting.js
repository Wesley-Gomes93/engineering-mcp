import { z } from "zod";
import { ok, wrap, lines, bullet } from "../lib/respond.js";
import * as store from "../lib/store.js";

export const tools = [
  {
    name: "report_ticket",
    title: "Pacote completo do ticket",
    description:
      "REPORTING: junta WORK + QA + TIME + INVESTIGATION + KNOWLEDGE de um ticket. Use para status, handoff ou evidência.",
    schema: z.object({
      ticket_id: z.string(),
    }),
    handler: wrap(async ({ ticket_id }) => {
      const packet = await store.ticketPacket(ticket_id);
      const t = packet.ticket;
      const time = packet.time.tickets[0] || { estimated: 0, actual: 0 };
      const text = lines([
        `# ${t.id}  ${t.title}`,
        `Status: ${t.status}  Tipo: ${t.type}  Prioridade: ${t.priority}`,
        t.description || null,
        `Tasks: ${t.tasks.length}`,
        bullet(t.tasks.map((task) => `[${task.status}] ${task.title}`), "- (nenhuma)"),
        `Tempo: ${time.actual}h / ${time.estimated}h estimadas`,
        `QA runs: ${packet.qa.runs.length}  bugs: ${packet.qa.bugs.length}  evidências: ${packet.qa.evidence.length}`,
        bullet(
          packet.qa.bugs.map((b) => `[${b.status}/${b.classification}] ${b.title}`),
          "- (sem bugs)"
        ),
        `Investigações: ${packet.investigations.length}`,
        bullet(
          packet.investigations.map((i) => `[${i.status}] ${i.title}${i.root_cause ? ` → ${i.root_cause}` : ""}`)
        ),
        `Conhecimento: ${packet.knowledge.length}`,
        bullet(packet.knowledge.map((k) => `[${k.kind}] ${k.title}`)),
      ]);
      return ok({ packet }, text);
    }),
  },
  {
    name: "report_status",
    title: "Status report",
    description: "REPORTING: snapshot do projeto — board counts, tempo, falhas recentes, bugs e investigações abertas.",
    schema: z.object({
      project_id: z.string().optional(),
      project_key: z.string().optional(),
      days: z.number().optional().describe("Janela em dias para runs de QA. Default 7."),
    }),
    handler: wrap(async (args) => {
      const report = await store.statusReport(args);
      const counts = Object.entries(report.ticket_counts)
        .map(([k, v]) => `${k}:${v}`)
        .join("  ");
      const text = lines([
        `# Status ${report.project ? report.project.name : "global"}  (${report.window_days}d)`,
        `Tickets: ${report.ticket_total}  ${counts}`,
        `Tempo: ${report.time.actual}h reais / ${report.time.estimated}h estimadas`,
        `QA na janela: ${report.qa_runs_in_window} runs, ${report.qa_fail_in_window} fail`,
        `Bugs abertos: ${report.open_bugs}  Investigações abertas: ${report.open_investigations}`,
        "Atualizados:",
        bullet(report.recently_updated.map((t) => `${t.id} [${t.status}] ${t.title}`)),
      ]);
      return ok({ report }, text);
    }),
  },
];
