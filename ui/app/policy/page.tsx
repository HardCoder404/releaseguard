"use client";
import { useEffect, useState } from "react";
import { get, send, type Config } from "@/lib/api";
import { Check } from "@/components/Icons";

const RULES = [["migration", "contains a database migration"], ["env_change", "changes environment variables"], ["dependency_change", "changes dependencies"]] as const;

export default function Policy() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [orig, setOrig] = useState<string>("");
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { get<Config>("/api/config").then((c) => { setCfg(c); setOrig(JSON.stringify(c)); }); }, []);
  if (!cfg) return <div className="card h-40 shimmer" />;

  const dirty = JSON.stringify(cfg) !== orig;
  const upd = (fn: (c: Config) => void) => { const c = structuredClone(cfg); fn(c); setCfg(c); };
  const save = async () => {
    setBusy(true);
    const r = await send<{ ok?: boolean; error?: string }>("PUT", "/api/config", { precheck: cfg.precheck, watch: cfg.watch, k8s: { canary: cfg.k8s.canary } });
    setBusy(false);
    if (r.ok) setOrig(JSON.stringify(cfg));
    setToast(r.ok ? "Saved to releaseguard.yml. The next deploy uses it." : `Error: ${r.error}`);
    setTimeout(() => setToast(null), 2800);
  };
  const r = cfg.watch.rollback_if;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="rise"><h1 className="text-[22px] font-semibold tracking-tight">Policy</h1><p className="text-sm text-mut mt-1">The rules. The model scores and explains; these numbers decide.</p></div>

      <section className="card p-6 space-y-5 rise rise-2">
        <div className="eyebrow">Before the deploy</div>
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-sm">Ask a human when the risk score is at least</div>
            <div className={`mono text-lg font-semibold ${cfg.precheck.risk_threshold <= 4 ? "text-warn" : "text-blue"}`}>{cfg.precheck.risk_threshold}<span className="text-dim text-xs">/10</span></div>
          </div>
          <input type="range" min={1} max={10} value={cfg.precheck.risk_threshold} onChange={(e) => upd((c) => { c.precheck.risk_threshold = Number(e.target.value); })} className="w-full" />
          <div className="flex justify-between text-[10.5px] text-dim mono mt-1"><span>1 · ask always</span><span>10 · never ask</span></div>
        </div>
        <div>
          <div className="text-sm mb-2">Always ask a human when the change…</div>
          <div className="grid sm:grid-cols-3 gap-2">
            {RULES.map(([k, label]) => {
              const on = cfg.precheck.require_approval_if.includes(k);
              return (
                <label key={k} className={`card card-hover px-3.5 py-3 flex items-center gap-2.5 text-[13px] cursor-pointer ${on ? "border-blue/50" : ""}`}>
                  <input type="checkbox" checked={on} onChange={(e) => upd((c) => { c.precheck.require_approval_if = e.target.checked ? [...c.precheck.require_approval_if, k] : c.precheck.require_approval_if.filter((x) => x !== k); })} />
                  {label}
                </label>
              );
            })}
          </div>
        </div>
        <label className={`card card-hover px-4 py-3.5 flex items-center gap-3 cursor-pointer ${cfg.k8s.canary ? "border-blue/50" : ""}`}>
          <input type="checkbox" checked={cfg.k8s.canary} onChange={(e) => upd((c) => { c.k8s.canary = e.target.checked; })} />
          <div><div className="text-[13.5px]">Canary first on Kubernetes</div><div className="text-[12px] text-mut">1 pod of the new version next to stable, then promote. Off = plain rolling update.</div></div>
        </label>
      </section>

      <section className="card p-6 space-y-5 rise rise-3">
        <div className="eyebrow">After the deploy · revert when</div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Num label="5xx error rate above" suffix="%" value={+(r.error_rate_above * 100).toFixed(2)} step={0.5} onChange={(v) => upd((c) => { c.watch.rollback_if.error_rate_above = v / 100; })} />
          <Num label="p95 latency above" suffix="ms" value={r.p95_latency_above_ms} step={50} onChange={(v) => upd((c) => { c.watch.rollback_if.p95_latency_above_ms = v; })} />
          <Num label="or p95 grows by a factor of" suffix="×" value={r.p95_latency_factor} step={0.5} onChange={(v) => upd((c) => { c.watch.rollback_if.p95_latency_factor = v; })} />
          <Num label="health check fails in a row" suffix="times" value={r.health_failures} step={1} onChange={(v) => upd((c) => { c.watch.rollback_if.health_failures = v; })} />
          <Num label="pod restarts more than" suffix="times" value={r.pod_restarts_above} step={1} onChange={(v) => upd((c) => { c.watch.rollback_if.pod_restarts_above = v; })} />
        </div>
        <div className="h-px bg-line" />
        <div className="grid sm:grid-cols-2 gap-4">
          <Num label="watch window" suffix="s" value={cfg.watch.window_seconds} step={10} onChange={(v) => upd((c) => { c.watch.window_seconds = v; })} />
          <Num label="sample every" suffix="s" value={cfg.watch.interval_seconds} step={5} onChange={(v) => upd((c) => { c.watch.interval_seconds = v; })} />
        </div>
      </section>

      <div className="flex items-center gap-3 rise rise-4">
        <button className={`btn ${dirty ? "btn-primary" : "btn-ghost"}`} onClick={save} disabled={busy || !dirty}><Check className="w-4 h-4" />{dirty ? "Save changes" : "Saved"}</button>
        {dirty && <span className="pill pill-warn"><span className="dot" />unsaved changes</span>}
        <span className="text-xs text-dim ml-auto mono">releaseguard/releaseguard.yml</span>
      </div>
      {toast && <div className="toast fixed bottom-6 left-1/2 -translate-x-1/2 card px-4 py-2.5 text-sm border-line2 shadow-xl">{toast}</div>}
    </div>
  );
}

function Num({ label, suffix, value, step, onChange }: { label: string; suffix: string; value: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="text-[13px] text-mut mb-1.5">{label}</div>
      <div className="relative">
        <input type="number" className="input mono pr-14" value={value} step={step} min={0} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[11px] text-dim mono">{suffix}</span>
      </div>
    </label>
  );
}
