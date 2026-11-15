---
description: canonical JSON codecs, versioned formats, snapshots, heap objects, disposal, scheduler wakes and host API — read before changing runtime
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-13
last_updated: 2026-11-15
tags: [reuse, runtime, snapshot, persistence, scheduler, lifetimes, host]
---

# Runtime, snapshots and persistence

## Units

- encode/decode canonical JSON text (written from sorted entries, so keys spelling array indexes sort as strings too), refuse text nesting too deeply before it is parsed (`decodeJson(text, deepest)`, `NestingError`), measure a value's depth, or SHA-256 hash → `encodeJson`, `decodeJson`, `jsonDepth`, `contentHash` (`src/definition/formats/codec.ts`)
- define a versioned format `{ format, version, body }` with depth/zod validation → `defineFormat`, `Format`, `FormatError` (`src/definition/formats/format.ts`)
- read or write a persisted `Definition` text → `definitionFormat` (`src/definition/definition.ts`); read a text together with its canonical text and hash, never as a `read` then a `write` → `Format.readCanonical` (`src/definition/formats/format.ts`)
- read or write a persisted `Snapshot` text → `snapshotFormat` (`src/runtime/snapshot/snapshot.ts`)
- validate a `Snapshot` against its `Definition` before restoring → `checkSnapshot` (`src/runtime/snapshot/check/index.ts`)
- query what a `HeapObject` holds or watches → `isRoot`, `rootKinds`, `valuesIn`, `referencedObjects`; which way a chain of resolvers is held, from its root down (a wait's case) or from its futures up (a callback) → `isHeldFromRoot` (`src/runtime/snapshot/holdings.ts`); what a resolver's chain comes down to deciding → `chainRoot` (`src/runtime/snapshot/objects.ts`); what a live object holds, its fields' holds and the edges the heap's indexes add (a registration, a wait's or a resolver's awaited resolvers) → `Heap.held`, `Heap.holds` (`src/runtime/scheduler/instance/heap.ts`)
- query what a `HoldingFrame` holds in its registers or cells → `frameValues`, `frameCells`; what a holder holds as one write reports it, a register's contents or an object's → `Held`, `heldIn`, `heldBy`, `idsHeld` (`src/runtime/snapshot/holdings.ts`)
- report a holder write, of a register, a heap object or a running call's future, or take the counted objects that lost their last holder at a step's end → `HolderWrites` (`src/runtime/lifetimes/holder-writes.ts`), the instance's `holders`; count holders, every composite value once per holder, or say which objects are counted → `Counts`, `countedIn` (`src/runtime/lifetimes/counts.ts`); write into a value in place where nothing else holds it → `HolderWrites.values`, an `InPlace` (`src/runtime/lifetimes/in-place.ts`); hand a value from one holder to another without its count passing through zero → `HolderWrites.handOver`; the call a closure taking nothing makes as it leaves for a context or a spawned instance → `leavingCall` (`src/runtime/scheduler/instance/crossing.ts`)
- check whether a register's contents is a `&` reference → `isReference` (`src/runtime/snapshot/objects.ts`)
- find reachable heap objects and deepest value nesting from roots, in one walk, for a commit → `heldFrom` (`src/runtime/lifetimes/holders.ts`)
- check object disposability or run one object's disposal → `isDisposable`, `dispose` (`src/runtime/lifetimes/disposal.ts`)
- run collection rounds of what reached zero → `Collector` (`src/runtime/lifetimes/collector.ts`); collect after a step, until no disposal's code is left, or while an instance ends, a disposal that panics let go of → `SegmentCollection.collected`, `collectFully`, `collectEnding` (`src/runtime/scheduler/segment/collection.ts`); run a disposal's code on the run stack, a `dispose` call or a disposed call's cleanup → `DisposalRuns` (`src/runtime/scheduler/segment/disposal-runs.ts`)
- make the one weak reference to a referent, watch it (`disposed()`, `disposing()`), or resolve its watches once the referent is gone → `WeakSide` (`src/runtime/scheduler/instance/weak-side.ts`)
- queue a slot operation or serve a slot's queue, serving paused while a decided `select`'s losers await collecting → `Slots`, `Slots.serveOwed` (`src/runtime/scheduler/instance/slots.ts`)
- convert between stored `HeapObject`s and live `Instance` objects/frames → `liveObject`, `storedObject` (`src/runtime/scheduler/instance/live-objects.ts`)
- start, restore or persist a running instance in memory → `Instance` (`src/runtime/scheduler/instance/index.ts`)
- manage indexed heap objects or unwrap a handle's object id → `Heap`, `handleObject`; the objects written into since last asked → `Heap.takeWritten` (`src/runtime/scheduler/instance/heap.ts`)
- check an instance's heap as it changes, a test's seam a host never sets → `HeapCheck`, `LoadedDefinition.heapCheck` (`src/runtime/scheduler/loaded-definition.ts`), given through `RuntimeSeams`, `TestRunOptions` or `CliEnvironment`
- read, make or let go of an instance's context constants (spec §3.4) → `ContextConstants` (`src/runtime/scheduler/instance/context-constants.ts`)
- find the transient cell a call shares from a call it is nested in, or the transients' cells an execution started from a caller keeps (spec §3.4) → `sharedTransient`, `transientsSeenFrom` (`src/runtime/scheduler/instance/transients.ts`); a code entry's transient registers → `transientRegistersOf` (`src/definition/tables/functions.ts`)
- format stack traces or `module:line:column` locations from a program's module `lineStarts`, whatever a runtime keeps of a frame → `traceText`, `locationOf`; the trace a default asks for, the innermost frame left out while in its prologue → `callerTraceText` (`src/definition/traces.ts`); an interpreter frame as a trace reads it → `tracedFrame` (`src/runtime/interpreter/trace.ts`)
- start a call on any call path (a written call, a function value's, a disposal's, an encoder's, a resolver's callback), a mock replacing its target asked first → `startCall` (`src/runtime/scheduler/segment/calls.ts`); a callback's run as a driver of its own, on an off-heap carrier → `RunCalls` (`src/runtime/scheduler/segment/run-calls.ts`); a call leaving parameters out to a mocked code entry runs the target's prologue as a plain frame and hands over at its `body` marker, the replacement taking that frame's place → `handOver` (`calls.ts`, `SegmentRunner.handOver`), never a second mock path; which mock a call reaches without recording it, and the call made to it → `reachedMock`, `mockedCall` (`src/runtime/scheduler/testing/mocks.ts`)
- convert V8 limit `RangeError`s to `Panic`, in any runtime → `panicOf` (`src/runtime/natives.ts`); guard a segment's depth → `requireDepth`, `requireFrameDepth` (`src/runtime/scheduler/segment/limits.ts`)
- find what a host starts by key and read its JSON arguments, refusing what doesn't fit, in any runtime → `startOf`, `jsonIn` (`src/runtime/boundary/starts.ts`)
- run a program's live and simple code as JavaScript, in a browser or Node: compile a Definition to an ES module → `emitProgram` (`src/codegen/emit.ts`); start the module's program by key with a host's externs → `program(…).start` (`src/live/program.ts`, the `istalang/live` entry)
- a place passed by `&` in compiled code, every write and native change of it going through one class → `Place` (`src/live/values/place.ts`); futures, waits and resolvers in compiled code, by the interpreter's rules → `Waits` (`src/live/waits/waits.ts`), `settleOrder` (`src/live/waits/settle-order.ts`)
- draw deterministic HMAC-SHA-256 random bytes from a 32-byte seed, on any runtime, or check a host's seed → `seedBytes`, `drawOf`, `seedOf` (`src/runtime/random-draws.ts`); encode or decode an instance's seed as its snapshot keeps it → `seedTextOf`, `seedFrom`, `seedBytesOf` (`src/runtime/snapshot/random.ts`)
- hash, HMAC or hex-encode bytes, in Node or a browser → @noble/hashes (`sha256`, `hmac`, `bytesToHex`, as `src/definition/formats/codec.ts` and `src/stdlib/crypto/natives.ts` use them), never `node:crypto`
- build spawned instance names `<parent>/<n>` or list ancestors → `spawnedName`, `ancestorsOf`, `spawnedSeparator` (`src/runtime/scheduler/instance/instance-names.ts`)
- inspect an instance's committed state and waiting points → `inspection` (`src/runtime/scheduler/inspect.ts`), `hasEnded` (`src/runtime/instance-state.ts`)
- spawn an instance from a native, its outcome encoded by its `Instance<T>` type entry's encoder → `NativeInstances.spawn` (`src/runtime/natives.ts`), the one spawning seam; never a second spawn path
- an instance's outcome, its root call's answer (code or an extern), awaited through an `outcome` object when a future and encoded for its host → `RootOutcome` (`src/runtime/scheduler/segment/root-outcome.ts`); what a value leaving its instance ends with, futures followed → `Futures.endOf` (`src/runtime/scheduler/instance/futures.ts`)
- advance or terminate an instance → `advance`, `terminate`, `unstarted` (`src/runtime/scheduler/wake.ts`); derive `InstanceState` from a `Snapshot` → `stateOf` (`src/runtime/scheduler/inspect.ts`)
- hold an instance between host calls, running on from its last commit → `Resident` (`src/runtime/scheduler/resident.ts`)
- run live code to its end in memory, never committing → `runLive` (`src/runtime/scheduler/live-run.ts`); one segment of it → `startLiveSegment`, `runLiveSegment` (`src/runtime/scheduler/segment/index.ts`)
- tell how a run waits (committing, or in memory), resume a live wait once from the host's event loop, or say how a wait failed, panicking its run where it began → `Waiting`, `LiveWaiting`, `istaWaiting`, `LiveResumes`, `Resume`, `FailedWait` (`src/runtime/scheduler/waiting.ts`)
- observe from outside the language the disposal of a live future or a runtime live code opened, told at once → `DisposalNotices` (`src/runtime/scheduler/instance/disposal-notices.ts`)
- give a live run a future something outside it resolves, with its one-shot resolver and cancellation → `liveResolvable` (`src/runtime/scheduler/live-resolvers.ts`), as natives reach it, `NativeFutures.resolvable` (`src/runtime/natives.ts`)
- open a wait, make its case resolvers, a `Resolver.of` or a `Resolver.at` one, register one on futures, resolve or cancel one, decide the wait when futures resolve together, or end it as the waiter moves on → `Waits` (`src/runtime/scheduler/instance/waits/index.ts`); queue what is ready, waiters and the runs of callbacks a resolver readied, and take the next → `ReadyQueue` (`src/runtime/scheduler/instance/ready.ts`); find the wait a frame stands at, resume or enter a case as decided, let go of a `select`'s losers → `stoppedAt`, `takeWait`, `resume`, `enterCase`, `releaseLosers` (`src/runtime/interpreter/suspension.ts`); what a pending resolver comes down to deciding (a `Resolver.at` chain's end), the resolver one decides, a wait's pending case resolvers → `rootOf`, `pendingOf`, `pendingCases` (`src/runtime/scheduler/instance/waits/resolvers.ts`); end a pending resolver without deciding, cancelled, lost or withdrawn → `ResolverEndings` (`waits/endings.ts`); the order futures resolved together decide in → `settleOrder` (`waits/settle-order.ts`)
- let go of what nothing holds without committing → `Instance.dropUnheld` (`src/runtime/scheduler/instance/index.ts`)
- run a host's calls on one instance one after another → `InstanceCalls` (`src/runtime/host/instance-calls.ts`)
- run the contexts a live run's runtimes reach: calls into them, resuming the store's instances on the first open, their timers → `Contexts` (`src/runtime/host/contexts.ts`), seen by the run as `RunContexts` (`src/runtime/scheduler/run-contexts.ts`); a new context's snapshot → `newContext`; the instances a runtime serves the jobs of → `RunContexts.served`
- run live work for ista code after its commit, again until its result commits → `runtime.delegate` (`src/stdlib/runtime/runtime.ista`), its jobs served by every runtime's loop, never a native of its own (`src/runtime/scheduler/wake.ts`)
- start a segment with a call from outside the instance, a mock's from another instance or an invocation into a context, its answer filling the caller's future → `startAnswering`, `startInvocation` (`src/runtime/scheduler/segment/answering.ts`); copy values leaving or arriving at an instance → `leaving`, `arriving` (`src/runtime/scheduler/instance/crossing.ts`)
- list every instance a store holds → `InstanceStore.instances` (`src/runtime/store.ts`)
- read another instance's last committed snapshot or end `Result` from the store → `storedSnapshot`, `storedEnds` (`src/runtime/scheduler/instance/instance-ends.ts`)
- adapt host extern functions to runtime natives → `hostNatives` (`src/runtime/boundary/host-natives.ts`)
- check host extern signatures across deploys → `recordExternSignatures` (`src/runtime/boundary/extern-signatures.ts`)
- format a finished instance's encoded outcome as host JSON or JSON text → `outcomeJson`, `outcomeText` (`src/runtime/boundary/outbound.ts`)
- create a `Runtime` or catch a host refusal → `createRuntime` (`src/runtime/host/index.ts`), `Refusal` (`src/runtime/refusal.ts`)
- bind a deployed Definition once per hash, start live or simple code of it by key as a live run, or hear what its contexts report by themselves → `programBinder`, `DeployedProgram.start`, `HostReports` (`src/runtime/host/programs.ts`)
- drive a group of instances and their spawns on a test's clock until settled, or with a test's own steps and end → `drive` (`src/runtime/testing/world/drive.ts`), `settleAll` (`src/runtime/runtime.test-kit.ts`), `InstanceGroup` (`src/runtime/host/instance-group.ts`)
- read or wait on time, real or manual, a wait that can be called off → `Clock`, `ManualClock` (`src/runtime/clock.ts`)
- store Definitions and snapshots in memory → `memoryStore`, `InstanceStore` (`src/runtime/store.ts`)
- store Definitions and snapshots atomically in a directory → `directoryStore` (`src/cli/directory-store.ts`)
- load a `--host` JS module or format a `LogRecord` as JSON → `loadHostModule` (`src/cli/host-module.ts`), `logLine` (`src/cli/log-lines.ts`)
- read or wait on real time, in a process or a browser → `realTime` (`src/runtime/clock.ts`); check for an OS `errno` error → `isSystemError` (`src/project/errno.ts`)
- run a test `Definition`'s suites or a single test's `World` → `runTests` (`src/runtime/testing/run-tests.ts`), `World` (`src/runtime/testing/world/index.ts`)
- build or check the arguments of the testing runner's `_list`/`_run` calls → `listingArguments`, `runningArguments`, `runnerArity` (`src/definition/tables/test-runner.ts`)

