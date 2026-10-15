import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../config.js";
import type { Target } from "./types.js";

const STATE = path.join(ROOT, "infra", "state");
const read = (f: string) => { try { return fs.readFileSync(path.join(STATE, f), "utf8").trim() || null; } catch { return null; } };
const sh = (script: string, args: string[] = []) =>
  execFileSync(path.join(ROOT, "scripts", script), args, { encoding: "utf8" }).trim();

export const dockerTarget: Target = {
  name: "docker",
  current: () => read("current"),
  deploy: (tag) => sh("deploy.sh", [tag]),
  rollback: () => sh("rollback.sh"),
  scope: { label: "app", selector: "" },
};
