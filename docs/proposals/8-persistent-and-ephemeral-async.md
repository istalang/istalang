---
description: proposal 8 of docs/proposals, for the semantics of two kinds of code — `live` (its awaits wait in memory and never commit, as in other languages) and `ista` (every `await` commits) — data that is simple, live or ista, code marked with the data it may handle (unmarked code handles simple data only) and the one rule that keeps the two worlds apart, code generic over the kind, one `Future<T, K>` whose kind is always written, `delegate` for persistent code's effects, the `Awaitable` trait and its one-shot `Resolver`, and the deferred-call form `g f(args)` — the rules, behaviour and power changes, spec edits and implementation notes; replaces the earlier proposal 8 and keeps its one-type rule; the runtime that runs it natively is proposal 9; read before specifying or implementing any of it, or changing async functions, futures, select, externs or persistence
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-10
last_updated: 2026-11-11
tags: [proposal, language, async, persistence, functions]
---

# Proposal: live and ista async

Today every `await` commits (§5). That suits long workflows, but a native, single-threaded build waits mostly on short network calls and holds values no snapshot can keep, such as sockets. This proposal splits code into two worlds:

- **`live`** code waits as in every other language: its awaits wait in memory and never commit.
- **`ista`** code is the language's own feature: every `await` commits, as today.

Data is simple, live or ista, and code is marked with the data it may handle: one rule keeps the two worlds apart, and the calls between them follow from it. Persistent code acts on the world through `delegate`, which runs live work after the commit, and live code reaches persistent work through proposal 9's contexts. Unmarked code handles simple data, and code generic over the kind writes its mark as a type parameter.

The language stays separate from its runtime. The compiler fixes each `await`'s mode from its function's kind and rejects every program the data rule doesn't accept, so one runtime contract (Rule 11) serves today's JavaScript interpreter and a later native backend, which may implement futures however it needs. How a native program starts and talks to persistent work, and where it persists it, is the runtime's: proposal 9.

It replaces the earlier proposal 8 and keeps its rule that a function type is the type of what its call gives, written two equal ways. The human decided every rule below. Section numbers refer to `docs/spec.md`.

```python
extern live async fn charge(card: Card, amount: Int) -> Receipt   # the host's: live

ista async fn settle(order: Order) -> String:                    # every await commits
    await time.delay(1d)                                          # an ista timer: commits, then waits a day
    const r = await delegate charge(order.card, order.total)      # runs live, after the commit
    `settled: ${r.id}`

live async fn quote(currency: String) -> Decimal:                 # waits in memory, never commits
    await rates.fetch(currency)

K async fn twice<K in Persistence, T>(f: Fn<(), Future<T, K>, K>) -> T:   # generic over the kind
    await f()
    await f()
```

## Rules

### 1. Two kinds of future

```python
type Mark = "simple" | "live" | "ista"          # prelude: data kinds and code marks
type Persistence = "live" | "ista"                  # Mark's kinded members
type Sendability = "sendable" | "plain"
trait DataKind<K in Mark>                           # derived: a type whose kind is among K's marks
extern shared struct Future<T, K in Persistence>
```

- **The kind is always written.** `Future<T>` is a compile error naming both kinds, and no alias spells either. `Future<T, "simple">` is an error too: `K in Persistence`.
- **A live future** lives in process memory. It is never persisted, and waiting on it never commits.
- **An ista future** is persisted with its instance, its value included. Waiting on it commits first. Only the runtime fills one: timers, slots, results and jobs (Rule 8).
- **The prelude's name is `Persistence`,** not `Kind`: no module may reuse a prelude name (§3.13), and `Kind` is a common one.

### 2. Data and code

Data is **simple**, **live** or **ista**. Code is marked with the data it may handle, and the mark is a privilege:

| Code | May handle |
| --- | --- |
| unmarked | simple data |
| `live` | simple and live data |
| `ista` | simple and ista data |

- **Kinded data.** A live future or resolver and an `extern live struct` value are live; an ista future or resolver and a slot are ista. Data containing kinded data is of its kind: a struct with a `Socket` field is live. Simple is implicit and never written. A type holding both kinds is an error.
- **The one rule.** Code handles only data its mark allows: its parameters, its result, its locals and temporaries, and every value its body computes. `fn f(s: Socket)` is an error: "`f` handles a live `Socket`; declare it `live fn`".
- **Calls follow from it,** with no rule of their own. Running a marked function makes data of its kind in its caller's execution: a `live async fn` gives a live future, and a sync `live fn` makes live data as it runs. So a callee's mark is at most its caller's, `"simple"` being below `"live"` and `"ista"`, which are apart (Rule 3): ista code calls nothing live, live code nothing ista, and unmarked code nothing marked; and code whose mark is a parameter `M` calls only simple functions and those of mark `M`. Implicit calls count: an operator's function, and the `dispose` a release runs. The error names the call: "`y` calls live `x`; declare it `live fn`".
- **Code as data is simple.** A function value is simple data whatever its mark, usable in any code: `ista fn f1(): return live fn f2(): "hello"` is valid. A closure's body handles what it captures, so it captures only data its mark allows.
- **Crossings are sendable,** a compile-time check of its own beside the data rule. A value crossing from one execution to another must be sendable (§3.1), and no live or ista data is: `delegate`'s job and its result (Rule 8), `rt.call`'s arguments and result (proposal 9), and the function a `spawn` starts (Rule 10). So no value, a closure included, carries data into the other world.
- **Marks are written,** never implied. A function's mark is its header's: `live`, `ista`, a mark parameter (Rule 3), or none, which is `"simple"`. A missing one is the error above, naming the value. Only a lambda infers its mark, from its expected type or its body.

