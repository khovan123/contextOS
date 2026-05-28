import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  detectExistingSkills,
  detectOS,
  parseSyncSkillsArgs,
  skillshareSourceDir,
  syncSkills
} from "../plugins/ctx/lib/skillshare-sync.js";

describe("skillshare sync", () => {
  it("parses sync --skills flags", () => {
    expect(parseSyncSkillsArgs(["--skills"])).toMatchObject({
      skills: true,
      agents: ["codex", "claude", "antigravity"],
      dryRun: false,
      noCollect: false
    });
    expect(parseSyncSkillsArgs(["--skills", "--agents", "codex,claude", "--dry-run", "--no-collect"]).agents).toEqual(["codex", "claude"]);
    expect(parseSyncSkillsArgs(["--skills", "--dry-run"]).dryRun).toBe(true);
    expect(parseSyncSkillsArgs(["--skills", "--no-collect"]).noCollect).toBe(true);
  });

  it("detects host OS names", () => {
    expect(detectOS("darwin")).toBe("mac");
    expect(detectOS("win32")).toBe("windows");
    expect(detectOS("linux")).toBe("linux");
    expect(detectOS("freebsd")).toBe("linux");
  });

  it("detects existing skills across global and project roots", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-skillshare-detect-"));
    const home = path.join(tmp, "home");
    const cwd = path.join(tmp, "repo");
    writeSkill(path.join(home, ".codex", "skills", "reviewer"), "reviewer");
    writeSkill(path.join(cwd, ".gemini", "antigravity", "skills", "payments"), "payments");

    const existing = detectExistingSkills({ cwd, home });

    expect(existing).toEqual(expect.arrayContaining([
      { path: path.join(home, ".codex", "skills"), count: 1 },
      { path: path.join(cwd, ".gemini", "antigravity", "skills"), count: 1 }
    ]));
  });

  it("initializes, collects, syncs, and rebuilds embeddings with a fake runner", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-skillshare-flow-"));
    const home = path.join(tmp, "home");
    const cwd = path.join(tmp, "repo");
    writeSkill(path.join(home, ".claude", "skills", "planning"), "planning");
    const calls = [];
    const logs = [];

    const run = (command, args) => {
      calls.push([command, args]);
      if (command === "skillshare" && args[0] === "--version") return { stdout: "skillshare 0.19.24\n" };
      if (command === "skillshare" && args[0] === "init") {
        fs.mkdirSync(skillshareSourceDir({ home }), { recursive: true });
      }
      if (command === "skillshare" && args[0] === "collect") {
        writeSkill(path.join(skillshareSourceDir({ home }), "planning"), "planning");
      }
      return { stdout: "" };
    };

    const result = await syncSkills({
      cwd,
      home,
      args: ["--skills", "--agents", "codex,claude"],
      run,
      logger: (line) => logs.push(line),
      rebuildSkillEmbeddings: async ({ sourceDir }) => ({ count: countSkillFiles(sourceDir), cachePath: "/tmp/embeddings.db" })
    });

    expect(calls.map(([command, args]) => `${command} ${args.join(" ")}`)).toEqual([
      "skillshare --version",
      "skillshare backup",
      "skillshare init",
      "skillshare collect --all",
      "skillshare sync --agents codex,claude"
    ]);
    expect(result.syncedCount).toBe(1);
    expect(result.embeddings.count).toBe(1);
    expect(logs.join("\n")).toContain("Rebuilding skill embeddings");
  });

  it("does not collect or rebuild embeddings in dry-run mode", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-skillshare-dry-"));
    const home = path.join(tmp, "home");
    const cwd = path.join(tmp, "repo");
    const calls = [];

    const run = (command, args) => {
      calls.push([command, args]);
      if (command === "skillshare" && args[0] === "--version") return { stdout: "skillshare 0.19.24\n" };
      return { stdout: "" };
    };

    const result = await syncSkills({
      cwd,
      home,
      args: ["--skills", "--dry-run", "--no-collect"],
      run,
      logger: () => {},
      rebuildSkillEmbeddings: async () => {
        throw new Error("should not rebuild in dry-run");
      }
    });

    expect(calls.map(([, args]) => args.join(" "))).toEqual([
      "--version",
      "init",
      "sync --dry-run --agents codex,claude,antigravity"
    ]);
    expect(result.embeddings.skipped).toBe(true);
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

function countSkillFiles(root) {
  if (!fs.existsSync(root)) return 0;
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, "SKILL.md")))
    .length;
}
