// Slack via incoming webhook. Without SLACK_WEBHOOK_URL it is a no-op (terminal output is enough locally).
import { env } from "./config.js";

/** Groq writes Markdown (**bold**, `code`); Slack wants *bold* and keeps `code`. */
function toSlackMarkdown(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "*$1*").replace(/^- /gm, "• ");
}

export async function notify(text: string): Promise<void> {
  if (!env.slackWebhook) return;
  try {
    const res = await fetch(env.slackWebhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: toSlackMarkdown(text) }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error(`slack ${res.status}: ${await res.text()}`);
  } catch (e) { console.error("slack failed:", (e as Error).message); }
}
