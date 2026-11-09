---
description: proposal 9 of docs/proposals, a sketch of the native runtime — a program written entirely in Istalang, its own host, persisting through a key-value store it provides, running persistent work in keyed contexts it reaches with `rt.at(key)` and `ctx.call f(args)`, with per-context inboxes and methods declared as typed names; how far it was discussed, examples of how it will look, and what is left to design; read before designing the native runtime or the standard library around it, or after proposal 8 to see where its runtime-side mechanisms went
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-07
last_updated: 2026-11-10
tags: [proposal, runtime, native, persistence, host]
---

# Proposal: native runtime

A sketch, not a specification: it records the shape agreed so far, and leaves its details to later work. It builds on proposal 8, whose language semantics it doesn't change.

Compiled to a native binary, a program is its own host. The developer writes everything in Istalang: the ephemeral `main` sets up the infrastructure, serves HTTP and the like, and now and then starts persistent work. Nothing has to be written in C++ or JavaScript, and the developer brings only a key-value store.

## Layers

| Layer | Written in | Provides |
| --- | --- | --- |
| OS primitives | the standard library, implemented by the native runtime | sockets, files, clock, event loop; the only externs left |
| App infrastructure | Istalang, ephemeral | `main`, HTTP, database drivers, the key-value store |
| Runtime | a standard-library value, created in `main` | runs persistent work in this process |
| Workflows | Istalang, persistent | `ista fn`s |

## The store

The developer provides a key-value store, and nothing else:

```python
trait Kv:
    fn get(self: Self, key: String) -> Future<Bytes?, "ephemeral">
    fn put(self: Self, key: String, value: Bytes) -> Future<Unit, "ephemeral">   # atomic for one key
    fn delete(self: Self, key: String) -> Future<Unit, "ephemeral">
```

- **Commits by copy-on-write.** A commit writes the changed objects under new keys, then `put`s one root key that points at them: that one put is the commit. Keys nothing reaches any more are deleted afterwards.
- **No indexes.** Contexts, executions, slots, timers and names all live in the state under the root key, so the store needs no find-or-create, no index and no lease. Timers are scheduled again when the runtime loads the state.
- **One process per store,** for now.
- **The standard library ships stores,** such as `store/sqlite`, and `store/memory` for tests. A store's code is ordinary ephemeral code, which proposal 8 already keeps from starting persistent work.

## Contexts

A context is a persistent instance named by a key. The functions called in it share its memory and its inboxes, as an instance's executions share its slots (§6).

- **`rt.at(key)`** gives the context, creating it if it doesn't exist. It is a plain call; the context is written to the store with the first invocation that commits. Persistent code reaches other contexts with `runtime.at(key)`, which commits with its segment.
- **`ctx.call f(args)`** runs `f` in the context, through proposal 8's deferred-call form. It gives a `Call<R>`, an awaitable of the caller's kind:
  - awaiting it gives `f`'s result;
  - `run.accepted()` resolves once the invocation is persisted.
- **Invocations are identified by their function and arguments.** The same call joins the invocation already running, or gets its recorded result, so retries are safe; two that must stay apart differ in an argument. The context keeps results until it ends.
- **An invocation belongs to the context, not its caller.** Releasing a `Call` without awaiting it doesn't cancel it.
- **A context ends** when nothing runs in it and its inboxes are empty, or on `ctx.delete()`.
- **Within a context, functions find what they share by name,** never passed in: an `ista fn` runs in a context from the moment it is called there, so its inboxes are well defined.

## Inboxes and methods

```python
const verdicts = InboxName<Verdict>{"verdicts"}         # a typed name: plain data
const approvals = Method<Verdict, String>{"approve"}
```

- **A typed name is declared once,** at the top level, so no string is written twice with two types. It holds no state: each context has its own `Inbox<Verdict>` of that name, the standard library's queue on slots (§6).
- **In an `ista fn`,** its operations act on the current context. **Outside one,** they need a context: `ctx.send(verdicts, v)`.
- **A method** is served by a running function and called from outside, `await ctx.call(approvals, v)`, for when the running workflow itself must answer: Temporal's "update". A plain handler, called with `ctx.call`, is simpler.

## Example

```python
# workflow.ista
const verdicts = InboxName<Verdict>{"verdicts"}

ista fn purchase(order: Order) -> String:
    const v = await verdicts.receive()                  # this context's inbox
    if v.ok: "approved" else: "rejected"

ista fn approve(v: Verdict) -> String:
    verdicts.send(v)                                    # same context, same inbox
    "noted"
```

```python
# main.ista
async fn main():
    const rt = Runtime.open(await SqliteKv.open("app.db"))   # loads the root, resumes persistent work
    const server = await http.listen(8080)
    const tasks = TaskGroup.create()
    while true:
        tasks.run handle(rt, await server.accept())          # each request a task; done ones let go

async fn handle(rt: Runtime, conn: Socket) -> Result<Unit>:
    const req = await http.read(conn)
    match req.route:
        case "POST /orders":
            const order = req.json<Order>()?
            const ctx = rt.at(`order/${order.id}`)
            const run = ctx.call purchase(order)
            await run.accepted()                    # persisted: answer 202 without waiting days
            await conn.respond(202, order.id)
        case "POST /approve":
            const body = req.json<Approval>()?
            const ctx = rt.at(`order/${body.order}`)
            await conn.respond(200, await ctx.call approve(body.verdict))
```

A server task group, rather than `hold(main)` in the loop, lets go of each handler when it finishes; `hold(main)` would keep every one until `main` ends.

## Who waits on persistent work

Ephemeral code waits on a context only while a request waits for its answer. Anything that must happen when persistent work ends happens inside it, or in what it calls; an ephemeral waiter is only a live consumer, and losing it on a restart loses nothing.

## Effects

An app's effects, such as charging a card, are ordinary `async fn`s over an HTTP client: persistent code awaits them in memory under proposal 8's checks. `readonly` is trusted only on externs, so the OS layer declares each dual-use operation twice, such as an HTTP client's GET as an `extern readonly async fn` and its other requests as an `extern async fn`, both implemented by the same native code. App functions built on them are `readonly` only where their bodies are.

## Runtime building blocks

These are the runtime's implementation details, not language: they decide nothing about `ista`, `async` or `await`.

- **`spawn`:** an independent instance, with its own memory, version, panic and operator view (§9). Proposal 8 makes it no keyword: it is a runtime function, called in the deferred form.
- **Jobs (`delegate`):** a runtime function in the deferred form too, for persistent code running ephemeral work through an internal job inbox, the transactional outbox: queued at the commit, run by the runtime's loop, run again after a crash under a stable key, its result committed into a persistent future.
- **Ephemeral views:** a `Call` awaited from ephemeral code is an in-memory listener on persistent work. It replaces a separate `watch`.
- **Resolvers** wrap callback-style native libraries into ephemeral awaitables. Persistent futures are filled only by the runtime: timers, inboxes, results and jobs.
- **Today's JavaScript host** becomes one more implementation: a store and the OS layer, written in JavaScript.

## Versions

A persisted frame belongs to the binary that wrote it. The runtime records each context's build, and a context runs on the build that created it. After a deploy, the old build keeps running until its contexts drain, and a newer binary forwards invocations meant for an older context, or waits for it.

## Left for later

- Several processes sharing one store: a compare-and-swap on the root key, and which process runs which context.
- Moving frames between builds.
- The store's object format and collection.
- How long a context keeps its results.
- Scheduling: fairness between contexts, and loading and unloading them.
- Whether jobs are visible to programs.
