---
name: feedback-reuse-docs
description: where reusable units and one-way decisions are indexed (docs/reuse/, grouped by caller need) and why AGENTS.md files must not hold such indexes
metadata:
  type: feedback
---

AGENTS.md files hold general, mostly static rules; never index functions or units in them. Reusable units, one-way rules and extension recipes go in `docs/reuse/`, one file per caller need (not per feature), each line `need → symbol (path)`. src/AGENTS.md only says what docs/reuse/ is, lists its files with who must read each before coding, and tells agents to keep them updated in the same commit.

**Why:** user decision on 2026-10-28. Most DRY and double-standard debt came from agents not knowing a unit or decision already existed; indexes inside AGENTS.md would churn constantly, and the docs must not waste LLM context.

**How to apply:** in fork briefs and reviewer briefs, rely on src/AGENTS.md pointing at docs/reuse/; when planning a shared design decision, put it in the matching docs/reuse file. Related: [[feedback-coordination]].
