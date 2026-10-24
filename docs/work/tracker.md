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
up, so the next one is D44.

| # | Item | Source | Status |
| --- | --- | --- | --- |
| D27 | Project root ignores `ista.json`: spec §3.13 makes the directory holding `ista.json` the root, with the working directory only as a fallback, but `cli/project.ts` always uses the working directory. Implement it with `ista.json` in M8. | phase review M2.1 2026-10-24 | open |
| D33 | The build emits declarations for every `src` module (tsc) but JavaScript only for modules reachable from `cli/main.ts` (tsdown entry). `compiler/syntax/tree.ts`, for example, ships `isNode` and `childrenOf` in `.d.ts` with no `.js`. When the subpath exports (`istalang/compiler`, …) land, add each one as a tsdown entry, and test that every exported `.d.ts` has its `.js`. | phase review M2.1 2026-10-24 | open |
| D34 | Snapshot↔Definition validation has no owner: `snapshot.ts` defers pc ranges, frame register bounds, function/type ids, top-frame pc on an `await`/`select`, and `resource` types being extern to "the runtime's load", which no phase scopes. Own it in 2.5 beside version refusal, so a snapshot from another Definition is refused at load, not mid-resume (Contain complexity) | phase review 2.2 2026-10-24 | open |
| D38 | Top-level constants (§3: `const` values computable at compile time) have no owner. The checker reports every one as not supported yet. Supporting them means checking that an initializer is computable at compile time (literals, and structs, arrays and maps built from them) and lowering each to a Definition constant. M3.2 (values) is the natural owner. | phase 2.4 2026-10-24 | open |
| D41 | Which extern types the runtime disposes is a list of qualified names in `lowering/tables.ts` (`runtimeDisposed`: `prelude.Future`, `prelude.Slot`). The runtime's disposal code will be a second home for the same fact, and `Shared<Lease>`-style `function` disposal (definition.md) has no path. When the disposal slice (§7) lands, derive each extern type's disposal from its declaration (an annotation or trait in `prelude.ista`), so lowering and the runtime read one source. | phase review 2.4 2026-10-24 | open |
| D42 | `stdlib/prelude/natives.ts` holds helpers every std module's natives will need (`key` over `externKey`, the `int`/`float`/`text` value guards, `divisor`, `sign`). M4 builds the std modules ∥ by module group, so each would copy them. Move them to one shared kit under `stdlib/` at the first second natives table, before M4 forks. | phase review 2.4 2026-10-24 | open |
| D43 | The context classes hold every construct's state while the rules sit in the construct modules: `BodyChecker` owns variables (`#variables`, `#reassigned`, `#warnUnreassigned`), returns (`#returned`, `#declaredResult`, `#inferredResult`) and loops; `FunctionLowering` owns label patching (`#placed`, `#patches`, `#refer`), loops and variables. Every M3 slice (2–5, ∥) will add fields and methods to these two classes and to `context.ts`, making them the shared hotspot the expressions split just removed. Before M3 forks: give them one owner, and have each class compose per-concern units that live beside their rules (`statements/variables.ts` owning a `VariableScope`; a `ReturnTracker`; lowering `labels.ts`), so a slice adds a unit instead of editing the class. | phase review 2.4 2026-10-24 | open |
