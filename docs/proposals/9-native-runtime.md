---
description: proposal 9 of docs/proposals, a sketch of the native runtime — a program written entirely in Istalang, its own host, persisting through key-value stores it opens as `Runtime` values; persistent work runs in contexts, instances named by key, entered with `rt.call(key) f(args)` from live code and `runtime.call(key) f(args)` from ista code, each giving a `Call` that replaces `Instance`; per-context state as `ista const`; `spawn`, jobs' keys, the standard library it adds, and what is left to design; read before designing the native runtime or the standard library around it, or after proposal 8 to see where its runtime-side mechanisms went
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-10
last_updated: 2026-11-10
tags: [proposal, runtime, native, persistence, host]
---

# Proposal: native runtime

A sketch, not a specification: it records the shape agreed so far, and leaves its details to later work. It builds on proposal 8, whose language semantics it doesn't change: `live` and `ista` code, the call rule between them, and `delegate`. How running work moves between releases is proposal 10's.

Compiled to a native binary, a program is its own host. The developer writes everything in Istalang: the live `main` sets up the infrastructure, serves HTTP and the like, and opens the runtimes that run persistent work. Nothing has to be written in C++ or JavaScript, and the developer brings only a key-value store.

## Layers

| Layer | Written in | Provides |
| --- | --- | --- |
| OS primitives | the standard library, implemented by the native runtime | sockets, files, clock, event loop; the only externs left, `live`, or unmarked where pure |
| App infrastructure | Istalang, live | `main`, HTTP, database drivers, the key-value store |
| Runtime | `Runtime` values, opened in `main` | run persistent work in this process, one per store |
| Workflows | Istalang, ista | `ista` functions, running in contexts |

## The store

The developer provides a key-value store, and nothing else:

```python
trait Kv:
    live async fn get(self: Self, key: String) -> Bytes?
    live async fn put(self: Self, key: String, value: Bytes)    # atomic for one key
    live async fn delete(self: Self, key: String)
```

- **Commits by copy-on-write.** A commit writes the changed objects under new keys, then `put`s one root key that points at them: that one put is the commit. Keys nothing reaches any more are deleted afterwards.
- **No indexes.** Contexts, executions, slots, timers, jobs and context constants all live in the state under the root key, so the store needs no find-or-create, no index and no lease. Timers are scheduled again when the runtime loads the state.
- **One process per store,** for now.
- **The standard library ships stores,** such as `store/sqlite`, and `store/memory` for tests. A store's code is live code, which the call rule keeps from calling ista code.
- **`Bytes`** joins the prelude: an immutable byte string, which the OS layer needs too.

## Runtimes

- **`Runtime.open(kv)`,** a `live async fn`, loads the store's root, resumes the persistent work in it and gives a `Runtime`. A `Runtime` is a live, disposable value: disposing it stops its work, which resumes at the next open.
- **A runtime is a value, named by its variable.** There is no default. A process opens several to run concurrent versions (proposal 10).
- **Ista code holds no `Runtime`,** since no live value reaches ista code (proposal 8, Rule 7). It reaches the runtime running it through the `runtime` module's `ista` functions.

## Contexts

A context is an instance (§9), named by its key. Its memory, executions, panics, retries, termination, operator view and re-run state (proposal 8, Rule 7) are the instance's.

- **`rt.call(key) f(args)`** in live code, and **`runtime.call(key) f(args)`** in ista code, run `f` in the context named `key`, creating it if it doesn't exist. Both are proposal 8's deferred form with arguments, `g(args) f(x)`:
  - `f` is an `ista` function, and its call is captured as a `sendable ista async fn() -> R`, so its arguments are copied into the context. Live code holds that function and never calls it (proposal 8, Rule 4).
  - The context is written with the first invocation that commits. From ista code, the invocation starts when the calling segment commits (proposal 8, Rule 7).
- **Each gives a `Call<R, K>`,** an awaitable whose kind settles to its caller's (proposal 8, Rule 3):
  - awaiting it gives `Result<R>`: `f`'s result, or an `Err` when `f` panics (code `panic`) or its context is deleted;
  - `call.accepted()` resolves once the invocation is persisted;
  - `call.key()` gives its context's key.

  In live code a `Call` is an in-memory listener on persistent work. An ista one is sendable, so it can be passed to another context.
- **An invocation belongs to its context, not its caller.** Releasing a `Call` without awaiting it doesn't cancel the invocation.
- **Every call starts a new invocation.** Nothing joins or caches calls. Running something once is the program's job, with a context constant as a flag, or with `once`.
- **`spawn f(args)`** is `runtime.call(key) f(args)` with a key made from its caller's context and a count of its spawns, as §9 names spawned instances. `Call` replaces `Instance<T>`, and `runtime.isolate(f)` is `await spawn f()`.
- **A context ends** on `rt.delete(key)` or `runtime.delete(key)`, which disposes everything it holds (§7). The `Call`s waiting on it then give an `Err`.

## Context constants

```python
ista const verdicts = Inbox.create<Verdict>()
```

- **A top-level `ista const` holds one value per context.** The value is made the first time code in that context reads it, inside the reading segment, and is kept in the context's memory.
- **It is named as every declaration is,** by its module and name. It therefore has one type, and proposal 10 moves it between releases by name.
- **It holds any type:** a slot, an inbox, an `rpc` method, a bus, a `Shared<T>`. It is immutable as every `const` is, up to its handles (§3.4).
- **Reading one is an `ista` call** (proposal 8, Rule 2). A function that reads one is `ista`, so no live code reaches one.
- **Handlers are how anything enters a running context.** Temporal's three message kinds are all plain handlers:
  - **signal:** a handler that sends into a context constant;
  - **query:** a handler that reads one;
  - **update:** a handler that calls an `rpc` method the running workflow serves.

