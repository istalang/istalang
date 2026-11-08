---
description: plan for implementing identity, variance and constraint-based inference (design.md) — process, five phases with falsifiable acceptance, order under the 3-parallel cap, shared surfaces and owners, diagnostic ranges, verification per phase; read before forking or examining a variance-inference phase
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-08
last_updated: 2026-11-08
tags: [plan, checker, inference, variance, f25]
---

# Identity, variance and inference — plan

Design and decisions: `design.md`. Spec: `docs/spec.md`.

## Process

**Five phases, at most three at a time, each with an implementer fork and a cold Claude reviewer;
qa on every behavioural phase; a merge review at the end.** *Why:* the work is core and has high
fan-in (fitting, inference, lowering), so review depth is high. It splits cleanly at two seams,
identity and variance, so the longest phase (I1) starts at once, beside the contract it later
consumes.

- **Merging:** forks rebase and fast-forward `main` once their reviewer approves. After V1 and I1
  have both landed, the tech-lead runs an e2e `qa`, since covariance-dependent behaviour exists
  only once both are in.
- **Each behavioural phase** profiles `fb-warm` and `std-tests` (`npm run profile:check`) against
  its base.
- **Each phase** edits the spec sections it changes (`design.md` §8), the docs it touches, and its
  tracker rows.

## Phases

| Phase | Scope | Accept |
|---|---|---|
| **V0** Identity (structural) | `extern shared/sendable/ephemeral struct` on the syntax tree, parser, formatter, grammar and VS Code grammar. One `identityOf` read off declarations, used by `sendable.ts`, `rules/testing.ts` and lowering's extern roles. Prelude and std re-spelled per `design.md` §1 | Suite and corpus unchanged. No handle is recognised by name. A disposable extern with no handle kind is an error |
| **I0** Optional join (behavioural, small) | One `commonType` for agreement (`rules/agreement.ts`): literal into its base, `T` with `None` into `T?`. Spec §2, §4 | `if c: 1 else: none` is `Int?`; `[1, none]` is `Array<Int?>`; `if c: 1 else: "a"` stays an error |
| **I1** Constraint inference per call (behavioural) | A joint-capable constraint system in `types/inference/`: bounds from arguments and the expected type, decomposed by `varianceOf` (stubbed invariant until V1 lands); the settling policy; fresh literals; postponed arguments; the "most specific" rank, which replaces the clash between a type and a union holding it. Delete `known-parameters.ts`, the variant expected-type helpers, conformance's expected step and the ordering in `function-arguments.ts`. Spec §3.5, §3.11, §3.14 | `design.md` §9 rows that need neither covariance nor joint solving (the three `map` examples, `pick` as `Status`, `biggest`, `fields.get`, `pairWith`, the variants, `show`). `fn f(x: Int)` and `fn f(x: Int?)` coexist, and `f(1)` takes the first. A property: a call that checks without an expected type checks to the same instantiation with its own result type expected. No corpus diagnostic moves |
| **V1** Variance and conversions inside types (behavioural) | `varianceOf`, derived (fixpoint) and written (`gives`/`takes` with their checks; an error on handles until F27), traits' through `any` by C#'s rule. Witnesses keep `self` exact. `fitOf` composing through variance. Nested fits recorded; lowering rebuilding where the representation changes. Spec §2, §3.1, §3.5 (variance), §3.6, §3.8, §3.18 | `Array<Int>` into `Array<Int?>` checks and runs, and its value persists and round-trips through JSON. `Slot<Int>` into `Slot<Int?>` is 5001. `Inbox<T>` is invariant. A struct with an `fn(T)` field is contravariant. An assertion contradicting the derived variance is an error. `any Source<Int>` fits `any Source<Int?>`, and `any Sink<Int>` doesn't. `Array<Int>` meets no trait through a function for `Array<Int?>`. `Json` and `Tree` pinned |
| **I2** Joint solving (structural, then behavioural) | 1. Delete §3.7 literal building, which is behaviour-neutral once V1 converts. 2. Pending node types in `BodyContext`'s records, behaviour-neutral. 3. Nested generic calls and literals join the outermost expression's system | `items([Item{value: "s"}])` as `Options<"s" \| "m">`; `items([Item{value: Small}])`; a lambda inside a nested generic call. No `builds` remains. Profile within noise |

**Order:** {V0 ∥ I0 ∥ I1} → V1 when V0 lands (beside I1) → I2 when V1 and I1 land → merge review.
*Why:* V1 needs V0's identity. I1 is the longest and needs only V1's contract, which it stubs. I2
needs V1's conversions (to delete literal building) and I1's system. I1 and V1 meet only at
`varianceOf` and `fitOf`, so they run in parallel and skip e2e until both have merged.

## Shared surfaces and owners

| Surface | Owner | Consumers |
|---|---|---|
| Extern handle kind (syntax tree), `identityOf` | V0 | V1, lowering, `sendable.ts`, `rules/testing.ts` |
| `varianceOf(declaration) → readonly ('covariant' \| 'contravariant' \| 'invariant')[]`, one per type parameter, memoized per declaration, on the `Fitting` seam | V1 | I1 (stub: all invariant), I2 |
| `fitOf` composing through variance; nested fits recorded for lowering | V1 | I1, I2 |
| `commonType` | I0 | I1 (settling rule 3) |
| Constraint system API: variables, bounds, settle, join a nested system | I1 | I2 |
| `BodyContext` records holding pending types | I2 | — |

A contract amendment goes to the tech-lead, who decides and tells the affected phases.

**Diagnostic ranges:**

| Phase | Parser | Checker |
|---|---|---|
| V0 | 2300–2309 | 5250–5259 |
| V1 | 2310–2319 | 5260–5289 |
| I0 | — | 5290–5299 |
| I1 | — | 5320–5349 |
| I2 | — | 5350–5369 |

## Verification

| Phase | qa | reviewer | Notes |
|---|---|---|---|
| V0 | no | yes | Behaviour-neutral. Covered by the existing suite: std modules' check, the sendability, boundary and testing-rule tests, the run corpus, formatter idempotence, `test/vscode-grammar.test.ts` |
| I0 | yes | yes | — |
| I1 | yes | yes | e2e for covariance-dependent rows deferred to the post-V1 qa |
| V1 | yes | yes | Persistence and JSON round-trips of converted values |
| I2 | yes | yes | Profile |
| Merge | — | yes | The whole branch against main since V0's base |

Out of scope, filed: F26 (`each`), F27 (view handles), F28 (proposal 8's qualifiers as subtyping).
