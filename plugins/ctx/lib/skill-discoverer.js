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
  "build", "can", "not", "production", "show", "something", "https", "http", "com", "www",
  "a", "an", "and", "are", "as", "at", "be", "before", "after", "both", "by", "from", "for",
  "if", "in", "into", "is", "must", "of", "on", "or", "the", "then", "this", "to", "user",
  "users", "when", "where", "whether", "with"
]);
const SPECIALIZED_SKILL_TOKENS = new Set([
  "android", "architecture", "authorization", "cicd", "documentation", "docs", "document",
  "eas", "expo", "frontend", "ios", "next", "nextjs", "mcp", "modelcontextprotocol",
  "postgres", "postgresql", "react", "react-native", "readme", "tailwind", "typescript",
  "ui", "wiki", "writer"
]);

const scanCache = new Map();

export function skillSearchRoots({ cwd = process.cwd(), home = os.homedir() } = {}) {
  return [
    path.join(cwd, ".codex", "skills"),
    path.join(cwd, ".claude", "skills"),
    path.join(cwd, ".gemini", "skills"),
    path.join(cwd, ".gemini", "antigravity", "skills"),
    path.join(cwd, ".gemini", "antigravity-cli", "skills"),
    path.join(home, ".codex", "skills"),
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
      relevancePriority: Number(rule.relevancePriority || 0),
      rankScore: Math.min(1, Number(rule.score || 0)) + Number(rule.relevancePriority || 0) / 100,
      reasons: rule.reasons || []
    }))
    .filter((skill) => Number(skill.keywordScore || 0) >= minimumKeywordScore
      || Number(skill.embeddingScore || 0) >= 0.62
      || Number(skill.relevancePriority || 0) >= 50)
    .sort((a, b) => b.rankScore - a.rankScore
      || b.relevancePriority - a.relevancePriority
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
    const intentBonus = skillIntentBonus(normalizedPrompt, enriched, projectTokens);
    const relevancePriority = skillRelevancePriority(normalizedPrompt, enriched, projectTokens);
    const domainEligible = isSkillDomainEligible(normalizedPrompt, enriched, projectTokens);
    const matchScore = matches.reduce((sum, token) => sum + (SPECIALIZED_SKILL_TOKENS.has(token) ? 0.2 : 0.08), 0);
    const projectBonus = intentBonus ? Math.min(0.16, projectMatches.length * 0.04) : 0;
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
      relevancePriority,
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

function isSkillDomainEligible(normalizedPrompt, enriched, projectTokens = new Set()) {
  const skillText = normalize(`${enriched.name} ${enriched.description}`);
  if (isMcpSkill(skillText) && !isMcpRelevantTask(normalizedPrompt, projectTokens)) return false;
  if (isOffensiveSecuritySkill(skillText) && !isSecurityTask(normalizedPrompt)) return false;
  if (isPlatformCommerceSkill(skillText) && !isPlatformCommerceTask(normalizedPrompt, skillText)) return false;
  if (isDocumentProcessingSkill(skillText) && !isDocumentProcessingTask(normalizedPrompt, skillText)) return false;
  if (isWorkspaceAutomationSkill(skillText) && !isWorkspaceAutomationTask(normalizedPrompt, skillText)) return false;
  if (!/\beas\b/.test(normalizedPrompt)) return true;
  if (!/\b(android|ios)\b/.test(skillText)) return true;
  return /\b(eas|expo|cicd)\b/.test(skillText);
}

function skillIntentBonus(normalizedPrompt, enriched, projectTokens = new Set()) {
  const skillText = normalize(`${enriched.name} ${enriched.description}`);
  if (isDocumentAuthoringTask(normalizedPrompt)
    && /\b(documentation|document|docs|doc|readme|wiki|writer|writing|coauthor|technical documentation|architecture documentation|onboarding|office productivity)\b/.test(skillText)) {
    return 0.48;
  }
  if (isMcpRelevantTask(normalizedPrompt, projectTokens)
    && /\b(mcp|model context protocol|modelcontextprotocol|agent memory|tool developer|tool builder)\b/.test(skillText)) {
    return 0.48;
  }
  if (isCommerceTask(normalizedPrompt)
    && /\b(payment|payments|checkout|billing|bill|invoice|wallet|balance|stripe|paypal|commerce|monetization)\b/.test(skillText)) {
    return 0.46;
  }
  if (isContentAccessTask(normalizedPrompt)
    && /\b(api|endpoint|backend|service|services|auth|authorization|permission|permissions|access|rbac|frontend api)\b/.test(skillText)) {
    return 0.34;
  }
  if (isNotificationTask(normalizedPrompt)
    && /\b(notification|notifications|notify|message|sms|email|event|webhook)\b/.test(skillText)) {
    return 0.3;
  }
  if (isFrontendCheckoutTask(normalizedPrompt)
    && /\b(frontend|react|next|nextjs|ui|component|modal|api integration)\b/.test(skillText)) {
    return 0.32;
  }
  if (isExpoRuntimeTask(normalizedPrompt, projectTokens)
    && /\b(expo|eas|nativewind|react native|tailwind)\b/.test(skillText)) {
    return 0.46;
  }
  if (isNextAppRouterTask(normalizedPrompt)
    && /\b(next|nextjs)\b/.test(skillText)
    && /\b(app router|router|routing|server components)\b/.test(skillText)) {
    return 0.5;
  }
  if (/\beas\b/.test(normalizedPrompt)
    && /\b(eas|expo)\b/.test(skillText)
    && /\b(cicd|workflow|workflows|build|deploy|deployment|pipeline|pipelines)\b/.test(skillText)) {
    return 0.28;
  }
  if (/\b(webapp|frontend|ui|dashboard|button|page|component|app|router)\b/.test(normalizedPrompt)
    && /\b(frontend|react|next|nextjs|ui|component|tailwind|app router)\b/.test(skillText)) {
    return 0.36;
  }
  if (/\b(role|admin|creator|permission|permissions|authorization|access)\b/.test(normalizedPrompt)
    && /\b(auth|authentication|authorization|permission|permissions|access|rbac)\b/.test(skillText)) {
    return 0.32;
  }
  return 0;
}

function skillRelevancePriority(normalizedPrompt, enriched, projectTokens = new Set()) {
  const skillText = normalize(`${enriched.name} ${enriched.description}`);
  const skillName = normalize(enriched.name);
  let priority = 0;
  if (isDocumentAuthoringTask(normalizedPrompt)) {
    if (skillName === "doc coauthoring") priority += 1300;
    if (skillName === "documentation") priority += 720;
    if (skillName === "docs architect") priority += 700;
    if (skillName === "readme") priority += 660;
    if (skillName === "wiki page writer") priority += 640;
    if (skillName === "wiki architect") priority += 620;
    if (skillName === "wiki onboarding") priority += 600;
    if (skillName === "writer" || skillName === "docx" || skillName === "office productivity") priority += 560;
    if (skillName === "agents md") priority += 420;
    if (/\b(code documentation doc generate|documentation generation doc generate|api documentation|api documenter|reference builder|architecture)\b/.test(skillText)) priority += 320;
    if (/\b(documentation|document|docs|doc|readme|wiki|writer|writing|coauthor|technical documentation)\b/.test(skillText)) priority += 130;
    if (/\b(mcp|model context protocol|metasploit|penetration|exploit)\b/.test(skillText)) priority -= 220;
  }
  if (isMcpRelevantTask(normalizedPrompt, projectTokens)) {
    if (skillName === "mcp builder") priority += 760;
    if (skillName === "mcp management") priority += 740;
    if (skillName === "mcp tool developer") priority += 720;
    if (skillName === "agent memory mcp") priority += 700;
    if (skillName === "agent tool builder" || skillName === "context agent") priority += 260;
    if (/\b(mcp|model context protocol|modelcontextprotocol)\b/.test(skillText)) priority += 160;
  }
  if (isCommerceTask(normalizedPrompt)) {
    if (/\b(payment integration|stripe integration|paypal integration)\b/.test(skillText)) priority += 520;
    if (/\bbilling automation\b/.test(skillText)) priority += 430;
    if (/\b(payment|payments|checkout|billing|wallet|balance|stripe|paypal|commerce|monetization)\b/.test(skillText)) priority += 160;
    if (!/\bstripe\b/.test(normalizedPrompt) && /\bstripe\b/.test(skillText)) priority -= 520;
    if (!/\bpaypal\b/.test(normalizedPrompt) && /\bpaypal\b/.test(skillText)) priority -= 520;
    if (!/\bsquare\b/.test(normalizedPrompt) && /\bsquare\b/.test(skillText)) priority -= 440;
    if (/\b(mcp|metasploit|penetration|exploit|bug bounty)\b/.test(skillText)) priority -= 500;
  }
  if (isContentAccessTask(normalizedPrompt)) {
    if (/\b(api endpoint builder|backend development|backend architect|frontend api integration patterns)\b/.test(skillText)) priority += 260;
    if (/\b(auth implementation patterns|authorization|permission|permissions|access|rbac)\b/.test(skillText)) priority += 120;
  }
  if (isNotificationTask(normalizedPrompt)) {
    if (/\bsendblue notify\b/.test(skillText)) priority += 140;
    if (/\b(notification|notifications|notify|message|sms|email|event|webhook)\b/.test(skillText)) priority += 90;
  }
  if (isFrontendCheckoutTask(normalizedPrompt)) {
    if (/\bfrontend api integration patterns\b/.test(skillText)) priority += 220;
    if (/\breact nextjs development|nextjs best practices|nextjs app router patterns|frontend developer\b/.test(skillText)) priority += 90;
  }
  if (isExpoRuntimeTask(normalizedPrompt, projectTokens)) {
    if (/\bexpo deployment\b/.test(skillText)) priority += 900;
    if (/\bbuilding native ui\b/.test(skillText)) priority += 760;
    if (/\bexpo tailwind setup\b/.test(skillText)) priority += 620;
    if (/\bexpo\b/.test(skillText) && /\b(qr|expo go|run|running|start|connect|eas|deployment|build)\b/.test(skillText)) priority += 220;
    if (/\bnativewind|tailwind\b/.test(skillText) && projectTokens.has("nativewind")) priority += 120;
    if (/\b(next|nextjs|frontend designer|dark themed|glassmorphism|framer motion)\b/.test(skillText)) priority -= 160;
  }
  if (isNextAppRouterTask(normalizedPrompt)) {
    if (/\bnextjs app router patterns\b/.test(skillText)) priority += 600;
    if (/\bnextjs best practices\b/.test(skillText)) priority += 560;
    if (/\breact nextjs development\b/.test(skillText)) priority += 420;
    if (/\b(next|nextjs)\b/.test(skillText) && /\b(app router|router|routing|server components)\b/.test(skillText)) priority += 100;
    if (/\b(next|nextjs)\b/.test(skillText) && /\breact\b/.test(skillText)) priority += 70;
    if (/\b(glassmorphism|dark themed|dark theme|framer motion)\b/.test(skillText)) priority -= 40;
  }
  if (/\b(role|admin|creator|permission|permissions|authorization|access)\b/.test(normalizedPrompt)
    && /\b(auth|authentication|authorization|permission|permissions|access|rbac)\b/.test(skillText)) {
    priority += 55;
  }
  return priority;
}

function isNextAppRouterTask(normalizedPrompt) {
  return /\bwebapp\b.*\bsrc\b.*\bapp\b/.test(normalizedPrompt)
    || /\b(next|nextjs)\b.*\b(app router|router|routing)\b/.test(normalizedPrompt)
    || /\bapp router\b/.test(normalizedPrompt);
}

function isExpoRuntimeTask(normalizedPrompt, projectTokens = new Set()) {
  const expoProject = projectTokens.has("expo") || projectTokens.has("nativewind") || projectTokens.has("eas");
  if (!expoProject) return false;
  return /\b(qr|connect|run|start|expo go|device|metro|tunnel|lan)\b/.test(normalizedPrompt);
}

function isCommerceTask(normalizedPrompt) {
  return /\b(purchase|purchased|buy|buyer|seller|payment|pay|checkout|wallet|balance|top up|topup|funded|billing|invoice)\b/.test(normalizedPrompt);
}

function isContentAccessTask(normalizedPrompt) {
  return /\b(content access service|content access|access permissions|grant access|permissions|library|resources|tutorials|collections)\b/.test(normalizedPrompt);
}

function isNotificationTask(normalizedPrompt) {
  return /\b(notification|notifications|notify|buyer|seller)\b/.test(normalizedPrompt);
}

function isFrontendCheckoutTask(normalizedPrompt) {
  return /\b(modal|display|show|checkout|library|frontend|webapp|page|button)\b/.test(normalizedPrompt);
}

function isDocumentAuthoringTask(normalizedPrompt) {
  return /\b(create|write|edit|update|draft|generate|author|maintain|work on|produce)\b.*\b(document|documents|documentation|docs|doc|readme|wiki|workspace|workspaces|manual|guide|onboarding|spec|adr)\b/.test(normalizedPrompt)
    || /\b(document|documents|documentation|docs|doc|readme|wiki|workspace|workspaces|manual|guide|onboarding|spec|adr)\b.*\b(create|write|edit|update|draft|generate|author|maintain|work on|produce)\b/.test(normalizedPrompt);
}

function isMcpTask(normalizedPrompt) {
  return /\b(mcp|model context protocol|tool server|tools server|server tool|bridge|proxy)\b/.test(normalizedPrompt);
}

function isMcpRelevantTask(normalizedPrompt, projectTokens = new Set()) {
  return isMcpTask(normalizedPrompt)
    || (isMcpProject(projectTokens) && isContextRetrievalTask(normalizedPrompt));
}

function isMcpProject(projectTokens = new Set()) {
  return projectTokens.has("mcp") || projectTokens.has("modelcontextprotocol");
}

function isContextRetrievalTask(normalizedPrompt) {
  return /\b(suggest|suggested|suggestion|skills|files|context|retrieval|retrieve|scorer|scoring|match|matching|prompt|hook|inject|injection)\b/.test(normalizedPrompt);
}

function isSecurityTask(normalizedPrompt) {
  return /\b(security|pentest|penetration|exploit|vulnerability|metasploit|bug bounty|owasp|xss|csrf|attack|audit)\b/.test(normalizedPrompt);
}

function isMcpSkill(skillText) {
  return /\bmcp\b|\bmodel context protocol\b/.test(skillText);
}

function isOffensiveSecuritySkill(skillText) {
  return /\b(metasploit|penetration testing|bug bounty|exploit|exploitation|privilege escalation|ethical hacking|web fuzzing|security assessment)\b/.test(skillText);
}

function isPlatformCommerceSkill(skillText) {
  return /\b(wordpress|woocommerce|shopify|odoo)\b/.test(skillText);
}

function isPlatformCommerceTask(normalizedPrompt, skillText) {
  if (/\bwordpress\b/.test(skillText)) return /\bwordpress\b/.test(normalizedPrompt);
  if (/\bwoocommerce\b/.test(skillText)) return /\bwoocommerce\b/.test(normalizedPrompt);
  if (/\bshopify\b/.test(skillText)) return /\bshopify\b/.test(normalizedPrompt);
  if (/\bodoo\b/.test(skillText)) return /\bodoo\b/.test(normalizedPrompt);
  return true;
}

function isDocumentProcessingSkill(skillText) {
  return /\b(azure ai document|document intelligence|formrecognizer|document translation|cosmos db|azure cosmos|search documents|docusign)\b/.test(skillText);
}

function isDocumentProcessingTask(normalizedPrompt, skillText) {
  if (/\bdocusign\b/.test(skillText)) return /\bdocusign|signature|envelope|sign\b/.test(normalizedPrompt);
  if (/\bcosmos db|azure cosmos\b/.test(skillText)) return /\bcosmos|database|nosql|query|container\b/.test(normalizedPrompt);
  if (/\bsearch documents\b/.test(skillText)) return /\bazure search|vector search|semantic search|index\b/.test(normalizedPrompt);
  return /\bextract|ocr|analyze|translate|translation|form recognizer|document intelligence|azure\b/.test(normalizedPrompt);
}

function isWorkspaceAutomationSkill(skillText) {
  return /\b(asana|bitbucket|slack|coda|google docs|google drive|google sheets|google slides|notion|telegram)\b/.test(skillText)
    && /\b(automation|automate|workspace|workspaces|manage docs|documents)\b/.test(skillText);
}

function isWorkspaceAutomationTask(normalizedPrompt, skillText) {
  if (/\basana\b/.test(skillText)) return /\basana\b/.test(normalizedPrompt);
  if (/\bbitbucket\b/.test(skillText)) return /\bbitbucket\b/.test(normalizedPrompt);
  if (/\bslack\b/.test(skillText)) return /\bslack\b/.test(normalizedPrompt);
  if (/\bcoda\b/.test(skillText)) return /\bcoda\b/.test(normalizedPrompt);
  if (/\bgoogle docs\b/.test(skillText)) return /\bgoogle docs\b/.test(normalizedPrompt);
  if (/\bgoogle drive\b/.test(skillText)) return /\bgoogle drive\b/.test(normalizedPrompt);
  if (/\bgoogle sheets\b/.test(skillText)) return /\bgoogle sheets\b/.test(normalizedPrompt);
  if (/\bgoogle slides\b/.test(skillText)) return /\bgoogle slides\b/.test(normalizedPrompt);
  if (/\bnotion\b/.test(skillText)) return /\bnotion\b/.test(normalizedPrompt);
  if (/\btelegram\b/.test(skillText)) return /\btelegram\b/.test(normalizedPrompt);
  return true;
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

function workspacePackagePaths(cwd) {
  const rootPackagePath = path.join(cwd, "package.json");
  const rootPackage = readJson(rootPackagePath);
  const paths = new Set([rootPackagePath]);
  for (const workspace of workspacePatterns(rootPackage?.workspaces)) {
    for (const packagePath of expandWorkspacePattern({ cwd, pattern: workspace })) {
      paths.add(packagePath);
    }
  }
  return [...paths];
}

function workspacePatterns(workspaces) {
  if (Array.isArray(workspaces)) return workspaces.filter((item) => typeof item === "string");
  if (Array.isArray(workspaces?.packages)) return workspaces.packages.filter((item) => typeof item === "string");
  return [];
}

function expandWorkspacePattern({ cwd, pattern }) {
  const normalized = String(pattern || "").replace(/\\/g, "/").replace(/\/+$/g, "");
  if (!normalized || normalized.startsWith("..") || path.isAbsolute(normalized)) return [];
  if (!normalized.includes("*")) {
    const packagePath = path.join(cwd, normalized, "package.json");
    return fs.existsSync(packagePath) ? [packagePath] : [];
  }
  const parts = normalized.split("/");
  const starIndex = parts.indexOf("*");
  if (starIndex < 0 || parts.includes("**")) return [];
  const baseDir = path.join(cwd, ...parts.slice(0, starIndex));
  const suffix = parts.slice(starIndex + 1);
  let entries = [];
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => path.join(baseDir, entry.name, ...suffix, "package.json"))
    .filter((packagePath) => fs.existsSync(packagePath));
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
  return normalize(String(value || "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/giao\s+di[eệ]n/gi, "frontend ui")
    .replace(/phan\s+quyen/gi, "authorization role"));
}
