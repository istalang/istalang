---
name: agents-merge-themselves
description: partition agents fast-forward the integration branch themselves; no idle integrator agent kept alive just to merge
metadata:
  type: feedback
---

Agents merge their own work: after rebasing onto the integration branch's head, a partition agent
fast-forwards it (in the worktree holding that branch, `git -C <worktree> merge --ff-only <branch>`).
No agent is kept alive only to integrate or review merges.

**Why:** the human closed ir-first's integrator (2026-11-16): "close it, agents merge themselves".

**How to apply:** brief partitions to rebase, fast-forward the integration branch and report the
head; the tech-lead only sequences who merges first. Related: [[coordination]].
