import { parseRules, filterActionableRules, scoreRules } from "./analyzer.js";
import { readAgentsChain } from "./reader.js";
import { scheduleContext } from "./scheduler.js";

export function benchmarkContext({ markdown, sources = [], task = "", openFiles = [], topK = 8 } = {}) {
  const parsedRules = parseRules(markdown);
  const actionableRules = filterActionableRules(parsedRules);
  const scoredRules = scoreRules(actionableRules, task, openFiles);
  const relevantRules = scoredRules.filter((rule) => Number(rule.score || 0) >= 0.1);
  const scheduled = scheduleContext({ rules: scoredRules, relevantFiles: [] });

  const originalPositions = new Map(actionableRules.map((rule, index) => [rule.content, index]));
  const middleStart = Math.floor(actionableRules.length * 0.25);
  const middleEnd = Math.ceil(actionableRules.length * 0.75);
  const lostMiddle = relevantRules.filter((rule) => {
    const index = originalPositions.get(rule.content);
    return typeof index === "number" && index >= middleStart && index <= middleEnd;
  });

  return {
    task,
    sources,
    rulesParsed: parsedRules.length,
    actionableRules: actionableRules.length,
    filteredRules: parsedRules.length - actionableRules.length,
    relevantRules: relevantRules.length,
    baseline: {
      relevantRulesInMiddle: lostMiddle.length,
      middleRiskPercent: relevantRules.length ? Math.round((lostMiddle.length / relevantRules.length) * 100) : 0
    },
    contextOS: {
      highRules: scheduled.highRules.length,
      midRules: scheduled.midRules.length,
      topRules: scoredRules.slice(0, topK).map((rule) => ({
        score: rule.score,
        content: rule.content,
        reasons: rule.reasons || []
      })),
      repeatsHighRulesAtEnd: scheduled.highRules.length > 0
    }
  };
}

export function benchmarkWorkspace({ cwd = process.cwd(), task = "", openFiles = [], topK = 8 } = {}) {
  const merged = readAgentsChain({ cwd });
  return benchmarkContext({
    markdown: merged.content,
    sources: merged.sources,
    task,
    openFiles,
    topK
  });
}

export function formatBenchmark(result) {
  const lines = [];
  lines.push("ContextOS benchmark");
  lines.push(`Task: ${result.task || "(empty)"}`);
  lines.push(`Rules: ${result.rulesParsed} parsed, ${result.actionableRules} actionable, ${result.filteredRules} filtered`);
  lines.push(`Relevant rules: ${result.relevantRules}`);
  lines.push(`Baseline middle-risk: ${result.baseline.relevantRulesInMiddle}/${result.relevantRules} relevant rules (${result.baseline.middleRiskPercent}%)`);
  lines.push(`ContextOS scheduled: ${result.contextOS.highRules} high, ${result.contextOS.midRules} mid`);
  lines.push(`Recency reminder: ${result.contextOS.repeatsHighRulesAtEnd ? "enabled" : "not needed"}`);
  if (result.contextOS.topRules.length) {
    lines.push("Top rules:");
    for (const rule of result.contextOS.topRules) {
      const reasons = rule.reasons?.length ? ` reasons:${rule.reasons.join(",")}` : "";
      lines.push(`- ${Number(rule.score || 0).toFixed(2)} ${rule.content}${reasons}`);
    }
  }
  return lines.join("\n");
}
