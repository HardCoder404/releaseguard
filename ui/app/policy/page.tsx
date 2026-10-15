"use client";
import { useEffect, useState } from "react";
import { get, send, type Config } from "@/lib/api";

const RULES = [["migration", "contains a database migration"], ["env_change", "changes environment variables"], ["dependency_change", "changes dependencies"]] as const;

export default function Policy() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { get<Config>("/api/config").then(setCfg); }, []);
  if (!cfg) return <p className="text-mut text-sm">Loading…</p>;

  const upd = (fn: (c: Config) => void) => { const c = structuredClone(cfg); fn(c); setCfg(c); setSaved(null); };
  const save = async () => {
    setBusy(true);
    const r = await send<{ ok?: boolean; error?: string }>("PUT", "/api/config", { precheck: cfg.precheck, watch: cfg.watch, k8s: { canary: cfg.k8s.canary } });
    setBusy(false); setSaved(r.ok ? "Saved to releaseguard.yml" : `Error: ${r.error}`);
  };
  const r = cfg.watch.rollback_if;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Policy</h1>
        <p className="text-sm text-mut">The rules. The model scores and explains; these numbers decide.</p>
      </div>

      <section className="card p-5 space-y-4">
        <h2 className="text-sm font-medium">Before the deploy</h2>
        <Field label={`Ask a human when risk score is at least ${cfg.precheck.risk_threshold}/10`}>
          <input type="range" min={1} max={10} value={cfg.precheck.risk_threshold} onChange={(e) => upd((c) => { c.precheck.risk_threshold = Number(e.target.value); })} className="w-full accent-blue" />
          <div className="flex justify-between text-[10px] text-mut mono"><span>1 · ask always</span><span>10 · never ask</span></div>
        </Field>
        <Field label="Always ask a human when the change…">
          <div className="space-y-1.5">
            {RULES.map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="accent-blue" checked={cfg.precheck.require_approval_if.includes(k)}
                  onChange={(e) => upd((c) => { c.precheck.require_approval_if = e.target.checked ? [...c.precheck.require_approval_if, k] : c.precheck.require_approval_if.filter((x) => x !== k); })} />
                {label}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Kubernetes rollout strategy">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-blue" checked={cfg.k8s.canary} onChange={(e) => upd((c) => { c.k8s.canary = e.target.checked; })} />canary first (1 pod of the new version next to stable), then promote</label>
        </Field>
      </section>

      <section className="card p-5 space-y-4">
        <h2 className="text-sm font-medium">After the deploy: revert when</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <Num label="5xx error rate above" suffix="%" value={r.error_rate_above * 100} step={0.5} onChange={(v) => upd((c) => { c.watch.rollback_if.error_rate_above = v / 100; })} />
          <Num label="p95 latency above" suffix="ms" value={r.p95_latency_above_ms} step={50} onChange={(v) => upd((c) => { c.watch.rollback_if.p95_latency_above_ms = v; })} />
          <Num label="or p95 grows by a factor of" suffix="×" value={r.p95_latency_factor} step={0.5} onChange={(v) => upd((c) => { c.watch.rollback_if.p95_latency_factor = v; })} />
          <Num label="health check fails in a row" suffix="times" value={r.health_failures} step={1} onChange={(v) => upd((c) => { c.watch.rollback_if.health_failures = v; })} />
          <Num label="pod restarts more than" suffix="times" value={r.pod_restarts_above} step={1} onChange={(v) => upd((c) => { c.watch.rollback_if.pod_restarts_above = v; })} />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Num label="watch window" suffix="s" value={cfg.watch.window_seconds} step={10} onChange={(v) => upd((c) => { c.watch.window_seconds = v; })} />
          <Num label="sample every" suffix="s" value={cfg.watch.interval_seconds} step={5} onChange={(v) => upd((c) => { c.watch.interval_seconds = v; })} />
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button className="btn btn-ok" onClick={save} disabled={busy}>Save</button>
        {saved && <span className={`text-sm ${saved.startsWith("Error") ? "text-bad" : "text-ok"}`}>{saved}</span>}
        <span className="text-xs text-mut ml-auto">Writes releaseguard/releaseguard.yml. The next deploy uses it.</span>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="text-sm text-mut mb-1.5">{label}</div>{children}</div>;
}
function Num({ label, suffix, value, step, onChange }: { label: string; suffix: string; value: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="text-sm text-mut mb-1.5">{label}</div>
      <div className="flex items-center gap-2">
        <input type="number" className="input" value={value} step={step} min={0} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="text-xs text-mut w-10">{suffix}</span>
      </div>
    </label>
  );
}
