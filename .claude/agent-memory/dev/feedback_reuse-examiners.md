---
name: reuse-examiners
description: re-review/re-QA goes to the same reviewer/QA agents that found the issues; their new findings go back to the agent that fixed that area
metadata:
  type: feedback
---

After fixes land, send the re-review and re-QA to the reviewer and QA agents that made the first reports, not fresh ones. Route each new finding back to the agent that owned that fix area.

**Why:** the human said so for ir-first's fix round (2026-11-17): "give review/qa to existing zepa/lipi, and if issues found give them back to the ones that were supposed to fix them".

**How to apply:** wait until every fix partition (cleanup included) has merged, then message the existing examiners. Related: [[resume-forks-for-fixes]], [[coordination]].
