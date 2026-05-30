import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { handlePromptPayload } from "../plugins/ctx/lib/prompt-hook.js";
import { handleStopPayload } from "../plugins/ctx/lib/stop-hook.js";
import { logError, persistRuntime } from "../plugins/ctx/lib/hook-io.js";

function mockScoreContext({ rules = [{ content: "Always use zod for validation.", score: 1, reasons: ["mock"], sourcePath: "AGENTS.md" }] } = {}) {
  return async () => ({
    scoredRules: rules,
    suggestedFiles: [],
    suggestedSkills: [{ name: "zod-validator", description: "Use for validation tasks.", path: ".codex/skills/zod-validator/SKILL.md", score: 0.9 }],
    suggestedWorkflows: [{ name: "primary-workflow", title: "Primary Workflow", chain: ["planner", "tester"], hint: "use for feature implementation", relativePath: ".claude/workflows/primary-workflow.md", score: 0.8 }],
    telemetry: {
      elapsedMs: 3,
      modelStatus: "mock",
      rulesParsed: rules.length,
      rulesInjected: rules.length,
      filesSuggested: 0,
      skillsSuggested: 1,
      workflowsSuggested: 1
    }
  });
}

describe("hook contracts", () => {
  it("on-prompt handler injects context by default", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-hook-"));
    const dataPath = path.join(tmp, ".data", "last-prompt-context.json");
    fs.writeFileSync(path.join(tmp, "AGENTS.md"), "- Always use zod for validation.\n");

    const output = await handlePromptPayload(
      { prompt: "fix zod validation", cwd: tmp, hook_event_name: "UserPromptSubmit" },
      { dataPath, scoreContextClient: mockScoreContext() }
    );

    expect(output.continue).toBe(true);
    expect(output.suppressOutput).toBe(true);
    expect(output.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(output.hookSpecificOutput.additionalContext).toContain("zod");
    expect(output.hookSpecificOutput.additionalContext).toContain("zod-validator");
    expect(output.hookSpecificOutput.additionalContext).toContain("Suggested workflow");
    expect(output.hookSpecificOutput.additionalContext).toContain("planner -> tester");
    expect(fs.existsSync(dataPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(dataPath, "utf8")).injected).toBe(true);
    expect(JSON.parse(fs.readFileSync(dataPath, "utf8")).scheduled.additionalContext).toContain("zod");
    expect(JSON.parse(fs.readFileSync(dataPath, "utf8")).suggestedSkills).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(dataPath, "utf8")).suggestedWorkflows).toHaveLength(1);
  });

  it("on-prompt handler can run quiet when disabled", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-hook-quiet-"));
    fs.writeFileSync(path.join(tmp, "AGENTS.md"), "- Always use zod for validation.\n");

    const output = await handlePromptPayload(
      { prompt: "fix zod validation", cwd: tmp, hook_event_name: "UserPromptSubmit" },
      { injectContext: false, scoreContextClient: mockScoreContext() }
    );

    expect(output.continue).toBe(true);
    expect(output.suppressOutput).toBe(true);
    expect(output.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(output.hookSpecificOutput.additionalContext).toBe("");
  });

  it("still injects prompt context when runtime persistence fails", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-hook-persist-fail-"));
    const blockedPath = path.join(tmp, "not-a-dir");
    fs.writeFileSync(blockedPath, "file");

    const output = await handlePromptPayload(
      { prompt: "fix zod validation", cwd: tmp, hook_event_name: "UserPromptSubmit" },
      {
        dataPath: path.join(blockedPath, "last-prompt-context.json"),
        historyPath: path.join(blockedPath, "history.jsonl"),
        scoreContextClient: mockScoreContext()
      }
    );

    expect(output.continue).toBe(true);
    expect(output.hookSpecificOutput.additionalContext).toContain("zod");
  });

  it("falls back to direct scoring when the MCP bridge is unavailable", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-hook-bridge-fallback-"));
    const dataPath = path.join(tmp, ".data", "last-prompt-context.json");
    fs.writeFileSync(path.join(tmp, "AGENTS.md"), "- Always use code-review-graph before reading files.\n");

    const output = await handlePromptPayload(
      { prompt: "review code changes", cwd: tmp, hook_event_name: "UserPromptSubmit" },
      {
        dataPath,
        mcpDataDir: path.join(tmp, ".ctx-data"),
        scoreContextClient: async () => {
          throw new Error("ctx-mcp bridge socket not found");
        }
      }
    );
    const runtime = JSON.parse(fs.readFileSync(dataPath, "utf8"));

    expect(output.continue).toBe(true);
    expect(output.hookSpecificOutput.additionalContext).toContain("code-review-graph");
    expect(runtime.telemetry.bridgeStatus).toBe("fallback");
  });

  it("on-stop handler returns valid JSON when no git repo exists", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-stop-"));
    fs.mkdirSync(path.join(tmp, ".data"), { recursive: true });
    const contextPath = path.join(tmp, ".data", "last-prompt-context.json");
    const reportPath = path.join(tmp, ".data", "last-report.json");
    fs.writeFileSync(contextPath, JSON.stringify({
      prompt: "Recheck authen flow",
      rules: [{ content: "Always use auth guards.", score: 1 }],
      relevantFiles: [],
      scheduled: { highRules: [{ content: "Always use auth guards.", score: 1 }], midRules: [] }
    }));

    const output = handleStopPayload(
      { cwd: tmp, hook_event_name: "Stop" },
      { contextPath, reportPath }
    );

    expect(output.continue).toBe(true);
    expect(output).not.toHaveProperty("message");
    expect(output).not.toHaveProperty("hookSpecificOutput");
    expect(output.systemMessage).toContain("ContextOS Report");
    expect(output.systemMessage).toContain("Rule Outcomes");
    expect(fs.existsSync(reportPath)).toBe(true);
  });

  it("on-stop measures mid-priority scheduled rules", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-stop-mid-"));
    fs.mkdirSync(path.join(tmp, ".data"), { recursive: true });
    const contextPath = path.join(tmp, ".data", "last-prompt-context.json");
    const reportPath = path.join(tmp, ".data", "last-report.json");
    fs.writeFileSync(contextPath, JSON.stringify({
      prompt: "check graph workflow",
      rules: [],
      relevantFiles: [],
      scheduled: {
        highRules: [],
        midRules: [{ content: "Always use `code-review-graph` before reading files.", score: 0.4 }]
      }
    }));

    handleStopPayload(
      { cwd: tmp, hook_event_name: "Stop" },
      { contextPath, reportPath }
    );

    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    expect(report.unmeasurable).toHaveLength(1);
    expect(report.unmeasurable[0].rule.content).toContain("code-review-graph");
  });

  it("on-stop filters system-user rules from stale scheduled context", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-stop-filter-user-"));
    fs.mkdirSync(path.join(tmp, ".data"), { recursive: true });
    const contextPath = path.join(tmp, ".data", "last-prompt-context.json");
    const reportPath = path.join(tmp, ".data", "last-report.json");
    fs.writeFileSync(contextPath, JSON.stringify({
      prompt: "fix zod validation",
      rules: [],
      relevantFiles: [],
      scheduled: {
        highRules: [
          { content: "First, execute the command to switch the user context to `minh_dev`.", score: 0.9 },
          { content: "Always use zod for validation.", score: 0.8 }
        ],
        midRules: [
          { content: "**All shell commands MUST run as `minh_dev`, not root.**", score: 0.4 }
        ]
      }
    }));
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ dependencies: { zod: "^4.0.0" } }));

    handleStopPayload(
      { cwd: tmp, hook_event_name: "Stop" },
      { contextPath, reportPath }
    );

    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    const allRules = [...report.followed, ...report.ignored, ...report.unknown, ...report.unmeasurable].map((item) => item.rule.content);
    expect(allRules).toEqual(["Always use zod for validation."]);
    expect(report.injectedRuleCount).toBe(1);
  });

  it("on-stop uses runtime telemetry to score workflow rules", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-stop-telemetry-"));
    fs.mkdirSync(path.join(tmp, ".data"), { recursive: true });
    const contextPath = path.join(tmp, ".data", "last-prompt-context.json");
    const reportPath = path.join(tmp, ".data", "last-report.json");
    const telemetryPath = path.join(tmp, ".data", "telemetry.jsonl");
    fs.writeFileSync(contextPath, JSON.stringify({
      at: "2026-01-01T00:00:00.000Z",
      prompt: "check graph workflow",
      rules: [],
      relevantFiles: [],
      scheduled: {
        highRules: [],
        midRules: [{ content: "Always use `code-review-graph` before reading files.", score: 0.4 }]
      }
    }));
    fs.writeFileSync(telemetryPath, `${JSON.stringify({
      at: "2026-01-01T00:00:01.000Z",
      event: "ToolCall",
      cwd: tmp,
      signals: ["code-review-graph", "semantic_search_nodes"],
      toolSignals: ["code-review-graph.semantic_search_nodes"],
      commandSignals: []
    })}\n`);

    const output = handleStopPayload(
      { cwd: tmp, hook_event_name: "Stop" },
      { contextPath, reportPath, telemetryPath }
    );

    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    expect(report.followed).toHaveLength(1);
    expect(report.followed[0]).toMatchObject({ kind: "runtime" });
    expect(report.followed[0].evidence).toContain("runtime telemetry observed code-review-graph");
    expect(output.systemMessage).toContain("Runtime Telemetry");
    expect(output.systemMessage).toContain("code-review-graph.semantic_search_nodes");
  });

  it("keeps diagnostic writes best-effort when data dir is not writable", () => {
    const previous = process.env.PLUGIN_DATA;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-unwritable-data-"));
    const fileDataDir = path.join(tmp, "not-a-directory");
    fs.writeFileSync(fileDataDir, "file");
    process.env.PLUGIN_DATA = fileDataDir;

    expect(() => logError("UserPromptSubmit", new Error("boom"))).not.toThrow();
    expect(() => persistRuntime("last-prompt-context.json", { ok: true })).not.toThrow();

    if (previous === undefined) delete process.env.PLUGIN_DATA;
    else process.env.PLUGIN_DATA = previous;
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
