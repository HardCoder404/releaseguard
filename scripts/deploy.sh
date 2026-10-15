#!/usr/bin/env bash
# Usage: scripts/deploy.sh <git-tag>   (docker target)
set -euo pipefail
TAG="${1:?usage: deploy.sh <git-tag>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$ROOT/infra/state"
mkdir -p "$STATE"
"$ROOT/scripts/build.sh" "$TAG" >/dev/null
if [ -f "$STATE/current" ]; then cp "$STATE/current" "$STATE/previous"; fi
echo "$TAG" > "$STATE/current"
TAG="$TAG" docker compose -f "$ROOT/infra/docker-compose.yml" up -d --remove-orphans >/dev/null 2>&1
echo "deployed shop-api:$TAG  (previous: $(cat "$STATE/previous" 2>/dev/null || echo none))"
