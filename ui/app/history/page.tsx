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
    return { total: all.length, live: all.filter((d) => d.result === "live").length, caught: caught.length,
      blocked: all.filter((d) => d.result === "blocked").length, avgDetect: detect.length ? Math.round(detect.reduce((a, b) => a + b, 0) / detect.length) : null };
  }, [data]);

  return (
    <div className="space-y-5">
      <div className="rise"><h1 className="text-[22px] font-semibold tracking-tight">History</h1><p className="text-sm text-mut mt-1">Every decision, with the reason.</p></div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 rise rise-2">
        <Stat label="deploys" value={stats.total} accent="from-blue to-violet" />
        <Stat label="went live" value={stats.live} accent="from-ok to-ok/40" cls="text-ok" />
        <Stat label="caught and reverted" value={stats.caught} accent="from-bad to-bad/40" cls="text-bad" />
        <Stat label="blocked at the gate" value={stats.blocked} accent="from-warn to-warn/40" cls="text-warn" />
        <Stat label="avg time to detect" value={stats.avgDetect !== null ? `${stats.avgDetect}s` : "–"} accent="from-violet to-blue" />
      </div>
      <div className="flex gap-1 rise rise-3 card p-1 w-fit">
        {filters.map((x) => <button key={x} onClick={() => setF(x)} className={`px-3.5 py-1.5 rounded-lg text-sm capitalize transition-colors ${f === x ? "bg-panel2 text-fg border border-line2" : "text-mut hover:text-fg border border-transparent"}`}>{x}</button>)}
      </div>
      <div className="card overflow-hidden rise rise-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-panel2/40">
              {["Result", "When", "Version", "Risk", "Last sample", "Why"].map((h) => <th key={h} className="text-left px-4 py-3 eyebrow font-semibold">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => <Row key={d.id} d={d} open={open === d.id} onClick={() => setOpen(open === d.id ? null : d.id)} />)}
            {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-mut">Nothing here.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, cls = "", accent }: { label: string; value: number | string; cls?: string; accent: string }) {
  return (
    <div className="card card-hover px-4 py-3.5 relative overflow-hidden">
      <div className={`absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b ${accent}`} />
      <div className={`text-[26px] font-semibold tracking-tight mono ${cls}`}>{value}</div>
      <div className="text-[11.5px] text-mut mt-0.5">{label}</div>
    </div>
  );
}

function Row({ d, open, onClick }: { d: Deployment; open: boolean; onClick: () => void }) {
  const m = resultMeta[d.result ?? "running"]; const last = d.samples.at(-1);
  const risk = d.risk_score;
  return (
    <>
      <tr className={`border-b border-line/70 hover:bg-panel2/50 cursor-pointer transition-colors ${open ? "bg-panel2/40" : ""}`} onClick={onClick}>
        <td className="px-4 py-3.5"><span className={`pill ${m.pill}`}><span className="dot" />{m.label}</span></td>
        <td className="px-4 py-3.5 mono text-[12px] text-mut whitespace-nowrap">{fmtTime(d.started_at)}</td>
        <td className="px-4 py-3.5 mono text-[12.5px]"><span className="text-dim">{d.previous ?? "–"} →</span> <b className="text-fg">{d.version}</b><div className="text-dim text-[11px] mt-0.5">{d.target} · {d.mode}</div></td>
        <td className="px-4 py-3.5">{risk !== null && <span className={`pill ${risk >= 7 ? "pill-bad" : risk >= 4 ? "pill-warn" : "pill-ok"} mono`}>{risk}/10</span>}</td>
        <td className="px-4 py-3.5 mono text-[12px] text-mut whitespace-nowrap">{last ? <>err {fmtPct(last.errorRate)} · p95 {fmtMs(last.p95ms)} <span className="text-dim">· {d.samples.length} samples</span></> : "–"}</td>
        <td className="px-4 py-3.5 text-mut max-w-[26rem]"><div className="line-clamp-1">{(d.reason ?? "").split("\n")[0].replace(/^\s*[-•]\s*/, "")}</div></td>
      </tr>
      {open && (
        <tr className="border-b border-line bg-panel2/30">
          <td colSpan={6} className="px-6 py-5">
            {d.risk_summary && <div className="text-[13.5px] mb-2"><span className="eyebrow mr-2">pre-check</span>{d.risk_summary}</div>}
            {d.risk_reasons.length > 0 && <div className="flex flex-wrap gap-1.5 mb-4">{d.risk_reasons.map((r, i) => <span key={i} className="pill pill-mut font-normal text-[12px] py-1.5 whitespace-normal text-left">{r}</span>)}</div>}
            {d.approved_by && <div className="text-[12px] text-dim mb-3">approved by <span className="text-fg">{d.approved_by}</span></div>}
            {d.reason && <Note text={d.reason} className="text-fg/90" />}
          </td>
        </tr>
      )}
    </>
  );
}
