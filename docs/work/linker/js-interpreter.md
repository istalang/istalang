---
description: today's executor, the TypeScript interpreter, as one backend among several — what it costs per instruction and per commit, which use cases it is enough for, and how to host it on Cloudflare Durable Objects; read before hosting the runtime somewhere new or judging whether a faster executor is needed
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-05
last_updated: 2026-11-05
tags: [runtime, executors, interpreter, durable-objects, cloudflare]
---

# JS interpreter

The runtime as it is: `runtime/host.ts` deploys a Definition, and `scheduler/wake.ts` advances an instance segment by segment. Within a segment, `scheduler/segment/` runs the top frame's instruction through the instruction table (`interpreter/instructions.ts`, one handler per kind, 28 kinds) and collects what it let go of before the next one.

## What it costs

- **Every operator is a call.** `a + b` on `Int` is a `call` instruction to the `prelude.add(Int, Int)` extern. Every call goes through the function table after the mock the instance reaches (`scheduler/segment/calls.ts`), then a `bigint` operation.
- **One dispatch per instruction,** then a collection check (`segment/index.ts` `#step`, `#collected`).
- **Loading:** deploying validates the whole Definition text, and waking reads the snapshot and its Definition and checks one against the other (`host.ts`).
- **Committing:** each commit encodes the whole snapshot as canonical JSON (zod, lossless-json) and writes it (`wake.ts` `commit`).

## What it is enough for

Anything whose segments do little CPU work between commits, where store latency dominates:
- Workflow engines.
- Agents waiting on models and humans.
- API glue and host integrations.
- Durable sessions and actors.

## Where it runs

- **Dependencies:** pure JavaScript except `node:crypto`, used by `random.ts`, `definition/formats/codec.ts` (content hashes) and `stdlib/crypto/natives.ts`. Libraries: zod, lossless-json, decimal.js, re2js, temporal-polyfill, lru-cache.
- **No compiler needed at run time.** A host deploys the Definition's text.
- **Seams:** `InstanceStore`, `Natives`, `now` and `seed` are the host's to give (architecture.md, Seams), and the store is synchronous.

So it should run on any JavaScript host that gives `node:crypto`: Node today, and untried, Bun, Deno and Cloudflare Workers under `nodejs_compat`.

## Hosting on Cloudflare Durable Objects

A Durable Object (DO) is a single-threaded actor with its own transactional storage and an alarm. Its storage is durable, but its execution isn't: in-memory state and any `await` in progress are lost on eviction, restart or deploy. Istalang makes the execution durable too, and its seams map onto a DO almost one to one:

| Istalang | Durable Object |
| --- | --- |
| `InstanceStore`, synchronous: Definitions by hash, each instance's last snapshot by name, the extern signatures | The DO's SQLite storage, synchronous inside the object |
| A waiting `InstanceState` names its earliest due timer; the host wakes the instance then | `setAlarm` for that time; the alarm handler calls `wake` |
| A host fills a future by its token (`fill`) | A fetch, WebSocket or RPC handler calls `fill` |
| Host externs, JSON in and out (docs/arch/boundary.md) | Worker bindings and `fetch` |
| `now`, `seed` | `Date.now()`, crypto random |

**Over a plain DO it gives:**
- `await` that survives eviction, restart and deploy: wait days, wait for a webhook, loop on a mailbox with `select`.
- Deterministic replay of a crashed segment from its last commit.
- Instances pinned to their Definition's hash, so a deploy never swaps code under a running instance.
- Many timers on one alarm, set to the earliest due time.
- Crash safety testable with `crashEveryAwait`, and `inspect`, `retry` and `terminate` for operators.

**Design decisions:**
- **Which instances share a DO.** `spawn` writes child instances into the same store, and `result()` reads another instance's last commit from it (`scheduler/instance-ends.ts`). Reading another DO is asynchronous, which the synchronous store can't be. So give each DO a whole instance tree, a parent and everything it spawns, or route waits between trees through messages to the host.
- **The driver.** It is a loop like `runtime/settle.ts`, waiting the DO's way: an alarm for the earliest due time, and handlers that `fill`.

**Limits:**
- Whole-snapshot commits make large state costly at every `await`; delta snapshots would fix it (README, Shared prerequisites).
- Workers cap CPU time per invocation, so a long computation commits inside its loop (`runtime.commit()`, §19.2).
- temporal-polyfill makes the bundle noticeably larger.

## Changes to our code

- **New:** a DO host adapter, an `InstanceStore` over `ctx.storage.sql` plus the alarm and fill driver. It mirrors `cli/directory-store.ts` and `runtime/settle.ts`.
- **Existing:** none for a single instance tree per DO. Waits across DOs would need the store's reads of other instances (`instance-ends.ts`) to go through the host.
