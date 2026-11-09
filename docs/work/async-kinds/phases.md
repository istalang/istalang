---
description: scope, acceptance and spec edits of each async-kinds phase (proposal 8, and CX's slice of proposal 9) — the text fork briefs quote verbatim; read before forking or examining a phase
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
- The syntax tree groups a head's qualifiers by meaning: `reach` (`sendable`, later `ephemeral`),
  `kind` (`async`, later `ista`), later `readonly`, replacing the `isSendable` and `isAsync`
  booleans. Today's words only.
- One ordered modifier list (Rule 4), read by every printer: the formatter (declarations, types,
  lambdas), signature help, type text and `typeKey`.
- The VS Code test covers contextual modifiers; `sendable fn` in a type is highlighted.

**Accept.** `async sendable fn` and `sendable async fn` give one tree, printed `sendable async fn`,
idempotently. `async async fn`, `sendable sendable fn` and `extern shared sendable struct` give the
new diagnostic naming the modifier. Hover, signature help and the formatter print one head for
every std function. No `'fn' || 'async'` test and no second modifier order remain. Nothing else
moves.

**Spec.** §2 (modifiers stack in any order).

## R1a Async host (structural; programs unchanged)

**Scope.**
- The host and test-world contract becomes asynchronous: `Runtime`'s calls, `settle`, `World` and
  the test kits return promises. `World`'s own loop over `advance` and `settle` become one
  driver. `boundary.md` holds the contract.
- An instance stays resident across host calls instead of being restored from the store for each;
  its state is read from it. Every `await` still commits.

**Accept.** Property: over the run corpus and generated programs, a resident run gives the same
outcomes, commits and snapshots as one restored from the store at every step. The full suite passes
on the asynchronous contract. One driver loop remains.

**Spec.** None. `boundary.md`.

## T0 One function type (structural, then behavioural)

**Scope.**
1. One `FunctionType` constructor in `types/type/`, which every builder and rebuilder goes through,
   lowering's included. The type carries `reach` (a `Reach`: `sendable` or plain, P adds
   `ephemeral`), mirroring A0's grouping, shaped so a later qualifier variable (QV) can stand in
   it. One function-fit relation over the qualifiers, replacing every copy listed in `findings.md`
   and `trait-objects.ts`'s `isAsync` branch, composing inside types through variance.
2. The one-type rule: `async` leaves the type, and `async fn(A) -> R` is built as
   `fn(A) -> Future<R>`. The async fit is `fn(A) -> R` into `fn(A) -> Future<R>`. Every
   "async means a `Future` result" mapping and `?? errorType` unwrap goes. `typeKey` and type text
   derive from the canonical form, and so do the Definition's function types and extern keys,
   which drop `async` (a key spells `fn(A) -> Future<T>`). A plain lambda where an async function
   is expected gives a resolved future; an `async` lambda's body checks against the future's value.
   Lowering reads a nested function's own header, not its type, for whether its body awaits; the
   code entry's flag itself is R1b's. `testing`'s `async` overloads of `mock` and `calls` go, since
   they would clash.

**Accept.** Property: `typeKey(async fn(A) -> R) == typeKey(fn(A) -> Future<R>)` over generated
`A`, `R`. A plain `fn(A) -> Future<R>` fits where `async fn(A) -> R` is expected, and runs.
`Array<fn() -> Int>` into `Array<async fn() -> Int>` converts and runs. Overloads on
`fn() -> Future<Int>` and `async fn() -> Int` clash. `retry(3, fn(id): Order{id})` with
`call: async fn(String) -> Order` fits; `fn(Int?) -> Int` into `async fn(Int) -> Int?` converts and
runs. B33's repro checks. No function-type literal outside the constructor. Profile within noise.

**Spec.** §2 conversions, §3.14 async function types.

## R1b In-memory waits (runtime; programs unchanged)

