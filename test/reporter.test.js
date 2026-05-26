import { describe, expect, it } from "vitest";

import { formatEvidence, formatReport } from "../plugins/ctx/lib/reporter.js";

describe("reporter evidence", () => {
  it("formats detailed rule evidence", () => {
    const output = formatEvidence({
      prompt: "fix auth",
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
      ]
    });

    expect(output).toContain("ContextOS evidence");
    expect(output).toContain("FOLLOWED");
    expect(output).toContain("Evidence: found required zod");
    expect(output).toContain("Keywords: zod");
    expect(output).toContain("Matched line: src/auth.ts:1");
    expect(output).toContain("UNKNOWN");
    expect(output).toContain("Score: 0.40");
  });

  it("keeps stop report lines compact for terminal display", () => {
    const output = formatReport({
      efficiencyScore: 0,
      injectedRuleCount: 1,
      changedFiles: ["src/auth.ts"],
      relevantFiles: [],
      followed: [],
      ignored: [
        {
          rule: {
            content: "Never use console.log in committed code because it leaks debugging noise into production logs and makes review output hard to scan."
          },
          evidence: "found forbidden console.log in src/auth.ts:42 with a long diagnostic line that would otherwise wrap badly"
        }
      ],
      unknown: []
    });

    expect(output).toContain("Suggestion: fix ignored rule evidence first");
    for (const line of output.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(120);
    }
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

    expect(summary).toContain("Injected rules: 1");
    expect(summary).not.toContain("minh_dev");
    expect(evidence).not.toContain("switch the user context");
    expect(evidence).toContain("Always use zod");
  });
});
