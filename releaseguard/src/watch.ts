// WATCHER: compare "after" against "before" for a fixed window, within one scope.
import type { Config } from "./config.js";
import { sample, type Sample } from "./metrics.js";
import type { Scope } from "./targets/types.js";

export interface Verdict { ok: boolean; reason: string; samples: Sample[]; baseline: Sample }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export async function baseline(cfg: Config, scope: Scope): Promise<Sample> {
  return sample(cfg, scope);
}

/** Watch `scope`; if `compare` is given, its numbers are printed next to it (canary vs stable). */
export async function watch(cfg: Config, base: Sample, scope: Scope, log: (s: string) => void, compare?: Scope): Promise<Verdict> {
  const { window_seconds, interval_seconds, rollback_if: r } = cfg.watch;
  const samples: Sample[] = [];
  let healthFails = 0;
  const deadline = Date.now() + window_seconds * 1000;

  while (Date.now() < deadline) {
    await sleep(interval_seconds * 1000);
    const [s, c] = await Promise.all([sample(cfg, scope), compare ? sample(cfg, compare) : Promise.resolve(null)]);
    samples.push(s);
    const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    const podInfo = s.pods ? `  pods ${s.pods.ready}/${s.pods.desired} restarts ${s.pods.restarts}` : "";
    const cmp = c ? `  | ${compare!.label}: err ${pct(c.errorRate)} p95 ${c.p95ms ?? "-"}ms` : "";
    log(`  ${s.healthy ? "✓" : "✗"} ${scope.label}: rps ${s.rps.toFixed(1)}  err ${pct(s.errorRate)}  p95 ${s.p95ms ?? "-"}ms${podInfo}${cmp}  (${left}s left)`);

    if (s.pods) {
      const baseRestarts = base.pods?.restarts ?? 0;
      if (s.pods.restarts - baseRestarts > r.pod_restarts_above)
        return { ok: false, reason: `${scope.label} pods restarted ${s.pods.restarts - baseRestarts} times since deploy (crash loop?)`, samples, baseline: base };
    }
    healthFails = s.healthy ? 0 : healthFails + 1;
    if (healthFails >= r.health_failures)
      return { ok: false, reason: `${scope.label} unhealthy ${healthFails} checks in a row`, samples, baseline: base };

    if (s.rps > 0 && s.errorRate > r.error_rate_above)
      return { ok: false, reason: `${scope.label} error rate ${pct(s.errorRate)} > ${pct(r.error_rate_above)} (baseline ${pct(base.errorRate)}${c ? `, stable now ${pct(c.errorRate)}` : ""})`, samples, baseline: base };

    if (s.p95ms !== null) {
      const tooSlowAbs = s.p95ms > r.p95_latency_above_ms;
      const tooSlowRel = base.p95ms !== null && base.p95ms > 0 && s.p95ms > base.p95ms * r.p95_latency_factor && s.p95ms > 50;
      if (tooSlowAbs || tooSlowRel)
        return { ok: false, reason: `${scope.label} p95 latency ${s.p95ms}ms vs baseline ${base.p95ms ?? "-"}ms (limit ${r.p95_latency_above_ms}ms or ${r.p95_latency_factor}x)`, samples, baseline: base };
    }
  }
  const last = samples.at(-1);
  if (last && last.rps === 0) return { ok: true, reason: "window passed but there was NO traffic, verdict is weak (run scripts/traffic.sh)", samples, baseline: base };
  return { ok: true, reason: `${scope.label} stable for ${window_seconds}s`, samples, baseline: base };
}
