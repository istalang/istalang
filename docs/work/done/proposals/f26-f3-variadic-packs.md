---
description: superseded by docs/proposals/12-variadic-tuples.md; design analysis for variadic packs beyond level 1 (tracker F3, superseding F26's `each`) — a pack as a tuple-constrained type parameter, tuples joining structs as products keyed by position so `keyof`, `S[K]`, mapped types, field loops and comprehensions serve both; today's pack code and its duplication, the five changes with sizes, what stays out, order against C3/C4, proposal 8 and F28, decisions left to the human; read before specifying or planning F3 or F26
owner: tech-lead
status: archived
applies_to: istalang
last_verified: 2026-11-09
last_updated: 2026-11-09
tags: [proposal, checker, generics, packs, tuples, mapped-types, field-loops, f3, f26]
---

# Variadic packs: a pack is a tuple

## The idea

The language already maps over a struct's fields, in types and in values (§3.1, §3.5, §4):
- `S is struct { [_] is C }`;
- `keyof S` and `S[K]`, with opaque keys and fields for a constrained `S`;
- mapped struct types;
- field loops checked once per known field plus one pass for the rest (unrolled per
  instantiation);
- struct comprehensions;
- member parameters `K in keyof S`;
- `case struct` in type `match`es.

Level 2 asks exactly this of a tuple of types. So:

- **A tuple is a product keyed by position,** as a struct is keyed by name. `keyof (Int, String)`
  is `0 | 1`, and `T[I]` is an element's type.
- **A pack is a type parameter constrained to tuples** (`A is tuple`, beside `S is struct`), not a
  kind of parameter. Its elements are opaque in the body, as a constrained struct's other fields
  are.
- **Everything level 2 needs is then the struct machinery, read by position:**

| Need | Today, for structs | For packs |
|---|---|---|
| Declare one | `S is struct` | `A is tuple` |
| Constrain every element | `S is struct { [_] is C }` | `A is tuple { [_] is C }` |
| Map through a type | `{ [F in keyof S]: G<S[F]> }` | the same over `keyof A`, reducing to a tuple |
| Iterate values, typed | `for k, v in ...s:` | `for i, v in ...t:` |
| Build one from a loop | `struct{for k, v in ...s: [k]: e}` | a tuple comprehension |
| One element by key | `s[k]`, `S[K]` | `t[i]`, `A[I]` |
| On a type | `struct Entry<S is struct, …>` | `struct Zip<A is tuple>` |
| Lowering | field loops unroll per instantiation | unchanged |

- **This is TypeScript's model:** variadic tuples are `T extends unknown[]`, mapped types over a
  tuple give a tuple, and inference reverses a homomorphic mapped type. Ista already copied the
  struct half (mapped types, `keyof`), and adds typed iteration (field loops), which TypeScript
  lacks.
- **Swift's `each`/`repeat` was built for a language with no `keyof` or mapped types.** Adopting
  it here would be a second way to map over a product, a double standard. So F26's `<each A>` is
  superseded: no new word.

## Today: level 1

- A pack is a type parameter marked `isPack` (syntax tree). A function type carries it in `pack`
  (`types/type/index.ts`), and a parameter as `rest: {kind: 'pack'}`. `withPack`
  (`type/function-types.ts`) flattens a tuple substituted for it.
- Inference binds it as a tuple variable, exactly. A function type ending in one relates by
  equality (`inference/relate.ts`).
- Functions only, with no constraint and no default (5080–5087). Lowering passes its elements as
  single parameters (`lowering/calls/packs.ts`).
- Uses: `mock` and `calls` (`testing.ista`, 4 declarations) and `test/corpus/packs/`.
- **Duplication** the redesign deletes rather than tidies:
  - the guard "a pack binds only what fills one", written three times (`inference/fillings.ts`,
    `inference/binding.ts`, `choosing/applicability.ts`);
  - "is a pack" read off the syntax node in several places;
  - a parameter's rest kind, derived three times (`signatures.ts`, `lambdas.ts`,
    `value-calls.ts`);
  - two `packOf`s.

## The changes

