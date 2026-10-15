#!/usr/bin/env node
import { Command } from "commander";
import { spawn } from "node:child_process";
import path from "node:path";
import { loadConfig, ROOT, CONFIG_FILE, type Config } from "./config.js";
import { doctor } from "./doctor.js";
import fs from "node:fs";
import { tagExists, type Diff } from "./git.js";
import { precheck, type Risk } from "./precheck.js";
import { evaluate, askHuman } from "./policy.js";
import { baseline, watch, type Verdict, type WatchHooks } from "./watch.js";
import { pickTarget, type Target } from "./targets/index.js";
import type { Scope } from "./targets/types.js";
import { explainRollback } from "./explain.js";
import { notify } from "./notify.js";
import * as db from "./db.js";

const program = new Command().name("releaseguard").description("AI guardrail around deploys");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Everything printed to the terminal is also written to the events table, so the dashboard sees it live. */
function makeLogger(id: number) {
  return (s: string) => { console.log(s); db.emit(id, "log", { line: s }); };
}
const step = (id: number, n: number, name: string, status: "active" | "done" | "fail" | "skipped", detail = "") =>
  db.emit(id, "step", { n, name, status, detail });

interface DeployOpts { yes?: boolean; traffic?: boolean; skipPrecheck?: boolean; target?: string; canary?: boolean }

program.command("deploy <tag>")
  .description("pre-check, deploy, watch, auto-rollback")
  .option("-y, --yes", "auto-approve the policy gate")
  .option("-t, --traffic", "generate synthetic traffic while watching (demo)")
  .option("--skip-precheck", "skip the AI risk analysis")
  .option("--target <name>", "docker | k8s (default from releaseguard.yml)")
  .option("--no-canary", "k8s: plain rolling update instead of canary first")
  .action(async (tag: string, opts: DeployOpts) => {
    const cfg = loadConfig(opts.target);
    const target = pickTarget(cfg);
    if (!tagExists(tag)) { console.error(`✗ git tag ${tag} not found`); process.exit(1); }
    const from = target.current();
    if (from === tag) { console.log(`• ${tag} is already running`); return; }
    const useCanary = Boolean(target.canary) && cfg.target === "k8s" && cfg.k8s.canary && opts.canary !== false;
    const id = db.startDeployment(tag, from, target.name, useCanary ? "canary" : "full");
    const log = makeLogger(id);
    process.on("SIGINT", () => { db.finish(id, "aborted", "interrupted (Ctrl+C)"); process.exit(130); });
    log(`\n▶ ReleaseGuard [${target.name}${useCanary ? ", canary" : ""}]: ${from ?? "(nothing)"} → ${tag}\n`);

    // 1. PRE-CHECK
    let risk: Risk | null = null, diff: Diff | null = null;
    if (!opts.skipPrecheck) {
      step(id, 1, "Pre-check", "active", "reading the diff");
      log("1/4 pre-check: reading the diff...");
      ({ risk, diff } = await precheck(from, tag, cfg.app));
      db.saveRisk(id, risk.score, risk.summary, risk.reasons);
      log(`    risk ${risk.score}/10  ${risk.summary}`);
      for (const r of risk.reasons) log(`    - ${r}`);
      const flags = [risk.has_migration && "migration", risk.has_env_change && "env change", risk.has_dependency_change && "dependency change"].filter(Boolean);
      if (flags.length) log(`    flags: ${flags.join(", ")}`);
      step(id, 1, "Pre-check", "done", `risk ${risk.score}/10 · ${risk.summary}`);

      // 2. POLICY GATE
      const d = evaluate(cfg, risk);
      if (d.needsApproval) {
        step(id, 2, "Policy gate", "active", `waiting for approval: ${d.why}`);
        log(`\n2/4 policy: needs human approval (${d.why})`);
        await notify(`⚠️ *${tag}* needs approval (risk ${risk.score}/10, ${d.why})\n${risk.summary}\n${risk.reasons.map((r) => `• ${r}`).join("\n")}\nApprove in the dashboard or the terminal.`);
        let ok: boolean, by: string;
        if (opts.yes) { ok = true; by = "--yes flag"; log("    approved via --yes"); db.requestApproval(id, tag, d.why, risk); db.decideApproval(id, "approved", by); }
        else { db.requestApproval(id, tag, d.why, risk); ({ ok, by } = await askHuman(id, "    deploy anyway?")); }
        if (!ok) {
          step(id, 2, "Policy gate", "fail", `rejected by ${by}`);
          db.finish(id, "blocked", `rejected by ${by} (${d.why})`);
          log(`✗ rejected by ${by}, nothing deployed`);
          await notify(`⛔ *${tag}* rejected at the policy gate by ${by}.`);
          return;
        }
        db.setApproved(id, by);
        step(id, 2, "Policy gate", "done", `approved by ${by}`);
        log(`    approved by ${by}`);
      } else { step(id, 2, "Policy gate", "done", "below threshold · auto-approved"); log("2/4 policy: auto-approved"); }
    } else { step(id, 1, "Pre-check", "skipped"); step(id, 2, "Policy gate", "skipped"); log("1/4 pre-check skipped\n2/4 policy skipped"); }

    let traffic: ReturnType<typeof spawn> | null = null;
    if (opts.traffic) traffic = spawn(path.join(ROOT, "scripts", "traffic.sh"), [cfg.urls.app], { stdio: "ignore" });
    try {
      const ctx: Ctx = { cfg, target, tag, from, id, risk, diff, log };
      if (useCanary) await canaryFlow(ctx);
      else await fullFlow(ctx);
    } finally { traffic?.kill(); }
  });

