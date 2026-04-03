#!/bin/zsh
set -euo pipefail

PID_FILE="/tmp/codex-lsp-mcp.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "not running"
  exit 0
fi

PID="$(cat "$PID_FILE")"
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  echo "stopped pid=$PID"
else
  echo "stale pid file removed"
fi

rm -f "$PID_FILE"
