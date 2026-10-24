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
up, so the next one is D57.

| # | Item | Source | Status |
| --- | --- | --- | --- |
| D27 | Project root ignores `ista.json`: spec §3.13 makes the directory holding `ista.json` the root, with the working directory only as a fallback, but `cli/project.ts` always uses the working directory. Implement it with `ista.json` in M8. | phase review M2.1 2026-10-24 | open |
| D33 | No type declarations ship: the package's only entry is the `ista` executable, and tsc emitted declarations for modules with no JavaScript. When the first subpath export (`istalang/compiler`, `istalang/runtime`, …) lands, make each one a tsdown entry with declarations for exactly what it exports, and test that every export has both its `.js` and its `.d.ts`. Owner: the host API (M3.9). | phase review M2.1 2026-10-24 | open |
| D38 | Top-level constants (§3: `const` values computable at compile time) have no owner. The checker reports every one as not supported yet. Supporting them means checking that an initializer is computable at compile time (literals, and structs, arrays and maps built from them) and lowering each to a Definition constant. M3.2 (values) is the natural owner. | phase 2.4 2026-10-24 | open |
| D41 | Which extern types the runtime disposes is a list of qualified names in `lowering/tables.ts` (`runtimeDisposed`: `prelude.Future`, `prelude.Slot`). The runtime's disposal code will be a second home for the same fact, and `Shared<Lease>`-style `function` disposal (definition.md) has no path. When the disposal slice (§7) lands, derive each extern type's disposal from its declaration (an annotation or trait in `prelude.ista`), so lowering and the runtime read one source. | phase review 2.4 2026-10-24 | open |
| D44 | The scheduler favours obviousness over speed: `Instance.callFutureOf` and `resolve` scan the whole heap on every async return and await, `#add` takes the max id each allocation, and every segment restores from the committed snapshot's text. Fine for skeleton-sized instances; measure once M3.6 (concurrency) gives instances many executions, then index what profiling shows (derived maps rebuilt on restore, never persisted). | phase 2.5 2026-10-25 | open |
| D45 | The "a future is only awaited or returned" frontier (`checker/rules/futures.ts`, `refuseHeldFuture`) is called from five sites: `declarations/signatures.ts` (parameters, fields), `statements/statements.ts` (`While` body tail, `checkBlock` non-last statements), `statements/variables.ts` (initializers). The slice that makes futures values and adds disposal (§7, M3) must remove all five; until then every new place a value is held or discarded (`for`, `match` arms, `if` as statement, closures) must add a sixth (Contain complexity). | phase review 2.5 2026-10-25 | open |
| D49 | `rules/futures.ts` reports a discarded future (a non-last block statement) as not supported yet (5000), and its banner says the disposal slice removes those reports. Spec §3.3 makes a bare unused future a compile error, so when futures become values (D45) the statement-position check must become that error, not disappear with the other reports. | phase review 2.5 2026-10-25 | open |
