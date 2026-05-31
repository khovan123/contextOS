import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { filterActionableRules, findRelevantFiles, isDocumentationOnlyRule, isSystemUserRule, parseRules, scoreRules } from "../plugins/ctx/lib/analyzer.js";
import { findEmbeddingRelevantFiles } from "../plugins/ctx/lib/file-embedding-retriever.js";
import { expandImportGraph, rebuildImportGraphIndex } from "../plugins/ctx/lib/import-graph.js";
import { buildGraphQueries, findGraphRelevantFiles, mergeRelevantFiles } from "../plugins/ctx/lib/graph-retriever.js";
import { loadRuntimeEvidence } from "../plugins/ctx/lib/telemetry.js";

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
    expect(filterActionableRules(rules).map((rule) => rule.content)).not.toContain("Backend");
  });

  it("scores auth rules above styling rules for auth tasks", () => {
    const rules = parseRules(`## Source: /repo/AGENTS.md
- Always use auth guards for login endpoints.
- Prefer CSS modules for styling.
`);
    const scored = scoreRules(rules, "Recheck authen flow", []);

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

  it("does not fall back to filename heuristics when embeddings are unavailable", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-files-"));
    fs.mkdirSync(path.join(tmp, "src", "auth"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "node_modules", "auth"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "src", "auth", "login.ts"), "");
    fs.writeFileSync(path.join(tmp, "src", "style.css"), "");
    fs.writeFileSync(path.join(tmp, "node_modules", "auth", "ignored.ts"), "");

    const files = await findRelevantFiles({
      cwd: tmp,
      task: "Recheck authen flow",
      limit: 3,
      embeddingFileFinder: async () => []
    });

    expect(files).toEqual([]);
  });

  it("queries the persisted file embedding index without walking source files", async () => {
    const missingCwd = path.join(os.tmpdir(), "ctx-no-source-tree", String(Date.now()));
    const files = await findEmbeddingRelevantFiles({
      cwd: missingCwd,
      task: "kiem duyet",
      dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "ctx-file-index-")),
      indexedSearcher: async ({ kind, task, timeoutMs }) => {
        expect(kind).toBe(`file:${path.resolve(missingCwd)}`);
        expect(task).toBe("kiem duyet");
        expect(timeoutMs).toBe(1000);
        return {
          status: "enabled",
          items: [
            { id: "src/content-moderation.service.ts", embeddingScore: 0.82 },
            { id: "src/profile.service.ts", embeddingScore: 0.2 }
          ]
        };
      }
    });

    expect(files).toEqual([
      {
        path: "src/content-moderation.service.ts",
        score: 8,
        source: "embedding",
        reasons: ["file-embedding:0.82"]
      }
    ]);
  });

  it("uses embedding file candidates for Vietnamese moderation terms", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-semantic-files-"));
    fs.mkdirSync(path.join(tmp, "services", "content-service", "src"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "services", "upload-service", "src"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "services", "content-service", "src", "content-moderation.service.ts"), "");
    fs.writeFileSync(path.join(tmp, "services", "upload-service", "src", "confirm-resource-upload.handler.ts"), "");
    fs.writeFileSync(path.join(tmp, "services", "content-service", "src", "profile.service.ts"), "");

    const files = await findRelevantFiles({
      cwd: tmp,
      task: "kiem duyet upload",
      limit: 3,
      embeddingFileFinder: async () => [
        {
          path: path.join("services", "content-service", "src", "content-moderation.service.ts"),
          score: 7,
          source: "embedding",
          reasons: ["file-embedding:0.70"]
        },
        {
          path: path.join("services", "upload-service", "src", "confirm-resource-upload.handler.ts"),
          score: 6,
          source: "embedding",
          reasons: ["file-embedding:0.60"]
        }
      ]
    });

    expect(files[0].path).toBe(path.join("services", "content-service", "src", "content-moderation.service.ts"));
    expect(files.map((file) => file.path)).toContain(path.join("services", "upload-service", "src", "confirm-resource-upload.handler.ts"));
  });

  it("boosts files connected by relative imports", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-import-files-"));
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-import-index-"));
    fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "src", "upload.ts"), "export const uploadService = {};\n");
    fs.writeFileSync(path.join(tmp, "src", "consumer.ts"), "import { uploadService } from './upload';\n");
    rebuildImportGraphIndex({ cwd: tmp, dataDir, files: ["src/upload.ts", "src/consumer.ts"] });

    const files = await findRelevantFiles({
      cwd: tmp,
      dataDir,
      task: "fix upload",
      limit: 3,
      embeddingFileFinder: async () => [
        {
          path: path.join("src", "upload.ts"),
          score: 7,
          source: "embedding",
          reasons: ["file-embedding:0.70"]
        }
      ]
    });

    expect(files.map((file) => file.path)).toContain(path.join("src", "consumer.ts"));
    expect(files.find((file) => file.path === path.join("src", "consumer.ts")).source).toBe("import-graph");
  });

  it("expands persisted import adjacency without reading the source tree", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-import-persisted-"));
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-import-persisted-index-"));
    fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "src", "upload.ts"), "export const upload = true;\n");
    fs.writeFileSync(path.join(tmp, "src", "consumer.ts"), "import { upload } from './upload';\n");
    rebuildImportGraphIndex({ cwd: tmp, dataDir, files: ["src/upload.ts", "src/consumer.ts"] });
    fs.rmSync(path.join(tmp, "src"), { recursive: true });

    expect(expandImportGraph({
      cwd: tmp,
      dataDir,
      seedFiles: [{ path: "src/upload.ts" }]
    })).toEqual([
      {
        path: "src/consumer.ts",
        score: 5,
        source: "import-graph",
        reasons: ["imported-by:src/upload.ts"]
      }
    ]);
  });

  it("uses embedding file candidates before import graph expansion", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-file-embedding-"));
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-file-import-index-"));
    fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "src", "content-moderation.service.ts"), "export const moderation = true;\n");
    fs.writeFileSync(path.join(tmp, "src", "consumer.ts"), "import { moderation } from './content-moderation.service';\n");
    rebuildImportGraphIndex({ cwd: tmp, dataDir, files: ["src/content-moderation.service.ts", "src/consumer.ts"] });

    const files = await findRelevantFiles({
      cwd: tmp,
      dataDir,
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

  it("records direct graph retrieval as runtime telemetry", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-graph-retrieval-"));
    const telemetryPath = path.join(cwd, "telemetry.jsonl");
    fs.mkdirSync(path.join(cwd, ".code-review-graph"));
    fs.writeFileSync(path.join(cwd, ".code-review-graph", "graph.db"), "");

    const files = findGraphRelevantFiles({
      cwd,
      task: "kiem duyet",
      python: process.execPath,
      telemetryPath,
      graphSearch: () => [{ path: "src/moderation.js", query: "kiem duyet" }]
    });
    const evidence = loadRuntimeEvidence({ telemetryPath, cwd });

    expect(files[0]).toMatchObject({ path: "src/moderation.js", source: "graph" });
    expect(evidence.signals).toContain("code-review-graph");
    expect(evidence.toolSignals).toContain("code-review-graph.semantic_search_nodes");
    expect(evidence.sources[0].event).toBe("InternalGraphRetrieval");
  });

  it("audits failed graph retrieval without claiming compliance evidence", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-graph-retrieval-error-"));
    const telemetryPath = path.join(cwd, "telemetry.jsonl");
    fs.mkdirSync(path.join(cwd, ".code-review-graph"));
    fs.writeFileSync(path.join(cwd, ".code-review-graph", "graph.db"), "");

    expect(findGraphRelevantFiles({
      cwd,
      task: "kiem duyet",
      python: process.execPath,
      telemetryPath,
      graphSearch: () => {
        throw new Error("timeout");
      }
    })).toEqual([]);

    const [event] = fs.readFileSync(telemetryPath, "utf8").trim().split("\n").map(JSON.parse);
    expect(event).toMatchObject({
      event: "InternalGraphRetrieval",
      backend: "code-review-graph",
      status: "error"
    });
    expect(event.signals).toEqual([]);
    expect(event.toolSignals).toEqual([]);
  });
});
