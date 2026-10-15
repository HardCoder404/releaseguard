"use client";
export type StepStatus = "idle" | "active" | "done" | "fail" | "skipped";
export interface StepState { n: number; name: string; status: StepStatus; detail: string }

const DEFAULT_NAMES = ["Pre-check", "Policy gate", "Deploy", "Watch"];
export const emptySteps = (mode: string | null): StepState[] =>
  DEFAULT_NAMES.map((name, i) => ({ n: i + 1, name: i === 2 && mode === "canary" ? "Canary" : name, status: "idle", detail: "" }));

const ring: Record<StepStatus, string> = {
  idle: "border-line", active: "border-blue pulse", done: "border-ok", fail: "border-bad", skipped: "border-line opacity-50",
};
const label: Record<StepStatus, string> = { idle: "text-mut", active: "text-blue", done: "text-ok", fail: "text-bad", skipped: "text-mut" };

export function StepFlow({ steps, outcome }: { steps: StepState[]; outcome: "live" | "rolled_back" | "canary_aborted" | "blocked" | "aborted" | null }) {
  const bad = outcome === "rolled_back" || outcome === "canary_aborted";
  const good = outcome === "live";
  return (
    <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center gap-2 min-w-0">
          <div className={`card border-2 ${ring[s.status]} px-4 py-3 w-[190px] shrink-0 transition-colors`}>
            <div className={`text-[10px] tracking-wider uppercase ${label[s.status]}`}>{s.n} · {s.name}</div>
            <div className="text-xs text-mut mt-1 leading-snug line-clamp-3 min-h-[3lh]">{s.detail || (s.status === "idle" ? "waiting" : s.status)}</div>
          </div>
          {i < steps.length - 1 && <Arrow on={steps[i + 1].status !== "idle"} bad={s.status === "fail"} />}
        </div>
      ))}
      <Arrow on={!!outcome} bad={bad} />
      <div className="flex flex-col gap-2 shrink-0">
        <div className={`card px-4 py-2 w-[200px] border-2 ${good ? "border-ok" : "border-line opacity-60"}`}>
          <div className={`text-xs font-semibold ${good ? "text-ok" : "text-mut"}`}>✓ Promote</div>
          <div className="text-[11px] text-mut">roll out to all, remove canary</div>
        </div>
        <div className={`card px-4 py-2 w-[200px] border-2 ${bad ? "border-bad" : "border-line opacity-60"}`}>
          <div className={`text-xs font-semibold ${bad ? "text-bad" : "text-mut"}`}>✗ Revert</div>
          <div className="text-[11px] text-mut">discard canary / rollout undo</div>
        </div>
      </div>
    </div>
  );
}

function Arrow({ on, bad }: { on: boolean; bad?: boolean }) {
  const c = bad ? "#ff5a5f" : on ? "#2ecc71" : "#232834";
  return <svg width="26" height="12" viewBox="0 0 26 12" className="shrink-0"><line x1="0" y1="6" x2="18" y2="6" stroke={c} strokeWidth="2" /><path d="M18 1 L25 6 L18 11 Z" fill={c} /></svg>;
}
