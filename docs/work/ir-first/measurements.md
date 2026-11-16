---
description: what R0 measured before the IR-first rewrite (the JS stack depth behind the spec's recursion floor, the FormBuilder and Int-loop baselines) and R1's numbers against those perf gates; read before changing the recursion rule or judging a perf gate
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-16
last_updated: 2026-11-16
tags: [measurements, perf, recursion, ir-first]
---

# IR first — measurements

R0 measured on an Apple M2 Max, Node 24.9.0, Chrome 157, at a load average of about 5.

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

## R1's perf gates

R1's build against R0's, the benches of `npm run bench` run in turn in one session: R1's from the
branch, R0's from 259b21c5, the commit that recorded them. Apple M2 Max, Node 24.9.0. Two rounds at a
load average of 5 to 7, as R0's; three more at 16 to 60, other agents running, which agree within
10% on mean and p75. Ranges are across the quiet rounds.

| Bench | Mean | p75 | Min | p99 |
|---|---|---|---|---|
| `form-builder.bench.ts`, a supplier form change, R1 | 1.73–1.95 ms | 1.24–1.54 ms | 1.13–1.16 ms | 12–13 ms |
| the same, R0 | 1.75–1.86 ms | 1.11–1.14 ms | 0.88–0.89 ms | 20–24 ms |
| `int-loop.bench.ts`, 100,000 iterations, R1 | 1.80–1.81 ms | 1.80–1.81 ms | 1.65–1.66 ms | |
| the same loop by hand over bigint | 2.52–2.61 ms | 2.61–2.71 ms | 0.64–0.65 ms | |
| the same, R0 | 13.6–13.7 ms | 13.7–13.8 ms | 13.1–13.2 ms | |

R0's rows repeat what R0 recorded, so the two sessions compare.

- **`Int` loop:** 0.7× its hand-written time on the mean, R0's measure (R0: 5.5×), within the 2×
  gate. On mins it is 2.5×: the hand-written loop's mean sits far above its min in every run, R0's
  included, and each compiled iteration of the bench is a whole start.
- **FormBuilder:** on the mean, on par with R0 and its tail faster (p99 about 45% lower), but a
  typical change slower: p75 10–35%, min about 30%. A CPU profile of 3,000 changes spends its self
  time on lifetimes (`share` 10%, `hold` 6%, `letGo` 3%), `Run.call` (8%) and garbage collection
  (11%).
