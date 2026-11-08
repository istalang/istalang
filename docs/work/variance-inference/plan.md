---
description: plan for implementing identity, variance and constraint-based inference (design.md) — process, six phases with falsifiable acceptance, order under the 3-parallel cap, shared surfaces and owners, diagnostic ranges, verification per phase, relation to proposal 8; read before forking or examining a variance-inference phase
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

**Six phases, each an implementer fork in its own worktree, with a pi reviewer; qa on every
behavioural phase; a merge review at the end.** *Why:* the work is core and has high fan-in
(fitting, inference, lowering), so review depth is high. It splits at two seams, identity and
variance, so the longest phase (I1) starts at once, beside the contract it later consumes.

- **Examiners:** V0's fork spawns the root pi reviewer, and the first behavioural phase the root
  qa; every later phase forks them. A fork reports to the tech-lead only once the human approves.
- **Merging:** forks rebase and fast-forward `main` once their reviewer approves.
- **Each behavioural phase** profiles `fb-warm` and `std-tests` (`npm run profile:check`) against
  its base.
- **Each phase** edits the spec sections it changes (`design.md` §8), the docs it touches
  (`architecture.md`'s checker tree included), and its tracker rows. Its acceptance names every
  fixture and corpus diagnostic it is expected to move; nothing else moves.

## Phases

| Phase | Scope | Accept |
|---|---|---|
| **V0** Identity (structural) | `extern shared/sendable/ephemeral struct` on the syntax tree, parser, formatter, grammar and VS Code grammar. `identityOf` (`design.md` §1) and every reader it lists. Prelude, std, fixtures and spec §12.1 respelled | No handle is recognised by name or by the `'shared'` role. A disposable extern with no handle kind is an error. Moves: only the respelled disposable externs (`Sent`, `Lease`, `Queue`, `Handle`, `Connection`, `_Call`) |
| **I0** Optional join (behavioural, small) | `commonType` (contract below) for agreement (`rules/agreement.ts`): literal into its base, `T` with `None` into `T?`. A spread is copied or iterated once the items' type is agreed. Spec §2, §4 | `if c: 1 else: none` is `Int?`; `[1, none]` is `Array<Int?>`; `[...xs, none]` runs with `xs`'s items wrapped; `if c: 1 else: "a"` stays an error |
| **I1** Constraint inference per call (behavioural) | The constraint system in `types/inference/` (`design.md` §4): `constrain(sub, sup)`, bounds decomposed by `varianceOf`, the receiver binding exactly, bounds propagating between variables, the settling policy, fresh literals, postponed arguments, the one-way "most specific" rank. Delete conformance's expected step and the ordering in `function-arguments.ts`. Variant calls keep `known-parameters.ts` until I2. Spec §3.5, §3.7, §3.14 | `design.md` §9 rows that need neither covariance, joint solving nor variant calls (the three `map` examples, `pick` as `Status`, `biggest`, `sorted`, `fields.get`, `pairWith`, `show`, `xs.includes(none)`). `fn f(x: Int)` and `fn f(x: Int?)` coexist, and `f(1)` takes the first. A property: a call that checks without an expected type checks to the same instantiation with its own result type expected. Moves: the 5105s in `test/corpus/unions/invalid-uses.ista`, the clash rows in `clashes.test.ts` |
| **V1** Variance and conversions inside types (behavioural) | `varianceOf` derived (four-point fixpoint; computed positions and member type parameters invariant) and written (`gives`/`takes` with their checks; an error on handles until F27). `fitOf` composing through variance, recursive types under a cycle guard, the one-element tuple only at the top. A nested fit records only from and to; lowering derives each rebuild per concrete pair as one synthesized function; `forms.ts` follows. Runtime equality and hashing by declaration, other type-id readers audited. Spec §2, §3.1, §3.5 (variance), §3.6, §3.8, §3.18 | `Array<Int>` into `Array<Int?>` checks and runs, persists and round-trips through JSON. `design.md` §9's `Slot`, `Map`, tuple and `Box` equality rows. `Inbox<T>` is invariant. A struct with an `fn(T)` field is contravariant. An assertion contradicting the derived variance is an error. `Json` and `Tree` pinned, and converted. Moves: the nested 5001s in `test/corpus/unions/invalid-conversions.ista`, `arguments/invalid-async-fits.test.ista`, `shapes/invalid-conversion.ista` |
| **V2** Variance through `any` (behavioural) | Traits' variance (`design.md` §2), meeting `any Trait<B>` through a fitting `Trait<A>`, dispatch and field reads converting, downcasts admitting. Spec §3.10 | `design.md` §9's `any Source` and `any Sink` rows. `Array<Int>` meets no trait through a function for `Array<Int?>` |
| **I2** Joint solving (structural, then behavioural) | 1. Every per-call and per-literal record pending until the outermost system settles, written by one pass; behaviour-neutral. 2. Nested generic calls and literals join the outermost system; literals with no type of their own take the expected type (`design.md` §4); variants become ordinary generic calls, spreads and `Options.Empty` included; delete `known-parameters.ts` and the variant helpers. 3. Delete §3.7 literal building once nothing reads it | `items([Item{value: "s"}])` as `Options<"s" \| "m">`; `items([Item{value: Small}])`; a lambda inside a nested generic call; `design.md` §9's variant rows. `variants.test.ts`, `recursive-uses.test.ts`, `literal-arguments.test.ts` unchanged. No `builds` remains. Profile within noise |

**Order:** {V0 ∥ I0} → V1 once V0 lands → I1 once V1 and I0 land → I2 once I1 lands, V2 once
V1 lands → merge review. A phase starts only on landed code, never on a contract, and beside a running one
only when their branches won't conflict. *Why:* least total work over the fastest finish. V0 and
I0 lay the bases (identity, `commonType`) and touch disjoint files. I1 consumes V1's
`varianceOf` (V0 shipped no stub). I2 needs V1's conversions and I1's system; V2 needs V1's
variance.

**Proposal 8** follows V1: its conversions become subtyping (F28 folds into its plan), its `K`
default becomes a settling rule, and its `Persistable` reads V0's reach. Its runtime is
independent of this plan and may run beside I2.

## Shared surfaces and owners

| Surface | Owner | Consumers |
|---|---|---|
| Extern handle kind (syntax tree), `identityOf` in the `types` layer | V0 | V1, lowering, `sendable.ts`, `testing.ts`, `json-forms.ts`, `disposal.ts` |
| `types/variance/variance.ts`: `type Variance = 'covariant' \| 'contravariant' \| 'invariant'`; `varianceOf(declaration: NominalDeclaration \| TypeAliasDeclaration \| TraitDeclaration): readonly Variance[]`, one per type parameter, memoized per declaration | V1 creates it; V2 adds the traits' | I1, I2 |
| `types/fitting/fit.ts`: composition through variance; a nested fit recorded as from and to | V1 | I1, I2, lowering, `forms.ts` |
| `types/unions/common-type.ts`: `commonType(types: readonly Type[]): Type \| undefined` | I0 | I1 (settling rule 3), `agreement.ts` |
| `types/inference/`: the constraint system (variables, `constrain`, settle, join a nested system) | I1 | I2 |
| `BodyContext` records pending until settled | I2 | — |

A contract amendment goes to the tech-lead, who decides and tells the affected phases.

**Diagnostic ranges:**

| Phase | Parser | Checker |
|---|---|---|
| V0 | 2300–2309 | 5250–5259 |
| V1 | 2310–2319 | 5260–5289 |
| I0 | — | 5290–5299 |
| I1 | — | 5320–5349 |
| I2 | — | 5350–5369 |
| V2 | — | 5370–5379 |

## Verification

| Phase | qa | reviewer | Notes |
|---|---|---|---|
| V0 | no | yes | Behaviour-neutral but for the respelled externs. Covered by the existing suite: std modules' check, the sendability, boundary, disposal and testing-rule tests, the run corpus, snapshot validation, formatter idempotence, `test/vscode-grammar.test.ts` |
| I0 | yes | yes | — |
| I1 | yes | yes | Covariance-dependent rows included, since V1 has landed |
| V1 | yes | yes | Persistence, JSON round-trips and equality of converted values |
| V2 | yes | yes | — |
| I2 | yes | yes | Profile |
| Merge | — | yes | The whole branch against main since V0's base |

Out of scope, filed: F26 (`each`), F27 (view handles), F28 (proposal 8's qualifiers as subtyping).
