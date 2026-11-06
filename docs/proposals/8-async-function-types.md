---
description: proposal 8 of docs/proposals, for one function type per call result — `async fn(A) -> R` and `fn(A) -> Future<R>`, two types today that a caller can't tell apart, become two equal spellings of one type; an async declaration may write its result either way; the formatter writes `fn(A) -> Future<R>` and `-> Future<R>`; `async` stays the mark of a body that may await — the rules, behaviour and power changes, spec edits and implementation notes; read before specifying or implementing it, or changing function types, async functions or their lowering
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-05
last_updated: 2026-11-05
tags: [proposal, language, types, async, functions]
---

# Proposal: one async function type, two spellings

Today a function whose call gives a `Future<R>` has two types: `async fn(A) -> R`, the type of an async function, and `fn(A) -> Future<R>`, the type of a plain one returning a future. A caller can't tell them apart: both calls give a `Future<R>`, and `await` reads both. Yet only the plain function converts into the other (§3.14), so an async function passed where `fn(A) -> Future<R>` is expected is error 5001. An agent's FormBuilder typed every async callback `fn(Sc) -> Future<T>` (`docs/review/guessed-forms.md`), and so would most readers of TypeScript.

The human decided:
- the two are one type, with both spellings kept and completely equal;
- declarations keep both spellings too;
- the formatter writes the spelling this proposal recommends.

Section numbers refer to `docs/spec.md`.

```python
async fn fetch(id: String) -> Future<Order>: …          # as today
async fn lookup(id: String) -> Order: …                  # the same, written by what the body gives

fn retry(times: Int, call: fn(String) -> Future<Order>) -> fn(String) -> Future<Order>: …

const safe = retry(3, fetch)                              # an async function fits
const quick = retry(3, fn(id): Order{id})                 # a plain one too, resolved at once
const later = retry(3, async fn(id): await fetch(id))     # and an async lambda
```

## Rules

- **One type, two spellings.** `async fn(A) -> R` is exactly `fn(A) -> Future<R>`: one type, written either way, in every type position. They are equal under `==` of types, in overloads and clashes (§3.7), in fitting and inference, and in extern keys. `sendable async fn(A) -> R` is `sendable fn(A) -> Future<R>` alike. Each spelling is sugar for the other, so `async fn(A) -> Future<X>` is `fn(A) -> Future<Future<X>>`.
- **What has the type.** Any function whose call gives a `Future<R>` has it, whatever its body:
  - an async declaration or lambda;
  - a plain one returning a future, such as `fn start(x: Int) -> Future<Int>: two(x)`, which checks and runs today.

  So an async function fits where `fn(A) -> Future<R>` is expected, and a plain function returning a future fits where `async fn(A) -> R` is.
- **A plain function still fits by conversion.** A `fn(A) -> R` value fits where `fn(A) -> Future<R>` is expected. Its call gives a future already resolved and never suspends, as today's conversion of a plain function into an async one does. As today, the conversion fits the value passed or assigned, not one inside another type: an `Array<fn()>` isn't an `Array<fn() -> Future<Unit>>`.
- **`async` marks a body.** On a declaration or a lambda, `async` says the body may `await` (§5), as today. It is no part of the type. A plain `fn` body still can't `await`, whatever its result type.
- **An async header writes its result either way.**
  - `async fn f(x: A) -> Future<R>`, as today, writes what a call gives.
  - `async fn f(x: A) -> R` writes what the body gives. Today this is error 5021.
  - Either way the call gives `Future<R>` and the body is checked against `R`.
  - The reading is decided by the written text, so it never depends on what a name resolves to: a result spelled `Future<…>` is what the call gives, and any other result is what the body gives. A future of a future is therefore written `-> Future<Future<X>>`, as today. The same holds for an async lambda that writes its result.
  - A plain header, `fn f(x: A) -> Future<R>`, stays a plain function returning a future: its body gives the `Future<R>`.
- **Calling one** gives the `Future<R>` and starts an async callee right away inside the caller's segment, as a direct call does (§3.3). No call changes behaviour; only which values fit where.
- **The formatter writes one spelling** (decided as recommended):
  - **Types:** `fn(A) -> Future<R>` (and `sendable fn(A) -> Future<R>`), so a type shows what a call gives.
  - **Async headers:** `-> Future<R>`, as declarations are written today.

  Both rewrites are syntactic, and safe since the header rule reads the text. Messages, hovers, signature help, inlay hints and extern keys print the same spelling.

## What changes in behaviour

| Code | Today | Proposed |
| --- | --- | --- |
| `retry(3, fetch)`, `call: fn(String) -> Future<Order>` | error 5001: expected `fn(String) -> Future<Order>`, found `async fn(String) -> Order` | fits |
| `retry(3, async fn(id): await fetch(id))` | errors 5001 at the lambda and inside its body | fits |
| `retry(3, fn(id): Order{id})` | error 5001 inside the body: expected `Future<Order>`, found `Order` | fits: a resolved future |
| `call: async fn(String) -> Order` as a parameter's type | the async function type | the same type as `fn(String) -> Future<Order>`; `ista fmt` writes that |
| `takesAsync(start)`, `start` a plain function returning a `Future<Int>`, `f: async fn(Int) -> Int` | error 5001 | fits |
| `async fn two(x: Int) -> Int: x * 2` | error 5021: an async function returns a Future, not Int | a `fn(Int) -> Future<Int>`; `ista fmt` writes `-> Future<Int>` |
| `async fn two(x: Int) -> Future<Int>: x * 2` | as written | unchanged |
| `fn f(x: Int) -> Future<Int>: await g(x)` | error 5022: `await` is allowed only inside an async function | unchanged |
| overloads `f(g: async fn(Int) -> Int)` and `f(g: fn(Int) -> Future<Int>)` | two overloads | they clash: one type |
| hover on `two` | `async fn(Int) -> Int` | `fn(Int) -> Future<Int>` |
| an extern's key with an async function type | spelled `async fn(…) -> R` | spelled `fn(…) -> Future<R>` |

