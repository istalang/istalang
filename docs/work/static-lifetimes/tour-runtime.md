---
description: runtime-lane code tour for static lifetimes — where holding, registrations, release noting, collection, disposal, roots, restores, handle identity and value updates live today, what each of R1–R5 changes there, every site it must touch, and the traps; read before planning, implementing or examining a runtime phase
owner: tech-lead
status: active
applies_to: runtime lifetimes, scheduler/instance, interpreter, snapshot, definition values
last_verified: 2026-11-12
last_updated: 2026-11-12
tags: [lifetimes, disposal, runtime, refcount, tour]
---

# Static lifetimes: runtime tour

Read against `main` at `41160c33`, and updated where R1 and R2 changed the code (their sections). Rules
and model: [design.md](design.md) §3 and §9. Phases: [plan.md](plan.md). Paths are under
`src/runtime/` unless they say otherwise.

## Map

| Unit | Today | Phase |
|---|---|---|
| `snapshot/holdings.ts` | the one per-kind holding table (`kinds`, `futureStates`): values held, ids held, ids watched; `isRoot`, `keptFrame`, `frameValues`, `frameCells` | R1 edges; stays the table counts read |
| `scheduler/instance/heap.ts` `Heap` | objects by id, a list per kind, 11 derived `indexes`; `holds` = holdings plus index edges (`#indexedHolds`, `#awaited`); `#write`, every change reported to the seam, index edges included (R2); ids are serials (`made`); `keepOnly` | R1, R2, R3, R4 |
| `lifetimes/holder-writes.ts` `HolderWrites` | the one seam every holder write reports to (R2); today it notes releases for the collector (`takeReleased`) and keeps the losers flag | R2; R3 counts here |
| `interpreter/registers.ts` | the only register writer, reporting each write (`FrameHeap.changed`); `raw-registers.ts` is its raw write | R2 |
| `interpreter/machine.ts` | `newFrame`, `releaseFrame` (ascending registers), `currentClosure` | R2, R3 |
| `scheduler/instance/index.ts` `Instance` | `frameHeap`; the constructor every start and restore goes through; `persisted`/`#kept` (walk plus the invariant scan); `dropUnheld`; `continueFrom`; `stop`; `owed`, `keptFrames` | R3, R4 |
| `lifetimes/collector.ts` | rounds: `disposablesFrom` → `heldUnlessAll` → `readyOrphans`, `#keptBy`, waiting on a disposal's code | R3 deletes the search; the rounds' order stays |
| `lifetimes/holders.ts` | `heldFrom` (with the commit's depth), `heldUnlessAll`, `walkHolds`, `holdsOf` | R3, R4 |
| `lifetimes/orphans.ts` | strongly connected components, cover, descending id | R3 deletes it |
| `lifetimes/oracle.test-kit.ts` | the oracle (R1), a `HeapCheck` | test-only, for good |
| `lifetimes/native-audit.test-kit.ts` | the native audit (C3 step 0), `HeapCheck.native`: edges natives add, against the std's `Keeps` | test-only, for good |
| `lifetimes/disposal.ts` | per kind: `disposable` and `dispose`; `readiedBy`; the dropped-resolver panic (`isDropped`); a future cancels what is registered on it (R1) | kept |
| `scheduler/segment/collection.ts` `SegmentCollection` | `collected` after every step, `collectFully`, `collectEnding` (panic recovery), `#roots` | R3 |
| `scheduler/segment/disposal-runs.ts` | a disposal's code as a frame on top of the running execution, or on a carrier (id −1) when nothing runs; a disposed call's cleanup | kept |
| `scheduler/instance/waits/` | `Waits`, `ResolverEndings`, `rootOf`, `pendingCases`, `settleOrder` | R1 |
| `scheduler/instance/weak-side.ts` | one `weakRef` per referent, found by the `weakRefs` index; watches | kept |
| `scheduler/instance/slots.ts` | `#owed`/`serveOwed`: serving waits on a decided `select`'s losers being collected | kept |
| `scheduler/live-run.ts`, `scheduler/resident.ts` | `dropUnheld` after each live segment; `take` returns the held instance, or restores | R3, R4 |
| `definition/values/values.ts` | `handlesIn`, `depthOf` over memoized `summaries`; `withChildValues` | releases stop using `handlesIn` in R3; `depthOf` stays for commits; R5 |
| `stdlib/prelude/arrays.ts`, `prelude/maps.ts`, `foundation/language/values.ts`, `interpreter/parts.ts` | every update of a composite value copies (below) | R5 |

## Holding today

- **One table.** `holdings.ts` gives what each object holds, and `Heap.holds` adds edges read off the
  indexes. `docs/arch/definition.md`'s Holders table is its prose.
  - The collector, the commit and the snapshot's closure check (`snapshot.ts`, through
    `referencedObjects`) read nothing else.
