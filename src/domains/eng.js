import { z } from "zod";
import { ok, wrap, lines, bullet } from "../lib/respond.js";
import * as store from "../lib/store.js";
import { dispatch, formatDaily, formatSimilar } from "../lib/route.js";
import { advise, formatAdvice, formatContext } from "../lib/advise.js";

function formatTicket(ticket) {
  if (!ticket) return "Ticket não encontrado.";
  return lines([
    `${ticket.id}  [${ticket.status}/${ticket.type}/${ticket.priority}]  ${ticket.title}`,
    ticket.project ? `Projeto: ${ticket.project.name} (${ticket.project.key})` : null,
    ticket.external_key ? `Externo: ${ticket.external_key}` : null,
    ticket.tags ? `Tags: ${ticket.tags}` : null,
    ticket.component ? `Componente: ${ticket.component}` : null,
    ticket.description ? `Desc: ${ticket.description}` : null,
  ]);
}

function formatMetrics(metrics) {
  return lines([
    metrics.project ? `Projeto: ${metrics.project.name}` : "Escopo: tickets em vista",
    `Estimado: ${metrics.estimated}h  |  Real: ${metrics.actual}h  |  Variância: ${metrics.variance}h  |  Restante: ${metrics.remaining}h`,
    metrics.accuracy != null ? `Acurácia (real/estimado): ${metrics.accuracy}` : "Sem estimativas ainda",
    bullet(
      metrics.tickets
        .filter((t) => t.estimated || t.actual)
        .map(
          (t) =>
            `${t.ticket_id} [${t.status}] est ${t.estimated}h / real ${t.actual}h (Δ ${t.variance}h)${t.overrun ? " OVER" : ""}`
        ),
      "- (sem tempo lançado)"
    ),
  ]);
}

