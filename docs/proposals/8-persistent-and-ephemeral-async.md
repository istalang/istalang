---
description: proposal 8 of docs/proposals, for the semantics of two kinds of async function — `async fn` (ephemeral: its awaits wait in memory and never commit, as in other languages) and `ista fn` (persistent: awaiting a persistent future commits) — one `Future<T, K>` whose kind is always written, the `Awaitable` trait and its one-shot `Resolver`, what fits where, the two compile-time checks that keep in-memory waits sound inside persistent code, `readonly` and ephemeral host types, and the deferred-call form `g f(args)` — the rules, behaviour and power changes, spec edits and implementation notes; replaces the earlier proposal 8 (one async function type, two spellings) and keeps its one-type rule; the runtime that runs it natively is proposal 9; read before specifying or implementing any of it, or changing async functions, futures, select, externs or persistence
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-09
last_updated: 2026-11-09
tags: [proposal, language, async, persistence, functions]
---

# Proposal: persistent and ephemeral async

Today every `await` commits (§5). That suits long workflows, but a native, single-threaded build waits mostly on short network calls and holds values no snapshot can keep, such as sockets. This proposal gives async two kinds:

- **`async fn`** is ephemeral, as in every other language: its awaits wait in memory and never commit.
- **`ista fn`** is persistent, the language's own feature: awaiting a persistent future commits, as every `await` does today.

The language stays separate from its runtime. The compiler fixes each `await`'s mode from types and rejects every program the two checks below don't accept, so one runtime contract (Rule 11) serves today's JavaScript interpreter and a later native backend, which may implement futures however it needs. How a native program starts and talks to persistent work, and where it persists it, is the runtime's: proposal 9.

It replaces the earlier proposal 8 and keeps its rule that a function type is the type of what its call gives, written two equal ways. The human decided every rule below. Section numbers refer to `docs/spec.md`.

```python
extern readonly async fn rate(currency: String) -> Decimal

ista fn settle(order: Order) -> String:              # persistent
    const r = await rate(order.currency)              # ephemeral and readonly: waits in memory
    await time.delay(1d)                              # a persistent timer: commits, then waits a day
    `settled at ${r}`

async fn quote(currency: String) -> Decimal:          # ephemeral: nothing commits
    await rate(currency)
```

## Rules

### 1. Two kinds of future

```python
type Persistence = "ephemeral" | "persistent"           # prelude
extern struct Future<T, K in Persistence>
```

- **The kind is always written.** `Future<T>` is a compile error naming both kinds, and no alias spells either.
- **An ephemeral future** lives in process memory. It is never persisted, and waiting on it never commits.
- **A persistent future** is persisted with its instance, its value included, so its `T` must be `Persistable` wherever the future lives across a commit, which check 1 checks (Rule 7). Waiting on it commits first.
- **The prelude's name is `Persistence`,** not `Kind`: no module may reuse a prelude name (§3.13), and `Kind` is a common one.

### 2. Two kinds of async function

| Header | Same type as | Its body |
| --- | --- | --- |
| `async fn f(a: A) -> T` | `fn(A) -> Future<T, "ephemeral">` | may `await` ephemeral awaitables; nothing commits |
| `ista fn f(a: A) -> T` | `fn(A) -> Future<T, "persistent">` | may `await` either kind; a persistent one commits |
| `fn f(a: A) -> T` | `fn(A) -> T` | can't `await` |

- **`async` and `ista` mark a body that may await,** as `async` does today. The kind lives in the result type. On an extern, which has no body, the keyword marks only its result's kind: `extern async fn fetch(r: Request) -> Response` is `extern fn fetch(r: Request) -> Future<Response, "ephemeral">`.
- **Headers read as proposal 8 read them.** A result spelled `Future<…>` is what the call gives, and its kind must be the header's: `async fn f() -> Future<T, "persistent">` is an error. Any other result is what the body gives. Lambdas take both headers: `async fn(x): …`, `ista fn(x): …`.
- **The plain-function fit stays.** A `fn(A) -> R` fits where `fn(A) -> Future<R, K>` is expected, for either kind. Its call gives a future already resolved.
- **A call starts its callee at once,** inside the caller (§3.3), for both kinds. A persistent function may call an ephemeral one.
- **Ephemeral code makes no persistent future.** An `async fn`, directly or through what it calls, calls no `ista fn` and no extern whose result is a persistent future. Nothing ephemeral commits, so a persistent callee would never resume past its first `await` (Rule 6), and a persistent wait would have nothing to commit with. The compiler infers this per function from bodies and extern signatures, as it infers effects (Rule 8), so slots need no rule of their own: their operations are such externs (Rule 5). Proposal 8 makes `fn(A) -> Future<R, "persistent">` also the type of a plain function returning such a future, so ephemeral code calls no function value of that type either. Starting and reaching persistent work from ephemeral code is the runtime's (proposal 9).
- **A host starts only `async fn`s,** by name, `main` when it names none, and a restart ends them. Persistence is configured inside the program, and an `ista fn` runs in a context the program enters (proposal 9).
- **`spawn` is no longer a keyword.** The runtime provides it as a function, called in the deferred form (Rule 9), so `spawn purchase(req)` keeps its spelling. What it does is proposal 9's.
- **`worker.disposing()`** gives a future of its function's kind.

