---
description: design of static lifetimes — holding sets on types, held arguments, the acyclic rule, one-way resolver edges, counted disposal and its order, the checker–runtime contract, handles off the id heap, and what is deleted; read before implementing or reviewing a static-lifetimes phase or changing spec §6–§7
owner: tech-lead
status: active
applies_to: checker, runtime lifetimes, spec §3.3 §3.14 §6 §7
last_verified: 2026-11-11
last_updated: 2026-11-11
tags: [lifetimes, disposal, design]
---

# Static lifetimes: design

Decided with the human (2026-11-11):
- Nothing that can hold a disposable is part of a cycle, checked at compile time.
- A call that holds the struct storing its own future is rejected at compile time.
- A closure's captures that can hold a disposable are part of its function type, read like a call's arguments. Its other captures are not.
- `holding H` names that set (Holding). `holding Never` is the empty set; an inferred set prints as `holding {Lease, Conn}`, in diagnostics only.
- §7's order becomes reverse release order.

Open until L0: the order's wording, the resolver edges' spec wording, and the costs (Costs, below).

## Holding (L1)

- **Tracked:** a disposable, or a type that may hold one at any depth (Reach, below).
- **What it is.** A function, future, resolver or trait-object type carries the set of tracked types it holds. A parameter of its own sort names the set, as a mark parameter names a mark (`qualifierParameterOf`). It is written only after `holding` and is never a value's type.
  - **Order-free.** The set has no order and no arity, so variadic packs don't touch it.
  - **Tracked only.** An untracked type can't reach a tracked one, so nothing else is kept.
- **Inferred:**
  - A lambda: the tracked types among its captures. A declared function holds nothing.
  - A call's future: the tracked types among its arguments, and its callee's set. The call holds them until it finishes, and the future's last holder is what stops it.
  - `Resolver.of`: its callback's set. `Resolver.at`: the set of the resolver it decides.
  - A trait object: its value's type, when tracked.
- **Written** only where a declaration keeps one and something depends on it:
  - `fn defer<M in Mark, H>(f: Fn<(), Unit, M> holding H) -> Deferred<M, H>`
  - Only `Never`, the empty set, or a holding parameter is written after `holding`; anything else there is an error.
  - `holding Never` is the usual bound, `any T holding Never` included.
- **Fit is set inclusion.** A parameter binds the inferred set.
- **Unwritten** (and `any T` without one) is *unknown*. Anything fits it, as with `Send`'s `plain`, so code that only calls stays as it is. Unknown reaches anything.
- **Holding feeds only reach.** Must-use and `capturedSend` keep reading what they read today.

## The rule (L2)

- **Reach.** A type reaches every type a value of it may hold at any depth, through:
  - fields, elements and variants;
  - a handle's contents;
  - the type parameters an extern declares it holds (marked as variance is; `WeakRef<T>` and `Instance<T>` hold nothing);
  - holding sets.
- **Held arguments.** An extern declares which of its parameters a call makes another argument hold: `Future`'s `onAwait` makes `self` hold `done`, and `onCancel` makes `self` hold `callback`. At the call, the held argument must not reach its holder's type, compared with holding sets ignored: the holder's type at the call can be wider than the place that keeps it (`const f: Future<Int, "live"> = s->sub`).
- **Rule:** a tracked handle type must not reach itself, meaning any type it fits. Since unknown reaches anything, a tracked handle can't hold an unknown holding.
  - It is checked where a handle type is declared, and where a generic one is instantiated.
  - Inside a generic body, a handle type over a parameter, or a held argument of a parameter's type, becomes a requirement that every call meets with its type arguments, as kinds and sendability do (`call-kinds.ts`).
- **Why stores need no check of their own:**
  - Construction can't close a cycle.
  - A mutation stores a value whose type fits the declared place. Inside a tracked handle, that place's type bounds what the value reaches.
  - Every runtime-made edge is in a type, or is a held argument checked at its call, except a pending case resolver's (Resolver edges). Those are rooted by the waiting call, and go when the resolver is resolved or cancelled, which its call stopping does.
