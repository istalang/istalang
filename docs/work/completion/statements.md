---
description: Completion scenarios — statements, expressions, scope, collections, control flow, patterns; each scenario's snippet, trigger, expected items, what accepting inserts, and today's status through ista lsp; read when changing or testing completion
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-30
last_updated: 2026-10-30
tags: [plan, completion, lsp]
---

# Completion scenarios: statements, expressions, scope, collections, control flow, patterns

Conventions, fixture and legend: `scenarios.md`. Status is ✅ when the probe's assertions for the scenario hold today, ❌ when any fails (`Today` gives the first reasons).

## ST: Statements

The start of a statement and the words that follow statement keywords (§3.4, §4, §6, §7).

### ST-01 · Blank line in a function body · P1 · ❌ fail

```
  ‸
---
  let y = 1
  ‸
---
  if n:
    1
  ‸x
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Visible names (parameters, locals, the module's functions and types, namespaces), statement keywords `let const if for while match select return defer drop hold spawn`, expression keywords `true false none not fn new struct`.
- **Not:** Declaration keywords `struct enum trait import extern`; clause words `case in is and or as`; `elif`/`else` unless an `if` block just ended (ST-02); bare enum variants (`Red`: no enum type is expected, §3.11); `break`/`continue` outside a loop; `await` outside an `async fn`.
- **Accept:** The word or name alone.
- **Basis:** spec §4, §3.11; TS offers only keywords the grammar accepts at the position.
- **Today:** #1 unexpected struct; #1 unexpected enum; #1 unexpected trait; #1 unexpected import; #1 unexpected extern; #1 unexpected case; #1 unexpected in; #1 unexpected is; #1 unexpected and; #1 unexpected or; #1 unexpected as; #1 unexpe…

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
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Besides ST-01, `elif` (while the chain has no `else`) and `else`.
- **Not:** `elif`/`else` when the previous block is not an `if` chain or already has `else`.
- **Basis:** spec §4 (`if`/`elif`/`else`); the editor's offside rule puts them at the `if`'s indentation.

### ST-03 · `else` is offered nowhere else · P2 · ❌ fail

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
- **Today:** #1 unexpected else; #1 unexpected elif; #2 unexpected else; #2 unexpected elif

### ST-04 · Inside a `match` body · P1 · ❌ fail

```
  match d:
    ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `case`: only `case` clauses stand in a `match` body.
- **Not:** Names, other keywords.
- **Accept:** `case ` with the trailing space, re-triggering pattern completion (PA-01).
- **Basis:** spec §3.11, §4.
- **Today:** unexpected xs; unexpected let; unexpected plus; unexpected if

### ST-05 · Inside a `select` body · P1 · ❌ fail

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
- **Today:** #1 unexpected xs; #1 unexpected let; #1 unexpected plus; #2 unexpected xs; #2 unexpected let; #2 unexpected plus

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

### ST-07 · Declaring names after `let`, `const`, `for`, `hold` · P1 · ❌ fail

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
- **Today:** #1 unexpected xs; #1 unexpected plus; #1 unexpected Pair; #1 unexpected if; #1 unexpected true; #1 unexpected let; #1 unexpected while; #2 unexpected xs; #2 unexpected plus; #2 unexpected Pair; #2 unexpected if; #2 unexpected t…

### ST-08 · After `for x` · P2 · ❌ fail

```
  for x ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `in`.
- **Not:** Everything else.
- **Basis:** spec §4.
- **Today:** unexpected xs; unexpected let; unexpected plus

### ST-09 · After the iterable and a range · P3 · ❌ fail

```
  for i in 0..10 ‸
---
  for i in xs ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `by` after a range; nothing after an array.
- **Not:** Names.
- **Basis:** spec §4 (`by`).
- **Today:** #1 unexpected xs; #1 unexpected let; #1 unexpected plus; #2 unexpected xs; #2 unexpected let; #2 unexpected plus

### ST-10 · Value of `for`, `while`, `if`, `match`, `return`, `drop`, `defer` · P1 · ❌ fail

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
  defer ‸
---
  return ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Expression start (EX-01).
- **Not:** Statement keywords, declaration keywords, clause words.
- **Basis:** spec §4.
- **Today:** #1 unexpected let; #1 unexpected const; #1 unexpected while; #1 unexpected for; #1 unexpected struct; #1 unexpected enum; #1 unexpected trait; #1 unexpected import; #1 unexpected extern; #1 unexpected case; #1 unexpected else; …

