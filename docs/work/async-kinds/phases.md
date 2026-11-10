---
description: scope, acceptance and spec edits of each async-kinds phase (proposal 8, and the slices of proposal 9 it needs, `delegate` and contexts) — the text fork briefs quote verbatim; read before forking or examining a phase
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
reads. K1 regroups `kind` as below.

## R1a Async host: done (`e4debfd6`, `b591f0fc`)

The host and test-world contract asynchronous, one driver (`host/drive.ts`), active instances
resident (`scheduler/resident.ts`). Concurrent host calls on one instance aren't serialized yet:
R1b's.

## T0 One function type (structural, then behavioural)

**Scope.**
1. One `FunctionType` constructor in `types/type/`, which every builder and rebuilder goes through,
   lowering's included. The type carries `reach` (`sendable` or plain) and a slot for the kind K1
   adds (unmarked, `live`, `ista`), each shaped so a variable can stand in it (K1's kind variables,
   QV's reach variables). One function-fit relation over the qualifiers, replacing every copy
   listed in `findings.md` and `trait-objects.ts`'s `isAsync` branch, composing inside types
   through variance.
2. The one-type rule: `async` leaves the type, and `async fn(A) -> R` is built as
   `fn(A) -> Future<R>`. The async fit is `fn(A) -> R` into `fn(A) -> Future<R>`. Every
   "async means a `Future` result" mapping and `?? errorType` unwrap goes. `typeKey` and type text
   derive from the canonical form, and so do the Definition's function types and extern keys,
   which drop `async` (a key spells `fn(A) -> Future<T>`). A plain lambda where an async function
   is expected gives a resolved future; an `async` lambda's body checks against the future's value.
   Lowering reads a nested function's own header, not its type, for whether its body awaits; the
   code entry's kind itself is R1b's. Syntax readers of A0's `qualifiers.kind` go through one
   accessor, which K1 splits. `testing`'s `async` overloads of `mock` and `calls` go, since they
   would clash.

**Accept.** Property: `typeKey(async fn(A) -> R) == typeKey(fn(A) -> Future<R>)` over generated
`A`, `R`. A plain `fn(A) -> Future<R>` fits where `async fn(A) -> R` is expected, and runs.
`Array<fn() -> Int>` into `Array<async fn() -> Int>` converts and runs. Overloads on
`fn() -> Future<Int>` and `async fn() -> Int` clash. `retry(3, fn(id): Order{id})` with
`call: async fn(String) -> Order` fits; `fn(Int?) -> Int` into `async fn(Int) -> Int?` converts and
runs. B33's repro checks. No function-type literal outside the constructor. Profile within noise.

**Spec.** §2 conversions, §3.14 async function types.

## R1b Live runs (runtime; programs unchanged)

**Scope.**
- A code entry's kind (plain, `live`, `ista`) replaces its `async` flag; lowering emits `ista` for
  every async entry until K1. An instance runs only `ista` entries and commits at every `await`,
  as today.
- A live run: an entry started outside any instance (by a host, later by a job) runs in memory,
  never commits and never reaches the store; a restart ends it. Its waits suspend in memory and
  resume through a one-shot resume primitive, which R2's resolvers extend. A live future is backed
  by a JavaScript promise, and the waits ride the host's own event loop (Node's, a Worker's): the
  runtime adds no loop of its own, so a later JS backend runs plain and live code as native
  JavaScript (`docs/work/linker/js-codegen.md`, After proposal 8). A host promise awaited in a live
  run resolves in memory; the manual clock fires live timers as it does ista ones.
- Concurrent host calls on one instance are serialized.

**Accept.** Over generated Definitions: a live run never writes the store, and an instance writes
at every `await`. A live run waiting on a host promise resolves in memory while an instance
commits. A manual-clock test fires a live timer. Two concurrent host calls on one instance run one
after the other. The full suite and the `crashEveryAwait` tests unchanged; `wake.bench.ts` within
10%.

**Spec.** None (§5 is K1's). `boundary.md`.

## DC Defaults and deferred calls (structural, then behavioural)

**Scope.**
1. Structural: one committed source rewriter in `scripts/`, through the project's scanner and
   parser, reaching `.ista` files and sources embedded in TypeScript in all three forms (template
   literals, quoted strings, line arrays); DC's, K1's, DG's and CX's rewrites use it.
2. Defaults are part of the function (decision 18): computed at the start of a call that leaves
   them out, in the callee, before its body; field defaults alike. An omitted argument is explicit
   in the Definition, and a function's entry computes its absent defaults first; an extern, struct
   or variant with defaults gets one synthesized entry for it. Traces omit that prologue, so
   `Error.trace` is unchanged. Filling entries go (B16); `defaultsOf` folds into the body if
   nothing else needs it apart.
3. Deferred calls (Rule 10): a syntax node checked as a construct, whose record says what runs now
   (callee, receiver, arguments) and what the closure calls; lowering builds the closure from that
   record. A range step's `by` stays the range's. Hover shows the call deferred. `defer` and
   `spawn` leave the reserved words, with their nodes, instructions and checker construct. `defer`
   is a prelude function giving `Deferred`, a shared struct whose `dispose` calls it; `Revertible`
   becomes a `Deferred` if its shape is the same. `spawn` is a prelude function over a
   `sendable async fn() -> R` (a plain function fits) giving `Instance<R>`, its rules from that
   type, its outcome encoder through one seam shared with `instances.spawn` and every other
   spawning native (closing B4); the new instance's root awaits the future its closure gives, with
   no wrapper frame in traces. A juxtaposition that doesn't check as a deferred call points at the
   missing comma. The rewriter makes every `defer fn(): …` statement `_ = defer …` and every
   `spawn f(x).result()` `(spawn f(x)).result()`.

**Accept.** Property: a deferred call equals its desugared closure (`test/AGENTS.md`'s commute
law). `retry load(id).process()` calls `load(id)` now; `a b c(x)` computes `x` once, now;
`retry(times: 5) fetchUser(id)` and `pool.submit encode(file)` check. `_ = defer log(x)` logs at
block end with `x` computed now, `hold _ = defer log(x)` at function end, last first; bare
`defer log(x)` is the must-use error. A `&` argument, or a `g` taking no `fn() -> X`, is refused.
A default leaving its call out is computed inside the callee, and a deferred call computes its
defaults when it runs; `f(b: 2)` on `fn f(a: Int = 1, b: Int = 2)` computes `a` in `f`; traces
show no filling frames. `spawn purchase(req)` behaves as today, for an async and a plain callee,
its outcome encodable to the host, and so are `runtime.isolate`'s and testing's instances. `[a
b(c)]` reports the missing comma where it doesn't check. The rewriter, run twice, changes nothing
the second time. Moves: `concurrency/invalid-spawn.ista`, `weak-side/invalid-revertible.ista`,
`values/invalid-shared-structs.ista`, `trait-objects/crossing.ista`, each named with its new
diagnostics in the report.

**Spec.** Cheat sheet; §2 reserved words; §3.1 field defaults; §3.3 defaults; §3.9 precedence;
§3.14 deferred calls; §7 defer; §9 spawn.

## K1 Kinds (structural, rewrite, then behavioural)

**Scope.**
1. Structural:
   - The entry rule gets one home, read by `compile.ts`, the checker's declarations, the
     Definition's validation, lowering and the binder.
   - `awaitedOf(type) → {value, mode}` is the one reader of what an awaitable gives, replacing
     every `futureArgument`/`futureOf` reader; AW swaps its implementation. The two kinds are
     spelled once, in `well-known`.
   - `kindOf(type)`: the kind a type's values belong to (a future or resolver of a kind, an
     `extern live struct`, anything holding one), derived on the same walk over parts as
     `Sendable`'s reach, which replaces `sendable.ts`'s switch.
   - A0's head groups: the kind (`live`, `ista`) a group of its own, `async` another; `ephemeral`
     becomes `live`.
2. `live` and `ista` as kinds (Rules 1–4); `Persistence` in the prelude; `Future<T, K in
   Persistence>`. DC's rewriter: every `async fn` but `main` becomes `ista async fn`; every
   `Future<T>` becomes `Future<T, "ista">`, except an `async` header's result, which becomes `T`
   (decision 15); `extern ephemeral struct` becomes `extern live struct`; then `ista fmt`.
   Behaviour-neutral.
3. The kinds (Rules 2–7, 9, 11):
   - The function's kind in T0's slot, with the header rule; lambdas infer theirs; an unmarked
     function fits either kind; the kinds never meet (`K` invariant).
   - The call rule, checked at each call, implicit calls and trait requirements included; a
     signature holding a value of a kind needs that kind; a missing mark is an error naming the
     call. The rewriter marks what the rule then needs, from its errors, until none is left.
   - Kind variables: an unmarked function's implicit `K`, settled to the caller's kind by one
     settling handler fed by a call-site seam, which also settles every unfixed `K in Persistence`;
     unmarked function types in its signature share it; a reference fixes it. Lowering compiles an
     unmarked function once per kind it is used at, as an instantiation, each entry with its kind.
   - An `await`'s and a `select`'s mode is its function's kind; an operand of the other kind is
     refused.
   - A host starts a live or unmarked `async fn` as a live run (R1b). A `main` the call rule makes
     `ista` is rewritten to `ista async fn main`, which the host still starts as an instance: a
     bounded interim, which CX ends. A host's future-giving externs stay `ista`, filled as today:
     a bounded interim, which DG ends.
   - `time.delay`, `time.at` and `worker.disposing()` run in both kinds; `futures` stays `ista`
     until AW. The Definition keeps literal type arguments, so natives generic over `K` read it.
   - Extern keys spell kinds, and the Definition's validation follows; hosts re-key once.
     Signature help prints a header's body result; the formatter prints what is written.

**Accept.** The behaviour table's rows on `async fn approve`, `async fn two`, `live async fn get`,
`Future<Int>`, `fn y()` calling a live `x`, `fn f(s: Socket)`, a `live async fn` calling an
`ista async fn` or receiving from an inbox, `time.delay(5s)` in a `live async fn`, `retry` given
either kind, `await select` over the other kind, `main` awaiting a host queue (as the interim),
`extern ephemeral struct`, `retry(3, fn(id): Order{id})` and the overload pair; `await http.get(u)`
in an `ista async fn` is refused (its `delegate` form is DG's). `live async fn get` writes nothing
to the store across its wait. An unmarked `async fn` used in both kinds gives two entries, each
running as its kind. No `futureArgument` reader and no second entry rule remain. After step 2 the
full suite passes with only respelled sources; after step 3 the same, but for respelled extern
keys. Profile within noise.

**Spec.** Cheat sheet; §1; §2; §3.1; §3.3; §3.5; §3.6; §3.7; §3.8; §3.10 requirement kinds;
§3.14; §5 (two awaits, segments, commits, starts at commit, re-run state); §8; §9; §12.

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

## QV Reach variables (design, then behavioural)

**Scope.**
1. Design first, approved by the human before code: how a signature carries reach variables with
   no new syntax (`variance-inference/design.md` §7, F28), on the mechanism K1 built for kind
   variables; how a result's reach follows its parameters', inferred from the body; how variables
   settle in the constraint system. Written to `qualifier-variables.md`.
2. The design, in T0's qualifier fields, the constraint system and K1's variables.

**Accept.** `logged(f)` keeps `f`'s reach: `sendable` in, `sendable` out; plain in, plain out. The
design's own examples. Profile within noise.

**Spec.** §3.14 function types; §3.5 where variables settle.

## DG Delegate, a slice of proposal 9 (runtime, then rewrite)

**Scope.**
- `delegate` (Rule 8): an `ista` runtime function in the deferred form,
  `delegate<R is Sendable>(job: sendable live async fn() -> R) -> Future<R, "ista">`. The job is
  queued in the instance's job inbox at the commit, run by the runtime's loop as a live run (R1b),
  and run again after a crash or restart until its result commits into the future through a
  registered ista resolver (R2), under a key stable across its runs.
- Host externs: a host's async externs are `live`; unmarked async and `ista` externs are the
  runtime's, which deploy checks. Host-filled ista futures go, with `HostCall.pending`,
  `Runtime.fill`'s token, `Futures.fromHost`, `resolveHost`, `createFilled` and the CLI's token
  wrapping; the extern wrapper execution goes (B6).
- The rewriter makes every host extern giving a future `extern live async fn`, and ista code's
  `await` of one `await delegate …`.

**Accept.** `await delegate charge(c, n)` runs `charge` once after the commit, its result in the
future; a segment crashed before its commit never runs it; crashed after the job starts and before
its result commits, it runs again under the same key. The behaviour table's `await http.get(u)` and
`charge(id)` rows in their `delegate` form. Deploy refuses a host's unmarked async or `ista`
extern. No host token remains. Property: over generated programs crashed at every `await`, every
job runs at least once per committed start and never for a discarded segment. The full suite passes
after the rewrite; `wake.bench.ts` within 10%.

**Spec.** §3.6 externs; §3.8 `delegate`; §5 jobs; §9 hosts.

## AW Awaitables (behavioural)

**Scope.**
- `Awaitable<T>` with `type Mode in Persistence` (a member bound on an associated type) and
  `onAwait`; `Resolver<T, K>` over R2, with `Resolver.of`. `Future<T, K>` is the runtime's
  awaitable, `K` its `Mode`, with a native `onAwait`.
- One await path: `await` and `select` cases over any awaitable, the conformance found through
  `awaitedOf`, `Mode` read, lowering calling `onAwait` with the runtime's resolver; no second
  instruction for futures.
- `Resolver.of`'s callback takes `K` as its kind; an ista one runs as a segment of its own.
- `futures` rewritten once as awaitables over `Resolver.of`, generic over the kind (Rule 3);
  inference refuses a mix. `futures.timeout` starts its timer when called. The native `first`, its
  future state and `#pendingFirsts` go.

**Accept.** A cold custom awaitable starts its work at `await`, its `Mode` deciding the commit.
`first` over two kinds is an inference error; over one kind it works in a `live async fn` and an
`ista async fn`. `Resolver.of` waits without `await`; an ista callback runs as its own segment.
Every `futures` test passes in both kinds. No `futures` native remains.

**Spec.** §3.5 member-bound associated types; §3.8 prelude and `futures`; §3.10 `Awaitable`; §8.

## CX Contexts, a slice of proposal 9 (behavioural)

**Scope.**
- `runtime.at(key)` gives a `Context`: a persistent instance named by its key, written with the
  first invocation that commits; from ista code it commits with its segment. `ctx.call f(args)`
  (the deferred form) runs `f`, an `ista` function, in it, and gives a `Call<R>`, an awaitable of
  the caller's kind; `run.accepted()` resolves once the invocation is persisted. Live code waiting
  on one is an in-memory listener, through the one cross-instance wait that `Instance.result()`
  and mock answers use.
- Invocation identity: an invocation is identified by its function and arguments; the same call
  joins the one running or gets its recorded result, so a restarted `main` doesn't run work twice.
- A host starts only `async fn`s, through K1's entry rule; persistent instances exist only as
  contexts and spawns, and what else a host may start today (`starts`) follows the rule. The
  interim ends: the rewriter moves each `ista async fn main`'s body into an `ista async fn` that a
  `live async fn main` runs in a context. The test runner, `World`, the test kits and `testing`'s
  crash-every-await (a context option) follow.
- Left to proposal 9, filed: typed inbox names and methods, `ctx.delete()` and a context's end,
  how long results are kept, `Kv` stores, versions.

**Accept.** `live async fn main(): await runtime.at("o/1").call purchase(order)` runs `purchase`
persistently and gives its result; crashed at every `await` of the context, it resumes to the same
result. Restarted (`ista run --resume`) mid-invocation, `main` joins the running invocation and
`purchase` runs once. The context commits while `main` waits in memory. `run.accepted()` resolves
after the first commit. A host asked to start an `ista` function refuses. No `ista async fn main`
remains; the full suite passes.

**Spec.** §9 contexts; §10 testing persistent work.
