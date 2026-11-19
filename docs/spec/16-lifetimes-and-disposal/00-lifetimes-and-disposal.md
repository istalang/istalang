---
description: disposables, holders, must-use values, drop, disposal order and cycles, weak references, graceful disposal, defer; read before changing lifetimes or disposal
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 16. Lifetimes and disposal

Pending futures, slots and inboxes, and revertible messages are **disposable**: they satisfy the built-in `Disposable` trait, and the runtime calls `dispose` when nothing holds them anymore. Code never calls `dispose`, or names it as a value except as a test's mock target (§18); it releases a value with `drop`. Only a value with an identity of its own can be disposable, so only a shared struct (§5.4) or an extern type may be. That is how user code gets a disposable resource: `fn dispose(self: Lease)` makes the shared struct `Lease` disposable, and a `dispose` declared for an extern type a host provides makes it disposable too. A plain struct that declares `dispose` is a compile error, because copies of a value have no single identity to dispose.

A program's `dispose` is found the way an operator's function is (§13.1), beside the type it disposes: in the module declaring that type. It is plain code: it takes the value as its one parameter, returns unit, and can't be `async`. The value can't outlive its disposal, so inside `dispose` it is used only as `*self` (or `self->field`) or passed to an extern function, or to a std function whose `@Keeps` stands for it (§5.5); storing it, copying it into a variable, capturing it or passing it to any other function is a compile error.

```ista
trait Disposable:
    fn dispose(self: Self)
```

**Holders.** A disposable value is held by whatever the running instance can still reach it through: variables (`_` included), struct fields, array and map elements, closure captures and values waiting in a slot, of the executions that are live, and through other values held so. Copying a value that contains a disposable handle adds a holder, overwriting a variable or field releases the old value, and returning a value hands it to the caller. When a block ends, it releases everything its variables hold, except `hold let` and `hold const` variables, whose holdings the enclosing function releases when it ends, or the loop or block their `hold(name)` names (§7.1); every disposable that has just lost its last holder is disposed. **Temporaries**, such as the result of `parent.deref()` used inside one expression, are released at the end of their statement. The temporaries of a header, such as an `if` or `while` condition or a `match` subject, are released when it has been evaluated, before the body runs.

Some holds are implicit:

- A pending `take`, `read` or `put` holds its slot, so a waiting receiver keeps the slot alive. A slot's queue of waiting operations holds nothing.
- An async call's execution is held through its future. A running call holds its own future until it suspends, so a call that releases the last holder of its own future runs on, and is stopped at its next `await`.
- A transient's cell (§7.1) is held by the outermost call of its function and by each call nested in it that shares it, an async call's execution keeping the cells visible where it started, so it is released when the last of them ends. The cycle rule takes every async call's future to hold every transient, so a future kept where a transient may reach it is a compile error; a `WeakRef` to it, or keeping it elsewhere, avoids one.
- A resolved future holds its value. A pending resolver holds its callbacks, and a `Resolver.at` one the resolver it decides, so a resolver lives as long as something that can still decide it. A registration holds one of its ends, as what the resolver comes down to deciding says: a wait's case, or a callback, through any `Resolver.at` ones. A wait's resolvers are held from the wait down: a wait holds its case resolvers that are awaited, registered or decided by awaited `Resolver.at` ones, each of them its awaited `Resolver.at` ones, and each the futures it is registered on. A callback's are held from its futures up: a future holds the pending resolvers registered on it. So what an awaitable starts by registering its resolver on it lives as long as the wait, and a callback as long as the future it is registered on: on a long-lived future, until that future resolves or is let go of, even once what the callback would decide is decided. A callback doesn't keep the future it is registered on: let go of, that future is disposed, which cancels the callback (§15.2). A callback holds nothing it started: a cold awaitable mapping, through `Resolver.of`, a future it started itself lets go of that future, and its resolver panics as dropped, so it registers its resolver or a `Resolver.at` of it instead, or maps the value in an async function. A pending resolver let go of is cancelled, but a wait's never registered, which panics (§15.2).
- A callback a resolver readied holds the values it is called with until it runs. An instance that finishes or ends runs none still pending, and lets go of what they hold.
- A `WeakRef` and a `disposed()` future watch what they refer to without holding it.

**Unnamed and dropped values.** A must-use value left as a bare expression is a compile error. The must-use types:

