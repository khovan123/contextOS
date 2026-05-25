# ContextOS

ContextOS (`ctx`) is a Codex companion plugin for task-aware project context.

It reads `AGENTS.md` guidance, scores the rules against the current prompt, suggests relevant files, records what context would have been injected, and reports lightweight compliance evidence after the task finishes.

## Quick Start

```bash
npm install -g @minhpnq1807/contextos
ctx install
```

Restart Codex after installing, then use Codex normally. ContextOS runs through Codex hooks and the `ctx-mcp` MCP server.

You can also run without a global install:

```bash
npx @minhpnq1807/contextos install
```

## Demo Flow

Use this flow for a 60-second demo recording:

```bash
ctx install
codex
```

Prompt Codex:

```text
kiểm tra flow kiểm duyệt upload
```

Expected result:

- `UserPromptSubmit` injects relevant AGENTS.md rules.
- ContextOS suggests upload/moderation files.
- `Stop` prints a ContextOS report with rule outcomes.
- `ctx evidence` shows the specific evidence behind the last report.

## Before / After

Without ContextOS, Codex receives the full AGENTS.md context passively and can miss task-relevant rules in large context windows.

With ContextOS, each prompt gets a compact block:

```text
## Critical ContextOS rules
- Use code-review-graph before reading files.
- All shell commands must run as minh_dev.

## Suggested files to check
- services/content-service/src/infrastructure/services/content-moderation.service.ts
- webapp/src/features/dashboard/components/moderation-status-badge.tsx
```

## What It Does

- Hooks into Codex `UserPromptSubmit`, `SessionStart`, and `Stop`.
- Registers a `ctx-mcp` MCP server that owns model loading and semantic scoring.
- Reads the active `AGENTS.md` chain for the current workspace.
- Scores rules by relevance to the user prompt.
- Finds likely relevant files with a hybrid retriever:
  - first, local prompt/file heuristics create seed candidates;
  - then, if `.code-review-graph/graph.db` exists, ContextOS queries `code-review-graph` semantic search and re-ranks graph-backed matches;
  - if no graph exists or graph lookup times out, it falls back to local heuristics.
- Stores scheduled context and hook telemetry under `$CODEX_HOME/contextos`.
- Reports rule outcomes as `followed`, `ignored`, or `unknown`.
- Injects `additionalContext` into Codex by default.

By default, ContextOS runs in injection mode. It adds task-relevant rules and files to the model context so the agent has the right project guidance at the moment it starts working.

## Install

From the package:

```bash
npx @minhpnq1807/contextos install
```

From this repository during local development:

```bash
rtk node bin/ctx.js install
```

`ctx install` does three things:

1. Copies this package into `$CODEX_HOME/marketplaces/contextos`.
2. Registers and installs `ctx@contextos` through Codex plugin marketplace commands.
3. Downloads and caches the required local MiniLM embedding model under `$CODEX_HOME/contextos/models`.
4. Warms `$CODEX_HOME/contextos/embeddings.db` for AGENTS rules and project file paths.
5. Registers the `ctx-mcp` MCP server and merges ContextOS global hooks into `$CODEX_HOME/hooks.json`.

Restart Codex after installing.

The embedding model is mandatory. `ctx install` intentionally fails if the model cannot be prepared, because otherwise the first prompt hook would have to cold-load or download the model.

## Modes

Injection mode is the default:

```bash
ctx install
```

In injection mode, ContextOS analyzes each prompt, stores runtime data, and returns task-relevant `additionalContext` to Codex. Codex may display that injected context in the UI.

Quiet mode:

```bash
ctx install --quiet
```

Quiet mode analyzes and measures prompts but returns an empty `additionalContext`, so Codex does not show a `hook context` block.

Explicit injection mode is also accepted:

```bash
ctx install --inject
```

Development copy mode:

```bash
ctx install --copy
```

Copies only the plugin payload into `$CODEX_HOME/plugins/ctx`. This is mostly for local experiments.

## Troubleshooting

### `ctx-mcp bridge socket not found`

Restart Codex after `ctx install`. The bridge socket is owned by the long-running `ctx-mcp` MCP server, so it exists only after Codex starts the server.

### `ContextOS model cache missing`

Run:

```bash
ctx embeddings warm -- "kiểm tra flow kiểm duyệt upload"
```

Then restart Codex.

### No report found

Run at least one Codex task with ContextOS enabled and let the task finish so the `Stop` hook can write `last-report.json`.

### `Average efficiency: unknown`

ContextOS only reports efficiency when git diff/status contains concrete evidence. Runtime-only rules, such as tool usage order, are shown as `unknown` unless they leave evidence in changed files.

## Commands

```bash
ctx install
ctx install --quiet
ctx install --inject
ctx install --copy
ctx debug -- "fix auth login bug"
ctx report
ctx evidence
ctx stats
ctx embeddings warm -- "fix upload moderation flow"
ctx --version
```

### `ctx debug`

Runs ContextOS scheduling locally for a fake task and prints rule scores plus the final context that would be injected.

```bash
ctx debug -- "fix upload moderation flow"
```

### `ctx report`

Shows the last Stop-hook report.

```bash
ctx report
```

### `ctx evidence`

Shows detailed rule-by-rule evidence for the last report:

- status
- rule text
- source file
- score
- evidence reason

```bash
ctx evidence
```

### `ctx stats`

Shows aggregate runtime stats:

- prompts analyzed
- reports generated
- injected vs quiet prompts
- average prompt analysis time
- average efficiency
- followed / ignored / unknown counts
- hook event counts
- last prompt and suggested files

```bash
ctx stats
```

### `ctx embeddings`

