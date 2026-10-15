// Dashboard server: JSON API + live events (SSE) + the static Next.js build in ui/out.
// The CLI never talks to this process; both read and write the same SQLite file.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadConfig, saveConfig } from "./config.js";
import { pickTarget } from "./targets/index.js";
import { baseline } from "./watch.js";
import * as db from "./db.js";

const UI = path.join(ROOT, "ui", "out");
const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain", ".gif": "image/gif" };

const json = (res: http.ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body));
};
const readBody = (req: http.IncomingMessage) => new Promise<string>((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });

function deploymentView(row: db.DeployRow) {
  return { ...row, risk_reasons: row.risk_reasons ? JSON.parse(row.risk_reasons) : [], samples: row.samples ? JSON.parse(row.samples) : [] };
}

async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  const p = url.pathname;
  if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,PUT", "access-control-allow-headers": "content-type" }); res.end(); return true; }

  if (p === "/api/deployments") return json(res, 200, db.history(Number(url.searchParams.get("limit") ?? 100)).map(deploymentView)), true;
  if (p === "/api/deployments/latest") { const d = db.latestDeployment(); return json(res, 200, d ? { ...deploymentView(d), events: db.eventsFor(d.id).map(ev) } : null), true; }
  const m = p.match(/^\/api\/deployments\/(\d+)$/);
  if (m) { const d = db.deployment(Number(m[1])); return d ? (json(res, 200, { ...deploymentView(d), events: db.eventsFor(d.id).map(ev) }), true) : (json(res, 404, { error: "not found" }), true); }

  if (p === "/api/events") {               // Server-Sent Events: everything the CLI writes, as it happens
    let last = Number(url.searchParams.get("since") ?? 0);
    if (!url.searchParams.has("since")) { const l = db.eventsSince(0, 100000); last = l.length ? l[l.length - 1].id : 0; }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "access-control-allow-origin": "*" });
    res.write(`retry: 2000\n\n`);
    const tick = () => {
      for (const e of db.eventsSince(last)) { last = e.id; res.write(`id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(ev(e))}\n\n`); }
    };
    tick();
    const timer = setInterval(() => { tick(); res.write(`: ping\n\n`); }, 1000);
    req.on("close", () => clearInterval(timer));
    return true;
  }

  if (p === "/api/approvals") return json(res, 200, db.pendingApprovals().map((a) => ({ ...a, risk_reasons: a.risk_reasons ? JSON.parse(a.risk_reasons) : [] }))), true;
  const a = p.match(/^\/api\/approvals\/(\d+)\/(approve|reject)$/);
  if (a && req.method === "POST") {
    const body = JSON.parse((await readBody(req)) || "{}") as { by?: string };
    const ok = db.decideApproval(Number(a[1]), a[2] === "approve" ? "approved" : "rejected", `dashboard${body.by ? ` (${body.by})` : ""}`);
    return json(res, ok ? 200 : 409, { ok, status: ok ? a[2] : "already decided" }), true;
  }

  if (p === "/api/config" && req.method === "GET") { const c = loadConfig(); return json(res, 200, { target: c.target, k8s: { canary: c.k8s.canary, deployment: c.k8s.deployment }, precheck: c.precheck, watch: c.watch }), true; }
  if (p === "/api/config" && req.method === "PUT") {
    try { const c = saveConfig(JSON.parse(await readBody(req))); return json(res, 200, { ok: true, precheck: c.precheck, watch: c.watch, k8s: { canary: c.k8s.canary } }), true; }
    catch (e) { return json(res, 400, { error: (e as Error).message }), true; }
  }

  if (p === "/api/status") {
    try { const cfg = loadConfig(); const t = pickTarget(cfg); const s = await baseline(cfg, t.scope); return json(res, 200, { target: t.name, running: t.current(), healthy: s.healthy, rps: s.rps, errorRate: s.errorRate, p95ms: s.p95ms, pods: s.pods ?? null }), true; }
    catch (e) { return json(res, 200, { target: null, running: null, error: (e as Error).message }), true; }
  }
  if (p.startsWith("/api/")) return json(res, 404, { error: "unknown endpoint" }), true;
  return false;
}

const ev = (e: db.EventRow) => ({ id: e.id, deployment_id: e.deployment_id, at: e.at, type: e.type, ...JSON.parse(e.data) });

function staticFile(res: http.ServerResponse, url: URL) {
  if (!fs.existsSync(UI)) { res.writeHead(200, { "content-type": "text/html" }); return res.end(`<pre style="font:14px Menlo;padding:24px">ReleaseGuard API is up. The dashboard is not built yet:\n\n  cd ui && npm install && npm run build\n\nthen reload.</pre>`); }
  let file = path.join(UI, decodeURIComponent(url.pathname));
  if (!file.startsWith(UI)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file) && fs.existsSync(file + ".html")) file = file + ".html";
  if (!fs.existsSync(file)) file = path.join(UI, "index.html");
  res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream", "cache-control": file.includes("/_next/static/") ? "public, max-age=31536000, immutable" : "no-cache" });
  fs.createReadStream(file).pipe(res);
}

export function serve(port: number) {
  http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    try { if (await api(req, res, url)) return; } catch (e) { return json(res, 500, { error: (e as Error).message }); }
    staticFile(res, url);
  }).listen(port, "127.0.0.1", () => console.log(`ReleaseGuard dashboard → http://127.0.0.1:${port}`));
}