| Header | Its type | May handle | Its body |
| --- | --- | --- | --- |
| `fn f(a: A) -> T` | `Fn<(A,), T>` | simple data, and its type parameters' values (Rule 3) | can't `await` |
| `live fn f(a: A) -> T` | `Fn<(A,), T, "live">` | simple and live data | can't `await` |
| `ista fn f(a: A) -> T` | `Fn<(A,), T, "ista">` | simple and ista data | can't `await` |
| `M fn f<M in Mark>(a: A) -> T` | `Fn<(A,), T, M>` | simple data and `M`'s | can't `await` |
| `live async fn f(a: A) -> T` | `Fn<(A,), Future<T, "live">, "live">` | simple and live data | waits in memory |
| `ista async fn f(a: A) -> T` | `Fn<(A,), Future<T, "ista">, "ista">` | simple and ista data | every `await` commits |
| `K async fn f<K in Persistence>(a: A) -> T` | `Fn<(A,), Future<T, K>, K>` | simple data and `K`'s | awaits in `K` |

An unmarked `async fn` is an error: its future would be `Future<T, "simple">`.

- **`live` and `ista` are the mark; `async` marks a body that may await,** as today. On an extern, which has no body, `async` marks only that its result is a future: `extern live async fn fetch(r: Request) -> Response` is `extern live fn fetch(r: Request) -> Future<Response, "live">`.
- **Headers.** A result spelled `Future<…>` is what the call gives, and its kind must be the header's: `live async fn f() -> Future<T, "ista">` is an error. Any other result is what the body gives. Lambdas take every header: `async fn(x): …`, `ista async fn(x): …`.

### 3. Code generic over the kind

- **Generics are transparent.** Unmarked code also handles its type parameters' values, whatever they stand for: the caller handles the concrete types, and the rule checks them there. So `Array<Socket>`'s functions work in live code, and `id(f)`, `f` a live future, is an error in ista code, which would hold it, and valid in live code. A type parameter's requirements and its `dispose` pass through the same way: unmarked generic code releasing a `T` that is a `Socket` is no error, its caller handling the `Socket`.
- **What a type parameter computes has its bounds' kind.** No caller names `T.Data`, an associated type of a type parameter, so no caller can check it: its kind is what the bounds its trait declares allow, and `DataKind<"simple">` where none is written, as simple is never written. `type Data is DataKind<"live" | "simple">` may be live, so only live code holds it. A type `match` over a type parameter is of its cases' kinds, as its arguments instantiate them, what a case takes from its subject passing through as the parameter does.
- **`DataKind<K>` is derived,** never declared: a type meets it when its kind is among `K`'s marks, `"simple"` where its values hold no kind. Sendable implies `DataKind<"simple">`, and `DataKind<K1>` implies `DataKind<K2>` when `K1`'s marks are `K2`'s; a type parameter meets it by its bounds. A type argument meets its trait's associated type bounds where it is used, so `createAndDrop<Box>()`, `Box.Data` live and the trait's `type Data` bounded by nothing, is an error naming that call and the bound to widen.
- **A mark may be a type parameter,** `M in Mark`, or `K in Persistence` on an `async` head, whose future takes it. The body handles that kind's data and calls functions of it:

  ```python
  M fn dispose<M in Mark>(self: Deferred<M>)
  K async fn retry<K in Persistence, T>(f: Fn<(), Future<T, K>, K>, times: Int) -> T
  M fn map<T, U, M in Mark, S in Sendability>(self: Array<T>, f: Fn<(T,), U, M, S>) -> Array<U>
  ```

  So combinators exist once for both worlds: `retry` takes a live `f` and waits in memory in live code, and an ista one and commits in ista code.
- **A call bounds its callee's mark.** The callee's own mark, the one its head names, is at most its caller's: simple code calls only simple functions, and live or ista code its own mark's or simple ones. The bound is on that one mark: the callee's other type parameters, `Fn` kinds among them, are inferred as any are.
  - **Undecided,** a mark parameter is the inference engine's to solve, with the call's other type arguments (§3.5): from the arguments, the expected type and the bound together, taking the least mark they allow. `time.delay(5s)` in ista code is an ista timer, `"ista"` being the only `K in Persistence` at most `"ista"`; `map` given a simple `f` in live code is simple. When the caller's mark is itself a parameter `K`, an undecided mark solves to `K`: `time.delay(5s)` inside a `K async fn` is a `K` timer.
  - **Decided,** written or fixed by an argument, a mark above the bound is an error naming the call: `retry` given a live `f` in ista code is live, which ista code can't call. So is a mark nothing allows: `time.delay(5s)` in simple code, no `K in Persistence` being simple.
- **No mark is implicit.** An unmarked function handles simple data, whatever its signature or body: `fn x(): _ = time.delay(1s)` is an error, since the timer's future is kinded and `x` has no mark to give it.
- **Used as a value,** a function generic over its mark has it fixed where it is used, from the expected type, as a generic function's other type arguments are; holding it runs nothing, so no bound applies.
- **Each mark gets its own code.** Lowering compiles a function generic over its mark once per mark it is used at, as an instantiation, so every compiled body has one fixed mark.

### 4. What fits where

