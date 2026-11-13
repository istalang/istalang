# Runtime (`src/runtime`) DRY & Design Findings

### [high] Double standard & DRY violation: `nativeResourcesOf.create` allocates duplicate resource objects for identical host payloads whereas `arriving` interns them by `(type, samePayload)`
- where: `src/runtime/scheduler/segment/native-calls.ts:193-197`, `src/runtime/scheduler/instance/crossing.ts:69-79`, `src/stdlib/json/natives.ts:62-71`
- evidence: When a value of a disposable host type (`isResourceType`) arrives in an instance across an instance or mock boundary, `arriving` (`crossing.ts:71-76`) interns it against existing heap resources (`const known = instance.heap.objectsOf('resource').find((each) => each.type === part.type && samePayload(each.payload, part.payload)); const resource = known ?? instance.heap.add(...)`) so a resource that leaves and comes back keeps its handle identity (`==`) and is disposed once (§3.6). By contrast, when a compiled host extern wrapper decodes a resource arriving from a real host (`json._decodeHandle` -> `context.resources.create(type, payload)` in `native-calls.ts:193-197`), `nativeResourcesOf.create` unconditionally allocates a new heap object (`heap.add((id) => ({ kind: 'resource', id, type, payload }))`) without checking `known`. A resource echoed back by a real host extern therefore gets a second object id (`!=` the original) and is disposed twice.
- proposal: Extract a single `resourceHandle(heap: Heap, type: TypeId, payload: unknown): Value` helper in `src/runtime/scheduler/instance/crossing.ts` (or `heap.ts`) that looks up an existing `resource` by `each.type === type && samePayload(each.payload, payload)` before calling `heap.add`, and call it from both `arriving` (`crossing.ts:71-77`) and `nativeResourcesOf.create` (`native-calls.ts:193-197`).
- confidence: high

### [high] Split root-call initialization and punning across `Instance.start`, `Resident.take`, `wake.ts`, `SegmentRunner.#started`, and `RootOutcome.callExtern`
- where: `src/runtime/scheduler/instance/index.ts:144-160`, `src/runtime/scheduler/resident.ts:41-50`, `src/runtime/scheduler/wake.ts:212-220`, `src/runtime/scheduler/segment/index.ts:61-66, 81-101, 141-156`, `src/runtime/scheduler/segment/root-outcome.ts:129-138`
- evidence: Starting an `unstarted` snapshot's `status.call` is split across five modules, using `instance.root() === undefined` as a sentinel for "the root call is an extern":
  1. `Instance.start` (`instance/index.ts:144-155`, which has only 2 callers: `resident.ts:48` and `live-run.ts:50`) looks up `loaded.functions.callee(call.function)` and calls `instance.startExecution(...)` only when `callee.kind === 'code'`, leaving `instance.root()` as `undefined` when `callee.kind === 'native'`.
  2. `Resident.take` (`resident.ts:46-49`) branches on `this.#committed.status.kind === 'unstarted' ? Instance.start(...) : Instance.restore(...)`.
  3. `runFrom` (`wake.ts:213-220`) checks `const root = instance.root()` on an `unstarted` instance to reconstruct whether `Instance.start` saw code or a native (`root === undefined ? { kind: 'call', call: status.call } : { kind: 'driver', execution: root }`).
  4. `SegmentRunner.#started` (`segment/index.ts:141-152`) dispatches `{ kind: 'call' }` to `this.#outcome.callExtern(first.call)` and `{ kind: 'driver' }` to `first.execution`.
  5. `RootOutcome.callExtern` (`root-outcome.ts:129-138`) looks up `instance.loaded.functions.callee(call.function)` a second time and asserts `callee.kind === 'native'`.
  Meanwhile, `startAnswering` (`segment/answering.ts:30-42`) handles starting a code or native call at segment start in one place. Also, `startLiveSegment` and `runLiveSegment` (`segment/index.ts:81-101`) are identical 7-line wrappers around `new SegmentRunner(instance, now, waiting).runLive(...)` differing only in whether `root` or `undefined` is passed.
- proposal: Move starting `status.call` (both `code` and `native`) into `RootOutcome.start(call: InstanceCall): LiveExecution | undefined`, called from `SegmentRunner.#started` when `first?.kind === 'call'`. Collapse `Instance.start` and `Instance.restore` into one constructor (`Instance.from(loaded, snapshot)`), simplify `Resident.take()` to `this.#held ?? Instance.from(this.loaded, this.#committed)`, remove `{ kind: 'driver' }` from `SegmentStart`, and merge `startLiveSegment` into `runLiveSegment(instance, now, waiting, first?: LiveExecution)`.
- confidence: high

