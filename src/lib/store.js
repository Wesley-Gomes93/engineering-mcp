import { exec, run, one, many, closeDatabase as closeAdapter, openDatabase, getDbPath, getMachineId, describeDb, isRemote } from "./db.js";
import { nowIso, uid, slugify, normalizeKey } from "./ids.js";

export { getDbPath, getMachineId, describeDb, isRemote };

export const TICKET_TYPES = ["epic", "story", "task", "bug", "spike"];
export const TICKET_STATUSES = ["backlog", "todo", "doing", "review", "done"];
export const PRIORITIES = ["p0", "p1", "p2", "p3"];
export const QA_RUN_STATUSES = ["pass", "fail", "flaky", "blocked"];
export const BUG_SEVERITIES = ["critical", "high", "medium", "low"];
export const CLASSIFICATIONS = ["bug", "flaky", "infra", "regression", "unknown"];
export const EVIDENCE_KINDS = ["log", "screenshot", "report", "url", "note"];
export const FINDING_KINDS = ["observation", "evidence", "hypothesis", "decision"];
export const KNOWLEDGE_KINDS = ["playbook", "lesson", "pattern"];
export const KNOWLEDGE_SOURCES = ["manual", "learned"];

let ready = false;

const SCHEMA = `
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
      external_source TEXT,
      external_url TEXT,
      tags         TEXT NOT NULL DEFAULT '',
      component    TEXT NOT NULL DEFAULT '',
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
      hits             INTEGER NOT NULL DEFAULT 0,
      last_hit_at      TEXT,
      source           TEXT NOT NULL DEFAULT 'manual',
      created_at       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id         TEXT PRIMARY KEY,
      kind       TEXT NOT NULL,
      entity     TEXT NOT NULL DEFAULT '',
      payload    TEXT NOT NULL DEFAULT '{}',
      machine_id TEXT NOT NULL DEFAULT 'local',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS work_sessions (
      id         TEXT PRIMARY KEY,
      ticket_id  TEXT NOT NULL,
      minutes    REAL NOT NULL,
      note       TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL,
      ended_at   TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      ticket_id  TEXT,
      updated_at TEXT NOT NULL
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
    CREATE INDEX IF NOT EXISTS idx_knowledge_title ON knowledge(title, kind);
    CREATE INDEX IF NOT EXISTS idx_work_sessions_ticket ON work_sessions(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind, created_at);
`;

export async function initDatabase(dbPath = getDbPath()) {
  await openDatabase(dbPath);
  await exec(SCHEMA);
  await migrateSchema();
  ready = true;
  return true;
}

export async function closeDatabase() {
  await closeAdapter();
  ready = false;
}

async function ensureDb() {
  if (!ready) await initDatabase();
}

async function migrateSchema() {
  await addColumn("knowledge", "hits", "INTEGER NOT NULL DEFAULT 0");
  await addColumn("knowledge", "last_hit_at", "TEXT");
  await addColumn("knowledge", "source", "TEXT NOT NULL DEFAULT 'manual'");
  await addColumn("tickets", "tags", "TEXT NOT NULL DEFAULT ''");
  await addColumn("tickets", "component", "TEXT NOT NULL DEFAULT ''");
  await addColumn("tickets", "external_source", "TEXT");
  await addColumn("tickets", "external_url", "TEXT");
}

async function addColumn(table, column, ddl) {
  let cols = [];
  try {
    cols = await many(`PRAGMA table_info(${table})`);
  } catch {
    return;
  }
  if (cols.some((c) => c.name === column)) return;
  await exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

async function nextSeq(name) {
  await ensureDb();
  const row = await one("SELECT value FROM counters WHERE name = ?", [name]);
  const next = (row?.value || 0) + 1;
  await run(
    "INSERT INTO counters (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value",
    [name, next]
  );
  return next;
}

function requireEnum(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new Error(`${field} inválido: ${value}. Use: ${allowed.join(", ")}`);
  }
  return value;
}

function tagsValue(tags) {
  if (tags == null) return null;
  return Array.isArray(tags) ? tags.filter(Boolean).join(",") : String(tags);
}

