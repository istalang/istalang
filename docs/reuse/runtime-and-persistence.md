---
description: canonical JSON codecs, versioned JSON and avsc formats, the Definition's persisted form, snapshots, run objects, holders and disposal, the World, segments and commits, and the host API — read before changing src/runtime or anything persisted
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-17
last_updated: 2026-11-17
tags: [reuse, runtime, snapshot, persistence, lifetimes, host]
---

# Runtime, snapshots and persistence

How the run works: docs/arch/runtime.md.

## Units

- encode/decode canonical JSON text, refuse text nesting too deeply before it is parsed → `encodeJson`, `decodeJson`, `NestingError` (`src/definition/formats/codec.ts`)
- define a versioned JSON format `{ format, version, body }` with depth/zod validation → `defineFormat`, `Format`, `FormatError`; check an envelope's name and version → `requireEnvelope` (`src/definition/formats/format.ts`)
- define a versioned binary format over a zod schema, avsc bytes with no zod run on a value; hash bytes → `defineBinaryFormat`, `contentHash`, `contentHashText` (`src/definition/formats/binary-format.ts`); a zod schema's values as Avro bytes and back, decoded as plain objects → `avroCodecOf` (`src/definition/formats/avro/index.ts`), a custom schema's Avro primitive → `avroForms` (`avro/forms.ts`)
- carry a Definition with its bytes and hash: encode the toolchain's own once → `encodeDefinition`; bytes from a store or file, decoded and validated → `readDefinition`; validate in memory → `requireValid`; embed in a built module and read it back unvalidated → `embeddedText`, `embeddedDefinition`; types `EncodedDefinition`, `KeyedDefinition` (`src/definition/definition.ts`)
- bytes as base64 and back, in Node and a browser → `base64Of`, `bytesOfBase64` (`src/foundation/text/base64.ts`)
- read or write an instance's snapshot → `snapshotFormat`, `Snapshot` (`src/runtime/snapshot/format.ts`); write one from a run → `snapshotOf`, `TooDeep` (`snapshot/write.ts`); read one back into a fresh run → `restore`, `rootInvocation` (`snapshot/restore.ts`)
- a run of one instance: calls, starts, parks, the ready queue, settling futures, timers, host fillings, its random draws → `Run` (`src/runtime/run/run.ts`); what a snapshot keeps of it beside its objects → `Run.persisted`, `Run.restored`
- act on a run's object from outside it, in whichever run of its instance the turn lands in, the turn kept as an input a segment run again applies again → `Arrivals.arrive`, `Arrivals.succeededBy` (`src/runtime/run/arrivals.ts`), `Run.onArrivalTaken`
- the run's objects: cells, resources, futures, executions with frame records, weak references, references → `src/runtime/run/objects/`
- run code so an ista instance's panic ends it at the outermost guarded call, whatever calls it started → `PanicGuard` (`src/runtime/run/panic-guard.ts`)
- the functions bound to an instance's function slots in a test, newest winning, asked up the spawn chain, the start never rebound → `Slots`, `Binding` (`src/runtime/run/slots.ts`); call a function value another instance holds, at once in its holder, sendable values crossing and an async result's future followed → `calledIn`, `HeldFunction` (`src/runtime/run/remote-calls.ts`)
- count holders, mark shared heap values, dispose in rounds newest first, write a path in place where unique from its root down (`opened`), keep what a native stores in a collection by its item type (`keepItems`), adopt a native's result by type, count restored holders again, collect a disposed call's cleanup apart, dispose everything past a panicking `dispose` (a termination, `disposingPastPanics`) → `Lifetimes` (`src/runtime/run/lifetimes.ts`)
- an instance, its end and how that end crosses to a waiter as a plain ending, a call its finishing instance left unanswered included → `Instance`, `instanceEnding`, `InvocationEnd` (`src/runtime/run/instances.ts`); its context constants, read, made and let go of last as it ends → `ContextConstants` (`src/runtime/run/context-constants.ts`); finish a run as its instance ends → `Run.finish`
- what one run asks of the instances beside it: call into a context, spawn, watch an end, a resident instance's run (`runOf`), a test's capabilities → `World`, `Spawning`, `TestingWorld` (`src/runtime/run/world.ts`); the one implementation, with residents, segments, commits, crash reruns and panics → `DurableWorld` (`src/runtime/host/durable-world.ts`), `Resident` (`src/runtime/host/resident.ts`); where a parked frame waits → `parkedAt` (`src/runtime/host/waiting.ts`), the `park` instruction a frame's `parkedAt` label names → `parkAt` (`src/definition/tables/functions.ts`)
- the run's own primitives the prelude's futures, waits and slots stand on → `runPrimitivesOf`, the `run` capability (`src/runtime/run/run-primitives.ts`), keyed by the prelude's `runNatives` (`src/stdlib/prelude/run-natives.ts`)
- bind a program's natives to a run with their capabilities, refusing a missing native → `bindNatives`, `RunSeams` (`src/runtime/run/natives.ts`)
- turn a JavaScript stack into the program's trace, or a span into `module:line:column` → `Traces` (`src/runtime/run/traces.ts`), `locationOf`, `traceText` (`src/definition/traces.ts`)
- convert V8 limit `RangeError`s to `Panic`, in any runtime → `panicOf` (`src/runtime/natives.ts`)
- bind a program to the runtime's natives with a host's externs beside them → `withHost` (`src/runtime/boundary/host-natives.ts`)
- check host extern signatures across deploys → `recordExternSignatures` (`src/runtime/boundary/extern-signatures.ts`)
- the start of a function by key, its arguments from JSON, refusing an outcome JSON can't hold → `startOf`, `jsonIn`, `checkJsonOut` (`src/runtime/boundary/starts.ts`)
- the entry encoding a spawned instance's outcome, from its `Instance<T>` type entry → `outcomeEncoderOf` (`src/definition/tables/types.ts`)
- create a host runtime: deploy, wake, retry, terminate, inspect → `createRuntime`, `Runtime` (`src/runtime/host/index.ts`); start a deployed program as a live run, read an outcome's JSON text → `DeployedProgram`, `deployed` (`src/runtime/host/programs.ts`); catch a host refusal → `Refusal` (`src/runtime/refusal.ts`)
- run a program's live code to its end with a store of its own → `startLive` (`src/runtime/program.ts`); as a built module does → `program` (`src/live/program.ts`)
- what a host binds every program to (natives, externs, clock, seed, store, reports) → `HostBinding`, `HostReports` (`src/runtime/host/binding.ts`); drive a world until something is done, a deadline passes or nothing can wake it → `runUntil` (`src/runtime/host/world-driving.ts`)
- read or wait on time, real or manual → `Clock`, `realTime`, `ManualClock` (`src/runtime/clock.ts`)
- store Definitions and snapshots in memory → `memoryStore`, `InstanceStore` (`src/runtime/store.ts`); atomically in a directory → `directoryStore` (`src/cli/directory-store.ts`)
- where an instance stands, what advancing it did, where it waits → `InstanceState`, `Advanced`, `Inspection`, `WaitingPoint`, `LogRecord` (`src/runtime/instance-state.ts`)