### 3. `await`, `Awaitable` and `Resolver`

```python
trait Awaitable<T>:
    type Mode in Persistence
    fn onAwait(self: Self, done: Resolver<T, Self.Mode>)
```

- **What `await x` does,** for `x` of an awaitable type:
  1. the runtime makes `done`, a resolver for this one wait;
  2. it calls `x.onAwait(done)`, a plain function, so it can't itself await;
  3. it commits, when `Mode` is `"persistent"`;
  4. it suspends the caller, and `done.resolve(v)` resumes it with `v`.
- **What `done` is depends on the mode.**
  - **Ephemeral:** an in-memory reference to the suspended execution. Resolving it schedules the execution on the event loop, and nothing is stored.
  - **Persistent:** an object in the instance's heap naming the waiting execution, and nothing more. Step 2 registers it where it will be resolved from, such as a slot's queue of waiters or the runtime's timers, and step 3's commit persists that registration with the suspended frame: both survive a crash, or neither does. Resolving it is a write to the instance's state, committed with the segment that resolves it. One the runtime resolves, such as a timer's, needs no commit of its own: the next commit of the execution it resumes persists it, and until then the registration stays stored, so a crash fires it again. It asks nothing of the store but commits.
  - **Handed to a host,** a persistent resolver crosses as its id, which the host gives back to resolve it, after a restart too. The host's resolution is acknowledged only once the runtime has committed it.
- **`Future<T, K>` is the runtime's awaitable,** with `K` as its `Mode`. Any type meets the trait the same way, with a `type Mode` of its own (§3.1). Its work then starts only when it is awaited, and the type, not the caller, decides the mode.
- **`type Mode in Persistence` is new:** a member bound on an associated type, as `S in U` is on a type parameter (§3.5).
- **A resolver:**
  - is one-shot: a second `resolve` panics, and `tryResolve` gives whether it took the value, for races;
  - panics its waiter when its last holder releases it unresolved, which deterministic disposal always detects (§7);
  - fires `onCancel` when its waiter is gone, its future disposed, after which `resolve` does nothing;
  - is `Persistable` when persistent, so it may be stored across commits, and isn't when ephemeral.
- **`Resolver.of<T, K>(callback)`** makes a resolver that calls `callback` with the value. Expert code passes one to another awaitable's `onAwait` to wait on it without `await`. A persistent one's callback must be persistable, and runs as a segment of its own when the value arrives.
- **`await runtime.commit()`** stays: a persistent future already resolved.

### 4. What fits where

- **One type, two spellings,** for each kind, as proposal 8 had for one:

  | Spelling | Is |
  | --- | --- |
  | `async fn(A) -> R` | `fn(A) -> Future<R, "ephemeral">` |
  | `ista fn(A) -> R` | `fn(A) -> Future<R, "persistent">` |
  | `sendable ista fn(A) -> R` | `sendable fn(A) -> Future<R, "persistent">`; `readonly` alike |

- **The kinds never meet.** A persistent future never fits where an ephemeral one is expected, nor the reverse, and so for function types and resolvers of the two kinds: `Future` is invariant in `K`.
- **What converts** is subtyping, composed inside other types through their variance (§3.5), as every conversion is:

  | A value of | fits where this is expected |
  | --- | --- |
  | `fn(A) -> R` | `fn(A) -> Future<R, K>`, either kind |
  | `sendable fn …` | `fn …` |
  | `readonly fn …` | `fn …` |
  | `fn …` | `ephemeral fn …` (Rule 7) |

- **Qualifier variables.** A higher-order function keeps its arguments' qualifiers, with no new syntax: `logged(f)` is `sendable` when `f` is, and `readonly` when `f` is and its own body adds no effect.
- **Overloads** on the two kinds are two types, so they don't clash. A plain function passed to such a pair converts either way, so that call is ambiguous (§3.7).
- **Modifiers stack in any order.** The formatter sorts them: `extern`; then `sendable` or `ephemeral`, what a value captures; then `readonly`; then `async` or `ista`; then `fn` or `struct`. So `extern readonly async fn`, `extern ephemeral struct` and `sendable readonly ista fn(A) -> R`.

### 5. `select`, combinators, slots and timers

