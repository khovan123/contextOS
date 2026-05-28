const DEFAULT_AGENTS = ["codex", "claude", "agy"];

export function parseSetupArgs(args = []) {
  const agentsFlag = args.indexOf("--agents");
  const agents = agentsFlag >= 0
    ? parseAgentList(args[agentsFlag + 1])
    : DEFAULT_AGENTS;

  return {
    agents,
    yes: args.includes("--yes") || args.includes("-y"),
    quiet: args.includes("--quiet"),
    inject: !args.includes("--quiet") && !args.includes("--no-inject"),
    syncRules: !args.includes("--no-rules"),
    syncSkills: !args.includes("--no-skills")
  };
}

export function parseAgentList(value = "") {
  const agents = String(value || "")
    .split(",")
    .map((item) => normalizeSetupAgent(item))
    .filter(Boolean);
  return [...new Set(agents)];
}

export function normalizeSetupAgent(agent) {
  const normalized = String(agent || "").trim().toLowerCase();
  if (normalized === "antigravity") return "agy";
  return normalized;
}

export function setupSummaryLines({
  cwd = process.cwd(),
  agents = DEFAULT_AGENTS,
  inject = true,
  syncRules = true,
  syncSkills = true
} = {}) {
  return [
    `Installation directory: ${cwd}`,
    `Agents: ${agents.join(", ") || "(none)"}`,
    `Prompt context injection: ${inject ? "enabled" : "quiet logging only"}`,
    `Ruler rule/MCP sync: ${syncRules ? "enabled" : "skipped"}`,
    `skillshare skill sync: ${syncSkills ? "enabled" : "skipped"}`
  ];
}
