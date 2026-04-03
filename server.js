#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn, execFile } = require("child_process");
const { promisify } = require("util");

const MCP_FALLBACK_PROTOCOL_VERSION = "2024-11-05";
const JSON_RPC_VERSION = "2.0";

const clients = new Map();
let mcpInitialized = false;
let nextMcpRequestId = 1;
const execFileAsync = promisify(execFile);

function normalizePath(filePath) {
  return path.resolve(filePath);
}

function filePathToUri(filePath) {
  const resolved = normalizePath(filePath);
  const normalized = resolved.split(path.sep).join("/");
  return `file://${encodeURI(normalized)}`;
}

function uriToFilePath(uri) {
  if (!uri.startsWith("file://")) {
    throw new Error(`Unsupported URI: ${uri}`);
  }
  return decodeURI(uri.slice("file://".length));
}

function statExists(targetPath) {
  try {
    fs.accessSync(targetPath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function findExecutable(command, fallbackPaths = []) {
  if (path.isAbsolute(command) && statExists(command)) {
    return command;
  }

  const pathEntries = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = path.join(entry, command);
    if (statExists(candidate)) {
      return candidate;
    }
  }

  for (const fallbackPath of fallbackPaths) {
    if (fallbackPath && statExists(fallbackPath)) {
      return fallbackPath;
    }
  }

  return command;
}

function readTextIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function findNearestAncestor(startPath, markers) {
  let current = fs.statSync(startPath).isDirectory() ? startPath : path.dirname(startPath);
  while (true) {
    for (const marker of markers) {
      if (statExists(path.join(current, marker))) {
        return current;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function prependPath(entry, currentPath) {
  if (!entry) {
    return currentPath || "";
  }
  const parts = (currentPath || "").split(path.delimiter).filter(Boolean);
  if (parts.includes(entry)) {
    return currentPath || entry;
  }
  return [entry, ...parts].join(path.delimiter);
}

function detectLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".go") {
    return "go";
  }
  if (ext === ".sol") {
    return "solidity";
  }
  throw new Error(`Unsupported language for ${filePath}`);
}

function findRootForLanguage(filePath, language) {
  const languageMarkers = {
    go: ["go.work", "go.mod", ".git"],
    solidity: [
      "foundry.toml",
      "hardhat.config.ts",
      "hardhat.config.js",
      "package.json",
      ".git",
    ],
  };

  const root = findNearestAncestor(filePath, languageMarkers[language] || [".git"]);
  return root || path.dirname(filePath);
}

function normalizeGoVersion(rawVersion) {
  if (!rawVersion) {
    return "";
  }

  let version = String(rawVersion).trim();
  if (!version) {
    return "";
  }

  version = version.replace(/^go/, "").replace(/^v/, "");
  return version;
}

function parseGoVersionFromText(text) {
  if (!text) {
    return "";
  }

  const toolchainMatch = text.match(/^\s*toolchain\s+go([0-9]+(?:\.[0-9]+){1,2})\s*$/m);
  if (toolchainMatch) {
    return normalizeGoVersion(toolchainMatch[1]);
  }

  const goMatch = text.match(/^\s*go\s+([0-9]+(?:\.[0-9]+){1,2})\s*$/m);
  if (goMatch) {
    return normalizeGoVersion(goMatch[1]);
  }

  return "";
}

function parseGoVersionFromToolVersions(text) {
  if (!text) {
    return "";
  }

  const match = text.match(/^\s*golang\s+([0-9]+(?:\.[0-9]+){1,2})\s*$/m);
  return normalizeGoVersion(match ? match[1] : "");
}

function detectGoVersion(rootDir) {
  const candidates = [
    path.join(rootDir, "go.work"),
    path.join(rootDir, "go.mod"),
    path.join(rootDir, ".go-version"),
    path.join(rootDir, ".tool-versions"),
  ];

  for (const candidate of candidates) {
    if (!statExists(candidate)) {
      continue;
    }

    const text = readTextIfExists(candidate);
    if (candidate.endsWith(".go-version")) {
      const version = normalizeGoVersion(text);
      if (version) {
        return version;
      }
      continue;
    }

    if (candidate.endsWith(".tool-versions")) {
      const version = parseGoVersionFromToolVersions(text);
      if (version) {
        return version;
      }
      continue;
    }

    const version = parseGoVersionFromText(text);
    if (version) {
      return version;
    }
  }

  return normalizeGoVersion(process.env.GOTOOLCHAIN || "");
}

function parseGoVersionParts(version) {
  return normalizeGoVersion(version)
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}

function compareGoVersions(left, right) {
  const leftParts = parseGoVersionParts(left);
  const rightParts = parseGoVersionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] || 0;
    const rightValue = rightParts[index] || 0;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return 0;
}

function findBestVersionedPath(baseDir, prefix) {
  if (!baseDir || !statExists(baseDir)) {
    return "";
  }

  const exactPath = path.join(baseDir, prefix);
  if (statExists(exactPath)) {
    return exactPath;
  }

  const parentDir = path.dirname(exactPath);
  const entryPrefix = path.basename(exactPath);
  if (!statExists(parentDir)) {
    return "";
  }

  const matches = fs
    .readdirSync(parentDir)
    .filter((entry) => entry === entryPrefix || entry.startsWith(`${entryPrefix}.`))
    .sort((left, right) => compareGoVersions(right.slice(2), left.slice(2)));

  return matches.length > 0 ? path.join(parentDir, matches[0]) : "";
}

function resolveGoRoot(homeDir, goVersion) {
  const normalized = normalizeGoVersion(goVersion);
  if (!normalized) {
    return statExists(process.env.GOROOT || "") ? process.env.GOROOT : "";
  }

  const gvmRoot = findBestVersionedPath(path.join(homeDir, ".gvm", "gos"), `go${normalized}`);
  if (gvmRoot) {
    return gvmRoot;
  }

  return statExists(process.env.GOROOT || "") ? process.env.GOROOT : "";
}

function resolveGoPath(homeDir, goVersion) {
  const normalized = normalizeGoVersion(goVersion);
  if (normalized) {
    const gvmPkgset = path.join(homeDir, ".gvm", "pkgsets", `go${normalized}`, "global");
    if (statExists(gvmPkgset)) {
      return gvmPkgset;
    }
  }

  const configuredGoPath = process.env.GOPATH || "";
  if (configuredGoPath && !configuredGoPath.startsWith("/tmp/codex-") && statExists(configuredGoPath)) {
    return configuredGoPath;
  }

  return path.join(homeDir, "go");
}

function resolveGoplsCommand(homeDir, goVersion) {
  const normalized = normalizeGoVersion(goVersion);
  if (normalized) {
    const versionedGopls = path.join(homeDir, ".gvm", "pkgsets", `go${normalized}`, "global", "bin", "gopls");
    if (statExists(versionedGopls)) {
      return versionedGopls;
    }
  }

  return findExecutable(process.env.GOPLS_BIN || "gopls", [
    path.join(homeDir, ".gvm/pkgsets/go1.21/global/bin/gopls"),
    path.join(homeDir, "go/bin/gopls"),
  ]);
}

function buildScopedTempDir(rootDir, label) {
  const hash = crypto.createHash("sha1").update(rootDir).digest("hex").slice(0, 12);
  const tempRoot = process.env.TMPDIR || "/tmp";
  return path.join(tempRoot, "codex-gopls-mcp", hash, label);
}

function getServerConfig(language, rootDir = "") {
  const home = process.env.HOME || "";
  if (language === "go") {
    return {
      languageId: "go",
      command: resolveGoplsCommand(home, detectGoVersion(rootDir)),
      args: [],
      env: buildGoProcessEnv(rootDir),
    };
  }

  if (language === "solidity") {
    return {
      languageId: "solidity",
      command: findExecutable(process.env.SOLIDITY_LS_BIN || "nomicfoundation-solidity-language-server", [
        path.join(home, ".nvm/versions/node/v20.11.1/bin/nomicfoundation-solidity-language-server"),
      ]),
      args: ["--stdio"],
      env: process.env,
    };
  }

  throw new Error(`No LSP server configured for language: ${language}`);
}

function buildGoProcessEnv(rootDir) {
  const env = { ...process.env };
  const homeDir = process.env.HOME || "";
  const goVersion = detectGoVersion(rootDir);
  const goRoot = resolveGoRoot(homeDir, goVersion);
  const goPath = resolveGoPath(homeDir, goVersion);
  const goModCache =
    env.GOMODCACHE && !env.GOMODCACHE.startsWith("/tmp/codex-") ? env.GOMODCACHE : path.join(goPath, "pkg", "mod");
  const goCache = env.GOCACHE && !env.GOCACHE.startsWith("/tmp/codex-") ? env.GOCACHE : buildScopedTempDir(rootDir, "go-build");
  const goplsHome =
    env.GOPLS_HOME && !env.GOPLS_HOME.startsWith("/tmp/codex-") ? env.GOPLS_HOME : buildScopedTempDir(rootDir, "home");
  const xdgCacheHome =
    env.XDG_CACHE_HOME && !env.XDG_CACHE_HOME.startsWith("/tmp/codex-")
      ? env.XDG_CACHE_HOME
      : buildScopedTempDir(rootDir, "xdg");
  const goBin = path.join(goRoot, "bin");

  fs.mkdirSync(goCache, { recursive: true });
  fs.mkdirSync(goplsHome, { recursive: true });
  fs.mkdirSync(xdgCacheHome, { recursive: true });
  fs.mkdirSync(path.join(goplsHome, "Library", "Caches"), { recursive: true });

  env.GOCACHE = goCache;
  env.GOMODCACHE = goModCache;
  env.GOPATH = goPath;
  env.XDG_CACHE_HOME = xdgCacheHome;
  env.GOTOOLCHAIN = env.GOTOOLCHAIN || "local";
  if (statExists(goBin)) {
    env.GOROOT = goRoot;
    env.PATH = prependPath(goBin, env.PATH);
  }
  env.HOME = goplsHome;
  env.GOPLS_BIN = resolveGoplsCommand(homeDir, goVersion);
  return env;
}

async function runGoCli(rootDir, args) {
  const config = getServerConfig("go", rootDir);
  const { stdout } = await execFileAsync(config.command, args, {
    cwd: rootDir,
    env: config.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

function toGoPosition(rootDir, filePath, line, column) {
  const relativePath = path.relative(rootDir, filePath);
  const positionPath = relativePath && !relativePath.startsWith("..") ? relativePath : filePath;
  return `${positionPath}:${line}:${column}`;
}

function parseGoDefinitionJson(raw) {
  if (!raw) {
    return [];
  }
  const parsed = JSON.parse(raw);
  const filePath = uriToFilePath(parsed.span.uri);
  return [
    {
      path: filePath,
      line: parsed.span.start.line,
      column: parsed.span.start.column,
      endLine: parsed.span.end.line,
      endColumn: parsed.span.end.column,
      snippet: extractSnippet(filePath, parsed.span.start.line - 1),
      description: parsed.description || "",
    },
  ];
}

function parseGoReferences(raw) {
  if (!raw) {
    return [];
  }

  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.*?):(\d+):(\d+)-(\d+)$/);
      if (!match) {
        return null;
      }
      const filePath = match[1];
      const lineNumber = Number(match[2]);
      const startColumn = Number(match[3]);
      const endColumn = Number(match[4]);
      return {
        path: filePath,
        line: lineNumber,
        column: startColumn,
        endLine: lineNumber,
        endColumn,
        snippet: extractSnippet(filePath, lineNumber - 1),
      };
    })
    .filter(Boolean);
}

function parseGoSymbols(raw, filePath) {
  if (!raw) {
    return [];
  }

  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.*?)\s+(\w+)\s+(\d+):(\d+)-(\d+):(\d+)$/);
      if (!match) {
        return null;
      }
      return {
        name: match[1],
        detail: "",
        kind: match[2],
        containerName: "",
        line: Number(match[3]),
        column: Number(match[4]),
        endLine: Number(match[5]),
        endColumn: Number(match[6]),
        path: filePath,
      };
    })
    .filter(Boolean);
}

