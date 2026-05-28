import { isSystemUserRule } from "./analyzer.js";
import { section, table, truncateCell } from "./terminal-ui.js";

export function buildReport({ cwd, prompt, relevantFiles, scheduled, gitSnapshot, compliance, runtimeEvidence }) {
  const actionableCompliance = compliance.filter((item) => !isSystemUserRule(item.rule));
  const followed = actionableCompliance.filter((item) => item.status === "followed");
  const ignored = actionableCompliance.filter((item) => item.status === "ignored");
  const unknown = actionableCompliance.filter((item) => item.status === "unknown");
  const unmeasurable = actionableCompliance.filter((item) => item.status === "unmeasurable");
  const measured = followed.length + ignored.length;
  const efficiencyScore = measured ? Math.round((followed.length / measured) * 100) : null;

  return {
    at: new Date().toISOString(),
    cwd,
    prompt,
    injectedRuleCount: (scheduled?.highRules?.length || 0) + (scheduled?.midRules?.length || 0),
    relevantFiles,
    changedFiles: gitSnapshot.changedFiles,
    warnings: gitSnapshot.warnings || [],
    runtimeEvidence: summarizeRuntimeEvidence(runtimeEvidence),
    followed,
    ignored,
    unknown,
    unmeasurable,
    measuredRuleCount: measured,
    unknownRuleCount: unknown.length,
    unmeasurableRuleCount: unmeasurable.length,
    efficiencyScore
  };
}

export function formatReport(report) {
  report = sanitizeReport(report);
  const lines = [];
  lines.push("ContextOS report");
  lines.push(section("Summary"));
  lines.push(table(["Metric", "Value"], [
    ["Efficiency", report.efficiencyScore == null ? "unknown" : `${report.efficiencyScore}%`],
    ["Injected rules", report.injectedRuleCount || 0],
    ["Measured rules", report.measuredRuleCount ?? ((report.followed?.length || 0) + (report.ignored?.length || 0))],
    ["Changed files", report.changedFiles?.length ? report.changedFiles.length : "none detected"]
  ]));

  lines.push(section("Rule Outcomes"));
  lines.push(table(["Status", "Count"], [
    ["followed", report.followed?.length || 0],
    ["ignored", report.ignored?.length || 0],
    ["unknown", report.unknown?.length || 0],
    ["unmeasurable", report.unmeasurable?.length || 0]
  ]));

  if (report.relevantFiles?.length) {
    lines.push(section("Suggested Files"));
    lines.push(table(["#", "Path", "Score"], report.relevantFiles.slice(0, 10).map((file, index) => [
      index + 1,
      truncateCell(file.path, 90),
      typeof file.score === "number" ? file.score.toFixed(2) : ""
    ])));
  }
  if (report.runtimeEvidence?.signals?.length) {
    lines.push(section("Runtime Telemetry"));
    lines.push(table(["#", "Signal"], report.runtimeEvidence.signals.map((signal, index) => [index + 1, signal])));
  }

  for (const warning of report.warnings || []) lines.push(`Warning: ${warning}`);

  appendBucket(lines, "Followed", report.followed);
  appendBucket(lines, "Ignored", report.ignored);
  appendBucket(lines, "Unknown", report.unknown);
  appendBucket(lines, "Unmeasurable", report.unmeasurable);

  if (report.ignored?.length) {
    lines.push(`Suggestion: fix ignored rule evidence first: ${truncate(report.ignored[0].rule?.content || "", 70)}`);
  } else if (report.unknown?.length && !(report.followed?.length || report.ignored?.length)) {
    lines.push("Suggestion: these rules need runtime evidence or more concrete keywords before ContextOS can score them from git diff.");
  }

  return lines.join("\n");
}