- **One kind per `await select`.** Every case's awaitable has the same `Mode`; mixing them is a compile error, since racing a commit against an in-memory wait is a bug. The `select` commits when its kind is persistent. A non-blocking `select … else:` neither waits nor commits, so its cases may mix: a persistent function polls a persistent signal, such as a cancel, while ephemeral work is in flight.
- **Combinators are written once,** as awaitables generic over the kind:

  ```python
  fn first<T, K in Persistence>(...fs: Array<Future<T, K>>) -> First<T, K>    # First's Mode is K
  ```

  Inference itself refuses a mix: one type parameter can't take two types (§3.5), and `K in Persistence` always stands for one member. Every function of `futures` takes this shape.
- **Code generic over the kind can't `await`,** since no header stands for both kinds. It is written against resolvers (`Resolver.of`), as the combinators are.
- **Slots are persistent,** with no kind parameter, and the checker treats them as nothing special. `put`, `take` and `read` are prelude externs giving persistent futures (§3.8), `read` declared `readonly`. `Inbox`, written on slots in the language, and every other type built on them, take their kind and their effects from those functions, through their own bodies.
- **A call's unfixed kind comes from its function.** A `K in Persistence` type argument that nothing fixes settles to the enclosing `async` or `ista` function's kind, a default from context (§3.5), so `time.delay(5s)` is an ephemeral timer in an `async fn` and a persistent one in an `ista fn`. A written type always writes its kind.

### 6. Segments and commits

- **A segment** is one execution's code from one commit to its next. Only an `ista` function's `await` on a persistent awaitable commits.
- **A commit persists every execution as of its own last commit.** It never captures one in the middle of running, and doesn't wait for other executions' in-memory awaits. Rule 8 keeps an open segment from changing older state before its last in-memory `await`, so the snapshot is the heap plus each execution's frame as of its last commit.
- **What a segment starts is real only once it commits.** A persistent call it made doesn't resume past its first `await` until then, which today's rule, every `await` committing, gives for free. A spawn is created at that commit, as §9 already says. A discarded segment started nothing.
- **Ephemeral work inside a segment belongs to it.** An async call made there runs with the segment, and runs again when a crash discards it.
- **Re-run state is kept per execution:** `now()`, `random`'s draws and spawn numbering, so a segment run again reproduces them. `now()` is the segment's start time in persistent code, ephemeral calls made inside a segment included, and the clock in ephemeral code outside any segment.

### 7. Check 1: what lives across a commit is persistable

- **`Persistable`** is a built-in marker trait, a reading of a type's reach (§3.1), as `Sendable` is: a value's reach is the least of its parts', a handle's comes from its declaration, and a `Future`'s or `Resolver`'s from its kind. A type is persistable when it is:
  - a primitive or a literal type;
  - a struct, enum, tuple or union of persistable parts;
  - a handle whose contents are persistable: `Shared`, a shared struct, a slot, an inbox, a persistent future or resolver, an `Instance`, a `WeakRef`;
  - a function value of a plain `fn` type.

  `Sendable` implies `Persistable`.
- **A type parameter** held across a commit gets an inferred `Persistable` requirement, checked at each type argument as constraints are (§3.5), the way `readonly` requirements are inferred (Rule 8). Nothing is written, and the error stands at the type argument, never in the generic body.
- **Not persistable:**
  - an ephemeral future or resolver;
  - an `extern ephemeral struct`, a host type the host can't persist, such as a socket, which can't also be declared `sendable`;
  - a function value of an `ephemeral fn` type;
  - anything holding one.
- **`ephemeral fn(A) -> R`** is the type of a closure that may capture a non-persistable value. Function types are structural, so without it check 1 couldn't tell what a closure captured.
  - **Written at declaration sites only:** a parameter, a field, a result or an alias.
  - **A lambda takes it from its expected type.** It may capture a non-persistable value only where an `ephemeral fn` is expected; where a plain `fn` is, such a capture is an error at the capture. With no expected type, a lambda is `ephemeral fn` exactly when it captures one. A local `fn` declaration is a lambda (§3.14).
  - **A plain `fn` fits where an `ephemeral fn` is expected,** never the reverse, as `sendable fn` fits `fn`. Every closure today is persistable, so only new native code writes the word, and `ephemeral` always means "can't be persisted".
- **The check.** At every committing `await`, every live value is `Persistable`. The error names the value and the `await`: "`conn: Socket` is live across this commit".

### 8. Check 2: await first, effect later

In a persistent segment, no in-memory `await` follows an effect.

- **Why.** During an in-memory wait other executions run, and one may commit. That commit saves this execution as of its segment's start. A write made before the wait would be persisted, then made again by the segment's re-run, or seen by other executions before it commits.
- **An effect is one of two things,** with nothing special to any type:
  - **an assignment to a place older than the segment:** a variable declared before it, a field or element of one, a `&` parameter's place, or a field behind a handle (`x->f = v`, a captured `let`'s cell);
  - **a call to a function that isn't `readonly`:** an extern unless declared so, and any other function as its body decides. A non-readonly extern may run in a persistent segment, after the segment's last in-memory `await`; a crash before the commit runs it again, as today (§5). Implicit calls count too: the `dispose` a release runs, and an operator's function.
