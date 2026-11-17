---
description: Completion scenarios — statements, expressions, scope, collections, control flow, patterns; each scenario's snippet, trigger, expected items, what accepting inserts, and today's status through ista lsp; read when changing or testing completion
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-10
last_updated: 2026-11-10
tags: [plan, completion, lsp]
---

# Completion scenarios: statements, expressions, scope, collections, control flow, patterns

Conventions, fixture and legend: `scenarios.md`. Status is ✅ when the probe's assertions for the scenario hold today, ❌ when any fails (`Today` gives the first reasons).

## ST: Statements

The start of a statement and the words that follow statement keywords (§3.4, §4, §6, §7).

### ST-01 · Blank line in a function body · P1 · ✅ pass

```
  ‸
---
  let y = 1
  ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Visible names (parameters, locals, the module's functions and types, namespaces), statement keywords `let const if for while match select return drop hold`, expression keywords `true false none not fn new struct` (`struct{…}`, an anonymous struct, starts an expression).
- **Not:** Declaration keywords `enum trait import extern`; clause words `case in is and or as`; `elif`/`else` unless an `if` block just ended (ST-02); bare enum variants (`Red`: no enum type is expected, §3.11); `break`/`continue` outside a loop; `await` outside an `async fn`.
- **Accept:** The word or name alone.
- **Basis:** spec §4, §3.11; TS offers only keywords the grammar accepts at the position.

### ST-02 · `elif` and `else` after an `if` block · P1 · ✅ pass

```
  if n:
    1
  ‸
---
  if n:
    1
  elif o:
    2
  ‸
---
  if n:
    1
  ‸x
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Besides ST-01, `elif` (while the chain has no `else`) and `else`, whatever follows the cursor on its line.
- **Not:** `elif`/`else` when the previous block is not an `if` chain or already has `else`.
- **Basis:** spec §4 (`if`/`elif`/`else`); the editor's offside rule puts them at the `if`'s indentation.

### ST-03 · `else` is offered nowhere else · P2 · ✅ pass

```
  while n:
    1
  ‸
---
  if n:
    1
  else:
    2
  ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** ST-01 minus `else`/`elif`.
- **Not:** `elif`, `else`.
- **Basis:** spec §4.

### ST-04 · Inside a `match` body · P1 · ✅ pass

```
  match d:
    ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `case`: only `case` clauses stand in a `match` body.
- **Not:** Names, other keywords.
- **Accept:** `case ` with the trailing space, re-triggering pattern completion (PA-01).
- **Basis:** spec §3.11, §4.

### ST-05 · Inside a `select` body · P1 · ✅ pass

```
  select:
    ‸
---
  select:
    case work(1) as v: v
    ‸
```
- **Where / trigger:** in `async fn t`; invoked, or typing on
- **Offer:** `case`, and `else` for a non-awaited `select`.
- **Not:** Names, statement keywords.
- **Basis:** spec §6.

### ST-06 · Loop-only and async-only keywords · P2 · ✅ pass

```
  while n:
    ‸
---
  for i in xs:
    ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** ST-01 plus `break`, `continue`.
- **Basis:** spec §4 (labels, `break`, `continue`).

### ST-06b · `await` only where it may stand · P2 · ✅ pass

```
  ‸
```
- **Where / trigger:** in `async fn t`; invoked, or typing on
- **Offer:** ST-01 plus `await` in an `async fn`; (the sync `fn` of ST-01 has none).
- **Basis:** spec §6 (only an `async fn` may `await`).

### ST-07 · Declaring names after `let`, `const`, `for`, `hold` · P1 · ✅ pass

```
  let ‸
---
  const ‸
---
  let a, ‸
---
  for ‸
---
  for i, ‸
---
  hold let ‸
---
  hold const ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Nothing: the name is declared (for `hold`, the words `let`, `const`).
- **Not:** Values, types, functions.
- **Basis:** declaring position.

### ST-08 · After `for x` · P2 · ✅ pass

