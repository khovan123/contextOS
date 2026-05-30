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
      agentsProvided: false,
      yes: false,
      quiet: false,
      syncRules: true,
      syncSkills: true
    });
  });

  it("parses setup flags", () => {
    expect(parseSetupArgs([
      "--yes",
      "--quiet",
      "--no-rules",
      "--no-skills",
      "--agents",
      "codex,antigravity,agy"
    ])).toEqual({
      agents: ["codex", "agy"],
      agentsProvided: true,
      yes: true,
      quiet: true,
      syncRules: false,
      syncSkills: false
    });
  });

  it("normalizes agent aliases", () => {
    expect(normalizeSetupAgent("Antigravity")).toBe("agy");
    expect(parseAgentList("codex, claude, antigravity")).toEqual(["codex", "claude", "agy"]);
  });

  it("formats setup summary lines with always-on injection", () => {
    expect(setupSummaryLines({
      cwd: "/repo",
      agents: ["codex"],
      syncRules: false,
      syncSkills: true
    })).toEqual([
      "Installation directory: /repo",
      "Agents: codex",
      "Prompt context injection: always enabled",
      "Ruler rule/MCP sync: skipped",
      "skillshare skill sync: enabled"
    ]);
  });
});
