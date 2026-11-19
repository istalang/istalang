---
description: proposal 11 of docs/proposals, for identity, variance and constraint-based inference — handles and values told apart by declaration, variance derived or written (`gives`/`takes`), conversions inside types (`Array<Int>` into `Array<Int?>`), one constraint system per expression with a fixed settling policy, the optional join; its phases, what has landed and what comes next. Read for the why and the status; the rules in full are `docs/work/done/variance-inference/design.md`
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-09
last_updated: 2026-11-09
tags: [proposal, language, checker, inference, variance, conversions, f25]
---

# Proposal: identity, variance and inference

Generic code infers what users from TypeScript, Kotlin, Swift, C# and Rust expect it to, and a
value converts inside the types that hold it. Each of these failed before:

```ista
const xs: Array<Result<Int, String>> = [1].map(Result.Ok)   # 5001: E fixed as Error
const ys: Array<Result<Int, String>> = [1].map(fn x: Ok(x))  # 5107

const a: Array<Int> = [1, 2]
const b: Array<Int?> = a                                     # 5001: no conversion inside a type

const c = if ready: 1 else: none                             # 5001: no join
const d = [1, none]                                          # 5001
```

Now all of them check: the expected type takes part in inference, an `Array` converts its items,
and an `Int` with a `None` joins into an `Int?`.

**Goals, in priority order:** nothing surprises a user coming from those languages; nothing that
can be inferred has to be written; room for variadic type parameters (proposal 12) and proposal 8's
function kinds.

The full rules, examples and risks are in `docs/work/done/variance-inference/design.md`, and the phases
in `plan.md` beside it. This proposal gives the outline, why it is built this way, and its status.

## Status

| Phase | What | Landed |
|---|---|---|
| V0 Identity | `extern shared/sendable/ephemeral struct`; handles recognised by declaration, never by name | `b10fee2c` |
| I0 Optional join | `commonType`: a literal into its base, `T` with `None` into `T?` | `4d30e7a5` |
| V1 Variance and conversions inside types | Variance derived and written; fitting composes through it; lowering rebuilds per concrete pair; equality by declaration | `7be193c3` |
| V2 Variance through `any` | Traits' variance; meeting `any Trait<B>` through a fitting `Trait<A>` | `f9fbbe4a` |
| I1 Constraint inference per call | Bounds on call variables, the settling policy, postponed arguments, the "most specific" overload rank | `9aaf0196` |
| I2 Joint solving | One constraint scope per body expression: nested calls and literals settle together; variants become plain generic calls; §3.7 literal building deleted | `daa0774a`–`23bf0ed5` |
| C1 Scope protocol | One table for what joins a constraint scope; a bound's role (advice, and by whom); function values join as calls do; a call chosen by defaults | `bf52710a`–`f30a8c21` |
| C2 Trait meeting | One memoized search for the instantiations a type meets, used by inference too (B46), with B37, B40 and B41 | `c66120e6` |
| C3 One holds relation | Joining, settling, choosing and clashes read one `holds` (B44); generic clashes judged as a call | `4ddaa8df` |
| C4 Placeholders that give | A held-back struct literal gives its fields to the lambdas inside it; a computed expected type waits on its form; form-builder's generator writes nothing inferred | `31d34496` |
| C5 Inference cost | Fixedness memoized per system revision; no quadratic scans in settling and readiness; behaviour-neutral | `b0189913` |

The merge review (`c3506066..23bf0ed5`, findings and root causes in
`docs/work/done/variance-inference/merge-analysis.md`) approved the corrections on `31d34496`.

C5 then cut the cost of inferring what form-builder no longer writes, fb-warm 671 ms to ~465 ms,
with no change in behaviour; what it left is P38.

**Later, filed:**
- F3: variadic tuples (proposal 12);
- F27: view handles, so `gives`/`takes` reach handles;
- F28: proposal 8's function-type qualifiers as subtyping in the constraint system;
- Q46: inference variables as a key of their own; Q47: every expression checked in a scope.

## Rules

### 1. Identity, read off declarations

A value has no identity: copies share it immutably and `==` is structural. A handle has one:
copies share one object, and `==` compares it. An extern says which it is:

```ista
extern struct Array<gives T>            # a value
extern shared struct Slot<T>            # a handle in its instance
extern sendable struct Instance         # a handle with a global id
extern ephemeral struct Socket          # a handle in its process (none until proposal 8)
```

A disposable extern must be a handle. One `identityOf` replaces every check that named `Slot` or
read a role (design §1).

### 2. Variance

A type parameter is covariant, contravariant or invariant.

- **Derived** for source types from where it occurs. A field gives, and a function parameter flips
  the direction. A handle's type arguments, `&`, computed positions (`T.Data`, `S[K]`) and member
  type parameters are invariant. Recursive types are solved by a fixpoint.
