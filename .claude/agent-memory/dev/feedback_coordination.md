---
name: feedback-coordination
description: How the user wants tech-lead/fork coordination run in istalang — minimal fork briefs, forks self-rebase, forks escalate to the human, lean coordinator context
metadata:
  type: feedback
---

- Fork briefs state only which fork it is and its task (e.g. "IMPLEMENTER, M1 phase 1.1, branch m1-syntax; task: §1.1 of m1-syntax.md"). No explanations: the fork already has the context.
- Serial forks work directly in the main checkout, without a worktree. Parallel forks use worktrees (`.claude/worktrees/<branch>`), at most 3 at a time; when one finishes and merges, the next starts. A worktree's node_modules is a symlink to the main checkout's: say in the brief never to run npm ci/install there (on 2026-10-28 one did and emptied main's node_modules). Dependency changes: `npm ci` in the main checkout after the phase lands.
- The tech-lead doesn't merge branches or resolve conflicts. If main moved, the tech-lead asks the fork to rebase onto main itself and report again.
- Forks raise issues directly with the human, not the tech-lead. A fork reports to the tech-lead only after its qa/review fixes are done and the human has approved.
- The tech-lead says little to the human while work runs; the human reads the fork transcripts.

**Why:** the user's instruction at M1 start (2026-10-24). Every fork inherits the coordinator's context, so it must stay small, and the user wants to approve each phase personally.

**How to apply:** every time a fork is spawned or a report is consumed in this project.
- Reviewers are cold Claude `reviewer` agents (never `--model fable` unless asked; not pi: on 2026-10-27 a pi review approved with no findings where a Claude reviewer found real bugs). Brief: diff range plus docs, focus on DRY, simplification, double standards, non-robust/hacky code. The same reviewer re-reviews the fixes.