export async function recordEvent({ kind, entity = "", payload = {} } = {}) {
  await ensureDb();
  if (!kind) throw new Error("kind é obrigatório");
  const id = uid("evt");
  await run(
    `INSERT INTO events (id, kind, entity, payload, machine_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, kind, entity || "", JSON.stringify(payload ?? {}), getMachineId(), nowIso()]
  );
  return one("SELECT * FROM events WHERE id = ?", [id]);
}

async function triggerLearn(trigger, payload = {}) {
  const { learnTick } = await import("./learn.js");
  await learnTick({ trigger, ...payload });
  const { absorb } = await import("../intel/index.js");
  await absorb(trigger, payload);
}

export async function findProject({ id, key } = {}) {
  await ensureDb();
  if (id) return one("SELECT * FROM projects WHERE id = ? OR key = ?", [id, String(id).toUpperCase()]);
  if (key) return one("SELECT * FROM projects WHERE key = ? OR id = ?", [String(key).toUpperCase(), slugify(key)]);
  return null;
}

export async function upsertProject({ id, key, name, description, status } = {}) {
  const existing = id || key ? await findProject({ id, key }) : null;
  const ts = nowIso();
  if (existing) {
    await run(
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
  if ((await findProject({ id: projectId })) || (await findProject({ key: projectKey }))) {
    throw new Error(`Projeto já existe (id=${projectId} key=${projectKey})`);
  }
  await run(
    `INSERT INTO projects (id, key, name, description, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [projectId, projectKey, name, description || "", status || "active", ts, ts]
  );
  return getProject(projectId);
}

export async function listProjects({ status } = {}) {
  if (status) return many("SELECT * FROM projects WHERE status = ? ORDER BY name", [status]);
  return many("SELECT * FROM projects ORDER BY name");
}

export async function getProject(idOrKey) {
  return findProject({ id: idOrKey, key: idOrKey });
}

export async function ensureProject({ key, name } = {}) {
  const projectKey = normalizeKey(key || name || "ENG");
  if (!projectKey) throw new Error("key inválida");
  const existing = await findProject({ key: projectKey });
  if (existing) return existing;
  return upsertProject({ key: projectKey, name: name || projectKey });
}

export async function defaultProject() {
  const active = await listProjects({ status: "active" });
  if (active.length) return active[0];
  const any = await listProjects();
  if (any.length) return any[0];
  return ensureProject({ key: "ENG", name: "Engineering" });
}

/**
 * Começa trabalho a partir de uma frase: cria projeto/ticket se não existirem e foca.
 */
export async function startWork(input = {}) {
  if (input.ticket_id) {
    const existing = await getTicket(input.ticket_id);
    if (existing) return focusTicket(existing.id);
    const key = String(input.ticket_id).split("-")[0];
    const project = await ensureProject({ key, name: key });
    const title = (input.title && input.title !== input.ticket_id ? input.title : null) || `Trabalho em ${input.ticket_id}`;
    const created = await upsertTicket({
      project_key: project.key,
      title,
      type: input.type || "task",
      priority: input.priority || "p2",
      status: "todo",
    });
    return focusTicket(created.id);
  }
  const title = String(input.title || "").trim();
  if (!title) {
    throw new Error(
      'diga o que está fazendo, ex: “Comecei um bug: timeout no checkout” ou “Comecei o ENG-1”'
    );
  }
  const project = input.project_key
    ? await ensureProject({ key: input.project_key, name: input.project_key })
    : await defaultProject();
  const created = await upsertTicket({
    project_key: project.key,
    title,
    type: input.type || "task",
    priority: input.priority || "p2",
    status: "todo",
  });
  return focusTicket(created.id);
}

export async function upsertTicket(input = {}) {
  const existing = input.id ? await one("SELECT * FROM tickets WHERE id = ?", [input.id]) : null;
  const ts = nowIso();
  if (existing) {
    if (input.type) requireEnum(input.type, TICKET_TYPES, "type");
    if (input.status) requireEnum(input.status, TICKET_STATUSES, "status");
    if (input.priority) requireEnum(input.priority, PRIORITIES, "priority");
    await run(
      `UPDATE tickets SET
        title = COALESCE(?, title),
        type = COALESCE(?, type),
        status = COALESCE(?, status),
        priority = COALESCE(?, priority),
        description = COALESCE(?, description),
        external_key = COALESCE(?, external_key),
        external_source = COALESCE(?, external_source),
        external_url = COALESCE(?, external_url),
        tags = COALESCE(?, tags),
        component = COALESCE(?, component),
        updated_at = ?
       WHERE id = ?`,
      [
        input.title ?? null,
        input.type ?? null,
        input.status ?? null,
        input.priority ?? null,
        input.description ?? null,
        input.external_key ?? null,
        input.external_source ?? null,
        input.external_url ?? null,
        tagsValue(input.tags),
        input.component ?? null,
        ts,
        existing.id,
      ]
    );
    return getTicket(existing.id);
  }
  const project = await findProject({ id: input.project_id, key: input.project_key || input.project_id });
  if (!project) throw new Error("projeto não encontrado — use work_upsert_project primeiro");
  if (!input.title) throw new Error("title é obrigatório");
  const type = requireEnum(input.type || "task", TICKET_TYPES, "type");
  const status = requireEnum(input.status || "backlog", TICKET_STATUSES, "status");
  const priority = requireEnum(input.priority || "p2", PRIORITIES, "priority");
  const seq = await nextSeq(`ticket:${project.id}`);
  const id = `${project.key}-${seq}`;
  await run(
    `INSERT INTO tickets (id, project_id, title, type, status, priority, description, external_key, external_source, external_url, tags, component, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      project.id,
      input.title,
      type,
      status,
      priority,
      input.description || "",
      input.external_key || null,
      input.external_source || null,
      input.external_url || null,
      tagsValue(input.tags) || "",
      input.component || "",
      ts,
      ts,
    ]
  );
  return getTicket(id);
}

export async function getTicket(id) {
  const ticket = await one("SELECT * FROM tickets WHERE id = ?", [id]);
  if (!ticket) return null;
  return {
    ...ticket,
    project: await getProject(ticket.project_id),
    tasks: await many("SELECT * FROM tasks WHERE ticket_id = ? ORDER BY created_at", [id]),
  };
}

export async function listTickets({ project_id, project_key, status, type, query } = {}) {
  const project = project_id || project_key ? await findProject({ id: project_id, key: project_key || project_id }) : null;
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
    clauses.push(
      "(id LIKE ? OR title LIKE ? OR description LIKE ? OR IFNULL(external_key,'') LIKE ? OR IFNULL(tags,'') LIKE ? OR IFNULL(component,'') LIKE ?)"
    );
    const like = `%${query}%`;
    params.push(like, like, like, like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return many(`SELECT * FROM tickets ${where} ORDER BY updated_at DESC`, params);
}

export async function board({ project_id, project_key } = {}) {
  const tickets = await listTickets({ project_id, project_key });
  const columns = {};
  for (const status of TICKET_STATUSES) columns[status] = [];
  for (const ticket of tickets) columns[ticket.status].push(ticket);
  return {
    project: await findProject({ id: project_id, key: project_key || project_id }),
    columns,
    total: tickets.length,
  };
}

export async function upsertTask(input = {}) {
  const existing = input.id ? await one("SELECT * FROM tasks WHERE id = ?", [input.id]) : null;
  const ts = nowIso();
  if (existing) {
    if (input.status) requireEnum(input.status, TICKET_STATUSES, "status");
    await run(
      `UPDATE tasks SET title = COALESCE(?, title), status = COALESCE(?, status), updated_at = ? WHERE id = ?`,
      [input.title ?? null, input.status ?? null, ts, existing.id]
    );
    return one("SELECT * FROM tasks WHERE id = ?", [existing.id]);
  }
  if (!input.ticket_id) throw new Error("ticket_id é obrigatório");
  if (!(await getTicket(input.ticket_id))) throw new Error(`ticket não encontrado: ${input.ticket_id}`);
  if (!input.title) throw new Error("title é obrigatório");
  const status = requireEnum(input.status || "todo", TICKET_STATUSES, "status");
  const id = uid("tsk");
  await run(
    `INSERT INTO tasks (id, ticket_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.ticket_id, input.title, status, ts, ts]
  );
  return one("SELECT * FROM tasks WHERE id = ?", [id]);
}

export async function recordRun(input = {}) {
  if (!input.status) throw new Error("status é obrigatório");
  requireEnum(input.status, QA_RUN_STATUSES, "status");
  if (input.ticket_id && !(await one("SELECT id FROM tickets WHERE id = ?", [input.ticket_id]))) {
    throw new Error(`ticket não encontrado: ${input.ticket_id}`);
  }
  const id = uid("run");
  await run(
    `INSERT INTO qa_runs (id, ticket_id, suite, status, summary, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.ticket_id || null, input.suite || "", input.status, input.summary || "", input.source || "manual", nowIso()]
  );
  const row = await one("SELECT * FROM qa_runs WHERE id = ?", [id]);
  await recordEvent({ kind: "qa_run", entity: row.id, payload: { status: row.status, suite: row.suite, ticket_id: row.ticket_id } });
  await triggerLearn("qa_run", { ticket_id: row.ticket_id, suite: row.suite, status: row.status });
  return row;
}

export async function recordBug(input = {}) {
  if (!input.title) throw new Error("title é obrigatório");
  const severity = requireEnum(input.severity || "medium", BUG_SEVERITIES, "severity");
  const classification = requireEnum(input.classification || "unknown", CLASSIFICATIONS, "classification");
  const ts = nowIso();
  const id = uid("bug");
  await run(
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
  const row = await one("SELECT * FROM qa_bugs WHERE id = ?", [id]);
  await recordEvent({ kind: "qa_bug", entity: row.id, payload: { title: row.title, ticket_id: row.ticket_id } });
  await triggerLearn("qa_bug", { ticket_id: row.ticket_id, bug_id: row.id });
  return row;
}

export async function attachEvidence(input = {}) {
  if (!input.path_or_url) throw new Error("path_or_url é obrigatório");
  const kind = requireEnum(input.kind || "note", EVIDENCE_KINDS, "kind");
  const id = uid("evd");
  await run(
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

export async function listQa({ ticket_id } = {}) {
  const filter = ticket_id ? "WHERE ticket_id = ?" : "";
  const params = ticket_id ? [ticket_id] : [];
  return {
    runs: await many(`SELECT * FROM qa_runs ${filter} ORDER BY created_at DESC`, params),
    bugs: await many(`SELECT * FROM qa_bugs ${filter} ORDER BY created_at DESC`, params),
    evidence: await many(`SELECT * FROM qa_evidence ${filter} ORDER BY created_at DESC`, params),
  };
}

export async function setEstimate({ ticket_id, hours, note } = {}) {
  if (!ticket_id) throw new Error("ticket_id é obrigatório");
  if (!(await getTicket(ticket_id))) throw new Error(`ticket não encontrado: ${ticket_id}`);
  const value = Number(hours);
  if (!Number.isFinite(value) || value < 0) throw new Error("hours deve ser um número >= 0");
  await run(
    `INSERT INTO time_estimates (ticket_id, hours, note, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(ticket_id) DO UPDATE SET hours = excluded.hours, note = excluded.note, updated_at = excluded.updated_at`,
    [ticket_id, value, note || "", nowIso()]
  );
  return one("SELECT * FROM time_estimates WHERE ticket_id = ?", [ticket_id]);
}

export async function logTime(input = {}) {
  const hours = Number(input.hours);
  if (!Number.isFinite(hours) || hours <= 0) throw new Error("hours deve ser um número > 0");
  if (input.ticket_id && !(await one("SELECT id FROM tickets WHERE id = ?", [input.ticket_id]))) {
    throw new Error(`ticket não encontrado: ${input.ticket_id}`);
  }
  const id = uid("log");
  await run(
    `INSERT INTO time_logs (id, ticket_id, task_id, hours, note, logged_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.ticket_id || null, input.task_id || null, hours, input.note || "", input.logged_at || nowIso()]
  );
  const row = await one("SELECT * FROM time_logs WHERE id = ?", [id]);
  await recordEvent({ kind: "time_log", entity: row.id, payload: { ticket_id: row.ticket_id, hours: row.hours } });
  await triggerLearn("time_log", { ticket_id: row.ticket_id });
  return row;
}

export async function timeMetrics({ ticket_id, project_id, project_key } = {}) {
  const project = project_id || project_key ? await findProject({ id: project_id, key: project_key || project_id }) : null;
  let tickets;
  if (ticket_id) {
    const ticket = await one("SELECT * FROM tickets WHERE id = ?", [ticket_id]);
    tickets = ticket ? [ticket] : [];
  } else if (project) {
    tickets = await many("SELECT * FROM tickets WHERE project_id = ?", [project.id]);
  } else {
    tickets = await many("SELECT * FROM tickets");
  }
  const ids = tickets.map((t) => t.id);
  const estimates = ids.length
    ? await many(`SELECT * FROM time_estimates WHERE ticket_id IN (${ids.map(() => "?").join(",")})`, ids)
    : [];
  const logs = ids.length
    ? await many(`SELECT * FROM time_logs WHERE ticket_id IN (${ids.map(() => "?").join(",")})`, ids)
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
      variance: Number((actual - estimated).toFixed(2)),
      overrun: actual > estimated && estimated > 0,
    };
  });
  const estimated = rows.reduce((sum, row) => sum + row.estimated, 0);
  const actual = rows.reduce((sum, row) => sum + row.actual, 0);
  const sessions = ids.length
    ? await many(
        `SELECT * FROM work_sessions WHERE ticket_id IN (${ids.map(() => "?").join(",")}) ORDER BY started_at DESC`,
        ids
      )
    : [];
  return {
    project: project || null,
    estimated,
    actual,
    remaining: Math.max(estimated - actual, 0),
    variance: Number((actual - estimated).toFixed(2)),
    accuracy: estimated > 0 ? Number((actual / estimated).toFixed(2)) : null,
    tickets: rows,
    sessions,
  };
}

