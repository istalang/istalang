---
name: suites-over-corpus
description: rules written as Istalang tests go into .test.ista suites grouped by area; a corpus program only when the rule needs a whole program
metadata:
  type: feedback
---

Write ported or new runtime rules as cases of `.test.ista` suites grouped by area (slots, resolvers, waits, disposal, aliasing, …), so each suite compiles once for all its cases. Keep a corpus program only where a rule needs a whole program: a panic ending the run, the run's end, a live `main`, a host scenario.

**Why:** the human's change mid-port (2026-11-16, relayed by the tech-lead): one corpus program per rule compiles the std once per rule and bloats every corpus sweep.

**How to apply:** test-port and new-rule tasks; defects still go to `test/golden/defects/` as programs. Related: [[build-on-constructs]], [[test-iteration]].
