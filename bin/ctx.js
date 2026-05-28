#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { readAgentsChain } from "../plugins/ctx/lib/reader.js";
import { filterActionableRules, parseRules, scoreRules } from "../plugins/ctx/lib/analyzer.js";
import { scheduleContext } from "../plugins/ctx/lib/scheduler.js";
import { formatEvidence, formatReport } from "../plugins/ctx/lib/reporter.js";
import { installGlobalHooks } from "../plugins/ctx/lib/global-hooks.js";
import { formatStats, loadStats } from "../plugins/ctx/lib/stats.js";
import { modelCacheDir, warmRuleEmbeddings } from "../plugins/ctx/lib/embedding-scorer.js";
import { warmFileEmbeddings } from "../plugins/ctx/lib/file-embedding-retriever.js";
import { scoreContext } from "../plugins/ctx/lib/score-context.js";
import { defaultDataRoot, workspaceDataDir, workspaceMarkerPath } from "../plugins/ctx/lib/workspace-data.js";
import { installMcpTelemetryProxies } from "../plugins/ctx/lib/mcp-proxy-install.js";
import { benchmarkWorkspace, formatBenchmark } from "../plugins/ctx/lib/benchmark.js";
import { copyDir, copyPackageRoot } from "../plugins/ctx/lib/package-install.js";
import { installClaudeHooks } from "../plugins/ctx/lib/claude-hooks.js";
import { installAntigravityHooks } from "../plugins/ctx/lib/antigravity-hooks.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const pluginSourceDir = path.join(rootDir, "plugins", "ctx");

function usage() {
  return `ContextOS (ctx)

Usage:
  ctx install
  ctx install codex
  ctx install claude
  ctx install agy
  ctx install --agent codex|claude|agy
  ctx install --quiet
  ctx install --inject
  ctx install --copy
  ctx debug -- "task"
  ctx report
  ctx evidence
  ctx stats
  ctx benchmark -- "task"
  ctx embeddings warm -- "task"
  ctx --version
`;
}

