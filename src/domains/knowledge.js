import { z } from "zod";
import { ok, wrap, bullet } from "../lib/respond.js";
import * as store from "../lib/store.js";

export const tools = [
  {
    name: "knowledge_save",
    title: "Salvar conhecimento",
    description:
      "KNOWLEDGE: grava playbook, lição ou padrão a partir de uma investigação. Memória local (FTS).",
    schema: z.object({
      title: z.string(),
      body: z.string(),
      kind: z.enum(store.KNOWLEDGE_KINDS).optional(),
      tags: z.union([z.string(), z.array(z.string())]).optional(),
      investigation_id: z.string().optional(),
      ticket_id: z.string().optional(),
    }),
    handler: wrap(async (args) => {
      const item = store.saveKnowledge(args);
      return ok({ knowledge: item }, `${item.id} [${item.kind}] ${item.title}`);
    }),
  },
  {
    name: "knowledge_search",
    title: "Buscar conhecimento",
    description: "KNOWLEDGE: busca playbooks/lições por texto. Use antes de reabrir bug parecido.",
    schema: z.object({
      query: z.string().optional().describe("Texto livre. Vazio = mais recentes."),
      limit: z.number().optional(),
    }),
    handler: wrap(async (args) => {
      const items = store.searchKnowledge(args);
      return ok(
        { items },
        items.length
          ? bullet(items.map((k) => `${k.id} [${k.kind}] ${k.title} — ${k.body.slice(0, 120)}`))
          : "Nada encontrado. Grave com knowledge_save."
      );
    }),
  },
];
