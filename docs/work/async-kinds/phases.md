---
description: scope, acceptance and spec edits of each async-kinds phase (proposal 8, with `delegate` and the minimal slice of proposal 9 that enters contexts) — the text fork briefs quote verbatim; read before forking or examining a phase
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-10
last_updated: 2026-11-10
tags: [plan, proposal-8, async]
---

# Async kinds: phases

"Rule N" is proposal 8's. Each phase also edits the docs it touches (`architecture.md`,
`docs/reuse/`, `boundary.md`, `definition.md`) and its tracker rows. Its acceptance names every
fixture and corpus diagnostic it is expected to move; nothing else moves.

## A0 Function heads: done (`321bc5da`)

One modifier-set parser for every head, any order, each at most once (2044 repeated, 2045
conflicting, 2046 misplaced); syntax qualifiers grouped (`reach`, `kind`); one order every printer
reads. K1a regrouped `kind`.

## R1a Async host: done (`e4debfd6`, `b591f0fc`)

The host and test-world contract asynchronous, one driver (`host/drive.ts`), active instances
resident (`scheduler/resident.ts`). Concurrent host calls on one instance aren't serialized yet:
R1b's.

## T0 One function type: done (`ebd1a8d3`..`fd249976`)

One `FunctionType` constructor carrying `reach`; one qualifier fit; `async fn(A) -> R` is
`fn(A) -> Future<R>`; the Definition's function types and keys without `async`. F1 makes `reach`
`Fn`'s `Send` slot.

## R1b Live runs: done (`71f3a5f2`..`51cc0b0c`)

