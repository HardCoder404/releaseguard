"use client";
import { useEffect, useRef, useState } from "react";

export const API = "";   // same origin (rg serve). In `next dev`, rewrites proxy /api to :4000.

export interface Deployment {
  id: number; version: string; previous: string | null; target: string | null; mode: string | null;
  risk_score: number | null; risk_summary: string | null; risk_reasons: string[]; approved_by: string | null;
  result: string | null; reason: string | null; samples: SamplePoint[]; started_at: string; finished_at: string | null;
  events?: Event[];
}
export interface SamplePoint { at: string; rps: number; errorRate: number; p95ms: number | null; healthy: boolean }
export interface Event {
  id: number; deployment_id: number; at: string; type: "step" | "log" | "sample" | "verdict" | "done" | "baseline";
  n?: number; name?: string; status?: "active" | "done" | "fail" | "skipped"; detail?: string;     // step
  line?: string;                                                                                     // log
  scope?: string; left?: number; errorRate?: number; p95ms?: number | null; rps?: number; healthy?: boolean; // sample
  pods?: { ready: number; desired: number; restarts: number } | null;
  compare?: { scope?: string; errorRate: number; p95ms: number | null; rps: number } | null;
  ok?: boolean; reason?: string; outcome?: string; note?: string;                                    // verdict
  result?: string;                                                                                   // done
}
export interface Approval {
  deployment_id: number; version: string; why: string; risk_score: number | null; risk_summary: string | null;
  risk_reasons: string[]; status: string; created_at: string;
}
export interface Status { target: string | null; running: string | null; healthy?: boolean; rps?: number; errorRate?: number; p95ms?: number | null; pods?: { ready: number; desired: number } | null; error?: string }
export interface Config {
  target: string; k8s: { canary: boolean; deployment: string };
  precheck: { risk_threshold: number; require_approval_if: string[] };
  watch: { window_seconds: number; interval_seconds: number; rollback_if: { error_rate_above: number; p95_latency_above_ms: number; p95_latency_factor: number; health_failures: number; pod_restarts_above: number } };
}

export async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
}
export async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API}${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}

/** Polls a GET endpoint every `ms`. */
export function usePoll<T>(path: string, ms = 3000): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const run = () => get<T>(path).then((d) => { if (alive) { setData(d); setError(null); } }).catch((e) => alive && setError(String(e.message)));
    run();
    const t = setInterval(run, ms);
    return () => { alive = false; clearInterval(t); };
  }, [path, ms, tick]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}

/** Live events from the CLI via SSE. `onEvent` gets every event as it is written. */
export function useEvents(onEvent: (e: Event) => void, since?: number) {
  const cb = useRef(onEvent); cb.current = onEvent;
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (since === undefined) return;   // wait until the initial snapshot is loaded
    const es = new EventSource(`${API}/api/events${since !== undefined ? `?since=${since}` : ""}`);
    const handler = (m: MessageEvent) => cb.current(JSON.parse(m.data));
    for (const t of ["step", "log", "sample", "verdict", "done", "baseline"]) es.addEventListener(t, handler as EventListener);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [since]);
  return connected;
}

export const fmtPct = (x: number | undefined | null) => x === undefined || x === null ? "–" : `${(x * 100).toFixed(1)}%`;
export const fmtMs = (x: number | undefined | null) => x === undefined || x === null ? "–" : `${x} ms`;
export const fmtTime = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
export const resultMeta: Record<string, { label: string; cls: string; icon: string }> = {
  live: { label: "live", cls: "text-ok bg-ok/10 border-ok/30", icon: "✓" },
  rolled_back: { label: "rolled back", cls: "text-bad bg-bad/10 border-bad/30", icon: "↩" },
  canary_aborted: { label: "canary discarded", cls: "text-bad bg-bad/10 border-bad/30", icon: "✗" },
  blocked: { label: "blocked", cls: "text-warn bg-warn/10 border-warn/30", icon: "⛔" },
  aborted: { label: "aborted", cls: "text-mut bg-panel2 border-line", icon: "…" },
  running: { label: "running", cls: "text-blue bg-blue/10 border-blue/30", icon: "●" },
};