```
  for x ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `in`.
- **Not:** Everything else.
- **Basis:** spec §4.

### ST-09 · After the iterable and a range · P3 · ✅ pass

```
  for i in 0..10 ‸
---
  for i in xs[0] ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `by` after a range; nothing after an element (after a name, EX-02b).
- **Not:** Names.
- **Basis:** spec §4 (`by`).

### ST-10 · Value of `for`, `while`, `if`, `match`, `return`, `drop` · P1 · ✅ pass

```
  for i in ‸
---
  while ‸
---
  if ‸
---
  elif ‸
---
  match ‸
---
  drop ‸
---
  return ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Expression start (EX-01).
- **Not:** Statement keywords, declaration keywords, clause words.
- **Basis:** spec §4.

### ST-11 · `break` and `continue` labels · P2 · ✅ pass

```
  outer: for i in xs:
    for j in xs:
      break ‸
---
  outer: for i in xs:
    continue ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** The labels of the loops around: `outer`.
- **Not:** Everything else; labels of other functions or finished loops.
- **Basis:** spec §4 (labels).

### ST-12 · `hold(` label · P3 · ✅ pass

```
  outer: for i in xs:
    hold(‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Labels of the enclosing blocks.
- **Not:** Everything else.
- **Basis:** spec §3.4.

### ST-13 · `spawn` · P2 · ✅ pass

```
  spawn ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-02b: `spawn` is a prelude function, a deferred call's taker, so a name starts the call it is given (`work`, `fetch`), beside the infix words.
- **Not:** Statement keywords, `if`.
- **Basis:** spec §3.14, §9 (`spawn f(args)`).

### ST-15 · After `;` and inside `{ }` blocks · P2 · ✅ pass

```
  const a = 1; ‸
---
  const a = { const b = 1; ‸ }
---
  if n: { ‸ }
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** ST-01.
- **Not:** ST-01's.
- **Basis:** spec §4 (`;` separates statements, `{ … }` blocks).

### ST-16 · One-line body · P2 · ✅ pass

```
  if n: ‸
---
  while n: ‸
---
  for i in xs: ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** ST-01 (a one-line body is a statement).
- **Not:** ST-01's.
- **Basis:** spec §4.

### ST-17 · Assignment target · P2 · ✅ pass

```
  p.first = ‸
---
  xs[0] = ‸
---
  n += ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Expression start with the target's type expected (ET-06).
- **Not:** Statement keywords.
- **Basis:** spec §3.4, §3.7.

## EX: Expressions

Where an expression starts, continues or is complete (§4).

### EX-01 · Where an expression starts · P1 · ✅ pass

```
  let x = ‸
