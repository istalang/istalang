---
description: analysis of tracker item F25 option 2 (a generic call's expected type speaking before its arguments, for every call) — why known-parameters.ts can't become every call's rule as framed, the rule that works (choose, then take the chosen function again with the type arguments its expected type gives inside its result), spec edits, how TypeScript, Swift, Kotlin and Rust do it, consequences, prototype evidence, risks, batches and the recommendation against option 1; read before specifying or implementing F25
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-08
last_updated: 2026-11-08
tags: [proposal, checker, inference, generics, calls, f25]
---

# F25: the expected type first

Today the arguments of a generic call bind its type parameters first. The expected type fills only
what they leave open, at instantiation (`conformance/conformance.ts` `instantiateAt`), after
lambdas and function values have been judged (`calls/function-arguments.ts`). Variant calls alone
read the expected type first (`calls/known-parameters.ts`, proposal 7). Option 2 asks for that
order for every generic call.

## Verdict

- **As framed, option 2 is unsound.** "known-parameters.ts for every call" needs the callee
  before its arguments are checked. But a call's candidates come partly from its arguments' types:
  argument-dependent lookup, and the functions a type parameter's constraints require
  (`choosing/candidates.ts`). Variants escape this only because their name fixes the constructor.
- **Binding over the whole result is wrong at its top.** There the call's value still converts
  into the expected type (§2), so what is expected is only a bound. Binding it exactly breaks std
  `json` and constrained calls.
- **A rule that works:** choose as today, without the expected type. Then take the chosen function
  again, with the type arguments its expected type gives *inside* its result in place, before any
  argument is matched. Where that doesn't take the arguments, keep the first taking.
  - The full suite passes, and every F25 example checks but one, which needs batch 3.
  - It costs about one probe per call; no time difference measured.
- **Recommendation:** option 2 in this form, in three batches. Not option 1, and not both: option 1
  is the same mechanism restricted to lambdas and function values, a strict subset that would be
  thrown away.

## Evidence: the prototype

A throwaway worktree, with each rule behind an environment switch. Each mode ran the full vitest
suite (12,848 tests) and `ista test src/stdlib` (222 std tests). The probes are 60 small programs
covering every area below. On main, the suite has 12,562 passing and 0 failing.

| Mode | Rule | Suite failures | std tests | F25 examples |
|---|---|---|---|---|
| hint | Every lone-candidate call: parameters known from the expected type, arguments checked against them top-down; arguments still bind | 12 | pass | 1 of 4 |
| hard | hint, plus the expected type's type arguments given as written, over the whole result (proposal 7's rule, generalised) | 276 | crash | 4 of 4 |
| inside | hard, giving nothing for a type parameter at the result's top | 12 | pass | 4 of 4 |
| seed | No top-down checking; inside-rule type arguments seeded into the one candidate's inference while choosing, unseeded again if they don't take the arguments | 0 (5 load timeouts that pass on rerun) | pass | 3 of 4 |
| retake | seed, applied after choosing to the chosen function, whatever the number of candidates | 0 (7 binder tests left pending under load; they pass on rerun) | pass | 3 of 4 |

The four F25 examples are `items([Item{value: "s"}])` as `Options<"s" | "m">`, `vs.map(Result.Ok)`,
`vs.map(fn x: Result.Ok(x))` and `vs.map(fn x: Ok(x))`, each as `Array<Result<Int, String>>`.

What each failure taught:

- **hard, 276 failures, from two causes:**
  - Std `json`'s `fields.get(name)`, expected as `Json`, matches `V?` against `Json`, so `V`
    becomes `Json` without `None` and the receiver `Map<String, Json>` no longer fits. Every
    program running `json` then fails to lower; that is the cascade.
  - `biggest(a, b)` (`T is Comparable`) expected as `Int?` gives `T = Int?`, which doesn't meet
    `Comparable`.
- **hint and inside, the same 12 failures, three causes:**
  1. The callee isn't known before the arguments. In `generics/traits.ista`,
     `pairWith(item, "cents")` with `item: T is Pairable` is checked against the only `pairWith` in
     scope, `pairWith(self: Money, …)`; `T`'s requirement is found only through the argument.
  2. An expected union. FormBuilder's `label: Prop.Fixed("Small")` loses the member that
     `sameNominal` picks today.
  3. Diagnostics move. A misfit in a lone call is reported at the argument as 5001, where today
     the call reports 5002 (`ruled-out-code`, `invalid-rest`). A written pack type argument gives
     `fn(...?)` (`invalid-packs`), and a test of how often `fitOf` is asked counts an extra one.
