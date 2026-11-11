---
name: worktree-base
description: forks made with `hcom f … -w <name>` start their worktree at an old commit (b390cfe8), not main — reset to main first
metadata:
  type: project
---

A worktree created by `claude -w` (via `hcom f riku … -w <name>`) is cut from an old commit (`b390cfe8`, likely the remote's head), not local `main`.

**Why:** observed 2026-11-11 when forking the async-kinds merge-review fixes; p8-rati caught it.

**How to apply:** after forking with `-w`, check `git -C .claude/worktrees/<name> log -1` and have the fork `git reset --hard main` before work; or say so in the fork's one-line brief.
