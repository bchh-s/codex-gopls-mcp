# Contributing

Thanks for contributing.

This repository is small, but it touches local toolchains, shell behavior, and MCP integration. Compatibility claims should be made carefully.

## Ground Rules

- For non-trivial changes, open an issue before opening a PR.
- For platform support work, always open an issue first.
- Do not describe a platform as supported unless it has been validated in a real environment or in CI that meaningfully exercises that platform.
- Keep changes small and scoped. Prefer follow-up issues over broad refactors.

## When To Open An Issue First

Open an issue before coding if the change involves:

- Windows support
- Linux support differences
- shell or path behavior
- toolchain detection changes
- changes to MCP behavior or exposed tools
- breaking changes in setup or usage

## Environment Details To Include

For bugs and compatibility reports, include:

- OS and version
- shell
- Codex version if relevant
- Node.js version
- Go version
- `gopls` version
- whether GVM is in use
- whether the environment is native Windows, WSL, macOS, or Linux

## Pull Requests

PRs should:

- link the issue they address
- describe the exact environment used for validation
- update docs if setup, support status, or behavior changed
- avoid claiming support broader than what was actually tested

## Testing Expectations

At minimum, keep the cross-platform smoke workflow green.

For Windows-related work:

- CI on a Windows runner is expected
- a note about native Windows vs WSL is expected
- if behavior is only validated in WSL, say that explicitly

## Support Language

Use these labels carefully in docs and PRs:

- "supported" means tested and intentionally maintained
- "expected to work" means plausible, but not fully validated
- "experimental" means not yet stable enough for a support claim