- **What the segment created itself is free.** Nothing else can reach it, and a re-run creates it again. So a call writing only what the segment created, through its arguments, is no effect.
- **Inferred from bodies.** Each function gets a summary: which of its parameters and captures it may assign through, and whether it calls a function that isn't `readonly`, through everything it calls and every execution it starts. The compiler computes the summaries over the whole program (§3.13). A call's effects stand where the call is, and an awaited call's at its `await`. Slot operations are externs, so `Inbox.send`'s effect is found in its body like any other. A function's defaults are part of its body (§3.3), so a `readonly` function's defaults are checked with it.
  - A lambda written at its call is analyzed where it stands.
  - A `sendable fn` can write only its arguments, since handles are never sendable.
  - Any other function value counts as writing everything it holds, unless its type is `readonly`.
  - A call through a trait, on a constraint or an `any` value, is `readonly` when its requirement is, declared or inferred (below), and otherwise counts as writing everything it holds.
- **`readonly` is trusted only on externs.** There it promises the call changes nothing, in the program or outside it, so running it twice, or a re-run not running it, is harmless. On any other function it is an assertion the compiler checks: the body assigns nothing it didn't create and calls only `readonly` functions. An extern used both ways is declared twice under two names, one `readonly`, and the code calling it picks. Function types carry `readonly`, as they carry `sendable`.
- **A lambda never writes `readonly`.** Where a `readonly fn` is expected, its body is checked for effects. Elsewhere it is `readonly` exactly when its body is, so it fits a `readonly` slot later if it qualifies.
- **`readonly` in traits.**
  - **Declared:** a requirement written `readonly fn` is met only by a `readonly` function.
  - **Inferred:** where generic code needs a requirement's call to be readonly, in a `readonly` function's body or before an in-memory `await` in a persistent segment, its constraint is strengthened as if the trait declared that requirement `readonly`, and so is an `any` type it calls through. The error stands where a type argument or a value converted into that `any` type doesn't meet it, never in the generic body (§3.5).
  - **Either way,** a `readonly` function meets a requirement that isn't declared `readonly`, never the reverse.

```python
ista fn sync(box: Inbox<Msg>, url: String):
    box.send(Msg{…})                  # writes `box`, older than this segment
    const r = await http.get(url)     # error: an in-memory await after an effect
```

### 9. Deferred calls: `g f(args)`

`g f(args)` gives `g` a function that makes the call `f(args)` later, with everything written computed now, as Go's `go` and `defer` do:

```python
retry fetchUser(id)
# is
retry((fn(x): fn(): fetchUser(x))(id))
```

- **Shape.** A name, or a path of names joined by `.`, then on its line a call. The parser reads it from the text alone, so parsing still never depends on what a name means.
- **What runs now:** the callee, with its receiver and any calls before the last one, and every argument written, left to right. Only the outermost call is deferred, so `retry load(id).process()` calls `load(id)` now. Defaults are part of the function (§3.3), so a default the call leaves out is computed when the deferred call runs, inside it.
- **What `g` takes:** one parameter of a function type without parameters, `fn() -> X`, any others having defaults. A method counts, its receiver as `self`: `pool.submit encode(file)`. Anything else is an error: "`g` doesn't take a call to run later".
- **What's captured:** the values computed, as copies. A `sendable fn` parameter makes them sendable. A deferred call can't take a `&` argument, since no reference can be captured (§3.14).
- **Precedence** is prefix `await`'s: `await retry fetchUser(id)` is `await (retry fetchUser(id))`, and `(g f()).x` needs its parentheses.
- **Nesting** reads from the right: `a b c(x)` is `a(fn(): b(fn(): c(x)))`, with `x` computed now.
- **The bracket form passes a value:** `retry(makeAttempt(x))` calls `makeAttempt` now and passes the function it gives.
- **A missing comma.** `[a b(c)]` is an error today, and may now check as a deferred call. Where it doesn't, the error points at the likely missing comma.
- **Callbacks with parameters** keep their lambda: `bus.subscribe(fn msg: …)`.
- **No call needs a keyword of its own.** `spawn` and `defer` are functions called this way, as are the runtime's other functions taking a call to run later (proposal 9).
- **`g(args) f(x)`** gives `g` its other arguments in parentheses: `retry(times: 5) fetchUser(id)`.
- **`defer` becomes a prelude function,** no longer a keyword: `fn defer(f: fn() -> Unit) -> Deferred`, where `Deferred` is a disposable whose `dispose` calls `f`. `_ = defer log(x)` computes `x` now and logs when the block ends, and `hold _ = defer log(x)` when the function ends, as Go's `defer` does. Release order runs them last first (§7). A disposable is must-use, so a bare `defer log(x)` is an error.

