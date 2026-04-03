#!/bin/zsh
set -euo pipefail

PID_FILE="/tmp/codex-lsp-mcp.pid"
PORT="${MCP_PORT:-3245}"
HOST="${MCP_HOST:-127.0.0.1}"

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "running pid=$(cat "$PID_FILE") url=http://$HOST:$PORT/mcp"
else
  echo "not running"
fi
