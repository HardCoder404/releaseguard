// stdin: the stable Deployment as JSON. stdout: a canary Deployment derived from it.
// usage: kubectl get deploy X -o json | node canary-manifest.mjs <canary-name> <container> <image> [track-label]
const [name, container, image, trackLabel = "track"] = process.argv.slice(2);
let src = ""; for await (const c of process.stdin) src += c;
const d = JSON.parse(src);
const out = {
  apiVersion: "apps/v1", kind: "Deployment",
  metadata: { name, namespace: d.metadata.namespace, labels: { ...(d.metadata.labels ?? {}), [trackLabel]: "canary", "releaseguard/role": "canary" } },
  spec: {
    replicas: 1,
    selector: { matchLabels: { ...(d.spec.selector.matchLabels ?? {}), [trackLabel]: "canary" } },
    template: {
      metadata: { ...(d.spec.template.metadata ?? {}), labels: { ...(d.spec.template.metadata?.labels ?? {}), [trackLabel]: "canary" } },
      spec: { ...d.spec.template.spec, containers: d.spec.template.spec.containers.map((c) => c.name === container ? { ...c, image } : c) },
    },
  },
};
process.stdout.write(JSON.stringify(out));
