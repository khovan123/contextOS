import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { enhanceRuleScoresWithEmbeddings, warmRuleEmbeddings } from "./embedding-scorer.js";

const DEFAULT_LIMIT = 2;
const MIN_WORKFLOW_BYTES = 100;
const MAX_DESCRIPTION_CHARS = 500;
const DEFAULT_EMBEDDING_CANDIDATES = 40;
const KNOWN_AGENT_NAMES = new Set([
  "planner",
  "tester",
  "code-reviewer",
  "docs-manager",
  "debugger",
  "researcher",
  "project-manager",
  "mcp-manager",
  "database-admin",
  "ui-ux-designer",
  "copywriter",
  "scout",
  "scout-external",
  "journal-writer",
  "git-manager",
  "brainstormer"
]);

export function workflowSearchRoots({ cwd = process.cwd(), home = os.homedir() } = {}) {
  return [
    path.join(cwd, ".claude", "workflows"),
    path.join(cwd, ".codex", "workflows"),
    path.join(home, ".claude", "workflows"),
    path.join(home, ".codex", "workflows")
  ];
}

export function scanWorkflows({ cwd = process.cwd(), roots = workflowSearchRoots({ cwd }) } = {}) {
  const workflows = [];
  const seen = new Set();
  for (const root of roots) {
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const filePath = path.join(root, entry.name);
      const realPath = safeRealpath(filePath) || filePath;
      if (seen.has(realPath)) continue;
      seen.add(realPath);
      const workflow = parseWorkflowFile(filePath, { cwd, root });
      if (workflow) workflows.push(workflow);
    }
  }
  return workflows;
}

export function parseWorkflowFile(filePath, { cwd = process.cwd(), root = path.dirname(filePath) } = {}) {
  let stat;
  let content;
  try {
    stat = fs.statSync(filePath);
    if (stat.size < MIN_WORKFLOW_BYTES) return null;
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  const body = stripFrontmatter(content);
  const title = extractTitle(body) || titleFromFile(filePath);
  const sectionTitles = extractSectionTitles(body);
  const chain = extractAgentChain(body);
  const description = buildWorkflowDescription({ title, sectionTitles, chain, body });
  if (!description) return null;

  return {
    name: path.basename(filePath, ".md"),
    title,
    description,
    chain,
    path: filePath,
    relativePath: path.relative(cwd, filePath),
    root,
    scope: isInsidePath(filePath, cwd) ? "project" : "global",
    mtime: Math.round(stat.mtimeMs)
  };
}

export async function suggestWorkflows({
  prompt = "",
  workflows = [],
  dataDir,
  limit = DEFAULT_LIMIT,
  timeoutMs = Number(process.env.CONTEXTOS_WORKFLOW_EMBEDDING_TIMEOUT_MS || process.env.CONTEXTOS_EMBEDDING_TIMEOUT_MS || 800)
} = {}) {
  if (!String(prompt || "").trim() || !workflows.length) return [];
  const base = scoreWorkflowsByKeyword({ prompt, workflows });
  const embeddingCandidates = selectWorkflowEmbeddingCandidates(base);
  if (!embeddingCandidates.length) return [];

  const embedding = await enhanceRuleScoresWithEmbeddings(embeddingCandidates, prompt, {
    dataDir,
    sources: embeddingCandidates.map((workflow) => workflow.path).filter(Boolean),
    timeoutMs,
    allowRemote: false
  });

  return finalizeWorkflowScores(embedding.rules, limit);
}

function selectWorkflowEmbeddingCandidates(workflows) {
  return workflows
    .filter((workflow) => Number(workflow.keywordScore || 0) > 0)
    .sort((a, b) => Number(b.keywordScore || 0) - Number(a.keywordScore || 0) || a.name.localeCompare(b.name))
    .slice(0, DEFAULT_EMBEDDING_CANDIDATES);
}

export async function warmWorkflowEmbeddings({
  cwd = process.cwd(),
  dataDir,
  allowRemote = true,
  workflows = scanWorkflows({ cwd })
} = {}) {
  if (!dataDir || !workflows.length) return { count: 0, cachePath: null };
  return warmRuleEmbeddings({
    rules: workflows.map((workflow) => ({ content: workflowEmbeddingText(workflow) })),
    task: "workflow discovery semantic retrieval feature implementation documentation testing",
    dataDir,
    sources: workflows.map((workflow) => workflow.path).filter(Boolean),
    allowRemote
  });
}

export async function syncWorkflows({
  cwd = process.cwd(),
  dataDir,
  allowRemote = true,
  logger = console.log
} = {}) {
  const workflows = scanWorkflows({ cwd });
  logger("ContextOS workflow index");
  logger(`Found workflows: ${workflows.length}`);
  if (workflows.length) {
    for (const workflow of workflows) {
      logger(`- ${workflow.relativePath || workflow.path} (${workflow.chain.join(" -> ") || "no chain"})`);
    }
  }
  const result = await warmWorkflowEmbeddings({ cwd, dataDir, allowRemote, workflows });
  logger(`Indexed workflows: ${workflows.length}`);
  if (result.cachePath) logger(`Cache: ${result.cachePath}`);
  return { workflows, embeddings: result };
}

function stripFrontmatter(content) {
  return String(content || "").replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, "");
}

