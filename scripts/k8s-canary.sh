#!/usr/bin/env bash
# Usage: scripts/k8s-canary.sh start <tag> | promote <tag> | abort
# The canary is a COPY of the stable Deployment: 1 replica, track=canary, new image. No extra manifest to write.
set -euo pipefail
ROOT="${RG_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
APP_NAME="${APP_NAME:-app}"; DEPLOY="${DEPLOYMENT:-$APP_NAME}"; NS="${NAMESPACE:-default}"; CONTAINER="${CONTAINER:-app}"
CANARY="$DEPLOY-canary"
case "${1:?start|promote|abort}" in
  start)
    TAG="${2:?tag}"
    "$ROOT/scripts/build.sh" "$TAG" >/dev/null
    "$ROOT/scripts/k8s-load-image.sh" "$APP_NAME:$TAG"
    kubectl -n "$NS" get deployment "$DEPLOY" -o json \
      | node "$ROOT/scripts/canary-manifest.mjs" "$CANARY" "$CONTAINER" "$APP_NAME:$TAG" \
      | kubectl -n "$NS" apply -f - >/dev/null
    kubectl -n "$NS" rollout status "deployment/$CANARY" --timeout=90s >/dev/null
    echo "canary $APP_NAME:$TAG up (1 pod next to $(kubectl -n "$NS" get deployment "$DEPLOY" -o jsonpath='{.status.readyReplicas}') stable pods)"
    ;;
  promote)
    TAG="${2:?tag}"
    PREV="$(kubectl -n "$NS" get deployment "$DEPLOY" -o jsonpath="{.spec.template.spec.containers[?(@.name==\"$CONTAINER\")].image}" | sed 's/.*://')"
    kubectl -n "$NS" set image "deployment/$DEPLOY" "$CONTAINER=$APP_NAME:$TAG" >/dev/null
    kubectl -n "$NS" annotate "deployment/$DEPLOY" kubernetes.io/change-cause="releaseguard promote $TAG" --overwrite >/dev/null
    kubectl -n "$NS" rollout status "deployment/$DEPLOY" --timeout=90s >/dev/null
    kubectl -n "$NS" delete deployment "$CANARY" --ignore-not-found >/dev/null
    echo "promoted $APP_NAME:$TAG to all stable pods (previous: $PREV), canary removed"
    ;;
  abort)
    kubectl -n "$NS" delete deployment "$CANARY" --ignore-not-found >/dev/null
    echo "canary removed, stable pods untouched"
    ;;
esac
