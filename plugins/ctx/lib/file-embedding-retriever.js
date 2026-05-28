import fs from "node:fs";
import path from "node:path";
import { enhanceRuleScoresWithEmbeddings, isModelCacheReady, warmRuleEmbeddings } from "./embedding-scorer.js";

const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".sql", ".md", ".json"
]);
const IGNORE_DIRS = new Set([
  ".git", ".next", ".turbo", "coverage", "dist", "build", "node_modules", "vendor"
]);
const DEFAULT_TIMEOUT_MS = 80;
const DEFAULT_MAX_FILES = 1200;

export async function findEmbeddingRelevantFiles({
  cwd = process.cwd(),
  task = "",
  dataDir,
  limit = 10,
  timeoutMs = Number(process.env.CONTEXTOS_FILE_EMBEDDING_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  maxFiles = Number(process.env.CONTEXTOS_FILE_EMBEDDING_MAX_FILES || DEFAULT_MAX_FILES),
  embeddingOptions = {}
} = {}) {
  if (process.env.CONTEXTOS_FILE_EMBEDDINGS === "0") return [];
  if (!dataDir) return [];
  if (!String(task || "").trim()) return [];

  const files = listSourceFiles(cwd, { maxFiles });
  if (!files.length) return [];

  const fileRules = files.map((filePath, index) => ({
    id: `f${index + 1}`,
    content: fileSearchText(filePath),
    path: filePath,
    score: 0,
    reasons: [],
    originalOrder: index
  }));

  const result = await enhanceRuleScoresWithEmbeddings(fileRules, task, {
    dataDir,
    sources: [path.join(cwd, "AGENTS.md")],
    timeoutMs,
    allowRemote: false,
    ...embeddingOptions
  });

  if (result.status !== "enabled") return [];

  return result.rules
    .filter((rule) => Number(rule.embeddingScore || 0) >= 0.45)
    .sort((a, b) => Number(b.embeddingScore || 0) - Number(a.embeddingScore || 0) || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((rule) => ({
      path: rule.path,
      score: Math.round(Number(rule.embeddingScore || 0) * 10),
      source: "embedding",
      reasons: [`file-embedding:${Number(rule.embeddingScore || 0).toFixed(2)}`]
    }));
}

export async function warmFileEmbeddings({
  cwd = process.cwd(),
  dataDir,
  allowRemote = true,
  maxFiles = Number(process.env.CONTEXTOS_FILE_EMBEDDING_MAX_FILES || DEFAULT_MAX_FILES)
} = {}) {
  if (!dataDir) return { count: 0, cachePath: null };
  if (!allowRemote && !isModelCacheReady(dataDir)) return { count: 0, cachePath: null, status: "missing-model" };
  const files = listSourceFiles(cwd, { maxFiles });
  const rules = files.map((filePath) => ({ content: fileSearchText(filePath) }));
  return warmRuleEmbeddings({
    rules,
    task: "project file semantic retrieval",
    dataDir,
    sources: [path.join(cwd, "AGENTS.md")],
    allowRemote
  });
}

function listSourceFiles(cwd, { maxFiles }) {
  const files = [];
  walkFiles(cwd, (filePath) => {
    if (files.length >= maxFiles) return;
    files.push(path.relative(cwd, filePath));
  });
  return files;
}

function walkFiles(directory, onFile, depth = 0) {
  if (depth > 7) return;
  let entries = [];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    if (IGNORE_DIRS.has(entry.name)) continue;

    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, onFile, depth + 1);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      onFile(fullPath);
    }
  }
}

function fileSearchText(filePath) {
  const normalized = String(filePath || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[._/-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
  return `${filePath} ${normalized}`;
}
