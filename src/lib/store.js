import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { nowIso, uid, slugify, normalizeKey } from "./ids.js";

let db;

export const TICKET_TYPES = ["epic", "story", "task", "bug", "spike"];
export const TICKET_STATUSES = ["backlog", "todo", "doing", "review", "done"];
export const PRIORITIES = ["p0", "p1", "p2", "p3"];
export const QA_RUN_STATUSES = ["pass", "fail", "flaky", "blocked"];
export const BUG_SEVERITIES = ["critical", "high", "medium", "low"];
export const CLASSIFICATIONS = ["bug", "flaky", "infra", "regression", "unknown"];
export const EVIDENCE_KINDS = ["log", "screenshot", "report", "url", "note"];
export const FINDING_KINDS = ["observation", "evidence", "hypothesis", "decision"];
export const KNOWLEDGE_KINDS = ["playbook", "lesson", "pattern"];

export function defaultDbPath() {
  return join(homedir(), ".engineering-mcp", "engineering.db");
}

export function getDbPath() {
  if (process.env.ENGINEERING_MCP_DB) return resolve(process.env.ENGINEERING_MCP_DB);
  return defaultDbPath();
}

export function initDatabase(dbPath = getDbPath()) {
  mkdirSync(dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode = WAL`);
  db.exec(`PRAGMA foreign_keys = ON`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS counters (
      name  TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      key         TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'active',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id           TEXT PRIMARY KEY,
      project_id   TEXT NOT NULL,
      title        TEXT NOT NULL,
      type         TEXT NOT NULL DEFAULT 'task',
      status       TEXT NOT NULL DEFAULT 'backlog',
      priority     TEXT NOT NULL DEFAULT 'p2',
      description  TEXT NOT NULL DEFAULT '',
      external_key TEXT,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id         TEXT PRIMARY KEY,
      ticket_id  TEXT NOT NULL,
      title      TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'todo',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id)
    );

    CREATE TABLE IF NOT EXISTS qa_runs (
      id         TEXT PRIMARY KEY,
      ticket_id  TEXT,
      suite      TEXT NOT NULL DEFAULT '',
      status     TEXT NOT NULL,
      summary    TEXT NOT NULL DEFAULT '',
      source     TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS qa_bugs (
      id             TEXT PRIMARY KEY,
      ticket_id      TEXT,
      title          TEXT NOT NULL,
      severity       TEXT NOT NULL DEFAULT 'medium',
      status         TEXT NOT NULL DEFAULT 'open',
      classification TEXT NOT NULL DEFAULT 'unknown',
      description    TEXT NOT NULL DEFAULT '',
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS qa_evidence (
      id          TEXT PRIMARY KEY,
      ticket_id   TEXT,
      bug_id      TEXT,
      run_id      TEXT,
      kind        TEXT NOT NULL,
      path_or_url TEXT NOT NULL,
      note        TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS time_estimates (
      ticket_id  TEXT PRIMARY KEY,
      hours      REAL NOT NULL,
      note       TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id)
    );

    CREATE TABLE IF NOT EXISTS time_logs (
      id         TEXT PRIMARY KEY,
      ticket_id  TEXT,
      task_id    TEXT,
      hours      REAL NOT NULL,
      note       TEXT NOT NULL DEFAULT '',
      logged_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS investigations (
      id             TEXT PRIMARY KEY,
      ticket_id      TEXT,
      bug_id         TEXT,
      title          TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'open',
      hypothesis     TEXT NOT NULL DEFAULT '',
      root_cause     TEXT NOT NULL DEFAULT '',
      classification TEXT NOT NULL DEFAULT 'unknown',
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS findings (
      id               TEXT PRIMARY KEY,
      investigation_id TEXT NOT NULL,
      kind             TEXT NOT NULL,
      body             TEXT NOT NULL,
      created_at       TEXT NOT NULL,
      FOREIGN KEY (investigation_id) REFERENCES investigations(id)
    );

    CREATE TABLE IF NOT EXISTS knowledge (
      id               TEXT PRIMARY KEY,
      title            TEXT NOT NULL,
      kind             TEXT NOT NULL DEFAULT 'lesson',
      body             TEXT NOT NULL,
      tags             TEXT NOT NULL DEFAULT '',
      investigation_id TEXT,
      ticket_id        TEXT,
      created_at       TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      id UNINDEXED,
      title,
      body,
      tags
    );

    CREATE INDEX IF NOT EXISTS idx_tickets_project ON tickets(project_id, status);
    CREATE INDEX IF NOT EXISTS idx_tasks_ticket ON tasks(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_qa_runs_ticket ON qa_runs(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_qa_bugs_ticket ON qa_bugs(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_time_logs_ticket ON time_logs(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_investigations_ticket ON investigations(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_findings_inv ON findings(investigation_id);
  `);
  return db;
}

