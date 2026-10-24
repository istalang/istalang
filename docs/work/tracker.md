---
description: status of toolchain milestones and filed debt/out-of-scope items — read to know what is done, in flight, or deferred
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-24
last_updated: 2026-10-25
tags: [tracker]
---

# Tracker

## Milestones (plan: `docs/work/toolchain-v0.1/plan.md`)

| Milestone | Status |
| --- | --- |
| M1 Syntax | done |
| M2 Skeleton | done |
| M3 Feature slices | planned |
| M4 Standard library | planned |
| M5 Test runner | planned |
| M6 Formatter | planned |
| M7 Language service and LSP | planned |
| M8 Packages | planned |

## Filed

Open items only: an item is removed once it is resolved; git history keeps it. Ids keep counting
up, so the next one is D67.

| # | Item | Source | Status |
| --- | --- | --- | --- |
| D27 | Project root ignores `ista.json`: spec §3.13 makes the directory holding `ista.json` the root, with the working directory only as a fallback, but `cli/project.ts` always uses the working directory. Implement it with `ista.json` in M8. | phase review M2.1 2026-10-24 | open |
| D33 | No type declarations ship: the package's only entry is the `ista` executable, and tsc emitted declarations for modules with no JavaScript. When the first subpath export (`istalang/compiler`, `istalang/runtime`, …) lands, make each one a tsdown entry with declarations for exactly what it exports, and test that every export has both its `.js` and its `.d.ts`. Owner: the host API (M3.9). | phase review M2.1 2026-10-24 | open |
| D44 | The scheduler favours obviousness over speed: `Instance.callFutureOf` and `resolve` scan the whole heap on every async return and await, `#add` takes the max id each allocation, and every segment restores from the committed snapshot's text. Fine for skeleton-sized instances; measure once M3.6 (concurrency) gives instances many executions, then index what profiling shows (derived maps rebuilt on restore, never persisted). | phase 2.5 2026-10-25 | open |
| D58 | Composite constants live in the Definition's constant pool, shared by every instance of a runtime, so values must stay immutable (definition.md, "Values"). When `store` and `setIndex` run (3.2), they must build the new value along their path, and 3.2's value-semantics acceptance must include changing a copy of a top-level constant. Owner: 3.2. | phase review M2-debt 2026-10-25 | open |
| D59 | The prelude's `dispose` overloads (`Future`, `Slot`) are ordinary callable functions: once 3.1 lifts the generic-call frontier, `dispose(slot)` checks clean and lowers to an extern no native implements, so deploy refuses it (a totality break), and §7 forbids making a disposed value observable. Refuse calling `dispose` directly. Whether a host type may be disposable at all, through its extern's native (`function` disposal) or not (§7: what the host provides is owned by the host), is decided with the host boundary; today only a std module's extern `dispose` counts. Owner: 3.7, with 3.9 for host types. | phase review M2-debt 2026-10-25 | open |
