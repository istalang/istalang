## src/runtime/boundary/extern-signatures.ts — Persisting and checking host extern declared types across Definition deploys
- externSignaturesFormat — versioned format for persisted host extern key-to-declaredType map; callers: 0 outside folder
- recordExternSignatures(store, definition) — checks host extern declared types against `store` and persists newly added ones; [exp]; callers: 1 outside folder

## src/runtime/boundary/host-natives.ts — Adapting host JSON extern functions (sync, Promise, or HostResolver) to runtime Natives
- HostCall — call metadata (`instance` and `resolver()`) passed to a host extern implementation; [exp]; callers: 0 outside folder
- HostResolver — one-shot live future resolver (`resolve`, `tryResolve`, `onCancel`) taking host JSON; [exp]; callers: 0 outside folder
- HostExterns — map of host extern implementations keyed by extern signature; [exp]; callers: 2 outside folder
- hostNatives(host) — wraps a `HostExterns` table into runtime `Natives` converting `Json` values and futures; [exp]; callers: 1 outside folder
- hostNative(extern) — adapts one `HostExtern` to a `Native`, converting JSON arguments and result/future; callers: 0 outside folder
- futureOf(given, taken, context, read) — settles or rejects a live future from a returned Promise or taken `HostResolver`; callers: 0 outside folder
- hostResolverOf(resolver, read, name) — wraps a `NativeResolver` in a `JsonResolver` tracked by `FinalizationRegistry`; callers: 0 outside folder
- JsonResolver — `HostResolver` implementation converting plain JSON and panicking on double `resolve`; callers: 0 outside folder
- JsonResolver.resolve(value) — resolves the underlying `NativeResolver` with converted JSON, panicking if already resolved; callers: 0 outside folder
- resolveWith(resolver, plain, read) — converts `plain` to `Json` (failing the wait on `JsonError`) and calls `tryResolve`; callers: 0 outside folder
- fitting(given, read) — converts host `given` value via `read`, turning `JsonError` into a runtime `Panic`; callers: 0 outside folder

## src/runtime/boundary/outbound.ts — Extracting a finished instance's encoded outcome as host JSON or canonical JSON text
- outcomeJson(finished, definition) — converts a finished instance's encoded `Json` value to host JS JSON; [exp]; callers: 1 outside folder
- outcomeText(finished, definition) — formats a finished instance's encoded `Json` value as canonical JSON text; [exp]; callers: 1 outside folder
- encodedOf({encoded}, definition) — validates that `encoded` is present and matches `definition`'s `Json` type, else throws `Refusal`; callers: 0 outside folder

## src/runtime/clock.ts — Host Clock seam and ManualClock for deterministic timer advancement
- Clock — host time seam (`now()` and cancellable `until(at, cancelled?)`); [exp]; callers: 5 outside folder
- ManualClock — test clock that reads its set time and jumps forward to `at` on `until(at)`; [exp]; callers: 0 outside folder
- ManualClock.until(at) — advances the manual clock to `at` if later than current time and resolves immediately; callers: 0 outside folder

## src/runtime/host/contexts.ts — Driving persistent context instances opened and called by a live run
- ContextSeams — runtime callbacks and seams needed by `Contexts` to load, advance, and observe instances; [exp]; callers: 0 outside folder
- InstanceObserver — callback notified after every advance or termination of a runtime instance; [exp]; callers: 0 outside folder
- Contexts — `RunContexts` implementation managing open runtimes, context invocations, timers, and job serving; [exp]; callers: 0 outside folder
- Contexts.open() — resumes unfinished store instances on first open, registers a new runtime id, and serves jobs; callers: 0 outside folder
- Contexts.call(runtime, call) — queues an invocation into context `key` if `runtime` is open, else reports panic to listener; callers: 0 outside folder
- Contexts.release(future) — removes waiting context calls and `served` waits whose live future was disposed; callers: 0 outside folder
- Contexts.dispose(runtime) — closes `runtime`, drops its `served` waits, and hands job serving to the next open runtime; callers: 0 outside folder
- Contexts.runReady() — runs pending context invocations and ready group instances one by one until none remain; callers: 0 outside folder
- Contexts.startCalls() — starts all queued context invocations even after runtimes close or the live run ends; callers: 0 outside folder
- Contexts.#nextStep() — returns the next queued invocation step or ready group instance advance step; callers: 0 outside folder
- Contexts.wakeDue(now) — advances all group instances whose timers are due by `now` while a runtime is open; callers: 0 outside folder
- Contexts.#serve() — notifies `served` waits on the earliest open runtime when `#servedLives` grows past `known`; callers: 0 outside folder
- Contexts.#began(instance) — records `instance` in `#servedLives` if it runs the live run's own Definition hash; callers: 0 outside folder
- Contexts.#resume() — adds all `active` or `unstarted` instances in the store to `#group` as ready; callers: 0 outside folder
- Contexts.#invoke({key, call, token}) — serializes on `key`, creates or loads its `Resident`, and runs the invocation advance; callers: 0 outside folder
- Contexts.#advance(instance) — serializes on `instance` and advances its `Resident` from its last commit; callers: 0 outside folder
- Contexts.#ownAdvance(resident, first) — advances `resident` while marking its name in `#advancing` as an own advance; callers: 0 outside folder
- Contexts.#record(instance, advanced, own) — updates `#group`, forwards logs, delivers call answers, and reports unhandled panics; callers: 0 outside folder
- Contexts.#endCallsInto(instance, state) — fails all calls waiting on `instance` when it stops running, returning if any was `'program'`; callers: 0 outside folder
- Contexts.#end(token, panic) — removes waiting call `token` and notifies its listener of `panic`; callers: 0 outside folder
- endedMessage(key, status) — formats the panic message and trace for a call into a finished, panicked, or terminated context; callers: 0 outside folder

## src/runtime/host/index.ts — Public host Runtime API (`createRuntime`: deploy, wake, programOf, inspect, retry, terminate)
- Runtime — public host runtime interface (`deploy`, `wake`, `programOf`, `inspect`, `retry`, `terminate`); [exp]; callers: 1 outside folder
- createRuntime(seams) — validates host extern names and builds a `Runtime` over `seams`; [exp]; callers: 1 outside folder
- residents(seams, held, calls) — wires `programBinder` and `residentOf` lookup across held and stored instances; callers: 0 outside folder
- heldInstances(seams) — tracks active `Resident`s in memory across advances and broadcasts advances to observers; callers: 0 outside folder
- retried(resident) — prepares a panicked `Resident` and its `AdvanceFirst` replay step to retry at `segmentStartedAt`; callers: 0 outside folder
- panicked(snapshot) — narrows `snapshot` to `PanickedSnapshot` or throws a `'notPanicked'` `Refusal`; callers: 0 outside folder

## src/runtime/host/instance-calls.ts — Per-instance promise queue serializing concurrent host operations
- InstanceCalls — serializes host operations per instance name so each sees the previous call's commit; [exp]; callers: 0 outside folder
- InstanceCalls.run(instance, call) — runs `call` immediately if no call is active on `instance`, else chains after the last; callers: 0 outside folder

## src/runtime/host/instance-group.ts — Tracking states, ready order, watched ends, and timers for a group of instances
- InstanceGroup — tracks `InstanceState`s of a group of instances and answers readiness and timer queries; [exp]; callers: 2 outside folder
- InstanceGroup.record(instance, {state, spawned}) — records `instance`'s new state and adds any newly spawned children as `'ready'`; callers: 0 outside folder
- InstanceGroup.ready() — returns the first `'ready'` instance, or the first waiting on an instance that has ended; callers: 0 outside folder
- InstanceGroup.#watchesAnEnd(state) — tests whether `state` waits on `result()` of a group instance that `hasEnded`; callers: 0 outside folder
- InstanceGroup.earliestTimer() — returns the minimum `until` timestamp across all waiting instances in the group; callers: 0 outside folder
- InstanceGroup.dueBy(due) — lists instances in the group waiting on a timer at or before `due`; callers: 0 outside folder

## src/runtime/host/programs.ts — Binding deployed Definition texts to natives and starting live runs
- programBinder(seams) — memoizes Definition decoding, validation, and `BoundProgram` binding by text and content hash; [exp]; callers: 0 outside folder
- boundProgram(seams, definition, hash) — loads `definition` with std and host natives and builds its `BoundProgram` starter; callers: 0 outside folder
- startOf(definition, key, count) — looks up startable entry `key` (or `main`) and checks argument arity, else throws `Refusal`; callers: 0 outside folder
- listedStart(definition, key) — finds `key` (or `main`) in `definition.starts` with its optional outcome encoder; callers: 0 outside folder
- jsonIn(definition, json) — converts a host JS argument to a `Json` value, throwing `'unfitJson'` `Refusal` on `JsonError`; callers: 0 outside folder
- BoundProgram — `DeployedProgram & LoadedDefinition` held internally by the host runtime; [exp]; callers: 0 outside folder
- RuntimeSeams — seams passed to `createRuntime` (`natives`, `store`, `clock`, `seed`, `host`, `reports`, `heapCheck`); [exp]; callers: 0 outside folder
- HostReports — callbacks (`logs`, `panicked`) for background work driven by a live run's contexts; [exp]; callers: 1 outside folder
- DeployedProgram — deployed program handle (`hash`, `starts`, `outcome`, `outcomeText`, `start`); [exp]; callers: 1 outside folder

## src/runtime/host/stored-instances.ts — Restoring and validating an instance snapshot and its Definition from the store
- storedInstance(store, bind, instance) — reads `instance`'s snapshot and Definition from `store`, checks them, and returns a `Resident`; [exp]; callers: 0 outside folder

## src/runtime/instance-state.ts — Host-facing instance states, log records, start/spawn options, and inspection types
- InstanceState — discriminated union of committed instance states (`ready`, `waiting`, `finished`, `panicked`, `terminated`); [exp]; callers: 7 outside folder
- Finished — narrowed `Extract<InstanceState, { kind: 'finished' }>` state; [exp]; callers: 2 outside folder
- LogLevel — `'debug' | 'info' | 'warn' | 'error'` log severity level; [exp]; callers: 1 outside folder
- LogRecord — structured log entry (`instance`, `time`, `level`, `message`, `fields`) emitted on commit; [exp]; callers: 5 outside folder
- StartOptions — instance start options (`crashEveryAwait`); [exp]; callers: 1 outside folder
- SpawnOptions — spawned instance options (`StartOptions` plus `terminatesOnPanic`); [exp]; callers: 2 outside folder
- hasEnded({kind}) — tests whether an `InstanceState` is `'finished'`, `'panicked'`, or `'terminated'`; [exp]; callers: 1 outside folder
- Advanced — result of advancing an instance (`state`, `spawned`, `logs`); [exp]; callers: 6 outside folder
- WaitingPoint — execution suspension point (`waypoint` and `module:line:column` `location`); [exp]; callers: 1 outside folder
- Inspection — committed instance `state` and `waitingAt` list of `WaitingPoint`s; [exp]; callers: 4 outside folder

## src/runtime/interpreter/frames.ts — Live call-frame representation and the FrameHeap interface frames reach
- FrameHeap — heap interface exposed to frames (`read`, `write`, `create` cells, context constants, `changed`, `values`); [exp]; callers: 2 outside folder
- FrameEntry — code entry descriptor (`function`, `code`, `arrives?`, `handsOver?`) used to build an `ActiveFrame`; [exp]; callers: 2 outside folder
- ActiveFrame — live execution frame (`function`, `code`, `pc`, `registers`, `heap`, `arrives?`, `handsOver?`); [exp]; callers: 11 outside folder

## src/runtime/interpreter/function-table.ts — Binding Definition function entries to code or runtime Natives at load time
- Callable — discriminated union (`code` vs `native`) for a bound function table entry; [exp]; callers: 0 outside folder
- FunctionTable — table mapping `FunctionId`s to `Callable`s, refusing Definitions with missing natives; [exp]; callers: 1 outside folder
- FunctionTable.callee(index) — returns the `Callable` at `index` in the bound function table; callers: 0 outside folder

## src/runtime/interpreter/instructions.ts — Instruction handler table executing one register-machine instruction per step
- relations — comparator functions (`less`, `lessOrEqual`, `greater`, `greaterOrEqual`) over `bigint` compare results; callers: 0 outside folder
- handlers — exhaustive `Handlers` table executing each `Instruction` kind on `(machine, instruction, frame)`; callers: 0 outside folder
- calledFunction(frame, callee) — resolves a direct `FunctionId` or closure register `Callee` to `{function, captures}`; callers: 0 outside folder
- runInstruction(machine, frame, instruction) — dispatches `instruction` on `frame` through `handlers`; [exp]; callers: 1 outside folder
- constantAt(machine, index) — reads constant `index` from `machine.definition.constants`; callers: 0 outside folder

## src/runtime/interpreter/machine.ts — Machine interface for instruction handlers and ActiveFrame lifecycle helpers
- Machine — execution callbacks (`call`, `return`, `openWait`, `resolver`, `wait`, `endWait`, `currentCall`, `handOver`); [exp]; callers: 1 outside folder
- newFrame(entry, contents, heap, captures) — allocates an `ActiveFrame` and populates its parameter and capture registers; [exp]; callers: 6 outside folder
- parameterContents(frame) — returns `frame`'s parameter register contents after its prologue has computed defaults; [exp]; callers: 1 outside folder
- currentClosure(frame) — builds the `{kind: 'closure', function, captures}` value for `frame`'s running function; [exp]; callers: 0 outside folder
- capturesOf(frame) — reads `frame`'s captured register contents following its parameters; [exp]; callers: 1 outside folder
- resumeAt(frame, dst, value) — writes `value` to `dst` (if defined) and advances `frame.pc` by 1; [exp]; callers: 0 outside folder
- resumeAfterCall(frame, value) — writes `value` to the `dst` of the `call` at `frame.pc` and advances `frame.pc`; [exp]; callers: 2 outside folder
- releaseFrame(frame) — clears every register of `frame` as the frame ends; [exp]; callers: 4 outside folder