- **One function type.** `Fn<Args, Result, Kind = "simple", Send = "plain">` is the builtin function type. `Args` is always a tuple, one parameter's being `(A,)`, the spec's one-element tuple, and a pack one too; an item may be `&T`, a by-reference parameter. Every other spelling is its sugar, as a header is (Rule 2), `fn(A) -> R` covering the common case: `fn(A, B) -> R` is `Fn<(A, B), R>`, `live fn(A) -> R` is `Fn<(A,), R, "live">`, `sendable fn(A) -> R` is `Fn<(A,), R, "simple", "sendable">`, `fn(x: &A)` is `Fn<(&A,), Unit>`, and `ista async fn(A) -> R` is `Fn<(A,), Future<R, "ista">, "ista">`. An `async fn` type needs its kind: unmarked, its future has none, an error.
- **The kinds never meet.** An ista future never fits where a live one is expected, nor the reverse, and so for functions and resolvers of the two kinds: `Future` is invariant in `K`.
- **Two orders of their own.** `Mark` is ordered `"simple"` below `"live"` and `"ista"`, which are apart, and `Sendability` `"sendable"` below `"plain"`. They are orders on these two types alone, not subtyping between their members, and how the checker encodes them is its own. A function fits where one of a mark and sendability at or above its own is expected.
- **What converts** is subtyping, composed inside other types through their variance (§3.5), as every conversion is, the two orders included:

  | A value of | fits where this is expected |
  | --- | --- |
  | `fn(A) -> R` | `live async fn(A) -> R` or `ista async fn(A) -> R`; its call gives a resolved future |
  | `sendable fn …` | `fn …`, by `Sendability`'s order |
  | an unmarked `fn …` | `live fn …` or `ista fn …`, by `Mark`'s order |

- **Qualifier parameters.** A higher-order function keeps its arguments' mark and sendability through written `Fn` parameters: `map`'s `M` and `S` take `f`'s (Rule 3), and `logged(f)` is `sendable` when `f` is.
- **Requirements carry a mark,** `live`, `ista`, a mark parameter or none. An implementation handles what its requirement allows, and the implementing type's own data too, `Self` being the trait's type parameter (Rule 3). So a requirement of a kind is met by a function of that kind or an unmarked one, an unmarked requirement by an unmarked function, and `Socket`'s `live fn dispose` meets `Disposable`'s unmarked `dispose`. A function's kind there is its instantiation's, with all it calls through its own constraints: a type whose values carry no kind meets no unmarked requirement through code of a kind.
- **Overloads** on the two kinds are two types, so they don't clash. A sync function passed to such a pair converts either way, so that call is ambiguous (§3.7).
- **Modifiers stack in any order.** The formatter sorts them: `extern`; then what a value is or captures (`shared`, `sendable`); then the mark, `live`, `ista` or a mark parameter (`M fn`); then `async`; then `fn` or `struct`. So `extern live async fn`, `extern live struct` and `sendable ista async fn(A) -> R`. `live` and `ista` are contextual words, as `sendable` is, so both stay free as names.

### 5. `await`, `Awaitable` and `Resolver`

```python
trait Awaitable<T>:
    type Mode in Persistence
    Self.Mode fn onAwait(self: Self, done: Resolver<T, Self.Mode>)
```

- **What `await x` does,** for `x` of an awaitable type:
  1. the runtime makes `done`, a resolver for this one wait;
  2. it calls `x.onAwait(done)`, a function without `async`, so it can't itself await;
  3. it commits, when `Mode` is `"ista"`;
  4. it suspends the caller, and `done.resolve(v)` resumes it with `v`.
- **An `await` waits in its code's mark,** which an `async` head makes a kind. Its operand's `Mode` must be that kind, so live code never commits and ista code never waits in memory.
- **What `done` is depends on the mode.**
  - **Live:** an in-memory reference to the suspended code. Resolving it schedules that code on the event loop, and nothing is stored.
  - **Ista:** an object in the instance's heap naming the waiting execution, and nothing more. Step 2 registers it where it will be resolved from, such as a slot's queue of waiters or the runtime's timers, and step 3's commit persists that registration with the suspended frame: both survive a crash, or neither does. Resolving it is a write to the instance's state, committed with the segment that resolves it. One the runtime resolves, such as a timer's, needs no commit of its own: the next commit persists it, and until then the registration stays stored, so a crash fires it again.
- **`Future<T, K>` is the runtime's awaitable,** with `K` as its `Mode`. Any type meets the trait the same way, with a `type Mode` of its own (§3.1). Its work then starts only when it is awaited, and the type, not the caller, decides the mode.
- **`type Mode in Persistence` is new:** a member bound on an associated type, as `S in U` is on a type parameter (§3.5). Bound so, it may be a requirement's mark, as `onAwait`'s is.
- **A resolver:**
  - is one-shot: a second `resolve` panics, and `tryResolve` gives whether it took the value, for races;
  - panics its waiter when its last holder releases it unresolved, which deterministic disposal always detects (§7);
  - fires `onCancel` when its waiter is gone, its future disposed, after which `resolve` does nothing;
  - is part of its instance when ista, so it may be stored across commits, and lives in memory when live.
- **`Resolver.of<T, K>(callback)`** makes a resolver that calls `callback` with the value. Expert code passes one to another awaitable's `onAwait` to wait on it without `await`. An ista one's callback runs as a segment of its own when the value arrives, so what it decides is decided only then: an awaitable composed through callbacks decides later than its value arrived, and isn't safe to lose a `select`, as Rust documents cancel safety.
- **`Resolver.at<T, K>(done, position)`** makes a resolver that resolves `done` with `(position, value)` in the same step, running no code, pending while `done` is. An awaitable racing several futures through one each, as `futures.first` does, decides as a `select`'s cases do, and its losers take nothing.
- **`await runtime.commit()`** stays: an ista future already resolved.

