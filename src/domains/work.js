import { z } from "zod";
import { ok, wrap, lines, bullet } from "../lib/respond.js";
import * as store from "../lib/store.js";

function formatTicket(ticket) {
  if (!ticket) return "Ticket não encontrado.";
  return lines([
    `${ticket.id}  [${ticket.status}/${ticket.type}/${ticket.priority}]  ${ticket.title}`,
    ticket.project ? `Projeto: ${ticket.project.name} (${ticket.project.key})` : null,
    ticket.external_key ? `Externo: ${ticket.external_key}` : null,
    ticket.description ? `Desc: ${ticket.description}` : null,
    ticket.tasks?.length
      ? `Tasks:\n${bullet(ticket.tasks.map((t) => `${t.id} [${t.status}] ${t.title}`))}`
      : "Tasks: (nenhuma)",
  ]);
}

export const tools = [
  {
    name: "work_upsert_project",
    title: "Criar ou atualizar projeto",
    description:
      "WORK: cria ou atualiza um projeto de engenharia (ex: app, backend, QA lab). Use antes de abrir tickets.",
    schema: z.object({
      id: z.string().optional().describe("Slug estável. Se omitido, deriva do nome."),
      key: z.string().optional().describe("Prefixo dos tickets, ex: ATL, ENG, APP."),
      name: z.string().optional().describe("Nome do projeto. Obrigatório na criação."),
      description: z.string().optional(),
      status: z.enum(["active", "archived"]).optional(),
    }),
    handler: wrap(async (args) => {
      const project = store.upsertProject(args);
      return ok(
        { project },
        `Projeto ${project.id} (${project.key}) — ${project.name} [${project.status}]`
      );
    }),
  },
  {
    name: "work_list_projects",
    title: "Listar projetos",
    description: "WORK: lista projetos locais do Engineering MCP.",
    schema: z.object({
      status: z.enum(["active", "archived"]).optional(),
    }),
    handler: wrap(async (args) => {
      const projects = store.listProjects(args);
      return ok(
        { projects },
        projects.length
          ? bullet(projects.map((p) => `${p.id} (${p.key}) — ${p.name} [${p.status}]`))
          : "Nenhum projeto. Crie com work_upsert_project."
      );
    }),
  },
  {
    name: "work_upsert_ticket",
    title: "Criar ou atualizar ticket",
    description:
      "WORK: cria/atualiza ticket (story, bug, task, spike, epic). IDs no formato KEY-N (ex: ENG-3). Passe id para atualizar status.",
    schema: z.object({
      id: z.string().optional().describe("ID existente para atualizar, ex: ENG-3."),
      project_id: z.string().optional().describe("Slug do projeto."),
      project_key: z.string().optional().describe("Key do projeto, ex: ENG."),
      title: z.string().optional(),
      type: z.enum(store.TICKET_TYPES).optional(),
      status: z.enum(store.TICKET_STATUSES).optional(),
      priority: z.enum(store.PRIORITIES).optional(),
      description: z.string().optional(),
      external_key: z.string().optional().describe("Chave Jira/GitLab opcional, ex: APP-442."),
    }),
    handler: wrap(async (args) => {
      const ticket = store.upsertTicket(args);
      return ok({ ticket }, formatTicket(ticket));
    }),
  },
  {
    name: "work_upsert_task",
    title: "Criar ou atualizar task",
    description: "WORK: cria/atualiza uma task filha de um ticket.",
    schema: z.object({
      id: z.string().optional(),
      ticket_id: z.string().optional().describe("Obrigatório na criação, ex: ENG-3."),
      title: z.string().optional(),
      status: z.enum(store.TICKET_STATUSES).optional(),
    }),
    handler: wrap(async (args) => {
      const task = store.upsertTask(args);
      return ok({ task }, `${task.id} [${task.status}] ${task.title} ← ${task.ticket_id}`);
    }),
  },
  {
    name: "work_list",
    title: "Listar tickets",
    description: "WORK: lista tickets com filtro por projeto, status, tipo ou texto.",
    schema: z.object({
      project_id: z.string().optional(),
      project_key: z.string().optional(),
      status: z.enum(store.TICKET_STATUSES).optional(),
      type: z.enum(store.TICKET_TYPES).optional(),
      query: z.string().optional(),
    }),
    handler: wrap(async (args) => {
      const tickets = store.listTickets(args);
      return ok(
        { tickets },
        tickets.length
          ? bullet(tickets.map((t) => `${t.id} [${t.status}/${t.type}] ${t.title}`))
          : "Nenhum ticket."
      );
    }),
  },
  {
    name: "work_board",
    title: "Board kanban",
    description: "WORK: visão kanban (backlog/todo/doing/review/done) de um projeto.",
    schema: z.object({
      project_id: z.string().optional(),
      project_key: z.string().optional(),
    }),
    handler: wrap(async (args) => {
      const board = store.board(args);
      const text = lines([
        board.project ? `Projeto: ${board.project.name} (${board.project.key})` : "Todos os projetos",
        `Total: ${board.total}`,
        ...store.TICKET_STATUSES.map((status) => {
          const col = board.columns[status];
          return `\n## ${status.toUpperCase()} (${col.length})\n${bullet(
            col.map((t) => `${t.id} ${t.title}`),
            "- (vazio)"
          )}`;
        }),
      ]);
      return ok({ board }, text);
    }),
  },
  {
    name: "work_get",
    title: "Detalhe do ticket",
    description: "WORK: detalhe de um ticket com tasks. Para pacote completo (QA+tempo+investigação) use report_ticket.",
    schema: z.object({
      id: z.string().describe("ID do ticket, ex: ENG-3."),
    }),
    handler: wrap(async ({ id }) => {
      const ticket = store.getTicket(id);
      if (!ticket) throw new Error(`ticket não encontrado: ${id}`);
      return ok({ ticket }, formatTicket(ticket));
    }),
  },
];
