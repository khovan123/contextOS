import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseWorkflowFile, scanWorkflows, suggestWorkflows } from "../plugins/ctx/lib/workflow-discoverer.js";

function writeWorkflow(root, name, content) {
  fs.mkdirSync(root, { recursive: true });
  const filePath = path.join(root, `${name}.md`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

describe("workflow discoverer", () => {
  it("parses markdown workflow files without frontmatter", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-workflow-"));
    const workflowsRoot = path.join(tmp, ".claude", "workflows");
    const filePath = writeWorkflow(workflowsRoot, "primary-workflow", [
      "# Primary Workflow",
      "",
      "Use this workflow for feature delivery.",
      "",
      "#### 1. Code Implementation",
      "Delegate design work to `planner`.",
      "",
      "#### 2. Testing",
      "Use `tester` and `code-reviewer` before finishing.",
      "",
      "#### 3. Documentation",
      "Ask `docs-manager` when docs change."
    ].join("\n"));

    const workflow = parseWorkflowFile(filePath, { cwd: tmp, root: workflowsRoot });

    expect(workflow).toMatchObject({
      name: "primary-workflow",
      title: "Primary Workflow",
      scope: "project"
    });
    expect(workflow.description).toContain("Code Implementation");
    expect(workflow.chain).toEqual(expect.arrayContaining(["planner", "tester", "code-reviewer", "docs-manager"]));
    expect(workflow.relativePath).toBe(path.join(".claude", "workflows", "primary-workflow.md"));
  });

  it("scans project workflow directories and skips tiny stubs", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-workflow-scan-"));
    const workflowsRoot = path.join(tmp, ".claude", "workflows");
    writeWorkflow(workflowsRoot, "primary-workflow", [
      "# Primary Workflow",
      "",
      "Use this workflow for feature delivery.",
      "",
      "#### Code Implementation",
      "Delegate to `planner` and `tester` for complex implementation tasks."
    ].join("\n"));
    fs.writeFileSync(path.join(workflowsRoot, "empty.md"), "# Empty\n");

    const workflows = scanWorkflows({ cwd: tmp, roots: [workflowsRoot] });

    expect(workflows.map((workflow) => workflow.name)).toEqual(["primary-workflow"]);
  });

  it("suggests the implementation workflow for feature prompts", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-workflow-score-"));
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-workflow-data-"));
    const workflowsRoot = path.join(tmp, ".claude", "workflows");
    writeWorkflow(workflowsRoot, "primary-workflow", [
      "# Primary Workflow",
      "",
      "Feature development workflow.",
      "",
      "#### Code Implementation",
      "Implementation work delegates to `planner`, `tester`, and `code-reviewer`.",
      "",
      "#### Debugging",
      "Fix failing tests and CI issues."
    ].join("\n"));
    writeWorkflow(workflowsRoot, "documentation-management", [
      "# Documentation Management",
      "",
      "Documentation workflow for README, changelog, and roadmap updates.",
      "",
      "### Documentation Updates",
      "Use `docs-manager` when docs need to be updated."
    ].join("\n"));

    const suggested = await suggestWorkflows({
      prompt: "implement a new payment feature and add tests",
      workflows: scanWorkflows({ cwd: tmp, roots: [workflowsRoot] }),
      dataDir,
      limit: 2,
      timeoutMs: 1
    });

    expect(suggested[0].name).toBe("primary-workflow");
    expect(suggested[0].chain).toEqual(expect.arrayContaining(["planner", "tester", "code-reviewer"]));
  });

  it("suggests documentation workflow for docs prompts", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-workflow-docs-"));
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-workflow-docs-data-"));
    const workflowsRoot = path.join(tmp, ".claude", "workflows");
    writeWorkflow(workflowsRoot, "primary-workflow", [
      "# Primary Workflow",
      "",
      "Feature implementation and testing workflow.",
      "",
      "#### Code Implementation",
      "Use `planner`, `tester`, and `code-reviewer`."
    ].join("\n"));
    writeWorkflow(workflowsRoot, "documentation-management", [
      "# Documentation Management",
      "",
      "Documentation workflow for docs, README, changelog, and roadmap updates.",
      "",
      "### README Updates",
      "Use `docs-manager` and `project-manager` for documentation changes."
    ].join("\n"));

    const suggested = await suggestWorkflows({
      prompt: "update API documentation and README",
      workflows: scanWorkflows({ cwd: tmp, roots: [workflowsRoot] }),
      dataDir,
      limit: 2,
      timeoutMs: 1
    });

    expect(suggested[0].name).toBe("documentation-management");
  });
});
