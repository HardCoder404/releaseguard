// Tiny read-only dashboard over the audit log. No framework, one HTML page + one JSON endpoint.
import http from "node:http";
import { history, type DeployRow } from "./db.js";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const ICON: Record<string, string> = { live: "✅", rolled_back: "🔴", canary_aborted: "🐤🔴", blocked: "⛔", aborted: "…" };

function page(rows: DeployRow[]): string {
  const live = rows.filter((r) => r.result === "live").length;
  const caught = rows.filter((r) => r.result === "rolled_back" || r.result === "canary_aborted").length;
  const tr = rows.map((r) => {
    const samples = r.samples ? (JSON.parse(r.samples) as { errorRate: number; p95ms: number | null }[]) : [];
    const last = samples.at(-1);
    return `<tr class="${esc(r.result)}">
      <td>${ICON[r.result ?? ""] ?? "…"} ${esc(r.result ?? "running")}</td>
      <td class="mono">${esc(r.started_at.slice(0, 16).replace("T", " "))}</td>
      <td class="mono">${esc(r.previous ?? "-")} → <b>${esc(r.version)}</b></td>
      <td><span class="risk r${r.risk_score ?? 0}">${r.risk_score ?? "-"}/10</span></td>
      <td class="mono">${last ? `err ${(last.errorRate * 100).toFixed(1)}% · p95 ${last.p95ms ?? "-"}ms · ${samples.length} samples` : "-"}</td>
      <td class="reason"><details><summary>${esc((r.reason ?? "").split("\n")[0].slice(0, 90))}</summary><pre>${esc(r.reason)}</pre>${r.risk_summary ? `<p><b>Pre-check:</b> ${esc(r.risk_summary)}</p>` : ""}</details></td>
    </tr>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>ReleaseGuard</title>
<meta http-equiv="refresh" content="10">
<style>
:root{--bg:#0f1115;--card:#171a21;--fg:#e6e6e6;--mut:#8b93a7;--ok:#2ecc71;--bad:#ff5a5f;--warn:#f5b942}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,Segoe UI,Inter,sans-serif;padding:32px}
h1{margin:0 0 4px;font-size:22px}.sub{color:var(--mut);margin-bottom:24px}
.stats{display:flex;gap:16px;margin-bottom:24px}.stat{background:var(--card);padding:14px 18px;border-radius:10px;min-width:140px}
.stat b{display:block;font-size:26px}.stat span{color:var(--mut);font-size:12px}
table{width:100%;border-collapse:collapse;background:var(--card);border-radius:10px;overflow:hidden}
th,td{padding:10px 12px;text-align:left;vertical-align:top;border-bottom:1px solid #22262f}th{color:var(--mut);font-weight:500;font-size:12px}
.mono{font-family:ui-monospace,Menlo,monospace;font-size:12.5px}.reason{max-width:520px}
summary{cursor:pointer;color:#cfd4e0}pre{white-space:pre-wrap;font-size:12px;color:var(--mut);margin:8px 0}
.risk{padding:2px 8px;border-radius:999px;font-size:12px;background:#2a2f3a}
.r7,.r8,.r9,.r10{background:#3a1f22;color:var(--bad)}.r4,.r5,.r6{background:#3a331f;color:var(--warn)}.r1,.r2,.r3{background:#1f3a2a;color:var(--ok)}
tr.rolled_back td:first-child,tr.canary_aborted td:first-child{color:var(--bad)}tr.live td:first-child{color:var(--ok)}
</style></head><body>
<h1>ReleaseGuard</h1><div class="sub">Every deploy decision, with the reason. Auto-refreshes every 10s.</div>
<div class="stats">
<div class="stat"><b>${rows.length}</b><span>deploys</span></div>
<div class="stat"><b style="color:var(--ok)">${live}</b><span>went live</span></div>
<div class="stat"><b style="color:var(--bad)">${caught}</b><span>caught &amp; reverted</span></div>
</div>
<table><thead><tr><th>Result</th><th>When</th><th>Version</th><th>Risk</th><th>Last sample</th><th>Why</th></tr></thead><tbody>${tr}</tbody></table>
</body></html>`;
}

export function serve(port: number) {
  http.createServer((req, res) => {
    const rows = history(100);
    if (req.url?.startsWith("/api")) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(rows)); }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(page(rows));
  }).listen(port, "127.0.0.1", () => console.log(`ReleaseGuard dashboard → http://127.0.0.1:${port}`));
}
