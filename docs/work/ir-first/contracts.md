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
- **Manifest:** every golden is assigned to exactly one phase. The runner reports per phase and
  fails on any red golden of a phase at or before the current one.
- **Coverage map:** every test file the old pipeline's deletion removes maps to a golden, a
  scenario, an `.ista` test, or "internal, dropped". It also names the property that replaces
  `differential.sweep` (generated programs).
- **Baselines:** `form-builder.bench.ts` on today's compiled code, and a new `Int` loop bench
  against hand-written bigint.

## Typed-IR gate (S1a, S1b)

- Every register is typed; every type entry states `disposable` and `heap`.
- No punned instruction: cells, references and tuple, struct and variant fields are apart.
- One entry builder; entry kinds a typed table; no ambient lowering state; nothing stored that
  is derived (`counted`).

## Owners of shared surface

| Surface | Owner | Others |
|---|---|---|
| Definition schema, extern entry schema, native contract | S1a | amend through the tech-lead |
| `prelude.ista`: futures, resolvers, waits, timers, watches | S2 | |
| `prelude.ista`: weak references | S3 | |
| `prelude.ista`: slots | S5a | |
| Every other std module and native; `std-modules.ts` | S4 | S2 adds run primitives as externs |