- **Written** on externs: `<gives T>`, `<takes T>`, nothing for invariant. `Map<K, gives V>` keeps
  its keys invariant, as Kotlin's does.
  - On a handle, a marker is an error until view handles exist (F27).
  - On a source type, it is an assertion the compiler checks against the derived variance.
- **Traits through `any`** follow C#'s interface rule. A type meets `any Trait<B>` through some
  `Trait<A>` that fits it.

So a `Slot<Int>` never becomes a `Slot<Int?>`, since writing a `None` through the wider view would
break the narrower one, while an `Array<Int>` becomes an `Array<Int?>`.

### 3. Conversions inside types

Fitting keeps its conversions (into an `any`, a struct into its shape, a function made async, a
one-element tuple at the top) and composes them through variance. The checker records only from
and to. Lowering derives each rebuild per concrete pair, as one synthesized function. Runtime
equality and hashing compare by declaration, so a `Box<"s">` widened to `Box<String>` equals one
built as `Box<String>`. A witness keeps `self` exact: `Array<Int>` doesn't meet a trait through a
function declared for `Array<Int?>`.

### 4. Inference: one constraint system per expression

Every generic call, generic struct literal and variant call adds variables to one constraint scope,
held by the body being checked. The scope settles on every path out.

- **Constraints:** everything goes through one directional relation, `constrain(sub, sup)`,
  decomposed by variance. Constraints come from:
  - the arguments;
  - the expected type, which advises once the arguments have bounded what they can;
  - the declaration's `is`/`in`, checked at settling.
- **The receiver binds exactly,** as Swift's and Rust's `Self` does.
- **Bounds propagate** between related variables.
- **Settling policy:**
  1. an equality;
  2. the expected type's choice, if the constraints allow it;
  3. the common type of the lower bounds;
  4. the upper bound;
  5. the default;
  6. otherwise 5100.
- **Postponed arguments:** lambdas and function values are checked once their inputs settle, and
  their results join the other bounds.
- **Overloads:** `fn f(x: Int)` and `fn f(x: Int?)` coexist, and `f(1)` takes the most specific.
  Two functions clash when, at some argument count, a call could fit both and neither is more
  specific. Generic ones each instantiate their own, as at a call, so `fn f<T>(x: T)` and
  `fn f<T>(x: T?)` clash.

### 5. The optional join

Producers that must agree (branches, a body's tail and its `return`s, a collection's items) join in
exactly two ways: a literal into its base, and a type with `None` into its optional. `if c: 1
else: "a"` stays an error; no other union is inferred. `[...xs, none]` wraps `xs`'s items.

## Why

- **One relation, decomposed by variance,** replaces the special cases that read the expected type
  in some places and not others: conformance's expected step, the argument ordering in
  `function-arguments.ts`, `known-parameters.ts` for variants, and §3.7's literal building. Each
  answered one shape of call, and each disagreed with the others at the edges.
- **Identity decides variance.** A handle can't be converted without a view (F27), and a value can
  be rebuilt. Reading identity from the declaration makes `Inbox<T>` invariant with no list of
  names to keep.
- **The expected type advises rather than decides.** A call checks to the same instantiation
  without an expected type as with its own result type expected, so annotating a call with the
  type it already has never changes it.

## What changes in behaviour

Design §9 lists every anchor with its result before and after. In short:
- conversions inside value types and through covariant `any` types now check;
- inferring from the expected type reaches lambdas, function values, variants, nested calls and
  literals;
- `Int` and `None` join;
- handles, `Map` keys, contravariant positions and one-element tuples inside a type still refuse,
  with 5001;
- `xs.includes(none)` for an `Array<Int>` reports 5002 instead of rebuilding `xs`.

## Decisions (the human's)

1. **The design as a whole,** decided 2026-11-08, replacing tracker F25's options and
   `docs/work/done/proposals/f25-expected-type-first.md`.
2. **Trait-object variance is its own phase** (V2).
3. **Runtime equality and hashing compare by declaration.**
4. **A method's receiver binds its type arguments exactly.**
5. **`Map<K, gives V>`.** Keys stay invariant.
6. **Joining is one constraint scope held by the body,** settled on every path out. It replaced I2's
   first, opt-in joining, which left nested calls orphaned when the outer call failed.
7. **I2 deletes §3.7 literal building and fixes B43** (a postponed lambda whose result is only
   partly known).
8. **The merge review's corrections run as C1–C3,** B46 and the other bugs folded into C2 and C3;
   C4 follows from form-builder's trial.
9. **A generic clash is judged as a call** (C3): choose over every overload, a clash when both tie.
