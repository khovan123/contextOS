const MAX_CONTEXT_CHARS = 4000;

export function scheduleContext({ rules = [], relevantFiles = [], suggestedSkills = [], maxChars = MAX_CONTEXT_CHARS } = {}) {
  const high = rules.filter((rule) => rule.score >= 0.5);
  const mid = rules.filter((rule) => rule.score >= 0.1 && rule.score < 0.5);
  const dropped = rules.filter((rule) => rule.score < 0.1);

  const sections = [];
  if (high.length) {
    sections.push(section("Critical ContextOS rules", high.slice(0, 8).map(formatRule)));
  }
  if (relevantFiles.length) {
    sections.push(section("Suggested files to check", relevantFiles.map((file) => `- ${file.path}`)));
  }
  if (suggestedSkills.length) {
    sections.push(section("Skills to activate for this task", suggestedSkills.map(formatSkill)));
  }
  if (mid.length) {
    sections.push(section("Additional relevant rules", mid.slice(0, 8).map(formatRule)));
  }
  if (high.length) {
    sections.push(section("ContextOS reminders", high.slice(0, 5).map(formatRule)));
  }

  const additionalContext = trimToLimit(sections.filter(Boolean).join("\n\n"), maxChars);
  return {
    highRules: high,
    midRules: mid,
    droppedRules: dropped,
    relevantFiles,
    suggestedSkills,
    additionalContext
  };
}

function section(title, lines) {
  if (!lines.length) return "";
  return `## ${title}\n${lines.join("\n")}`;
}

function formatRule(rule) {
  const source = rule.sourcePath && rule.sourcePath !== "unknown" ? ` (${rule.sourcePath})` : "";
  return `- ${rule.content}${source}`;
}

function formatSkill(skill) {
  const description = skill.description ? `: ${skill.description}` : "";
  const location = skill.path ? ` (${skill.path})` : "";
  return `- ${skill.name}${description}${location}`;
}

function trimToLimit(value, maxChars) {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 80)).trimEnd()}\n\n[ContextOS truncated context to ${maxChars} chars]`;
}
