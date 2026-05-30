import { describe, expect, it } from "vitest";

import { scheduleContext } from "../plugins/ctx/lib/scheduler.js";

describe("scheduler", () => {
  it("puts high-score rules at the beginning", () => {
    const scheduled = scheduleContext({
      rules: [
        { id: "r1", content: "Always use zod for validation.", sourcePath: "/repo/AGENTS.md", score: 0.9 },
        { id: "r2", content: "Prefer compact CSS.", sourcePath: "/repo/AGENTS.md", score: 0.2 },
        { id: "r3", content: "Unrelated deployment note.", sourcePath: "/repo/AGENTS.md", score: 0 }
      ],
      relevantFiles: [{ path: "src/auth/login.ts" }],
      suggestedSkills: [{ name: "zod-validator", description: "Use for validation tasks.", path: ".codex/skills/zod-validator/SKILL.md" }],
      suggestedWorkflows: [{
        name: "primary-workflow",
        title: "Primary Workflow",
        hint: "use for feature implementation, testing, review, and debugging",
        chain: ["planner", "tester", "code-reviewer"],
        relativePath: ".claude/workflows/primary-workflow.md"
      }]
    });

    expect(scheduled.highRules).toHaveLength(1);
    expect(scheduled.midRules).toHaveLength(1);
    expect(scheduled.droppedRules).toHaveLength(1);
    expect(scheduled.additionalContext).toContain("## Critical ContextOS rules");
    // Rules should appear once (no duplicate "reminders" section)
    expect(scheduled.additionalContext.match(/Always use zod/g)).toHaveLength(1);
    // No absolute paths in rule output
    expect(scheduled.additionalContext).not.toContain("/repo/AGENTS.md");
    expect(scheduled.additionalContext).toContain("- src/auth/login.ts");
    expect(scheduled.additionalContext).toContain("## Skills to activate for this task");
    expect(scheduled.additionalContext).toContain("zod-validator");
    // No absolute paths in skill output
    expect(scheduled.additionalContext).not.toContain(".codex/skills/");
    expect(scheduled.additionalContext).toContain("## Suggested workflow for this task");
    expect(scheduled.additionalContext).toContain("Primary Workflow");
    expect(scheduled.additionalContext).toContain("planner -> tester -> code-reviewer");
    // No "see: …" path in workflow output
    expect(scheduled.additionalContext).not.toContain("see:");
  });

  it("trims output to max chars", () => {
    const scheduled = scheduleContext({
      rules: [{ id: "r1", content: "Always " + "very ".repeat(100), score: 1 }],
      maxChars: 120
    });

    expect(scheduled.additionalContext.length).toBeLessThanOrEqual(140);
    expect(scheduled.additionalContext).toContain("truncated");
  });
});
