---
description: inventory (2026-11-16) of every feature only the TS interpreter runs (ista code, segments and commits, snapshots, contexts, instances, jobs, slots, mocks, ista test, crashEveryAwait, the host API), what each needs of an executor, what lowering could emit and which run-time primitive stays; the frame shape that lets compiled JS and LLVM snapshot and resume like the interpreter, with its measured cost; an IR-level design space for mocks; and the duplicated rules between the two TS runtimes — read before planning one run under several executors, ista code in compiled JS, or the LLVM backend
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-16
last_updated: 2026-11-16
tags: [research, interpreter, codegen, live, snapshot, segments, mocks, testing, contexts, executors, llvm]
---

# Interpreter-only features: to IR and shared primitives (read-only research)

Goal assumed: every backend (interpreter, compiled JS, LLVM) runs the same Definition IR, lowering
decides, and backends run primitives. LOC is `wc -l` of non-test sources. Lifetime duplicates are
in `lifetimes-inventory.md` (D1–D15) and are not repeated here.

## Findings in brief

- **No instruction is interpreter-only.** The codegen's emitter table is a complete
  `Handlers<EntryScope, Instruction, …>` (`codegen/code-entry.ts`). The split is drawn in only two
  places: `emitProgram` refuses an entry with `mode === 'ista'`, or an extern in
  `interpreterNativeKeys` (`codegen/emit.ts` `interpreterOnly`, `stdlib/natives.ts`).
- **The interpreter's features belong to its run, not its executor.** The instruction loop is
  `runtime/interpreter/` (924 LOC). Everything listed below sits in `runtime/scheduler` (6122),
  `host` (934), `snapshot` (1220) and `testing` (703), and needs nothing from how instructions
  execute beyond one thing: a suspended frame as data.
- **There are two runs today:** the interpreter's and `src/live` (2700 LOC, 770 of it
  lifetimes). They code at least 12 non-lifetime rules twice (§7). One run under N executors
  removes both the duplication and the interpreter-only features.
- **The blocker:** compiled async entries are JS generators whose registers are locals, so they
  can be neither saved nor restored. The fix is the shape `linker/native-binary.md` already
  prescribes for LLVM: a state machine over a frame record, with registers spilled at each
  suspension. Measured on FormBuilder, it changes 5 of 1,977 functions (§3).
- **Mocks** are a run-time interception on every call path, paid in production too. In test
  builds lowering can emit one check per mocked target instead (§6).

## 1. Where the split is drawn (evidence)

- **Interpreter-only natives,** from `stdModule(…, { everywhere, interpreter })` in
  `stdlib/std-module.ts`:
  - prelude `spawn`, `result`, `Slot.create`, `put`, `take`, `read` (`instance-natives.ts`,
    `slot-natives.ts`);
  - runtime `_isolated`, `hostStore`, `_Runtime.open`, `_call`, `_jobCall`, `_served`,
    `_jobServer` (`stdlib/runtime/natives.ts`);
  - all of testing: `_mock`, `_calls`, `spawnCrashingEveryAwait`, `idle`, `reaches`,
    `waitingAt`, `state`, `handle`.
  - Each native only delegates to `context.instances|contexts|slots|testing.*`. The logic is in
    the run.
- **Compiled JS fills 16 `NativeCapabilities` members with stubs that panic**
  (`live/natives-context.ts` `interpreterOnly`: slots ×4, instances ×2, contexts ×5, testing ×5).
- **Production paths:**
  - `ista run` runs the interpreter for live code as well (`cli/commands/run.ts` →
    `createRuntime` → `host/programs.ts` → `scheduler/live-run.ts` `runLive`).
  - Compiled JS has no runner in the toolchain: only `ista build` output and the `istalang/live`
    export (`live/program.ts`, 99 LOC; `start` only).

## 2. Inventory

