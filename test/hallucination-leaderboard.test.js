import { describe, expect, it } from "vitest";

import {
  formatHallucinationLeaderboard,
  runHallucinationLeaderboard
} from "../eval/hallucination/run-leaderboard.js";

describe("hallucination leaderboard", () => {
  it("compares raw prompt guesses against ContextOS routing", async () => {
    const result = await runHallucinationLeaderboard();
    const output = formatHallucinationLeaderboard(result);
    const raw = result.systems.find((system) => system.name === "Raw Agent");
    const contextos = result.systems.find((system) => system.name === "ContextOS + Codex");

    expect(result.caseCount).toBe(20);
    expect(result.repoCount).toBeGreaterThanOrEqual(10);
    expect(contextos.correctRate).toBeGreaterThan(raw.correctRate);
    expect(output).toContain("Hallucination Leaderboard");
    expect(output).toContain("ContextOS + Codex");
  }, 15000);
});