Builds local embeddings for semantic rule scoring.

```bash
ctx embeddings warm -- "fix upload moderation flow"
```

`warm` downloads/loads the local `Xenova/all-MiniLM-L6-v2` model if needed and stores rule/prompt vectors plus project file path vectors in `$CODEX_HOME/contextos/embeddings.db`.

## Runtime Files

ContextOS writes runtime data to:

```text
$CODEX_HOME/contextos/
```

Important files:

```text
debug.log                 hook event log
ctx-mcp.sock              private hook bridge owned by ctx-mcp
last-prompt-context.json  latest scheduled context
last-report.json          latest compliance report
prompt-history.jsonl      prompt scheduling history
report-history.jsonl      report history
```

These files are local telemetry only. Hooks do not make network calls.

## Project Understanding

ContextOS does not try to replace `code-review-graph`. It uses it as the project-understanding layer when the target repo has already built a graph database.

For file suggestions, ContextOS now runs a local RAG-style retrieval pass:

```text
prompt
  -> UserPromptSubmit hook calls ctx-mcp bridge
  -> ctx-mcp reads AGENTS.md and scores rules with local MiniLM
  -> run file-path embedding search against embeddings.db for semantic file candidates
  -> scan filenames for initial seed candidates
  -> expand candidates through relative import graph links
  -> query code-review-graph semantic_search_nodes with seed entity names
  -> merge graph matches with heuristic matches
  -> inject top suggested files with graph evidence reasons
```

This keeps the hook fast and local while still using graph semantics when available. The graph search path is visible in runtime data through file reasons such as `graph:content-moderation.service`.

Configuration:

```text
CONTEXTOS_GRAPH_RETRIEVAL=0       disable graph-backed file retrieval
CONTEXTOS_GRAPH_TIMEOUT_MS=80     graph lookup timeout
CONTEXTOS_CRG_PYTHON=/path/python Python with code_review_graph installed
CONTEXTOS_EMBEDDINGS=0            disable embedding rule scoring
CONTEXTOS_MCP_BRIDGE_TIMEOUT_MS=1000 ctx-mcp hook bridge timeout
CONTEXTOS_EMBEDDING_TIMEOUT_MS=800 embedding scoring timeout inside ctx-mcp/debug
CONTEXTOS_FILE_EMBEDDINGS=0       disable file-path embedding retrieval
CONTEXTOS_FILE_EMBEDDING_TIMEOUT_MS=80 file embedding lookup timeout
```

## Hook Flow

```text
Codex prompt
  -> UserPromptSubmit hook
  -> call ctx-mcp through private bridge
  -> ctx-mcp scores rules and relevant files
  -> write last-prompt-context.json
  -> return additionalContext unless quiet mode is enabled
  -> Codex runs task
  -> Stop hook
  -> read git diff/status
  -> measure rule evidence
  -> write last-report.json and report-history.jsonl
```

## Rule Outcomes

ContextOS uses a heuristic diff-based measurement.

```text
followed = evidence in the diff suggests the rule was applied
ignored  = evidence in the diff suggests the rule was violated
unknown  = the rule was relevant, but the diff does not prove either way
```

Example `unknown`: a rule says shell commands must run as `minh_dev`, but git diff does not record shell user identity. ContextOS cannot prove the rule was followed from code changes alone.

## Development

Install dependencies:

```bash
rtk npm install
```

Run tests:

```bash
rtk npm test
```

Run MCP protocol and warm performance smoke:

```bash
rtk npm run test:mcp
```

Validate plugin schema:

```bash
rtk npm run validate:plugin
```

Check the npm package contents:

```bash
npm pack --dry-run
```

Smoke test prompt hook:

```bash
printf '%s' '{"prompt":"fix auth validation","cwd":"'$PWD'","hook_event_name":"UserPromptSubmit"}' \
  | node plugins/ctx/bin/on-prompt.js
```

Smoke test Stop hook:

```bash
printf '%s' '{"cwd":"'$PWD'","hook_event_name":"Stop"}' \
  | node plugins/ctx/bin/on-stop.js
```

## Project Layout

```text
bin/ctx.js                         CLI
plugins/ctx/hooks.json             plugin hook declaration
plugins/ctx/bin/                   hook entrypoints
plugins/ctx/mcp/server.js          ctx-mcp MCP server and hook bridge
plugins/ctx/lib/reader.js          AGENTS.md reader
plugins/ctx/lib/analyzer.js        rule/file scoring
plugins/ctx/lib/embedding-scorer.js local embedding rule scoring
plugins/ctx/lib/score-context.js   shared MCP scoring pipeline
plugins/ctx/lib/ctx-mcp-client.js  hook bridge client
plugins/ctx/lib/import-graph.js      relative import graph traversal
plugins/ctx/lib/graph-retriever.js code-review-graph retrieval bridge
plugins/ctx/lib/scheduler.js       context layout
plugins/ctx/lib/measure.js         diff-based compliance checks
plugins/ctx/lib/reporter.js        report/evidence formatting
plugins/ctx/lib/stats.js           runtime stats
plugins/ctx/lib/global-hooks.js    Codex global hook installer
test/                              unit tests
contextos-plan.jsx                 implementation plan/reference
```

## Limitations

- Codex CLI only.
- Local marketplace plugin hooks may not fire reliably in current Codex builds, so `ctx install` also installs global hooks.
- Injection mode may show a visible `hook context` block in Codex.
- Quiet mode does not inject context into the model; it only records and measures.
- Compliance is heuristic and mostly based on git diff/status.
- Some rules can only be `unknown` unless ContextOS records richer telemetry such as tool calls or shell command metadata.
