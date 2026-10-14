// Slack (Day 2). Until a webhook is configured, messages just print.
import { env } from "./config.js";

export async function notify(text: string): Promise<void> {
  if (!env.slackWebhook) return;
  try {
    await fetch(env.slackWebhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
  } catch (e) { console.error("slack failed:", (e as Error).message); }
}
