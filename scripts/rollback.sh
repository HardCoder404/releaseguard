#!/usr/bin/env bash
# Usage: scripts/rollback.sh   -> re-deploys the previous tag (docker target)
set -euo pipefail
ROOT="${RG_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
APP_NAME="${APP_NAME:-app}"; COMPOSE="${COMPOSE_FILE_RG:-docker-compose.yml}"; SERVICE="${COMPOSE_SERVICE:-app}"
STATE="$ROOT/infra/state"
PREV="$(cat "$STATE/previous" 2>/dev/null || true)"
[ -n "$PREV" ] || { echo "nothing to roll back to"; exit 1; }
CUR="$(cat "$STATE/current")"
APP_IMAGE="$APP_NAME" TAG="$PREV" docker compose -f "$ROOT/$COMPOSE" up -d --remove-orphans "$SERVICE" >/dev/null 2>&1
echo "$CUR" > "$STATE/previous"; echo "$PREV" > "$STATE/current"
echo "rolled back $CUR -> $PREV"
