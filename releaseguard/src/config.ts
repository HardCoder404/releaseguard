import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import dotenv from "dotenv";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(ROOT, ".env") });

export interface Config {
  target: "docker" | "k8s";
  urls: { app: string; prometheus: string };
  precheck: { risk_threshold: number };
  watch: {
    window_seconds: number;
    interval_seconds: number;
    rollback_if: {
      error_rate_above: number;
      p95_latency_above_ms: number;
      p95_latency_factor: number;
      health_failures: number;
    };
  };
}

export function loadConfig(): Config {
  const file = path.join(ROOT, "releaseguard", "releaseguard.yml");
  return YAML.parse(fs.readFileSync(file, "utf8")) as Config;
}

export const env = {
  groqKey: process.env.GROQ_API_KEY ?? "",
  groqModel: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
  slackWebhook: process.env.SLACK_WEBHOOK_URL ?? "",
};
