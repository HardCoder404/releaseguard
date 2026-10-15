import type { Config } from "../config.js";
import { dockerTarget } from "./docker.js";
import { k8sTarget } from "./k8s.js";
import type { Target } from "./types.js";
export type { Target } from "./types.js";

export function pickTarget(cfg: Config): Target {
  return cfg.target === "k8s" ? k8sTarget(cfg.k8s.deployment, cfg.k8s.namespace) : dockerTarget;
}