function extractTitle(content) {
  const match = String(content || "").match(/^#\s+(.+?)\s*$/m);
  return match ? match[1].trim() : "";
}

function extractSectionTitles(content) {
  return [...String(content || "").matchAll(/^#{3,4}\s+(.+?)\s*$/gm)]
    .map((match) => match[1].replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);
}

function extractAgentChain(content) {
  const names = [];
  const add = (value) => {
    const normalized = normalizeAgentName(value);
    if (!normalized || !KNOWN_AGENT_NAMES.has(normalized) || names.includes(normalized)) return;
    names.push(normalized);
  };

  for (const match of String(content || "").matchAll(/`([a-z][a-z0-9-]*(?:-agent)?)`/gi)) {
    add(match[1]);
  }
  for (const name of KNOWN_AGENT_NAMES) {
    if (new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(content)) add(name);
  }
  return names;
}

function buildWorkflowDescription({ title, sectionTitles, chain, body }) {
  const parts = [
    title,
    sectionTitles.join(", "),
    chain.length ? `delegates to ${chain.join(", ")} agents` : "",
    firstParagraph(body)
  ].filter(Boolean);
  return parts.join(" — ").replace(/\s+/g, " ").trim().slice(0, MAX_DESCRIPTION_CHARS);
}

function firstParagraph(body) {
  return String(body || "")
    .split(/\n\s*\n/)
    .filter((part) => !/^\s*#/.test(part))
    .map((part) => part.replace(/^#+\s*/gm, "").replace(/[*_`#>-]/g, "").replace(/\s+/g, " ").trim())
    .find(Boolean) || "";
}

function titleFromFile(filePath) {
  return path.basename(filePath, ".md").split(/[-_]+/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function scoreWorkflowsByKeyword({ prompt, workflows }) {
  const normalizedPrompt = normalize(prompt);
  const promptTokens = new Set(normalizedPrompt.split(/\s+/).filter(Boolean));
  return workflows.map((workflow, index) => {
    const content = workflowEmbeddingText(workflow);
    const workflowTokens = new Set(normalize(content).split(/\s+/).filter(Boolean));
    const matches = [...workflowTokens].filter((token) => promptTokens.has(token) && token.length > 2);
    const nameHit = normalizedPrompt.includes(normalize(workflow.name)) || normalizedPrompt.includes(normalize(workflow.title));
    const chainHit = workflow.chain.some((agent) => normalizedPrompt.includes(normalize(agent)));
    const actionBonus = actionIntentBonus(normalizedPrompt, workflow);
    const scopeBonus = workflow.scope === "project" ? 0.08 : 0;
    const score = Math.min(1, (matches.length ? 0.22 + matches.length * 0.08 : 0) + (nameHit ? 0.22 : 0) + (chainHit ? 0.16 : 0) + actionBonus + scopeBonus);
    return {
      id: `workflow-${index + 1}`,
      ...workflow,
      content,
      score,
      keywordScore: score,
      reasons: [
        ...(matches.length ? [`keyword:${matches.slice(0, 5).join(",")}`] : []),
        ...(nameHit ? ["name-match"] : []),
        ...(chainHit ? ["chain-match"] : []),
        ...(actionBonus ? ["workflow-intent"] : [])
      ],
      originalOrder: index
    };
  });
}

function actionIntentBonus(normalizedPrompt, workflow) {
  const name = normalize(`${workflow.name} ${workflow.title} ${workflow.description}`);
  const implementationIntent = /\b(implement|feature|build|create|fix|debug|test|ci|failing)\b/.test(normalizedPrompt);
  const docsIntent = /\b(doc|docs|documentation|readme|changelog|roadmap)\b/.test(normalizedPrompt);
  const orchestrationIntent = /\b(parallel|sequential|chain|delegate|agent|subagent|orchestrat)\b/.test(normalizedPrompt);
  if (implementationIntent && /\b(primary|implementation|testing|debugging|quality)\b/.test(name)) return 0.35;
  if (docsIntent && /\b(documentation|docs|changelog|roadmap)\b/.test(name)) return 0.35;
  if (orchestrationIntent && /\b(orchestration|parallel|sequential|chaining)\b/.test(name)) return 0.35;
  return 0;
}

function finalizeWorkflowScores(workflows, limit) {
  return workflows
    .map((workflow) => ({
      name: workflow.name,
      title: workflow.title,
      description: workflow.description,
      chain: workflow.chain || [],
      path: workflow.path,
      relativePath: workflow.relativePath,
      scope: workflow.scope,
      keywordScore: workflow.keywordScore,
      score: Math.min(1, Number(workflow.score || 0)),
      embeddingScore: workflow.embeddingScore,
      reasons: workflow.reasons || [],
      hint: workflowHint(workflow)
    }))
    .filter((workflow) => Number(workflow.score || 0) >= 0.4 || Number(workflow.embeddingScore || 0) >= 0.62)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function workflowHint(workflow) {
  const text = normalize(`${workflow.name} ${workflow.title} ${workflow.description}`);
  if (text.includes("documentation")) return "use when documentation, changelog, or roadmap updates are needed";
  if (text.includes("orchestration")) return "use when chaining or parallelizing agents";
  if (text.includes("development rules")) return "use for coding conventions and pre-commit discipline";
  return "use for feature implementation, testing, review, and debugging";
}

function workflowEmbeddingText(workflow) {
  return `${workflow.title || workflow.name} ${workflow.description || ""} ${(workflow.chain || []).join(" ")}`;
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeAgentName(value) {
  return String(value || "").toLowerCase().replace(/-agent$/, "");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeRealpath(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return null;
  }
}

function isInsidePath(filePath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(filePath));
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}
