# codex-gopls-mcp

`codex-gopls-mcp` is a small MCP server for Codex that exposes `gopls`-backed code navigation tools for Go repositories.

The current implementation also keeps optional Solidity support, but the primary target is Go plus `gopls`.

## Tools

- `lsp_hover`
- `lsp_definition`
- `lsp_references`
- `lsp_document_symbols`
- `lsp_workspace_symbols`
- `lsp_diagnostics`

## Assumptions

- This repository is currently tested on macOS.
- The helper scripts use `zsh`.
- `go` is already installed on the machine.
- `gopls` is already installed on the machine.
- `node` is already installed on the machine.
- The Go path resolution is friendliest to GVM-based setups because it can reuse versioned `GOROOT`, `GOPATH`, and `pkg/mod` directories when they exist.
- If you are not using GVM, the server falls back to `PATH`, `GOROOT`, `GOPATH`, and other environment variables that are already present.

This repository does not try to install Go, `gopls`, Node.js, or Codex for you.

## Go Behavior

- Go requests run through `gopls` CLI commands inside the MCP server.
- For each Go repository, the server detects the nearest repo root and reads `go.work`, `go.mod`, `.go-version`, or `.tool-versions` to infer the target Go version.
- If a matching GVM toolchain exists, the server prefers that `GOROOT` and `GOPATH`.
- Writable build and cache state is isolated under `/tmp`.
- The module cache defaults to the matching GVM pkgset `pkg/mod` when available, so cross-file lookups can reuse dependencies that are already on the machine.
- If the exact Go version is not installed locally, the server falls back to the configured `gopls` binary and the available Go environment.

## Solidity

- Solidity support is optional.
- If you want it, install `nomicfoundation-solidity-language-server` on `PATH` or pass `SOLIDITY_LS_BIN`.
- The repository name is Go-oriented because the main value here is the `gopls` integration path.

## Quick Start

Register the MCP server in `stdio` mode:

```sh
codex mcp add lsp \
  -- node /absolute/path/to/codex-gopls-mcp/server.js
```

Run the server in HTTP daemon mode:

- Entry point: `node ./server.js --http`
- Start: `./start-daemon.sh`
- Stop: `./stop-daemon.sh`
- Status: `./status-daemon.sh`
- Config snippet: `./lsp-daemon-config.toml`

Daemon mode `config.toml` snippet:

```toml
[mcp_servers.lsp]
url = "http://127.0.0.1:3245/mcp"
```

## Notes

- The helper scripts resolve their own directory, so the repository can be cloned anywhere.
- `activate-global-lsp.sh` assumes the companion `use-lsp-when-coding` skill exists under `$HOME/.codex/memories/use-lsp-when-coding/SKILL.md`, unless `SKILL_SOURCE` is set explicitly.
- The defaults in this repository reflect one macOS workstation setup. If your machine is different, prefer overriding environment variables instead of editing the server.