### 6. `select`, combinators, slots and timers

- **A `select`'s cases wait in its function's kind,** as every `await` does, so the kinds never race. An `await select` commits in ista code.
- **Combinators are written once,** generic over the kind (Rule 3):

  ```python
  K fn first<T, K in Persistence>(...fs: Array<Future<T, K>>) -> First<T, K>    # First's Mode is K
  ```

  Inference refuses a mix: one type parameter can't take two types (§3.5), and `K in Persistence` always stands for one member. Every function of `futures` takes this shape.
- **Slots are ista data,** with no kind parameter, and nothing special to the checker: `put`, `take` and `read` are `extern ista` functions (§3.8). `Inbox`, written on slots in the language, and every other type holding one, are ista data.
- **Timers are the runtime's, in both kinds:** `time.delay` and `time.at` are externs generic over their mark, `extern K fn delay<K in Persistence>(d: Duration) -> Future<Unit, K>`, which the runtime implements for each. `worker.disposing()` likewise gives a future of its function's kind.

### 7. Segments and commits

- **A segment** is an instance's code from one commit to its next, as today. An instance runs only ista code, where every `await` commits and nothing waits in memory, so a segment runs uninterrupted and commits whole. No live value reaches ista code, and a crash discards everything a segment changed, so nothing has to check what lives across a commit or what a segment writes.
- **What a segment starts is real only once it commits:** an ista call past its first `await`, a spawn, a job (Rule 8). A discarded segment started nothing.
- **Live code runs outside instances,** in memory on the program's event loop, and never commits or reaches the store. Once proposal 9's contexts land (phase CX), a host starts only `live async fn`s, by name, `main` when it names none, as live code, and a restart ends them; a job is run again (Rule 8). Ista code runs in a context the program enters (proposal 9). Until then, a host starts an `ista async fn main`.
- **Re-run state is kept per instance, as today:** `now()`, `random`'s draws and spawn numbering, so a segment run again reproduces them. `now()` is the segment's start time in ista code and the clock in live code.

### 8. Effects: `delegate`

Ista code acts on the world through `delegate`, proposal 9's jobs:

```python
ista async fn purchase(order: Order) -> Receipt:
    await delegate charge(order.card, order.total)
```

- **`delegate` is an `ista` runtime function,** called in the deferred form (Rule 10): `ista fn delegate<R is Encodable & Decodable>(job: sendable live async fn() -> R) -> Future<R, "ista">`. A `live fn` fits, its call a resolved future. The result crosses back as JSON, so it needs its codecs rather than sendability.
- **The job is queued at the commit,** in the instance's job inbox, the transactional outbox, so a discarded segment runs nothing.
- **The runtime's loop runs it as live code,** and again after a crash or restart until its result commits into the future: it runs at least once, and only for committed history.
- **A job has a stable key,** the same on every run, so the work it calls can deduplicate. How live code reads it is proposal 9's.

### 9. Externs

- **An extern is code without a body,** its signature alone held to Rule 2. So an unmarked extern handles simple data only: `extern fn getSocket() -> Socket` is an error, written `extern live fn getSocket() -> Socket`.
- **A host's externs are unmarked, `live` or `live async`.** An unmarked one handles simple data, so any code calls it, and again when a crash discards its segment, so pure functions stay unmarked. One that changes the world is `extern live fn`, which ista code reaches only through `delegate`. A forgotten `live` isn't caught: a crash then repeats the call, as today.
- **Externs generic over their mark and `extern ista` functions are the runtime's:** timers, slots, `spawn`, `delegate`. Only the runtime fills an ista future, so a host's async externs are `live`, which deploy checks.
- **`extern live struct`** declares a host type bound to the process, such as a socket: never persisted, never sent. Its values are live data, so code handling one is `live` (Rule 2). A disposable host type stays as today (§3.6).
- **A host's future-returning extern receives the resolver** of the live future its call gives, and resolves it when it can, from any thread; the runtime posts it to the program's event loop.
  - **`onCancel` is the disposal notice,** fired as the future is disposed.
  - **Dropping the resolver unresolved** panics the waiter, naming the extern. It is a host bug, as a result of the wrong type is (§3.12).
  - **A JavaScript host may return a promise instead,** as today, which resolves it when it settles.
- **Extern keys** spell a function type's kind: `live fn(String) -> Future<Int, "live">`. Hosts re-key once.

### 10. Deferred calls: `g f(args)`

`g f(args)` gives `g` a function that makes the call `f(args)` later, with everything written computed now, as Go's `go` and `defer` do:

```python
retry fetchUser(id)
# is
retry((fn(x): fn(): fetchUser(x))(id))
```

