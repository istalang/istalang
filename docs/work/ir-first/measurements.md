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

R1's build against R0's, each bench run in turn in one session: R1's from the branch, R0's from
259b21c5, the commit that recorded R0's numbers, each built fresh first, since `npm run bench` times
`dist/` and doesn't build it. Apple M2 Max, Node 24.9.0.

**FormBuilder**, a supplier form change, compiled, at `d0613bf3` (two of the rounds at `0d1d8f28`,
whose run is the same): five interleaved rounds at a load average of 7.5 to 9, about 18 over 15
minutes, other agents running. Ranges are across rounds:

| Build | Mean | p75 | Min | p99 |
|---|---|---|---|---|
| R1 | 1.09–1.24 ms | 0.79–0.92 ms | 0.71–0.75 ms | 7.8–9.1 ms |
| R0 | 1.66–1.80 ms | 1.06–1.12 ms | 0.86–0.90 ms | 19–26 ms |

R1 is faster than R0 on every measure: mean −30%, p75 −20%, min −17%, p99 −60%. Both draw the same
view per change, 8,047 bytes of JSON. Earlier rounds recorded R1 slower on p75 and min (1.24–1.54 and
1.13–1.16 ms), probably against a stale `dist/`.

**`Int` loop**, 100,000 iterations, at `e1baebe5`: two rounds at a load average of 5 to 7, and three at
16 to 60 that agree within 10%:

| Bench | Mean | p75 | Min |
|---|---|---|---|
| R1 | 1.80–1.81 ms | 1.80–1.81 ms | 1.65–1.66 ms |
| the same loop by hand over bigint | 2.52–2.61 ms | 2.61–2.71 ms | 0.64–0.65 ms |
| R0 | 13.6–13.7 ms | 13.7–13.8 ms | 13.1–13.2 ms |

0.7× its hand-written time on the mean, R0's measure (R0: 5.5×), within the 2× gate. On mins it is
2.5×: the hand-written loop's mean sits far above its min in every run, R0's included, and each
compiled iteration of the bench is a whole start.