### ST-11 · `break` and `continue` labels · P2 · ❌ fail

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
- **Today:** #1 offered [Red,Green,Blue,Approved,Rejected,Expired,Some,None] ≠ [outer]; #2 offered [Red,Green,Blue,Approved,Rejected,Expired,Some,None] ≠ [outer]

### ST-12 · `hold(` label · P3 · ❌ fail

```
  outer: for i in xs:
    hold(‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Labels of the enclosing blocks.
- **Not:** Everything else.
- **Basis:** spec §3.4.
- **Today:** offered [Red,Green,Blue,Approved,Rejected,Expired,Some,None] ≠ [outer]

### ST-13 · `spawn` · P2 · ❌ fail

```
  spawn ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Functions (`work`, `fetch`, `plus`…), module functions first; the spawned call must be a function.
- **Not:** Local non-function values, types, keywords.
- **Basis:** spec §6 (`spawn f(args)`).
- **Today:** unexpected xs; unexpected p; unexpected let; unexpected if

### ST-15 · After `;` and inside `{ }` blocks · P2 · ❌ fail

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
- **Today:** #1 unexpected struct; #1 unexpected enum; #1 unexpected trait; #1 unexpected import; #1 unexpected extern; #1 unexpected case; #1 unexpected in; #2 unexpected struct; #2 unexpected enum; #2 unexpected trait; #2 unexpected impor…

### ST-16 · One-line body · P2 · ❌ fail

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
- **Today:** #1 unexpected struct; #1 unexpected enum; #1 unexpected trait; #1 unexpected import; #1 unexpected extern; #1 unexpected case; #2 unexpected struct; #2 unexpected enum; #2 unexpected trait; #2 unexpected import; #2 unexpected e…

### ST-17 · Assignment target · P2 · ❌ fail

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
- **Today:** #1 unexpected let; #1 unexpected while; #1 unexpected case; #2 unexpected let; #2 unexpected while; #2 unexpected case; #3 unexpected let; #3 unexpected while; #3 unexpected case

## EX: Expressions

Where an expression starts, continues or is complete (§4).

### EX-01 · Where an expression starts · P1 · ❌ fail

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
- **Offer:** Parameters, locals, functions, types (they begin a literal or a static call), namespaces, `true false none not fn async await spawn if match select new struct`.
- **Not:** Statement keywords `let const for while return defer drop hold`; declaration keywords; clause words `case elif else in is and or as`; bare variants (`Red`); the names of declarations that are not values.
- **Accept:** The name alone; a function adds no `(`unless it is a snippet, see OR-04.
- **Basis:** spec §3.11, §4; TS/RA offer only what continues an expression.
- **Today:** #1 unexpected let; #1 unexpected const; #1 unexpected while; #1 unexpected for; #1 unexpected defer; #1 unexpected drop; #1 unexpected struct; #1 unexpected enum; #1 unexpected trait; #1 unexpected import; #1 unexpected extern;…

### EX-02 · After a complete operand · P1 · ❌ fail

```
  let x = n ‸
---
  let x = plus(1) ‸
---
  let x = xs[0] ‸
---
  let x = "a" ‸
---
  if n ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** The words that continue an expression: `and`, `or`, `is`, `in` (operator characters are typed, not completed).
- **Not:** Every name; keywords that cannot follow an operand (`let`, `return`, `else` …).
- **Accept:** The word.
- **Basis:** spec §4 operators; names after an operand are never valid.
- **Today:** #1 unexpected xs; #1 unexpected p; #1 unexpected plus; #1 unexpected Pair; #1 unexpected let; #1 unexpected return; #1 unexpected true; #1 unexpected else; #1 unexpected case; #2 unexpected xs; #2 unexpected p; #2 unexpected pl…

### EX-03 · After `and`, `or`, `is`, `in`, `??`, `..` · P1 · ❌ fail

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
- **Today:** #1 unexpected let; #1 unexpected while; #1 unexpected case; #1 unexpected else; #2 unexpected let; #2 unexpected while; #2 unexpected case; #2 unexpected else; #3 unexpected let; #3 unexpected while; #3 unexpected case; #3 unex…

### EX-04 · After `await` · P2 · ❌ fail

```
  let x = await ‸
