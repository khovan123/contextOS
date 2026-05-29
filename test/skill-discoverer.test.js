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

  it("truncates very long descriptions before scoring", () => {
    const skill = parseSkillFrontmatter([
      "---",
      "name: huge-skill",
      `description: ${"long ".repeat(300)}`,
      "---"
    ].join("\n"), {
      skillPath: "/repo/.codex/skills/huge-skill/SKILL.md"
    });

    expect(skill.description.length).toBeLessThanOrEqual(500);
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

  it("scans Antigravity skill directories", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-agy-skills-"));
    const skillDir = path.join(tmp, ".gemini", "antigravity", "skills", "payment-integration");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), [
      "---",
      "name: payment-integration",
      "description: Use for payment checkout and billing webhook tasks.",
      "---"
    ].join("\n"));

    const skills = scanSkills({
      cwd: tmp,
      roots: [path.join(tmp, ".gemini", "antigravity", "skills")]
    });

    expect(skills.map((skill) => skill.name)).toContain("payment-integration");
  });

  it("caches scans even when the max skill limit is reached", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-skill-cache-"));
    const root = path.join(tmp, ".codex", "skills");
    writeSkill(path.join(root, "one"), "one");
    writeSkill(path.join(root, "two"), "two");

    const first = scanSkills({ cwd: tmp, roots: [root], maxSkills: 1 });
    fs.rmSync(path.join(root, "one"), { recursive: true, force: true });
    fs.rmSync(path.join(root, "two"), { recursive: true, force: true });
    const second = scanSkills({ cwd: tmp, roots: [root], maxSkills: 1 });

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0].name).toBe(first[0].name);
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

function writeSkill(directory, name) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "SKILL.md"), [
    "---",
    `name: ${name}`,
    `description: Use for ${name} tasks.`,
    "---"
  ].join("\n"));
}
