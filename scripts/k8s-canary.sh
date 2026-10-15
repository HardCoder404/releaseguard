#!/usr/bin/env bash
# Usage: scripts/k8s-canary.sh start <tag> | promote <tag> | abort
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY="${DEPLOYMENT:-shop-api}"
CANARY="$DEPLOY-canary"
case "${1:?start|promote|abort}" in
  start)
    TAG="${2:?tag}"
    "$ROOT/scripts/build.sh" "$TAG" >/dev/null
    minikube image load "shop-api:$TAG" 2>/dev/null
    sed "s/IMAGE_TAG/$TAG/" "$ROOT/k8s/canary.yml" | kubectl apply -f - >/dev/null
    kubectl rollout status "deployment/$CANARY" --timeout=90s >/dev/null
    echo "canary shop-api:$TAG up (1 pod next to $(kubectl get deployment "$DEPLOY" -o jsonpath='{.status.readyReplicas}') stable pods)"
    ;;
  promote)
    TAG="${2:?tag}"
    PREV="$(kubectl get deployment "$DEPLOY" -o jsonpath='{.spec.template.spec.containers[0].image}' | sed 's/.*://')"
    kubectl set image "deployment/$DEPLOY" "app=shop-api:$TAG" >/dev/null
    kubectl annotate "deployment/$DEPLOY" kubernetes.io/change-cause="releaseguard promote $TAG" --overwrite >/dev/null
    kubectl rollout status "deployment/$DEPLOY" --timeout=90s >/dev/null
    kubectl delete deployment "$CANARY" --ignore-not-found >/dev/null
    echo "promoted shop-api:$TAG to all stable pods (previous: $PREV), canary removed"
    ;;
  abort)
    kubectl delete deployment "$CANARY" --ignore-not-found >/dev/null
    echo "canary removed, stable pods untouched"
    ;;
esac