interface Ctx { cfg: Config; target: Target; tag: string; from: string | null; id: number; risk: Risk | null; diff: Diff | null; log: (s: string) => void }

function hooks(ctx: Ctx, scope: Scope, compare?: Scope): WatchHooks {
  return {
    log: ctx.log,
    onSample: (s, c, left) => db.emit(ctx.id, "sample", {
      scope: scope.label, left,
      errorRate: s.errorRate, p95ms: s.p95ms, rps: s.rps, healthy: s.healthy, pods: s.pods ?? null,
      compare: c ? { scope: compare?.label, errorRate: c.errorRate, p95ms: c.p95ms, rps: c.rps } : null,
    }),
  };
}

/** Plain deploy: everything switches, watch, undo on regression. */
async function fullFlow(ctx: Ctx) {
  const { cfg, target, tag, from, id, risk, diff, log } = ctx;
  const base = await baseline(cfg, target.scope);
  db.emit(id, "baseline", { errorRate: base.errorRate, p95ms: base.p95ms });
  step(id, 3, "Deploy", "active", "switching all instances");
  log(`\n3/4 deploy: baseline err ${pct(base.errorRate)} p95 ${base.p95ms ?? "-"}ms`);
  let deployOut = "";
  try { deployOut = target.deploy(tag); }
  catch (e) {
    const diag = target.diagnose?.() ?? "";
    step(id, 3, "Deploy", "fail", "rollout never became ready");
    log(`\n🔴 rollout failed: ${(e as Error).message.split("\n")[0].slice(0, 160)}`);
    if (diag) log(diag.split("\n").map((l) => "    " + l).join("\n"));
    log(`    ${target.rollback()}`);
    const v: Verdict = { ok: false, reason: "rollout failed, new pods never became ready", samples: [], baseline: base };
    await finishRollback(ctx, v, diag, "rollout failed");
    return;
  }
  step(id, 3, "Deploy", "done", deployOut);
  log(`    ${deployOut}`);
  await notify(`🚀 *${tag}* deployed on ${target.name} (risk ${risk?.score ?? "-"}/10, was ${from ?? "nothing"}). Watching for ${cfg.watch.window_seconds}s...`);
  await sleep(3000);
  step(id, 4, "Watch", "active", `${cfg.watch.window_seconds}s window`);
  log(`\n4/4 watch: ${cfg.watch.window_seconds}s, every ${cfg.watch.interval_seconds}s`);
  const v = await watch(cfg, base, target.scope, hooks(ctx, target.scope));
  if (v.ok) {
    step(id, 4, "Watch", "done", v.reason);
    db.emit(id, "verdict", { ok: true, reason: v.reason, outcome: "live" });
    db.finish(id, "live", v.reason, v.samples);
    log(`\n✅ ${tag} is live (${v.reason})`);
    const last = v.samples.at(-1);
    await notify(`✅ *${tag}* is live on ${target.name}. ${v.reason}. err ${pct(last?.errorRate ?? 0)}, p95 ${last?.p95ms ?? "-"}ms.`);
  } else {
    step(id, 4, "Watch", "fail", v.reason);
    log(`\n🔴 regression detected: ${v.reason}`);
    log(`    ${target.rollback()}`);
    await finishRollback(ctx, v, target.diagnose?.() ?? "", "auto");
  }
}

