import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { execFileSync, execSync } from "node:child_process";

const DEFAULT_AGENTS = ["codex", "claude", "antigravity"];
const INSTALL_SH_URL = "https://raw.githubusercontent.com/runkids/skillshare/main/install.sh";
const INSTALL_PS_URL = "https://raw.githubusercontent.com/runkids/skillshare/main/install.ps1";

function statusLine(label, value) {
  return `[ctx] ${label.padEnd(38)} ${value}`;
}

function runCommand(command, args = [], { cwd = process.cwd(), stdio = "pipe", dryRun = false } = {}) {
  if (dryRun) return { stdout: "", skipped: true };
  const stdout = execFileSync(command, args, { cwd, stdio, encoding: "utf8" });
  return { stdout: stdout || "" };
}

function runShell(command, { cwd = process.cwd(), stdio = "inherit", dryRun = false } = {}) {
  if (dryRun) return { stdout: "", skipped: true };
  const stdout = execSync(command, { cwd, stdio, encoding: "utf8" });
  return { stdout: stdout || "" };
}

export function parseSyncSkillsArgs(args = []) {
  const agentsFlag = args.indexOf("--agents");
  const agents = agentsFlag >= 0
    ? String(args[agentsFlag + 1] || "").split(",").map((item) => item.trim()).filter(Boolean)
    : DEFAULT_AGENTS;
  return {
    skills: args.includes("--skills"),
    agents,
    dryRun: args.includes("--dry-run"),
    noCollect: args.includes("--no-collect"),
    yes: args.includes("--yes") || args.includes("-y")
  };
}

export function detectOS(platform = process.platform) {
  if (platform === "darwin") return "mac";
  if (platform === "win32") return "windows";
  return "linux";
}

export function skillshareConfigDir({ home = os.homedir() } = {}) {
  return path.join(home, ".config", "skillshare");
}

export function skillshareSourceDir({ home = os.homedir() } = {}) {
  return path.join(skillshareConfigDir({ home }), "skills");
}

export function checkSkillshareInstalled({ run = runCommand } = {}) {
  try {
    const result = run("skillshare", ["--version"]);
    return { installed: true, version: result.stdout.trim() || "installed" };
  } catch {
    return { installed: false, version: "" };
  }
}

async function shouldInstallSkillshare({ yes = false } = {}) {
  if (yes) return true;
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question("[ctx] skillshare is not installed. Install now? [Y/n] ");
    return !/^n(o)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

export async function installSkillshare({
  run = runCommand,
  runShellCommand = runShell,
  yes = false,
  dryRun = false,
  platform = process.platform
} = {}) {
  const accepted = dryRun || await shouldInstallSkillshare({ yes });
  if (!accepted) {
    throw new Error("skillshare is required for ctx sync --skills. Install it manually with `curl -fsSL https://raw.githubusercontent.com/runkids/skillshare/main/install.sh | sh` or rerun with --yes.");
  }

  const osName = detectOS(platform);
  if (osName === "windows") {
    run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `irm ${INSTALL_PS_URL} | iex`], { stdio: "inherit", dryRun });
  } else {
    runShellCommand(`curl -fsSL ${INSTALL_SH_URL} | sh`, { stdio: "inherit", dryRun });
  }

  const check = checkSkillshareInstalled({ run });
  if (!dryRun && !check.installed) {
    throw new Error("skillshare install finished but `skillshare --version` still failed. Check PATH or install skillshare manually.");
  }
  return check;
}

export function detectExistingSkills({ cwd = process.cwd(), home = os.homedir() } = {}) {
  return skillRoots({ cwd, home })
    .map((root) => ({ path: root, count: countSkillFiles(root) }))
    .filter((entry) => entry.count > 0);
}

function skillRoots({ cwd, home }) {
  return [
    path.join(home, ".claude", "skills"),
    path.join(home, ".codex", "skills"),
    path.join(home, ".gemini", "antigravity", "skills"),
    path.join(home, ".gemini", "antigravity-cli", "skills"),
    path.join(cwd, ".claude", "skills"),
    path.join(cwd, ".codex", "skills"),
    path.join(cwd, ".gemini", "antigravity", "skills"),
    path.join(cwd, ".gemini", "antigravity-cli", "skills")
  ];
}

