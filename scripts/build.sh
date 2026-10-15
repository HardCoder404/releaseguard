#!/usr/bin/env bash
# Usage: scripts/build.sh <git-tag>
# Builds <APP_NAME>:<tag> from exactly that git tag's <APP_PATH> (never from the working tree).
set -euo pipefail
TAG="${1:?usage: build.sh <git-tag>}"
ROOT="${RG_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
APP_NAME="${APP_NAME:-app}"; APP_PATH="${APP_PATH:-.}"; APP_DOCKERFILE="${APP_DOCKERFILE:-$APP_PATH/Dockerfile}"
git -C "$ROOT" rev-parse -q --verify "refs/tags/$TAG" >/dev/null || { echo "tag $TAG not found"; exit 1; }
if docker image inspect "$APP_NAME:$TAG" >/dev/null 2>&1; then echo "image $APP_NAME:$TAG exists"; exit 0; fi
BUILD_DIR="$(mktemp -d)"
if [ "$APP_PATH" = "." ]; then git -C "$ROOT" archive "$TAG" | tar -x -C "$BUILD_DIR"; CTX="$BUILD_DIR"
else git -C "$ROOT" archive "$TAG" "$APP_PATH" | tar -x -C "$BUILD_DIR"; CTX="$BUILD_DIR/$APP_PATH"; fi
docker build -q --build-arg APP_VERSION="$TAG" -f "$BUILD_DIR/$APP_DOCKERFILE" -t "$APP_NAME:$TAG" "$CTX" >/dev/null
rm -rf "$BUILD_DIR"
echo "built $APP_NAME:$TAG"
