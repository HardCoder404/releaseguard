#!/usr/bin/env bash
# Usage: scripts/build.sh <git-tag>   -> builds docker image shop-api:<tag> from exactly that tag
set -euo pipefail
TAG="${1:?usage: build.sh <git-tag>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
git -C "$ROOT" rev-parse -q --verify "refs/tags/$TAG" >/dev/null || { echo "tag $TAG not found"; exit 1; }
if docker image inspect "shop-api:$TAG" >/dev/null 2>&1; then echo "image shop-api:$TAG exists"; exit 0; fi
BUILD_DIR="$(mktemp -d)"
git -C "$ROOT" archive "$TAG" shop-api | tar -x -C "$BUILD_DIR"
docker build -q --build-arg APP_VERSION="$TAG" -t "shop-api:$TAG" "$BUILD_DIR/shop-api" >/dev/null
rm -rf "$BUILD_DIR"
echo "built shop-api:$TAG"
