import { execFileSync } from "node:child_process";
import path from "node:path";
import { ROOT } from "../config.js";
import type { Target, PodHealth } from "./types.js";

export function k8sTarget(deployment: string, namespace: string): Target {
  const kubectl = (...args: string[]) =>
    execFileSync("kubectl", ["-n", namespace, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const sh = (script: string, args: string[] = []) =>
    execFileSync(path.join(ROOT, "scripts", script), args, { encoding: "utf8", env: { ...process.env, DEPLOYMENT: deployment } }).trim();

  const podHealth = (deploy: string, selector: string): PodHealth => {
    let ready = 0, desired = 0;
    try {
      const d = JSON.parse(kubectl("get", `deployment/${deploy}`, "-o", "json"));
      ready = d.status?.readyReplicas ?? 0; desired = d.spec?.replicas ?? 0;
    } catch { /* deployment gone (canary aborted) */ }
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

  const stableSel = `app=${deployment},track=stable`;
  const canarySel = `app=${deployment},track=canary`;

  return {
    name: "k8s",
    current: () => {
      try { return kubectl("get", `deployment/${deployment}`, "-o", "jsonpath={.spec.template.spec.containers[0].image}").split(":").pop() ?? null; }
      catch { return null; }
    },
    deploy: (tag) => sh("k8s-deploy.sh", [tag]),
    rollback: () => sh("k8s-rollback.sh"),
    scope: { label: "stable", selector: 'track="stable"', pods: () => podHealth(deployment, stableSel) },
    diagnose: () => diagnosePods(`app=${deployment}`),
    canary: {
      start: (tag) => sh("k8s-canary.sh", ["start", tag]),
      promote: (tag) => sh("k8s-canary.sh", ["promote", tag]),
      abort: () => sh("k8s-canary.sh", ["abort"]),
      scope: { label: "canary", selector: 'track="canary"', pods: () => podHealth(`${deployment}-canary`, canarySel) },
      stableScope: { label: "stable", selector: 'track="stable"', pods: () => podHealth(deployment, stableSel) },
    },
  };
}
