---
description: status of toolchain milestones and filed debt/out-of-scope items — read to know what is done, in flight, or deferred
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-24
last_updated: 2026-10-24
tags: [tracker]
---

# Tracker

## Milestones (plan: `docs/work/toolchain-v0.1/plan.md`)

| Milestone | Status |
| --- | --- |
| M1 Syntax | done |
| M2 Skeleton | planned |
| M3 Feature slices | planned |
| M4 Standard library | planned |
| M5 Test runner | planned |
| M6 Formatter | planned |
| M7 Language service and LSP | planned |
| M8 Packages | planned |

## Filed

Open items only: an item is removed once it is resolved; git history keeps it. Ids keep counting
up, so the next one is D38.

| # | Item | Source | Status |
| --- | --- | --- | --- |
| D27 | Project root ignores `ista.json`: spec §3.13 makes the directory holding `ista.json` the root, with the working directory only as a fallback, but `cli/project.ts` always uses the working directory. Implement it with `ista.json` in M8. | phase review M2.1 2026-10-24 | open |
| D33 | The build emits declarations for every `src` module (tsc) but JavaScript only for modules reachable from `cli/main.ts` (tsdown entry). `compiler/syntax/tree.ts`, for example, ships `isNode` and `childrenOf` in `.d.ts` with no `.js`. When the subpath exports (`istalang/compiler`, …) land, add each one as a tsdown entry, and test that every exported `.d.ts` has its `.js`. | phase review M2.1 2026-10-24 | open |
| D34 | Snapshot↔Definition validation has no owner: `snapshot.ts` defers pc ranges, frame register bounds, function/type ids, top-frame pc on an `await`/`select`, and `resource` types being extern to "the runtime's load", which no phase scopes. Own it in 2.5 beside version refusal, so a snapshot from another Definition is refused at load, not mid-resume (Contain complexity) | phase review 2.2 2026-10-24 | open |
