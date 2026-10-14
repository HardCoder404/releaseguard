// PRE-CHECK: read the diff like a senior engineer would, before anything ships.
import { askJSON } from "./ai.js";
import { diffBetween, type Diff } from "./git.js";

export interface Risk {
  score: number;              // 1 (trivial) .. 10 (dangerous)
  summary: string;            // one line
  reasons: string[];          // why that score
  has_migration: boolean;
  has_env_change: boolean;
  has_dependency_change: boolean;
  watch_closely: string[];    // endpoints/areas the watcher should care about
}

const SYSTEM = `You are a release engineer reviewing a diff before production deploy.
Score risk 1-10:
1-3: copy/UI/comment changes, no logic.
4-6: contained logic change (one route/function), no schema/env/dependency change.
7-10: database migration, env var change, payment/auth/checkout logic, dependency upgrade, error handling removed, anything that could raise error rate or latency.
Be concrete: cite file names and what changed. Respond ONLY with JSON:
{"score":n,"summary":"...","reasons":["..."],"has_migration":bool,"has_env_change":bool,"has_dependency_change":bool,"watch_closely":["/route",...]}`;

/** Cheap deterministic signals, so we never depend 100% on the model. */
function heuristics(d: Diff) {
  const f = d.files.join("\n");
  const p = d.patch;
  return {
    migration: /migrat|schema|\.sql/i.test(f) || /ALTER TABLE|CREATE TABLE|DROP /i.test(p),
    env: /\.env|process\.env\.[A-Z_]+/.test(p) && /^\+.*process\.env/m.test(p),
    deps: /package(-lock)?\.json/.test(f),
    checkout: /checkout|payment|auth/i.test(p),
  };
}

export async function precheck(from: string | null, to: string): Promise<{ risk: Risk; diff: Diff }> {
  const diff = diffBetween(from, to);
  if (from && diff.files.length === 0) {
    return {
      diff,
      risk: { score: 1, summary: "No application code changed between versions.", reasons: ["diff is empty for shop-api/"],
        has_migration: false, has_env_change: false, has_dependency_change: false, watch_closely: [] },
    };
  }
  const h = heuristics(diff);
  const user = `Deploying ${from ?? "(nothing)"} -> ${to}

Commits:
${diff.commits}
Files changed:
${diff.stat}
Heuristic flags: migration=${h.migration} env=${h.env} dependencies=${h.deps} touches_checkout_or_auth=${h.checkout}

Diff:
${diff.patch || "(no patch)"}`;

  const risk = await askJSON<Risk>(SYSTEM, user);
  // never let the model under-report hard signals
  if (h.migration) { risk.has_migration = true; risk.score = Math.max(risk.score, 7); }
  if (h.deps) risk.has_dependency_change = true;
  risk.score = Math.min(10, Math.max(1, Math.round(risk.score)));
  return { risk, diff };
}
