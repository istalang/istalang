---
description: phase plan and process for the JS backend (design.md) — read before forking, building or reviewing any js-codegen phase
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-15
last_updated: 2026-11-16
tags: [plan, codegen, javascript, lifetimes]
---

# JS codegen — plan

Design: `design.md`.

## Process

Sequential phases on one branch: P2 counts the objects P1 builds, and P3 changes the writes P2
counts. Each gets qa and reviewer. P2's reviewer reviews the whole feature (`main..HEAD`), which
makes it the merge review; the feature merges then. P3 follows on its own branch, its reviewer seeing
its whole diff. Lifetimes then move into the IR (`docs/work/ir-lifetimes/`), so every backend runs
them and none decides them.

| Phase | Scope | Acceptance |
|---|---|---|
| P1 backend (done) | `src/codegen` emitter; `src/live` (values, calls, futures, waits, resolvers, `select`, slots, timers, resources, random, logs, natives' context, traces, host API); `ista build`; `istalang/live` export; layer entries; differential runner. Nothing counted, nothing disposed. | Runner green on every live corpus program and spec example whose behavior doesn't depend on disposal, each exclusion named with its reason. FormBuilder views byte-identical, ≤ 1.5 ms per change. `src/live` imports no `node:` module and no interpreter internals (dependency-cruiser). |
| P2 lifetimes (done) | `counted` in lowering (format +1); counts in emitted code and runtime objects; collector; disposal kinds and declared `dispose`; stopping suspended calls; weak refs and `disposed()`; `select` losers. | Runner green on the whole live corpus and every spec example: P1's exclusions are gone. `counted` covers every register whose type reaches a disposable (property test). FormBuilder ≤ 2 ms per change. |
| P3 in place | Tracker P51 first. Then ownership at run time on the interpreter's in place: a node a write made changes in place until it is read out of its cell; only big arrays and maps, only in holders that can't reach a counted object. | Building n items by `push`, into a `let` or through a handle (`x->items.push`), is linear (time ratio n=10⁵ / 10⁴ < 15). Runner green. fast-check aliasing properties: no shared value ever observably changes. FormBuilder ≤ 2 ms per change. |

## Checked in P1 (the interpreter is the reference)

- An `await` on a settled wait never yields, and microtasks keep the interpreter's wake order.
- Every write of a place goes through the one path write or `changes` (P3's no-rework condition).
