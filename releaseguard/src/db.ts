// Audit log: every deploy decision, saved. Uses Node's built-in SQLite (no native build).
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { ROOT } from "./config.js";

const db = new DatabaseSync(path.join(ROOT, "releaseguard", "audit.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS deployments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version TEXT NOT NULL,
    previous TEXT,
    risk_score INTEGER,
    risk_summary TEXT,
    risk_reasons TEXT,
    approved_by TEXT,
    result TEXT,            -- live | rolled_back | blocked | failed
    reason TEXT,
    samples TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT
  )
`);

export interface DeployRow {
  id: number; version: string; previous: string | null; risk_score: number | null;
  risk_summary: string | null; risk_reasons: string | null; approved_by: string | null;
  result: string | null; reason: string | null; samples: string | null;
  started_at: string; finished_at: string | null;
}

export function startDeployment(version: string, previous: string | null): number {
  const r = db.prepare(
    `INSERT INTO deployments (version, previous, started_at) VALUES (?, ?, ?)`
  ).run(version, previous, new Date().toISOString());
  return Number(r.lastInsertRowid);
}

export function saveRisk(id: number, score: number, summary: string, reasons: string[]) {
  db.prepare(`UPDATE deployments SET risk_score=?, risk_summary=?, risk_reasons=? WHERE id=?`)
    .run(score, summary, JSON.stringify(reasons), id);
}

export function setApproved(id: number, by: string) {
  db.prepare(`UPDATE deployments SET approved_by=? WHERE id=?`).run(by, id);
}

export function finish(id: number, result: string, reason: string, samples?: unknown) {
  db.prepare(`UPDATE deployments SET result=?, reason=?, samples=?, finished_at=? WHERE id=?`)
    .run(result, reason, samples ? JSON.stringify(samples) : null, new Date().toISOString(), id);
}

export function history(limit = 20): DeployRow[] {
  return db.prepare(`SELECT * FROM deployments ORDER BY id DESC LIMIT ?`).all(limit) as unknown as DeployRow[];
}