## src/runtime/interpreter/parts.ts — Reading nested composite value parts along a path of field indices
- partAt(value, path) — walks `path` of child indices through `value` using `childValues`; [exp]; callers: 1 outside folder
- childAt(value, index) — returns child `index` of composite `value`; callers: 0 outside folder
- compositeAt(value, index) — narrows `value` to `CompositeValue` or calls `unreachable`; callers: 0 outside folder

## src/runtime/interpreter/raw-registers.ts — Single raw register slot mutator imported only by `registers.ts`
- setRegister(frame, register, contents) — mutates `frame.registers[register]` in place without reporting a holder write; [exp]; callers: 0 outside folder

## src/runtime/interpreter/registers.ts — Reading and writing frame registers, cells, and `&` references with holder-write reporting
- readRegister(frame, register) — reads `register`'s value directly, through a cell, or through a `&` reference; [exp]; callers: 0 outside folder
- writeRegister(frame, register, value) — writes `value` into `register`, its cell (allocating on first write), or its `&` reference; [exp]; callers: 0 outside folder
- newCell(frame, type, value) — creates a heap cell of `type` holding `value` and returns its handle; [exp]; callers: 0 outside folder
- readCell(frame, register) — reads the heap cell whose handle is in `register`; [exp]; callers: 0 outside folder
- writeCell(frame, register, value) — writes `value` into the heap cell whose handle is in `register`; [exp]; callers: 0 outside folder
- clearRegister(frame, register) — empties `register` and reports its released holdings; [exp]; callers: 0 outside folder
- placeContents(frame, register, contents) — places raw `RegisterContents` into `register` (for references, captures, restores); [exp]; callers: 1 outside folder
- put(frame, register, contents) — sets `frame.registers[register]` via `setRegister` and reports `heldIn(was)` -> `heldIn(contents)`; callers: 0 outside folder
- storeAt(frame, place, value) — updates the nested part at `place` in place or through a `&` reference; [exp]; callers: 0 outside folder
- Passed — `RegisterContents | undefined` passed to a parameter (`undefined` when omitted for prologue); [exp]; callers: 2 outside folder
- argumentContents(frame, argument) — resolves a call `Argument` (`value`, `omitted`, or `&` `place` reference) in `frame`; [exp]; callers: 1 outside folder
- givesEvery(passed) — type guard checking that no parameter in `passed` was left `undefined`; [exp]; callers: 1 outside folder
- passedValues(heap, contents) — reads the `Value` of each `RegisterContents` in `contents`, dereferencing any `Reference`; [exp]; callers: 2 outside folder
- writeReference(heap, reference, value) — updates `reference.cell` at `reference.path` with `value` via `heap.values.withPart`; callers: 0 outside folder
- changesAt(heap, reference) — returns `ValueChanges` mutating the array or map at `reference` in `heap`; [exp]; callers: 1 outside folder
- capturedContents(frame, register) — returns the cell handle itself for a cell register, or the register's value otherwise; [exp]; callers: 0 outside folder
- cellOf(contents) — extracts the cell object id from a handle `RegisterContents`; callers: 0 outside folder

## src/runtime/interpreter/suspension.ts — Inspecting, resuming, and releasing losing cases of `await` and `select` waits
- Decision — winning case `{position, value}` of a decided wait; [exp]; callers: 3 outside folder
- waitAt(frame) — returns the wait object id in `frame`'s current `await` or `select` wait register, if any; callers: 0 outside folder
- stoppedAt(frame) — returns the wait object id `frame` is suspended at (`await` or blocking `select`); [exp]; callers: 1 outside folder
- takeWait(frame) — clears and returns the wait object id from `frame`'s current `await` or `select` register; [exp]; callers: 1 outside folder
- releaseLosers(frame, winner) — clears `holds` registers of all cases other than `winner` at a blocking `select`; [exp]; callers: 1 outside folder
- enterCase(frame, select, winner) — releases losing cases' `holds`, binds `winner.value` if needed, and jumps to target; [exp]; callers: 0 outside folder
- resume(frame, decision) — resumes `frame` past an `await` or into the winning case of a blocking `select`; [exp]; callers: 2 outside folder
- releaseCase(frame, selectCase) — clears non-empty registers in `selectCase.holds` and returns whether any were cleared; callers: 0 outside folder

## src/runtime/interpreter/trace.ts — Formatting stack traces and 1-based `module:line:column` source locations
- traceOf(definition, frames) — formats `at <fn> (<module>:<line>:<col>)` lines for `frames`, innermost first; [exp]; callers: 1 outside folder
- callerTraceOf(definition, frames) — formats `traceOf` omitting the innermost frame while it is in its default prologue; [exp]; callers: 1 outside folder
- locationOf(definition, module, offset) — converts a UTF-16 `offset` in `module` to `id:line:column` using `lineStarts`; [exp]; callers: 1 outside folder

## src/runtime/lifetimes/collector.ts — Disposing counted objects that reached zero holders in newest-first rounds
- CollectorSeams — `DisposalContext` plus `holders: HolderWrites` and `run(DisposalRun)` callback; [exp]; callers: 0 outside folder
- Collector — drives newest-first disposal rounds and tracks abandoned disposals during instance termination; [exp]; callers: 1 outside folder
- Collector.collect() — starts a disposal round for newly zeroed disposables (removing non-disposables immediately); callers: 0 outside folder
- Collector.returned() — marks the active disposal call of the innermost round as returned; callers: 0 outside folder
- Collector.abandoned() — marks the innermost disposal call as returned and records its object in `#released`; callers: 0 outside folder
- Collector.panicked() — handles a panic thrown while creating a disposal before code ran (`'none' | 'released' | 'letGo'`); callers: 0 outside folder
- Collector.#proceed() — advances the top round through queued disposables and completed disposal code calls; callers: 0 outside folder
- Collector.#dispose(round, id) — runs `dispose` for object `id` and either removes it or waits on its `DisposalRun`; callers: 0 outside folder
- Collector.#gone(round, id) — removes disposed object `id` and appends newly zeroed disposables to `round.next`; callers: 0 outside folder
- Collector.#remove(id) — removes `id` from the heap, notifies `weak.disposed(id)`, and clears `#released`; callers: 0 outside folder
- Collector.#push(ready) — sorts `ready` descending (newest first) and pushes a new `Round` if non-empty; callers: 0 outside folder
- Collector.#zeroDisposables(released) — drains `holders.takeZeroes()`, removing non-disposables and collecting disposables; callers: 0 outside folder

## src/runtime/lifetimes/counts.ts — Reference counting for counted heap objects and composite value nodes
- countedIn(types) — predicate returning whether a `LiveObject`'s holders are counted given `types`; [exp]; callers: 1 outside folder
- Counts — per-instance reference counter for counted heap objects and `CompositeValue` nodes; [exp]; callers: 0 outside folder
- Counts.made(id) — registers newly created counted object `id` with 0 holders and adds it to `#zeroes`; callers: 0 outside folder
- Counts.gone(id) — removes `id` from `#objects` and `#zeroes`; callers: 0 outside folder
- Counts.changed(was, now) — holds `now` then releases `was` so unchanged holdings never dip to zero; callers: 0 outside folder
- Counts.partHeld(node, part) — increments holdings of `part` when held composite `node` adds it in place; callers: 0 outside folder
- Counts.partReleased(node, part) — decrements holdings of `part` when held composite `node` removes it in place; callers: 0 outside folder
- Counts.takeZeroes() — drains and returns counted object ids in `#zeroes` whose holder count is still 0; callers: 0 outside folder
- Counts.#hold({values, holds}) — increments holder counts for `holds` and walks `values` on an explicit stack; callers: 0 outside folder
- Counts.#release({values, holds}) — decrements holder counts for `holds` and walks `values` on an explicit stack; callers: 0 outside folder
- Counts.#holdValue(value) — increments composite `value`'s node count, returning `childValues` on its first hold; callers: 0 outside folder
- Counts.#releaseValue(value) — decrements composite `value`'s node count, returning `childValues` when its last holder leaves; callers: 0 outside folder
- Counts.#holdObject(id) — increments counted object `id`'s holder count if tracked; callers: 0 outside folder
- Counts.#releaseObject(id) — decrements counted object `id`'s holder count, recording `#letGo` and `#zeroes`; callers: 0 outside folder

## src/runtime/lifetimes/disposal.ts — Per-kind disposability predicates and disposal actions for heap objects
- DisposalCall — `{kind: 'call', function, arguments}` for a declared `dispose` function call; [exp]; callers: 1 outside folder
- Cleanup — `{kind: 'cleanup', execution, position}` for resuming a disposed async call's `disposing()` case; [exp]; callers: 1 outside folder
- DisposalRun — `DisposalCall | Cleanup` code execution started by a disposal; [exp]; callers: 1 outside folder
- Disposability — `{heap, types}` context needed to test whether a `LiveObject` is disposable; [exp]; callers: 1 outside folder
- DisposalContext — `Disposability` plus callbacks (`stop`, `cleanupCase`, `weak`, `disposed`, `cancel`); [exp]; callers: 0 outside folder
- declared(object) — builds `KindDisposal` for a `cell` or `resource` from its type entry's `disposal`; callers: 0 outside folder
- kinds — exhaustive `Handlers` table mapping each `LiveObject` kind to its `KindDisposal`; callers: 0 outside folder
- isDisposable(context, object) — tests whether `object` runs a disposal action when reaching zero holders; [exp]; callers: 1 outside folder
- isDropped(context, resolver) — tests whether a pending case resolver was dropped unregistered while its wait is still awaited; callers: 0 outside folder
- isAwaited(heap, id) — tests whether wait `id` and its waiter's call future still have at least one holder; callers: 0 outside folder
- dispose(context, object) — performs `object`'s disposal and returns any `DisposalRun` code to execute; [exp]; callers: 0 outside folder
- disposeFuture(context, future) — cancels registered resolvers, notifies observers, and disposes call/slot state; callers: 0 outside folder
- disposeCall(context, execution) — resolves `disposing()` watches on `execution` and returns its cleanup or stops it; callers: 0 outside folder

## src/runtime/lifetimes/holder-writes.ts — Single reporting seam for register, heap, and run-stack holder changes
- HolderWrites — coordinates `Counts`, `InPlace` value mutations, `letGo` tracking, and uncollected `select` losers; [exp]; callers: 4 outside folder
- HolderWrites.made(object) — notifies `#counts` when the heap creates a counted `object`; callers: 0 outside folder
- HolderWrites.handOver(value, move) — holds `value` across `move()` so its reference count never dips through zero; callers: 0 outside folder
- HolderWrites.takeZeroes() — clears `#losersReleased` and returns counted objects currently at zero holders; callers: 0 outside folder
- HolderWrites.settled() — clears `#losersReleased` and drains `#counts.takeLetGo()` after a commit; callers: 0 outside folder

## src/runtime/lifetimes/holders.ts — Walking reachable heap objects and maximum value depth from roots
- Roots — `{frames, objects}` starting set for a reachability walk; [exp]; callers: 0 outside folder
- Held — `{objects, depth}` result of `heldFrom`; [exp]; callers: 0 outside folder
- heldFrom(heap, roots) — walks `heap` from `roots` in one pass, returning reachable object ids and max `depth`; [exp]; callers: 1 outside folder

## src/runtime/lifetimes/in-place.ts — Copy-on-write and in-place mutation of uniquely held instance-owned composite values
- NodeCounts — interface to `Counts` (`holdersOfNode`, `partHeld`, `partReleased`) used by `InPlace`; [exp]; callers: 0 outside folder
- Place — `{read, path, write}` accessor for a mutable value place; [exp]; callers: 0 outside folder
- ValueChanges — in-place array/map mutation methods (`push`, `pop`, `reverse`, `splice`, `setEntry`, `deleteEntry`); [exp]; callers: 2 outside folder
- InPlace — mutates composite values in place when owned by this instance and held once, else copies; [exp]; callers: 1 outside folder
- InPlace.made(value) — marks `value` as built by this instance (`#own`) and returns it; callers: 0 outside folder
- InPlace.withPart(whole, path, part) — replaces the value at `path` in `whole` with `part` (in place if unique); callers: 0 outside folder
- InPlace.appended(array, items) — appends `items` to `array` (in place if unique); callers: 0 outside folder
- InPlace.withEntries(map, entries) — sets `entries` in `map` in order (in place if unique); callers: 0 outside folder
- InPlace.changesAt(place) — builds `ValueChanges` that open `place.path`, mutate the target, and write back; callers: 0 outside folder
- InPlace.#change(whole, path, inserted, edit) — opens `path` in `whole` (copying shared nodes) and applies `edit`; callers: 0 outside folder
- InPlace.#push(array, items) — pushes `items` onto `array` in place, updating counts and clearing derived caches; callers: 0 outside folder
- InPlace.#pop(array) — pops and returns the last element of `array` in place, updating counts and caches; callers: 0 outside folder
- InPlace.#splice(array, start, count, items) — splices `array` in place, updating part counts and clearing caches; callers: 0 outside folder
- InPlace.#setEntry(map, key, value) — sets `(key, value)` in `map` in place via `setEntryInPlace` and updates counts; callers: 0 outside folder
- InPlace.#deleteEntry(map, key) — deletes `key` from `map` in place via `deleteEntryInPlace` and updates counts; callers: 0 outside folder
- InPlace.#open(whole, path, inserted) — walks `path` in `whole` and copies from the first shared or self-inserted node down; callers: 0 outside folder
- InPlace.#setPart(node, index, part) — sets child `index` of `node` to `part`, updating counts and clearing caches; callers: 0 outside folder
- InPlace.#copyOf(node) — shallow-copies `node` (preserving a map's hash table) and marks the copy in `#own`; callers: 0 outside folder
- setChild(node, index, part) — writes `part` into child slot `index` of a tuple, array, struct, variant, closure, or map; callers: 0 outside folder

