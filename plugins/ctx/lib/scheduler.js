import path from "node:path";

import { loadOutputConfig } from "./output-config.js";

const MAX_CONTEXT_CHARS = 4000;

export function scheduleContext({
  rules = [],
  relevantFiles = [],
  suggestedSkills = [],
  suggestedWorkflows = [],
  maxChars = MAX_CONTEXT_CHARS,
  outputConfig = loadOutputConfig()
} = {}) {
  const orderedRules = [...rules].sort(compareRulesForContext);
  const high = orderedRules.filter((rule) => rule.score >= 0.5);
  const mid = orderedRules.filter((rule) => rule.score >= 0.1 && rule.score < 0.5);
  const dropped = orderedRules.filter((rule) => rule.score < 0.1);

  const sections = [];
  if (outputConfig.sections.rules && high.length) {
    sections.push(section("Critical ContextOS rules", high.slice(0, 5).map(formatRule)));
  }
  if (outputConfig.sections.files && relevantFiles.length) {
    sections.push(commaSection("Suggested files to check", formatFiles(relevantFiles)));
  }
  if (outputConfig.sections.skills && suggestedSkills.length) {
    sections.push(inlineSection("Suggested skills for this task", suggestedSkills.map(formatSkill)));
  }
  if (outputConfig.sections.workflows && suggestedWorkflows.length) {
    sections.push(section("Suggested workflow for this task", suggestedWorkflows.map(formatWorkflow)));
  }
  if (outputConfig.sections.rules && mid.length) {
    sections.push(section("Additional relevant rules", mid.slice(0, 5).map(formatRule)));
  }

  const additionalContext = trimToLimit(sections.filter(Boolean).join("\n\n"), maxChars);
  return {
    highRules: high,
    midRules: mid,
    droppedRules: dropped,
    relevantFiles,
    suggestedSkills,
    suggestedWorkflows,
    additionalContext
  };
}

function compareRulesForContext(a, b) {
  return rulePriority(b) - rulePriority(a)
    || Number(b.score || 0) - Number(a.score || 0)
    || Number(a.originalOrder || 0) - Number(b.originalOrder || 0);
}

function rulePriority(rule) {
  const content = String(rule.content || "").toLowerCase();
  let priority = 0;
  if (/\b(important|always|must|required|mandatory|strictly|never)\b/.test(content)) priority += 10;
  if (/\b(code-review-graph|query_graph|get_minimal_context|detect_changes|semantic_search_nodes)\b/.test(content)) priority += 4;
  return priority;
}

function section(title, lines) {
  const uniqueLines = [...new Set(lines)];
  if (!uniqueLines.length) return "";
  return `## ${title}\n${uniqueLines.join("\n")}`;
}

function inlineSection(title, values) {
  const uniqueValues = [...new Set(values)];
  if (!uniqueValues.length) return "";
  return `## ${title}: ${uniqueValues.join(", ")}`;
}

function commaSection(title, values) {
  const uniqueValues = [...new Set(values)];
  if (!uniqueValues.length) return "";
  return `## ${title}, ${uniqueValues.join(", ")}`;
}

function formatRule(rule) {
  return `- ${rule.content}`;
}

function formatFiles(files) {
  const counts = new Map();
  for (const file of files) {
    const name = path.basename(file.path);
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return files.map((file) => formatFile(file, counts));
}

function formatFile(file, basenameCounts) {
  const name = path.basename(file.path);
  return basenameCounts.get(name) > 1 ? file.path : name;
}

function formatSkill(skill) {
  const name = String(skill.name || "").trim();
  if (!name) return "";
  if (name.startsWith("$")) return name;
  return skill.explicit ? `$${name}` : name;
}

function formatWorkflow(workflow) {
  const name = workflow.title || workflow.name;
  const chain = workflow.chain?.length ? `\n  chain: ${workflow.chain.join(" -> ")}` : "";
  return `- ${name}${chain}`;
}

function trimToLimit(value, maxChars) {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 80)).trimEnd()}\n\n[ContextOS truncated context to ${maxChars} chars]`;
}
