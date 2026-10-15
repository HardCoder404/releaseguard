"use client";
import { useEffect, useMemo, useState } from "react";
import { get, useEvents, fmtPct, fmtMs, fmtTime, resultMeta, type Deployment, type Event, type Config } from "@/lib/api";
import { StepFlow, emptySteps } from "@/components/StepFlow";
import { LineChart } from "@/components/Chart";
import { Note } from "@/components/Note";
import { Log } from "@/components/Log";
import { RiskRing } from "@/components/RiskRing";
import { Shield, Clock } from "@/components/Icons";

interface Pt { err: number; p95: number | null; cErr: number | null; cP95: number | null; left: number }

function reduce(events: Event[], mode: string | null) {
  const steps = emptySteps(mode);
  const logs: string[] = [];
  const pts: Pt[] = [];
  let verdict: Event | null = null, baseline: { errorRate: number; p95ms: number | null } | null = null;
  for (const e of events) {
    if (e.type === "step" && e.n) steps[e.n - 1] = { n: e.n, name: e.name ?? steps[e.n - 1].name, status: e.status ?? "idle", detail: e.detail ?? "" };
    else if (e.type === "log" && e.line !== undefined) logs.push(e.line);
    else if (e.type === "sample") pts.push({ err: e.errorRate ?? 0, p95: e.p95ms ?? null, cErr: e.compare?.errorRate ?? null, cP95: e.compare?.p95ms ?? null, left: e.left ?? 0 });
    else if (e.type === "verdict") verdict = e;
    else if (e.type === "baseline") baseline = { errorRate: e.errorRate ?? 0, p95ms: e.p95ms ?? null };
  }
  return { steps, logs, pts, verdict, baseline };
}

