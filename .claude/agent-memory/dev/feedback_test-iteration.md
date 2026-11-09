---
name: feedback-test-iteration
description: never iterate on the full vitest suite in istalang — run only affected tests while iterating, the full suite once at the end
metadata:
  type: feedback
---

While iterating on a change, run only the tests it probably affects (`npx vitest run <paths>`); run the whole suite once, at the end, before committing.

**Why:** the full suite is slow and heavy (user, 2026-11-08).

**How to apply:** every implementer fork and every fix loop; say it in briefs if a fork might not know.