### 10. Externs

- **`extern readonly fn`** marks a host call as changing nothing, the one place `readonly` is trusted (Rule 8). An extern used both ways, such as an HTTP call that may be a GET or a POST, is declared twice: `extern readonly async fn httpGet(…)` and `extern async fn httpSend(…)`, the same host function under two keys.
- **`extern async fn` and `extern ista fn`** spell the kind of the future the extern gives (Rule 2).
- **`extern ephemeral struct`** declares a host type that can't be persisted (Rule 7). A disposable host type stays as today (§3.6).
- **A future-returning extern's implementation receives the resolver** of the future its call gives, and resolves it when it can, from any thread; the runtime posts it to the program's event loop.
  - **`onCancel` is the disposal notice.** It fires at once for an ephemeral future, and once the disposing segment commits for a persistent one, so a disposal rolled back never reaches the host.
  - **Dropping the resolver unresolved** panics the waiter, naming the extern. It is a host bug, as a result of the wrong type is (§3.12).
  - **A persistent resolver crosses as its id** (Rule 3), so the host can resolve it after a restart.
  - **A JavaScript host may return a promise instead,** as today, which resolves it when it settles.
- **Extern keys** spell a function type's kind: `fn(String) -> Future<Int, "ephemeral">`. Hosts re-key once.

### 11. The runtime contract

Every backend implements these, and the compiler guarantees the rest:

1. **`await`:** Rule 3's four steps.
2. **Commit:** each execution persisted as of its own last commit (Rule 6).
3. **Resolvers:** Rule 3's guarantees and Rule 10's notices.
4. **Starts at commit:** the persistent calls and spawns a segment started become real at its commit.
5. **Re-run state per execution:** `now()`, `random` and spawn numbering.

**Lowering.** Every `await`'s mode is known from types. The interpreter waits in memory on an ephemeral awaitable and snapshots before a persistent one. A native backend makes an ephemeral function a coroutine with its frame on the heap (`llvm.coro.*`). A persistent function's frame holds only persistable values at its commit points, so the compiler emits its serializer.

## Why

- **Two keywords.** `async` keeps the meaning every other language gives it, so code guessed from TypeScript, Kotlin or C# means what it says. `ista` names the feature only Istalang has. The kind lives in the result type, so proposal 8's one-type rule carries over.
- **Kinds that never meet.** An `await`'s behaviour reads from its operand's type alone, with no exception. Mixing the kinds is almost always a bug.
- **Checks, not runtime handling.** Both checks are compile errors, so no backend tracks dependencies between executions, and no commit waits on another execution.
- **Resolvers, not continuations.** The runtime keeps the continuation, and an awaitable receives a one-shot resolver. A continuation called twice would run its caller twice, and one never called would hang it, which nothing short of linear types could check.

## What changes in behaviour

| Code | Today | Proposed |
| --- | --- | --- |
| `async fn approve(req: Req) -> Future<String>:` | persistent: every `await` commits | error: `Future` takes its kind. The repository's rewrite makes it `ista fn approve(req: Req) -> Future<String, "persistent">` |
| `async fn two(x: Int) -> Int: x * 2` | error 5021 | an ephemeral `async fn(Int) -> Int` |
| `async fn get(u: String) -> String: await http.get(u)` | (no ephemeral waits) | waits in memory, never commits |
| `Future<Int>` | the one future type | error: name its kind |
| `conn: Socket` live across `await time.delay(1d)` in an `ista fn` | (no ephemeral types) | error: not persistable across this commit |
| `box.send(m)`, then `await http.get(u)`, in an `ista fn` | (no ephemeral waits) | error: an in-memory await after an effect |
| `charge(id)`, then `await http.get(u)`, in an `ista fn` | (no ephemeral waits) | error: an in-memory await after an effect |
| `await select` with a persistent and an ephemeral case | (one kind) | error: one kind per `select` |
| a non-blocking `select` with a persistent and an ephemeral case | (one kind) | legal: it never waits |
| `fn(i): conn.write(i)`, capturing `conn: Socket`, passed where `fn(Item) -> Unit` is expected | (no ephemeral types) | error at the capture; legal where `ephemeral fn(Item) -> Unit` is expected |
| an `async fn` calling an `ista fn`, or receiving from an inbox | (one kind) | error: ephemeral code makes no persistent future |
| `time.delay(5s)` in an `async fn` | (one kind) | an ephemeral timer |
| `async fn main()` awaiting a host queue's `receive()` | the program's persistent root | error: ephemeral code makes no persistent future; the rewrite moves the body into an `ista fn` that `main` runs in a context |
| a function or field named `ista` | legal | error: reserved |
| `retry fetchUser(id)` | error: a missing `,` | a deferred call |
| `defer fn(): log(x)` | the `defer` keyword: runs when the block ends | error: a disposable left unused. Written `_ = defer log(x)`, computing `x` now |
| `readonly fn f()` whose body calls a non-readonly function | (no `readonly`) | error: `f` isn't readonly |
| `ista fn notify<T is Notifier>(x: T)` calling `x.send()` before an in-memory `await`, then `notify(email)` where `Email`'s `send` isn't readonly | (no `readonly`) | error at `notify(email)`: `T`'s `send` must be readonly there |
| `spawn purchase(req)` | a keyword | the runtime's function in the deferred form; its defaults still computed in the new instance, as part of the function |
| `fn log(msg: String, at: Time = time.now())` | the default runs as code of its own, called from the call | the default is part of `log`, computed at the start of its call |
| `extern async fn fetch(r: Request) -> Response` | error | `extern fn fetch(r: Request) -> Future<Response, "ephemeral">` |
| `retry(3, fn(id): Order{id})`, `call: ista fn(String) -> Order` | error 5001 inside the body | fits: a resolved future |
| overloads `f(g: async fn() -> Int)` and `f(g: ista fn() -> Int)` | (one kind) | two types, no clash; a plain argument is ambiguous |

