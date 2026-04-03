import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function encodeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8"), body]);
}

class RpcClient {
  constructor(command, args, options) {
    this.proc = spawn(command, args, options);
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.nextId = 1;

    this.proc.stdout.on("data", (chunk) => this.onData(chunk));
    this.proc.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
    });
    this.proc.on("exit", (code) => {
      if (code !== 0) {
        for (const pending of this.pending.values()) {
          pending.reject(new Error(`server exited with code ${code}`));
        }
        this.pending.clear();
      }
    });
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return;
      }
      const headerText = this.buffer.slice(0, headerEnd).toString("utf8");
      const lengthMatch = headerText.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        throw new Error("missing Content-Length");
      }
      const contentLength = Number(lengthMatch[1]);
      const totalLength = headerEnd + 4 + contentLength;
      if (this.buffer.length < totalLength) {
        return;
      }
      const body = this.buffer.slice(headerEnd + 4, totalLength).toString("utf8");
      this.buffer = this.buffer.slice(totalLength);
      const message = JSON.parse(body);
      if (message.id != null) {
        const pending = this.pending.get(message.id);
        if (!pending) {
          continue;
        }
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message || "request failed"));
        } else {
          pending.resolve(message.result);
        }
      }
    }
  }

  request(method, params = {}) {
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    this.proc.stdin.write(encodeMessage(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  notify(method, params = {}) {
    this.proc.stdin.write(encodeMessage({ jsonrpc: "2.0", method, params }));
  }

  async close() {
    this.proc.kill();
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const fixtureFile = path.join(repoRoot, "testdata", "go-basic", "main.go");
  const client = new RpcClient("node", ["server.js"], {
    cwd: repoRoot,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  try {
    const initResult = await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "ci-smoke", version: "0.1.0" },
    });
    assert(initResult?.serverInfo?.name === "codex-gopls-mcp", "unexpected server name");
    client.notify("notifications/initialized", {});

    const tools = await client.request("tools/list", {});
    const toolNames = new Set((tools.tools || []).map((tool) => tool.name));
    assert(toolNames.has("lsp_document_symbols"), "missing lsp_document_symbols");
    assert(toolNames.has("lsp_workspace_symbols"), "missing lsp_workspace_symbols");

    const symbolsResult = await client.request("tools/call", {
      name: "lsp_document_symbols",
      arguments: { filePath: fixtureFile },
    });
    const symbols = JSON.parse(symbolsResult.content[0].text);
    assert(symbols.some((item) => item.name === "main"), "missing main symbol");
    assert(symbols.some((item) => item.name === "helper"), "missing helper symbol");

    const workspaceResult = await client.request("tools/call", {
      name: "lsp_workspace_symbols",
      arguments: { filePath: fixtureFile, query: "main" },
    });
    const workspaceSymbols = JSON.parse(workspaceResult.content[0].text);
    assert(workspaceSymbols.some((item) => item.name === "main"), "missing workspace main symbol");

    const diagnosticsResult = await client.request("tools/call", {
      name: "lsp_diagnostics",
      arguments: { filePath: fixtureFile },
    });
    const diagnostics = JSON.parse(diagnosticsResult.content[0].text);
    assert(Array.isArray(diagnostics), "diagnostics payload must be an array");

    process.stdout.write("smoke test passed\n");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
