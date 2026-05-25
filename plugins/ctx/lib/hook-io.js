import fs from "node:fs";
import path from "node:path";
import { writeJsonFile } from "./fs-utils.js";

function codexHome() {
  return process.env.CODEX_HOME || path.join(process.env.HOME || process.cwd(), ".codex");
}

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

export function pluginDataDir(fileName = "") {
  const root = process.env.PLUGIN_DATA || path.join(codexHome(), "contextos");
  try {
    fs.mkdirSync(root, { recursive: true });
  } catch {
    return path.join(process.cwd(), ".contextos", fileName);
  }
  return path.join(root, fileName);
}

export function logDebug(event, payload) {
  const line = JSON.stringify({ at: new Date().toISOString(), event, payload });
  try {
    fs.appendFileSync(pluginDataDir("debug.log"), `${line}\n`, "utf8");
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