- **Roots.**
  - The `isRoot` kinds are execution, run, answer, outcome and context constant.
  - `SegmentCollection.#roots` lists, in this order:
    1. the running frames, innermost first;
    2. every other execution on the heap, waiting or ready;
    3. `Instance.keptFrames` (runs and constants, as frames);
    4. `RunStack.callFutures` (each running call's own future);
    5. `Instance.owed` (the futures answers and the outcome hold).
  - The collector adds its waiting rounds to these.
- **A call future holds nothing** (`futureStates.call`), and an execution only watches its own future.
  The only link from a future to its call is the `executions` index, which `disposeFuture` reads to
  stop the call (`lifetimes/disposal.ts`).
- **So a call that holds its own future is never disposed.** For example, its `Shared` cell holds
  the future, and the caller lets go of it:
  - Collection finds the future held from the waiting execution's frames (a root), so no round
    starts.
  - The call ends only if it returns, or when the instance ends, which stops it with no cleanup.
  - This breaks spec §7, "An async call's execution is held through its future". The analysis
    rejects the program (design.md §2), so R1 keeps executions as roots.

### Registrations

Since R1, each registration holds one way, as its chain's root says (`isHeldFromRoot`):

| Edge | Root | Where | How |
|---|---|---|---|
| future → each pending resolver registered on it | callback | `heap.ts` `#indexedHolds` | `resolvers` index, filtered by root |
| pending resolver → its `on` futures | case | `holdings.ts`, resolver entry | field |
| pending resolver → its callback, its `onCancel` values | either | `holdings.ts`, resolver entry | fields |
| wait → its awaited case resolvers (a case resolver only watches its wait, a wait only its waiter) | case | `heap.ts` | `cases` index; *awaited* is recursive in `#awaited` |
| at-resolver → its `done` | either | `holdings.ts` | field |
| pending resolver → its awaited at-resolvers | case | `heap.ts` | `positions` index |

- `Waits.register` grows `on`, `ResolverEndings.replace` ends a resolver and notes it, and
  `cancelLosers` narrows `on`. `Waits.at` records the root on the at-resolver it makes.
- No registration makes a cycle any more. Within a wait's chain, an awaited at-resolver and its
  `done` hold each other until the wait ends both. A cycle through a callback's chain is the
  program's own, such as a callback capturing its future.

## Release and collection today

- **What is noted** (since R2, through the seam, `HolderWrites`; R2 below): whatever a holder
  write reports the holder held and holds no more.
  - Registers: every write, clear and frame release (`registers.ts`). A reference holds its cell.
  - Heap objects: every add, replace, remove and `keepOnly` drop (`Heap.#write`): the object's own
    holds, index edges included, and the index edges of the objects that read it. An execution
    reports nothing of its own: `stop` or `landReturn` has already released its frames.
  - The run stack: a running call's own future, on every pop (`RunStack`).
  - A decided `select`'s losers set the losers flag (`noteLosersReleased`).
- **After every step,** `SegmentRunner.#drive` calls `SegmentCollection.collected()`:
  - It runs `takeReleased`.
  - It runs `Collector.collect` only when something was released or the collector is stalled.
  - It returns early while a disposal's code still has to run.
  - It loops again only while `Slots.serveOwed` served something.
- **A round:**
  1. `disposablesFrom(released)`.
  2. `heldUnlessAll(roots, reached)`, which stops once every one is found held.
  3. `readyOrphans`, newest first.
  4. Per object, `dispose`. Code runs on the run stack and the round waits for it, then `returned`
     → `#gone` (`heap.remove`, `weak.disposed`).
  5. When the queue is empty, a new round starts from `takeReleased`.

  `#keptBy` skips, for this round, whatever the runs a disposal readies (the `onCancel` callbacks)
  will hold.
- **Left until `keepOnly`:** unheld objects whose disposal does nothing, such as resolved futures,
  timers, plain cells and weak references. A commit's `continueFrom` or a live `dropUnheld` removes
  them.

## Values: every update copies

- **How each update copies:**
  - `push` builds `[...elements, x]`, and `arrayOf` copies it again (`stdlib/prelude/arrays.ts`,
    `stdlib/values/arguments.ts`).
  - `setIndex` uses `elements.with(…)` and copies again.
  - A map set is `withEntry`: a spread of the entries, plus `#carryTable` making a new table for a
    new key (`foundation/language/values.ts`, `prelude/maps.ts`).
  - `withPart` rebuilds the spine along a path, each level through `withChildValues`, which copies
    again (`interpreter/parts.ts`, `definition/values/values.ts`).
  - A write through `&` or a cell goes `writeReference` → `withPart` → `FrameHeap.write` →
    `Heap.replace`. Its report to the seam then summarizes the new spine.
- **Nothing mutates a value in place.** Only frames (registers, pc) and an execution's frame stack
  change in place.
- **Values shared by identity:**
  - **Constants:** `constantAt` returns `definition.constants[i]` itself, shared by every instance.
  - **Registers:** `move` copies the reference, `field` returns the child, and builders embed
    register values by reference.
  - **Runs:** `ReadyQueue.run` reuses `closure.captures`.
  - **Snapshots:** `storedObject` and `liveObject` pass objects and register contents through as
    the same objects. A committing instance never shares with its committed snapshot, because
    `commit` reads the text back. Instances restored from one snapshot share with it and with each
    other.
  - **Derived data keyed by value identity:** `summaries` (`values.ts`), `#hashes` and `#tables`
    (`foundation/language/values.ts`).
- **Tracker:** P2 is the general row (building a collection one item at a time is quadratic). P8 is
  `mapOf`/`#carryTable` building maps in O(n²).

## R1 Edges and the oracle

Landed. What R1 left, for the phases after it:

- **Direction by root.** A chain of resolvers comes down to a wait's case or a callback, its root.
  `isHeldFromRoot(target)` (`snapshot/holdings.ts`) is the rule's one home. The resolver entry
  there, and `Heap.#indexedHolds`, read it.
  - **Either root:** an at-resolver holds its `done`, since it can still decide it (design.md §6.3).
    QA found that an at-resolver kept to resolve later, and registered on nothing, otherwise
    lets its wait's resolver go: the wait panics as dropped.
  - **Case root:** the wait holds its awaited case resolvers, each pending resolver holds its awaited
    `Resolver.at` ones, and each resolver holds its `on`. A future only watches. So an awaited
    at-resolver and its `done` hold each other, which the wait's end undoes, as it ends both.
  - **Callback root:** a future holds the pending resolvers registered on it. A resolver only
    watches its `on`.
  - **The root is recorded, not walked.** Each `at` target carries `root` (`snapshot/objects.ts`,
    `chainRoot`), set by `Waits.at` and checked against its `done` by `snapshot/check/waits.ts`.
    A walk can't stand in for it: `ResolverEndings` ends a resolver before it cancels the
    at-resolvers deciding it, so mid-step their `done` is no longer pending, while the heap's
    report must still read what they held. R3's counting needs the same.
- **A future disposes what is registered on it.** `disposeFuture` first cancels every resolver
  still registered on the future. A future with resolvers registered on it is disposable whatever
  its state (`registered` in `lifetimes/disposal.ts`). Without that, a timer nothing else holds is
  dropped at the commit while a held callback still names it, and the snapshot's closure check
  fails. A callback registered on several futures is cancelled when the first of them is disposed.
- **Behaviour that changed:** a `Resolver.of` resolver no longer keeps alive the futures it is
  registered on. `on-cancel.test.ts`'s "given that resolver and what it holds" now holds its `take`
  through the holder. `callbacks.test.ts` has the new case: a held callback is cancelled once its
  future, a call or a timer, is let go of.
- **Executions stay roots.** The analysis models a call future as holding its call (design.md §2).
- **The oracle** is `lifetimes/oracle.test-kit.ts`.
  - **Its seam** is `HeapCheck` (`scheduler/loaded-definition.ts`). It rides on `LoadedDefinition`
    and comes in through `RuntimeSeams.heapCheck`, `TestRunOptions` and `WorldSeams`, and
    `CliEnvironment.heapCheck`. `SegmentCollection.collected` calls its `changed` after every
    instruction that let go of or wrote into something, before collecting, with those ids: the
    released ones and `Heap.takeWritten`'s, every object replaced. `NativeCalls` calls its `native`
    as an extern's native starts, and what it returns once the native returned: the native audit's
    hook (C3 step 0, `lifetimes/native-audit.test-kit.ts`; design.md §6.6). A host passes
    `noHeapCheck`.
  - **Its graph is the analysis's holding** (design.md §3, §6.3, §6.4), so an accepted program
    never trips it. That is `Heap.holds` and the executions' frames, plus call future → execution,
    but for the executions running (decided 2026-11-12): `changed` gets them from the run stack,
    and `countedHolds` leaves their futures' edges out. With three differences:
    - a future holds every resolver registered on it, whatever the root, as `onAwait` keeps one;
    - a resolver holds its callbacks and its `done`, never its `on` or the at-resolvers deciding it;
    - a wait holds the futures its chain is registered on, what its waiter awaits.
  - **Its disposables are the language's** (spec §7): pending futures and resolvers, slots, values
    whose type declares `dispose`, and mocks. They are not `disposal.ts`'s `isDisposable`, which
    says whether the collector must act at once and leaves an unwatched slot or timer to the
    commit. Counting must reach every disposable.
  - **What it walks:** only what the changed ids reach. A cycle closes only by a write into one of
    its objects (design.md §2), and one lost to counting is one something let go of. Walking the
    whole heap timed out `collections/deep-elements.ista`. No program yet closes a cycle releasing
    nothing that reaches it, since statements release their temporaries; the write log keeps the
    check independent of that, which C5's elision may change.
  - **Where it is on:** by default in `testRuntime`, `reportsOf` and `cli.test-kit`'s `ista`.
    `oracle` throws at the first cycle. `cycleWatch()` records instead, for the oracle's own tests,
    whose cyclic programs C3 rejects, so they compile through `compile.test-kit.ts`'s
    `textDespiteCycles`, which lets only cycle errors through. `wake.bench.ts` turns it off.
  - **Runners:** the corpus through `wake.sweep`, `resident.sweep`, `run.sweep` (`ista run`) and
    the fmt sweep; the std suites through `cli/commands/test.sweep.test.ts` (`ista test`, one
    module at a time); and every runtime test on `testRuntime` or `reportsOf`. The CLI's
    spec-example tests run under it too.
  - **Its own tests** are `oracle.test.ts`, over programs shaped as design.md §12's.
- **What the oracle flagged after R1.** C3 rejected or rewrote each (design.md §10) and dropped the
  marks, so the oracle flags nothing now:
  - corpus `holders/dispose.ista` `cycle()`;
  - std `collections`: `WeakMap`'s watch future → its call → the map's cell → the future;
  - `on-cancel.test.ts`, "runs once its resolver is let go of, given that resolver…" (both
    variants), and its live run: `watching.onCancel` captures `watching`;
  - `on-cancel.test.ts`, the B76 pair: `d2->r = r`, with `r`'s callback reading `d2` and its
    `onCancel` capturing `r`.

  The `on-cancel` cases are `test/corpus/holders/invalid-own-resolver.ista` and
  `invalid-resolver-cycle.ista` now, and `cycle()` is `invalid-cycle.ista`. Two programs that made a cycle only by an `onCancel`
  capturing `self` now capture a field instead: `callbacks.test.ts`'s "lives as long as its
  future…" and `callbacks.test-kit.ts`'s `watched`.
- **Docs edited:** spec §6 (Resolvers) and §7 (the implicit-holds bullet); `definition.md`'s
  Holders, with a `resource` row; the headers of `objects.ts`, `holdings.ts`, `disposal.ts` and
  `waits/index.ts`; `Heap.holds`; `architecture.md`'s runtime tree.

## R2 Seams and identity

Landed. What R2 left, for the phases after it:

- **One seam:** `HolderWrites` (`lifetimes/holder-writes.ts`), one per instance
  (`Instance.holders`). Every holder write reports `changed(was, now)`, each a `Held`
  (`snapshot/holdings.ts`: values, and ids held directly).
  - **Registers:** `registers.ts` alone writes them. Its `put` writes through `raw-registers.ts`
    `setRegister` and reports, through `FrameHeap.changed`. Only `registers.ts` may import the raw
    write (dependency-cruiser `runtime-raw-register-write`), and `ActiveFrame.registers` is
    read-only. `newFrame`'s references and captures, and a restored frame's registers
    (`liveFrame`), go through `placeContents`; `takeWait` through `clearRegister`. A reference holds
    its cell (`heldIn`).
  - **Heap objects:** `Heap.#write` is every add, replace, remove and `keepOnly` drop, and a
    snapshot's objects going in (`restore`). It reports each object's own holds, index edges
    included, and for each other object whose index edges read one (`#readers`), that object's
    edges before and after: the futures a resolver is registered on, its case's wait, the resolver
    it decides, and up that chain, as whether each is awaited may change.
    `ResolverEndings.replace`'s own note went with that. An execution reports nothing of its own;
    its registers do.
  - **Every id a report names is in the heap as it reports**, so a consumer can read its object:
    `#write` takes a batch, in which every object made goes in before any report and every one gone
    leaves after them all. A restore makes the empty heap first (`Instance.heap`), puts every object
    in at once, and fills the restored frames' registers last (`restoreRegisters`), as an older
    object may hold a newer one.
  - **The run stack:** `RunStack`'s `push`, `pop` and `drive` report the running calls' futures.
    `SegmentRunner.wait`'s note went with that.
  - **Today's consumer is tracing:** `changed` notes what the holder held and holds no more
    (`takeReleased`). The collector's `noteReleased` puts back what a round skipped, the losers
    flag lives there, and `keepOnly` forgets the notes (`settled`).
  - **Exact:** `heap.test.ts`, "heap holder writes", tallies the reports over random changes and
    commits and checks them against `Heap.holds` of every object, and that each id reported is in
    the heap. R3's shadow counts are that tally, with the registers and the run stack added.
  - **Not reported:** a composite's parts. A composite is counted at its first hold, when a register
    or an object reports holding it (design.md §9.1), so R3 does that in `HolderWrites`. The
    collector's waiting rounds hold as roots of their own, which R3 deletes.
- **Identity:** an object id is a serial. The heap counts on from the snapshot's `objectsMade`
  (`Heap.made`) and never resets it, so no id is given twice, and a restored instance numbers its
  next object as the held one would: the resident sweep compares their commits. Validation refuses
  an object id at or past `objectsMade`. Q51 is closed.
  - Counts can be keyed by id: `keepOnly` reports what it drops through the seam, so a count goes
    with its object. On disk the serial stays the handle's `object` when R4 makes live handles
    direct references.
- **Creation order:** unchanged. Ids still grow with creation, which `Heap.find`, `settleOrder`,
  losers and `reachingMock` read.
- **One walk:** `replacingParts` (`definition/values/replacing.ts`), on a stack of its own, is
  `leaving`, `arriving` and what a mock records (`hostValuesIn`, `crossing.ts`): tracker Q29.
- **Composite builders** stay as they were: a constructor alone can't tell whether a part is counted,
  which depends on the handle's kind and, for a cell, its type entry's `counted` flag, and natives
  build values with no instance at hand.

## R3 Counting

In this order: shadow counts beside tracing, then the switch, then order under counts.

### Shadow counts

- **The one rebuild site is the `Instance` constructor.** `Instance.start` and `Instance.restore`
  both go through it.
  - `Resident.take` returns the held instance, the one that committed and continued through
    `continueFrom`, whenever one is held. It restores only when nothing is held.
  - crashEveryAwait's rerun is usually the held instance plus one restore, and those two share
    nothing.
  - Two restores, or two starts of one unstarted snapshot, happen only when nothing is held: a fresh
    resident or runtime, after `frozenAt`, or a segment started while another runs. Those share
    objects (`live-objects.ts`).
- **What the table survives:** `continueFrom` keeps it.
  - `keepOnly` drops what nothing holds, and that may include counted objects: one of a counted
    type on a cycle that reaches no disposable never reaches zero (design.md §1).
  - So everything `keepOnly` drops is uncounted or reaches no disposable. `keepOnly` reports its
    drops through the seam (R2), so the table forgets those.
- **What is counted** (design.md §9.1):
  - every disposable;
  - a shared struct's cell or a `_Cell` whose type entry is `counted` (written by C3, only read here);
  - a composite value with a counted direct part, decided at its first hold, in `HolderWrites`
    (R2's seam).
- **The check:** every zero is an orphan, and every orphan that reaches a disposable is a zero.
  - Compare each round's `readyOrphans` with the counts' zeroes for the same step.
  - Counted objects whose disposal does nothing are left to `keepOnly` today, so compare those
    against the commit's `#kept`.
  - An object of a counted type on a cycle that reaches no disposable (`let f = fn: f()`) is an
    orphan that never reaches zero. That is legal, and the acceptance includes one.
- **Runners:** `scheduler/wake.sweep.test.ts`, `scheduler/resident.sweep.test.ts` and
  `src/cli/commands/run.sweep.test.ts`.

### Switch

- **What goes:**
  - `HolderWrites`' tracing: what `changed` notes, `takeReleased` and `noteReleased`;
  - the orphan search: `disposablesFrom`, `heldUnlessAll`, `readyOrphans` and `#keptBy`;
  - `#kept`'s invariant scan;
  - `lifetimes/holders.test.ts`, `orphans.test.ts` and `lifetimes.test-kit.ts`, rewritten or
    deleted. The oracle keeps its own copy of the component search.
  - Guard: dependency-cruiser bans release paths from importing the walks (`handlesIn`,
    `heldFrom`).
- **What stays:**
  - per-kind disposal;
  - `DisposalRuns`;
  - `collectEnding`'s attribution;
  - `weak.disposed` after the object is gone;
  - `Slots.#owed`. `takeReleased` clears its flag (`HolderWrites`) today, so it needs a new
    clearing point.
- **At zero, every counted object leaves the heap and its indexes.** Its kind's disposal runs only
  where `isDisposable` says it does something. Otherwise a pending timer nothing holds stays in the
  `pending` index and wakes a live run (`live-run.test.ts`, "lets go of a timer nothing waits on any
  more…").
- **Confirm zeroes at the step's end, not at the decrement.** Several paths let go before they hold
  again:
  - `ResolverEndings.end` replaces the resolver before it readies the `onCancel` runs;
  - `ReadyQueue.next` removes a run before `RunCalls.start` writes its captures;
  - `withPart` rebuilds a value along a path, sharing the parts off it.

  Confirming at the step's end also deletes `#keptBy`: the readied run holds what it calls with
  before the zeroes are confirmed.
- **Ordered as today:** descending id within a batch, holders before what they hold.
- **Until R4,** `persisted` keeps `heldFrom` for the commit's objects and depth, and live runs keep
  `dropUnheld`.

### Order

- **Where order is decided today:**
  - The `release` handler (`interpreter/instructions.ts`) clears in the instruction's list order.
    Lowering writes the lists:
    - a block's end lists `scope.declared`
      (`compiler/lowering/constructs/statements/scopes.ts`);
    - statement and header ends list their temporaries;
    - a guarded scope's failing path lists the declared variables, then the temporaries;
    - exits list the blocks left, innermost first (`variables.ts`);
    - `drop` lists one register;
    - `calls/waits.ts` releases `done`.
  - `releaseFrame` clears registers in ascending order.
  - `Instance.stop` releases frames innermost first.
  - `keep` builds an array in keep order.
  - `#letGoOfTheRest` releases answers, then executions, then constants last.
  - `ContextConstants.release` releases the last one made first.
- **Tests:**
  - corpus `holders/`: `dispose`, `defer`, `function-holdings`, `hold-scopes`, `lifetimes` and
    `exits`; and `combined/scope-teardown`;
  - `lifetimes/orphans.test.ts`;
  - `testing/mocks.test.ts`, "are released with their holder…";
  - `on-cancel.test.ts`'s B76 pair. Its program is a cycle (`d2->r = r`, with `r`'s callback reading
    `d2`), so C3 makes it invalid.

## R4 Only indexes

- **What the scheduler reads besides objects by id:**
  - All 11 indexes in `heap.ts` `indexes` are read: `mocks` (on every call, `Instance.mockOf`),
    `answers`, `hostFutures`, `contextConstants`, `cases`, `positions`, `weakRefs`, `executions`,
    `watches`, `pending` and `resolvers`.
  - The kind lists read are `execution`, `answer`, `outcome`, `run`, `contextConstant` (the roots)
    and `resource` (`arriving` finds one by payload). Mocks are read only through their index and
    `heap.of`.
- **Commit:**
  - Today a commit runs `persisted`, then `snapshotFormat.write`, then reads the text back
    (`wake.ts` `commit`). crashEveryAwait's `runText` encodes again.
  - The root walk can build the objects and the depth in one pass. The format's encoding is a
    second pass unless it is replaced.
- **Weak references:** no index keeps a weak reference alive today. An unheld one is inert
  (`lifetimes/disposal.ts`) and is dropped at the next commit or `dropUnheld`.
  - R4 must keep a weak reference alive as long as its referent, through the `weakRefs` index,
    which "one weak reference per referent" needs.
- **Guards:** live paths can't import a walk (dependency-cruiser), and an uncounted cell is
  reclaimed (a finalization test).

## R5 Unique values in place

- **The copies are listed under "Values: every update copies" above.** A copy is needed only when
  something else still holds the old value. Value semantics require that holder keep its contents.
- **Counts tell uniqueness**, which today's runtime can't know:
  - A composite node held once, and made by this instance, is updated in place.
  - Any other node is copied once on its first write, and the copy holds its parts (+1 each).
- **Never in place:**
  - constants (`definition.constants`, shared by every instance);
  - values a restore shares with another instance or with its snapshot;
  - values derived data is keyed by (`summaries`, `#hashes`, `#tables`), unless that entry is
    dropped with the write.
- **Measure** against P2's figures: 20k-element comprehension, 5k map inserts, `[...0..20000]`.

## Traps

- **Values are shared by identity.** A copy, a constant and a restored snapshot's value can be one
  object. Key per-instance data by identity, never on the value, and never mutate one that isn't
  provably unique (R5).
- **Carriers are executions off the heap.** `DisposalRuns` uses id −1 and `RunCalls` id −2; their
  frames hold values.
- **`LiveExecution.disposing` is never set true,** but it is in the snapshot schema.
- **A mock records its calls' arguments** (`mock.calls`), so it holds every handle it was called
  with, except resources, which it records as their host values. The analysis counts a mock as
  holding anything (design.md §6.3).
- **The runtime's holds must stay within the analysis's.** A native that keeps more than its
  `Keeps` and its object's `Holds` make an edge no check sees, and a cycle through it leaks. C2's
  native audit guards this.
- **A `select`'s losers are released twice** (Q49).
- **Natives keep no handle outside the heap.** What a native keeps, it stores through a capability.
  Pinned extern-constant reads live outside the heap (`segment-effects.ts`, the snapshot's
  `pinned`), but they are sendable and hold no handles.

## Lowering

- **The release points are already lowering's** (`docs/reuse/lowering-and-ir.md`):
  - `release` at block and statement ends, on exits, and for `drop`;
  - `keep` for `hold`;
  - a `select` case's `holds`;
  - `return` releasing every register.

  Counting hooks go at the interpreter's existing write and release sites. The Definition gains only
  `counted` on type entries (C3).
- **Generics are compiled per instantiation,** so every type at an emit site is concrete. The
  Definition's code is untyped by decision.
- **`move`'s TSDoc** (`src/definition/instructions/data.ts`) says it adds a holder; it copies a
  register (Q50).

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
- **Programs inside runtime tests:** 10 runtime test files, plus `callbacks.test-kit.ts`, declare a
  `shared struct` in their programs. Three more declare only `extern shared struct`s. They are
  listed in `tour-checker.md`, C3. C3 must leave them checking clean, or turn them into invalid
  cases as with the B76 pair, before R3 relies on them.
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
| map set (quadratic, P8) | 183 ms | |

The fast path and the per-step check are out of scope.
