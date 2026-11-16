---
description: how the run executes compiled code — one Run per instance, the World they meet through, segments and commits, snapshots, the host runtime (start, wake, retry, terminate, inspect), holders and disposal; read before changing src/runtime, the snapshot format, or the prelude's futures, resolvers, waits and slots
owner: toolchain
status: active
applies_to: src/runtime, src/stdlib/prelude (async section)
last_verified: 2026-11-16
last_updated: 2026-11-16
tags: [runtime, run, snapshot, durability, lifetimes, futures]
---

# The run

Compiled code (docs/arch/codegen.md) runs on one runtime, `src/runtime/run/`, whatever host starts it:
`ista run`, `ista test`, a built module (`istalang/live`) or an embedding host. There is no
interpreter; a live run is a run that never commits.

## One run per instance

- Every instance is a `Run` (`run/run.ts`) of its own: its objects, ready queue, timers, transients,
  holders' counts, and the emitted program instantiated over it (`function(rt)`), so nothing one
  instance holds is ever another's. A run's `instance` names it and says whether it is durable
  (ista) or the live run a host started.
- Runs meet only through a `World` (`run/world.ts`): a call into a context, a spawn, a wait on an
  instance's end. What crosses is a sendable value, deep-copied (`copied`), so no composite is
  counted by two runs; every answer arrives in the waiting run as a turn of its own (`Run.arrive`),
  never inside another run's step.
- The one `World` is `host/durable-world.ts`. `startLive` (`runtime/program.ts`) runs over it with a
  memory store that ends with the start; the host runtime runs over the host's store.

## What the run does and what the prelude does

The run implements primitives only (ir-first design, decision 6; `run/run-natives.ts`): futures that
settle once and call their callbacks in rank order, park and unpark of an execution, `_later`
(enqueue a closure call), timers, weak references, cells, stopping a disposed call and the
`disposing()` priority resume. Everything above them is Istalang in the prelude:

- **Futures** are run objects; `onAwait` registers a callback with a rank and a `standing` probe
  (`_standing`: pending, lost, or withdrawn).
- **Resolvers** are shared structs (`decide`, `rank`, `state`, `cancels`, ...). `resolve` panics on
  a second resolve; one resolved to no effect (state 4) stays cancellable.
- **Waits** (`_Wait`): `_caseResolver` decides the wait and unparks the call; `_parking`, emitted
  before every `park`, marks every case known; losers are cancelled once the wait is decided and its
  cases known (`_losersCancelled`). A `select` with `else` (`_decided`) takes back its call's resume
  (`_stayRunning`) and *withdraws* its cases, so it gives up on nothing. A case on the call's own
  `disposing()` overrides an earlier decision while the call is being disposed (`_disposingWins`).
- **Slots** are shared structs: `contents: Array<T>` (one item while full) and one queue of
  operations holding their futures weakly, so an operation its holders let go of leaves the queue;
  one given up on (every case awaiting it lost) is passed over, and served where it stands once
  awaited again (`_onAwaited`). `put`, `take` and `read` carry `@Keeps` (below).
- **Instance ends** cross as a plain `(Array<R>, String, String)` ending; `Instance.result()` and
  `runtime._call` are Istalang wrappers making the `Result`. No native builds an optional, a
  `Result` or an enum: natives speak primitives (decision 8; `stdlib/values/results.ts`).

`@Keeps` stands on a std function with a body when its body calls code the lifetime analysis can't
follow (closures held in a resolver; a slot's queue read back through weak references): callers read
it as a native, with exactly the summary its extern predecessor had (spec §3.16).

## Holders and disposal (`run/lifetimes.ts`)

- Lowering places every hold and let-go; the run only counts and acts. **Counted** values (their
  type reaches a disposable) are counted per holder, on the object for a run object and in a
  WeakMap for a composite; **heap** values are marked shared on a second holder, changed in place
  only while unique; **plain** values are passed over.
- What loses its last holder is disposed in rounds, newest object first; what a disposed value held
  loses its holder in the next round. A disposed call's cleanup (its frame's let-gos and what it
  returns, which settles nothing) is collected `apart`, before its call is gone (spec §7).
- A native's result is `adopt`ed by its declared type: a composite it built holds its parts.
- An async call holds what it was given until it ends (`Execution.given`).
- A disposed call resumes only on its `disposing()` case; otherwise it stops where it waits.

## Segments and commits (`host/durable-world.ts`)

- A durable instance is **resident** while the world holds it. A segment starts with what wakes it
  (a call into it, its spawn, a due timer, another instance's end) and ends at every park (each
  await commits, spec §6) or when nothing is ready. Its clock reads the time the segment started.
- At the commit the instance is written to the store (`snapshotOf`), then what it did to others
  leaves it: answers to callers, the instances it spawned (made only now, so a discarded segment
  spawns nothing), its end told to watchers, its log records (to the host's reports, or to the
  `Advanced` of a host call advancing it).
- **Crash at every await** (spec §10): before committing, the segment runs again from the same
  inputs on the instance as it last committed, and that run commits; the first run's effects never
  leave. Answers of calls running across the rerun come from the last commit (`Resident.answers`).
- **A panic** commits the instance as it stood before the failed segment, with the panic, the time
  the segment started and the call it was starting, if any (`replay`). A panic no caller hears is
  reported to the host (`HostReports.panicked`).
- **Too deep to persist** (spec §5): a value nesting past `maximumDepth` panics the instance at the
  await that would commit it, named by the call that parked last.
- Extern constants are read once per instance and kept as its context constants (spec §3.6).

## Snapshots (`snapshot/`)

- `format.ts`: the persisted shape. Objects by id (cells, futures, executions, weak references,
  resources); values as trees with run objects as handles; frames as data (function, pc, registers,
  where a register may hold a `&` reference); live executions, timers, watches of other instances'
  ends, the ready queue, the running invocations (the spawned one `root`), context constants, the
  serial, draws, spawned count, options and status.
- `write.ts`: a root walk from what the instance keeps. Holders are not written.
- `restore.ts`: objects made first, then filled; every holder counted again as the writing run
  counted it (`Lifetimes.adoptRestored`): a composite comes back held by one holder, so value
  semantics can't tell it from the shared original. The root invocation ends the instance again as
  it returns; any other is re-answered from the resident's last commit, or dropped when its caller
  is gone.

## The host runtime (`host/`)

- `index.ts`: `createRuntime({natives, store, clock, seed, host?, reports?})` gives
  `deploy(text)`, `wake`, `retry`, `terminate`, `inspect` and `programOf`. A Definition is read and
  emitted once per hash and written to the store once.
- `programs.ts`: `DeployedProgram.start(name, {function?, arguments?, crashEveryAwait?})` runs a
  live run named `name` (what `runtime.id()` reads). Its start entry decodes the arguments and calls
  the root without awaiting; the start's encoding entry runs the moment the root's outcome settles,
  and the live run finishes then: readied work never runs, suspended calls stop (spec §10). The
  instances it reached go on as far as they can without waiting.
- `retry` restores a panicked instance as it stood before its failed segment and runs it again at
  the time it first started, replaying the call it was starting; `terminate` disposes what it held
  then and commits it holding nothing; `inspect` reads the last commit: state, and where each
  parked execution waits (`parkedAt`: function, waypoint, source location).
