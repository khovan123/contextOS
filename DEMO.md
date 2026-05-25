# ContextOS Demo Script

Use this script to record the README demo GIF or terminal clip.

## Setup

```bash
npm install -g @khovan123/contextos
ctx install
```

Restart Codex after install.

## Recording Flow

1. Open a project with an `AGENTS.md`.
2. Start Codex.
3. Submit:

```text
kiểm tra flow kiểm duyệt upload
```

4. Show the `hook context` block:

```text
## Critical ContextOS rules
...
## Suggested files to check
...
```

5. Let the task finish so the Stop hook runs.
6. Show:

```bash
ctx evidence
ctx stats
```

## Expected Talking Points

- ContextOS does not replace Codex or wrap the CLI.
- It runs as a Codex plugin with hooks plus `ctx-mcp`.
- It uses local embeddings to bridge vocabulary mismatch such as `kiểm duyệt` and `moderation`.
- It reports `followed`, `ignored`, and `unknown` outcomes after the task.

## Current Release Checks

Run before recording:

```bash
npm run validate:plugin
npm test
npm run test:mcp
npm pack --dry-run
```
