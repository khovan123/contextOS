# Roadmap

ContextOS is past the core routing layer. The next work should make the value visible faster and create a community loop.

## P1: Hallucination Leaderboard

The strongest launch artifact is not another feature. It is a leaderboard that shows raw prompt-only agents making plausible guesses while ContextOS routes from repo evidence.

Layout:

```text
benchmarks/
  codex/
  claude-code/
  cursor/
  gemini-cli/
  contextos/
```

Protocol:

```text
same repo
same task
same model when possible
same scoring rubric
```

Example task:

```text
Task: Fix deployment
Repo: Expo app
```

Example result:

```text
System             Correct Skill
Raw Agent          ❌
ContextOS + Codex  ✅
```

Target public table:

```text
Hallucination Benchmark

Claude Code:        61%
Cursor:             58%
Raw Codex:          63%
ContextOS + Codex:  89%
```

Why it matters:

- It is easy to understand in seconds.
- It turns ContextOS from infrastructure into a visible correctness story.
- It creates content for GitHub, Hacker News, Reddit, and X/Twitter.

## P2: Agent Replay

ContextOS already records prompt context, suggested files, suggested skills, rule outcomes, telemetry, and reports. Agent Replay should turn that into a compact post-task narrative.

Planned command:

```bash
ctx replay
```

Target output:

```text
Prompt:
Fix deployment

Selected skills:
- eas
- github-actions-ci-cd

Rules followed:
✓ Use graph first

Files suggested:
✓ eas.json
✓ workflow.yml

Files actually touched:
✓ eas.json
✓ workflow.yml

Efficiency:
94%
```

Why it matters:

- It proves whether the injected context helped.
- It turns local telemetry into a readable artifact.
- It gives maintainers a quick way to debug agent behavior after the fact.
- It is easier to demo than raw JSON reports.

Likely inputs:

- `last-prompt-context.json`
- `last-report.json`
- `prompt-history.jsonl`
- `report-history.jsonl`
- `telemetry.jsonl`
- current git diff/status for touched files

Non-goals for the first version:

- Cloud sync
- Dashboard
- Cross-user analytics
- Long-term hosted memory

## P3: Community Skill Packs

Do not build a full Hub first. Start with the local `community-skills/` folder that accepts PRs.

Initial packs:

```text
community-skills/
  eas/
  vercel/
  prisma/
  redis/
  oauth-google/
  jwt-auth/
```

The seed packs now live in [`community-skills/`](../community-skills/). Each pack contains:

```text
SKILL.md
skill.yaml
```

The Skill Router becomes more valuable when skill packs are ContextOS-ready instead of plain markdown folders.

ContextOS-ready skill packs should include:

```yaml
id: oauth-google
name: Google OAuth
positive_triggers:
  prompts: [oauth, google login, google sign in, callback]
  files: [app/api/auth/*, auth.config.ts]
  dependencies: [next-auth, "@auth/core"]
evidence:
  files: [app/api/auth/*, auth.config.ts, .env.example]
  dependencies: [next-auth, "@auth/core"]
negative_triggers:
  prompts: [jwt only, password login]
  dependencies: [jsonwebtoken]
workflow:
  - Inspect auth provider config, callback URLs, scopes, secrets, and session creation.
  - Verify frontend login entrypoints and backend callback routes agree.
  - Patch the smallest auth boundary while preserving session conventions.
  - Verify with focused auth tests, typecheck, or local callback flow.
```

Possible future install flow:

```bash
ctx skills install oauth-google
```

or package-based:

```bash
npm install skill-oauth-google
ctx sync --skills
```

Why it matters:

- It creates a network effect around reusable agent capabilities.
- It gives skill authors a structured contract: triggers, evidence, negative gates, workflow.
- It lets ContextOS route capabilities by project evidence instead of popularity or keyword overlap.

Non-goals for the first version:

- Full marketplace UI
- Paid skill hosting
- Cloud account system
- Remote vector database

## P4: ContextOS Ready

Certification can help the ecosystem self-organize without a hosted service.

```text
ContextOS Ready
```

Repository requirements:

```text
AGENTS.md
skills/
workflows/
```

Command:

```bash
ctx doctor
```

Target output:

```text
Repository Score

Rules: 92
Skills: 88
Workflows: 84

Overall:
ContextOS Ready Gold
```

Why it matters:

- It gives projects a concrete target.
- It creates a badge people can add to README files.
- It encourages community contributions without requiring a cloud product.

MVP scope:

- Local-only scoring.
- No hosted account.
- No external leaderboard dependency.
- Rules score from project `AGENTS.md`.
- Skills score from project skill packs with `SKILL.md` and `skill.yaml`.
- Workflows score from project workflow markdown with agent handoff chains.
