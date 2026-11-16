---
description: the target architecture of the IR-first refactor — every program, ista code included, lowered to one typed IR with lifetimes explicit, run alike by every executor (interpreter, compiled JS, LLVM later) under one run, with runtime services written once in Istalang; decisions, invariants, verification and what the human still decides; read before planning, building or reviewing any ir-first phase, or changing lowering, the Definition, a runtime or a backend
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-16
last_updated: 2026-11-16
tags: [design, refactor, definition, lowering, runtime, codegen, llvm, lifetimes, natives]
---

# IR first — design

**What it is:** a greenfield rework where lowering decides everything and backends only execute.
Every program, ista code included, becomes one typed IR. One run drives every executor, and the
runtime's services are Istalang compiled per backend. A rule lives once: an interpreter-only
feature, or a rule coded per runtime, is a defect this design removes.

Evidence (read before a phase): `research/interpreter-only.md`, `research/lowering-audit.md`,
`research/runtime-audit.md`, `research/natives-boundary.md`, `research/lifetimes-inventory.md`.

## Why

- **Two runs:** the interpreter's (`runtime/scheduler`, 6.2k LOC) and compiled JS's (`src/live`).
  They code at least 12 non-lifetime rules twice, and lifetimes twice more. They also diverge on
  `select` losers, in place, counted registers and recursion depth.
- **Interpreter-only features:** ista code, commits, snapshots, contexts, instances, jobs, mocks and
  `ista test`. No instruction is interpreter-only. The split is two refusals in `codegen/emit.ts`
  plus generators that can't be snapshotted.
- **Policies inside runtimes** (about 1.4k LOC): holder counting, in place, copies at crossings,
  start outcomes, mock dispatch and collect points.
- **Untyped IR:** a register's meaning depends on a side list and on what it holds at run time.
  `field` means three things. Reach is stated twice, and partially. An LLVM backend can't be
  written against it.

## Target shape

| Layer | Holds | Written |
|---|---|---|
| Lowering | Every decision: holds and let-gos, in place, copies at crossings, start wrappers, mock checks, collect points, stop landings | TS, once |
| Definition | Typed registers, reach facts on every type, explicit cells and references, frames as data, lifetime instructions | the contract |
| Services | Futures, resolvers, waits, slots, timer grouping, `disposed()`/`disposing()` watches, settle order, the mock registry, about 95 std natives | Istalang (std), compiled per backend |
| Run | One: ready queue, park and unpark of executions, segments and commits, the snapshot codec (root walk, object ids), contexts, instances, effects (clock, random draws, logs), counts and the collector, one host binding | TS once for JS executors; ported once for native |
| Executors | Interpreter: the instruction table over frame records. JS: generated functions, async entries as resumable functions over frame records. LLVM later: the same shape | per backend, primitives only |
| Natives | About 85 primitives (Int, Float, String, Array, Map, JSON text, waits, effects, regex/crypto/tz libraries) that take and give primitives | per backend |

## Decisions

1. **One run, executors beneath it.**
   - The run takes `src/live`'s object model (JS objects, lazy reconciling), plus object ids from
     the instance's serial. It drops the id-indexed heap: a commit finds what to persist by walking
     from the roots.
   - A live run is a run that never commits.
2. **Frames are data.** A frame record `(function, pc, registers)` is the snapshot's own shape.
   - A compiled async entry is a resumable function: it reloads the record, runs
     `switch (frame.pc)`, and at a wait it spills its registers and returns
     (`research/interpreter-only.md` §3, shape C).
   - Simple entries stay plain functions on the host stack.
   - Spill sets follow IR emptiness, never liveness, so every executor spills alike.
