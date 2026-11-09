---
description: plan for implementing identity, variance and constraint-based inference (design.md) — process, six phases and five corrections after the merge review and form-builder's trial, with falsifiable acceptance, order under the 3-parallel cap, shared surfaces and owners, diagnostic ranges, verification per phase, relation to proposal 8; read before forking or examining a variance-inference phase
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-08
last_updated: 2026-11-09
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
- **Corrections:** the merge review asked for changes. `merge-analysis.md` holds its findings
  (M1–M6, B37–B46), their root causes and the structural changes S1–S6 that C1–C3 make. C4 follows form-builder's trial of
  what can go unwritten; C5 cuts the cost its unannotated forms expose.
- **Each phase** edits the spec sections it changes (`design.md` §8), the docs it touches
  (`architecture.md`'s checker tree included), and its tracker rows. Its acceptance names every
  fixture and corpus diagnostic it is expected to move; nothing else moves.

## Phases

| Phase | Scope | Accept |
|---|---|---|
| **V0** Identity (structural) | `extern shared/sendable/ephemeral struct` on the syntax tree, parser, formatter, grammar and VS Code grammar. `identityOf` (`design.md` §1) and every reader it lists. Prelude, std, fixtures and spec §12.1 respelled | No handle is recognised by name or by the `'shared'` role. A disposable extern with no handle kind is an error. Moves: only the respelled disposable externs (`Sent`, `Lease`, `Queue`, `Handle`, `Connection`, `_Call`) |
| **I0** Optional join (behavioural, small) | `commonType` (contract below) for agreement (`rules/agreement.ts`): literal into its base, `T` with `None` into `T?`. A spread is copied or iterated once the items' type is agreed. Spec §2, §4 | `if c: 1 else: none` is `Int?`; `[1, none]` is `Array<Int?>`; `[...xs, none]` runs with `xs`'s items wrapped; `if c: 1 else: "a"` stays an error |
| **I1** Constraint inference per call (behavioural) | The constraint system in `types/inference/` (`design.md` §4): `constrain(sub, sup)`, bounds decomposed by `varianceOf`, the receiver binding exactly, bounds propagating between variables, the settling policy, fresh literals, postponed arguments, the one-way "most specific" rank. Delete conformance's expected step and the ordering in `function-arguments.ts`. Variant calls keep `known-parameters.ts` until I2. Spec §3.5, §3.7, §3.14 | `design.md` §9 rows that need neither covariance, joint solving nor variant calls (the three `map` examples, `pick` as `Status`, `biggest`, `sorted`, `fields.get`, `pairWith`, `show`, `xs.includes(none)`). `fn f(x: Int)` and `fn f(x: Int?)` coexist, and `f(1)` takes the first. A called function value gives its parameter types to its arguments: `(h.f)(Phantom{n: 31})` for `h.f: fn(Phantom<Int>)`. A property: a call that checks without an expected type checks to the same instantiation with its own result type expected. Moves: the 5105s in `test/corpus/unions/invalid-uses.ista`, the clash rows in `clashes.test.ts` |
| **V1** Variance and conversions inside types (behavioural) | `varianceOf` derived (four-point fixpoint; computed positions and member type parameters invariant) and written (`gives`/`takes` with their checks; an error on handles until F27). `fitOf` composing through variance, recursive types under a cycle guard, the one-element tuple only at the top. A nested fit records only from and to; lowering derives each rebuild per concrete pair as one synthesized function; `forms.ts` follows. Runtime equality and hashing by declaration, other type-id readers audited. Spec §2, §3.1, §3.5 (variance), §3.6, §3.8, §3.18 | `Array<Int>` into `Array<Int?>` checks and runs, persists and round-trips through JSON. `design.md` §9's `Slot`, `Map`, tuple and `Box` equality rows. `Inbox<T>` is invariant. A struct with an `fn(T)` field is contravariant. An assertion contradicting the derived variance is an error. `Json` and `Tree` pinned, and converted. Moves: the nested 5001s in `test/corpus/unions/invalid-conversions.ista`, `arguments/invalid-async-fits.test.ista`, `shapes/invalid-conversion.ista` |
| **V2** Variance through `any` (behavioural) | Traits' variance (`design.md` §2), meeting `any Trait<B>` through a fitting `Trait<A>`, dispatch and field reads converting, downcasts admitting. Spec §3.10 | `design.md` §9's `any Source` and `any Sink` rows. `Array<Int>` meets no trait through a function for `Array<Int?>` |
| **I2** Joint solving (structural, then behavioural) | Redesigned as J1, J2 in `i2-plan.md`. 1. Every per-call and per-literal record pending until the outermost system settles, written by one pass; behaviour-neutral. 2. Nested generic calls and literals join the outermost system; literals with no type of their own take the expected type (`design.md` §4); variants become ordinary generic calls, spreads and `Options.Empty` included; delete `known-parameters.ts` and the variant helpers. 3. Delete §3.7 literal building once nothing reads it | `items([Item{value: "s"}])` as `Options<"s" \| "m">`; `items([Item{value: Small}])`; a lambda inside a nested generic call; `design.md` §9's variant rows. `variants.test.ts`, `recursive-uses.test.ts`, `literal-arguments.test.ts` unchanged. No `builds` remains. Profile within noise |
| **C1** Scope protocol (structural, then behavioural) | 1. S1: one typed table in the body's scopes says what joins, what is a boundary, and that a field-loop pass opens its own scope, settled before the pass exits; handlers stop calling `suspended()`; `ConstraintScope` moves to `wiring/body/`. 2. S2: a bound says whether it is advice and whether it comes from the construct's consumer; whether a variable is at the top of its own result is kept per variable, through `adopt`. 3. S3: a named function value joins the scope as a call does. Doc fixes (`merge-analysis.md` §1) | M2's comprehensions check, and the overloaded `show` runs `"int str"`. M3's `Result.Ok` calls check. `if c: id(1) else: id(2)` as `Int?` and the tuple take `id<Int>` both times; `takeArr(pair(1, 2))` takes `pair<Int?>` with no array conversion; `takeBox(makeBox(1))` checks. `checkerModel` is `['diagnostics', 'types']`. `joint.test.ts`, `variants.test.ts`, `recursive-uses.test.ts` unchanged. Profile within noise |
| **C2** Trait meeting and small repairs (behavioural) | S5: one memoized search for the instantiation a type meets (requirement candidates, known constraints, witnesses), read by fitting, dispatch, `reportUnmet` and inference (`relate.ts` relates a concrete type to `any Trait<B>` through it). S6: a union rebuilt through `unionOf`; a host form's parts are its type arguments; fields paired by canonical index | M6's repros check; `any OptSink & WideSink` into `any Sink<Int>` is 5370. B41's `s[k]` fits. A nested `LayoutView{…}` under `Array<any View<Sc>>` infers `Sc`, and `takes(direct(), Sc{a: 1})` checks (B46). B40's property passes at seed 2040523392. A host `Box<fn() -> Int>` is refused at the boundary (B37) |
| **C3** One holds relation (behavioural) | S4: `holds(holder, type)`, meaning fits, in `types/fitting/`, read by `commonType`, settling's rule 3, most-specific choosing and the clash rule. Still no new union inferred | M5's branches and collections check in both orders; `same(xs, ys)` is `Array<Int?>`. B44's pairs clash at declaration. `if c: 1 else: "a"` stays an error |
| **C4** Placeholders that give (behavioural) | A held-back struct literal gives its fields to the lambdas inside it: a postponed lambda waits while an input reaches those fields, as it does for a waiting function's result. An expected computed type (a mapped type over an open `C`) waits on what decides its form, then reduces. One home for "computed": `equal.ts`'s own `isOpaque` goes, read through `computed-types.ts`. `generate.ts` stops writing what is now inferred (the views' type arguments, the scope aliases); `order.gen.ista` and `supplier.gen.ista` regenerated. Spec §3.14 and `design.md` §4 | `Pick{sel: h, cases: struct{x: Case{body: fn(sc): sc.a}}}` under a mapped `cases` checks, as it does under a plain one; with `sel: C`, `struct{x: 1}` and `cases: struct{x: fn(sc): sc.a}` checks (5501 today). `VariantView`, `CaseView` and `ScopedView` carry no type arguments in either generated file, and no `OrderScope*` alias remains; both check and `form-spec.test.ts` passes. No second `isOpaque` meaning "computed". Profile within noise |
| **C5** Readiness and settling cost (behaviour-neutral) | Profile first; cut where it shows, taking only levers that leave the structure simpler (the human's rule). Fixedness memoized per system revision; tentative types read only for the variables substituted; the quadratic scans in settling and readiness gone | `npm run profile:check`: fb-warm lower than 671 ms on `31d34496` (landed ~465 ms), std-tests not slower. Same diagnostics and types: the full suite, `constraint-scope.test.ts`, `test/examples.test.ts` and `form-spec.test.ts` pass unchanged. The levers not taken are P38 |

**Order:** {V0 ∥ I0} → V1 once V0 lands → I1 once V1 and I0 land → I2 once I1 lands, V2 once
V1 lands → merge review → {C1 ∥ C2} → C3 once C1 lands → C4 once C3 lands → the merge reviewer re-checks → C5. A phase starts only on landed code, never on a contract, and beside a running one
only when their branches won't conflict. *Why:* least total work over the fastest finish. V0 and
I0 lay the bases (identity, `commonType`) and touch disjoint files. I1 consumes V1's
`varianceOf` (V0 shipped no stub). I2 needs V1's conversions and I1's system; V2 needs V1's
variance. C1 and C2 share only `program-checker.ts`'s memo table. C3 changes what agreement and
rule 3 decide, and C1 how agreement stands in a scope. C4 edits the constraint scope C3 reads.

**Proposal 8** follows V1: its conversions become subtyping (F28 folds into its plan), its `K`
default becomes a settling rule, and its `Persistable` reads V0's reach. Its runtime is
independent of this plan and may run beside I2.

## Shared surfaces and owners

| Surface | Owner | Consumers |
|---|---|---|
| Extern handle kind (syntax tree), `identityOf` in the `types` layer | V0 | V1, lowering, `sendable.ts`, `testing.ts`, `json-forms.ts`, `disposal.ts` |
| `types/variance/variance.ts`: `type Variance = 'covariant' \| 'contravariant' \| 'invariant'`; `varianceOf(declaration: NominalDeclaration \| TypeAliasDeclaration \| TraitDeclaration): readonly Variance[]`, one per type parameter, memoized per declaration | V1 creates it; V2 adds the traits' | I1, I2 |
| `types/fitting/fit/`: composition through variance; a nested fit recorded as from and to | V1 | I1, I2, lowering, `forms.ts` |
| `types/unions/common-type.ts`: `commonType(types: readonly Type[]): Type \| undefined` | I0 | I1 (settling rule 3), `agreement.ts` |
| `types/inference/`: the constraint system (variables, `constrain`, settle, one constraint scope per body expression) | I1 | I2 |
| `BodyContext` holds the constraint scope; records are written at settle | I2 | — |
| The scope protocol (what joins, what is a boundary, a scope per field pass) and `ConstraintScope`, in `wiring/body/` | C1 | `constructs/`, C3 |
| The instantiation a type meets, memoized per type and trait | C2 | fitting, dispatch, `reportUnmet`, `relate.ts` |
| `holds(holder, type)` in `types/fitting/` | C3 | `commonType`, settling's rule 3, choosing, clashes |

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
| C1 | — | 5380–5389 |
| C2 | — | 5390–5399 |
| C3 | — | 5310–5319 |
| C4 | — | — |
| C5 | — | — |

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
| C1 | yes | yes | Profile |
| C2 | yes | yes | — |
| C3 | yes | yes | — |
| C4 | yes | yes | Profile |
| C5 | yes | yes | Profile, before and after |
| Re-check | — | yes | The merge reviewer, on the corrections against its findings |

Out of scope, filed: F26 (`each`), F27 (view handles), F28 (proposal 8's qualifiers as subtyping),
Q46 (inference variables as their own key, S7), Q47 (always in a scope, S8).
