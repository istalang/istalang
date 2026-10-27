---
description: agreed new language features (rest/named args, `**`, isolate, Instance<T>, hold/labels, templates, docstrings, patterns, `any T`, `!`, bitwise/chains/`in`/step, variadic tuple packs) — per feature the decision, where it lands in the code, and the spec gaps with proposed defaults; read before implementing or examining a language-features phase
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-27
last_updated: 2026-10-28
tags: [plan, language, syntax, checker, runtime]
---

# Language features — decisions, landing points, gaps

Plan and process: `plan.md`. Each phase sweeps its features' gaps with the human first (defaults below), then writes the spec.

## Syntax decided in L0 (human, 2026-10-27)

L0 parses all of it; the owning phase gives each form its meaning and its refusals.

- **Precedence, loosest first:** `??`, `or`, `and`, `not`, comparison (`< <= > >= == != is in not in`), range (`..`, `..=`, `by`), `|`, `^`, `&`, shifts, additive, multiplicative, prefix (`-`, `~`, `await`, `*`, `&`), `**`, postfix (`!`, `?`, calls, members).
- **`**`** groups right; its right operand may be a prefix expression (`2 ** -1`). A prefix operator directly on its left parses and is refused by L5. `**x` in prefix position is two dereferences.
- **Compound assignments** gain `**=`, `&=`, `|=`, `^=`, `<<=`, `>>=`. `>>` and `>>=` split inside type arguments, as `>=` does.
- **Chains:** two or more of `< <= > >= == !=` are one chain node; `is`, `in`, `not in` don't chain. Which mixes are legal is L5's.
- **`not in`** is one operator. The iterable of `for` and of a comprehension stays a full expression: their targets are patterns, so `in` can't be swallowed.
- **`a..b by c`:** `by` is a contextual word after any range; its operand binds as the range's end.
- **`spawn`** binds as JS `new`: a callee (names, members, type arguments) and one argument list, then postfix applies to the instance: `spawn w.run(job).result()` is `(spawn w.run(job)).result()`.
- **Patterns:** `|` anywhere a pattern stands; `A | B as x` is `(A | B) as x`; `x is A | B` takes the whole or-pattern. Arrays `[p, ...rest, q]`, the rest `...name` or `..._`. Range bounds are literals (negative numbers included), either end open.
- **Types:** `any` is a contextual word before a type name; `any A & B`; `any T?` is `(any T)?`. Packs are declared `<...A>`; function types take a rest, `fn(...A) -> R` and `fn(int, ...Array<string>)`.
- **Labels** stand before `for` or `while` only (`outer: for …`); `break outer` and `continue outer` name them on the same line.
- **`hold`:** `hold let|const|_ …` and `hold(name) …`. Unlabelled `hold` is `fn let/const/_` respelled, so it works from L0, and both spellings share one tree field until L4 deletes `fn`'s; `hold(name)` reports 5000 until L4.
- **Named arguments:** `f(name: value)` in any order in the parser (L1 refuses positional after named); `name: &x` is allowed; no shorthand.
- **`x!`** is postfix beside `?`.
- **Templates and docstrings:** L0 declares their node kinds and fields; scanning and parsing them is L6's, which owns multi-line tokens.

## F1 Rest parameters and spread (D67)

- **Decided:** as §3.3 already specifies: `...xs: Array<T>` last, after defaults; `...xs` spreads at a call; fixed arity beats rest.
- **Lands:** parsing exists (`Parameter.isRest`, `Spread`). Checker: the two `frontier` entries go; `resolution/choice.ts` gains the rest slot and a third tie-break tier after "concrete beats generic". Lowering: the caller builds an `array` instruction (spread items exist), so there is no IR change; `extern-key.ts` spells a rest type.
- **Deletes:** `strings.format`'s 7 overloads and `_format` (D193).
- **Gaps:** spread into a non-rest position (default: refused); rest in an `extern fn` (default: allowed, the host gets an array).

## F4 Named arguments; parameters as a struct

