---
description: archived — the JavaScript backend as built before the IR-first rewrite (generators, counted registers, the live runtime library), superseded by docs/work/done/ir-first/design.md; read only for the rules the code being replaced encodes
owner: tech-lead
status: archived
applies_to: istalang
last_verified: 2026-11-16
last_updated: 2026-11-16
tags: [design, codegen, javascript, runtime, browser, lifetimes, lowering]
---

# JS codegen — design

**What it is:** live and simple code compiled to one JavaScript ES module per program, run in a
browser or Node by a small runtime library. A form like FormBuilder's `supplierForm` redraws on
every React input change, with no snapshot. A prototype over the Definition ran `supplierForm`
~30× faster than the interpreter: 1.1 ms per change against 33.5 ms, with byte-identical views. The
interpreter keeps ista code, contexts, `ista test` and mocks. It is also the reference this backend
is diffed against.

## Decisions

- **Simplicity first.** One module per program, emitted afresh every build, with no cache: emitting
  is one pass over the IR, cheap next to checking and lowering. A host's bundler does chunking and
  hashing.
- **Disposal stays exactly spec §7.** Counted values are counted, and what lost its last holder is
  disposed at that release point, before the next instruction runs.
- **Lowering records which registers may hold a counted value.** The Definition carries no register
  types, so the emitter can't derive it.
- **Values are copied on write.** In place on a sole holder comes later, as a decision inside the
  one write path.
- **`Int` stays a bigint.**

## Pipeline

```text
Program ─check─▶ lower ─▶ Definition (+ counted registers) ─emit─▶ <program>.js
istalang/live: the runtime library, prebuilt with the toolchain, imported by every program
```

## What lowering adds

- **`counted`** on every code entry: the registers that may hold what reaches a disposable. A
  register is plain by the type of the values lowering binds it to (the same `reachesDisposable`
  the type table's `counted` flag reads), or, beyond types, when every write builds its value only
  from plain registers (`plainRegisters`); a derived codec of a plain type is plain throughout. It
  is safe, not exact: what neither says is counted. Tests run compiled code checking every write of
  an uncounted register (`checksCounted`).
- The Definition's format version goes up by one. The interpreter ignores `counted`.

## Generated code

**The module** imports `istalang/live`, builds the program's type table and constants at load, binds
each extern to its native with its context (result type, type arguments), holds one JS function per
code entry, and exports one function per start (Host API).

**Functions:**
- **Kinds:** a simple entry is a JS function. A live async entry is a function giving its future,
  whose body is a generator the run drives: it yields each wait, and settles the future as it
  returns. Every `await` yields, a settled future's too, as the interpreter's do. The run resumes,
  stops (`return()`) or runs a cleanup in a suspended call synchronously, inside the step disposing
  it (spec §7), which an `async` function can't.
- **Registers:**
  - registers are locals;
  - a cell register holds a cell, made by its first write;
  - a reference parameter holds `{cell, path}`;
  - a closure carries its captured cells.
- **Arguments:** a parameter left out arrives `undefined`, which the prologue's `given` tests.
- **Control flow:** jumps become a `for (;;) switch (pc)` with one case per label, and code between
  labels is straight-line. Every instruction is one JS line.
- **Calls:** a direct call is a JS call. A function value's call goes through its closure. Calls
  nest on the JavaScript stack, so recursion deeper than it allows (~10k calls) panics, where the
  interpreter's frames go on.

**Values keep the Definition's shapes:** bigint `Int`, tagged composites, the language's maps. So
`valuesEqual`, `mapOf`, the std natives and the JSON boundary are reused unchanged. Values are
immutable to the program: a write copies along its path, and a native's `changes` copies its
place's value. Every write of a place goes through the runtime library's one path write or
`changes`, so in place is later a decision inside them, with no rework.

**In place (later):** the emitter tracks, per register and per cell no closure captures, whether
it alone holds its value's top node.
- **Becomes sole holder:** by a build, or by a move whose source dies before it is read again.
- **Stops being sole holder:** when the value is copied out (a move, a capture, a value argument, a
  store of it as a value).
- **What it allows:** a sole holder's top node is changed in place (`push`, `setIndex`, a `store`'s
  first step). Everything below the top node, and every other value, is copied along the path.
- **For natives:** a `&` argument tells its native's `changes` whether its place is the sole holder,
  so building a collection item by item stays linear without counting plain data.
- **Memos kept by identity:** a value changed in place is first forgotten by `WrittenJson`, as the
  interpreter's in-place writes do, and by lifetimes' memo of whether it reaches a counted object.

## Lifetimes and disposal (spec §7)

