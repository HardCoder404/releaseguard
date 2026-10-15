import { execFileSync } from "node:child_process";
import path from "node:path";
import { ROOT } from "../config.js";
import type { Target, PodHealth } from "./types.js";

export function k8sTarget(deployment: string, namespace: string): Target {
  const kubectl = (...args: string[]) =>
    execFileSync("kubectl", ["-n", namespace, ...args], { encoding: "utf8" }).trim();
  const sh = (script: string, args: string[] = []) =>
    execFileSync(path.join(ROOT, "scripts", script), args, { encoding: "utf8", env: { ...process.env, DEPLOYMENT: deployment } }).trim();

  return {
    name: "k8s",
    current: () => {
      try { return kubectl("get", `deployment/${deployment}`, "-o", "jsonpath={.spec.template.spec.containers[0].image}").split(":").pop() ?? null; }
      catch { return null; }
    },
    deploy: (tag) => sh("k8s-deploy.sh", [tag]),
    rollback: () => sh("k8s-rollback.sh"),
    diagnose: (): string => {
      const pods = JSON.parse(kubectl("get", "pods", "-l", `app=${deployment}`, "-o", "json")) as {
        items: { metadata: { name: string }; status?: { phase?: string; containerStatuses?: { ready: boolean; restartCount: number; state?: Record<string, { reason?: string; message?: string }> }[] } }[] };
      const out: string[] = [];
      for (const p of pods.items) {
        const c = p.status?.containerStatuses?.[0];
        if (!c || c.ready) continue;
        const state = c.state ? Object.entries(c.state).map(([k, v]) => `${k}${v.reason ? ` (${v.reason})` : ""}`).join(",") : "?";
        let logs = "";
        try { logs = execFileSync("kubectl", ["-n", namespace, "logs", p.metadata.name, "--tail=15", "--previous"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch {}
        if (!logs.trim()) { try { logs = execFileSync("kubectl", ["-n", namespace, "logs", p.metadata.name, "--tail=15"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch {} }
        out.push(`pod ${p.metadata.name}: ${state}, restarts ${c.restartCount}\n${logs.trim() || "(no logs)"}`);
      }
      return out.join("\n\n");
    },
    pods: (): PodHealth => {
      const d = JSON.parse(kubectl("get", `deployment/${deployment}`, "-o", "json"));
      const pods = JSON.parse(kubectl("get", "pods", "-l", `app=${deployment}`, "-o", "json")) as { items: { status?: { containerStatuses?: { restartCount: number }[] } }[] };
      const restarts = pods.items.reduce((n, p) => n + (p.status?.containerStatuses ?? []).reduce((m, c) => m + c.restartCount, 0), 0);
      return { ready: d.status?.readyReplicas ?? 0, desired: d.spec?.replicas ?? 0, restarts };
    },
  };
}
