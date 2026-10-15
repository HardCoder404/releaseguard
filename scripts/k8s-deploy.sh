#!/usr/bin/env bash
# Usage: scripts/k8s-deploy.sh <git-tag>   (k8s target)
# build -> load into minikube -> kubectl set image -> wait for rollout
set -euo pipefail
TAG="${1:?usage: k8s-deploy.sh <git-tag>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY="${DEPLOYMENT:-shop-api}"
"$ROOT/scripts/build.sh" "$TAG" >/dev/null
minikube image load "shop-api:$TAG" 2>/dev/null
PREV="$(kubectl get deployment "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null | sed 's/.*://' || echo none)"
kubectl set image "deployment/$DEPLOY" "app=shop-api:$TAG" >/dev/null
kubectl annotate "deployment/$DEPLOY" kubernetes.io/change-cause="releaseguard deploy $TAG" --overwrite >/dev/null
kubectl rollout status "deployment/$DEPLOY" --timeout=90s >/dev/null
echo "rolled out shop-api:$TAG on k8s  (previous: $PREV)"
