---
description: how the run executes compiled code — one Run per instance, the World they meet through, arrivals, segments and commits, seeds, outcome encoders, mocks, snapshots, the host runtime (start, wake, retry, terminate, inspect), holders and disposal; read before changing src/runtime, the snapshot format, or the prelude's futures, resolvers, waits and slots
owner: toolchain
status: active
applies_to: src/runtime, src/stdlib/prelude (async section)
last_verified: 2026-11-17
last_updated: 2026-11-17
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
  instance's end, each given the future it settles. What crosses is a sendable value, deep-copied
  (`copied`), so no composite is counted by two runs.
- **Arrivals.** Whatever reaches a run from outside (an answer, an end, a host's filling, a mock's
  answer from another instance) arrives as a turn of its own (`Arrivals.arrive(object, turn)`, `run/arrivals.ts`), never
  inside another run's step. The turn names the object it acts on, and acts on it in whichever run
  of the instance it lands in: once a rerun replaced the run (below, `Arrivals.succeededBy`), on the object
  of the same id its snapshot read back. The world advances instances in the order their oldest
  waiting turns arrived across runs (`Arrivals.first`), so what settles first runs first (spec §6).
  At an instant timers come due, the instances' fire first and run to their commits, so what a
  context answers because of them reaches a live run before its own timers due then decide what
  waited on both (`DurableWorld.fireDue`).
- The one `World` is `host/durable-world.ts`, made from the one host binding (`host/binding.ts`:
  natives, externs, clock, seed, store, reports). `startLive` (`runtime/program.ts`) runs over it
  with a memory store that ends with the start, a test's world (`testing/test-world.ts`) with its
  own, answering what the test asks; the host runtime runs over the host's store. Every driver
  drives it with the one loop, `runUntil` (`host/world-driving.ts`).

## What the run does and what the prelude does