## One-way rules

- Persisted formats use `defineFormat` and `encodeJson`/`decodeJson`, or `defineBinaryFormat`, never `JSON.parse`/`JSON.stringify`.
- Nothing outside `src/definition/definition.ts` encodes, decodes or embeds a Definition; only `src/definition/formats/avro/` imports avsc, through its types-only entry, and only its `avsc-buffers.ts` touches a Buffer (Node's `buffer` module, as avsc does). What a browser bundle of `istalang/live` needs of Node is pinned by `src/live/browser-bundle.test.ts`: `buffer` and `util`, avsc's.
- Snapshots store only what can't be derived: never holders or counts; `restore` counts them again from what holds them.
- Runs meet only through the `World`; what crosses is copied, and an answer arrives in its run as a turn of its own (`Arrivals.arrive`), naming the object it acts on rather than capturing the run.
- Whatever is random in an instance draws from its own seed (`Run.draw`), kept in its snapshot, so a segment run again draws alike; a seed a host's instance starts with derives from the host's by what the instance is → `instanceSeed`, `SeededInstance` (`src/runtime/random-draws.ts`), a live run's by its start → `LiveRuns` (`src/runtime/host/live-runs.ts`).
- An instance's effects on others (answers, spawns, ends, log records) leave it only at its commit.
- Natives speak primitives: an optional, a `Result` or an enum is built by the std's Istalang wrapping the native, never by the native.
