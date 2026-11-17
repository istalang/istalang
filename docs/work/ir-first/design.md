---
description: the target architecture of the IR-first rewrite — every program, ista code included, lowered to one typed IR with lifetimes explicit, compiled (JS now, LLVM later) and run by one run, runtime services written in Istalang, derived JSON codecs synthesized by lowering behind one seam, the interpreter replaced by golden outputs; decisions, invariants, verification; read before planning, building or reviewing any ir-first phase, or touching lowering, the IR, the run or codegen
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-16
last_updated: 2026-11-17
tags: [design, rewrite, definition, lowering, runtime, codegen, llvm, lifetimes, natives]
---

# IR first — design

**What it is:** a greenfield rewrite of everything after the checker. Lowering decides everything,
and a compiler backend only executes primitives:
- every program, ista code included, becomes one typed IR;
- JavaScript is the one backend now, and LLVM later compiles the same IR;
- one run drives compiled code: persistence, contexts, instances, jobs and tests included;
- runtime services are Istalang; derived JSON codecs are IR that lowering synthesizes.

The interpreter is replaced by golden outputs captured from it, then deleted. Nothing has users,
so nothing stays compatible. Where new code differs throughout, it is written new, not migrated.

Evidence: `research/` (`interpreter-only.md`, `lowering-audit.md`, `runtime-audit.md`,
`natives-boundary.md`, `lifetimes-inventory.md`). Those audits describe the code being replaced:
read them for the rules it encodes and the mistakes not to repeat.

## Why

The research found the same rules coded in two runs, and runtime policies that belong in
lowering. It found interpreter-only features that exist only because compiled code keeps frames in
generators. And it found an untyped IR with punned instructions, which no LLVM backend could
target. Migrating that shape costs more than writing the right one.

## What stays

- The checker and everything before it, the editor and the formatter.
- The spec, amended below.
- The corpus, spec examples and std `.test.ista` suites.

## Target shape

| Layer | Holds | Written |
|---|---|---|
| Lowering | Every decision: holds and let-gos, in place, copies at crossings, start wrappers, mock checks, collect points, stop landings, derived JSON codecs (one module) | TS, once |
| IR (the Definition) | Typed registers; reach facts on every type; explicit cells and references; tuple, struct and variant fields apart; flavors as variants; lifetime instructions; spill sets per suspension | the contract |
| Std in Istalang | Futures, resolvers, waits, slots, timer grouping, `disposed()`/`disposing()` watches, settle order, the mock registry, about 95 former natives | Istalang |
| Run | One: ready queue, park and unpark of executions, segments and commits, snapshots (root walk, object ids), contexts, instances, jobs, effects (clock, random draws, logs), counts and the collector, one host binding | TS for JS; ported once for LLVM |
| Codegen | One ES module per program. Simple entries are plain functions; async entries are resumable functions over frame records. Primitive operations are inline JS | TS |
| Natives | About 85 primitives (Int, Float, String, Array, Map, JSON text, effects, regex/crypto/tz libraries) taking and giving primitives | per backend |

## Decisions

1. **Golden outputs, not an interpreter.**
   - **Captured before anything changes:** the current interpreter's results over the corpus, spec
     examples, std suites, host scenarios and FormBuilder views.
   - **What a result is:** outcome or panic (message and innermost frame), logs, host calls and
     visible disposal effects, observed independently of the snapshot's shape.
   - **One home each:** an outcome a corpus header (`# outcome:`/`# panic:`) or a `.test.ista`
     assertion already states stays there; goldens hold only what nothing states yet.
   - **Changing one:** a golden changes only in a commit whose change it shows, a named spec amendment or a named fix of spec-stated behaviour, with every moved line explained by it.
2. **One run.**
   - **Object model:** `src/live`'s, with object ids from the instance's serial. A commit finds
     what to persist by walking from the roots.
   - **A live run** is a run that never commits.
