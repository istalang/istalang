---
name: feedback-tracker
description: docs/work/tracker.md lists only open items; resolved debt is removed, not marked resolved
metadata:
  type: feedback
---

The tracker's Filed table holds open items only. When an item is resolved, delete its row (git history keeps it); never keep "resolved: …" rows. Ids keep counting up (don't reuse ids). Don't reference tracker ids from code or tests, since they disappear.

**Why:** user instruction during M1.3 (2026-10-24): resolved rows were piling up as noise.

**How to apply:** any agent filing or resolving debt in this repo, including the tech-lead after merge reviews. Related: [[feedback-coordination]].
