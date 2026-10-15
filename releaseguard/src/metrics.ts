// Two PromQL queries + a health probe, for one scope (all pods, or just the canary).
import type { Config } from "./config.js";
import type { Scope, PodHealth } from "./targets/types.js";

export interface Sample {
  at: string;
  rps: number;
  errorRate: number;       // 0..1
  p95ms: number | null;    // null when no traffic yet
  healthy: boolean;
  version: string | null;
  pods?: PodHealth;        // k8s only
}

const WINDOW = "30s";

async function promQL(base: string, q: string): Promise<number | null> {
  let res: Response;
  try { res = await fetch(`${base}/api/v1/query?query=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(5000) }); }
  catch { return null; }   // Prometheus unreachable or slow: treat as "no data", the health probe still runs
  const j = (await res.json()) as { data: { result: { value: [number, string] }[] } };
  const v = j.data.result[0]?.value?.[1];
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function sample(cfg: Config, scope: Scope): Promise<Sample> {
  const p = cfg.urls.prometheus;
  const sel = scope.selector ? `{${scope.selector}}` : "";
  const selErr = scope.selector ? `{${scope.selector},status=~"5.."}` : `{status=~"5.."}`;
  const [rps, err5xx, p95] = await Promise.all([
    promQL(p, `sum(rate(http_requests_total${sel}[${WINDOW}]))`),
    promQL(p, `sum(rate(http_requests_total${selErr}[${WINDOW}]))`),
    promQL(p, `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket${sel}[${WINDOW}])) by (le))`),
  ]);
  let pods: PodHealth | undefined;
  if (scope.pods) { try { pods = scope.pods(); } catch { /* cluster unreachable: health check covers it */ } }
  // /health goes through the Service, so it may land on any pod. For k8s scopes pod readiness is the real health signal.
  let healthy = false, version: string | null = null;
  try {
    const r = await fetch(`${cfg.urls.app}/health`, { signal: AbortSignal.timeout(2000) });
    healthy = r.ok;
    version = ((await r.json()) as { version?: string }).version ?? null;
  } catch { healthy = false; }
  if (pods) healthy = pods.desired > 0 && pods.ready > 0;
  const total = rps ?? 0;
  return {
    at: new Date().toISOString(),
    rps: total,
    errorRate: total > 0 ? (err5xx ?? 0) / total : 0,
    p95ms: p95 === null ? null : Math.round(p95 * 1000),
    healthy,
    version,
    pods,
  };
}
