import fs from "node:fs";
import path from "node:path";

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return fallback;
  return JSON.parse(raw);
}

function commandFor(installRoot, scriptName, { injectPromptContext = true } = {}) {
  const envPrefix = scriptName === "on-antigravity-preinvocation.js" && !injectPromptContext ? "CONTEXTOS_INJECT=0 " : "";
  return `${envPrefix}node ${shellQuote(path.join(installRoot, "plugins", "ctx", "bin", scriptName))}`;
}

export function antigravityHooksPath() {
  return process.env.ANTIGRAVITY_HOOKS_PATH
    || path.join(process.env.HOME || process.cwd(), ".gemini", "config", "hooks.json");
}

export function buildAntigravityHooksConfig(existingConfig, { installRoot, injectPromptContext = true } = {}) {
  const config = existingConfig && typeof existingConfig === "object" ? structuredClone(existingConfig) : {};
  config.contextos = {
    enabled: true,
    PreInvocation: [
      {
        type: "command",
        command: commandFor(installRoot, "on-antigravity-preinvocation.js", { injectPromptContext }),
        timeout: 10
      }
    ],
    Stop: [
      {
        type: "command",
        command: commandFor(installRoot, "on-antigravity-stop.js"),
        timeout: 10
      }
    ]
  };
  return config;
}

export function installAntigravityHooks({ hooksPath = antigravityHooksPath(), installRoot, injectPromptContext = true } = {}) {
  const existing = readJsonFile(hooksPath, {});
  const next = buildAntigravityHooksConfig(existing, { installRoot, injectPromptContext });
  fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
  fs.writeFileSync(hooksPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return hooksPath;
}