| Feature | Evidence | What it needs of an executor | Lowering could emit | Primitive that stays |
|---|---|---|---|---|
| ista code | A code entry's `mode` is the only IR difference (`lowering/functions/modes.ts` `codeModeOf`). | A frame as data at each suspension (§3). | Nothing new: waits are already explicit (`await`, `select`, `wait`, `resolver`). | The run's segment rule: only the driver's `await` ends a segment (`scheduler/segment/index.ts` banner). |
| Segments and commits | `wake.ts` (361) `advance`/`commit`. `instance/segment-effects.ts` (129) buffers spawns, answers, logs, draws and pinned constants. `scheduler/resident.ts` rolls back by continuing from the last commit. | Run a frame until it returns, suspends or panics. | Nothing. | Effect buffer, the commit through `InstanceStore` (`runtime/store.ts`), rollback. All executor-neutral. |
| Snapshot and restore | `snapshot/objects.ts` frame `{function, pc, registers: [register, contents][], arrives?}`. `snapshot/check/index.ts`: the top frame stands at a wait, outer frames at a `call`. `objectsMade` serial ids. | Export a suspended frame. Resume a frame built from data. | Per suspension point, which registers hold something (derivable). Proposal 10 makes this a named frame schema. | Snapshot codec, object ids, handle ↔ object at the codec. |
| Determinism | `now()` is the segment start (`SegmentRunner #now`). Draws are counted from the commit (`segment-effects.ts`; HMAC shared in `random-draws.ts`). Extern constants pinned (`pinned`). Live reads the clock per call and counts draws in a closure (`live/natives-context.ts`). | None. | None. | Segment clock and draw counter: run-level. |
| Contexts and context constants | `host/contexts.ts` (374) `Contexts`, `scheduler/run-contexts.ts` (91), `segment/native-contexts.ts` (130), `instance/context-constants.ts` (59). Live already keeps them per run (`live/run.ts #contextConstants`). | None. | `ista const` is already instructions (`contextConstant`, `makeContextConstant`). | Invocation into a stored instance (`advance` with `invocation`), its token, answer delivery after the commit, constants persisted as root objects. |
| Jobs | Already Istalang: `stdlib/runtime/runtime.ista` `_serve`, `_serveInstance`, `ista const _jobs = new _Jobs{}`. Banner: "Jobs (§5) are Istalang over a context constant, with no state of the runtime's own." | None. | — | Only the context primitives above. Arbitration is still TS (§7.9). |
| Instances (`spawn`, `result`, `isolate`) | `spawn` → `instances.spawn`. `result` → a `watch` future read from the child's stored snapshot (`instance-ends.ts` `storedEnds`). `_isolated` = spawn + `terminatesOnPanic`. Children are written `unstarted` at the parent's commit (`wake.ts` `commitChildren`), named `<parent>/<n>`. Values cross via `instance/crossing.ts` (90). | None. | — | Writing the child, reading its end, crossing (rebuilding values between instances). |
| Slots | `prelude.ista`: `extern shared struct Slot<T>`, `extern ista fn put`/`take`/`read`/`dispose`. `scheduler/instance/slots.ts` (213). Slot branches in waits (`givenUp`) and disposal (D7/D8). | None. | — | Candidate for Istalang over `Resolver.of`, `onCancel` and a shared struct (§5). Unverified, spike. |
| Mocks | §6 | §6 | §6 | §6 |
| `ista test` | `runtime/testing/` (703), `cli/commands/test.ts` (143). A fresh `World`, `memoryStore` and `test` context per test. `idle`, `reaches` (the `await` instruction's `waypoint`), `waitingAt` and `state` read the last commit (`scheduler/inspect.ts`, `world/snapshot-reads.ts`). | None, once snapshots work. | Waypoints already are IR. | Test world over the store. Spec §10 "Built in versus library" already puts the rest in `testing.ista` (354). |
| crashEveryAwait | `wake.ts:172` `rerun`: runs the segment twice from the commit and compares `runText` (snapshot text, children, logs). | Restore and encode only. | — | Run-level (~25 LOC). |
| Host API | `host/index.ts` (232): `deploy`, `wake`, `programOf`, `inspect`, `retry`, `terminate`. All store and snapshot level. `retry`, `terminate` and `programOf` have callers only in tests. | None. | — | Unchanged, over the one run. |

Divergences that are not features but must close before compiled code commits:
- **Transients:** keyed `(entry, register)` in `live/running.ts` vs `(function, register)` in
  `instance/transients.ts`. The execution's `transients` are persisted, so the key must be one.
- **Recursion:** compiled simple calls nest on the JS stack (~10k) vs `segment/limits.ts`
  `requireFrameDepth`.
- **Traces:** compiled traces after an `await` show only frames since the resume (tracker F35).

## 3. Frames compiled code can snapshot

**Facts.**
- **F1. A suspended execution holds one frame in practice.**
  - `runsAsExecution` (`segment/calls.ts`) gives every `live`/`ista` entry an execution of its
    own.
  - Every `RunStack.pushFrame` caller pushes an entry that never waits: a simple callee or mock
    replacement (`segment/index.ts`), a `dispose` (`disposal-runs.ts`), an encoder
    (`root-outcome.ts`).
  - The format allows more (`frames: z.array(frame).min(1)`). Snapshot code reading `frames.at(-1)`
    stays correct either way.
- **F2. Today's compiled async entry** is `function* b<i>(fut, cl, r0…)` with
  `for (;;) switch (pc)` and `t = yield r<wait>` (`codegen/code-entry.ts`,
  `instructions/suspension.ts`). Registers are `let` locals. A stop is `body.return()`, whose
  `finally` releases the counted registers (`live/executions.ts`).
- **F3. Neither half of a snapshot works on it.** Saving fails: the locals can't be read from
  outside. Restoring fails: no generator can be created standing at pc *k* with given locals.
- **F4. `linker/native-binary.md`** already decides the LLVM side: "Each function becomes a state
  machine entered through `switch (frame.pc)`, its registers spilled to the frame at each
  suspension and held in SSA values between them."
- **F5. Proposal 10, decision 12:** "A committing `await` stands at statement level", and rule 4:
  "Frames are persisted by meaning, never by compiler layout".
  - Neither is implemented: no checker rule was found, and snapshot frames are keyed by register
    number.
  - At such an `await`, the frame holds named values, the pending future, loop iterators and
    holdings, never expression temporaries.

**Options.**

| Shape | Save | Restore | Cost to live code | Verdict |
|---|---|---|---|---|
| A. Generators as today | no | no | — | out |
| B. Generator, spill before each `yield`, entry reloads registers and jumps | yes | yes | spill per await | works, but keeps the generator and `return()` stop machinery |
| C. Resumable function over the frame record: reload, `switch (frame.pc)`, spill and `return` at a wait | yes | yes | spill per await; simple entries untouched | **recommended** |
| D. Registers as a frame array everywhere | yes | yes | an array access per register use in async bodies | out: taxes loops inside async bodies for nothing C doesn't give |
| E. LLVM coroutines (`llvm.coro.*`) | layout private to CoroSplit | needs that private layout | — | out: a snapshot must be the Definition's frame, which any executor resumes (`linker/README.md`) |
| F. Replay from the last commit | — | needs the frame it lacks | — | out |

Prior art decides only the shape. Kotlin keeps a `label` and spilled live locals in the
continuation; C# keeps `<>1__state` and hoisted locals. Both are C, with a layout private to the
compiler. Here the layout must be the IR's.

**Recommended shape (C), sketch.** Registers stay JS locals between suspensions. The frame record
is the snapshot's own shape, live:
```js
function b12(frame, decision) {            // frame = { function: 12, pc, registers }
  let [r0, r1, r2, r3] = frame.registers, pc = frame.pc, t;
  for (;;) switch (pc) {
    case 7:                                  // await r2 -> r3
      if (decision === undefined) { frame.pc = 7; frame.registers = [r0, r1, r2, r3]; return r2; }
      r2 = undefined; r3 = decision.value; decision = undefined; pc = 8; continue;
    // … one line per instruction, as today
  }
}
```

The run owns frames. This brings three things:
- **Restore** builds the record from the snapshot.
- **Stop** releases the record's registers, as the interpreter's `instance.stop` does. That
  removes the generator `finally` path (lifetimes D10).
- **The interpreter becomes the second executor** over the same record (`ActiveFrame` already is
  one: `interpreter/frames.ts`).

**Invariants every executor keeps:**
1. **Emptiness is the IR's.** A register the IR emptied (`release`, a decided `select`'s losers)
   is `undefined` in the spill. Today `scope.emptied` already does this.
   - So spilling every register gives the interpreter's frame byte for byte.
   - LLVM must spill by IR emptiness, not by SSA liveness.