## One-way rules

- Persisted formats use `defineFormat` (`src/definition/formats/format.ts`) and `encodeJson`/`decodeJson` (`codec.ts`), never `JSON.parse`/`JSON.stringify`.
- Snapshots store only what cannot be derived: never store reference counts, holder lists or timer lists (`docs/arch/definition.md`). How many objects were made (`objectsMade`) is stored because ids are never given twice, and what a commit let go of can't be read back from what it kept.
- Every holder write reports to `HolderWrites` (`src/runtime/lifetimes/holder-writes.ts`): register changes go through `src/runtime/interpreter/registers.ts` (the raw write, `raw-registers.ts`, no other module may import), heap changes through `Heap` (`scheduler/instance/heap.ts`), index edges included, and a running call's future through `RunStack`.
- What an object holds is read from `snapshot/holdings.ts` and `Heap.holds` alone: counting, a commit and the snapshot's closure check never list holds of their own, and a new edge goes there (and in `docs/arch/definition.md`'s Holders table).
- Every start and restore of an instance goes through `Instance`'s one constructor (`Instance.start`, `Instance.restore`, so `Resident.take`): whatever an instance derives in memory from its objects is built there, never on the objects or values, which in-memory commits share.

## Recipes

### Add a heap object kind or future state

1. Add the zod schema to `heapObject` or `futureState` in `src/runtime/snapshot/objects.ts`.
2. Add its holding and watching rules to `kinds` or `futureStates` in `src/runtime/snapshot/holdings.ts`, and its row to `docs/arch/definition.md`'s Holders table.
3. Add its load-time check to `kindProblems` in `src/runtime/snapshot/check/index.ts` and its disposal rule to `src/runtime/lifetimes/disposal.ts`.
4. If it is indexed in memory, add the derived index to `Heap` (`src/runtime/scheduler/instance/heap.ts`).
5. If it is a root, add its kind to `rootKinds` (`src/runtime/snapshot/holdings.ts`): a commit walks from every root through what `kinds` says it holds.
