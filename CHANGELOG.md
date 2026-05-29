# Changelog

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
