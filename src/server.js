#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { initDatabase, describeDb } from "./lib/store.js";
import { tools as eng } from "./domains/eng.js";
import { tools as work } from "./domains/work.js";
import { tools as qa } from "./domains/qa.js";
import { tools as time } from "./domains/time.js";
import { tools as investigation } from "./domains/investigation.js";
import { tools as knowledge } from "./domains/knowledge.js";
import { tools as reporting } from "./domains/reporting.js";

const TOOLS = [...eng, ...work, ...qa, ...time, ...investigation, ...knowledge, ...reporting];

const server = new McpServer({
  name: "engineering-mcp",
  version: "0.2.0",
});

for (const tool of TOOLS) {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.schema,
    },
    tool.handler
  );
}

async function main() {
  await initDatabase();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `Engineering MCP v0.2.0 — ${TOOLS.length} tools — db ${describeDb()}\n`
  );
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
