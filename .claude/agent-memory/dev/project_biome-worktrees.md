---
name: biome-worktrees
description: biome false-cleans in worktrees whose node_modules is a symlink — type-aware and import rules silently pass; lint against a real (cloned) node_modules
metadata:
  type: project
---

In a worktree whose `node_modules` is a symlink to the main checkout's, biome resolves no modules and infers no types, so `noUnresolvedImports` and type-aware rules (`noUnnecessaryConditions`) pass silently. Two such errors sat latent on main for ~150 commits until found 2026-11-10 (fixed in ea3d8ac1).

**Why:** forks run in worktrees with symlinked `node_modules` (never `npm ci` there).
**How to apply:** before a phase's report, replace the symlink with an APFS clone (`rm node_modules && cp -cR <main>/node_modules node_modules`) and run `npx biome ci`; say so in fork context. See [[test-iteration]].
