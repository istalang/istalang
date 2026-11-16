---
description: contracts between ir-first phases — golden format, coverage map, typed-IR gate, what L and R1 each own; read before building R0, L or R1
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
- **Coverage map:** every test that imports code R1 deletes maps to a golden, a scenario, an
  `.ista` test, a rewrite in R1, or "internal, dropped". It also names the property that replaces
  `differential.sweep` (generated programs).
- **Baselines:** `form-builder.bench.ts` on today's compiled code, and a new `Int` loop bench
  against hand-written bigint.

## Typed-IR gate (R1)

- Every register is typed; every type entry states `disposable` and `heap`.
- No punned instruction: cells, references and tuple, struct and variant fields are apart.
- One entry builder; entry kinds a typed table; no ambient lowering state; nothing stored that
  is derived (`counted`).
- Snapshot round trip across builds: the second build emits the same Definition's functions in a
  shuffled order into a fresh module.

## L and R1

- **L owns** the checker features and every std module's Istalang and natives, except the runtime
  services below. It leaves behavior unchanged on the old pipeline.
- **R1 owns** the runtime services in Istalang (futures, resolvers, waits, `select`, slots, timers,
  watches, weak references, the mock registry), the native contract, and the natives L leaves,
  ported after L merges.
