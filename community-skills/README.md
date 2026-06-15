# ContextOS Skills

Community Skill Packs for ContextOS.

This repo is intentionally smaller than a hosted Hub. Contributors can open a PR that adds one folder with:

```text
<skill-id>/
  SKILL.md
  skill.yaml
```

`SKILL.md` is the model-visible operating guide. `skill.yaml` is the routing contract used by the Skill Router.

## Contract

Every pack should define:

- `name`: Human-readable skill name.
- `positive_triggers`: Prompt, file, and dependency signals that should select the skill.
- `evidence`: Project files and dependencies that support high confidence routing.
- `negative_triggers`: Signals that should reduce confidence or reject the skill.
- `workflow`: Short execution checklist for the agent.

Copy `_template/` when adding a new pack.

## Seed Packs

- `eas`: Expo EAS build, submit, preview, and production deployment.
- `vercel`: Next.js and Vercel deployment debugging.
- `prisma`: Prisma schema, migration, generated client, and query debugging.
- `redis`: Redis cache, TTL, rate limiting, queue, and session work.
- `oauth-google`: Google OAuth login and callback flows.
- `jwt-auth`: JWT access token, refresh token, guard, and middleware work.

## Contribution Rules

- Keep triggers specific enough to avoid false positives.
- Add negative triggers for adjacent but wrong platforms.
- Prefer project evidence over broad prompt words.
- Keep workflows compact and action-oriented.
- Do not require optional graph or memory adapters.

## PR Validation

Every PR runs:

```bash
node scripts/validate-skills.mjs
```

The validator requires each skill folder to include `SKILL.md`, `skill.yaml`, matching `id`, `positive_triggers`, `evidence`, `negative_triggers`, and `workflow`.

Use the PR template when submitting a pack. Use the issue templates for new skill requests or routing bugs.
