#!/usr/bin/env node
import { Command } from "commander";
import { spawn } from "node:child_process";
import path from "node:path";
import { loadConfig, ROOT } from "./config.js";
import { tagExists } from "./git.js";
import { precheck } from "./precheck.js";
import { evaluate, askHuman } from "./policy.js";
import { baseline, watch } from "./watch.js";
import { dockerTarget } from "./targets/docker.js";
import { explainRollback } from "./explain.js";
import { notify } from "./notify.js";
import * as db from "./db.js";

const program = new Command().name("releaseguard").description("AI guardrail around deploys");
const log = (s: string) => console.log(s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

program.command("deploy <tag>")
  .description("pre-check, deploy, watch, auto-rollback")
  .option("-y, --yes", "auto-approve the policy gate")
  .option("-t, --traffic", "generate synthetic traffic while watching (demo)")
  .option("--skip-precheck", "skip the AI risk analysis")
  .action(async (tag: string, opts: { yes?: boolean; traffic?: boolean; skipPrecheck?: boolean }) => {
    const cfg = loadConfig();
    const target = dockerTarget;
    if (!tagExists(tag)) { console.error(`✗ git tag ${tag} not found`); process.exit(1); }
    const from = target.current();
    if (from === tag) { console.log(`• ${tag} is already running`); return; }
    const id = db.startDeployment(tag, from);
    process.on("SIGINT", () => { db.finish(id, "aborted", "interrupted (Ctrl+C)"); process.exit(130); });
    log(`\n▶ ReleaseGuard: ${from ?? "(nothing)"} → ${tag}\n`);

    // 1. PRE-CHECK
    let risk = null, diff = null;
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
        await notify(`⚠️ *${tag}* needs approval: ${d.why}\n${risk.summary}`);
        if (opts.yes) log("    approved via --yes");
        const ok = opts.yes || (await askHuman("    deploy anyway?"));
        if (!ok) { db.finish(id, "blocked", d.why); log("✗ blocked by policy, nothing deployed"); return; }
        db.setApproved(id, opts.yes ? "--yes flag" : "terminal");
      } else log("2/4 policy: auto-approved");
    } else log("1/4 pre-check skipped\n2/4 policy skipped");

    // 3. DEPLOY
    const base = await baseline(cfg);
    log(`\n3/4 deploy: baseline err ${(base.errorRate * 100).toFixed(1)}% p95 ${base.p95ms ?? "-"}ms`);
    let traffic: ReturnType<typeof spawn> | null = null;
    if (opts.traffic) traffic = spawn(path.join(ROOT, "scripts", "traffic.sh"), [cfg.urls.app], { stdio: "ignore" });
    try {
      log(`    ${target.deploy(tag)}`);
      await notify(`🚀 deploying *${tag}* (risk ${risk?.score ?? "-"}/10). Watching for ${cfg.watch.window_seconds}s...`);
      await sleep(3000); // let the container boot and Prometheus scrape once

      // 4. WATCH
      log(`\n4/4 watch: ${cfg.watch.window_seconds}s, every ${cfg.watch.interval_seconds}s`);
      const v = await watch(cfg, base, log);
      if (v.ok) {
        db.finish(id, "live", v.reason, v.samples);
        log(`\n✅ ${tag} is live (${v.reason})`);
        await notify(`✅ *${tag}* is live. ${v.reason}.`);
      } else {
        log(`\n🔴 regression detected: ${v.reason}`);
        log(`    ${target.rollback()}`);
        const why = diff ? await explainRollback(from ?? "none", tag, diff, v) : `Rolled back: ${v.reason}`;
        db.finish(id, "rolled_back", why, v.samples);
        log(`\n${why}\n`);
        await notify(`🔴 *Rolled back ${tag} → ${from}* (auto)\n${why}`);
      }
    } finally { traffic?.kill(); }
  });

program.command("rollback").description("manual rollback to previous version").action(async () => {
  const out = dockerTarget.rollback(); log(out); await notify(`↩️ manual: ${out}`);
});

program.command("status").description("what is running").action(async () => {
  const cfg = loadConfig(); const s = await baseline(cfg);
  log(`running: ${dockerTarget.current() ?? "nothing"}  healthy=${s.healthy}  rps ${s.rps.toFixed(1)}  err ${(s.errorRate * 100).toFixed(1)}%  p95 ${s.p95ms ?? "-"}ms`);
});

program.command("history").description("audit log").option("-n <n>", "rows", "15").action((o: { n: string }) => {
  const rows = db.history(Number(o.n));
  if (!rows.length) return log("no deployments yet");
  for (const r of rows) {
    const icon = r.result === "live" ? "✅" : r.result === "rolled_back" ? "🔴" : r.result === "blocked" ? "⛔" : "…";
    log(`${icon} #${r.id} ${r.started_at.slice(0, 16).replace("T", " ")}  ${r.previous ?? "-"} → ${r.version}  risk ${r.risk_score ?? "-"}/10  ${r.result ?? "running"}`);
    if (r.reason) log(`     ${r.reason.split("\n")[0].slice(0, 110)}`);
  }
});

program.parseAsync();