- a future (§6.1)
- a `Result` (§12)
- a disposable
- a union with a must-use member (§4.2)
- any value holding one of these, at any depth: a struct or tuple with a future in it, an `Array` of futures, a `Result?`

Using one consumes it (`await`, `match`, `?`), as does keeping it in a variable or discarding it. `_ = expr` keeps it in an unnamed variable, so it lasts until the block ends, `hold _ = expr` until the function ends, and `hold(name) _ = expr` until the loop or block `name` ends. `drop expr` says "I don't need this": a disposable is disposed right away if nothing else holds it, and anything else is simply discarded. A typical use is a best-effort call whose failure doesn't matter, such as `drop audit.record(event)`, which ignores its `Result` on purpose. `drop x` releases the variable `x`, which can't be used afterwards: a use that some path reaches from the `drop` is a compile error, unless a `let` is assigned again first, and a variable declared again, as in a loop's next iteration, is a fresh one. Only a variable the function holds itself can be dropped: not one a closure captured from outside it, not a reference parameter, not a transient, which the calls nested in its outermost one share (§7.1), and not a top-level constant. Neither ever makes a disposed value observable.

In the common case nothing is stored anywhere else, so a disposable lives exactly as long as the function that created it. That isn't forced, though: storing, returning or sending a disposable keeps it alive, and doing so is the developer's choice.

- **Deterministic.** Disposal happens when the last holder's block ends, never at snapshot time, because `dispose` has visible effects.
- **Synchronous.** `dispose` can't `await`. It can send signals, retract messages and mark work as aborted. Anything that must clean up gracefully does so in its own execution, after receiving the signal.
- **Ordered.** Values that lose their last holder at the same block exit are disposed in reverse creation order. A value held by another one being disposed loses its last holder only once that disposal is done, so a holder is disposed before what it holds, and its `dispose`, a `Deferred`'s function included, never sees a disposed value.
- **Atomic.** The effects of disposal commit with the segment in which the block ends.
- **Within one instance.** Holding never crosses instances: disposable handles aren't sendable (§7.4), and what the host provides is owned by the host.
- **Cycles.** No cycle of holding may pass through a value that reaches a disposable, so each disposable's holders can be counted and it is disposed when the count reaches zero. A write that may close such a cycle is a compile error, and so is a call whose callee would close one with what it is given, or at the types it is given. A parent that holds its children and is reached back from them, for example, is held by them through a `WeakRef`: `child->parent = WeakRef(node)`, read with `deref()`. A cycle of inert values (§7.4), which reach no disposable, is allowed: a closure calling itself through the `let` it is assigned to, or a listener of type `inert fn` capturing the very handle that keeps it (§6.4). A plain function value may hold anything, since its type doesn't say what it captured.

**What disposing does,** as implemented by the standard library:

