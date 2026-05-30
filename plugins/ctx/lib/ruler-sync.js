import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { execFileSync } from "node:child_process";

import { defaultDataRoot } from "./workspace-data.js";

const DEFAULT_AGENTS = ["codex", "claude", "antigravity"];
const CTX_MCP_NAME = "ctx-mcp";
const CONTEXTOS_PROXY_MARKER = "/contextos/plugins/ctx/mcp/proxy.js";
const MCP_SERVER_RELATIVE = path.join("plugins", "ctx", "mcp", "server.js");
const AGENT_ALIASES = new Map([
  ["agy", "antigravity"],
  ["antigravity", "antigravity"],
  ["codex", "codex"],
  ["claude", "claude"]
]);

function statusLine(label, value) {
  return `[ctx] ${label.padEnd(38)} ${value}`;
}

function runCommand(command, args, { cwd = process.cwd(), stdio = "pipe", dryRun = false } = {}) {
  if (dryRun) return { stdout: "", skipped: true };
  const stdout = execFileSync(command, args, { cwd, stdio, encoding: "utf8", shell: true });
  return { stdout: stdout || "" };
}

export function parseSyncRulesArgs(args = []) {
  const agentsFlag = args.indexOf("--agents");
  const agents = agentsFlag >= 0
    ? normalizeAgentList(String(args[agentsFlag + 1] || "").split(","))
    : DEFAULT_AGENTS;
  return {
    rules: args.includes("--rules"),
    agents,
    dryRun: args.includes("--dry-run"),
    force: args.includes("--force"),
    importCodexMcp: !args.includes("--no-import-codex-mcp"),
    yes: args.includes("--yes") || args.includes("-y")
  };
}

export function normalizeAgentName(agent) {
  const key = String(agent || "").trim().toLowerCase();
  return AGENT_ALIASES.get(key) || key;
}

export function normalizeAgentList(agents = []) {
  return [...new Set(agents.map(normalizeAgentName).filter(Boolean))];
}

function displayAgentName(agent) {
  return agent === "antigravity" ? "agy" : agent;
}

function codexConfigPath() {
  return path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "config.toml");
}

function claudeUserConfigPath() {
  return process.env.CLAUDE_CONFIG_PATH || path.join(os.homedir(), ".claude.json");
}

export function rulerTomlPath(cwd = process.cwd()) {
  return path.join(cwd, ".ruler", "ruler.toml");
}

export function checkRulerInstalled({ run = runCommand } = {}) {
  try {
    const result = run("ruler", ["--version"]);
    return { installed: true, version: result.stdout.trim() || "installed" };
  } catch {
    return { installed: false, version: "" };
  }
}

async function shouldInstallRuler({ yes = false } = {}) {
  if (yes) return true;
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question("[ctx] Ruler is not installed. Install @intellectronica/ruler globally? [Y/n] ");
    return !/^n(o)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

export async function installRuler({ run = runCommand, yes = false, dryRun = false } = {}) {
  const accepted = await shouldInstallRuler({ yes });
  if (!accepted) {
    throw new Error("Ruler is required for ctx sync --rules. Install it with `npm install -g @intellectronica/ruler` or rerun with --yes.");
  }
  run("npm", ["install", "-g", "@intellectronica/ruler"], { stdio: "inherit", dryRun });
}

export function ensureRulerInit({ cwd = process.cwd(), run = runCommand, dryRun = false } = {}) {
  const tomlPath = rulerTomlPath(cwd);
  if (fs.existsSync(tomlPath)) return { created: false, tomlPath };
  run("ruler", ["init"], { cwd, stdio: "inherit", dryRun });
  return { created: true, tomlPath };
}

function removeTomlSection(content, sectionName) {
  const lines = content.split(/\r?\n/);
  const result = [];
  let skipping = false;
  const header = `[${sectionName}]`;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === header) {
      skipping = true;
      continue;
    }
    if (skipping && /^\[[^\]]+\]\s*$/.test(trimmed)) {
      skipping = false;
    }
    if (!skipping) result.push(line);
  }
  return result.join("\n").replace(/\n{3,}/g, "\n\n");
}

function hasTomlSection(content, sectionName) {
  return new RegExp(`^\\[${sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\s*$`, "m").test(content);
}