function useElapsed(start: string | undefined, running: boolean, end: string | null | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!running) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [running]);
  if (!start) return "";
  const ms = (end ? new Date(end).getTime() : now) - new Date(start).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
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
        get<Deployment>(`/api/deployments/${e.deployment_id}`).then((d) => { setDep(d); setEvents(d.events ?? []); });
        return cur;
      }
      setEvents((list) => list.some((x) => x.id === e.id) ? list : [...list, e]);
      if (e.type === "done") get<Deployment>(`/api/deployments/${cur.id}`).then((d) => setDep((c) => c?.id === d.id ? { ...d, events: undefined } : c));
      return cur;
    });
  }, since);

  const view = useMemo(() => reduce(events, dep?.mode ?? null), [events, dep?.mode]);
  const running = !!dep && !dep.result;
  const elapsed = useElapsed(dep?.started_at, running, dep?.finished_at);
  const outcome = (dep?.result ?? null) as Parameters<typeof StepFlow>[0]["outcome"];
  const meta = resultMeta[dep?.result ?? "running"];
  const isCanary = dep?.mode === "canary";
  const threshold = cfg?.precheck.risk_threshold ?? 7;
  const watching = view.steps[3].status === "active";
  const left = view.pts.at(-1)?.left;

  if (!loaded) return <div className="card h-40 shimmer rounded-2xl" />;
  if (!dep) return (
    <div className="card p-14 text-center rise">
      <div className="mx-auto w-12 h-12 rounded-2xl bg-gradient-to-br from-blue to-violet grid place-items-center text-white mb-4"><Shield className="w-6 h-6" /></div>
      <div className="text-lg font-semibold">No deploys yet</div>
      <p className="text-mut text-sm mt-2">Run <code className="mono text-fg bg-panel2 border border-line px-1.5 py-0.5 rounded-md">./rg deploy v2.3.0 --traffic</code> and this page will follow it live.</p>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* hero */}
      <div className="card p-5 rise flex flex-wrap items-center gap-4">
        {dep.risk_score !== null && <RiskRing score={dep.risk_score} threshold={threshold} />}
        <div className="min-w-0">
          <div className="eyebrow mb-1">Deploy #{dep.id} · {dep.target} · {dep.mode}</div>
          <h1 className="text-[26px] leading-none font-semibold tracking-tight mono">
            <span className="text-dim">{dep.previous ?? "nothing"}</span><span className="text-dim mx-2">→</span>{dep.version}
          </h1>
        </div>
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          <span className={`pill ${meta.pill}`}><span className={`dot ${running ? "dot-live" : ""}`} />{meta.label}</span>
          {watching && left !== undefined && <span className="pill pill-blue"><Clock className="w-3 h-3" />{left}s left in window</span>}
          <span className="pill pill-mut mono"><Clock className="w-3 h-3" />{elapsed}</span>
          <span className="pill pill-mut mono text-dim">{fmtTime(dep.started_at)}</span>
          <span className={`pill ${connected ? "pill-ok" : "pill-warn"}`}><span className={`dot ${connected ? "dot-live" : ""}`} />{connected ? "stream" : "reconnecting"}</span>
        </div>
      </div>

      <div className="rise rise-2"><StepFlow steps={view.steps} outcome={outcome} /></div>

      {dep.risk_summary && (
        <div className="card p-5 rise rise-3">
          <div className="eyebrow mb-2">Pre-check</div>
          <div className="text-[14.5px] leading-relaxed">{dep.risk_summary}</div>
          {dep.risk_reasons.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">{dep.risk_reasons.map((r, i) => <span key={i} className="pill pill-mut font-normal text-[12px] py-1.5 whitespace-normal text-left">{r}</span>)}</div>
          )}
          {dep.approved_by && <div className="mt-3 text-xs text-dim">approved by <span className="text-fg">{dep.approved_by}</span></div>}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4 rise rise-4">
        <ChartCard title={`Error rate${isCanary ? " · canary vs stable" : ""}`} baseline={fmtPct(view.baseline?.errorRate)} now={fmtPct(view.pts.at(-1)?.err)}>
          <LineChart id="err" unit="%" threshold={cfg?.watch.rollback_if.error_rate_above} max={0.08} series={[
            { name: isCanary ? "canary" : "app", color: "#5b8cff", points: view.pts.map((p) => p.err) },
            ...(isCanary ? [{ name: "stable", color: "#8a92a6", points: view.pts.map((p) => p.cErr) }] : []),
          ]} />
        </ChartCard>
        <ChartCard title={`p95 latency${isCanary ? " · canary vs stable" : ""}`} baseline={fmtMs(view.baseline?.p95ms)} now={fmtMs(view.pts.at(-1)?.p95)}>
          <LineChart id="p95" unit="ms" threshold={cfg?.watch.rollback_if.p95_latency_above_ms} max={120} series={[
            { name: isCanary ? "canary" : "app", color: "#8b7cff", points: view.pts.map((p) => p.p95) },
            ...(isCanary ? [{ name: "stable", color: "#8a92a6", points: view.pts.map((p) => p.cP95) }] : []),
          ]} />
        </ChartCard>
      </div>

      {view.verdict && (
        <div className={`card p-5 rise ${view.verdict.ok ? "glow-ok" : "glow-bad"}`}>
          <div className={`flex items-center gap-2 text-[14.5px] font-semibold ${view.verdict.ok ? "text-ok" : "text-bad"}`}>
            <span className={`grid place-items-center w-6 h-6 rounded-full ${view.verdict.ok ? "bg-ok/15" : "bg-bad/15"}`}>{view.verdict.ok ? "✓" : "✗"}</span>{view.verdict.reason}
          </div>
          {view.verdict.note && <Note text={view.verdict.note} className="mt-3 text-mut" />}
        </div>
      )}

      <div className="card p-5 rise rise-5">
        <div className="flex items-center justify-between mb-3">
          <div className="eyebrow">Log</div>
          {running && <span className="pill pill-blue"><span className="dot dot-live" />running</span>}
        </div>
        <Log lines={view.logs} running={running} />
      </div>
    </div>
  );
}

function ChartCard({ title, baseline, now, children }: { title: string; baseline: string; now: string; children: React.ReactNode }) {
  return (
    <div className="card card-hover p-5">
      <div className="flex items-baseline justify-between mb-3">
        <div className="eyebrow">{title}</div>
        <div className="text-[11.5px] mono text-dim">baseline {baseline} · now <span className="text-fg">{now}</span></div>
      </div>
      {children}
    </div>
  );
}
