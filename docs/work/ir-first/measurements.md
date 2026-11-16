---
description: what R0 measured before the IR-first rewrite — the JS stack depth behind the spec's recursion floor, and the FormBuilder and Int-loop baselines the perf gates compare with; read before changing the recursion rule or judging a perf gate
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-16
last_updated: 2026-11-16
tags: [measurements, perf, recursion, ir-first]
---

# IR first — measurements (R0)

Apple M2 Max, Node 24.9.0, Chrome 157; load average about 5.

## Recursion depth on JS stacks

Plain JS functions of the shape compiled code takes (inline bigint ops, no depth counter), warmed
up, default stack, deepest call before a `RangeError`:

| Bigint locals live across the call | Node | Chrome |
|---|---|---|
| 0 | 10,302 | 12,274 |
| 4 | 7,726 | |
| 8 | 6,181 | |
| 16 | 4,415 | |
| 32 | 2,809 | |
| 64 | 1,626 | |

Before warm-up, small frames reach 9,216 in Node. A floor of 10,000 would need a depth counter or
heap frames on every call, so the spec's floor is 1,000 nested calls: met with margin by frames
holding up to about a hundred values.

## Perf baselines

Today's compiled code, `npm run bench`:

| Bench | Mean | p75 | Min |
|---|---|---|---|
| `form-builder.bench.ts`, a supplier form change, compiled | 1.77 ms | 1.13 ms | 0.85 ms |
| the same, on the interpreter | 22.2 ms | 23.0 ms | 19.5 ms |
| `int-loop.bench.ts`, 100,000 iterations, compiled | 13.6 ms | 13.8 ms | 13.0 ms |
| the same loop by hand over bigint | 2.49 ms | 2.60 ms | 0.65 ms |

The `Int` loop runs 5.5× its hand-written time today; the gate is 2×. FormBuilder's gate is no slower
than the compiled row.
