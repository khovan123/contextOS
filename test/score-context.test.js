import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { scoreContext } from "../plugins/ctx/lib/score-context.js";

describe("score context", () => {
  it("excludes system-user shell rules from scored context", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-score-"));
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-score-data-"));
    fs.writeFileSync(path.join(tmp, "AGENTS.md"), [
      "- All shell commands MUST run as minh_dev, not root.",
      "- Do not prefix every command with sudo -u minh_dev.",
      "- Always use zod for validation."
    ].join("\n"));

    const result = await scoreContext({
      cwd: tmp,
      prompt: "fix zod validation",
      dataDir,
      embeddingTimeoutMs: 20,
      fileEmbeddingTimeoutMs: 1
    });

    expect(result.scoredRules.map((rule) => rule.content)).toEqual([
      "Always use zod for validation."
    ]);
    expect(result.telemetry.rulesFiltered).toBeGreaterThanOrEqual(2);
  });
});
