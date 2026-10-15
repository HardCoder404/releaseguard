// POLICY GATE: the rules a team would otherwise keep in someone's head.
import readline from "node:readline/promises";
import type { Config } from "./config.js";
import type { Risk } from "./precheck.js";

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

export async function askHuman(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return a === "y" || a === "yes";
}