**Scope.**
- The Definition's `await` and `select` carry a mode, and a code entry's kind (plain, ephemeral,
  persistent) replaces its `async` flag; lowering emits `persistent` for both until K1. At a call
  the runtime reads the callee's kind: an ephemeral callee runs with its caller's segment, a
  persistent one is held at its first `await` until that segment commits.
- An ephemeral wait suspends in memory without committing, and resumes through a one-shot resume
  primitive, which R2's resolvers extend. An ephemeral future is backed by a JavaScript promise,
  and the waits ride the host's own event loop (Node's, a Worker's): the runtime adds no loop of
  its own, so a later JS backend runs plain and `async` code as native JavaScript
  (`docs/work/linker/js-codegen.md`, After proposal 8). A host promise awaited ephemerally
  resolves in memory; the manual clock fires ephemeral timers as it does persistent ones.
- A commit persists each execution as of its own last commit, collected from those frames; what
  an open segment started (spawns, a persistent call's progress past its first `await`) is
  released at its commit (Rule 6, contract item 4). An execution that never commits gives its
  outcome to the call that started it and ends with a restart.
- Re-run state per execution: `random` draws, spawn numbering (child names unique across
  executions), `now()` (the segment's start inside one, a clock in `NativeContext` outside).

**Accept.** Over generated Definitions: an ephemeral `await` never writes the store, a persistent
one always does. One execution waits in memory while another commits; a crash re-runs the first
from its last commit, repeating its draws and spawn names. A manual-clock test fires an ephemeral
timer. The full suite and the `crashEveryAwait` tests unchanged; `wake.bench.ts` within 10%.
Soundness end to end is E1's.

**Spec.** None (§5 is K1's). `boundary.md`.

## DC Defaults and deferred calls (structural, then behavioural)

**Scope.**
1. Structural: `callsMadeBy(f)` once, read by expansion and reduction requirements (today's two
   copies). One committed source rewriter in `scripts/`, through the project's scanner and parser,
   reaching `.ista` files and sources embedded in TypeScript in all three forms (template literals,
   quoted strings, line arrays); DC's, K1's and CX's rewrites use it.
2. Defaults are part of the function (decision 21): computed at the start of a call that leaves
   them out, in the callee, before its body; field defaults alike. An omitted argument is explicit
   in the Definition, and a function's entry computes its absent defaults first; an extern, struct
   or variant with defaults gets one synthesized entry for it. Traces omit that prologue, so
   `Error.trace` is unchanged. Filling entries go (B16); `defaultsOf` folds into the body if
   nothing else needs it apart.
3. Deferred calls (Rule 9): a syntax node checked as a construct, whose record says what runs now
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

## P Persistable and check 1 (structural, then behavioural, in today's `async`)

**Scope.**
1. Structural: `rules/flow/forward.ts` becomes a folder, with await, call and release hooks; it
   stays the one model of execution order. Release points (implicit `dispose` calls) are derived
   in one place the checker and lowering share.
2. `reachOf(type)` (ephemeral < persistable < sendable) in `types/traits/`, read off `identityOf`,
   parts and a function type's `reach`, replacing `sendable.ts`'s switch; `Sendable` and
   `Persistable` (a built-in marker trait) are thresholds of it.
3. A type parameter held across a commit gets an inferred `Persistable` requirement, checked at
   each type argument as constraints are (§3.5): the inferred-requirement mechanism, built once
   here and extended by E2.
4. `ephemeral fn` (Rule 7): `ephemeral` joins T0's `Reach`, `fn` fitting `ephemeral fn`; written
   at declaration sites only. A lambda takes its reach from its expected type: a capture the
   expected type can't hold (non-persistable for `fn`, non-sendable for `sendable fn`) is an error
   at the capture; with no expected type a lambda is `ephemeral fn` exactly when it captures one.
5. The committing-await predicate, in one place (every `await`, until K1). Liveness written forward
   on the engine: one derivation gives check 1 and the live set at each committing `await`, from
   which lowering releases or clears every register holding a dead value. A disposable is live
   until its release; temporaries pending at an `await` count, and so does the awaited operand
   (every case of an `await select`), so a persistent future's `T` is checked there.

**Accept.** `conn: Socket` (`extern ephemeral struct`) live across `await time.delay(1d)`:
"`conn: Socket` is live across this commit"; last used before it: legal. The behaviour table's
`fn(i): conn.write(i)` row, both ways. A disposable `Socket` released at its scope's end is live
across an `await` before it. A dead ephemeral value is absent from the next snapshot.
`futures.allSettled` and `futures.timeout` check unchanged; instantiated at an ephemeral type in
an `async fn`, the error stands at the type argument. Property: `Sendable` implies `Persistable`
over generated types. Moves: `concurrency/invalid-sendable.ista`'s two 5001s, to the captures.
Every other std and corpus program still checks. Profile within noise.

**Spec.** §3.1 persistable types; §3.5 inferred requirements; §3.10 `Persistable`; §3.14
`ephemeral fn`; §5 check 1.

## K1 Two kinds (structural, rewrite, then behavioural)

**Scope.**
1. Structural:
   - The entry rule gets one home, read by `compile.ts`, the checker's declarations, the
     Definition's validation, lowering and the binder.
   - `awaitedOf(type) → {value, mode}` is the one reader of what an awaitable gives, replacing
     every `futureArgument`/`futureOf` reader; AW swaps its implementation. The two kinds are
     spelled once, in `well-known`.
2. `ista` reserved and a header; `Persistence` in the prelude; `Future<T, K in Persistence>`.
   DC's rewriter: every `async fn` but `main` becomes `ista fn`; every `Future<T>` becomes
   `Future<T, "persistent">`, except an `async` or `ista` header's result, which becomes `T`
   (decision 13), so no header depends on how `async` reads; then `ista fmt`. Behaviour-neutral.
3. The kinds (Rules 1, 2, 4, 5, 10, 11):
   - `async fn` is ephemeral, with Rule 2's header rule as written; lambdas and externs take both
     headers; a plain function fits either kind; the kinds never meet (`K` invariant).
   - An unfixed `K in Persistence` takes the enclosing function's kind: one settling handler fed by
     a new call-site seam.
   - An `await`'s mode comes from `awaitedOf` and is lowered into R1b's field, and code entries
     their kind. An `ista fn`'s `await` expects either kind; one on a kind that is a type
     parameter is an error (Rule 5). An `await select` holds one kind; a non-blocking
     `select … else:` may mix. P's committing-await predicate narrows to persistent awaits in an
     `ista fn`.
   - Ephemeral code makes no persistent future: the program-level function-summary unit in
     `rules/`, built on entries and `strongly-connected.ts` over `callsMadeBy`, with this as its
     first fact. A lambda is a function of its own: making or passing an `ista fn` closure (to
     `spawn`, to CX's `ctx.call`) is no persistent future; calling one is.
   - A host starts an `async fn` as an ephemeral run (R1b). A `main` the checker finds making a
     persistent future is rewritten to `ista fn main`, which the host still starts as a persistent
     instance: a bounded interim, so harnesses are unchanged, which CX ends.
   - `time.delay`, `time.at` and `worker.disposing()` take the kind; `futures` stays persistent
     until AW. The Definition keeps literal type arguments, so natives generic over `K` read it.
   - Extern keys spell `Future<T, K>`, and the Definition's validation follows; hosts re-key once.
     Signature help prints a header's body result; the formatter prints what is written.

**Accept.** The behaviour table's rows on `async fn approve`, `async fn two`, `async fn get`,
`Future<Int>`, `await select` mixing and the non-blocking form, an `async fn` calling an `ista fn`
or receiving from an inbox, `time.delay(5s)` in an `async fn`, `main` awaiting a host queue,
`ista` as a name, `extern async fn fetch`, `retry(3, fn(id): Order{id})` and the overload pair.
`async fn get` writes nothing to the store across its wait. In an `ista fn`, awaiting a generic
`async fn` infers its `T`; a body awaiting a future of kind `K` is an error; a user's own
`fn make<K in Persistence>()` takes its caller's kind. No `futureArgument` reader and no second
entry rule remain. After step 2 the full suite passes with only respelled sources; after step 3
the same, but for respelled extern keys. Profile within noise.

**Spec.** Cheat sheet; §1; §2; §3.3; §3.6; §3.7; §3.8; §5 (two awaits, segments, commits, starts
at commit, re-run state); §8; §9; §12; §14.

## R2 Resolvers (runtime and host)

**Scope.**
- One resolver per wait (Rule 3), extending R1b's resume primitive: ephemeral, a reference to the
  suspended execution; persistent, a heap object naming the waiter, registered where it will be
  resolved from (slots' waiter queues, timers, the host) and committed with the frame.
  `Futures.resolve` stops scanning executions.
- One-shot `resolve` and `tryResolve`; released unresolved, it panics its waiter; `onCancel` once
  its waiter is gone (ephemeral at once, persistent once the disposing segment commits). A
  `select`'s losing cases are cancelled, so a losing `take` consumes nothing; a non-blocking
  `select`'s `else` cancels every case.
- A future-returning extern receives its resolver (a persistent one as its id, resolvable after a
  restart, acknowledged after commit); a returned promise still resolves it. Host tokens go, with
  `HostCall.pending`, `Runtime.fill`'s token, `Futures.fromHost`, `resolveHost`, `createFilled`
  and the CLI's token wrapping. The extern wrapper execution goes (B6).

**Accept.** A second `resolve` panics; a dropped resolver panics its waiter, naming the extern;
disposal fires `onCancel` once; a disposal a crash rolls back never reaches the host. A host
resolves a persistent resolver by id after a restart and the waiter resumes. A `select` won by one
slot leaves the other slots' values. No host token remains. In `wake.bench.ts` resolving no longer
grows with executions. The full suite unchanged.

**Spec.** §3.6 an extern's resolver; §6 waits; §7 `onCancel` and dropped resolvers; §9 hosts.

## E1 Effects and check 2 (behavioural)

**Scope.**
1. `readonly` on functions, externs and function types (A0's group, T0's type); `readonly fn`
   fits `fn`. A lambda takes `readonly` from its expected type (its body checked) or from its
   body.
2. Function summaries in K1's unit: which parameters and captures a function may assign through,
   and whether it calls a non-`readonly` function, through everything it calls and every execution
   it starts, defaults included. A `sendable fn` value writes only its arguments; another function
   value everything it holds unless `readonly`. Implicit calls count, at P's release points.
3. A flow pass per persistent segment, on P's engine, marking values fresh or older; check 2. An
   awaited call's effects stand at its `await`, after the wait. Each committing `await` starts a
   new segment: whatever existed before it is older. `readonly` on a non-extern is an assertion
   checked against its body.

**Accept.** The behaviour table's `box.send(m)`, `charge(id)` and `readonly fn f()` rows; each
legal with its await first. A call writing only what the segment created is no effect. Mutually
recursive summaries reach their fixpoint (an effect two calls deep in a cycle). Soundness
property, through the real checker: a generated program passing checks 1 and 2, crashed at every
point and resumed, ends as an uncrashed run, its ephemeral results held fixed. Profile within
noise.

**Spec.** §3.3 `readonly`, §3.6 `extern readonly fn`, §3.14 `readonly fn`, §5 check 2.

## AW Awaitables (behavioural)

**Scope.**
- `Awaitable<T>` with `type Mode in Persistence` (a member bound on an associated type) and
  `onAwait`; `Resolver<T, K>` over R2, with `Resolver.of`. `Future<T, K>` is the runtime's
  awaitable, `K` its `Mode`, with a native `onAwait`.
- One await path: `await` and `select` cases over any awaitable, the conformance found through
  `awaitedOf`, `Mode` read, lowering calling `onAwait` with the runtime's resolver; no second
  instruction for futures.
- `Resolver.of`'s callback reach follows `K`: persistable for a persistent resolver, possibly
  ephemeral for an ephemeral one.
- `futures` rewritten once as awaitables over `Resolver.of`, generic over the kind; inference
  refuses a mix. `futures.timeout` starts its timer when called. The native `first`, its future
  state and `#pendingFirsts` go.

**Accept.** A cold custom awaitable starts its work at `await`, its `Mode` deciding the commit.
`first` over two kinds is an inference error; over one kind it works in an `async fn` and an
`ista fn`. `Resolver.of` waits without `await`; a persistent callback runs as its own segment,
and an ephemeral capture in it is refused. Every `futures` test passes in both kinds. No
`futures` native remains.

**Spec.** §3.5 member-bound associated types; §3.8 prelude and `futures`; §3.10 `Awaitable`; §8.

## E2 `readonly` through traits (behavioural)

**Scope.** A requirement declared `readonly fn` is met only by a `readonly` function. Where
generic code needs a requirement's call readonly (a `readonly` body, or before an in-memory
`await` in a persistent segment), P's inferred-requirement mechanism records it, and callers'
type arguments and `any` conversions are checked as constraints are (§3.5). A `readonly` function
meets a requirement that isn't, never the reverse.

**Accept.** The behaviour table's `notify(email)` row errors at the call, not in the body. A
declared `readonly` requirement met by a non-readonly method errors at the method. Converting
`Email` into `any Notifier` under a strengthened requirement errors at the conversion.

**Spec.** §3.10 `readonly` requirements.

## CX Contexts, a slice of proposal 9 (behavioural)

**Scope.**
- `runtime.at(key)` gives a `Context`: a persistent instance named by its key, written with the
  first invocation that commits; from persistent code it commits with its segment.
  `ctx.call f(args)` (the deferred form) runs `f`, an `ista fn`, in it, and gives a `Call<R>`, an
  awaitable of the caller's kind; `run.accepted()` resolves once the invocation is persisted.
  Ephemeral code waiting on one is an in-memory listener, through the one cross-instance wait that
  `Instance.result()` and mock answers use.
- Invocation identity: an invocation is identified by its function and arguments; the same call
  joins the one running or gets its recorded result, so a restarted `main` doesn't run work twice.
- A host starts only `async fn`s, through K1's entry rule; persistent instances exist only as
  contexts and spawns, and what else a host may start today (`starts`) follows the rule. The
  interim ends: the rewriter moves each `ista fn main`'s body into an `ista fn` that an
  `async fn main` runs in a context. The test runner, `World`, the test kits and `testing`'s
  crash-every-await (a context option) follow.
- Left to proposal 9, filed: mailboxes and methods as typed names, `ctx.delete()` and a context's
  end, how long results are kept, `Kv` stores, versions.

**Accept.** `async fn main(): await runtime.at("o/1").call purchase(order)` runs `purchase`
persistently and gives its result; crashed at every `await` of the context, it resumes to the same
result. Restarted (`ista run --resume`) mid-invocation, `main` joins the running invocation and
`purchase` runs once. The context commits while `main` waits in memory. `run.accepted()` resolves
after the first commit. A host asked to start an `ista fn` refuses. No `ista fn main` remains; the
full suite passes.

**Spec.** §9 contexts; §10 testing persistent work.

## QV Qualifier variables (design, then behavioural)

**Scope.**
1. Design first, approved by the human before code: how a signature carries qualifier variables
   with no new syntax (`variance-inference/design.md` §7, F28), for `reach` and `readonly`; how a
   result's qualifiers follow its parameters', inferred from the body through the summaries; how
   variables settle in the constraint system. Written to `qualifier-variables.md`.
2. The design, in T0's qualifier fields, the constraint system and K1's summary unit.

**Accept.** `logged(f)` keeps `f`'s qualifiers: `sendable` in, `sendable` out; `readonly` in,
`readonly` out; plain in, plain out. A wrapper whose body adds an effect gives a non-`readonly`
result whatever its argument. The design's own examples. Profile within noise.

**Spec.** §3.14 function types; §3.5 where variables settle.
