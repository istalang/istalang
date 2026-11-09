---
description: scope, acceptance and spec edits of each async-kinds phase (proposal 8) — the text fork briefs quote verbatim; read before forking or examining a phase
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-09
last_updated: 2026-11-09
tags: [plan, proposal-8, async]
---

# Async kinds: phases

"Rule N" is proposal 8's. Each phase also edits the docs it touches (`architecture.md`,
`docs/reuse/`, `boundary.md`, `definition.md`) and its tracker rows. Its acceptance names every
fixture and corpus diagnostic it is expected to move; nothing else moves.

## A0 Function heads (structural)

**Scope.**
- One modifier-set parser for every function and extern head (declarations, externs, trait
  members, lambdas, function types): any order, each at most once, one of each exclusive group
  (`sendable`/`ephemeral`, `async`/`ista`, the extern handles). One list of the words starting a
  function head; `followers`, completion's `externWords` and `followsHandle` derive from the lists.
- One ordered modifier list (Rule 4) and one head printer, read by the formatter (declarations,
  types, lambdas) and signature help. Today's words only.
- The VS Code test covers contextual modifiers; `sendable fn` in a type is highlighted.

**Accept.** `async sendable fn` and `sendable async fn` give one tree, printed `sendable async fn`,
idempotently. `async async fn`, `sendable sendable fn` and `extern shared sendable struct` give the
new diagnostic naming the modifier. Hover, signature help and the formatter print one head for
every std function. No `'fn' || 'async'` test remains outside the list. Nothing else moves.

**Spec.** §2 (modifiers stack in any order).

## T0 One function type (structural, then behavioural)

**Scope.**
1. One `FunctionType` constructor in `types/type/`, which every builder and rebuilder goes through,
   lowering's included. One function-fit relation over a qualifier table (`sendable` today),
   replacing every copy listed in `findings.md`, composing inside types through variance.
2. The one-type rule: `async` leaves the type, and `async fn(A) -> R` is built as
   `fn(A) -> Future<R>`. The async fit is `fn(A) -> R` into `fn(A) -> Future<R>`. Every
   "async means a `Future` result" mapping and `?? errorType` unwrap goes. `typeKey` and type text
   derive from the canonical form, and so do the Definition's function types and extern keys,
   which drop `async` (a key spells `fn(A) -> Future<T>`). A plain lambda where an async function
   is expected gives a resolved future; an `async` lambda's body checks against the future's value.
   Lowering reads a nested function's own header, not its type, for whether its body awaits.
   `testing`'s `async` overloads of `mock` and `calls` go, since they would clash.

**Accept.** Property: `typeKey(async fn(A) -> R) == typeKey(fn(A) -> Future<R>)` over generated
`A`, `R`. A plain `fn(A) -> Future<R>` fits where `async fn(A) -> R` is expected, and runs.
`Array<fn() -> Int>` into `Array<async fn() -> Int>` converts and runs. Overloads on
`fn() -> Future<Int>` and `async fn() -> Int` clash. `retry(3, fn(id): Order{id})` with
`call: async fn(String) -> Order` fits; `fn(Int?) -> Int` into `async fn(Int) -> Int?` converts and
runs. B33's repro checks. No function-type literal outside the constructor. Profile within noise.

**Spec.** §2 conversions, §3.14 async function types.

## R1 In-memory waits (runtime; programs unchanged)

**Scope.**
- The Definition's `await` and `select` carry a mode, and a code entry's kind (plain, ephemeral,
  persistent) replaces its `async` flag; lowering emits `persistent` for both until K1. At a call
  the runtime reads the callee's kind: an ephemeral callee runs with its caller's segment, a
  persistent one is held at its first `await` until that segment commits.
- An ephemeral wait suspends in memory without committing, and its resolution resumes it. An
  ephemeral future is backed by a JavaScript promise, and the waits ride the host's own event loop
  (Node's, a Worker's): the runtime adds no loop of its own, so a later JS backend runs plain and
  `async` code as native JavaScript (`docs/work/linker/js-codegen.md`, After proposal 8). An
  instance stays resident while an execution waits in memory. A host promise awaited ephemerally
  resolves in memory.
