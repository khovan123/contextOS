import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { enhanceRuleScoresWithEmbeddings, warmRuleEmbeddings } from "./embedding-scorer.js";

const DEFAULT_LIMIT = 3;
const DEFAULT_MAX_SKILLS = 2000;
const DEFAULT_EMBEDDING_CANDIDATES = 120;
const DEFAULT_SEMANTIC_CATALOG_LIMIT = 300;
const SCAN_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_DESCRIPTION_CHARS = 500;
const GENERIC_SKILL_TOKENS = new Set([
  "active", "agent", "agents", "code", "config", "configuration", "create", "development",
  "environment", "file", "files", "graph", "install", "integration", "local", "node", "package",
  "project", "refresh", "rebuild", "setup", "skill", "skills", "sync", "tool", "tools", "using",
  "build", "production", "https", "http", "com", "www"
]);
const SPECIALIZED_SKILL_TOKENS = new Set([
  "android", "cicd", "eas", "expo", "ios", "postgres", "postgresql", "react-native"
]);

const scanCache = new Map();

export function skillSearchRoots({ cwd = process.cwd(), home = os.homedir() } = {}) {
  return [
    path.join(cwd, ".codex", "skills"),
    path.join(cwd, ".claude", "skills"),
    path.join(cwd, ".gemini", "skills"),
    path.join(cwd, ".gemini", "antigravity", "skills"),
    path.join(cwd, ".gemini", "antigravity-cli", "skills"),
    path.join(home, ".config", "skillshare", "skills"),
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
    description: truncateDescription(fields.description || fallbackDescription),
    path: skillPath
  };
}

function truncateDescription(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, MAX_DESCRIPTION_CHARS);
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
  const cacheKey = `${path.resolve(cwd)}\0${maxSkills}\0${roots.map((root) => path.resolve(root)).join("\0")}`;
  const cached = scanCache.get(cacheKey);
  if (cached && monotonicNow() - cached.createdAt < SCAN_CACHE_TTL_MS) {
    return cached.skills;
  }

  const skills = [];
  const seen = new Set();
  for (const root of roots) {
    for (const skillPath of findSkillFiles(root)) {
      if (skills.length >= maxSkills) return cacheAndReturnSkills(cacheKey, skills);
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
      skills.push(enrichSkill({
        ...skill,
        root,
        scope: isInsidePath(skillPath, cwd) ? "project" : "global",
        relativePath: path.relative(cwd, skillPath)
      }));
    }
  }
  return cacheAndReturnSkills(cacheKey, skills);
}

function monotonicNow() {
  return globalThis.performance?.now?.() || Date.now();
}

