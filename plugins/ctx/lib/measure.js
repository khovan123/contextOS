import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { tokenize } from "./analyzer.js";

const COMPLIANCE_STOPWORDS = new Set([
  "always",
  "before",
  "cannot",
  "cheaper",
  "context",
  "coverage",
  "dependents",
  "faster",
  "fewer",
  "gives",
  "important",
  "instead",
  "never",
  "project",
  "rules",
  "scanning",
  "strictly",
  "structural",
  "that",
  "this",
  "tools",
  "use",
  "using",
  "visible"
]);

const RUNTIME_EVIDENCE_PATTERNS = [
  /\bbefore\s+(using|reading|grep|glob|read|searching)/i,
  /\bafter\s+(running|checking|reading)/i,
  /\balways\s+use\s+(code-review-graph|mcp|memory|agentmemory)\b/i,
  /\bmust\s+run\b/i,
  /\bdo not\s+prefix\b/i,
  /\bkhong\s+the\b/i
];

const TEXT_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json", ".md", ".txt", ".yml", ".yaml", ".sql", ".py", ".sh", ".css", ".scss", ".html"
]);
const MAX_STATUS_FILE_LINES = 400;
const MAX_STATUS_FILE_BYTES = 200_000;

export function readGitSnapshot({ cwd = process.cwd() } = {}) {
  try {
    const diff = execFileSync("git", ["diff", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 1000
    });
    return parseGitDiff(diff);
  } catch {
    try {
      const status = execFileSync("git", ["status", "--short"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 1000
      });
      const changedFiles = parseStatusFiles(status);
      return {
        mode: "status",
        changedFiles,
        addedLines: collectStatusAddedLines({ cwd, changedFiles }),
        warnings: ["git diff HEAD unavailable; used git status and readable file content"]
      };
    } catch {
      return {
        mode: "none",
        changedFiles: [],
        addedLines: [],
        warnings: ["git unavailable; skipped ContextOS measurement"]
      };
    }
  }
}

function parseStatusFiles(status) {
  return String(status || "")
    .split(/\r?\n/)
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .map((file) => file.includes(" -> ") ? file.split(" -> ").at(-1).trim() : file);
}

function collectStatusAddedLines({ cwd, changedFiles }) {
  const addedLines = [];
  for (const file of changedFiles) {
    if (addedLines.length >= MAX_STATUS_FILE_LINES) break;
    if (!isReadableTextFile(file)) continue;
    const fullPath = path.join(cwd, file);
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > MAX_STATUS_FILE_BYTES) continue;
    let content = "";
    try {
      content = fs.readFileSync(fullPath, "utf8");
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/).slice(0, MAX_STATUS_FILE_LINES - addedLines.length);
    lines.forEach((line, index) => {
      if (line.trim()) addedLines.push({ file, line: index + 1, content: line });
    });
  }
  return addedLines;
}

function isReadableTextFile(file) {
  const base = path.basename(file);
  if (base === "AGENTS.md" || base === "README.md" || base === "package.json") return true;
  return TEXT_EXTENSIONS.has(path.extname(file));
}

export function parseGitDiff(diff) {
  const changedFiles = new Set();
  const addedLines = [];
  let currentFile = null;
  let newLine = null;

  for (const line of String(diff || "").split(/\r?\n/)) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) {
      currentFile = fileMatch[1];
      changedFiles.add(currentFile);
      continue;
    }
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      newLine = Number(hunkMatch[1]);
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      addedLines.push({ file: currentFile, line: newLine, content: line.slice(1) });
      if (typeof newLine === "number") newLine += 1;
    } else if (!line.startsWith("-") && typeof newLine === "number") {
      newLine += 1;
    }
  }

  return {
    mode: "diff",
    changedFiles: [...changedFiles],
    addedLines,
    warnings: []
  };
}

export function checkCompliance({ rules = [], addedLines = [] } = {}) {
  const results = [];

  for (const rule of rules) {
    const lower = rule.content.toLowerCase();
    const keywords = extractComplianceKeywords(rule.content);
    const isRuntimeOnly = needsRuntimeEvidence(rule.content);
    const kind = lower.includes("no ") || lower.includes("never") || lower.includes("khong")
      ? "forbidden"
      : "required";

    if (!keywords.length || !addedLines.length) {
      results.push({
        rule,
        status: "unknown",
        kind,
        keywords,
        evidence: !addedLines.length ? "no added lines in git diff" : "no concrete compliance keywords found"
      });
      continue;
    }

    if (isRuntimeOnly) {
      results.push({
        rule,
        status: "unknown",
        kind: "runtime",
        keywords,
        evidence: "requires runtime/tool-call evidence, not git diff evidence"
      });
      continue;
    }

    if (kind === "forbidden") {
      const violation = findKeywordEvidence(addedLines, keywords);
      const violated = violation?.keyword;
      results.push(violated
        ? {
          rule,
          status: "ignored",
          kind,
          keywords,
          evidence: `found forbidden ${violated} in ${formatLineRef(violation.line)}`,
          matchedLines: [violation.line]
        }
        : {
          rule,
          status: "followed",
          kind,
          keywords,
          evidence: `forbidden keywords not found: ${keywords.join(", ")}`
        });
      continue;
    }

    const match = findKeywordEvidence(addedLines, keywords);
    const matched = match?.keyword;
    results.push(matched
      ? {
        rule,
        status: "followed",
        kind,
        keywords,
        evidence: `found required ${matched} in ${formatLineRef(match.line)}`,
        matchedLines: [match.line]
      }
      : {
        rule,
        status: "unknown",
        kind,
        keywords,
        evidence: `expected keywords not visible in added lines: ${keywords.join(", ")}`
      });
  }

  return results;
}

function needsRuntimeEvidence(content) {
  return RUNTIME_EVIDENCE_PATTERNS.some((pattern) => pattern.test(content));
}

function findKeywordEvidence(lines, keywords) {
  for (const keyword of keywords) {
    const normalized = keyword.toLowerCase();
    const line = lines.find((item) => String(item.content || "").toLowerCase().includes(normalized));
    if (line) return { keyword, line };
  }
  return null;
}

function formatLineRef(line) {
  if (!line?.file) return "diff";
  return typeof line.line === "number" ? `${line.file}:${line.line}` : line.file;
}

function extractComplianceKeywords(content) {
  const explicit = [...String(content || "").matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  const tokens = tokenize(content).filter((token) => {
    if (token.length < 3) return false;
    if (COMPLIANCE_STOPWORDS.has(token)) return false;
    return /[./_-]/.test(token) || /^[a-z][a-z0-9]*$/i.test(token);
  });
  return [...new Set([...explicit, ...tokens])].slice(0, 8);
}
