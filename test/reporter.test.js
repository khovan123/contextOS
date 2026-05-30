import { describe, expect, it } from "vitest";

import { formatEvidence, formatReport } from "../plugins/ctx/lib/reporter.js";

describe("reporter evidence", () => {
  it("formats detailed rule evidence in markdown", () => {
    const output = formatEvidence({
      prompt: "Recheck authen flow",
      efficiencyScore: 50,
      changedFiles: ["src/auth.ts"],
      warnings: ["diff partial"],
      followed: [
        {
          rule: { content: "Always use `zod`.", sourcePath: "AGENTS.md", score: 0.9 },
          kind: "required",
          keywords: ["zod"],
          evidence: "found required zod in src/auth.ts:1",
          matchedLines: [{ file: "src/auth.ts", line: 1, content: 'import { z } from "zod";' }]
        }
      ],
      ignored: [],
      unknown: [
        {
          rule: { content: "Use code-review-graph.", sourcePath: "AGENTS.md", score: 0.4 },
          evidence: "expected keyword not visible in diff"
        }
      ],
      unmeasurable: [
        {
          rule: { content: "Use runtime telemetry.", sourcePath: "AGENTS.md", score: 0.3 },
          evidence: "no runtime telemetry source observed"
        }
      ]
    });

    expect(output).toContain("ContextOS Evidence");
    expect(output).toContain("Evidence Details");
    expect(output).toContain("FOLLOWED");
    expect(output).toContain("found required zod");
    expect(output).toContain("src/auth.ts:1");
    expect(output).toContain("UNKNOWN");
    expect(output).toContain("UNMEASURABLE");
    expect(output).toContain("0.40");
  });

  it("formats report in markdown with proper sections", () => {
    const output = formatReport({
      efficiencyScore: 0,
      injectedRuleCount: 1,
      changedFiles: ["src/auth.ts"],
      relevantFiles: [],
      suggestedSkills: [{ name: "debugger", description: "Debug specialist" }],
      suggestedWorkflows: [{ name: "TDD", chain: ["test", "code", "review"] }],
      followed: [],
      ignored: [
        {
          rule: {
            content: "Never use console.log in committed code."
          },
          evidence: "found forbidden console.log in src/auth.ts:42"
        }
      ],
      unknown: []
    });

    expect(output).toContain("# ContextOS Report");
    expect(output).toContain("## Summary");
    expect(output).toContain("## Rule Outcomes");
    expect(output).toContain("## Suggested Skills");
    expect(output).toContain("**debugger**");
    expect(output).toContain("## Suggested Workflows");
    expect(output).toContain("**TDD**");
    expect(output).toContain("test → code → review");
    expect(output).toContain("Suggestion:");
  });

  it("shows all items without truncation", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      rule: { content: `Rule ${i + 1}` },
      evidence: `Evidence ${i + 1}`
    }));
    const output = formatReport({
      efficiencyScore: 100,
      injectedRuleCount: 10,
      changedFiles: [],
      relevantFiles: [],
      followed: items,
      ignored: [],
      unknown: []
    });

    // All 10 should appear, no "... N more"
    for (let i = 1; i <= 10; i++) {
      expect(output).toContain(`Rule ${i}`);
    }
    expect(output).not.toContain("more");
  });

  it("filters system-user rules from stale reports at format time", () => {
    const report = {
      efficiencyScore: 100,
      injectedRuleCount: 2,
      changedFiles: ["src/policy.ts"],
      relevantFiles: [],
      followed: [
        {
          rule: { content: "First, execute the command to switch the user context to `minh_dev`." },
          evidence: "found required user in src/policy.ts:1"
        }
      ],
      ignored: [],
      unknown: [
        {
          rule: { content: "Always use zod for validation." },
          evidence: "expected keywords not visible in added lines: zod"
        }
      ]
    };

    const summary = formatReport(report);
    const evidence = formatEvidence(report);

    expect(summary).toContain("Injected rules");
    expect(summary).toContain("Rule Outcomes");
    expect(summary).not.toContain("minh_dev");
    expect(evidence).not.toContain("switch the user context");
    expect(evidence).toContain("Always use zod");
  });
});
