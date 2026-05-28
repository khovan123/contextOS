import { describe, expect, it } from "vitest";

import { scheduleContext } from "../plugins/ctx/lib/scheduler.js";

describe("scheduler", () => {
  it("puts high-score rules at the beginning and end", () => {
    const scheduled = scheduleContext({
      rules: [
        { id: "r1", content: "Always use zod for validation.", sourcePath: "/repo/AGENTS.md", score: 0.9 },
        { id: "r2", content: "Prefer compact CSS.", sourcePath: "/repo/AGENTS.md", score: 0.2 },
        { id: "r3", content: "Unrelated deployment note.", sourcePath: "/repo/AGENTS.md", score: 0 }
      ],
      relevantFiles: [{ path: "src/auth/login.ts" }],
      suggestedSkills: [{ name: "zod-validator", description: "Use for validation tasks.", path: ".codex/skills/zod-validator/SKILL.md" }]
    });

    expect(scheduled.highRules).toHaveLength(1);
    expect(scheduled.midRules).toHaveLength(1);
    expect(scheduled.droppedRules).toHaveLength(1);
    expect(scheduled.additionalContext).toContain("## Critical ContextOS rules");
    expect(scheduled.additionalContext).toContain("## ContextOS reminders");
    expect(scheduled.additionalContext.match(/Always use zod/g)).toHaveLength(2);
    expect(scheduled.additionalContext).toContain("- src/auth/login.ts");
    expect(scheduled.additionalContext).toContain("## Skills to activate for this task");
    expect(scheduled.additionalContext).toContain("zod-validator");
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