- The host and test-world contract becomes asynchronous: `Runtime`'s calls, `settle`, `World` and
  the test kits return promises and drive resident waits. A resident instance's state is read from
  it, not only from its last snapshot; the manual clock fires ephemeral timers as it does
  persistent ones; an execution that never commits gives its outcome to the call that started it.
  `boundary.md` holds the contract.
- A commit persists each execution as of its own last commit, collected from those frames; what
  an open segment started (spawns, a persistent call's progress past its first `await`) is
  released at its commit (Rule 6, contract item 4). An execution that never commits runs resident
  and ends with a restart.
- Re-run state per execution: `random` draws, spawn numbering (child names unique across
  executions), `now()` (the segment's start inside one, a clock in `NativeContext` outside).

**Accept.** Over generated Definitions: an ephemeral `await` never writes the store, a persistent
one always does. Soundness property: a Definition obeying checks 1 and 2 by construction, crashed
at every point and resumed, ends as an uncrashed run, its ephemeral results held fixed. One
execution waits in memory while another commits; a crash re-runs the first from its last commit,
repeating its draws and spawn names. A manual-clock test fires an ephemeral timer. The full suite,
on the asynchronous contract, and the `crashEveryAwait` tests unchanged; `wake.bench.ts` not
slower.

**Spec.** None (§5 is K1's). `boundary.md` for the host API.

## DC Defaults and deferred calls (behavioural, two commits)

**Scope.**
1. Defaults are part of the function (decision 21): computed at the start of a call that leaves
   them out, in the callee, before its body; field defaults alike. An omitted argument is explicit
   in the Definition, and a function's entry computes its absent defaults first; an extern, struct
   or variant with defaults gets one synthesized entry for it. Traces omit that prologue, so
   `Error.trace` is unchanged. Filling entries go (B16).
2. Deferred calls (Rule 9): a syntax node checked as a construct, whose record says what runs now
   (callee, receiver, arguments) and what the closure calls; lowering builds the closure from that
   record. A range step's `by` stays the range's. Hover shows the call deferred. `defer` and
   `spawn` leave the reserved words, with their nodes, instructions and checker construct. `defer`
   is a prelude function giving `Deferred`, a shared struct whose `dispose` calls it. `spawn` is a
   prelude function over a `sendable async fn() -> R` (a plain function fits) giving `Instance<R>`,
   its rules from that type, its outcome encoder through one seam shared with `instances.spawn`;
   the new instance's root awaits the future its closure gives, with no wrapper frame in traces. A
   juxtaposition that doesn't check as a deferred call points at the missing comma. A scripted
   rewrite makes every `defer fn(): …` statement `_ = defer …` and every `spawn f(x).result()`
   `(spawn f(x)).result()`.

**Accept.** Property: a deferred call equals its desugared closure (`test/AGENTS.md`'s commute
law). `retry load(id).process()` calls `load(id)` now; `a b c(x)` computes `x` once, now;
`retry(times: 5) fetchUser(id)` and `pool.submit encode(file)` check. `_ = defer log(x)` logs at
block end with `x` computed now, `hold _ = defer log(x)` at function end, last first; bare
`defer log(x)` is the must-use error. A `&` argument, or a `g` taking no `fn() -> X`, is refused.
A default leaving its call out is computed inside the callee, and a deferred call computes its
defaults when it runs; `f(b: 2)` on `fn f(a: Int = 1, b: Int = 2)` computes `a` in `f`; traces
show no filling frames. `spawn purchase(req)` behaves as today, for an async and a plain callee,
its outcome encodable to the host. `[a b(c)]` reports the missing comma where it doesn't check.
Moves: `concurrency/invalid-spawn.ista`, `weak-side/invalid-revertible.ista`,
`values/invalid-shared-structs.ista`, `trait-objects/crossing.ista`, each named with its new
diagnostics in the report.

**Spec.** Cheat sheet; §2 reserved words; §3.1 field defaults; §3.3 defaults; §3.9 precedence;
§3.14 deferred calls; §7 defer; §9 spawn.

## P Persistable and check 1 (behavioural, in today's `async`)

**Scope.**
- `reachOf(type)` (ephemeral < persistable < sendable) in `types/traits/`, read off `identityOf`
  and parts, replacing `sendable.ts`'s switch; `Sendable` and `Persistable` (a built-in marker
  trait) are thresholds of it.
- `ephemeral fn` (Rule 7): a qualifier in T0's table, `fn` fitting `ephemeral fn`; written at
  declaration sites only. A lambda takes its reach from its expected type: a capture the expected
  type can't hold (non-persistable for `fn`, non-sendable for `sendable fn`) is an error at the
  capture; with no expected type a lambda is `ephemeral fn` exactly when it captures one.
- Release points (implicit `dispose` calls) derived in one place the checker and lowering share;
  a disposable is live until its release.
- Liveness at every committing `await` (every `await`, until K1), temporaries pending at it
  included; check 1. A committing `await` persists no register holding a dead value: lowering
  releases or clears it first.

**Accept.** `conn: Socket` (`extern ephemeral struct`) live across `await time.delay(1d)`:
"`conn: Socket` is live across this commit"; last used before it: legal. The behaviour table's
`fn(i): conn.write(i)` row, both ways. A disposable `Socket` released at its scope's end is live
across an `await` before it. A dead ephemeral value is absent from the next snapshot. Property:
`Sendable` implies `Persistable` over generated types. Moves: `concurrency/invalid-sendable.ista`'s
two 5001s, to the captures. Every other std and corpus program still checks. Profile within
noise.

**Spec.** §3.1 persistable types, §3.10 `Persistable`, §3.14 `ephemeral fn`, §5 check 1.

## K1 Two kinds (structural rewrite, then behavioural)

**Scope.**
1. `ista` reserved and a header; `Persistence` in the prelude; `Future<T, K in Persistence>`.
   A scripted rewrite through the project's scanner and parser, re-runnable on rebase, over `.ista`
   files, the spec, docs, examples and sources embedded in TS: every `async fn` but `main` becomes
   `ista fn`; every `Future<T>` becomes `Future<T, "persistent">`, except a header's result, which
   becomes `T` (decision 13); then `ista fmt`. Behaviour-neutral.
2. The kinds (Rules 1, 2, 4, 5, 10, 11):
   - `async fn` is ephemeral, with the header rule; lambdas and externs take both headers; a plain
     function fits either kind; the kinds never meet (`K` invariant); `Future<T, "persistent">`
     needs a persistable `T`.
   - An unfixed `K in Persistence` takes the enclosing function's kind: a settling rule fed by a
     new call-site seam.
   - An `await`'s mode comes from its operand's type and is lowered into R1's field, and code
     entries their kind. An `ista fn`'s `await` expects either kind; one on a kind that is a type
     parameter is an error (Rule 5). An `await select` holds one kind; a non-blocking
     `select … else:` may mix. Check 1 narrows to persistent awaits in an `ista fn`.
   - Ephemeral code makes no persistent future: the program-level function-summary unit in
     `rules/` (beside expansion, solved per strongly connected component), with this as its first
     fact. A lambda is a function of its own: making or passing an `ista fn` closure (to `spawn`,
     to CX's `ctx.call`) is no persistent future; calling one is.
   - A host starts an `async fn` as an ephemeral run (R1). A `main` the checker finds making a
     persistent future is rewritten to `ista fn main`, which the host still starts as a persistent
     instance: a bounded interim, so harnesses are unchanged, which CX ends.
   - `time.delay`, `time.at` and `worker.disposing()` take the kind; `futures` stays persistent
     until AW. The Definition keeps literal type arguments, so natives generic over `K` read it.
   - Extern keys spell `Future<T, K>`, and the Definition's validation follows; hosts re-key once.
     The formatter and signature help print a header's body result.

**Accept.** The behaviour table's rows on `async fn approve`, `async fn two`, `async fn get`,
`Future<Int>`, `await select` mixing and the non-blocking form, an `async fn` calling an `ista fn`
or receiving from an inbox, `time.delay(5s)` in an `async fn`, `main` awaiting a host queue,
`ista` as a name, `extern async fn fetch`, `retry(3, fn(id): Order{id})` and the overload pair.
`async fn get` writes nothing to the store across its wait. In an `ista fn`, awaiting a generic
`async fn` infers its `T`; a body awaiting a future of kind `K` is an error. After step 1 the
full suite passes with only respelled sources; after step 2 the same, but for respelled extern
keys. Profile within noise.

**Spec.** Cheat sheet; §1; §2; §3.3; §3.6; §3.7; §3.8; §5 (two awaits, segments, commits, starts
at commit, re-run state); §8; §9; §12; §14.

## CX Contexts, a slice of proposal 9 (behavioural)

**Scope.**
- `runtime.at(key)` gives a `Context`: a persistent instance named by its key, written with the
  first invocation that commits; from persistent code it commits with its segment.
  `ctx.call f(args)` (the deferred form) runs `f`, an `ista fn`, in it, and gives a `Call<R>`, an
  awaitable of the caller's kind (a `Future<R, K>`, `K` from the caller, until AW makes it an
  `Awaitable`); `run.accepted()`
  resolves once the invocation is persisted. Ephemeral code waiting on one is an in-memory
  listener.
- A host starts only `async fn`s; persistent instances exist only as contexts and spawns. The
  interim ends: a scripted rewrite moves each `ista fn main`'s body into an `ista fn` that an
  `async fn main` runs in a context. The test runner, `World`, the test kits and `testing`'s
  crash-every-await (a context option) follow.
- Left to proposal 9, filed: invocation identity (joining by function and arguments, recorded
  results), mailboxes and methods as typed names, `ctx.delete()` and a context's end, `Kv`
  stores, versions.

**Accept.** `async fn main(): await runtime.at("o/1").call purchase(order)` runs `purchase`
persistently and gives its result; crashed at every `await` of the context, it resumes to the same
result. The context commits while `main` waits in memory. `run.accepted()` resolves after the
first commit. A host asked to start an `ista fn` refuses. No `ista fn main` remains; the full
suite passes.

**Spec.** §9 contexts; §10 testing persistent work.

## E1 Effects and check 2 (behavioural)

**Scope.**
1. `readonly` on functions, externs and function types; `readonly fn` fits `fn`. A lambda takes
   `readonly` from its expected type (its body checked) or from its body.
2. Function summaries in K1's unit: which parameters and captures a function may assign through,
   and whether it calls a non-`readonly` function, through everything it calls and every execution
   it starts, defaults included. A `sendable fn` value writes only its arguments; another function
   value everything it holds unless `readonly`. Implicit calls count, at P's release points.
3. A flow pass per persistent segment marking values fresh or older; check 2. An awaited call's
   effects stand at its `await`, after the wait. Each committing `await` starts a new segment:
   whatever existed before it is older. `readonly` on a non-extern is an assertion checked against
   its body.

**Accept.** The behaviour table's `box.send(m)`, `charge(id)` and `readonly fn f()` rows; each
legal with its await first. A call writing only what the segment created is no effect. Mutually
recursive summaries reach their fixpoint (an effect two calls deep in a cycle). Property: a
generated program passing checks 1 and 2, crashed at every point and resumed, ends as an
uncrashed run. Profile within noise.

**Spec.** §3.3 `readonly`, §3.6 `extern readonly fn`, §3.14 `readonly fn`, §5 check 2.

## E2 `readonly` through traits (behavioural)

**Scope.** A requirement declared `readonly fn` is met only by a `readonly` function. Where
generic code needs a requirement's call readonly (a `readonly` body, or before an in-memory
`await` in a persistent segment), the summary records it, strengthening the constraint, and
callers' type arguments and `any` conversions are checked as constraints are (§3.5). A `readonly`
function meets a requirement that isn't, never the reverse.

**Accept.** The behaviour table's `notify(email)` row errors at the call, not in the body. A
declared `readonly` requirement met by a non-readonly method errors at the method. Converting
`Email` into `any Notifier` under a strengthened requirement errors at the conversion.

**Spec.** §3.10 `readonly` requirements.

## QV Qualifier variables (design, then behavioural)

**Scope.**
1. Design first, approved by the human before code: how a signature carries qualifier variables
   with no new syntax (`variance-inference/design.md` §7, F28), for reach (`sendable`, plain,
   `ephemeral`) and `readonly`; how a result's qualifiers follow its parameters', inferred from the
   body through the summaries; how variables settle in the constraint system. Written to
   `qualifier-variables.md`.
2. The design, in T0's qualifier table, the constraint system and K1's summary unit.

**Accept.** `logged(f)` keeps `f`'s qualifiers: `sendable` in, `sendable` out; `readonly` in,
`readonly` out; plain in, plain out. A wrapper whose body adds an effect gives a non-`readonly`
result whatever its argument. The design's own examples. Profile within noise.

**Spec.** §3.14 function types; §3.5 where variables settle.

## R2 Resolvers (runtime and host)

**Scope.**
- One resolver per wait (Rule 3): ephemeral, a reference to the suspended execution; persistent,
  a heap object naming the waiter, registered where it will be resolved from (slots' waiter
  queues, timers, the host) and committed with the frame. `Futures.resolve` stops scanning
  executions.
- One-shot `resolve` and `tryResolve`; released unresolved, it panics its waiter; `onCancel` once
  its waiter is gone (ephemeral at once, persistent once the disposing segment commits). A
  `select`'s losing cases are cancelled, so a losing `take` consumes nothing; a non-blocking
  `select`'s `else` cancels every case.
- A future-returning extern receives its resolver (a persistent one as its id, resolvable after a
  restart, acknowledged after commit); a returned promise still resolves it. The extern wrapper
  execution goes (B6).

**Accept.** A second `resolve` panics; a dropped resolver panics its waiter, naming the extern;
disposal fires `onCancel` once; a disposal a crash rolls back never reaches the host. A host
resolves a persistent resolver by id after a restart and the waiter resumes. A `select` won by one
slot leaves the other slots' values. In `wake.bench.ts` resolving no longer grows with executions.
The full suite unchanged.

**Spec.** §3.6 an extern's resolver; §6 waits; §7 `onCancel` and dropped resolvers.

## AW Awaitables (behavioural)

**Scope.**
- `Awaitable<T>` with `type Mode in Persistence` (a member bound on an associated type) and
  `onAwait`; `Resolver<T, K>` over R2, with `Resolver.of`. `Future<T, K>` is the runtime's
  awaitable, `K` its `Mode`.
- `await` and `select` cases over any awaitable: the conformance found, `Mode` read; lowering
  calls `onAwait` with the runtime's resolver.
- `Resolver.of`'s callback reach follows `K`: persistable for a persistent resolver, possibly
  ephemeral for an ephemeral one.
- `futures` rewritten once as awaitables generic over the kind; inference refuses a mix.
  `futures.timeout` starts its timer when called.

**Accept.** A cold custom awaitable starts its work at `await`, its `Mode` deciding the commit.
`first` over two kinds is an inference error; over one kind it works in an `async fn` and an
`ista fn`. `Resolver.of` waits without `await`; a persistent callback runs as its own segment,
and an ephemeral capture in it is refused. Every `futures` test passes in both kinds.

**Spec.** §3.5 member-bound associated types; §3.8 prelude and `futures`; §3.10 `Awaitable`; §8.