export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

function getDb() {
  if (!db) initDatabase();
  return db;
}

function one(sql, params = []) {
  return getDb().prepare(sql).get(...params) || null;
}

function many(sql, params = []) {
  return getDb().prepare(sql).all(...params);
}

function run(sql, params = []) {
  return getDb().prepare(sql).run(...params);
}

function nextSeq(name) {
  const row = one("SELECT value FROM counters WHERE name = ?", [name]);
  const next = (row?.value || 0) + 1;
  run("INSERT INTO counters (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value", [
    name,
    next,
  ]);
  return next;
}

function requireEnum(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new Error(`${field} inválido: ${value}. Use: ${allowed.join(", ")}`);
  }
  return value;
}

export function findProject({ id, key } = {}) {
  if (id) return one("SELECT * FROM projects WHERE id = ? OR key = ?", [id, String(id).toUpperCase()]);
  if (key) return one("SELECT * FROM projects WHERE key = ? OR id = ?", [String(key).toUpperCase(), slugify(key)]);
  return null;
}

export function upsertProject({ id, key, name, description, status } = {}) {
  const existing = id || key ? findProject({ id, key }) : null;
  const ts = nowIso();
  if (existing) {
    run(
      `UPDATE projects SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        status = COALESCE(?, status),
        updated_at = ?
       WHERE id = ?`,
      [name ?? null, description ?? null, status ?? null, ts, existing.id]
    );
    return getProject(existing.id);
  }
  if (!name) throw new Error("name é obrigatório para criar projeto");
  const projectId = id || slugify(name);
  const projectKey = normalizeKey(key || name);
  if (!projectKey) throw new Error("key inválida");
  if (findProject({ id: projectId }) || findProject({ key: projectKey })) {
    throw new Error(`Projeto já existe (id=${projectId} key=${projectKey})`);
  }
  run(
    `INSERT INTO projects (id, key, name, description, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [projectId, projectKey, name, description || "", status || "active", ts, ts]
  );
  return getProject(projectId);
}

export function listProjects({ status } = {}) {
  if (status) return many("SELECT * FROM projects WHERE status = ? ORDER BY name", [status]);
  return many("SELECT * FROM projects ORDER BY name");
}

export function getProject(idOrKey) {
  return findProject({ id: idOrKey, key: idOrKey });
}

export function upsertTicket(input = {}) {
  const existing = input.id ? one("SELECT * FROM tickets WHERE id = ?", [input.id]) : null;
  const ts = nowIso();
  if (existing) {
    if (input.type) requireEnum(input.type, TICKET_TYPES, "type");
    if (input.status) requireEnum(input.status, TICKET_STATUSES, "status");
    if (input.priority) requireEnum(input.priority, PRIORITIES, "priority");
    run(
      `UPDATE tickets SET
        title = COALESCE(?, title),
        type = COALESCE(?, type),
        status = COALESCE(?, status),
        priority = COALESCE(?, priority),
        description = COALESCE(?, description),
        external_key = COALESCE(?, external_key),
        updated_at = ?
       WHERE id = ?`,
      [
        input.title ?? null,
        input.type ?? null,
        input.status ?? null,
        input.priority ?? null,
        input.description ?? null,
        input.external_key ?? null,
        ts,
        existing.id,
      ]
    );
    return getTicket(existing.id);
  }
  const project = findProject({ id: input.project_id, key: input.project_key || input.project_id });
  if (!project) throw new Error("projeto não encontrado — use work_upsert_project primeiro");
  if (!input.title) throw new Error("title é obrigatório");
  const type = requireEnum(input.type || "task", TICKET_TYPES, "type");
  const status = requireEnum(input.status || "backlog", TICKET_STATUSES, "status");
  const priority = requireEnum(input.priority || "p2", PRIORITIES, "priority");
  const seq = nextSeq(`ticket:${project.id}`);
  const id = `${project.key}-${seq}`;
  run(
    `INSERT INTO tickets (id, project_id, title, type, status, priority, description, external_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, project.id, input.title, type, status, priority, input.description || "", input.external_key || null, ts, ts]
  );
  return getTicket(id);
}

