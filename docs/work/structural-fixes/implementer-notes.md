---
description: how a structural-fixes phase runs for a fresh implementer agent — what to read, worktree setup, iteration, examiners, commit and report. Read first when starting any structural-fixes phase
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-15
last_updated: 2026-11-15
tags: [structural-fixes, process, implementer]
---

# Implementer notes (every phase)

Each phase starts a fresh `dev` agent in implementer mode, briefed by the tech-lead with one line naming its
phase doc. Everything it needs to start is in these files. Research already done is not repeated: the phase doc
names the research it rests on. Mechanisms traced by the plan review are hypotheses until your red test
confirms them.

## Read, in order

1. `~/.claude/skills/clean-dev/SKILL.md` and `AGENTS.md` (project rules: 400-line files, banners, no barrels,
   one-line commits).
2. `plan.md`, then your phase doc (`a.md`, `b.md`, `c.md` or `d.md`). Only `plan.md` is approved
   scope.
3. The research files your phase doc names, and the `docs/reuse/*.md` files it lists.
4. `docs/arch/architecture.md`: the sections your folders sit in, before adding a module or crossing folders.

The code outranks these docs. Where they disagree, follow the code and say so in your report.

## Worktree

- The tech-lead creates `.claude/worktrees/<branch>` on branch `<branch>`. If `git log -1` shows an old commit,
  run `git reset --hard main` first.
- `node_modules` is a symlink to the main checkout's: never run `npm ci` or `npm install`. `npm run build` in
  your worktree builds your own `dist`.
- Biome is falsely clean on a symlinked `node_modules`. Before reporting, run
  `rm node_modules && cp -cR /Users/arash/Projects/istalang/node_modules node_modules`, then `npx biome ci`.
- Use `tsm` (the ts-refactor skill) for references, renames, moves and codemods. Report a tsm bug to @solu over
  hcom.

## Iterate, then verify

- Write the repro tests first and see them fail (red), then fix (green).
- While iterating, run only the affected tests: `npx vitest run <paths>`.
- Run `npm run verify` once, at the end. Timeouts in the full run (files that pass alone) don't count.
- A refactor and a behaviour change go in separate commits, the refactor first. Commits are one line,
  Angular style, with no body and no attribution.

## Examiners

Run them once, when the whole phase is done, both at the same time. Brief them with facts only: phase, branch,
diff range, spec, plan, your phase doc, and the acceptance criteria verbatim. Never your approach.
- **Reviewer:** `hcom f rvroot-remu --tag <tag> --go`. If that agent is gone, spawn
  `hcom pi --agent reviewer --tag <tag> --go --dir <worktree>`. Ask it to focus on DRY, double standards,
  cohesion by feature, simplification, and anything hacky.
- **QA:** `hcom pi --agent qa --tag <tag> --go --dir <worktree>`.

Fix what they find, and have the same agents re-examine.

## Rules

- Do the work yourself. Don't fork yourself or spawn helpers beyond the two examiners.
- Ask the tech-lead (@noro), not the human. Message only on a blocking discovery; your report is the normal
  channel.
- Stay inside your phase's scope. File unrelated defects in your report; don't fix them.
- Never edit `plan.md` or `docs/work/tracker.md`. Report changes instead.
- Report over hcom in this shape, with examiner verdicts verbatim:

```
PHASE <id> — <done | blocked>
BRANCH / HEAD:  <branch> <sha>, rebased on main <sha>
SHIPPED:        <what now works>
DEVIATED:       <plan changes and why> | none
PLAN IMPACT:    <what later phases must assume> | none
DEBT FILED:     <for the tracker, verbatim> | none
QA:             <verdict verbatim>
REVIEW:         <verdict verbatim>
RISK:           <what to watch> | none
```

The tech-lead runs the ff-merge.