3. **Frames are data.** A frame record `(function, pc, registers)` is the snapshot's own shape.
   - **Async entries:** each is a resumable function. It reloads the record, runs
     `switch (frame.pc)`, and at a wait it spills its registers and returns
     (`research/interpreter-only.md` §3, shape C).
   - **Spilling:** registers are spilled by register layout, following IR emptiness.
   - **Proposal 10's named schema** can replace that layout later as an IR fact, with codegen
     unchanged.
   - **Simple calls use the host stack,** so recursion depth is limited (the spec's floor). The IR
     states calls only, never a calling convention. Each backend has one predicate choosing which
     functions run on frame records (async entries today), and one unit turning the host's stack
     overflow into the recursion panic. Moving recursive cycles, or every function, onto frame
     records changes that predicate alone, in JS or LLVM.
4. **Typed IR.**
   - **Registers:** typed, with one register per pass in field loops.
   - **Types:** every type entry states `disposable` (the checker's `reachesDisposable`) and `heap`.
   - **Cells and references:** explicit instructions.
   - **Fields:** tuple, struct and variant fields are separate instructions.
5. **Lifetimes are instructions.**
   - **Holds and let-gos:** parameters are borrowed and a last use is a move, so most pairs never
     appear.
   - **Calls:** each await carries its stop landing; a native holds what it keeps itself, so externs carry no lifetime facts.
   - **In place:** "in place if unique" for write paths and the six collection changes, with
     derived-data forgets inside.
   - **Verification:** an ownership verifier in IR validation.
   - **What each backend tracks:**
     - JS tracks values reaching a disposable, plus arrays and maps for uniqueness;
     - LLVM reference-counts every heap value, with a periodic cycle collector that frees memory
       only. The checker forbids cycles through anything reaching a disposable.
6. **Services in Istalang** run over these primitives:
   - park and unpark an execution, enqueue a closure call, timer-at;
   - a host-future token, the current execution;
   - weak references and cells;
   - stopping a suspended call, and the `disposing()` priority resume.

   For now the run also keeps in TS settle order, timer grouping, the `disposed()`/`disposing()`
   and end watches, and resolver pruning. Moving them to Istalang waits on measuring what it
   costs (tracker Q59), after the merge.

   Object ids come from the instance's serial from the first slice on. Heap kinds: cell, resource, weakRef, execution, contextConstant.
7. **Protocols are lowered:**
   - a start wrapper awaits the root and encodes its outcome;
   - `copy` at spawn and context calls;
   - a `mocked` instruction, in test builds only, asks the run's `mockOf`;
   - collect points.
8. **Natives speak primitives.**
   - **Results:** built in Istalang wrappers.
   - **Capabilities:** the natives table's type refuses a table needing one the run lacks, at compile time; the IR declares none, since natives are per backend.
   - **Primitive operations** (`Int` `+`, comparisons, …) compile to inline JS, so they run as fast
     as hand-written JS over the same representation.
9. **Derived JSON codecs are synthesized IR.** Writing them in Istalang needs tuple loops,
   per-pass variant and tuple construction, literal enumeration, an extern-type constraint and a §9
   change: more language than the code it deletes. Lowering emits each type's codec as ordinary IR
   from one module, whose only inputs are the checker's codec requirements and whose only output is
   IR functions, so a later language-features plan replaces that module alone.
10. **One host binding** `{natives, externs, clock, seed, store}` serves `ista run`, `ista test`,
   `ista build` and embedding hosts alike.

## Spec amendments

- **Recursion:** the depth limit is implementation-defined, with one panic text. Its floor is
  what compiled code reaches on Node and browsers with large frames and no depth counter, measured
  before the amendment.
- **`select` losers:** resolvers still cancel at the decision, so a value reaching a losing take's
  slot right after the winner's stays there; only the losers' holdings are let go when the winner
  resumes, which lowering emits at each case's target.

## Invariants

- The Definition is the deployed unit.
- Frames are data.
- A segment re-run computes the same.
- What lost its last holder is disposed at its release point.
- A snapshot compiled code commits is one any later build of the same Definition resumes.

## Verification

- **Golden runner** over the new pipeline, reporting per corpus folder.
- **Ownership verifier.**
- **fast-check aliasing:** no shared value observably changes.
- **Snapshot round trip:** suspend, commit, restore, compare; also across two builds of one
  Definition.
- **Perf gates,** each relative within one bench run:
  - FormBuilder per change no slower than today's compiled code (recorded in R0);
  - an `Int` loop within 2× of the same loop hand-written over bigint;
  - string operations written in Istalang linear in the string's length.
- **Decimal:** `decimal.js` stays only as a dev-time fast-check oracle.
- **Browser:** the run bundles with no Node built-in but `buffer` and `util`, which avsc (the Definition encoding) needs; a browser build polyfills them.

## Out of scope (filed)

- The LLVM backend itself. `native-binary.md` gains reference counts, the cycle collector and this
  frame shape.
- Per-type equality and hashing (LLVM).
- Proposal 10's named frame schema.
- The run itself in Istalang (proposal 9's far end).
