"use client";
import { useState } from "react";
import { usePoll, send, fmtTime, type Approval } from "@/lib/api";

export default function Approvals() {
  const { data, reload } = usePoll<Approval[]>("/api/approvals", 2000);
  const [busy, setBusy] = useState<number | null>(null);
  const [name, setName] = useState("");

  const decide = async (id: number, action: "approve" | "reject") => {
    setBusy(id);
    await send(`POST`, `/api/approvals/${id}/${action}`, { by: name || undefined });
    setBusy(null); reload();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Approvals</h1>
        <p className="text-sm text-mut">Deploys the policy gate is holding. Decide here or in the terminal, whichever comes first.</p>
      </div>
      <div className="flex items-center gap-2 max-w-sm">
        <input className="input" placeholder="your name (shows in the audit log)" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      {!data ? <p className="text-mut text-sm">Loading…</p> : data.length === 0 ? (
        <div className="card p-10 text-center text-mut text-sm">Nothing waiting. Risky deploys will show up here with their reasons.</div>
      ) : data.map((a) => (
        <div key={a.deployment_id} className="card p-5 border-l-4 border-l-warn">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-lg font-semibold">{a.version}</div>
            <span className="pill border text-bad bg-bad/10 border-bad/30">risk {a.risk_score ?? "–"}/10</span>
            <span className="text-xs text-mut mono ml-auto">#{a.deployment_id} · waiting since {fmtTime(a.created_at)}</span>
          </div>
          <div className="mt-2 text-sm">{a.risk_summary}</div>
          <ul className="mt-2 text-sm text-mut list-disc pl-5 space-y-0.5">{a.risk_reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          <div className="mt-3 text-xs text-warn">Held because: {a.why}</div>
          <div className="mt-4 flex gap-2">
            <button className="btn btn-ok" disabled={busy === a.deployment_id} onClick={() => decide(a.deployment_id, "approve")}>Approve and deploy</button>
            <button className="btn btn-bad" disabled={busy === a.deployment_id} onClick={() => decide(a.deployment_id, "reject")}>Reject</button>
          </div>
        </div>
      ))}
    </div>
  );
}
