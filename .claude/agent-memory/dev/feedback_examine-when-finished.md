---
name: feedback-examine-when-finished
description: Fork reviewer/QA (from the p8 roots bumi/teri) only once the whole unfinished phase is done, not per commit inside it
metadata:
  type: feedback
---

Spawn examiners only when the work in hand is finished and ready: fork the QA and reviewer roots (`p8qa-bumi`, `p8rv-teri`) once, after the last step of the phase, never per intermediate commit. An already-approved step stays approved; the rest is examined together at the end.

**Why:** 2026-11-11, async-kinds DG: after DG1 was approved, I forked new examiners for DG2 while DG3 was still in progress; the human closed them: "your current one is not finished yet. why are you spawning new test/reviews? ... fork from bumi/teri only once your work is finished and ready for test/review". He had also said "don't split into multi phases. Finish it here."

**How to apply:** when the human says to finish remaining steps in one go, treat them as one phase: build all of it, verify, then fork examiners once. Related: [[feedback-coordination]].
