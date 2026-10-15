// Every target (docker, k8s, ...) answers the same 4 questions.
export interface PodHealth { ready: number; desired: number; restarts: number }
export interface Target {
  name: string;
  current(): string | null;             // which version is running
  deploy(tag: string): string;          // put a version live
  rollback(): string;                   // bring the previous one back
  pods?(): PodHealth;                   // optional: orchestrator-level health
  diagnose?(): string;                  // optional: logs/events of unhealthy pods
}
