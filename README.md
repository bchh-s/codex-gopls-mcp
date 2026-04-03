# codex-gopls-mcp

MCP server for Codex with `gopls`-backed Go code navigation.

This repository started from a macOS workstation setup where Go, `gopls`, Node.js, and optionally GVM are already installed. The Go path is the primary target. Solidity support is still present, but it is secondary.

## What It Exposes

- `lsp_hover`
- `lsp_definition`
- `lsp_references`
- `lsp_document_symbols`
- `lsp_workspace_symbols`
- `lsp_diagnostics`

## Assumptions

- OS: macOS
- Shell: `zsh`
- Codex is already installed and usable
- `node` is already installed
- `go` is already installed
- `gopls` is already installed
- GVM is optional, but this repo is friendliest to GVM-based Go setups

This repository does not provision the runtime for you. It expects the machine to already have the required tooling.

## Support Status

Current support should be read conservatively:

- macOS: primary development target
- Linux: core server path validated in CI
- Windows native: core server path validated in CI, but helper scripts are still Unix-oriented
- WSL: more realistic than native Windows today because the helper scripts are Unix-oriented

Important limitation:

- Docker on macOS or Linux is not a real substitute for native Windows validation. For Windows-specific behavior, use a real Windows VM or a Windows CI runner.

CI policy:

- smoke CI tracks the latest stable Go release
- smoke CI installs `gopls@latest`
- a scheduled workflow reruns the same matrix so upstream Go or `gopls` changes are noticed early
- older Go versions are not a compatibility target for this repository unless documented otherwise

## Install Prerequisites

### 1. Install Go

Official docs:

- https://go.dev/doc/install
- https://go.dev/dl/

On macOS, the simplest path is usually the official installer package from the Go downloads page. After installation, confirm:

```sh
go version
which go
```

### 2. Install `gopls`

Official docs:

- https://pkg.go.dev/golang.org/x/tools/gopls
- https://go.dev/gopls/

Install with:

```sh
go install golang.org/x/tools/gopls@latest
```

Then confirm:

```sh
gopls version
which gopls
```

### 3. Install Node.js

Official docs:

- https://nodejs.org/en/download

Install Node.js with the official macOS installer or your preferred Node version manager. Then confirm:

```sh
node -v
which node
```

### 4. Install GVM (Optional)

Official project:

- https://github.com/moovweb/gvm

If you want version-aware Go switching through GVM, read the upstream requirements first. The project README documents extra macOS prerequisites such as Xcode Command Line Tools and Mercurial.

Typical macOS prep from the upstream README:

```sh
xcode-select --install
brew update
brew install mercurial
```

Install GVM:

```sh
zsh < <(curl -s -S -L https://raw.githubusercontent.com/moovweb/gvm/master/binscripts/gvm-installer)
```

Then reload your shell and confirm:

```sh
gvm version
```

If you want GVM to manage a newer Go version, follow the version bootstrap notes in the upstream README. Those steps change over time and are better taken directly from the source:

- https://github.com/moovweb/gvm#installing

## How Go Resolution Works

For Go repositories, the server tries to match the repository's toolchain instead of forcing one global version.

It looks for version hints in the nearest repo root, in this order:

1. `go.work`
2. `go.mod`
3. `.go-version`
4. `.tool-versions`

If a matching GVM toolchain exists, it prefers that `GOROOT` and `GOPATH`. If not, it falls back to the Go environment already available on the machine.

Writable build state is isolated under `/tmp`, while the module cache prefers the matching GVM `pkg/mod` when available so `gopls` can reuse dependencies that are already present.

## Quick Start

Register the MCP server in `stdio` mode:

```sh
codex mcp add lsp \
  -- node /absolute/path/to/codex-gopls-mcp/server.js
```

## Daemon Mode

HTTP entry point:

```sh
node ./server.js --http
```

Helper scripts:

- start: `./start-daemon.sh`
- stop: `./stop-daemon.sh`
- status: `./status-daemon.sh`
- config snippet: `./lsp-daemon-config.toml`

Example Codex config:

```toml
[mcp_servers.lsp]
url = "http://127.0.0.1:3245/mcp"
```

## Optional Solidity Support

Solidity support is optional.

If you want it, install `nomicfoundation-solidity-language-server` on `PATH` or pass `SOLIDITY_LS_BIN`.

## Notes

- The helper scripts resolve their own directory, so the repository can be cloned anywhere.
- `activate-global-lsp.sh` installs the bundled skill from `./skills/use-lsp-when-coding/SKILL.md` by default. You can override that with `SKILL_SOURCE`.
- The defaults in this repository reflect one macOS workstation setup. If your machine differs, prefer overriding environment variables instead of patching the server.
- If a required Go version is not installed locally, results depend on the fallback environment that `gopls` can reach on that machine.
- This repository follows current `gopls` releases rather than pinning an older long-lived `gopls` build for CI.

## Contributing

If you want to send patches, read [CONTRIBUTING.md](./CONTRIBUTING.md) first.

In particular:

- open an issue first for platform support work, non-trivial behavior changes, or compatibility claims
- include exact OS, shell, Go, `gopls`, and Node.js versions in bug reports
- treat Windows support as tracked work until it is validated in CI and on a real Windows environment

## Bundled Skill

This repository includes a Codex skill for Go and Solidity code navigation:

- `./skills/use-lsp-when-coding/SKILL.md`

If you run `./activate-global-lsp.sh`, that skill is copied into:

```sh
$HOME/.codex/skills/use-lsp-when-coding/SKILL.md
```

## Sources

- Go install docs: https://go.dev/doc/install
- Go downloads: https://go.dev/dl/
- `gopls` docs: https://pkg.go.dev/golang.org/x/tools/gopls
- `gopls` site: https://go.dev/gopls/
- Node.js downloads: https://nodejs.org/en/download
- GVM upstream README: https://github.com/moovweb/gvm
- GitHub Actions docs: https://docs.github.com/github/automating-your-workflow-with-github-actions
- Docker docs: https://docs.docker.com/