## Example

```python
# workflow.ista
import Inbox from 'inbox'
import * as rpc from 'rpc'
import * as runtime from 'runtime'
import * as time from 'time'
import once from 'functions'
import * as payments from 'payments'           # app code: live async fns over an HTTP client
import * as email from 'email'

struct Order { id: String, customer: String, amount: Int }
struct Verdict { role: String, ok: Bool }
type Outcome = "approved" | "rejected" | "expired"

ista const verdicts = Inbox.create<Verdict>()
ista const outcome = new Shared<Outcome?>{value: none}
ista const amendments = rpc.create<Int, Int>()
ista const spent = new Shared{value: 0}           # only customer contexts read it
ista const purchaseOnce = once(purchase)          # the program's choice: one purchase per context

ista async fn purchase(order: Order) -> Result<Outcome>:
    const amount = new Shared{value: order.amount}
    hold _ = amendments.onMessage(fn(a): { amount->value = a; a })   # answers amend() while it runs
    const result: Outcome = await select:
        case verdicts.receive() as v:
            if v.ok: "approved" else: "rejected"
        case time.delay(5d):
            "expired"
    outcome->value = result
    if result == "approved":
        const receipt = (await runtime.call(`customer/${order.customer}`) charge(order.id, amount->value))?
        spawn notify(order.customer, `Order ${order.id} approved: ${receipt}`)   # not awaited
    Ok(result)

ista async fn charge(orderId: String, amount: Int) -> String:
    const receipt = await delegate payments.charge(orderId, amount)   # a job, run after the commit
    spent->value = spent->value + amount
    receipt

ista async fn notify(customer: String, text: String):
    await delegate email.send(customer, text)

# handlers
ista async fn place(order: Order) -> Result<Outcome>: await purchaseOnce(order)   # a retry starts nothing
ista fn approve(v: Verdict): verdicts.send(v)                                      # signal
ista fn status() -> Outcome?: outcome->value                                       # query
ista async fn amend(amount: Int) -> Result<Int>: await amendments.call(amount)     # update
```

```python
# main.ista
import * as http from 'http'
import * as futures from 'futures'
import Runtime from 'runtime'
import SqliteKv from 'store/sqlite'
import Order, Verdict, place, approve, status, amend from 'workflow'

live async fn main():
    const rt = await Runtime.open(await SqliteKv.open("orders.db"))   # resumes its persistent work
    const server = await http.listen(8080)
    const tasks = futures.group()
    while true:
        tasks.run handle(rt, await server.accept())                   # each request a task

live async fn handle(rt: Runtime, conn: http.Conn) -> Result<Unit>:
    const req = await http.read(conn)
    const key = `order/${req.param("id")}`
    match req.route:
        case "POST /orders/:id":                                      # answer once persisted
            await (rt.call(key) place(req.json<Order>()?)).accepted()
            await conn.respond(202)
        case "POST /orders/:id/verdicts":
            (await rt.call(key) approve(req.json<Verdict>()?))?
            await conn.respond(204)
        case "GET /orders/:id":
            await conn.respond(200, (await rt.call(key) status())?)
        case "PUT /orders/:id/amount":
            await conn.respond(200, (await rt.call(key) amend(req.json<Int>()?))?)
        case "DELETE /orders/:id":
            await rt.delete(key)
            await conn.respond(204)
        case _:
            await conn.respond(404)
    Ok(())
```

A task group, rather than `hold(main)` in the loop, lets go of each handler when it finishes; `hold(main)` would keep every one until `main` ends.

## Who waits on persistent work

Live code waits on a context only while a request waits for its answer. Anything that must happen when persistent work ends happens inside it, or in what it calls. A live `Call` is only a listener, and losing it on a restart loses nothing.

## Jobs

`delegate` is proposal 8's (Rule 8): queued at the commit, run as live code, run again under a stable key until its result commits. The runtime's loop runs jobs, and **`runtime.jobKey()`**, a `live fn`, gives the key of the job running it, or `none` outside one. The work it calls passes that key on to deduplicate, such as an idempotency key to a payment API.

## What the standard library gains

- **prelude:** `Bytes`. `Instance<T>` goes, replaced by `Call`.
- **`runtime`:**
  - `Runtime`, with `Runtime.open`, `call` and `delete`;
  - the `ista` functions `call` and `delete`, which act on the runtime running the code;
  - `Call<R, K>`;
  - `jobKey()`.
- **`futures`:** `group()`, a disposable holding each task it runs until the task settles. Disposing it disposes the tasks still running. Like every function of `futures`, it is generic over the kind (proposal 8, Rule 6).
- **`functions`:** `once(f)`, an unmarked combinator. It calls `f` the first time, and gives that first call's result every later time.
- **`store/sqlite`, `store/memory`:** `Kv` implementations.

Today's JavaScript host becomes one more implementation of the OS layer and of stores, such as a file store, written in JavaScript.

## Spec changes

- **§3.4:** context constants, `ista const`.
- **§3.8:** the standard library above.
- **§9:**
  - Instances are contexts.
  - `spawn` gives a `Call`, and `runtime.isolate(f)` is `await spawn f()`.
  - A host starts live code only (proposal 8), and persistent work runs in the runtimes the program opens.
- **§10:** `testing` inspects a context by its key, as `call.key()` gives it, instead of an `Instance`.

## Left for later

- Several processes sharing one store: a compare-and-swap on the root key, and which process runs which context.
- The store's object format and collection.
- How long an idle context is kept before it ends without a `delete`.
- Scheduling: fairness between contexts, and loading and unloading them.
- Whether jobs are visible to programs.
