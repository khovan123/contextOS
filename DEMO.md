# ContextOS Demo Script

Use this to record the README GIF or a short terminal clip.

The current rendered demo is checked in at:

```text
docs/demo/contextos-demo.gif
```

It was generated from an actual terminal transcript using:

```text
node docs/demo/render-terminal-gif.mjs <terminal-log> docs/demo/contextos-demo.gif
```

## Goal

Show one thing clearly:

```text
AGENTS.md rule buried in a long file -> ContextOS injects the relevant rule -> ctx report proves whether it was followed
```

## Setup

```bash
npm install -g @minhpnq1807/contextos
ctx setup --yes --agents codex
```

Restart Codex after setup.

## Fixture Rule

Use a repo whose `AGENTS.md` contains a rule like:

```text
IMPORTANT: This project has a knowledge graph. Always use code-review-graph MCP tools before Grep/Glob/Read.
```

The rule should be somewhere below the first screen of `AGENTS.md` so the demo makes the lost-in-the-middle problem obvious.

## Recording Flow

1. Show the rule in `AGENTS.md`.
2. Start Codex in the project.
3. Submit:

```text
Recheck authen flow
```

4. Show the `hook context` block:

```text
## Critical ContextOS rules
...
## Suggested files to check
...
## Suggested workflow for this task
...
```

5. Let the task finish so the Stop hook writes the report.
6. Show:

```bash
ctx report
ctx evidence
ctx stats
```

## Side-By-Side Clip

Record two short terminal panes:

| Left | Right |
| --- | --- |
| Codex without ContextOS. | Codex with ContextOS. |
| Agent starts by reading random files or grepping. | Hook context shows the relevant rule before work starts. |
| No evidence report. | `ctx report` shows followed/ignored/unknown. |

## Talking Points

- ContextOS does not replace Codex, Claude Code, or Antigravity.
- It runs through native hooks plus a local `ctx-mcp` MCP server.
- It uses local embeddings to bridge vocabulary mismatch such as `kiểm duyệt` and `moderation`.
- Runtime history is isolated by project path and shared across supported agents.
- It reports what happened after the task instead of only hoping the agent remembered rules.

## Release Checks

Run before recording or posting:

```bash
npm run validate:plugin
npm test
npm run test:mcp
npm pack --dry-run
npm view @minhpnq1807/contextos version
```
