import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { installClaudeHooks } from "../plugins/ctx/lib/claude-hooks.js";
import { buildClaudeMcpConfig, installClaudeMcp } from "../plugins/ctx/lib/claude-mcp.js";
import { buildAntigravityHooksConfig, installAntigravityHooks } from "../plugins/ctx/lib/antigravity-hooks.js";
import { buildAntigravityMcpConfig, installAntigravityMcp } from "../plugins/ctx/lib/antigravity-mcp.js";
import { antigravityCwd, extractPromptFromAntigravityPayload } from "../plugins/ctx/lib/antigravity-adapter.js";

describe("agent hook installers", () => {
  it("installs Claude Code hooks without dropping existing settings", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-claude-hooks-"));
    const settingsPath = path.join(tmp, "settings.json");
    fs.writeFileSync(settingsPath, JSON.stringify({
      theme: "dark",
      hooks: {
        Stop: [
          {
            hooks: [{ type: "command", command: "echo existing" }]
          }
        ]
      }
    }));

    installClaudeHooks({
      claudeHome: tmp,
      installRoot: "/tmp/contextos",
      injectPromptContext: true
    });

    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    expect(settings.theme).toBe("dark");
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toContain("/tmp/contextos/plugins/ctx/bin/on-prompt.js");
    expect(settings.hooks.Stop).toHaveLength(2);
    expect(settings.hooks.Stop[1].hooks[0].command).toContain("/tmp/contextos/plugins/ctx/bin/on-stop.js");
  });

  it("builds Claude Code user MCP config without dropping existing servers", () => {
    const config = buildClaudeMcpConfig({
      mcpServers: {
        github: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"]
        }
      },
      projects: {
        "/tmp/project": {}
      }
    }, {
      installRoot: "/tmp/contextos"
    });

    expect(config.projects["/tmp/project"]).toEqual({});
    expect(config.mcpServers.github.command).toBe("npx");
    expect(config.mcpServers["ctx-mcp"].type).toBe("stdio");
    expect(config.mcpServers["ctx-mcp"].command).toBe("node");
    expect(config.mcpServers["ctx-mcp"].args[0]).toBe("/tmp/contextos/plugins/ctx/mcp/server.js");
  });

  it("installs Claude Code user MCP config to .claude.json", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-claude-mcp-"));
    const configPath = path.join(tmp, ".claude.json");

    installClaudeMcp({
      configPath,
      installRoot: "/tmp/contextos"
    });

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(config.mcpServers["ctx-mcp"].args[0]).toBe("/tmp/contextos/plugins/ctx/mcp/server.js");
  });

  it("builds Antigravity hooks using PreInvocation and Stop adapters", () => {
    const config = buildAntigravityHooksConfig({
      existing: {
        Stop: [{ command: "echo keep" }]
      }
    }, {
      installRoot: "/tmp/contextos",
      injectPromptContext: false
    });

    expect(config.existing.Stop[0].command).toBe("echo keep");
    expect(config.contextos.PreInvocation[0].command).toContain("CONTEXTOS_INJECT=0");
    expect(config.contextos.PreInvocation[0].command).toContain("on-antigravity-preinvocation.js");
    expect(config.contextos.Stop[0].command).toContain("on-antigravity-stop.js");
  });

  it("installs Antigravity hooks to hooks.json", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-agy-hooks-"));
    const hooksPath = path.join(tmp, "hooks.json");
    installAntigravityHooks({
      hooksPath,
      installRoot: "/tmp/contextos"
    });

    const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    expect(hooks.contextos.enabled).toBe(true);
    expect(hooks.contextos.PreInvocation[0].command).toContain("on-antigravity-preinvocation.js");
  });

  it("builds Antigravity MCP config without dropping existing servers", () => {
    const config = buildAntigravityMcpConfig({
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"]
        }
      }
    }, {
      installRoot: "/tmp/contextos"
    });

    expect(config.mcpServers.github.command).toBe("npx");
    expect(config.mcpServers["ctx-mcp"].command).toBe("node");
    expect(config.mcpServers["ctx-mcp"].args[0]).toBe("/tmp/contextos/plugins/ctx/mcp/server.js");
  });

  it("installs Antigravity MCP config for app and CLI config paths", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-agy-mcp-"));
    const appPath = path.join(tmp, "antigravity", "mcp_config.json");
    const cliPath = path.join(tmp, "antigravity-cli", "mcp_config.json");

    const written = installAntigravityMcp({
      configPaths: [appPath, cliPath],
      installRoot: "/tmp/contextos"
    });

    expect(written).toEqual([appPath, cliPath]);
    for (const filePath of written) {
      const config = JSON.parse(fs.readFileSync(filePath, "utf8"));
      expect(config.mcpServers["ctx-mcp"].args[0]).toBe("/tmp/contextos/plugins/ctx/mcp/server.js");
    }
  });

  it("normalizes Antigravity cwd and prompt from transcript payloads", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-agy-transcript-"));
    const transcriptPath = path.join(tmp, "transcript.jsonl");
    fs.writeFileSync(transcriptPath, [
      JSON.stringify({ role: "assistant", content: "old" }),
      JSON.stringify({ role: "user", content: [{ text: "Recheck authen flow" }] })
    ].join("\n"));

    const payload = {
      workspacePaths: [tmp],
      transcriptPath
    };

    expect(antigravityCwd(payload)).toBe(tmp);
    expect(extractPromptFromAntigravityPayload(payload)).toBe("Recheck authen flow");
  });
});
