#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { readAgentsChain } from "../plugins/ctx/lib/reader.js";
import { filterActionableRules, parseRules, scoreRules } from "../plugins/ctx/lib/analyzer.js";
import { scheduleContext } from "../plugins/ctx/lib/scheduler.js";
import { formatEvidence, formatReport } from "../plugins/ctx/lib/reporter.js";
import { installGlobalHooks } from "../plugins/ctx/lib/global-hooks.js";
import { formatStats, loadStats } from "../plugins/ctx/lib/stats.js";
import { isModelCacheReady, modelCacheDir, warmRuleEmbeddings } from "../plugins/ctx/lib/embedding-scorer.js";
import { warmFileEmbeddings } from "../plugins/ctx/lib/file-embedding-retriever.js";
import { scoreContext } from "../plugins/ctx/lib/score-context.js";
import { defaultDataRoot, workspaceDataDir, workspaceMarkerPath } from "../plugins/ctx/lib/workspace-data.js";
import { installMcpTelemetryProxies } from "../plugins/ctx/lib/mcp-proxy-install.js";
import { benchmarkWorkspace, formatBenchmark } from "../plugins/ctx/lib/benchmark.js";
import { copyDir, copyPackageRoot } from "../plugins/ctx/lib/package-install.js";
import { installClaudeHooks } from "../plugins/ctx/lib/claude-hooks.js";
import { installClaudeMcp } from "../plugins/ctx/lib/claude-mcp.js";
import { installAntigravityHooks } from "../plugins/ctx/lib/antigravity-hooks.js";
import { installAntigravityMcp } from "../plugins/ctx/lib/antigravity-mcp.js";
import { syncRules } from "../plugins/ctx/lib/ruler-sync.js";
import { syncSkills } from "../plugins/ctx/lib/skillshare-sync.js";
import { scanSkills, warmSkillEmbeddings } from "../plugins/ctx/lib/skill-discoverer.js";
import { parsePassthroughArgs, runPassthrough } from "../plugins/ctx/lib/passthrough.js";
import { parseAgentList, parseSetupArgs, setupSummaryLines } from "../plugins/ctx/lib/setup-wizard.js";
import { syncWorkflows, warmWorkflowEmbeddings } from "../plugins/ctx/lib/workflow-discoverer.js";

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
  ctx install --agent codex
  ctx install --agent claude
  ctx install --agent agy
  ctx install --quiet
  ctx install --inject
  ctx install --copy
  ctx setup
  ctx setup --yes
  ctx setup --agents codex,claude,agy
  ctx setup --no-rules
  ctx setup --no-skills
  ctx setup --quiet
  ctx debug -- "task"
  ctx report
  ctx evidence
  ctx stats
  ctx benchmark -- "task"
  ctx sync --rules
  ctx sync --rules --agents codex,claude,antigravity
  ctx sync --rules --dry-run
  ctx sync --rules --no-import-codex-mcp
  ctx sync --skills
  ctx sync --workflows
  ctx sync --workflows --agents codex,claude,agy
  ctx sync --workflows --dry-run
  ctx sync --skills --dry-run
  ctx sync --skills --no-collect
  ctx sync --skills --agents codex,claude,antigravity
  ctx embeddings warm -- "task"
  ctx ruler -- <ruler args>
  ctx skillshare -- <skillshare args>
  ctx --version