function parseGoWorkspaceSymbols(raw) {
  if (!raw) {
    return [];
  }

  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.*?):(\d+):(\d+)-(\d+)\s+(\S+)\s+(\w+)$/);
      if (!match) {
        return null;
      }
      const filePath = match[1];
      const lineNumber = Number(match[2]);
      const startColumn = Number(match[3]);
      const endColumn = Number(match[4]);
      return {
        name: match[5],
        kind: match[6],
        containerName: "",
        location: {
          path: filePath,
          line: lineNumber,
          column: startColumn,
          endLine: lineNumber,
          endColumn,
          snippet: extractSnippet(filePath, lineNumber - 1),
        },
      };
    })
    .filter(Boolean);
}

function parseGoDiagnostics(raw, filePath) {
  if (!raw) {
    return [];
  }

  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.*?):(\d+):(\d+):\s*(.*)$/);
      if (!match) {
        return null;
      }
      const resolvedPath = match[1] || filePath;
      const lineNumber = Number(match[2]);
      const columnNumber = Number(match[3]);
      return {
        message: match[4],
        severity: null,
        source: "gopls",
        code: null,
        line: lineNumber,
        column: columnNumber,
        endLine: lineNumber,
        endColumn: columnNumber,
        snippet: extractSnippet(resolvedPath, lineNumber - 1),
      };
    })
    .filter(Boolean);
}

