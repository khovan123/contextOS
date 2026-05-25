import fs from "node:fs";
import path from "node:path";
import { findGraphRelevantFiles, mergeRelevantFiles } from "./graph-retriever.js";
import { expandImportGraph } from "./import-graph.js";
import { findEmbeddingRelevantFiles } from "./file-embedding-retriever.js";

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "cho", "co", "cua", "do", "fix", "for",
  "from", "in", "is", "it", "la", "of", "on", "or", "sua", "task", "the", "to", "trong",
  "tra", "va", "with"
]);

const IMPORTANT_WORDS = [
  "always", "never", "must", "required", "important", "strictly", "mandatory",
  "luon", "khong bao gio", "bat buoc", "quan trong"
];

const IGNORE_DIRS = new Set([
  ".git", ".next", ".turbo", "coverage", "dist", "build", "node_modules", "vendor"
]);

const SEMANTIC_ALIASES = {
  duyet: ["moderation", "moderate", "review", "approve", "approval", "approved", "reject", "rejected"],
  kiem: ["check", "verify", "validation", "validate"],
  "kiem-duyet": ["moderation", "moderate", "review", "approve", "approval", "reject"],
  kiemduyet: ["moderation", "moderate", "review", "approve", "approval", "reject"],
  moderation: ["duyet", "kiemduyet", "review", "approval", "reject"],
  moderate: ["duyet", "kiemduyet", "review", "approval", "reject"],
  review: ["duyet", "moderation", "moderate"],
  approve: ["duyet", "approval", "approved"],
  approval: ["duyet", "approve", "approved"],
  reject: ["duyet", "rejected", "rejection"],
  flow: ["workflow", "pipeline", "process"],
  workflow: ["flow", "pipeline", "process"],
  tai: ["upload", "uploaded", "resource"],
  "tai-len": ["upload", "uploaded", "resource"],
  tailen: ["upload", "uploaded", "resource"],
  upload: ["tai", "tailen", "resource", "uploaded"],
  xac: ["confirm", "verify", "verification"],
  nhan: ["confirm", "confirmation"],
  "xac-nhan": ["confirm", "confirmation", "verify", "verification"],
  xacnhan: ["confirm", "confirmation", "verify", "verification"],
  thong: ["notification", "notify", "message"],
  bao: ["notification", "notify", "message"],
  "thong-bao": ["notification", "notify", "message"],
  thongbao: ["notification", "notify", "message"]
};

const MODERATION_TOKENS = new Set(["moderation", "moderate", "content-moderation", "approval", "approved", "reject", "rejected", "needs_review"]);

export function tokenize(value) {
  const normalized = String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/kiem\s+duyet/g, "kiem-duyet")
    .replace(/tai\s+len/g, "tai-len")
    .replace(/xac\s+nhan/g, "xac-nhan")
    .replace(/thong\s+bao/g, "thong-bao");

  return normalized
    .split(/[^a-z0-9_.-]+/g)
    .flatMap(splitCompoundToken)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

function splitCompoundToken(token) {
  const parts = String(token || "").split(/[_.-]+/g).filter(Boolean);
  return parts.length > 1 ? [token, ...parts] : [token];
}

function expandSemanticTokens(tokens) {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    for (const alias of SEMANTIC_ALIASES[token] || []) expanded.add(alias);
  }
  return expanded;
}