Decision 6 of the ir-first design gives the run primitives only (`run/run-primitives.ts`, the `run`
capability the prelude's natives call): futures that settle once and call their callbacks in rank
order, park and unpark of an execution, `_later` (enqueue a closure call), timers, weak references,
cells, stopping a disposed call and the `disposing()` priority resume. The run still keeps more than
that in TypeScript until moving it is measured (tracker Q59), each a service a backend ports too:
the order a set of futures settles in (`run/settling.ts`), timers grouped by when they come due
(`run/timers.ts`, `Run.fireDue`), the `disposed()` and `disposing()` watches (`Run.disposedOf`,
`Executions.disposingOf`), the watches on an instance's end (`run/end-watches.ts`), giving up on a
case nothing waits on any more (`Future.lost`, read through `_standing`), and the mock registry
(`run/mocks.ts`). Everything else above the primitives is Istalang in the prelude:

- **Futures** are run objects; `onAwait` registers a callback with a rank, a `standing` probe
  (`_standing`: pending, lost, or withdrawn) and what cancels its resolver if the future is disposed
  first. Every future a resolver is registered on resolves it as `tryResolve` does: the first
  decides. What settling a set of futures settles in turn (a
  future following another, as a mock's answer does) settles together after it
  (`Run.settleTogether`). A widened call's future follows the call's (`run/following.ts`, prelude
  `_converted`, spec §3.14): it settles together with it, its value converted, holds it until then,
  and, disposed first, lets go of it at once, so the call stops as an unwidened one does; the
  call's future stays as it is for whatever else reaches it, with no execution between.
- **Resolvers** are shared structs of `decide` and their state, a `_Resolution<K>` (`rank`, `state`,
  `cancels`, what it comes down to deciding: a wait's case, the resolver a `Resolver.at` one decides,
  or a callback), which takes no value: only what passes a value on is compiled per awaited type, the
  rest once per mode (ir-first B116). `resolve` panics on a second resolve; one resolved to no effect
  (state 4) stays cancellable.
- **Waits** (`_Wait`): `_caseResolver` decides the wait and unparks the call, reaching the wait
  weakly; the wait's call holds the futures its cases' chains are registered on until the wait is
  let go of (`_awaiting`, `Execution.awaiting`, spec §7), a hold the run keeps since no value could
  without a cycle the analysis of lifetimes refuses. `_parking`, emitted before every `park`, marks
  every case known; losers are cancelled once the wait is decided and its
  cases known (`_losersCancelled`). A `select` with `else` (`_decided`) takes back its call's resume
  (`_stayRunning`) and *withdraws* its cases, so it gives up on nothing. A case on the call's own
  `disposing()` overrides an earlier decision while the call is being disposed (`_disposingWins`).
- **Slots** are shared structs: `contents: Array<T>` (one item while full) and one queue of
  operations holding their futures weakly, so an operation its holders let go of leaves the queue;
  a waiting put's value sits in an `_Offer` its future alone holds, the queue reaching it weakly,
  so the value goes as the put settles or is let go of, a `select`'s loser included (spec §7, §8);
  one given up on (every case awaiting it lost) is passed over, and served where it stands once
  awaited again (`_onAwaited`). Reads at the head are one event and a take after them the next, so
  a `select` the reads decide has cancelled a losing take before it is reached. `put`, `take` and
  `read` carry `@Keeps` (below).
- **Instance ends** cross as a plain `(Array<R>, String, String)` ending; `Instance.result()` and
  `runtime._call` are Istalang wrappers making the `Result`. No native builds an optional, a
  `Result` or an enum: natives speak primitives (decision 8; `stdlib/values/results.ts`).
- **Outcome encoders.** An `Instance<T>` type entry carries `encoder`, the entry of `T`'s codec
  writing it, where one does (lowering's type table). An instance spawned as one calls it, in the
  instance, as its root returns (`rootInvocation`), so it ends `finished` with its outcome and that
  outcome's JSON (`encoded`), or panics if encoding panics. `outcomeText` writes `encoded` as JSON
  text, and a plain outcome's text where there is none.

`@Keeps` stands on a std function with a body when its body calls code the lifetime analysis can't
follow (closures held in a resolver; a slot's queue read back through weak references): callers read
it as a native, with exactly the summary its extern predecessor had (spec §3.16).

## Holders and disposal (`run/lifetimes.ts`)

- Lowering places every hold and let-go; the run only counts and acts. **Counted** values (their
  type reaches a disposable) are counted per holder, on the object for a run object and in a
  WeakMap for a composite; **heap** values are marked shared on a second holder, changed in place
  only while unique; **plain** values are passed over.
- What loses its last holder is disposed in rounds, newest object first; what a disposed value held
  loses its holder in the next round. Code a disposal runs, a declared `dispose` or a disposed
  call's cleanup (its frame's let-gos and what it returns, which settles nothing), is collected
  `apart` from the round disposing it, each let-go as it happens, so before its value or call is
  gone (spec §7) and a `select`'s losers before its winning case's body (§8).
- Disposal is final: an object is marked disposed as its round takes it, and a snapshot keeps the
  mark, so no later hold counts on it, a mock recording its `dispose` call included (§10), and it
  is never disposed twice.
- A native's result is `adopt`ed by its declared type: a composite it built holds its parts. One
  storing an item through `&` (`push`, `setEntry`, ...) keeps it by its item type first, so the
  item, even read from the place it changes, keeps its value (`keepItems`).
- An async call holds what it was given until it ends (`Execution.given`).
- A disposed call resumes only on its `disposing()` case; otherwise it stops where it waits, runs no
  code, and its frame lets go in the round after; an ended call is never readied again.
- An instance finishes in the segment its root returns in (`Run.finish`): readied calls dropped,
  suspended ones stopped and what holds the outcome let go of, then its context constants, last
  made first, each disposed before the next, a read of one let go of panicking
  (`run/context-constants.ts`); a disposal panicking there ends the instance panicked. A terminated
  one finishes the same way, from where it stood before its failed segment.
- A weak reference refers to nothing from the moment its referent's last holder lets go, before its
  disposal in that round (`referentOf`, `run/weak-references.ts`).

## Segments and commits (`host/durable-world.ts`)

- A durable instance is **resident** while the world holds it. A segment starts with what wakes it
  (a call into it, its spawn, a due timer, another instance's end) and ends at every park (each
  await commits, spec §6) or when nothing is ready. Its clock reads the time the segment started.
- At the commit the instance is written to the store (`snapshotOf`); a write the store fails
  commits nothing, the instance read back as it last committed. Then what it did to others
  leaves it: answers to callers, the instances it spawned (made only now, so a discarded segment
  spawns nothing), its end told to watchers, its log records (to the host's reports, or to the
  `Advanced` of a host call advancing it). A panicked segment never happened (spec §5): it commits
  the instance as it stood before, and its end alone leaves it, the calls still waiting hearing
  its panic. A panic unwinds to the run's outermost guarded call (`run/panic-guard.ts`), even from an
  async call started within another, so no code of the instance runs past it, a host extern call
  included.
- **Inputs.** What starts a segment and every turn it takes as it runs is an input of it
  (`Run.onArrivalTaken` into `Resident.inputs`), which a segment run again applies again. A call
  made into it after a call parked still starts before the commit, which can't keep it
  (`ReadyQueue.nextInvocation`).
- **Crash at every await** (spec §10): before committing, the segment runs again from the same
  inputs on the instance as it last committed, read back, as a restart's is, into a fresh run of
  the program bound to its Definition's hash (a test binds a second build), which takes the instance
  over (`Arrivals.succeededBy`: what arrives later lands there), and stops at its first park, as the first
  run did; that run commits and the first run's effects never leave. Answers of calls running across
  the rerun come from the last commit (`Resident.answers`).
- **Random source** (spec §3.8 `random`): each instance has a seed of its own, derived from the
  host's `seed` and what the instance is (`instanceSeed`, each kind under a prefix of its own): a
  context's from its key; a live run's, never persisted, from its name and the count of live runs
  the host started before it (`host/live-runs.ts`), so the usual `main` and the context named
  after it (`runtime.id()`) draw apart, and so do two starts under one name; a spawned instance's
  a draw of its parent's (drawn as it spawns, so a rerun spawns it alike). A test's host seed is
  made from its title. Its snapshot keeps the seed and the draws made, so a
  segment run again draws the same values.
- **A panic** commits the instance as it stood before the failed segment, with the panic, the time
  the segment started and the call that started it, if one did (`replay`): its spawn's, or a call
  into it. A panic no caller hears is reported to the host (`HostReports.panicked`): a call let go
  of hears none (`Invocation.hears`).
- **Too deep to persist** (spec §5): a value nesting past `maximumDepth` panics the instance at the
  await that would commit it, named by the call that parked last.
- Extern constants are read once per instance and kept as its context constants (spec §3.6).

## Mocks (`run/mocks.ts`, `run/mock-answers.ts`)

In a Definition built to run tests (spec §10):

- A mock is a run object (`MockObject`: target entry, replacement, the calls it took) its instance
  holds while anything holds its handle (`Mocking.held`, `run/mocking.ts`); the newest held for a target wins, and letting
  one go brings back the one before.
- A call reaches the mock its instance holds, else the nearest one an instance it was spawned from
  holds (`World.heldMock`). A code entry asks at its `mocked` instruction, past its prologue, with
  every parameter's value; a native is asked as its extern is called. The function an invocation
  starts with is never mocked; a widened one is the function its `wrapping` entry wraps.
- The holder records the call and runs the replacement, as a call of its own when it holds the mock
  for another instance (`Executions.asCall`). A host value crosses as its host's JSON and arrives as the
  caller's resource, which the caller alone disposes; other values pass as they are within one
  instance, and only sendable ones cross between two, copied. An async replacement's future is
  followed by one of the caller's, which the holder lets go of once it settles or once the caller
  lets go of its own, so a mocked receive losing a `select` takes nothing.

## Snapshots (`snapshot/`)

- `format.ts`: the persisted shape. Objects by id (cells, futures, executions, calls that ended,
  which a handle may outlive and which keep no frame, weak references, resources, mocks); values as trees with run objects as handles; frames as data (function, the
  label of the `park` it stands at, registers, where a register may hold a `&` reference), each
  execution with the transients' cells it kept where it started (its frame's own shares are its
  transient registers); live executions, timers, watches of other instances' ends, the ready queue,
  the running invocations (the spawned one `root`), context constants, the serial, the seed and
  draws, spawned count, the outcome's encoder, options and status (a finished one with its outcome
  and, where encoded, its JSON).
- `write.ts`: a root walk from what the instance keeps. Holders are not written.
- `restore.ts`: objects made first, then filled; every holder counted again as the writing run
  counted it (`Lifetimes.adoptRestored`): a composite comes back held by one holder, so value
  semantics can't tell it from the shared original. The root invocation ends the instance again as
  it returns; any other is re-answered from the resident's last commit, or dropped when its caller
  is gone. A snapshot naming an object it doesn't hold is refused (`snapshotMismatch`), as are an
  unknown format version or shape (`FormatError`) and a Definition the store lacks
  (`unknownDefinition`), before anything of it resumes.

## The host runtime (`host/`)

- `index.ts`: `createRuntime(binding)` gives
  `deploy(text)`, `wake`, `retry`, `terminate`, `inspect` and `programOf`. A Definition is read,
  validated and emitted once per hash and written to the store once, as it was given.
- **Host turns** (`host-turns.ts`): the world's work runs synchronously to its end once begun, and a
  host's extern runs inside it. So every host call that runs code (a start, a wake, a retry, a
  termination) starts on a turn of its own: one an extern makes starts once the call it was made in
  ended, and calls on one instance run one after another.
