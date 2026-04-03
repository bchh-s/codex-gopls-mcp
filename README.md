`codex-lsp-mcp` exposes local Go and Solidity language tooling to Codex through MCP.

Tools exposed:

- `lsp_hover`
- `lsp_definition`
- `lsp_references`
- `lsp_document_symbols`
- `lsp_workspace_symbols`
- `lsp_diagnostics`

Current behavior on this machine:

- Solidity works with `nomicfoundation-solidity-language-server --stdio`.
- Go uses `gopls` through a CLI fallback path inside the MCP server.
- For Go repositories, the server detects the nearest repo root and reads `go.work`, `go.mod`, `.go-version`, or `.tool-versions` to pick the matching Go toolchain when available.
- Writable build/cache state is isolated under `/tmp`, while the module cache defaults to the matching GVM pkgset so cross-file results can reuse the repo's existing dependencies.
- If a repo needs a Go version that is not installed locally, the server falls back to the configured `gopls` binary and available Go environment.

Daemon mode files:

- HTTP daemon entrypoint: `node ./server.js --http`
- Start: `./start-daemon.sh`
- Stop: `./stop-daemon.sh`
- Status: `./status-daemon.sh`
- Config snippet: `./lsp-daemon-config.toml`

`stdio` registration command:

```sh
codex mcp add lsp \
  -- node /absolute/path/to/codex-lsp-mcp/server.js
```

Daemon mode `config.toml` snippet:

```toml
[mcp_servers.lsp]
url = "http://127.0.0.1:3245/mcp"
```

Notes:

- The helper scripts resolve their own directory, so they can be cloned anywhere.
- If you want Solidity support, install `nomicfoundation-solidity-language-server` somewhere on `PATH`, or pass `SOLIDITY_LS_BIN`.
- `activate-global-lsp.sh` assumes the companion `use-lsp-when-coding` skill exists under `$HOME/.codex/memories/use-lsp-when-coding/SKILL.md`, unless `SKILL_SOURCE` is set explicitly.
