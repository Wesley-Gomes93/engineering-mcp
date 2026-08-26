import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "eng-mcp-"));
process.env.ENGINEERING_MCP_DB = join(dir, "test.db");

const store = await import(new URL("../src/lib/store.js", import.meta.url).href);

describe("engineering-mcp store", () => {
  before(() => {
    store.initDatabase(process.env.ENGINEERING_MCP_DB);
  });

  after(() => {
    store.closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it("fecha o loop work → qa → time → investigation → knowledge → reporting", () => {
    const project = store.upsertProject({
      name: "Atlas",
      key: "ATL",
      description: "app mobile",
    });
    assert.equal(project.key, "ATL");

    const ticket = store.upsertTicket({
      project_key: "ATL",
      title: "Timeout no checkout",
      type: "bug",
      priority: "p1",
      status: "doing",
    });
    assert.equal(ticket.id, "ATL-1");

    store.upsertTask({ ticket_id: ticket.id, title: "Reproduzir no Android 13" });
    store.setEstimate({ ticket_id: ticket.id, hours: 4 });
    store.logTime({ ticket_id: ticket.id, hours: 1.5, note: "repro + logs" });

    const run = store.recordRun({
      ticket_id: ticket.id,
      suite: "checkout.spec.js",
      status: "fail",
      source: "ci",
    });
    const bug = store.recordBug({
      ticket_id: ticket.id,
      title: "Timeout ao finalizar pedido",
      severity: "high",
      classification: "unknown",
    });
    store.attachEvidence({
      ticket_id: ticket.id,
      run_id: run.id,
      kind: "log",
      path_or_url: "/tmp/checkout.log",
    });

    const inv = store.openInvestigation({
      ticket_id: ticket.id,
      bug_id: bug.id,
      title: "Checkout timeout Android 13",
      hypothesis: "seletor do botão Finalizar ficou instável após redesign",
    });
    store.addFinding({
      investigation_id: inv.id,
      kind: "evidence",
      body: "Wait for displayed estourou em 10s no botão #finish",
    });
    const closed = store.concludeInvestigation({
      investigation_id: inv.id,
      classification: "flaky",
      root_cause: "timing no botão Finalizar após animação do redesign",
    });
    assert.equal(closed.status, "concluded");

    const lesson = store.saveKnowledge({
      title: "Checkout: wait na animação do Finalizar",
      kind: "playbook",
      body: "Esperar animação terminar + usar data-testid no botão Finalizar. Não usar XPath de classe CSS.",
      tags: ["checkout", "flaky", "android"],
      investigation_id: inv.id,
      ticket_id: ticket.id,
    });
    const found = store.searchKnowledge({ query: "checkout flaky" });
    assert.ok(found.some((k) => k.id === lesson.id));

    const packet = store.ticketPacket(ticket.id);
    assert.equal(packet.qa.runs.length, 1);
    assert.equal(packet.qa.bugs.length, 1);
    assert.equal(packet.investigations[0].classification, "flaky");
    assert.equal(packet.time.tickets[0].actual, 1.5);
    assert.equal(packet.knowledge.length, 1);

    const report = store.statusReport({ project_key: "ATL", days: 7 });
    assert.equal(report.ticket_total, 1);
    assert.equal(report.ticket_counts.doing, 1);
    assert.ok(report.qa_fail_in_window >= 1);
  });

  it("work_board agrupa por status", () => {
    store.upsertTicket({ project_key: "ATL", title: "Spike de métricas", type: "spike", status: "backlog" });
    const board = store.board({ project_key: "ATL" });
    assert.equal(board.total, 2);
    assert.equal(board.columns.doing.length, 1);
    assert.equal(board.columns.backlog.length, 1);
  });
});
