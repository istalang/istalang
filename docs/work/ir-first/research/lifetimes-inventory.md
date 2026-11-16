---
description: inventory (2026-11-16) of every lifetime rule in the spec, what lowering decides, what each runtime decides beside executing instructions (duplicates and divergences), what snapshots need from counts, and how natives hold or change values — read before designing or reviewing lifetimes in the IR
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-16
last_updated: 2026-11-16
tags: [lifetimes, inventory, lowering, runtime, codegen, natives, snapshot]
---

# Lifetimes inventory: everything as Definition IR (read-only research)

Legend: S = lowering can place it statically; R = needs a run-time decision; P = the minimal run-time primitive.

## 1. Spec rules (§3.1, §3.3, §3.4, §3.7, §3.14, §3.18, §5, §7, §8, §9)

Copy semantics
- §3.1: copied "field by field, when assigned, passed to a function, returned or sent"; a handle "copies the handle, not the state behind it". S: the type decides, and generics are monomorphized. R only for an in-place update. P: `isUnique(v)` / `makeUnique(v)`.
- §9 "Stable references": a value given to a host "unchanged, is the same JavaScript object"; what a host gets "is frozen". R: a value a host has seen is never unique.
- §3.3: "A by-value parameter is immutable". S: a call argument is a borrow and needs no copy.

References and cells
- §3.7: an element or shared value passed by `&` "is read with `index` before the call … written back with `setIndex`". S: already emitted.
- §3.7: "A referenced variable's storage stays alive until every call holding a reference to it has ended". S for synchronous calls (frames nest). R for a `let` passed to an async call. P: a counted cell; lowering already knows which variables are cells.
- §3.14: "Each captured `let` moves into a cell"; "Copying a closure shares its state". S: which variables are cells. R: the cell's lifetime. P: alloc-cell, retain, release.
- §7 Cycles: "A plain function value may hold anything, since its type doesn't say what it captured". R: releasing a closure dispatches on its function. The IR could carry a release recipe per closure function's capture layout.
- §3.18: `new` makes a cell; `==` compares handles by identity; a shared struct's fields may hold itself. P: `newCell`, identity equality.
- §7: "A cycle of inert values … is allowed"; §5: unreachable shared structs and closures "simply disappear". R, and the main gap for a GC-less LLVM backend: counting cannot free inert cycles. That backend needs a cycle collector, a per-instance arena, or accepted leaks.
- §3.4 transients: "The outermost call holds it, the calls nested in it share its cell"; for async calls, "also once the outermost call has returned". R. P: a per-execution transient-cell slot (inherit or create) plus retain/release by frames.
- §3.4 context constants: made lazily in the reading segment, let go of "last, once everything else it held is disposed, the last made first". R. P: a per-instance list in creation order, drained at instance end.

Holders and release points
- §3.4/§7: a block "releases everything its variables hold" on finishing, `return`, `break`, `continue` or disposal; overwriting "releases the old value". S on every exit path, including an abort at an `await` if lowering emits a cleanup landing per await site.
- `hold` / `hold(name)`: kept until the function, or the labelled scope, ends; `continue` keeps them. S: where the list is made and drained. R: how much it holds. P: a hold list (append, then release all).
- Temporaries end at their statement's end; a header's before its body. S.
- §7: "Copying a value that contains a disposable handle adds a holder … disposed when the count reaches zero". S: which types reach a disposable, so retain/release only for those, with per-type walkers. R: the count. P: retain, release, dispose-at-zero.
- `drop x` disposes at once if nothing else holds the value. S.
- §7: "A running call holds its own future until it suspends … stopped at its next `await`". S: retain on resume, release at each await. R: the call's disposed flag.

