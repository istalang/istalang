---
description: quality audit (2026-11-16) of src/runtime, src/live and src/codegen against clean-dev, for the greenfield rework where every backend executes the same Definition IR — structure, roots and churn, violations by family (lifetimes excluded, see lifetimes-inventory.md), each unit classed as primitive / policy-for-lowering / Istalang service / duplicate with LOC, and the ranked refactors with their Mikado prerequisites; read before planning or reviewing any runtime, codegen or backend refactor
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-16
last_updated: 2026-11-16
tags: [runtime, live, codegen, audit, ir-first, clean-dev, refactor, mikado]
---

# Runtime audit for an IR-first rework (read-only research)

Abbreviations: **I** = interpreter (`src/runtime`), **C** = compiled JavaScript (`src/live` + `src/codegen`).
Lifetime duplicates (counts, holdings, disposal per kind, weak side, in place, select-loser timing, run-end
teardown) are inventoried as D1–D15 in `lifetimes-inventory.md` and only referenced here.
LOC = production lines (no `*.test.ts`, `*.test-kit.ts`, `*.bench.ts`); tests in these folders: 10,867.

## 1. Map

| Folder | LOC | Contents |
|---|---|---|
| runtime/scheduler | 6,122 | instance/ 2,743 (heap, waits 591, futures, slots, weak side, ready, crossing, effects), segment/ 2,020 (driver loop, run stack, calls, returns, natives' context, root outcome, collection, disposal runs), top 1,092 (wake, resident, inspect, live run, waiting, live resolvers, run contexts), testing/ 267 (mocks, test world) |
| runtime/lifetimes | 1,272 | counts, collector (shared with C); holder-writes, in-place, disposal, holders (I only) |
| runtime/snapshot | 1,220 | persisted instance format (objects, snapshot, holdings, random), check/ 545 |
| runtime/host | 934 | `createRuntime` API, programs, contexts 374, instance group/calls, stored instances |
| runtime/interpreter | 924 | instruction table, frames, machine, registers, suspension, trace |
| runtime/testing | 703 | `ista test` runner, test world (a runtime of its own) |
| runtime/boundary + top | 427 + 711 | host externs as natives, starts, outbound JSON, extern signatures; natives seam, clock, store, refusal, instance-state, random-draws, settle-order |
| live | 2,700 | run, executions (generators), ready, timers, arrivals, natives-context, waits/ 446, lifetimes/ 770, values/ 206, traces, program |
| codegen | 744 | emit, code-entry, entry-scope, instructions/ (one emitter table per family), literal |

**Roots (fan-in from production importers).** `runtime/natives.ts` 61 (32 outside these folders: stdlib, cli);
`snapshot/objects.ts` 27; `scheduler/instance/heap.ts` 27; `snapshot/snapshot.ts` 20; `interpreter/frames.ts` 18;
`instance-state.ts` 18; `scheduler/instance/index.ts` 15 (fan-out 27); `live/values/cell.ts` 12; `live/waits/future.ts` 12.
**Backend-neutral core C imports from I** (allow-list `live-imports-interpreter` in `.dependency-cruiser.mjs`):
natives, clock, refusal, instance-state, random-draws, settle-order, lifetimes/counts, lifetimes/collector, boundary/ —
≈1,570 LOC living inside the interpreter's folder.
**Leaves:** codegen/instructions/*, live/values/*, scheduler/segment/* (fan-in ≤5).

**Churn since 2026-09-01** (213 commits on these folders, +42.8k/−15.6k; 41 `refactor(runtime)`, 26 `fix(runtime)`):
natives.ts 49, scheduler/instance/index.ts 46, scheduler/segment/index.ts 44, snapshot/objects.ts 40, wake.ts 38,
interpreter/instructions.ts 37, lifetimes/disposal.ts 29. Two high-fan-in roots are also top churners (natives.ts,
snapshot/objects.ts): **fragile roots** — every new runtime service edits the natives capability interfaces and the
heap-object union. C: 17 commits, run.ts 9, waits/waits.ts 7; messages such as "a ready queue keeps the interpreter's
order", "a late case loses at the stop" show twin-chasing; 15 "as the interpreter('s)" mirror-by-comment notes in live/ and codegen/.

**Run / instance / segment / execution today**
- *Instance* (I): heap + executions, made from a snapshot, committed at every driver `await` (wake.ts, resident.ts).
- *Segment* (I): code between commits; `segment/index.ts` drives the next ready execution on a run stack, collecting after every step.
- *Live run* (I): live code on an `Instance` made from its `unstarted` snapshot, segments without commits
  (scheduler/live-run.ts, waiting.ts, live-resolvers.ts, run-contexts.ts, instance/disposal-notices.ts); it reports a
  live end as an instance `Advanced` with `spawned: []` always.
- *Run* (C): live/run.ts, no heap ids, no segments; async bodies are JS generators (live/executions.ts).
- *Execution*: I heap object with frames as data; C `Execution<At>` around a generator.
- **Name punning:** "run" = live run (both), the `run` heap kind (a readied callback), `RunStack`, `RunCalls`, two
  unrelated `RunEnd` types (live/run.ts, segment/segment-ends.ts). "live" = the persistence kind (spec), the in-memory
  form of heap objects (`LiveExecution`, `LiveObjectOf`, instance/live-objects.ts), and the `src/live` library.

## 2. Violations by family (lifetimes excluded)

### 2.1 Duplication: one rule, two TS homes (I ↔ C)

| Rule | I | C | LOC I / C | Fix direction |
|---|---|---|---|---|
| Waits and language resolvers (proposal 8 Rule 5): `resolver`/`callback`/`at`/`onCancel`/`register`/`resolve`/`tryResolve`, `#take` → `#decide` → `#ready`, `cancelLosers`/`keeps`/`end`/`lose`/`cancelPositions` | scheduler/instance/waits/ (index, endings, resolvers, settle-order) | live/waits/ (waits, wait, resolver, future) | 591 / 446 | one implementation, ideally prelude Istalang (§4 R3); method-for-method twins today, differing only in storage (heap records vs objects) |
| Live future a host resolves (`NativeResolver` state machine; same panic text "A host's onCancel threw") | scheduler/live-resolvers.ts `LiveResolver` | live/natives-context.ts `resolvable` | 122 / ≈53 | one TS module in the shared core |
| Timers: due instants grouped, earliest first, resolved together | instance/futures.ts `nextTimer`, `resolveDueTimers` | live/timers.ts + run.ts `#resolveDue` | ≈30 / ≈60 | one timer service over a clock primitive |
| Context constants (§3.4): "read while it is being made" panic, released last, newest first | instance/context-constants.ts | live/run.ts `contextConstant`, `makeContextConstant`, `#letGoOfTheRest` | 59 / ≈20 | one store over a primitive |
| Event-loop policy of a live run: one arrival per turn, clock waited only when idle, earliest timer | scheduler/live-run.ts (`idled`, `woken`, `nextTurn`), waiting.ts | live/arrivals.ts | ≈120 / 98 | one driver over an executor seam |
| Root outcome: await a pending root future, run the start's encoder before the root lets go, then release the rest | segment/root-outcome.ts, Instance `releaseRoot`/`awaitOutcome` | live/run.ts `start`, `#finishedOnceReturned` (comment: "The interpreter encodes before the root's frame lets go") | 261 / ≈45 | lowered start wrapper (§4 R4) |
| Native context assembly: name, result type, type args, types, instance, version, now, traces; extern constants pinned; random draw counter | segment/native-calls.ts, instance/segment-effects.ts `pinned`/`draw` | live/natives-context.ts `externContext`, `boundExtern` | ≈120 / ≈90 | one context builder over a backend's capability seam |
| Ready order (§6): waiters and readied callbacks, one at a time | instance/ready.ts | live/ready.ts | 102 / 59 | mechanism per backend is legitimate; the order rule should live once (it is restated in both banners) |
| Transient lookup (§3.4) | instance/transients.ts (nearest frame of the same function, then execution's kept cells) | live/running.ts (scope chain per execution) | 78 / 37 | one rule; two different algorithms for one spec sentence |
| Instance hosting: resident instances + `advance` + `InstanceGroup` + store | host/index.ts `residents`, host/contexts.ts `Contexts` | testing/world/index.ts `World` (+ drive.ts) | 232+374 / 391+74 | one instance host with a store seam; the world is that host plus the test-world seam |

### 2.2 Double standards (two shapes or mechanisms for one concept)
- **Host API for starting live code:** `DeployedProgram.start(run, request) → Promise<Advanced>` with outcome read later
  through `outcome(finished)` (host/programs.ts) vs `LiveProgram.start(start) → Promise<LiveEnded>` with JSON, text and
  logs (live/program.ts). Fix: one `LiveProgram` contract in the shared core, implemented per backend.
- **Two live-run engines:** I runs live code through instance machinery (heap ids, snapshots-in-memory, `dropUnheld`
  walks, `#keptByWalk` amortization in instance/index.ts); C runs it with none. Fix: one executor model (§4 R5).
- **Two test oracles:** `HeapCheck` (scheduler/loaded-definition.ts; walks the heap after steps and around natives,
  plumbed into production `RuntimeSeams.heapCheck`) checks I only; `EmitOptions.checksCounted` (`lt.uncounted` asserts)
  checks C only. Fix: the planned IR lifetime check in `definition/validation` plus the differential runner; drop both.
- **Interpreter-only natives refused twice:** codegen/emit.ts `interpreterOnly` refuses any Definition naming
  `stdlib/natives.ts` `interpreterNativeKeys`, yet live/natives-context.ts still builds panicking stubs for slots,
  instances, contexts, testing (unreachable after the refusal; forced by the fat `NativeCapabilities` type, §2.3).
- **Storage of wait edges:** I derives reverse edges from one side (heap-indexes.ts: "keys derived from the object
  alone"; `heap.find('positions', id)`); C stores both sides (`Resolver.on` and `Waits.#registered`, `target.wait` and
  `Waits.#cases`, `Resolver.positions`) and splices both by hand (`#keepOnly`). See 2.5.

### 2.3 Responsibility (SRP, ISP, deep modules)
- **`Instance` god object** (scheduler/instance/index.ts, 417 LOC, fan-out 27): composition root and public bag of
  nine mutable services (`heap`, `waits`, `futures`, `slots`, `weak`, `notices`, `holders`, `frameHeap`, `effects`)
  plus mocks, root/outcome, answers, runs, context constants, commit pruning. Callers reach through it (13 reaches in
  segment/native-calls.ts, 9 in wake.ts, 8 in segment/index.ts). Blast radius: every scheduler module. Fix: shrinks by
  itself once waits/futures/slots move out (R3); keep a narrow facade per consumer.
- **Fat natives seam** (runtime/natives.ts): `FullNativeContext` = context + 11 capabilities for every native, though
  natives already type their needs (`Natives<NativeContext & WithWaits>` in stdlib/prelude/wait-natives.ts). Most
  capabilities (futures, waits, slots, weak, instances, testing) are runtime services, not host edges, which is why
  this root churns most. Fix: services leave the seam (R3); what stays is host edges (resources, random, logs,
  encodings, host futures, clock).
- **Waits know slots:** I `Waits` seams `awaited`/`givenUp`/`losersReleased` exist for slots.ts and
  holder-writes.ts (`noteLosersReleased`). A slot concern inside the resolver engine.
- **Test concerns in production paths:** `HeapCheck` wraps every extern call (`NativeCalls.#checked`) and every step
  (segment/collection.ts); `TestWorld` is consulted on every call (`reachedMock`, segment/calls.ts), every
  `encodings` choice (`keepingNone` when mocking).

### 2.4 Dependencies and cohesion
- The backend-neutral core (≈1,570 LOC, §1) lives in the interpreter's folder; C reaches it through a path allow-list.
  Snapshot format, holdings and check (1,220 LOC) — a persisted contract like the Definition — also sit under the
  interpreter. Fix: one shared-core folder for seams, shared primitives and the snapshot contract (R1).
- H modules welded to interpreter internals (import `scheduler/instance` or `segment`): wake.ts, segment/answering.ts,
  segment/native-contexts.ts, live-run.ts, live-resolvers.ts, resident.ts, host/contexts.ts, testing/world/index.ts,
  lifetimes/holders.ts (≈1,750 LOC). No executor seam exists between "host/persistence" and "execution".

### 2.5 Module shape, stored derived data, symptom patches
- **Stored and synced edges:** live/waits/waits.ts `#registered`, `#cases` mirror `Resolver.on`, `Resolver.target`
  (clean-dev: single source of truth). Disappears with R3.
- **Slot serving pauses for select losers** (instance/slots.ts banner; holder-writes.ts `noteLosersReleased`,
  `losersUncollected`): a patch compensating for releasing losers at decision while zeros are confirmed only at the
  step's end. Fix: losers' holdings as IR data released by the wait primitive (ir-lifetimes L2a) and slot serving in
  the same collector round; or the spec simplification in §5.
- **Copies to protect in place:** instance/crossing.ts ("Every value crossing is rebuilt") and root-outcome.ts
  `copied` exist because of I's run-time in-place policy (D13/D14). Fix: explicit `copy` IR at spawn/context calls.
- **Generators block persistence of C:** live/executions.ts ("each call's body is a generator the run drives") and
  codegen/entry-scope.ts (registers are JS locals `r<n>`) make compiled frames non-serializable, which is why ista
  code is "interpreter only" (codegen/emit.ts refuses `mode === 'ista'`).

### 2.6 Waste
- knip: clean (no unused exports). Dead-by-construction: C's interpreter-only capability stubs (≈25 LOC, §2.2).
- `live/values/helpers.ts` `keep` copies the list per call (O(n²), D-list in inventory).
- `disposal-notices.ts` (29) exists only because live code runs through `Instance` on I.

### 2.7 Behavioral divergence between backends
- **Recursion limit:** I `maximumFrames = 200_000` (segment/limits.ts, corpus `run/recursion.ista` runs 100,000 deep);
  C panics at the JS stack (live/run.ts banner). Same IR, different outcome.
- `crashEveryAwait`, retry, terminate, mocks, `ista test`, contexts, spawn: I only.
- Select-loser release timing, in place, counted registers: see inventory D2, D13, §2 "select".

## 3. Classification of every runtime unit

(a) executes an IR primitive or is backend mechanics — keep, one copy per backend; (a-host) host and persistence
shell — keep once, backend-agnostic, today welded to I; (b) a policy or decision that belongs in lowering/IR; (c) a
service that can be written once in Istalang; (d) a twin of another unit or dead. Primary class per file; residues noted.

| Class | LOC | runtime | live | codegen |
|---|---|---|---|---|
| (a) primitive / mechanics | 6,225 | 4,247 | 1,234 | 744 |
| (a-host) host + persistence shell | 5,607 | 5,508 | 99 | 0 |
| (b) policy → lowering/IR | 1,386 | 1,114 | 272 | 0 |
| (c) service → Istalang | 1,444 | 1,444 | 0 | 0 |
| (d) duplicate | 1,095 | 0 | 1,095 | 0 |
| total | 15,757 | | | |

- **(a):** interpreter/* (924); scheduler/segment/{index, run-stack, calls, returns, run-calls, disposal-runs,
  native-calls, limits, segment-ends}; scheduler/instance/{index, heap, heap-indexes, live-objects, ready,
  transients, context-constants, weak-side}; scheduler/loaded-definition.ts; lifetimes/{counts, collector};
  random-draws.ts; live/{run, executions, ready, running, natives-context, program-tables, traces, values/*};
  codegen/* (744). Residues: (b) in interpreter/registers.ts (holder reports, in place), interpreter/suspension.ts
  (`releaseLosers`), segment/calls.ts (mock dispatch), codegen/entry-scope.ts (counted swap, hand-over),
  codegen/code-entry.ts (collect points, `finally` release list), codegen/instructions/suspension.ts (losers at
  resume), live/run.ts (root outcome, teardown ≈45); (d) in live/natives-context.ts (`resolvable`, stubs ≈80) and
  live/run.ts (context constants, timer glue ≈30). heap-indexes.ts shrinks to nothing once (c) leaves.
- **(a-host):** host/* (934), boundary/* (427), snapshot/* (1,220), testing/* (703), scheduler/{wake, resident,
  inspect, live-run, waiting, live-resolvers, run-contexts, testing/test-world}, scheduler/segment/{answering,
  native-contexts}, scheduler/instance/{segment-effects, instance-ends, instance-names, disposal-notices},
  lifetimes/holders.ts, natives.ts, clock, store, refusal, instance-state, live/program.ts (second API shape).
- **(b):** segment/root-outcome.ts 261 (start wrapper: await + encode), instance/crossing.ts 90 (`copy` at
  crossings), testing/mocks.ts 186 (call dispatch lowered in test Definitions; registry and call log → ista),
  segment/collection.ts 127 (collect points), lifetimes/{holder-writes 129, in-place 321}, live/lifetimes/lifetimes.ts
  272 (run-time reach walk, reconcile).
- **(c):** scheduler/instance/waits/* 591, instance/futures.ts 290 (futures, answers following futures, timers,
  watches), instance/slots.ts 213, settle-order.ts 70, lifetimes/disposal.ts 280 (per-kind disposal: mostly futures,
  waits, resolvers, slots, mocks). Precedent: prelude-level services already in Istalang over these primitives —
  stdlib/futures (`futures.first` over `Resolver.at`), inbox, fanout, rpc (365 LOC of .ista).
- **(d):** live/waits/* 446, live/timers.ts 53, live/arrivals.ts 98, live/lifetimes/{disposal 136, holdings 124,
  run-lifetimes 112, weak-side 126} (inventory D7–D12, D15).

What the primitive set reduces to once (b) and (c) leave: frames (call, return, jump, suspend at `await`/`select`,
resume), cells/resources/weak references with identity, counts + collector rounds (ir-lifetimes), a ready queue,
park/unpark of an execution, timer-at and host-future tokens, context-constant and transient slots, random draws,
natives. Heap kinds drop from 13 (snapshot/objects.ts `heapObject`) to about 5 (cell, resource, weakRef, execution,
contextConstant): slot, future, wait, resolver become shared structs; run, answer, outcome, mock become lowered or ista.

## 4. Big refactors, ranked, with Mikado prerequisites

Goal node: every backend executes the same IR; the interpreter has no feature of its own; the host/persistence shell
drives any backend. Leaves first; each arrow is "needs".

1. **R1 Shared core folder** (structural, low risk, unblocks all). Move seams (natives, clock, store, refusal,
   instance-state), shared primitives (counts, collector, settle-order, random-draws), boundary/ and the snapshot
   contract (objects, snapshot, holdings, check, random) out of the interpreter's folder; delete the
   `live-imports-interpreter` allow-list. Prereq: none. Moves ≈2.8k LOC, deletes none.
2. **R2 Lifetimes in the IR** (designed: docs/work/ir-lifetimes/design.md, plan L1→L4→L2a→L2b→L3). Deletes the (b)
   lifetime policies (holder-writes, in-place, live reach walk ≈720) and the D7–D15 twins (≈500). Prereqs: L1 typed
   registers. R3 needs L2a/L2b.
3. **R3 Runtime objects in Istalang:** `Future`, `Resolver`, waits, `Slot` (today `extern shared struct` in
   stdlib/prelude/prelude.ista), timers' grouping, `disposed()`/`disposing()` watches, mock registry. Deletes (c) 1,444
   + (d) waits/timers 499 + snapshot/check/waits.ts 226 + heap-indexes 73 + most holdings tables (snapshot/holdings,
   live/lifetimes/holdings) and native capabilities `futures`, `waits`, `slots` — ≈2.5k LOC. Prereqs (Mikado leaves):
   (i) R2 L2a/L2b, so fields of these structs get lowered holds and let-gos instead of runtime holdings tables;
   (ii) IR primitives for park/unpark of an execution, ready-enqueue of a closure call, timer-at, host-future token,
   current execution — replacing today's `wait`/`resolver`/`await`/`select` runtime semantics; (iii) select losers as
   wait data released at decision (L2a); (iv) stop-a-suspended-call and `disposing()` priority resume as primitives
   (inventory §1); (v) the settle order expressed in ista; (vi) perf gates (scheduler/wake.bench.ts,
   codegen/form-builder.bench.ts).
4. **R4 Protocols into lowering:** start wrapper (await root, encode, give both) replacing root-outcome.ts and the
   `outcome` heap kind and C's `#root`; explicit `copy` at spawn and context calls replacing crossing.ts; mock dispatch
   lowered for test Definitions (calls to mockable targets through an ista registry) replacing `reachedMock` on every
   call path; collect points and stop landings (R2). Deletes ≈650 LOC of (b). Prereqs: R1; R2 for stop landings; R3
   for mocks-as-ista.
5. **R5 Executor seam + persistence on every backend:** one contract (start a call, run to its next suspension,
   resume with a decision, frames as data out and in) that wake/resident/live-run/contexts/test world drive; codegen
   emits resumable frames (registers in a frame record, the existing `for (;;) switch (pc)`) instead of generators so
   compiled code commits and restores; one event-loop driver (merges live-run.ts/waiting.ts with arrivals.ts); one
   `LiveProgram` API. Removes the "ista code / contexts / instances / tests run on the interpreter only" rule
   (codegen/emit.ts `interpreterOnly`, stdlib `interpreterKeys`). Prereqs: R1, R3 (few heap kinds to persist), R4,
   L1 typed registers (also the LLVM prerequisite, docs/work/linker/native-binary.md); a perf decision on frames-as-data.
6. **R6 One instance host:** host/index `residents`, host/contexts `Contexts`, testing/world `World` → one host core
   with a store seam (sync for tests), one drive loop (world/drive.ts, contexts' loop, live-run's). Prereq: none; cheaper
   after R5, which defines what it drives. Deletes ≈300 LOC.
7. **R7 Names:** one meaning each for "live", "run", `RunEnd`, `LiveExecution`; fold into R5's contract names.

Order: R1 → R2 (L1, L4 in parallel) → R4 (start wrapper, copy) → R2 (L2a, L2b) → R3 → R5 → R6/R7. R6 may start any time.

## 5. Spec questions to surface (each would delete code)
- **Recursion limit:** fix it in the spec (or make it implementation-defined) so backends stop diverging (§2.7).
- **Select-loser release timing** (§8 "as the winner is decided, before anything else runs"): releasing at the
  winner's resume, as C does, would delete slot serving's pause and `noteLosersReleased`/`losersUncollected`.
- **Live end shape:** a live run's end is reported as an instance `Advanced` with `spawned: []`; a distinct live
  outcome type in the host contract removes the pun.