function packageVersion() {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
    return packageJson.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function codexHome() {
  return process.env.CODEX_HOME || path.join(process.env.HOME || process.cwd(), ".codex");
}

function copyInstall() {
  const target = path.join(codexHome(), "plugins", "ctx");
  fs.rmSync(target, { recursive: true, force: true });
  copyDir(pluginSourceDir, target);
  console.log(`Installed ctx plugin to ${target}`);
  console.log("Restart Codex if it was already running, then submit a task to trigger ContextOS.");
}

function agentInstallRoot(agent) {
  return path.join(contextOSDataDir(), "agents", agent, "contextos");
}

async function install({ copy = false, inject = true, agent = "codex" } = {}) {
  if (copy) {
    copyInstall();
    return;
  }

  if (agent === "claude") {
    const installRoot = copyPackageRoot({ rootDir, targetRoot: agentInstallRoot("claude") });
    const hooksPath = installClaudeHooks({ installRoot, injectPromptContext: inject });
    console.log("Preparing required local embedding model...");
    const warmResult = await warmInstallEmbeddings();
    console.log("Installed ctx hooks for Claude Code.");
    console.log(`Stable install root: ${installRoot}`);
    console.log(`Installed ContextOS hooks to ${hooksPath}`);
    console.log(`Embedding model cache: ${modelCacheDir(contextOSDataDir())}`);
    console.log(`Embedding vectors cache: ${warmResult.cachePath}`);
    console.log(`File path embeddings warmed: ${warmResult.fileCount || 0}`);
    console.log(`Prompt context injection: ${inject ? "enabled" : "quiet logging only"}`);
    console.log("Restart Claude Code if it was already running, then submit a task to trigger ContextOS.");
    return;
  }

  if (agent === "agy") {
    const installRoot = copyPackageRoot({ rootDir, targetRoot: agentInstallRoot("agy") });
    const hooksPath = installAntigravityHooks({ installRoot, injectPromptContext: inject });
    console.log("Preparing required local embedding model...");
    const warmResult = await warmInstallEmbeddings();
    console.log("Installed ctx hooks for Antigravity.");
    console.log(`Stable install root: ${installRoot}`);
    console.log(`Installed ContextOS hooks to ${hooksPath}`);
    console.log(`Embedding model cache: ${modelCacheDir(contextOSDataDir())}`);
    console.log(`Embedding vectors cache: ${warmResult.cachePath}`);
    console.log(`File path embeddings warmed: ${warmResult.fileCount || 0}`);
    console.log(`Prompt context injection: ${inject ? "enabled" : "quiet logging only"}`);
    console.log("Restart Antigravity or agy if it was already running, then submit a task to trigger ContextOS.");
    return;
  }

  if (agent !== "codex") {
    throw new Error(`Unknown agent '${agent}'. Expected codex, claude, or agy.`);
  }

  const marketplaceRoot = path.join(codexHome(), "marketplaces", "contextos");
  copyPackageRoot({ rootDir, targetRoot: marketplaceRoot });

  tryRunCodex(["plugin", "remove", "ctx@contextos"]);
  tryRunCodex(["plugin", "marketplace", "remove", "contextos"]);
  tryRunCodex(["mcp", "remove", "ctx-mcp"]);
  runCodex(["plugin", "marketplace", "add", marketplaceRoot]);
  runCodex(["plugin", "add", "ctx@contextos"]);
  runCodex(["mcp", "add", "ctx-mcp", "--", "node", path.join(marketplaceRoot, "plugins", "ctx", "mcp", "server.js")]);
  const proxyResult = installMcpTelemetryProxies({ codexHome: codexHome(), marketplaceRoot });
  const hooksPath = installGlobalHooks({ codexHome: codexHome(), marketplaceRoot, injectPromptContext: inject });

  console.log("Preparing required local embedding model...");
  const warmResult = await warmInstallEmbeddings();
  console.log("Installed ctx through Codex plugin marketplace.");
  console.log(`Stable marketplace root: ${marketplaceRoot}`);
  console.log(`Installed ContextOS global hooks to ${hooksPath}`);
  console.log("Installed ctx-mcp MCP server.");
  console.log(`MCP telemetry proxies: ${proxyResult.wrapped.length ? proxyResult.wrapped.map((item) => item.name).join(", ") : "none changed"}`);
  console.log(`Embedding model cache: ${modelCacheDir(contextOSDataDir())}`);
  console.log(`Embedding vectors cache: ${warmResult.cachePath}`);
  console.log(`File path embeddings warmed: ${warmResult.fileCount || 0}`);
  console.log(`Prompt context injection: ${inject ? "enabled" : "quiet logging only"}`);
  console.log("Restart Codex if it was already running, then submit a task to trigger ContextOS.");
}

async function warmInstallEmbeddings() {
  const dataDir = contextOSDataDir();
  const result = await warmRuleEmbeddings({
    rules: [
      { content: "Always use project rules that are semantically relevant to the user prompt." },
      { content: "Find code files by meaning, imports, graph relationships, and task intent." },
      { content: "Use local embeddings to bridge natural language and code vocabulary mismatch." }
    ],
    task: "kiểm duyệt upload moderation semantic code search",
    dataDir,
    sources: [],
    allowRemote: true
  });
  const fileResult = await warmFileEmbeddings({
    cwd: process.cwd(),
    dataDir,
    allowRemote: true
  });
  return { ...result, fileCount: fileResult.count };
}

function tryRunCodex(args) {
  try {
    execFileSync("codex", args, { stdio: "ignore" });
  } catch {
    // Best effort cleanup for repeat installs.
  }
}

function runCodex(args) {
  try {
    execFileSync("codex", args, { stdio: "inherit" });
  } catch (error) {
    const status = typeof error.status === "number" ? error.status : 1;
    throw new Error(`codex ${args.join(" ")} failed with exit code ${status}. Make sure Codex CLI is installed and authenticated.`);
  }
}

function loadLastReport() {
  const workspaceDir = contextOSWorkspaceDataDir();
  const candidates = [
    path.join(workspaceDir, "last-report.json"),
    path.join(codexHome(), "contextos", "last-report.json"),
    path.join(codexHome(), "marketplaces", "contextos", "plugins", "ctx", ".data", "last-report.json"),
    path.join(codexHome(), "plugins", "ctx", ".data", "last-report.json"),
    path.join(process.cwd(), ".contextos", "last-report.json")
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return JSON.parse(fs.readFileSync(candidate, "utf8"));
    }
  }
  throw new Error("No ContextOS report found. Run a Codex task with the ctx plugin enabled first.");
}

function contextOSDataDir() {
  return defaultDataRoot();
}

function contextOSWorkspaceDataDir(cwd = process.cwd()) {
  return workspaceDataDir({ cwd, dataRoot: contextOSDataDir() });
}