export const tools = [
  {
    name: "eng_route",
    title: "Despachar linguagem natural",
    description:
      "ENGINEERING: porta de entrada. Executa uma frase em PT ou EN. Banco vazio é ok: “Comecei um bug: timeout no checkout” cria projeto, ticket e foco. Depois: evidência, hipótese, minutos, causa raiz, “o que aconteceu?”, “já vimos isso?”, “me prepara para a daily”. Não roda testes (qa-lab-agent) nem puxa Jira (qa-oracle).",
    schema: z.object({
      task: z.string().describe("O que aconteceu ou o que você quer, em linguagem natural."),
    }),
    handler: wrap(async ({ task }) => {
      const result = await dispatch(task);
      return ok(
        {
          action: result.parsed.action,
          domain: result.domain,
          parsed: result.parsed,
          advice: result.advice,
          ...result.data,
        },
        result.text
      );
    }),
  },
  {
    name: "eng_context",
    title: "História completa do ticket",
    description:
      "ENGINEERING: contexto compacto para o modelo — CURRENT_STATE, EVIDENCE, INVESTIGATION, TIME, RELATED_MEMORY, NEXT_STEP. Linhas marcadas [fact] / [inference] / [knowledge]. Sem ticket_id usa o foco.",
    schema: z.object({
      ticket_id: z.string().optional(),
    }),
    handler: wrap(async ({ ticket_id }) => {
      const context = await store.ticketContext(ticket_id);
      const advice = await advise({ ticket_id: context.ticket.id, event: "context" });
      return ok({ context, advice }, formatContext(context, advice));
    }),
  },
  {
    name: "eng_work",
    title: "Trabalho e foco",
    description:
      "ENGINEERING: foca um ticket na sessão, cria/atualiza, lista ou muda status. Alias de alto nível para work_*.",
    schema: z.object({
      action: z
        .enum(["focus", "upsert", "get", "list", "board", "status"])
        .describe("focus = este ticket passa a receber as próximas falas."),
      ticket_id: z.string().optional(),
      project_id: z.string().optional(),
      project_key: z.string().optional(),
      title: z.string().optional(),
      type: z.enum(store.TICKET_TYPES).optional(),
      status: z.enum(store.TICKET_STATUSES).optional(),
      priority: z.enum(store.PRIORITIES).optional(),
      description: z.string().optional(),
      tags: z.union([z.string(), z.array(z.string())]).optional(),
      component: z.string().optional(),
      external_key: z.string().optional(),
      external_source: z.string().optional(),
      external_url: z.string().optional(),
      query: z.string().optional(),
    }),
    handler: wrap(async (args) => {
      if (args.action === "focus") {
        const ticket =
          args.ticket_id || args.title
            ? await store.startWork({
                ticket_id: args.ticket_id,
                title: args.title,
                type: args.type,
                priority: args.priority,
                project_key: args.project_key,
              })
            : await store.focusTicket(await store.resolveTicketId());
        const advice = await advise({ ticket_id: ticket.id, event: "focus", text: ticket.title });
        return ok(
          { ticket, advice },
          lines([`Foco em ${ticket.id} [${ticket.status}] ${ticket.title}`, formatAdvice(advice)])
        );
      }
      if (args.action === "get") {
        const id = await store.resolveTicketId(args.ticket_id);
        const ticket = await store.getTicket(id);
        return ok({ ticket }, formatTicket(ticket));
      }
      if (args.action === "list") {
        const tickets = await store.listTickets(args);
        return ok(
          { tickets },
          tickets.length
            ? bullet(tickets.map((t) => `${t.id} [${t.status}/${t.type}] ${t.title}`))
            : "Nenhum ticket."
        );
      }
      if (args.action === "board") {
        const board = await store.board(args);
        return ok(
          { board },
          lines([
            board.project ? `Projeto: ${board.project.name}` : "Todos os projetos",
            `Total: ${board.total}`,
          ])
        );
      }
      if (args.action === "status") {
        const id = await store.resolveTicketId(args.ticket_id);
        const ticket = await store.upsertTicket({ id, status: args.status || "doing" });
        return ok({ ticket }, formatTicket(ticket));
      }
      const ticket = await store.upsertTicket(args);
      if (args.action === "upsert" && args.ticket_id == null && ticket.id) {
        await store.focusTicket(ticket.id);
      }
      return ok({ ticket }, formatTicket(ticket));
    }),
  },
  {
    name: "eng_evidence",
    title: "Evidência de QA",
    description:
      "ENGINEERING: grava run, bug ou anexo no ticket em foco. Não executa a suite.",
    schema: z.object({
      action: z.enum(["run", "bug", "attach", "list"]).default("attach"),
      ticket_id: z.string().optional(),
      suite: z.string().optional(),
      status: z.enum(store.QA_RUN_STATUSES).optional(),
      summary: z.string().optional(),
      source: z.string().optional(),
      title: z.string().optional(),
      severity: z.enum(store.BUG_SEVERITIES).optional(),
      classification: z.enum(store.CLASSIFICATIONS).optional(),
      description: z.string().optional(),
      kind: z.enum(store.EVIDENCE_KINDS).optional(),
      path_or_url: z.string().optional(),
      note: z.string().optional(),
      bug_id: z.string().optional(),
      run_id: z.string().optional(),
    }),
    handler: wrap(async (args) => {
      const ticket_id = args.ticket_id || (await store.resolveTicketId());
      if (args.action === "list") {
        const qa = await store.listQa({ ticket_id });
        return ok(
          { qa },
          lines([
            `Runs (${qa.runs.length})`,
            bullet(qa.runs.map((r) => `${r.id} [${r.status}] ${r.suite || r.summary}`)),
            `Bugs (${qa.bugs.length})`,
            bullet(qa.bugs.map((b) => `${b.id} [${b.status}] ${b.title}`)),
            `Evidências (${qa.evidence.length})`,
            bullet(qa.evidence.map((e) => `${e.id} [${e.kind}] ${e.path_or_url}`)),
          ])
        );
      }
      if (args.action === "run") {
        const run = await store.recordRun({ ...args, ticket_id, status: args.status || "fail" });
        return ok({ run }, `${run.id} [${run.status}] ← ${ticket_id}`);
      }
      if (args.action === "bug") {
        if (!args.title) throw new Error("title é obrigatório para gravar bug");
        const bug = await store.recordBug({ ...args, ticket_id });
        return ok({ bug }, `${bug.id} ${bug.title} ← ${ticket_id}`);
      }
      if (!args.path_or_url) throw new Error("path_or_url é obrigatório para anexar evidência");
      const evidence = await store.attachEvidence({ ...args, ticket_id });
      return ok({ evidence }, `${evidence.id} [${evidence.kind}] ${evidence.path_or_url}`);
    }),
  },
  {
    name: "eng_investigate",
    title: "Investigação / RCA",
    description:
      "ENGINEERING: abre investigação no ticket em foco, adiciona finding (hipótese/evidência) ou fecha com causa raiz. Reusa a investigação aberta se já existir.",
    schema: z.object({
      action: z.enum(["open", "finding", "conclude", "list"]).default("finding"),
      ticket_id: z.string().optional(),
      title: z.string().optional(),
      hypothesis: z.string().optional(),
      kind: z.enum(store.FINDING_KINDS).optional(),
      body: z.string().optional(),
      root_cause: z.string().optional(),
      classification: z.enum(store.CLASSIFICATIONS).optional(),
      bug_id: z.string().optional(),
    }),
    handler: wrap(async (args) => {
      const ticket_id = args.ticket_id || (await store.resolveTicketId());
      if (args.action === "list") {
        const investigations = await store.listInvestigations({ ticket_id });
        return ok(
          { investigations },
          investigations.length
            ? bullet(investigations.map((i) => `${i.id} [${i.status}] ${i.title}`))
            : "Nenhuma investigação."
        );
      }
      if (args.action === "open") {
        const investigation = await store.openInvestigation({
          ticket_id,
          bug_id: args.bug_id,
          title: args.title || `Investigação ${ticket_id}`,
          hypothesis: args.hypothesis,
        });
        return ok({ investigation }, `${investigation.id} aberta em ${ticket_id}`);
      }
      if (args.action === "conclude") {
        const investigation = await store.concludeOpenInvestigation({
          ticket_id,
          root_cause: args.root_cause,
          classification: args.classification,
          hypothesis: args.hypothesis,
        });
        return ok(
          { investigation },
          `${investigation.id} [${investigation.classification}] ${investigation.root_cause}`
        );
      }
      const out = await store.addFindingToTicket({
        ticket_id,
        bug_id: args.bug_id,
        title: args.title,
        kind: args.kind,
        body: args.body || args.hypothesis,
        hypothesis: args.hypothesis,
      });
      return ok({ ...out }, `${out.finding.id} [${out.finding.kind}] ${out.finding.body}`);
    }),
  },
  {
    name: "eng_time",
    title: "Tempo e sessão",
    description:
      "ENGINEERING: estimativa, lançamento em horas, ou sessão em minutos no ticket em foco. Variância entra nas métricas.",
    schema: z.object({
      action: z.enum(["estimate", "log", "session", "metrics"]).default("session"),
      ticket_id: z.string().optional(),
      hours: z.number().optional(),
      minutes: z.number().optional(),
      note: z.string().optional(),
      project_id: z.string().optional(),
      project_key: z.string().optional(),
    }),
    handler: wrap(async (args) => {
      if (args.action === "metrics") {
        const metrics = await store.timeMetrics(args);
        return ok({ metrics }, formatMetrics(metrics));
      }
      const ticket_id = args.ticket_id || (await store.resolveTicketId());
      if (args.action === "estimate") {
        const estimate = await store.setEstimate({ ticket_id, hours: args.hours, note: args.note });
        return ok({ estimate }, `${ticket_id}: ${estimate.hours}h estimadas`);
      }
      if (args.action === "log") {
        const log = await store.logTime({ ticket_id, hours: args.hours, note: args.note });
        return ok({ log }, `+${log.hours}h em ${ticket_id}`);
      }
      const minutes = args.minutes ?? (args.hours != null ? args.hours * 60 : null);
      const logged = await store.logWorkSession({ ticket_id, minutes, note: args.note });
      return ok(logged, `+${logged.session.minutes} min em ${ticket_id} (${logged.log.hours}h)`);
    }),
  },
  {
    name: "eng_knowledge",
    title: "Conhecimento local",
    description: "ENGINEERING: grava ou busca playbook/lição/padrão. FTS local, sem nuvem.",
    schema: z.object({
      action: z.enum(["save", "search", "similar"]).default("search"),
      title: z.string().optional(),
      body: z.string().optional(),
      kind: z.enum(store.KNOWLEDGE_KINDS).optional(),
      tags: z.union([z.string(), z.array(z.string())]).optional(),
      query: z.string().optional(),
      ticket_id: z.string().optional(),
      limit: z.number().optional(),
    }),
    handler: wrap(async (args) => {
      if (args.action === "save") {
        const ticket_id = args.ticket_id || (await store.getFocus())?.id;
        const item = await store.saveKnowledge({ ...args, ticket_id });
        return ok({ knowledge: item }, `${item.id} [${item.kind}] ${item.title}`);
      }
      if (args.action === "similar") {
        const ticket_id = args.ticket_id || (await store.getFocus())?.id;
        const similar = await store.similarTickets({ ticket_id, query: args.query, limit: args.limit });
        return ok({ similar }, formatSimilar(similar));
      }
      const items = await store.searchKnowledge({ query: args.query, limit: args.limit });
      return ok(
        { items },
        items.length
          ? bullet(items.map((k) => `${k.id} [${k.kind}] ${k.title}`))
          : "Nada encontrado."
      );
    }),
  },
  {
    name: "eng_report",
    title: "Pacote e daily",
    description:
      "ENGINEERING: pacote do ticket em foco, resumo da daily, ou snapshot de status do projeto.",
    schema: z.object({
      action: z.enum(["ticket", "daily", "status"]).default("ticket"),
      ticket_id: z.string().optional(),
      project_id: z.string().optional(),
      project_key: z.string().optional(),
      days: z.number().optional(),
    }),
    handler: wrap(async (args) => {
      if (args.action === "daily") {
        const report = await store.dailyReport(args);
        return ok({ report }, formatDaily(report));
      }
      if (args.action === "status") {
        const report = await store.statusReport(args);
        const counts = Object.entries(report.ticket_counts)
          .map(([k, v]) => `${k}:${v}`)
          .join("  ");
        return ok(
          { report },
          lines([
            `# Status ${report.project ? report.project.name : "global"}`,
            `Tickets: ${report.ticket_total}  ${counts}`,
            `Tempo: ${report.time.actual}h / ${report.time.estimated}h  Δ ${report.time.variance}h`,
          ])
        );
      }
      const context = await store.ticketContext(args.ticket_id);
      const advice = await advise({ ticket_id: context.ticket.id, event: "report" });
      return ok({ context, advice }, formatContext(context, advice));
    }),
  },
];
