import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import { defaultDataRoot } from "./workspace-data.js";

const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_CONNECT_TIMEOUT_MS = 100;
export const CTX_MCP_BRIDGE_REVISION = 2;

export function ctxMcpSocketPath(dataDir = defaultDataDir()) {
  return path.join(dataDir, "ctx-mcp.sock");
}

export function invalidateCtxMcpSocket(dataDir = defaultDataDir()) {
  const socketPath = ctxMcpSocketPath(dataDir);
  if (!fs.existsSync(socketPath)) return false;
  try {
    fs.rmSync(socketPath, { force: true });
    return true;
  } catch {
    return false;
  }
}

export async function callCtxScoreContext(payload, {
  dataDir = defaultDataDir(),
  timeoutMs = Number(process.env.CONTEXTOS_MCP_BRIDGE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  connectTimeoutMs = Number(process.env.CONTEXTOS_MCP_CONNECT_TIMEOUT_MS || DEFAULT_CONNECT_TIMEOUT_MS),
  createConnection = net.createConnection
} = {}) {
  const socketPath = ctxMcpSocketPath(dataDir);
  if (!fs.existsSync(socketPath)) {
    throw new Error(`ctx-mcp bridge socket not found: ${socketPath}`);
  }
  const socketIdentity = statIdentity(socketPath);

  return new Promise((resolve, reject) => {
    const client = createConnection(socketPath);
    let raw = "";
    let responseTimer;
    const connectTimer = setTimeout(() => {
      client.destroy();
      reject(new Error(`ctx-mcp bridge connect timed out after ${connectTimeoutMs}ms`));
    }, connectTimeoutMs);

    client.on("connect", () => {
      clearTimeout(connectTimer);
      responseTimer = setTimeout(() => {
        client.destroy();
        reject(new Error(`ctx-mcp bridge timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      client.write(`${JSON.stringify(payload)}\n`);
    });
    client.on("data", (chunk) => {
      raw += chunk.toString("utf8");
    });
    client.on("end", () => {
      clearTimeout(connectTimer);
      clearTimeout(responseTimer);
      try {
        const response = JSON.parse(raw || "{}");
        if (response.bridgeRevision !== CTX_MCP_BRIDGE_REVISION) {
          invalidateSocketIfUnchanged(socketPath, socketIdentity);
          reject(new Error(`ctx-mcp bridge revision mismatch: expected ${CTX_MCP_BRIDGE_REVISION}, received ${response.bridgeRevision || "missing"}`));
          return;
        }
        resolve(response);
      } catch (error) {
        reject(error);
      }
    });
    client.on("error", (error) => {
      clearTimeout(connectTimer);
      clearTimeout(responseTimer);
      reject(error);
    });
  });
}

function invalidateSocketIfUnchanged(socketPath, expectedIdentity) {
  if (!expectedIdentity || statIdentity(socketPath) !== expectedIdentity) return false;
  try {
    fs.rmSync(socketPath, { force: true });
    return true;
  } catch {
    return false;
  }
}

function statIdentity(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.dev}:${stat.ino}`;
  } catch {
    return null;
  }
}

function defaultDataDir() {
  return defaultDataRoot();
}