After the repository's rewrite (implementation note 9), every program that compiles today compiles and behaves the same, except that extern keys are respelled.

## What changes in power

**Gained.**
- In-memory async: a short wait costs no commit, and ephemeral code holds sockets, files and native handles.
- A persistent function may wait in memory where it chooses, and Rule 8 keeps that sound.
- Custom awaitables, cold ones included, and externs that resolve later and learn of cancellation.
- One deferred-call form for every function that takes a call to run later.
- Higher-order functions that keep their arguments' qualifiers, with no new syntax.

**Not gained.**
- Both kinds in one `select`.
- Code generic over the kind that uses `await`: it uses resolvers.
- Ephemeral code reaching persistent work: proposal 9's runtime provides it.

**Lost.**
- `async fn` meaning persistent, and `Future<T>` without its kind. The rewrite moves every program to `ista fn`.
- `ista` as a name.
- `defer` and `spawn` as keywords: both are functions, `defer` held as `_ = defer f()`.
- Overloads told apart only by the spelling of a function type, as in proposal 8.

## Spec changes

- **Cheat sheet:**
  - The functions block shows an `async fn` and an `ista fn`.
  - The types line shows `Future<T, "ephemeral">`, `Future<T, "persistent">`, `Resolver<T, K>`, `async fn(A) -> R`, `ista fn(A) -> R` and `readonly fn(A) -> R`.
  - The concurrency block shows which `await` commits, and a deferred call; `defer` is written `_ = defer log("exited")`.
- **§1.** "Visible persistence: every `await` commits" becomes: "`await` is the only place execution can suspend; an `await` on a persistent future commits, and its type says which." The overview names ephemeral code beside workflows.
- **§2.**
  - Reserved words gain `ista` and lose `defer` and `spawn`.
  - Grammar words gain `readonly` and `ephemeral`, among a declaration's or a function type's modifiers, which stack in any order (Rule 4).
  - The types table gains `Future<T, K>` and `Resolver<T, K>`, and the function-types row both kinds.
  - The conversions list: a plain function into either kind, and nothing between the kinds.
- **§3.1.** Sendable types: `Sendable` implies `Persistable`. A new paragraph, **Persistable types** (Rule 7).
- **§3.3.** Both headers and the header rule, calls of both kinds, and ephemeral code making no persistent future. `readonly` on a function, checked against its body, defaults included. **Defaults** are part of the function, as in JavaScript and Kotlin: computed at the start of each call that leaves them out, in the function's scope and before its body, never awaiting. A spawned call computing its defaults in the new instance then follows, no longer a rule of its own. §3.1's field defaults are likewise part of building the value.
- **§3.6.** `extern readonly fn`, `extern async fn` and `extern ista fn`, `extern ephemeral struct`, and a future-returning extern's resolver.
- **§3.7.** Overloads on the two kinds.
- **§3.8.** The prelude gains `Persistence`, `Awaitable`, `Resolver`, `Persistable`, `defer` and `Deferred`, and its `Future` takes the kind. Its slot externs give persistent futures, `read` declared `readonly`. `futures` becomes awaitables generic over the kind. `time.delay` and `time.at` take the kind.
- **§3.9.** The precedence table's prefix level gains the deferred call.
- **§3.10.** The built-in traits table gains `Awaitable` and `Persistable`. Associated types take a member bound. A requirement may be `readonly`, and a constraint is strengthened where its call must be (Rule 8).
- **§3.14.** **Async function types** becomes Rule 4. `readonly fn` and `ephemeral fn` beside `sendable fn` (Rules 7 and 8). A new paragraph, **Deferred calls** (Rule 9).
- **§5.** Rewritten: the two kinds of `await`, segments per execution, commits, starting at commit, checks 1 and 2, and re-run state.
- **§6.** Every wait is a wait on a slot or a resolver.
- **§7.** A resolver's `onCancel`, and a dropped resolver panicking its waiter. **Defer** describes the prelude's `defer` (Rule 9).
- **§8.** One kind per `await select`; the non-blocking form may mix.
- **§9.** A host starts only `async fn`s; persistent work runs in contexts the program enters (proposal 9). `spawn` is the runtime's function, defined by proposal 9. Extern keys spell kinds.
- **§12.** The examples use `ista fn` and `Future<…, "persistent">` throughout.
- **§14.** Future work gains a header for code generic over the kind.

