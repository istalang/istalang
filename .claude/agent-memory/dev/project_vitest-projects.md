---
name: vitest-projects
description: sweeps (`*.sweep.test.ts` outside src/compiler, test/golden) run only in vitest's `slow` project; mixing paths in one `vitest run` silently skips them
metadata:
  type: project
---

`npx vitest run test/golden src/runtime …` ran only the `quick` project's files and passed without running the golden sweeps. Run sweeps with `npx vitest run --project slow test/golden`.

**Why:** vitest.config.ts splits `quick` and `slow`; a sweep path alone selects `slow`, but mixed with quick paths it is dropped silently.
**How to apply:** when verifying goldens or the crash/cross-build sweep, run them in their own `--project slow` command and check the test count (golden 253, crash sweep 221). See [[test-iteration]].
