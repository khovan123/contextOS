import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  enhanceRuleScoresWithEmbeddings,
  searchIndexedEmbeddings,
  warmIndexedEmbeddings
} from "./embedding-scorer.js";
import { fusedProjectQuery, workspacePackagePaths } from "./project-profiler.js";

const DEFAULT_LIMIT = 3;
const DEFAULT_MAX_SKILLS = 2000;
const DEFAULT_EMBEDDING_CANDIDATES = 120;
const SCAN_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_DESCRIPTION_CHARS = 500;
const SKILL_EMBEDDING_THRESHOLD = 0.45;
const DEFAULT_SKILL_TIMEOUT_MS = 2000;

const scanCache = new Map();

export function skillSearchRoots({ cwd = process.cwd(), home = os.homedir() } = {}) {
  return [
    path.join(cwd, ".codex", "skills"),
    path.join(cwd, ".agents", "skills"),
    path.join(cwd, ".claude", "skills"),
    path.join(cwd, ".gemini", "skills"),
    path.join(cwd, ".gemini", "antigravity", "skills"),
    path.join(cwd, ".gemini", "antigravity-cli", "skills"),
    path.join(home, ".codex", "skills"),
    path.join(home, ".agents", "skills"),
    path.join(home, ".claude", "skills"),
    path.join(home, ".config", "skillshare", "skills"),
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
  const deduped = dedupeSkills(skills);
  scanCache.set(cacheKey, { createdAt: monotonicNow(), skills: deduped });
  return deduped;
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
  timeoutMs = Number(process.env.CONTEXTOS_SKILL_EMBEDDING_TIMEOUT_MS || process.env.CONTEXTOS_EMBEDDING_TIMEOUT_MS || DEFAULT_SKILL_TIMEOUT_MS),
  indexedSearcher = searchIndexedEmbeddings,
  embeddingEnhancer = enhanceRuleScoresWithEmbeddings,
  embeddingsEnabled = true
} = {}) {
  if (!String(prompt || "").trim() || !skills.length) return [];
  const catalog = dedupeSkills(skills);
  const query = skillQuery({ prompt, cwd, dataDir });
  const byId = new Map(catalog.map((skill) => [skillIndexId(skill), skill]));
  const explicitSkills = explicitSkillSuggestions({ prompt, byId });
  if (!embeddingsEnabled) return finalizeSkillScores(explicitSkills, limit);

  if (dataDir) {
    const indexed = await searchSkillIndexes({ cwd, query, dataDir, timeoutMs, indexedSearcher });
    if (indexed.status === "enabled" && indexed.items.length) {
      return finalizeSkillScores([
        ...explicitSkills,
        ...indexed.items
        .map((item) => {
          const skill = byId.get(item.id);
          if (!skill) return null;
          return skillScoreFromEmbedding(skill, item.embeddingScore, [`embedding:${Number(item.embeddingScore || 0).toFixed(2)}`]);
        })
        .filter(Boolean)
      ], limit);
    }
  }

  if (catalog.length > DEFAULT_EMBEDDING_CANDIDATES) return finalizeSkillScores(explicitSkills, limit);

  const embeddingCandidates = catalog.map((skill, index) => skillRule({ skill, index }));
  if (!embeddingCandidates.length) return finalizeSkillScores(explicitSkills, limit);

  const embedding = await embeddingEnhancer(embeddingCandidates, query, {
    dataDir,
    sources: embeddingCandidates.map((skill) => skill.path).filter(Boolean),
    timeoutMs,
    allowRemote: false
  });

  return finalizeSkillScores([...explicitSkills, ...embedding.rules], limit);
}

function skillQuery({ prompt = "", cwd = process.cwd(), dataDir } = {}) {
  const focusedPrompt = String(prompt || "").trim();
  const fused = fusedProjectQuery({ prompt, cwd, dataDir });
  return [focusedPrompt, focusedPrompt, fused].filter(Boolean).join("\n");
}

function explicitSkillSuggestions({ prompt = "", byId = new Map() } = {}) {
  const names = extractExplicitSkillNames(prompt);
  return names
    .map((name, index) => ({ skill: byId.get(normalize(name)), index }))
    .filter(({ skill }) => Boolean(skill))
    .map(({ skill, index }) => skillScoreFromEmbedding(skill, 1 - index * 0.0001, ["explicit-skill"]));
}

