---
description: canonical JSON codecs, versioned formats, snapshots, heap objects, disposal, scheduler wakes and host API — read before changing runtime
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-28
last_updated: 2026-11-04
tags: [reuse, runtime, snapshot, persistence, scheduler, lifetimes, host]
---

# Runtime, snapshots and persistence

## Units

- encode/decode canonical JSON text (written from sorted entries, so keys spelling array indexes sort as strings too), refuse text nesting too deeply before it is parsed (`decodeJson(text, deepest)`, `NestingError`), measure a value's depth, or SHA-256 hash → `encodeJson`, `decodeJson`, `jsonDepth`, `contentHash` (`src/definition/formats/codec.ts`)
- define a versioned format `{ format, version, body }` with depth/zod validation → `defineFormat`, `Format`, `FormatError` (`src/definition/formats/format.ts`)
- read or write a persisted `Definition` text → `definitionFormat` (`src/definition/definition.ts`); read a text together with its canonical text and hash, never as a `read` then a `write` → `Format.readCanonical` (`src/definition/formats/format.ts`)
- read or write a persisted `Snapshot` text → `snapshotFormat` (`src/runtime/snapshot/snapshot.ts`)
- validate a `Snapshot` against its `Definition` before restoring → `checkSnapshot` (`src/runtime/snapshot/check.ts`)
- query what a `HeapObject` holds or watches → `isRoot`, `heldObjects`, `valuesIn`, `referencedObjects` (`src/runtime/snapshot/holdings.ts`)
- query what a `HoldingFrame` holds in its registers or cells → `frameValues`, `frameCells` (`src/runtime/snapshot/holdings.ts`)
- check whether a register's contents is a `&` reference → `isReference` (`src/runtime/snapshot/objects.ts`)
- find reachable heap objects and deepest value nesting from roots → `heldFrom`, `heldUnlessAll`, `walkHolds`, `holdsOf` (`src/runtime/lifetimes/holders.ts`)
- find ready disposable orphans → `readyOrphans` (`src/runtime/lifetimes/orphans.ts`)
- check object disposability or run one object's disposal → `isDisposable`, `dispose` (`src/runtime/lifetimes/disposal.ts`)
- run collection rounds at release points → `Collector` (`src/runtime/lifetimes/collector.ts`)
- convert between stored `HeapObject`s and live `Instance` objects/frames → `liveObject`, `storedObject` (`src/runtime/scheduler/instance/live-objects.ts`)
- start, restore or persist a running instance in memory → `Instance` (`src/runtime/scheduler/instance/index.ts`)
- manage indexed heap objects or unwrap a handle's object id → `Heap`, `handleObject` (`src/runtime/scheduler/instance/heap.ts`)
- format stack traces or `module:line:column` locations from a `Definition`'s `lineStarts` → `traceOf`, `locationOf`; the trace a default asks for, its own frame left out → `callerTraceOf` (`src/runtime/interpreter/trace.ts`)
- convert V8 limit `RangeError`s to `Panic` or guard depth → `panicOf`, `requireDepth`, `requireFrameDepth` (`src/runtime/scheduler/segment/limits.ts`)
- encode/decode 32-byte instance random seeds, and draw deterministic HMAC-SHA-256 random bytes from one for a segment → `seedBytes`, `seedTextOf`, `seedFrom`, `drawOf` (`src/runtime/snapshot/random.ts`)
- build spawned instance names `<parent>/<n>` or list ancestors → `spawnedName`, `ancestorsOf`, `spawnedSeparator` (`src/runtime/scheduler/instance/instance-names.ts`)
- inspect an instance's committed state and waiting points → `inspection` (`src/runtime/scheduler/inspect.ts`), `hasEnded` (`src/runtime/instance-state.ts`)
- advance, terminate or derive `InstanceState` from a `Snapshot` → `advance`, `terminate`, `unstarted`, `stateOf` (`src/runtime/scheduler/wake.ts`)
- read another instance's last committed snapshot or end `Result` from the store → `storedSnapshot`, `storedEnds` (`src/runtime/scheduler/instance/instance-ends.ts`)
- adapt host extern functions to runtime natives → `hostNatives` (`src/runtime/boundary/host-natives.ts`)
- check host extern signatures across deploys → `recordExternSignatures` (`src/runtime/boundary/extern-signatures.ts`)
- format a finished instance's encoded outcome as host JSON or JSON text → `outcomeJson`, `outcomeText` (`src/runtime/boundary/outbound.ts`)
- create a `Runtime` or catch a host refusal → `createRuntime` (`src/runtime/host/index.ts`), `Refusal` (`src/runtime/refusal.ts`)
- drive a group of instances and their spawns until settled → `settle` (`src/runtime/host/settle.ts`), `InstanceGroup` (`src/runtime/host/instance-group.ts`)
- store Definitions and snapshots in memory → `memoryStore`, `InstanceStore` (`src/runtime/store.ts`)
- store Definitions and snapshots atomically in a directory → `directoryStore` (`src/cli/directory-store.ts`)
- load a `--host` JS module or format a `LogRecord` as JSON → `loadHostModule` (`src/cli/host-module.ts`), `logLine` (`src/cli/log-lines.ts`)
- read the CLI clock or check for an OS `errno` error → `clock` (`src/cli/clock.ts`), `isSystemError` (`src/project/errno.ts`)
- run a test `Definition`'s suites or a single test's `World` → `runTests` (`src/runtime/testing/run-tests.ts`), `World` (`src/runtime/testing/world/index.ts`)
- build or check the arguments of the testing runner's `_list`/`_run` calls → `listingArguments`, `runningArguments`, `runnerArity` (`src/definition/tables/test-runner.ts`)

## One-way rules

- Persisted formats use `defineFormat` (`src/definition/formats/format.ts`) and `encodeJson`/`decodeJson` (`codec.ts`), never `JSON.parse`/`JSON.stringify`.
- Snapshots store only what cannot be derived: never store reference counts, holder lists, next object IDs or timer lists (`docs/arch/definition.md`).
- Register changes go through `src/runtime/interpreter/registers.ts` and heap changes through `Heap` (`scheduler/instance/heap.ts`) so released handles are noted.

## Recipes

### Add a heap object kind or future state

1. Add the zod schema to `heapObject` or `futureState` in `src/runtime/snapshot/objects.ts`.
2. Add its holding and watching rules to `kinds` or `futureStates` in `src/runtime/snapshot/holdings.ts`.
3. Add its load-time check to `kindProblems` in `src/runtime/snapshot/check.ts` and its disposal rule to `src/runtime/lifetimes/disposal.ts`.
4. If it is indexed in memory, add the derived index to `Heap` (`src/runtime/scheduler/instance/heap.ts`).
