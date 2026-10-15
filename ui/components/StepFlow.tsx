"use client";
import { Check, X, Spinner } from "./Icons";
export type StepStatus = "idle" | "active" | "done" | "fail" | "skipped";
export interface StepState { n: number; name: string; status: StepStatus; detail: string }

const NAMES = ["Pre-check", "Policy gate", "Deploy", "Watch"];
export const emptySteps = (mode: string | null): StepState[] =>
  NAMES.map((name, i) => ({ n: i + 1, name: i === 2 && mode === "canary" ? "Canary" : name, status: "idle", detail: "" }));

const box: Record<StepStatus, string> = {
  idle: "border-line", active: "border-blue/70 glow-blue", done: "border-ok/40", fail: "border-bad/70 glow-bad", skipped: "border-line opacity-50",
};
const num: Record<StepStatus, string> = {
  idle: "bg-panel2 text-dim border-line", active: "bg-blue text-white border-blue ring", done: "bg-ok/15 text-ok border-ok/40", fail: "bg-bad/15 text-bad border-bad/50", skipped: "bg-panel2 text-dim border-line",
};
const label: Record<StepStatus, string> = { idle: "text-dim", active: "text-blue", done: "text-ok", fail: "text-bad", skipped: "text-dim" };

export function StepFlow({ steps, outcome }: { steps: StepState[]; outcome: "live" | "rolled_back" | "canary_aborted" | "blocked" | "aborted" | null }) {
  const bad = outcome === "rolled_back" || outcome === "canary_aborted" || outcome === "blocked";
  const good = outcome === "live";
  return (
    <div className="flex items-stretch gap-0 overflow-x-auto pb-2 -mx-1 px-1">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center shrink-0">
          <div className={`card card-hover border ${box[s.status]} px-3.5 py-3 w-[182px] h-[108px] flex flex-col`}>
            <div className="flex items-center gap-2.5">
              <span className={`grid place-items-center w-6 h-6 rounded-full border text-[11px] font-semibold ${num[s.status]}`}>
                {s.status === "done" ? <Check className="w-3.5 h-3.5" /> : s.status === "fail" ? <X className="w-3.5 h-3.5" /> : s.status === "active" ? <Spinner className="w-3.5 h-3.5" /> : s.n}
              </span>
              <span className={`eyebrow ${label[s.status]}`}>{s.name}</span>
            </div>
            <div className="text-[12.5px] text-mut mt-2.5 leading-snug line-clamp-3">{s.detail || (s.status === "idle" ? "waiting" : s.status)}</div>
          </div>
          {i < steps.length - 1 && <Connector state={s.status === "fail" ? "bad" : steps[i + 1].status !== "idle" ? "on" : s.status === "active" ? "flow" : "off"} />}
        </div>
      ))}
      <Connector state={bad ? "bad" : good ? "on" : steps[3].status === "active" ? "flow" : "off"} />
      <div className="flex flex-col gap-2 shrink-0">
        <Outcome on={good} tone="ok" title="Promote" sub="roll out to all pods, remove canary" />
        <Outcome on={bad} tone="bad" title="Revert" sub={outcome === "blocked" ? "nothing deployed" : "discard canary / rollout undo"} />
      </div>
    </div>
  );
}

function Outcome({ on, tone, title, sub }: { on: boolean; tone: "ok" | "bad"; title: string; sub: string }) {
  const color = tone === "ok" ? "text-ok" : "text-bad";
  return (
    <div className={`card px-3.5 py-2.5 w-[196px] border transition-all ${on ? (tone === "ok" ? "border-ok/50 glow-ok" : "border-bad/60 glow-bad") : "border-line opacity-50"}`}>
      <div className={`flex items-center gap-2 text-[12.5px] font-semibold ${on ? color : "text-mut"}`}>
        {tone === "ok" ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}{title}
      </div>
      <div className="text-[11px] text-dim mt-0.5">{sub}</div>
    </div>
  );
}

function Connector({ state }: { state: "off" | "on" | "flow" | "bad" }) {
  const c = state === "bad" ? "#fb5c5c" : state === "on" ? "#34d399" : state === "flow" ? "#5b8cff" : "#2a3040";
  return (
    <svg width="26" height="14" viewBox="0 0 30 14" className="shrink-0">
      <line x1="0" y1="7" x2="21" y2="7" stroke={c} strokeWidth="2" className={state === "flow" ? "flow" : ""} />
      <path d="M20 2 L28 7 L20 12 Z" fill={c} />
    </svg>
  );
}
