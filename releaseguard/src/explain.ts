// After a rollback: turn numbers + diff into a sentence a sleepy engineer understands.
import { askText } from "./ai.js";
import type { Diff } from "./git.js";
import type { Verdict } from "./watch.js";

export async function explainRollback(from: string, to: string, diff: Diff, v: Verdict, diagnostics = "", mode: "rollback" | "canary" = "rollback"): Promise<string> {
  const outcome = mode === "canary"
    ? `The canary pod running ${to} was discarded. The stable pods kept running ${from} the whole time and were never changed, so only the canary's share of traffic was affected. Say exactly this, do not call it a rollback.`
    : `The rollback to ${from} already happened, so no action is needed.`;
  const sys = `You are an SRE writing a 3-5 line incident note for Slack. Plain language, no fluff.
Include: what was observed (numbers), the most likely cause citing file/line from the diff, and the outcome: ${outcome}
Only use numbers that appear in the input. If the sample list is empty, say the new version never became ready so no traffic reached it; do not claim any error rate.`;
  const user = `${mode === "canary" ? `Canary of ${to} next to stable ${from}` : `Deployed ${to} (replacing ${from})`}. Reverted automatically.
Trigger: ${v.reason}
Baseline before deploy: err ${(v.baseline.errorRate * 100).toFixed(1)}%, p95 ${v.baseline.p95ms ?? "-"}ms
Samples after deploy${v.samples.length ? "" : " (NONE, new pods never became ready)"}:
${v.samples.map((s) => `  ${s.at.slice(11, 19)} err ${(s.errorRate * 100).toFixed(1)}% p95 ${s.p95ms ?? "-"}ms healthy=${s.healthy}`).join("\n")}
${diagnostics ? `Pod diagnostics (logs of unhealthy pods):\n${diagnostics.slice(0, 3000)}\n` : ""}
Diff ${from}..${to}:
${diff.patch.slice(0, 6000) || "(empty)"}`;
  try { return await askText(sys, user); }
  catch (e) { return `Rolled back ${to} -> ${from}. Trigger: ${v.reason}. (AI explanation unavailable: ${(e as Error).message})`; }
}