## src/runtime/natives.ts — The Natives seam, capability interfaces (`With*`), `NativeContext`, and `Panic`
- NativeContext — base context passed to every native call (`name`, `resultType`, `typeArguments`, `types`, `changes`, traces); [exp]; callers: 28 outside folder
- NativeFutures — capability for creating `resolved`, `timer`, and live `resolvable` futures; [exp]; callers: 1 outside folder
- NativeWaits — capability for `onAwait`, `resolve`, `tryResolve`, `callback`, `at`, and `onCancel` on resolvers; [exp]; callers: 1 outside folder
- ResolverState — `'pending' | 'resolved' | 'cancelled'` state of a `NativeResolver`; [exp]; callers: 1 outside folder
- NativeResolver — one-shot resolver for a live future (`tryResolve`, `fail`, `panic`, `onCancel`); [exp]; callers: 2 outside folder
- Resolvable — `{future, resolver}` pair returned by `NativeFutures.resolvable()`; [exp]; callers: 2 outside folder
- NativeSlots — capability for `create`, `put`, `take`, and `read` on `Slot<T>`; [exp]; callers: 1 outside folder
- NativeWeakSide — capability for `reference`, `target` (`deref`), and `watch` (`disposed`/`disposing`); [exp]; callers: 1 outside folder
- NativeResources — capability for creating disposable host `resource` handles and reading their `payloadOf`; [exp]; callers: 1 outside folder
- NativeInstances — capability for spawning child instances (`spawn`) and watching their end (`ended`); [exp]; callers: 1 outside folder
- NativeContexts — capability for live runs to open runtimes, call into contexts, and query `served`/`jobServer`; [exp]; callers: 1 outside folder
- NativeTesting — capability for `mock`, `calls`, `inspect`, `watch`, and `handle` in `ista test`; [exp]; callers: 1 outside folder
- NativeRandom — capability drawing deterministic 32-byte random values (`draw`); [exp]; callers: 1 outside folder
- NativeLogs — capability appending structured log records (`write`) to the current segment; [exp]; callers: 1 outside folder
- WithFutures — `{futures: NativeFutures}` capability slice; [exp]; callers: 3 outside folder
- WithWaits — `{waits: NativeWaits}` capability slice; [exp]; callers: 2 outside folder
- WithSlots — `{slots: NativeSlots}` capability slice; [exp]; callers: 2 outside folder
- WithWeakSide — `{weak: NativeWeakSide}` capability slice; [exp]; callers: 2 outside folder
- WithResources — `{resources: NativeResources}` capability slice; [exp]; callers: 2 outside folder
- WithRandom — `{random: NativeRandom}` capability slice; [exp]; callers: 1 outside folder
- WithLogs — `{logs: NativeLogs}` capability slice; [exp]; callers: 1 outside folder
- WithInstances — `{instances: NativeInstances}` capability slice; [exp]; callers: 4 outside folder
- WithTesting — `{testing: NativeTesting}` capability slice; [exp]; callers: 1 outside folder
- WithContexts — `{contexts: NativeContexts}` capability slice; [exp]; callers: 1 outside folder
- NativeCapabilities — intersection of all ten `With*` capability interfaces; [exp]; callers: 1 outside folder
- FullNativeContext — `NativeContext & NativeCapabilities`; [exp]; callers: 1 outside folder
- Native — native function signature `(argumentValues, context) => Value`; [exp]; callers: 10 outside folder
- Natives — `Readonly<Record<string, Native<Context>>>` table of natives by extern key; [exp]; callers: 33 outside folder
- Panic — error thrown by natives or the runtime to panic the running instance; [exp]; callers: 24 outside folder

## src/runtime/refusal.ts — Host call refusal error (`Refusal`) and `RefusalReason` codes
- RefusalReason — union of 11 host refusal reason codes (`missingNatives`, `unfitJson`, `notPanicked`, etc.); [exp]; callers: 0 outside folder
- Refusal — error thrown when the runtime refuses an invalid host request or corrupted store text; [exp]; callers: 10 outside folder

## src/runtime/scheduler/inspect.ts — Deriving `InstanceState` and `Inspection` waiting points from a committed Snapshot
- inspection(definition, snapshot) — derives `{state, waitingAt}` from `snapshot`'s status and execution top frames; [exp]; callers: 2 outside folder
- waitingPointOf(definition, frame) — returns `{waypoint, location}` of the `await` or `select` at `frame.pc`; callers: 0 outside folder
- stateOf(snapshot) — derives host-visible `InstanceState` (`ready`, `waiting`, `finished`, `panicked`, `terminated`); [exp]; callers: 1 outside folder
- watchedOf(snapshot) — lists unique instance names watched by `ended` watch futures in `snapshot`; callers: 0 outside folder
- nextTimerOf(snapshot) — returns the earliest `at` timestamp among timer futures in `snapshot`; callers: 0 outside folder

## src/runtime/scheduler/instance/context-constants.ts — Reading, initializing, and LIFO-releasing an instance's context constants
- ContextConstants — manages `contextConstant` root objects in an instance's heap (§3.4); [exp]; callers: 0 outside folder
- ContextConstants.read(name) — returns the value of context constant `name`, panicking if read after instance ended; callers: 0 outside folder
- ContextConstants.make(name, value) — stores `value` for context constant `name`, panicking on recursive re-entry; callers: 0 outside folder
- ContextConstants.release(collect) — removes context constants in reverse creation order, calling `collect` after each; callers: 0 outside folder

## src/runtime/scheduler/instance/crossing.ts — Copying values across instance boundaries and translating disposable host resources
- leaving(instance, value) — rebuilds `value` leaving `instance`, converting resources to externs and panicking on other handles; [exp]; callers: 1 outside folder
- hostValuesIn(instance, value, other) — replaces resource handles in `value` with extern values and other handles via `other`; [exp]; callers: 1 outside folder
- leavingCall(instance, closure) — extracts `{function, captures}` from `closure` with captures mapped through `leaving`; [exp]; callers: 2 outside folder
- arriving(instance, value) — rebuilds `value` arriving in `instance`, interning resource externs into heap `resource` handles; [exp]; callers: 5 outside folder

## src/runtime/scheduler/instance/disposal-notices.ts — Notifying external live-run observers when a live future or runtime is disposed
- DisposalNotices — per-object-id callback registry invoked when a live future or `_Runtime` resource is disposed; [exp]; callers: 0 outside folder
- DisposalNotices.disposed(id) — deletes and invokes all disposal notice callbacks registered for object `id`; callers: 0 outside folder

## src/runtime/scheduler/instance/futures.ts — Creating, settling, and following futures, timers, watches, and external answers
- Settled — `{value: Value}` wrapper for a resolved future's value; [exp]; callers: 1 outside folder
- Caller — `{instance?, token}` identifying an external mock or context caller awaiting an answer; [exp]; callers: 1 outside folder
- Answered — `Caller` plus `{value, followed}` for a completed answer to an external call; [exp]; callers: 2 outside folder
- AnswerGiven — callback invoked when an `answer` object's future resolves to a non-future value; [exp]; callers: 0 outside folder
- Resolution — `{id, value}` pair passed to `resolveTogether`; [exp]; callers: 0 outside folder
- Futures — manages heap `future` and `answer` objects, timer/watch resolution, and wait settlement; [exp]; callers: 0 outside folder
- Futures.resolveTogether(resolutions) — marks `resolutions` resolved, settles registered `Waits`, and advances `answer` objects; callers: 0 outside folder
- Futures.#answer(answer) — chains `answer` onto a returned nested future or emits `#answered` and removes `answer`; callers: 0 outside folder
- Futures.endOf(future) — follows resolved futures from `future` until a non-future value or a pending future is reached; callers: 0 outside folder
- Futures.pendingIn(value) — returns the future id `value` points to if it (or what it resolves to) is still pending; callers: 0 outside folder
- Futures.#futureIn(value) — returns the object id if `value` is a handle to a `future` object, else `undefined`; callers: 0 outside folder
- Futures.answer(future, caller) — creates an `answer` root object on `future` and immediately processes it if already resolved; callers: 0 outside folder
- Futures.withdraw(withdrawn) — removes `answer` objects matching `withdrawn` caller futures; callers: 0 outside folder
- Futures.resolveWatches(holds) — resolves all pending `watch` futures for which `holds(state)` returns a value; callers: 0 outside folder
- Futures.#valueOf(id) — returns the value of resolved future `id`; callers: 0 outside folder
- Futures.#settle(id, value) — transitions pending future `id` to `resolved` and forgets its disposal notices; callers: 0 outside folder
- Futures.resolveHost(token, value) — resolves the pending `host` future matching `token` with `value()`; callers: 0 outside folder
- Futures.createFilled(tokenOf) — creates a pending `host` future with token `tokenOf(id)` and returns `{id, token}`; callers: 0 outside folder
- Futures.nextTimer() — returns the earliest `at` timestamp among pending `timer` futures in the heap; callers: 0 outside folder
- Futures.resolveDueTimers(now) — groups pending timers with `at <= now` by timestamp and resolves each instant in order; callers: 0 outside folder

## src/runtime/scheduler/instance/heap-indexes.ts — Declarative secondary index definitions over heap objects
- indexes — secondary index definitions (`executions`, `weakRefs`, `watches`, `hostFutures`, `pending`, `mocks`, `answers`, etc.); [exp]; callers: 0 outside folder
- Indexes — `typeof indexes`; [exp]; callers: 0 outside folder
- IndexName — `keyof Indexes`; [exp]; callers: 0 outside folder
- IndexKey — key type of index `Name`; [exp]; callers: 0 outside folder
- indexNames — array of all `IndexName`s; [exp]; callers: 0 outside folder
- readIndexes — set of index names (`resolvers`, `cases`, `positions`) that contribute holder edges; [exp]; callers: 0 outside folder
- keysOf(object) — returns all `[IndexName, key]` pairs derived from `object`; [exp]; callers: 0 outside folder

## src/runtime/scheduler/instance/heap.ts — Indexed heap of live objects reporting every mutation to `HolderWrites`
- LiveExecution — live execution heap object (`id`, `resolves`, `frames: ActiveFrame[]`, `disposing`); [exp]; callers: 13 outside folder
- LiveObject — union of stored `HeapObject` kinds with `execution` replaced by `LiveExecution`; [exp]; callers: 3 outside folder
- LiveKind — `LiveObject['kind']`; [exp]; callers: 0 outside folder
- LiveObjectOf — narrows `LiveObject` to `Kind`; [exp]; callers: 5 outside folder
- Heap — indexed serial-id object store reporting all field and index-edge holder changes to `HolderWrites`; [exp]; callers: 7 outside folder
- Heap.restore(objects) — populates an empty heap from restored `objects` in id order and reports their holdings; callers: 0 outside folder
- Heap.add(make) — allocates the next serial id, builds `make(id)`, and writes it into the heap; callers: 0 outside folder
- Heap.of(id, kind) — returns object `id` narrowed to `kind`, or calls `unreachable`; callers: 0 outside folder
- Heap.replace(object) — replaces existing object `object.id` of the same kind and records it in `#written`; callers: 0 outside folder
- Heap.remove(id) — removes object `id` from the heap if present; callers: 0 outside folder
- Heap.keepOnly(kept) — removes all objects not in `kept` and settles `#holders` and `#written`; callers: 0 outside folder
- Heap.#write(changes) — applies batch object additions/replacements/removals, updating indexes and reporting `HolderWrites`; callers: 0 outside folder
- Heap.find(name, key) — returns objects filed under `key` in index `name` in ascending id order; callers: 0 outside folder
- Heap.objectOf(id) — returns `LiveObject` `id` of any kind, or calls `unreachable`; callers: 0 outside folder
- Heap.#enter(object) — adds `object.id` to `#kinds` and all secondary indexes in `keysOf(object)`; callers: 0 outside folder
- Heap.#leave(object) — removes `object.id` from all secondary indexes in `keysOf(object)`; callers: 0 outside folder
- Heap.holds(object) — returns all object ids held by non-execution `object` (fields, values, and index edges); callers: 0 outside folder
- Heap.held(object) — returns `Held` (`values` and `holds` including index edges) for `object`; callers: 0 outside folder
- Heap.#indexedHeld(reader) — returns `Held` from index edges alone for object `reader`; callers: 0 outside folder
- Heap.#readers(objects) — finds all objects whose index-held edges depend on `objects` (transitively up `positions`); callers: 0 outside folder
- Heap.#indexedHolds(object) — computes index-derived held ids for a `future`, `wait`, or case-rooted `resolver`; callers: 0 outside folder
- Heap.#awaited(resolvers) — filters `resolvers` to those registered on a future or transitively awaited via `positions`; callers: 0 outside folder
- handleObject(handle) — unwraps the heap object id from `handle` or calls `unreachable`; [exp]; callers: 3 outside folder

## src/runtime/scheduler/instance/index.ts — Running `Instance` state in memory: heap, waits, futures, slots, weak refs, and snapshots
- InstanceStatus — `Snapshot['status']`; [exp]; callers: 0 outside folder
- Instance — in-memory running instance assembling `Heap`, `HolderWrites`, `Waits`, `Futures`, `Slots`, `WeakSide`, `SegmentEffects`; [exp]; callers: 14 outside folder
- Instance.start(loaded, snapshot) — constructs an `Instance` from an `unstarted` snapshot and starts its code root execution; callers: 0 outside folder
- Instance.restore(loaded, snapshot) — constructs an `Instance` from a committed snapshot; callers: 0 outside folder
- Instance.persisted() — walks from roots to return held `HeapObject[]` and maximum value `depth` for a commit; callers: 0 outside folder
- Instance.dropUnheld() — sweeps unreachable uncounted/cyclic objects in a live run once heap size doubles; callers: 0 outside folder
- Instance.#kept() — walks from `rootKinds` via `heldFrom`, asserting no unreachable object is disposable; callers: 0 outside folder
- Instance.snapshot(status, objects) — builds a new `Snapshot` merging `#from`, `effects.committing()`, `objects`, and `#ready.ids`; callers: 0 outside folder
- Instance.continueFrom(committed) — prunes the heap to `committed.objects` and clears `effects` to continue after commit; callers: 0 outside folder
- Instance.startExecution(entry, contents, captures, resolves) — creates a `newFrame` and adds a `LiveExecution` to `heap`; callers: 0 outside folder
- Instance.releaseRoot() — drops ready runs, stops any root execution, and removes `outcome` root objects; callers: 0 outside folder
- Instance.releaseAnswers() — removes all `answer` root objects when the instance ends; callers: 0 outside folder
- Instance.stop(execution) — ends `execution`'s wait, releases all its frames innermost-first, and removes it from `heap`; callers: 0 outside folder
- Instance.resumeOn(execution, decision) — ends `execution`'s wait and resumes its top frame with `decision`; callers: 0 outside folder
- Persisted — `{objects, depth}` returned by `Instance.persisted()`; [exp]; callers: 0 outside folder
- topFrame(execution) — returns the innermost `ActiveFrame` of `execution` or calls `unreachable`; [exp]; callers: 3 outside folder

