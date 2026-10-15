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
  app: { name: string; path: string; dockerfile: string; health_path: string; description: string };
  metrics: { requests_total: string; duration_bucket: string; status_label: string; track_label: string };
  target: TargetName;
  urls: Urls;                      // resolved from the active target
  docker: { compose_file: string; service: string; urls: Urls };
  k8s: { deployment: string; namespace: string; container: string; canary: boolean; urls: Urls };
  precheck: { risk_threshold: number; require_approval_if: string[] };
  watch: {
    window_seconds: number;
    interval_seconds: number;
    rollback_if: { error_rate_above: number; p95_latency_above_ms: number; p95_latency_factor: number; health_failures: number; pod_restarts_above: number };
  };
}

export const CONFIG_FILE = path.join(ROOT, "releaseguard", "releaseguard.yml");

export function loadConfig(targetOverride?: string): Config {
  const cfg = YAML.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as Config;
  if (targetOverride === "docker" || targetOverride === "k8s") cfg.target = targetOverride;
  // defaults, so a minimal file still works
  cfg.app ??= {} as Config["app"];
  cfg.app.name ??= "app"; cfg.app.path ??= "."; cfg.app.dockerfile ??= path.posix.join(cfg.app.path, "Dockerfile");
  cfg.app.health_path ??= "/health"; cfg.app.description ??= "";
  cfg.metrics ??= {} as Config["metrics"];
  cfg.metrics.requests_total ??= "http_requests_total"; cfg.metrics.duration_bucket ??= "http_request_duration_seconds_bucket";
  cfg.metrics.status_label ??= "status"; cfg.metrics.track_label ??= "track";
  cfg.docker ??= {} as Config["docker"]; cfg.docker.compose_file ??= "docker-compose.yml"; cfg.docker.service ??= "app";
  cfg.k8s ??= {} as Config["k8s"]; cfg.k8s.deployment ??= cfg.app.name; cfg.k8s.namespace ??= "default"; cfg.k8s.container ??= "app"; cfg.k8s.canary ??= true;
  cfg.precheck ??= { risk_threshold: 7, require_approval_if: [] }; cfg.precheck.require_approval_if ??= [];
  cfg.urls = cfg[cfg.target]?.urls ?? { app: "http://127.0.0.1:3000", prometheus: "http://127.0.0.1:9090" };
  return cfg;
}

/** Environment handed to every script, so scripts never hardcode app details. */
export function scriptEnv(cfg: Config): NodeJS.ProcessEnv {
  return {
    ...process.env,
    RG_ROOT: ROOT,
    APP_NAME: cfg.app.name, APP_PATH: cfg.app.path, APP_DOCKERFILE: cfg.app.dockerfile,
    COMPOSE_FILE_RG: cfg.docker.compose_file, COMPOSE_SERVICE: cfg.docker.service,
    DEPLOYMENT: cfg.k8s.deployment, NAMESPACE: cfg.k8s.namespace, CONTAINER: cfg.k8s.container,
  };
}

/** Dashboard "Policy" page writes here. Comments in the YAML are preserved. */
export function saveConfig(patch: { precheck?: Partial<Config["precheck"]>; watch?: Partial<Omit<Config["watch"], "rollback_if">> & { rollback_if?: Partial<Config["watch"]["rollback_if"]> }; k8s?: { canary?: boolean } }): Config {
  const doc = YAML.parseDocument(fs.readFileSync(CONFIG_FILE, "utf8"));
  const set = (keys: string[], v: unknown) => { if (v !== undefined) doc.setIn(keys, v); };
  set(["precheck", "risk_threshold"], patch.precheck?.risk_threshold);
  set(["precheck", "require_approval_if"], patch.precheck?.require_approval_if);
  set(["watch", "window_seconds"], patch.watch?.window_seconds);
  set(["watch", "interval_seconds"], patch.watch?.interval_seconds);
  for (const k of ["error_rate_above", "p95_latency_above_ms", "p95_latency_factor", "health_failures", "pod_restarts_above"] as const)
    set(["watch", "rollback_if", k], patch.watch?.rollback_if?.[k]);
  set(["k8s", "canary"], patch.k8s?.canary);
  fs.writeFileSync(CONFIG_FILE, doc.toString());
  return loadConfig();
}

export const env = {
  groqKey: process.env.GROQ_API_KEY ?? "",
  groqModel: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
  slackWebhook: process.env.SLACK_WEBHOOK_URL ?? "",
};
