import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import { defaultDataRoot } from "./workspace-data.js";

const DEFAULT_TIMEOUT_MS = 1000;

export function ctxMcpSocketPath(dataDir = defaultDataDir()) {
  return path.join(dataDir, "ctx-mcp.sock");
}

export async function callCtxScoreContext(payload, {
  dataDir = defaultDataDir(),
  timeoutMs = Number(process.env.CONTEXTOS_MCP_BRIDGE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
} = {}) {
  const socketPath = ctxMcpSocketPath(dataDir);
  if (!fs.existsSync(socketPath)) {
    throw new Error(`ctx-mcp bridge socket not found: ${socketPath}`);
  }

  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);
    let raw = "";
    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error(`ctx-mcp bridge timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    client.on("connect", () => {
      client.write(`${JSON.stringify(payload)}\n`);
    });
    client.on("data", (chunk) => {
      raw += chunk.toString("utf8");
    });
    client.on("end", () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    client.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function defaultDataDir() {
  return defaultDataRoot();
}