- **seed and retake:**
  - Overloads: unchanged. `show(5)` with a concrete overload still takes it.
  - Errors: a misfit keeps today's message, at the call.
  - What they don't fix: `items([Item{value: "s"}])` and `many(["s"])` as `Box<"s" | "m">`. A named
    generic struct literal and a scalar literal have no `builds` handler
    (`constructs/expressions/expressions.ts`), so neither is rebuilt as the parameter's type
    (§3.7). That is batch 3.
- **Time:** the median of three rounds of `profile:check` (fb-warm, std-tests, every-std) is
  within noise. seed is 0–3% above main; inside is 1–7%, from its extra top-down fits.

## 1. The rule

### Why known-parameters.ts can't be every call's rule

1. **Candidates depend on arguments.** `callCandidates` adds argument-dependent lookup and
   requirement candidates from the arguments' types; `topLevelCandidates` adds the traits a union
   meets. Whatever the name finds before the arguments may be the wrong function (cause 1 above).
   A rule like "know them when the name leaves one, unless an argument brings more" is circular.
2. **Exact at the top is wrong.** `T`, or a member of `T?`, is where conversion into a union, `any`
   or async still applies (§2, §3.14). The expected type is an upper bound there, not the type.

Variants keep their top-down checking, because a variant's name fixes its function. Only the type
arguments they take from the expected type come from the shared rule below.

### The rule (§3.5)

Once a call's function is chosen, and no type arguments are written:

1. Match the function's result against the expected type exactly: against the whole of it, else
   against the one member of an expected union that takes the arguments. That member choice is the
   variant rule (`variants.ts` `instanceTaking`), generalised.
2. Keep what the match binds for type parameters that stand **inside** the result: a type argument
   of a generic type, an element of an array, map or tuple, a part of a function type. Drop those
   standing at its top: the result itself, or a member of a result union.
3. Take the chosen function again with those type arguments in place, as written ones are. Every
   argument is matched against its parameter's type with them; lambdas and functions named as
   values are judged after, against the same types. A literal that has items is rebuilt as its
   parameter's type where its own type doesn't fit (§3.7).
4. If that taking fails, keep the taking without them. The result is then judged against the
   expected type as any value's is, so the error stays what it is today.
5. Instantiation fills what is still open from the expected type, then from defaults, as today.

Properties:

- **Choosing never reads the expected type.** §3.7's "Return types play no part" stays true.
- **Nothing that compiles today changes meaning.** Positions inside a type are invariant, so a call
  whose arguments' instantiation fits the expected type already had the type arguments the
  expected type gives.
  - Seeding can only add programs: where the arguments alone can't decide (a literal, `none`,
    `[]`, a lambda), or a literal can be rebuilt.
  - The suite confirms it: the 60 corpus run outcomes and the compile-identity tests are
    unchanged.

### Spec edits

- **§3.5, Generics.** Replace "A type parameter the arguments leave open is taken from the type the
  call is expected to have, once the function is chosen, and then from its default." with:
  > Once a call's function is chosen, the type it is expected to have speaks before its
  > arguments. Matched against the function's result, it gives the type parameters standing
  > inside the result (a type argument, an element, a part of a function type), as written type
  > arguments would. Each argument is then matched against its parameter's type with them in
  > place, and a literal, lambda or function named as a value takes its type from there: as an
  > `Array<Int?>`, `pair(1, 2)` binds `T` to `Int?`; as an `Array<Result<Int, String>>`,
  > `vs.map(Result.Ok)` binds `U`, and `E` is `String`. Where the arguments don't fit what it
  > gives, they bind as if nothing were expected. A type parameter at the top of the result (`T`,
  > `T?`) takes nothing from it first, since the call's value converts into the expected type
  > there (§2): `max(a, b)` as an `Int?` binds `T` to `Int`. An expected union gives what its one
  > member taking the arguments gives. What is still open is taken from the expected type, then
  > from defaults.

  Also amend "an expected result, that gives the parameter" in the inference-never-goes-through
  bullet to cite this rule.
- **§3.3, Functions.** No normative change: evaluation order is unchanged, and inference belongs to
  §3.5. Add one cross-reference to *Arguments*: "the types they are matched against may come from
  the call's expected type (§3.5)".
- **§3.7, Methods.** Keep "Return types play no part", and add "in choosing; the expected type
  speaks once one is chosen (§3.5)". In the literal-argument bullet, replace "a parameter type still
  to be found takes the literal's own type" with "a parameter type neither the arguments nor the
  expected type (§3.5) gives takes the literal's own type". Batch 3 widens the same bullet to named
  generic struct literals and scalar literals against literal types.