- **Decided:** `f(times: 5, backoff: 2s)`, the struct-literal spelling. A function's parameters are modelled as a struct: fields with defaults, the rest parameter as one array field. Call syntax is sugar over it. Names filter overload candidates (Kotlin), and aren't part of a function's identity. Function values have no names, so only direct calls of declared functions take named arguments.
- **One defaults mechanism:** a parameter default becomes what a field default already is (`syntax/field-defaults.ts`, `lowerFieldDefault`): one entry per defaulted parameter, computing it from the ones before. The caller fills each missing parameter, then calls the full entry. The per-arity `f/N` entries (`lowerDefaults`, `instanceKey`'s `/arity`) go. A named function used as a shorter function value keeps one synthesized entry.
- **Structural first:** one signature or slot model replaces the 5 separate arity computations (`choice.ts`, `rules/clashes.ts`, `closures/function-values.ts`, `closures/value-calls.ts`, `lowering/instances.ts`).
- **Gaps:**
  - positional after named (default: refused, as in Kotlin);
  - naming the rest parameter (default: `parts: [..]` is allowed and spreads);
  - `&` parameters, which can't be stored, so the struct is the model and not a value (default: `f(target: &x)` is allowed);
  - naming a method receiver (default: refused);
  - the overload-clash rule, today shapes per arity (default: two declarations clash when some positional call fits both, as today).

## F7 A plain function fits an async function type (D189)

- **Decided:** a plain `fn(A) -> R` fits `async fn(A) -> R`. Calling it gives a future that is already resolved, and the call never suspends.
- **Lands:**
  - The checker records a wrap at the coercion site, as it does for `T`→`T?`.
  - Lowering wraps the value in a closure whose entry is async.
  - Function-type equality is written twice (`types/type.ts` `sameType` and `inference/infer.ts`), so it becomes one function first.
- **Deletes:** the plain halves of `test` (×2), `futures.retry`, `rpc.onMessage` and `fanout.subscribe`.
- **Gaps:** whether `sendable` is kept through the wrap (default: yes).

## F8 `spawn` returns `Instance<T>`; F3 `isolate`

- **Decided:**
  - `spawn f(x)` is an expression of type `Instance<T>`. It isn't must-use, and holding the handle doesn't hold the child, which stays independent.
  - `inst.result()` gives `Future<Result<T>>`.
  - `isolate(f)` is library code over it: `spawn f()`, then `result()`.
- **Lands:**
  - **Production watch resolver:** today only the test world resolves `watch` futures (`scheduler/wake.ts`). A child's end (finished or panicked) becomes an arrival the host delivers to watchers, the way it fills any wait.
  - **Testing:** `testing.Started<R>` becomes `Instance<R>`, with the inspection functions (`idle`, `reaches`, `waitingAt`, `state`) left in `testing`. `start`'s 14 overloads give way to `spawn`.
  - **Structural first:** split the over-cap `scheduler/instance.ts`, `segment/index.ts` and `testing/world.ts`.
- **Gaps decided (human, 2026-10-28, all defaults):** the panic is `Err(Error{message, code: "panic", trace})`; `isolate` terminates a panicked child (a start option), while a plain `spawn`'s stays for an operator; `testing.spawnCrashingEveryAwait(fn(): f(a, b))`; `Instance<T>` is a sendable prelude type compared by identity and never `Encodable`; `isolate` lives in `runtime`; `result()` requires `T is Sendable`; `result()` reports the first end, a terminated instance keeping its panic; a waiting instance names the instances it watches (`watching`) so a host wakes it, the runtime reading the end from the store; under `ista test` a panic some instance waits for through `result()` fails no test (`expectPanic` is library code over it); `testing.InstanceState` gains `Terminated`; a child `isolate` terminated fails no `ista run`.

## F5 `hold`, labels, labelled `break`/`continue`

- **Decided:**
  - `hold _ = x`, `hold let x = …` and `hold const x = …` replace `fn _`, `fn let` and `fn const`. The holdings last until the enclosing function ends.
  - `hold(name) _ = x` holds until the named loop ends, or the enclosing function when `name` is its own name.
  - A name never crosses a function boundary, as `break` doesn't.
  - Labels are written `outer: for …` / `outer: while …`, and give `break outer` and `continue outer`.
- **Lands:**
  - **Syntax:** `VariableDeclaration.heldByFunction` becomes a hold target; `For`/`While`/`Break`/`Continue` get a label.
  - **Parser:** `hold` is a contextual word (`Parser.atWord`), and needs lookahead to tell it from a call `hold(…)`.
  - **Lowering:** `LoopStack` finds a loop by label. `scopeSince(depth)` already unwinds any depth.
  - **IR:** `keep` gains a target scope, because frame-level `kept` only covers the function case. That is an amendment to `definition.md`.
- **Migrates:** every `fn let`, `fn const` and `fn _` in the spec, corpus, spec suites, std and the VS Code grammar. This is a hard switch, since v0.1 has no users.
- **Gaps:** labels on bare blocks (default: no); an unused label (default: warning).

## F6 Template strings; F9 docstrings

- **Decided:**
  - Backticks: `` `…` `` may span lines and interpolate `${expr}`, where each value is `T is Stringable` and goes through `toString`.
  - Tagged form: `` tag`…` `` calls `tag(parts, ...values)`.
  - Docstrings: `"""…"""`, as in Python.
- **Lands:**
  - **Scanner:** the scanner stays context-free. A template is one token carrying its parts, and the parser re-scans each `${…}` body, as it already re-reads `t.0.1`.
  - **Multi-line tokens:** these touch the losslessness kit (`scan.test-kit.ts`), `firstOnLine` and layout. The tests pinning a backtick as `unknown` change.
  - **Checker:** interpolation is a new implicit-call role (`ImplicitCalls`). `wellKnown.stringable`, dead today, gets its first user.
  - **Docstrings** attach where annotations do (`parser/layout.ts`), as a `doc` field. The checker ignores them; M6 and M7 read them.
- **Depends on F1 and F11:** tagged templates take `...values: Array<any Stringable>`, so they come last.
- **Gaps:**
  - multi-line indentation (default, as in Swift: drop the newline after the opening backtick, and remove the indentation the lines share);
  - escapes (default: today's escapes, plus `` \` `` and `\${`);
  - where a docstring stands (default: the first line of a function, struct, enum or trait body, or of a module);
  - field docstrings (default: no);
  - `strings.format` kept for templates from data (default: yes).

## F10 Patterns: or, array, range

- **Decided:** `case A | B:`, `[first, ...rest]`, `case 1..=5:`. Struct destructuring already exists (§3.15).
- **Lands:**
  - **Syntax and parser:** a pattern node per form; `|` is a new token, shared with F13.
  - **Binder:** both alternatives bind the same names.
  - **Checker:** an or-pattern expands into several exhaustiveness rows; an array gets constructors indexed by length; a range is a guard shape.
  - **Lowering:** the tests for length and range are new `PatternTest`s.
- **Gaps:**
  - or-patterns in `let` targets (default: refused, since they can fail);
  - the rest in the middle, `[a, ...mid, z]` (default: allowed);
  - range patterns on `float` or `string` (default: `int` only);
  - open ranges `..5` (default: allowed).

## F11 Trait objects `any T` (enum dispatch)

- **Decided:**
  - `any T` and `any A & B` are types.
  - The checker treats them as open: no exhaustiveness, and sendable only through an explicit `& Sendable`.
  - Lowering closes the set over the whole program: one synthesized enum per trait set, one variant per concrete type (one per instantiation for a generic coercion), and dispatch through `branchOnVariant` to that type's monomorphized witness.
  - A value is wrapped wherever it becomes `any T`.
  - Object safety: no static requirements, and `Self` only as the receiver. Generic methods are allowed.
  - `==` compares the type, then the value. JSON refuses `any`.
  - `case Email{to}` on an `any Notifier` downcasts, and needs `case _`.
- **Lands:**
  - **Checker:** a new `Type` kind. The silent `default`s over `Type` (`types/held.ts`, `resolution/candidates.ts` `staticTargetOf`) become exhaustive first.
  - **Parser:** reuses the constraint list that type parameters parse (`A & B`).
  - **Lowering and Definition:** synthesized enum types in the types table. Variants are positional within one Definition, which is enough because snapshots are tied to their version.
  - **Spec:** §3.10 and its "no dynamic dispatch" paragraph are rewritten.
- **Gaps:** reading a trait's required fields through `any` (default: allowed, read-only); `any T` as a map key (default: yes, by `==`).

## F12 Postfix `!`

- **Decided:** `x!` on a `T?` gives the value, or panics on `none`.
- **Lands:** a new punctuator, so the test pinning `!` as unknown changes. A postfix parselet like `?`. The checker uses `optionalInner`. Lowering is `branchOnVariant` and calls `panic`, with no new instruction.
- **Gaps:**
  - `a?.b!` (default: `!` applies to the whole chain before it);
  - the message (default: `"force-unwrapped none"` plus the location);
  - `x!=y` scans as `!=` (stated in the spec).

## F14 Variadic generics, level 1 (tuple packs)

- **Decided:**
  - A type parameter may stand for a tuple of types, used as `...args: A` in a parameter list and as `fn(...A) -> R` in a function type.
  - In a generic body a pack is opaque. It can only be spread into a call (`f(...args)`), kept as the tuple it is, or used in a function type.
  - Mapped packs (`each T is Stringable`, `...Future<T>`) are out of scope.
- **Lands:** the checker only. Function types and parameter slots get a pack form on L1's signature model. Substitution turns `fn(...(int, string))` into `fn(int, string)`. Inference binds `A` by matching parameter lists. Overloads use "fixed arity beats a pack".
  - Nothing in lowering, the runtime or snapshots: functions are compiled per instantiation, so a pack is a concrete tuple before lowering.
- **Deletes:** `mock`'s and `calls`'s 28 overloads; `calls()` records a tuple for every arity.
- **Gaps:**
  - how a pack type parameter is declared (default: `<...A>`);
  - a pack beside an `Array` rest parameter (default: refused);
  - named arguments into a pack (default: refused, since packs have no names).

## F2 `**`; F13 bitwise operators, chained comparisons, `in`, range step

- **`**`:**
  - Right-associative and binds tighter than `*`. A unary operator directly on its left operand is a syntax error, as in JS.
  - Calls `power`, with the trait `Powerable`. `**=` is included.
  - `int ** int` panics on a negative exponent.
  - `math.pow` and `decimal.pow` become `power` overloads in their modules, and `pow` goes, so there is one home.
- **Operator table as data first:** associativity, the function name and post-parse operand rules (today's hard-coded `??` rule) move into `syntax/operators.ts`. The checker's `operatorFunctions` and lowering's switch are derived from it; operator names are spelled in three places today.
- **Bitwise:**
  - Operators `&`, `|`, `^`, `~`, `<<`, `>>`, on `int` only, with Python's semantics for negative numbers.
  - Precedence as Python: shifts below additive, then `&`, `^`, `|`, all above comparison.
  - `>>` is split inside type arguments, as the cursor already splits `>=`.
  - Infix `&` beside a reference argument `&x` is told apart by position.
- **Chains:** `a < b <= c` evaluates `b` once. Today it parses silently as `(a < b) <= c`.
- **`in`:** the iterable of `for` and of a comprehension is parsed at range level, so `in` can't swallow it.
- **Range step:** `0..10 by 2`, where `by` is a contextual word and `Range` gains a `step`.
- **Gaps:**
  - the bitwise function and trait names (default: one trait `Bitwise` with `bitAnd`, `bitOr`, `bitXor`, `bitNot`, `shiftLeft`, `shiftRight`);
  - which comparisons chain (default: only ordering comparisons in one direction; other mixes are an error);
  - what `in` calls (default: `contains(container, item)` with a trait `Container<T>`, for arrays (element), maps (key), strings (substring) and ranges; `not in` included);
  - steps (default: a negative step needs `start > end`; slicing with a step is allowed).
