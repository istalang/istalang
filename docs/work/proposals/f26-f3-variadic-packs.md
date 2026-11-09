---
description: analysis of variadic packs beyond level 1 — F26 (`<each A>` respelling) and F3 (level 2, packs mapped through types) — today's implementation, what level 2 needs layer by layer, consumers, size, prior art (Swift, TypeScript, C++), order against proposal 8 and F28, and the decisions left to the human; read before specifying or planning F26 or F3
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-09
last_updated: 2026-11-09
tags: [proposal, checker, generics, packs, variadic, f3, f26]
---

# Variadic packs: F26 and level 2 (F3)

## Today: level 1 (spec §3.5)

- A pack is an ordinary type parameter marked `isPack` (syntax tree), with no type kind of its
  own. A function type carries it in `pack`, and a parameter as `rest: {kind: 'pack'}`.
- Substitution flattens it (`withPack`): `fn(...A)` with `A` as `(Int, String)` is
  `fn(Int, String)`. Lowering compiles per instantiation and passes a pack as single parameters.
- Inference already treats a pack as a tuple variable, bound only by a tuple, `Unit` or a pack. A
  function type ending in a pack relates by equality.
- Opaque in its body: passed, kept, compared, spread only into a rest of the same pack.
  Functions only, with no constraint and no default (5080–5087).
- Uses: `mock` and `calls` (4 declarations, which replaced 28 per-arity overloads), plus the
  corpus in `test/corpus/packs/`.

**Duplication found in passing** (worth one structural cleanup):
- the guard "a pack binds only what fills one" is written three times (`inference/fillings.ts`,
  `inference/binding.ts`, `choosing/applicability.ts`), the last reading the syntax node;
- "is a pack" is read off the syntax node in several places instead of through `isPack`;
- a parameter's rest kind is derived three times (`signatures.ts`, `lambdas.ts`,
  `value-calls.ts`);
- two different `packOf`s (`written/resolve-type.ts`, `choosing/packs.ts`);
- `language-features/features.md` F14 still says "nothing in lowering".

## F26: `<each A>`

`<each A>` declares a pack. `...` stays for expansion: `fn(...A)`, `...args: A`, `f(...args)`.

- **Scope:**
  - The parser takes `each` in the slot `eatVariance` already reserves.
  - The formatter, signature help and the VS Code grammar print and highlight it.
  - Diagnostics' text changes (5080 names `'...A'`).
  - Spec §3.5, §3.14 and §10, and `guide.md`.
  - Respelled: `testing.ista` (4 lines), the packs corpus, and the unit tests' source strings.
- **Size:** small, smaller than V0. With the cleanup above, one structural phase.
- `<gives each A>` means nothing until a type declares a pack (layer 2d below), since a function's
  type parameters take no variance.

## Level 2 (F3): what it needs

Four layers, each usable without the next:

| Layer | What | Where the work is | Size |
|---|---|---|---|
| **2a** Patterns in types | `(...Setup<each A>)`, `fn(...Setup<each A>) -> R`, a rest `...s: (...Setup<each A>)`. Substitution expands a pattern per element. | A type form for an expansion (pattern, packs it mentions), through parts, text, keys, equality and fitting. Inference relates a tuple or arguments to a pattern, one variable per element, then the pack as their tuple. The variance of a pattern is read pointwise. Same shape when a pattern mentions two packs. Clashes. Opacity in the body. | big (like I1) |
| **2b** Constraints | `each A is Stringable`: every element meets it. | Checked per element at a call. In the body, an element's value supports the constraint. | small–medium |
| **2c** Values | `(...p, z)` spreads a pack's value into a tuple literal. `for x in ...xs` is unrolled per instantiation. Recursion over a shrinking pack (`<each A, Z>`). | The body is checked once with an abstract element, the rule that keeps "checked once" sound. Lowering unrolls. The rule against endless instantiations must admit a shrinking pack. | medium–big |
| **2d** Packs on types | `struct Zip<each A>`, `<gives each A>` | Derived variance of a pack. Instantiations' type ids, forms, JSON and persistence. | medium |

- **Monomorphization makes codegen cheap,** as in C++: a pack is a concrete tuple before
  lowering. The cost sits in the checker: element-wise inference, same-shape, and the body checked
  once.
- **Prior art:**
  - **Swift** (SE-0393, 0398, 0399, 0408) took 2018–2024 and still has same-shape surprises and
    no tuple conformances. Its hardest problem was a one-element pack against a scalar, which
    Ista's one-element tuple conversion (§3.15) also faces.
  - **TypeScript** maps over tuples lazily, but can't split two adjacent packs except at a rest
    parameter.
  - No language carries a variance marker on a pack, so `gives each A` is new ground. Pointwise
    from the pattern is the natural rule.

## Consumers

- **`testing.setups`:** 5 overloads (arity 2–6), the only per-arity family left. Its body is a
  fold that appends to a tuple, so writing it in Ista needs 2a and 2c. With 2a alone it becomes a
  native.
- **Mixed-type future combinators** (`all(fa, fb) -> (A, B)`, as TypeScript's `Promise.all`):
  2a over `Future<A, K>`, as externs, or in Ista with 2c.
- **Proposal 8 needs none of it:** its combinators are written once over
  `...fs: Array<Future<T, K>>` (its decision 4).

## Order

- **F26 and the cleanup can run any time, preferably before proposal 8.** It's small, touches the
  parser, the formatter and the pack files (little overlap with C3 and C4), and proposal 8's
  scripted rewrite then meets the final spelling.
- **F3 runs after proposal 8 and F28:**
  - Proposal 8 rebuilds function types (`isAsync` becomes the result's kind, qualifiers, one
    constructor) in `function-types.ts`, where the pack helpers live. 2a adds expansions to the
    same types, so it builds on the final model instead of being re-threaded.
  - F28 moves function-type fitting into the constraint system's relation, where 2a's
    element-wise relation sits (today, "a pack relates by equality").
  - Its consumers have proposal 8's shape: `Setup` is an async CPS type whose kind changes, and
    mixed combinators need `Future<T, K>`.
  - Nothing in proposal 8 waits on it.
- **Within F3:** 2a → 2b → 2c, and 2d only once a type needs a pack.

## Decisions for the human

1. **References inside a pattern:** `each A` marks the element, `(...Setup<each A>)`, while a
   bare `A` stays the whole tuple everywhere (Swift's choice, recommended). Or a bare `A` inside
   `...` means the element, so `A` means two things by context.
2. **2c (values) in F3, or `setups` stays overloads or a native.**
3. **2d (packs on types) deferred** until a type needs one.
4. **One pack per pattern first,** or same-shape for several (`zip`) from the start.