function cacheAndReturnSkills(cacheKey, skills) {
  scanCache.set(cacheKey, { createdAt: monotonicNow(), skills });
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
  cwd = process.cwd(),
  limit = DEFAULT_LIMIT,
  timeoutMs = Number(process.env.CONTEXTOS_SKILL_EMBEDDING_TIMEOUT_MS || process.env.CONTEXTOS_EMBEDDING_TIMEOUT_MS || 800)
} = {}) {
  if (!String(prompt || "").trim() || !skills.length) return [];
  const base = scoreSkillsByKeyword({ prompt, skills, projectHints: projectSkillHints({ cwd }) });
  if (skills.length > DEFAULT_SEMANTIC_CATALOG_LIMIT) {
    return finalizeSkillScores(base, limit, { minimumKeywordScore: 0.5 });
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

function finalizeSkillScores(skills, limit, { minimumKeywordScore = 0.35 } = {}) {
  const ranked = skills
    .filter((rule) => rule.domainEligible !== false)
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
    .filter((skill) => Number(skill.keywordScore || 0) >= minimumKeywordScore || Number(skill.embeddingScore || 0) >= 0.62)
    .sort((a, b) => b.score - a.score || scopePriority(b.scope) - scopePriority(a.scope) || a.name.localeCompare(b.name));
  const seen = new Set();
  return ranked
    .filter((skill) => {
      const key = normalize(skill.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function scopePriority(scope) {
  return scope === "project" ? 1 : 0;
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

function scoreSkillsByKeyword({ prompt, skills, projectHints = [] }) {
  const normalizedPrompt = normalizePrompt(prompt);
  const promptTokens = new Set(normalizedPrompt.split(/\s+/).filter(Boolean));
  const projectTokens = new Set(projectHints);
  return skills.map((skill, index) => {
    const enriched = skill.searchTokens ? skill : enrichSkill(skill);
    const name = String(enriched.name || "");
    const description = truncateDescription(enriched.description || "");
    const content = `${name} ${description}`;
    const matches = filterSkillMatches(
      enriched.searchTokens.filter((token) => promptTokens.has(token) && token.length > 2 && !GENERIC_SKILL_TOKENS.has(token)),
      { normalizedPrompt, enriched }
    );
    const projectMatches = enriched.searchTokens.filter((token) => projectTokens.has(token) && SPECIALIZED_SKILL_TOKENS.has(token));
    const normalizedName = enriched.normalizedName;
    const nameTokens = enriched.nameTokens;
    const nameHit = normalizedPrompt.includes(normalizedName);
    const nameTokenHit = nameTokens.length > 1 && nameTokens.every((token) => promptTokens.has(token));
    const scopeBonus = enriched.scope === "project" ? 0.08 : 0;
    const intentBonus = skillIntentBonus(normalizedPrompt, enriched);
    const domainEligible = isSkillDomainEligible(normalizedPrompt, enriched);
    const matchScore = matches.reduce((sum, token) => sum + (SPECIALIZED_SKILL_TOKENS.has(token) ? 0.2 : 0.08), 0);
    const projectBonus = matches.length && intentBonus ? Math.min(0.16, projectMatches.length * 0.04) : 0;
    const score = Math.min(1, (matches.length ? 0.25 + matchScore : 0) + projectBonus + intentBonus + (nameHit ? 0.2 : 0) + (nameTokenHit ? 0.18 : 0) + scopeBonus);
    return {
      id: `skill-${index + 1}`,
      name,
      description,
      path: enriched.path,
      scope: enriched.scope,
      content,
      score,
      keywordScore: score,
      domainEligible,
      reasons: [
        ...(matches.length ? [`keyword:${matches.slice(0, 4).join(",")}`] : []),
        ...(projectBonus ? [`project:${projectMatches.slice(0, 4).join(",")}`] : []),
        ...(intentBonus ? ["intent-match"] : []),
        ...(nameHit || nameTokenHit ? ["name-match"] : [])
      ],
      originalOrder: index
    };
  });
}

function filterSkillMatches(matches, { normalizedPrompt, enriched }) {
  if (!/\beas\b/.test(normalizedPrompt)) return matches;
  const skillText = normalize(`${enriched.name} ${enriched.description}`);
  if (/\b(eas|expo|cicd)\b/.test(skillText)) return matches;
  return matches.filter((token) => token !== "android" && token !== "ios");
}

function isSkillDomainEligible(normalizedPrompt, enriched) {
  if (!/\beas\b/.test(normalizedPrompt)) return true;
  const skillText = normalize(`${enriched.name} ${enriched.description}`);
  if (!/\b(android|ios)\b/.test(skillText)) return true;
  return /\b(eas|expo|cicd)\b/.test(skillText);
}

function skillIntentBonus(normalizedPrompt, enriched) {
  const skillText = normalize(`${enriched.name} ${enriched.description}`);
  if (/\beas\b/.test(normalizedPrompt)
    && /\b(eas|expo)\b/.test(skillText)
    && /\b(cicd|workflow|workflows|build|deploy|deployment|pipeline|pipelines)\b/.test(skillText)) {
    return 0.28;
  }
  return 0;
}

export function projectSkillHints({ cwd = process.cwd() } = {}) {
  const hints = new Set();
  const packagePaths = [path.join(cwd, "package.json")];
  const rootPackage = readJson(path.join(cwd, "package.json"));
  for (const workspace of rootPackage?.workspaces || []) {
    if (typeof workspace !== "string" || workspace.includes("*")) continue;
    packagePaths.push(path.join(cwd, workspace, "package.json"));
  }

  for (const packagePath of packagePaths) {
    const packageDir = path.dirname(packagePath);
    const packageJson = readJson(packagePath);
    addHintText(hints, JSON.stringify({
      name: packageJson?.name,
      description: packageJson?.description,
      dependencies: Object.keys(packageJson?.dependencies || {}),
      devDependencies: Object.keys(packageJson?.devDependencies || {})
    }));
    for (const fileName of ["app.json", "app.config.js", "app.config.ts", "eas.json"]) {
      if (fs.existsSync(path.join(packageDir, fileName))) addHintText(hints, fileName);
    }
  }
  return [...hints];
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function addHintText(hints, value) {
  for (const token of normalize(value).split(/\s+/).filter(Boolean)) hints.add(token);
}

function enrichSkill(skill) {
  const name = String(skill.name || "");
  const description = truncateDescription(skill.description || "");
  const normalizedName = normalize(name);
  const searchTokens = [...new Set(normalize(`${name} ${description}`).split(/\s+/).filter(Boolean))];
  const nameTokens = normalizedName.split(/\s+/).filter((token) => token.length > 2);
  return {
    ...skill,
    description,
    normalizedName,
    nameTokens,
    searchTokens
  };
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizePrompt(value) {
  return normalize(String(value || "").replace(/https?:\/\/\S+/gi, " "));
}