### [high] Feature reduction & DRY violation: `RootOutcome` duplicates future-following (`Futures.#futureIn` / `endOf`) and splits encoder invocation across two paths
- where: `src/runtime/scheduler/segment/root-outcome.ts:108-220`, `src/runtime/scheduler/segment/returns.ts:43-52, 76-82, 95-103`, `src/runtime/scheduler/instance/futures.ts:118-156`
- evidence:
  1. `RootOutcome.#awaited` (`root-outcome.ts:158-169`) checks `const future = handleTarget(value); if (future === undefined || heap.objectOf(future).kind !== 'future') return { value };`, which is an exact copy of `Futures.#futureIn(value)` (`futures.ts:150-155`).
  2. `RootOutcome` has two separate paths for calling the outcome encoder (`#encodes` in `root-outcome.ts:183-196` when a root frame returns vs. `arrival` in `root-outcome.ts:139-156` when an extern or awaited `outcome` future resolves), both calling `this.#encoderCall(outcome)` and branching on `target.kind === 'answered'` vs `'code'`.
  3. Because a direct root execution (`spawn(make)`) releases its frame inside `landReturn`'s `handOver(value, ...)` (`returns.ts:48-50`) and releases `value` in the same step before collection, whereas a deferred root (`spawn make()`) resolves a call future awaited by `outcome`, `spawn(make)` disposes the returned outcome before the root frame's `defer` (`spawn.test.ts:264`, B82).
