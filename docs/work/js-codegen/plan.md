---
description: phase plan and process for the JS backend (design.md) — read before forking, building or reviewing any js-codegen phase
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-15
last_updated: 2026-11-15
tags: [plan, codegen, javascript, lifetimes]
---

# JS codegen — plan

Design: `design.md`.

## Process

Sequential phases on one branch: P2 counts the objects P1 builds, and P3 changes the writes P2
counts. Each gets qa and reviewer. P2's reviewer reviews the whole feature (`main..HEAD`), which
makes it the merge review; the feature merges then. P3 is not urgent: it follows whenever it is
picked up, on its own branch, its reviewer seeing its whole diff.

| Phase | Scope | Acceptance |
|---|---|---|
| P1 backend | `src/codegen` emitter; `src/live` (values, calls, futures, waits, resolvers, `select`, slots, timers, resources, random, logs, natives' context, traces, host API); `ista build`; `istalang/live` export; layer entries; differential runner. Nothing counted, nothing disposed. | Runner green on every live corpus program and spec example whose behavior doesn't depend on disposal, each exclusion named with its reason. FormBuilder views byte-identical, ≤ 1.5 ms per change. `src/live` imports no `node:` module and no interpreter internals (dependency-cruiser). |
| P2 lifetimes | `counted` in lowering (format +1); counts in emitted code and runtime objects; collector; disposal kinds and declared `dispose`; stopping suspended calls; weak refs and `disposed()`; `select` losers. | Runner green on the whole live corpus and every spec example: P1's exclusions are gone. `counted` holds exactly the registers whose type reaches a disposable (property test). FormBuilder ≤ 2 ms per change. |
| P3 in place (later, after tracker P51) | Sole-holder analysis in the emitter; in place inside the one path write and `changes`. | Building n items by `push`, into a `let` or through a handle (`x->items.push`), is linear (time ratio n=10⁵ / 10⁴ < 15). Runner green. fast-check aliasing properties: no shared value ever observably changes. |

## Checked in P1 (the interpreter is the reference)

- An `await` on a settled wait never yields, and microtasks keep the interpreter's wake order.
- Every write of a place goes through the one path write or `changes` (P3's no-rework condition).
