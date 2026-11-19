---
description: futures, their producers, resolvers, positions, events and callbacks; read before changing waits or resolution order
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 15.2 Futures and resolvers

**Futures.** A `Future<T, K>` is the read-only view of a slot: it can only be waited on. Every wait in the language is a wait on a slot, filled by one of three producers:

- **User code,** with `put`: an inbox's `receive()` or an `rpc` reply.
- **The runtime:** when an async call returns, when a `time.delay` or `time.at` timer fires, and when a value is disposed (`disposed()`, `worker.disposing()`).
- **The host,** resolving a live future its extern gave (§17.2).

`await` and `select` wait on awaitables (§19.1), a future the runtime's own. A future resolves once and stays resolved.

**Resolvers.** Each wait has a resolver per case, which the runtime makes and gives the case's awaitable through its `onAwait` (§19.1): an `await`'s one, or each case of a `select`, in order. A future registers it on itself, several futures may register one, the first to resolve deciding it, and another awaitable resolves it, hands it to one, or keeps it to resolve later. The first of a wait's resolvers to resolve decides it, once: the waiting execution becomes ready and resumes with that value, and the wait's other resolvers are cancelled, after which resolving them does nothing. Several resolved before the wait began decide it at the first in order: its first case, within it the lowest position of a `Resolver.at`, then the future registered earliest. Several resolving together decide it at the first the event resolves (below). A wait's resolver let go of unresolved, never registered, panics: nothing can decide its wait through it any more. An awaitable keeps the work it starts alive by registering its resolver on it, or a `Resolver.at` of it (§16). **Positions.** `Resolver.at(done, position)` makes a resolver that, resolved with a value, resolves `done` with `(position, value)` in the same step, running no code. It is pending as long as `done` is, and cancelled once `done` is decided, so an awaitable racing several futures through one each, as `futures.first` does, decides as a `select`'s cases do (§15.4). Futures resolve together when one event resolves them at once: the reads one value serves, in their slot's queue order, the timers due at one instant, in the order they were set, the watches one disposal resolves; each take or put a slot serves is an event of its own, in queue order. An event resolves its futures' resolvers future by future in its order, each future's in the order they were registered on it, and what becomes ready runs in that order, executions and callbacks alike. **Callbacks.** A `Resolver.of(callback)` resolver decides no wait: code hands it to an awaitable's `onAwait` to wait without `await`, and resolving it calls `callback` with the value, as a call of its own that runs once the code resolving it waits, so in a persistent instance in a segment of its own. Whatever the callback decides is decided only then, later than its value arrived: an awaitable composed through callbacks may lose a `select` to a later case, and lose what its callback was to get, such as a slot's value, so unlike a future or a `Resolver.at` race it is not safe to lose (§15.4). A resolver's `onCancel(callback)` runs `callback` the same way, once, when it is cancelled: another case decided its wait (even should it be resolved after, to no effect), its waiter moved on without it, what a `Resolver.at` one decides was decided, it was let go of unresolved without panicking, or a future it is registered on was disposed; it runs right after the waiter whose wait cancelled it, at once when it was cancelled already, and never once it decided anything. In a persistent instance the resolver is part of its state, committed with the waiting frame, so a segment that is discarded decided nothing; in live code it lives in memory. Resolving a future costs what waits on that future, however many executions wait on others.
