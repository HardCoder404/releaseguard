#!/usr/bin/env node
import { Command } from "commander";
import { spawn } from "node:child_process";
import path from "node:path";
import { loadConfig, ROOT } from "./config.js";
import { tagExists } from "./git.js";
import { precheck, type Risk } from "./precheck.js";
import { evaluate, askHuman } from "./policy.js";
import { baseline, watch, type Verdict } from "./watch.js";
import { pickTarget, type Target } from "./targets/index.js";
import { explainRollback } from "./explain.js";
import { notify } from "./notify.js";
import type { Diff } from "./git.js";
import * as db from "./db.js";

const program = new Command().name("releaseguard").description("AI guardrail around deploys");
const log = (s: string) => console.log(s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

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
    const id = db.startDeployment(tag, from);
    process.on("SIGINT", () => { db.finish(id, "aborted", "interrupted (Ctrl+C)"); process.exit(130); });
    log(`\n▶ ReleaseGuard [${target.name}${useCanary ? ", canary" : ""}]: ${from ?? "(nothing)"} → ${tag}\n`);

    // 1. PRE-CHECK
    let risk: Risk | null = null, diff: Diff | null = null;
    if (!opts.skipPrecheck) {
      log("1/4 pre-check: reading the diff...");
      ({ risk, diff } = await precheck(from, tag));
      db.saveRisk(id, risk.score, risk.summary, risk.reasons);
      log(`    risk ${risk.score}/10  ${risk.summary}`);
      for (const r of risk.reasons) log(`    - ${r}`);
      const flags = [risk.has_migration && "migration", risk.has_env_change && "env change", risk.has_dependency_change && "dependency change"].filter(Boolean);
      if (flags.length) log(`    flags: ${flags.join(", ")}`);

      // 2. POLICY GATE
      const d = evaluate(cfg, risk);
      if (d.needsApproval) {
        log(`\n2/4 policy: needs human approval (${d.why})`);
        await notify(`⚠️ *${tag}* needs approval (risk ${risk.score}/10, ${d.why})\n${risk.summary}\n${risk.reasons.map((r) => `• ${r}`).join("\n")}`);
        if (opts.yes) log("    approved via --yes");
        const ok = opts.yes || (await askHuman("    deploy anyway?"));
        if (!ok) { db.finish(id, "blocked", d.why); log("✗ blocked by policy, nothing deployed"); await notify(`⛔ *${tag}* blocked by a human at the policy gate.`); return; }
        db.setApproved(id, opts.yes ? "--yes flag" : "terminal");
      } else log("2/4 policy: auto-approved");
    } else log("1/4 pre-check skipped\n2/4 policy skipped");

    let traffic: ReturnType<typeof spawn> | null = null;
    if (opts.traffic) traffic = spawn(path.join(ROOT, "scripts", "traffic.sh"), [cfg.urls.app], { stdio: "ignore" });
    try {
      if (useCanary) await canaryFlow(cfg, target, tag, from, id, risk, diff);
      else await fullFlow(cfg, target, tag, from, id, risk, diff);
    } finally { traffic?.kill(); }
  });

/** Plain deploy: everything switches, watch, undo on regression. */
async function fullFlow(cfg: ReturnType<typeof loadConfig>, target: Target, tag: string, from: string | null, id: number, risk: Risk | null, diff: Diff | null) {
  const base = await baseline(cfg, target.scope);
  log(`\n3/4 deploy: baseline err ${pct(base.errorRate)} p95 ${base.p95ms ?? "-"}ms`);
  let deployOut = "";
  try { deployOut = target.deploy(tag); }
  catch (e) {
    const diag = target.diagnose?.() ?? "";
    log(`\n🔴 rollout failed: ${(e as Error).message.split("\n")[0].slice(0, 160)}`);
    if (diag) log(diag.split("\n").map((l) => "    " + l).join("\n"));
    log(`    ${target.rollback()}`);
    const v: Verdict = { ok: false, reason: "rollout failed, new pods never became ready", samples: [], baseline: base };
    await finishRollback(target, tag, from, id, diff, v, diag, "rollout failed");
    return;
  }
  log(`    ${deployOut}`);
  await notify(`🚀 *${tag}* deployed on ${target.name} (risk ${risk?.score ?? "-"}/10, was ${from ?? "nothing"}). Watching for ${cfg.watch.window_seconds}s...`);
  await sleep(3000);
  log(`\n4/4 watch: ${cfg.watch.window_seconds}s, every ${cfg.watch.interval_seconds}s`);
  const v = await watch(cfg, base, target.scope, log);
  if (v.ok) {
    db.finish(id, "live", v.reason, v.samples);
    log(`\n✅ ${tag} is live (${v.reason})`);
    const last = v.samples.at(-1);
    await notify(`✅ *${tag}* is live on ${target.name}. ${v.reason}. err ${pct(last?.errorRate ?? 0)}, p95 ${last?.p95ms ?? "-"}ms.`);
  } else {
    log(`\n🔴 regression detected: ${v.reason}`);
    log(`    ${target.rollback()}`);
    await finishRollback(target, tag, from, id, diff, v, target.diagnose?.() ?? "", "auto");
  }
}