export async function openInvestigation(input = {}) {
  if (!input.title) throw new Error("title é obrigatório");
  const id = uid("inv");
  const ts = nowIso();
  await run(
    `INSERT INTO investigations (id, ticket_id, bug_id, title, status, hypothesis, root_cause, classification, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'open', ?, '', 'unknown', ?, ?)`,
    [id, input.ticket_id || null, input.bug_id || null, input.title, input.hypothesis || "", ts, ts]
  );
  return getInvestigation(id);
}

export async function addFinding(input = {}) {
  if (!input.investigation_id) throw new Error("investigation_id é obrigatório");
  if (!(await one("SELECT id FROM investigations WHERE id = ?", [input.investigation_id]))) {
    throw new Error(`investigation não encontrada: ${input.investigation_id}`);
  }
  if (!input.body) throw new Error("body é obrigatório");
  const kind = requireEnum(input.kind || "observation", FINDING_KINDS, "kind");
  const id = uid("fnd");
  await run(
    `INSERT INTO findings (id, investigation_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?)`,
    [id, input.investigation_id, kind, input.body, nowIso()]
  );
  await run("UPDATE investigations SET updated_at = ? WHERE id = ?", [nowIso(), input.investigation_id]);
  return one("SELECT * FROM findings WHERE id = ?", [id]);
}

