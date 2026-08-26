import { z } from "zod";
import { ok, wrap, lines, bullet } from "../lib/respond.js";
import * as store from "../lib/store.js";

export const tools = [
  {
    name: "qa_record_run",
    title: "Registrar evidência de teste",
    description:
      "QA: grava um run de teste (pass/fail/flaky/blocked) ligado a um ticket. Não executa testes — para rodar, use o MCP qa-lab-agent.",
    schema: z.object({
      ticket_id: z.string().optional(),
      suite: z.string().optional().describe("Nome da suite ou spec."),
      status: z.enum(store.QA_RUN_STATUSES).describe("pass, fail, flaky ou blocked."),
      summary: z.string().optional(),
      source: z.string().optional().describe("manual, ci, qa-lab-agent, local…"),
    }),
    handler: wrap(async (args) => {
      const run = store.recordRun(args);
      return ok({ run }, `${run.id} [${run.status}] ${run.suite || "suite"} ← ${run.ticket_id || "sem ticket"}`);
    }),
  },
  {
    name: "qa_record_bug",
    title: "Registrar bug",
    description:
      "QA: grava um bug local (severity + classificação). Para histórico Jira corporativo use o MCP qa-oracle (search_bug_history).",
    schema: z.object({
      ticket_id: z.string().optional(),
      title: z.string(),
      severity: z.enum(store.BUG_SEVERITIES).optional(),
      status: z.string().optional().describe("open, investigating, fixed, closed."),
      classification: z.enum(store.CLASSIFICATIONS).optional(),
      description: z.string().optional(),
    }),
    handler: wrap(async (args) => {
      const bug = store.recordBug(args);
      return ok(
        { bug },
        `${bug.id} [${bug.severity}/${bug.classification}] ${bug.title} ← ${bug.ticket_id || "sem ticket"}`
      );
    }),
  },
  {
    name: "qa_attach_evidence",
    title: "Anexar evidência",
    description: "QA: anexa log, screenshot, report ou URL a um ticket, bug ou run.",
    schema: z.object({
      ticket_id: z.string().optional(),
      bug_id: z.string().optional(),
      run_id: z.string().optional(),
      kind: z.enum(store.EVIDENCE_KINDS).optional(),
      path_or_url: z.string().describe("Caminho local ou URL da evidência."),
      note: z.string().optional(),
    }),
    handler: wrap(async (args) => {
      const evidence = store.attachEvidence(args);
      return ok({ evidence }, `${evidence.id} [${evidence.kind}] ${evidence.path_or_url}`);
    }),
  },
  {
    name: "qa_list",
    title: "Listar QA de um ticket",
    description: "QA: lista runs, bugs e evidências. Filtra por ticket_id se informado.",
    schema: z.object({
      ticket_id: z.string().optional(),
    }),
    handler: wrap(async (args) => {
      const qa = store.listQa(args);
      const text = lines([
        `Runs (${qa.runs.length})`,
        bullet(qa.runs.map((r) => `${r.id} [${r.status}] ${r.suite || r.summary}`)),
        `Bugs (${qa.bugs.length})`,
        bullet(qa.bugs.map((b) => `${b.id} [${b.status}/${b.classification}] ${b.title}`)),
        `Evidências (${qa.evidence.length})`,
        bullet(qa.evidence.map((e) => `${e.id} [${e.kind}] ${e.path_or_url}`)),
      ]);
      return ok({ qa }, text);
    }),
  },
];