## Implementation notes

1. **Syntax.**
   - **Words:** `ista` joins the reserved words, and `defer` and `spawn` leave them, their nodes going (`compiler/syntax/tokens/index.ts`, `compiler/syntax/expressions/index.ts`). `readonly` and `ephemeral` join the grammar words (`compiler/syntax/tokens/grammar-words.ts`). `test/vscode-grammar.test.ts` holds the VS Code grammar to them.
   - **Modifiers** parse in any order, each at most once.
   - **Deferred calls:** a new expression node, a path and a call, parsed where a name or path is followed on its line by a call (`compiler/parser/grammar/`).
2. **Checker.**
   - **Function types:** `isAsync` becomes the result's kind (`checker/types/type/function-types.ts`, `index.ts`). Every spelling builds through the one constructor, so nothing downstream sees which was written: proposal 8's normalization at construction.
   - **Futures:** `Future`'s kind is a required member parameter. A call's unfixed `K in Persistence` takes the enclosing function's kind, as a settling rule.
   - **Fitting:** the qualifiers are subtyping in the constraint system, composed through variance: a plain function into either kind, `sendable fn` into `fn` into `ephemeral fn`, `readonly fn` into `fn`; nothing between kinds (`checker/types/fitting/`). Qualifier variables carry a higher-order function's qualifiers through. A lambda's captures are checked against its expected type (`constructs/closures/lambdas.ts`).
   - **`Persistable`:** a threshold of the one reach derivation `Sendable` reads (`checker/types/traits/`), never a copy of it.
   - **`await` and `select`** (`constructs/expressions/control/await.ts`, `select.ts`): find the `Awaitable` conformance, read `Mode`, run check 1 over the live values at a committing `await`, and require one kind in a `select`.
   - **Check 2:** a new analysis with two parts, placed per `docs/arch/architecture.md`. Function summaries are computed over the call graph to a fixpoint, together with whether a function makes a persistent future, for Rule 2, and checked against every `readonly` written on a function. A flow pass marks values fresh or older within each segment. No type is special to it: slots, inboxes and the rest are reached through their functions' summaries.
   - **Traits:** a generic function's summary records which requirements it needs `readonly`, and its callers' type arguments and `any` conversions are checked against them, as constraints are.
   - **Deferred calls** desugar to their closure in one place. `constructs/expressions/control/spawn.ts` goes: `spawn`'s rules come from its parameter's `sendable fn` type.
3. **Lowering.** An `await` lowers by its static mode, and a deferred call as its closure. The spawn path in `lowering/constructs/expressions/calls.ts` goes.
4. **Runtime.**
   - **Segments** (`runtime/scheduler/segment/index.ts`): today every `await` by a driver commits. Now only a persistent one does, and an in-memory `await` suspends without committing.
   - **Snapshots** (`runtime/snapshot/`): each execution's frame is kept as of its last commit. A snapshot is the heap plus those frames, collected from them, so the executions an open segment started are left out.
   - **New machinery:** the queue of what a segment starts, released at its commit; resolvers, with their one-shot rule and `onCancel`.
   - **Re-run state:** `random`'s count (`runtime/snapshot/random.ts`) and spawn numbering are kept per execution.
