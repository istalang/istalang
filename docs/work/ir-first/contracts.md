---
description: contracts between ir-first phases — golden format and manifest, coverage map, typed-IR gate, owners of shared files; read before building R0, forking any ir-first phase, or editing a file another phase owns
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-16
last_updated: 2026-11-16
tags: [plan, rewrite, goldens, contracts]
---

# IR first — contracts between phases

## Goldens (R0)

- **One home per result.** A corpus header (`# outcome:`/`# panic:`) or a `.test.ista` assertion
  stays the home of what it states. A golden holds only what nothing states yet: logs, host calls,
  disposal effects, the panic's innermost frame. Goldens are keyed to the existing files.
- **Host scenarios are data:** deploy, wake, retry, terminate and inspect steps, with their
  observations. Observations never read the snapshot's shape.
- **Fixed inputs:** the clock and the random seed are part of each golden.
- **The schema** is a doc R0 writes beside the runner.
- **Amended goldens:** those a spec amendment changes are written by hand to the amended spec,
  marked expected red on the old pipeline.
- **Manifest:** every golden is assigned to exactly one phase. The runner reads the set of landed
  phases (each phase adds itself on merge) and fails on any red golden of a landed phase.
- **Coverage map:** every test that imports code S1a deletes maps to a golden, a scenario, an
  `.ista` test, a rewrite in its owner's phase, or "internal, dropped". It also names the property
  that replaces `differential.sweep` (generated programs).
- **Round trip across builds:** the second build emits the same Definition's functions in a
  shuffled order into a fresh module.
- **Baselines:** `form-builder.bench.ts` on today's compiled code, and a new `Int` loop bench
  against hand-written bigint.

## Typed-IR gate (S1a, S1b)

- Every register is typed; every type entry states `disposable` and `heap`.
- No punned instruction: cells, references and tuple, struct and variant fields are apart.
- One entry builder; entry kinds a typed table; no ambient lowering state; nothing stored that
  is derived (`counted`).

## Natives during the rewrite

S1a deletes every native its goldens don't need. Natives are bound per extern a program reaches,
so an unbound extern fails only the programs using it; those goldens belong to the phase owning it
below, which writes it new on the native contract
(the old one stays readable at `ir-first-base`).

## Owners of shared surface

| Surface | Owner | Others |
|---|---|---|
| Definition schema, extern entry schema, native contract | S1a | amend through the tech-lead |
| Starting a program (one start API) | S1a | S2 extends it with the host binding |
| Array and Map primitive natives (`length`, `index`, `size`, `get`, …) | S1b | |
| The six `&` collection changes | S3 | |
| `prelude.ista`: futures, resolvers, waits, timers, watches | S2 | |
| `prelude.ista`: `WeakRef.from`, `deref` | S3 | |
| Ista-only externs: slots, `disposed()`, `WeakMap`, `Revertible`, `Inbox` | S5a | |
| `copy` lowering | S5b | S5c stubs it until S5b lands |
| Host API: deploy, wake, inspect | S5a | S7 exports it |
| Host API: retry, terminate | S5c | S7 exports it |
| Every std module and native not above; `std-modules.ts` | S4 | S2 adds run primitives as externs |
