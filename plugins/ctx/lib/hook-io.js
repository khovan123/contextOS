import fs from "node:fs";
import path from "node:path";
import { writeJsonFile } from "./fs-utils.js";
import { defaultDataRoot, workspaceDataDir } from "./workspace-data.js";

export async function readStdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

export function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

export function resolveHookCwd(payload = {}) {
  return payload.cwd
    || payload.working_directory
    || payload.workspacePath
    || payload.workspace_path
    || payload.workspaceRoot
    || payload.workspace_root
    || payload.projectDir
    || payload.project_dir
    || payload.workspacePaths?.[0]
    || payload.workspace_paths?.[0]
    || process.env.CLAUDE_PROJECT_DIR
    || process.env.PWD
    || process.cwd();
}

export function pluginDataDir(fileName = "", cwd = process.cwd()) {
  let root;
  try {
    root = workspaceDataDir({ cwd });
    fs.mkdirSync(root, { recursive: true });
  } catch {
    return path.join(process.cwd(), ".contextos", fileName);
  }
  return path.join(root, fileName);
}

export function pluginDataRoot(fileName = "") {
  const root = defaultDataRoot();
  try {
    fs.mkdirSync(root, { recursive: true });
  } catch {
    return path.join(process.cwd(), ".contextos", fileName);
  }
  return path.join(root, fileName);
}

export function pluginRuntimeFile(fileName = "", cwd) {
  return cwd ? pluginDataDir(fileName, cwd) : pluginDataRoot(fileName);
}

export function logDebug(event, payload) {
  const line = JSON.stringify({ at: new Date().toISOString(), event, payload });
  try {
    fs.appendFileSync(pluginRuntimeFile("debug.log", payload?.cwd || payload?.working_directory), `${line}\n`, "utf8");
  } catch {
    // Logging must never break Codex hooks.
  }
}

export function logError(event, error) {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    event,
    message: error?.message || String(error),
    stack: error?.stack
  });
  try {
    fs.appendFileSync(pluginDataDir("error.log"), `${line}\n`, "utf8");
  } catch {
    // failOpen depends on this staying best-effort.
  }
}

export function failOpen(event, error, fallback) {
  logError(event, error);
  writeJson(fallback);
}

export function persistRuntime(name, value) {
  try {
    writeJsonFile(pluginDataDir(name), value);
  } catch {
    // Runtime persistence is diagnostic; hook output is the critical path.
  }
}
