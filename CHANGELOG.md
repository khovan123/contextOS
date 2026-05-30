# Changelog

## 0.5.42

- **Setup fallback when no skills found:** During `ctx setup`, if `syncSkills` completes but `detectExistingSkills` finds zero skills on the machine, the CLI now automatically offers the community skill library installer. After successful install, `syncSkills` re-runs to distribute the newly installed skills to all selected agents.
- **Reusable `runCommunitySkillInstaller()`:** Extracted the fetch → select → install flow into a shared function used by both `ctx skills` and the `ctx setup` fallback. Returns the number of successfully installed sources for downstream branching.

## 0.5.41

- **Interactive community skill installer (`ctx skills`):** Replaced the info-only display with a fully functional multi-select installer. Users can now toggle multiple community library sources with `Space`, confirm with `Enter`, and the CLI automatically runs the appropriate install command for each selected source (`npx`, `git clone`, etc.).
- **Compact selection UI with URL hints:** The skill source picker now shows a clean box-styled header and each option displays its GitHub URL as a dimmed sub-line hint, matching the `◇ / │` visual language used throughout contextOS.
- **Prefixed install output (`runPrefixed`):** All child-process output during installation (including interactive npx prompts like "Ok to proceed?") is piped through a line-by-line prefixer that prepends `│  ` to every line. This keeps the visual box style consistent and prevents raw command output from breaking the layout. `stdin` remains inherited so users can still answer interactive prompts.
- **`multiSelect` hint support:** The multi-select component now accepts an optional `hint` property on each option, rendered as a dimmed indented line below the label. Used for URLs but available for any contextual sub-text.
- **Library install metadata:** `skill-library.js` now exports `getInstallCommands(libraryId)` returning structured install info (command, verify step, type) for each library source, keeping install logic out of the main CLI.

## 0.5.40