function sourceFromLine(line) {
  const match = line.match(/^## Source:\s+(.+)$/);
  return match ? match[1].trim() : null;
}

function cleanRuleLine(line) {
  return line
    .replace(/^\s{0,3}[-*+]\s+/, "")
    .replace(/^\s{0,3}\d+[.)]\s+/, "")
    .replace(/^#+\s+/, "")
    .trim();
}

export function parseRules(markdown) {
  const rules = [];
  let sourcePath = "unknown";
  let paragraph = [];

  const flushParagraph = () => {
    const content = cleanRuleLine(paragraph.join(" ").replace(/\s+/g, " "));
    paragraph = [];
    if (content.length < 20) return;
    rules.push({
      id: `r${rules.length + 1}`,
      sourcePath,
      content,
      originalOrder: rules.length
    });
  };

  for (const rawLine of String(markdown || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    const nextSource = sourceFromLine(line);
    if (nextSource) {
      flushParagraph();
      sourcePath = nextSource;
      continue;
    }
    if (!line || /^-{3,}$/.test(line)) {
      flushParagraph();
      continue;
    }
    if (/^\s{0,3}([-*+]|\d+[.)])\s+/.test(rawLine) || /^#{1,6}\s+/.test(rawLine)) {
      flushParagraph();
      const content = cleanRuleLine(rawLine);
      if (content.length >= 4) {
        rules.push({
          id: `r${rules.length + 1}`,
          sourcePath,
          content,
          originalOrder: rules.length
        });
      }
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return dedupeRules(rules);
}

function dedupeRules(rules) {
  const seen = new Set();
  return rules.filter((rule) => {
    const key = `${rule.sourcePath}:${rule.content.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((rule, index) => ({ ...rule, id: `r${index + 1}`, originalOrder: index }));
}

export function scoreRules(rules, task, openFiles = []) {
  const rawTaskTokens = new Set(tokenize(task));
  const openFileText = Array.isArray(openFiles) ? openFiles.join(" ") : String(openFiles || "");
  const openFileTokens = new Set(tokenize(openFileText));

  return rules.map((rule) => {
    const ruleTokens = new Set(tokenize(rule.content));
    const exactOverlap = [...rawTaskTokens].filter((token) => ruleTokens.has(token));
    const semanticOverlap = [];
    for (const token of rawTaskTokens) {
      for (const alias of SEMANTIC_ALIASES[token] || []) {
        if (!rawTaskTokens.has(alias) && ruleTokens.has(alias)) semanticOverlap.push(`${token}->${alias}`);
      }
    }
    const reasons = [];
    let score = rawTaskTokens.size
      ? (exactOverlap.length + semanticOverlap.length * 0.5) / Math.max(rawTaskTokens.size, 1)
      : 0;

    if (exactOverlap.length) reasons.push(`task:${exactOverlap.join("/")}`);
    if (semanticOverlap.length) reasons.push(`semantic:${semanticOverlap.join("/")}`);

    const lowerRule = rule.content.toLowerCase();
    if (IMPORTANT_WORDS.some((word) => lowerRule.includes(word))) {
      score += 0.4;
      reasons.push("imperative");
    }

    const fileMentions = [...ruleTokens].filter((token) => /[./]/.test(token) || /\.[a-z0-9]+$/.test(token));
    if (fileMentions.some((token) => openFileTokens.has(token) || openFileText.includes(token))) {
      score += 0.2;
      reasons.push("open-file");
    }

    return {
      ...rule,
      score: Math.max(0, Math.min(1, Number(score.toFixed(3)))),
      reasons
    };
  }).sort((a, b) => b.score - a.score || a.originalOrder - b.originalOrder);
}

export async function findRelevantFiles({
  cwd = process.cwd(),
  task = "",
  rules = [],
  dataDir,
  limit = 3,
  embeddingFileFinder = findEmbeddingRelevantFiles,
  fileEmbeddingTimeoutMs,
  fileEmbeddingOptions = {}
} = {}) {
  const rawTaskTokens = new Set(tokenize(task));
  if (!rawTaskTokens.size) return [];

  const candidates = [];
  walkFiles(cwd, (filePath) => {
    const rel = path.relative(cwd, filePath);
    const fileTokens = new Set(tokenize(rel));
    const match = scoreFileTokens({ rawTaskTokens, fileTokens });
    if (match.score > 0) {
      candidates.push({
        path: rel,
        score: match.score,
        reasons: match.reasons
      });
    }
  });

  const heuristicFiles = candidates
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, Math.max(limit * 2, 6));
  const hasHighConfidenceHeuristics =
    heuristicFiles.length >= limit &&
    Number(heuristicFiles[0]?.score || 0) >= 8;
  const embeddingFiles = hasHighConfidenceHeuristics
    ? []
    : await embeddingFileFinder({
      cwd,
      task,
      dataDir,
      timeoutMs: fileEmbeddingTimeoutMs,
      embeddingOptions: fileEmbeddingOptions,
      limit: Math.max(limit * 2, 6)
    });
  const importGraphFiles = expandImportGraph({
    cwd,
    seedFiles: mergeLocalFileCandidates([...heuristicFiles, ...embeddingFiles]).slice(0, limit),
    limit: Math.max(limit * 2, 6)
  });
  const seedFiles = mergeLocalFileCandidates([...heuristicFiles, ...embeddingFiles, ...importGraphFiles])
    .slice(0, Math.max(limit * 3, 9));

  const graphFiles = findGraphRelevantFiles({
    cwd,
    task,
    rules,
    seedFiles,
    limit: Math.max(limit * 2, 6)
  });

  return mergeRelevantFiles({ graphFiles, heuristicFiles: seedFiles, limit });
}

function mergeLocalFileCandidates(files) {
  const byPath = new Map();
  for (const file of files) {
    const existing = byPath.get(file.path);
    byPath.set(file.path, {
      ...existing,
      ...file,
      score: Number(existing?.score || 0) + Number(file.score || 0),
      reasons: [...new Set([...(existing?.reasons || []), ...(file.reasons || [])])],
      source: existing?.source === "import-graph" || file.source === "import-graph" ? "import-graph" : file.source
    });
  }
  return [...byPath.values()].sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

function scoreFileTokens({ rawTaskTokens, fileTokens }) {
  let score = 0;
  const reasons = new Set();
  const hasModerationIntent = rawTaskTokens.has("kiem-duyet") || rawTaskTokens.has("kiemduyet") || rawTaskTokens.has("duyet");
  const hasUploadIntent = rawTaskTokens.has("upload") || rawTaskTokens.has("tai-len") || rawTaskTokens.has("tailen");

  for (const token of rawTaskTokens) {
    if (fileTokens.has(token)) {
      score += 3;
      reasons.add(token);
    }
    for (const alias of SEMANTIC_ALIASES[token] || []) {
      if (fileTokens.has(alias)) {
        score += 2;
        reasons.add(`${token}->${alias}`);
      }
    }
  }

  if (hasModerationIntent && [...fileTokens].some((token) => MODERATION_TOKENS.has(token))) {
    score += 6;
    reasons.add("domain:moderation");
  }

  if (hasUploadIntent && (fileTokens.has("upload") || fileTokens.has("uploaded") || fileTokens.has("resource"))) {
    score += 2;
    reasons.add("domain:upload");
  }

  return { score, reasons: [...reasons] };
}

function walkFiles(directory, onFile, depth = 0) {
  if (depth > 6) return;
  let entries = [];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".github") {
      if (entry.name !== ".codex") continue;
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) walkFiles(fullPath, onFile, depth + 1);
    } else if (entry.isFile()) {
      onFile(fullPath);
    }
  }
}
