export function buildReport({ cwd, prompt, relevantFiles, scheduled, gitSnapshot, compliance, runtimeEvidence }) {
  const followed = compliance.filter((item) => item.status === "followed");
  const ignored = compliance.filter((item) => item.status === "ignored");
  const unknown = compliance.filter((item) => item.status === "unknown");
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
    measuredRuleCount: measured,
    unknownRuleCount: unknown.length,
    efficiencyScore
  };
}

export function formatReport(report) {
  const lines = [];
  lines.push("ContextOS report");
  lines.push(`Efficiency: ${report.efficiencyScore == null ? "unknown" : `${report.efficiencyScore}%`}`);
  lines.push(`Injected rules: ${report.injectedRuleCount || 0}`);
  lines.push(`Rule outcomes: ${report.followed?.length || 0} followed, ${report.ignored?.length || 0} ignored, ${report.unknown?.length || 0} unknown`);
  lines.push(`Measured rules: ${report.measuredRuleCount ?? ((report.followed?.length || 0) + (report.ignored?.length || 0))}`);
  lines.push(`Changed files: ${report.changedFiles?.length ? report.changedFiles.join(", ") : "none detected"}`);

  if (report.relevantFiles?.length) {
    lines.push(`Suggested files: ${report.relevantFiles.map((file) => file.path).join(", ")}`);
  }
  if (report.runtimeEvidence?.signals?.length) {
    lines.push(`Runtime telemetry: ${report.runtimeEvidence.signals.join(", ")}`);
  }

  for (const warning of report.warnings || []) lines.push(`Warning: ${warning}`);

  appendBucket(lines, "Followed", report.followed);
  appendBucket(lines, "Ignored", report.ignored);
  appendBucket(lines, "Unknown", report.unknown);

  if (report.ignored?.length) {
    lines.push(`Suggestion: fix ignored rule evidence first: ${truncate(report.ignored[0].rule?.content || "", 70)}`);
  } else if (report.unknown?.length && !(report.followed?.length || report.ignored?.length)) {
    lines.push("Suggestion: these rules need runtime evidence or more concrete keywords before ContextOS can score them from git diff.");
  }

  return lines.join("\n");
}

export function formatEvidence(report) {
  const lines = [];
  lines.push("ContextOS evidence");
  lines.push(`Prompt: ${report.prompt || "(empty)"}`);
  lines.push(`Efficiency: ${report.efficiencyScore == null ? "unknown" : `${report.efficiencyScore}%`}`);
  lines.push(`Changed files: ${report.changedFiles?.length ? report.changedFiles.join(", ") : "none detected"}`);

  for (const warning of report.warnings || []) lines.push(`Warning: ${warning}`);

  const items = [
    ...(report.followed || []).map((item) => ({ ...item, status: "followed" })),
    ...(report.ignored || []).map((item) => ({ ...item, status: "ignored" })),
    ...(report.unknown || []).map((item) => ({ ...item, status: "unknown" }))
  ];

  if (!items.length) {
    lines.push("No rule evidence captured for the last report.");
    lines.push("Run a task that schedules at least one relevant rule, then let the Stop hook finish.");
    return lines.join("\n");
  }

  items.forEach((item, index) => {
    lines.push("");
    lines.push(`${index + 1}. ${item.status.toUpperCase()}`);
    lines.push(`Rule: ${item.rule?.content || "(missing rule)"}`);
    if (item.rule?.sourcePath) lines.push(`Source: ${item.rule.sourcePath}`);
    if (typeof item.rule?.score === "number") lines.push(`Score: ${item.rule.score.toFixed(2)}`);
    if (item.kind) lines.push(`Kind: ${item.kind}`);
    if (item.keywords?.length) lines.push(`Keywords: ${item.keywords.join(", ")}`);
    lines.push(`Evidence: ${item.evidence || "(none)"}`);
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