3. **Typed IR.**
   - Registers are typed, with one register per pass in field loops.
   - Explicit cell and reference instructions.
   - `field` splits into tuple, struct and variant.
   - The Definition's flavors (main, tests, job server) become variants.
   - Every type entry states `disposable` (the checker's `reachesDisposable`) and `heap`.
   - `counted` and its write inference go.
4. **Lifetimes are instructions.**
   - Hold and let-go: parameters are borrowed and a last use is a move, so most pairs never
     appear.
   - Each await's stop landing.
   - `select` holdings released at decision, as wait data.
   - Each extern's keeps and holds (`@Keeps`, `@Holds`).
   - "In place if unique" for write paths and the six collection changes, with the forgetting of
     derived data (written JSON, summaries) inside it.
   - An ownership verifier in `definition/validation`.
   - Backends choose what to track by reach:
     - JS tracks values reaching a disposable, plus arrays and maps for uniqueness;
     - LLVM reference-counts every heap value, with a periodic cycle collector that frees memory
       only. The checker forbids cycles through anything reaching a disposable, so disposal never
       waits on it.
5. **Services in Istalang** over a small primitive set:
   - the primitives: park and unpark an execution, enqueue a closure call, timer-at, a host-future
     token, the current execution, weak references, cells;
   - heap kinds go from 13 to about 5: cell, resource, weakRef, execution, contextConstant.
6. **Protocols are lowered:**
   - a start wrapper awaits the root and encodes its outcome;
   - `copy` at spawn and context calls;
   - a `mocked` instruction in test builds only, asking the run's `mockOf`, with the registry in
     Istalang;
   - collect points.
7. **Natives speak primitives.**
   - Results are built in `.ista` wrappers, never by name at run time.
   - About 95 natives become `.ista`, decimal first, which removes `decimal.js`.
   - Capabilities are declared per extern in the Definition and checked when a backend binds
     natives. `interpreterNativeKeys` and the capability stubs go.
8. **One host binding** `{natives, externs, clock, seed, store}`, taken by every executor's entry.

## Invariants every executor keeps

These are the invariants of `docs/work/linker/README.md`, now enforced across executors:
- the Definition is the deployed unit;
- frames are data;
- a segment re-run computes the same;
- what lost its last holder is disposed at its release point;
- a snapshot one executor commits is one any other resumes.

## Verification

- **Ownership verifier:** catches the lowering lifetime bugs that every executor would share.
- **Differential runner over every executor:**
  - the whole corpus, ista code, the std `.test.ista` suites and `crashEveryAwait`;
  - a snapshot committed by one executor resumed on another.
- **Corpus expected outputs and spec examples:** hold lowering to the spec.
- **Perf gates:** FormBuilder per change (`codegen/form-builder.bench.ts`), the wake bench
  (`scheduler/wake.bench.ts`).

## Open: the human decides

1. **The interpreter's fate,** once it is a thin executor (about 1k LOC). Keep it: it runs a
   Definition as data where code can't be generated at run time (Workers forbid eval, so a deploy
   would otherwise be a new bundle), and it is a second executor for differential tests. Or delete
   it.
2. **Recursion depth:** the interpreter allows 200,000 frames, compiled JS stops at the JS stack.
   One spec rule, such as an implementation-defined depth of at least 10,000 with one panic text.
3. **Select-loser release:** releasing at the winner's resume would delete slot serving's pause
   machinery (spec §8 says at decision).
4. **Derived JSON codecs in Istalang:** field loops would expose field annotations, and enums would
   get a variant loop (§3.16). That deletes 427 LOC of synthesized codecs.
5. **Frame layout:** frames persisted by register layout now, with proposal 10's named schema
   later. Both are IR facts, so executors don't change.
6. **Natives moved to `.ista`** run slower on the interpreter: per-instruction dispatch where a
   native was one call. Compiled executors compile them.

## Out of scope (filed)

- The LLVM backend itself. `native-binary.md` gains reference counts, the cycle collector and this
  frame shape.
- Per-type equality and hashing (LLVM).
- Proposal 10's named frame schema.
- The run itself written in Istalang (proposal 9's far end).