Every program that compiles today compiles unchanged, except overloads that differ only in the spelling of a function type, which now clash.

## What changes in power

**Gained.**
- Any function giving a future fits wherever such a function is expected, whatever its body and whichever spelling the slot uses. Callbacks are typed once, as in TypeScript, Kotlin or Swift.
- An async declaration may write its result as what its body gives, `async fn f() -> R`, as most languages do.
- One function type fewer in the checker and the extern keys, with one printed spelling.

**Not gained.**
- Telling from a type whether calling it may run anything before it returns. That was never observable: a plain function's body may call an async function too.
- A header and a type reading `Future<X>` alike when written with `async`. `async fn f() -> Future<X>` gives a `Future<X>`, while the type `async fn() -> Future<X>` is `fn() -> Future<Future<X>>`, as today. The formatter's spellings never show the type form, so formatted code never meets it.

**Lost.**
- Two overloads told apart only by the spelling of a function type.

## Spec changes

- **Cheat sheet:**
  - The function-types line writes `fn(A) -> Future<R>`, noting `async fn(A) -> R` as its other spelling.
  - The async declaration example shows both headers.
- **§2.**
  - The **Function types** row: `fn(A, B) -> R`, and `async fn(A) -> R`, the same type as `fn(A) -> Future<R>`.
  - The conversions list's "a plain function fits where an async one of its parameters and result is expected" becomes "a plain `fn(A) -> R` fits where `fn(A) -> Future<R>` is expected".
- **§3.3.** "An `async fn` declares its real return type, `Future<T>`" becomes the header rule: the result written either as the call's `Future<T>` or as the body's `T`, decided by whether it is spelled `Future<…>`; its value is a `fn(A) -> Future<T>`.
- **§3.7.** Function types differing only in spelling are one type, so overloads on them clash.
- **§3.14.**
  - **Async function types** becomes the one-type rule: the two spellings, `async` marking a body, an async lambda's written result read as a header's, and the plain-function fit.
  - **Sendable function types:** `sendable async fn(A) -> R` is `sendable fn(A) -> Future<R>`.

## Implementation notes

1. **Checker.**
   - **One type:** the function type (`checker/types/type/index.ts`) drops `isAsync`, so a function's type is its parameters and its result. Both written spellings resolve through the one constructor that builds a function type, which wraps the result of the `async` spelling in `Future`. That normalizes at construction, so nothing downstream sees which spelling was written.
   - **Headers:** an async declaration's or lambda's result is read in one place (`checker/constructs/closures/`, function types of declarations): written `Future<…>`, it is the call's result; otherwise it is the body's, wrapped. Error 5021 goes.
   - **The fit:** the plain-into-async fit (`types/fitting/fit.ts`, the function-type fit) becomes the fit of `fn(A) -> R` into `fn(A) -> Future<R>`.
   - **Clashes** (`rules/clashes.ts`) compare the one type, so a clash by spelling needs no rule of its own.
2. **Parser.** Both spellings parse as today (`parser/grammar/types.ts`). The syntax node keeps whether `async` was written, for the formatter alone.
3. **Formatter.**
   - A function type written `async fn(A) -> R` prints `fn(A) -> Future<R>`.
   - An async header or lambda whose result isn't spelled `Future<…>` prints it wrapped: `-> R` becomes `-> Future<R>`.
   - Both are rewrites of text the formatter already holds (`formatter/types.ts`, `declarations.ts`), and the format-then-parse round trip gives the same type.
4. **Lowering.**
   - **Plain functions:** a plain function value made to fit (`lowering/functions/fits.ts`, `madeAsync`) stays: its entry is async and returns at once.
   - **Async values in plain slots:** an async function's value passed where `fn(A) -> Future<R>` was expected needs no wrapper, since calling an async entry gives its future in any frame.
   - **Type keys:** the `async` flag leaves function type keys (`lowering/tables/type-table.ts`, `lowering/tables/names.ts`) and extern keys (`definition/extern-key.ts`). Entries keep theirs (`synthesized/index.ts`), since an entry is a body.
5. **Definition.** A function type's `async` flag goes from the format (`docs/arch/definition.md`), and every extern key is spelled anew. Nothing is released, so hosts re-key as after proposal 1.
6. **The repository's sources** need no rewrite, since both spellings stay valid. Running `ista fmt` over the repository writes the formatter's spelling: about 140 `.ista` lines spell async function types today.
7. **Tests** (fast-check, beside the code):
   - the two spellings, generated over parameter and result types, give equal types (`typeKey`) and equal behaviour wherever they stand;
   - an async declaration in either header spelling, an async lambda and a plain function each fit a slot of either spelling, and give the same awaited value over generated bodies;
   - calling through a function value equals calling directly, async and plain alike, the commute law of test/AGENTS.md;
   - the formatter's rewrite round-trips to the same types;
   - every row of the behaviour table.

## Decisions (the human's)

1. **The two spellings stay and are completely equal,** in type positions and in async headers alike.
2. **The formatter writes `fn(A) -> Future<R>` for types and `-> Future<R>` in async headers,** as recommended: a type and a header then show what a call gives, and declarations keep the form they are written in today.