- **What it catches:**

  | Kind | Example |
  |---|---|
  | data | `Lease{partner: Lease?}` |
  | call | `task->running = _run(task, …)`; WeakMap's watch |
  | closure | a `Deferred` whose `run` captures a cell holding it |
  | resolver | a struct keeping a resolver whose callback reaches the struct; `s->sub.onAwait(Resolver.of(fn v: s->last = v))`; `r.onCancel(cb)` with `cb` reaching `r`'s type (`r`, or what holds it) |
  | `any` | `Hub{subs: Array<any Listener>}` with a `Listener` holding the hub |

- **A call reaching its own future by a path no type shows,** e.g. through `WeakRef.deref()` or a top-level cell, still runs on as a root. That is today's behaviour, not a new leak.

## Resolver edges (R1; wording in L0)

Today a registration holds both its ends: a future holds its pending resolvers, and each resolver holds its future. That is a 2-cycle by construction (heap `#indexedHolds`, holdings `state.on`). Each edge becomes one-way, a change of behaviour of its own (R1). The other direction is a watch: an index entry, never a count.

- **A wait's case resolver:**
  - Its wait holds it while it is awaited. An awaitable may keep it too.
  - It holds the futures it is registered on, and the at-resolvers registered on a future to decide it, as today. These only watch it.
  - It holds its `onCancel` callbacks, as every resolver does.
  - It lets go of them when it is resolved or cancelled. It is cancelled when its waiting call stops, whatever else holds it.
- **A callback resolver** (`Resolver.of`):
  - The future it is registered on holds it, as a held argument. It only watches that future.
  - It holds its callback and its `onCancel` callbacks.
- **An at-resolver** (`Resolver.at`) takes the direction of the resolver its chain ends in:
  - in a case chain, `done` holds the at-resolvers, and they hold their futures;
  - in a callback chain, the futures hold the at-resolvers, and they hold `done`.

## Costs (L0 decides)

- **`done` and `Awaitable`.** The resolver an awaitable is given is Disposable and its holding is unknown, so no awaitable can keep it in a handle. That makes §6's "keeps it to resolve later" inexpressible.
  - Proposal: `Awaitable.onAwait` takes `done: Resolver<T, Self.Mode> holding Never`. An awaitable then keeps or registers `done` with no check. The case resolver meets it, and its pending edges are rooted by the waiting call (The rule).
  - It is required, not optional: with `done` unknown, `futures.first` fails L2 (it registers `Resolver.at(done, …)` on a future), as does every awaitable that composes.
  - Then a callback holding a tracked value can't be given to an awaitable's `onAwait`. It registers on a future instead: an async call awaiting the awaitable.
- **`any T`.** Decided: `any T holding Never` is the usual bound, and `any T holding H` is used where something depends on it. No hidden generics. A tracked value can't become an `any T holding Never`; FormBuilder's views hold `any View` and `any Showable`.
- **Recursive tracked types,** even acyclic chains (`fanout`).
- **Held arguments are checked by type.** A callback can't be registered on a future, or added by `onCancel` to a resolver, whose type it reaches, even when what it reaches is a different one. Holding that through a `WeakRef` passes, when it is Disposable.
- **A kept resolver's `onCancel` cleanup is rejected.** `self->waiters.push(done); done.onCancel(fn: self->waiters.remove(done))` reaches its holder's type, so §6's keeper loses the cleanup `onCancel` exists for, unless the keeper is Disposable and the callback holds it through a `WeakRef`.
- **Every handle holding a function, future, resolver or trait object spells its holding,** since unknown reaches anything: `Deferred`, `Revertible`, `Mock`, the testing fakes, FormBuilder (`List.make` included), §7's `Shared` example, and instantiations such as `Shared<fn() -> Unit>` or `Inbox<fn() -> Unit>`.