- **One core:** both runtimes count with `runtime/lifetimes/counts.ts` and order disposals with
  `runtime/lifetimes/collector.ts`, which reaches either runtime's objects through seams
  (`Collected`). The runtime library's `live/lifetimes/` gives it a run's objects.
- **What is counted:**
  - disposables;
  - objects that may hold one (futures, waits, resolvers);
  - cells and resources of counted types;
  - composite values held by counted holders that reach a counted object, each a node that counts
    its holders and holds its parts. Whether a value reaches one is memoized by identity, values
    never changing, so plain data costs one look per new value and is never counted.

  Everything else is left to the JS GC. The checker's rule (no cycle through anything that reaches
  a disposable) means no cycle collector.
- **Where counts change:**
  - **Emitted code:** writes of counted registers (hold the new value, then let go of the old),
    counted parameters and captures as a frame begins, `release`, and `return`, which holds the
    value given back while every counted register lets go. A counted cell reports its own writes.
  - **The runtime library,** for what its own objects hold: a future's value and registrations, a
    wait's value and cases, a resolver's callbacks and targets, as the interpreter's holdings say
    them. Their state changes mark them touched; what they hold is reconciled with what was last
    reported before anything reads the counts.
  - **The run,** for a readied callback's closure and arguments, a context constant's value, the
    root's future, and a running call's own future.
- **Disposal at the release point:** every call, and in an entry counting anything (a reference
  included) every instruction but control flow, is followed by `if (lt.due) lt.collect()`. A
  `return` collects nothing itself: what it let go of is collected where it lands, once its caller
  holds the value. `dispose` is synchronous (spec), so a collection runs whole before the next
  instruction: a declared `dispose` runs as code inside its round, what it let go of collected in
  a round on top before what it disposed is gone.
- **Stopping a call:** a running call holds its own future, so only a suspended call can be
  stopped: `return()` on its generator runs the `finally` that lets go of its counted registers. A
  call waiting on its own `disposing()` resumes at that case inside the disposal, and is stopped at
  its next await; a `return` from its cleanup settles nothing. Its case on that watch stays pending
  when another case decides the wait, until the call moves on, so the disposal still finds it.
- **The run's end:** once the root's call returned, its outcome is encoded, collecting nothing
  meanwhile, then the run lets go of what it readied but never ran, the root's future, any call
  still suspended and its context constants, collecting after each, as an instance finishes.
- **Panics:** a panic unwinds through compiled code, its callers included, to what the run runs
  on its own, which ends the run there; nothing collects on the way.
- **Also kept:** weak references and their watches; a host's `onCancel` once its future is disposed
  unresolved; a decided `select` releases its losers.

## Runtime library (`istalang/live`)

- **Waits:**
  - a waiting call is resumed by the run once its wait is decided;
  - waits decided together wake in the interpreter's order: the ready queue drains in one
    synchronous pass, each item running to its next stop;
  - `select` decides by position;
  - no segments, heap ids, snapshots or commits.
- **Natives:**
  - the capabilities live code reaches are implemented here: futures, waits, timers, weak side,
    resources, random and logs;
  - slots are ista data; std modules mark the natives only the interpreter runs (instances,
    contexts, slots, testing), and a program reaching one fails to build, naming it;
  - the std natives and `runtime/boundary` are reused unchanged.
- **Traces:** the module carries a line → span table. A panic's trace is read off the JavaScript
  stack, located against a site the module records at load since loaders move lines, so nothing is
  paid on the hot path. After an `await`, the stack holds only the frames
  since it resumed, and so does the trace.
- **Host API:** each start's export takes the host's externs as today's `HostExterns` (JSON in,
  JSON or a promise of it out) and the start's JSON arguments.

## Where it lives

- **`src/codegen/`:** the emitter; `emit/` holds one emitter per instruction family, a typed table
  over the kinds.
- **`src/live/`:** the runtime library. It reaches only the runtime's seams and no Node built-in
  (dependency-cruiser), so it bundles for a browser.
- **`compiler/lowering/`:** `counted`.
- **`cli/commands/build.ts`:** `ista build <entry> --out <file>`.
- **Verification:** a differential runner runs every live corpus program and spec example on both
  backends, beside the corpus runners (`run.sweep.test.ts`). It diffs outcomes (a panic by its
  message and innermost frame), logs and host calls; disposal order shows through what each
  `dispose` does. FormBuilder's views stay byte-identical.

## Out of scope

Ista code, contexts, instances, jobs, snapshots, mocks and `ista test` stay on the interpreter.
Per-module output and build caching are left out on purpose. Source maps and full async panic
traces are filed (tracker F34, F35).
Proposal 9 (native runtime) is a separate target that can reuse `src/live/`.
