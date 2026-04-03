#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
CODEX_HOME="$HOME/.codex"
CONFIG_FILE="$CODEX_HOME/config.toml"
SKILL_SOURCE="${SKILL_SOURCE:-$ROOT_DIR/skills/use-lsp-when-coding/SKILL.md}"
SKILL_TARGET_DIR="$CODEX_HOME/skills/use-lsp-when-coding"
TMP_CONFIG="$(mktemp)"

if [[ ! -f "$SKILL_SOURCE" ]]; then
  echo "missing skill source: $SKILL_SOURCE" >&2
  exit 1
fi

mkdir -p "$SKILL_TARGET_DIR"
cp "$SKILL_SOURCE" "$SKILL_TARGET_DIR/SKILL.md"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "missing $CONFIG_FILE" >&2
  exit 1
fi

cp "$CONFIG_FILE" "$CONFIG_FILE.bak.$(date +%Y%m%d%H%M%S)"

awk '
  BEGIN { skip = 0 }
  /^\[mcp_servers\.lsp\]$/ { skip = 1; next }
  /^\[mcp_servers\.lsp\.env\]$/ { skip = 1; next }
  /^\[/ {
    if (skip) {
      skip = 0
    }
  }
  !skip { print }
' "$CONFIG_FILE" > "$TMP_CONFIG"

cat <<'EOF' >> "$TMP_CONFIG"

[mcp_servers.lsp]
url = "http://127.0.0.1:3245/mcp"
EOF

mv "$TMP_CONFIG" "$CONFIG_FILE"

"$ROOT_DIR/start-daemon.sh"

echo "global skill installed: $SKILL_TARGET_DIR/SKILL.md"
echo "global lsp config switched to daemon mode in $CONFIG_FILE"
echo "restart codex to pick up the new global config and skill"
