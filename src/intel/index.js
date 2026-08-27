import { mkdirSync, readFileSync, appendFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BRAIN_FILE = join(dirname(fileURLToPath(import.meta.url)), "brain.json");
const NOTES_FILE = join(homedir(), ".engineering-mcp", "notes.jsonl");

const DOMAINS = new Set(["work", "qa", "time", "investigation", "knowledge", "reporting"]);
const PAINS = new Set(["fail", "flaky", "fail_streak", "overrun", "rca", "bug", "none"]);
const USES = new Set(["qa_run", "qa_bug", "time_log", "investigation_concluded", "knowledge_save"]);
const SOLUTIONS = new Set(["pattern", "lesson", "improvement_ticket", "none"]);
const CLASSES = new Set(["bug", "flaky", "infra", "regression", "unknown", "none"]);

const TRIGGER_MAP = {
  qa_run: { domain: "qa", used: "qa_run" },
  qa_bug: { domain: "qa", used: "qa_bug", pain: "bug" },
  time_log: { domain: "time", used: "time_log" },
  investigation_concluded: { domain: "investigation", used: "investigation_concluded", pain: "rca" },
};

function notesFile() {
  if (process.env.ENGINEERING_MCP_DB) {
    return join(dirname(process.env.ENGINEERING_MCP_DB), "notes.jsonl");
  }
  return NOTES_FILE;
}

function emptyBrain() {
  return { version: 1, pains: {}, uses: {}, solutions: {}, classes: {}, playbooks: [] };
}

export function loadBrain() {
  try {
    return { ...emptyBrain(), ...JSON.parse(readFileSync(BRAIN_FILE, "utf8")) };
  } catch {
    return emptyBrain();
  }
}

export function sanitize(input = {}) {
  const domain = DOMAINS.has(input.domain) ? input.domain : null;
  const pain = PAINS.has(input.pain) ? input.pain : "none";
  const used = USES.has(input.used) ? input.used : null;
  const solution = SOLUTIONS.has(input.solution) ? input.solution : "none";
  const klass = CLASSES.has(input.klass) ? input.klass : "none";
  if (!domain || !used) return null;
  return { v: 1, day: new Date().toISOString().slice(0, 10), domain, pain, used, solution, klass };
}

export function topPain(notes = readNotes()) {
  const counts = {};
  for (const note of notes) {
    if (!note.pain || note.pain === "none") continue;
    counts[note.pain] = (counts[note.pain] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

export function hintFor(text = "", extra = {}) {
  const brain = loadBrain();
  const hay = [text, extra.pain, extra.event, extra.query]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const playbooks = brain.playbooks || [];
  const hit = playbooks.find((p) => (p.when || []).some((w) => hay.includes(String(w).toLowerCase())));
  if (hit) return hit.hint;
  if (!extra.usePersonal) return null;
  const pain = extra.pain || topPain();
  if (!pain) return null;
  return playbooks.find((p) => (p.when || []).includes(pain))?.hint || null;
}

export async function absorb(trigger, payload = {}, extra = {}) {
  const mapped = TRIGGER_MAP[trigger] || {};
  let pain = extra.pain || mapped.pain || "none";
  if (trigger === "qa_run" && (payload.status === "fail" || payload.status === "flaky")) {
    pain = payload.status === "flaky" ? "flaky" : "fail";
  }
  if (payload.status === "fail" && extra.pain === "fail_streak") pain = "fail_streak";
  const klass = CLASSES.has(payload.classification) ? payload.classification : extra.klass || "none";
  const note = sanitize({
    domain: extra.domain || mapped.domain,
    used: extra.used || mapped.used,
    pain,
    solution: extra.solution || "none",
    klass,
  });
  if (!note) return null;
  const file = notesFile();
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(note)}\n`, "utf8");
  return note;
}

export function readNotes() {
  const file = notesFile();
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
