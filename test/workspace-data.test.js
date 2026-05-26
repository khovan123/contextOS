import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { workspaceDataDir, workspaceId, workspaceMarkerPath } from "../plugins/ctx/lib/workspace-data.js";

describe("workspace data", () => {
  it("creates stable per-workspace ids and local ignore marker", () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-data-root-"));
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-repo-"));

    const first = workspaceDataDir({ cwd: repo, dataRoot });
    const second = workspaceDataDir({ cwd: repo, dataRoot });

    expect(first).toBe(second);
    expect(first.startsWith(path.join(dataRoot, "workspaces"))).toBe(true);
    expect(fs.existsSync(workspaceMarkerPath(repo))).toBe(true);
    expect(fs.readFileSync(path.join(repo, ".gitignore"), "utf8")).toContain(".contextos/");
  });

  it("keeps different workspace paths isolated", () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-data-root-"));
    const repoA = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-repo-a-"));
    const repoB = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-repo-b-"));

    expect(workspaceId({ cwd: repoA })).not.toBe(workspaceId({ cwd: repoB }));
    expect(workspaceDataDir({ cwd: repoA, dataRoot })).not.toBe(workspaceDataDir({ cwd: repoB, dataRoot }));
  });
});
