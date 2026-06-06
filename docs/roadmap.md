# Roadmap

ContextOS is past the core routing layer. The next work should make the value visible faster and create a community loop.

## P1: Agent Replay

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

## P2: ContextOS Hub

The Skill Router becomes more valuable when skill packs are ContextOS-ready instead of plain markdown folders.

ContextOS-ready skill packs should include:

```yaml
id: oauth-google
name: Google OAuth
triggers:
  prompts:
    - oauth
    - google login
  files:
    - app/api/auth/*
    - auth.config.ts
  dependencies:
    - next-auth
    - "@auth/core"
evidence:
  positive:
    - package dependency exists
    - auth callback route exists
negative:
  dependencies:
    - passport-saml
workflow:
  - inspect auth provider config
  - verify callback route
  - test login redirect
```

Possible install flow:

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

## P3: Hallucination Benchmark

The best public demo remains:

```text
Same prompt.
Same model.
Different context.
```

The benchmark should compare raw prompt-only recommendations against ContextOS evidence-routed recommendations across controlled fixtures:

- Expo/EAS
- Next/Vercel
- Docker
- Railway/Render
- Firebase
- Nest/Prisma
- Express/JWT
- static docs negative cases

Goal:

```text
Show that context routing prevents plausible-but-wrong agent guesses.
```
