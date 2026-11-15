---
description: tech-lead state for structural-fixes — what is approved, running, merged and next, and how it started. Read first when resuming the tech-lead role (after compaction or in a new session)
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-15
last_updated: 2026-11-15
tags: [structural-fixes, status]
---

# Status

## Origin

- B92 is fixed and merged (`07f6bc5e`; plan `docs/work/b92-union-order/`, done). Its QA filed B94.
- The human asked for B94 to be solved robustly, with refactoring, and for the other tracker items to be reviewed
  for the same root causes: poor cohesion (an agent sees only part of a feature) and DRY copies (a fix misses
  one). Four scouts ran; their reports are in `research/`.
- The human also asked that every phase start a fresh agent with all the docs it needs, and that the
  tech-lead's own state survive compaction (this file).
- mihu was told about B92's merge and that the FormBuilder `TODO(B92)` workaround can be reverted (tracker B92).

## State (2026-11-15)

- The plan was revised after the cold plan review (`sfrv-suri`, verdict "changes required", stored as
  `research/plan-review.md`):
  - A1 and A2 merged into A.
  - B re-scoped to per-field layout plus the expansion reach; B87 out.
  - C's unit moved to `resolution/choosing/`.
  - D rewritten to four exact asymmetries, now in wave 1.
- suri re-reviewed the revision: approve, with no findings (appended to `research/plan-review.md`).
- The human approved D1–D4; the docs are committed (`45b09009`). The human asked to begin phase A alone; B, C
  and D wait for the human's go.
- Step 0 done: tracker hygiene committed. New A rows: Q56, Q57, B95, B96, B97. Close them, with B94, B65 and P35,
  when A merges.
- Phase A running: agent `sfa-tizo`, worktree `.claude/worktrees/sf-a-type-identity`, branch `sf-a-type-identity`
  from `45b09009`; idle sub armed.
- Still alive: `b92-neni` (B92, done), its reviewer and QA, and `sfrv-suri`. Ask the human before stopping them.

## Next, on approval

1. Commit the plan docs.
2. Step 0: tracker hygiene, per `findings.md` "Stale or duplicate rows". Correct B94's `live` claim. File the new
   A findings (runtime variant-by-name, union parenthesis, extern-key collision, `typeText` in keys, name-based
   Array/Map) as rows that point to this plan. Add B87's traced mechanism (`b.md` "Not here") to its row.
3. Create worktrees and branches `sf-a-type-identity`, `sf-b-layout-expansion`, `sf-c-members` and
   `sf-d-inference`. Spawn a fresh dev agent for each, `hcom claude --agent dev --tag <tag> --go`, then send one
   line: "ROLE: IMPLEMENTER, phase <id> of docs/work/structural-fixes; read implementer-notes.md, then <id>.md;
   worktree <path>." Arm `hcom events sub --idle <name>` for each.
4. ff-merge each after its reviewer approves, rebasing the others in turn. Then run the merge review over all
   four, and `npm run verify` on main.
5. Write the plan for E and B87 (`findings.md` §E). Update this file at every step.