## src/runtime/scheduler/instance/instance-ends.ts — Reading another instance's committed snapshot and end `Result` from the store
- panicCode — `'panic'` error code used in `Err(Error)` when an instance or context panics; [exp]; callers: 1 outside folder
- storedSnapshot(store, instance) — reads and decodes `instance`'s snapshot from `store`, memoized per `(store, instance, text)`; [exp]; callers: 2 outside folder
- endOf(types, snapshot, result) — builds `Ok(outcome)` or `Err(Error)` of type `result` if `snapshot` has ended; callers: 0 outside folder
- storedEnds(store, types) — returns a lookup `(instance, result) => Value | undefined` for `inst.result()` watches; [exp]; callers: 1 outside folder

## src/runtime/scheduler/instance/instance-names.ts — Formatting `<parent>/<n>` spawned instance names and listing ancestor names
- spawnedSeparator — `'/'` separator between parent instance name and spawn index; [exp]; callers: 0 outside folder
- spawnedName(parent, count) — formats `${parent}/${count}` for the `count`th child spawned by `parent`; [exp]; callers: 0 outside folder
- ancestorsOf(instance) — lists ancestor instance names of `instance` from nearest parent to root; [exp]; callers: 1 outside folder

## src/runtime/scheduler/instance/live-objects.ts — Converting between stored `HeapObject`s and live `LiveObject`s with `ActiveFrame`s
- liveObject(definition, object, heap) — converts a stored `HeapObject` to a `LiveObject` with empty `ActiveFrame` registers; [exp]; callers: 0 outside folder
- liveFrame(definition, frame, heap) — creates an empty `ActiveFrame` at `frame.pc` for `frame.function`; callers: 0 outside folder
- restoreRegisters(stored, live) — populates `live` execution frames' registers from `stored` via `placeContents`; [exp]; callers: 0 outside folder
- storedObject(object) — converts a `LiveObject` to a serializable `HeapObject` with sparse register tuples; [exp]; callers: 0 outside folder

## src/runtime/scheduler/instance/ready.ts — FIFO queue of decided waiters and readied resolver callback runs
- ReadyToRun — `LiveExecution | LiveObjectOf<'run'>` dequeued to drive next; [exp]; callers: 1 outside folder
- ReadyQueue — FIFO queue of ready execution and `run` object ids persisted in `Snapshot.ready`; [exp]; callers: 0 outside folder
- ReadyQueue.run(callback, argumentValues) — adds a `run` heap object for `callback(argumentValues)` and queues its id unless closed; callers: 0 outside folder
- ReadyQueue.close() — marks the queue closed, withdraws all `run` objects, and removes them from the heap; callers: 0 outside folder
- ReadyQueue.withdraw(ready) — removes `ready.id` from `#ids` if present; callers: 0 outside folder
- ReadyQueue.next(waits) — shifts the next id, removing and returning a `run` or resuming a waiter execution past its wait; callers: 0 outside folder

## src/runtime/scheduler/instance/segment-effects.ts — Buffering a segment's spawns, answers, logs, random draws, and pinned extern constants
- Spawn — buffered child instance spawn record (`name`, `call`, `seed`, `encoder`, options); [exp]; callers: 0 outside folder
- SegmentEffects — accumulates uncommitted segment side effects and produces updated snapshot fields on commit; [exp]; callers: 0 outside folder
- SegmentEffects.pinned(key, read) — returns cached extern constant `key` or evaluates and pins `read()`; callers: 0 outside folder
- SegmentEffects.spawn(call, options, encoder) — draws a child seed, records a `Spawn`, and returns its `<parent>/<n>` name; callers: 0 outside folder
- SegmentEffects.draw() — computes the next deterministic HMAC-SHA-256 random draw for this segment; callers: 0 outside folder
- SegmentEffects.committing() — returns updated `{spawned, random, pinned}` fields to merge into the committed snapshot; callers: 0 outside folder
- SegmentEffects.clear() — resets buffered spawns, answers, logs, and draw count after a segment commits; callers: 0 outside folder

## src/runtime/scheduler/instance/slots.ts — `Slot<T>` state machine, FIFO waiter queue, given-up pass-over, and loser-collection pause
- SlotOperation — `'put' | 'take' | 'read'` slot operation kind; [exp]; callers: 0 outside folder
- Slots — implements `Slot<T>` creation, operations, queue serving, and pause while `select` losers are uncollected; [exp]; callers: 1 outside folder
- Slots.operate(handle, operation, value) — completes immediately if servable and not owed, else queues a `slot` future; callers: 0 outside folder
- Slots.awaited(id) — triggers `#serve` when a resolver registers on pending slot future `id`; callers: 0 outside folder
- Slots.givenUp(id) — marks pending slot future `id` as `givenUp: true` when a case awaiting it loses; callers: 0 outside folder
- Slots.serveOwed() — serves all slots in `#owed` after `select` losers have been collected; callers: 0 outside folder
- Slots.#serve(id) — serves slot `id`'s queue event by event until unservable or paused for `losersUncollected`; callers: 0 outside folder
- Slots.#servableState(id) — returns future `id`'s state unless it is `givenUp` with no pending resolvers registered; callers: 0 outside folder
- nextServed(slot, stateOf) — computes the next batch of head readers, single take, or single put to resolve on `slot`; callers: 0 outside folder
- store(heap, slot, waiting, contents) — replaces `slot` in `heap` with updated `waiting` queue and optional `value`; callers: 0 outside folder
- completed(contents, operation, value) — computes `{yielded, contents}` for a completed `put`, `take`, or `read`; callers: 0 outside folder

## src/runtime/scheduler/instance/waits/endings.ts — Cancelling losing or withdrawn resolvers, running `onCancel`, and giving up futures
- Ending — `'lost' | 'withdrawn'` reason a pending resolver stops being awaited; [exp]; callers: 0 outside folder
- EndingSeams — callbacks (`watchesCall`, `called`, `givenUp`, `losersReleased`) used when ending resolvers; [exp]; callers: 0 outside folder
- ResolverEndings — cancels losing or withdrawn resolvers, readies `onCancel` callbacks, and marks futures given up; [exp]; callers: 0 outside folder
- ResolverEndings.cancelLosers(wait) — cancels pending case resolvers of decided `wait` except its waiter's own `disposing()` watch; callers: 0 outside folder
- ResolverEndings.end(resolver, state, ending) — sets `resolver` to `state`, queues `onCancel`, gives up futures if `'lost'`, cancels `at`s; callers: 0 outside folder
- ResolverEndings.lose(resolver, state) — ends `resolver` as `'lost'` and recursively loses its target if `target.kind === 'at'`; callers: 0 outside folder
- ResolverEndings.cancelPositions(resolver, ending) — cancels all pending `Resolver.at` resolvers targeting `resolver.id`; callers: 0 outside folder

## src/runtime/scheduler/instance/waits/index.ts — Managing `wait` and language `resolver` objects, registrations, and wait decisions
- WaitSeams — `EndingSeams` plus `decided(waiter, decision)` and `awaited(future)`; [exp]; callers: 0 outside folder
- Waits — implements `wait` and `resolver` lifecycle (`open`, `resolver`, `callback`, `at`, `onCancel`, `register`, `resolve`, `settle`); [exp]; callers: 3 outside folder
- Waits.open(waiter) — creates a pending `wait` heap object for `waiter` and returns its handle; callers: 0 outside folder
- Waits.at(done, position) — creates a pending `Resolver.at` targeting `done` if pending, else a `'cancelled'` resolver; callers: 0 outside folder
- Waits.onCancel(done, callback) — appends `callback` to pending `done.state.onCancel` or readies it immediately if `'cancelled'`; callers: 0 outside folder
- Waits.register(done, future, settled) — resolves `done` if `settled`, else registers `done` on `future` (or gives up if lost/ended); callers: 0 outside folder
- Waits.resolve(done, value) — resolves `done` with `value`, panicking if already `'resolved'` and losing if wait already decided; callers: 0 outside folder
- Waits.tryResolve(done, value) — attempts to decide `done` with `value`, cancelling it as lost if its wait was already decided; callers: 0 outside folder
- Waits.settle(resolved, settled) — resolves all pending resolvers registered on `resolved` futures in `settleOrder`; callers: 0 outside folder
- Waits.stopped(waiter) — readies `waiter` and cancels losing cases if its wait was already decided during `onAwait`; callers: 0 outside folder
- Waits.cleanupCase(waiter) — finds the case position of `waiter`'s stopped wait registered on `waiter`'s own `disposing()` watch; callers: 0 outside folder
- Waits.#endWith(frame, ending) — takes the wait from `frame`, cancels its pending case resolvers with `ending`, and removes the wait; callers: 0 outside folder
- Waits.#pending(target) — adds a pending `resolver` heap object with `target` and returns its handle; callers: 0 outside folder
- Waits.#take(resolver, value) — resolves `resolver` and propagates `(position, value)` to `at`, decides `case`, or calls `callback`; callers: 0 outside folder
- Waits.#decide({wait, position}, value) — marks `wait` decided at `position` with `value` and readies its stopped waiter or cancels losers; callers: 0 outside folder

## src/runtime/scheduler/instance/waits/resolvers.ts — Types and heap lookups for `wait` and `resolver` objects and `Resolver.at` chains
- Wait — `LiveObjectOf<'wait'>`; [exp]; callers: 0 outside folder
- Resolver — `LiveObjectOf<'resolver'>`; [exp]; callers: 0 outside folder
- PendingResolver — `Resolver` narrowed to `state.kind === 'pending'`; [exp]; callers: 0 outside folder
- CaseTarget — `Extract<ResolverTarget, { readonly kind: 'case' }>`; [exp]; callers: 0 outside folder
- CaseResolver — `PendingResolver` targeting a `CaseTarget`; [exp]; callers: 0 outside folder
- Ended — `'resolved' | 'cancelled'` resolver state; [exp]; callers: 0 outside folder
- isPending(resolver) — type guard for `PendingResolver`; [exp]; callers: 0 outside folder
- isCase(resolver) — type guard for `CaseResolver`; [exp]; callers: 0 outside folder
- pendingOf(heap, id) — returns resolver `id` narrowed to `PendingResolver` or calls `unreachable`; [exp]; callers: 0 outside folder
- rootOf(heap, resolver) — follows `target.kind === 'at'` links to the root `case` or `callback` `PendingResolver`; [exp]; callers: 0 outside folder
- positioned(position, value) — builds the 2-tuple `{kind: 'tuple', elements: [position, value]}` for `Resolver.at`; [exp]; callers: 0 outside folder
- waiterOf(heap, wait) — returns the `LiveExecution` for `wait.waiter`, or `undefined` if off-heap carrier; [exp]; callers: 0 outside folder
- stoppedWait(heap, waiter) — returns the `Wait` object `waiter`'s top frame is stopped at, if any; [exp]; callers: 0 outside folder
- pendingCases(heap, wait) — returns all `CaseResolver`s currently pending for `wait.id`; [exp]; callers: 0 outside folder

## src/runtime/scheduler/instance/waits/settle-order.ts — Deterministic settlement ordering for resolvers on simultaneously resolved futures
- Registration — `{resolver, future, order}` for a pending resolver's earliest registration among resolved futures; [exp]; callers: 0 outside folder
- settleOrder(heap, resolved) — sorts `registrationsOn(heap, resolved)` by `rankOf` then registration `order`; [exp]; callers: 0 outside folder
- registrationsOn(heap, resolved) — collects each pending resolver's earliest registration on any future in `resolved`; callers: 0 outside folder
- rankOf(heap, resolver) — computes lexicographic `bigint[]` rank (case waiters by waiter id + case pos + `at` pos before callbacks); callers: 0 outside folder
- compareRanks(first, second) — compares two `bigint[]` rank tuples lexicographically; callers: 0 outside folder

## src/runtime/scheduler/instance/weak-side.ts — `WeakRef<T>` creation, `deref()`, and `disposed()`/`disposing()` watch futures
- WeakSide — `NativeWeakSide` implementation managing `weakRef` objects and their `disposed` watch futures; [exp]; callers: 1 outside folder
- WeakSide.reference(referent) — returns the unique `weakRef` handle for `referent`, creating it on first use; callers: 0 outside folder
- WeakSide.target(weak) — returns `referent`'s handle if still alive and its holder count is non-zero, else `undefined`; callers: 0 outside folder
- WeakSide.watch(weak) — returns an already-resolved future if `target === 'disposed'`, else a pending `disposed` watch future; callers: 0 outside folder
- WeakSide.watchesCall(execution, future) — tests whether `future` is a pending `disposing()` watch on `execution`; callers: 0 outside folder
- WeakSide.#letGo(target, gone) — sets `target`'s `weakRef.target` to `'disposed' | 'callEnded'` and returns its watch future ids; callers: 0 outside folder

## src/runtime/scheduler/live-resolvers.ts — One-shot `NativeResolver` and cancellation for live futures filled from outside a run
- LiveResolver — one-shot resolver queuing settlement or failure on `LiveResumes` and invoking `onCancel` callbacks; callers: 0 outside folder
- LiveResolver.tryResolve(value) — transitions from `'pending'` to `'resolved'` and queues fulfilled `value` on `#settle`; callers: 0 outside folder
- LiveResolver.fail(panic) — transitions from `'pending'` to `'resolved'` and queues rejected `panic` on `#settle`; callers: 0 outside folder
- LiveResolver.onCancel(callback) — invokes `callback` immediately if already `'cancelled'`, else appends to `#cancels`; callers: 0 outside folder
- LiveResolver.cancel() — transitions from `'pending'` to `'cancelled'` and invokes all registered `#cancels` callbacks; callers: 0 outside folder
- LiveResolver.#cancelling(callback) — calls `callback`, turning any thrown JS error into a `#misused` panic on the run; callers: 0 outside folder
- liveResolvable({futures, notices}, resumes, trace) — creates a `host` future, wires its `LiveResolver` to `resumes` and `notices`; [exp]; callers: 2 outside folder

