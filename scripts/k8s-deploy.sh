#!/usr/bin/env bash
# Usage: scripts/k8s-deploy.sh <git-tag>   build -> load into the cluster -> kubectl set image -> wait for rollout
set -euo pipefail
TAG="${1:?usage: k8s-deploy.sh <git-tag>}"
ROOT="${RG_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
APP_NAME="${APP_NAME:-app}"; DEPLOY="${DEPLOYMENT:-$APP_NAME}"; NS="${NAMESPACE:-default}"; CONTAINER="${CONTAINER:-app}"
"$ROOT/scripts/build.sh" "$TAG" >/dev/null
"$ROOT/scripts/k8s-load-image.sh" "$APP_NAME:$TAG"
PREV="$(kubectl -n "$NS" get deployment "$DEPLOY" -o jsonpath="{.spec.template.spec.containers[?(@.name==\"$CONTAINER\")].image}" 2>/dev/null | sed 's/.*://' || echo none)"
kubectl -n "$NS" set image "deployment/$DEPLOY" "$CONTAINER=$APP_NAME:$TAG" >/dev/null
kubectl -n "$NS" annotate "deployment/$DEPLOY" kubernetes.io/change-cause="releaseguard deploy $TAG" --overwrite >/dev/null
kubectl -n "$NS" rollout status "deployment/$DEPLOY" --timeout=90s >/dev/null
echo "rolled out $APP_NAME:$TAG on k8s  (previous: ${PREV:-none})"
