#!/usr/bin/env bash
# shortcut: ./rg deploy v1.1.0 --traffic
cd "$(dirname "$0")/releaseguard" && exec node --no-warnings=ExperimentalWarning --import tsx src/cli.ts "$@"
