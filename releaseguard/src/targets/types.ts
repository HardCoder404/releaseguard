// Every target (docker, k8s, ...) answers the same questions.
export interface PodHealth { ready: number; desired: number; restarts: number }

/** What the watcher looks at: which pods' metrics, and whose health. */
export interface Scope {
  label: string;                  // for logs: "canary", "stable", "app"
  track: string;                  // value of the track label to query ("canary" | "stable"), "" = everything
  pods?: () => PodHealth;         // orchestrator-level health for this scope
}

export interface Canary {
  start(tag: string): string;     // bring up a small slice of the new version
  promote(tag: string): string;   // roll the new version out to everything, remove the slice
  abort(): string;                // remove the slice, stable untouched
  scope: Scope;                   // how to watch the slice
  stableScope: Scope;             // how to watch the rest (for side-by-side comparison)
}

export interface Target {
  name: string;
  current(): string | null;       // which version is running
  deploy(tag: string): string;    // put a version live everywhere
  rollback(): string;             // bring the previous one back
  scope: Scope;                   // how to watch a full deploy
  diagnose?(): string;            // logs/events of unhealthy pods
  canary?: Canary;                // optional: progressive delivery
}