function findMcpServerSections(content) {
  const lines = String(content || "").split(/\r?\n/);
  const sections = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\[mcp_servers\.([^\].]+)\]\s*$/);
    if (!match) continue;
    let end = lines.length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (/^\[/.test(lines[cursor])) {
        end = cursor;
        break;
      }
    }
    sections.push({
      name: unquoteTomlKey(match[1]),
      body: lines.slice(index + 1, end)
    });
  }
  return sections;
}

function findStringValue(lines, key) {
  const line = lines.find((item) => new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`).test(item));
  if (!line) return null;
  const match = line.match(/=\s*"((?:\\.|[^"\\])*)"/);
  return match ? unescapeTomlString(match[1]) : null;
}

function findArrayValue(lines, key) {
  const line = lines.find((item) => new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`).test(item));
  if (!line) return [];
  const arrayMatch = line.match(/=\s*\[(.*)\]\s*$/);
  if (!arrayMatch) return [];
  const values = [];
  const pattern = /"((?:\\.|[^"\\])*)"/g;
  let match;
  while ((match = pattern.exec(arrayMatch[1]))) values.push(unescapeTomlString(match[1]));
  return values;
}

function tomlString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function tomlArray(values = []) {
  return `[${values.map(tomlString).join(", ")}]`;
}

