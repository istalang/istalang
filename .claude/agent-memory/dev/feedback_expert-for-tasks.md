---
name: expert-for-tasks
description: spawn `expert` agents (not `dev`) for doing work and tasks; `dev` is for planning big tasks
metadata:
  type: feedback
---

When spawning a fresh agent to do work or a task (fix defects, port tests, perf work, a partition
of a phase), spawn `hcom claude --agent expert`, not `--agent dev`. `dev` is for planning big tasks
(tech-lead mode); forks of the tech-lead stay forks.

**Why:** the human's instruction (2026-11-17): "for doing work and tasks (not planning for big
tasks) you have to spawn `expert` agent instead of `dev`."

**How to apply:** every cold implementer spawned via hcom uses `--agent expert`, with the same
complete brief. Related: [[coordination]], [[agents-merge-themselves]].