2. **Handles.**
   - In memory, the interpreter's values hold `{kind: 'handle', object: id}`, while compiled
     values hold the object itself (`live/natives-context.ts` `objectOf`: `value instanceof kind`).
   - Every run object gets an id from the instance's serial when made (`objectsMade`), so ids and
     disposal rounds (newest first) agree across executors.
   - Only the codec swaps object ↔ handle.
3. **Cells and references** (`live/values/cell.ts`, `{cell, path}` parameters) are run objects
   with ids, as in item 2.
4. **The transient key is one** (§2 divergences).
5. **If proposal 10 lands,** the spill contract becomes its per-suspension-point schema, an IR
   fact. Executors stay unchanged: they spill what the IR lists.

**Cost.** `ista build examples/FormBuilder/supplier-demo.ista`, measured 2026-11-16:
- **What changes:**
  - The module is 47,492 lines: 1,972 simple functions, 5 async bodies (7 to 49 registers, median
    15) and 5 `await`/`select` sites.
  - Under C the simple functions are unchanged. Each resume does one destructure and one array
    write of at most 49 slots.
  - The bench measures 1.1 ms per change (`js-codegen/design.md`) against a cap of 1.5 ms (P1).
    The added cost is estimated to be well under 1 µs per change.
- **Ids** cost one increment per object made.
- **The commit walk and the segment clock** exist only in ista mode; live runs never commit.
- **Dropping generators** may make resume faster. This is not measured: confirm both with
  `src/codegen/form-builder.bench.ts` (`npm run bench`).

