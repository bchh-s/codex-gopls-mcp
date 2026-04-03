---
name: use-lsp-when-coding
description: Use the `lsp` MCP tools during coding work in Go or Solidity repositories when symbol-aware navigation, references, definitions, diagnostics, or file structure inspection would be more reliable than plain text search. Trigger for debugging, refactoring, code comprehension, cross-file edits, or when the user asks where something is defined or used.
---

# Use LSP When Coding

Prefer the `lsp` MCP tools over shell text search when the task is about code structure rather than raw text.

## Use This Skill For

- Finding where a symbol is defined: `lsp_definition`
- Finding usages of a symbol: `lsp_references`
- Getting a file outline before editing: `lsp_document_symbols`
- Searching symbols across a workspace: `lsp_workspace_symbols`
- Checking language-server diagnostics after edits: `lsp_diagnostics`
- Reading type or signature information at a cursor position: `lsp_hover`

## Workflow

1. If the task involves Go or Solidity code navigation, start with the `lsp` MCP tools before using shell search.
2. Before cross-file edits or renames, use `lsp_definition` and `lsp_references` to confirm the impact set.
3. Before editing an unfamiliar file, use `lsp_document_symbols` to understand its structure.
4. After edits in supported files, use `lsp_diagnostics` on touched files when that can catch compile-time issues quickly.
5. Fall back to shell search only when the question is broad text search, config discovery, or non-Go/Solidity files.

## Practical Rules

- Do not force LSP for trivial one-line edits where the target is already obvious.
- Do not claim LSP results unless you actually called the tool.
- If `lsp` is unavailable or returns incomplete results, say so and continue with shell-based inspection.
- Keep tool usage tight: use the smallest LSP call that answers the question.

## Tool Mapping

- "Where is this defined?" -> `lsp_definition`
- "Where is this used?" -> `lsp_references`
- "What is in this file?" -> `lsp_document_symbols`
- "Find this symbol in the project" -> `lsp_workspace_symbols`
- "Any language errors here?" -> `lsp_diagnostics`
- "What type/signature is this?" -> `lsp_hover`