## src/runtime/scheduler/live-run.ts — Driving an ephemeral `live` run in memory on the host event loop and clock
- runLive(clock, loaded, snapshot, contexts) — runs `snapshot` as an in-memory live run to completion while driving `contexts`; [exp]; callers: 1 outside folder
- runToEnd(clock, instance, waiting) — executes live segments, dropping unheld objects and awaiting timers/resumes/contexts between segments; callers: 0 outside folder
- idled(clock, instance, {resumes, contexts}) — advances `contexts`, checks if any host future or timer can wake the run, and awaits `woken`; callers: 0 outside folder
- runContexts(clock, contexts) — wakes due timers in `contexts` and runs ready context work; callers: 0 outside folder
- earliest(first, second) — returns the earlier of two optional `bigint` timestamps; callers: 0 outside folder
- woken(clock, due, resumes) — races `resumes.called()` against `clock.until(due)` (deferring timer wait one macrotask turn if resumes exist); callers: 0 outside folder

## src/runtime/scheduler/loaded-definition.ts — Binding a Definition to its `FunctionTable`, `TestWorld`, and `HeapCheck`
- HeapCheck — test-only oracle callbacks (`changed` after steps, `native` around native calls) inspecting heap invariants; [exp]; callers: 4 outside folder
- NativeCallMade — `{key, passed, values}` descriptor passed to `HeapCheck.native`; [exp]; callers: 1 outside folder
- noHeapCheck — no-op `HeapCheck` used in production runs; [exp]; callers: 0 outside folder
- LoadedDefinition — `{definition, hash, functions, world, heapCheck}` bound once per deployed Definition; [exp]; callers: 5 outside folder
- TestLoading — optional `{world, heapCheck}` overrides passed to `loadDefinition`; [exp]; callers: 0 outside folder
- loadDefinition(definition, hash, natives, options) — binds `definition` to `natives` in a `FunctionTable` with `world` and `heapCheck`; [exp]; callers: 2 outside folder

## src/runtime/scheduler/resident.ts — Holding an active `Instance` in memory alongside its last committed `Snapshot`
- Resident — caches an active `Instance` across segments so subsequent segments continue without re-decoding its `Snapshot`; [exp]; callers: 5 outside folder
- Resident.take() — takes the cached `Instance` (or starts/restores a fresh one from `#committed`) for one segment; callers: 0 outside folder
- Resident.committedBy(instance, snapshot) — updates `#committed` and retains `instance` via `continueFrom` if still `'active'`; callers: 0 outside folder
- Resident.frozenAt(snapshot) — updates `#committed` and drops `#held` when an instance panics or terminates; callers: 0 outside folder

## src/runtime/scheduler/run-contexts.ts — Seam interface (`RunContexts`) between a live run and the persistent contexts it drives
- CallMaker — `'program' | 'jobs'` tag distinguishing user `Runtime.call` from the job-serving loop's `_jobCall`; [exp]; callers: 2 outside folder
- ContextCall — `{key, call, future, listener, maker}` request to invoke a closure in context `key`; [exp]; callers: 1 outside folder
- ServedWait — `{runtime, known, future, listener}` request waiting for `_served` instance names; [exp]; callers: 1 outside folder
- CallListener — `{answered(value), panicked(panic)}` callbacks for a `ContextCall`; [exp]; callers: 1 outside folder
- RunContexts — interface used by `live-run.ts` and `native-contexts.ts` to open, call, and drive persistent contexts; [exp]; callers: 2 outside folder

## src/runtime/scheduler/segment/answering.ts — Starting a segment that answers an external mock call or context invocation
- AnsweredCall — `{function, captures, arguments, caller}` descriptor for an external call answered by an instance; [exp]; callers: 0 outside folder
- startAnswering(instance, natives, call) — creates a `call` future, registers an `answer` object, and starts code or resolves a native; [exp]; callers: 1 outside folder
- startInvocation(instance, natives, {call, token}) — maps `call`'s captures/args through `arriving` and calls `startAnswering`; [exp]; callers: 0 outside folder

## src/runtime/scheduler/segment/calls.ts — Unified call entry point handling mocks, default prologues (`handOver`), natives, and call-rule checks
- Caller — `{instance, natives, now, waiting}` context of a segment making calls; [exp]; callers: 0 outside folder
- CallTarget — `{kind: 'answered', value}` or `{kind: 'code', entry, contents, captures}` result of starting a call; [exp]; callers: 0 outside folder
- startCall(caller, target, contents, captures) — intercepts `target` with any active mock (after prologue if needed) or calls `runCall`; [exp]; callers: 0 outside folder
- handOver(caller, frame) — hands a prologue frame at its `body` instruction over to the active mock (or target) with full parameters; [exp]; callers: 0 outside folder
- runsAsExecution(entry) — tests whether `entry` runs as a separate async `LiveExecution` (`mode !== 'simple'` and not `handsOver`); [exp]; callers: 0 outside folder
- returnedValue(instance, frame, value) — passes `value` through `arriving(instance, value)` if `frame.arrives` is set; [exp]; callers: 0 outside folder
- replacedCall(caller, target, reached, contents) — dispatches a mocked call to `mockedCall` and wraps a local replacement with `arrivingFrom`; callers: 0 outside folder
- runCall(caller, run, passed) — invokes a native immediately or checks `mayCall` and returns `{kind: 'code'}` for a code entry; callers: 0 outside folder
- givenContents(passed) — asserts `givesEvery(passed)` for a native or mock call; callers: 0 outside folder
- arrivingFrom(instance, target) — converts an immediate mock answer via `arriving` or marks a code replacement frame `arrives: true`; callers: 0 outside folder

## src/runtime/scheduler/segment/collection.ts — Running post-step reference-count collection, `HeapCheck`, slot serving, and ending disposal
- SegmentCollection — wires `Collector` and `DisposalRuns` to collect zero-holder objects after each interpreter step; [exp]; callers: 0 outside folder
- SegmentCollection.collected() — runs `heapCheck.changed`, `collector.collect()`, and `slots.serveOwed()` in a loop until settled or busy; callers: 0 outside folder
- SegmentCollection.collectFully(step) — steps disposal code until `collected()` returns `true`; callers: 0 outside folder
- SegmentCollection.collectEnding(step) — collects during instance termination, abandoning any disposal that panics and continuing; callers: 0 outside folder

## src/runtime/scheduler/segment/disposal-runs.ts — Running declared `dispose` calls and async `disposing()` cleanups on the segment `RunStack`
- DisposalRunSeams — `{instance, caller, runStack, returned, abandoned}` seams for `DisposalRuns`; [exp]; callers: 0 outside folder
- DisposalRuns — executes `DisposalCall` frames and `Cleanup` executions on `runStack` and abandons panicking ones on end; [exp]; callers: 0 outside folder
- DisposalRuns.replaceFrame(frame, replacement) — transfers disposal-frame tracking when a prologue frame hands over to a mock; callers: 0 outside folder
- DisposalRuns.returned(execution, frame) — finishes a tracked disposal call frame when it returns and notifies the collector; callers: 0 outside folder
- DisposalRuns.suspended(execution) — stops a disposed call's `Cleanup` execution at its next `await` or return and notifies the collector; callers: 0 outside folder
- DisposalRuns.abandon() — unwinds and stops frames/executions of the innermost panicking disposal during instance termination; callers: 0 outside folder
- DisposalRuns.innermost() — finds the innermost active disposal frame or cleanup execution on `runStack`; callers: 0 outside folder
- DisposalRuns.#call(call) — starts a `DisposalCall` via `startCall`, pushing its frame onto `runStack` (using `#carrier` if empty); callers: 0 outside folder
- DisposalRuns.#cleanup({execution, position}) — resumes `execution` on its `disposing()` case `position` and pushes it onto `runStack`; callers: 0 outside folder

## src/runtime/scheduler/segment/index.ts — `SegmentRunner` (`Machine`) executing one atomic segment or live-run segment
- SegmentStart — initial action of a segment (`driver`, `answer`, `invocation`, or extern `call`); [exp]; callers: 1 outside folder
- runSegment(instance, startedAt, first) — runs one persistent segment of `instance` and checks persistence depth; [exp]; callers: 1 outside folder
- startLiveSegment(instance, now, waiting, root) — runs the first segment of a live run starting from `root`; [exp]; callers: 1 outside folder
- runLiveSegment(instance, now, waiting) — runs a subsequent segment of a live run; [exp]; callers: 1 outside folder
- endInstance(instance, startedAt) — releases roots, answers, executions, and context constants of `instance`, collecting panics; [exp]; callers: 1 outside folder
- SegmentRunner — implements `Machine`, driving ready executions, async calls, returns, waits, outcomes, and collection; callers: 0 outside folder
- SegmentRunner.run(first) — runs `#started(first)` and ready drivers, wrapping the result in `persistable` and `#panicking`; callers: 0 outside folder
- SegmentRunner.#started(first) — dispatches `SegmentStart` (`callExtern`, `startAnswer`, `startInvocation`, or `first.execution`); callers: 0 outside folder
- SegmentRunner.#letGoOfTheRest(collect) — releases owed answers, remaining executions, and context constants in order, collecting after each; callers: 0 outside folder
- SegmentRunner.call(frame, callee, argumentList, captures) — evaluates `argumentContents` and enters `startCall`; callers: 0 outside folder
- SegmentRunner.handOver(frame) — replaces prologue `frame` at `body` with its mock's answer, execution, or replacement frame; callers: 0 outside folder
- SegmentRunner.#enter(frame, target) — resumes `frame` if `answered`, pushes a new `LiveExecution` if async, or pushes a synchronous frame; callers: 0 outside folder
- SegmentRunner.wait() — handles an `await` or blocking `select`, ending the segment if driver-only or popping an async child execution; callers: 0 outside folder
- SegmentRunner.#finished(outcome) — disposes remaining answers, executions, and context constants and returns `{kind: 'finished', ...outcome}`; callers: 0 outside folder
- SegmentRunner.#runDrivers(first) — collects initial zeroes and drives `first` and ready executions/runs until await, finish, or idle; callers: 0 outside folder
- SegmentRunner.#run(run) — starts callback `run` on `RunCalls` and drives its carrier (or collects if answered immediately); callers: 0 outside folder
- SegmentRunner.#next() — returns an arrived/encoding `RootOutcome` step if ready, else `instance.resumeNext()`; callers: 0 outside folder
- SegmentRunner.#drive(driver) — drives `driver` on `#runStack` step by step until `#end` is set and `#collection.collected()` is done; callers: 0 outside folder
- SegmentRunner.#step() — fetches and executes the instruction at the top frame's `pc` via `runInstruction`; callers: 0 outside folder

## src/runtime/scheduler/segment/limits.ts — Converting V8 `RangeError` allocation limits and value/frame depth limits into `Panic`s
- limits — map from V8 string/array/BigInt `RangeError` messages to user-facing `Panic` messages; callers: 0 outside folder
- panicOf(error) — returns `error` if a `Panic`, or wraps a recognized V8 limit `RangeError` in a `Panic`; [exp]; callers: 0 outside folder
- requireDepth(depth) — throws a `Panic` if persisted value nesting `depth` exceeds `maximumDepth` (256); [exp]; callers: 0 outside folder
- requireFrameDepth(frames) — throws a `Panic` if active frame count `frames` exceeds `maximumFrames` (200,000); [exp]; callers: 0 outside folder

## src/runtime/scheduler/segment/native-calls.ts — Assembling `FullNativeContext` capabilities and invoking runtime/host natives
- NativeCalls — builds per-segment `NativeCapabilities` and invokes natives with `HeapCheck.native` and constant pinning; [exp]; callers: 1 outside folder
- NativeCalls.call(callee, native, contents) — dereferences args, builds `NativeContext`, runs `HeapCheck.native`, and pins constants; callers: 0 outside folder
- NativeCalls.#checked(call, called) — wraps `called()` with `loaded.heapCheck.native` before and after; callers: 0 outside folder
- referenceAt(contents, position) — extracts the `&` `Reference` at `contents[position]` or calls `unreachable`; callers: 0 outside folder
- capabilitiesOf(instance, side) — assembles all ten `NativeCapabilities` (`futures`, `waits`, `slots`, `weak`, `resources`, `random`, etc.); callers: 0 outside folder
- nativeFuturesOf(instance, {waiting, trace}) — builds `NativeFutures` (`resolved`, `timer`, `resolvable`); callers: 0 outside folder
- nativeWaitsOf({waits, futures}) — builds `NativeWaits` (`onAwait`, `resolve`, `tryResolve`, `callback`, `at`, `onCancel`); callers: 0 outside folder
- nativeSlotsOf(slots) — builds `NativeSlots` (`create`, `put`, `take`, `read`); callers: 0 outside folder
- nativeResourcesOf(heap) — builds `NativeResources` (`create`, `payloadOf`); callers: 0 outside folder
- nativeInstancesOf(instance, waiting) — builds `NativeInstances` (`spawn` with outcome encoder, `ended` watch future); callers: 0 outside folder
- nativeTestingOf(instance) — builds `NativeTesting` (`mock`, `calls`, `inspect`, `watch`, `handle`); callers: 0 outside folder

## src/runtime/scheduler/segment/native-contexts.ts — Implementing `NativeContexts` for live runs to open runtimes and invoke contexts
- nativeContextsOf(instance, waiting, trace) — builds `NativeContexts` (`hostStore`, `open`, `call`, `served`, `jobServer`); [exp]; callers: 0 outside folder
- liveOf(waiting) — narrows `waiting` to `LiveWaiting` or calls `unreachable`; callers: 0 outside folder
- awaitedFromContexts(instance, {resumes, contexts}, trace, waitOn) — creates a `liveResolvable` future for `waitOn` and releases on cancel; callers: 0 outside folder
- answering(instance, result, resolver) — builds a `CallListener` resolving `resolver` with `Ok(arriving(value))` or `Err(Error)`; callers: 0 outside folder