/** Canary: 1 pod of the new version next to stable, watch only that pod, then promote or discard. */
async function canaryFlow(ctx: Ctx) {
  const { cfg, target, tag, from, id, risk, log } = ctx;
  const c = target.canary!;
  const base = await baseline(cfg, c.stableScope);
  db.emit(id, "baseline", { errorRate: base.errorRate, p95ms: base.p95ms });
  step(id, 3, "Canary", "active", "starting 1 pod of the new version");
  log(`\n3/4 canary: baseline (stable) err ${pct(base.errorRate)} p95 ${base.p95ms ?? "-"}ms`);
  let startOut = "";
  try { startOut = c.start(tag); log(`    ${startOut}`); }
  catch (e) {
    const diag = target.diagnose?.() ?? "";
    step(id, 3, "Canary", "fail", "canary pod never became ready");
    log(`\n🔴 canary never became ready: ${(e as Error).message.split("\n")[0].slice(0, 160)}`);
    if (diag) log(diag.split("\n").map((l) => "    " + l).join("\n"));
    log(`    ${c.abort()}`);
    const v: Verdict = { ok: false, reason: "canary pod never became ready", samples: [], baseline: base };
    await finishCanaryAbort(ctx, v, diag);
    return;
  }
  step(id, 3, "Canary", "done", startOut);
  await notify(`🐤 *${tag}* canary up on ${target.name} (1 pod, risk ${risk?.score ?? "-"}/10, stable stays ${from}). Watching for ${cfg.watch.window_seconds}s...`);
  await sleep(3000);
  step(id, 4, "Watch", "active", `canary vs stable, ${cfg.watch.window_seconds}s`);
  log(`\n4/4 watch canary vs stable: ${cfg.watch.window_seconds}s, every ${cfg.watch.interval_seconds}s`);
  const v = await watch(cfg, base, c.scope, hooks(ctx, c.scope, c.stableScope), c.stableScope);
  if (!v.ok) {
    step(id, 4, "Watch", "fail", v.reason);
    log(`\n🔴 canary failed: ${v.reason}`);
    const diag = target.diagnose?.() ?? "";
    log(`    ${c.abort()}`);
    await finishCanaryAbort(ctx, v, diag);
    return;
  }
  step(id, 4, "Watch", "done", v.reason);
  log(`\n    canary healthy, promoting to all pods...`);
  try { log(`    ${c.promote(tag)}`); }
  catch (e) {
    log(`\n🔴 promotion failed: ${(e as Error).message.split("\n")[0].slice(0, 160)}`);
    log(`    ${target.rollback()}`); log(`    ${c.abort()}`);
    await finishRollback(ctx, { ...v, ok: false, reason: "promotion rollout failed" }, target.diagnose?.() ?? "", "promotion failed");
    return;
  }
  const last = v.samples.at(-1);
  db.emit(id, "verdict", { ok: true, reason: `${v.reason}, promoted`, outcome: "live" });
  db.finish(id, "live", `${v.reason}, promoted`, v.samples);
  log(`\n✅ ${tag} is live on all pods (${v.reason}, promoted)`);
  await notify(`✅ *${tag}* promoted to all pods on ${target.name}. Canary ${v.reason}: err ${pct(last?.errorRate ?? 0)}, p95 ${last?.p95ms ?? "-"}ms.`);
}

async function finishRollback(ctx: Ctx, v: Verdict, diag: string, how: string) {
  const { target, tag, from, id, diff, log } = ctx;
  const why = diff ? await explainRollback(from ?? "none", tag, diff, v, diag) : `Rolled back: ${v.reason}`;
  db.emit(id, "verdict", { ok: false, reason: v.reason, outcome: "rolled_back", note: why });
  db.finish(id, "rolled_back", why, v.samples);
  log(`\n${why}\n`);
  await notify(`🔴 *Rolled back ${tag} → ${from}* on ${target.name} (${how}, ${v.reason})\n${why}`);
}

async function finishCanaryAbort(ctx: Ctx, v: Verdict, diag: string) {
  const { target, tag, from, id, diff, log } = ctx;
  const why = diff ? await explainRollback(from ?? "none", tag, diff, v, diag, "canary") : `Canary aborted: ${v.reason}`;
  db.emit(id, "verdict", { ok: false, reason: v.reason, outcome: "canary_aborted", note: why });
  db.finish(id, "canary_aborted", why, v.samples);
  log(`\n${why}\n`);
  await notify(`🔴 *Canary ${tag} discarded* on ${target.name}, stable ${from} untouched (${v.reason})\n${why}`);
}

