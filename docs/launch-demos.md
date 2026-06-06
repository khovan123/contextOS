# Launch Demos

These are demo scripts for explaining ContextOS quickly. They are intentionally small and visual.

## 1. Agent Hallucination Benchmark

Prompt:

```text
Fix deployment
```

Raw agent:

```text
Suggests: Vercel, Docker, Railway
Reason: guessed from common deployment tools
```

ContextOS:

```text
Detected:
- eas.json
- expo dependency
- GitHub workflow

Selected:
- eas
- mobile-deployment
- github-actions-ci-cd
```

Message:

```text
Same prompt. Same model. Different context.
```

## 2. AGENTS.md Lost In The Middle

Setup:

```text
AGENTS.md
  rule 1
  rule 2
  ...
  IMPORTANT: Always use code-review-graph before grep.
  ...
  rule 40
```

Raw agent:

```text
Misses the buried rule.
```

ContextOS:

```text
Extracts the relevant rule and injects it before work starts.
```

Message:

```text
Important repo rules should not depend on where they appear in a long file.
```

## 3. Repo-Aware Skills

Prompt:

```text
fix deployed
```

Repo A:

```text
Evidence: expo, eas.json
Skills: eas, mobile-deployment
```

Repo B:

```text
Evidence: next, vercel.json
Skills: vercel-deployment, github-actions-ci-cd
```

Repo C:

```text
Evidence: Dockerfile, docker-compose.yml
Skills: docker, build-log-debugging
```

Message:

```text
Context is not extra text. It changes the correct answer.
```
