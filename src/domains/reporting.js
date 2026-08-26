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
      const packet = store.ticketPacket(ticket_id);
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
      const report = store.statusReport(args);
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
  {
    name: "eng_route",
    title: "Roteador de domínio",
    description:
      "Encaminha uma tarefa em linguagem natural para o domínio certo: work, qa, time, investigation, knowledge ou reporting.",
    schema: z.object({
      task: z.string().describe("O que você quer fazer, em linguagem natural."),
    }),
    handler: wrap(async ({ task }) => {
      const text = String(task || "").toLowerCase();
      const rules = [
        {
          domain: "work",
          tools: ["work_upsert_ticket", "work_board", "work_list"],
          hints: ["ticket", "jira", "board", "kanban", "projeto", "task", "backlog", "sprint"],
        },
        {
          domain: "qa",
          tools: ["qa_record_run", "qa_record_bug", "qa_attach_evidence", "qa_list"],
          hints: ["teste", "test", "bug", "evidência", "evidence", "flaky", "fail", "screenshot"],
        },
        {
          domain: "time",
          tools: ["time_log", "time_estimate", "time_metrics"],
          hints: ["hora", "tempo", "estimate", "estimativa", "timesheet", "apontar"],
        },
        {
          domain: "investigation",
          tools: ["investigate_open", "investigate_add_finding", "investigate_conclude"],
          hints: ["investiga", "causa", "root cause", "por que", "rca", "diagnóstico"],
        },
        {
          domain: "knowledge",
          tools: ["knowledge_save", "knowledge_search"],
          hints: ["playbook", "lição", "lesson", "lembrar", "conhecimento", "padrão"],
        },
        {
          domain: "reporting",
          tools: ["report_ticket", "report_status"],
          hints: ["relatório", "report", "status", "métrica", "handoff", "pacote"],
        },
      ];
      const scored = rules
        .map((rule) => ({
          ...rule,
          score: rule.hints.filter((h) => text.includes(h)).length,
        }))
        .sort((a, b) => b.score - a.score);
      const best = scored[0].score > 0 ? scored[0] : rules[0];
      return ok(
        { domain: best.domain, tools: best.tools, task },
        lines([
          `Domínio: ${best.domain.toUpperCase()}`,
          `Ferramentas: ${best.tools.join(", ")}`,
          "Não duplica qa-lab-agent (execução de testes) nem qa-oracle (CI/Jira). Este MCP é o OS de engenharia.",
        ])
      );
    }),
  },
];