export async function concludeInvestigation(input = {}) {
  if (!input.investigation_id) throw new Error("investigation_id é obrigatório");
  const existing = await one("SELECT * FROM investigations WHERE id = ?", [input.investigation_id]);
  if (!existing) throw new Error(`investigation não encontrada: ${input.investigation_id}`);
  const classification = requireEnum(input.classification || existing.classification, CLASSIFICATIONS, "classification");
  await run(
    `UPDATE investigations SET
      status = 'concluded',
      root_cause = COALESCE(?, root_cause),
      classification = ?,
      hypothesis = COALESCE(?, hypothesis),
      updated_at = ?
     WHERE id = ?`,
    [input.root_cause ?? null, classification, input.hypothesis ?? null, nowIso(), existing.id]
  );
  const closed = await getInvestigation(existing.id);
  await recordEvent({
    kind: "investigation_concluded",
    entity: closed.id,
    payload: { ticket_id: closed.ticket_id, classification: closed.classification },
  });
  await triggerLearn("investigation_concluded", { investigation_id: closed.id, ticket_id: closed.ticket_id });
  return closed;
}

export async function getInvestigation(id) {
  const investigation = await one("SELECT * FROM investigations WHERE id = ?", [id]);
  if (!investigation) return null;
  return {
    ...investigation,
    findings: await many("SELECT * FROM findings WHERE investigation_id = ? ORDER BY created_at", [id]),
  };
}