async function debug(task) {
  const cwd = process.cwd();
  const scored = await scoreContext({
    cwd,
    prompt: task,
    dataDir: contextOSDataDir(),
    maxFiles: 3,
    embeddingTimeoutMs: Number(process.env.CONTEXTOS_EMBEDDING_DEBUG_TIMEOUT_MS || 5000)
  });
  const rules = scored.scoredRules;
  const relevantFiles = scored.suggestedFiles.slice(0, 3);
  const scheduled = scheduleContext({ rules, relevantFiles });

  console.log("ContextOS debug");
  console.log(`cwd: ${cwd}`);
  console.log(`workspace data: ${contextOSWorkspaceDataDir(cwd)}`);
  console.log(`workspace marker: ${workspaceMarkerPath(cwd)}`);
  console.log(`rules: ${rules.length}`);
  console.log(`mcp scorer: ${scored.telemetry.modelStatus}${scored.telemetry.model ? ` (${scored.telemetry.model})` : ""}`);
  console.log(`elapsed: ${scored.telemetry.elapsedMs}ms`);
  console.log("");
  for (const rule of rules.slice(0, 20)) {
    console.log(`${rule.score.toFixed(2)}  ${rule.content}`);
    if (rule.reasons.length) console.log(`      reasons: ${rule.reasons.join(", ")}`);
  }
  if (rules.length > 20) console.log(`... ${rules.length - 20} more rules`);
  console.log("");
  console.log("Suggested files:");
  for (const file of relevantFiles) {
    const source = file.source ? ` source:${file.source}` : "";
    const reasons = file.reasons?.length ? ` reasons:${file.reasons.join(", ")}` : "";
    console.log(`${Number(file.score || 0).toFixed(2)}  ${file.path}${source}${reasons}`);
  }
  if (!relevantFiles.length) console.log("(none)");
  console.log("");
  console.log("Final additionalContext:");
  console.log(scheduled.additionalContext || "(empty)");
}

async function warmEmbeddings(task) {
  const cwd = process.cwd();
  const merged = readAgentsChain({ cwd });
  const rules = scoreRules(filterActionableRules(parseRules(merged.content)), task, []);
  const result = await warmRuleEmbeddings({
    rules,
    task,
    dataDir: contextOSDataDir(),
    sources: merged.sources,
    allowRemote: true
  });
  const fileResult = await warmFileEmbeddings({
    cwd,
    dataDir: contextOSDataDir(),
    allowRemote: true
  });
  console.log(`Warmed ${result.count} embeddings`);
  console.log(`Warmed ${fileResult.count} file path embeddings`);
  console.log(`Cache: ${result.cachePath}`);
}

const args = process.argv.slice(2);
const command = args[0];

function installAgentFromArgs(args) {
  const agentFlag = args.indexOf("--agent");
  if (agentFlag >= 0) return args[agentFlag + 1] || "";
  const firstValue = args.slice(1).find((arg) => !arg.startsWith("--"));
  return firstValue || "codex";
}

try {
  if (!command || command === "--help" || command === "-h") {
    console.log(usage());
  } else if (command === "--version" || command === "-v") {
    console.log(packageVersion());
  } else if (command === "install") {
    await install({
      copy: args.includes("--copy"),
      inject: !args.includes("--quiet"),
      agent: installAgentFromArgs(args)
    });
  } else if (command === "debug") {
    const marker = args.indexOf("--");
    const task = marker >= 0 ? args.slice(marker + 1).join(" ") : args.slice(1).join(" ");
    if (!task.trim()) throw new Error('Usage: ctx debug -- "task"');
    await debug(task);
  } else if (command === "embeddings") {
    if (args[1] === "warm") {
      const marker = args.indexOf("--");
      const task = marker >= 0 ? args.slice(marker + 1).join(" ") : args.slice(2).join(" ");
      await warmEmbeddings(task);
    } else {
      throw new Error(`Unknown embeddings command: ${args[1] || ""}\n\n${usage()}`);
    }
  } else if (command === "report") {
    console.log(formatReport(loadLastReport()));
  } else if (command === "evidence") {
    console.log(formatEvidence(loadLastReport()));
  } else if (command === "stats") {
    console.log(formatStats(loadStats(contextOSWorkspaceDataDir())));
  } else if (command === "benchmark") {
    const marker = args.indexOf("--");
    const task = marker >= 0 ? args.slice(marker + 1).join(" ") : args.slice(1).join(" ");
    if (!task.trim()) throw new Error('Usage: ctx benchmark -- "task"');
    console.log(formatBenchmark(benchmarkWorkspace({ cwd: process.cwd(), task })));
  } else {
    throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
