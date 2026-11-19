---
description: the prelude's declarations: built-in types, futures, resolvers, slots, weak references, instances, spawn and defer; read before changing the prelude
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 19.1 Prelude

The **prelude** declares the built-in types the runtime implements, using the same `extern` mechanism programs use (§17.2):

```ista fragment
extern struct Array<gives T>                # an Array<Int> is an Array<Int?> (§8.1)
extern struct Map<K, gives V>               # keys invariant: widening them would rehash
extern shared struct Slot<T>                # a handle, not sendable
extern shared struct WeakRef<T is Disposable>
type Mark = "simple" | "live" | "ista"   # what data is, and what code may handle (§9.1)
type Persistence = "live" | "ista"            # the two kinds of code (§14)
extern shared struct Future<T, K in Persistence> { type Mode = K }   # waited on in its kind
extern shared struct Resolver<T, K in Persistence>   # one wait's one-shot resolver (§15.2)
type Sendability = "sendable" | "inert" | "plain"   # what a function's values may capture (§6.4)
extern struct Fn<Args, Result, Kind in Mark = "simple", Send in Sendability = "plain">   # §6.4
extern sendable struct Instance<T>          # compared by identity, never Encodable (§17.4)
shared struct Shared<T> { value: T }        # not sendable (§5.4)

trait Awaitable<T>:                         # what `await` and a `select` case wait on (§15.2, §15.4)
  type Mode in Persistence
  Self.Mode fn onAwait(self: Self, done: Resolver<T, Self.Mode>)
extern K fn onAwait<T, K in Persistence>(self: Future<T, K>, done: Resolver<T, K>)   # the runtime's
extern K fn resolve<T, K in Persistence>(self: Resolver<T, K>, value: T)   # a second one panics
extern K fn tryResolve<T, K in Persistence>(self: Resolver<T, K>, value: T) -> Bool   # took it?
extern K fn Resolver.of<T, K in Persistence>(callback: Fn<(T,), Unit, K>) -> Resolver<T, K>   # calls back
extern K fn Resolver.at<T, K in Persistence>(done: Resolver<(Int, T), K>, position: Int) -> Resolver<T, K>   # decides done
extern K fn onCancel<T, K in Persistence>(self: Resolver<T, K>, callback: Fn<(), Unit, K>)   # once cancelled

extern ista fn Slot.create<T>() -> Slot<T>                  # starts empty; a slot is ista data
extern ista fn put<T>(self: Slot<T>, value: T) -> Future<Unit, "ista">   # waits until empty, then fills
extern ista fn take<T>(self: Slot<T>) -> Future<T, "ista">               # waits until full, then empties
extern ista fn read<T>(self: Slot<T>) -> Future<T, "ista">               # waits until full, keeps the value
extern fn WeakRef.from<T is Disposable>(value: T) -> WeakRef<T>   # WeakRef(x): the one weak handle to x
extern fn deref<T is Disposable>(self: WeakRef<T>) -> T?
extern ista fn disposed<T is Disposable>(self: WeakRef<T>) -> Future<Unit, "ista">
extern ista fn result<T is Sendable>(self: Instance<T>) -> Future<Result<T>, "ista">   # its first end (§17.1)
```

The prelude also contains `type Optional<T> = T?`, whose static functions are every optional's (§4.6), `Result`, `Step` (§8.4), `Error`, the built-in traits (§8.4, including `Disposable`, `Stringable` and `Parsable`, which `Int`, `Float`, `Bool` and `String` satisfy), the `Waypoint` annotation (§18), `panic`, `ista fn spawn<R>(f: sendable ista async fn() -> R) -> Instance<R>`, which starts a new instance running `f` (§17.1), and `M fn defer<M in Mark>(f: Fn<(), Unit, M>) -> Deferred<M>`, a shared struct whose `M fn dispose` calls `f` (§16).
