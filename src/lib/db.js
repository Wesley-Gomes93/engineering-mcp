import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join, resolve } from "node:path";

let adapter = null;

export function defaultDbPath() {
  return join(homedir(), ".engineering-mcp", "engineering.db");
}

export function getDbPath() {
  if (process.env.ENGINEERING_MCP_DB) return resolve(process.env.ENGINEERING_MCP_DB);
  return defaultDbPath();
}

/** Sempre local. Turso/libsql saíram do produto. */
export function isRemote() {
  return false;
}

export function getMachineId() {
  return process.env.ENGINEERING_MCP_MACHINE || hostname() || "local";
}

export function describeDb() {
  return getDbPath();
}

class LocalAdapter {
  constructor(path) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
  }

  async exec(sql) {
    this.db.exec(sql);
  }

  async run(sql, params = []) {
    return this.db.prepare(sql).run(...params);
  }

  async one(sql, params = []) {
    return this.db.prepare(sql).get(...params) || null;
  }

  async many(sql, params = []) {
    return this.db.prepare(sql).all(...params);
  }

  async close() {
    this.db.close();
  }
}

export async function openDatabase(dbPath = getDbPath()) {
  adapter = new LocalAdapter(dbPath);
  try {
    await adapter.exec("PRAGMA journal_mode = WAL");
  } catch {
    // alguns fs não aceitam WAL
  }
  try {
    await adapter.exec("PRAGMA foreign_keys = ON");
  } catch {
    // ignore
  }
  return adapter;
}

export async function getAdapter() {
  if (!adapter) await openDatabase();
  return adapter;
}

export async function exec(sql) {
  return (await getAdapter()).exec(sql);
}

export async function run(sql, params = []) {
  return (await getAdapter()).run(sql, params);
}

export async function one(sql, params = []) {
  return (await getAdapter()).one(sql, params);
}

export async function many(sql, params = []) {
  return (await getAdapter()).many(sql, params);
}

export async function closeDatabase() {
  if (adapter) {
    await adapter.close();
    adapter = null;
  }
}