5. **Host** (`runtime/host/index.ts`, `settle.ts`, `cli/host-module.ts`). An extern returning a future receives its resolver, and a returned promise still resolves it.
6. **Definition** (`definition/extern-key.ts`, `docs/arch/definition.md`). Function types carry their kind and lose the `async` flag. Every extern key is respelled, so hosts re-key as after proposal 1.
7. **Standard library.** The prelude gains `Persistence`, `Awaitable`, `Resolver` and `Persistable`, with `Future` taking the kind, and `defer` with `Deferred`, a shared struct whose `dispose` calls its function. `futures` becomes awaitables over the kind (`stdlib/futures/futures.ista`), and `time`'s timers take it.
8. **Formatter and tools** (`formatter/types.ts`, `declarations.ts`). Types print `async fn(A) -> R` and `ista fn(A) -> R`, and headers the body's result, `ista fn f() -> R`, since the keyword carries the kind; externs alike, `extern async fn f() -> R`. Modifiers print in Rule 4's order. Hover and signature help print the spelling the formatter writes, and a deferred call's hover shows the call it defers.
9. **The repository's sources: a scripted rewrite through the project's own parser.** No ephemeral code exists yet, so every program keeps its meaning:
   - every `async fn` but `main` becomes `ista fn`: about 308 in `.ista` files and 40 in the spec, beside about 220 `main`s;
   - every `Future<T>` becomes `Future<T, "persistent">`: about 310 and 38;
   - a `main` that makes a persistent future moves its body into an `ista fn`, which `main` runs in a context (proposal 9's `at` and `call`);
   - every `defer f` statement becomes `_ = defer(f)`: 17 in `.ista` files and 2 in the spec.

   The same rewrite reaches sources embedded in TypeScript tests (about 279 `async fn` and 154 `Future<`). Then `ista fmt` runs.
10. **Tests** (fast-check, beside the code):
    - each pair of spellings gives equal types (`typeKey`);
    - over generated programs, an ephemeral `await` never writes to the store and a persistent one always does;
    - **soundness:** a program passing both checks, crashed at every point and resumed, ends as an uncrashed run does, its ephemeral results held fixed;
    - a deferred call equals its desugared closure (the commute law of `test/AGENTS.md`);
    - a second `resolve` panics, a dropped resolver panics its waiter, and disposal fires `onCancel` once;
    - every refusal in the behaviour table.

## Decisions (the human's)

1. **Two kinds:** `async fn` is ephemeral, as other languages have it, and `ista fn` is persistent, the new feature. `await` serves both, and commits exactly when its operand is persistent.
2. **`Future<T, K>`** writes its kind always, with no alias.
3. **The kinds never fit each other,** and a `select` mixing them is a compile error.
4. **`Awaitable` gives an expert a callback,** made a one-shot resolver so the runtime keeps the continuation. `Future` is one awaitable among others. Combinators are written once, and `first`'s type keeps kinds from mixing.
5. **The host learns when a future is disposed,** so it can cancel its work.
6. **Soundness is two compile errors,** checks 1 and 2, inferred without declarations. Whether a value is persistable or fresh is derived, never declared.
7. **An effect is an assignment to older state, or a call to a function that isn't `readonly`.** `readonly` is trusted only on externs, and on every other function is an assertion checked against its body. An extern used both ways is declared twice, one of them `readonly`.
8. **Slots are persistent only, and nothing special to the checker.** `Inbox` is written on slots in the language, and every such type's effects come from its functions' bodies.
9. **A non-readonly extern counts as an effect,** so a persistent segment calls it only after its last in-memory `await`.
10. **`now()` reads the clock in ephemeral code outside any segment,** and is its segment's start time in persistent code, as today.
11. **Any function taking a call to run later takes the deferred-call form,** its arguments computed where they are written, and `g(args) f(x)` passes `g`'s other arguments.
12. **`defer` is a prelude function like any other,** returning a disposable that calls its function when released, so `_ = defer f(x)` and `hold _ = defer f(x)` give block and function scope, the latter Go's.
13. **The formatter writes `async fn(A) -> R` and `ista fn(A) -> R` in types, and the body's result in headers.** This reverses the earlier proposal 8's second decision.
14. **A non-blocking `select` may mix kinds,** since it neither waits nor commits.
15. **`ephemeral fn` types a closure that may capture a non-persistable value,** written at declaration sites only. A lambda takes it from its expected type, and a plain `fn` stays persistable.
16. **`extern async fn` and `extern ista fn`** spell the kind of an extern's future.
17. **Modifiers stack in any order,** and the formatter sorts them.
18. **`readonly` in traits:** a requirement may declare it, which binds whoever meets it. Undeclared, it is inferred where generic code needs it, strengthening the constraint, and the error stands at the call site. A `readonly` function meets a requirement that isn't, never the reverse.
19. **A lambda never writes `readonly`;** it takes it from its expected type, or from its body.
20. **`spawn` is no keyword,** but a runtime function in the deferred form, as `defer` is a prelude one.
21. **Defaults are part of the function,** computed at the start of its call, as in JavaScript and Kotlin. They never affect the caller, and a deferred call computes them when it runs.
22. **The language is separate from the runtime.** The compiler checks everything, the runtime contract is fixed, and a backend implements futures as it needs. Starting persistent work from ephemeral code, and every other runtime mechanism, is proposal 9's.
23. **This replaces the earlier proposal 8,** and keeps its one-type rule.
24. **Conversions are subtyping** composed through variance, the qualifiers ordered among themselves, and qualifier variables keep a higher-order function's qualifiers (tracker F28, `docs/work/variance-inference/design.md` §7).
25. **A type parameter held across a commit** gets an inferred `Persistable` requirement, checked at its type arguments; a persistent future's `T` is checked the same way, through check 1.
