#!/usr/bin/env bash
# Usage: scripts/k8s-rollback.sh   -> kubectl rollout undo (k8s keeps the previous ReplicaSet around)
set -euo pipefail
DEPLOY="${DEPLOYMENT:-${APP_NAME:-app}}"; NS="${NAMESPACE:-default}"; CONTAINER="${CONTAINER:-app}"
img() { kubectl -n "$NS" get deployment "$DEPLOY" -o jsonpath="{.spec.template.spec.containers[?(@.name==\"$CONTAINER\")].image}" | sed 's/.*://'; }
CUR="$(img)"
kubectl -n "$NS" rollout undo "deployment/$DEPLOY" >/dev/null 2>&1
kubectl -n "$NS" rollout status "deployment/$DEPLOY" --timeout=90s >/dev/null
echo "rolled back $CUR -> $(img) (kubectl rollout undo)"
