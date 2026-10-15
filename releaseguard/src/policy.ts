// POLICY GATE: the rules a team would otherwise keep in someone's head.
import readline from "node:readline/promises";
import type { Config } from "./config.js";
import type { Risk } from "./precheck.js";
import * as db from "./db.js";

export interface Decision { proceed: boolean; needsApproval: boolean; why: string }

export function evaluate(cfg: Config, risk: Risk): Decision {
  const why: string[] = [];
  if (risk.score >= cfg.precheck.risk_threshold) why.push(`risk ${risk.score} >= threshold ${cfg.precheck.risk_threshold}`);
  const rules = cfg.precheck.require_approval_if;
  if (rules.includes("migration") && risk.has_migration) why.push("rule: contains a database migration");
  if (rules.includes("env_change") && risk.has_env_change) why.push("rule: changes environment variables");
  if (rules.includes("dependency_change") && risk.has_dependency_change) why.push("rule: changes dependencies");
  return { proceed: why.length === 0, needsApproval: why.length > 0, why: why.join("; ") };
}

/**
 * Ask a human. Two doors, whichever answers first wins:
 *  - the terminal (y/N)
 *  - the dashboard (Approve/Reject button writes to the approvals table)
 */
export async function askHuman(deploymentId: number, question: string): Promise<{ ok: boolean; by: string }> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let settled = false;
  return new Promise((resolve) => {
    const finish = (ok: boolean, by: string) => {
      if (settled) return; settled = true;
      clearInterval(timer); rl.close();
      if (by === "terminal") db.decideApproval(deploymentId, ok ? "approved" : "rejected", "terminal");
      resolve({ ok, by });
    };
    rl.question(`${question} [y/N]  (or decide in the dashboard) `).then((a) => {
      const t = a.trim().toLowerCase();
      finish(t === "y" || t === "yes", "terminal");
    }).catch(() => { /* closed by the dashboard path */ });
    const timer = setInterval(() => {
      const s = db.approvalStatus(deploymentId);
      if (s && s.status !== "pending") finish(s.status === "approved", s.decided_by ?? "dashboard");
    }, 1000);
  });
}
