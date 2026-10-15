#!/usr/bin/env bash
# Usage: scripts/deploy.sh <git-tag>   (docker target: swap the compose service to <APP_NAME>:<tag>)
set -euo pipefail
TAG="${1:?usage: deploy.sh <git-tag>}"
ROOT="${RG_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
APP_NAME="${APP_NAME:-app}"; COMPOSE="${COMPOSE_FILE_RG:-docker-compose.yml}"; SERVICE="${COMPOSE_SERVICE:-app}"
STATE="$ROOT/infra/state"; mkdir -p "$STATE"
"$ROOT/scripts/build.sh" "$TAG" >/dev/null
if [ -f "$STATE/current" ]; then cp "$STATE/current" "$STATE/previous"; fi
echo "$TAG" > "$STATE/current"
APP_IMAGE="$APP_NAME" TAG="$TAG" docker compose -f "$ROOT/$COMPOSE" up -d --remove-orphans "$SERVICE" >/dev/null 2>&1
echo "deployed $APP_NAME:$TAG  (previous: $(cat "$STATE/previous" 2>/dev/null || echo none))"