/** Canary: 1 pod of the new version next to stable, watch only that pod, then promote or discard. */
async function canaryFlow(cfg: ReturnType<typeof loadConfig>, target: Target, tag: string, from: string | null, id: number, risk: Risk | null, diff: Diff | null) {
  const c = target.canary!;
  const base = await baseline(cfg, c.stableScope);
  log(`\n3/4 canary: baseline (stable) err ${pct(base.errorRate)} p95 ${base.p95ms ?? "-"}ms`);
  try { log(`    ${c.start(tag)}`); }
  catch (e) {
    const diag = target.diagnose?.() ?? "";
    log(`\n🔴 canary never became ready: ${(e as Error).message.split("\n")[0].slice(0, 160)}`);
    if (diag) log(diag.split("\n").map((l) => "    " + l).join("\n"));
    log(`    ${c.abort()}`);
    const v: Verdict = { ok: false, reason: "canary pod never became ready", samples: [], baseline: base };
    await finishCanaryAbort(target, tag, from, id, diff, v, diag);
    return;
  }
  await notify(`🐤 *${tag}* canary up on ${target.name} (1 pod, risk ${risk?.score ?? "-"}/10, stable stays ${from}). Watching for ${cfg.watch.window_seconds}s...`);
  await sleep(3000);
  log(`\n4/4 watch canary vs stable: ${cfg.watch.window_seconds}s, every ${cfg.watch.interval_seconds}s`);
  const v = await watch(cfg, base, c.scope, log, c.stableScope);
  if (!v.ok) {
    log(`\n🔴 canary failed: ${v.reason}`);
    const diag = target.diagnose?.() ?? "";
    log(`    ${c.abort()}`);
    await finishCanaryAbort(target, tag, from, id, diff, v, diag);
    return;
  }
  log(`\n    canary healthy, promoting to all pods...`);
  try { log(`    ${c.promote(tag)}`); }
  catch (e) {
    log(`\n🔴 promotion failed: ${(e as Error).message.split("\n")[0].slice(0, 160)}`);
    log(`    ${target.rollback()}`); log(`    ${c.abort()}`);
    await finishRollback(target, tag, from, id, diff, { ...v, ok: false, reason: "promotion rollout failed" }, target.diagnose?.() ?? "", "promotion failed");
    return;
  }
  const last = v.samples.at(-1);
  db.finish(id, "live", `canary ${v.reason}, promoted`, v.samples);
  log(`\n✅ ${tag} is live on all pods (canary ${v.reason}, promoted)`);
  await notify(`✅ *${tag}* promoted to all pods on ${target.name}. Canary ${v.reason}: err ${pct(last?.errorRate ?? 0)}, p95 ${last?.p95ms ?? "-"}ms.`);
}

async function finishRollback(target: Target, tag: string, from: string | null, id: number, diff: Diff | null, v: Verdict, diag: string, how: string) {
  const why = diff ? await explainRollback(from ?? "none", tag, diff, v, diag) : `Rolled back: ${v.reason}`;
  db.finish(id, "rolled_back", why, v.samples);
  log(`\n${why}\n`);
  await notify(`🔴 *Rolled back ${tag} → ${from}* on ${target.name} (${how}, ${v.reason})\n${why}`);
}

async function finishCanaryAbort(target: Target, tag: string, from: string | null, id: number, diff: Diff | null, v: Verdict, diag: string) {
  const why = diff ? await explainRollback(from ?? "none", tag, diff, v, diag, "canary") : `Canary aborted: ${v.reason}`;
  db.finish(id, "canary_aborted", why, v.samples);
  log(`\n${why}\n`);
  await notify(`🔴 *Canary ${tag} discarded* on ${target.name}, stable ${from} untouched (${v.reason})\n${why}`);
}

program.command("rollback").description("manual rollback to previous version").option("--target <name>").action(async (o: { target?: string }) => {
  const t = pickTarget(loadConfig(o.target)); const out = t.rollback(); log(out); await notify(`↩️ manual: ${out}`);
});

program.command("status").description("what is running").option("--target <name>").action(async (o: { target?: string }) => {
  const cfg = loadConfig(o.target); const t = pickTarget(cfg); const s = await baseline(cfg, t.scope);
  const pods = s.pods ? `  pods ${s.pods.ready}/${s.pods.desired}` : "";
  log(`[${t.name}] running: ${t.current() ?? "nothing"}  healthy=${s.healthy}  rps ${s.rps.toFixed(1)}  err ${pct(s.errorRate)}  p95 ${s.p95ms ?? "-"}ms${pods}`);
});

program.command("history").description("audit log").option("-n <n>", "rows", "15").action((o: { n: string }) => {
  const rows = db.history(Number(o.n));
  if (!rows.length) return log("no deployments yet");
  const icons: Record<string, string> = { live: "✅", rolled_back: "🔴", canary_aborted: "🐤🔴", blocked: "⛔", aborted: "…" };
  for (const r of rows) {
    log(`${icons[r.result ?? ""] ?? "…"} #${r.id} ${r.started_at.slice(0, 16).replace("T", " ")}  ${r.previous ?? "-"} → ${r.version}  risk ${r.risk_score ?? "-"}/10  ${r.result ?? "running"}`);
    if (r.reason) log(`     ${r.reason.split("\n")[0].slice(0, 110)}`);
  }
});

program.parseAsync();
