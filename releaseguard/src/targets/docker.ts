// Docker target: the thing that actually swaps versions. Day 2 adds targets/k8s.ts with the same shape.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../config.js";

export interface Target {
  current(): string | null;
  deploy(tag: string): string;
  rollback(): string;
}

const STATE = path.join(ROOT, "infra", "state");
const read = (f: string) => { try { return fs.readFileSync(path.join(STATE, f), "utf8").trim() || null; } catch { return null; } };

export const dockerTarget: Target = {
  current: () => read("current"),
  deploy: (tag) => execFileSync(path.join(ROOT, "scripts", "deploy.sh"), [tag], { encoding: "utf8" }).trim(),
  rollback: () => execFileSync(path.join(ROOT, "scripts", "rollback.sh"), { encoding: "utf8" }).trim(),
};
