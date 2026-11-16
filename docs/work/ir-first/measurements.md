---
description: what R0 measured before the IR-first rewrite (the JS stack depth behind the spec's recursion floor, the FormBuilder and Int-loop baselines) and R1's numbers against those perf gates; read before changing the recursion rule or judging a perf gate
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-16
last_updated: 2026-11-17
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

**FormBuilder**, a supplier form change, compiled: eight interleaved rounds, five at a load average
of 7.5 to 9 (at `0d1d8f28` and `d0613bf3`, whose runs are the same) and three at 10.6 to 15.6 at
`18081621`, which checks the call rule at every async start; other agents running. Ranges are
across rounds:

| Build | Mean | p75 | Min | p99 |
|---|---|---|---|---|
| R1 | 1.08–1.31 ms | 0.79–0.96 ms | 0.71–0.75 ms | 6.5–10.4 ms |
| R0 | 1.66–1.80 ms | 1.06–1.15 ms | 0.85–0.90 ms | 19–26 ms |

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

## Definition size and deploy (B116)

R1 instantiated about 25 await functions per awaited type (the futures and resolvers are generic
Istalang), and a deploy validated and re-encoded each Definition three times. Fixed by a resolver's
state moving into a `_Resolution<K>` that takes no value, so per awaited type only what passes a
value on is compiled (about 10 functions), and by validation running once, as a text is read, a
deploy keying the text it was given. Measured from the sources under Node's type stripping, Node
24.9.0, the median of 6 rounds after 2 warm-ups at a load average of 20 to 40; `deploy` is
`createRuntime(...).deploy(text)`, `write` is `definitionFormat.write`, compile includes checking.

| Program | Build | Functions | Definition | Compile | Write | Deploy |
|---|---|---|---|---|---|---|
| minimal `runtime.run(id) _main()` | before (`ac95388a`) | 161 | 491 KB | 79 ms | 29 ms | 52 ms |
| | after | 119 | 296 KB | 73 ms | 15 ms | 18 ms |
| delegate test's `purchase` | before | 616 | 1,925 KB | 200 ms | 101 ms | 188 ms |
| | after | 444 | 1,171 KB | 139 ms | 49 ms | 64 ms |

R0 compiled the minimal program to 25 functions, its futures being native. `npx vitest run --project
quick`: 140 s before, 125 s after, both at a load average near 38, each with checker tests timing out
under that load. What remains per awaited type: `onAwait` and its callback, `_caseResolver` and its
`decide`, `resolve`, `_decides`, `dispose`, and the three future natives' entries. Sharing those
across types needs instances keyed by their parameters' lifetime classes (shape stenciling), left
out as more machinery than it saves.

