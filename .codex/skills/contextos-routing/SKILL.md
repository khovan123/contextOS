---
name: ContextOS Routing
description: Work on ContextOS rule, file, skill, workflow, and evidence routing without adding broad runtime complexity.
---

# ContextOS Routing

Use this skill when changing ContextOS routing behavior, prompt hook output, scoring, evidence, or MCP scorer paths.

## Workflow

1. Inspect the existing routing module before changing behavior.
2. Keep prompt-hook hot paths bounded and fail-open.
3. Add focused tests for ranking, output, or telemetry behavior.
4. Run `npm test`, `npm run build`, and `npm run validate:plugin` when the change affects runtime.