export async function listInvestigations({ ticket_id, status } = {}) {
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
  const rows = await many(`SELECT * FROM investigations ${where} ORDER BY updated_at DESC`, params);
  return Promise.all(rows.map((row) => getInvestigation(row.id)));
}

export async function findKnowledgeByTitle(title, kind) {
  if (kind) return one("SELECT * FROM knowledge WHERE title = ? AND kind = ?", [title, kind]);
  return one("SELECT * FROM knowledge WHERE title = ?", [title]);
}

export async function saveKnowledge(input = {}) {
  if (!input.title || !input.body) throw new Error("title e body são obrigatórios");
  const kind = requireEnum(input.kind || "lesson", KNOWLEDGE_KINDS, "kind");
  const source = requireEnum(input.source || "manual", KNOWLEDGE_SOURCES, "source");
  const tags = Array.isArray(input.tags) ? input.tags.join(",") : input.tags || "";
  const existing = await findKnowledgeByTitle(input.title, kind);
  if (existing) {
    await run(
      `UPDATE knowledge SET body = ?, tags = COALESCE(NULLIF(?, ''), tags), investigation_id = COALESCE(?, investigation_id), ticket_id = COALESCE(?, ticket_id)
       WHERE id = ?`,
      [input.body, tags, input.investigation_id || null, input.ticket_id || null, existing.id]
    );
    return one("SELECT * FROM knowledge WHERE id = ?", [existing.id]);
  }
  const id = uid("know");
  await run(
    `INSERT INTO knowledge (id, title, kind, body, tags, investigation_id, ticket_id, hits, last_hit_at, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
    [id, input.title, kind, input.body, tags, input.investigation_id || null, input.ticket_id || null, source, nowIso()]
  );
  await run("INSERT INTO knowledge_fts (id, title, body, tags) VALUES (?, ?, ?, ?)", [id, input.title, input.body, tags]);
  return one("SELECT * FROM knowledge WHERE id = ?", [id]);
}

function rankKnowledge(rows) {
  return [...rows].sort((a, b) => {
    const hits = (b.hits || 0) - (a.hits || 0);
    if (hits) return hits;
    const aHit = a.last_hit_at || a.created_at || "";
    const bHit = b.last_hit_at || b.created_at || "";
    return bHit.localeCompare(aHit);
  });
}

export async function searchKnowledge({ query, limit = 8 } = {}) {
  const cap = Number(limit) || 8;
  if (!query) {
    return rankKnowledge(await many("SELECT * FROM knowledge", [])).slice(0, cap);
  }
  try {
    const rows = await many(
      `SELECT k.* FROM knowledge k
       JOIN knowledge_fts f ON f.id = k.id
       WHERE knowledge_fts MATCH ?`,
      [query]
    );
    if (rows.length) return rankKnowledge(rows).slice(0, cap);
  } catch {
    // MATCH rejeita alguns tokens; cai no LIKE
  }
  const like = `%${query}%`;
  const rows = await many(
    `SELECT * FROM knowledge WHERE title LIKE ? OR body LIKE ? OR tags LIKE ?`,
    [like, like, like]
  );
  return rankKnowledge(rows).slice(0, cap);
}

export async function recallKnowledge({ query, limit = 8 } = {}) {
  const items = await searchKnowledge({ query, limit });
  const ts = nowIso();
  for (const item of items) {
    await run(`UPDATE knowledge SET hits = hits + 1, last_hit_at = ? WHERE id = ?`, [ts, item.id]);
    item.hits = (item.hits || 0) + 1;
    item.last_hit_at = ts;
  }
  return items;
}

export async function memoryStats() {
  const events = await one("SELECT COUNT(*) AS n FROM events");
  const knowledge = await many("SELECT kind, source, COUNT(*) AS n, SUM(hits) AS hits FROM knowledge GROUP BY kind, source");
  const totals = await one("SELECT COUNT(*) AS n, COALESCE(SUM(hits), 0) AS hits FROM knowledge");
  const machines = await many("SELECT machine_id, COUNT(*) AS n FROM events GROUP BY machine_id ORDER BY n DESC");
  return {
    machine_id: getMachineId(),
    remote: isRemote(),
    events: events?.n || 0,
    knowledge_items: totals?.n || 0,
    knowledge_hits: totals?.hits || 0,
    by_kind: knowledge,
    machines,
  };
}

export async function ticketPacket(ticketId) {
  const ticket = await getTicket(ticketId);
  if (!ticket) throw new Error(`ticket não encontrado: ${ticketId}`);
  return {
    ticket,
    qa: await listQa({ ticket_id: ticketId }),
    time: await timeMetrics({ ticket_id: ticketId }),
    investigations: await listInvestigations({ ticket_id: ticketId }),
    knowledge: await many("SELECT * FROM knowledge WHERE ticket_id = ? ORDER BY created_at DESC", [ticketId]),
  };
}

export async function statusReport({ project_id, project_key, days = 7 } = {}) {
  const project = project_id || project_key ? await findProject({ id: project_id, key: project_key || project_id }) : null;
  const since = new Date(Date.now() - Number(days) * 86400000).toISOString();
  const tickets = await listTickets({ project_id: project?.id, project_key: project?.key });
  const counts = Object.fromEntries(TICKET_STATUSES.map((s) => [s, 0]));
  for (const ticket of tickets) counts[ticket.status] += 1;
  const qa = {
    runs: await many(
      project
        ? `SELECT r.* FROM qa_runs r JOIN tickets t ON t.id = r.ticket_id WHERE t.project_id = ? AND r.created_at >= ?`
        : "SELECT * FROM qa_runs WHERE created_at >= ?",
      project ? [project.id, since] : [since]
    ),
    bugs_open: await many(
      project
        ? `SELECT b.* FROM qa_bugs b JOIN tickets t ON t.id = b.ticket_id WHERE t.project_id = ? AND b.status = 'open'`
        : "SELECT * FROM qa_bugs WHERE status = 'open'",
      project ? [project.id] : []
    ),
  };
  const openInvestigations = (await listInvestigations({ status: "open" })).filter(
    (inv) => !project || tickets.some((t) => t.id === inv.ticket_id)
  );
  return {
    generated_at: nowIso(),
    window_days: Number(days),
    project,
    ticket_counts: counts,
    ticket_total: tickets.length,
    time: await timeMetrics({ project_id: project?.id }),
    qa_runs_in_window: qa.runs.length,
    qa_fail_in_window: qa.runs.filter((r) => r.status === "fail").length,
    open_bugs: qa.bugs_open.length,
    open_investigations: openInvestigations.length,
    recently_updated: tickets.slice(0, 8),
  };
}

const FOCUS_SESSION = "default";

const STOP_TERMS = new Set([
  "the", "and", "for", "com", "para", "uma", "uns", "uma", "dos", "das", "que", "nao", "não",
  "por", "uma", "sem", "isso", "este", "esta", "esse", "essa", "pelo", "pela", "nos", "nas",
  "the", "this", "that", "from", "with", "ticket", "bug", "test",
]);

export function extractTicketId(text) {
  const match = String(text || "").match(/\b([A-Za-z][A-Za-z0-9]{0,7}-\d+)\b/);
  return match ? match[1].toUpperCase() : null;
}

export async function getFocus() {
  await ensureDb();
  const row = await one("SELECT * FROM sessions WHERE id = ?", [FOCUS_SESSION]);
  if (!row?.ticket_id) return null;
  return getTicket(row.ticket_id);
}

export async function focusTicket(ticketId) {
  if (!ticketId) throw new Error("ticket_id é obrigatório para focar");
  const ticket = await getTicket(ticketId);
  if (!ticket) throw new Error(`ticket não encontrado: ${ticketId}`);
  const ts = nowIso();
  await run(
    `INSERT INTO sessions (id, ticket_id, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET ticket_id = excluded.ticket_id, updated_at = excluded.updated_at`,
    [FOCUS_SESSION, ticket.id, ts]
  );
  if (ticket.status === "backlog" || ticket.status === "todo") {
    await upsertTicket({ id: ticket.id, status: "doing" });
  }
  await recordEvent({ kind: "focus", entity: ticket.id, payload: { ticket_id: ticket.id } });
  return getTicket(ticket.id);
}

export async function resolveTicketId(explicit) {
  if (explicit) {
    const ticket = await one("SELECT id FROM tickets WHERE id = ?", [explicit]);
    if (!ticket) throw new Error(`ticket não encontrado: ${explicit}`);
    return explicit;
  }
  const focus = await getFocus();
  if (!focus) {
    throw new Error('nenhum ticket em foco — diga o que está fazendo, ex: “Comecei um bug: timeout no checkout”');
  }
  return focus.id;
}

export async function logWorkSession(input = {}) {
  const ticketId = await resolveTicketId(input.ticket_id);
  const minutes = Number(input.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("minutes deve ser um número > 0");
  const endedAt = input.ended_at || nowIso();
  const startedAt =
    input.started_at || new Date(Date.parse(endedAt) - minutes * 60_000).toISOString();
  const id = uid("wses");
  await run(
    `INSERT INTO work_sessions (id, ticket_id, minutes, note, started_at, ended_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, ticketId, minutes, input.note || "", startedAt, endedAt, nowIso()]
  );
  const hours = Number((minutes / 60).toFixed(4));
  const log = await logTime({
    ticket_id: ticketId,
    hours,
    note: input.note || `sessão ${minutes}min`,
    logged_at: endedAt,
  });
  const session = await one("SELECT * FROM work_sessions WHERE id = ?", [id]);
  return { session, log };
}

function termsFrom(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 3 && !STOP_TERMS.has(term));
}

