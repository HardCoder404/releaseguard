import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import dotenv from "dotenv";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(ROOT, ".env") });

export type TargetName = "docker" | "k8s";
export interface Urls { app: string; prometheus: string }

export interface Config {
  target: TargetName;
  urls: Urls;                      // resolved from the active target
  docker: { urls: Urls };
  k8s: { deployment: string; namespace: string; urls: Urls; canary: boolean };
  precheck: { risk_threshold: number; require_approval_if: string[] };
  watch: {
    window_seconds: number;
    interval_seconds: number;
    rollback_if: {
      error_rate_above: number;
      p95_latency_above_ms: number;
      p95_latency_factor: number;
      health_failures: number;
      pod_restarts_above: number;
    };
  };
}

export function loadConfig(targetOverride?: string): Config {
  const file = path.join(ROOT, "releaseguard", "releaseguard.yml");
  const cfg = YAML.parse(fs.readFileSync(file, "utf8")) as Config;
  if (targetOverride === "docker" || targetOverride === "k8s") cfg.target = targetOverride;
  cfg.urls = cfg[cfg.target].urls;
  cfg.precheck.require_approval_if ??= [];
  return cfg;
}

/** Dashboard "Policy" page writes here. Comments in the YAML are preserved. */
export function saveConfig(patch: { precheck?: Partial<Config["precheck"]>; watch?: Partial<Omit<Config["watch"], "rollback_if">> & { rollback_if?: Partial<Config["watch"]["rollback_if"]> }; k8s?: { canary?: boolean } }): Config {
  const file = path.join(ROOT, "releaseguard", "releaseguard.yml");
  const doc = YAML.parseDocument(fs.readFileSync(file, "utf8"));
  const set = (keys: string[], v: unknown) => { if (v !== undefined) doc.setIn(keys, v); };
  set(["precheck", "risk_threshold"], patch.precheck?.risk_threshold);
  set(["precheck", "require_approval_if"], patch.precheck?.require_approval_if);
  set(["watch", "window_seconds"], patch.watch?.window_seconds);
  set(["watch", "interval_seconds"], patch.watch?.interval_seconds);
  for (const k of ["error_rate_above", "p95_latency_above_ms", "p95_latency_factor", "health_failures", "pod_restarts_above"] as const)
    set(["watch", "rollback_if", k], patch.watch?.rollback_if?.[k]);
  set(["k8s", "canary"], patch.k8s?.canary);
  fs.writeFileSync(file, doc.toString());
  return loadConfig();
}

export const env = {
  groqKey: process.env.GROQ_API_KEY ?? "",
  groqModel: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
  slackWebhook: process.env.SLACK_WEBHOOK_URL ?? "",
};
