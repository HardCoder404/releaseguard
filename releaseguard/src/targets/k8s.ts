import { execFileSync } from "node:child_process";
import path from "node:path";
import { ROOT, scriptEnv, type Config } from "../config.js";
import type { Target, PodHealth } from "./types.js";

export function k8sTarget(cfg: Config): Target {
  const { deployment, namespace, container } = cfg.k8s;
  const kubectl = (...args: string[]) =>
    execFileSync("kubectl", ["-n", namespace, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const sh = (script: string, args: string[] = []) =>
    execFileSync(path.join(ROOT, "scripts", script), args, { encoding: "utf8", env: scriptEnv(cfg) }).trim();

  const imageOf = (deploy: string) => {
    const d = JSON.parse(kubectl("get", `deployment/${deploy}`, "-o", "json"));
    const c = (d.spec.template.spec.containers as { name: string; image: string }[]).find((x) => x.name === container) ?? d.spec.template.spec.containers[0];
    return c.image as string;
  };
  const podHealth = (deploy: string, selector: string): PodHealth => {
    let ready = 0, desired = 0;
    try { const d = JSON.parse(kubectl("get", `deployment/${deploy}`, "-o", "json")); ready = d.status?.readyReplicas ?? 0; desired = d.spec?.replicas ?? 0; }
    catch { /* deployment gone (canary aborted) */ }
    const pods = JSON.parse(kubectl("get", "pods", "-l", selector, "-o", "json")) as { items: { status?: { containerStatuses?: { restartCount: number }[] } }[] };
    const restarts = pods.items.reduce((n, p) => n + (p.status?.containerStatuses ?? []).reduce((m, c) => m + c.restartCount, 0), 0);
    return { ready, desired, restarts };
  };
  const diagnosePods = (selector: string): string => {
    const pods = JSON.parse(kubectl("get", "pods", "-l", selector, "-o", "json")) as {
      items: { metadata: { name: string }; status?: { containerStatuses?: { ready: boolean; restartCount: number; state?: Record<string, { reason?: string }> }[] } }[] };
    const out: string[] = [];
    for (const p of pods.items) {
      const c = p.status?.containerStatuses?.[0];
      if (!c || c.ready) continue;
      const state = c.state ? Object.entries(c.state).map(([k, v]) => `${k}${v.reason ? ` (${v.reason})` : ""}`).join(",") : "?";
      let logs = "";
      try { logs = kubectl("logs", p.metadata.name, "--tail=15", "--previous"); } catch {}
      if (!logs.trim()) { try { logs = kubectl("logs", p.metadata.name, "--tail=15"); } catch {} }
      out.push(`pod ${p.metadata.name}: ${state}, restarts ${c.restartCount}\n${logs.trim() || "(no logs)"}`);
    }
    return out.join("\n\n");
  };

  // pods are found by the selector of the stable Deployment itself, so any label scheme works
  const selectorOf = (deploy: string) => {
    try {
      const d = JSON.parse(kubectl("get", `deployment/${deploy}`, "-o", "json"));
      return Object.entries(d.spec.selector.matchLabels as Record<string, string>).map(([k, v]) => `${k}=${v}`).join(",");
    } catch { return `app=${deployment}`; }
  };
  const t = cfg.metrics.track_label;
  const stableSel = () => selectorOf(deployment);
  const canarySel = () => selectorOf(`${deployment}-canary`);
  const anySel = () => stableSel().split(",").filter((kv) => !kv.startsWith(`${t}=`)).join(",") || `app=${deployment}`;

  return {
    name: "k8s",
    current: () => { try { return imageOf(deployment).split(":").pop() ?? null; } catch { return null; } },
    deploy: (tag) => sh("k8s-deploy.sh", [tag]),
    rollback: () => sh("k8s-rollback.sh"),
    scope: { label: "stable", track: "stable", pods: () => podHealth(deployment, stableSel()) },
    diagnose: () => diagnosePods(anySel()),
    canary: {
      start: (tag) => sh("k8s-canary.sh", ["start", tag]),
      promote: (tag) => sh("k8s-canary.sh", ["promote", tag]),
      abort: () => sh("k8s-canary.sh", ["abort"]),
      scope: { label: "canary", track: "canary", pods: () => podHealth(`${deployment}-canary`, canarySel()) },
      stableScope: { label: "stable", track: "stable", pods: () => podHealth(deployment, stableSel()) },
    },
  };
}