## Contract between the lanes

- **The flag.** L2 writes `tracked` on the Definition's type entries for shared structs and externs. The checker is its one home; the runtime only reads it.
- **What the runtime counts:**
  - every disposable: futures, slots, resolvers, resources, mocks;
  - a cell, when its type is tracked;
  - a composite value, when one of its direct parts is counted. Its one constructor decides that (R2).

## Counted disposal (R3–R5)

- **Where counts live:**
  - in a per-instance table keyed by object (a `WeakMap` for composite values);
  - never on values or heap records, which in-memory snapshots share.

  A restore rebuilds the table in one pass over what it restores: decoding, or a resident's in-memory `take()`.
- **Holders:**
  - a register, a cell or slot, a composite, a capture: each when written or built over the value;
  - a held argument's holder;
  - the resolver edges above, as they say.
- **At zero:** a disposable is disposed, then the object's direct parts are let go of. That is the free of the dead object's parts, never a walk of the live state. The rule makes counted objects acyclic, so counts are exact. R3 checks it against the collector before anything relies on it.
- **Calls:** a call is a root until it finishes, and its frames take counts. A future whose count reaches zero stops its call, at its next `await` when it is running.
- **Order (R5; wording in L0):** what one release lets go of is disposed last-held first.
  - A block's variables go last-declared first.
  - A composite's parts go last-first.
  - A holder is disposed, and its dispose code run, before its parts are let go of. The parts are let go of depth-first.
  - Zeroes made by a dispose's own code are handled before that dispose's siblings, as nested rounds are today.
- **Kept:**
  - per-kind disposal (`disposal.ts`);
  - dispose code on the run stack (`disposal-runs.ts`);
  - weak watches, resolved when their target is disposed;
  - `Slots.#owed`, unless a phase shows serving no longer waits on dispose code;
  - an ending instance's recovery (`segment/collection.ts`, `collectEnding`): a disposal that panics
    is let go of and the rest still run, the panic charged to the innermost running disposal. R4
    rebuilds it over the queue of zeroes.

## Off the id heap (R6)

- **Every handle refers to its object directly,** with a creation serial for `==`, hashing and snapshot ids. That settles Q51.
- **The heap keeps only the scheduler's indexes:** executions, resolvers, waits, pending futures and timers, and weak watches. An object's membership changing over its life touches neither its handles nor its count.
- **Live runs never walk.**
- **An ista commit** writes what its roots reach in the one pass that encodes it, with the depth check made in that pass.

## Deleted

| Phase | What goes |
|---|---|
| R4 | the collector's rounds (it becomes a queue of zeroes); `orphans.ts`; `handlesIn`/`summaryOf` for releases; `Heap.noteReleased`/`takeReleased`; the commit's invariant scan (P4) |
| R6 | `holders.ts`; `Instance.dropUnheld`, `#kept`, `Heap.keepOnly`; holding rules in `snapshot/holdings.ts` that only served the walks; id handles |

## Spec and docs

L0 approves the wording. Each phase commits the sections it makes true, so the spec never describes behaviour the code lacks.

- §3.3, §3.14: holding and held arguments (L1, L2).
- §6: resolver edges (R1), and `onAwait`'s `done` (L2).
- §7:
  - "A registration holds both its ends" becomes the one-way edges (R1).
  - Cycles: the bullet goes, and the rule takes its place (L2).
  - Holders by count (R4).
  - "An async call's execution is held through its future" becomes: a call is a root until it finishes, and its future's last holder stops it (R4).
  - Order (R5).
- `docs/arch/definition.md`'s row "Rejected: Reference counts" is reversed (R4). Cycles are now excluded by types. Counts can't disagree with values because they are derived in memory, never stored, rebuilt on every restore, and checked against the collector in R3.
- `docs/reuse/runtime-and-persistence.md`'s one-way rule narrows to "never persist counts" (R4).
