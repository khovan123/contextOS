import fs from "node:fs";
import path from "node:path";

import { safeReadText } from "./fs-utils.js";

function readJsonLines(filePath) {
  return safeReadText(filePath)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function average(values) {
  const nums = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!nums.length) return null;
  return Math.round(nums.reduce((sum, value) => sum + value, 0) / nums.length);
}

function percent(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

export function loadStats(dataDir) {
  const prompts = readJsonLines(path.join(dataDir, "prompt-history.jsonl"));
  const reportsFromHistory = readJsonLines(path.join(dataDir, "report-history.jsonl"));
  const lastPrompt = readJsonIfExists(path.join(dataDir, "last-prompt-context.json"));
  const lastReport = readJsonIfExists(path.join(dataDir, "last-report.json"));
  const events = readJsonLines(path.join(dataDir, "debug.log"));
  const reports = reportsFromHistory.length ? reportsFromHistory : [lastReport].filter(Boolean);

  const byEvent = new Map();
  for (const item of events) {
    byEvent.set(item.event, (byEvent.get(item.event) || 0) + 1);
  }

  const promptCount = prompts.length || (lastPrompt ? 1 : 0);
  const injectedCount = prompts.filter((item) => item.injected).length + (!prompts.length && lastPrompt?.injected ? 1 : 0);
  const analyzedPrompts = prompts.length ? prompts : [lastPrompt].filter(Boolean);
  const knownEfficiency = reports.map((report) => report.efficiencyScore).filter((score) => score != null);
  const followed = reports.reduce((sum, report) => sum + (report.followed?.length || 0), 0);
  const ignored = reports.reduce((sum, report) => sum + (report.ignored?.length || 0), 0);
  const unknown = reports.reduce((sum, report) => sum + (report.unknown?.length || 0), 0);

  return {
    dataDir,
    events: Object.fromEntries([...byEvent.entries()].sort()),
    promptCount,
    reportCount: reports.length,
    injectedCount,
    quietCount: Math.max(0, promptCount - injectedCount),
    injectionRate: percent(injectedCount, promptCount),
    averagePromptMs: average(analyzedPrompts.map((item) => item.elapsedMs)),
    averageEfficiency: average(knownEfficiency),
    followed,
    ignored,
    unknown,
    lastPrompt: analyzedPrompts.at(-1) || null,
    lastReport: reports.at(-1) || null
  };
}

export function formatStats(stats) {
  const lines = [];
  lines.push("ContextOS stats");
  lines.push(`Data dir: ${stats.dataDir}`);
  lines.push(`Prompts analyzed: ${stats.promptCount}`);
  lines.push(`Reports generated: ${stats.reportCount}`);
  lines.push(`Prompt mode: ${stats.injectedCount} injected, ${stats.quietCount} quiet (${stats.injectionRate}% injected)`);
  lines.push(`Average prompt analysis: ${stats.averagePromptMs == null ? "unknown" : `${stats.averagePromptMs}ms`}`);
  lines.push(`Average efficiency: ${formatAverageEfficiency(stats)}`);
  lines.push(`Rule outcomes: ${stats.followed} followed, ${stats.ignored} ignored, ${stats.unknown} unknown`);

  const eventSummary = Object.entries(stats.events)
    .map(([event, count]) => `${event}:${count}`)
    .join(", ");
  lines.push(`Hook events: ${eventSummary || "none"}`);

  if (stats.lastPrompt) {
    lines.push(`Last prompt: ${truncateLine(stats.lastPrompt.prompt || "", 100) || "(empty)"}`);
    lines.push(`Last scheduled rules: ${scheduledRuleCount(stats.lastPrompt)}`);
    const files = (stats.lastPrompt.relevantFiles || []).map((file) => file.path).join(", ");
    if (files) lines.push(`Last suggested files: ${files}`);
  }

  if (stats.lastReport) {
    lines.push(`Last report efficiency: ${stats.lastReport.efficiencyScore == null ? "unknown" : `${stats.lastReport.efficiencyScore}%`}`);
    lines.push(`Last report measured rules: ${stats.lastReport.measuredRuleCount ?? ((stats.lastReport.followed?.length || 0) + (stats.lastReport.ignored?.length || 0))}`);
    lines.push(`Last report unknown rules: ${stats.lastReport.unknownRuleCount ?? (stats.lastReport.unknown?.length || 0)}`);
    const changed = stats.lastReport.changedFiles?.join(", ");
    if (changed) lines.push(`Last changed files: ${changed}`);
  }

  return lines.join("\n");
}

function formatAverageEfficiency(stats) {
  if (stats.averageEfficiency != null) return `${stats.averageEfficiency}%`;
  if (!stats.reportCount) return "unknown (no Stop reports yet)";
  if (stats.followed + stats.ignored === 0) return "unknown (no measurable followed/ignored rule evidence yet)";
  return "unknown";
}

function scheduledRuleCount(prompt) {
  return (prompt.scheduled?.highRules?.length || 0) + (prompt.scheduled?.midRules?.length || 0);
}

function truncateLine(value, max) {
  const normalized = String(value).replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}