- **Shape.** A name, or a path of names joined by `.`, then on its line a call. The parser reads it from the text alone, so parsing still never depends on what a name means.
- **What runs now:** the callee, with its receiver and any calls before the last one, and every argument written, left to right. Only the outermost call is deferred, so `retry load(id).process()` calls `load(id)` now. Defaults are part of the function (§3.3), so a default the call leaves out is computed when the deferred call runs, inside it.
- **What `g` takes:** one parameter of a function type without parameters, `fn() -> X`, any others having defaults or given in parentheses, `g(args) f(x)`: `retry(times: 5) fetchUser(id)`. A method counts, its receiver as `self`: `pool.submit encode(file)`. Anything else is an error: "`g` doesn't take a call to run later".
- **What's captured:** the values computed, as copies. A `sendable fn` parameter makes them sendable. A deferred call can't take a `&` argument, since no reference can be captured (§3.14).
- **Precedence** is prefix `await`'s: `await retry fetchUser(id)` is `await (retry fetchUser(id))`, and `(g f()).x` needs its parentheses.
- **Nesting** reads from the right: `a b c(x)` is `a(fn(): b(fn(): c(x)))`, with `x` computed now.
- **The bracket form passes a value:** `retry(makeAttempt(x))` calls `makeAttempt` now and passes the function it gives.
- **A missing comma.** `[a b(c)]` is an error today, and may now check as a deferred call. Where it doesn't, the error points at the likely missing comma.
- **Callbacks with parameters** keep their lambda: `bus.subscribe(fn msg: …)`.
- **No call needs a keyword of its own.** `spawn`, `delegate` and `defer` are functions called this way, as are the runtime's other functions taking a call to run later (proposal 9).
- **`spawn` leaves the keywords:** the runtime provides it as an `ista` function, so `spawn purchase(req)` keeps its spelling. What it does is proposal 9's.
- **`defer` becomes a prelude function,** no longer a keyword: `fn defer<M in Mark>(callback: Fn<(), Unit, M>) -> Deferred<M>`, where `shared struct Deferred<M in Mark> { callback: Fn<(), Unit, M> }` is a disposable whose `M fn dispose` calls it. Code of any mark defers, the simple included: `fn w(): _ = defer log(x)` makes a `Deferred<"simple">`. `_ = defer log(x)` computes `x` now and logs when the block ends, and `hold _ = defer log(x)` when the function ends, as Go's `defer` does. Release order runs them last first (§7). A disposable is must-use, so a bare `defer log(x)` is an error.

### 11. The runtime contract

Every backend implements these, and the compiler guarantees the rest:

1. **`await`:** Rule 5's four steps.
2. **Commit:** an instance persisted whole at every `await` in ista code (Rule 7).
3. **Resolvers:** Rule 5's guarantees and Rule 9's notices.
4. **Starts at commit:** the ista calls, spawns and jobs a segment started become real at its commit.
5. **Jobs:** run as live code until their result commits, under a stable key (Rule 8).
6. **Re-run state per instance:** `now()`, `random` and spawn numbering.

## Why

- **Two worlds, one rule.** Live code is async as every other language has it, and ista code the feature only Istalang has. One rule on the data code handles keeps them apart, the calls between them following from it, so a segment never waits in memory and commits whole: nothing has to check what lives across a commit, or what an effect is.
- **Marks are privileges on headers.** What a function may handle reads from its header, and each body is checked alone. A helper that starts handling live data changes its own header, never its distant callers' validity.
- **Code as data is simple.** Any code may hold and pass a function of any mark, for example to `delegate` (Rule 8); only running it needs the mark.
- **Code generic over the kind.** Generic code passes through whatever its caller may handle, and a mark may be a type parameter, so library code, combinators and higher-order functions included, is written once for both worlds.
- **Effects through `delegate`.** Only committed history acts on the world, at least once, under a key the world can deduplicate on: the transactional outbox.
- **Short, matched words.** `live` and `ista` name the two worlds on functions, structs and futures alike, and `async` keeps meaning "may await".
- **Resolvers, not continuations.** The runtime keeps the continuation, and an awaitable receives a one-shot resolver. A continuation called twice would run its caller twice, and one never called would hang it, which nothing short of linear types could check.

## What changes in behaviour

| Code | Today | Proposed |
| --- | --- | --- |
| `async fn approve(req: Req) -> Future<String>:` | persistent: every `await` commits | error: `Future` takes its kind. The repository's rewrite makes it `ista async fn approve(req: Req) -> String` |
| `async fn two(x: Int) -> Int: x * 2` | error 5021 | error: an `async fn` takes a kind; `K async fn two<K in Persistence>(x: Int) -> Int` is generic over it |
| `f: async fn() -> Int`, a parameter's type | persistent | error: an `async fn` type takes its kind, `live async fn() -> Int` or `Fn<(), Future<Int, K>, K>` |
| `live async fn get(u: String) -> String: await http.get(u)` | (no live code) | waits in memory, never commits |
| `Future<Int>` | the one future type | error: name its kind |
| `await http.get(u)` or `charge(id)`, both `live`, in an `ista async fn` | (no kinds) | error: ista code calls nothing live; written `await delegate charge(id)` |
| `fn y(): _ = x()`, `x` a `live async fn` | legal | error: "`y` calls live `x`; declare it `live fn`" |
| `fn f(s: Socket)`, `Socket` an `extern live struct` | (no live types) | error: `f` handles a live `Socket`; declare it `live fn` |
| `extern fn getSocket() -> Socket` | (no live types) | error: an extern's signature is held to the rule; written `extern live fn getSocket() -> Socket` |
| `ista fn f1(): return live fn f2(): "hello"` | (no kinds) | valid: a function reference is simple data |
| `id(f)`, `f: Future<Int, "live">`, `id` unmarked and generic | (no kinds) | valid in live code; an error in ista code, which would hold `f` |
| `fn x(): _ = time.delay(1s)` | legal | error: `x` is unmarked and handles a future; `K fn x<K in Persistence>()` gives it one |
| `fn w(): _ = defer log(x)` | the `defer` keyword | a `Deferred<"simple">`: simple code defers |
| a `live async fn` calling an `ista async fn`, or receiving from an inbox | (one kind) | error: live code calls nothing ista, and holds no inbox |
| `time.delay(5s)` in a `live async fn` | (one kind) | a live timer |
| `K async fn retry<K in Persistence, T>(f: Fn<(), Future<T, K>, K>, times: Int) -> T` given a live `f` | (one kind) | runs live; given an ista `f`, runs ista |
| `await select` over a case of the other kind | (one kind) | error: an `await` waits in its function's kind |
| `async fn main()` awaiting a host queue's `receive()` | the program's persistent root | error: live code calls nothing ista; the rewrite moves the body into an `ista async fn` that `main` runs in a context |
| `extern ephemeral struct Socket` | a host type in the process | spelled `extern live struct Socket` |
| `retry fetchUser(id)` | error: a missing `,` | a deferred call |
| `defer fn(): log(x)` | the `defer` keyword: runs when the block ends | error: a disposable left unused. Written `_ = defer log(x)`, computing `x` now |
| `spawn purchase(req)` | a keyword | the runtime's function in the deferred form; its defaults still computed in the new instance, as part of the function |
| `fn log(msg: String, at: Time = time.now())` | the default runs as code of its own, called from the call | the default is part of `log`, computed at the start of its call |
| `extern async fn fetch(r: Request) -> Response` | error | the runtime's, in both kinds; a host's is `extern live async fn fetch(…)`, which deploy checks |
| `retry(3, fn(id): Order{id})`, `call: ista async fn(String) -> Order` | error 5001 inside the body | fits: a resolved future |
| overloads `f(g: live async fn() -> Int)` and `f(g: ista async fn() -> Int)` | (one kind) | two types, no clash; a plain argument is ambiguous |