## src/runtime/scheduler/segment/returns.ts — Landing frame returns into callers, call futures, disposal/callback carriers, or `RootOutcome`
- DriveEnd — `'awaited' | 'returned' | {finished: Outcome}` result of driving an execution; [exp]; callers: 0 outside folder
- ReturnSeams — `{instance, runStack, outcome, collection, runCalls}` seams used by `landReturn`; [exp]; callers: 0 outside folder
- landReturn(seams, frame, given) — consults `outcome.returning`, pops `frame`, and hands `value` over to `landPopped`; [exp]; callers: 0 outside folder
- landPopped(seams, {frame, execution, value, awaits}) — releases `frame` and routes `value` to disposal, encoder, caller, run, or future; callers: 0 outside folder
- leave(runStack, future, end) — pops the top execution and passes `handleTo(future)` to the caller beneath (or ends drive with `end`); [exp]; callers: 0 outside folder
- waitsOn({instance, runStack}, returned) — checks if a `simple` driver returned a pending future and records it on `runStack.stoppedIn`; callers: 0 outside folder

## src/runtime/scheduler/segment/root-outcome.ts — Tracking, awaiting, and JSON-encoding an instance's root outcome
- RootOutcomeSeams — `{instance, caller, runStack}` seams for `RootOutcome`; [exp]; callers: 0 outside folder
- Outcome — `{outcome: Value, encoded?: Value}` of a finished instance; [exp]; callers: 0 outside folder
- Returning — `{kind: 'return', value} | {kind: 'await'} | {kind: 'encode'}` action when a frame returns; [exp]; callers: 0 outside folder
- Arrival — `{kind: 'encode', root} | {kind: 'finished', outcome}` when an extern or awaited root outcome arrives; [exp]; callers: 0 outside folder
- RootOutcome — manages root call completion, pending future awaiting (`outcome` object), and outcome JSON encoder execution; [exp]; callers: 0 outside folder
- RootOutcome.returning(frame, value) — intercepts root execution's final return to await a pending future or push the outcome encoder; callers: 0 outside folder
- RootOutcome.callExtern(call) — invokes an extern root call at segment start and records or awaits its result; callers: 0 outside folder
- RootOutcome.arrival() — checks if an extern or awaited `outcome` future has resolved and starts its encoder or finishes; callers: 0 outside folder
- RootOutcome.#awaited(value) — follows `value` if it is a future handle, creating an `outcome` root object if still pending; callers: 0 outside folder
- RootOutcome.#resolved() — checks if the instance's `outcome` object future has resolved, releasing the root if so; callers: 0 outside folder
- RootOutcome.#encodes(frame, outcome) — calls the instance's outcome encoder on `outcome`, pushing its frame on top of `frame` if code; callers: 0 outside folder
- RootOutcome.#encoderCall(outcome) — starts the instance's `encoder` function with `[outcome]` via `startCall`; callers: 0 outside folder
- RootOutcome.returned(frame, value) — records `value` as `#encoded` when the encoder frame returns and returns its `RootReturn`; callers: 0 outside folder
- RootOutcome.finished(outcome) — drops ready runs and returns `{outcome, encoded}`; callers: 0 outside folder

## src/runtime/scheduler/segment/run-calls.ts — Running readied resolver callbacks (`run` objects) on an off-heap carrier execution
- RunCalls — drives synchronous `run` callback objects on an off-heap `#carrier` execution; [exp]; callers: 0 outside folder
- RunCalls.start(caller, run) — starts `run` via `startCall` and pushes its frame onto `#carrier` if not immediately answered; callers: 0 outside folder
- RunCalls.returned(execution) — pops `#carrier` from `#runStack` and returns `true` when `execution === #carrier`; callers: 0 outside folder

## src/runtime/scheduler/segment/run-stack.ts — Stack of nested `LiveExecution`s running within a segment with frame-depth and future holding
- RunStack — manages the active execution stack, total frame count limit, running call-future holdings, and stack traces; [exp]; callers: 0 outside folder
- RunStack.drive(driver) — sets `driver` as the sole execution on the stack and updates held call futures; callers: 0 outside folder
- RunStack.push(execution) — checks `requireFrameDepth`, pushes `execution`, and reports its call future as held; callers: 0 outside folder
- RunStack.pushFrame(frame) — checks `requireFrameDepth` and pushes `frame` onto the current top execution; callers: 0 outside folder
- RunStack.popFrame(frame) — pops `frame` from the current top execution and decrements `#frames`; callers: 0 outside folder
- RunStack.dropFrames(execution, at) — splices frames from `at` onward off `execution` in reverse order and updates `#frames`; callers: 0 outside folder
- RunStack.pop() — pops the top execution, releases its held call future, and returns the new top execution; callers: 0 outside folder
- RunStack.current() — returns the top `LiveExecution` or calls `unreachable`; callers: 0 outside folder
- RunStack.#framesInnermostFirst() — flattens all frames across `#executions` (or `#driver` after await) innermost first; callers: 0 outside folder

## src/runtime/scheduler/segment/segment-ends.ts — Segment completion states, `Panic` catching with stack traces, and persistence depth checking
- SegmentEnd — completion state of a persistent segment (`awaited`, `idle`, `finished`, or `panicked`); [exp]; callers: 1 outside folder
- LiveSegmentEnd — completion state of a live segment (`awaited`, `idle`, `finished`, or `panicked` without persisted objects); [exp]; callers: 0 outside folder
- RunEnd — pre-persistence segment completion state (`awaited`, `idle`, or `finished`); [exp]; callers: 0 outside folder
- endOrPanic(run, trace) — runs `run()`, catching any `Panic` or V8 limit `RangeError` (`panicOf`) and attaching `trace()`; [exp]; callers: 0 outside folder
- persistable(instance, end) — checks `requireDepth` on `end.outcome`/`encoded` or `instance.persisted()` and returns `SegmentEnd`; [exp]; callers: 0 outside folder

## src/runtime/scheduler/testing/mocks.ts — Finding active mocks (local or ancestor), recording calls, and relaying cross-instance mock calls
- reachingMock(mocks) — returns the mock with the highest `id` (newest) from `mocks`; [exp]; callers: 1 outside folder
- recordCall(instance, mock, values) — appends a call argument tuple (or `null` for 0 args) to `mock.calls` in `instance.heap`; callers: 0 outside folder
- MockedCall — `{kind: 'replaced', replacement, values}` or `{kind: 'answered', value}` result of calling a mock; [exp]; callers: 0 outside folder
- CallToMock — `{instance, startedAt, target, values}` descriptor for a call intercepted by a mock; [exp]; callers: 0 outside folder
- replacementOf(mock) — unwraps `mock.replacement` as a closure value or calls `unreachable`; callers: 0 outside folder
- reachedMock(instance, target) — finds the newest local mock or nearest ancestor mock in `world` replacing `target`; [exp]; callers: 1 outside folder
- ReachedMock — `{kind: 'own', mock}` or `{kind: 'relayed', held}` mock target; [exp]; callers: 1 outside folder
- mockedCall(call, reached) — records and prepares a local mock replacement or relays `call` to an ancestor holder via `relayCall`; [exp]; callers: 1 outside folder
- relayedMockOf(instance, target) — searches `ancestorsOf(instance.name)` via `world.mockOf` for a mock of `target`; callers: 0 outside folder
- relayCall(call, held) — creates a `host` future, asks `world.answer` on `held.holder`, and returns or resolves the answer; callers: 0 outside folder
- startAnswer(instance, natives, call) — records `call` on `instance`'s mock and starts its replacement via `startAnswering`; [exp]; callers: 1 outside folder

## src/runtime/scheduler/testing/test-world.ts — `TestWorld` seam between the scheduler and `runtime/testing/world/`
- CallerFuture — `{instance, token}` identifying a caller's pending mock-call future; [exp]; callers: 3 outside folder
- MockCall — `CallerFuture` plus `{mock, arguments}` for a cross-instance mock call; [exp]; callers: 3 outside folder
- MockAnswer — `{kind: 'given', value, followed} | {kind: 'pending'} | {kind: 'failed'}` result of `TestWorld.answer`; [exp]; callers: 1 outside folder
- TestWorld — scheduler seam for cross-instance mocks, `idle`/`waypoint` watches, `inspect`, and `testing.handle`; [exp]; callers: 2 outside folder
- noTestWorld — default `TestWorld` outside `ista test` that panics on test-only operations; [exp]; callers: 1 outside folder

## src/runtime/scheduler/waiting.ts — Waiting mode (`ista` vs `live`) and `LiveResumes` queue for waking a live run
- Waiting — discriminated union of `{kind: 'ista'}` and `{kind: 'live', resumes, contexts}`; [exp]; callers: 4 outside folder
- LiveWaiting — narrowed `Extract<Waiting, { readonly kind: 'live' }>`; [exp]; callers: 2 outside folder
- istaWaiting — `{kind: 'ista'}` constant for persistent instance segments; [exp]; callers: 1 outside folder
- FailedWait — `{message, trace}` of a rejected host promise or misused live resolver; [exp]; callers: 0 outside folder
- Resume — `(value: T) => void` one-shot callback waking a live run; [exp]; callers: 0 outside folder
- LiveResumes — queues one-shot live wait settlements and host resolver misuses and wakes the live run loop; [exp]; callers: 0 outside folder
- LiveResumes.once(resolve) — returns a one-shot `Resume<T>` that queues `() => resolve(value)` and wakes the driver; callers: 0 outside folder
- LiveResumes.fail(failed) — records the first host resolver misuse in `#misused` and wakes the driver; callers: 0 outside folder
- LiveResumes.called() — returns a Promise that settles as soon as a resume or misuse is queued; callers: 0 outside folder
- LiveResumes.applyNext() — applies `#misused` or shifts and runs the next queued resume callback; callers: 0 outside folder

## src/runtime/scheduler/wake.ts — Advancing and terminating persistent instances across committed segments and `crashEveryAwait`
- SchedulerSeams — `{store, now}` seams needed to advance or terminate a persistent instance; [exp]; callers: 2 outside folder
- Beginning — `SpawnOptions` plus `{seed, encoder?}` for initializing a new instance or context snapshot; [exp]; callers: 1 outside folder
- unstarted(loaded, name, call, beginning) — builds an `unstarted` `Snapshot` for `name` about to run `call`; [exp]; callers: 1 outside folder
- newContext(loaded, key, beginning) — builds an `active` `Snapshot` with no executions for a new context `key`; [exp]; callers: 2 outside folder
- begun(loaded, name, status, beginning) — shared helper constructing an initial `Snapshot` with `status` and `beginning`; callers: 0 outside folder
- AdvanceFirst — initial step for `advance` (`none`, `invocation`, `arrival`, `answer`, `withdraw`, plus optional `startedAt`); [exp]; callers: 4 outside folder
- Advance — `Advanced` plus `{answered: readonly Answered[]}`; [exp]; callers: 4 outside folder
- advance(seams, resident, first) — runs segments of `resident` (re-running on `crashEveryAwait`) and commits each until waiting; [exp]; callers: 2 outside folder
- terminate(seams, resident) — runs `endInstance` on panicked `resident`, commits spawned children and `terminated` snapshot; [exp]; callers: 1 outside folder
- replayOf(status, step) — builds the `Replay` (`call` or `invocation`) saved in a panicked snapshot for `retry`; callers: 0 outside folder
- runFrom(resident, watched, startedAt, step) — takes `resident`'s `Instance`, applies `step`/timers/watches, and runs one segment if needed; callers: 0 outside folder
- segmentStartOf(step) — maps `FirstStep` (`answer` or `invocation`) to `SegmentStart`; callers: 0 outside folder
- rerun(first, second) — compares `runText(first)` and `runText(second)` for `crashEveryAwait`, panicking on any divergence; callers: 0 outside folder
- runText({instance, end}) — serializes a segment's resulting snapshot, child snapshots, and logs (or panic) for `crashEveryAwait` comparison; callers: 0 outside folder
- commitChildren(store, instance) — writes `unstarted` snapshots of children spawned by `instance`'s segment unless already started in `store`; callers: 0 outside folder
- childrenOf(instance) — maps `instance.effects.spawns()` to `unstarted` `Snapshot`s; callers: 0 outside folder
- commit(store, snapshot) — encodes `snapshot`, writes it to `store`, and decodes it back so in-memory state matches stored state; callers: 0 outside folder

## src/runtime/snapshot/check/calls.ts — Validating snapshot calls (`unstarted`, `replay`, `run`, and resolver callbacks) against the Definition
- CallShape — `{function, captures, arguments}` arity descriptor of a persisted call; [exp]; callers: 0 outside folder
- callProblems(definition, call, described) — checks function existence, capture count, arg arity, and no `&` reference params; [exp]; callers: 0 outside folder
- calledBackProblems(definition, call, described) — checks `callProblems` plus that the target `returnsAtOnce` (does not wait); [exp]; callers: 0 outside folder
- shapeOf(call) — extracts `CallShape` counts from `{function, captures, arguments}`; [exp]; callers: 0 outside folder

## src/runtime/snapshot/check/index.ts — Validating a decoded Snapshot against its Definition before restoration
- checkSnapshot(definition, snapshot) — collects all object, wait, call-future, constant, start-call, encoder, and outcome problems; [exp]; callers: 1 outside folder
- objectProblems(definition, object) — validates all `valuesIn(object)` via `valueProblems` and dispatches `kindProblems`; callers: 0 outside folder
- kindProblems — exhaustive `Handlers` table validating each `HeapObject` kind against `definition`; callers: 0 outside folder
- contextConstantProblems(snapshot) — checks that no two `contextConstant` objects in `snapshot` share a `key`; callers: 0 outside folder
- callFutureProblems(snapshot) — checks that at most one root exists and every non-root execution resolves a unique pending `call` future; callers: 0 outside folder
- startingCallProblems(definition, status) — validates the `InstanceCall` in an `unstarted` or `panicked` replay status; callers: 0 outside folder
- startingCallOf(status) — extracts the `InstanceCall` from `unstarted` or `panicked` replay status, if any; callers: 0 outside folder
- encoderProblems(definition, encoder) — validates `snapshot.encoder` via `encoderProblem`; callers: 0 outside folder
- outcomeProblems(definition, status) — validates a `finished` snapshot's `outcome` and `encoded` `Json` value; callers: 0 outside folder
- frameProblems(definition, frame, standsAt) — checks that `frame.function` is code, registers are in bounds, and `pc` satisfies `standsAt`; callers: 0 outside folder