| Value | Disposing it |
| --- | --- |
| `Future` of an async call | resolves the call's `disposing()`, then stops the call at its next `await` |
| a job's future (`runtime.delegate`'s, §14) | withdraws the job: one not yet run never runs, and a running one is cancelled, its live future disposed |
| a pending `take`, `read` or timer | drops the wait without consuming / cancels the timer |
| a live future a host's extern gave (§17.2) | cancels its resolver: its `onCancel` callbacks run once, telling the host, and a later `resolve` does nothing |
| `Slot` or `Inbox` | it dies, along with the values in it |
| `Revertible<T>` holder | retracts the message if it hasn't been received |
| `Deferred` (`defer`'s) | calls its function |

In every case, each `disposed()` future watching the value resolves afterwards.

**Resolvers.** A resolver is one-shot: a second `resolve` panics, and `tryResolve` gives whether it took the value, for races. One its holder lets go of unresolved panics the wait it was to resume, naming who dropped it. One whose future is disposed first is cancelled: its `onCancel` callbacks run once, at once in live code and when the disposing segment commits in a persistent instance, so a disposal a crash discards cancels nothing.

**Weak references.** `WeakRef<T is Disposable>` refers to a value without holding it. Its `deref()` returns `T?`, which is `none` once the last holder has released the value. Its `disposed()` returns a `Future<Unit, "ista">` that resolves at that moment, already resolved if it has passed, and waiting on it holds nothing. `WeakRef(x)` gives the one weak reference to `x`, so two weak references are `==` exactly when they refer to the same value, also after it is disposed. Weak references aren't sendable.

**Disposing early.** To dispose something you hold before its block ends, `drop` it. A value is disposed only when its last holder releases it, so a disposed value is never observable. To stop something that other code may also need to reach, keep the only holder in a `Shared` and share that. Setting its value to `none` releases the holder, and everyone else then sees `none` rather than a disposed value:

```ista statements
const sub = new Shared<Future<Unit, "ista">?>{value: bus.subscribe(fn msg: show(msg))}
...
sub->value = none         # the subscription is disposed here
```

Code that copies the future out (`const f = sub->value`) becomes a holder itself, and keeps it alive.

**Graceful disposal.** Inside an `async fn`, the function's own name gives the current call's context. `worker.disposing()` returns a `Future<Unit, K>`, `K` the kind of the code asking, that resolves when the call is disposed, which gives the call a chance to clean up:

```ista
ista async fn worker(jobs: Inbox<Job>):
    while true:
        await select:
            case jobs.receive() as job:
                process(job)
            case worker.disposing():     # this call is being disposed
                flushPending()           # cleanup can't await
                return
```

- **Cleanup runs inside the disposal.** When the call's last holder releases it, the runtime resolves its `disposing()` future. If the call is suspended where it can resume on that future (awaiting it, or in a `select` with a case for it), it resumes at once, in the same segment as the disposal, and that case wins over any other.
- **The next `await` aborts.** After disposal, the first `await` the call reaches stops it, and its variables are released. A call that never watches `disposing()`, or isn't waiting on it at that moment, is stopped right where it is suspended.
- **Cleanup can't wait.** Because the next `await` aborts the call, cleanup is synchronous by construction. Cleanup is decided by the future: whatever the call is suspended on, if it is the call's `disposing()` future, it resumes as cleanup. The compiler warns about an `await` inside a `select` case written as `worker.disposing()`; one held in a variable is the same future, but gets no warning.
- **Lexical.** `worker.disposing()` always refers to the enclosing call of `worker`, also from a nested local function, so nested functions are never ambiguous. It is a compile error outside an `async fn` of that name, in a parameter's default, which runs before the body starts (§6.1), and for `main`, which nothing holds.
- **Calls nothing can dispose.** An instance's root call, such as a started function, and a call that has already returned are never disposed, so their `disposing()` never resolves. The call a spawned instance awaits for its outcome (§17.1) is disposed only when the instance is terminated, so its `disposing()` cleanup runs then; when it returns, the instance finishes and disposes its outcome if that is disposable, as it does one its root returns.

**Defer.** `defer` is a prelude function, `M fn defer<M in Mark>(f: Fn<(), Unit, M>) -> Deferred<M>`, whose `Deferred<M>` is a disposable calling `f` when released, so it needs no machinery of its own. Called as a deferred call (§6.5), `_ = defer log(x)` computes `x` now and logs when the current block ends, whether it finishes, is left through `return`, `break` or `continue`, or is disposed at an `await`; `hold _ = defer log(x)` logs when the function ends, as Go's `defer` does. A `Deferred` is must-use, so a bare `defer log(x)` is a compile error. `f` isn't async, so it can't await; its mark is a lambda's (§6.4), the deferring code's where it calls or handles anything of a kind, else simple, and its release runs in the deferring code. Several run as any values released together are disposed, last first, and one kept by `_` in a loop body runs at the end of each iteration, as in Swift. The bracket form passes a function as it is, a lambda reading variables when it runs. Unlike `disposing()`, it also runs on a normal exit; to act only on disposal, check a flag:

```ista
ista async fn reserveAndShip(item: Item):
    const hold = reserve(item)
    let shipped = false
    _ = defer(fn(): {
        if not shipped:
            release(hold)
    })
    await ship(item)
    shipped = true
```

**Example.** `processAll` keeps every job it starts with `hold _`, and disposes its inbox, and any job still running, as soon as it returns:

```ista
ista async fn processAll(jobs: Array<Job>) -> Array<Outcome>:
    const results = Inbox.create<Outcome>()
    for job in jobs:
        hold _ = runJob(job, results)       # runs concurrently until processAll returns
    let outcomes: Array<Outcome> = []
    while outcomes.length() < jobs.length():
        outcomes.push(await results.receive())
    outcomes
```

**No escape rule.** Because disposal follows holders, a future, slot or inbox may be returned or stored freely; doing so simply keeps it alive.
