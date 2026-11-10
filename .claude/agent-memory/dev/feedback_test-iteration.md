---
name: feedback-test-iteration
description: never iterate on the full vitest suite in istalang — run only affected tests while iterating, the full suite once at the end
metadata:
  type: feedback
---

While iterating on a change, run only the tests it probably affects (`npx vitest run <paths>`); run the whole suite once, at the end, before committing.

**Why:** the full suite is slow and heavy (user, 2026-11-08).

**How to apply:** every implementer fork and every fix loop; say it in briefs if a fork might not know.

Timeout failures in the final full run (5 s timeouts under load, files passing alone) are ignored, never rerun or waited on (user, 2026-11-10). Even 10–20 s tests are too slow: after F1, a dedicated task makes the slow and timing-out tests fast for repeated runs.
