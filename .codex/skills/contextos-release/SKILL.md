---
name: ContextOS Release
description: Prepare ContextOS npm package releases, changelog updates, plugin validation, tags, and GitHub release safety checks.
---

# ContextOS Release

Use this skill when bumping versions, preparing changelog entries, validating package contents, or publishing ContextOS.

## Workflow

1. Update README and CHANGELOG before tagging.
2. Verify package and plugin versions stay aligned.
3. Run build, plugin validation, MCP smoke, tests, and `npm pack --dry-run`.
4. Commit, tag, push, and verify the GitHub release/npm publish path.