## src/runtime/snapshot/check/waits.ts — Validating a Snapshot's executions, ready queue, `wait` objects, and `resolver` chains
- waitProblems(definition, snapshot) — validates `ready` uniqueness, execution stops, `wait` objects, and pending `resolver` objects; [exp]; callers: 0 outside folder
- stopOf(definition, objects, execution) — inspects `execution`'s top frame wait instruction and resolves its `wait` object and case count; callers: 0 outside folder
- stopProblems(execution, stop, isReady) — checks `execution` waits on its own `wait` and `isReady` matches `wait.state.kind === 'decided'`; callers: 0 outside folder
- waitObjectProblems(wait, cases, pending) — checks that `wait` is stood at by its execution and has a valid decided case or pending resolver; callers: 0 outside folder
- resolverProblems(checked, resolver) — checks a pending resolver's `target`, `onCancel` callbacks, and that `on` futures are pending; callers: 0 outside folder
- callbackProblems(definition, callback, given, described) — checks `callback` is a closure valid for `calledBackProblems` with `given` args; callers: 0 outside folder
- targetProblems(checked, id, target) — validates a pending resolver's `callback`, `at` (`done.id < id` and `chainRoot`), or `case` target; callers: 0 outside folder

## src/runtime/snapshot/holdings.ts — Declarative holding and watching rules for every `HeapObject` kind, `FutureState`, and frame
- HoldingFrame — `{registers}` interface shared by live `ActiveFrame`s and stored `Frame`s; [exp]; callers: 1 outside folder
- rootKinds — `['execution', 'run', 'answer', 'outcome', 'contextConstant']` tuple of root heap object kinds; [exp]; callers: 1 outside folder
- isRoot(object) — type guard testing whether `object.kind` is in `rootKinds`; [exp]; callers: 2 outside folder
- Held — `{values: readonly Value[], holds: readonly number[]}` held by a register, object, or index edge; [exp]; callers: 6 outside folder
- nothingHeld — empty `Held` constant `{values: [], holds: []}`; [exp]; callers: 2 outside folder
- futureStates — exhaustive `Handlers` table mapping each `FutureState` kind to its `Held` values and object ids; callers: 0 outside folder
- kinds — exhaustive `Handlers` table mapping each `HeapObject` kind to its `Holding` (`values`, `holds`, `watches`); callers: 0 outside folder
- pendingResolver({target, on, onCancel}) — computes `Holding` for a pending resolver based on `isHeldFromRoot(target)`; callers: 0 outside folder
- isHeldFromRoot(target) — `true` when `chainRoot(target) === 'case'` (held from wait down) vs `'callback'` (from futures up); [exp]; callers: 1 outside folder
- heldObjects(object) — returns all object ids held directly or through values by `object`; [exp]; callers: 0 outside folder
- heldBy(object) — returns `{values, holds}` held by `object`'s fields and values (excluding heap index edges); [exp]; callers: 1 outside folder
- heldIn(contents) — returns `Held` for a single register's `RegisterContents | undefined`; [exp]; callers: 1 outside folder
- idsHeld(held) — combines `held.holds` and `handlesIn` of `held.values`; [exp]; callers: 2 outside folder
- valuesIn(object) — returns all `Value`s directly held in `object`; [exp]; callers: 1 outside folder
- referencedObjects(object) — returns all object ids held or watched by `object`; [exp]; callers: 0 outside folder
- frameValues(frame) — returns all non-reference `Value`s in `frame.registers`; [exp]; callers: 1 outside folder
- frameCells(frame) — returns all cell object ids referenced by `&` `Reference`s in `frame.registers`; [exp]; callers: 1 outside folder

## src/runtime/snapshot/objects.ts — Zod schemas and types for persisted frames, references, futures, waits, resolvers, and heap objects
- Reference — `{kind: 'reference', cell: number, path: number[]}` register contents for a `&` parameter; [exp]; callers: 2 outside folder
- RegisterContents — `Value | Reference` stored in a frame register; [exp]; callers: 7 outside folder
- isReference(contents) — type guard testing whether `RegisterContents` is a `Reference`; [exp]; callers: 5 outside folder
- Frame — persisted call frame `{function, pc, registers, arrives?}`; [exp]; callers: 4 outside folder
- futureState — zod discriminated union schema for the 7 `FutureState` kinds (`resolved`, `call`, `slot`, `timer`, `host`, `disposed`, `watch`); callers: 0 outside folder
- FutureState — decoded union type of `futureState`; [exp]; callers: 3 outside folder
- Watch — `Extract<FutureState, { kind: 'watch' }>`; [exp]; callers: 2 outside folder
- ChainRoot — `'case' | 'callback'` root kind of a resolver chain; [exp]; callers: 0 outside folder
- ResolverTarget — decoded union type of `resolverTarget` (`case`, `callback`, `at`); [exp]; callers: 3 outside folder
- chainRoot(target) — returns `'case' | 'callback'` root of `target` (`target.root` for `at`, else `target.kind`); [exp]; callers: 2 outside folder
- TestWatch — `Exclude<Watch['until'], { kind: 'ended' }>` (`idle` or `waypoint`); [exp]; callers: 4 outside folder
- defineObject(kind, shape) — builds a `z.strictObject` schema with `kind` literal and `id: objectId`; callers: 0 outside folder
- heapObject — zod discriminated union schema for all 13 `HeapObject` kinds; [exp]; callers: 0 outside folder
- HeapObject — decoded union type of `heapObject`; [exp]; callers: 8 outside folder

## src/runtime/snapshot/random.ts — Deterministic HMAC-SHA-256 random byte draws and 32-byte hex seed encoding
- seedBytes — `32` (byte length of an instance random seed); [exp]; callers: 1 outside folder
- seedText — zod schema validating a 64-character lowercase hex seed string; [exp]; callers: 0 outside folder
- seedTextOf(bytes) — encodes a 32-byte `Uint8Array` as lowercase hex, throwing `'unfitSeed'` `Refusal` if wrong length; [exp]; callers: 1 outside folder
- seedFrom(bytes) — encodes the first 32 bytes of `bytes` as a hex seed string; [exp]; callers: 2 outside folder
- drawOf(seed, index) — computes 32-byte HMAC-SHA-256 of 64-bit big-endian `index` keyed by `seed`; [exp]; callers: 1 outside folder

## src/runtime/snapshot/snapshot.ts — Versioned `istalang-snapshot` format schema and internal object-reference validation
- InstanceCall — `{function, captures, arguments}` call descriptor for starting an instance or invoking a context; [exp]; callers: 10 outside folder
- Invocation — `{call: InstanceCall, token: string}` context invocation descriptor; [exp]; callers: 2 outside folder
- Replay — `{kind: 'call', call} | {kind: 'invocation', invocation}` saved on a panicked snapshot for `retry`; [exp]; callers: 1 outside folder
- Snapshot — decoded persisted instance snapshot validated by `checkObjectReferences`; [exp]; callers: 12 outside folder
- PanickedSnapshot — `Snapshot` narrowed to `status.kind === 'panicked'`; [exp]; callers: 1 outside folder
- snapshotFormat — `defineFormat('istalang-snapshot', 1, snapshot)` codec; [exp]; callers: 3 outside folder
- checkObjectReferences(contents, context) — zod refinement checking ascending object ids, `< objectsMade`, `referencedObjects`, and `ready`; callers: 0 outside folder

## src/runtime/store.ts — `InstanceStore` persistence seam and `memoryStore` in-memory implementation
- InstanceStore — persistence seam (`readDefinition`, `writeDefinition`, `readSnapshot`, `writeSnapshot`, `instances`, externs); [exp]; callers: 8 outside folder
- memoryStore() — in-memory `InstanceStore` backed by `Map`s for tests and ephemeral runs; [exp]; callers: 2 outside folder

## src/runtime/testing/run-tests.ts — Listing and running `@Suite` tests in isolated `World`s for `ista test`
- TestRunOptions — options for `runTests` (`natives`, `clock`, `timeout`, `filter?`, `heapCheck?`); [exp]; callers: 0 outside folder
- TestReport — `{title, outcome}` yielded for each executed or skipped test; [exp]; callers: 1 outside folder
- runTests(text, options) — decodes test `Definition`, lists suites in isolated `World`s, and yields `TestReport`s for each test; [exp]; callers: 1 outside folder
- runListed(listing, {run, runner, focused, filter}) — filters and runs (or skips) each `Listed` test of a suite in its own `World`; callers: 0 outside folder
- listedOf(definition, outcome) — decodes the `Array<Listed>` struct values returned by `testing._list`; callers: 0 outside folder

## src/runtime/testing/world/drive.ts — Driving an `InstanceGroup` and advancing timers until settled, ended, or past deadline
- Driving — callbacks and state (`group`, `now`, `runNext`, `wake`, `wait`, `ends?`, `deadline?`) for `drive`; [exp]; callers: 0 outside folder
- Driven — `'settled' | 'ended' | 'late'` outcome of `drive`; [exp]; callers: 0 outside folder
- drive(driving) — loops running `runNext()` and `waitForTimer(driving)` until `ends()`, settled, or past `deadline`; [exp]; callers: 0 outside folder
- waitForTimer(driving) — checks `group.waits()`, enforces `deadline`, awaits `wait(due)`, and wakes all `group.dueBy(now())`; callers: 0 outside folder

## src/runtime/testing/world/index.ts — Isolated in-memory `World` (`TestWorld`) driving one `.ista` test and its spawned instances
- Failed — `{kind: 'failed', message, trace, logs}` test failure outcome; [exp]; callers: 1 outside folder
- Ended — `{kind: 'finished', outcome} | Failed` outcome of `World.run`; [exp]; callers: 1 outside folder
- WorldSeams — `{definition, hash, natives, clock, seed, deadline, heapCheck?}` configuration for a `World`; [exp]; callers: 0 outside folder
- World — `TestWorld` implementation running a single test in context `'test'`, relaying mocks, and resolving test watches; [exp]; callers: 1 outside folder
- World.run(call) — invokes `call` in context `'test'`, drives `#group` via `drive`, and returns `Ended`; callers: 0 outside folder
- World.mockOf(holder, target) — returns the newest mock id for `target` in `holder`'s last committed snapshot; callers: 0 outside folder
- World.answer(holder, call) — advances `holder` with `{kind: 'answer', call}` to run its mock replacement and returns `MockAnswer`; callers: 0 outside folder
- World.watched(instance, until) — evaluates whether `instance`'s committed snapshot satisfies an `'idle'` or `'waypoint'` `TestWatch`; callers: 0 outside folder
- World.#step() — delivers the next queued mock answer arrival, advances a ready instance, or advances an instance whose test watch holds; callers: 0 outside folder
- World.#advance(instance, first) — advances `instance`'s `Resident` with `first` and records the result; callers: 0 outside folder
- World.#record(instance, advanced) — updates `#group`, queues arrivals, records `#outcome`/`#logs`, withdraws answers, notes expected panics; callers: 0 outside folder
- World.#withdrawAnswersTo(caller) — advances holders with `{kind: 'withdraw'}` when `caller` drops futures of pending mock calls; callers: 0 outside folder
- World.#ended() — returns `Failed` if any instance panicked unexpectedly, or `{kind: 'finished', outcome}` once `test` answered; callers: 0 outside folder
- World.#failure(why) — formats a stuck or timed-out test failure listing all waiting instances' waypoints/locations (and job hint); callers: 0 outside folder
- World.#resident(instance) — returns cached `Resident` for `instance` or creates one from `storedSnapshot`; callers: 0 outside folder
- mocksOf(memory, snapshot) — memoizes the map of `target -> newest mock id` for a committed `Snapshot`; callers: 0 outside folder

## src/runtime/testing/world/snapshot-reads.ts — Reading pending test watches and withdrawn mock answers from committed Snapshots
- activeObjects(snapshot) — returns `snapshot.objects` when `snapshot.status.kind === 'active'`, else `[]`; callers: 0 outside folder
- pendingTestWatches(snapshot) — extracts pending `'idle'` and `'waypoint'` watch futures from `activeObjects(snapshot)`; [exp]; callers: 0 outside folder
- withdrawnAnswers(holder, caller, callerSnapshot) — finds `answer` objects in `holder` for `caller` whose `host` future was dropped; [exp]; callers: 0 outside folder

## src/runtime/testing/world/test-host.ts — Synthesizing default test natives that panic on unmocked host externs and no-op on host `dispose`
- unmockedExterns(definition, natives) — builds fallback natives for host externs (no-op for host `dispose`, panic for others); [exp]; callers: 0 outside folder
- unmocked(name) — returns a `Native` that throws a `Panic` stating no mock replaced `name`; callers: 0 outside folder

