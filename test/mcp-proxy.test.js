import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const proxyPath = path.resolve("plugins/ctx/mcp/proxy.js");

describe("mcp proxy", () => {
  it("forwards MCP stdio and records tools/call telemetry", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-proxy-cwd-"));
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-proxy-data-"));
    const childCode = [
      "process.stdin.on('data', c => process.stdout.write(c));"
    ].join("");
    const proxy = spawn(process.execPath, [
      proxyPath,
      "--name",
      "code-review-graph",
      "--",
      process.execPath,
      "-e",
      childCode
    ], {
      cwd,
      env: { ...process.env, PLUGIN_DATA: dataRoot },
      stdio: ["pipe", "pipe", "pipe"]
    });

    const message = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "detect_changes_tool", arguments: {} }
    };
    const stdout = await writeAndCollect(proxy, `${JSON.stringify(message)}\n`);

    expect(JSON.parse(stdout.trim())).toMatchObject(message);
    const workspaceDir = path.join(dataRoot, "workspaces");
    const telemetryFile = findFile(workspaceDir, "telemetry.jsonl");
    const telemetry = fs.readFileSync(telemetryFile, "utf8");
    expect(telemetry).toContain("McpToolCall");
    expect(telemetry).toContain("code-review-graph.detect_changes_tool");
  });
});

function writeAndCollect(child, input) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (stdout.includes("\n")) {
        child.kill();
        resolve(stdout);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (!stdout) reject(new Error(`proxy exited ${code}: ${stderr}`));
    });
    child.stdin.write(input);
  });
}

function findFile(root, name) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name === name) return fullPath;
    if (entry.isDirectory()) {
      const found = findFile(fullPath, name);
      if (found) return found;
    }
  }
  return null;
}