function countSkillFiles(root) {
  return findSkillFiles(root).length;
}

function findSkillFiles(root) {
  const files = [];
  walk(root, 0, files);
  return files;
}

function walk(directory, depth, files) {
  if (depth > 4) return;
  let entries = [];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const stat = safeStat(fullPath);
      if (stat?.isDirectory()) walk(fullPath, depth + 1, files);
    } else if (entry.isDirectory()) {
      walk(fullPath, depth + 1, files);
    } else if (entry.isFile() && entry.name === "SKILL.md") {
      files.push(fullPath);
    }
  }
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

export function isSkillshareInitialized({ home = os.homedir() } = {}) {
  return fs.existsSync(skillshareConfigDir({ home }));
}

export async function syncSkills({
  cwd = process.cwd(),
  home = os.homedir(),
  args = [],
  run = runCommand,
  runShellCommand = runShell,
  logger = console.log,
  rebuildSkillEmbeddings = async () => ({ count: 0, cachePath: null })
} = {}) {
  const options = parseSyncSkillsArgs(args);
  if (!options.skills) throw new Error("Usage: ctx sync --skills [--dry-run] [--no-collect] [--agents codex,claude,antigravity]");

  const installed = checkSkillshareInstalled({ run });
  logger(statusLine("Checking skillshare installation...", installed.installed ? `✓ ${installed.version}` : "not found"));
  if (!installed.installed) {
    logger("");
    logger("skillshare is required to sync skills across agents.");
    const postInstall = await installSkillshare({
      run,
      runShellCommand,
      yes: options.yes,
      dryRun: options.dryRun,
      platform: process.platform
    });
    logger(statusLine("Installing skillshare...", options.dryRun ? "dry-run" : `✓ ${postInstall.version}`));
  }

  const initialized = isSkillshareInitialized({ home });
  logger(statusLine("Checking skillshare config...", initialized ? "✓ initialized" : "not initialized"));

  if (!initialized) {
    const existing = detectExistingSkills({ cwd, home });
    if (existing.length) {
      logger("[ctx] Found existing skills:");
      for (const entry of existing) {
        logger(`      ${entry.path.padEnd(44)} ${entry.count} skills`);
      }
    } else {
      logger("[ctx] No existing skills found.");
    }

    run("skillshare", ["init"], { cwd, stdio: "inherit", dryRun: options.dryRun });
    logger(statusLine("Initializing skillshare...", options.dryRun ? "dry-run" : "✓ initialized"));

    if (existing.length && !options.noCollect) {
      run("skillshare", ["backup"], { cwd, stdio: "inherit", dryRun: options.dryRun });
      logger(statusLine("Backing up...", options.dryRun ? "dry-run" : "✓ backup created"));
      run("skillshare", ["collect", "--all"], { cwd, stdio: "inherit", dryRun: options.dryRun });
      const collected = countSkillFiles(skillshareSourceDir({ home }));
      logger(statusLine("Collecting from all agents...", options.dryRun ? "dry-run" : `✓ ${collected} skills collected`));
    }
  }

  const syncArgs = ["sync"];
  if (options.dryRun) syncArgs.push("--dry-run");
  if (options.agents.length) syncArgs.push("--agents", options.agents.join(","));
  run("skillshare", syncArgs, { cwd, stdio: "inherit", dryRun: false });
  const syncedCount = countSkillFiles(skillshareSourceDir({ home }));
  logger(statusLine("Running skillshare sync...", options.dryRun ? "dry-run" : `✓ ${syncedCount} skills → ${options.agents.join(", ")}`));

  let embeddings = { count: 0, cachePath: null, skipped: options.dryRun };
  if (!options.dryRun) {
    embeddings = await rebuildSkillEmbeddings({ cwd, home, sourceDir: skillshareSourceDir({ home }) });
    logger(statusLine("Rebuilding skill embeddings...", `✓ ${embeddings.count || 0} skills indexed`));
  } else {
    logger(statusLine("Rebuilding skill embeddings...", "skipped in dry-run"));
  }

  logger("");
  logger("Done. Skills are now synced.");
  logger(`Source: ${skillshareSourceDir({ home })}`);
  return { options, initialized, sourceDir: skillshareSourceDir({ home }), syncedCount, embeddings };
}