## 4. One run, executors beneath it

- **Executor contract.** It runs a code entry's frame record until it returns, suspends at a wait
  or panics. Async calls, natives, the other executor's code and collection go through the run.
  - The frame helpers in `interpreter/machine.ts` are its seed (`linker/README.md`, "Shared
    prerequisites" 1).
  - Interpreter: the instruction table over the record. JS: the generated functions of §3. LLVM:
    the same shape in machine code.
- **The run** holds, once:
  - the ready queue, waits, resolvers, futures, timers, slots (if they stay native) and object
    ids;
  - effects, segments and commits, the snapshot codec and determinism;
  - contexts, instances and the mock registry;
  - the host API.
- **Object model.** The run takes `src/live`'s model: JS objects and lazy reconciling, which is why
  FormBuilder runs at 1.1 ms. It adds ids. It doesn't need the interpreter's id-indexed heap
  (`instance/heap.ts`, `heap-indexes.ts`), because a commit already finds what to persist "in one
  walk" from the roots (`docs/arch/definition.md`, Holders). The heap indexes (`mocks`, `pending`,
  `timer`) become fields of the run.
- **Placement.** The run must bundle for a browser, as `src/live` does today (dependency-cruiser:
  no Node built-in). Node-only parts (the directory store, the CLI) stay at the edge.

## 5. What can be Istalang (proposal 9)

- **Already Istalang:** the job loop and job state, `Runtime.open` (`runtime.ista`), and the whole
  testing library beyond the built-ins (spec §10).
- **Candidates:**
  - **Slots,** over `Resolver.of`, `onCancel` and a shared struct. The queue is a list of
    resolvers, and a losing case's `givenUp` is a cancelled resolver. This would delete
    `instance/slots.ts`, the slot object and the slot branches in waits and disposal. Spike the
    rule that passes over `givenUp` futures while a resolver is pending.
  - **"Earliest open runtime serves"** (`Contexts.#serve`).
  - **The mock registry and its call records.** These need a function's identity as a value; today
    `namedFunction` reads the closure's `function` index.
- **Primitives that stay** per backend or native runtime: object ids and the root walk, store
  I/O, the segment boundary and commit, the snapshot codec, the clock and timers, the random HMAC,
  crossing, host tokens, and the executor itself.
- **The run itself in Istalang** is the far end of proposal 9. It needs frames exposed as values
  to Istalang code. Left for later.

## 6. Mocks

**Today.** One heap object, `mock {target, replacement, calls}` (`snapshot/objects.ts`).
- **Every call path asks `reachedMock`** through `startCall` (`segment/calls.ts`): a written
  call, a function value's, a disposal's, a resolver callback's and the encoder's.
- **Lookup order:** the instance's newest mock (`heap.find('mocks', target)`), else each ancestor
  `<parent>` via `world.mockOf`, which reads that holder's last commit.
- **A call leaving defaults out** runs the target's prologue as a `handsOver` frame, and hands over
  at the `body` instruction. That marker is the only thing lowering knows about mocks
  (`lowering/functions/frame-variables.ts`).
- **A replacement's result arrives** as from a host (`arrives`, `crossing.ts`). Another instance's
  mock is answered through an `answer` object (`segment/answering.ts`, `mocks.ts` `relayCall`).
- **Production pays for it:** no flag guards `reachedMock`, and `ancestorsOf` splits the name on
  every call. Compiled JS emits `body` as `''` (`codegen/instructions/control.ts`).

**Constraints an IR form must keep** (spec §10; `checker/rules/testing.ts`):
- only test modules import `testing`, so a production build can never hold a mock;
- a target is a named function, an extern included, a host type's `dispose` the runtime calls
  included;
- the mock replaces the body, not the defaults;
- the newest held mock wins, and releasing it restores the one before;
- it applies to spawned descendants, called "as a host's extern is called";
- "Starting an instance with a function value … isn't a call of it";
- calls are recorded.

**IR form (design space for the plan).**
- **Where the check goes.** In test builds only (`Definition.tests` present), lowering emits a
  `mocked` instruction where the `body` marker stands, in each target the checker recorded and in
  no other function.
  - The instruction asks the run's `mockOf(function)` primitive: own newest, else ancestors.
  - When a mock is held, it records the call and hands the frame over to the replacement with
    every parameter, its result arriving.
