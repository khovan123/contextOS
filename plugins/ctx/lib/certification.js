import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { filterActionableRules, parseRules } from "./analyzer.js";
import { readAgentsChain } from "./reader.js";
import { scanSkills } from "./skill-discoverer.js";
import { scanWorkflows } from "./workflow-discoverer.js";

const PROJECT_SKILL_ROOTS = [
  [".codex", "skills"],
  [".agents", "skills"],
  [".claude", "skills"],
  [".gemini", "skills"],
  [".gemini", "antigravity", "skills"],
  [".gemini", "antigravity-cli", "skills"]
];

const PROJECT_WORKFLOW_ROOTS = [
  [".claude", "workflows"],
  [".codex", "workflows"],
  [".gemini", "workflows"],
  [".gemini", "antigravity", "workflows"],
  [".gemini", "antigravity-cli", "workflows"]
];

export function inspectContextOSReady({ cwd = process.cwd(), home = os.homedir() } = {}) {
  const root = findProjectRoot(cwd);
  const rules = inspectRules({ cwd, root, home });
  const skills = inspectSkills({ root });
  const workflows = inspectWorkflows({ root });
  const overall = Math.round((rules.score + skills.score + workflows.score) / 3);
  const tier = readinessTier(overall, { rules, skills, workflows });

  return {
    root,
    rules,
    skills,
    workflows,
    overall,
    tier,
    badge: tier === "Not Ready" ? "ContextOS Ready: Not Ready" : `ContextOS Ready ${tier}`
  };
}

export function formatContextOSReady(result) {
  const lines = [
    "Repository Score",
    "",
    `Rules: ${result.rules.score}`,
    `Skills: ${result.skills.score}`,
    `Workflows: ${result.workflows.score}`,
    "",
    "Overall:",
    result.badge,
    "",
    "Evidence:",
    `- Rules: ${result.rules.summary}`,
    `- Skills: ${result.skills.summary}`,
    `- Workflows: ${result.workflows.summary}`
  ];

  const next = [
    ...result.rules.recommendations,
    ...result.skills.recommendations,
    ...result.workflows.recommendations
  ];
  if (next.length) {
    lines.push("", "Next:");
    for (const item of [...new Set(next)].slice(0, 5)) lines.push(`- ${item}`);
  }

  return lines.join("\n");
}

function inspectRules({ cwd, root, home }) {
  const chain = readAgentsChain({ cwd, home });
  const projectSources = chain.sources.filter((source) => isInsidePath(source, root));
  const rules = parseRules(chain.content || "");
  const actionable = filterActionableRules(rules);
  const imperative = actionable.filter((rule) => /\b(always|never|must|required|use|prefer|avoid|do not|don't)\b/i.test(rule.content));
  let score = 0;
  const recommendations = [];

  if (projectSources.length) score += 55;
  else recommendations.push("Add a project AGENTS.md with repository-specific operating rules.");

  if (actionable.length >= 3) score += 20;
  else recommendations.push("Add at least three actionable AGENTS.md rules.");

  if (imperative.length) score += 15;
  else recommendations.push("Use explicit rule language such as always, never, must, use, prefer, or avoid.");

  if (projectSources.length > 1 || fs.existsSync(path.join(root, ".ruler"))) score += 10;

  return {
    score: Math.min(100, score),
    sources: projectSources,
    ruleCount: rules.length,
    actionableCount: actionable.length,
    summary: projectSources.length
      ? `${projectSources.length} AGENTS.md source(s), ${actionable.length} actionable rule(s)`
      : "missing project AGENTS.md",
    recommendations
  };
}

function inspectSkills({ root }) {
  const roots = PROJECT_SKILL_ROOTS.map((parts) => path.join(root, ...parts));
  const skills = scanSkills({ cwd: root, roots, maxSkills: 500 });
  const metadataFiles = findFiles(roots, (filePath) => /skill\.ya?ml$/i.test(path.basename(filePath)));
  const richMetadata = metadataFiles.filter((filePath) => {
    const content = safeRead(filePath);
    return /^positive_triggers:/m.test(content)
      && /^evidence:/m.test(content)
      && /^negative_triggers:/m.test(content)
      && /^workflow:/m.test(content);
  });
  let score = 0;
  const recommendations = [];

  if (skills.length) score += 50;
  else recommendations.push("Add project skills under .codex/skills/ or .agents/skills/.");

  if (metadataFiles.length) score += 20;
  else recommendations.push("Add skill.yaml metadata beside important SKILL.md files.");

  if (richMetadata.length) score += 20;
  else recommendations.push("Include positive_triggers, negative_triggers, evidence, and workflow in skill.yaml.");

  if (skills.length >= 3) score += 10;
  else recommendations.push("Provide at least three project-relevant skills for common tasks.");

  return {
    score: Math.min(100, score),
    count: skills.length,
    metadataCount: metadataFiles.length,
    richMetadataCount: richMetadata.length,
    summary: skills.length
      ? `${skills.length} skill(s), ${metadataFiles.length} metadata file(s)`
      : "missing project skill packs",
    recommendations
  };
}

function inspectWorkflows({ root }) {
  const roots = PROJECT_WORKFLOW_ROOTS.map((parts) => path.join(root, ...parts));
  const workflows = scanWorkflows({ cwd: root, roots });
  const withChain = workflows.filter((workflow) => workflow.chain?.length);
  let score = 0;
  const recommendations = [];

  if (workflows.length) score += 60;
  else recommendations.push("Add project workflows under .codex/workflows/ or .claude/workflows/.");

  if (withChain.length) score += 25;
  else recommendations.push("Include agent handoff names such as planner, tester, code-reviewer, or docs-manager in workflow files.");

  if (workflows.length >= 2) score += 15;
  else recommendations.push("Provide more than one workflow when the repo has distinct delivery paths.");

  return {
    score: Math.min(100, score),
    count: workflows.length,
    chainCount: withChain.length,
    summary: workflows.length
      ? `${workflows.length} workflow(s), ${withChain.length} with agent chain(s)`
      : "missing project workflows",
    recommendations
  };
}

function readinessTier(overall, { rules, skills, workflows }) {
  if (rules.score < 50 || skills.score < 50 || workflows.score < 50) return "Not Ready";
  if (overall >= 85) return "Gold";
  if (overall >= 70) return "Silver";
  if (overall >= 50) return "Bronze";
  return "Not Ready";
}

function findProjectRoot(cwd) {
  let current = path.resolve(cwd);
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(cwd);
    current = parent;
  }
}

function findFiles(roots, predicate) {
  const files = [];
  for (const root of roots) walk(root, files, predicate, 0);
  return files;
}

function walk(directory, files, predicate, depth) {
  if (depth > 4) return;
  let entries = [];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(filePath, files, predicate, depth + 1);
    else if (entry.isFile() && predicate(filePath)) files.push(filePath);
  }
}

function isInsidePath(filePath, root) {
  const relative = path.relative(path.resolve(root), path.resolve(filePath));
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}