After the repository's rewrite (implementation note 9), every program that compiles today compiles and behaves the same, except that extern keys are respelled and persistent code's `live` host calls run through `delegate`, after the commit.

## What changes in power

**Gained.**
- In-memory async: live code waits without committing, and holds sockets, files and native handles.
- Effects that act only for committed history, at least once and under a stable key, through `delegate`.
- Code generic over the kind, `await` included: generic code passes through what its caller may handle, and a mark may be a type parameter, so combinators and higher-order functions are written once.
- Custom awaitables, cold ones included, and externs that resolve later and learn of cancellation.
- One deferred-call form for every function that takes a call to run later.
- One function type, `Fn<Args, Result, Kind, Send>`, every spelling its sugar, so higher-order functions keep their arguments' mark and sendability through written parameters.

**Not gained.**
- In-memory waits inside persistent code: even a read goes through `delegate`, and commits.
- Live code calling persistent code: proposal 9's contexts reach it.

**Lost.**
- `async fn` meaning persistent, and `Future<T>` without its kind. The rewrite moves every program to `ista async fn`.
- Persistent code calling a world-changing host function directly, and hosts filling persistent futures.
- `defer` and `spawn` as keywords: both are functions, `defer` held as `_ = defer f()`.
- Overloads told apart only by how a function type is spelled: the two spellings are one type.

## Spec changes

- **Cheat sheet:**
  - The functions block shows a `live async fn`, an `ista async fn` and a `K async fn` generic over its kind.
  - The types line shows `Future<T, "live">`, `Future<T, "ista">`, `Resolver<T, K>`, `Fn<Args, Result, Kind, Send>`, `live async fn(A) -> R` and `ista async fn(A) -> R`.
  - The concurrency block shows which `await` commits, `delegate`, and a deferred call; `defer` is written `_ = defer log("exited")`.
- **§1.** "Visible persistence: every `await` commits" becomes: "`await` is the only place execution can suspend; in `ista` code it commits, in `live` code it waits in memory." The overview names live code beside workflows.
- **§2.**
  - Reserved words lose `defer` and `spawn`.
  - Grammar words gain `live` and `ista` and lose `ephemeral`, among a declaration's or a function type's modifiers, which stack in any order (Rule 4).
  - The types table gains `Future<T, K>`, `Resolver<T, K>` and `Fn<Args, Result, Kind, Send>`, the function-types row becoming `Fn`'s sugar.
  - The conversions list: a sync function into either future kind, an unmarked function into either kind, and nothing between the kinds.
- **§3.1.** `extern live struct` values, neither persisted nor sendable.
- **§3.3.** Data kinds, code marks and the one rule, calls as its consequence, code as data, code generic over the kind (Rules 2 and 3). **Defaults** are part of the function, as in JavaScript and Kotlin: computed at the start of each call that leaves them out, in the function's scope and before its body, never awaiting. A spawned call computing its defaults in the new instance then follows, no longer a rule of its own. §3.1's field defaults are likewise part of building the value.
- **§3.5.** Generic code transparent to its type parameters' data; a mark parameter, `M in Mark` or `K in Persistence`, inferred with a call's other type arguments under its caller's mark as an upper bound, the least mark allowed; a decided mark above it an error.
- **§3.6.** `extern live fn`, `extern live async fn` and `extern live struct`; externs generic over their mark and `ista` externs are the runtime's; a future-returning extern's resolver.
- **§3.7.** Overloads on the two kinds.
- **§3.8.** The prelude gains `Mark`, `Persistence`, `Sendability`, `Fn`, `Awaitable`, `Resolver`, `defer` and `Deferred`, and its `Future` takes the kind. Its slot externs are `ista`. `futures` becomes awaitables generic over the kind, `time.delay` and `time.at` run in both kinds, and the runtime module gains `delegate`.
- **§3.9.** The precedence table's prefix level gains the deferred call.
- **§3.10.** The built-in traits table gains `Awaitable`. Associated types take a member bound. A requirement carries a mark, and its implementation also handles the implementing type's data.
- **§3.14.** **Async function types** becomes Rule 4. `live fn` and `ista fn` beside `sendable fn`. A new paragraph, **Deferred calls** (Rule 10).
- **§5.** Rewritten: the two kinds of `await`, segments and commits in ista code, live code outside instances, starting at commit, jobs, and re-run state.
- **§6.** Every wait is a wait on a slot or a resolver.
- **§7.** A resolver's `onCancel`, and a dropped resolver panicking its waiter. **Defer** describes the prelude's `defer` (Rule 10).
- **§8.** A `select`'s cases share its function's kind.
- **§9.** A host starts only `live async fn`s; persistent work runs in contexts the program enters (proposal 9). `spawn` and `delegate` are the runtime's functions. A host's externs are unmarked or `live`. Extern keys spell kinds.
- **§12.** The examples use `ista async fn` and `Future<…, "ista">` throughout.

