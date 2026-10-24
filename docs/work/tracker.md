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
up, so the next one is D76.

| # | Item | Source | Status |
| --- | --- | --- | --- |
| D27 | Project root ignores `ista.json`: spec §3.13 makes the directory holding `ista.json` the root, with the working directory only as a fallback, but `cli/project.ts` always uses the working directory. Implement it with `ista.json` in M8. | phase review M2.1 2026-10-24 | open |
| D33 | No type declarations ship: the package's only entry is the `ista` executable, and tsc emitted declarations for modules with no JavaScript. When the first subpath export (`istalang/compiler`, `istalang/runtime`, …) lands, make each one a tsdown entry with declarations for exactly what it exports, and test that every export has both its `.js` and its `.d.ts`. Owner: the host API (M3.9). | phase review M2.1 2026-10-24 | open |
| D44 | The scheduler favours obviousness over speed: `Instance.callFutureOf` and `resolve` scan the whole heap on every async return and await, `#add` takes the max id each allocation, and every segment restores from the committed snapshot's text. Fine for skeleton-sized instances; measure once M3.6 (concurrency) gives instances many executions, then index what profiling shows (derived maps rebuilt on restore, never persisted). | phase 2.5 2026-10-25 | open |
| D59 | Whether a host type may be disposable at all, through its extern's native (`function` disposal) or not (§7: what the host provides is owned by the host), is decided with the host boundary; today only a std module's extern `dispose` counts. Calling `dispose` directly is refused (3.1). Owner: 3.7, with 3.9 for host types. | phase review M2-debt 2026-10-25 | open |
| D67 | Rest parameters and spread arguments (spec §3.3) stay behind the checker's frontier: the human deferred them from 3.1 to keep 3.1 off arrays. They need the overload rule "fixed arity beats rest", a caller building an `array` (definition.md), and `...xs` spreading into it. Owner: unassigned (after 3.3, which owns arrays). | slice 3.1 2026-10-25 | open |
| D68 | A requirement with type parameters of its own is met by a function generic the same way (spec §3.10), but constraints on those type parameters carry no witnesses: an instance of the requirement's witness can't call what they require. Nothing in the spec or the prelude declares one. | slice 3.1 2026-10-25 | open |
| D69 | Three identity-key schemes for one job: `typeKey` (checker/types/type.ts) and `declarationKey` (lowering/instances.ts) each keep a module-global WeakMap counter, beside `DefinitionTables.#typeKey`; `rules/clashes.ts` then renames type parameters by `replaceAll` over key strings and keys static owners as `name@offset`. One structural key (parameters substituted to canonical ones, entities by identity), owned per checker, with no module-global mutable counters.  3.2 compounded it: the `anonymous` type kind was added to both `typeKey` (checker/types/type.ts) and `DefinitionTables.#typeKey`, the double edit every new type kind now costs. | phase review 3.1 2026-10-25 | open |
| D70 | DRY in 3.1's call paths: a literal's known type arguments (the written ones, else the expected type's) are computed twice (structs.ts `knownArguments`, variants.ts `checkVariantLiteral`), though literal-fields.ts is the one path both build through. `entity as NominalType['entity']` is cast in four places, and `isSendableTrait` reads a trait through `wellKnownType` as a fake nominal type, with a fallback by name. | phase review 3.1 2026-10-25 | open |
| D71 | `rules/expansion.ts` records "checked once" in a module-level `WeakSet<CheckerContext>` instead of a ProgramChecker unit. The first `diagnosticsOf` of any module checks the body of every generic function in the program, which breaks the lazy contract (architecture: the LSP pays only for what it asks). | phase review 3.1 2026-10-25 | open |
| D72 | `BodyContext.fit(found, expected, at: Expression | Span)` changes behavior by the runtime shape of `at`: given a Span, it reports a value that fits by the implicit wrap as a mismatch. Split it into a node form (which records the wrap) and a span form, or make every fit site pass its node. Also, the witness search bound `maximumDepth = 16` (traits/conformance.ts) reports a too-deep search as "doesn't satisfy: it needs 'f'", which names the wrong cause. | phase review 3.1 2026-10-25 | open |
| D73 | 3.1's engines have no colocated tests: inference/, overloads/, traits/, rules/expansion.ts (a hand-rolled Tarjan), rules/clashes.ts and types/fit.ts are exercised only through 14 corpus files. Add table and property tests beside them, at least that inference doesn't depend on argument order, that a clash is symmetric, and that expansion reports exactly the cycles holding an expanding edge. | phase review 3.1 2026-10-25 | open |
| D74 | A cell is made by the first write into an empty register (docs/arch/definition.md, "Frames"), so a `let` declared in a loop body and passed by `&` keeps one cell across iterations until a block-end `release` empties its register; spec §3.4 makes each iteration's variable fresh. Nothing in 3.2 observes it (a reference lives only through an awaited call), but a closure capturing such a `let` (3.5, whose acceptance includes §3.14's fresh-per-iteration sharing rule) or a future held across iterations (3.6) would. Human decision (3.2): fixed by 3.7's `release`, which must empty cell registers, with a corpus case of closures or references made in a loop. The slice order (3.5 before 3.7) is the tech-lead's to reconcile. Owner: 3.7. | phase review M3.2 2026-10-25 | open |
