# ContextOS Launch Kit

## Positioning

ContextOS fixes the practical problem where agents technically receive `AGENTS.md`, but task-critical rules are lost in the middle of a large context window.

One-line pitch:

```text
ContextOS makes Codex, Claude Code, and Antigravity follow the right AGENTS.md rules by injecting task-relevant context before each task and reporting what was followed afterward.
```

## Hacker News

Title:

```text
ContextOS - Codex ignores your AGENTS.md. This fixes it.
```

Post:

```text
I built ContextOS because I kept seeing agents miss important rules in AGENTS.md once the file got long.

The problem is not that agents cannot read the file. The problem is attention: the relevant rule is often buried in the middle of context.

ContextOS runs as native hooks plus a local MCP server. On each prompt it:

- scores AGENTS.md rules against the task
- injects the relevant rules at the start/end of the prompt context
- suggests likely files, skills, and workflows
- records runtime telemetry
- reports followed / ignored / unknown after the task

It supports Codex, Claude Code, and Antigravity. It is local-first and uses local MiniLM embeddings.

Install:

npm install -g @minhpnq1807/contextos && ctx setup

Repo: https://github.com/khovan123/contextOS
```

## X / Twitter

Short:

```text
Codex can read AGENTS.md and still ignore the rule that matters.

ContextOS ranks rules per prompt, injects the important ones before work starts, then reports followed / ignored / unknown after the task.

npm install -g @minhpnq1807/contextos && ctx setup

https://github.com/khovan123/contextOS
```

With GIF:

```text
AGENTS.md is not enough when the important rule is buried in the middle.

ContextOS:
1. scores rules against the prompt
2. injects the relevant context
3. suggests files/workflows
4. reports what the agent followed

Demo below.
```

## GitHub Repo Description

```text
Task-aware AGENTS.md context injection and compliance reports for Codex, Claude Code, and Antigravity.
```

## npm Description

```text
Task-aware AGENTS.md context injection and compliance reporting for Codex, Claude Code, and Antigravity.
```

## Launch Checklist

- [ ] README starts with problem, demo, install, before/after.
- [ ] Demo GIF or terminal clip recorded.
- [ ] `npm view @minhpnq1807/contextos version` matches latest tag.
- [ ] Fresh install tested in a separate project.
- [ ] GitHub repo description updated.
- [ ] HN post prepared.
- [ ] X post prepared with GIF.