Code-entry kinds (`plain`, F1's `simple`; `live`; `ista`); live runs in memory, never committing,
their waits through the one-shot resume primitive; host calls on one instance serialized; `now()`
the clock in a live run.

## DC Defaults and deferred calls: done (`56e13911`..`8d28e871`)

The source rewriter (`scripts/rewrite`); defaults in the callee (B16); `g f(args)`; `defer` and
`spawn` prelude functions, `Instance<R>` carrying its encoder (B4).

## K1a Kind words: done (`6a451ee8`..`01c0aaaf`)

`live` and `ista` as contextual words; `Future<T, K in Persistence>`; the start rule's one home;
`awaitedOf`; the kinds spelled once; the `kinds` rewrite to `ista async fn` and `Future<T, "ista">`.
Interim: an unmarked `async` head gives `Future<T, "ista">`, which K1b ends.

## F1 Function types as `Fn` (structural; behaviour unchanged)

**Scope.**
- One builtin `Fn<Args, Result, Kind = "simple", Send = "plain">` (Rule 4). T0's constructor
  carries the kind and `Send` as type slots, its `reach` field becoming the `Send` slot. `Args` is a
  tuple (`(A,)` for one parameter, a pack one too, `&T` items for by-reference parameters). Every
  spelling, `fn(A) -> R`, `live fn`, `sendable fn`, `ista async fn`, is its sugar, built through the
  one constructor; `typeKey` and type text derive from the canonical form.
- The prelude's `DataKind = "simple" | "live" | "ista"`, `Persistence` its kinded subset, and
  `Sendability = "sendable" | "plain"`. Their two orders (Rule 4) join the fit relation and the
  constraint system, encoded as the checker sees fit, not as subtyping between their members.
- Head mark parameters parse and check as type parameters: `M fn`, `K async fn`, and a
  requirement's `Self.Mode fn` (AW gives it meaning).
- The standard library's and `testing`'s higher-order functions take `M in DataKind` and
  `S in Sendability` and keep their arguments' (F28, absorbing QV); `Deferred<M in DataKind>`,
  `defer<M>`, `M fn dispose`.
- One spelling each: R1b's code-entry `plain` becomes `simple`, T0's `Reach` becomes
  `Sendability`.
- Unmarked `async` heads and types keep K1a's interim; the data rule is K1b's.

**Accept.** Property: each sugar's `typeKey` equals its `Fn` spelling's, over generated arguments,
kinds and sendabilities. `logged(f)` keeps `f`'s sendability, `sendable` in and out, plain in and
out; `map` keeps `f`'s mark. A one-parameter `Fn<(A,), R>` and an `&T` item check and run.
`_ = defer log(x)` and `hold _ = defer log(x)` behave as before. No function-type literal outside
the constructor, and no second spelling of `plain` or `Reach`. The full suite unchanged; profile
within noise.

**Spec.** §2 types and conversions; §3.5 mark parameters and the two orders; §3.8 prelude;
§3.14 function types.

## R2 Resolvers (runtime and host)

**Scope.**
- One resolver per wait (Rule 5), extending R1b's resume primitive: live, a reference to the
  suspended code; ista, a heap object naming the waiter, registered where it will be resolved from
  (slots' waiter queues, timers, results) and committed with the frame. `Futures.resolve` stops
  scanning executions.
- One-shot `resolve` and `tryResolve`; released unresolved, it panics its waiter; `onCancel` once
  its waiter is gone (live at once, ista once the disposing segment commits). A `select`'s losing
  cases are cancelled, so a losing `take` consumes nothing; a non-blocking `select`'s `else`
  cancels every case.
- A live future-returning extern receives its resolver; a returned promise still resolves it.

**Accept.** A second `resolve` panics; a dropped resolver panics its waiter, naming the extern;
disposal fires `onCancel` once; an ista disposal a crash rolls back fires nothing. A `select` won
by one slot leaves the other slots' values. In `wake.bench.ts` resolving no longer grows with
executions. The full suite unchanged.

**Spec.** §3.6 an extern's resolver; §6 waits; §7 `onCancel` and dropped resolvers.

## K1b The data rule (behavioural, then rewrite)

Starts fresh, after F1; mebu's `k1b2` branch is reference only. Keeps K1a's ranges (plan.md).

**Scope.**
- A value's data kind, `simple`, `live` or `ista`, in one memoized home, derived per instantiation
  from what a type holds: a future's or resolver's `K`, an `extern live struct` live, a slot ista,
  a function value simple. Shaped so a declared kind (proposal 9's `ista const`) slots in later. A
  type holding both kinds is an error.
- The data rule (Rule 2) over every value a body handles, its signature's included: parameters,
  result, locals, temporaries, each expression; an extern's signature alone (Rule 9). A missing
  mark is an error naming the value; lambdas infer theirs.
- Transparent generics (Rule 3): a type parameter's values, requirements and `dispose` pass
  through unmarked code, checked at the caller.
- Calls as the rule's consequence, implicit calls and releases included (B54): the callee's head
  mark bounded by its caller's; bounded mark inference in the constraint system, the least mark
  allowed, a caller's mark parameter `K` solving an undecided one to `K`, a decided mark above the
  bound an error naming the call. Lowering compiles a mark-generic function once per mark, each
  entry with its kind.
- Requirements' marks (Rule 4): an implementation handles what its requirement allows and the
  implementing type's data.
- An unmarked `async fn` and `async fn` type are errors; K1a's interim goes. An `await`'s and a
  `select`'s mode is its code's mark; an operand of the other kind is refused.
- `time.delay` and `time.at` (`extern K fn`) and `worker.disposing()` in both kinds; extern keys
  spell kinds, the Definition's validation following.
- The rewrite, through DC's rewriter: a kind-marks pass marking what the rule needs, from its
  errors, until none is left; every `async fn` type its kind; `async fn main` becomes
  `ista async fn main`, an interim CX ends. A host's future-giving externs stay `ista`, filled as
  today, an interim DG ends.

**Accept.** The behaviour table's rows on `async fn two`, an `async fn` parameter type,
`fn y()` calling a live `x`, `fn f(s: Socket)`, `extern fn getSocket`, `f1` returning a `live fn`,
`id(f)` in both kinds, `fn x(): _ = time.delay(1s)`, `fn w(): _ = defer log(x)`, a
`live async fn` calling an `ista async fn` or receiving from an inbox, `time.delay(5s)` in a
`live async fn`, `retry` given either kind, `await select` over the other kind, `main` awaiting a
host queue (as the interim) and the overload pair; `await http.get(u)` in an `ista async fn` is
refused (its `delegate` form is DG's). `retry` given a live `f` in ista code is refused, naming the
call; unmarked generic code releasing a `T` that is a `Socket` checks. `live async fn get` writes
nothing to the store across its wait. A mark-generic function used at two marks gives two
entries, each running as its mark. Property: in accepted generated programs no ista frame holds
live data, no live frame ista data, and no instance calls live code. The full suite passes after
the rewrite, but for respelled sources and extern keys. Profile within noise.

**Spec.** Cheat sheet; §1; §2; §3.1; §3.3; §3.5; §3.6; §3.7; §3.8; §3.10 requirement marks;
§3.14; §5 (two awaits, segments, commits, starts at commit, re-run state); §8; §9; §12.

## DG Delegate, a slice of proposal 9 (runtime, then rewrite)

**Scope.**
- `delegate` (Rule 8): an `ista` runtime function in the deferred form,
  `delegate<R is Sendable>(job: sendable live async fn() -> R) -> Future<R, "ista">`. The job is
  queued in the instance's job inbox at the commit, run by the runtime's loop as a live run (R1b),
  and run again after a crash or restart until its result commits into the future through a
  registered ista resolver (R2), under a key stable across its runs. Its job and its result must
  be sendable, the crossing check (Rule 2), refused where they aren't.
- Host externs: a host's async externs are `live`; externs generic over their mark and `ista`
  externs are the runtime's, which deploy checks. Host-filled ista futures go, with `HostCall.pending`,
  `Runtime.fill`'s token, `Futures.fromHost`, `resolveHost`, `createFilled` and the CLI's token
  wrapping; the extern wrapper execution goes (B6).
- The rewriter makes every host extern giving a future `extern live async fn`, and ista code's
  `await` of one `await delegate …`.

**Accept.** `await delegate charge(c, n)` runs `charge` once after the commit, its result in the
future; a segment crashed before its commit never runs it; crashed after the job starts and before
its result commits, it runs again under the same key. The behaviour table's `await http.get(u)` and
`charge(id)` rows in their `delegate` form. A job or result that isn't sendable is refused. Deploy refuses a host's mark-generic or
`ista` extern. No host token remains. Property: over generated programs crashed at every `await`, every
job runs at least once per committed start and never for a discarded segment. The full suite passes
after the rewrite; `wake.bench.ts` within 10%.

**Spec.** §3.6 externs; §3.8 `delegate`; §5 jobs; §9 hosts.

## AW Awaitables (behavioural)

**Scope.**
- `Awaitable<T>` with `type Mode in Persistence`, member bounds on associated types being new, and
  `Self.Mode fn onAwait`, an associated type bound to `Persistence` as a requirement's mark; `Resolver<T, K>` over R2, with `Resolver.of`. `Future<T, K>` is the runtime's
  awaitable, `K` its `Mode`, with a native `onAwait`.
- One await path: `await` and `select` cases over any awaitable, the conformance found through
  `awaitedOf`, `Mode` read, lowering calling `onAwait` with the runtime's resolver; no second
  instruction for futures.
- `Resolver.of`'s callback takes `K` as its kind; an ista one runs as a segment of its own.
- `futures` rewritten once as awaitables over `Resolver.of`, generic over the kind through mark
  parameters (`K fn first`, Rule 6);
  inference refuses a mix. `futures.timeout` starts its timer when called. The native `first`, its
  future state and `#pendingFirsts` go.

**Accept.** A cold custom awaitable starts its work at `await`, its `Mode` deciding the commit.
`first` over two kinds is an inference error; over one kind it works in a `live async fn` and an
`ista async fn`. `Resolver.of` waits without `await`; an ista callback runs as its own segment.
Every `futures` test passes in both kinds. No `futures` native remains.

**Spec.** §3.5 member-bound associated types; §3.8 prelude and `futures`; §3.10 `Awaitable`; §8.

## CX Contexts, the minimal slice of proposal 9 (behavioural)

**Scope.** Only what running and testing ista code from live code needs; the rest of proposal 9 is
a plan of its own.
- `Runtime.open(runtime.hostStore())`, a `live async fn`, gives a `Runtime`, a live disposable value
  over the host's store: the CLI's `--store`, memory without it, a test's own in the test runner.
  Opening it resumes the work persisted there, so `--resume` goes: running the program again on the
  same store resumes its contexts.
- `rt.call(key) f(args)`, the deferred form with arguments, runs `f`, an `ista` function, in the
  context named `key`, an instance, creating it. It gives a `Call<R>`, a live awaitable: awaiting
  it gives `Result<R>`, an `Err` when `f` panics. Every call starts a new invocation, and releasing
  a `Call` cancels nothing. The wait is the one cross-instance wait `Instance.result()` and mock
  answers use. Its arguments and result must be sendable, the crossing check (Rule 2).
- A host starts only live code, through K1a's entry rule, and what else it may start today
  (`starts`) follows. The interim ends: the rewriter moves each `ista async fn main`'s body into an
  `ista async fn` that a `live async fn main` calls in a context through `rt.call`. The test runner, `World` and the
  test kits run ista code in contexts of their own; `testing`'s crash-every-await is a context
  option.
- Left to proposal 9's plan: `runtime.call` from ista code, `Call` replacing `Instance` (`spawn`
  unchanged here), `accepted()`, `delete`, context constants (`ista const`), `Kv` stores,
  `runtime.jobKey()`.

**Accept.** `live async fn main()` awaiting `rt.call("o/1") purchase(order)` runs `purchase`
persistently and gives `Ok` of its result; crashed at every `await` of the context, it resumes to the
same result; a panicking `purchase` gives an `Err`; a non-sendable argument is refused. The context commits while `main` waits in
memory. On `--store`, a context stopped mid-invocation resumes when the program next opens the
store. A host asked to start an `ista` function refuses. No `ista async fn main` remains; the full
suite passes.

**Spec.** §9 runtimes, contexts and hosts; §10 testing persistent work.