## Implementation notes

1. **Syntax.**
   - **Words:** `defer` and `spawn` leave the reserved words, their nodes going (`compiler/syntax/tokens/index.ts`, `compiler/syntax/expressions/index.ts`). `live` and `ista` join the grammar words and `ephemeral` leaves them (`compiler/syntax/tokens/grammar-words.ts`). `test/vscode-grammar.test.ts` holds the VS Code grammar to them.
   - **Modifiers** parse in any order, each at most once: the kind (`live`, `ista`) is a group of its own, and `async` another.
   - **Deferred calls:** a new expression node, a path and a call, parsed where a name or path is followed on its line by a call (`compiler/parser/grammar/`).
2. **Checker.**
   - **Function types** carry a mark, unmarked, `live`, `ista` or a variable, beside their sendability, and what a value of them may capture (Rule 2), and `async` becomes the result's future (`checker/types/type/function-types.ts`, `index.ts`). Every spelling builds through the one constructor, so nothing downstream sees which was written.
   - **Data kinds:** one home derives a type's kind, simple, live or ista, from what it holds, per instantiation; a type parameter's values pass in unmarked code, and the caller checks their concrete types. A declaration may later give a binding its kind (proposal 9's `ista const`), through the same home.
   - **Futures:** `Future`'s kind is a required member parameter. A callee's mark is bounded above by its caller's, `"simple"` below `"live"` and `"ista"`: a mark parameter is solved with the call's other type arguments under that bound, the least the constraints allow, and a decided mark above it is an error naming the call. Nothing else defaults.
   - **Fitting:** the two orders join the constraint system, composed through variance, encoded as the checker sees fit: a sync function into either future kind, `sendable fn` into `fn`, an unmarked function into either kind; nothing between kinds (`checker/types/fitting/`). `Fn`'s `Kind` and `Send` parameters carry a higher-order function's mark and sendability through.
   - **The data rule** is checked on every value a body handles, its signature's included, against its mark, a missing mark an error naming the value. Calls are checked as its consequence, implicit ones included: the callee's mark, or its requirement's, is the caller's or none. No whole-program analysis.
   - **`await` and `select`** (`constructs/expressions/control/await.ts`, `select.ts`): find the `Awaitable` conformance, read `Mode`, and require the function's kind.
   - **Deferred calls** desugar to their closure in one place. `constructs/expressions/control/spawn.ts` goes: `spawn`'s rules come from its parameter's `sendable fn` type.
3. **Lowering.** An `await` lowers by its function's kind; a function generic over its mark is compiled once per mark it is used at, as an instantiation; a deferred call lowers as its closure. The spawn path in `lowering/constructs/expressions/calls.ts` goes. A native backend makes a live function a coroutine with its frame on the heap (`llvm.coro.*`); an ista function's frame holds only persistable values at its commit points, so the compiler emits its serializer.
4. **Runtime.** Instances run only ista code and commit at every `await`, as today (`runtime/scheduler/segment/index.ts`). Live code runs on the host's event loop. New: resolvers, with their one-shot rule and `onCancel`; the job inbox and its runner.
5. **Host** (`runtime/host/index.ts`, `cli/host-module.ts`). A live extern returning a future receives its resolver, and a returned promise still resolves it. Host-filled persistent futures and their tokens go.
6. **Definition** (`definition/extern-key.ts`, `docs/arch/definition.md`). Function types carry their kind and lose the `async` flag. Every extern key is respelled, so hosts re-key as after proposal 1.
7. **Standard library.** The prelude gains `Mark`, `Persistence`, `Sendability`, `Fn`, `Awaitable` and `Resolver`, with `Future` taking the kind, and `defer` with `Deferred`, a shared struct whose `dispose` calls its function. Slot externs are `ista`. `futures` becomes awaitables over the kind (`stdlib/futures/futures.ista`), `time`'s timers run in both kinds, and `runtime` gains `delegate`. `log.write` stays unmarked: a re-run's repeated line is harmless. Higher-order functions take written `M in Mark` and `S in Sendability` parameters, keeping their arguments' mark and sendability (tracker F28).
8. **Formatter and tools** (`formatter/types.ts`, `declarations.ts`). Types print `live async fn(A) -> R` and `ista async fn(A) -> R`, and headers the body's result, `ista async fn f() -> R`, since `async` carries the future; externs alike, `extern live async fn f() -> R`. Modifiers print in Rule 4's order. Hover and signature help print the spelling the formatter writes, and a deferred call's hover shows the call it defers.
9. **The repository's sources: a scripted rewrite through the project's own parser.** No live code exists yet, so every program keeps its meaning:
   - every `async fn` but `main` becomes `ista async fn`: about 308 in `.ista` files and 40 in the spec, beside about 220 `main`s, which become `ista async fn main` until phase CX, then `live async fn main` running the rest through `rt.call`;
   - every `async fn` type gets its kind, `ista` as its function's;
   - every `Future<T>` becomes `Future<T, "ista">`, except an `async` header's result, which becomes `T`: about 310 and 38;
   - a host's future-returning extern becomes `extern live async fn`, and ista code's `await` of one `await delegate …`;
   - `extern ephemeral struct` becomes `extern live struct`;
   - the functions the data rule then needs marked are marked, from its own errors, until none is left;
   - a `main` that makes an ista future moves its body into an `ista async fn`, which `main` runs in a context of a runtime it opens (proposal 9's `Runtime.open` and `rt.call(key)`);
   - every `defer f` statement becomes `_ = defer(f)`: 17 in `.ista` files and 2 in the spec.

   The same rewrite reaches sources embedded in TypeScript tests (about 279 `async fn` and 154 `Future<`). Then `ista fmt` runs.
10. **Tests** (fast-check, beside the code):
    - each pair of spellings gives equal types (`typeKey`);
    - over generated programs, live code never writes to the store, and every `await` in an instance does;
    - an accepted program never calls live code inside an instance, nor ista code in live code, and no ista frame holds live data, nor a live frame ista data;
    - a function generic over its mark behaves, at each mark, as its copy written with that mark would;
    - a job runs at least once per committed start and never for a discarded segment, under one key;
    - a deferred call equals its desugared closure (the commute law of `test/AGENTS.md`);
    - a second `resolve` panics, a dropped resolver panics its waiter, and disposal fires `onCancel` once;
    - every refusal in the behaviour table.

## Decisions (the human's)

1. **Two kinds, `live` and `ista`:** live code waits in memory and never commits, as other languages have it; ista code commits at every `await`, the new feature. `async` only marks a body that may await.
2. **`Future<T, K>`** writes its kind always, `Persistence` being `"live" | "ista"`, with no alias.
3. **The kinds never fit each other.**
4. **`Awaitable` gives an expert a callback,** made a one-shot resolver so the runtime keeps the continuation. `Future` is one awaitable among others. Combinators are written once, and `first`'s type keeps kinds from mixing.
5. **The host learns when a future is disposed,** so it can cancel its work.
6. **One rule: code handles only data its mark allows.** Data is simple, live or ista, and kinded when it contains kinded data. Unmarked code handles simple data, `live` code simple and live, `ista` code simple and ista, in its parameters, result, locals, temporaries and every value it computes. Calls follow: running a marked function makes its kind of data in its caller, so ista code calls nothing live, live code nothing ista and unmarked code nothing marked. No in-memory wait happens inside persistent code, so a segment commits whole, and no check of what lives across a commit, or of effects, is needed.
7. **Marks are privileges, written** on headers, externs, function types and requirements, `live`, `ista` or a mark parameter, never implied; a missing one is an error naming the value or the call, and only a lambda infers its mark. A function value is simple data whatever its mark, and a closure captures only data its mark allows.
8. **Code generic over the kind** writes its mark as a type parameter, `M in Mark` or `K in Persistence`, never implied; generic code passes through its type parameters' data, checked at the caller; lowering compiles one copy per mark. An unmarked `async fn`, or `async fn` type, is an error.
9. **Persistent code acts on the world through `delegate`,** proposal 9's jobs: queued at the commit, run as live code, run again under a stable key until its result commits. Only the runtime fills an ista future.
10. **A host's externs are unmarked, `live` or `live async`;** externs generic over their mark and `ista` externs are the runtime's, which deploy checks. A forgotten `live` isn't caught, a risk accepted: a crash repeats the call, as today.
11. **Slots are ista only, and nothing special to the checker.** `Inbox` is written on slots in the language.
12. **`now()` is its segment's start time in ista code,** as today, and the clock in live code.
13. **Any function taking a call to run later takes the deferred-call form,** its arguments computed where they are written, and `g(args) f(x)` passes `g`'s other arguments.
14. **`defer` is a prelude function like any other,** returning a disposable that calls its function when released, so `_ = defer f(x)` and `hold _ = defer f(x)` give block and function scope, the latter Go's.
15. **The formatter writes `live async fn(A) -> R` and `ista async fn(A) -> R` in types, and the body's result in headers.**
16. **Modifiers stack in any order,** and the formatter sorts them. `live` and `ista` are contextual words, not reserved.
17. **`spawn` is no keyword,** but a runtime function in the deferred form, as `defer` is a prelude one.
18. **Defaults are part of the function,** computed at the start of its call, as in JavaScript and Kotlin. They never affect the caller, and a deferred call computes them when it runs.
19. **The language is separate from the runtime.** The compiler checks everything, the runtime contract is fixed, and a backend implements futures as it needs. Starting persistent work from live code, and every other runtime mechanism, is proposal 9's.
20. **Conversions are subtyping** composed through variance, and `Fn`'s written `Kind` and `Send` parameters keep a higher-order function's mark and sendability (tracker F28, `docs/work/variance-inference/design.md` §7).
21. **One function type, `Fn<Args, Result, Kind = "simple", Send = "plain">`,** `Args` a tuple, every spelling its sugar. The prelude has `Mark = "simple" | "live" | "ista"`, for data kinds and code marks, `Persistence`, its kinded subset, and `Sendability = "sendable" | "plain"`.