export function getTicket(id) {
  const ticket = one("SELECT * FROM tickets WHERE id = ?", [id]);
  if (!ticket) return null;
  return {
    ...ticket,
    project: getProject(ticket.project_id),
    tasks: many("SELECT * FROM tasks WHERE ticket_id = ? ORDER BY created_at", [id]),
  };
}

export function listTickets({ project_id, project_key, status, type, query } = {}) {
  const project = project_id || project_key ? findProject({ id: project_id, key: project_key || project_id }) : null;
  const clauses = [];
  const params = [];
  if (project) {
    clauses.push("project_id = ?");
    params.push(project.id);
  }
  if (status) {
    clauses.push("status = ?");
    params.push(status);
  }
  if (type) {
    clauses.push("type = ?");
    params.push(type);
  }
  if (query) {
    clauses.push("(id LIKE ? OR title LIKE ? OR description LIKE ? OR IFNULL(external_key,'') LIKE ?)");
    const like = `%${query}%`;
    params.push(like, like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return many(`SELECT * FROM tickets ${where} ORDER BY updated_at DESC`, params);
}

export function board({ project_id, project_key } = {}) {
  const tickets = listTickets({ project_id, project_key });
  const columns = {};
  for (const status of TICKET_STATUSES) columns[status] = [];
  for (const ticket of tickets) columns[ticket.status].push(ticket);
  return { project: findProject({ id: project_id, key: project_key || project_id }), columns, total: tickets.length };
}

export function upsertTask(input = {}) {
  const existing = input.id ? one("SELECT * FROM tasks WHERE id = ?", [input.id]) : null;
  const ts = nowIso();
  if (existing) {
    if (input.status) requireEnum(input.status, TICKET_STATUSES, "status");
    run(
      `UPDATE tasks SET title = COALESCE(?, title), status = COALESCE(?, status), updated_at = ? WHERE id = ?`,
      [input.title ?? null, input.status ?? null, ts, existing.id]
    );
    return one("SELECT * FROM tasks WHERE id = ?", [existing.id]);
  }
  if (!input.ticket_id) throw new Error("ticket_id é obrigatório");
  if (!getTicket(input.ticket_id)) throw new Error(`ticket não encontrado: ${input.ticket_id}`);
  if (!input.title) throw new Error("title é obrigatório");
  const status = requireEnum(input.status || "todo", TICKET_STATUSES, "status");
  const id = uid("tsk");
  run(
    `INSERT INTO tasks (id, ticket_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.ticket_id, input.title, status, ts, ts]
  );
  return one("SELECT * FROM tasks WHERE id = ?", [id]);
}

export function recordRun(input = {}) {
  if (!input.status) throw new Error("status é obrigatório");
  requireEnum(input.status, QA_RUN_STATUSES, "status");
  if (input.ticket_id && !one("SELECT id FROM tickets WHERE id = ?", [input.ticket_id])) {
    throw new Error(`ticket não encontrado: ${input.ticket_id}`);
  }
  const id = uid("run");
  run(
    `INSERT INTO qa_runs (id, ticket_id, suite, status, summary, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.ticket_id || null, input.suite || "", input.status, input.summary || "", input.source || "manual", nowIso()]
  );
  return one("SELECT * FROM qa_runs WHERE id = ?", [id]);
}

export function recordBug(input = {}) {
  if (!input.title) throw new Error("title é obrigatório");
  const severity = requireEnum(input.severity || "medium", BUG_SEVERITIES, "severity");
  const classification = requireEnum(input.classification || "unknown", CLASSIFICATIONS, "classification");
  const ts = nowIso();
  const id = uid("bug");
  run(
    `INSERT INTO qa_bugs (id, ticket_id, title, severity, status, classification, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.ticket_id || null,
      input.title,
      severity,
      input.status || "open",
      classification,
      input.description || "",
      ts,
      ts,
    ]
  );
  return one("SELECT * FROM qa_bugs WHERE id = ?", [id]);
}

export function attachEvidence(input = {}) {
  if (!input.path_or_url) throw new Error("path_or_url é obrigatório");
  const kind = requireEnum(input.kind || "note", EVIDENCE_KINDS, "kind");
  const id = uid("evd");
  run(
    `INSERT INTO qa_evidence (id, ticket_id, bug_id, run_id, kind, path_or_url, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.ticket_id || null,
      input.bug_id || null,
      input.run_id || null,
      kind,
      input.path_or_url,
      input.note || "",
      nowIso(),
    ]
  );
  return one("SELECT * FROM qa_evidence WHERE id = ?", [id]);
}

export function listQa({ ticket_id } = {}) {
  const filter = ticket_id ? "WHERE ticket_id = ?" : "";
  const params = ticket_id ? [ticket_id] : [];
  return {
    runs: many(`SELECT * FROM qa_runs ${filter} ORDER BY created_at DESC`, params),
    bugs: many(`SELECT * FROM qa_bugs ${filter} ORDER BY created_at DESC`, params),
    evidence: many(`SELECT * FROM qa_evidence ${filter} ORDER BY created_at DESC`, params),
  };
}

export function setEstimate({ ticket_id, hours, note } = {}) {
  if (!ticket_id) throw new Error("ticket_id é obrigatório");
  if (!getTicket(ticket_id)) throw new Error(`ticket não encontrado: ${ticket_id}`);
  const value = Number(hours);
  if (!Number.isFinite(value) || value < 0) throw new Error("hours deve ser um número >= 0");
  run(
    `INSERT INTO time_estimates (ticket_id, hours, note, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(ticket_id) DO UPDATE SET hours = excluded.hours, note = excluded.note, updated_at = excluded.updated_at`,
    [ticket_id, value, note || "", nowIso()]
  );
  return one("SELECT * FROM time_estimates WHERE ticket_id = ?", [ticket_id]);
}

export function logTime(input = {}) {
  const hours = Number(input.hours);
  if (!Number.isFinite(hours) || hours <= 0) throw new Error("hours deve ser um número > 0");
  if (input.ticket_id && !one("SELECT id FROM tickets WHERE id = ?", [input.ticket_id])) {
    throw new Error(`ticket não encontrado: ${input.ticket_id}`);
  }
  const id = uid("log");
  run(
    `INSERT INTO time_logs (id, ticket_id, task_id, hours, note, logged_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.ticket_id || null, input.task_id || null, hours, input.note || "", input.logged_at || nowIso()]
  );
  return one("SELECT * FROM time_logs WHERE id = ?", [id]);
}

export function timeMetrics({ ticket_id, project_id, project_key } = {}) {
  const project = project_id || project_key ? findProject({ id: project_id, key: project_key || project_id }) : null;
  let tickets;
  if (ticket_id) {
    const ticket = one("SELECT * FROM tickets WHERE id = ?", [ticket_id]);
    tickets = ticket ? [ticket] : [];
  } else if (project) {
    tickets = many("SELECT * FROM tickets WHERE project_id = ?", [project.id]);
  } else {
    tickets = many("SELECT * FROM tickets");
  }
  const ids = tickets.map((t) => t.id);
  const estimates = ids.length
    ? many(`SELECT * FROM time_estimates WHERE ticket_id IN (${ids.map(() => "?").join(",")})`, ids)
    : [];
  const logs = ids.length
    ? many(`SELECT * FROM time_logs WHERE ticket_id IN (${ids.map(() => "?").join(",")})`, ids)
    : [];
  const estimateByTicket = Object.fromEntries(estimates.map((e) => [e.ticket_id, e.hours]));
  const actualByTicket = {};
  for (const log of logs) {
    actualByTicket[log.ticket_id] = (actualByTicket[log.ticket_id] || 0) + log.hours;
  }
  const rows = tickets.map((ticket) => {
    const estimated = estimateByTicket[ticket.id] || 0;
    const actual = actualByTicket[ticket.id] || 0;
    return {
      ticket_id: ticket.id,
      title: ticket.title,
      status: ticket.status,
      estimated,
      actual,
      remaining: Math.max(estimated - actual, 0),
      overrun: actual > estimated && estimated > 0,
    };
  });
  const estimated = rows.reduce((sum, row) => sum + row.estimated, 0);
  const actual = rows.reduce((sum, row) => sum + row.actual, 0);
  return {
    project: project || null,
    estimated,
    actual,
    remaining: Math.max(estimated - actual, 0),
    accuracy: estimated > 0 ? Number((actual / estimated).toFixed(2)) : null,
    tickets: rows,
  };
}

export function openInvestigation(input = {}) {
  if (!input.title) throw new Error("title é obrigatório");
  const id = uid("inv");
  const ts = nowIso();
  run(
    `INSERT INTO investigations (id, ticket_id, bug_id, title, status, hypothesis, root_cause, classification, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'open', ?, '', 'unknown', ?, ?)`,
    [id, input.ticket_id || null, input.bug_id || null, input.title, input.hypothesis || "", ts, ts]
  );
  return getInvestigation(id);
}

export function addFinding(input = {}) {
  if (!input.investigation_id) throw new Error("investigation_id é obrigatório");
  if (!one("SELECT id FROM investigations WHERE id = ?", [input.investigation_id])) {
    throw new Error(`investigation não encontrada: ${input.investigation_id}`);
  }
  if (!input.body) throw new Error("body é obrigatório");
  const kind = requireEnum(input.kind || "observation", FINDING_KINDS, "kind");
  const id = uid("fnd");
  run(
    `INSERT INTO findings (id, investigation_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?)`,
    [id, input.investigation_id, kind, input.body, nowIso()]
  );
  run("UPDATE investigations SET updated_at = ? WHERE id = ?", [nowIso(), input.investigation_id]);
  return one("SELECT * FROM findings WHERE id = ?", [id]);
}

export function concludeInvestigation(input = {}) {
  if (!input.investigation_id) throw new Error("investigation_id é obrigatório");
  const existing = one("SELECT * FROM investigations WHERE id = ?", [input.investigation_id]);
  if (!existing) throw new Error(`investigation não encontrada: ${input.investigation_id}`);
  const classification = requireEnum(input.classification || existing.classification, CLASSIFICATIONS, "classification");
  run(
    `UPDATE investigations SET
      status = 'concluded',
      root_cause = COALESCE(?, root_cause),
      classification = ?,
      hypothesis = COALESCE(?, hypothesis),
      updated_at = ?
     WHERE id = ?`,
    [input.root_cause ?? null, classification, input.hypothesis ?? null, nowIso(), existing.id]
  );
  return getInvestigation(existing.id);
}

export function getInvestigation(id) {
  const investigation = one("SELECT * FROM investigations WHERE id = ?", [id]);
  if (!investigation) return null;
  return {
    ...investigation,
    findings: many("SELECT * FROM findings WHERE investigation_id = ? ORDER BY created_at", [id]),
  };
}

export function listInvestigations({ ticket_id, status } = {}) {
  const clauses = [];
  const params = [];
  if (ticket_id) {
    clauses.push("ticket_id = ?");
    params.push(ticket_id);
  }
  if (status) {
    clauses.push("status = ?");
    params.push(status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return many(`SELECT * FROM investigations ${where} ORDER BY updated_at DESC`, params).map((row) =>
    getInvestigation(row.id)
  );
}

export function saveKnowledge(input = {}) {
  if (!input.title || !input.body) throw new Error("title e body são obrigatórios");
  const kind = requireEnum(input.kind || "lesson", KNOWLEDGE_KINDS, "kind");
  const id = uid("know");
  const tags = Array.isArray(input.tags) ? input.tags.join(",") : input.tags || "";
  run(
    `INSERT INTO knowledge (id, title, kind, body, tags, investigation_id, ticket_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.title, kind, input.body, tags, input.investigation_id || null, input.ticket_id || null, nowIso()]
  );
  run("INSERT INTO knowledge_fts (id, title, body, tags) VALUES (?, ?, ?, ?)", [id, input.title, input.body, tags]);
  return one("SELECT * FROM knowledge WHERE id = ?", [id]);
}

export function searchKnowledge({ query, limit = 8 } = {}) {
  if (!query) return many("SELECT * FROM knowledge ORDER BY created_at DESC LIMIT ?", [limit]);
  try {
    const rows = many(
      `SELECT k.* FROM knowledge k
       JOIN knowledge_fts f ON f.id = k.id
       WHERE knowledge_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
      [query, limit]
    );
    if (rows.length) return rows;
  } catch {
    // MATCH rejeita alguns tokens; cai no LIKE
  }
  const like = `%${query}%`;
  return many(
    `SELECT * FROM knowledge WHERE title LIKE ? OR body LIKE ? OR tags LIKE ? ORDER BY created_at DESC LIMIT ?`,
    [like, like, like, limit]
  );
}

export function ticketPacket(ticketId) {
  const ticket = getTicket(ticketId);
  if (!ticket) throw new Error(`ticket não encontrado: ${ticketId}`);
  return {
    ticket,
    qa: listQa({ ticket_id: ticketId }),
    time: timeMetrics({ ticket_id: ticketId }),
    investigations: listInvestigations({ ticket_id: ticketId }),
    knowledge: many("SELECT * FROM knowledge WHERE ticket_id = ? ORDER BY created_at DESC", [ticketId]),
  };
}

export function statusReport({ project_id, project_key, days = 7 } = {}) {
  const project = project_id || project_key ? findProject({ id: project_id, key: project_key || project_id }) : null;
  const since = new Date(Date.now() - Number(days) * 86400000).toISOString();
  const tickets = listTickets({ project_id: project?.id, project_key: project?.key });
  const counts = Object.fromEntries(TICKET_STATUSES.map((s) => [s, 0]));
  for (const ticket of tickets) counts[ticket.status] += 1;
  const qa = {
    runs: many(
      project
        ? `SELECT r.* FROM qa_runs r JOIN tickets t ON t.id = r.ticket_id WHERE t.project_id = ? AND r.created_at >= ?`
        : "SELECT * FROM qa_runs WHERE created_at >= ?",
      project ? [project.id, since] : [since]
    ),
    bugs_open: many(
      project
        ? `SELECT b.* FROM qa_bugs b JOIN tickets t ON t.id = b.ticket_id WHERE t.project_id = ? AND b.status = 'open'`
        : "SELECT * FROM qa_bugs WHERE status = 'open'",
      project ? [project.id] : []
    ),
  };
  const openInvestigations = listInvestigations({ status: "open" }).filter(
    (inv) => !project || tickets.some((t) => t.id === inv.ticket_id)
  );
  return {
    generated_at: nowIso(),
    window_days: Number(days),
    project,
    ticket_counts: counts,
    ticket_total: tickets.length,
    time: timeMetrics({ project_id: project?.id }),
    qa_runs_in_window: qa.runs.length,
    qa_fail_in_window: qa.runs.filter((r) => r.status === "fail").length,
    open_bugs: qa.bugs_open.length,
    open_investigations: openInvestigations.length,
    recently_updated: tickets.slice(0, 8),
  };
}
