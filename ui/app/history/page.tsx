"use client";
import { useMemo, useState } from "react";
import { usePoll, fmtPct, fmtMs, fmtTime, resultMeta, type Deployment } from "@/lib/api";
import { Note } from "@/components/Note";

const filters = ["all", "live", "reverted", "blocked"] as const;

export default function History() {
  const { data } = usePoll<Deployment[]>("/api/deployments?limit=200", 5000);
  const [f, setF] = useState<(typeof filters)[number]>("all");
  const [open, setOpen] = useState<number | null>(null);

  const rows = useMemo(() => (data ?? []).filter((d) =>
    f === "all" ? true : f === "live" ? d.result === "live" : f === "reverted" ? d.result === "rolled_back" || d.result === "canary_aborted" : d.result === "blocked"), [data, f]);

  const stats = useMemo(() => {
    const all = data ?? [];
    const caught = all.filter((d) => d.result === "rolled_back" || d.result === "canary_aborted");
    const detect = caught.map((d) => d.samples.length * 10).filter((n) => n > 0);
    return {
      total: all.length, live: all.filter((d) => d.result === "live").length, caught: caught.length,
      blocked: all.filter((d) => d.result === "blocked").length,
      avgDetect: detect.length ? Math.round(detect.reduce((a, b) => a + b, 0) / detect.length) : null,
    };
  }, [data]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">History</h1>
        <p className="text-sm text-mut">Every decision, with the reason.</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="deploys" value={stats.total} />
        <Stat label="went live" value={stats.live} cls="text-ok" />
        <Stat label="caught and reverted" value={stats.caught} cls="text-bad" />
        <Stat label="blocked at the gate" value={stats.blocked} cls="text-warn" />
        <Stat label="avg time to detect" value={stats.avgDetect !== null ? `${stats.avgDetect}s` : "–"} />
      </div>
      <div className="flex gap-1">
        {filters.map((x) => <button key={x} onClick={() => setF(x)} className={`btn ${f === x ? "bg-panel2 border border-mut" : "btn-ghost border-transparent"} capitalize`}>{x}</button>)}
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-mut uppercase tracking-wider">
            <tr className="border-b border-line">
              <th className="text-left px-4 py-3 font-medium">Result</th><th className="text-left px-4 py-3 font-medium">When</th>
              <th className="text-left px-4 py-3 font-medium">Version</th><th className="text-left px-4 py-3 font-medium">Risk</th>
              <th className="text-left px-4 py-3 font-medium">Last sample</th><th className="text-left px-4 py-3 font-medium">Why</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const m = resultMeta[d.result ?? "running"]; const last = d.samples.at(-1);
              return (
                <Row key={d.id} d={d} m={m} last={last} open={open === d.id} onClick={() => setOpen(open === d.id ? null : d.id)} />
              );
            })}
            {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-mut">Nothing here.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, cls = "" }: { label: string; value: number | string; cls?: string }) {
  return <div className="card px-4 py-3"><div className={`text-2xl font-semibold ${cls}`}>{value}</div><div className="text-xs text-mut">{label}</div></div>;
}

function Row({ d, m, last, open, onClick }: { d: Deployment; m: { label: string; cls: string; icon: string }; last?: Deployment["samples"][number]; open: boolean; onClick: () => void }) {
  return (
    <>
      <tr className="border-b border-line/60 hover:bg-panel2/60 cursor-pointer" onClick={onClick}>
        <td className="px-4 py-3"><span className={`pill border ${m.cls}`}>{m.icon} {m.label}</span></td>
        <td className="px-4 py-3 mono text-xs text-mut">{fmtTime(d.started_at)}</td>
        <td className="px-4 py-3 mono text-xs"><span className="text-mut">{d.previous ?? "–"} →</span> <b>{d.version}</b><div className="text-mut">{d.target} · {d.mode}</div></td>
        <td className="px-4 py-3">{d.risk_score !== null && <span className={`pill border ${d.risk_score >= 7 ? "text-bad bg-bad/10 border-bad/30" : d.risk_score >= 4 ? "text-warn bg-warn/10 border-warn/30" : "text-ok bg-ok/10 border-ok/30"}`}>{d.risk_score}/10</span>}</td>
        <td className="px-4 py-3 mono text-xs text-mut">{last ? `err ${fmtPct(last.errorRate)} · p95 ${fmtMs(last.p95ms)} · ${d.samples.length} samples` : "–"}</td>
        <td className="px-4 py-3 text-mut max-w-md"><div className="line-clamp-1">{(d.reason ?? "").split("\n")[0]}</div></td>
      </tr>
      {open && (
        <tr className="border-b border-line bg-panel2/40">
          <td colSpan={6} className="px-6 py-4">
            {d.risk_summary && <div className="text-sm mb-1"><span className="text-mut">Pre-check:</span> {d.risk_summary}</div>}
            {d.risk_reasons.length > 0 && <ul className="text-sm text-mut list-disc pl-5 mb-3">{d.risk_reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
            {d.approved_by && <div className="text-xs text-mut mb-3">approved by {d.approved_by}</div>}
            {d.reason && <Note text={d.reason} className="text-fg/90" />}
          </td>
        </tr>
      )}
    </>
  );
}
