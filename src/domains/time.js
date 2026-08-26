import { z } from "zod";
import { ok, wrap, lines, bullet } from "../lib/respond.js";
import * as store from "../lib/store.js";

function formatMetrics(metrics) {
  return lines([
    metrics.project ? `Projeto: ${metrics.project.name}` : "Escopo: todos os tickets",
    `Estimado: ${metrics.estimated}h  |  Real: ${metrics.actual}h  |  Restante: ${metrics.remaining}h`,
    metrics.accuracy != null ? `Acurácia (real/estimado): ${metrics.accuracy}` : "Sem estimativas ainda",
    bullet(
      metrics.tickets
        .filter((t) => t.estimated || t.actual)
        .map(
          (t) =>
            `${t.ticket_id} [${t.status}] est ${t.estimated}h / real ${t.actual}h${t.overrun ? " OVER" : ""}`
        ),
      "- (sem tempo lançado)"
    ),
  ]);
}

export const tools = [
  {
    name: "time_estimate",
    title: "Definir estimativa",
    description: "TIME: grava ou atualiza a estimativa em horas de um ticket.",
    schema: z.object({
      ticket_id: z.string(),
      hours: z.number().describe("Estimativa em horas."),
      note: z.string().optional(),
    }),
    handler: wrap(async (args) => {
      const estimate = store.setEstimate(args);
      return ok({ estimate }, `${estimate.ticket_id}: ${estimate.hours}h estimadas`);
    }),
  },
  {
    name: "time_log",
    title: "Lançar horas",
    description: "TIME: lança tempo trabalhado em um ticket ou task.",
    schema: z.object({
      ticket_id: z.string().optional(),
      task_id: z.string().optional(),
      hours: z.number().describe("Horas trabalhadas (> 0)."),
      note: z.string().optional(),
      logged_at: z.string().optional().describe("ISO-8601. Default: agora."),
    }),
    handler: wrap(async (args) => {
      const log = store.logTime(args);
      return ok({ log }, `${log.id}: +${log.hours}h em ${log.ticket_id || log.task_id || "geral"}`);
    }),
  },
  {
    name: "time_metrics",
    title: "Métricas de tempo",
    description: "TIME: estimado vs real vs restante, por ticket, projeto ou global.",
    schema: z.object({
      ticket_id: z.string().optional(),
      project_id: z.string().optional(),
      project_key: z.string().optional(),
    }),
    handler: wrap(async (args) => {
      const metrics = store.timeMetrics(args);
      return ok({ metrics }, formatMetrics(metrics));
    }),
  },
];