program.command("precheck <from> <to>")
  .description("risk analysis only (any git refs), prints markdown; used by CI")
  .option("--json", "print raw JSON")
  .action(async (from: string, to: string, o: { json?: boolean }) => {
    const cfg = loadConfig();
    const { risk, diff } = await precheck(from, to, cfg.app);
    if (o.json) return console.log(JSON.stringify({ risk, files: diff.files }, null, 2));
    const d = evaluate(cfg, risk);
    const badge = risk.score >= cfg.precheck.risk_threshold ? "🔴" : risk.score >= 4 ? "🟡" : "🟢";
    const flags = [risk.has_migration && "migration", risk.has_env_change && "env change", risk.has_dependency_change && "dependency change"].filter(Boolean);
    const out = [`### ${badge} ReleaseGuard pre-check: risk ${risk.score}/10\n`, `**${risk.summary}**\n`, ...risk.reasons.map((r) => `- ${r}`)];
    if (flags.length) out.push(`\nFlags: ${flags.join(", ")}`);
    if (risk.watch_closely?.length) out.push(`\nWatch closely after deploy: ${risk.watch_closely.map((w) => `\`${w}\``).join(", ")}`);
    out.push(`\n${d.needsApproval ? `⚠️ Deploy will **pause for human approval** (${d.why}).` : "✅ Deploy will proceed without manual approval."}`);
    out.push(`\n<sub>${diff.files.length} file(s) in ${diff.path}/ changed · ${from.slice(0, 12)} → ${to.slice(0, 12)}</sub>`);
    console.log(out.join("\n"));
  });

program.command("serve")
  .description("dashboard + API on http://127.0.0.1:4000")
  .option("-p, --port <port>", "port", "4000")
  .action(async (o: { port: string }) => {
    const { serve } = await import("./serve.js");
    serve(Number(o.port));
  });

program.command("doctor")
  .description("check this config against git, docker/kubectl, the app and Prometheus; tells you what is missing")
  .option("--target <name>")
  .action(async (o: { target?: string }) => { const ok = await doctor(loadConfig(o.target)); process.exit(ok ? 0 : 1); });

program.command("init")
  .description("write a starter releaseguard.yml for your own service (does not overwrite an existing one)")
  .option("--name <name>", "app / image / deployment name", "my-api")
  .option("--path <path>", "folder of the app inside this repo", ".")
  .action((o: { name: string; path: string }) => {
    if (fs.existsSync(CONFIG_FILE)) { console.log(`${CONFIG_FILE} already exists. Edit it, then run ./rg doctor.`); return; }
    fs.writeFileSync(CONFIG_FILE, starterConfig(o.name, o.path));
    console.log(`wrote ${CONFIG_FILE}\n\nNext:\n  1. expose GET /health and GET /metrics (prom-client) in your app\n  2. put GROQ_API_KEY in .env\n  3. git tag v1.0.0\n  4. ./rg doctor`);
  });

function starterConfig(name: string, p: string) {
  return `# ReleaseGuard config for ${name}. Run \`./rg doctor\` after editing.
app:
  name: ${name}
  path: ${p}
  dockerfile: ${p === "." ? "Dockerfile" : p + "/Dockerfile"}
  health_path: /health
  description: ""

metrics:
  requests_total: http_requests_total
  duration_bucket: http_request_duration_seconds_bucket
  status_label: status
  track_label: track

target: docker

docker:
  compose_file: docker-compose.yml
  service: ${name}
  urls: { app: http://127.0.0.1:3000, prometheus: http://127.0.0.1:9090 }

k8s:
  deployment: ${name}
  namespace: default
  container: ${name}
  canary: true
  urls: { app: http://127.0.0.1:30080, prometheus: http://127.0.0.1:30090 }

precheck:
  risk_threshold: 7
  require_approval_if: [migration, env_change]

watch:
  window_seconds: 120
  interval_seconds: 10
  rollback_if:
    error_rate_above: 0.05
    p95_latency_above_ms: 800
    p95_latency_factor: 3
    health_failures: 2
    pod_restarts_above: 1
`;
}

program.command("rollback").description("manual rollback to previous version").option("--target <name>").action(async (o: { target?: string }) => {
  const t = pickTarget(loadConfig(o.target)); const out = t.rollback(); console.log(out); await notify(`↩️ manual: ${out}`);
});

program.command("status").description("what is running").option("--target <name>").action(async (o: { target?: string }) => {
  const cfg = loadConfig(o.target); const t = pickTarget(cfg); const s = await baseline(cfg, t.scope);
  const pods = s.pods ? `  pods ${s.pods.ready}/${s.pods.desired}` : "";
  console.log(`[${t.name}] running: ${t.current() ?? "nothing"}  healthy=${s.healthy}  rps ${s.rps.toFixed(1)}  err ${pct(s.errorRate)}  p95 ${s.p95ms ?? "-"}ms${pods}`);
});

program.command("history").description("audit log").option("-n <n>", "rows", "15").action((o: { n: string }) => {
  const rows = db.history(Number(o.n));
  if (!rows.length) return console.log("no deployments yet");
  const icons: Record<string, string> = { live: "✅", rolled_back: "🔴", canary_aborted: "🐤🔴", blocked: "⛔", aborted: "…" };
  for (const r of rows) {
    console.log(`${icons[r.result ?? ""] ?? "…"} #${r.id} ${r.started_at.slice(0, 16).replace("T", " ")}  ${r.previous ?? "-"} → ${r.version}  risk ${r.risk_score ?? "-"}/10  ${r.result ?? "running"}`);
    if (r.reason) console.log(`     ${r.reason.split("\n")[0].slice(0, 110)}`);
  }
});

program.parseAsync();
