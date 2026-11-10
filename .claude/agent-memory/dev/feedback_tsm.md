---
name: tsm
description: implementers use the ts-refactor skill (tsm) for TS queries and refactors; tsm problems go to solu over hcom
metadata:
  type: feedback
---

Use the ts-refactor skill / `tsm` wherever it fits (finding references, renames, moves, codemods) instead of grep/sed or hand edits.

**Why:** the human asked for it for async-kinds phases (2026-11-10); solu maintains tsm.
**How to apply:** pass it on in every fork's context; when tsm misbehaves, message solu via hcom with the repro instead of silently working around it. See [[test-iteration]].
