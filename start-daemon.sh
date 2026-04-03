#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="/tmp/codex-gopls-mcp.pid"
LOG_FILE="/tmp/codex-gopls-mcp.log"
PORT="${MCP_PORT:-3245}"
HOST="${MCP_HOST:-127.0.0.1}"

resolve_node_bin() {
  if [[ -n "${NODE_BIN:-}" ]] && [[ -x "${NODE_BIN}" ]]; then
    echo "${NODE_BIN}"
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  local candidate
  for candidate in \
    "$HOME/.nvm/versions/node"/*/bin/node \
    /opt/homebrew/bin/node \
    /usr/local/bin/node
  do
    if [[ -x "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "already running pid=$(cat "$PID_FILE") url=http://$HOST:$PORT/mcp"
  exit 0
fi

NODE_BIN="$(resolve_node_bin)" || {
  echo "failed to locate node binary; set NODE_BIN or install node in a standard path" >>"$LOG_FILE"
  echo "failed to start; see $LOG_FILE" >&2
  exit 1
}

nohup "$NODE_BIN" "$ROOT_DIR/server.js" --http >>"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"
sleep 1

if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "started pid=$(cat "$PID_FILE") url=http://$HOST:$PORT/mcp"
else
  echo "failed to start; see $LOG_FILE" >&2
  exit 1
fi
