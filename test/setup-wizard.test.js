import { describe, expect, it } from "vitest";

import {
  normalizeSetupAgent,
  parseAgentList,
  parseSetupArgs,
  setupSummaryLines
} from "../plugins/ctx/lib/setup-wizard.js";

describe("setup wizard", () => {
  it("parses setup defaults", () => {
    expect(parseSetupArgs([])).toEqual({
      agents: ["codex", "claude", "agy"],
      yes: false,
      quiet: false,
      inject: true,
      syncRules: true,
      syncSkills: true
    });
  });

  it("parses setup flags", () => {
    expect(parseSetupArgs([
      "--yes",
      "--quiet",
      "--no-inject",
      "--no-rules",
      "--no-skills",
      "--agents",
      "codex,antigravity,agy"
    ])).toEqual({
      agents: ["codex", "agy"],
      yes: true,
      quiet: true,
      inject: false,
      syncRules: false,
      syncSkills: false
    });
    expect(parseSetupArgs(["--quiet"]).inject).toBe(false);
  });

  it("normalizes agent aliases", () => {
    expect(normalizeSetupAgent("Antigravity")).toBe("agy");
    expect(parseAgentList("codex, claude, antigravity")).toEqual(["codex", "claude", "agy"]);
  });

  it("formats setup summary lines", () => {
    expect(setupSummaryLines({
      cwd: "/repo",
      agents: ["codex"],
      inject: false,
      syncRules: false,
      syncSkills: true
    })).toEqual([
      "Installation directory: /repo",
      "Agents: codex",
      "Prompt context injection: quiet logging only",
      "Ruler rule/MCP sync: skipped",
      "skillshare skill sync: enabled"
    ]);
  });
});
