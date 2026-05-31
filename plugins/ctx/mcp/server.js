#!/usr/bin/env node
import fs from "node:fs";
import net from "node:net";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { isModelCacheReady, modelCacheDir } from "../lib/embedding-scorer.js";
import { scoreContext } from "../lib/score-context.js";
import { CTX_MCP_BRIDGE_REVISION, ctxMcpSocketPath } from "../lib/ctx-mcp-client.js";
import { defaultDataRoot } from "../lib/workspace-data.js";
import { createContextOSMcpServer } from "./contextos-server.js";

const dataDir = defaultDataRoot();
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
  if (!fs.existsSync(modelDir) || !isModelCacheReady(dataDir)) {
    throw new Error(`ContextOS model cache missing: ${modelDir}. Run ctx install first.`);
  }
}

function startBridge() {
  fs.rmSync(socketPath, { force: true });
  const bridge = net.createServer((socket) => {
    let raw = "";
    socket.on("error", () => {
      // Clients may time out and close while scoring is still in progress.
    });
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
      maxFiles: payload.maxFiles || 5,
      maxSkills: payload.maxSkills || 3,
      maxWorkflows: payload.maxWorkflows || 2,
      skills: payload.skills,
      workflows: payload.workflows
    });
    socket.end(JSON.stringify({ ...result, bridgeRevision: CTX_MCP_BRIDGE_REVISION }));
  } catch (error) {
    socket.end(JSON.stringify({
      bridgeRevision: CTX_MCP_BRIDGE_REVISION,
      error: error?.message || String(error),
      scoredRules: [],
      suggestedFiles: [],
      suggestedSkills: [],
      suggestedWorkflows: [],
      telemetry: { elapsedMs: 0, modelStatus: "error" }
    }));
  }
}