function positionToOffset(text, position) {
  const lines = text.split(/\r?\n/);
  let offset = 0;
  for (let line = 0; line < position.line; line += 1) {
    offset += (lines[line] || "").length + 1;
  }
  return offset + position.character;
}

function extractSnippet(filePath, zeroBasedLine) {
  try {
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    return lines[zeroBasedLine] || "";
  } catch {
    return "";
  }
}

function formatLocation(location) {
  const filePath = uriToFilePath(location.uri);
  return {
    path: filePath,
    line: location.range.start.line + 1,
    column: location.range.start.character + 1,
    endLine: location.range.end.line + 1,
    endColumn: location.range.end.character + 1,
    snippet: extractSnippet(filePath, location.range.start.line),
  };
}

function extractHoverText(hover) {
  if (!hover || hover.contents == null) {
    return "";
  }

  const { contents } = hover;
  if (typeof contents === "string") {
    return contents;
  }
  if (Array.isArray(contents)) {
    return contents
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item.value === "string") {
          return item.value;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n\n");
  }
  if (typeof contents.value === "string") {
    return contents.value;
  }
  return JSON.stringify(contents, null, 2);
}

class JsonRpcStream {
  constructor(readable, writable, label) {
    this.readable = readable;
    this.writable = writable;
    this.label = label;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.nextId = 1;
    this.notificationHandler = null;
    this.requestHandler = null;
    this.transportMode = null;

    readable.on("data", (chunk) => this._onData(chunk));
    readable.on("error", (error) => this._rejectAll(error));
    readable.on("close", () => this._rejectAll(new Error(`${label} stream closed`)));
  }

