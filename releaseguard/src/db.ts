// Audit log + the "bus" between the CLI and the dashboard server. Both just read/write this SQLite file.
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { ROOT } from "./config.js";

const db = new DatabaseSync(path.join(ROOT, "releaseguard", "audit.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS deployments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version TEXT NOT NULL,
    previous TEXT,
    target TEXT,
    mode TEXT,              -- canary | full
    risk_score INTEGER,
    risk_summary TEXT,
    risk_reasons TEXT,
    approved_by TEXT,
    result TEXT,            -- live | rolled_back | canary_aborted | blocked | aborted
    reason TEXT,
    samples TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deployment_id INTEGER NOT NULL,
    at TEXT NOT NULL,
    type TEXT NOT NULL,     -- step | log | sample | verdict | done
    data TEXT NOT NULL      -- JSON
  );
  CREATE INDEX IF NOT EXISTS events_dep ON events(deployment_id);
  CREATE TABLE IF NOT EXISTS approvals (
    deployment_id INTEGER PRIMARY KEY,
    version TEXT NOT NULL,
    why TEXT NOT NULL,
    risk_score INTEGER,
    risk_summary TEXT,
    risk_reasons TEXT,
    status TEXT NOT NULL,   -- pending | approved | rejected
    decided_by TEXT,
    created_at TEXT NOT NULL,
    decided_at TEXT
  );
`);
// older databases: add columns that did not exist on day 1
for (const col of ["target TEXT", "mode TEXT"]) {
  try { db.exec(`ALTER TABLE deployments ADD COLUMN ${col}`); } catch { /* exists */ }
}

export interface DeployRow {
  id: number; version: string; previous: string | null; target: string | null; mode: string | null;
  risk_score: number | null; risk_summary: string | null; risk_reasons: string | null; approved_by: string | null;
  result: string | null; reason: string | null; samples: string | null; started_at: string; finished_at: string | null;
}
export interface EventRow { id: number; deployment_id: number; at: string; type: string; data: string }
export interface ApprovalRow {
  deployment_id: number; version: string; why: string; risk_score: number | null; risk_summary: string | null;
  risk_reasons: string | null; status: string; decided_by: string | null; created_at: string; decided_at: string | null;
}

const now = () => new Date().toISOString();

export function startDeployment(version: string, previous: string | null, target: string, mode: string): number {
  const r = db.prepare(`INSERT INTO deployments (version, previous, target, mode, started_at) VALUES (?, ?, ?, ?, ?)`)
    .run(version, previous, target, mode, now());
  return Number(r.lastInsertRowid);
}
export function saveRisk(id: number, score: number, summary: string, reasons: string[]) {
  db.prepare(`UPDATE deployments SET risk_score=?, risk_summary=?, risk_reasons=? WHERE id=?`).run(score, summary, JSON.stringify(reasons), id);
}
export function setApproved(id: number, by: string) {
  db.prepare(`UPDATE deployments SET approved_by=? WHERE id=?`).run(by, id);
}
export function finish(id: number, result: string, reason: string, samples?: unknown) {
  db.prepare(`UPDATE deployments SET result=?, reason=?, samples=?, finished_at=? WHERE id=?`)
    .run(result, reason, samples ? JSON.stringify(samples) : null, now(), id);
  emit(id, "done", { result, reason });
}
export function history(limit = 20): DeployRow[] {
  return db.prepare(`SELECT * FROM deployments ORDER BY id DESC LIMIT ?`).all(limit) as unknown as DeployRow[];
}
export function deployment(id: number): DeployRow | undefined {
  return db.prepare(`SELECT * FROM deployments WHERE id=?`).get(id) as unknown as DeployRow | undefined;
}
export function latestDeployment(): DeployRow | undefined {
  return db.prepare(`SELECT * FROM deployments ORDER BY id DESC LIMIT 1`).get() as unknown as DeployRow | undefined;
}

// ---- events (live progress) ----
export function emit(deploymentId: number, type: string, data: unknown) {
  db.prepare(`INSERT INTO events (deployment_id, at, type, data) VALUES (?, ?, ?, ?)`).run(deploymentId, now(), type, JSON.stringify(data));
}
export function eventsSince(afterId: number, limit = 500): EventRow[] {
  return db.prepare(`SELECT * FROM events WHERE id > ? ORDER BY id LIMIT ?`).all(afterId, limit) as unknown as EventRow[];
}
export function eventsFor(deploymentId: number): EventRow[] {
  return db.prepare(`SELECT * FROM events WHERE deployment_id=? ORDER BY id`).all(deploymentId) as unknown as EventRow[];
}

// ---- approvals (human gate, answered from terminal OR dashboard) ----
export function requestApproval(id: number, version: string, why: string, risk: { score: number; summary: string; reasons: string[] } | null) {
  db.prepare(`INSERT OR REPLACE INTO approvals (deployment_id, version, why, risk_score, risk_summary, risk_reasons, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`)
    .run(id, version, why, risk?.score ?? null, risk?.summary ?? null, risk ? JSON.stringify(risk.reasons) : null, now());
}
export function approvalStatus(id: number): ApprovalRow | undefined {
  return db.prepare(`SELECT * FROM approvals WHERE deployment_id=?`).get(id) as unknown as ApprovalRow | undefined;
}
export function decideApproval(id: number, status: "approved" | "rejected", by: string): boolean {
  const r = db.prepare(`UPDATE approvals SET status=?, decided_by=?, decided_at=? WHERE deployment_id=? AND status='pending'`).run(status, by, now(), id);
  return Number(r.changes) > 0;
}
export function pendingApprovals(): ApprovalRow[] {
  return db.prepare(`SELECT * FROM approvals WHERE status='pending' ORDER BY created_at DESC`).all() as unknown as ApprovalRow[];
}
