#!/usr/bin/env bash
# Usage: scripts/deploy.sh <git-tag>
# Builds shop-api from exactly that git tag, records previous tag, starts it.
set -euo pipefail
TAG="${1:?usage: deploy.sh <git-tag>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$ROOT/infra/state"
mkdir -p "$STATE"

git -C "$ROOT" rev-parse -q --verify "refs/tags/$TAG" >/dev/null || { echo "tag $TAG not found"; exit 1; }

# 1. build image from the tagged source (not from working tree)
BUILD_DIR="$(mktemp -d)"
git -C "$ROOT" archive "$TAG" shop-api | tar -x -C "$BUILD_DIR"
docker build -q --build-arg APP_VERSION="$TAG" -t "shop-api:$TAG" "$BUILD_DIR/shop-api" >/dev/null
rm -rf "$BUILD_DIR"

# 2. remember what was running, so rollback knows where to go
if [ -f "$STATE/current" ]; then cp "$STATE/current" "$STATE/previous"; fi
echo "$TAG" > "$STATE/current"

# 3. swap the running container
TAG="$TAG" docker compose -f "$ROOT/infra/docker-compose.yml" up -d --remove-orphans >/dev/null 2>&1
echo "deployed shop-api:$TAG  (previous: $(cat "$STATE/previous" 2>/dev/null || echo none))"
