import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { formatContextOSReady, inspectContextOSReady } from "../plugins/ctx/lib/certification.js";

describe("ContextOS certification doctor", () => {
  it("scores a repository with rules, skills, and workflows as gold", () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, "AGENTS.md"), [
      "- Always use focused tests before broad test suites.",
      "- Never edit generated files directly.",
      "- Use project skills when a task matches their evidence.",
      "- Prefer workflow handoffs for implementation tasks."
    ].join("\n"));

    writeSkill(repo, "jwt-auth");
    writeSkill(repo, "prisma");
    writeSkill(repo, "redis");
    writeWorkflow(repo, ".codex/workflows/primary.md", [
      "# Primary Workflow",
      "",
      "Use this workflow for feature delivery, debugging, and test fixes.",
      "",
      "planner -> tester -> code-reviewer -> docs-manager",
      "",
      "Inspect the task, implement the smallest change, verify, then document relevant behavior."
    ]);
    writeWorkflow(repo, ".claude/workflows/release.md", [
      "# Release Workflow",
      "",
      "Use this workflow for release preparation and validation.",
      "",
      "planner -> tester -> docs-manager",
      "",
      "Check changelog, version, packaging, and release notes before publishing."
    ]);

    const result = inspectContextOSReady({ cwd: repo, home: path.join(repo, "home") });
    const output = formatContextOSReady(result);

    expect(result.tier).toBe("Gold");
    expect(result.overall).toBeGreaterThanOrEqual(85);
    expect(output).toContain("Repository Score");
    expect(output).toContain("ContextOS Ready Gold");
  });

  it("does not certify a repository missing skills and workflows", () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, "AGENTS.md"), "- Always run focused tests.\n- Use project rules.\n- Avoid unrelated edits.\n");

    const result = inspectContextOSReady({ cwd: repo, home: path.join(repo, "home") });
    const output = formatContextOSReady(result);

    expect(result.tier).toBe("Not Ready");
    expect(result.skills.score).toBe(0);
    expect(result.workflows.score).toBe(0);
    expect(output).toContain("ContextOS Ready: Not Ready");
    expect(output).toContain("Add project skills");
  });
});

function makeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-certified-"));
  fs.mkdirSync(path.join(repo, ".git"));
  return repo;
}

function writeSkill(repo, id) {
  const skillDir = path.join(repo, ".codex", "skills", id);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), [
    "---",
    `name: ${id}`,
    `description: ${id} project skill.`,
    "---",
    "",
    `# ${id}`,
    "",
    "Use this skill when project evidence matches the routing metadata."
  ].join("\n"));
  fs.writeFileSync(path.join(skillDir, "skill.yaml"), [
    `id: ${id}`,
    `name: ${id}`,
    `description: ${id} project skill.`,
    "positive_triggers:",
    "  prompts: [auth, database, cache]",
    "  files: [package.json]",
    "  dependencies: [example]",
    "evidence:",
    "  files: [package.json]",
    "  dependencies: [example]",
    "negative_triggers:",
    "  prompts: [unrelated]",
    "workflow:",
    "  - Inspect project evidence.",
    "  - Patch the smallest boundary.",
    "  - Run focused verification."
  ].join("\n"));
}

function writeWorkflow(repo, relativePath, lines) {
  const filePath = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join("\n"));
}