`;
}

function normalizeInstallAgent(agent) {
  const normalized = String(agent || "").trim().toLowerCase();
  if (/[|/]/.test(normalized)) {
    throw new Error([
      `Invalid agent '${agent}'.`,
      "Install one agent per command:",
      "  ctx install --agent codex",
      "  ctx install --agent claude",
      "  ctx install --agent agy",
      "",
      "Do not run `ctx install --agent codex|claude|agy`: `|` is a shell pipe."
    ].join("\n"));
  }
  if (normalized === "antigravity") return "agy";
  return normalized;
}

function createInstallProgress({ quiet = false } = {}) {
  const enabled = !quiet && process.stderr.isTTY;
  const frames = ["-", "\\", "|", "/"];
  let percent = 0;
  let label = "starting";
  let frame = 0;
  let timer = null;

  function render() {
    if (!enabled) return;
    const text = `[ctx] install ${String(percent).padStart(3)}% ${frames[frame % frames.length]} ${label}`;
    process.stderr.write(`\r${text.padEnd(92)}`);
    frame += 1;
  }

  return {
    start(initialLabel = "starting") {
      label = initialLabel;
      percent = 0;
      if (enabled) {
        render();
        timer = setInterval(render, 120);
      } else if (!quiet) {
        console.log(`[ctx] install 0% ${label}`);
      }
    },
    step(nextPercent, nextLabel) {
      percent = Math.max(percent, Math.min(100, nextPercent));
      label = nextLabel;
      if (enabled) render();
      else if (!quiet) console.log(`[ctx] install ${percent}% ${label}`);
    },
    done(finalLabel = "done") {
      percent = 100;
      label = finalLabel;
      if (timer) clearInterval(timer);
      timer = null;
      if (enabled) {
        render();
        process.stderr.write("\n");
      } else if (!quiet) {
        console.log(`[ctx] install 100% ${label}`);
      }
    },
    fail(errorLabel = "failed") {
      label = errorLabel;
      if (timer) clearInterval(timer);
      timer = null;
      if (enabled) {
        render();
        process.stderr.write("\n");
      }
    }
  };
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
  agent = normalizeInstallAgent(agent);
  if (copy) {
    copyInstall();
    return;
  }
  const progress = createInstallProgress({ quiet: false });
  progress.start(`installing ${agent || "codex"}`);

  try {
    if (agent === "claude") {
      progress.step(10, "copying package");
      const installRoot = copyPackageRoot({ rootDir, targetRoot: agentInstallRoot("claude") });
      progress.step(25, "installing hooks");
      const hooksPath = installClaudeHooks({ installRoot, injectPromptContext: inject });
      progress.step(40, "installing mcp");
      const mcpConfigPath = installClaudeMcp({ installRoot });
      progress.step(55, "warming embeddings");
      const warmResult = await warmInstallEmbeddings();
      progress.done("claude installed");
      console.log("Installed ctx hooks for Claude Code.");
      console.log(`Stable install root: ${installRoot}`);
      console.log(`Installed ContextOS hooks to ${hooksPath}`);
      console.log(`Installed ctx-mcp MCP server to ${mcpConfigPath}`);
      console.log(`Embedding model cache: ${modelCacheDir(contextOSDataDir())}`);
      console.log(`Embedding vectors cache: ${warmResult.cachePath}`);
      console.log(`File path embeddings warmed: ${warmResult.fileCount || 0}`);
      console.log(`Skill embeddings warmed: ${warmResult.skillCount || 0}`);
      console.log(`Workflow embeddings warmed: ${warmResult.workflowCount || 0}`);
      console.log(`Prompt context injection: ${inject ? "enabled" : "quiet logging only"}`);
      console.log("Restart Claude Code if it was already running, then submit a task to trigger ContextOS.");
      return;
    }

    if (agent === "agy") {
      progress.step(10, "copying package");
      const installRoot = copyPackageRoot({ rootDir, targetRoot: agentInstallRoot("agy") });
      progress.step(25, "installing hooks");
      const hooksPath = installAntigravityHooks({ installRoot, injectPromptContext: inject });
      progress.step(40, "installing mcp");
      const mcpConfigPaths = installAntigravityMcp({ installRoot });
      progress.step(55, "warming embeddings");
      const warmResult = await warmInstallEmbeddings();
      progress.done("agy installed");
      console.log("Installed ctx hooks for Antigravity.");
      console.log(`Stable install root: ${installRoot}`);
      console.log(`Installed ContextOS hooks to ${hooksPath}`);
      console.log(`Installed ctx-mcp MCP server to ${mcpConfigPaths.join(", ")}`);
      console.log(`Embedding model cache: ${modelCacheDir(contextOSDataDir())}`);
      console.log(`Embedding vectors cache: ${warmResult.cachePath}`);
      console.log(`File path embeddings warmed: ${warmResult.fileCount || 0}`);
      console.log(`Skill embeddings warmed: ${warmResult.skillCount || 0}`);
      console.log(`Workflow embeddings warmed: ${warmResult.workflowCount || 0}`);
      console.log(`Prompt context injection: ${inject ? "enabled" : "quiet logging only"}`);
      console.log("Restart Antigravity or agy if it was already running, then submit a task to trigger ContextOS.");
      return;
    }

    if (agent !== "codex") {
      throw new Error(`Unknown agent '${agent}'. Expected codex, claude, or agy.`);
    }

    progress.step(10, "copying marketplace");
    const marketplaceRoot = path.join(codexHome(), "marketplaces", "contextos");
    copyPackageRoot({ rootDir, targetRoot: marketplaceRoot });

    progress.step(20, "refreshing codex plugin");
    tryRunCodex(["plugin", "remove", "ctx@contextos"]);
    tryRunCodex(["plugin", "marketplace", "remove", "contextos"]);
    tryRunCodex(["mcp", "remove", "ctx-mcp"]);
    runCodex(["plugin", "marketplace", "add", marketplaceRoot]);
    runCodex(["plugin", "add", "ctx@contextos"]);
    progress.step(40, "installing mcp");
    runCodex(["mcp", "add", "ctx-mcp", "--", "node", path.join(marketplaceRoot, "plugins", "ctx", "mcp", "server.js")]);
    progress.step(50, "installing telemetry proxies");
    const proxyResult = installMcpTelemetryProxies({ codexHome: codexHome(), marketplaceRoot });
    progress.step(60, "installing hooks");
    const hooksPath = installGlobalHooks({ codexHome: codexHome(), marketplaceRoot, injectPromptContext: inject });

    progress.step(70, "warming embeddings");
    const warmResult = await warmInstallEmbeddings();
    progress.done("codex installed");
    console.log("Installed ctx through Codex plugin marketplace.");
    console.log(`Stable marketplace root: ${marketplaceRoot}`);
    console.log(`Installed ContextOS global hooks to ${hooksPath}`);
    console.log("Installed ctx-mcp MCP server.");
    console.log(`MCP telemetry proxies: ${proxyResult.wrapped.length ? proxyResult.wrapped.map((item) => item.name).join(", ") : "none changed"}`);
    console.log(`Embedding model cache: ${modelCacheDir(contextOSDataDir())}`);
    console.log(`Embedding vectors cache: ${warmResult.cachePath}`);
    console.log(`File path embeddings warmed: ${warmResult.fileCount || 0}`);
    console.log(`Skill embeddings warmed: ${warmResult.skillCount || 0}`);
    console.log(`Workflow embeddings warmed: ${warmResult.workflowCount || 0}`);
    console.log(`Prompt context injection: ${inject ? "enabled" : "quiet logging only"}`);
    console.log("Restart Codex if it was already running, then submit a task to trigger ContextOS.");
  } catch (error) {
    progress.fail("install failed");
    throw error;
  }
}

async function warmInstallEmbeddings() {
  const dataDir = contextOSDataDir();
  const modelReady = isModelCacheReady(dataDir);
  console.log(modelReady
    ? "Required local embedding model already cached."
    : "Preparing required local embedding model...");
  const result = await warmRuleEmbeddings({
    rules: [
      { content: "Always use project rules that are semantically relevant to the user prompt." },
      { content: "Find code files by meaning, imports, graph relationships, and task intent." },
      { content: "Use local embeddings to bridge natural language and code vocabulary mismatch." }
    ],
    task: "kiểm duyệt upload moderation semantic code search",
    dataDir,
    sources: [],
    allowRemote: !modelReady
  });
  const fileResult = await warmFileEmbeddings({
    cwd: process.cwd(),
    dataDir,
    allowRemote: !modelReady
  });
  const skillResult = await warmSkillEmbeddings({
    cwd: process.cwd(),
    dataDir,
    allowRemote: !modelReady
  });
  const workflowResult = await warmWorkflowEmbeddings({
    cwd: process.cwd(),
    dataDir,
    allowRemote: !modelReady
  });
  return { ...result, modelAlreadyCached: modelReady, fileCount: fileResult.count, skillCount: skillResult.count, workflowCount: workflowResult.count };
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
  const suggestedSkills = (scored.suggestedSkills || []).slice(0, 3);
  const suggestedWorkflows = (scored.suggestedWorkflows || []).slice(0, 2);
  const scheduled = scheduleContext({ rules, relevantFiles, suggestedSkills, suggestedWorkflows });

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
  console.log("Suggested skills:");
  for (const skill of suggestedSkills) {
    const score = Number(skill.score || 0).toFixed(2);
    const location = skill.path ? ` path:${skill.path}` : "";
    console.log(`${score}  ${skill.name}${location}`);
  }
  if (!suggestedSkills.length) console.log("(none)");
  console.log("");
  console.log("Suggested workflows:");
  for (const workflow of suggestedWorkflows) {
    const score = Number(workflow.score || 0).toFixed(2);
    const chain = workflow.chain?.length ? ` chain:${workflow.chain.join(" -> ")}` : "";
    const location = workflow.relativePath || workflow.path ? ` path:${workflow.relativePath || workflow.path}` : "";
    console.log(`${score}  ${workflow.title || workflow.name}${chain}${location}`);
  }
  if (!suggestedWorkflows.length) console.log("(none)");
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
  const skillResult = await warmSkillEmbeddings({
    cwd,
    dataDir: contextOSDataDir(),
    allowRemote: true
  });
  const workflowResult = await warmWorkflowEmbeddings({
    cwd,
    dataDir: contextOSDataDir(),
    allowRemote: true
  });
  console.log(`Warmed ${result.count} embeddings`);
  console.log(`Warmed ${fileResult.count} file path embeddings`);
  console.log(`Warmed ${skillResult.count} skill embeddings`);
  console.log(`Warmed ${workflowResult.count} workflow embeddings`);
  console.log(`Cache: ${result.cachePath}`);
}

function printSetupBanner() {
  console.log("");
  console.log("╭─ ContextOS setup ─────────────────────────────────────────╮");
  console.log("│ Task-aware rules, MCP sync, and skill discovery for agents │");
  console.log("╰───────────────────────────────────────────────────────────╯");
  console.log("");
}

async function askSetupQuestion(rl, question, defaultValue) {
  const suffix = defaultValue ? ` (${defaultValue})` : "";
  const answer = await rl.question(`◇ ${question}${suffix}: `);
  return answer.trim() || defaultValue;
}

async function askSetupYesNo(rl, question, defaultValue = true) {
  const suffix = defaultValue ? "Y/n" : "y/N";
  const answer = await askSetupQuestion(rl, question, suffix);
  if (!answer || answer === suffix) return defaultValue;
  return !/^n(o)?$/i.test(answer.trim());
}

async function setup({ args = [], cwd = process.cwd() } = {}) {
  const options = parseSetupArgs(args);
  const interactive = !options.yes && process.stdin.isTTY;

  printSetupBanner();
  console.log(`◇ Installation directory:\n│  ${cwd}`);

  if (interactive) {
    const rl = readline.createInterface({ input, output });
    try {
      const proceed = await askSetupYesNo(rl, "Install to this directory?", true);
      if (!proceed) {
        console.log("Setup cancelled.");
        return;
      }
      const agents = await askSetupQuestion(rl, "Install for agents? comma-separated", options.agents.join(","));
      options.agents = parseAgentList(agents);
      options.inject = await askSetupYesNo(rl, "Enable prompt context injection?", options.inject);
      options.syncRules = await askSetupYesNo(rl, "Sync project rules and MCP servers through Ruler?", options.syncRules);
      options.syncSkills = await askSetupYesNo(rl, "Sync skills through skillshare?", options.syncSkills);
    } finally {
      rl.close();
    }
  }

  console.log("");
  console.log("◇ Ready to setup:");
  for (const line of setupSummaryLines({ cwd, ...options })) console.log(`│  ${line}`);
  console.log("");

  if (!options.agents.length) throw new Error("No agents selected. Use --agents codex,claude,agy.");

  for (const agent of options.agents) {
    console.log(`● Setting up ${agent}...`);
    await install({ agent, inject: options.inject, copy: false });
  }

  if (options.syncRules) {
    console.log("● Syncing project rules and MCP servers...");
    const syncAgents = options.agents.map((agent) => agent === "agy" ? "antigravity" : agent).join(",");
    const syncArgs = ["--rules", "--agents", syncAgents];
    if (options.yes) syncArgs.push("--yes");
    await syncRules({ cwd, rootDir, args: syncArgs });
  }

  if (options.syncSkills) {
    console.log("● Syncing skills...");
    const skillAgents = options.agents.map((agent) => agent === "agy" ? "antigravity" : agent).join(",");
    const syncArgs = ["--skills", "--agents", skillAgents];
    if (options.yes) syncArgs.push("--yes");
    await syncSkills({
      cwd,
      args: syncArgs,
      rebuildSkillEmbeddings: async ({ cwd: skillCwd, sourceDir }) => warmSkillEmbeddings({
        cwd: skillCwd,
        dataDir: contextOSDataDir(),
        allowRemote: !isModelCacheReady(contextOSDataDir()),
        skills: scanSkills({ cwd: skillCwd, roots: [sourceDir] })
      })
    });
  }

  console.log("");
  console.log("╭─ ContextOS is ready ───────────────────────────────────────╮");
  console.log("│ Next: restart/open your agent from this project directory. │");
  console.log("│ Try: ctx debug -- \"Recheck authen flow\"                  │");
  console.log("╰───────────────────────────────────────────────────────────╯");
}

const args = process.argv.slice(2);
const command = args[0];

function installAgentFromArgs(args) {
  const agentFlag = args.indexOf("--agent");
  if (agentFlag >= 0) return normalizeInstallAgent(args[agentFlag + 1] || "");
  const firstValue = args.slice(1).find((arg) => !arg.startsWith("--"));
  return normalizeInstallAgent(firstValue || "codex");
}

try {
  if (!command || command === "--help" || command === "-h") {
    console.log(usage());
  } else if (command === "--version" || command === "-v") {
    console.log(packageVersion());
  } else if (command === "install") {
    await install({
      copy: args.includes("--copy"),
      inject: args.includes("--inject") || !args.includes("--quiet"),
      agent: installAgentFromArgs(args)
    });
  } else if (command === "setup") {
    await setup({ args: args.slice(1), cwd: process.cwd() });
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
  } else if (command === "sync") {
    if (args.includes("--workflows")) {
      await syncWorkflows({
        cwd: process.cwd(),
        dataDir: contextOSDataDir(),
        allowRemote: !isModelCacheReady(contextOSDataDir()),
        args: args.slice(1)
      });
    } else if (args.includes("--skills")) {
      await syncSkills({
        cwd: process.cwd(),
        args: args.slice(1),
        rebuildSkillEmbeddings: async ({ cwd, sourceDir }) => warmSkillEmbeddings({
          cwd,
          dataDir: contextOSDataDir(),
          allowRemote: !isModelCacheReady(contextOSDataDir()),
          skills: scanSkills({ cwd, roots: [sourceDir] })
        })
      });
    } else {
      await syncRules({ cwd: process.cwd(), rootDir, args: args.slice(1) });
    }
  } else if (command === "ruler" || command === "skillshare") {
    const passthrough = parsePassthroughArgs(args);
    const result = runPassthrough(passthrough);
    if (result.signal) {
      console.error(`${passthrough.command} terminated by signal ${result.signal}`);
      process.exitCode = 1;
    } else {
      process.exitCode = result.status;
    }
  } else {
    throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