- **Update notifier:** `ctx` now checks npm for newer versions in the background (once per day, 3s timeout). If a newer release exists, a boxed notice is printed at the very end of any command: `Update available: 0.5.39 → 0.5.40`. Check result is cached in `$CONTEXTOS_DATA/.update-check.json` to avoid repeated network calls.
- **Community skill library browser (`ctx skills`):** New command to browse curated skill libraries from the community. Fetches and parses README files from 4 sources:
  - [antigravity-awesome-skills](https://github.com/sickn33/antigravity-awesome-skills) — 1,400+ universal skills
  - [awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) — Claude Code skills & workflows
  - [awesome-codex-skills](https://github.com/ComposioHQ/awesome-codex-skills) — Codex CLI skills & automations
  - [awesome-copilot](https://github.com/github/awesome-copilot) — GitHub Copilot instructions & agents
  Results are cached for 24 hours. Use `--agents <names>` to filter and `--refresh` to force refetch.
- **Post-install skill recommendations:** After interactive `ctx install` or `ctx setup`, a styled recommendation panel shows top 5 skills from each relevant library with descriptions and repo URLs. This guides new users toward useful community skills immediately after setup.
- **Test stability:** Increased timeout for MCP bridge fallback test to prevent CI flakiness.

## 0.5.39

- **Report layout fix:** Replaced ASCII table formatting with clean markdown output. Reports now render correctly in all agent UIs (Antigravity, Claude Code, Codex) without truncation or line-wrapping issues.
- **Skills & workflows in report:** `Suggested Skills` and `Suggested Workflows` sections now appear in the compliance report when available. Data is passed through from `stop-hook.js` → `buildReport()` → `formatReport()`.
- **No more truncation:** All rules now display in the report — removed the artificial item limits that caused `... N more` messages.
- **Emoji status indicators:** Rule outcomes use ✅/❌/❓/⚠️ prefixes for quick scanning.


## 0.5.38

- **Unified agent branding:** All user-facing text now shows `antigravity` instead of `agy`. Internal value remains `agy` for backward compatibility. Interactive prompts display "Antigravity" without the parenthetical alias.
- **`ctx help` command:** Added `help` as a recognized command (alongside `--help` and `-h`). Previously returned "Unknown command".
- **`--help` in usage:** Added `ctx --help` line to the usage display so it's discoverable.
- **Fix `--agents` flag parsing:** `ctx install --agents antigravity` now correctly skips the interactive prompt. Previously only `--agent` (singular) was recognized.
- **Cleaner usage text:** Replaced hardcoded agent lists (`codex,claude,antigravity,copilot`) with `<names>` placeholder for future-proof documentation.

## 0.5.37

- **Real-time animated progress bar for `ctx install`:** The progress spinner now updates in-place using raw stderr writes (`\r`) instead of being captured by `streamSetupOutput`. Uses a smooth 10-frame Braille spinner (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) with a visual bar (`[████████░░░░]`) that animates at 80ms intervals.
- **Clean install output:** Reduced verbose per-agent install summary from 10+ lines of paths to a compact 4-line summary (Hooks →, MCP →, Embeddings count, restart instruction). Removed redundant "embedding model already cached" log line from `warmInstallEmbeddings`.
- **Fix `streamSetupOutput` breaking spinner:** Previously intercepted `process.stderr.write` and converted `\r` carriage returns to newlines, preventing in-place updates. Now only intercepts `console.log` for `│  ` prefixed output, leaving stderr untouched for spinner rendering.
- **Suppress codex command noise:** `runCodex()` no longer prints verbose stdout lines like "Added marketplace `contextos`" and "Added global MCP server 'ctx-mcp'" — the progress spinner already provides feedback.
- **Clean context formatting:** Removed absolute paths from rules, skills, and workflows in scheduler output. Removed duplicate "ContextOS reminders" section. Truncated long skill descriptions to 80 chars. Capped rules at 5 per section instead of 8. Context now renders as clean, readable markdown:

## 0.5.36

- **Fix ctx_score_context MCP output not rendering in Antigravity editor:** The `content` text block returned by the MCP tool previously only contained raw telemetry JSON, which editors cannot render as user-facing context. Now the tool uses `scheduleContext()` to produce the same human-readable markdown (Critical ContextOS rules, Suggested files, Skills, Workflows) that the hook path generates, and returns it as the primary `content[0].text` block. Telemetry JSON is pushed to a secondary content block. This ensures Antigravity (and any MCP-compatible editor) displays the scored rules and file suggestions.
- **Fix symlink incompatibility with antigravity-awesome-skills:** `copyDirectory` in `skillshare-sync.js` was preserving symlinks when copying skills, which caused `antigravity-awesome-skills` to crash with "Skipping unsafe destination symlink" on re-install. Now follows symlinks and copies actual file content instead, making output compatible with all tools that write to the same skills directory.
- **Updated MCP protocol smoke test:** Assertions now validate the two-block content structure — human-readable context first, telemetry JSON last.

## 0.5.35

- **Add GitHub Copilot agent support:** New `copilot` agent for `ctx install --agent copilot` and `ctx setup`. Creates `.github/copilot-instructions.md` with ContextOS integration marker and configures `ctx-mcp` MCP server in `.vscode/mcp.json`. Copilot is now recognized by Ruler (`ctx sync --rules`) and Skillshare (`ctx sync --skills`) alongside existing codex, claude, and agy agents.
- **Agent selection defaults to none:** `ctx setup` and `ctx install` no longer pre-select all agents. Users must explicitly choose which agents to install via the interactive multiSelect prompt or `--agents` flag. This prevents accidental installation of unwanted agent hooks.
- **copilot-hooks.js:** Writes a managed `copilot-instructions.md` file under `.github/`, appending to existing content if present. Uses a marker comment (`<!-- managed by ContextOS -->`) to avoid duplicate sections.
- **copilot-mcp.js:** Configures `ctx-mcp` server in `.vscode/mcp.json` using the same pattern as existing claude/antigravity MCP modules.

## 0.5.34

- **Real-time streaming output during install/setup:** Replaced `captureSetupOutput` (buffered) with `streamSetupOutput` — now prints each line immediately with `│  ` prefix as it arrives, eliminating the perceived "hang" during long-running downloads and installs.
- **Fix codex CLI output missing `│` prefix:** Changed `runCodex` from `stdio: "inherit"` to `stdio: ["ignore", "pipe", "pipe"]`. Output now flows through `console.log` → `streamSetupOutput` → `│  ` prefix, ensuring lines like "Added marketplace..." are consistently formatted.
- **Async streaming for skillshare/ruler install:** Replaced blocking `execSync`/`runShell` calls in `installSkillshare` and `installRuler` with async `spawn` + line-by-line streaming. Download progress from PowerShell/curl/npm is now visible in real time instead of being buffered until completion.
- **Fix `skillshare init` hang on Windows:** `skillshare init` is interactive by default (prompts for copy source, git, skill install). With stdin routed to NUL (deadlock prevention), the Go binary hangs waiting for terminal input that never arrives. Fixed by passing `--no-copy --no-git --no-skill --all-targets` flags for fully non-interactive initialization.

## 0.5.32

- **Fix Windows terminal hang during skillshare/ruler install:** `execSync` with `stdio: "pipe"` creates a stdin pipe whose write-end is held by Node while it blocks on `waitpid`. If the child process (PowerShell installer, npm, etc.) reads from stdin, it blocks waiting for data/EOF that never comes — classic deadlock. Fixed by normalizing `stdio: "pipe"` to `["ignore", "pipe", "pipe"]` in both `runCommand` and `runShell`. This routes stdin to NUL (`/dev/null`) for immediate EOF, while still capturing stdout/stderr through pipes for `◇`/`│` formatting.

## 0.5.31

- **Complete stdio audit — eliminate all output leakage:** Changed every remaining `stdio: "inherit"` in `skillshare-sync.js` and `ruler-sync.js` to `stdio: "pipe"`. When subprocess calls use `inherit`, child processes write directly to the parent's fd — bypassing both `console.log` and `process.stderr.write` interception in `captureSetupOutput`. With `pipe`, all subprocess output is captured as return values and re-emitted through `console.log`, ensuring the `◇`/`│` formatting is applied consistently. Also changed `runShell` default from `"inherit"` to `"pipe"` to prevent future regressions.

## 0.5.30

- **Fix Windows skillshare post-install hang:** After the PowerShell installer adds skillshare to PATH, the current Node.js process still has the old `process.env.PATH`. Now injects the known Windows install directory (`%LOCALAPPDATA%\\Programs\\skillshare`) into `process.env.PATH` immediately after install, so `skillshare --version`, `skillshare init`, and subsequent calls resolve without restarting the terminal.

## 0.5.29

- **Fix Windows skillshare install `iex` not recognized:** The PowerShell pipe `irm ... | iex` was being intercepted by `cmd.exe` (the outer shell via `shell: true`) instead of PowerShell. Switched to `execSync` with properly double-quoted `-Command` argument so the pipe stays inside PowerShell's scope.

## 0.5.28

- **Consistent `◇`/`│` UI formatting for all install and setup output:** All progress bars, detail lines, and status messages from `ctx install` and `ctx setup` are now captured and re-emitted with `◇` step headers and `│`-indented detail lines. Added `captureSetupOutput` helper that intercepts both `console.log` and `process.stderr.write` to ensure nothing leaks unprefixed.
- **Fix broken `syncSkills` call in setup:** Restored the missing `syncSkills()` invocation that was accidentally dropped during a previous edit.

## 0.5.27

- **Fix Windows `spawnSync`/`execFileSync` ENOENT across all modules:** Added `shell: true` to every remaining child-process invocation in `ruler-sync.js`, `skillshare-sync.js`, `passthrough.js`, and `measure.js`. Without this, Windows cannot resolve `.cmd`/`.ps1` shims (e.g. `npm.cmd`, `ruler.cmd`, `skillshare.cmd`) via PATH, causing `ctx setup` to crash during the Ruler/Skillshare installation step.

## 0.5.26

- **Interactive `ctx install`:** Running `ctx install` without `--agent` now shows an interactive multi-select prompt (↑/↓ to navigate, Space to toggle, Enter to confirm) letting you pick which agents to install in one go.
- **Removed positional agent args:** `ctx install codex`, `ctx install claude`, `ctx install agy` no longer work as positional shortcuts. Use `ctx install` (interactive) or `ctx install --agent <name>` (direct).

## 0.5.25

- **Fix Windows JSON parse crash:** All `readJsonFile`/`readHooksFile` helpers now catch corrupt JSON and warn instead of crashing, allowing fresh config to be generated automatically.
- **Fix Windows shell quoting:** `shellQuote` now uses double-quotes on Windows (`process.platform === "win32"`) instead of POSIX single-quotes which are not recognized by cmd.exe/PowerShell.
- **Fix Codex CLI invocation on Windows:** `runCodex`/`tryRunCodex` now pass `shell: true` to `execFileSync` so Windows can resolve `codex.cmd` via PATH.

## 0.5.24

- **Interactive agent selection:** Replaces the comma-separated text input in `ctx setup` with an interactive multi-select prompt — use ↑/↓ to navigate, Space to toggle agents on/off, and Enter to confirm.

## 0.5.23

- **Fix Windows install paths:** Replaces all `process.env.HOME || process.cwd()` fallbacks with `os.homedir()` across `ctx.js`, `claude-hooks.js`, `antigravity-hooks.js`, `claude-mcp.js`, `antigravity-mcp.js`, and `ruler-sync.js`. On Windows, `HOME` is not set, causing `.codex/`, `.claude/`, and `.gemini/` directories (with full `node_modules` and source code) to be created inside the project tree instead of the user's home directory.
- **Fix ephemeral MCP server path:** `ctx sync --rules` now resolves the MCP server path from stable install roots (`~/.codex/marketplaces/contextos/`, `~/.ctx/contextos/agents/`) instead of `rootDir`, which may point to a temporary npm extraction directory (e.g. `/tmp/contextos/`) that disappears after cleanup.

## 0.5.22

- Adds `.gitignore` management to `ctx install`: writes inner `.gitignore` (excludes `node_modules/`, `bin/`, `lib/`, `mcp/`) inside installed agent directories and ensures the project root `.gitignore` excludes `.codex/marketplaces/contextos/`, `.claude/settings.json`, and `.gemini/`.
- Splits the `npm install -g && ctx setup` one-liner into two separate commands in README and LAUNCH docs to avoid shell PATH resolution failures.

## 0.5.21

- Makes prompt hooks fall back to direct scoring when the `ctx-mcp` bridge socket is missing, stale, or unavailable, avoiding empty `hook context` output.
- Prioritizes imperative and code-review-graph rules in injected critical context so `IMPORTANT` project rules appear before generic semantic matches.
- Improves workflow detection for CI, deployment, server, runtime, debugging, and issue-analysis prompts.

## 0.5.20

- Refreshes stale `ctx-mcp` Ruler entries that point at temporary paths such as `/tmp/contextos/...`.
- Keeps `ctx install` fast by skipping large skill/workflow discovery embedding warmup unless `CONTEXTOS_INSTALL_WARM_DISCOVERY=1` is set.

## 0.5.19

- Makes `ctx-mcp` startup non-mutating: the MCP server now verifies the local embedding model without warming or rewriting `embeddings.db` during agent initialization.
- Fixes Antigravity staying on `ctx-mcp initializing...` when a large embedding cache makes startup writes slow or blocked.

## 0.5.18

- Prevents `ctx sync --rules` from importing project MCP commands that point into temporary directories such as `/tmp/...`.
- Prunes stale temporary MCP commands from Antigravity MCP configs during rule sync.
- Removes the project-scope Claude `ctx-mcp` entry when a user-scope `ctx-mcp` is already installed, avoiding conflicting endpoint warnings.

## 0.5.17

- Makes `ctx setup --agents ...` honor the provided agent list without prompting for the same agents again.

## 0.5.16

- Prints a "Rebuilding skill embeddings... started" status before indexing large skillshare catalogs so `ctx sync --skills` no longer looks stuck after skillshare finishes.
- Adds `ctx sync --skills --no-embeddings` for fast skill sync when users want to warm embeddings later.
- Caches oversized skill catalog scans correctly and truncates skill descriptions before scoring, keeping prompt-time skill discovery fast with large skillshare catalogs.
- Runs native `skillshare sync` in quiet mode by default to avoid flooding ContextOS output with budget warnings; use `--verbose` to show them.

## 0.5.15

- Replaces the misleading `ctx install --agent codex|claude|agy` usage text with separate commands.
- Adds a clear CLI error when an install agent value contains shell-choice separators such as `|` or `/`.

## 0.5.14

- Adds an actual rendered terminal demo GIF generated from `ctx debug` plus a real `codex exec` hook run.
- Points the README demo section at `docs/demo/contextos-demo.gif`.

## 0.5.13

- Reworks the README for launch: demo-first positioning, fear hook, one-line install, before/after, and quick command table.
- Adds a launch kit and concrete demo recording script for HN/X/GitHub/npm launch prep.
- Adds `ctx-codex` as a bin alias for npm package execution flows.

## 0.5.12

- Makes `ctx sync --workflows` synchronize unique workflow files to global Claude, Codex, and Antigravity workflow roots.
- Adds `ctx sync --workflows --agents ...` and `--dry-run`, with workflow-name dedupe to avoid duplicated workflow suggestions across agents.

## 0.5.11

- Adds Antigravity workflow discovery roots under `.gemini/workflows`, `.gemini/antigravity/workflows`, and `.gemini/antigravity-cli/workflows`.

## 0.5.10

- Adds workflow discovery for `.claude/workflows/`, `.codex/workflows/`, `~/.claude/workflows/`, and `~/.codex/workflows/`.
- Adds `ctx sync --workflows` to parse markdown workflow headings, agent chains, and warm workflow embeddings.
- Injects prompt-relevant workflow hints into ContextOS prompt context and shows them in `ctx debug`.

## 0.5.9

- Formats `ctx report`, `ctx evidence`, `ctx stats`, and `ctx benchmark` with sectioned terminal tables for easier scanning and analysis.
- Adds a small shared terminal table formatter used by report, evidence, stats, and benchmark output.

## 0.5.8

- Adds explicit `ctx setup` interactive onboarding for installing agents, enabling injection, syncing Ruler rules/MCP servers, and syncing skills through skillshare.
- Adds non-interactive setup flags: `--yes`, `--agents`, `--no-rules`, `--no-skills`, `--quiet`, and `--no-inject`.
- Keeps npm install lifecycle clean; setup only runs when the user explicitly invokes `ctx setup`.

## 0.5.7

- Adds thin passthrough commands `ctx ruler -- <args>` and `ctx skillshare -- <args>` for upstream admin/debug workflows without reimplementing those CLIs.
- Preserves upstream output and exit status for passthrough commands, with install hints when the upstream binary is missing.

## 0.5.6

- Adds visible `ctx install` progress from 0-100 so long model/file/skill embedding warmups no longer look stalled.
- Accepts `agy` as the Antigravity alias for install, Ruler sync, and skillshare sync while still passing Ruler/skillshare their official `antigravity` agent id.
- Makes `ctx install --inject` explicitly override `--quiet` when both flags are present.

## 0.5.5

- Discovers all skill roots containing `SKILL.md` under global/project `.gemini`, `.codex`, and `.claude` directories before `ctx sync --skills`.
- Skips temporary/cache directories such as `.tmp`, `.git`, and `node_modules` while discovering skill roots.

## 0.5.4

- Bridges legacy Antigravity skill directories (`~/.gemini/antigravity/skills` and `~/.gemini/antigravity-cli/skills`) into the skillshare source before `ctx sync --skills`.
- Reads custom `sources.skills` from `~/.config/skillshare/config.yaml` so ContextOS writes to the actual skillshare source path.

## 0.5.3

- Skips project MCP imports whose command is an absolute path that does not exist, preventing placeholder paths such as `/home/user/.cargo/bin/mcp-rtk` from reaching Antigravity.
- Sanitizes Antigravity MCP config files during `ctx sync --rules` by removing existing MCP entries with missing absolute command paths.

## 0.5.2

- Recovers automatically from malformed `embeddings.db` files by moving the corrupt cache aside and recreating it.
- Writes the sql.js embedding cache with atomic temp-file rename to avoid partial DB files during concurrent hook/MCP writes.

## 0.5.1

- Fixes `ctx sync --skills` first-run ordering by running `skillshare init` before `skillshare backup`, matching skillshare's config requirement.

## 0.5.0

- Adds `ctx sync --skills` for skillshare-backed skill sync across Codex, Claude Code, and Antigravity.
- Detects existing global/project skill directories, backs them up, optionally collects them into skillshare, runs sync, and rebuilds skill embeddings.
- Adds `~/.config/skillshare/skills` to skill discovery roots so ContextOS ranks the shared source of truth after sync.

## 0.4.1

- Adds Antigravity skill discovery roots for `.gemini/skills`, `.gemini/antigravity/skills`, and `.gemini/antigravity-cli/skills`.
- Raises the skill catalog scan cap to cover large Antigravity skill catalogs before ranking.

## 0.4.0

- Adds prompt-aware skill discovery to `ctx_score_context`, returning `suggestedSkills` alongside rules and files.
- Scans project/global `.codex/skills`, `.claude/skills`, and Antigravity `.gemini/**/skills` catalogs, ranks skill `name` + `description`, and injects top skill hints into prompt context.
- Warms skill embeddings during `ctx install` and `ctx embeddings warm`.

## 0.3.0

- Adds `ctx sync --rules` for Ruler-backed project rule/MCP sync across Codex, Claude Code, and Antigravity.
- Supports `--agents`, `--dry-run`, `--force`, and `--yes` flags for targeted, previewable, idempotent Ruler sync.
- Injects `ctx-mcp` into `.ruler/ruler.toml` without deleting user-defined MCP servers or agent sections.
- Imports existing Codex MCP servers from `~/.codex/config.toml` into Ruler so servers like `code-review-graph` and `agentmemory` can propagate to Antigravity and Claude Code.
- Mirrors Ruler MCP servers into Antigravity app/CLI MCP config files after `ruler apply` so Antigravity receives all imported MCP servers.
- Imports project `.mcp.json` servers such as `mcp-rtk` so MCPs generated by Ruler or other agents are also propagated.
- Skips embedding model download during `ctx install` when the required MiniLM files are already present in `~/.ctx/contextos/models`.
- Writes Antigravity MCP config to the legacy editor path `~/.gemini/config/mcp_config.json` so older editor builds can show ContextOS under `@mcp`.

## 0.2.4

- Hardens workspace isolation for Claude Code, Codex, and Antigravity hooks by normalizing project cwd from hook payloads, `workspacePath(s)`, and `CLAUDE_PROJECT_DIR` before writing prompt/report telemetry.

## 0.2.3

- Registers `ctx-mcp` for Claude Code by writing a user-scoped MCP server into `~/.claude.json`.

## 0.2.2

- Registers `ctx-mcp` for Antigravity app and `agy` CLI by writing `~/.gemini/antigravity/mcp_config.json` and `~/.gemini/antigravity-cli/mcp_config.json`.

## 0.2.1

- Adds `ctx install claude` for Claude Code hooks in `~/.claude/settings.json`.
- Adds `ctx install agy` for Antigravity hooks in `~/.gemini/config/hooks.json`.
- Adds Antigravity `PreInvocation` and `Stop` adapters so prompt context can be injected through `ephemeralMessage` and reports remain available through `ctx report` / `ctx evidence`.

## 0.2.0

- Adds `ctx benchmark -- "task"` to compare baseline AGENTS.md ordering with ContextOS scheduling and estimate lost-in-the-middle risk.
- Improves AGENTS.md rule filtering for generic headings and non-actionable sections.
- Splits Stop reports into `followed`, `ignored`, `unknown`, and `unmeasurable` so efficiency only reflects rules with evidence.

## 0.1.9

- Proxies all configured MCP servers except ContextOS' own `ctx-mcp` server.
- Preserves each original MCP command after the proxy separator and forwards it unchanged, including RTK-managed commands.

## 0.1.8

- Limits automatic MCP telemetry wrapping to `code-review-graph` only.
- Restores older ContextOS proxy wrappers on non-target MCP servers such as `agentmemory`.
- Skips RTK-managed MCP commands instead of replacing their command entry with the ContextOS proxy.

## 0.1.7

- Filters documentation-only AGENTS entries such as MCP tool headings, HTML comments, generic "Key Tools" headings, and tool reference tables before scoring.
- Keeps actionable tool instructions, for example `Use detect_changes for code review`, measurable through MCP telemetry.

## 0.1.6

- Adds a transparent stdio MCP telemetry proxy that records `tools/call` events while forwarding requests to the original MCP server.
- `ctx install` now wraps supported local MCP servers, including `code-review-graph` and `agentmemory`, so runtime-only tool rules can be measured from real MCP usage.

## 0.1.5

- Sanitizes stale Stop reports at display time so previously recorded system-user rules no longer appear in `ctx report` or `ctx evidence` after upgrading.
- Filters system-user rules again inside the Stop hook to protect reports created from older prompt contexts.

## 0.1.4

- Filters host/session user rules such as `sudo -u user`, `sudo su - user`, and "commands must run as user X" before scoring and injection.
- Prevents system-user setup instructions from inflating `unknown` outcomes or skewing ContextOS efficiency reports.

## 0.1.3

- Separates runtime prompt/report/stats files per workspace under `~/.ctx/contextos/workspaces/<workspace-id>`.
- Adds a local `.contextos/workspace.json` marker and `.gitignore` entry so workspace identity is stable without being pushed.
- Keeps MCP/model caches shared at the ContextOS data root while isolating report, evidence, stats, and telemetry by project path.

## 0.1.2

- Adds local runtime telemetry for hook-visible tool, MCP, and command signals.
- Uses telemetry evidence in Stop reports so runtime-only rules can be marked `followed` instead of staying `unknown` when matching tool/command signals are observed.
- Shows runtime telemetry summaries in `ctx report` output.

## 0.1.1

- Fixes `sql.js` WASM resolution when ContextOS is executed from the published npm package through `npm exec` or `npx`.

## 0.1.0

Initial public release.

- Adds the `ctx` Codex plugin installer.
- Registers `ctx-mcp` for semantic AGENTS.md rule scoring.
- Injects prompt-specific ContextOS rules and suggested files through Codex hooks.
- Reports Stop-hook rule outcomes as `followed`, `ignored`, or `unknown`.
- Provides `ctx debug`, `ctx report`, `ctx evidence`, `ctx stats`, and `ctx embeddings warm`.
- Includes CI checks for plugin validation, unit tests, and MCP protocol/performance smoke.

Known release note:

- `npm audit` currently reports transitive dependency vulnerabilities in the local embedding stack. They are not fixed with `npm audit fix --force` because that can introduce breaking dependency upgrades. Revisit before a wider public launch.
