#!/usr/bin/env node
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { modelCacheDir, warmRuleEmbeddings } from "../lib/embedding-scorer.js";
import { scoreContext } from "../lib/score-context.js";
import { ctxMcpSocketPath } from "../lib/ctx-mcp-client.js";
import { createContextOSMcpServer } from "./contextos-server.js";

const dataDir = process.env.PLUGIN_DATA || path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "contextos");
const socketPath = ctxMcpSocketPath(dataDir);

fs.mkdirSync(dataDir, { recursive: true });
await ensureModelReady();
if (process.env.CONTEXTOS_DISABLE_BRIDGE !== "1") startBridge();
const keepAlive = setInterval(() => {}, 2 ** 31 - 1);

const server = createContextOSMcpServer({ dataDir });
console.error("ctx-mcp ready");
await server.connect(new StdioServerTransport());

async function ensureModelReady() {
  const modelDir = modelCacheDir(dataDir);
  if (!fs.existsSync(modelDir)) {
    throw new Error(`ContextOS model cache missing: ${modelDir}. Run ctx install first.`);
  }
  await warmRuleEmbeddings({
    task: "contextos mcp model ready",
    rules: [{ content: "ContextOS semantic scorer is ready." }],
    dataDir,
    allowRemote: false
  });
}

function startBridge() {
  fs.rmSync(socketPath, { force: true });
  const bridge = net.createServer((socket) => {
    let raw = "";
    socket.on("data", (chunk) => {
      raw += chunk.toString("utf8");
      if (raw.includes("\n")) handleBridgeRequest(socket, raw);
    });
  });
  bridge.on("error", (error) => {
    console.error(`ctx-mcp bridge disabled: ${error?.message || String(error)}`);
  });
  bridge.listen(socketPath);
  process.on("exit", () => {
    clearInterval(keepAlive);
    fs.rmSync(socketPath, { force: true });
  });
  process.on("SIGTERM", () => {
    clearInterval(keepAlive);
    fs.rmSync(socketPath, { force: true });
    process.exit(0);
  });
}

async function handleBridgeRequest(socket, raw) {
  socket.pause();
  try {
    const payload = JSON.parse(raw.trim() || "{}");
    const result = await scoreContext({
      cwd: payload.cwd || process.cwd(),
      prompt: payload.prompt || "",
      openFiles: payload.openFiles || [],
      dataDir,
      maxFiles: payload.maxFiles || 5
    });
    socket.end(JSON.stringify(result));
  } catch (error) {
    socket.end(JSON.stringify({
      error: error?.message || String(error),
      scoredRules: [],
      suggestedFiles: [],
      telemetry: { elapsedMs: 0, modelStatus: "error" }
    }));
  }
}
