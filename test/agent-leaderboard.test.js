import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  formatAgentLeaderboard,
  runAgentLeaderboard
} from "../eval/hallucination/run-agent-leaderboard.js";

describe("live agent leaderboard", () => {
  it("runs through a CLI adapter when an agent binary is available", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-agent-leaderboard-"));
    const fake = path.join(tmp, "fake-agent");
    fs.writeFileSync(fake, "#!/usr/bin/env bash\necho 'eas, mobile-deployment, github-actions-ci-cd'\n");
    fs.chmodSync(fake, 0o755);
    const originalPath = process.env.PATH;
    process.env.PATH = `${tmp}${path.delimiter}${originalPath || ""}`;
    try {
      const result = runAgentLeaderboard({ agents: ["fake-agent"], caseLimit: 1, timeoutMs: 5000 });
      const output = formatAgentLeaderboard(result);

      expect(result.systems[0].status).toBe("ok");
      expect(result.systems[0].correctRate).toBe(1);
      expect(output).toContain("Live Agent Leaderboard");
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
