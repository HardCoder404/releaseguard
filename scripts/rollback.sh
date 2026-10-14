#!/usr/bin/env bash
# Usage: scripts/rollback.sh   -> re-deploys the previous tag
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$ROOT/infra/state"
PREV="$(cat "$STATE/previous" 2>/dev/null || true)"
[ -n "$PREV" ] || { echo "nothing to roll back to"; exit 1; }
CUR="$(cat "$STATE/current")"
TAG="$PREV" docker compose -f "$ROOT/infra/docker-compose.yml" up -d --remove-orphans >/dev/null 2>&1
echo "$CUR" > "$STATE/previous"
echo "$PREV" > "$STATE/current"
echo "rolled back $CUR -> $PREV"
