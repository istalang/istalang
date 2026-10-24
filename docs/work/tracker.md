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
| M1 Syntax | planned |
| M2 Skeleton | planned |
| M3 Feature slices | planned |
| M4 Standard library | planned |
| M5 Test runner | planned |
| M6 Formatter | planned |
| M7 Language service and LSP | planned |
| M8 Packages | planned |

## Filed

Open items only: an item is removed once it is resolved; git history keeps it. Ids keep counting
up, so the next one is D27.

| # | Item | Source | Status |
| --- | --- | --- | --- |
| D23 | BOM is handled inside the core (scanner skips it, `Parser.columnOf` subtracts it on line 0, scan test-kit tolerates it). Editors never send a BOM over LSP, so strip it once at the `SourceHost` edge in M2 and delete the in-core cases (Step back: reformulate, don't branch) | merge review M1 2026-10-24 | open |