| # | Change | Where | Size |
|---|---|---|---|
| 1 | **Products by position** (structural). `struct-keys.ts`, already the one home for keys, reads a tuple's keys as Int literals in position order. `KeysType`'s left-out names become keys. A mapped type over a tuple's keys reduces to a tuple. Field loops (checker `constructs/loops/field-passes.ts`, lowering alike) and `t[i]` accept a tuple. A tuple comprehension. | `types/traits/struct-keys.ts`, `type/computed-types.ts`, `type/type-rules.ts`, field passes, comprehensions | medium |
| 2 | **Tuple constraint.** `A is tuple { … }` in the constraint model beside struct constraints (`type/struct-constraint.ts`, `traits/known-constraints.ts`). `isPack` and its special cases go: a rest's type is an array or a tuple type, constraints and defaults allowed, declarable on types. Most of 5080–5087 become ordinary constraint failures. | parser, constraints, `resolution/choosing/packs.ts`, signatures, lambdas, value calls | medium, net deletion |
| 3 | **Spread tuples.** A tuple type's elements may hold one spread of an opaque tuple, `(X, ...A, Y)`, normalized at construction: a concrete spread flattens, as `withPack` does now. A function type's parameters end in one, replacing `FunctionType.pack`. At most one opaque spread per list, so inference always splits a fixed prefix, the spread and a fixed suffix. A spread relates exactly, as a pack does today. | `type/index.ts`, `function-types.ts`, parts, keys, text, `relate.ts`/`equal.ts` | medium |
| 4 | **Inference through a homomorphic mapped type.** Relating a known product, a struct or a tuple, to `{ [K in keyof S]: G<S[K]> }` binds `S` to a product of fresh variables, one per key, each related through `G`. Today a mapped type is opaque to inference (`inference/equal.ts`). This serves structs too, e.g. a `Group<M>`-style parameter written as a mapping. | `types/inference/` | medium |
| 5 | **Pointwise variance of a homomorphic mapped type**, instead of invariant, for structs and tuples alike: `{ [I in keyof A]: Array<A[I]> }` is covariant in `A`. Needed for `<gives A is tuple>` on a type. | `types/variance/usage-walk.ts` | small |

Spec: §3.1 (keys, mapped types), §3.5 (packs rewritten as tuple constraints), §3.14, §3.15
(tuples as products), §4 (field loops and comprehensions over tuples).

**Total:** three phases, about I2's size. Changes 1 and 2 are structural and come first. Change 3
replaces the pack field. Changes 4 and 5 are behavioural.

## What stays out

- **Recursion over a pack** (`(h, ...t)` patterns, head/tail type `match`): a body is checked
  once, and an opaque tuple of unknown length chooses no base case. A field loop covers maps and
  per-element work; a fold whose type changes per step doesn't fit. So **`setups`** (5
  overloads, a fold over CPS setups) is declared once with changes 1–4 and implemented natively, or
  stays overloads.
- **Two opaque spreads in one list:** TypeScript can't infer them either.

## Consumers

- Mixed-type combinators, `all(fs)` giving a tuple of results: a tuple comprehension
  `(for i, f in ...fs: await f)` over `{ [I in keyof A]: Future<A[I], K> }`, written in Ista with
  changes 1–4.
- `setups` declared once.
- Typed field-wise helpers shared by structs and tuples (equality, JSON, forms over a tuple).
- **Proposal 8 needs none of it:** its combinators are single-type, over
  `...fs: Array<Future<T, K>>`.

## Order

- **After C3 and C4,** which touch the same computed-type and inference code: C4 makes a mapped
  expected type wait on its keys, and removes `equal.ts`'s own `isOpaque`.
- **Independent of proposal 8.** It can precede it and is better before F28:
  - change 3 rebuilds function types' parameters, while proposal 8 rebuilds their result's kind;
    either rebases on the other, and proposal 8's single constructor then normalizes the final
    shape;
  - change 3 removes `relate.ts`'s "a function ending in a pack relates by equality" special case
    before F28 moves function-type fitting into the relation.
- **Within:** 1 ∥ 2 (disjoint files), then 3, then 4, then 5.

## Decisions for the human

1. **A pack is a tuple-constrained parameter** (`A is tuple`), superseding F26's `<each A>`.
   Recommended. The alternative is Swift's `each`/`repeat`, a second mapping mechanism.
2. **How a mapped tuple is spelled:**
   - `{ [I in keyof A]: G<A[I]> }`, with the keys' owner deciding tuple or struct, as TypeScript
     does;
   - or a positional spelling, `( [I in keyof A]: G<A[I]> )`.
   The parentheses are recommended: braces build a struct everywhere else.
3. **How a tuple comprehension is spelled,** e.g. `(for i, v in ...t: expr)`, beside
   `[for …]` and `struct{for …}`.
4. **`setups`:** declared once with a native body, or kept as overloads.
