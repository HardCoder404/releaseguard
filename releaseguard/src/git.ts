import { execFileSync } from "node:child_process";
import { ROOT } from "./config.js";

export function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
}

export function tagExists(tag: string): boolean {
  try { git("rev-parse", "-q", "--verify", `refs/tags/${tag}`); return true; } catch { return false; }
}

export interface Diff { stat: string; patch: string; files: string[]; commits: string }

/** Diff between what is running (from) and what we want to deploy (to). Only the app folder matters. */
export function diffBetween(from: string | null, to: string): Diff {
  const range = from ? `${from}..${to}` : to;
  const stat = from ? git("diff", "--stat", range, "--", "shop-api") : "(first deploy, no previous version)";
  const files = from ? git("diff", "--name-only", range, "--", "shop-api").trim().split("\n").filter(Boolean) : [];
  let patch = from ? git("diff", range, "--", "shop-api") : "";
  const commits = from ? git("log", "--oneline", range) : git("log", "--oneline", "-5", to);
  const MAX = 12000;
  if (patch.length > MAX) patch = patch.slice(0, MAX) + `\n... (truncated, ${patch.length - MAX} more chars)`;
  return { stat, patch, files, commits };
}
