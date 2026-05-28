import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseSkillFrontmatter, scanSkills, suggestSkills } from "../plugins/ctx/lib/skill-discoverer.js";

describe("skill discoverer", () => {
  it("parses SKILL.md YAML frontmatter", () => {
    const skill = parseSkillFrontmatter([
      "---",
      "name: payment-integration",
      "description: Use when building payment provider webhooks and checkout flows.",
      "---",
      "",
      "# Payment"
    ].join("\n"), {
      fallbackName: "fallback",
      skillPath: "/repo/.claude/skills/payment-integration/SKILL.md"
    });

    expect(skill).toMatchObject({
      name: "payment-integration",
      description: "Use when building payment provider webhooks and checkout flows.",
      path: "/repo/.claude/skills/payment-integration/SKILL.md"
    });
  });

  it("falls back to directory name and first body paragraph", () => {
    const skill = parseSkillFrontmatter("# Debugger\n\nUse for root cause analysis.", {
      skillPath: "/repo/.codex/skills/debugger/SKILL.md"
    });

    expect(skill.name).toBe("debugger");
    expect(skill.description).toBe("Debugger");
  });

  it("scans global/project style skill directories", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-skills-"));
    const skillDir = path.join(tmp, ".claude", "skills", "planning");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), [
      "---",
      "name: planning",
      "description: Use for task breakdown and architecture decisions.",
      "---"
    ].join("\n"));

    const skills = scanSkills({
      cwd: tmp,
      roots: [path.join(tmp, ".claude", "skills")]
    });

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ name: "planning" });
  });

  it("suggests top skills without being affected by catalog size/order", async () => {
    const skills = Array.from({ length: 50 }, (_, index) => ({
      name: `zzz-${index}`,
      description: "Use for unrelated infrastructure maintenance.",
      path: `/skills/zzz-${index}/SKILL.md`
    }));
    skills.push({
      name: "payment-integration",
      description: "Use when creating payment provider integrations, checkout sessions, billing webhooks, and invoices.",
      path: "/skills/payment-integration/SKILL.md"
    });

    const suggested = await suggestSkills({
      prompt: "create a new payment integration with checkout webhook",
      skills,
      dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "ctx-skill-data-")),
      limit: 3,
      timeoutMs: 1
    });

    expect(suggested[0].name).toBe("payment-integration");
  });
});
