---
name: feedback-coordination
description: How the user wants tech-lead/fork coordination run in istalang — minimal fork briefs, forks self-rebase, forks escalate to the human, lean coordinator context
metadata:
  type: feedback
---

- Fork briefs state only which fork it is and its task (e.g. "IMPLEMENTER, M1 phase 1.1, branch m1-syntax; task: §1.1 of m1-syntax.md"). No explanations: the fork already has the context.
- Serial forks work directly in the main checkout, without a worktree. Parallel forks use worktrees (`.claude/worktrees/<branch>`), with no limit on how many: start every branch as soon as its dependencies have merged (user, 2026-10-29). A worktree's node_modules is a symlink to the main checkout's: say in the brief never to run npm ci/install there (on 2026-10-28 one did and emptied main's node_modules). A fork needing a new dependency: the tech-lead runs `npm install --no-save --ignore-scripts <pkg>@<ver>` in the main checkout before forking; the fork pins it in package.json and runs `npm install --package-lock-only`.
- On every merge to main, the tech-lead tells every running fork what changed and asks it to rebase now (user, 2026-10-29), so forks learn early and rebase cheaply.
- The tech-lead doesn't merge branches or resolve conflicts. If main moved, the tech-lead asks the fork to rebase onto main itself and report again.
- Forks raise issues directly with the human, not the tech-lead. A fork reports to the tech-lead only after its qa/review fixes are done and the human has approved.
- The tech-lead says little to the human while work runs; the human reads the fork transcripts.

**Why:** the user's instruction at M1 start (2026-10-24). Every fork inherits the coordinator's context, so it must stay small, and the user wants to approve each phase personally.

**How to apply:** every time a fork is spawned or a report is consumed in this project.
- Reviewers were cold Claude `reviewer` agents (never `--model fable` unless asked), after a pi review on 2026-10-27 approved with no findings where a Claude reviewer found real bugs. On 2026-10-28 the user moved pi from gemini-3.1 to gemini-4-argon (more thorough), which fixed that, and switched reviewers to cold pi agents (`hcom pi --tag rv --go --dir <wt>`). Default to pi reviewers; the user asks for a second Claude review himself when a pi review reports nothing.
- Cold reviewers are slow to learn the project, so don't spawn one per fork (user, 2026-10-29). Either group small related changes under one reviewer, or spawn one pi root reviewer at the start that reads every docs/reuse/*.md (to catch DRY violations and double standards) plus the code the plan touches, and idles; each implementer forks it (`hcom f <root> --tag rv --go --dir <wt>`) to review its own diff, and a last fork does the merge review.
- Implementers are forks of the tech-lead (`hcom f zelu …`), not pi agents, unless the user names pi. Brief: diff range plus docs, focus on DRY, simplification, double standards, non-robust/hacky code. The same reviewer re-reviews the fixes.