function unescapeTomlString(value) {
  return String(value).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function unquoteTomlKey(value) {
  return value.replace(/^"|"$/g, "");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unwrapContextOSProxy(command, args = []) {
  if (command !== "node" || !String(args[0] || "").includes(CONTEXTOS_PROXY_MARKER)) {
    return { command, args };
  }
  const separator = args.indexOf("--");
  if (separator < 0 || separator >= args.length - 1) return { command, args };
  return {
    command: args[separator + 1],
    args: args.slice(separator + 2)
  };
}

export function readCodexMcpServers({ configPath = codexConfigPath() } = {}) {
  if (!fs.existsSync(configPath)) return [];
  const content = fs.readFileSync(configPath, "utf8");
  const servers = [];
  for (const section of findMcpServerSections(content)) {
    const command = findStringValue(section.body, "command");
    if (!command) continue;
    const args = findArrayValue(section.body, "args");
    const unwrapped = unwrapContextOSProxy(command, args);
    servers.push({
      name: section.name,
      command: unwrapped.command,
      args: unwrapped.args
    });
  }
  return servers;
}

export function readProjectMcpJsonServers({ cwd = process.cwd(), configPath = path.join(cwd, ".mcp.json") } = {}) {
  if (!fs.existsSync(configPath)) return [];
  const config = readJsonFile(configPath, {});
  const mcpServers = config.mcpServers && typeof config.mcpServers === "object" ? config.mcpServers : {};
  return Object.entries(mcpServers)
    .filter(([, server]) => server && typeof server.command === "string")
    .filter(([, server]) => isRunnableMcpCommand(server.command))
    .map(([name, server]) => ({
      name,
      command: server.command,
      args: Array.isArray(server.args) ? server.args : []
    }));
}

function isRunnableMcpCommand(command) {
  if (isEphemeralAbsoluteCommand(command)) return false;
  if (!path.isAbsolute(command)) return true;
  return fs.existsSync(command);
}

function isEphemeralAbsoluteCommand(command) {
  if (!path.isAbsolute(command)) return false;
  const resolved = path.resolve(command);
  const tmp = path.resolve(os.tmpdir());
  return resolved === tmp || resolved.startsWith(`${tmp}${path.sep}`);
}

function mergeMcpServers(...groups) {
  const merged = new Map();
  for (const group of groups) {
    for (const server of group || []) {
      if (!server?.name || !server?.command) continue;
      if (!merged.has(server.name)) merged.set(server.name, server);
    }
  }
  return [...merged.values()];
}

function readRulerMcpServers({ tomlPath } = {}) {
  if (!tomlPath || !fs.existsSync(tomlPath)) return [];
  const content = fs.readFileSync(tomlPath, "utf8");
  const servers = [];
  for (const section of findMcpServerSections(content)) {
    const command = findStringValue(section.body, "command");
    if (!command) continue;
    servers.push({
      name: section.name,
      command,
      args: findArrayValue(section.body, "args")
    });
  }
  return servers;
}

function readRulerMcpServer({ tomlPath, name } = {}) {
  return readRulerMcpServers({ tomlPath }).find((server) => server.name === name) || null;
}

function antigravityMcpConfigPaths() {
  const home = os.homedir();
  return [
    path.join(home, ".gemini", "antigravity", "mcp_config.json"),
    path.join(home, ".gemini", "antigravity-cli", "mcp_config.json"),
    path.join(home, ".gemini", "config", "mcp_config.json")
  ];
}

function readJsonFile(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function syncAntigravityMcpFromRuler({ tomlPath, configPaths = antigravityMcpConfigPaths(), dryRun = false } = {}) {
  const allServers = readRulerMcpServers({ tomlPath });
  const servers = allServers.filter((server) => isRunnableMcpCommand(server.command));
  const skipped = allServers.filter((server) => !isRunnableMcpCommand(server.command)).map((server) => server.name);
  if (!servers.length && !skipped.length) return { changed: false, servers: [], skipped, removed: [], configPaths };

  const removed = [];
  for (const configPath of configPaths) {
    const config = readJsonFile(configPath, {});
    if (!config.mcpServers || typeof config.mcpServers !== "object") config.mcpServers = {};
    for (const [name, server] of Object.entries(config.mcpServers)) {
      if (server?.command && !isRunnableMcpCommand(server.command)) {
        delete config.mcpServers[name];
        removed.push(name);
      }
    }
    for (const server of servers) {
      config.mcpServers[server.name] = {
        command: server.command,
        args: server.args || []
      };
    }
    if (!dryRun) writeJsonFile(configPath, config);
  }

  return { changed: true, servers: servers.map((server) => server.name), skipped, removed: [...new Set(removed)], configPaths };
}

export function pruneClaudeProjectCtxMcp({
  cwd = process.cwd(),
  projectConfigPath = path.join(cwd, ".mcp.json"),
  userConfigPath = claudeUserConfigPath(),
  dryRun = false
} = {}) {
  const userConfig = readJsonFile(userConfigPath, {});
  const userHasCtx = Boolean(userConfig?.mcpServers?.[CTX_MCP_NAME]);
  if (!userHasCtx || !fs.existsSync(projectConfigPath)) {
    return { changed: false, removed: false, projectConfigPath };
  }

  const projectConfig = readJsonFile(projectConfigPath, {});
  if (!projectConfig?.mcpServers?.[CTX_MCP_NAME]) {
    return { changed: false, removed: false, projectConfigPath };
  }

  delete projectConfig.mcpServers[CTX_MCP_NAME];
  if (!dryRun) writeJsonFile(projectConfigPath, projectConfig);
  return { changed: true, removed: true, projectConfigPath };
}

export function buildCtxMcpToml({ mcpServerPath, agents = DEFAULT_AGENTS } = {}) {
  const blocks = [
    "# Added by ctx sync --rules",
    "[mcp]",
    "enabled = true",
    'merge_strategy = "merge"',
    "",
    `[mcp_servers.${CTX_MCP_NAME}]`,
    'command = "node"',
    `args = [${JSON.stringify(mcpServerPath)}]`
  ];

  for (const agent of agents) {
    const outputPath = agent === "claude" ? "CLAUDE.md" : "AGENTS.md";
    blocks.push(
      "",
      `[agents.${agent}]`,
      "enabled = true",
      `output_path = "${outputPath}"`,
      "",
      `[agents.${agent}.mcp]`,
      "enabled = true",
      'merge_strategy = "merge"'
    );
  }

  return `${blocks.join("\n")}\n`;
}

export function buildMcpServerToml(server) {
  return [
    `# Imported by ctx sync --rules from Codex MCP config`,
    `[mcp_servers.${server.name}]`,
    `command = ${tomlString(server.command)}`,
    `args = ${tomlArray(server.args || [])}`
  ].join("\n");
}

export function injectMcpServers({ tomlPath, servers = [], force = false, dryRun = false } = {}) {
  if (!servers.length) return { changed: false, added: [], skipped: [] };
  let content = fs.existsSync(tomlPath) ? fs.readFileSync(tomlPath, "utf8") : "";
  const added = [];
  const skipped = [];

  for (const server of servers) {
    if (!server?.name || !server?.command) continue;
    const sectionName = `mcp_servers.${server.name}`;
    const exists = hasTomlSection(content, sectionName);
    if (exists && !force) {
      skipped.push(server.name);
      continue;
    }
    if (exists && force) content = removeTomlSection(content, sectionName);
    const prefix = content.trim() ? "\n\n" : "";
    content = `${content.trimEnd()}${prefix}${buildMcpServerToml(server)}\n`;
    added.push(server.name);
  }

  if (added.length && !dryRun) {
    fs.mkdirSync(path.dirname(tomlPath), { recursive: true });
    fs.writeFileSync(tomlPath, content, "utf8");
  }
  return { changed: added.length > 0, added, skipped, content };
}

export function injectCtxMcp({ tomlPath, mcpServerPath, agents = DEFAULT_AGENTS, force = false, dryRun = false } = {}) {
  if (!fs.existsSync(tomlPath)) {
    if (dryRun) return { changed: true, existed: false, content: buildCtxMcpToml({ mcpServerPath, agents }) };
    fs.mkdirSync(path.dirname(tomlPath), { recursive: true });
    fs.writeFileSync(tomlPath, buildCtxMcpToml({ mcpServerPath, agents }), "utf8");
    return { changed: true, existed: false };
  }

  let content = fs.readFileSync(tomlPath, "utf8");
  const sectionExists = hasTomlSection(content, `mcp_servers.${CTX_MCP_NAME}`);
  if (sectionExists && !force) {
    const existingServer = readRulerMcpServer({ tomlPath, name: CTX_MCP_NAME });
    const existingPath = existingServer?.command === "node" ? existingServer.args?.[0] : existingServer?.command;
    if (existingPath && isRunnableMcpCommand(existingPath)) return { changed: false, existed: true };
    force = true;
  }

  if (force) {
    content = removeTomlSection(content, "mcp");
    content = removeTomlSection(content, `mcp_servers.${CTX_MCP_NAME}`);
    for (const agent of agents) {
      content = removeTomlSection(content, `agents.${agent}`);
      content = removeTomlSection(content, `agents.${agent}.mcp`);
    }
  }

  const next = `${content.trimEnd()}\n\n${buildCtxMcpToml({ mcpServerPath, agents })}`;
  if (!dryRun) fs.writeFileSync(tomlPath, next, "utf8");
  return { changed: true, existed: sectionExists, content: next };
}

export function runRulerApply({ agents = DEFAULT_AGENTS, cwd = process.cwd(), run = runCommand, dryRun = false } = {}) {
  run("ruler", ["apply", "--agents", normalizeAgentList(agents).join(",")], { cwd, stdio: "inherit", dryRun });
}

function fileContains(filePath, pattern) {
  try {
    return fs.readFileSync(filePath, "utf8").includes(pattern);
  } catch {
    return false;
  }
}

export function verifySync({ cwd = process.cwd(), agents = DEFAULT_AGENTS } = {}) {
  const checks = [];
  const definitions = {
    codex: [path.join(cwd, ".codex", "config.toml")],
    claude: [path.join(cwd, ".mcp.json"), path.join(cwd, ".claude", "settings.json"), path.join(os.homedir(), ".claude.json")],
    antigravity: [
      path.join(cwd, ".gemini", "settings.json"),
      path.join(cwd, ".gemini", "mcp.json"),
      ...antigravityMcpConfigPaths(),
      path.join(cwd, "AGENTS.md")
    ]
  };

  for (const agent of agents) {
    const files = definitions[agent] || [];
    const found = files.find((filePath) => fileContains(filePath, CTX_MCP_NAME));
    checks.push({ agent, ok: Boolean(found), filePath: found || files[0] || "" });
  }
  return checks;
}

function resolveStableMcpServerPath(rootDir) {
  const codexRoot = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "marketplaces", "contextos");
  const dataRoot = defaultDataRoot();
  const candidates = [
    path.join(codexRoot, MCP_SERVER_RELATIVE),
    path.join(dataRoot, "agents", "claude", "contextos", MCP_SERVER_RELATIVE),
    path.join(dataRoot, "agents", "agy", "contextos", MCP_SERVER_RELATIVE),
    path.join(rootDir, MCP_SERVER_RELATIVE)
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(rootDir, MCP_SERVER_RELATIVE);
}

export async function syncRules({
  cwd = process.cwd(),
  rootDir,
  args = [],
  run = runCommand,
  logger = console.log
} = {}) {
  const options = parseSyncRulesArgs(args);
  if (!options.rules) throw new Error("Usage: ctx sync --rules [--agents codex,claude,antigravity] [--dry-run] [--force]");

  logger("");
  const ruler = checkRulerInstalled({ run });
  if (!ruler.installed) {
    logger(statusLine("Checking ruler installation...", options.dryRun ? "missing (dry-run)" : "missing"));
    if (!options.dryRun) await installRuler({ run, yes: options.yes });
  } else {
    logger(statusLine("Checking ruler installation...", `✓ ${ruler.version}`));
  }

  const init = ensureRulerInit({ cwd, run, dryRun: options.dryRun });
  logger(statusLine("Checking .ruler/ruler.toml...", init.created ? "✓ created" : "✓ found"));

  const mcpServerPath = resolveStableMcpServerPath(rootDir);
  const injected = injectCtxMcp({
    tomlPath: init.tomlPath,
    mcpServerPath,
    agents: options.agents,
    force: options.force,
    dryRun: options.dryRun
  });
  logger(statusLine("Injecting ctx-mcp into ruler.toml...", injected.changed ? "✓ added" : "✓ already configured"));

  let importedMcp = { added: [], skipped: [] };
  let importedServers = [];
  if (options.importCodexMcp) {
    importedServers = mergeMcpServers(
      readCodexMcpServers(),
      readProjectMcpJsonServers({ cwd })
    ).filter((server) => server.name !== CTX_MCP_NAME);
    importedMcp = injectMcpServers({
      tomlPath: init.tomlPath,
      servers: importedServers,
      force: options.force,
      dryRun: options.dryRun
    });
    const importedLabel = importedMcp.added.length
      ? `✓ added ${importedMcp.added.join(", ")}`
      : importedServers.length
        ? "✓ already configured"
        : "none found";
    logger(statusLine("Importing existing MCP servers...", importedLabel));
  }

  logger("[ctx] Running ruler apply...");
  runRulerApply({ agents: options.agents, cwd, run, dryRun: options.dryRun });

  let claudePrune = { changed: false, removed: false };
  if (options.agents.includes("claude")) {
    claudePrune = pruneClaudeProjectCtxMcp({ cwd, dryRun: options.dryRun });
    logger(statusLine("Deduping Claude ctx-mcp scope...", claudePrune.removed ? "✓ removed project duplicate" : "✓ no duplicate"));
  }

  let antigravityMcp = { changed: false, servers: [], configPaths: [] };
  if (options.agents.includes("antigravity")) {
    antigravityMcp = options.dryRun
      ? {
        changed: true,
        servers: [CTX_MCP_NAME, ...importedServers.map((server) => server.name)],
        configPaths: antigravityMcpConfigPaths()
      }
      : syncAntigravityMcpFromRuler({ tomlPath: init.tomlPath });
    logger(statusLine("Syncing Antigravity MCP config...", antigravityMcp.servers.length ? `✓ ${antigravityMcp.servers.join(", ")}` : "none found"));
  }

  logger("[ctx] Verifying sync...");
  const checks = options.dryRun ? options.agents.map((agent) => ({ agent, ok: true, filePath: "(dry-run)" })) : verifySync({ cwd, agents: options.agents });
  for (const check of checks) {
    logger(`      → ctx-mcp in ${displayAgentName(check.agent).padEnd(12)} ${check.ok ? "✓" : "not found"}${check.filePath ? ` ${check.filePath}` : ""}`);
  }

  const okCount = checks.filter((check) => check.ok).length;
  logger("");
  logger(`[ctx] ${options.dryRun ? "Dry run complete" : "Done"}. Rules ${options.dryRun ? "would sync" : "synced"} to ${okCount}/${options.agents.length} agents.`);
  logger(`      ${options.dryRun ? "No files were changed." : "Restart each agent to activate ctx-mcp."}`);

  return { options, ruler, init, injected, importedMcp, antigravityMcp, checks };
}
