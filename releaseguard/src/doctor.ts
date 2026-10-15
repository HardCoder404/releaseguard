// `rg doctor`: every assumption in releaseguard.yml, checked against the real world, with a fix hint.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT, env, type Config } from "./config.js";
import { git } from "./git.js";

const has = (bin: string) => { try { execFileSync("which", [bin], { stdio: "ignore" }); return true; } catch { return false; } };
async function fetchText(url: string, ms = 3000) { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); return { ok: r.ok, text: await r.text() }; }

export async function doctor(cfg: Config): Promise<boolean> {
  let fails = 0;
  const row = (ok: boolean | "warn", what: string, hint = "") => {
    if (ok === false) fails++;
    console.log(`${ok === true ? "✓" : ok === "warn" ? "!" : "✗"} ${what}${hint && ok !== true ? `\n    ${hint}` : ""}`);
  };
  console.log(`ReleaseGuard doctor · target ${cfg.target} · app ${cfg.app.name} (${cfg.app.path})\n`);

  // repo + build inputs
  row(fs.existsSync(path.join(ROOT, ".git")), "git repository", "ReleaseGuard deploys git tags; run it inside the repo of the service");
  const tags = git("tag").trim().split("\n").filter(Boolean);
  row(tags.length > 0, `git tags (${tags.length})`, "create one: git tag v1.0.0");
  row(fs.existsSync(path.join(ROOT, cfg.app.path)), `app folder ${cfg.app.path}/`, "fix app.path in releaseguard.yml");
  row(fs.existsSync(path.join(ROOT, cfg.app.dockerfile)), `Dockerfile ${cfg.app.dockerfile}`, "fix app.dockerfile");
  row(has("docker"), "docker CLI", "install Docker Desktop");
  row(env.groqKey ? true : "warn", "GROQ_API_KEY in .env", "without it the pre-check and explanations are skipped (deploy/watch/rollback still work)");
  row(env.slackWebhook ? true : "warn", "SLACK_WEBHOOK_URL in .env", "optional: notifications only print to the terminal");

  // target
  if (cfg.target === "k8s") {
    row(has("kubectl"), "kubectl", "install kubectl");
    try {
      const d = JSON.parse(execFileSync("kubectl", ["-n", cfg.k8s.namespace, "get", `deployment/${cfg.k8s.deployment}`, "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
      row(true, `deployment ${cfg.k8s.namespace}/${cfg.k8s.deployment}`);
      const labels = d.spec.template.metadata?.labels ?? {};
      row(labels[cfg.metrics.track_label] === "stable", `pod label ${cfg.metrics.track_label}: stable`, `add "${cfg.metrics.track_label}: stable" to the pod template labels AND selector.matchLabels of the Deployment (canary pods get "canary")`);
      row(!!(d.spec.selector.matchLabels ?? {})[cfg.metrics.track_label], `selector includes ${cfg.metrics.track_label}`, "otherwise the stable Deployment would adopt canary pods");
      const c = (d.spec.template.spec.containers as { name: string; ports?: { name?: string }[]; readinessProbe?: unknown }[]).find((x) => x.name === cfg.k8s.container);
      row(!!c, `container "${cfg.k8s.container}" in the pod`, "fix k8s.container");
      if (c) {
        row(!!c.readinessProbe, "readiness probe on the container", "add readinessProbe { httpGet: " + cfg.app.health_path + " } so rollouts are zero-downtime");
        row((c.ports ?? []).some((p) => p.name === "http"), 'container port named "http"', "the bundled Prometheus scrapes the port named http");
      }
    } catch { row(false, `deployment ${cfg.k8s.namespace}/${cfg.k8s.deployment} reachable`, "kubectl cannot find it: wrong context, namespace or name?"); }
  } else {
    row(fs.existsSync(path.join(ROOT, cfg.docker.compose_file)), `compose file ${cfg.docker.compose_file}`, "fix docker.compose_file");
  }

  // app
  try { const h = await fetchText(cfg.urls.app + cfg.app.health_path); row(h.ok, `app health ${cfg.urls.app}${cfg.app.health_path}`, "app not reachable: is it running and is urls.app right?"); }
  catch { row(false, `app health ${cfg.urls.app}${cfg.app.health_path}`, "app not reachable: is it running and is urls.app right?"); }
  try {
    const m = await fetchText(cfg.urls.app + "/metrics");
    row(m.ok, "GET /metrics", "expose Prometheus metrics (prom-client / prometheus_client)");
    row(m.text.includes(cfg.metrics.requests_total), `metric ${cfg.metrics.requests_total}`, "counter with a status label; or change metrics.requests_total");
    row(m.text.includes(cfg.metrics.duration_bucket), `metric ${cfg.metrics.duration_bucket}`, "histogram; or change metrics.duration_bucket");
  } catch { row(false, "GET /metrics", "expose Prometheus metrics (prom-client / prometheus_client)"); }

  // prometheus
  try {
    const q = await fetchText(`${cfg.urls.prometheus}/api/v1/query?query=sum(${cfg.metrics.requests_total})`);
    const j = JSON.parse(q.text) as { data?: { result?: unknown[] } };
    row(q.ok, `prometheus ${cfg.urls.prometheus}`, "not reachable: fix urls.prometheus");
    row((j.data?.result?.length ?? 0) > 0, `prometheus has ${cfg.metrics.requests_total} series`, "Prometheus is up but not scraping the app yet (check scrape config / pod labels), or no traffic yet");
    if (cfg.target === "k8s") {
      const t = await fetchText(`${cfg.urls.prometheus}/api/v1/label/${cfg.metrics.track_label}/values`);
      const vals = (JSON.parse(t.text) as { data?: string[] }).data ?? [];
      row(vals.includes("stable"), `prometheus carries label ${cfg.metrics.track_label}=stable`, "relabel the pod label into the metrics (see k8s/prometheus.yml)");
    }
  } catch { row(false, `prometheus ${cfg.urls.prometheus}`, "not reachable: fix urls.prometheus"); }

  console.log(`\n${fails === 0 ? "all good, run: ./rg deploy <tag> --traffic" : `${fails} problem(s) to fix`}`);
  return fails === 0;
}