- **§3.11, Enums.** In the variant-function bullet, replace "or else the expected type's when it is
  the same enum" with "or else those the expected type gives (§3.5)". The top-down checking of each
  argument against its field stays, since a variant's name fixes its function.
- **§3.14, Function types.**
  - *Parameter types* bullet: "checked after the other arguments, so they give its parameter
    types, and its result then infers the type parameters that remain" becomes "checked after the
    other arguments and the expected type (§3.5), so they give its parameter types, and its result
    where the expected type gives it; its result then infers the type parameters that remain".
  - *Functions named as values*: likewise, so `vs.map(fn x: Ok(x))` is legal; the bare `Ok`
    already resolves once the expected function type's result is its enum.
- **§3.11, error text.** The 5107 example `xs.map(Ok)` stays an error only where nothing
  expected gives `map`'s `U`.

### Other languages

| Language | When the expected type speaks | What it binds | Lesson for us |
|---|---|---|---|
| TypeScript | Lowest-priority inference candidates (`InferencePriority.ReturnType`), used to type context-sensitive arguments (lambdas) in a second pass | Arguments override it | Covariance hides the problem: `Box<"s">` fits `Box<"s" \| "m">`. With our invariance, "arguments win" alone leaves `single("s")` failing |
| Swift | Jointly: one constraint system for the result and the arguments, solutions scored | Whatever satisfies all constraints, literals polymorphic | Everything here compiles, at the price of search ("expression too complex") and solver-shaped errors. Rejected: we keep one pass |
| Kotlin | Before fixing type variables: `R <: Expected` joins the argument constraints | Equality in invariant positions, an upper bound at the top; lower bounds preferred | The model adopted: `mutableListOf(1, 2)` as `MutableList<Number>` gives `T = Number`, `maxOf(a, b)` as `Int?` keeps `T = Int` |
| Rust | Before the arguments: `expected_inputs_for_expected_output` unifies return and expectation in a rolled-back snapshot | Only expectations (hints) for the arguments | Where we get the probe and fallback: a seed that fails leaves nothing behind |

## 2. Consequences

| Area | Today | With the rule |
|---|---|---|
| Unions | An expected union fills only what is open | The one member taking the arguments seeds (`single(5)` as `Box<Int?> \| String` checks). Several members that take them seed nothing. A result at the top is never seeded, so `fields.get(k)` as `Json` is unaffected |
| Optionals, implicit wraps | A result converts into `T?` at the top | Unchanged at the top (`biggest(a, b)`, `firstOf(xs)`, `id(o) ?? 0` as `Int?`). Inside, the wrap reaches the arguments: `wrap(n)` as `Array<Int?>`, `keyed("a", 1)` as `Map<String, Int?>?`, `single(o ?? 1)` as `Box<Int?>` |
| Literal types | A literal argument binds its base | `single("s")` as `Box<"s" \| "m">` checks. `many(["s"])` and `items([Item{value: "s"}])` need batch 3. `pick("draft", "sent")` as `Status` stays an error (top) |
| Overloads | Chosen by arguments | Chosen by arguments; only the chosen function is seeded. A concrete overload still beats a generic one |
| Defaults | Fill what neither arguments nor expected type give | Same order. `Result.Ok`'s `E` now comes from the expected type where one is (the F25 fix); no compiling program changes |
| Packs | A pack binds from its arguments | A pack inside the result is seeded, but its items must be exact, so the seed falls back and the error is today's. A pack at the top is unchanged |
| Async | `await f(x)` checks the operand alone | Unchanged; a stored `Future<T>` result is seeded like any nominal type |
| Lambdas, function values | Judged after the arguments, before the expected type | Also after the expected type: the three `map` examples check, and a lambda body is checked against the seeded result (`[1].map(fn x: x)` as `Array<Int?>`) |
| Error messages | A misfit names the call | Unchanged, by the fallback. Variants keep reporting at the argument |
| Incremental checking | The call reads the callee's signature and result | No new reads: the expected type is the call's own input, and the result is already read at instantiation. Entries and memo keys are unchanged |
| Editor | Argument completions see a type only for variants | Unchanged for plain arguments, which are not checked top-down. Lambdas and rebuilt literals (batch 3) record their seeded expected types, so completions inside them improve |
| Performance | — | One extra taking of the chosen function, only for a generic call with an expected type that gives something inside its result. Measured within noise |