- proposal: Expose `Futures.futureIn(value)` (or move `RootOutcome.#awaited`'s future check into `Futures`) so `root-outcome.ts` does not duplicate `#futureIn`; unify the encoder call handling in `RootOutcome`; and keep the root's returned outcome held until the root frame's release is collected so `spawn(make)` and `spawn make()` share the same disposal order.
- confidence: high

### [high] Dead field in persisted snapshot schema and live heap: `execution.disposing` is never set to `true` or read
- where: `src/runtime/snapshot/objects.ts:251`, `src/runtime/scheduler/instance/heap.ts:54`, `src/runtime/scheduler/instance/index.ts:285`, `src/runtime/scheduler/segment/disposal-runs.ts:48`, `src/runtime/scheduler/segment/run-calls.ts:22`
- evidence: `heapObject`'s `execution` schema defines `disposing: z.boolean()` (`objects.ts:251`) and `LiveExecution` defines `readonly disposing: boolean` (`heap.ts:54`). Every construction site (`instance/index.ts:285`, `disposal-runs.ts:48`, `run-calls.ts:22`) sets `disposing: false`, and nothing in `src/` ever reads `.disposing` on an execution or sets it to `true`. Disposed calls running their `disposing()` cleanup are tracked in memory within a segment by `DisposalRuns.#cleanups = new WeakSet<LiveExecution>()` (`disposal-runs.ts:39`) and cannot persist across a commit because cleanup aborts at its next `await` or `return`.
- proposal: Remove `disposing` from the `execution` schema in `src/runtime/snapshot/objects.ts`, from `LiveExecution` in `src/runtime/scheduler/instance/heap.ts`, and from the execution literals in `instance/index.ts`, `disposal-runs.ts`, and `run-calls.ts`.
- confidence: high

### [high] Dead callback abstraction and duplicated timer wait in `drive` (`Driving.wait` always returns `false`)
- where: `src/runtime/testing/world/drive.ts:20-26, 55-75`, `src/runtime/testing/world/index.ts:143-156`, `src/runtime/runtime.test-kit.ts:189-206`
- evidence: `Driving` (`drive.ts:20-26`) requires both `now: () => bigint` and `wait: (due: bigint | undefined) => Promise<boolean>`, and `waitForTimer` (`drive.ts:66-68`) checks `if (!(await wait(due)) && due === undefined) return 'settled';`. The only two callers of `drive` in the repository (`testing/world/index.ts:143` and `runtime.test-kit.ts:189`) both pass `now: clock.now` and the exact same 6-line `wait` callback:
  ```ts
  wait: async (due) => {
    if (due !== undefined) {
      await clock.until(due);
    }
    return false;
  },
  ```
  Because `wait` always returns `false`, calling `await wait(undefined)` when `due === undefined` is a no-op, and the branch where `wait` returns `true` is dead code.
- proposal: Replace `now` and `wait` on `Driving` (`src/runtime/testing/world/drive.ts`) with `clock: Clock`. In `waitForTimer`, return `'settled'` immediately when `due === undefined`, return `'late'` when `deadline !== undefined && due > deadline`, and otherwise `await clock.until(due)` before waking `group.dueBy(clock.now())`. Remove the duplicated `wait` callbacks in `src/runtime/testing/world/index.ts` and `src/runtime/runtime.test-kit.ts`.
- confidence: high

### [med] DRY violation: `Counts.#hold` and `Counts.#release` duplicate the explicit-stack composite value walk
- where: `src/runtime/lifetimes/counts.ts:86-98, 113-166`
- evidence: In `Counts`, `#hold` (`counts.ts:113-121`) and `#release` (`counts.ts:123-131`) contain identical loops over `holds` and identical explicit-stack DFS loops (`const pending: Value[] = [...values]; for (let value = pending.pop(); value !== undefined; value = pending.pop()) { pushAll(pending, ...); }`), and `#holdValue` (`counts.ts:134-147`) and `#releaseValue` (`counts.ts:150-166`) both check `if (!isComposite(value)) return []; if (value.kind === 'handle') { ...; return []; }` before updating `this.#nodes`.
- proposal: Extract a private `#walk({ values, holds }: Held, onObject: (id: number) => void, onNode: (node: CompositeValue) => readonly Value[]): void` method in `Counts` (`src/runtime/lifetimes/counts.ts`) that handles `holds`, the `pending` stack, `!isComposite`, and `value.kind === 'handle'`, called by both `#hold` and `#release`.
- confidence: high

### [med] DRY violation: `DisposalNotices.onDisposed` copies the array on append instead of using `addToGroup`
- where: `src/runtime/scheduler/instance/disposal-notices.ts:8-13`
- evidence: `docs/reuse/structures-and-invariants.md` specifies `addToGroup` (`src/foundation/structures/groups.ts`) for adding items one at a time to a `Map<K, V[]>`, with the one-way rule: "A group is filled in place (`addToGroup`, `Map.groupBy`), never copied to append one item (`[...group, item]`), which makes filling it quadratic". `DisposalNotices.onDisposed` (`disposal-notices.ts:11-13`) writes `this.#notices.set(id, [...(this.#notices.get(id) ?? []), notice]);`.
- proposal: Call `addToGroup(this.#notices, id, notice)` from `src/foundation/structures/groups.ts` in `DisposalNotices.onDisposed`.
- confidence: high

### [med] DRY violation: `Futures.resolveDueTimers` and `settle-order.ts` re-implement `compareOrdered` (`foundation/language/order.ts`)
- where: `src/runtime/scheduler/instance/futures.ts:272`, `src/runtime/scheduler/instance/waits/settle-order.ts:53-65`
- evidence: `docs/reuse/values-and-equality.md` indexes `compareOrdered` (`src/foundation/language/order.ts`) to "order two `bigint`s or UTF-16 `string`s". `Futures.resolveDueTimers` (`futures.ts:272`) sorts `bigint` timestamps with `.toSorted((first, second) => Number(first - second))` (which also converts `bigint` difference to `Number`), and `compareRanks` (`settle-order.ts:59-61`) compares `bigint` rank elements with `if (element !== other) { return element < other ? -1 : 1; }`.
- proposal: Use `compareOrdered` from `src/foundation/language/order.ts` in `Futures.resolveDueTimers` (`futures.ts:272`) and `compareRanks` (`settle-order.ts:59`).
- confidence: high

### [med] DRY violation: `native-calls.ts` re-implements `handleObject` and duplicates `leavingCall`'s `closureOf` check
- where: `src/runtime/scheduler/segment/native-calls.ts:44, 199-204, 229-233`, `src/runtime/scheduler/instance/crossing.ts:52-60`
- evidence:
  1. `native-calls.ts:44` already imports `handleObject` from `../instance/heap.ts` (using it at lines 171 and 269), which unwraps `handleTarget(handle)` or calls `unreachable`. Yet `nativeResourcesOf.payloadOf` (`native-calls.ts:199-204`) manually writes `const id = handleTarget(handle); if (id === undefined) unreachable(...); return heap.of(id, 'resource').payload;`.
  2. `nativeInstancesOf.spawn` (`native-calls.ts:229-233`) checks `const closure = closureOf(entry) ?? unreachable(...); const call = leavingCall(instance, closure);`, but `leavingCall(instance, closure: Value)` (`crossing.ts:52-55`) already takes `Value` and performs `closureOf(closure) ?? unreachable(...)` itself (as `native-contexts.ts:61` relies on).
- proposal: In `src/runtime/scheduler/segment/native-calls.ts`, simplify `payloadOf` to `(handle) => heap.of(handleObject(handle), 'resource').payload`, pass `entry` directly to `leavingCall(instance, entry)` in `spawn`, and remove the unused `closureOf` and `handleTarget` imports from `native-calls.ts`.
- confidence: high

### [med] DRY violation: `hasEnded` (`instance-state.ts`) is not a type guard, forcing `contexts.ts` to define a complementary `runs(state)` type guard
- where: `src/runtime/instance-state.ts:58-60`, `src/runtime/host/contexts.ts:102, 297, 313, 342-352`, `src/runtime/runtime.test-kit.ts:211-213`
- evidence: `hasEnded({ kind }: InstanceState): boolean` in `instance-state.ts:58-60` checks `kind === 'finished' || kind === 'panicked' || kind === 'terminated'`, the exact complement of `kind === 'ready' || kind === 'waiting'`. Because `hasEnded` returns `boolean` instead of narrowing `InstanceState`, `contexts.ts:342-346` defines `function runs(state: InstanceState): state is Extract<InstanceState, { kind: 'ready' | 'waiting' }>` and `runtime.test-kit.ts:211-213` re-checks `state.kind === 'waiting' || state.kind === 'ready'`.
- proposal: Change `hasEnded` in `src/runtime/instance-state.ts` to `export function hasEnded(state: InstanceState): state is Exclude<InstanceState, { kind: 'ready' | 'waiting' }>`, and replace `runs(state)` in `src/runtime/host/contexts.ts` and the manual check in `src/runtime/runtime.test-kit.ts:212` with `!hasEnded(state)` / `hasEnded(state)`.
- confidence: high

### [med] DRY violation: Earliest timer reduction is implemented four times across `inspect.ts`, `futures.ts`, `instance-group.ts`, and `live-run.ts`
- where: `src/runtime/scheduler/inspect.ts:66-75`, `src/runtime/scheduler/instance/futures.ts:254-263`, `src/runtime/host/instance-group.ts:53-62`, `src/runtime/scheduler/live-run.ts:113-118`
- evidence: Four functions in `src/runtime` compute the minimum `bigint | undefined` timestamp:
  - `nextTimerOf(snapshot)` (`scheduler/inspect.ts:66-75`): `earliest === undefined || object.state.at < earliest ? object.state.at : earliest`
  - `Futures.nextTimer()` (`scheduler/instance/futures.ts:254-263`): `earliest === undefined || state.at < earliest ? state.at : earliest`
  - `InstanceGroup.earliestTimer()` (`host/instance-group.ts:53-62`): `earliest === undefined || state.until < earliest ? state.until : earliest`
  - `earliest(first, second)` (`scheduler/live-run.ts:113-118`): `first < second ? first : second`
- proposal: Define `earliestOf(times: Iterable<bigint | undefined>): bigint | undefined` (or `earlier(first: bigint | undefined, second: bigint | undefined): bigint | undefined`) in `src/runtime/clock.ts` and use it in `inspect.ts`, `futures.ts`, `instance-group.ts`, and `live-run.ts`.
- confidence: high

### [med] DRY violation: `stored-instances.ts` and `wake.ts` decode snapshots from `InstanceStore` by hand instead of using `storedSnapshot` (`instance-ends.ts`)
- where: `src/runtime/scheduler/instance/instance-ends.ts:26-44`, `src/runtime/host/stored-instances.ts:22-26`, `src/runtime/scheduler/wake.ts:276-282`
- evidence: `storedSnapshot(store, instance)` (`instance-ends.ts:26-44`, indexed in `docs/reuse/runtime-and-persistence.md`) reads `store.readSnapshot(instance)` and memoizes `snapshotFormat.read(text)` per `(store, instance, text)` (used by `storedEnds`, `Contexts.#resume`, and `World.#resident`). However, `storedInstance` (`stored-instances.ts:22-26`) calls `store.readSnapshot(instance)` + `snapshotFormat.read(text)` directly without the cache, and `commitChildren` (`wake.ts:276-282`) also calls `store.readSnapshot(child.instance)` + `snapshotFormat.read(stored)` directly.
- proposal: Use `storedSnapshot(store, instance)` in `storedInstance` (`src/runtime/host/stored-instances.ts:22-26`) and `commitChildren` (`src/runtime/scheduler/wake.ts:276-282`).
- confidence: high

### [med] DRY violation: Panic `Result` (`Err(Error)` with `code: 'panic'`) construction is duplicated between `instance-ends.ts` and `native-contexts.ts`
- where: `src/runtime/scheduler/instance/instance-ends.ts:22, 47-63`, `src/runtime/scheduler/segment/native-contexts.ts:23, 114-124`
- evidence: `instance-ends.ts:22` exports `export const panicCode = 'panic'` only so `native-contexts.ts:121` can construct the exact same panic `Err(Error)` value (`errorOf(types, result, { message, code: panicCode, trace })`) that `endOf` in `instance-ends.ts:58` constructs when an instance panics or terminates.
- proposal: Export `panicErrorOf(types: readonly TypeDefinition[], result: TypeId, panic: { readonly message: string; readonly trace: string }): Value` from `src/runtime/scheduler/instance/instance-ends.ts` (calling `errorOf(types, result, { ...panic, code: 'panic' })`), call it from both `endOf` and `answering` (`native-contexts.ts:121`), and unexport `panicCode`.
- confidence: high

### [med] DRY violation: Instruction lookup at `frame.pc` (`instructionAt`) and wait-register extraction are duplicated across `inspect.ts`, `waits.ts`, `check/index.ts`, and `suspension.ts`
- where: `src/runtime/scheduler/inspect.ts:25-35`, `src/runtime/snapshot/check/waits.ts:68-74, 193-196`, `src/runtime/snapshot/check/index.ts:202-214`, `src/runtime/interpreter/suspension.ts:32-56`
- evidence:
  - `waitingPointOf` (`scheduler/inspect.ts:26-27`) and `instructionAt` (`snapshot/check/waits.ts:193-196`) both write `const code = definition.functions[frame.function]; const instruction = code?.kind === 'code' ? code.instructions[frame.pc] : undefined;`.
  - In `interpreter/suspension.ts:32-56`, `waitAt(frame)` checks `instruction?.kind === 'await' || instruction?.kind === 'select' ? instruction.wait : undefined`, `stoppedAt(frame)` checks `waitRegister(instruction) !== undefined ? waitAt(frame) : undefined` (reading `frame.code.instructions[frame.pc]` twice), and `takeWait(frame)` calls `waitAt(frame)` and then re-reads `frame.code.instructions[frame.pc]` and re-checks `instruction?.kind === 'await' || instruction?.kind === 'select'` to clear `instruction.wait`.
- proposal: In `src/runtime/interpreter/suspension.ts`, extract `waitRegisterOf(instruction)` (or `waitRegisterAt(frame)`) returning `instruction.wait` for `await` or `select` so `waitAt`, `stoppedAt`, and `takeWait` share a single instruction read and check. Export `instructionAt(definition, frame)` from `src/runtime/snapshot/objects.ts` (or `definition/tables/functions.ts`) and reuse it in `inspect.ts` and `snapshot/check/waits.ts`.
- confidence: high

### [med] Belongs in `.ista` / Generalization: `_call` and `_jobCall` in `stdlib/runtime/` are duplicate externs and natives differing only by `maker: 'program' | 'jobs'`
- where: `src/stdlib/runtime/runtime.ista:95-108, 197, 199, 208`, `src/stdlib/runtime/natives.ts:38-39, 45-59`, `src/runtime/scheduler/run-contexts.ts:21`
- evidence: `src/stdlib/runtime/runtime.ista` declares two separate generic externs with identical parameter and return types (`extern live fn _call<R is Sendable>(...)` and `extern live fn _jobCall<R is Sendable>(...)`), and `src/stdlib/runtime/natives.ts:38-59` registers two separate natives via `contextCallKey(keys, '_call'): contextCall('program')` and `contextCallKey(keys, '_jobCall'): contextCall('jobs')`.
- proposal: Replace `_call` and `_jobCall` with a single extern `extern live fn _call<R is Sendable>(runtime: _Runtime, key: String, f: sendable ista async fn() -> R, jobs: Bool = false) -> Future<Result<R>, "live">` in `src/stdlib/runtime/runtime.ista` and a single native in `src/stdlib/runtime/natives.ts`.
- confidence: high

### [low] Dead method `RunStack.callFutures()` and unused `WithResources` capability in `host-natives.ts`
- where: `src/runtime/scheduler/segment/run-stack.ts:113-116`, `src/runtime/boundary/host-natives.ts:45, 75`
- evidence:
  - `RunStack.callFutures()` (`run-stack.ts:113-116`) has zero callers in the entire repository (neither production nor test). It is a remnant from before `RunStack.drive`/`push`/`pop` reported `futuresOf(...)` directly to `HolderWrites.changed`.
  - `src/runtime/boundary/host-natives.ts:45, 75` imports `WithResources` and includes `& WithResources` in `type HostContext = NativeContext & WithFutures & WithResources`, but nothing in `host-natives.ts` ever accesses `context.resources` (resource creation moved to `json._decodeHandle` in `src/stdlib/json/natives.ts`).
- proposal: Delete `callFutures()` from `RunStack` (`src/runtime/scheduler/segment/run-stack.ts:113-116`) and remove `WithResources` from `src/runtime/boundary/host-natives.ts:45, 75`.
- confidence: high

### [low] Exports used only by tests or never imported outside their defining file
- where: `src/runtime/snapshot/holdings.ts:140`, `src/runtime/scheduler/instance/instance-names.ts:8`, `src/runtime/scheduler/instance/slots.ts:27`, `src/runtime/snapshot/objects.ts:127`, `src/runtime/boundary/host-natives.ts:49, 60`, and 25 exported internal types/interfaces across `src/runtime/`
- evidence:
  - `heldObjects(object)` (`src/runtime/snapshot/holdings.ts:140`) has 0 production callers and only 1 test caller (`src/runtime/lifetimes/oracle.test-kit.ts:32, 108, 118`), where it is simply `idsHeld(heldBy(object))`.
  - `spawnedSeparator` (`scheduler/instance/instance-names.ts:8`), `SlotOperation` (`scheduler/instance/slots.ts:27`), `ChainRoot` (`snapshot/objects.ts:127`), and `HostCall`/`HostResolver` (`boundary/host-natives.ts:49, 60`) have 0 production callers and 1 test caller each.
  - 25 exported types/interfaces have 0 imports anywhere in `src/` or `test/`: `ContextSeams` (`host/contexts.ts:44`), `Callable` (`interpreter/function-table.ts:18`), `CollectorSeams` (`lifetimes/collector.ts:43`), `Roots` & `Held` (`lifetimes/holders.ts:28, 34`), `NodeCounts` & `Place` (`lifetimes/in-place.ts:49, 56`), `RefusalReason` (`refusal.ts:12`), `AnswerGiven` (`scheduler/instance/futures.ts:46`), `InstanceStatus` & `Persisted` (`scheduler/instance/index.ts:55, 392`), `Spawn` (`scheduler/instance/segment-effects.ts:24`), `WaitSeams` (`scheduler/instance/waits/index.ts:62`), `Registration` (`scheduler/instance/waits/settle-order.ts:12`), `TestLoading` (`scheduler/loaded-definition.ts:56`), `AnsweredCall` (`scheduler/segment/answering.ts:24`), `RootOutcomeSeams` & `Returning` (`scheduler/segment/root-outcome.ts:41, 56`), `MockedCall` & `CallToMock` (`scheduler/testing/mocks.ts:49, 59`), `CallShape` (`snapshot/check/calls.ts:19`), `TestRunOptions` (`testing/run-tests.ts:29`), `Driving` & `Driven` (`testing/world/drive.ts:16, 32`), `WorldSeams` (`testing/world/index.ts:68`).
- proposal: Remove `export` from internal types/interfaces not imported outside their module, and inline `heldObjects(object)` as `idsHeld(heldBy(object))` in `oracle.test-kit.ts`.
- confidence: high

## Missing from docs/reuse

### Wrong or stale entries in `docs/reuse/*.md` for `src/runtime`
- `docs/reuse/stdlib-and-natives.md:46` — One-way rule states `"writes it through NativeContext.write"` (and `src/runtime/scheduler/segment/native-calls.ts:7` banner also says `"through the context's write"`), but `NativeContext.write` was replaced by `NativeContext.changes: (position: number) => ValueChanges` (`src/runtime/natives.ts:59`, `src/runtime/lifetimes/in-place.ts`).
- `docs/reuse/testing.md:50` — Lists `acyclicOracle`, `cyclicOracle`, `oracleFor`, `Oracle` (`src/runtime/lifetimes/oracle.test-kit.ts`), all of which were removed/renamed; `src/runtime/lifetimes/oracle.test-kit.ts` now exports `oracle` and `countedHolds`, and `src/runtime/lifetimes/native-audit.test-kit.ts` exports `nativeAudit`, `withNativeAudit`, `NativeAudit`, `NativeKeeps`.
- `docs/reuse/runtime-and-persistence.md:20` — Lists `heldObjects` (`src/runtime/snapshot/holdings.ts`), which has 0 production callers (replaced in production by `heldBy` + `idsHeld`).

### Reusable exported units in `src/runtime` (with callers outside their folder) missing from `docs/reuse/*.md`
- `src/runtime/scheduler/loaded-definition.ts`: `loadDefinition`, `LoadedDefinition`, `NativeCallMade` (callers outside folder: 2, 5, 1) — binding a `Definition` to its `FunctionTable`, `TestWorld`, and `HeapCheck`.
- `src/runtime/interpreter/function-table.ts`: `FunctionTable` (callers outside folder: 1) — binding `Definition` function entries to code or runtime `Natives`.
- `src/runtime/interpreter/instructions.ts`: `runInstruction` (callers outside folder: 1) — dispatching one register-machine `Instruction` on an `ActiveFrame`.
- `src/runtime/interpreter/machine.ts`: `Machine`, `newFrame`, `parameterContents`, `capturesOf`, `resumeAfterCall`, `releaseFrame` (callers outside folder: 1, 6, 1, 1, 2, 4) — `ActiveFrame` creation, parameter/capture reading, call resumption, and frame teardown.
- `src/runtime/interpreter/registers.ts`: `placeContents`, `argumentContents`, `givesEvery`, `passedValues`, `changesAt`, `Passed` (callers outside folder: 1, 1, 1, 2, 1, 2) — placing register contents, resolving call `Argument`s, and dereferencing arguments for natives and mocks.
- `src/runtime/scheduler/instance/index.ts`: `topFrame` (callers outside folder: 3) — getting the innermost `ActiveFrame` of a `LiveExecution`.
- `src/runtime/scheduler/instance/crossing.ts`: `hostValuesIn` (callers outside folder: 1) — replacing resource handles in a `Value` with their host `extern` values.
- `src/runtime/scheduler/segment/index.ts`: `runSegment`, `endInstance`, `SegmentStart` (callers outside folder: 1, 1, 1) — running a persistent segment or terminating an instance's holdings.
- `src/runtime/scheduler/segment/native-calls.ts`: `NativeCalls` (callers outside folder: 1) — per-segment native caller with capabilities, constant pinning, and `HeapCheck.native`.
- `src/runtime/scheduler/testing/mocks.ts`: `reachingMock`, `startAnswer`, `ReachedMock` (callers outside folder: 1, 1, 1) — selecting the newest mock and starting a mock answer segment.
- `src/runtime/scheduler/testing/test-world.ts`: `TestWorld`, `noTestWorld`, `CallerFuture`, `MockCall`, `MockAnswer` (callers outside folder: 2, 1, 3, 3, 1) — test world seam between the scheduler and `runtime/testing/world/`.
- `src/runtime/snapshot/holdings.ts`: `nothingHeld` (callers outside folder: 2) — empty `Held` constant `{ values: [], holds: [] }`.
- `src/runtime/boundary/host-natives.ts`: `HostExterns` (callers outside folder: 2) — host extern function table type.
- `src/runtime/runtime.test-kit.ts`: `settleStored` (callers outside folder: 1 in `src/stdlib/runtime/delegate.test.ts`) — advancing all stored instances on a test runtime until settled.
- `src/runtime/lifetimes/native-audit.test-kit.ts`: `nativeAudit`, `withNativeAudit`, `NativeAudit`, `NativeKeeps` (callers outside folder: 2 in `src/stdlib/`) — auditing native `@Keeps` annotations against heap edges added during native calls.
