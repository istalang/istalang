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
| M2 Skeleton | planned |
| M3 Feature slices | planned |
| M4 Standard library | planned |
| M5 Test runner | planned |
| M6 Formatter | planned |
| M7 Language service and LSP | planned |
| M8 Packages | planned |

## Filed

Open items only: an item is removed once it is resolved; git history keeps it. Ids keep counting
up, so the next one is D50.

| # | Item | Source | Status |
| --- | --- | --- | --- |
| D27 | Project root ignores `ista.json`: spec §3.13 makes the directory holding `ista.json` the root, with the working directory only as a fallback, but `cli/project.ts` always uses the working directory. Implement it with `ista.json` in M8. | phase review M2.1 2026-10-24 | open |
| D33 | The build emits declarations for every `src` module (tsc) but JavaScript only for modules reachable from `cli/main.ts` (tsdown entry). `compiler/syntax/tree.ts`, for example, ships `isNode` and `childrenOf` in `.d.ts` with no `.js`. When the subpath exports (`istalang/compiler`, …) land, add each one as a tsdown entry, and test that every exported `.d.ts` has its `.js`. | phase review M2.1 2026-10-24 | open |
| D38 | Top-level constants (§3: `const` values computable at compile time) have no owner. The checker reports every one as not supported yet. Supporting them means checking that an initializer is computable at compile time (literals, and structs, arrays and maps built from them) and lowering each to a Definition constant. M3.2 (values) is the natural owner. | phase 2.4 2026-10-24 | open |
| D41 | Which extern types the runtime disposes is a list of qualified names in `lowering/tables.ts` (`runtimeDisposed`: `prelude.Future`, `prelude.Slot`). The runtime's disposal code will be a second home for the same fact, and `Shared<Lease>`-style `function` disposal (definition.md) has no path. When the disposal slice (§7) lands, derive each extern type's disposal from its declaration (an annotation or trait in `prelude.ista`), so lowering and the runtime read one source. | phase review 2.4 2026-10-24 | open |
| D43 | The context classes hold every construct's state while the rules sit in the construct modules: `BodyChecker` owns variables (`#variables`, `#reassigned`, `#warnUnreassigned`), returns (`#returned`, `#declaredResult`, `#inferredResult`) and loops; `FunctionLowering` owns label patching (`#placed`, `#patches`, `#refer`), loops and variables. Every M3 slice (2–5, ∥) will add fields and methods to these two classes and to `context.ts`, making them the shared hotspot the expressions split just removed. Before M3 forks: give them one owner, and have each class compose per-concern units that live beside their rules (`statements/variables.ts` owning a `VariableScope`; a `ReturnTracker`; lowering `labels.ts`), so a slice adds a unit instead of editing the class. | phase review 2.4 2026-10-24 | open |
| D44 | The scheduler favours obviousness over speed: `Instance.callFutureOf` and `resolve` scan the whole heap on every async return and await, `#add` takes the max id each allocation, and every segment restores from the committed snapshot's text. Fine for skeleton-sized instances; measure once M3.6 (concurrency) gives instances many executions, then index what profiling shows (derived maps rebuilt on restore, never persisted). | phase 2.5 2026-10-25 | open |
| D45 | The "a future is only awaited or returned" frontier (`checker/rules/futures.ts`, `refuseHeldFuture`) is called from five sites: `declarations/signatures.ts` (parameters, fields), `statements/statements.ts` (`While` body tail, `checkBlock` non-last statements), `statements/variables.ts` (initializers). The slice that makes futures values and adds disposal (§7, M3) must remove all five; until then every new place a value is held or discarded (`for`, `match` arms, `if` as statement, closures) must add a sixth (Contain complexity). | phase review 2.5 2026-10-25 | open |
| D46 | The host's wait-then-wake loop exists twice: `runtime/runtime.test-kit.ts` `runToEnd` (manual clock) and `cli/commands/run.ts` `finish` (real sleep), each with its own "waits on nothing that can wake it" branch; the CLI also reads `Date.now` in two places (the `now` seam and the sleep). One driver taking how to wait until a time, and one clock in the CLI (DRY). | phase review 2.5 2026-10-25 | open |
| D47 | "How an instance ended" has three shapes: `SegmentEnd` (scheduler/segment.ts), `Snapshot['status']` (`finished` carries `outcome`) and `InstanceState` (`finished` carries `value`). `advance` returns a `SegmentEnd` as an `InstanceState` by structural coincidence, `statusOf` and `stateOf` convert between the other two, and `Instance.snapshot(status)` accepts a panicked status but would drop its objects, while wake.ts's panic path keeps them. One shape for the host-facing state, derived once from the stored status; narrow `snapshot()` to the statuses it builds (No double standards, Make illegal states unrepresentable). | phase review 2.5 2026-10-25 | open |
| D48 | `crashEveryAwait` is a runtime-wide seam (`RuntimeSeams.crashEveryAwait`), but spec §10 makes it an argument of each `testing.start`, and it isn't persisted, so a fresh runtime on the same store silently drops it. The M5 test runner needs it per instance: make it an option of `start` recorded in the snapshot, so `wake` honours it after a restart. | phase review 2.5 2026-10-25 | open |
| D49 | `rules/futures.ts` reports a discarded future (a non-last block statement) as not supported yet (5000), and its banner says the disposal slice removes those reports. Spec §3.3 makes a bare unused future a compile error, so when futures become values (D45) the statement-position check must become that error, not disappear with the other reports. | phase review 2.5 2026-10-25 | open |