## 3. Risks and containment

- **A silent change of meaning.** Containment:
  - the invariance argument above;
  - a fast-check property: a call that checks without an expected type checks to the same
    instantiation and result when its own result type is expected;
  - the corpus run outcomes and compile-identity tests as they stand.
- **Hazards at the top** (`Json`, constraints). Contained by the inside rule. Pin them with
  regression tests: `biggest(a, b)` as `Int?`, `fields.get(k)` as `Json`, `pairWith(item, …)`
  through a requirement, and FormBuilder.
- **State leaking from a failed seed.** The seeded taking builds its own `Inference`; a failure
  drops it ("Probes do not mutate"). Lambdas are checked once, after the retake, on the taking that
  is kept (`request.chosen` runs after it).
- **Recursive aliases.** Seeds bind what `matchExactly` unfolds. `Box<Json>`, `Array<Json>` and
  `Array<Tree>` probes check, but add them as tests: proposal 5's identity is the area most likely
  to drift.
- **Two rules for arguments.** Variants check top-down, other calls only match. Batch 3 narrows the
  gap, and §3.11 says why the difference exists.
- **Scope creep toward the top.** `pick` as `Status`, and `applied(1, fn x: Result.Ok(x))` as
  `Result<Int, String>?`, need bounds at the top: Kotlin's upper bound, or Rust's hint for a
  lambda's result. File them separately, not in this work.

## 4. The work

Structure first, then behaviour, each batch one commit with `npm run verify` green.

1. **One home for "what the expected type gives a call's type parameters"** (structural, S, about
   80 lines). Add a resolution module (for example `resolution/choosing/expected-arguments.ts`)
   with the inside rule and the member that takes the arguments.
   - Variants' `expectedArguments` and `instanceTaking` (`constructs/expressions/structs/variants.ts`)
     and `givenTypeArguments` (`calls/known-parameters.ts`) go through it.
   - A variant's result `E<P…>` has every parameter inside, so behaviour is unchanged.
   - `sameNominal` (`types/fitting/expected.ts`) stays for the editor's completions.
   - Tests: the existing `variants.test.ts`, plus the module's own table.
2. **Retake the chosen function seeded** (behavioural, M, about 120 lines of code plus about 200 of
   tests).
   - Code: `applying/applied-call.ts` (retake before `chosen`), `choosing/choice.ts`
     (`seededApplication`), `choosing/applicability.ts` (`Given` takes a seed merged under written
     type arguments).
   - Banners: `calls/function-arguments.ts`, `calls/resolve.ts`, `conformance/conformance.ts`.
   - Spec: §3.3, §3.5, §3.7, §3.11, §3.14 as above.
   - Tests: a table test of the probes (F25 examples, top hazards, packs, overloads, recursive
     aliases); the property above; corpus `generics/expected-first.ista` (run) and an invalid twin.
   - Tracker: close F25.
3. **Rebuild every literal that takes its type from where it stands** (behavioural, M).
   - Code: `buildsHandlers` in `constructs/expressions/expressions.ts` (a scalar literal builds as a
     literal type, or a union of literals, holding its value);
     `constructs/expressions/structs/structs.ts` (a named generic struct literal with no written
     type arguments builds as any instance its fields fit); the rebuilt path in
     `wiring/body/body-checker.ts`.
   - Spec: §3.7's literal bullet.
   - Tests: `choosing/literal-arguments.test.ts`, plus `items([Item{value: "s"}])`.
   - It also makes literal arguments of non-generic overloads accept literal types, so check the
     tie-break rank of "built as another type".

The 1, 2, 3 order is forced: 2 builds on 1, and 3 is useful only once 2 gives the types. 3 is the
only part with real design risk (overload ranking), so it lands last and can slip without
blocking F25's three `map` examples.

## 5. Recommendation

**Option 2, as the retake rule, batches 1 to 3.** Not option 1, and not both in sequence:

- Option 1 is batch 2 restricted to lambdas and function values. It is the same mechanism, it
  needs the same inside rule (option 1 binding at the top has the `Comparable` hazard), and the
  work is the same size.
- It misses everything literal: `pair(1, 2)` as `Array<Int?>`, `many([1, 2])` as `Box<Int?>`,
  `single("s")` as `Box<"s" | "m">`.
- Shipping it first would only be rewritten by batch 2.

File separately: top-of-result bounds (`pick` as `Status`, lambdas returning into an optional);
seeding a pack that converts its items; and argument-level diagnostics for lone non-generic calls,
which hint mode showed would move many 5002s to 5001s.
