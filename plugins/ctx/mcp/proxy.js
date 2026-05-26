#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";

import { appendTelemetry } from "../lib/telemetry.js";
import { workspaceDataDir } from "../lib/workspace-data.js";

const { serverName, command, args } = parseArgs(process.argv.slice(2));
const cwd = process.cwd();
const telemetryPath = path.join(workspaceDataDir({ cwd }), "telemetry.jsonl");
let inspectBuffer = "";

const child = spawn(command, args, {
  cwd,
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"]
});

process.stdin.on("data", (chunk) => {
  inspectClientChunk(chunk);
  child.stdin.write(chunk);
});

process.stdin.on("end", () => {
  child.stdin.end();
});

child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
});

child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

child.on("error", (error) => {
  process.stderr.write(`contextos mcp proxy failed to start ${serverName}: ${error?.message || String(error)}\n`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

function inspectClientChunk(chunk) {
  inspectBuffer += chunk.toString("utf8");
  const lines = inspectBuffer.split(/\r?\n/);
  inspectBuffer = lines.pop() || "";
  for (const line of lines.filter(Boolean)) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message?.method !== "tools/call") continue;
    const toolName = message.params?.name || "unknown";
    appendTelemetry({
      telemetryPath,
      event: "McpToolCall",
      payload: {
        cwd,
        mcp: serverName,
        server: serverName,
        toolName: `${serverName}.${toolName}`,
        tool: toolName,
        method: message.method
      }
    });
  }
}

function parseArgs(argv) {
  const separator = argv.indexOf("--");
  if (separator < 0) usage();

  const before = argv.slice(0, separator);
  const after = argv.slice(separator + 1);
  const nameIndex = before.indexOf("--name");
  const serverName = nameIndex >= 0 ? before[nameIndex + 1] : null;
  const command = after[0];
  const args = after.slice(1);

  if (!serverName || !command) usage();
  return { serverName, command, args };
}

function usage() {
  process.stderr.write("Usage: node proxy.js --name <mcp-server-name> -- <command> [...args]\n");
  process.exit(2);
}
