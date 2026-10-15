#!/usr/bin/env bash
# Usage: scripts/k8s-rollback.sh   -> kubectl rollout undo (k8s keeps the previous ReplicaSet around)
set -euo pipefail
DEPLOY="${DEPLOYMENT:-shop-api}"
CUR="$(kubectl get deployment "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].image}' | sed 's/.*://')"
kubectl rollout undo "deployment/$DEPLOY" >/dev/null 2>&1
kubectl rollout status "deployment/$DEPLOY" --timeout=90s >/dev/null
NEW="$(kubectl get deployment "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].image}' | sed 's/.*://')"
echo "rolled back $CUR -> $NEW (kubectl rollout undo)"
