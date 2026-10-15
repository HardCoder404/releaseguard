"use client";
import { useEffect, useMemo, useState } from "react";
import { get, useEvents, fmtPct, fmtMs, fmtTime, resultMeta, type Deployment, type Event, type Config } from "@/lib/api";
import { StepFlow, emptySteps, type StepState } from "@/components/StepFlow";
import { LineChart } from "@/components/Chart";
import { Note } from "@/components/Note";

interface Pt { err: number; p95: number | null; cErr: number | null; cP95: number | null; left: number }

/** Rebuild the live view from a list of events (initial load + SSE stream share this). */
function reduce(events: Event[], mode: string | null) {
  const steps = emptySteps(mode);
  const logs: string[] = [];
  const pts: Pt[] = [];
  let verdict: Event | null = null, baseline: { errorRate: number; p95ms: number | null } | null = null;
  for (const e of events) {
    if (e.type === "step" && e.n) { steps[e.n - 1] = { n: e.n, name: e.name ?? steps[e.n - 1].name, status: e.status ?? "idle", detail: e.detail ?? "" }; }
    else if (e.type === "log" && e.line !== undefined) logs.push(e.line);
    else if (e.type === "sample") pts.push({ err: e.errorRate ?? 0, p95: e.p95ms ?? null, cErr: e.compare?.errorRate ?? null, cP95: e.compare?.p95ms ?? null, left: e.left ?? 0 });
    else if (e.type === "verdict") verdict = e;
    else if (e.type === "baseline") baseline = { errorRate: e.errorRate ?? 0, p95ms: e.p95ms ?? null };
  }
  return { steps, logs, pts, verdict, baseline };
}

export default function Live() {
  const [dep, setDep] = useState<Deployment | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [since, setSince] = useState<number | undefined>(undefined);

  useEffect(() => {
    get<Deployment | null>("/api/deployments/latest").then((d) => { setDep(d); setEvents(d?.events ?? []); setSince(d?.events?.at(-1)?.id ?? 0); setLoaded(true); });
    get<Config>("/api/config").then(setCfg).catch(() => {});
  }, []);

  const connected = useEvents((e) => {
    setDep((cur) => {
      if (!cur || e.deployment_id !== cur.id) {
        // a new deploy started: load its snapshot (header + events so far), then keep streaming into it
        get<Deployment>(`/api/deployments/${e.deployment_id}`).then((d) => { setDep(d); setEvents(d.events ?? []); });
        return cur;
      }
      // same deploy: append the event; on "done" refresh the header (result, reason, samples)
      setEvents((list) => list.some((x) => x.id === e.id) ? list : [...list, e]);
      if (e.type === "done") get<Deployment>(`/api/deployments/${cur.id}`).then((d) => setDep((c) => c?.id === d.id ? { ...d, events: undefined } : c));
      return cur;
    });
  }, since);

  const view = useMemo(() => reduce(events, dep?.mode ?? null), [events, dep?.mode]);
  const outcome = (dep?.result ?? null) as Parameters<typeof StepFlow>[0]["outcome"];
  const running = dep && !dep.result;
  const meta = resultMeta[dep?.result ?? "running"];
  const isCanary = dep?.mode === "canary";
  const errLimit = cfg?.watch.rollback_if.error_rate_above;
  const p95Limit = cfg?.watch.rollback_if.p95_latency_above_ms;

  if (!loaded) return <p className="text-mut text-sm">Loading…</p>;
  if (!dep) return (
    <div className="card p-10 text-center">
      <div className="text-lg font-medium">No deploys yet</div>
      <p className="text-mut text-sm mt-2">Run <code className="mono text-fg">./rg deploy v2.3.0 --traffic</code> and this page will follow it live.</p>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">
          <span className="text-mut">{dep.previous ?? "nothing"}</span> <span className="text-mut">→</span> {dep.version}
        </h1>
        <span className={`pill border ${meta.cls}`}>{meta.icon} {meta.label}</span>
        <span className="pill bg-panel2 text-mut border border-line">{dep.target} · {dep.mode}</span>
        {dep.risk_score !== null && <RiskPill score={dep.risk_score} threshold={cfg?.precheck.risk_threshold ?? 7} />}
        <span className="ml-auto text-xs text-mut mono">#{dep.id} · {fmtTime(dep.started_at)} · <span className={connected ? "text-ok" : "text-warn"}>{connected ? "live" : "reconnecting"}</span></span>
      </div>

      <StepFlow steps={view.steps} outcome={outcome} />

      {dep.risk_summary && (
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-mut mb-1">Pre-check</div>
          <div className="text-sm">{dep.risk_summary}</div>
          {dep.risk_reasons.length > 0 && <ul className="mt-2 text-sm text-mut list-disc pl-5 space-y-0.5">{dep.risk_reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
          {dep.approved_by && <div className="mt-2 text-xs text-mut">approved by <span className="text-fg">{dep.approved_by}</span></div>}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card p-4">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-xs uppercase tracking-wider text-mut">Error rate{isCanary ? " · canary vs stable" : ""}</div>
            <div className="text-xs text-mut">baseline {fmtPct(view.baseline?.errorRate)} · now <span className="text-fg">{fmtPct(view.pts.at(-1)?.err)}</span></div>
          </div>
          <LineChart unit="%" threshold={errLimit} max={0.1} series={[
            { name: isCanary ? "canary" : "app", color: "#4c8dff", points: view.pts.map((p) => p.err) },
            ...(isCanary ? [{ name: "stable", color: "#8b93a7", points: view.pts.map((p) => p.cErr) }] : []),
          ]} />
        </div>
        <div className="card p-4">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-xs uppercase tracking-wider text-mut">p95 latency{isCanary ? " · canary vs stable" : ""}</div>
            <div className="text-xs text-mut">baseline {fmtMs(view.baseline?.p95ms)} · now <span className="text-fg">{fmtMs(view.pts.at(-1)?.p95)}</span></div>
          </div>
          <LineChart unit="ms" threshold={p95Limit} max={100} series={[
            { name: isCanary ? "canary" : "app", color: "#4c8dff", points: view.pts.map((p) => p.p95) },
            ...(isCanary ? [{ name: "stable", color: "#8b93a7", points: view.pts.map((p) => p.cP95) }] : []),
          ]} />
        </div>
      </div>

      {view.verdict && (
        <div className={`card p-4 border-l-4 ${view.verdict.ok ? "border-l-ok" : "border-l-bad"}`}>
          <div className={`text-sm font-medium ${view.verdict.ok ? "text-ok" : "text-bad"}`}>{view.verdict.ok ? "✓ " : "✗ "}{view.verdict.reason}</div>
          {view.verdict.note && <Note text={view.verdict.note} className="mt-2 text-mut" />}
        </div>
      )}

      <div className="card p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs uppercase tracking-wider text-mut">Log</div>
          {running && <span className="text-xs text-blue">● running</span>}
        </div>
        <pre className="mono text-[12.5px] leading-relaxed text-mut max-h-80 overflow-auto whitespace-pre-wrap">{view.logs.join("\n") || "…"}</pre>
      </div>
    </div>
  );
}

function RiskPill({ score, threshold }: { score: number; threshold: number }) {
  const cls = score >= threshold ? "text-bad bg-bad/10 border-bad/30" : score >= 4 ? "text-warn bg-warn/10 border-warn/30" : "text-ok bg-ok/10 border-ok/30";
  return <span className={`pill border ${cls}`}>risk {score}/10</span>;
}
