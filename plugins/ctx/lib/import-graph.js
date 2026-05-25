import fs from "node:fs";
import path from "node:path";

const JS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const IMPORT_RE = /\bimport\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;

export function expandImportGraph({ cwd = process.cwd(), seedFiles = [], limit = 6 } = {}) {
  const seeds = new Set(seedFiles.map((file) => normalizeRel(file.path)).filter(Boolean));
  if (!seeds.size) return [];

  const files = [];
  for (const root of importGraphRoots(cwd, [...seeds])) {
    walkSourceFiles(root, (filePath) => files.push(path.relative(cwd, filePath)));
  }
  const fileSet = new Set(files);
  const outgoing = new Map();
  const incoming = new Map();

  for (const rel of files) {
    const imports = resolveImports({ cwd, rel, fileSet });
    outgoing.set(rel, imports);
    for (const target of imports) {
      const importers = incoming.get(target) || new Set();
      importers.add(rel);
      incoming.set(target, importers);
    }
  }

  const candidates = new Map();
  for (const seed of seeds) {
    for (const target of outgoing.get(seed) || []) {
      addImportCandidate(candidates, target, `imports:${seed}`, 4);
    }
    for (const importer of incoming.get(seed) || []) {
      addImportCandidate(candidates, importer, `imported-by:${seed}`, 5);
    }
  }

  return [...candidates.values()]
    .filter((file) => !seeds.has(file.path))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit);
}

function importGraphRoots(cwd, seedFiles) {
  const roots = new Set();
  for (const file of seedFiles) {
    const parts = file.split(path.sep);
    const rootParts = parts[0] === "services" && parts[1] ? parts.slice(0, 2) : parts.slice(0, 1);
    const root = path.join(cwd, ...rootParts);
    if (fs.existsSync(root)) roots.add(root);
  }
  return roots.size ? [...roots] : [cwd];
}

function addImportCandidate(candidates, filePath, reason, score) {
  const existing = candidates.get(filePath) || {
    path: filePath,
    score: 0,
    source: "import-graph",
    reasons: []
  };
  existing.score += score;
  existing.reasons.push(reason);
  candidates.set(filePath, {
    ...existing,
    reasons: [...new Set(existing.reasons)]
  });
}

function resolveImports({ cwd, rel, fileSet }) {
  const fullPath = path.join(cwd, rel);
  let content = "";
  try {
    content = fs.readFileSync(fullPath, "utf8");
  } catch {
    return [];
  }

  const resolved = new Set();
  for (const match of content.matchAll(IMPORT_RE)) {
    const specifier = match[1] || match[2];
    if (!specifier?.startsWith(".")) continue;
    const target = resolveRelativeImport(path.dirname(rel), specifier, fileSet);
    if (target) resolved.add(target);
  }
  return [...resolved];
}

function resolveRelativeImport(fromDir, specifier, fileSet) {
  const base = normalizeRel(path.join(fromDir, specifier));
  const candidates = [
    base,
    ...JS_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...JS_EXTENSIONS.map((ext) => path.join(base, `index${ext}`))
  ];
  return candidates.find((candidate) => fileSet.has(candidate)) || null;
}

function normalizeRel(filePath) {
  const normalized = path.normalize(String(filePath || ""));
  if (!normalized || normalized.startsWith("..") || path.isAbsolute(normalized)) return null;
  return normalized;
}

function walkSourceFiles(directory, onFile, depth = 0) {
  if (depth > 8) return;
  let entries = [];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") || ["node_modules", "dist", "build", "coverage", ".next"].includes(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(fullPath, onFile, depth + 1);
    } else if (entry.isFile() && JS_EXTENSIONS.includes(path.extname(entry.name))) {
      onFile(fullPath);
    }
  }
}
