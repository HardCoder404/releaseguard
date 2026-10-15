"use client";
import { useState } from "react";
import { usePoll, send, fmtTime, type Approval, type Config } from "@/lib/api";
import { RiskRing } from "@/components/RiskRing";
import { Check, X, Shield } from "@/components/Icons";

export default function Approvals() {
  const { data, reload } = usePoll<Approval[]>("/api/approvals", 2000);
  const { data: cfg } = usePoll<Config>("/api/config", 30000);
  const [busy, setBusy] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const decide = async (id: number, action: "approve" | "reject") => {
    setBusy(id);
    const r = await send<{ ok: boolean }>("POST", `/api/approvals/${id}/${action}`, { by: name || undefined });
    setBusy(null); reload();
    setToast(r.ok ? (action === "approve" ? "Approved. The deploy continues." : "Rejected. Nothing was deployed.") : "Already decided elsewhere.");
    setTimeout(() => setToast(null), 2800);
  };

  return (
    <div className="space-y-5">
      <Header title="Approvals" sub="Deploys the policy gate is holding. Decide here or in the terminal, whichever answers first." />
      <div className="rise rise-2 flex items-center gap-3 max-w-md">
        <input className="input" placeholder="Your name, for the audit log" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      {!data ? <div className="card h-40 shimmer" /> : data.length === 0 ? (
        <div className="card p-14 text-center rise rise-3">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-panel2 border border-line grid place-items-center text-ok mb-4"><Shield className="w-6 h-6" /></div>
          <div className="text-lg font-semibold">Nothing waiting</div>
          <p className="text-mut text-sm mt-1.5">Risky deploys stop here with their reasons.</p>
        </div>
      ) : data.map((a, i) => (
        <div key={a.deployment_id} className={`card p-6 rise glow-blue ${i ? "" : "rise-3"}`}>
          <div className="flex items-start gap-5">
            <RiskRing score={a.risk_score ?? 0} threshold={cfg?.precheck.risk_threshold ?? 7} size={72} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-[22px] font-semibold mono tracking-tight">{a.version}</div>
                <span className="pill pill-warn"><span className="dot dot-live" />waiting for a human</span>
                <span className="text-[11.5px] text-dim mono ml-auto">#{a.deployment_id} · since {fmtTime(a.created_at)}</span>
              </div>
              <div className="mt-2.5 text-[14.5px] leading-relaxed">{a.risk_summary}</div>
              <div className="mt-3 flex flex-wrap gap-1.5">{a.risk_reasons.map((r, j) => <span key={j} className="pill pill-mut font-normal text-[12px] py-1.5 whitespace-normal text-left">{r}</span>)}</div>
              <div className="mt-4 text-[12px] text-warn flex items-center gap-1.5"><span className="dot" />held because: {a.why}</div>
              <div className="mt-5 flex gap-2.5">
                <button className="btn btn-ok" disabled={busy === a.deployment_id} onClick={() => decide(a.deployment_id, "approve")}><Check className="w-4 h-4" />Approve and deploy</button>
                <button className="btn btn-bad" disabled={busy === a.deployment_id} onClick={() => decide(a.deployment_id, "reject")}><X className="w-4 h-4" />Reject</button>
              </div>
            </div>
          </div>
        </div>
      ))}
      {toast && <div className="toast fixed bottom-6 left-1/2 -translate-x-1/2 card px-4 py-2.5 text-sm border-line2 shadow-xl">{toast}</div>}
    </div>
  );
}

function Header({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="rise">
      <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-mut mt-1">{sub}</p>
    </div>
  );
}