```
- **Where / trigger:** in `async fn t`; invoked, or typing on
- **Offer:** EX-01; futures first (calls of `async fn`s: `fetch`, `work`).
- **Not:** EX-01's.
- **Order:** `async` functions, then locals of type `Future`, then the rest.
- **Basis:** spec §6; ranking by expected type, as TS ranks Promises after `await`.
- **Today:** fetch ranks 56, not top 5; work ranks 182, not top 5

### EX-05 · After `*` and `&` · P3 · ✅ pass

```
  let x = *‸
---
  let y = plus(&‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `*`: shared-struct values (`l`) first; `&`: assignable variables (`let`s).
- **Not:** Constants, parameters for `&`.
- **Basis:** spec §3.7, §3.18.

### EX-06 · Inside a block expression · P2 · ❌ fail

```
  const a = { const b = 1; b + ‸ }
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01, `b` visible.
- **Not:** EX-01's.
- **Basis:** spec §4.
- **Today:** unexpected let

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

### SC-07 · Loop variable in its own iterable · P2 · ❌ fail

```
  for i in ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01 without `i`.
- **Not:** `i`.
- **Basis:** scoping, as SC-04.
- **Today:** unexpected i

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
    case Approved{by}: ‸
---
  match d:
    case Rejected{reason as why}: ‸
---
  match o:
    case Some{value}: ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** The arm's bindings: `by`, `why` (not `reason`), `value`.
- **Not:** Bindings of other arms; the renamed field's own name.
- **Basis:** spec §3.11.

### SC-09b · Arm bindings stay in their arm · P1 · ✅ pass

```
  match d:
    case Approved{by}: 1
    case Expired: ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** No `by`.
- **Not:** `by`.
- **Basis:** spec §3.11.

### SC-10 · Guard sees the arm's bindings · P1 · ✅ pass

```
  match d:
    case Rejected{reason as why} if ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `why`.
- **Not:** `reason`.
- **Basis:** spec §3.11.

### SC-11 · `is` binds on the right of `and` and in the body · P1 · ✅ pass

```
  if r is Ok{value as y} and ‸
---
  if r is Ok{value as y}:
    ‸
    1
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `y`.
- **Basis:** spec §3.11 (`is` outside `match`).

### SC-11b · `is` bindings are not there after `or`, or in `else` · P1 · ✅ pass

```
  if r is Ok{value as y} or ‸
---
  if r is Ok{value as y}:
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
- **Offer:** `Some None Ok Err panic Array Optional Result time` (the prelude needs no import).
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

### CO-01 · Array and map literals · P1 · ❌ fail

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
- **Today:** #1 unexpected let; #1 unexpected while; #1 unexpected case; #2 unexpected let; #2 unexpected while; #2 unexpected case; #3 unexpected let; #3 unexpected while; #3 unexpected case; #4 unexpected let; #4 unexpected while; #4 unex…

### CO-02 · Spread · P2 · ❌ fail

```
  const a = [...‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Arrays first (`xs`).
- **Order:** Values of an array type first.
- **Basis:** spec §2.
- **Today:** xs ranks 183, not top 3

### CO-03 · Tuples and ranges and slices · P1 · ❌ fail

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
- **Today:** #1 unexpected let; #1 unexpected case; #2 unexpected let; #2 unexpected case; #3 unexpected let; #3 unexpected case

### CO-04 · Comprehension · P1 · ❌ fail

```
  const e = [for x in xs if ‸
---
  const e = [for x in xs: ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01 with `x`.
- **Not:** Statement keywords.
- **Basis:** spec §4.
- **Today:** #1 unexpected let; #2 unexpected let

### CO-04b · Comprehension binder · P1 · ❌ fail

```
  const e = [for ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Nothing (declaring).
- **Not:** Everything.
- **Basis:** declaring position.
- **Today:** offered 184: Red,Green,Blue,Approved,Rej…

### CO-05 · Lambda parameters · P1 · ❌ fail

```
  const f = fn(‸
---
  const f = fn ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Nothing: parameters are declared.
- **Not:** Everything.
- **Basis:** declaring position.
- **Today:** #1 offered 184: Red,Green,Blue,Approved,Rej…; #2 offered 184: Red,Green,Blue,Approved,Rej…

### CO-06 · Lambda body · P1 · ❌ fail

```
  const f = fn(q): ‸
---
  const f = fn q: ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01 with `q`.
- **Not:** Statement keywords.
- **Basis:** spec §3.14.
- **Today:** #1 unexpected let; #2 unexpected let

### CO-06b · Lambda annotation · P1 · ❌ fail

```
  const f = fn(q: ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Types.
- **Not:** Values.
- **Basis:** spec §3.14.
- **Today:** unexpected xs; unexpected plus; unexpected let

### CO-07 · Template interpolation · P1 · ❌ fail

```
  const s = `id ${‸}`
---
  const s = `id ${n} and ${‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01.
- **Not:** Statement keywords.
- **Basis:** spec §2.
- **Today:** #1 unexpected let; #1 unexpected case; #2 unexpected let; #2 unexpected case

### CO-08 · Template text · P1 · ❌ fail

```
  const s = `id ‸`
---
  const s = `${n} ‸ tail`
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Nothing.
- **Not:** Everything.
- **Basis:** text, not code.
- **Today:** #1 offered 184: Red,Green,Blue,Approved,Rej…; #2 offered 184: Red,Green,Blue,Approved,Rej…

### CO-09 · Index · P1 · ❌ fail

```
  xs[‸]
---
  m[‸]
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01; for a `Map` the key type first.
- **Not:** Statement keywords.
- **Basis:** spec §3.9.
- **Today:** #1 unexpected let; #2 unexpected let

## CF: Control flow

§4, §6.

### CF-01 · Condition · P1 · ❌ fail

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
- **Today:** #1 unexpected let; #1 unexpected for; #2 unexpected let; #2 unexpected for; #3 unexpected let; #3 unexpected for

### CF-02 · Scrutinee · P1 · ❌ fail

```
  match ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01.
- **Not:** Statement keywords.
- **Basis:** spec §4.
- **Today:** unexpected let; unexpected for

### CF-03 · Select case · P1 · ❌ fail

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
- **Today:** #1 unexpected let; #1 unexpected for; #2 unexpected let; #2 unexpected for

### CF-04 · After the awaited future · P2 · ❌ fail

```
  select:
    case work(1) ‸
```
- **Where / trigger:** in `async fn t`; invoked, or typing on
- **Offer:** `as`.
- **Not:** Names.
- **Basis:** spec §6.
- **Today:** unexpected xs; unexpected plus

### CF-05 · Binding after `as` · P1 · ❌ fail

```
  select:
    case work(1) as ‸
---
  match d:
    case Approved{by} as ‸
```
- **Where / trigger:** in `async fn t`; invoked, or typing on
- **Offer:** Nothing.
- **Not:** Everything.
- **Basis:** declaring position.
- **Today:** #1 offered 184: Red,Green,Blue,Approved,Rej…; #2 offered 185: Red,Green,Blue,Approved,Rej…

### CF-06 · Result of `await select` · P3 · ✅ pass

```
  const v = await select:
    case work(1): 1
    else: ‸
```
- **Where / trigger:** in `async fn t`; invoked, or typing on
- **Offer:** ST-01.
- **Basis:** spec §6.

### CF-07 · Line-start `case` in a nested match · P2 · ❌ fail

```
  match d:
    case Approved{by}:
      match o:
        ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `case`.
- **Not:** Names.
- **Basis:** spec §3.11.
- **Today:** unexpected xs; unexpected let

## PA: Patterns

§3.11 patterns, `is`.

### PA-01 · Start of a `case` pattern · P1 · ❌ fail

```
  match d:
    case ‸
---
  match d:
    case Approved{by}: 1
    case ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** The scrutinee type's variants, bare (`Approved Rejected Expired`), literals/keywords `true false none`, `_`, and the enum name `Decision`.
- **Not:** Variables, parameters, functions, statement keywords, clause words — a camelCase bare name binds, so naming a variable would be a misreading (§3.11).
- **Accept:** Variant with fields: the name, then the user types `{`; (optional snippet `Approved{by}`). `_`: `_`.
- **Basis:** spec §3.11 (patterns); TS/Kotlin/RA fill match arms from the type.
- **Today:** #1 missing _; #1 unexpected xs; #1 unexpected p; #1 unexpected plus; #1 unexpected let; #1 unexpected if; #1 unexpected Red; #1 unexpected and; #2 missing _; #2 unexpected xs; #2 unexpected p; #2 unexpected plus; #2 unexpected …

### PA-02 · Variants already covered come last · P3 · ❌ fail

```
  match d:
    case Approved{by}: 1
    case ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** As PA-01.
- **Order:** Uncovered variants before covered ones.
- **Basis:** RA/TS exhaustiveness-aware ordering.
- **Today:** Rejected ranks after Approved; Expired ranks after Approved

### PA-03 · Pattern fields · P1 · ❌ fail

```
  match d:
    case Rejected{‸
---
  match d:
    case Rejected{reason as why, ‸}
---
  match d:
    case Rejected{‸}: 1
```
- **Where / trigger:** in `fn t`; typing `{`
- **Offer:** The variant's fields not used yet: `by`, `reason` (after `reason as why,`: `by`).
- **Not:** Scope; fields of other variants; used fields.
- **Accept:** `by` (it binds), not `by: `.
- **Basis:** spec §3.11 ("`field` binds the field").
- **Today:** #1 missing by; #2 missing by; #3 missing by

### PA-03b · Pattern fields after a comma, space typed · P1 · ❌ fail

```
  match d:
    case Rejected{reason as why, ‸}
```
- **Where / trigger:** in `fn t`; typing ` `
- **Offer:** `by`.
- **Not:** `reason`.
- **Basis:** as LI-03.
- **Today:** ' ' is not a trigger character; offered [Red,Green,Blue,Approved,Rejected,Expired,Some,None] ≠ [by]

### PA-04 · After a pattern field · P2 · ❌ fail

```
  match d:
    case Rejected{reason ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `as`, `is`.
- **Not:** Names.
- **Basis:** spec §3.11 (`field as name`, `field is Pattern`; comparisons are operators).
- **Today:** unexpected xs; unexpected plus

### PA-05 · After `as` in a pattern · P1 · ❌ fail

```
  match d:
    case Rejected{reason as ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Nothing: the name is declared.
- **Not:** Everything.
- **Basis:** spec §3.11.
- **Today:** offered 184: Red,Green,Blue,Approved,Rej…

### PA-06 · After `is` in a pattern · P2 · ❌ fail

```
  match d:
    case Rejected{reason is ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** A pattern start (PA-01 rules): `_`, literals.
- **Not:** Variables, functions.
- **Basis:** spec §3.11 ("Only a pattern may follow `is`").
- **Today:** missing _; unexpected xs; unexpected plus; unexpected let

### PA-06b · After `==` in a pattern · P2 · ❌ fail

```
  match d:
    case Rejected{reason == ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01.
- **Not:** Statement keywords.
- **Basis:** spec §3.11 (`field == expr`).
- **Today:** unexpected let

### PA-07 · `is` outside match · P1 · ❌ fail

```
  if r is ‸
---
  const k = o is ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** PA-01 for the left operand's type: `r` → `Ok`, `Err`; `o` → `Some`, `None`.
- **Not:** Variables, statement keywords.
- **Basis:** spec §3.11.
- **Today:** #1 missing _; #1 unexpected xs; #1 unexpected let; #1 unexpected plus; #2 missing _; #2 unexpected xs; #2 unexpected let; #2 unexpected plus

### PA-08 · Fields of `Ok`/`Some` in `is` · P1 · ❌ fail

```
  if r is Ok{‸
---
  if o is Some{‸
```
- **Where / trigger:** in `fn t`; typing `{`
- **Offer:** `value`.
- **Not:** Scope.
- **Basis:** spec §3.11.
- **Today:** #1 missing value; #2 missing value

### PA-09 · Alternatives and nesting · P2 · ❌ fail

```
  match d:
    case Approved{by} | ‸
---
  match o:
    case Some{value is ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** PA-01.
- **Not:** Variables.
- **Basis:** spec §3.11.
- **Today:** #1 unexpected xs; #1 unexpected let; #1 unexpected plus; #2 unexpected xs; #2 unexpected let; #2 unexpected plus

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

### PA-11 · Literals, tuples, arrays, ranges · P2 · ❌ fail

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
- **Today:** #1 unexpected xs; #1 unexpected let; #1 unexpected plus; #2 unexpected xs; #2 unexpected let; #2 unexpected plus; #3 unexpected xs; #3 unexpected let; #3 unexpected plus

### PA-12 · Guard · P1 · ❌ fail

```
  match d:
    case Approved{by} if ‸
---
  match n:
    case x if ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01 with the bindings (`by` / `x`).
- **Not:** Statement keywords.
- **Basis:** spec §3.11.
- **Today:** #1 unexpected let; #2 unexpected let

### PA-13 · Arm of a `match` after `:` · P2 · ❌ fail

```
  match d:
    case Expired: ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** ST-16 (a statement or an expression).
- **Not:** Declaration keywords.
- **Basis:** spec §4.
- **Today:** unexpected struct; unexpected enum; unexpected trait; unexpected import; unexpected extern; unexpected case

