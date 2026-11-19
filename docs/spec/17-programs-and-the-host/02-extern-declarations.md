---
description: extern functions, constants and structs, host handles, disposable host types, marks of externs, host-resolved futures; read before changing the host boundary's declarations
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 17.2 Extern declarations

`extern` marks a top-level declaration whose implementation lives in the host, outside any workflow instance. It applies to functions, which have no body, to constants, written `extern name: Type` with no initializer, and to struct types the host implements, such as `extern sendable struct Queue<T>`. Their values cross as JSON (§17.4), so the parameters of extern functions must be `Encodable`, and their results and extern constants `Decodable` (§8.4), which makes all of them sendable (§7.4). The one exception is sendability: what crosses to the host crosses as JSON, so a disposable host type, below, which isn't sendable, still crosses to its own host, alone or inside other values. An `extern live async fn` gives a live future, which its host resolves (below). A host object with operations of its own is an extern type with extern functions taking it, and one whose release the host must learn of is a disposable host type, below: a queue the host provides gives a revertible send as one, which the `inbox` module's `Revertible.holding` keeps until its holder is released (§15.3, §20.1).

```ista
extern fn chargeCard(purchaseId: String, amount: Int) -> Result<String>
extern approvalDeadline: Duration
extern purchaseRequests: Queue<PurchaseRequest>     # a queue the host provides
```

- **Provided by the host.** The host supplies each extern constant's value and keeps it outside instance snapshots, so it outlives every instance and every deploy.
- **Sendable only.** An extern constant is `Decodable`, so sendable (§7.4), since any instance may read it. A function type, even a sendable one (§6.4), has no JSON form, so it never crosses.
- **Constant binding.** An extern can't be reassigned. Its internal state can still change through its methods, for example when a message is sent into a queue the host provides.
- **Checked at deploy.** The runtime refuses a program whose extern declaration has a different type from the one it already holds under that name, so one name always means one type.
- **Deterministic reads.** An instance reads an extern constant once, at its first read, and keeps that value in its snapshot for its whole life, so every segment, resumed or not, sees the same value.
- **Values and handles.** An extern struct is a value unless a word between `extern` and `struct` makes it a handle (§7.2): `extern shared struct` has an identity in its instance, as a shared struct does (§5.4); `extern sendable struct` one every instance shares, such as a queue the host provides; `extern live struct` one in the process that made it, whose values are live data (§9.1). An extern value crosses as JSON, so it is sendable when its type arguments are, and so is a `sendable` handle; any other handle never is. An extern value's type parameters are invariant unless `gives` or `takes` says otherwise (§8.1); a handle's always are.
- **Associated types.** An extern struct may declare associated types in an indented body, and nothing else there, its fields being the host's (§5.2): `extern shared struct Future<T, K in Persistence>` declares `type Mode = K`, by which it meets `Awaitable` (§19.1). A field written there is a compile error.
- **Disposable host types.** A host type is disposable when a `dispose` is declared beside it (§16): an extern one its host implements, or code that passes the value to the host's externs. Each value of it then has an identity of its own: it arrives as the JSON the host gave, which the instance keeps while it holds the value, and leaves to the host as that same JSON. So such a type is declared `extern shared struct` (or `extern live struct`), neither a value nor `sendable`, it isn't `Encodable` or `Decodable`, and no extern constant, which every read shares, can hold one.
- **Marks.** An extern is code without a body, its signature alone held to the data rule (§9.1): `extern fn getSocket() -> Socket` is an error, written `extern live fn getSocket() -> Socket`. A host's externs are unmarked or `live`, and one marked `ista` or generic over its mark is a compile error: only the runtime runs ista code or fills an ista future, so externs generic over their mark, such as `time.at`, and `ista` ones, such as a slot's, are the runtime's, which implements each mark. Ista code reaches a host's `live` extern only through a job (`runtime.delegate`, §14).
- **Futures from the host.** An extern returning a future is `live async`, so it gives live code a live future, and the host's extern receives that future's resolver (§16): it resolves it when it can, from anywhere, the runtime taking the value between the code's steps, and learns through `onCancel` when the future is disposed first. A host that drops the resolver unresolved panics the waiting code, naming the extern. A JavaScript host may give back a promise instead, which resolves it as it settles.
