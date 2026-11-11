---
description: how phase AW (awaitables) is built — the await path through `onAwait`, language-level resolvers in the runtime, `Resolver.of` callbacks and the `futures` rewrite, with the runtime facts they rest on; read before implementing or examining AW
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-11
last_updated: 2026-11-11
tags: [proposal-8, async, awaitable, resolver, runtime]
---

# AW: design

Scope and acceptance: `phases.md`, AW. Rules: proposal 8, Rules 5 and 6.

## Language (AW1)

- `type Mode in Persistence` on a trait's associated type: a member bound, as `S in U` on a type
  parameter. `T.Mode` of a type parameter then stands for one member, as a member parameter does,
  so it may be a requirement's mark (`Self.Mode fn`) and a `K in Persistence` argument
  (`Resolver<T, Self.Mode>`). A type's own associated type meets the bound by being one member.
- `Self.Mode fn` names an associated type with a member bound of `Mark` (one of `Persistence` on an
  async head), as a mark parameter must.
- An extern struct may declare associated types in a body (`type Mode = K`), so `Future<T, K>`
  meets `Awaitable<T>`.

## The await path (AW2)

- **Checker.** `await x` and each `select` case make an implicit call `onAwait(x, done)`, found as
  `for`'s `iterate` is (`resolution/applying/implicit.ts`), `done` a placeholder argument taking the
  parameter's type. The chosen function's `done` parameter, `Resolver<T, M>`, gives the awaited `T`
  and the mode `M`, which must be the code's kind (`checkWaitKind`). A type parameter
  `A is Awaitable<T>` finds the requirement, its mode `A.Mode`, which no kind equals: refused, as
  sound.
- `awaitedOf` stays the reading of a `Future`'s parts (function results, conversions, kinds); the
  awaitable reading is the implicit call's.
- **Lowering.** Each operand in order, then `w = wait()`, then per case `r = resolver(w, position)`,
  the recorded `onAwait(x, r)` call and `release r`; then `await(dst, w)` or `select(w, …)`, which
  name no future any more. The wait is an explicit register, not the execution's current wait,
  since `onAwait`, a plain function, may run a non-blocking `select` of its own while the wait it
  was called for is open (tech-lead, 2026-11-11). The frame holds its wait, so a wait is no root.
  Synthesized code awaiting a future calls the prelude's `onAwait` alike (`lowering/calls/waits.ts`),
  with the future's type in its instance. A blocking wait commits in ista code even when already
  decided, as today.
- **Runtime objects.** Today's `resolver` heap object becomes the *wait* (its waiter; pending, or
  decided at a position with a value). A *resolver* is a heap object per language `Resolver`:
  pending for a case of a wait, maybe registered on a future; resolved; or cancelled. AW3 adds the
  callback target and `onCancel` closures.
- **Deciding.** A future's native `onAwait` resolves `r` at once when the future has resolved, else
  registers it on the future (the `resolvers` index). Futures resolving together decide each wait at
  its lowest case among them (today's rule). Deciding a wait cancels the case resolvers pending
  then, their registrations dropped. `resolve` twice panics; `tryResolve` says whether it took the
  value; a cancelled resolver ignores both. `onCancel` moves to AW3, which runs closures as
  executions.
- **Holding.** The wait holds its resolvers registered on futures, read off the heap's index in the
  walk from the roots (`lifetimes/holders.ts`), and a pending resolver holds its future: the
  registration persists with the waiting frame (Rule 5), so a future a cold awaitable made in its
  `onAwait` lives as long as the wait, and a losing `disposing()` case keeps its watch until the
  call resumes. A cancelled resolver lets go of its future.
- **A resolver made after its wait was decided** (an earlier case's `onAwait` decided it) is
  pending until its waiter stops at the wait, every case known, which cancels it: until then
  `resolve` takes the value to no effect and a second `resolve` panics, `tryResolve` gives false and
  cancels it, and letting it go panics, so misuse is caught however the race went. Registering it
  cancels it, unless on its waiter's own `disposing()` watch, kept for a disposal (§7). A resolved
  or cancelled resolver a `WeakRef` refers to is disposed when let go of, its watches resolved.
- **Dropped unresolved** (its last holder lets go while pending) panics, as any panic does: the
  instance, or the live run.
- A non-blocking `select` that finds its wait undecided goes to `otherwise`, cancelling its case
  resolvers.
- **Must change with it:** `snapshot/check.ts` (waits no longer name futures in registers),
  `snapshot/holdings.ts` (a pending resolver holds its future, its wait holds it; a wait watches its
  waiter), `weak-side.ts` and `disposal-runs.ts` (`waitingOn`: a case watching the call's own
  `disposing()` is found through its resolver's registration), `suspension.ts`.
- Live runs use the same `Instance`, heap and segments (`live-run.ts`), so language resolvers are
  the same objects there, never committed. R2's host resolvers (`live-resolvers.ts`) stay for host
  externs.

## `Resolver.of` and `futures` (AW3)

- `onCancel(callback)` on a resolver, its callbacks run once its wait is decided by another case
  or its waiter stops, the same way `Resolver.of`'s callbacks run.
- `Resolver.of(callback)` makes a resolver whose target is the callback. Resolving it starts the
  closure as a new execution of the instance, ready at once: its own driver, so in ista code its own
  segment. Nothing does this today: `Instance.startExecution` makes an execution but readies none,
  the ready queue holds only waiters (`resumeNext` takes a decision), and `snapshot/check.ts`
  refuses a ready execution that doesn't wait. The closest precedent is a mock's answer
  (`scheduler/testing/mocks.ts`, `startAnswer`), started as a segment's first driver.
- `onCancel` callbacks run the same way.
- `futures`: every function `K fn …<…, K in Persistence>` giving an awaitable struct whose `onAwait`
  registers `Resolver.of` callbacks on its futures and resolves `done` from shared state; `first`
  gives `First<T, K>` (`Mode = K`); `timeout` makes its timer when called. Mixing kinds is an
  inference error by itself (one `K`).
- What goes: `NativeFutures.first`, the `first` future state and every use (`objects.ts`,
  `heap.ts`'s `pending` index, `futures.ts` `#pendingFirsts`, `holdings.ts`, `disposal.ts`, tests),
  and `stdlib/futures/natives.ts`.
- Live tests: a TypeScript test compiling `live async fn` scenarios over live timers and starting
  each with `program.start('live', …)` (`boundary/host-resolvers.test.ts` shows how).
