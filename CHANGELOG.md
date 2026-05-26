# Changelog

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
