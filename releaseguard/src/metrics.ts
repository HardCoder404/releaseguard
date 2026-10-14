// two PromQL queries + a health probe.
import type { Config } from "./config.js";

export interface Sample {
  at: string;
  rps: number;
  errorRate: number;       // 0..1
  p95ms: number | null;    // null when no traffic yet
  healthy: boolean;
  version: string | null;
}

const WINDOW = "30s";

async function promQL(base: string, q: string): Promise<number | null> {
  const res = await fetch(`${base}/api/v1/query?query=${encodeURIComponent(q)}`);
  const j = (await res.json()) as { data: { result: { value: [number, string] }[] } };
  const v = j.data.result[0]?.value?.[1];
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function sample(cfg: Config): Promise<Sample> {
  const p = cfg.urls.prometheus;
  const [rps, err5xx, p95] = await Promise.all([
    promQL(p, `sum(rate(http_requests_total[${WINDOW}]))`),
    promQL(p, `sum(rate(http_requests_total{status=~"5.."}[${WINDOW}]))`),
    promQL(p, `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[${WINDOW}])) by (le))`),
  ]);
  let healthy = false, version: string | null = null;
  try {
    const r = await fetch(`${cfg.urls.app}/health`, { signal: AbortSignal.timeout(2000) });
    healthy = r.ok;
    version = ((await r.json()) as { version?: string }).version ?? null;
  } catch { healthy = false; }
  const total = rps ?? 0;
  return {
    at: new Date().toISOString(),
    rps: total,
    errorRate: total > 0 ? (err5xx ?? 0) / total : 0,
    p95ms: p95 === null ? null : Math.round(p95 * 1000),
    healthy,
    version,
  };
}
