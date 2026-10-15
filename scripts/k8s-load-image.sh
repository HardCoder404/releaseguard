#!/usr/bin/env bash
# Usage: scripts/k8s-load-image.sh <image:tag>
# Local clusters cannot pull from your laptop's Docker. Load the image into whichever one is running.
# Real clusters: push to a registry instead and set imagePullPolicy accordingly (then make this a no-op: RG_SKIP_IMAGE_LOAD=1).
set -euo pipefail
IMG="${1:?image:tag}"
[ -n "${RG_SKIP_IMAGE_LOAD:-}" ] && exit 0
CTX="$(kubectl config current-context 2>/dev/null || true)"
case "$CTX" in
  minikube*) minikube image load "$IMG" 2>/dev/null ;;
  kind*)     kind load docker-image "$IMG" --name "${CTX#kind-}" >/dev/null 2>&1 ;;
  docker-desktop|k3d*) ;;   # docker-desktop shares the daemon; k3d: `k3d image import` if needed
  *) echo "note: not a known local cluster ($CTX); assuming the image is pullable" ;;
esac