function extractExplicitSkillNames(prompt = "") {
  const names = [];
  const seen = new Set();
  const pattern = /(?:^|[\s([{,])\$([A-Za-z0-9][A-Za-z0-9_.:-]*)/g;
  let match;
  while ((match = pattern.exec(String(prompt || "")))) {
    const name = match[1];
    const key = normalize(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

function finalizeSkillScores(skills, limit) {
  const ranked = skills
    .map((rule) => ({
      name: rule.name,
      description: rule.description,
      path: rule.path,
      scope: rule.scope,
      score: Math.min(1, Number(rule.score || 0)),
      embeddingScore: rule.embeddingScore,
      rankScore: Math.min(1, Number(rule.score || 0)),
      reasons: rule.reasons || []
    }))
    .filter((skill) => Number(skill.embeddingScore || skill.score || 0) >= SKILL_EMBEDDING_THRESHOLD)
    .sort((a, b) => b.rankScore - a.rankScore
      || b.score - a.score
      || scopePriority(b.scope) - scopePriority(a.scope)
      || a.name.localeCompare(b.name));
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

export async function warmSkillEmbeddings({
  cwd = process.cwd(),
  dataDir,
  allowRemote = true,
  skills = scanSkills({ cwd })
} = {}) {
  if (!dataDir || !skills.length) return { count: 0, cachePath: null };
  const catalog = dedupeSkills(skills);
  const workspaceResult = await warmIndexedEmbeddings({
    kind: skillIndexKind(cwd),
    items: catalog.map((skill) => ({
      id: skillIndexId(skill),
      text: skillEmbeddingText(skill)
    })),
    task: fusedProjectQuery({ prompt: "skill discovery semantic retrieval", cwd, dataDir }),
    dataDir,
    sources: catalog.map((skill) => skill.path).filter(Boolean),
    allowRemote
  });
  if (workspaceResult.status === "missing-model" || workspaceResult.status === "warm-failed") return workspaceResult;
  await warmIndexedEmbeddings({
    kind: sharedSkillIndexKind(),
    items: catalog.map((skill) => ({
      id: skillIndexId(skill),
      text: skillEmbeddingText(skill)
    })),
    task: fusedProjectQuery({ prompt: "skill discovery semantic retrieval", cwd, dataDir }),
    dataDir,
    sources: catalog.map((skill) => skill.path).filter(Boolean),
    allowRemote
  });
  return workspaceResult;
}

function skillRule({ skill, index }) {
  const enriched = skill.searchTokens ? skill : enrichSkill(skill);
  return {
    id: skillIndexId(enriched),
    name: enriched.name,
    description: enriched.description,
    path: enriched.path,
    scope: enriched.scope,
    content: skillEmbeddingText(enriched),
    score: 0,
    originalOrder: index
  };
}

function skillScoreFromEmbedding(skill, embeddingScore, reasons = []) {
  const score = Math.min(1, Number(embeddingScore || 0));
  return {
    name: skill.name,
    description: skill.description,
    path: skill.path,
    scope: skill.scope,
    score,
    embeddingScore: score,
    reasons
  };
}

function dedupeSkills(skills) {
  const byName = new Map();
  for (const skill of skills || []) {
    const enriched = skill.searchTokens ? skill : enrichSkill(skill);
    const key = normalize(enriched.name);
    if (!key) continue;
    const existing = byName.get(key);
    if (!existing || skillSourcePriority(enriched) > skillSourcePriority(existing)) {
      byName.set(key, enriched);
    }
  }
  return [...byName.values()];
}

function skillSourcePriority(skill) {
  let priority = 0;
  if (skill.scope === "project") priority += 100;
  const skillPath = String(skill.path || "");
  if (skillPath.includes(`${path.sep}.codex${path.sep}skills${path.sep}`)) priority += 30;
  if (skillPath.includes(`${path.sep}.config${path.sep}skillshare${path.sep}skills${path.sep}`)) priority += 20;
  if (skillPath.includes(`${path.sep}.agents${path.sep}skills${path.sep}`)) priority += 10;
  return priority;
}

function skillIndexKind(cwd) {
  return `skill:${path.resolve(cwd)}`;
}

function sharedSkillIndexKind() {
  return "skill:global";
}

async function searchSkillIndexes({ cwd, query, dataDir, timeoutMs, indexedSearcher }) {
  const workspace = await indexedSearcher({
    kind: skillIndexKind(cwd),
    task: query,
    dataDir,
    timeoutMs,
    allowRemote: false
  });
  if (workspace.status === "enabled" && workspace.items.length) return workspace;
  const shared = await indexedSearcher({
    kind: sharedSkillIndexKind(),
    task: query,
    dataDir,
    timeoutMs,
    allowRemote: false
  });
  if (shared.status === "enabled" && shared.items.length) return shared;
  return workspace.status === "enabled" ? workspace : shared;
}

function skillIndexId(skill) {
  return normalize(skill.name);
}

function skillEmbeddingText(skill) {
  return [skill.name, skill.description].filter(Boolean).join("\n");
}

export function projectSkillHints({ cwd = process.cwd() } = {}) {
  const hints = new Set();
  const packagePaths = workspacePackagePaths(cwd);

  for (const packagePath of packagePaths) {
    const packageDir = path.dirname(packagePath);
    const packageJson = readJson(packagePath);
    addHintText(hints, JSON.stringify({
      name: packageJson?.name,
      description: packageJson?.description,
      keywords: packageJson?.keywords || [],
      scripts: packageJson?.scripts || {},
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
