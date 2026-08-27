import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "eng-mcp-"));
process.env.ENGINEERING_MCP_DB = join(dir, "test.db");
process.env.ENGINEERING_MCP_MACHINE = "test-runner";

const store = await import(new URL("../src/lib/store.js", import.meta.url).href);
const { learnTick } = await import(new URL("../src/lib/learn.js", import.meta.url).href);
const { parseUtterance, dispatch } = await import(new URL("../src/lib/route.js", import.meta.url).href);

describe("engineering-mcp store", () => {
  before(async () => {
    await store.initDatabase(process.env.ENGINEERING_MCP_DB);
  });

  after(async () => {
    await store.closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it("fecha o loop work → qa → time → investigation → knowledge → reporting", async () => {
    const project = await store.upsertProject({
      name: "Atlas",
      key: "ATL",
      description: "app mobile",
    });
    assert.equal(project.key, "ATL");

    const ticket = await store.upsertTicket({
      project_key: "ATL",
      title: "Timeout no checkout",
      type: "bug",
      priority: "p1",
      status: "doing",
    });
    assert.equal(ticket.id, "ATL-1");

    await store.upsertTask({ ticket_id: ticket.id, title: "Reproduzir no Android 13" });
    await store.setEstimate({ ticket_id: ticket.id, hours: 4 });
    await store.logTime({ ticket_id: ticket.id, hours: 1.5, note: "repro + logs" });

    const run = await store.recordRun({
      ticket_id: ticket.id,
      suite: "checkout.spec.js",
      status: "fail",
      source: "ci",
    });
    const bug = await store.recordBug({
      ticket_id: ticket.id,
      title: "Timeout ao finalizar pedido",
      severity: "high",
      classification: "unknown",
    });
    await store.attachEvidence({
      ticket_id: ticket.id,
      run_id: run.id,
      kind: "log",
      path_or_url: "/tmp/checkout.log",
    });

    const inv = await store.openInvestigation({
      ticket_id: ticket.id,
      bug_id: bug.id,
      title: "Checkout timeout Android 13",
      hypothesis: "seletor do botão Finalizar ficou instável após redesign",
    });
    await store.addFinding({
      investigation_id: inv.id,
      kind: "evidence",
      body: "Wait for displayed estourou em 10s no botão #finish",
    });
    const closed = await store.concludeInvestigation({
      investigation_id: inv.id,
      classification: "flaky",
      root_cause: "timing no botão Finalizar após animação do redesign",
    });
    assert.equal(closed.status, "concluded");

    const lesson = await store.saveKnowledge({
      title: "Checkout: wait na animação do Finalizar",
      kind: "playbook",
      body: "Esperar animação terminar + usar data-testid no botão Finalizar. Não usar XPath de classe CSS.",
      tags: ["checkout", "flaky", "android"],
      investigation_id: inv.id,
      ticket_id: ticket.id,
    });
    const found = await store.searchKnowledge({ query: "checkout flaky" });
    assert.ok(found.some((k) => k.id === lesson.id));

    const packet = await store.ticketPacket(ticket.id);
    assert.equal(packet.qa.runs.length, 1);
    assert.equal(packet.qa.bugs.length, 1);
    assert.equal(packet.investigations[0].classification, "flaky");
    assert.equal(packet.time.tickets[0].actual, 1.5);
    assert.ok(packet.knowledge.length >= 1);
    assert.ok(packet.knowledge.some((k) => k.kind === "lesson" && k.source === "learned"));

    const report = await store.statusReport({ project_key: "ATL", days: 7 });
    assert.equal(report.ticket_total, 1);
    assert.equal(report.ticket_counts.doing, 1);
    assert.ok(report.qa_fail_in_window >= 1);
  });

  it("work_board agrupa por status", async () => {
    await store.upsertTicket({ project_key: "ATL", title: "Spike de métricas", type: "spike", status: "backlog" });
    const board = await store.board({ project_key: "ATL" });
    assert.equal(board.total, 2);
    assert.equal(board.columns.doing.length, 1);
    assert.equal(board.columns.backlog.length, 1);
  });

  it("learnTick gera pattern sem duplicar e recall incrementa hits", async () => {
    const ticket = await store.upsertTicket({
      project_key: "ATL",
      title: "Login flaky",
      type: "bug",
      status: "doing",
    });
    for (let i = 0; i < 3; i += 1) {
      await store.recordRun({
        ticket_id: ticket.id,
        suite: "login.spec.js",
        status: "fail",
        source: "ci",
      });
    }
    const patterns = (await store.searchKnowledge({ query: "login.spec.js" })).filter((k) => k.kind === "pattern");
    assert.equal(patterns.length, 1);
    const firstId = patterns[0].id;

    await store.recordRun({
      ticket_id: ticket.id,
      suite: "login.spec.js",
      status: "fail",
      source: "ci",
    });
    const again = (await store.searchKnowledge({ query: "login.spec.js" })).filter((k) => k.kind === "pattern");
    assert.equal(again.length, 1);
    assert.equal(again[0].id, firstId);

    const improvement = (await store.listTickets({ project_key: "ATL" })).find((t) =>
      t.title.startsWith("Melhoria: login.spec.js")
    );
    assert.ok(improvement, "segunda ocorrência abre ticket de melhoria");

    const recalled = await store.recallKnowledge({ query: "login.spec.js" });
    const hit = recalled.find((k) => k.id === firstId);
    assert.ok(hit);
    assert.ok(hit.hits >= 1);

    const stats = await store.memoryStats();
    assert.equal(stats.machine_id, "test-runner");
    assert.equal(stats.remote, false);
    assert.ok(stats.events >= 1);
    assert.ok(stats.knowledge_hits >= 1);
  });

  it("catalog anônimo não leva título, ticket nem suite", async () => {
    const { sanitize, readNotes } = await import(new URL("../src/intel/index.js", import.meta.url).href);
    const note = sanitize({
      domain: "qa",
      used: "qa_run",
      pain: "fail",
      title: "Timeout no checkout",
      ticket_id: "ATL-1",
      suite: "checkout.spec.js",
    });
    assert.ok(note);
    assert.equal(note.title, undefined);
    assert.equal(note.ticket_id, undefined);
    assert.equal(note.suite, undefined);
    assert.equal(note.pain, "fail");
    const blob = JSON.stringify(readNotes());
    assert.equal(blob.includes("ATL-1"), false);
    assert.equal(blob.includes("checkout.spec"), false);
    assert.equal(blob.includes("Timeout"), false);
  });

  it("advise sussurra playbook e próximo passo no foco", async () => {
    await store.focusTicket("ATL-1");
    const { advise, formatAdvice } = await import(new URL("../src/lib/advise.js", import.meta.url).href);
    const { hintFor } = await import(new URL("../src/intel/index.js", import.meta.url).href);
    assert.match(hintFor("timeout no checkout"), /espera|testid/i);
    const advice = await advise({ ticket_id: "ATL-1", event: "focus", text: "Comecei o ATL-1" });
    assert.ok(advice.knowledge.length >= 1 || advice.similar.length >= 1 || advice.hint || advice.next);
    assert.match(formatAdvice(advice), /Memória/);
  });

  it("advise cala quando não há sinal e contexto vem em blocos", async () => {
    const { advise, formatAdvice, formatContext, hasSignal } = await import(
      new URL("../src/lib/advise.js", import.meta.url).href
    );
    const quiet = await store.upsertTicket({
      project_key: "ATL",
      title: "Relatorio fiscal zebra trimestral",
      type: "task",
      status: "review",
    });
    await store.recordRun({ ticket_id: quiet.id, suite: "fiscal.spec.js", status: "pass" });
    await store.logTime({ ticket_id: quiet.id, hours: 0.5 });
    const silent = await advise({ ticket_id: quiet.id, event: "focus", text: `Comecei o ${quiet.id}` });
    assert.equal(silent.next, null);
    assert.equal(hasSignal(silent), false);
    assert.equal(formatAdvice(silent), null);

    await store.focusTicket("ATL-1");
    const ctx = await store.ticketContext("ATL-1");
    const brief = formatContext(ctx, await advise({ ticket_id: "ATL-1", event: "context" }));
    assert.match(brief, /CURRENT_STATE/);
    assert.match(brief, /\[fact\]/);
    assert.match(brief, /EVIDENCE/);
    assert.match(brief, /RELATED_MEMORY/);
  });

  it("learnTick grava lesson de overrun sem duplicar", async () => {
    const ticket = await store.upsertTicket({
      project_key: "ATL",
      title: "Refino de estimativa",
      type: "task",
      status: "doing",
    });
    await store.setEstimate({ ticket_id: ticket.id, hours: 1 });
    await store.logTime({ ticket_id: ticket.id, hours: 2.5, note: "estourou" });
    const result = await learnTick({ trigger: "test" });
    assert.ok(result.learned >= 1);
    const lessons = (await store.searchKnowledge({ query: ticket.id })).filter((k) =>
      k.title.includes("Estimativa estourou")
    );
    assert.equal(lessons.length, 1);
    await learnTick({ trigger: "test" });
    const again = (await store.searchKnowledge({ query: ticket.id })).filter((k) =>
      k.title.includes("Estimativa estourou")
    );
    assert.equal(again.length, 1);
  });

  it("sessão ativa, work session, similar, contexto e daily", async () => {
    const focused = await store.focusTicket("ATL-1");
    assert.equal(focused.status, "doing");
    assert.equal((await store.getFocus()).id, "ATL-1");
    assert.equal(await store.resolveTicketId(), "ATL-1");

    const tagged = await store.upsertTicket({
      id: "ATL-1",
      tags: ["checkout", "android"],
      component: "checkout",
    });
    assert.match(tagged.tags, /checkout/);
    assert.equal(tagged.component, "checkout");

    await store.upsertTicket({
      project_key: "ATL",
      title: "Timeout no checkout iOS",
      type: "bug",
      tags: ["checkout", "ios"],
      component: "checkout",
    });

    const session = await store.logWorkSession({ minutes: 40, note: "repro 401" });
    assert.equal(session.session.ticket_id, "ATL-1");
    assert.equal(session.session.minutes, 40);
    assert.ok(session.log.hours > 0.6 && session.log.hours < 0.7);

    const metrics = await store.timeMetrics({ ticket_id: "ATL-1" });
    assert.equal(metrics.tickets[0].variance, Number((metrics.tickets[0].actual - metrics.tickets[0].estimated).toFixed(2)));
    assert.ok(metrics.sessions.some((s) => s.id === session.session.id));

    const similar = await store.similarTickets({ ticket_id: "ATL-1" });
    assert.ok(similar.tickets.some((t) => /checkout/i.test(t.title)));

    const finding = await store.addFindingToTicket({
      kind: "hypothesis",
      body: "seletor do botão Finalizar instável",
    });
    assert.ok(finding.investigation.id);
    assert.equal(finding.finding.kind, "hypothesis");

    const ctx = await store.ticketContext();
    assert.equal(ctx.ticket.id, "ATL-1");
    assert.equal(ctx.focused, true);
    assert.ok(ctx.qa.evidence.length >= 1);
    assert.ok(ctx.investigations.length >= 1);
    assert.ok(ctx.similar.tickets.length >= 1);

    const daily = await store.dailyReport({ days: 1 });
    assert.ok(daily.hours > 0);
    assert.ok(daily.tickets.some((t) => t.id === "ATL-1"));
    assert.ok(daily.doing.some((t) => t.id === "ATL-1"));
  });

  it("eng_route reconhece e executa o ciclo em linguagem natural", async () => {
    assert.equal(parseUtterance("Comecei o ATL-1").action, "focus");
    assert.equal(parseUtterance("Comecei o ATL-1").ticket_id, "ATL-1");
    assert.equal(parseUtterance("anexa evidência 401").action, "run");
    assert.equal(parseUtterance("hipótese: seletor instável").action, "finding");
    assert.equal(parseUtterance("40 min").action, "session");
    assert.equal(parseUtterance("40 min").minutes, 40);
    assert.equal(parseUtterance("causa raiz: timing no botão, flaky").action, "conclude");
    assert.equal(parseUtterance("causa raiz: timing no botão, flaky").classification, "flaky");
    assert.equal(parseUtterance("fechei, done").action, "done");
    assert.equal(parseUtterance("o que aconteceu?").action, "context");
    assert.equal(parseUtterance("já vimos isso?").action, "similar");
    assert.equal(parseUtterance("me prepara para a daily").action, "daily");

    const start = await dispatch("Comecei o ATL-1");
    assert.equal(start.data.ticket.id, "ATL-1");
    assert.equal((await store.getFocus()).id, "ATL-1");
    assert.match(start.text, /Memória/);
    assert.match(start.text, /Próximo:/);

    const evidence = await dispatch("anexa evidência 401");
    assert.equal(evidence.domain, "qa");

    const time = await dispatch("1 hora");
    assert.equal(time.domain, "time");
    assert.equal(time.data.session.minutes, 60);

    const hypo = await dispatch("hipótese: timeout depois da animação");
    assert.equal(hypo.data.finding.kind, "hypothesis");

    const ctx = await dispatch("o que aconteceu?");
    assert.match(ctx.text, /CURRENT_STATE/);
    assert.match(ctx.text, /ATL-1/);
    assert.match(ctx.text, /\[fact\]/);

    const similar = await dispatch("já vimos isso?");
    assert.ok(similar.data.similar);

    const daily = await dispatch("me prepara para a daily");
    assert.match(daily.text, /Daily/);

    const done = await dispatch("done");
    assert.equal(done.data.ticket.status, "done");
  });

  it("frase sem ID cria ticket e banco vazio também funciona", async () => {
    const parsed = parseUtterance("Comecei um bug: timeout no checkout");
    assert.equal(parsed.action, "focus");
    assert.equal(parsed.type, "bug");
    assert.match(parsed.title, /timeout no checkout/i);

    const created = await dispatch("Comecei um bug: falha no webhook xyzzy");
    assert.equal(created.data.ticket.type, "bug");
    assert.match(created.data.ticket.title, /webhook xyzzy/i);
    assert.equal((await store.getFocus()).id, created.data.ticket.id);

    const named = await dispatch("Comecei o NEWB-1");
    assert.match(named.data.ticket.id, /^NEWB-\d+$/);
    assert.ok(await store.findProject({ key: "NEWB" }));

    const emptyDir = mkdtempSync(join(tmpdir(), "eng-mcp-empty-"));
    const emptyDb = join(emptyDir, "empty.db");
    await store.closeDatabase();
    await store.initDatabase(emptyDb);
    try {
      const first = await dispatch("Comecei um bug: timeout no checkout");
      assert.equal(first.data.ticket.id, "ENG-1");
      assert.equal(first.data.ticket.type, "bug");
      assert.equal((await store.getFocus()).id, "ENG-1");
      const ev = await dispatch("anexa evidência 401");
      assert.equal(ev.domain, "qa");
    } finally {
      await store.closeDatabase();
      rmSync(emptyDir, { recursive: true, force: true });
      await store.initDatabase(process.env.ENGINEERING_MCP_DB);
    }
  });
});