- `programs.ts`: `DeployedProgram.start(name, {function?, arguments?, crashEveryAwait?})` runs a
  live run named `name` (what `runtime.id()` reads). Its start entry decodes the arguments and calls
  the root without awaiting; the start's encoding entry runs the moment the root's outcome settles,
  and the live run finishes then: readied work never runs, suspended calls stop (spec §10). The
  instances it reached go on as far as they can without waiting.
- **Runtimes over the store** (`open-runtimes.ts`, spec §9): opening the first one resumes the
  store's work, every instance stored there that hasn't ended read back for the world to run on.
  The earliest one open serves the jobs (`runtime._served`) of every instance running its live
  code's program that began since: running then, made since, or run again by a retry, whose panic
  ended the loop serving it. A `_Runtime` is a resource whose disposal is the runtime's own
  (`Resource.release`): it closes the runtime, and the next earliest serves. The instances' timers
  fire only while a runtime is open, or in a test's world, which drives its own; what is ready
  without waiting runs regardless, a call made through a runtime since closed included. `open`
  settles once the work it resumed ran what it had due by then (`OpenRuntimes.letOpenersGoOn`), a
  timer that came due while none was open included.
- `retry` restores a panicked instance as it stood before its failed segment and runs it again at
  the time it first started, replaying the call that started it (answering nobody: its caller heard
  the panic); `terminate` disposes what it held
  then, a `dispose` that panics stopping none of the others (`Lifetimes.disposingPastPanics`), and
  commits it holding nothing, as happens at once to an isolated instance
  (`runtime.isolate`, `terminatesOnPanic`, kept in its snapshot) whose segment panics; `inspect` reads the last commit: state (a finished one with
  its outcome's JSON, where encoded), and where each parked execution waits (`parkedAt`: function,
  waypoint, source location).