- **Extern targets** get a code entry around them, which lowering already writes for an extern
  with defaults and for a host extern.
- **Starts.** A start (host, `spawn(f)`, `isolate(f)`) must enter past the check. Starts already
  enter differently ("a start entry has no prologue", `definition.md`), but the plan picks the
  mechanism.
- **Gains:**
  - one check site instead of five call paths;
  - no `handsOver` frames;
  - zero cost in production;
  - mocks run alike on every backend: one instruction plus one run primitive.

## 7. Clean-dev violations passed

1. **Two runs code one rule twice.** Each item is location A | location B:
   - the wait/resolver state machine, down to the panic text `'A resolver was resolved twice.'`:
     `live/waits/waits.ts` | `scheduler/instance/waits/index.ts` + `endings.ts`;
   - the settle-order adapter: `rankedTarget` | `waits/settle-order.ts` `heapSettleOrder`;
   - the ready queue: `live/ready.ts` | `instance/ready.ts`;
   - async-call driving: `live/executions.ts` | `segment/index.ts`, `run-stack.ts`, `returns.ts`;
   - due timers: `live/timers.ts` | `instance/futures.ts` `resolveDueTimers`/`nextTimer`;
   - the host resolvable: `live/natives-context.ts` `resolvable` | `scheduler/live-resolvers.ts`
     `LiveResolver`;
   - `NativeWaits`: `waitsOf` | `segment/native-calls.ts` `nativeWaitsOf`;
   - the draws, logs and resources capabilities;
   - transients, whose keys also diverge;
   - the live loop: `live/arrivals.ts` | `scheduler/live-run.ts` `woken`/`nextTurn`.
   - **Blast radius:** every change to waits or timers edits both, and only the differential
     runner guards them. **Fix:** one run (§4).
2. **Two shapes for a handle:** an id in the interpreter, an object in compiled code. Both
   runtimes and the codec are affected. **Fix:** objects in memory, ids at the codec.
3. **Two shapes for "a run ended":** `instance-state.ts` `Advanced` vs `live/program.ts`
   `LiveEnded` / `run.ts` `RunEnd`. Start preparation (seed, `startOf`, `jsonIn`) is repeated in
   `host/programs.ts` and `live/program.ts`. **Fix:** one end type, and one start preparation in
   `boundary/starts.ts`.
4. **Capability members that throw "not supported":** 16 `interpreterOnly` stubs, though
   `std-module.ts` already splits `everywhere` and `interpreter`. **Fix:** they vanish with one
   run. Until then, segregate `NativeCapabilities`.
5. **A production call pays for tests:** `startCall` → `reachedMock` → `ancestorsOf` on every
   call. **Fix:** §6.
6. **Stored derived index:** "newest mock" is computed in `mocks.ts` `reachingMock` and again in
   `World.mocksOf`, a WeakMap over snapshot objects (`testing/world/index.ts`). **Fix:** one index
   function over objects.
7. **Symptom patch:** `world.mocking ? keepingNone : …` (`segment/native-calls.ts`) turns JSON
   caching off for every test run. **Fix:** find why caching breaks under mocks. The cause is
   unknown.
8. **Punning:** `answer` means a mock call or a host invocation, with `instance` optional
   (`snapshot/objects.ts`). **Fix:** two kinds.
9. **Policy in TS that Istalang half owns:** `Contexts.#serve` (earliest open runtime serves), and
   `CallMaker` `'program' | 'jobs'`. **Fix:** move the arbitration into `runtime.ista`.
10. **Stored derived data:** `Contexts.#runsOwnProgram` (the snapshot names the hash),
    `#servedLives`, `InstanceGroup.#states` (the store's last commit says it). **Fix:** derive from
    the store.
11. **Speculative generality:** `hostStore` returns a `Store` whose payload is always `'host'`.
    `Contexts` is generic over a program type with one instantiation.

## 8. Docs that contradict the goal

- `docs/work/ir-lifetimes/design.md`, "Interpreter": "the only runtime for ista code (persistent
  instances, snapshots, commits), contexts, jobs, mocks and `ista test`."
- `docs/work/js-codegen/design.md`:
  - "Out of scope" keeps those on the interpreter.
  - "Functions" makes a live async entry a generator.
  - "Stopping a call" stops it with `return()`.
- `docs/arch/definition.md`, Frames, `counted`: superseded by the typed registers of
  `ir-lifetimes`.

## Open

- **The spill contract:** register layout now, with an IR-derived set per suspension point, or
  proposal 10's named schema first. Both are IR facts, so executors don't change between them.
- **Whether slots become Istalang:** the spike in §5.
- **The mechanism that keeps starts past the mock check:** §6.
