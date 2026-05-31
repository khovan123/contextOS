import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { callCtxScoreContext, ctxMcpSocketPath, invalidateCtxMcpSocket } from "../plugins/ctx/lib/ctx-mcp-client.js";

describe("ctx mcp client", () => {
  it("fails stale socket connects within the connect timeout", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-mcp-connect-timeout-"));
    fs.writeFileSync(ctxMcpSocketPath(dataDir), "");
    const client = fakeClient();
    const started = Date.now();

    await expect(callCtxScoreContext({}, {
      dataDir,
      connectTimeoutMs: 20,
      timeoutMs: 1000,
      createConnection: () => client
    })).rejects.toThrow("ctx-mcp bridge connect timed out after 20ms");

    expect(Date.now() - started).toBeLessThan(200);
    expect(client.destroyed).toBe(true);
  });

  it("keeps a separate response timeout after connecting", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-mcp-response-timeout-"));
    fs.writeFileSync(ctxMcpSocketPath(dataDir), "");
    const client = fakeClient();
    const pending = callCtxScoreContext({ prompt: "test" }, {
      dataDir,
      connectTimeoutMs: 20,
      timeoutMs: 40,
      createConnection: () => client
    });
    client.emit("connect");

    await expect(pending).rejects.toThrow("ctx-mcp bridge timed out after 40ms");
    expect(client.writes).toEqual(['{"prompt":"test"}\n']);
  });

  it("rejects responses from stale bridge revisions", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-mcp-revision-"));
    fs.writeFileSync(ctxMcpSocketPath(dataDir), "");
    const client = fakeClient();
    const pending = callCtxScoreContext({ prompt: "test" }, {
      dataDir,
      createConnection: () => client
    });
    client.emit("connect");
    client.emit("data", Buffer.from('{"suggestedSkills":[]}'));
    client.emit("end");

    await expect(pending).rejects.toThrow("ctx-mcp bridge revision mismatch");
    expect(fs.existsSync(ctxMcpSocketPath(dataDir))).toBe(false);
  });

  it("invalidates an existing private bridge socket", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-mcp-invalidate-"));
    fs.writeFileSync(ctxMcpSocketPath(dataDir), "");

    expect(invalidateCtxMcpSocket(dataDir)).toBe(true);
    expect(fs.existsSync(ctxMcpSocketPath(dataDir))).toBe(false);
  });
});

function fakeClient() {
  const client = new EventEmitter();
  client.destroyed = false;
  client.writes = [];
  client.destroy = () => {
    client.destroyed = true;
  };
  client.write = (value) => {
    client.writes.push(value);
  };
  return client;
}
