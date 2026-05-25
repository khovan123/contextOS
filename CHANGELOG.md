# Changelog

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
