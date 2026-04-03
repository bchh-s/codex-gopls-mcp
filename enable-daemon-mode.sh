#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="$HOME/.codex/config.toml"
SNIPPET_FILE="$ROOT_DIR/lsp-daemon-config.toml"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "missing $CONFIG_FILE" >&2
  exit 1
fi

if grep -q '^url = "http://127.0.0.1:3245/mcp"$' "$CONFIG_FILE"; then
  echo "daemon mode already configured"
  exit 0
fi

cat <<EOF
Replace the existing [mcp_servers.lsp] block in:
  $CONFIG_FILE

with:
$(cat "$SNIPPET_FILE")

If your current config also has [mcp_servers.lsp.env], remove that block too.
EOF
