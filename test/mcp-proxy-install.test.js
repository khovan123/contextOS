import { describe, expect, it } from "vitest";

import { rewriteMcpTelemetryProxies } from "../plugins/ctx/lib/mcp-proxy-install.js";

describe("mcp proxy install", () => {
  it("wraps target MCP servers and preserves tool approval sections", () => {
    const input = `model = "gpt"

[mcp_servers.code-review-graph]
command = "/venv/bin/python"
args = ["-m", "code_review_graph", "serve"]
cwd = "/repo"

[mcp_servers.code-review-graph.tools.detect_changes_tool]
approval_mode = "approve"

[mcp_servers.agentmemory]
command = "npx"
args = ["-y", "@agentmemory/mcp"]

[mcp_servers.ctx-mcp]
command = "node"
args = ["/ctx/server.js"]
`;

    const result = rewriteMcpTelemetryProxies(input, { proxyPath: "/ctx/proxy.js" });

    expect(result.wrapped.map((item) => item.name)).toEqual(["code-review-graph"]);
    expect(result.content).toContain('command = "node"');
    expect(result.content).toContain('args = ["/ctx/proxy.js", "--name", "code-review-graph", "--", "/venv/bin/python", "-m", "code_review_graph", "serve"]');
    expect(result.content).toContain("[mcp_servers.code-review-graph.tools.detect_changes_tool]");
    expect(result.content).toContain("[mcp_servers.agentmemory]");
    expect(result.content).toContain('args = ["-y", "@agentmemory/mcp"]');
    expect(result.content).toContain('args = ["/ctx/server.js"]');
  });

  it("does not double-wrap already proxied servers", () => {
    const input = `[mcp_servers.code-review-graph]
command = "node"
args = ["/ctx/proxy.js", "--name", "code-review-graph", "--", "/venv/bin/python"]
`;

    const result = rewriteMcpTelemetryProxies(input, { proxyPath: "/ctx/proxy.js" });

    expect(result.wrapped).toEqual([]);
    expect(result.skipped[0]).toMatchObject({ name: "code-review-graph", reason: "already-wrapped" });
    expect(result.content).toBe(input);
  });

  it("unwraps older ContextOS proxies for non-target MCP servers", () => {
    const input = `[mcp_servers.agentmemory]
command = "node"
args = ["/ctx/proxy.js", "--name", "agentmemory", "--", "npx", "-y", "@agentmemory/mcp"]
`;

    const result = rewriteMcpTelemetryProxies(input, { proxyPath: "/ctx/proxy.js" });

    expect(result.wrapped).toEqual([]);
    expect(result.skipped[0]).toMatchObject({ name: "agentmemory", reason: "unwrapped-non-target" });
    expect(result.content).toContain('command = "npx"');
    expect(result.content).toContain('args = ["-y", "@agentmemory/mcp"]');
  });

  it("does not wrap RTK-managed MCP commands", () => {
    const input = `[mcp_servers.code-review-graph]
command = "rtk"
args = ["python", "-m", "code_review_graph", "serve"]
`;

    const result = rewriteMcpTelemetryProxies(input, { proxyPath: "/ctx/proxy.js" });

    expect(result.wrapped).toEqual([]);
    expect(result.skipped[0]).toMatchObject({ name: "code-review-graph", reason: "rtk-managed" });
    expect(result.content).toBe(input);
  });
});