export async function similarTickets({ ticket_id, query, limit = 5 } = {}) {
  const ticket = ticket_id ? await one("SELECT * FROM tickets WHERE id = ?", [ticket_id]) : null;
  const source =
    query ||
    [ticket?.title, ticket?.tags, ticket?.component, ticket?.description].filter(Boolean).join(" ");
  const terms = termsFrom(source);
  const knowledge = await searchKnowledge({ query: source || query, limit });
  if (!terms.length) {
    return { query: source, tickets: [], knowledge };
  }
  const all = await many("SELECT * FROM tickets");
  const scored = all
    .filter((row) => row.id !== ticket_id)
    .map((row) => {
      const hay = new Set(termsFrom([row.id, row.title, row.tags, row.component, row.description].join(" ")));
      const score = terms.filter((term) => hay.has(term)).length;
      return { ...row, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Number(limit) || 5);
  return { query: source, tickets: scored, knowledge };
}

export async function ticketContext(ticketId) {
  const id = await resolveTicketId(ticketId);
  const packet = await ticketPacket(id);
  const similar = await similarTickets({ ticket_id: id });
  const focus = await getFocus();
  return {
    ...packet,
    similar,
    focused: focus?.id === id,
    sessions: packet.time?.sessions || [],
  };
}

export async function addFindingToTicket(input = {}) {
  const ticketId = await resolveTicketId(input.ticket_id);
  if (!input.body) throw new Error("body é obrigatório");
  let investigation = (await listInvestigations({ ticket_id: ticketId, status: "open" }))[0];
  if (!investigation) {
    const ticket = await getTicket(ticketId);
    investigation = await openInvestigation({
      ticket_id: ticketId,
      bug_id: input.bug_id,
      title: input.title || `Investigação ${ticketId}: ${ticket.title}`,
      hypothesis: input.kind === "hypothesis" ? input.body : input.hypothesis,
    });
  }
  const finding = await addFinding({
    investigation_id: investigation.id,
    kind: input.kind,
    body: input.body,
  });
  return { investigation: await getInvestigation(investigation.id), finding };
}

export async function concludeOpenInvestigation(input = {}) {
  const ticketId = await resolveTicketId(input.ticket_id);
  const open = (await listInvestigations({ ticket_id: ticketId, status: "open" }))[0];
  if (!open) throw new Error(`nenhuma investigação aberta em ${ticketId}`);
  return concludeInvestigation({
    investigation_id: open.id,
    root_cause: input.root_cause,
    classification: input.classification,
    hypothesis: input.hypothesis,
  });
}

export async function flowGaps({ project_id, project_key } = {}) {
  const tickets = await listTickets({ project_id, project_key });
  const active = tickets.filter((t) => t.status !== "done" && t.status !== "backlog");
  if (!active.length) return [];

  const ids = active.map((t) => t.id);
  const placeholders = ids.map(() => "?").join(",");
  const runRows = await many(
    `SELECT ticket_id, status, COUNT(*) AS n FROM qa_runs WHERE ticket_id IN (${placeholders}) GROUP BY ticket_id, status`,
    ids
  );
  const invRows = await many(
    `SELECT ticket_id, status FROM investigations WHERE ticket_id IN (${placeholders})`,
    ids
  );
  const metrics = await timeMetrics({ project_id, project_key });
  const timeBy = Object.fromEntries((metrics.tickets || []).map((row) => [row.ticket_id, row]));

  const runsBy = {};
  for (const row of runRows) {
    if (!runsBy[row.ticket_id]) runsBy[row.ticket_id] = { total: 0, fail: 0 };
    runsBy[row.ticket_id].total += Number(row.n);
    if (row.status === "fail" || row.status === "flaky") runsBy[row.ticket_id].fail += Number(row.n);
  }
  const invBy = {};
  for (const row of invRows) {
    if (!invBy[row.ticket_id]) invBy[row.ticket_id] = { open: false, concluded: false };
    if (row.status === "open") invBy[row.ticket_id].open = true;
    if (row.status === "concluded") invBy[row.ticket_id].concluded = true;
  }

  const gaps = [];
  for (const ticket of active) {
    const runs = runsBy[ticket.id] || { total: 0, fail: 0 };
    const inv = invBy[ticket.id] || { open: false, concluded: false };
    const time = timeBy[ticket.id];
    if (ticket.status === "review" && runs.total === 0) {
      gaps.push({
        ticket_id: ticket.id,
        title: ticket.title,
        kind: "review_without_qa",
        message: "review sem evidência de QA",
      });
    }
    if (runs.fail > 0 && !inv.open && !inv.concluded) {
      gaps.push({
        ticket_id: ticket.id,
        title: ticket.title,
        kind: "fail_without_rca",
        message: "fail sem RCA",
      });
    }
    if (time?.overrun) {
      gaps.push({
        ticket_id: ticket.id,
        title: ticket.title,
        kind: "overrun",
        message: `overrun (${time.actual}h vs ${time.estimated}h)`,
      });
    }
    if (ticket.type === "spike" && (!time || time.actual === 0)) {
      gaps.push({
        ticket_id: ticket.id,
        title: ticket.title,
        kind: "spike_without_time",
        message: "spike sem hora lançada",
      });
    }
  }
  return gaps;
}

export async function dailyReport({ days = 1, project_id, project_key } = {}) {
  const project =
    project_id || project_key ? await findProject({ id: project_id, key: project_key || project_id }) : null;
  const start = new Date();
  if (Number(days) <= 1) start.setHours(0, 0, 0, 0);
  else start.setTime(Date.now() - Number(days) * 86400000);
  const since = start.toISOString();

  const logs = await many("SELECT * FROM time_logs WHERE logged_at >= ? ORDER BY logged_at DESC", [since]);
  const sessions = await many(
    "SELECT * FROM work_sessions WHERE started_at >= ? ORDER BY started_at DESC",
    [since]
  );
  const runs = await many("SELECT * FROM qa_runs WHERE created_at >= ? ORDER BY created_at DESC", [since]);
  const bugs = await many("SELECT * FROM qa_bugs WHERE created_at >= ? ORDER BY created_at DESC", [since]);
  const ticketsUpdated = await many(
    "SELECT * FROM tickets WHERE updated_at >= ? ORDER BY updated_at DESC",
    [since]
  );
  const investigations = await many(
    "SELECT * FROM investigations WHERE updated_at >= ? ORDER BY updated_at DESC",
    [since]
  );

  const idSet = new Set(
    [
      ...ticketsUpdated.map((t) => t.id),
      ...logs.map((r) => r.ticket_id),
      ...sessions.map((r) => r.ticket_id),
      ...runs.map((r) => r.ticket_id),
      ...bugs.map((r) => r.ticket_id),
      ...investigations.map((r) => r.ticket_id),
    ].filter(Boolean)
  );
  let tickets = idSet.size
    ? await many(
        `SELECT * FROM tickets WHERE id IN (${[...idSet].map(() => "?").join(",")}) ORDER BY updated_at DESC`,
        [...idSet]
      )
    : [];
  if (project) tickets = tickets.filter((t) => t.project_id === project.id);
  const ticketIds = new Set(tickets.map((t) => t.id));
  const inScope = (row) => !project || !row.ticket_id || ticketIds.has(row.ticket_id);

  const hours = logs.filter(inScope).reduce((sum, row) => sum + Number(row.hours || 0), 0);
  const doing = await many(
    project
      ? "SELECT * FROM tickets WHERE status = 'doing' AND project_id = ? ORDER BY updated_at DESC"
      : "SELECT * FROM tickets WHERE status = 'doing' ORDER BY updated_at DESC",
    project ? [project.id] : []
  );
  const openInvestigations = (await listInvestigations({ status: "open" })).filter((inv) => {
    if (!project) return true;
    if (inv.ticket_id && ticketIds.has(inv.ticket_id)) return true;
    return doing.some((t) => t.id === inv.ticket_id);
  });

  return {
    generated_at: nowIso(),
    since,
    days: Number(days) || 1,
    project,
    hours: Number(hours.toFixed(2)),
    sessions: sessions.filter(inScope),
    tickets,
    doing,
    qa_runs: runs.filter(inScope),
    bugs: bugs.filter(inScope),
    investigations: investigations.filter(inScope),
    open_investigations: openInvestigations,
    gaps: await flowGaps({ project_id: project?.id, project_key: project?.key }),
  };
}