  setNotificationHandler(handler) {
    this.notificationHandler = handler;
  }

  setRequestHandler(handler) {
    this.requestHandler = handler;
  }

  sendRequest(method, params) {
    const id = this.nextId++;
    const message = {
      jsonrpc: JSON_RPC_VERSION,
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this._write(message);
    });
  }

  sendNotification(method, params) {
    this._write({
      jsonrpc: JSON_RPC_VERSION,
      method,
      params,
    });
  }

  sendResponse(id, result) {
    this._write({
      jsonrpc: JSON_RPC_VERSION,
      id,
      result,
    });
  }

  sendError(id, code, message) {
    this._write({
      jsonrpc: JSON_RPC_VERSION,
      id,
      error: { code, message },
    });
  }

  _write(message) {
    const body = Buffer.from(JSON.stringify(message), "utf8");
    if (this.transportMode === "ndjson") {
      this.writable.write(Buffer.concat([body, Buffer.from("\n", "utf8")]));
      return;
    }
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8");
    this.writable.write(Buffer.concat([header, body]));
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd !== -1) {
        const headerText = this.buffer.slice(0, headerEnd).toString("utf8");
        const lengthMatch = headerText.match(/Content-Length:\s*(\d+)/i);
        if (!lengthMatch) {
          throw new Error(`Invalid Content-Length header from ${this.label}`);
        }

        const contentLength = Number(lengthMatch[1]);
        const totalLength = headerEnd + 4 + contentLength;
        if (this.buffer.length < totalLength) {
          return;
        }

        this.transportMode = this.transportMode || "content-length";

        const body = this.buffer.slice(headerEnd + 4, totalLength).toString("utf8");
        this.buffer = this.buffer.slice(totalLength);

        const message = JSON.parse(body);
        this._dispatch(message);
        continue;
      }

      const prefix = this.buffer.slice(0, Math.min(this.buffer.length, 32)).toString("utf8").trimStart();
      if (!prefix.startsWith("{") && !prefix.startsWith("[")) {
        return;
      }

      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }

      const line = this.buffer.slice(0, newlineIndex).toString("utf8").trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }

      this.transportMode = this.transportMode || "ndjson";
      const message = JSON.parse(line);
      this._dispatch(message);
    }
  }

  _dispatch(message) {
    if (message.id != null && Object.prototype.hasOwnProperty.call(message, "result")) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      pending.resolve(message.result);
      return;
    }

    if (message.id != null && Object.prototype.hasOwnProperty.call(message, "error")) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      pending.reject(new Error(message.error.message || `${this.label} request failed`));
      return;
    }

    if (message.id != null && message.method) {
      if (!this.requestHandler) {
        this.sendError(message.id, -32601, `Method not found: ${message.method}`);
        return;
      }
      Promise.resolve(this.requestHandler(message))
        .then((result) => this.sendResponse(message.id, result))
        .catch((error) => this.sendError(message.id, -32000, error.message));
      return;
    }

    if (message.method && this.notificationHandler) {
      this.notificationHandler(message);
    }
  }

  _rejectAll(error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

class LspClient {
  constructor(language, rootDir) {
    this.language = language;
    this.rootDir = rootDir;
    this.versionByUri = new Map();
    this.textByUri = new Map();
    this.diagnosticsByUri = new Map();

    const config = getServerConfig(language, rootDir);
    this.command = config.command;
    this.args = config.args;
    this.languageId = config.languageId;
    this.processEnv = config.env || process.env;
    this.process = null;
    this.stderr = "";

    if (language === "go") {
      this.ready = Promise.resolve();
      return;
    }

    this.process = spawn(this.command, this.args, {
      cwd: rootDir,
      env: this.processEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stderr.on("data", (chunk) => {
      this.stderr += chunk.toString("utf8");
      if (this.stderr.length > 8000) {
        this.stderr = this.stderr.slice(-8000);
      }
    });

    this.rpc = new JsonRpcStream(this.process.stdout, this.process.stdin, `${language} lsp`);
    this.rpc.setNotificationHandler((message) => this._handleNotification(message));

    this.ready = this._initialize();
    this.process.on("exit", (code, signal) => {
      clients.delete(this.cacheKey());
      if (code !== 0) {
        console.error(`${this.language} LSP exited with code=${code} signal=${signal}\n${this.stderr}`);
      }
    });
  }

  cacheKey() {
    return `${this.language}:${this.rootDir}`;
  }

  async _initialize() {
    const rootUri = filePathToUri(this.rootDir);
    await this.rpc.sendRequest("initialize", {
      processId: process.pid,
      clientInfo: {
        name: "codex-gopls-mcp",
        version: "0.1.0",
      },
      rootUri,
      workspaceFolders: [
        {
          name: path.basename(this.rootDir),
          uri: rootUri,
        },
      ],
      capabilities: {
        workspace: {
          workspaceFolders: true,
          symbol: {
            dynamicRegistration: false,
          },
        },
        textDocument: {
          hover: { dynamicRegistration: false },
          definition: { dynamicRegistration: false, linkSupport: false },
          references: { dynamicRegistration: false },
          documentSymbol: {
            dynamicRegistration: false,
            hierarchicalDocumentSymbolSupport: true,
          },
          publishDiagnostics: {
            relatedInformation: true,
          },
        },
      },
      initializationOptions: {},
    });
    this.rpc.sendNotification("initialized", {});
  }

  _handleNotification(message) {
    if (message.method === "textDocument/publishDiagnostics") {
      const { uri, diagnostics } = message.params;
      this.diagnosticsByUri.set(uri, diagnostics || []);
    }
  }

  async ensureDocument(filePath) {
    await this.ready;

    const resolvedPath = normalizePath(filePath);
    const text = fs.readFileSync(resolvedPath, "utf8");
    const uri = filePathToUri(resolvedPath);
    const previous = this.textByUri.get(uri);
    const nextVersion = (this.versionByUri.get(uri) || 0) + 1;

    if (previous == null) {
      this.rpc.sendNotification("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId: this.languageId,
          version: nextVersion,
          text,
        },
      });
    } else if (previous !== text) {
      this.rpc.sendNotification("textDocument/didChange", {
        textDocument: {
          uri,
          version: nextVersion,
        },
        contentChanges: [{ text }],
      });
    }

    this.versionByUri.set(uri, nextVersion);
    this.textByUri.set(uri, text);
    return { uri, text };
  }

  async request(method, params) {
    await this.ready;
    return this.rpc.sendRequest(method, params);
  }

  async hover(filePath, line, column) {
    if (this.language === "go") {
      const raw = await runGoCli(this.rootDir, ["definition", "-json", toGoPosition(this.rootDir, filePath, line, column)]);
      const [definition] = parseGoDefinitionJson(raw);
      return {
        path: normalizePath(filePath),
        line,
        column,
        contents: definition ? definition.description : "",
        range: definition
          ? {
              startLine: definition.line,
              startColumn: definition.column,
              endLine: definition.endLine,
              endColumn: definition.endColumn,
            }
          : null,
      };
    }

    const { uri } = await this.ensureDocument(filePath);
    const result = await this.request("textDocument/hover", {
      textDocument: { uri },
      position: { line: line - 1, character: column - 1 },
    });

    return {
      path: normalizePath(filePath),
      line,
      column,
      contents: extractHoverText(result),
      range: result && result.range
        ? {
            startLine: result.range.start.line + 1,
            startColumn: result.range.start.character + 1,
            endLine: result.range.end.line + 1,
            endColumn: result.range.end.character + 1,
          }
        : null,
    };
  }

  async definition(filePath, line, column) {
    if (this.language === "go") {
      const raw = await runGoCli(this.rootDir, ["definition", "-json", toGoPosition(this.rootDir, filePath, line, column)]);
      return parseGoDefinitionJson(raw);
    }

    const { uri } = await this.ensureDocument(filePath);
    const result = await this.request("textDocument/definition", {
      textDocument: { uri },
      position: { line: line - 1, character: column - 1 },
    });

    return normalizeLocations(result);
  }

  async references(filePath, line, column, includeDeclaration) {
    if (this.language === "go") {
      const args = ["references"];
      if (includeDeclaration) {
        args.push("-d");
      }
      args.push(toGoPosition(this.rootDir, filePath, line, column));
      const raw = await runGoCli(this.rootDir, args);
      return parseGoReferences(raw);
    }

    const { uri } = await this.ensureDocument(filePath);
    const result = await this.request("textDocument/references", {
      textDocument: { uri },
      position: { line: line - 1, character: column - 1 },
      context: { includeDeclaration: Boolean(includeDeclaration) },
    });

    return normalizeLocations(result);
  }

  async documentSymbols(filePath) {
    if (this.language === "go") {
      const relativePath = path.relative(this.rootDir, filePath);
      const cliTarget = relativePath && !relativePath.startsWith("..") ? relativePath : filePath;
      const raw = await runGoCli(this.rootDir, ["symbols", cliTarget]);
      return parseGoSymbols(raw, filePath);
    }

    const { uri } = await this.ensureDocument(filePath);
    const result = await this.request("textDocument/documentSymbol", {
      textDocument: { uri },
    });

    return flattenSymbols(result);
  }

  async workspaceSymbols(query) {
    if (this.language === "go") {
      const raw = await runGoCli(this.rootDir, ["workspace_symbol", query || ""]);
      return parseGoWorkspaceSymbols(raw);
    }

    const result = await this.request("workspace/symbol", {
      query: query || "",
    });

    return (result || []).map((item) => ({
      name: item.name,
      kind: item.kind,
      containerName: item.containerName || "",
      location: item.location ? formatLocation(item.location) : null,
    }));
  }

  async diagnostics(filePath) {
    if (this.language === "go") {
      const relativePath = path.relative(this.rootDir, filePath);
      const cliTarget = relativePath && !relativePath.startsWith("..") ? relativePath : filePath;
      const raw = await runGoCli(this.rootDir, ["check", cliTarget]);
      return parseGoDiagnostics(raw, filePath);
    }

    const { uri } = await this.ensureDocument(filePath);
    const diagnostics = this.diagnosticsByUri.get(uri) || [];

    return diagnostics.map((item) => ({
      message: item.message,
      severity: item.severity || null,
      source: item.source || "",
      code: item.code || null,
      line: item.range.start.line + 1,
      column: item.range.start.character + 1,
      endLine: item.range.end.line + 1,
      endColumn: item.range.end.character + 1,
      snippet: extractSnippet(filePath, item.range.start.line),
    }));
  }
}

function normalizeLocations(result) {
  if (!result) {
    return [];
  }

  if (Array.isArray(result)) {
    return result
      .filter((item) => item && item.uri && item.range)
      .map((item) => formatLocation(item));
  }

  if (result.uri && result.range) {
    return [formatLocation(result)];
  }

  if (Array.isArray(result.targets)) {
    return result.targets
      .filter((item) => item && item.targetUri && item.targetRange)
      .map((item) =>
        formatLocation({
          uri: item.targetUri,
          range: item.targetSelectionRange || item.targetRange,
        }),
      );
  }

  return [];
}

function flattenSymbols(result, bucket = [], parentName = "") {
  if (!Array.isArray(result)) {
    return bucket;
  }

  for (const item of result) {
    const locationRange = item.location ? item.location.range : item.range;
    bucket.push({
      name: item.name,
      detail: item.detail || "",
      kind: item.kind,
      containerName: item.containerName || parentName,
      line: locationRange ? locationRange.start.line + 1 : null,
      column: locationRange ? locationRange.start.character + 1 : null,
      endLine: locationRange ? locationRange.end.line + 1 : null,
      endColumn: locationRange ? locationRange.end.character + 1 : null,
    });

    if (Array.isArray(item.children) && item.children.length > 0) {
      flattenSymbols(item.children, bucket, item.name);
    }
  }

  return bucket;
}

function getClientForFile(filePath) {
  const resolvedPath = normalizePath(filePath);
  if (!statExists(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`);
  }

  const language = detectLanguage(resolvedPath);
  const rootDir = findRootForLanguage(resolvedPath, language);
  if (language === "go") {
    return new LspClient(language, rootDir);
  }
  const key = `${language}:${rootDir}`;

  let client = clients.get(key);
  if (!client) {
    client = new LspClient(language, rootDir);
    clients.set(key, client);
  }
  return client;
}

function ensureInteger(name, value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function makeTextResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function getToolDefinitions() {
  return [
    {
      name: "lsp_hover",
      description: "Get LSP hover information for a Go or Solidity file at a 1-based line and column.",
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Absolute path to a .go or .sol file." },
          line: { type: "integer", description: "1-based line number." },
          column: { type: "integer", description: "1-based column number." },
        },
        required: ["filePath", "line", "column"],
        additionalProperties: false,
      },
    },
    {
      name: "lsp_definition",
      description: "Find LSP definition locations for a Go or Solidity symbol at a 1-based line and column.",
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Absolute path to a .go or .sol file." },
          line: { type: "integer", description: "1-based line number." },
          column: { type: "integer", description: "1-based column number." },
        },
        required: ["filePath", "line", "column"],
        additionalProperties: false,
      },
    },
    {
      name: "lsp_references",
      description: "Find LSP references for a Go or Solidity symbol at a 1-based line and column.",
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Absolute path to a .go or .sol file." },
          line: { type: "integer", description: "1-based line number." },
          column: { type: "integer", description: "1-based column number." },
          includeDeclaration: { type: "boolean", description: "Whether to include the symbol declaration." },
        },
        required: ["filePath", "line", "column"],
        additionalProperties: false,
      },
    },
    {
      name: "lsp_document_symbols",
      description: "List document symbols for a Go or Solidity source file.",
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Absolute path to a .go or .sol file." },
        },
        required: ["filePath"],
        additionalProperties: false,
      },
    },
    {
      name: "lsp_workspace_symbols",
      description: "Search workspace symbols using the language server attached to the given file.",
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Absolute path to a .go or .sol file inside the target workspace." },
          query: { type: "string", description: "Search query." },
        },
        required: ["filePath", "query"],
        additionalProperties: false,
      },
    },
    {
      name: "lsp_diagnostics",
      description: "Read the latest diagnostics for a Go or Solidity file after opening it in the language server.",
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Absolute path to a .go or .sol file." },
        },
        required: ["filePath"],
        additionalProperties: false,
      },
    },
  ];
}

async function handleToolCall(name, args) {
  if (name === "lsp_hover") {
    ensureInteger("line", args.line);
    ensureInteger("column", args.column);
    return makeTextResult(await getClientForFile(args.filePath).hover(args.filePath, args.line, args.column));
  }

  if (name === "lsp_definition") {
    ensureInteger("line", args.line);
    ensureInteger("column", args.column);
    return makeTextResult(await getClientForFile(args.filePath).definition(args.filePath, args.line, args.column));
  }

  if (name === "lsp_references") {
    ensureInteger("line", args.line);
    ensureInteger("column", args.column);
    return makeTextResult(
      await getClientForFile(args.filePath).references(
        args.filePath,
        args.line,
        args.column,
        args.includeDeclaration,
      ),
    );
  }

  if (name === "lsp_document_symbols") {
    return makeTextResult(await getClientForFile(args.filePath).documentSymbols(args.filePath));
  }

  if (name === "lsp_workspace_symbols") {
    return makeTextResult(await getClientForFile(args.filePath).workspaceSymbols(args.query));
  }

  if (name === "lsp_diagnostics") {
    return makeTextResult(await getClientForFile(args.filePath).diagnostics(args.filePath));
  }

  throw new Error(`Unknown tool: ${name}`);
}

async function handleMcpRequest(message) {
  const { method, params = {} } = message;

  if (method === "initialize") {
    return {
      protocolVersion: params.protocolVersion || MCP_FALLBACK_PROTOCOL_VERSION,
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: "codex-gopls-mcp",
        version: "0.1.0",
      },
    };
  }

  if (method === "ping") {
    return {};
  }

  if (method === "tools/list") {
    return {
      tools: getToolDefinitions(),
    };
  }

  if (method === "tools/call") {
    if (!mcpInitialized) {
      mcpInitialized = true;
    }
    return handleToolCall(params.name, params.arguments || {});
  }

  throw new Error(`Method not supported: ${method}`);
}

function handleMcpNotification(message) {
  if (message.method === "notifications/initialized") {
    mcpInitialized = true;
  }
}

function runStdioServer() {
  const mcp = new JsonRpcStream(process.stdin, process.stdout, "mcp");

  mcp.setNotificationHandler((message) => {
    handleMcpNotification(message);
  });

  mcp.setRequestHandler(async (message) => handleMcpRequest(message));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function handleHttpMessage(message) {
  if (message.method && message.id == null) {
    handleMcpNotification(message);
    return null;
  }

  try {
    const result = await handleMcpRequest(message);
    return {
      jsonrpc: JSON_RPC_VERSION,
      id: message.id,
      result,
    };
  } catch (error) {
    return {
      jsonrpc: JSON_RPC_VERSION,
      id: message.id,
      error: {
        code: -32000,
        message: error.message,
      },
    };
  }
}

function runHttpServer() {
  const port = Number(process.env.MCP_PORT || process.env.PORT || 3245);
  const host = process.env.MCP_HOST || "127.0.0.1";

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, name: "codex-gopls-mcp" }));
        return;
      }

      if (req.method !== "POST" || (req.url !== "/mcp" && req.url !== "/")) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }

      const rawBody = await readRequestBody(req);
      if (!rawBody.trim()) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "empty body" }));
        return;
      }

      const parsed = JSON.parse(rawBody);
      const messages = Array.isArray(parsed) ? parsed : [parsed];
      const responses = (await Promise.all(messages.map((message) => handleHttpMessage(message)))).filter(Boolean);

      if (responses.length === 0) {
        res.writeHead(202);
        res.end();
        return;
      }

      const payload = Array.isArray(parsed) ? responses : responses[0];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: JSON_RPC_VERSION,
          error: { code: -32603, message: error.message },
        }),
      );
    }
  });

  server.listen(port, host, () => {
    console.error(`codex-gopls-mcp listening on http://${host}:${port}/mcp`);
  });
}

if (process.argv.includes("--http")) {
  runHttpServer();
} else {
  runStdioServer();
}
