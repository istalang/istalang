---
description: runtime-lane code tour for static lifetimes — where holding, release noting, collection, disposal, resolver edges, roots, restores and handles live today, what each of R1–R7 changes there, every site it must touch, and the traps; read before implementing or examining a runtime phase
owner: tech-lead
status: active
applies_to: runtime lifetimes, scheduler/instance, interpreter, snapshot
last_verified: 2026-11-12
last_updated: 2026-11-12
tags: [lifetimes, disposal, runtime, tour]
---

# Static lifetimes: runtime tour

Read against main at `67d50e5b`. Rules and model: [design.md](design.md); phases: [plan.md](plan.md). What was still true of the earlier research ([archive/findings.md](archive/findings.md)) is folded in here. Paths are under `src/runtime/` unless they say otherwise.

## Map

| Unit | Today | Phase |
|---|---|---|
| `snapshot/holdings.ts` | the one per-kind holding table (`kinds`, `futureStates`): values held, ids held, ids watched; `isRoot`, `keptFrame`, `frameValues`, `frameCells` | R1 edges; stays the table counts read |
| `scheduler/instance/heap.ts` `Heap` | objects by id, a list per kind, 11 derived `indexes`; `holds` = holdings plus index edges (`#indexedHolds`, `#awaited`); `#noteHoldings` on `replace`/`remove`; `noteReleased`/`takeReleased`; the losers flag; `keepOnly` | R1, R2, R3, R5, R7 |
| `interpreter/registers.ts` | the register writers; `FrameHeap.released` on overwrite and clear | R2 |
| `interpreter/machine.ts` | `newFrame`, `releaseFrame` (ascending registers), `currentClosure` | R2, R6 |
| `scheduler/instance/index.ts` `Instance` | `frameHeap`; the constructor every start and restore goes through; `persisted`/`#kept` (walk plus the invariant scan); `dropUnheld`; `continueFrom`; `stop`; `owed`, `keptFrames` | R4, R5, R7 |
| `lifetimes/collector.ts` | rounds: `disposablesFrom` → `heldUnlessAll` → `readyOrphans`, `#keptBy`, waiting on a disposal's code | R5 deletes the rounds |
| `lifetimes/holders.ts` | `heldFrom` (with the commit's depth), `heldUnlessAll`, `walkHolds`, `holdsOf` | R5, R7 |
| `lifetimes/orphans.ts` | strongly connected components, cover, descending id | R5 deletes |
| `lifetimes/disposal.ts` | per kind: `disposable` and `dispose`; `readiedBy`; the dropped-resolver panic (`isDropped`) | kept; R1 adds a cancel |
| `scheduler/segment/collection.ts` `SegmentCollection` | `collected` after every step, `collectFully`, `collectEnding` (panic recovery), `#roots` | R5 |
| `scheduler/segment/disposal-runs.ts` | disposal code on the run stack: a carrier (id −1), or a disposed call's cleanup | kept |
| `scheduler/instance/waits/` | `Waits`, `ResolverEndings`, `rootOf`, `pendingCases`, `settleOrder` | R1 |
| `scheduler/instance/weak-side.ts` | one `weakRef` per referent, found by the `weakRefs` index; watches | kept |
| `scheduler/instance/slots.ts` | `#owed`/`serveOwed`: serving waits on a decided `select`'s losers being collected | kept (design.md) |
| `scheduler/live-run.ts`, `scheduler/resident.ts` | `dropUnheld` after each live segment; `take` restores, `committedBy` → `continueFrom` | R4, R7 |
| `definition/values/values.ts` | `handlesIn`, `depthOf` over memoized `summaries` | releases stop using them in R5; `depthOf` stays for commits |

## Holding today

- **One table.** `holdings.ts` per object, and `Heap.holds` for edges read off indexes. `docs/arch/definition.md`'s Holders table is its prose. The collector, the commit and the snapshot's closure check (`snapshot.ts`, through `referencedObjects`) read nothing else.
- **Index edges** (`Heap.#indexedHolds`):
  - a future holds every pending resolver registered on it (`resolvers` index);
  - a wait holds its pending case resolvers that are awaited (`cases`);
  - a pending resolver holds its awaited `Resolver.at` ones (`positions`).
  - *Awaited*: registered on a future, or decided by an awaited at-resolver (recursive, `#awaited`).
- **Field edges** (`holdings.ts`, resolver entry):
  - a pending resolver holds `on`, a callback's `callback`, its `onCancel` values, and an at-resolver's `done`;
  - a case resolver watches its `wait`.

  So each end of a registration holds the other, one direction in each file.
- **Roots.**
  - `isRoot` kinds: execution, run, answer, outcome and context constant.
  - `SegmentCollection.#roots`, in this order: running frames innermost first, then the waiting executions; then `Instance.keptFrames` (runs and constants as frames); `RunStack.callFutures` (a running call's own future); and `Instance.owed` (the futures that answers and the outcome hold).
  - The collector adds its waiting rounds to these roots.

## Release and collection today

- **What is noted:**
  - Register writes go through `writeRegister`, `clearRegister` and `releaseFrame` to `FrameHeap.released`, which calls `heap.noteReleased(handlesIn(old))`.
  - `Heap.replace` and `Heap.remove` note an object's old holds minus its new ones (`#noteHoldings`). `Heap.add` notes nothing.
  - `ResolverEndings.replace` notes the resolver itself, because the index edges to it vanish with it.
  - A decided `select`'s losers set the losers flag through `noteLosersReleased`.
  - A driver that awaits notes its own call future (`SegmentRunner.wait`).
- **After every step:** `SegmentRunner.#drive` → `SegmentCollection.collected()`, which runs `takeReleased`, then `Collector.collect`, then `Slots.serveOwed`, until nothing is left.
- **A round:**
  1. `disposablesFrom(released)`.
  2. `heldUnlessAll(roots, reached)`, which stops once every one is found held.
  3. `readyOrphans`, newest first.
  4. Per object, `dispose`. Code runs on the run stack and the round waits on it, then `returned` → `#gone` (`heap.remove`, `weak.disposed`).
  5. When the queue is empty, a new round starts from `takeReleased`.

  `#keptBy` skips this round whatever the runs a disposal readies (the `onCancel` callbacks) will hold.
- **Left until `keepOnly`:** unheld objects whose disposal does nothing (resolved futures, timers, plain cells, weak references). A commit's `continueFrom` or a live `dropUnheld` removes them.

## R1 Edges

- **Sites.**
  - `holdings.ts` resolver entry: `on` and an at-resolver's `done` stop being unconditional holds. They stay referenced, as watches, for the closure check.
  - `heap.ts` `#indexedHolds` and `#awaited` take the direction from the chain's root:
    - The root comes from `rootOf` (`waits/resolvers.ts`), which follows `target.done` until a target isn't `at`.
    - The root is fixed at creation, since `Waits.at` makes a pending at-resolver only on a pending `done`.
    - `waits/` imports `heap.ts`, so the root walk must live where `Heap` can read it.
  - **Case root:** the resolver holds `on`, `done` holds its awaited at-resolvers, and the wait holds its awaited case resolvers, all as today. The future only watches.
  - **Callback root:** the future holds the resolver or at-resolver registered on it, an at-resolver holds its `done`, and a resolver no longer holds `on`.
- **`disposal.ts` `disposeFuture` must cancel what is registered on the future.**
  - With one-way edges, a future can be disposed while a resolver registered on it is held elsewhere.
  - §7's "Resolvers" paragraph and `objects.ts` already say that such a resolver is cancelled. Today that happens only because the two are orphaned together.
  - R1 cancels, at the future's disposal, the pending resolvers the `resolvers` index finds on it. Otherwise their `on` names a gone object, and the next commit fails `snapshot.ts`'s closure check.
- **Already true, unchanged:**
  - A case resolver is cancelled when its waiter stops: `Instance.stop` → `#endWait` → `Waits.end` → cancelled as `'lost'`.
  - The drop panic is `isDropped`: a pending *case* resolver with an empty `on`. An at-resolver let go of is cancelled; the panic comes from its case root once nothing holds the root.
- **Docs:**
  - `definition.md` Holders rows for future, wait and resolver;
  - spec §7's implicit-holds bullet;
  - the `objects.ts` header, `Heap.holds`'s comment and the `waits/index.ts` header.
- **Tests:**
  - test/corpus has no resolver program. Resolver lifetimes are tested in `scheduler/instance/callbacks.test.ts` ("lives as long as its future…", "is cancelled, not dropped, when the future it is registered on is disposed first", "holds nothing a cold awaitable started…"). All three pass under the new edges, and the new case goes beside them.
  - `on-cancel.test.ts`, `waits.test.ts`, `awaitables.test.ts` and `races.test.ts` cover the rest.

## R2 Seams

- **Every holder write today:**
  - **Registers:** `registers.ts` (`writeRegister`, `clearRegister`; cells through `FrameHeap.create`/`write`). These write registers directly: `newFrame` (captures and reference parameters), `liveFrame` (restore), and `takeWait` (a wait, which isn't counted).
  - **Heap objects:** `Heap.add`, `replace`, `remove`, and `keepOnly`, which drops without noting.
  - **Edges that change when another object changes:**
    - `Waits.register`: a growing `on` adds a holder to the future, or makes the resolver awaited, which adds it to its wait or to its `done`'s, recursively.
    - `ResolverEndings.replace`: an ending drops all of them.
  - **A running call's own future:** `RunStack` push and pop (`callFutures`), and the await note in `SegmentRunner.wait`.
- **Composite builders,** if R2 gathers them:
  - **Values and parts:** `values.ts` `withChildValues`; `interpreter/parts.ts` `withPart`.
  - **Interpreter:** `interpreter/instructions.ts` (tuple, struct, variant, array, closure, `keep`); `machine.ts` `currentClosure`.
  - **Declared values and maps:** `definition/values/declared-values.ts` (`structOf`, `variantOf`); `json-values.ts`; `foundation/language/values.ts` (`withEntry`, `withoutEntry`, `mapOf`).
  - **Std natives:** `stdlib/values/arguments.ts` `arrayOf`; `results.ts`; the prelude's `maps.ts`, `strings.ts` and `range-natives.ts`; the regex, strings and testing natives.
  - **Scheduler:** `waits/resolvers.ts` `positioned`; `testing/mocks.ts` (`callRecord`, `asHostValue`); `instance/crossing.ts` (`leaving`, `arriving`); `segment/native-contexts.ts`.
  - **Definition tables:** `definition/tables/test-runner.ts`.
  - **Decoding:** zod decodes every value in a snapshot.
- **A constructor alone can't tell whether a part is counted:** whether a handle's object is counted depends on its kind and, for a cell, its type entry, and natives build values with no instance at hand. So R4 decides it at a composite's first hold, at this seam (design.md, Contract).
- **Acceptance's guard:** a dependency-cruiser rule lets only the seam import the raw writers (plan).

## R3 Identity

- **Scale:** `handleTo` has 34 uses in 14 files, `handleTarget` 21 in 11, `handleObject` 18 in 7, `heap.of` 31 in 12, `heap.objectOf` 10 in 7, and `heap.find` 18 in 10 (non-test).
- **Identity:**
  - Records are immutable and replaced on every change (`Heap.replace`), so a direct handle needs an identity that outlives a replace.
  - `HandleValue.object` is part of the persisted `Value` that snapshots share. An in-memory reference therefore differs from the stored serial, and the two convert only where a commit encodes and a restore decodes.
- **Creation order matters beyond disposal:** `Heap.find` returns it, and `settleOrder`, cancelling losers and `reachingMock` (the newest) depend on it. The serial must keep it.
- **Handle reads today:**
  - `==` compares ids (`src/definition/values/equality.ts`, `sameHead`), and hashing is `handle:${id}`.
  - Cells are read and written only through `FrameHeap` (`interpreter/registers.ts`).
  - Raw reads bypass the helpers in `equality.ts` and in `scheduler/testing/mocks.ts`'s `asHostValue` and `leaving`, which are two copies of one walk.
- **Counts follow:** R4's table is keyed by this identity from the start (design.md, Off the id heap).

## R4 Shadow counts

- **The one rebuild site is the `Instance` constructor.**
  - `Instance.start` and `Instance.restore` both go through it.
  - `Resident.take` restores from the commit after `wake.ts`'s `commit` read it back from its text, so a resident never shares objects with the instance that committed them. Two restores from one commit do share them (crashEveryAwait's rerun).
- **What the table survives:** `continueFrom` keeps it. `keepOnly` drops what nothing holds, and that may include counted objects: one of a tracked type in a cycle that reaches no disposable never reaches zero (design.md, Contract). So what `keepOnly` drops is uncounted or reaches no disposable, and the weakly keyed table lets those go with their last reference.
- **What is counted** (design.md, Contract): every disposable; a handle or cell whose type entry is `tracked`, the flag L2 writes and the runtime only reads; a composite with a counted direct part, decided at its first hold (R2's seam).
- **The check** (design.md, Contract): every zero is an orphan, and every orphan that reaches a disposable is a zero.
  - Compare each round's `readyOrphans` with the counts' zeroes for the same step.
  - Counted objects whose disposal does nothing are left to `keepOnly` today, so compare them against the commit's `#kept`.
  - An object of a tracked type in a cycle that reaches no disposable (`let f = fn: f()`) is an orphan that never reaches zero, which is legal; the acceptance includes one.
- **Runners:** `scheduler/wake.sweep.test.ts`, `scheduler/resident.sweep.test.ts` and `src/cli/commands/run.sweep.test.ts`.

## R5 Switch

- **What goes:**
  - `noteReleased`/`takeReleased` and `#noteHoldings`;
  - the `Collector`'s rounds, `disposablesFrom`, `heldUnlessAll`, `readyOrphans` and `#keptBy`;
  - `#kept`'s invariant scan;
  - `lifetimes/holders.test.ts`, `orphans.test.ts` and `lifetimes.test-kit.ts`, rewritten or deleted.
  - Acceptance's guard (plan): dependency-cruiser bans release paths from importing the walks (`handlesIn`, `heldFrom`).
- **What stays:**
  - per-kind disposal;
  - `DisposalRuns`;
  - `collectEnding`'s attribution;
  - `weak.disposed` after the object is gone;
  - `Slots.#owed`. Its flag is cleared by `takeReleased` today, so it needs a new clearing point.
- **At zero, every counted object leaves the heap and its indexes.** Its kind's disposal runs only where `isDisposable` says it does something. Otherwise a pending timer nothing holds stays in the `pending` index and wakes a live run (`live-run.test.ts`, "lets go of a timer nothing waits on any more…").
- **Confirm zeroes at the step's end, not at the decrement.** Several paths let go before they hold again:
  - `ResolverEndings.end` replaces the resolver before it readies the `onCancel` runs;
  - `ReadyQueue.next` removes a run before `RunCalls.start` writes its captures;
  - `withPart` rebuilds a value along a path, sharing the parts off it.

  Confirming at the step's end also deletes `#keptBy`: the readied run holds what it calls with before the zeroes are confirmed.
- **"Ordered as today":** descending id within a batch, holders before what they hold.
- **Until R7,** `persisted` keeps `heldFrom` for the commit's objects and depth, and live runs keep `dropUnheld`.

## R6 Order

- **Where order is decided today:**
  - The `release` handler (`interpreter/instructions.ts`) clears in the instruction's list order, which is `scope.declared`'s (`compiler/lowering/constructs/statements/scopes.ts`).
  - `releaseFrame` clears registers in ascending order.
  - `Instance.stop` releases frames innermost first.
  - `keep` builds an array in keep order.
  - `#letGoOfTheRest` releases answers, then executions, then constants last.
  - `ContextConstants.release` releases the last made first.
- **Tests:**
  - corpus `holders/` `dispose`, `defer`, `function-holdings`, `hold-scopes`, `lifetimes` and `exits`, and `combined/scope-teardown`;
  - `lifetimes/orphans.test.ts`;
  - `testing/mocks.test.ts` "are released with their holder…";
  - `on-cancel.test.ts`'s B76 pair. Its program is a cycle (`d2->r = r`, with `r`'s callback reading `d2`), so L2 makes it invalid.

## R7 Only indexes

- **What the scheduler reads besides objects by id:**
  - every index in `heap.ts` `indexes`: `mocks` on every call (`Instance.mockOf`), and `answers`, `hostFutures`, `contextConstants`, `cases`, `positions` and `weakRefs`;
  - the lists per kind: executions, answers, outcomes, runs and context constants (roots), resources (`arriving` finds one by payload) and mocks.
- **Commit:**
  - Today a commit runs `persisted`, then `snapshotFormat.write`, then reads the text back (`wake.ts` `commit`). crashEveryAwait's `runText` encodes again.
  - The root walk can build the objects and the depth in one pass. The format's encoding is a second pass unless it is replaced.
- **Weak references:** the `weakRefs` index keeps a weak reference alive as long as its referent, which "one weak reference per referent" needs.
- **Acceptance's guards** (plan): live paths can't import a walk (dependency-cruiser), and an untracked cell is reclaimed (a finalization test).

## Traps

- **Values are shared by identity.** A copy, a constant and a committed snapshot's value can be one object. Key per-instance data by identity, never on the value.
- **Carriers are executions off the heap.** `DisposalRuns` uses id −1 and `RunCalls` id −2; their frames hold values.
- **Ids are reused.** `keepOnly` resets `#next`, so ids above the highest kept one come back. `objects.ts`'s "never reused" is wrong (Q51); R3's serial settles it.
- **`LiveExecution.disposing` is never set true,** but it is in the snapshot schema.
- **A mock records its calls' arguments** (`mock.calls`): the mock holds them. The analysis models that as a rule (design.md, Holds); keep the two in step.
- **The runtime's holds must stay within the analysis's.** The analysis assumes an extern call's future holds its callee, receiver and arguments, and an extern object what its `@Holds` say (design.md, Holds). A native that keeps more makes an edge no check sees, and a cycle through it leaks.
- **A `select`'s losers are released twice** (Q49).
- **Natives keep no language value outside the heap.** What a native keeps, it stores through a capability, so every holder is a register or a heap object.

## Lowering

- **The release points are already the lowering's** (`docs/reuse/lowering-and-ir.md`):
  - `release` at block and statement ends, on exits, and for `drop`;
  - `keep` for `hold`;
  - a `select` case's `holds`;
  - `return` releasing every register.

  Counting hooks go at the interpreter's existing write and release sites. The Definition gains only
  `tracked` on type entries.
- **Generics are compiled per instantiation,** so every type at an emit site is concrete, and the IR
  is untyped by decision.
- **Stale TSDoc (Q50):** `move`'s TSDoc (`src/definition/instructions/data.ts`) says it adds a holder; it
  copies a register.

## Tests

- **Order and cycles:**
  - `lifetimes/orphans.test.ts`;
  - corpus `holders/` (`dispose`, `defer`, `function-holdings`, `hold-scopes`, `lifetimes`,
    `exits`) and `combined/scope-teardown`;
  - `testing/mocks.test.ts`, "are released with their holder…".
- **Weak side:** `test/corpus/weak-side/*.ista`, `scheduler/instance/weak-side.test.ts`, and
  `collections.test.ista`.
- **Live run:** `live-run.test.ts`, "lets go of a timer nothing waits on any more…".
- **Commits:** `scheduler/wake.test.ts`, and the resident sweep.
- **Programs inside runtime tests:** 13 runtime test files declare shared structs
  (`rg -l "shared struct" src/runtime -g '*.test.ts'`). L2 must leave them checking clean or turn
  them into invalid cases, as with the B76 pair, before R4 relies on them.
- **Runners:** the corpus runs through `wake.sweep.test.ts`, `resident.sweep.test.ts` and
  `src/cli/commands/run.sweep.test.ts`.

## Measurements (2026-11-11, live FormBuilder `supplierForm`)

| Run | Per change, settled | First view | Notes |
|---|---|---|---|
| As-is | 48 ms | 24 ms | 3 views per change |
| Releases not noted (ceiling) | 26 ms | 12 ms | |

A change's profile: collector 33%, release walks 20%, `newFrame` 13%.

Live micro-benchmarks, n = 2000:

| Loop | Before | After |
|---|---|---|
| `await` loop, with a settled-future fast path | 50 ms | 33 ms |
| per-step check without allocation | | −15% |
| map set (quadratic, P2) | 183 ms | |

The fast path and the per-step check are out of scope (plan, tracker).
