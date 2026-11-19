---
description: main, spawn, instances, isolating calls, contexts and runtimes; read before changing how programs and instances start
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 17.1 Program structure

Every program has exactly one `live async fn main()`, taking nothing. A host starts only live or simple code (§9.1), as a live run, which runs in memory, never commits and ends with its process. Persistent work runs in contexts, which `main` calls through a runtime it opens (below). The host starts `main` when it runs a version. When `main` returns, everything it holds is disposed (§16).

**spawn.** `spawn` is a prelude function, `ista fn spawn<R>(f: sendable ista async fn() -> R) -> Instance<R>`, that starts `f` as a new, independent workflow instance with its own snapshot, then continues immediately. Called as a deferred call (§6.5), `spawn purchase(req)` computes `req` now and copies it into the new instance, which makes the call `purchase(req)`; a plain function fits too (§6.5), so `purchase` may be async or not, and `spawn(f)` starts a function value `f` itself. The new instance awaits the future `f` gives and ends with its value, its outcome, `R`, which the host can see. Its `Instance<R>` may be left unused, and holding it doesn't hold the new instance, which stays independent. It doesn't wait, so an `ista fn` may spawn too; `spawn` being ista, live and unmarked code can't (§9.1). What `f` captures is copied into the new instance, so it must be sendable (§7.4): a deferred call's computed values each are (§6.5). The new instance runs until it finishes by itself, on the version it started with. Concurrency inside an instance needs no `spawn`: an async call that isn't awaited right away already runs alongside its caller.

- **What can be spawned.** Any call a deferred call can make with sendable values (§6.5): of a top-level function, async or not, a method or static function, an instance of a generic one, an extern, a function a constraint requires, or a value of a sendable function type, whose captures are copied with what the call passes. A `&` argument, a call through `?.` and a value that isn't sendable are compile errors.
- **Effects commit with the segment.** The new instance exists once the segment that spawned it commits; a segment that is discarded spawned nothing. Each spawned instance is named after its parent and a count of the parent's spawns, `<parent>/<n>`, and is written before the parent's commit, so a segment that re-runs finds it already there and doesn't spawn it twice.
- **Options are inherited.** An instance spawned by one that runs with `crashEveryAwait` (§18) runs with it too.
- **Waiting for an instance.** `inst.result()` resolves with the instance's first end: `Ok` of its outcome when it finishes, or `Err(Error{message, code: "panic", trace})` with its panic when it panics, or was terminated after one. The outcome is copied out of the instance's last commit, so `T` must be sendable. A retry after the panic changes nothing for a wait already resolved. `Instance<T>` is sendable and compares by identity, so it may be passed to another instance; it isn't `Encodable`, so it never crosses to the host.
- **Isolating a call.** `runtime.isolate(f)` spawns `f` and waits for its `result()`, so a panic in `f` becomes an `Err` instead of freezing the caller. Its panic also terminates that instance at once, disposing what it holds (§16), so it needs no operator.

```ista
import * as runtime from 'runtime'
live async fn main(): await runtime.run(runtime.id()) _main()
ista async fn _main():
    while true:
        const req: PurchaseRequest = await runtime.delegate purchaseRequests.receive()
        spawn purchase(req)
```

**Contexts.** Ista code runs in contexts: instances in the host's store, each named by its key. Live code reaches them through a runtime, from the `runtime` module:

- **Opening a runtime.** `Runtime.open(runtime.hostStore())`, a `live async fn`, opens a runtime over the host's store, `ista run`'s `--store` (memory without it) or a test's own, and resumes the work persisted there: every context and instance that hasn't ended runs on from its last commit. It serves their jobs too (§14), each instance's by calls into it: the earliest runtime still open serves every instance running its program, and one opened later takes them over once those before it are disposed; an instance on another version waits for a run of its own. A `Runtime` is live and disposable: disposing it stops that work, which the next open resumes, and the work runs only while the live code that opened it does.
- **Calling into a context.** `rt.call(key) f(args)` runs `f`, an ista function, in the context named `key`, made with the options the live run started with (`crashEveryAwait`, §18) when the store has none by that key. A key holds no `/`, which only a spawned instance's name does (`<parent>/<n>`), so no key names one: a call with one panics. Every call starts a new invocation, alongside any already running there, and gives a `Call<R>`, a live awaitable (§19.1): awaiting it gives `Ok` of what `f` gave, or `Err(Error{message, code: "panic", trace})` once the context panics, or when it had panicked or ended already. Releasing a `Call` cancels nothing. What crosses, `args` and the result, must be sendable (§7.4). The context commits at every `await`, as any instance does, while the live code waiting on it waits in memory; an invocation an earlier process started runs to its end once resumed, its answer reaching nobody.
- **Running in a context.** `runtime.run(key) f(args)` opens a runtime and calls `f` in the context named `key`, giving what `f` gave, or panicking with the context's panic, its message and trace. The usual `main` runs its program this way, in the context named after the live run (`runtime.id()`):

```ista
import * as runtime from 'runtime'
live async fn main() -> Int: await runtime.run(runtime.id()) _main()
ista async fn _main() -> Int:
    await runtime.commit()
    42
```
