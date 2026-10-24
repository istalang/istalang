---
name: feedback-commits
description: Commit message format the user requires in istalang — overrides clean-dev B.8/G tags and co-author attribution
metadata:
  type: feedback
---

Commit messages are a single line, Angular style (`type(scope): summary`), no body, no `clean-dev:` rule tags, no `Co-Authored-By` or any AI attribution — must read like a human wrote it.

**Why:** explicit user instruction at project start (2026-10-24); it overrides the clean-dev commit-body/tag rules and the harness attribution reminder.

**How to apply:** every commit by any agent in this repo (tech-lead, implementer forks); include it in fork briefs so implementers don't fall back to clean-dev's tagged body. Rule names still go in conversation/reports, just not in commits.
