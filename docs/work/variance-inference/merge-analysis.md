---
description: analysis of the variance-inference merge review (kere, c3506066..23bf0ed5) and the follow-up bugs B37, B40, B41, B44, B46 — each finding reproduced or refuted with its mechanism, the root causes behind them, the structural changes that remove them, and the phases proposed; read before planning the merge-review fixes
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-09
last_updated: 2026-11-09
tags: [review, inference, constraint-scope, fitting, traits, variance-inference]
---

# Merge-review analysis

Checked on main `2b189cdb`, with `ista check` and `ista run`, and by compiling to a Definition to
read which instantiations a call takes. Paths are under `src/compiler/checker/` unless they say
otherwise.

## 1. Findings

| # | Finding | Verdict | Mechanism | Size |
|---|---|---|---|---|
| M1 | `ConstraintScope` lives in `contexts/` | confirmed | `contexts/constraint-scope.ts` holds the 384-line class and imports `Inference` as a value. `.dependency-cruiser.mjs` `checkerModel` gained `'types/inference'` (it was `['diagnostics', 'types']` at `c3506066`). `types/` imports `contexts/context.ts` (`common-type.ts`), so the type model can reach inference through the contracts | small |
| M2 | Field passes inside an open scope | confirmed, a miscompile | `Passes` (`contexts/passes.ts`) and `BodyScopes` (`wiring/body/body-scopes.ts`) each keep a dynamic "current". Deferred work (`whenSolved`, `recorded`, `ScopeMember.complete`) captures neither. A call in a pass joins the outer scope and completes after `inFieldPasses` has left the pass, writing into the root pass's tables. The site twin `(node, T)` is shared by every pass. `i2-scope.md` §2's boundary table has no row for field passes, and the code puts a `suspended()` on only two of the four callers | small–medium |
| M3 | A named function value infers alone | confirmed | `judgeNamed` (`constructs/expressions/postponed.ts`) calls `functionValueType` → `fittedValue` (`resolution/choosing/named-functions.ts`), which replaces the parts still open with the error type (`holesIn`) and instantiates outside the scope. `E` then settles to its default `Error` (rule 5 comes before the error-type fallback), and `whenSolved` re-checks the pre-instantiated `type`. So a function value is checked twice, by two models | medium |
| M4 | `#atTop` and rule 2 | confirmed | `CallSystem.#atTop` (`types/inference/system.ts`) is one set, overwritten by each `expectResult` and dropped by `adopt`. `expectedChoice` (`types/inference/settle.ts`) takes only bounds with `origin === 'expected'`. An enclosing call's parameter bounds a nested call's result with `'argument'`, so rule 2 never fires for nested calls | medium |
| M5 | `commonType` is asymmetric | confirmed, wider than reported | `holdsAll` (`types/unions/common-type.ts`) accepts only conversions of kind `none` or `base`, so a conversion inside a type never counts as holding. `agreement.ts` falls back to the first producer, and settling's rule 3 calls `commonType` | small–medium |
| M6 | Trait objects aren't transitive | confirmed | `candidateBinding` (`resolution/conformance/met-instantiations.ts`) skips a candidate that is a requirement (`candidate.requirement === undefined`), so a type parameter's or an `any` type's own requirements propose nothing. The `found.kind === 'any'` guard in `reportUnmet` (`trait-objects.ts`) is the same gap seen from the other side. `metInstantiation` isn't memoized (5 callers) | small–medium |
| D1 | `twinOf` puns | confirmed | A variable is a shallow clone of a `TypeParameter` node (`types/inference/variables.ts`), told apart by a module-global `WeakMap` and read back through `standingFor` at 3 sites in `wiring/program/program-checker.ts`. A placeholder is a `parameter` type too, with a made-up `Placeholder` key. So `parameter` means a rigid parameter, a variable and a placeholder | medium–large (67 `declaration.kind` checks) |
| D2 | Field lookups are O(F²) | confirmed, minor | `.find` by name in `lowering/functions/fits/parts.ts` (`shapePairs`, `rebuiltStruct`) and in `rules/computation/forms.ts` (`structForm`). It's one symptom of §2 R6 | small |
| C1–C5 | Correctness cases | confirmed | = M2, M3, M4, M5, M6 | — |
| I1–I3 | Integration seams | confirmed | I1 = M5, I2 = M4, I3 = M2 | — |
| Docs | `architecture.md` cites `joint.ts` | confirmed | the line on constraint-based inference | small |
| | `architecture.md` lists `fit.ts` and omits `unfolding-pairs.ts` | refuted | it names `fit/index.ts` and `unfolding-pairs.ts` | — |
| | contracts say they name nothing above the type model | confirmed | `architecture.md`, the banner of `contexts/body-context.ts` | small |
| | `design.md` keeps obsolete "as built" notes | confirmed | §4, the notes from before the redesign | small |
| | `reuse/types-and-fitting.md` says producers "are built again" | confirmed | the "agree on one type" entry | small |
| | stale references to `function-arguments.ts` | confirmed, 5 sites | `resolve.ts`, `settle.ts`, `named-functions.ts`, `expected.ts`, `conformance.ts` | small |
| | tracker's next id | already fixed | `45e22886` | — |
| B37 | A host extern's type arguments go unchecked | confirmed by reading | `#partMissing` (`rules/boundary/json-forms.ts`) returns early for a `host` form, so a host value's type arguments are never asked for codecs | small |
| B40 | A union is substituted without normalizing | confirmed at its seed | The property fails at seed 2040523392 (a union holding an `any` whose constraint binds `Self`); 3000 random runs pass. `withTypeChildren` (`types/parts/type-children.ts`) and `rebuiltFrom` (`types/identity/recursive-types.ts`) rebuild a union raw, not through `unionOf`, which breaks "normalize at construction" | small |
| B41 | A keyed field doesn't meet its trait | confirmed | `commonRules` (`types/traits/known-constraints.ts`) joins an exact-type entry (`a: Boxed`) with a trait entry (`[_] is Source<Int>`) by "the traits each asks", never asking whether the exact type meets them | small–medium |
| B44 | Overload clashes miss conversions inside types | confirmed | `clashes.ts` (`constructs/declarations/functions/`) compares union members and literal bases by key. Choosing compares by `fitOf`. The declaration passes and the call is 5003 | medium |
| B46 | Inference stops at an `any` type | confirmed | `relatedByParts` (`types/inference/relate.ts`) relates an `any` only as the very same type (`equal.ts`). The witness search that fitting uses (M6's) is never consulted | medium |

**Repros:**
- **M2:** for `struct S { a: Int, b: String }`:
  - `struct{for k, v in ...s: [k]: id(v)}` gives 5001 "Expected String, found Int";
  - the same with overloaded `show(Int)` and `show(String)` checks, and runs `"str str"`;
  - in `fn copy<T is struct { a: Int, b: String }>`, three bogus 5001s.
- **M3:** these give 5001 or 5100, while `fn x: Result.Ok(x)` checks in each:
  - `takeResults(vs.map(Result.Ok))`;
  - `take(apply(1, Result.Ok), "hello")`;
  - `pairWith(1, Result.Ok, takeResultString)`.
- **M4:** in the Definition:
  - `const b: Int? = if c: id(1) else: id(2)` calls `id<Int>` in one branch and `id<Int?>` in the other;
  - `(id(3), id(4))` as `(Int?, Int?)` calls `id<Int>`, then `id<Int?>`, then a tuple conversion;
  - `takeArr(pair(1, 2))` calls `pair<Int>`, then `Array<Int> as Array<Int?>`;
  - `takeBox(makeBox(1))` with `T is Nullable` is 5101, while `const x: Box<Int?> = makeBox(1)` checks.
- **M5:** for `xs: Array<Int>` and `ys: Array<Int?>`:
  - `if c: xs else: ys` is 5005, and `[xs, ys]` is 5301, while the other order of each checks;
  - `same(xs, ys)` is 5100 in both orders;
  - `if true: x else: y` for `Box<"a">` and `Box<String>` is 5005.
- **M6:**
  - `fn direct<T is MySource<Int>>(x: T) -> any Source<Int?>: x` is 5101;
  - the same with `x: any MySource<Int>` is 5001;
  - converting into `any Source<Int>` first, then to `Source<Int?>`, checks;
  - `any OptSink & WideSink` into `any Sink<Int>` is 5001, where a concrete `Both` gets 5370.

## 2. Root causes

- **R1. Taking part in a scope is opt-in per construct.**
  - The scope API has 14 operations, used at about 50 sites in about 20 construct files: `isOpen`, `holds`, `suspended`, `join`, `postpone`, `whenSolved`, `recorded`, `guided`, `abandon`, `isolated`, `within`, `commit`, `root`, `current`.
  - `i2-scope.md` §2's table of joining kinds and boundaries exists as prose. In code it is `joinsScope` plus each handler's own `suspended()` calls. A missed boundary is a bug (M2).
  - Many constructs keep two paths, decided now or decided at settling:
    - `builtAs` and `builtOnceExpected` (`structs.ts`);
    - `decidedSoFar` against nothing when a scope is open (`branches.ts`);
    - `agreement.ts` and `open-agreement.ts`;
    - `checkFunctionValue` and `functionValueType` (M3);
    - `fit` now, or `fit` once solved.

  Two paths for one meaning disagree at the edges.
- **R2. Two dynamic contexts that don't nest.** `Passes.current` and `Scopes.current` change independently, and deferred work captures neither (M2). Any future effect that scopes records (`Passes` is one) has the same hazard.
- **R3. A bound's `origin` carries three meanings.**
  1. Advice, rolled back on conflict (`expectResult`, `#atomic`).
  2. The bounds a new bound is checked against (`checkedAgainst` in `bounds.ts`).
  3. Whether rule 2 may choose it (`expectedChoice`).

  "At the top of the result" is a per-system set, not a property of each variable. Joint solving made an enclosing call's parameter a requirement (2), yet it is just as much the nested call's expected type (3), so rule 2 lost it (M4).
- **R4. Two models for deferring a generic thing.** Calls and literals join the scope with their variables. A named function value instantiates alone, with error-type holes, and is checked again later (M3). The I2 redesign unified the first and left the second.
- **R5. "Holds", "narrower" and "fits" are three relations for one meaning, the subtype order fitting defines:**
  - `commonType.holdsAll` (only `none` and `base`);
  - most-specific choosing (`fitOf`);
  - overload clashes (keys of union members).

  Whichever three phases built them, they diverge wherever V1's conversions apply (M5, B44).
- **R6. A type meeting a trait is searched three ways, and part pairs are derived three times.**
  - The trait search:
    - what a type meets by what it is (`known-constraints.ts`);
    - which instantiation it meets through its witnesses (`met-instantiations.ts`, which skips requirement candidates);
    - in inference, `any` as the very same type (`relate.ts`).

    Each misses what the others know: M6, B41 and B46.
  - The part pairs between two types are derived in fitting (`fit/parts.ts`), in lowering's rebuilds (`lowering/functions/fits/parts.ts`) and in constant forms (`forms.ts`), the shape and function pairing written three times (D2).
- **R7. Variables pun parameters** (D1). This doesn't cause any of today's bugs. It is why `standingFor`, the global `WeakMap` and the "a variable's call is its membership in a system" rule exist, and why the I1 and I2 reviews found namespace bugs.
- **R8. Normalization at construction is broken in one place** (B40): a union is rebuilt raw. B37 is a lone double standard: a derived form's parts are checked, a host form's are not.

## 3. Structural changes

| Change | Unifies or deletes | Resolves |
|---|---|---|
| **S1. One scope protocol.** `BodyScopes` owns one typed table, kind of node × role of its part → join, settled, or a scope per pass (`satisfies Record<Kind, …>`), which is `i2-scope.md` §2 made code. Handlers stop calling `suspended()`. A field-loop pass opens a scope of its own, which settles before the pass exits. The `ConstraintScope` class moves to `wiring/body/`. A lint rule lets `types/` import only `contexts/context.ts`, so `checkerModel` returns to `['diagnostics', 'types']` | `joinsScope`/`opensScope` and the scattered `suspended()` calls, and the field-pass gap | M1, M2, I3, R1 (boundaries), R2 |
| **S2. Explicit bound roles.** A bound carries whether it is *advice* (retractable) and whether it comes from the *consumer* of the construct (an expected type, or an enclosing parameter). Whether a variable is at the top of its own construct's result is stored on its call's variables and kept by `adopt`. Rule 2 reads a consumer's upper bounds; rollback reads advice | `#atTop`, and `origin`'s three meanings | M4, I2, R3 |
| **S3. Function values join as calls do.** A named function, once chosen by its settled inputs, mints its type parameters as variables of the scope; its placeholder is its instantiated type there, checked once at settling | `holesIn`, the isolated `instantiate` in `fittedValue`, and `judgeNamed`'s re-check | M3, R4 |
| **S4. One "holds" relation.** `holds(holder, type) = fitOf(type, holder) !== undefined`, in `types/fitting/`. `commonType` uses it, and so do settling's rule 3 and most-specific choosing. Clashes ask whether some call fits both (variables for each side's type parameters) and whether neither is narrower, through the same relation | `holdsAll`'s kind list, and the clash rule's union-key comparison | M5, I1, B44, R5 |
| **S5. One search for the instantiation a type meets.** `metInstantiations(found, trait)` takes requirement candidates, known constraints and witnesses together, and is memoized per type key and trait. Fitting (`meetsAny`), dispatch (`memberConstraint`) and `reportUnmet` read it, and so does inference: `relate.ts` relates a concrete type to `any Trait<B>` through each candidate `Trait<A>`, giving nothing when several apply. `commonRules` asks it for an exact-type entry | the `requirement === undefined` filter, the `any` guard, and `relate.ts`'s "same `any` only" rule | M6, B41, B46, R6 (traits) |
| **S6. Small repairs.** A union is rebuilt through `unionOf`, the rules passed in as a seam (B40). A host form's parts are its type arguments (B37). Lowering and forms pair fields by canonical index, as `fieldPairs` already does (D2) | raw union rebuilds | B40, B37, D2 |
| **S7 (to file). Variables as their own key.** A `Variable` member of `ParameterKey`, carrying its parameter and its site, beside `Placeholder` | `twinOf`'s clone, the `WeakMap`, `standingFor` | D1, R7 |
| **S8 (to decide). Always in a scope.** Every value expression is checked in a scope, with no decide-now paths. A coverage run first shows which of the closed paths R1 lists are already dead | each construct's second path | the rest of R1 |

S4 doesn't widen what joins: `commonType` still returns one of the given types, or the two joins in `design.md` §5, so no new union is inferred. "Holds" now means "fits", as rule 3 says.

## 4. Phases

The corrections are C1 (S1–S3), C2 (S5, S6) and C3 (S4) in `plan.md`, with their acceptance.
Order: C1 ∥ C2, then C3 once C1 lands.

- **Files:**
  - C1: `contexts/`, `wiring/body/`, `types/inference/{system,settle,bounds}.ts`, `postponed.ts`,
    `named-functions.ts`, `field-passes.ts` and the construct handlers' boundary calls.
  - C2: `met-instantiations.ts`, `trait-objects.ts`, `known-constraints.ts`, `relate.ts`,
    `type-children.ts`, `recursive-types.ts`, `json-forms.ts`, lowering's `parts.ts` and
    `forms.ts`.
  - The two share only a memo entry in `program-checker.ts`.
- **Why C3 waits for C1:** it changes what settling's rule 3 and agreement decide, and C1 changes
  how agreement stands in a scope (`branches.ts`, `open-agreement.ts`).
- **Filed, not run:** S7 as Q46, a structural phase of its own once C1 lands. S8 as Q47, decided
  after C1's coverage run.
