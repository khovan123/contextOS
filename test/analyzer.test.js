import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { filterActionableRules, findRelevantFiles, isDocumentationOnlyRule, isSystemUserRule, parseRules, scoreRules } from "../plugins/ctx/lib/analyzer.js";
import { buildGraphQueries, mergeRelevantFiles } from "../plugins/ctx/lib/graph-retriever.js";

describe("analyzer", () => {
  it("parses markdown rules with source attribution", () => {
    const rules = parseRules(`## Source: /repo/AGENTS.md
# Backend
- Always use zod for validation.
1. Never commit console.log.

Plain paragraph with enough content to become a standalone rule.
`);

    expect(rules).toHaveLength(4);
    expect(rules[0]).toMatchObject({
      sourcePath: "/repo/AGENTS.md",
      content: "Backend"
    });
    expect(rules[1].content).toBe("Always use zod for validation.");
  });

  it("scores auth rules above styling rules for auth tasks", () => {
    const rules = parseRules(`## Source: /repo/AGENTS.md
- Always use auth guards for login endpoints.
- Prefer CSS modules for styling.
`);
    const scored = scoreRules(rules, "fix auth login bug", []);

    expect(scored[0].content).toContain("auth guards");
    expect(scored[0].score).toBeGreaterThan(0.5);
    expect(scored.at(-1).content).toContain("CSS modules");
    expect(scored.at(-1).score).toBeLessThan(0.5);
  });

  it("filters system-user shell rules before scheduling", () => {
    const rules = parseRules(`## Source: /repo/AGENTS.md
- All shell commands MUST run as minh_dev, not root.
- Do not prefix every command with sudo -u minh_dev.
- First run sudo su - minh_dev before doing project work.
- @/home/example/.codex/RTK.md
- Always use zod for validation.
`);

    expect(rules).toHaveLength(5);
    expect(isSystemUserRule("sudo -i -u minh_dev")).toBe(true);
    expect(filterActionableRules(rules).map((rule) => rule.content)).toEqual([
      "Always use zod for validation."
    ]);
  });

  it("filters documentation-only headings and tool reference tables", () => {
    const rules = parseRules(`## Source: /repo/AGENTS.md
# MCP Tools: code-review-graph
- <!-- code-review-graph MCP tools -->
- Key Tools
- Workflow
- | Tool | Use when | |------|----------| | \`detect_changes\` | Reviewing code changes | | \`query_graph\` | Tracing relationships |
- Use \`detect_changes\` for code review.
- **Exploring code**: \`semantic_search_nodes\` or \`query_graph\` instead of Grep
`);

    expect(isDocumentationOnlyRule("MCP Tools: code-review-graph")).toBe(true);
    expect(isDocumentationOnlyRule("Use `detect_changes` for code review.")).toBe(false);
    expect(filterActionableRules(rules).map((rule) => rule.content)).toEqual([
      "Use `detect_changes` for code review.",
      "**Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep"
    ]);
  });

  it("finds relevant files from task keywords", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-files-"));
    fs.mkdirSync(path.join(tmp, "src", "auth"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "node_modules", "auth"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "src", "auth", "login.ts"), "");
    fs.writeFileSync(path.join(tmp, "src", "style.css"), "");
    fs.writeFileSync(path.join(tmp, "node_modules", "auth", "ignored.ts"), "");

    const files = await findRelevantFiles({ cwd: tmp, task: "fix auth login", limit: 3 });

    expect(files[0].path).toBe(path.join("src", "auth", "login.ts"));
    expect(files.map((file) => file.path)).not.toContain(path.join("node_modules", "auth", "ignored.ts"));
  });

  it("finds semantically related moderation files from Vietnamese task terms", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-semantic-files-"));
    fs.mkdirSync(path.join(tmp, "services", "content-service", "src"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "services", "upload-service", "src"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "services", "content-service", "src", "content-moderation.service.ts"), "");
    fs.writeFileSync(path.join(tmp, "services", "upload-service", "src", "confirm-resource-upload.handler.ts"), "");
    fs.writeFileSync(path.join(tmp, "services", "content-service", "src", "profile.service.ts"), "");

    const files = await findRelevantFiles({ cwd: tmp, task: "kiem duyet upload", limit: 3 });

    expect(files[0].path).toBe(path.join("services", "content-service", "src", "content-moderation.service.ts"));
    expect(files.map((file) => file.path)).toContain(path.join("services", "upload-service", "src", "confirm-resource-upload.handler.ts"));
  });

  it("boosts files connected by relative imports", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-import-files-"));
    fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "src", "upload.ts"), "export const uploadService = {};\n");
    fs.writeFileSync(path.join(tmp, "src", "consumer.ts"), "import { uploadService } from './upload';\n");

    const files = await findRelevantFiles({ cwd: tmp, task: "fix upload", limit: 3 });

    expect(files.map((file) => file.path)).toContain(path.join("src", "consumer.ts"));
    expect(files.find((file) => file.path === path.join("src", "consumer.ts")).source).toBe("import-graph");
  });

  it("uses embedding file candidates before import graph expansion", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-file-embedding-"));
    fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "src", "content-moderation.service.ts"), "export const moderation = true;\n");
    fs.writeFileSync(path.join(tmp, "src", "consumer.ts"), "import { moderation } from './content-moderation.service';\n");

    const files = await findRelevantFiles({
      cwd: tmp,
      task: "kiem duyet",
      limit: 3,
      embeddingFileFinder: async () => [
        {
          path: path.join("src", "content-moderation.service.ts"),
          score: 7,
          source: "embedding",
          reasons: ["file-embedding:0.70"]
        }
      ]
    });

    expect(files[0]).toMatchObject({
      path: path.join("src", "content-moderation.service.ts"),
      source: "embedding"
    });
    expect(files.map((file) => file.path)).toContain(path.join("src", "consumer.ts"));
  });

  it("scores English moderation rules for Vietnamese moderation prompts", () => {
    const rules = parseRules(`## Source: /repo/AGENTS.md
- Always run content moderation before approving uploaded resources.
- Prefer CSS modules for styling.
`);
    const scored = scoreRules(rules, "kiem duyet upload", []);

    expect(scored[0].content).toContain("content moderation");
    expect(scored[0].score).toBeGreaterThan(0.5);
  });

  it("builds graph retrieval queries from scored project rules", () => {
    const queries = buildGraphQueries({
      task: "kiem duyet upload",
      seedFiles: [
        {
          path: path.join("services", "content-service", "src", "content-moderation.service.ts")
        }
      ],
      rules: [
        {
          content: "Always run content moderation before approving uploaded resources.",
          score: 0.8
        }
      ]
    });

    expect(queries).toContain("kiem duyet upload");
    expect(queries).toContain("content-moderation.service");
    expect(
      buildGraphQueries({
        task: "kiem duyet upload",
        rules: [
          {
            content: "Always run content moderation before approving uploaded resources.",
            score: 0.8
          }
        ]
      })
    ).toContain("content moderation");
  });

  it("prefers graph file matches over heuristic file matches", () => {
    const files = mergeRelevantFiles({
      graphFiles: [
        {
          path: path.join("src", "content-moderation.service.ts"),
          score: 2,
          reasons: ["graph:content moderation"]
        }
      ],
      heuristicFiles: [
        {
          path: path.join("src", "upload.service.ts"),
          score: 8,
          reasons: ["upload"]
        }
      ],
      limit: 2
    });

    expect(files[0]).toMatchObject({
      path: path.join("src", "content-moderation.service.ts"),
      source: "graph"
    });
  });
});
