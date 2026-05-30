import { isSystemUserRule } from "./analyzer.js";

export function buildReport({ cwd, prompt, relevantFiles, suggestedSkills, suggestedWorkflows, scheduled, gitSnapshot, compliance, runtimeEvidence }) {
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
    suggestedSkills: suggestedSkills || [],
    suggestedWorkflows: suggestedWorkflows || [],
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
  lines.push("# ContextOS Report\n");

  // Summary
  lines.push("## Summary");
  lines.push(`- **Efficiency:** ${report.efficiencyScore == null ? "unknown" : `${report.efficiencyScore}%`}`);
  lines.push(`- **Injected rules:** ${report.injectedRuleCount || 0}`);
  lines.push(`- **Measured rules:** ${report.measuredRuleCount ?? ((report.followed?.length || 0) + (report.ignored?.length || 0))}`);
  lines.push(`- **Changed files:** ${report.changedFiles?.length ? report.changedFiles.length : "none detected"}`);
  lines.push("");

  // Rule Outcomes
  lines.push("## Rule Outcomes");
  lines.push(`- ✅ Followed: ${report.followed?.length || 0}`);
  lines.push(`- ❌ Ignored: ${report.ignored?.length || 0}`);
  lines.push(`- ❓ Unknown: ${report.unknown?.length || 0}`);
  lines.push(`- ⚠️ Unmeasurable: ${report.unmeasurable?.length || 0}`);
  lines.push("");

  // Suggested Files
  if (report.relevantFiles?.length) {
    lines.push("## Suggested Files");
    for (const [index, file] of report.relevantFiles.entries()) {
      const score = typeof file.score === "number" ? ` (${file.score.toFixed(2)})` : "";
      lines.push(`${index + 1}. ${file.path}${score}`);
    }
    lines.push("");
  }

  // Suggested Skills
  if (report.suggestedSkills?.length) {
    lines.push("## Suggested Skills");
    for (const skill of report.suggestedSkills) {
      const desc = skill.description ? `: ${truncate(skill.description, 80)}` : "";
      lines.push(`- **${skill.name}**${desc}`);
    }
    lines.push("");
  }

  // Suggested Workflows
  if (report.suggestedWorkflows?.length) {
    lines.push("## Suggested Workflows");
    for (const workflow of report.suggestedWorkflows) {
      const name = workflow.title || workflow.name;
      const chain = workflow.chain?.length ? ` → ${workflow.chain.join(" → ")}` : "";
      lines.push(`- **${name}**${chain}`);
    }
    lines.push("");
  }

  // Runtime Telemetry
  if (report.runtimeEvidence?.signals?.length) {
    lines.push("## Runtime Telemetry");
    for (const signal of report.runtimeEvidence.signals) {
      lines.push(`- ${signal}`);
    }
    lines.push("");
  }

  // Warnings
  for (const warning of report.warnings || []) lines.push(`> ⚠️ ${warning}\n`);

  // Rule details
  appendBucket(lines, "Followed", report.followed);
  appendBucket(lines, "Ignored", report.ignored);
  appendBucket(lines, "Unknown", report.unknown);
  appendBucket(lines, "Unmeasurable", report.unmeasurable);

  if (report.ignored?.length) {
    lines.push(`> **Suggestion:** Fix ignored rule evidence first: ${truncate(report.ignored[0].rule?.content || "", 70)}`);
  } else if (report.unknown?.length && !(report.followed?.length || report.ignored?.length)) {
    lines.push("> **Suggestion:** These rules need runtime evidence or more concrete keywords before ContextOS can score them from git diff.");
  }

  return lines.join("\n");
}

export function formatEvidence(report) {
  report = sanitizeReport(report);
  const lines = [];
  lines.push("# ContextOS Evidence\n");

  lines.push("## Summary");
  lines.push(`- **Prompt:** ${truncate(report.prompt || "(empty)", 100)}`);
  lines.push(`- **Efficiency:** ${report.efficiencyScore == null ? "unknown" : `${report.efficiencyScore}%`}`);
  lines.push(`- **Changed files:** ${report.changedFiles?.length ? report.changedFiles.join(", ") : "none detected"}`);
  lines.push("");

  for (const warning of report.warnings || []) lines.push(`> ⚠️ ${warning}\n`);

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

  lines.push("## Evidence Details\n");
  for (const [index, item] of items.entries()) {
    const statusIcon = { followed: "✅", ignored: "❌", unknown: "❓", unmeasurable: "⚠️" }[item.status] || "";
    lines.push(`### ${index + 1}. ${statusIcon} ${item.status.toUpperCase()}`);
    lines.push(`- **Rule:** ${truncate(item.rule?.content || "(missing rule)", 120)}`);
    if (item.rule?.sourcePath) lines.push(`- **Source:** ${item.rule.sourcePath}`);
    if (typeof item.rule?.score === "number") lines.push(`- **Score:** ${item.rule.score.toFixed(2)}`);
    if (item.kind) lines.push(`- **Kind:** ${item.kind}`);
    lines.push(`- **Evidence:** ${truncate(item.evidence || "(none)", 120)}`);
    for (const line of item.matchedLines || []) {
      const where = line.file ? `${line.file}${typeof line.line === "number" ? `:${line.line}` : ""}` : "diff";
      lines.push(`  - Match: \`${where}\` ${truncate(line.content || "", 100)}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function appendBucket(lines, label, items = []) {
  if (!items.length) return;
  const icon = { Followed: "✅", Ignored: "❌", Unknown: "❓", Unmeasurable: "⚠️" }[label] || "";
  lines.push(`### ${icon} ${label}`);
  for (const item of items) {
    lines.push(`- **Rule:** ${truncate(item.rule.content, 100)}`);
    lines.push(`  - Evidence: ${truncate(item.evidence, 100)}`);
  }
  lines.push("");
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