Disposal order and atomicity
- §7: values losing their last holder "at the same block exit are disposed in reverse creation order. A value held by another one being disposed loses its last holder only once that disposal is done". R: creation order is dynamic (an earlier value can sit in a later-declared variable). P: a creation sequence number per disposable, and a release batch: collect the zeros, dispose newest first, release their contents into the next round. Where a batch begins and ends could be S.
- §7: deterministic, "never at snapshot time"; synchronous ("`dispose` can't `await`"); atomic, committing with the segment; `onCancel` runs "at once in live code and when the disposing segment commits" in a persistent instance. R. P: a per-segment queue of deferred effects (the scheduler's, not a lifetime decision).
- Dispatch: a user `dispose` is S (resolved like an operator). The std effects are R natives: an async call's future (resolve `disposing()`, stop at the next await); pending take/read/timer (drop the wait); host future (cancel); slot ("it dies, along with the values in it"); Revertible; Deferred.
- §7: "Holding never crosses instances"; §3.12: "Terminating disposes everything it holds"; the root's outcome is disposed when the instance finishes. R. P: instance-end teardown: roots, then context constants.

Weak references, `disposed()`, `disposing()`
- §7: `WeakRef(x)` is "the one weak reference to `x`", `==` even after disposal; `deref()` is `none` "once the last holder has released the value"; `disposed()` resolves "at that moment, already resolved if it has passed, and waiting on it holds nothing", always after the dispose. R. P: a lazily interned weak side per disposable (alive flag, one disposed future) that holds nothing.
- §7 Graceful disposal: when a call's future is disposed, the runtime resolves its `disposing()`; a call suspended where it can resume on it "resumes at once, in the same segment as the disposal, and that case wins over any other". R. P: a per-call disposing future and flag, and a synchronous priority resume.
- After that, "the first `await` the call reaches stops it", and a call not waiting on `disposing()` "is stopped right where it is suspended". R: check the flag at each await, then unwind. The unwind's releases are S given cleanup landings. The root call and a call that has returned are never disposed.

Implicit holds (§6, §7)
- A pending take/read/put holds its slot; the slot's queue holds nothing; a future holds the pending resolvers registered on it; a callback does not keep its future; a pending resolver let go of is cancelled, a never-registered one panics; a readied callback holds its arguments until it runs. R: holder edges between runtime objects. P: the same retain/release on native fields. If futures and resolvers were .ista shared structs, these edges would be ordinary fields with static walkers.

`select` (§8)
- "Each case holds what its expression creates." S: lowering already lists them (`selectCase.holds`).
- Losers' holdings are "released … as the winner is decided, before anything else runs, so a value reaching a losing take's slot right after the winner's stays there". What to release is S; when is R (at decision, not at resume; other executions may run in between). P: a wait carrying each case's holding registers as data, released, and the losers' resolvers cancelled, on decision.
- "The winner's holdings move to the block enclosing the `select`"; a case on the call's own `disposing()` "is kept until the call resumes"; a non-waiting `select` has no losers. S.

Compile-time only: must-use, the cycle rule, and `defer` (which reduces to `Deferred`).

Irreducibly run-time: counts, creation sequence numbers, the weak side, the disposed flag and disposing future, hold-list contents, the transient slot, the deferred-effect queue, decision-time loser release, and reclaiming inert cycles on a GC-less backend.

## 2. What lowering decides today

IR surface (definition/):
- `release { registers }`, `keep { registers, into }` — src/definition/instructions/lifetimes.ts. Header: "The lowering decides every release point, so the runtime never infers scopes". `keep` appends to an array in `into` ("Only `keep` writes `into`, and nothing reads it"); the list register is released like any scope variable.
- `return` — control.ts: "Every register still holding something is released, in reverse creation order of what each one disposes". Which registers are non-empty, and the reverse-creation order, are runtime decisions.
- `select.cases[].holds` — suspension.ts: "A losing case's holdings are released when the winner is chosen". The runtime releases the losers when it resumes (definition.md "Resuming a select releases the losing cases' holdings"). The losing sets are static, but spec §8 times the release "as the winner is decided, before anything else runs". The interpreter does it at decision time (scheduler/instance/index.ts:126 `Waits({decided: … releaseLosers(topFrame(waiter), position)})`), not at the target. So a `release` at each case's target is NOT equivalent, and `holds` must stay data the wait primitive acts on.
- Function entry `counted: Register[]` — tables/functions.ts: "A runtime counting holders per register counts these alone …; the interpreter counts every register." Safe, not exact.
- Function entry `cells: {register, type}[]` — the `_Cell<T>` type entry, so a cell's disposability is known.
- Extern type `counted: boolean` plus `disposal: none|runtime|function{function, host?}` — tables/types.ts:122-158. "The checker decides it (`reachesDisposable`); the runtime only reads it." `isResourceType` (types.ts:~196) derives "resource object behind a handle".
- `currentCall { dst }` — calls.ts: the handle `disposing()` watches. `transient { dst, target }` — data.ts:138.
- Implicit: overwriting a register "ends what it held, with no operation of its own" (checker/surface/flow-ir.ts:26-27). Today the runtime's register write reports old/new (interpreter/registers.ts:93-97 `put` → `frame.heap.changed(heldIn(was), heldIn(contents))`).

Where lowering emits them:
- The checker's flow IR decides the points. checker/surface/flow-ir.ts ops `keep {values, until}` and `release {values, reason: 'end'|'drop'}`, plus `BranchTest.select.holds`. Built in checker/rules/flow/build/{scopes,statements}.ts; checker/rules/disposal/dropped.ts reads them.
- lowering/flow/writer.ts: `#writeBlock` releases an operation's extra registers at once when the operation gives no value (`this.release(extras, …)`), or attaches them to the value (`#extras`) so they are released with it. `release()` at :252 is the single emitter. `listOf(until)` allocates the hold-scope list register (`#held`).
- lowering/flow/operations.ts:67-73: `keep` → `keep` then `writer.release(registers)`; `release` → `writer.release(writer.registersEnding(values))`; `onAwait` call releases the resolver `done` after the call (:267).
- lowering/calls/waits.ts:30 `openWait`: `release [done]` after each case's handOver.
- lowering/functions/frame-variables.ts:183 `computeLeftOut`: releases a default's temporaries (`ended`) in the prologue.
- lowering/flow/exits.ts: `return` emits a bare `return` (no release list).

`counted` computation:
- By type: lowering/flow/variables.ts:98 `holdsType` → `code.holdsCounted` / `code.holdsPlain` via `checker.reachesDisposable(concreteType(…))`. `cellHolds` (:86) remakes a cell's type entry when another field-loop pass binds a disposable-reaching type. synthesized/boundary/codecs.ts:55 `holdsOnlyPlain()` for codecs of plain types.
- By dataflow: lowering/functions/plain-registers.ts `plainRegisters`: a greatest fixpoint over the writes table (`writes: Handlers<…, Instruction, …>`); "opaque" = `call` dst and `&` args, `wait`, `await`, `resolver`, `select` binds, `newCell`, `transient`, `contextConstant`, `currentClosure`. Inputs (params/captures) and cells are "plain by type alone".
- code-writer.ts:299-322 `finish` → `counted = all registers − plain`; `#typedCounted` overrides `holdsPlain` (field loops).
- type-table.ts:306,337: extern entries `counted: checker.reachesDisposable(type)`.

Not decided by lowering today (all left to the runtime): when a count hits zero, disposal order and rounds, copy vs in-place, the hold/let-go on every move/store/field/call argument/result, select-loser release, `return`'s implicit release set, and commit pruning.

## 3. What each runtime decides today (I = interpreter, C = compiled: src/live + src/codegen)

Executing lowering's instructions
- `release`: I `clearRegister` (interpreter/instructions.ts:239); C `scope.emptied` (codegen/instructions/lifetimes.ts:12). Equivalent.
- `keep`: I writes in place (`heap.values.made`/`appended`, instructions.ts:245). C copies, `[...elementsOf(list), ...kept]` (live/values/helpers.ts:23), so O(n²) over a loop's holds. Diverges.
- Select losers: I at decision time (`releaseLosers`, interpreter/suspension.ts:66, called from the Waits `decided` seam), which then needs `noteLosersReleased`/`losersUncollected` (holder-writes.ts:100) to hold off slot serving (slots.ts:129). C releases at resume, in the case branch (codegen/instructions/suspension.ts:38), and cancels resolvers in `Waits.#cancelLosers` (live/waits/waits.ts:247). Diverges, and C's timing contradicts §8.

Run-time decisions
- D1 Which objects are counted: I `countedIn(types)` (holder-writes.ts:120): all but roots and weakRef; cells and resources by `countsHoldersOf` (counts.ts:36: `entry.counted || disposalOf(...).kind !== 'none'`). C calls the same `countsHoldersOf` on every cell or resource made (live/run.ts:205, :222). Shared predicate, but evaluated per made object; the IR could carry it at the make site.
- D2 Which registers report holder writes: I every one (registers.ts:96 `put` → `heap.changed(heldIn(was), heldIn(contents))`), ignoring lowering's `counted`. C only `entry.counted` ones (`lt.swap`/`lt.release`, codegen/entry-scope.ts:81, :133), with `lt.uncounted` asserts behind `checksCounted`. Double standard.
- D3 Which composite values are count nodes: I counts every composite (`new Counts()`, counts.ts:44), because in-place needs it. C uses `new Counts(this.#reachesCounted)`: `#findReach` walks each value at run time, memoized per node in a WeakMap (live/lifetimes/lifetimes.ts:166-195). Whether a value reaches a counted object is a type fact lowering could emit.
- D4 A zero is only a candidate: `Counts.takeZeroes` (shared, counts.ts:125). Hand-over (hold the new value before letting go of the old): I `HolderWrites.handOver` (holder-writes.ts:70; returns.ts:51, slots.ts:79); C emits it inline for `return` (`t = v; lt.hold(t); <releases> lt.release(t)`, entry-scope.ts:104). One rule, coded twice; it could be one IR sequence.
- D5 When to collect: I after every step (`SegmentCollection.collected`, scheduler/segment/collection.ts:66). C's emitter picks per instruction, `if (lt.due) lt.collect();` (codegen/code-entry.ts:81, :96), skipping its `collectsNothing` set. C `Lifetimes.deferring` while the root's encoder runs (live/run.ts:356); I gets that structurally (encoder on top of the root frame).
- D6 Rounds and order: shared `Collector` (runtime/lifetimes/collector.ts), newest first (`sort((a, b) => b - a)`), next round after. I only: disposal code runs on the run stack (`returned`, `abandoned`, `panicked`). C `run` returns `true` synchronously (lifetimes.ts:76).
- D7 Disposability per kind: I kind table `kinds` and `futureStates` (runtime/lifetimes/disposal.ts:124, :138). C an `instanceof` chain `isDisposable` (live/lifetimes/disposal.ts:47), whose banner says "as the interpreter's … says it". DUP. I alone covers `mock` and slot futures.
- D8 What disposal does per kind: `disposeFuture` in both (I disposal.ts:252, C disposal.ts:99): cancel resolvers, notify, then cleanup case or `stop`. Cell or resource: the declared `dispose`. Wait: cancel its pending cases. Resolver: the same panic text in both (`'A resolver was let go of unresolved…'`, I :162, C :83). I alone drops slot futures from the queue. DUP.
- D9 Helpers written twice: `isAwaited` (I disposal.ts:186, C run-lifetimes.ts:91), `isDropped` (I :173, C disposal.ts:126), `cleanupCase` (I `instance.waits.cleanupCase`, C run-lifetimes.ts:66).
- D10 Stopping a suspended call: I `instance.stop(execution)` releases its frames. C `Executions.stop` → `execution.body.return()` (live/executions.ts:79), with the emitted `} finally { lt.release(rN) … }` (code-entry.ts:88). The release list comes from `scope.counted`, not from an IR instruction.
- D11 What each object holds: I `Heap.held`/`#indexedHolds`/`#awaited`/`#readers` (scheduler/instance/heap.ts:289-356) plus snapshot/holdings.ts `heldBy`, reported eagerly on every heap write (heap.ts:173-189). C live/lifetimes/holdings.ts `heldBy`/`readersOf`/`awaited`/`heldFromRoot` ("as the interpreter's holdings say it"), reported lazily (`touch` → `#reconcile` → a `sameHeld` diff, lifetimes.ts:199-238). DUP.
- D12 Weak side: scheduler/instance/weak-side.ts vs live/lifetimes/weak-side.ts, the same API (`reference`, `target`, `watch`, `disposed`, `disposing`, `watchesCall`, `returned`). I keeps a heap object, C a WeakMap. DUP.
- D13 In-place vs copy: I `InPlace` (runtime/lifetimes/in-place.ts) decides on every write: mutate only when `#own`, `holdersOfNode(node) === 1` and not `inserted`, else copy from that node down, forgetting derived data. Callers: registers.ts:107, :152, :158; instructions.ts:183, :201, :255, :300. C always copies (`withPartAt`, helpers.ts:40; `Place.changes`). Double standard.
- D14 Copying at boundaries (I only, a consequence of D13): crossing.ts ("Every value crossing is rebuilt, so none is shared with the instance it left, which may change its own in place") and root-outcome.ts:34 `copied`.
- D15 End of run: C `#letGoOfTheRest` (live/run.ts:362): the root future, then suspended calls oldest first, then context constants last. It mirrors I's `releaseRoot`/finish by comment only.

Summary
- Duplicated: D7, D8 (down to the panic text), D9, D11, D12, D4, D15.
- Shared already: `Counts`, `Collector`, `countsHoldersOf`, `disposalOf`.
- Divergent policy: D2, D3, D13, `keep`'s cost, the timing of loser release.
- IR could carry: counted-ness per make site (D1); per-type "reaches counted" (D3); collect points (D5); hand-over and hold/release sequences (D4); the stop/unwind release list (D10); ownership for in-place (D13), as static ownership plus a run-time `holders == 1` check at minimum.
- Run-time by nature: zero confirmation, round order, state-dependent disposability of futures, waits and resolvers, and `deref()`.

## 4. What snapshots/restore need from counts

- Nothing about holders is persisted. definition.md "Decisions → What a snapshot stores": "Nothing about holders is stored: an instance counts the holders … rebuilt from its objects whenever it is made". Rejected alternative: "Persisted reference counts: they could disagree with the values they count". Same in snapshot/objects.ts:10-11.
- Persisted ordering facts: `objectsMade` (snapshot.ts:107), so "id order is creation order, which disposal follows in reverse" (objects.ts:6-9). That is the only lifetime ordering a snapshot carries.
- Restore rebuilds counts by replaying holder writes: scheduler/instance/index.ts:113-122 `heap.restore(objects)` → heap.ts:89 `#write(objects.map(now => ({old: undefined, now})))`; then `restoreRegisters` (live-objects.ts:54) fills each frame register through `placeContents` → `put`, which reports `heap.changed(heldIn(was), heldIn(contents))`. "Every one is in before any reports what it holds, as one may hold another made after it" (heap.ts:85-87).
- What-holds-what rules are shared by live and stored forms: snapshot/holdings.ts (`heldBy`, `heldIn`, `frameValues`, `frameCells`, `isRoot`, `isHeldFromRoot`): "A frame holds the same whether it is live … or stored …, so one rule reads both". The compiled runtime has its own `heldBy` (live/lifetimes/holdings.ts:40), keyed by its `WaitIndexes`: a second implementation of the same table.
- Commit pruning is a walk, not counts: instance/index.ts:205-222 `#kept()` → lifetimes/holders.ts `heldFrom` (roots = executions' frames + `rootKinds`), the same walk that computes `maximumDepth`. It asserts `unreachable('Object … lost its last holder without being disposed.')` for a disposable left unreached, a cross-check of counting. `continueFrom` → `heap.keepOnly(...)`.
- In-place depends on identity, not counts alone: in-place.ts:8-10: never write in place "a value a restore shares with another instance or its snapshot"; such a value is copied at its first write. So restore needs the "own" set empty (everything restored counts as foreign), not just counts.
- Disposability is derived, never stored (objects.ts:21-27): from kind/state, type entry `disposal`, and "whether a weak reference refers to it". `weakRef.target` is persisted as id | 'disposed' | 'callEnded'.
- Codegen/live never commits ("Live code waits in memory and never commits", definition.md Frames `mode`), so today only the interpreter restores. An LLVM backend persisting instances would need the same: no counts in the format, rebuilt by a holder-write replay or a walk.
- Implication for an IR-driven design: if lowering wrote explicit hold/let-go primitives, the snapshot would still not store counts. Restore would need a primitive "recount from roots" (or replay), with per-register `counted`/type info to know which registers and handles count.

## 5. Natives

The seam: a native gets plain values, never references.
- `src/runtime/natives.ts`: `NativeContext.changes(position) → ValueChanges` (push, pop, reverse, splice, setEntry, deleteEntry), each made "in place when nothing else holds it, else in a copy that takes its place". The result is written back to the referenced place.
- Interpreter: `scheduler/segment/native-calls.ts` `NativeCalls.call` sets `changes: (p) => changesAt(heap, referenceAt(contents, p))` → `interpreter/registers.ts` `changesAt` → `in-place.ts` `InPlace.changesAt`. `#open` copies from the first path node with `!#own.has(node) || holdersOfNode(node) !== 1 || inserted.includes(node)`; edits report `partHeld`/`partReleased` and forget derived data (`forgetSummary`, `forgetPlainOf`, `written.forget`).
- Compiled: `live/natives-context.ts` `boundExtern`: `changes: (p) => objectOf(passed[p], Place).changes()`. `live/values/place.ts` `Place.changes()` **always copies** (`[...elementsOf(this.read())]`, `copiedMap`); the banner says the decision is still to come ("tracker P51, js-codegen P3"). So a push loop is quadratic in compiled code and linear in the interpreter.
- **DUP:** the six operations are written twice: `InPlace` #push/#pop/#splice/#setEntry/#deleteEntry/#reverse and `Place.changes`. They share only `setEntryInPlace`, `deleteEntryInPlace` and `copiedMap` (definition/values/equality.ts).

Natives that change a `&` argument (the only callers of `context.changes`):
- `stdlib/prelude/arrays.ts` `changingNatives`: push, pop, reverse, `setIndex(Int)` (a 1-item splice), `setIndex(Range)` (`splicesOf`).
- `stdlib/prelude/maps.ts`: delete (`deleteEntry`), `setIndex` (`setEntry`).
- Plain index and `withPart` writes are not natives. The interpreter does them with `InPlace.withPart`, `appended` and `withEntries`; compiled code with `Place.write` and `withPartAt`.

Natives that build or share values:
- These make fresh values: slice, flat, `index(Range)`, `_patternRest`, keys, values, entries, default, plus the decimal, crypto, strings, regex, time and math natives. A native's result is never "own" (`InPlace.made` is called only from interpreter/instructions.ts:255,300), so the first write to it copies.
- These share a part uncopied: index, at, get, `_patternItem`, `_entryAt`.

Natives that make a runtime object hold a value (through a capability; in the interpreter every `Heap` write is reported to `HolderWrites.changed`, heap.ts:182-199; compiled code derives the same edges in `live/lifetimes/holdings.ts` `heldBy`, "as the interpreter's holdings say it" — **DUP**):
- Slots: `put` (`@Keeps{["self": ["value"]]}`) → `Slots.operate`, which queues a future holding the value or stores it with `holders.handOver`. Compiled: `slots: { put: interpreterOnly('Slots') }`.
- Waits: `onAwait` (`@Keeps self←done`), `onCancel` (`@Keeps self←callback`), `Resolver.of` and `Resolver.at` (struct `@Holds<…>`), and `resolve`/`tryResolve`, which settle a future that then holds the value.
- Weak references: `WeakRef.from` holds nothing (`countedIn` excludes weakRef); `deref`; `disposed`/`disposing` → `weak.watch`.
- `json.decodeHandle` → `resources.create`. `testing._mock` holds its replacement. `json._remember` caches written JSON keyed by identity, "held for good"; an in-place change must forget it (`#forgetWholeOf`; compiled: `WrittenJson`).
- Crossing instances (spawn, `contexts.call`, open) copies: `scheduler/instance/crossing.ts` `leavingCall`, `leaving`, `arriving`: "Every value crossing is rebuilt, so none is shared with the instance it left".

What the IR lacks:
- `@Keeps` and `@Holds` live only in the checker (`keepsOf`, `externHeldOf`, rules/lifetimes/externs.ts). native-audit.test-kit.ts:16: "the Definition carries neither annotation". The audit (`HeapCheck.native`) reads the checker's table. Default (§3.16): a `&` parameter keeps every other parameter.
- The IR could carry instead:
  (a) per `&`-native call site, an ownership fact or a `unique` operand, replacing `#own`/`holdersOfNode` and `Place`'s always-copy;
  (b) each extern's keeps/holds table in its function entry, so a GC-less backend knows what holder edges a call creates;
  (c) the six `ValueChanges` as IR primitives (arrayPush, mapSet, …), each backend implementing them once;
  (d) copy-on-cross as an explicit `copy` at spawn and context-call sites, instead of crossing.ts.

## Cross-cutting: what the IR could carry instead (collected from the evidence above)
- Counted-ness at each make site (cell, resource) and per register. Today I ignores `counted` and C re-derives node reach at run time.
- An explicit hand-over, hold and let-go per write of counted values; it replaces I's every-write reporting and C's emitter-placed `swap`/`release`.
- Per-await cleanup landings with their release lists (stopping a call, disposal), so C's `finally` list and I's `stop` read IR, not `scope.counted`.
- Collect points (I collects every step; C's emitter chooses).
- Ownership operands for in-place updates (`unique`, or ownership plus a `holders == 1` check), and the six `ValueChanges` as primitives.
- Each extern's `@Keeps`/`@Holds` table in its function entry (today checker-only).
- Copy-on-cross as explicit `copy` instructions at spawn and context calls.
- Must stay run-time: counts and zero confirmation, creation-order rounds, the weak side, the disposed flag and priority resume, decision-time loser release, the deferred-effect queue, and inert-cycle reclamation on a GC-less backend.


