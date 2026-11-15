---
description: the design of the JavaScript backend for live and simple code — one ES module per program; what lowering adds (counted registers); how code, values, lifetimes and disposal, waits and natives are emitted and run; the runtime library; where it lives; read before implementing or reviewing any part of it
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-15
last_updated: 2026-11-15
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

- **`counted`** on every code entry: the registers whose type reaches a disposable, by the same
  `reachesDisposable` the type table's `counted` flag reads.
- The Definition's format version goes up by one. The interpreter ignores `counted`.

## Generated code

**The module** imports `istalang/live`, builds the program's type table and constants at load, binds
each extern to its native with its context (result type, type arguments), holds one JS function per
code entry, and exports one function per start (Host API).

**Functions:**
- **Kinds:** a simple entry is a JS function. A live async entry is an `async` function that
  settles its own future, so awaiting a future that has already settled never yields.
- **Registers:**
  - registers are locals;
  - a cell register holds a cell, made by its first write;
  - a reference parameter holds `{cell, path}`;
  - a closure carries its captured cells.
- **Arguments:** a parameter left out arrives `undefined`, which the prologue's `given` tests.
- **Control flow:** jumps become a `for (;;) switch (pc)` with one case per label, and code between
  labels is straight-line. Every instruction is one JS line.
- **Calls:** a direct call is a JS call. A function value's call goes through its closure.

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

## Lifetimes and disposal (spec §7)

- **What is counted:** what `lifetimes/counts.ts` counts today:
  - disposables;
  - objects that may hold one (futures, slots, waits, resolvers);
  - cells and resources of counted types;
  - composite values in counted registers, each a node that counts its holders and holds its parts.

  Everything else is left to the JS GC. The checker's rule (no cycle through anything that reaches
  a disposable) means no cycle collector.
- **Where counts change:**
  - **Emitted code:**
    - writes of counted registers (hold the new value, then let go of the old);
    - `release`, and `return` for every counted register;
    - builds and captures from counted registers;
    - cell writes of counted types.
  - **The runtime library,** for what its own objects hold: a future's registrations, a wait's
    resolvers, a slot's queue.
- **Disposal at the release point:** every instruction that let go of something is followed by
  `if (zeroes.length) collect()`. `dispose` is synchronous (spec), so a collection runs whole before
  the next instruction:
  - rounds go newest first, as `lifetimes/collector.ts` orders them;
  - a declared `dispose` runs as code;
  - each kind does what `lifetimes/disposal.ts` says.

  The interpreter's collector is bound to its heap and snapshots, so the runtime library has its
  own; the differential runner holds the two to one behavior.
- **Stopping a call:** a running call holds its own future, so only a suspended call can be
  stopped. Its await wakes with a stop: the function lets go of its counted registers and returns,
  settling nothing. A call woken through `disposing()` resumes at that case and stops at its next
  await.
- **Also kept:** weak references and their `disposed()` watches; a decided `select` releases its
  losers.

## Runtime library (`istalang/live`)

- **Waits:**
  - a waiting call sleeps on a promise its wait resolves;
  - waits decided together wake in the interpreter's order, and JavaScript's microtasks keep it;
  - `select` decides by position;
  - no segments, heap ids, snapshots or commits.
- **Natives:**
  - the capabilities live code reaches are implemented here: futures, waits, slots, timers, weak
    side, resources, random and logs;
  - instances, contexts and testing are absent, so a program needing them fails to build, naming
    the extern;
  - the std natives and `runtime/boundary` are reused unchanged.
- **Traces:** the module carries a line → span table. A panic's trace is read off the JavaScript
  stack, so nothing is paid on the hot path. After an `await`, the stack holds only the frames
  since it resumed, and so does the trace.
- **Host API:** each start's export takes the host's externs as today's `HostExterns` (JSON in,
  JSON or a promise of it out) and the start's JSON arguments.

## Where it lives

- **`src/codegen/`:** the emitter; `emit/` holds one emitter per instruction family, a typed table
  over the kinds.
- **`src/live/`:** the runtime library. It imports only `definition/values`, `foundation`, the
  `stdlib` natives and `runtime/boundary`, so it bundles for a browser. Both folders need entries in
  `.dependency-cruiser.mjs`.
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
