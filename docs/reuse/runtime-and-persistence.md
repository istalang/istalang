---
description: canonical JSON codecs, versioned formats, snapshots, run objects, holders and disposal, the World, segments and commits, and the host API — read before changing src/runtime or anything persisted
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-16
last_updated: 2026-11-17
tags: [reuse, runtime, snapshot, persistence, lifetimes, host]
---

# Runtime, snapshots and persistence

How the run works: docs/arch/runtime.md.

## Units

- encode/decode canonical JSON text, refuse text nesting too deeply before it is parsed, hash a text → `encodeJson`, `decodeJson`, `NestingError`, `contentHash` (`src/definition/formats/codec.ts`)
- define a versioned format `{ format, version, body }` with depth/zod validation → `defineFormat`, `Format`, `FormatError` (`src/definition/formats/format.ts`)
- read (validating it) or write (checking its shape) a persisted `Definition` text, with the hash a store keys it by → `definitionFormat`, `Format.readKeyed` (`src/definition/definition.ts`); what a format checks beyond its shape, once as it reads → `defineFormat`'s `problemsOf`
- read or write an instance's snapshot → `snapshotFormat`, `Snapshot` (`src/runtime/snapshot/format.ts`); write one from a run → `snapshotOf`, `TooDeep` (`snapshot/write.ts`); read one back into a fresh run → `restore`, `rootInvocation` (`snapshot/restore.ts`)
- a run of one instance: calls, starts, parks, the ready queue, settling futures, timers, host fillings, its random draws → `Run` (`src/runtime/run/run.ts`); what a snapshot keeps of it beside its objects → `Run.persisted`, `Run.restored`
- act on a run's object from outside it, in whichever run of its instance the turn lands in, the turn kept as an input a segment run again applies again → `Run.arrive`, `Run.onArrivalTaken`, `Run.succeededBy`
- the run's objects: cells, resources, futures, executions with frame records, weak references, mocks, references → `src/runtime/run/objects.ts`
- the mocks an instance holds, newest winning → `Mocks` (`src/runtime/run/mocks.ts`); answer a call with a mock held by the caller or an instance it was spawned from → `answerOfMock`, `HeldMock` (`src/runtime/run/mock-answers.ts`)
- count holders, mark shared heap values, dispose in rounds newest first, write a path in place where unique from its root down (`opened`), keep what a native stores in a collection by its item type (`keepItems`), adopt a native's result by type, count restored holders again, collect a disposed call's cleanup apart → `Lifetimes` (`src/runtime/run/lifetimes.ts`)
- an instance, its end and how that end crosses to a waiter as a plain ending → `Instance`, `instanceEnding`, `InvocationEnd` (`src/runtime/run/instances.ts`); its context constants, read, made and let go of last as it ends → `ContextConstants` (`src/runtime/run/context-constants.ts`); finish a run as its instance ends → `Run.finish`
- what one run asks of the instances beside it: call into a context, spawn, watch an end, the mock a parent holds, a test's capabilities → `World`, `Spawning`, `TestingWorld` (`src/runtime/run/world.ts`); the one implementation, with residents, segments, commits, crash reruns and panics → `DurableWorld`, `Resident`, `endOf`, `parkedAt` (`src/runtime/host/durable-world.ts`)
- the run's own primitives the prelude's futures, waits and slots stand on → `runNatives` (`src/runtime/run/run-natives.ts`)
- bind a program's natives to a run with their capabilities, refusing a missing native → `bindNatives`, `NativeBinding` (`src/runtime/run/natives.ts`)
- turn a JavaScript stack into the program's trace, or a span into `module:line:column` → `Traces` (`src/runtime/run/traces.ts`), `locationOf`, `traceText` (`src/definition/traces.ts`)
- convert V8 limit `RangeError`s to `Panic`, in any runtime → `panicOf` (`src/runtime/natives.ts`)
- bind a program to the runtime's natives with a host's externs beside them → `withHost` (`src/runtime/boundary/host-natives.ts`)
- check host extern signatures across deploys → `recordExternSignatures` (`src/runtime/boundary/extern-signatures.ts`)
- the start of a function by key, its arguments from JSON → `startOf`, `jsonIn` (`src/runtime/boundary/starts.ts`)
- the entry encoding a spawned instance's outcome, from its `Instance<T>` type entry → `outcomeEncoderOf` (`src/definition/tables/types.ts`)
- create a host runtime: deploy, wake, retry, terminate, inspect → `createRuntime`, `Runtime` (`src/runtime/host/index.ts`); start a deployed program as a live run, read an outcome's JSON text, hear what instances report → `DeployedProgram`, `HostReports`, `readDefinition` (`src/runtime/host/programs.ts`); catch a host refusal → `Refusal` (`src/runtime/refusal.ts`)
- run a program's live code to its end with a store of its own → `startLive` (`src/runtime/program.ts`); as a built module does → `program` (`src/live/program.ts`)
- read or wait on time, real or manual → `Clock`, `realTime`, `ManualClock` (`src/runtime/clock.ts`)
- store Definitions and snapshots in memory → `memoryStore`, `InstanceStore` (`src/runtime/store.ts`); atomically in a directory → `directoryStore` (`src/cli/directory-store.ts`)
- where an instance stands, what advancing it did, where it waits → `InstanceState`, `Advanced`, `Inspection`, `WaitingPoint`, `LogRecord` (`src/runtime/instance-state.ts`)

## One-way rules

- Persisted formats use `defineFormat` and `encodeJson`/`decodeJson`, never `JSON.parse`/`JSON.stringify`.
- Snapshots store only what can't be derived: never holders or counts; `restore` counts them again from what holds them.
- Runs meet only through the `World`; what crosses is copied, and an answer arrives in its run as a turn of its own (`Run.arrive`), naming the object it acts on rather than capturing the run.
- Whatever is random in an instance draws from its own seed (`Run.draw`), kept in its snapshot, so a segment run again draws alike.
- An instance's effects on others (answers, spawns, ends, log records) leave it only at its commit.
- Natives speak primitives: an optional, a `Result` or an enum is built by the std's Istalang wrapping the native, never by the native.