---
  const x = (‸
---
  let x = 1 + ‸
---
  let x = not ‸
---
  let x = -‸
---
  let x = a ?? ‸
---
  let x = [1, ‸]
---
  return plus(‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Parameters, locals, functions, types (they begin a literal or a static call), namespaces, `true false none not fn async await if match select new struct`.
- **Not:** Statement keywords `let const for while return drop hold`; declaration keywords; clause words `case elif else in is and or as`; bare variants (`Red`); the names of declarations that are not values.
- **Accept:** The name alone; a function adds no `(`unless it is a snippet, see OR-04.
- **Basis:** spec §3.11, §4; TS/RA offer only what continues an expression.

### EX-02 · After a complete operand · P1 · ✅ pass

```
  let x = xs[0] ‸
---
  let x = "a" ‸
---
  if n + 1 ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** The words that continue an expression: `and`, `or`, `is`, `in` (operator characters are typed, not completed).
- **Not:** Every name; keywords that cannot follow an operand (`let`, `return`, `else` …).
- **Accept:** The word.
- **Basis:** spec §4 operators; a name follows only an operand shaped as a deferred call's taker (EX-02b).

### EX-02b · After a deferred call's taker · P1 · ✅ pass

```
  let x = n ‸
---
  let x = plus(1) ‸
---
  if n ‸
---
  let x = p.first ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-02's words, and the visible names that start the call a deferred call gives the operand (`g f(x)`): EX-01's names.
- **Not:** Keywords that start no call (`let`, `return`, `true`, `if`, `fn` …); nothing right against the operand (NO-07).
- **Accept:** The word or name alone.
- **Basis:** spec §3.14 deferred calls: a name, or a path of names maybe called, then on its line a call.

### EX-03 · After `and`, `or`, `is`, `in`, `??`, `..` · P1 · ✅ pass

```
  let x = n and ‸
---
  let x = n or ‸
---
  let x = n in ‸
---
  let x = o ?? ‸
---
  let x = 0..‸
---
  let x = 0..=‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01 (for `is`: patterns, PA-10).
- **Not:** EX-01's.
- **Basis:** spec §4.

### EX-04 · After `await` · P2 · ❌ fail

```
  let x = await ‸
```
- **Where / trigger:** in `async fn t`; invoked, or typing on
- **Offer:** EX-01; futures first (calls of `async fn`s: `fetch`, `work`).
- **Not:** EX-01's.
- **Order:** `async` functions, then locals of type `Future`, then the rest.
- **Basis:** spec §6; ranking by expected type, as TS ranks Promises after `await`.
- **Today:** fetch ranks 18, not in the first 5; work ranks 29, not in the first 5

### EX-05 · After `*` · P3 · ✅ pass

```
  let x = *‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Shared-struct values (`l`) first.
- **Basis:** spec §3.18.

### EX-05b · After `&` · P3 · ✅ pass

```
  let z = 1
  let y = plus(&‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Variables that may change: `let`s (`z`) and reference parameters.
- **Not:** Constants, by-value parameters (`n`).
- **Basis:** spec §3.3 (a by-value parameter can't be passed by `&`), §3.7.

### EX-06 · Inside a block expression · P2 · ✅ pass

```
  const a = { const b = 1; b + ‸ }
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01, `b` visible.
- **Not:** EX-01's.
- **Basis:** spec §4.

### EX-07 · Named lambda sees itself · P2 · ✅ pass

```
  const fact = fn f(n: int) -> int: ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01 with `f` and `n` visible.
- **Not:** EX-01's.
- **Basis:** spec cheat sheet (`const fact = fn f(n: int)`: "f calls itself").

## SC: Scope

Which names are visible at the cursor (§3.4, §3.6, §3.13).

### SC-01 · Parameters · P1 · ✅ pass

```
  ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Every parameter once.
- **Basis:** spec §3.3.

### SC-02 · Locals declared above · P1 · ✅ pass

```
  let a = 1
  const b = 2
  const (c, d2) = (1, 2)
  ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `a`, `b` and the destructured names `c`, `d2`.
- **Basis:** spec §3.4, §3.15.

### SC-03 · Locals declared below · P1 · ✅ pass

```
  ‸
  let later = 1
  later
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Nothing named `later`.
- **Not:** `later`.
- **Basis:** spec §3.4 (blocks are sequential).

### SC-04 · The variable being declared · P1 · ✅ pass

```
  let y = ‸
---
  const y = 1 + ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01 without `y`.
- **Not:** `y`.
- **Basis:** a name enters scope after its initializer (TS flags use-before-define; RA/Kotlin exclude it).

### SC-05 · After a nested block ends · P1 · ✅ pass

```
  if n:
    let inner = 1
  ‸
---
  { const inner = 1 }
  ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** No `inner`.
- **Not:** `inner`.
- **Basis:** spec §3.4 (block scope).

### SC-06 · Loop variable · P1 · ✅ pass

```
  for i in xs:
    ‸
    1
---
  for k, v in m:
    ‸
    1
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `i` (and `k`, `v`) inside the body.
- **Basis:** spec §4.

### SC-06b · Loop variable after the loop · P1 · ✅ pass

```
  for i in xs:
    1
  ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** No `i`.
- **Not:** `i`.
- **Basis:** spec §4.

### SC-07 · Loop variable in its own iterable · P2 · ✅ pass

```
  for i in ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01 without `i`.
- **Not:** `i`.
- **Basis:** scoping, as SC-04.

### SC-08 · Lambda parameters · P1 · ✅ pass

```
  const f = fn(q): ‸
---
  const f = fn q: ‸
---
  const f = fn(q: int): { ‸ }
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `q` in the body.
- **Basis:** spec §3.14.

### SC-08b · Lambda parameter outside · P1 · ✅ pass

```
  const f = fn(q): q
  ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** No `q`.
- **Not:** `q`.
- **Basis:** spec §3.14.

### SC-09 · Match arm bindings · P1 · ✅ pass

```
  match d:
    case Approved(by): ‸
---
  match d:
    case Rejected(_, why): ‸
---
  match o:
    case Int as count: ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** The arm's bindings: `by`, `why` (not `reason`), `count`.
- **Not:** Bindings of other arms; the field's own name where another binds it.
- **Basis:** spec §3.11.

### SC-09b · Arm bindings stay in their arm · P1 · ✅ pass

```
  match d:
    case Approved(by): 1
    case Expired: ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** No `by`.
- **Not:** `by`.
- **Basis:** spec §3.11.

### SC-10 · Guard sees the arm's bindings · P1 · ✅ pass

```
  match d:
    case Rejected(_, why) if ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `why`.
- **Not:** `reason`.
- **Basis:** spec §3.11.

### SC-11 · `is` binds on the right of `and` and in the body · P1 · ✅ pass

```
  if r is Ok(y) and ‸
---
  if r is Ok(y):
    ‸
    1
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `y`.
- **Basis:** spec §3.11 (`is` outside `match`).

### SC-11b · `is` bindings are not there after `or`, or in `else` · P1 · ✅ pass

```
  if r is Ok(y) or ‸
---
  if r is Ok(y):
    1
  else:
    ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** No `y`.
- **Not:** `y`.
- **Basis:** spec §3.11 ("`or` can't introduce bindings").

### SC-12 · Top-level names in any order · P1 · ✅ pass

```
  ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** The functions and types declared above and below the cursor's function, and `t` itself.
- **Basis:** spec §3.

### SC-12b · Declared below · P1 · ✅ pass

```
  ‸
fn later() -> int: 1
struct Late { a: int }
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `later`, `Late`.
- **Basis:** spec §3 (module level is order-independent).

### SC-13 · Local functions are not hoisted · P2 · ✅ pass

```
  ‸
  fn inner() -> int: 1
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** No `inner` above its declaration.
- **Not:** `inner`.
- **Basis:** guide L3 ("Local functions aren't hoisted").

### SC-13b · Local functions below their declaration · P2 · ✅ pass

```
  fn inner() -> int: 1
  ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `inner`.
- **Basis:** spec §3.14.

### SC-14 · Own private names · P1 · ✅ pass

```
  ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** The module's own `_hidden`.
- **Basis:** spec §3.13 (`_` is private to its module).

### SC-14b · Other modules' private names · P1 · ✅ pass

```
  time.‸
```
- **Where / trigger:** in `fn t`; typing `.`
- **Offer:** No `_`-prefixed export.
- **Not:** Any `_name`.
- **Basis:** spec §3.13.

### SC-15 · Prelude and namespaces · P1 · ✅ pass

```
  ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `panic Array Optional Result time` (the prelude needs no import).
- **Not:** The prelude's variants bare (`Ok Err`): no enum type is expected (§3.11).
- **Basis:** spec §3.8.

### SC-16 · One entry per name · P1 · ✅ pass

```
  const xs = [1]
  ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** A shadowed name once, as the innermost binding (`xs: Array<int>`, not the parameter).
- **Not:** Duplicates.
- **Basis:** LSP clients show duplicates verbatim; TS/RA list the visible binding only.

### SC-17 · `self` · P1 · ✅ pass

```
fn Pair.double(self: Pair) -> int:
  ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** `self`.
- **Basis:** spec §3.7.

### SC-18 · Type parameters as values · P2 · ✅ pass

```
fn g<T>(x: T) -> int:
  ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** `T` (its statics are reached through it).
- **Basis:** spec §3.10.

### SC-19 · Other functions' locals and parameters · P1 · ✅ pass

```
fn other(zzz: int) -> int:
  let qqq = 1
  qqq
fn g() -> int:
  ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** Neither `zzz` nor `qqq`.
- **Not:** `zzz`, `qqq`.
- **Basis:** scoping.

### SC-20 · Comprehension variable · P1 · ✅ pass

```
  const e = [for x in xs: ‸
---
  const e = [for x in xs if ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `x`.
- **Basis:** spec §4.

### SC-21 · `hold let` · P2 · ✅ pass

```
  hold let pending = 0
  ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `pending`.
- **Basis:** spec §3.4.

### SC-22 · Imports in scope · P1 · ✅ pass

```
import delay from 'time'
fn g():
  ‸
---
import * as tm from 'time'
fn g():
  ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** `delay`; `tm` (and not `time`, which this file did not bind).
- **Basis:** spec §3.13.

## CO: Collections, lambdas, templates

§2, §3.14, §4.

### CO-01 · Array and map literals · P1 · ✅ pass

```
  const a = [‸
---
  const a = [1, ‸
---
  const a = [...‸
---
  const a = ["k": ‸
---
  const a = [1, 2][‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01; after `[` also `for` (comprehension) and `...`.
- **Not:** Statement keywords other than `for`; clause words.
- **Basis:** spec §2.

### CO-02 · Spread · P2 · ❌ fail

```
  const a = [...‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Arrays first (`xs`).
- **Order:** Values of an array type first.
- **Basis:** spec §2.
- **Today:** xs ranks 12, not in the first 3

### CO-03 · Tuples and ranges and slices · P1 · ✅ pass

```
  const t = (1, ‸
---
  const r = 0..‸
---
  const s = xs[1..‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01.
- **Not:** Statement keywords.
- **Basis:** spec §2, §3.15.

### CO-04 · Comprehension · P1 · ✅ pass

```
  const e = [for x in xs if ‸
---
  const e = [for x in xs: ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01 with `x`.
- **Not:** Statement keywords.
- **Basis:** spec §4.

### CO-04b · Comprehension binder · P1 · ✅ pass

```
  const e = [for ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Nothing (declaring).
- **Not:** Everything.
- **Basis:** declaring position.

### CO-05 · Lambda parameters · P1 · ✅ pass

```
  const f = fn(‸
---
  const f = fn ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Nothing: parameters are declared.
- **Not:** Everything.
- **Basis:** declaring position.

### CO-06 · Lambda body · P1 · ✅ pass

```
  const f = fn(q): ‸
---
  const f = fn q: ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01 with `q`.
- **Not:** Statement keywords.
- **Basis:** spec §3.14.

### CO-06b · Lambda annotation · P1 · ✅ pass

```
  const f = fn(q: ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Types.
- **Not:** Values.
- **Basis:** spec §3.14.

### CO-07 · Template interpolation · P1 · ✅ pass

```
  const s = `id ${‸}`
---
  const s = `id ${n} and ${‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01.
- **Not:** Statement keywords.
- **Basis:** spec §2.

### CO-08 · Template text · P1 · ✅ pass

```
  const s = `id ‸`
---
  const s = `${n} ‸ tail`
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Nothing.
- **Not:** Everything.
- **Basis:** text, not code.

### CO-09 · Index · P1 · ✅ pass

```
  xs[‸]
---
  m[‸]
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01; for a `Map` the key type first.
- **Not:** Statement keywords.
- **Basis:** spec §3.9.

## CF: Control flow

§4, §6.

### CF-01 · Condition · P1 · ✅ pass

```
  if ‸
---
  while ‸
---
  if n > 1 and ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01.
- **Not:** Statement keywords.
- **Basis:** spec §4.

### CF-02 · Scrutinee · P1 · ✅ pass

```
  match ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01.
- **Not:** Statement keywords.
- **Basis:** spec §4.

### CF-03 · Select case · P1 · ✅ pass

```
  await select:
    case ‸
---
  select:
    case work(1) as v: v
    case ‸
```
- **Where / trigger:** in `async fn t`; invoked, or typing on
- **Offer:** EX-01 (futures first); a case introduces its binding with `as`.
- **Not:** Statement keywords.
- **Basis:** spec §6.

### CF-04 · After the awaited future · P2 · ✅ pass

```
  select:
    case work(1) ‸
```
- **Where / trigger:** in `async fn t`; invoked, or typing on
- **Offer:** `as`, and EX-02b's names, `work(1)` being shaped as a deferred call's taker.
- **Not:** Keywords that start no call.
- **Basis:** spec §6.

### CF-05 · Binding after `as` · P1 · ✅ pass

```
  select:
    case work(1) as ‸
---
  match d:
    case Approved(by) as ‸
```
- **Where / trigger:** in `async fn t`; invoked, or typing on
- **Offer:** Nothing.
- **Not:** Everything.
- **Basis:** declaring position.

### CF-06 · Result of `await select` · P3 · ✅ pass

```
  const v = await select:
    case work(1): 1
    else: ‸
```
- **Where / trigger:** in `async fn t`; invoked, or typing on
- **Offer:** ST-01.
- **Basis:** spec §6.

### CF-07 · Line-start `case` in a nested match · P2 · ✅ pass

```
  match d:
    case Approved(by):
      match o:
        ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `case`.
- **Not:** Names.
- **Basis:** spec §3.11.

## PA: Patterns

§3.11 patterns, `is`.

### PA-01 · Start of a `case` pattern · P1 · ✅ pass

```
  match d:
    case ‸
---
  match d:
    case Approved(by): 1
    case ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** The scrutinee type's variants, bare (`Approved Rejected Expired`), `true false none` only where the scrutinee's type can hold them (a `Decision` cannot), `_`, and the enum name `Decision`.
- **Not:** Variables, parameters, functions, statement keywords, clause words — a camelCase bare name binds, so naming a variable would be a misreading (§3.11).
- **Accept:** Variant with fields: its call pattern, `Approved($0)`, then its fields' labels (PA-03c). `_`: `_`.
- **Basis:** spec §3.11 (patterns); TS/Kotlin/RA fill match arms from the type.

### PA-02 · Variants already covered come last · P3 · ✅ pass

```
  match d:
    case Approved(by): 1
    case ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** As PA-01.
- **Order:** Uncovered variants before covered ones.
- **Basis:** RA/TS exhaustiveness-aware ordering.

### PA-03 · Braces after a variant's name in a pattern · P1 · ✅ pass

```
  match d:
    case Rejected{‸
---
  match d:
    case Rejected{reason as why, ‸}
---
  if r is Ok{‸
```
- **Where / trigger:** in `fn t`; typing `{`
- **Offer:** No field: a variant is taken apart by its call pattern (PA-03c), and checking refuses braces after its name, naming the call pattern.
- **Not:** `by`, `reason`, `value`.
- **Basis:** spec §3.11 ("Only by its call").

### PA-03c · Field labels in a call pattern · P2 · ✅ pass

```
  match d:
    case Rejected(‸
---
  match d:
    case Rejected("legal", ‸
---
  match d:
    case Rejected(reason: "r", ‸
```
- **Where / trigger:** in `fn t`; typing `,` or a space after it, or invoked; a space after a label's `:` opens the pattern's list
- **Offer:** The labels of the fields no other argument gives, `by:` and `reason:` (after `"legal",`: `reason:`), beside what a pattern there starts with; after a named argument, the labels alone (`by:`), as in a call (§3.3), and those alone while a label is written (`Rejected(rea‸: "r")`), accepting it then writing the name alone.
- **Not:** A field another argument gives by position or name.
- **Accept:** `reason: ` and re-trigger, as a call's argument name does (CA).
- **Basis:** spec §3.11 (call patterns bind as a call's arguments do).

### PA-04 · After a pattern field · P2 · ✅ pass

```
  match cfg:
    case Cfg{note ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `as`, `is`.
- **Not:** Names.
- **Basis:** spec §3.11 (`field as name`, `field is Pattern`; comparisons are operators).

### PA-05 · After `as` in a pattern · P1 · ✅ pass

```
  match cfg:
    case Cfg{note as ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Nothing: the name is declared.
- **Not:** Everything.
- **Basis:** spec §3.11.

### PA-06 · After `is` in a pattern · P2 · ✅ pass

```
  match cfg:
    case Cfg{note is ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** A pattern start (PA-01 rules): `_`, literals.
- **Not:** Variables, functions.
- **Basis:** spec §3.11 ("Only a pattern may follow `is`").

### PA-06b · After `==` in a pattern · P2 · ✅ pass

```
  match cfg:
    case Cfg{note == ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01.
- **Not:** Statement keywords.
- **Basis:** spec §3.11 (`field == expr`).

### PA-07 · `is` outside match · P1 · ✅ pass

```
  if r is ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** PA-01 for the left operand's type: `r` → `Ok`, `Err`, `_`.
- **Not:** Variables, statement keywords.
- **Basis:** spec §3.11.

### PA-07b · `is` on an optional · P1 · ✅ pass

```
  const k = o is ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `o` is an `Int?`: `_`, `Int`, `None`, `none` (a pattern on a union selects a member, §3.11).
- **Not:** Variables, statement keywords.
- **Basis:** spec §3.11.

### PA-08 · Field labels of `Ok` in `is` · P1 · ✅ pass

```
  if r is Ok(‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `value:` and what a pattern there starts with (`_`), as PA-03c.
- **Not:** Scope.
- **Basis:** spec §3.11.

### PA-08b · Fields of an optional's member in `is` · P1 · ✅ pass

```
  if po is Pair{‸
---
  match po:
    case Pair{‸
```
- **Where / trigger:** in `fn t`, `po: Pair?`; typing `{`
- **Offer:** `first`, `second`: a struct pattern on a union takes the member it names apart (§3.11).
- **Not:** Scope.
- **Basis:** spec §3.11.

### PA-09 · Alternatives and nesting · P2 · ✅ pass

```
  match d:
    case Approved(by) | ‸
---
  const c: Cfg = Cfg{note: none}
  if c is Cfg{note is ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** PA-01.
- **Not:** Variables.
- **Basis:** spec §3.11.

### PA-10 · Qualified variants in a pattern · P1 · ✅ pass

```
  match d:
    case Decision.‸
---
  match col:
    case Color.‸
```
- **Where / trigger:** in `fn t`; typing `.`
- **Offer:** The variants.
- **Not:** Scope.
- **Basis:** spec §3.11.

### PA-11 · Literals, tuples, arrays, ranges · P2 · ✅ pass

```
  match n:
    case ‸
---
  match n:
    case 0..=‸
---
  match xs:
    case [first, ...‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `n` is `int`: literal-ish keywords only (none usable beyond `_`); after `..=`, `...` nothing.
- **Not:** Variables.
- **Basis:** spec §3.11.

### PA-12 · Guard · P1 · ✅ pass

```
  match d:
    case Approved(by) if ‸
---
  match n:
    case x if ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01 with the bindings (`by` / `x`).
- **Not:** Statement keywords.
- **Basis:** spec §3.11.

### PA-13 · Arm of a `match` after `:` · P2 · ✅ pass

```
  match d:
    case Expired: ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** ST-16 (a statement or an expression).
- **Not:** Declaration keywords.
- **Basis:** spec §4.

