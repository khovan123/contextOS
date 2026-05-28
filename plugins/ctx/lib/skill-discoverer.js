import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { enhanceRuleScoresWithEmbeddings, warmRuleEmbeddings } from "./embedding-scorer.js";

const DEFAULT_LIMIT = 3;
const DEFAULT_MAX_SKILLS = 2000;
const DEFAULT_EMBEDDING_CANDIDATES = 120;
const DEFAULT_SEMANTIC_CATALOG_LIMIT = 300;

export function skillSearchRoots({ cwd = process.cwd(), home = os.homedir() } = {}) {
  return [
    path.join(cwd, ".codex", "skills"),
    path.join(cwd, ".claude", "skills"),
    path.join(cwd, ".gemini", "skills"),
    path.join(cwd, ".gemini", "antigravity", "skills"),
    path.join(cwd, ".gemini", "antigravity-cli", "skills"),
    path.join(home, ".codex", "skills"),
    path.join(home, ".claude", "skills"),
    path.join(home, ".gemini", "skills"),
    path.join(home, ".gemini", "antigravity", "skills"),
    path.join(home, ".gemini", "antigravity-cli", "skills")
  ];
}

export function parseSkillFrontmatter(content = "", { fallbackName = "", skillPath = "" } = {}) {
  const text = String(content || "");
  const frontmatter = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  const fields = frontmatter ? parseYamlishFields(frontmatter[1]) : {};
  const body = frontmatter ? text.slice(frontmatter[0].length) : text;
  const fallbackDescription = firstParagraph(body);
  return {
    name: fields.name || fallbackName || path.basename(path.dirname(skillPath)),
    description: fields.description || fallbackDescription,
    path: skillPath
  };
}

function parseYamlishFields(frontmatter) {
  const fields = {};
  const lines = String(frontmatter || "").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    value = value.replace(/^["']|["']$/g, "");
    fields[key] = value;
  }
  return fields;
}

function firstParagraph(body) {
  return String(body || "")
    .split(/\n\s*\n/)
    .map((part) => part.replace(/^#+\s*/gm, "").replace(/\s+/g, " ").trim())
    .find(Boolean) || "";
}

export function scanSkills({ cwd = process.cwd(), roots = skillSearchRoots({ cwd }), maxSkills = DEFAULT_MAX_SKILLS } = {}) {
  const skills = [];
  const seen = new Set();
  for (const root of roots) {
    for (const skillPath of findSkillFiles(root)) {
      if (skills.length >= maxSkills) return skills;
      const realPath = safeRealpath(skillPath) || skillPath;
      if (seen.has(realPath)) continue;
      seen.add(realPath);
      let content = "";
      try {
        content = fs.readFileSync(skillPath, "utf8");
      } catch {
        continue;
      }
      const skill = parseSkillFrontmatter(content, {
        fallbackName: path.basename(path.dirname(skillPath)),
        skillPath
      });
      if (!skill.name || !skill.description) continue;
      skills.push({
        ...skill,
        root,
        scope: isInsidePath(skillPath, cwd) ? "project" : "global",
        relativePath: path.relative(cwd, skillPath)
      });
    }
  }
  return skills;
}

function findSkillFiles(root) {
  const files = [];
  walk(root, 0, files);
  return files;
}

function walk(directory, depth, files) {
  if (depth > 4) return;
  let entries = [];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, depth + 1, files);
    } else if (entry.isFile() && entry.name === "SKILL.md") {
      files.push(fullPath);
    }
  }
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

export async function suggestSkills({
  prompt = "",
  skills = [],
  dataDir,
  limit = DEFAULT_LIMIT,
  timeoutMs = Number(process.env.CONTEXTOS_SKILL_EMBEDDING_TIMEOUT_MS || process.env.CONTEXTOS_EMBEDDING_TIMEOUT_MS || 800)
} = {}) {
  if (!String(prompt || "").trim() || !skills.length) return [];
  const base = scoreSkillsByKeyword({ prompt, skills });
  if (skills.length > DEFAULT_SEMANTIC_CATALOG_LIMIT) {
    return finalizeSkillScores(base, limit);
  }

  const embeddingCandidates = selectEmbeddingCandidates(base);
  if (!embeddingCandidates.length) return [];

  const embedding = await enhanceRuleScoresWithEmbeddings(embeddingCandidates, prompt, {
    dataDir,
    sources: embeddingCandidates.map((skill) => skill.path).filter(Boolean),
    timeoutMs,
    allowRemote: false
  });

  return finalizeSkillScores(embedding.rules, limit);
}

function finalizeSkillScores(skills, limit) {
  return skills
    .map((rule) => ({
      name: rule.name,
      description: rule.description,
      path: rule.path,
      scope: rule.scope,
      keywordScore: rule.keywordScore,
      score: Math.min(1, Number(rule.score || 0)),
      embeddingScore: rule.embeddingScore,
      reasons: rule.reasons || []
    }))
    .filter((skill) => Number(skill.keywordScore || 0) >= 0.35 || Number(skill.embeddingScore || 0) >= 0.62)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function selectEmbeddingCandidates(skills) {
  if (skills.length <= DEFAULT_EMBEDDING_CANDIDATES) return skills;
  return [...skills]
    .filter((skill) => Number(skill.keywordScore || 0) > 0)
    .sort((a, b) => Number(b.keywordScore || 0) - Number(a.keywordScore || 0) || a.name.localeCompare(b.name))
    .slice(0, DEFAULT_EMBEDDING_CANDIDATES);
}

export async function warmSkillEmbeddings({
  cwd = process.cwd(),
  dataDir,
  allowRemote = true,
  skills = scanSkills({ cwd })
} = {}) {
  if (!dataDir || !skills.length) return { count: 0, cachePath: null };
  return warmRuleEmbeddings({
    rules: skills.map((skill) => ({ content: `${skill.name} ${skill.description}` })),
    task: "skill discovery semantic retrieval",
    dataDir,
    sources: skills.map((skill) => skill.path).filter(Boolean),
    allowRemote
  });
}

function scoreSkillsByKeyword({ prompt, skills }) {
  const normalizedPrompt = normalize(prompt);
  const promptTokens = new Set(normalizedPrompt.split(/\s+/).filter(Boolean));
  return skills.map((skill, index) => {
    const name = String(skill.name || "");
    const description = String(skill.description || "");
    const content = `${name} ${description}`;
    const skillTokens = new Set(normalize(content).split(/\s+/).filter(Boolean));
    const matches = [...skillTokens].filter((token) => promptTokens.has(token) && token.length > 2);
    const normalizedName = normalize(name);
    const nameTokens = normalizedName.split(/\s+/).filter((token) => token.length > 2);
    const nameHit = normalizedPrompt.includes(normalizedName);
    const nameTokenHit = nameTokens.length > 1 && nameTokens.every((token) => promptTokens.has(token));
    const scopeBonus = skill.scope === "project" ? 0.08 : 0;
    const score = Math.min(1, (matches.length ? 0.25 + matches.length * 0.08 : 0) + (nameHit ? 0.2 : 0) + (nameTokenHit ? 0.18 : 0) + scopeBonus);
    return {
      id: `skill-${index + 1}`,
      name,
      description,
      path: skill.path,
      scope: skill.scope,
      content,
      score,
      keywordScore: score,
      reasons: [
        ...(matches.length ? [`keyword:${matches.slice(0, 4).join(",")}`] : []),
        ...(nameHit || nameTokenHit ? ["name-match"] : [])
      ],
      originalOrder: index
    };
  });
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
