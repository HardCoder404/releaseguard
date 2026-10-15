// WATCHER: compare "after deploy" against "before deploy" for a fixed window.
import type { Config } from "./config.js";
import { sample, type Sample } from "./metrics.js";
import type { Target } from "./targets/types.js";

export interface Verdict { ok: boolean; reason: string; samples: Sample[]; baseline: Sample }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function baseline(cfg: Config, target?: Target): Promise<Sample> {
  return sample(cfg, target);
}

export async function watch(cfg: Config, base: Sample, log: (s: string) => void, target?: Target): Promise<Verdict> {
  const { window_seconds, interval_seconds, rollback_if: r } = cfg.watch;
  const samples: Sample[] = [];
  let healthFails = 0;
  const deadline = Date.now() + window_seconds * 1000;

  while (Date.now() < deadline) {
    await sleep(interval_seconds * 1000);
    const s = await sample(cfg, target);
    samples.push(s);
    const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    const podInfo = s.pods ? `  pods ${s.pods.ready}/${s.pods.desired} restarts ${s.pods.restarts}` : "";
    log(`  ${s.healthy ? "✓" : "✗"} ${s.version ?? "?"}  rps ${s.rps.toFixed(1)}  err ${(s.errorRate * 100).toFixed(1)}%  p95 ${s.p95ms ?? "-"}ms${podInfo}  (${left}s left)`);

    if (s.pods) {
      const baseRestarts = base.pods?.restarts ?? 0;
      if (s.pods.restarts - baseRestarts > r.pod_restarts_above)
        return { ok: false, reason: `pods restarted ${s.pods.restarts - baseRestarts} times since deploy (crash loop?)`, samples, baseline: base };
      if (s.pods.ready === 0)
        return { ok: false, reason: `0/${s.pods.desired} pods ready`, samples, baseline: base };
    }

    healthFails = s.healthy ? 0 : healthFails + 1;
    if (healthFails >= r.health_failures)
      return { ok: false, reason: `/health failed ${healthFails} times in a row`, samples, baseline: base };

    if (s.rps > 0 && s.errorRate > r.error_rate_above)
      return { ok: false, reason: `error rate ${(s.errorRate * 100).toFixed(1)}% > ${(r.error_rate_above * 100).toFixed(0)}% (baseline ${(base.errorRate * 100).toFixed(1)}%)`, samples, baseline: base };

    if (s.p95ms !== null) {
      const tooSlowAbs = s.p95ms > r.p95_latency_above_ms;
      const tooSlowRel = base.p95ms !== null && base.p95ms > 0 && s.p95ms > base.p95ms * r.p95_latency_factor && s.p95ms > 50;
      if (tooSlowAbs || tooSlowRel)
        return { ok: false, reason: `p95 latency ${s.p95ms}ms vs baseline ${base.p95ms ?? "-"}ms (limit ${r.p95_latency_above_ms}ms or ${r.p95_latency_factor}x)`, samples, baseline: base };
    }
  }
  const last = samples.at(-1);
  if (last && last.rps === 0) return { ok: true, reason: "window passed but there was NO traffic, verdict is weak (run scripts/traffic.sh)", samples, baseline: base };
  return { ok: true, reason: `stable for ${window_seconds}s`, samples, baseline: base };
}
