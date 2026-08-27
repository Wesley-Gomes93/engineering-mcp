import { z } from "zod";
import { ok, wrap, lines, bullet } from "../lib/respond.js";
import * as store from "../lib/store.js";

function formatInvestigation(inv) {
  return lines([
    `${inv.id} [${inv.status}/${inv.classification}] ${inv.title}`,
    inv.ticket_id ? `Ticket: ${inv.ticket_id}` : null,
    inv.bug_id ? `Bug: ${inv.bug_id}` : null,
    inv.hypothesis ? `Hipótese: ${inv.hypothesis}` : null,
    inv.root_cause ? `Causa raiz: ${inv.root_cause}` : null,
    `Findings (${inv.findings.length})`,
    bullet(inv.findings.map((f) => `[${f.kind}] ${f.body}`)),
    inv.status === "concluded"
      ? "Concluída. Considere knowledge_save para virar playbook."
      : null,
  ]);
}

export const tools = [
  {
    name: "investigate_open",
    title: "Abrir investigação",
    description:
      "INVESTIGATION: abre uma investigação (RCA) ligada a ticket e/ou bug. Cruza WORK + QA. Para logs CI/Jira use também qa-oracle.",
    schema: z.object({
      title: z.string(),
      ticket_id: z.string().optional(),
      bug_id: z.string().optional(),
      hypothesis: z.string().optional(),
    }),
    handler: wrap(async (args) => {
      const investigation = await store.openInvestigation(args);
      return ok({ investigation }, formatInvestigation(investigation));
    }),
  },
  {
    name: "investigate_add_finding",
    title: "Adicionar finding",
    description: "INVESTIGATION: adiciona observação, evidência, hipótese ou decisão a uma investigação aberta.",
    schema: z.object({
      investigation_id: z.string(),
      kind: z.enum(store.FINDING_KINDS).optional(),
      body: z.string(),
    }),
    handler: wrap(async (args) => {
      const finding = await store.addFinding(args);
      return ok({ finding }, `${finding.id} [${finding.kind}] ${finding.body}`);
    }),
  },
  {
    name: "investigate_conclude",
    title: "Concluir investigação",
    description:
      "INVESTIGATION: fecha com causa raiz e classificação (bug/flaky/infra/regression). Depois grave knowledge.",
    schema: z.object({
      investigation_id: z.string(),
      root_cause: z.string().optional(),
      classification: z.enum(store.CLASSIFICATIONS).optional(),
      hypothesis: z.string().optional(),
    }),
    handler: wrap(async (args) => {
      const investigation = await store.concludeInvestigation(args);
      return ok({ investigation }, formatInvestigation(investigation));
    }),
  },
  {
    name: "investigate_list",
    title: "Listar investigações",
    description: "INVESTIGATION: lista investigações, opcionalmente por ticket ou status.",
    schema: z.object({
      ticket_id: z.string().optional(),
      status: z.enum(["open", "concluded"]).optional(),
    }),
    handler: wrap(async (args) => {
      const investigations = await store.listInvestigations(args);
      return ok(
        { investigations },
        investigations.length
          ? bullet(investigations.map((i) => `${i.id} [${i.status}/${i.classification}] ${i.title}`))
          : "Nenhuma investigação."
      );
    }),
  },
];