## Concept footprint
- Result: scheduler/instance/instance-ends.ts:endOf, scheduler/instance/instance-ends.ts:storedEnds, scheduler/segment/native-calls.ts:nativeInstancesOf, scheduler/segment/native-contexts.ts:nativeContextsOf, scheduler/segment/native-contexts.ts:answering, snapshot/objects.ts:futureState
- enums/variants: interpreter/instructions.ts:handlers, interpreter/instructions.ts:isVariant, lifetimes/in-place.ts:setChild
- futures/await/select: boundary/host-natives.ts:hostNative, boundary/host-natives.ts:returnsFuture, boundary/host-natives.ts:futureOf, boundary/host-natives.ts:hostResolverOf, boundary/host-natives.ts:JsonResolver, boundary/host-natives.ts:resolveWith, interpreter/instructions.ts:handlers, interpreter/machine.ts:Machine, interpreter/suspension.ts:waitAt, interpreter/suspension.ts:stoppedAt, interpreter/suspension.ts:takeWait, interpreter/suspension.ts:releaseLosers, interpreter/suspension.ts:enterCase, interpreter/suspension.ts:resume, interpreter/suspension.ts:releaseCase, lifetimes/disposal.ts:futureStates, lifetimes/disposal.ts:kinds, lifetimes/disposal.ts:isDropped, lifetimes/disposal.ts:isAwaited, lifetimes/disposal.ts:disposeFuture, lifetimes/holder-writes.ts:HolderWrites, scheduler/inspect.ts:inspection, scheduler/inspect.ts:waitingPointOf, scheduler/inspect.ts:stateOf, scheduler/inspect.ts:watchedOf, scheduler/inspect.ts:nextTimerOf, scheduler/instance/futures.ts:Futures, scheduler/instance/heap-indexes.ts:indexes, scheduler/instance/heap.ts:Heap.#indexedHolds, scheduler/instance/heap.ts:Heap.#awaited, scheduler/instance/index.ts:Instance, scheduler/instance/ready.ts:ReadyQueue, scheduler/instance/slots.ts:Slots, scheduler/instance/waits/endings.ts:ResolverEndings, scheduler/instance/waits/index.ts:Waits, scheduler/instance/waits/resolvers.ts:pendingOf, scheduler/instance/waits/resolvers.ts:rootOf, scheduler/instance/waits/resolvers.ts:positioned, scheduler/instance/waits/resolvers.ts:waiterOf, scheduler/instance/waits/resolvers.ts:stoppedWait, scheduler/instance/waits/resolvers.ts:pendingCases, scheduler/instance/waits/settle-order.ts:settleOrder, scheduler/instance/waits/settle-order.ts:registrationsOn, scheduler/instance/waits/settle-order.ts:rankOf, scheduler/live-resolvers.ts:LiveResolver, scheduler/live-resolvers.ts:liveResolvable, scheduler/live-run.ts:runLive, scheduler/live-run.ts:runToEnd, scheduler/live-run.ts:idled, scheduler/live-run.ts:woken, scheduler/segment/answering.ts:startAnswering, scheduler/segment/calls.ts:runsAsExecution, scheduler/segment/index.ts:SegmentRunner, scheduler/segment/native-calls.ts:nativeFuturesOf, scheduler/segment/native-calls.ts:nativeWaitsOf, scheduler/segment/native-calls.ts:nativeSlotsOf, scheduler/segment/returns.ts:landPopped, scheduler/segment/returns.ts:leave, scheduler/segment/returns.ts:waitsOn, scheduler/segment/root-outcome.ts:RootOutcome, scheduler/segment/run-calls.ts:RunCalls, scheduler/segment/run-stack.ts:RunStack, scheduler/segment/run-stack.ts:futuresOf, scheduler/waiting.ts:LiveResumes, scheduler/wake.ts:advance, scheduler/wake.ts:runFrom, snapshot/check/index.ts:kindProblems, snapshot/check/index.ts:callFutureProblems, snapshot/check/waits.ts:waitProblems, snapshot/check/waits.ts:stopOf, snapshot/check/waits.ts:stopProblems, snapshot/check/waits.ts:waitObjectProblems, snapshot/check/waits.ts:resolverProblems, snapshot/check/waits.ts:targetProblems, snapshot/holdings.ts:futureStates, snapshot/holdings.ts:kinds, snapshot/holdings.ts:pendingResolver, snapshot/holdings.ts:isHeldFromRoot, snapshot/objects.ts:futureState, snapshot/objects.ts:chainRoot, snapshot/objects.ts:heapObject
- marks/kinds (live/ista/simple): host/contexts.ts:Contexts, host/programs.ts:boundProgram, scheduler/live-resolvers.ts:liveResolvable, scheduler/live-run.ts:runLive, scheduler/live-run.ts:runToEnd, scheduler/live-run.ts:idled, scheduler/run-contexts.ts:RunContexts, scheduler/segment/calls.ts:runsAsExecution, scheduler/segment/calls.ts:runCall, scheduler/segment/index.ts:runSegment, scheduler/segment/index.ts:startLiveSegment, scheduler/segment/index.ts:runLiveSegment, scheduler/segment/native-calls.ts:nativeFuturesOf, scheduler/segment/native-calls.ts:nativeInstancesOf, scheduler/segment/native-contexts.ts:nativeContextsOf, scheduler/segment/native-contexts.ts:liveOf, scheduler/segment/returns.ts:landPopped, scheduler/segment/returns.ts:waitsOn, scheduler/segment/root-outcome.ts:RootOutcome.returning, scheduler/waiting.ts:Waiting, scheduler/waiting.ts:LiveResumes, snapshot/check/calls.ts:calledBackProblems
- sendable: scheduler/instance/crossing.ts:leaving, scheduler/instance/crossing.ts:hostValuesIn, scheduler/instance/crossing.ts:leavingCall, scheduler/instance/crossing.ts:arriving
- shared structs: interpreter/frames.ts:FrameHeap, interpreter/instructions.ts:handlers, interpreter/registers.ts:newCell, interpreter/registers.ts:readCell, interpreter/registers.ts:writeCell, interpreter/registers.ts:cellOf, lifetimes/counts.ts:countedIn, lifetimes/disposal.ts:declared, scheduler/instance/index.ts:Instance, snapshot/check/index.ts:kindProblems, snapshot/holdings.ts:kinds, snapshot/objects.ts:heapObject
- extern types: boundary/extern-signatures.ts:recordExternSignatures, boundary/host-natives.ts:hostNatives, boundary/host-natives.ts:hostNative, lifetimes/counts.ts:countedIn, lifetimes/disposal.ts:declared, lifetimes/disposal.ts:disposalOf, scheduler/instance/crossing.ts:hostValuesIn, scheduler/instance/crossing.ts:arriving, scheduler/instance/segment-effects.ts:SegmentEffects.pinned, scheduler/segment/native-calls.ts:NativeCalls.call, scheduler/segment/native-calls.ts:nativeResourcesOf, scheduler/segment/native-calls.ts:nativeTestingOf, scheduler/segment/native-contexts.ts:nativeContextsOf, snapshot/check/index.ts:kindProblems, snapshot/holdings.ts:kinds, snapshot/objects.ts:heapObject, testing/world/test-host.ts:unmockedExterns
- comprehensions: interpreter/instructions.ts:handlers, interpreter/instructions.ts:growsInPlace, lifetimes/in-place.ts:InPlace.appended, lifetimes/in-place.ts:InPlace.withEntries
- deferred calls: scheduler/instance/crossing.ts:leavingCall, scheduler/segment/answering.ts:startInvocation, scheduler/segment/returns.ts:landPopped, scheduler/segment/returns.ts:waitsOn, scheduler/segment/root-outcome.ts:RootOutcome.returning, scheduler/segment/root-outcome.ts:RootOutcome.#awaited
- spawn/defer: host/contexts.ts:Contexts.#record, host/instance-group.ts:InstanceGroup.record, host/instance-group.ts:InstanceGroup.ready, host/instance-group.ts:InstanceGroup.#watchesAnEnd, instance-state.ts:SpawnOptions, instance-state.ts:hasEnded, scheduler/inspect.ts:stateOf, scheduler/inspect.ts:watchedOf, scheduler/instance/instance-ends.ts:storedSnapshot, scheduler/instance/instance-ends.ts:endOf, scheduler/instance/instance-ends.ts:storedEnds, scheduler/instance/instance-names.ts:spawnedName, scheduler/instance/instance-names.ts:ancestorsOf, scheduler/instance/segment-effects.ts:SegmentEffects.spawn, scheduler/segment/native-calls.ts:nativeInstancesOf, scheduler/wake.ts:unstarted, scheduler/wake.ts:advance, scheduler/wake.ts:terminate, scheduler/wake.ts:commitChildren, scheduler/wake.ts:childrenOf
- context consts: interpreter/frames.ts:FrameHeap, interpreter/instructions.ts:handlers, scheduler/instance/context-constants.ts:ContextConstants, scheduler/instance/heap-indexes.ts:indexes, scheduler/instance/index.ts:Instance, scheduler/instance/index.ts:Instance.releaseConstants, scheduler/segment/index.ts:SegmentRunner.#letGoOfTheRest, snapshot/check/index.ts:contextConstantProblems, snapshot/holdings.ts:rootKinds, snapshot/holdings.ts:kinds, snapshot/objects.ts:heapObject
- disposal/lifetimes/holders: interpreter/instructions.ts:handlers, interpreter/machine.ts:releaseFrame, interpreter/raw-registers.ts:setRegister, interpreter/registers.ts:put, interpreter/registers.ts:clearRegister, interpreter/suspension.ts:releaseLosers, interpreter/suspension.ts:releaseCase, lifetimes/collector.ts:Collector, lifetimes/counts.ts:countedIn, lifetimes/counts.ts:Counts, lifetimes/disposal.ts:declared, lifetimes/disposal.ts:kinds, lifetimes/disposal.ts:isDisposable, lifetimes/disposal.ts:isDropped, lifetimes/disposal.ts:isAwaited, lifetimes/disposal.ts:dispose, lifetimes/disposal.ts:disposeFuture, lifetimes/disposal.ts:disposeCall, lifetimes/holder-writes.ts:HolderWrites, lifetimes/holders.ts:heldFrom, lifetimes/in-place.ts:InPlace, scheduler/instance/context-constants.ts:ContextConstants.release, scheduler/instance/disposal-notices.ts:DisposalNotices, scheduler/instance/heap.ts:Heap, scheduler/instance/index.ts:Instance, scheduler/instance/index.ts:Instance.dropUnheld, scheduler/instance/index.ts:Instance.#kept, scheduler/instance/index.ts:Instance.releaseRoot, scheduler/instance/index.ts:Instance.stop, scheduler/instance/index.ts:Instance.resumeOn, scheduler/instance/slots.ts:Slots, scheduler/instance/waits/endings.ts:ResolverEndings, scheduler/instance/waits/index.ts:Waits.cleanupCase, scheduler/instance/weak-side.ts:WeakSide, scheduler/live-resolvers.ts:LiveResolver.cancel, scheduler/segment/collection.ts:SegmentCollection, scheduler/segment/disposal-runs.ts:DisposalRuns, scheduler/segment/index.ts:endInstance, scheduler/segment/index.ts:SegmentRunner.#letGoOfTheRest, scheduler/segment/index.ts:SegmentRunner.currentCall, scheduler/segment/returns.ts:landReturn, scheduler/segment/returns.ts:landPopped, scheduler/segment/root-outcome.ts:copiedOut, scheduler/segment/run-stack.ts:RunStack, scheduler/wake.ts:terminate, snapshot/holdings.ts:isRoot, snapshot/holdings.ts:futureStates, snapshot/holdings.ts:kinds, snapshot/holdings.ts:heldBy, snapshot/holdings.ts:heldIn, snapshot/holdings.ts:idsHeld, snapshot/holdings.ts:frameValues, snapshot/holdings.ts:frameCells, testing/world/index.ts:World.#withdrawAnswersTo, testing/world/snapshot-reads.ts:withdrawnAnswers, testing/world/test-host.ts:unmockedExterns
- defaults/fields functions: interpreter/frames.ts:FrameEntry, interpreter/frames.ts:ActiveFrame, interpreter/instructions.ts:handlers, interpreter/machine.ts:newFrame, interpreter/machine.ts:parameterContents, interpreter/registers.ts:argumentContents, interpreter/registers.ts:givesEvery, interpreter/trace.ts:callerTraceOf, scheduler/segment/calls.ts:startCall, scheduler/segment/calls.ts:handOver, scheduler/segment/calls.ts:runsAsExecution, scheduler/segment/calls.ts:givesAll, scheduler/segment/calls.ts:givenContents, scheduler/segment/index.ts:SegmentRunner.handOver, scheduler/segment/run-stack.ts:RunStack.callerTrace, snapshot/check/calls.ts:callProblems
- codecs/JSON: boundary/host-natives.ts:hostNative, boundary/host-natives.ts:resolveWith, boundary/host-natives.ts:fitting, boundary/outbound.ts:outcomeJson, boundary/outbound.ts:outcomeText, boundary/outbound.ts:encodedOf, host/programs.ts:boundProgram, host/programs.ts:startOf, host/programs.ts:listedStart, host/programs.ts:jsonIn, scheduler/instance/index.ts:Instance.encoder, scheduler/instance/segment-effects.ts:SegmentEffects.spawn, scheduler/segment/native-calls.ts:nativeInstancesOf, scheduler/segment/returns.ts:landReturn, scheduler/segment/returns.ts:landPopped, scheduler/segment/root-outcome.ts:RootOutcome, scheduler/segment/segment-ends.ts:persistable, scheduler/wake.ts:begun, snapshot/check/index.ts:encoderProblems, snapshot/check/index.ts:outcomeProblems, testing/world/test-host.ts:unmockedExterns
- places/&refs: interpreter/instructions.ts:handlers, interpreter/machine.ts:newFrame, interpreter/parts.ts:partAt, interpreter/registers.ts:readRegister, interpreter/registers.ts:writeRegister, interpreter/registers.ts:storeAt, interpreter/registers.ts:argumentContents, interpreter/registers.ts:passedValues, interpreter/registers.ts:writeReference, interpreter/registers.ts:changesAt, interpreter/registers.ts:capturedContents, interpreter/registers.ts:readThrough, interpreter/registers.ts:isCell, lifetimes/in-place.ts:InPlace, scheduler/segment/native-calls.ts:NativeCalls.call, scheduler/segment/native-calls.ts:referenceAt, snapshot/check/calls.ts:callProblems, snapshot/check/waits.ts:stopOf, snapshot/holdings.ts:heldIn, snapshot/holdings.ts:frameValues, snapshot/holdings.ts:frameCells, snapshot/objects.ts:isReference
- comparisons: interpreter/instructions.ts:relations, interpreter/instructions.ts:handlers