export function formatEvidence(report) {
  report = sanitizeReport(report);
  const lines = [];
  lines.push("ContextOS evidence");
  lines.push(section("Summary"));
  lines.push(table(["Field", "Value"], [
    ["Prompt", truncateCell(report.prompt || "(empty)", 100)],
    ["Efficiency", report.efficiencyScore == null ? "unknown" : `${report.efficiencyScore}%`],
    ["Changed files", report.changedFiles?.length ? report.changedFiles.join(", ") : "none detected"]
  ]));

  for (const warning of report.warnings || []) lines.push(`Warning: ${warning}`);

  const items = [
    ...(report.followed || []).map((item) => ({ ...item, status: "followed" })),
    ...(report.ignored || []).map((item) => ({ ...item, status: "ignored" })),
    ...(report.unknown || []).map((item) => ({ ...item, status: "unknown" })),
    ...(report.unmeasurable || []).map((item) => ({ ...item, status: "unmeasurable" }))
  ];

  if (!items.length) {
    lines.push("No rule evidence captured for the last report.");
    lines.push("Run a task that schedules at least one relevant rule, then let the Stop hook finish.");
    return lines.join("\n");
  }

  lines.push(section("Evidence Table"));
  lines.push(table(["#", "Status", "Score", "Kind", "Rule", "Evidence"], items.map((item, index) => [
    index + 1,
    item.status.toUpperCase(),
    typeof item.rule?.score === "number" ? item.rule.score.toFixed(2) : "",
    item.kind || "",
    truncateCell(item.rule?.content || "(missing rule)", 46),
    truncateCell(item.evidence || "(none)", 58)
  ])));

  items.forEach((item, index) => {
    lines.push(section(`${index + 1}. ${item.status.toUpperCase()}`));
    lines.push(table(["Field", "Value"], [
      ["Rule", truncateCell(item.rule?.content || "(missing rule)", 120)],
      ["Source", item.rule?.sourcePath || ""],
      ["Score", typeof item.rule?.score === "number" ? item.rule.score.toFixed(2) : ""],
      ["Kind", item.kind || ""],
      ["Keywords", item.keywords?.length ? truncateCell(item.keywords.join(", "), 120) : ""],
      ["Evidence", truncateCell(item.evidence || "(none)", 120)]
    ].filter(([, value]) => value !== "")));
    for (const line of item.matchedLines || []) {
      const where = line.file ? `${line.file}${typeof line.line === "number" ? `:${line.line}` : ""}` : "diff";
      lines.push(`Matched line: ${where} ${truncate(line.content || "", 140)}`);
    }
  });

  return lines.join("\n");
}

function appendBucket(lines, label, items = []) {
  if (!items.length) return;
  lines.push(`${label}:`);
  for (const item of items.slice(0, 5)) {
    lines.push(`- Rule: ${truncate(item.rule.content, 68)}`);
    lines.push(`  Evidence: ${truncate(item.evidence, 64)}`);
  }
  if (items.length > 5) lines.push(`- ... ${items.length - 5} more`);
}

function truncate(value, max) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

function summarizeRuntimeEvidence(runtimeEvidence = {}) {
  const signals = [
    ...(runtimeEvidence.toolSignals || []),
    ...(runtimeEvidence.commandSignals || []),
    ...(runtimeEvidence.signals || [])
  ];
  return {
    signals: [...new Set(signals)].slice(0, 20),
    sources: (runtimeEvidence.sources || []).slice(0, 10)
  };
}

function sanitizeReport(report = {}) {
  const followed = (report.followed || []).filter((item) => !isSystemUserRule(item.rule));
  const ignored = (report.ignored || []).filter((item) => !isSystemUserRule(item.rule));
  const unknown = (report.unknown || []).filter((item) => !isSystemUserRule(item.rule));
  const unmeasurable = (report.unmeasurable || []).filter((item) => !isSystemUserRule(item.rule));
  const measured = followed.length + ignored.length;
  return {
    ...report,
    injectedRuleCount: followed.length + ignored.length + unknown.length + unmeasurable.length,
    followed,
    ignored,
    unknown,
    unmeasurable,
    measuredRuleCount: measured,
    unknownRuleCount: unknown.length,
    unmeasurableRuleCount: unmeasurable.length,
    efficiencyScore: measured ? Math.round((followed.length / measured) * 100) : null
  };
}
