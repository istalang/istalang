---
description: the design of the JavaScript backend for live and simple code — one ES module per source module, cached and content-hashed; what lowering adds to the Definition (roots, keys, owners, counted registers); how code, values, in-place updates, lifetimes and disposal, waits and natives are emitted and run; the runtime library; where it lives; read before implementing or reviewing any part of it
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-14
last_updated: 2026-11-14
tags: [design, codegen, javascript, runtime, browser, lifetimes, lowering]
---

# JS codegen — design

**What it is:** live and simple code compiled to JavaScript ES modules, one per source module, run in
a browser or Node by a small runtime library. A form like FormBuilder's `supplierForm` redraws on
every React input change, with no snapshot. A prototype over the Definition ran `supplierForm`
~30× faster than the interpreter: 1.1 ms per change against 33.5 ms, with byte-identical views. The
interpreter keeps ista code, contexts, `ista test` and mocks. It is also the reference this backend
is diffed against.

## Decisions

- **Disposal stays exactly spec §7.** Counted values are counted, and what lost its last holder is
  disposed at that release point, before the next instruction runs.
- **Lowering records which registers may hold a counted value.**
- **`Int` stays a bigint.**
- **One JS module per source module,** or per import cycle. Each is cached by its content and
  content-hashed on disk, so a change rebuilds, and a browser downloads again, only what it touched.

## Pipeline

```text
Program ─check─▶ lower ─▶ Definition (+ roots, keys, owners, counted registers)
                              │
                              ├─▶ split into units ─▶ emit each unit (cached by its IR) ─▶ <unit>.js
                              └─▶ link ─▶ types.js (type table), main.js (starts)
istalang/live: the runtime library, prebuilt and shared by every program
```

## What lowering adds

- **Roots:** a JS build lowers every non-generic declaration of each module it compiles, reachable
  from `main` or not. A module's unit then depends on that module alone, and the bundler drops what
  nothing uses. The interpreter's Definitions stay reachability-based; it is an option of `lower`.
- **`key`** on every code entry and type entry: the identity lowering interns it by, spelled as text
  (its declaration and its type arguments' keys; a lambda's is its owner's and its position).
  - Keys are unique in a Definition, where names are not: overloads repeat a name, such as
    `json.toJson` ×6.
  - Names stay what traces read.
- **`owners`** on every code entry: the modules that together provide it, which decide its unit.
  - The candidates are its declaration's module, the modules declaring the named types in its type
    arguments, and its witnesses' modules.
  - Any candidate that another candidate imports, directly or not, drops out.
  - A non-generic function has its own module as its one owner, and so does an instance whose
    types its using module brings in. An instance combining unrelated modules' types has several
    owners.
- **`counted`** on every code entry: the registers whose type reaches a disposable, by the same
  `reachesDisposable` the type table's `counted` flag reads.
  - It has one home: the interpreter may read it too, to skip counting plain registers.
- The Definition's format version goes up by one.

## Units

- **A unit is one strongly connected component of the import graph,** which is one module unless
  imports form a cycle (spec §3.13 allows import cycles).
- **Each code entry goes to its owners' unit:**
  - one owner: that module's unit;
  - several: a shared unit named by the owner set (`crm+geo`), which changes only when one of
    them does.
  - For example, `forms._keyOf` goes to `forms`, `forms.draw<Scope<supplier.gen.…>>` to
    `supplier.gen`, and `prelude.push<forms.Node>` to `forms`.
- **References cross units by key:**
  - **Functions:** a unit exports what it owns under a stable mangling of each key, and imports
    what it calls from the unit that owns it.
  - **Type indexes:** values carry the type's index, the shape natives read, so indexes are a
    program's. Each unit imports them from the link's `types.js`, a leaf module, and binds the ones
    it uses once, at load.
  - **Constants:** built at load in each unit that uses them, so loading needs nothing from another
    unit. Units that import each other in a cycle are therefore safe, since they call each other
    only at run time.
  - **Externs:** bound by key. Each unit makes its extern wrappers at load, each with its context
    (result type, type arguments).

## Caching

- **A unit's JS is a pure function of its IR,** with every reference spelled as a key. The emit
  cache is keyed by the hash of that IR, so a unit is emitted again only when it changes, and its
  file name is content-hashed.
- **The std's units and the runtime library are prebuilt** with the toolchain, once per toolchain
  version. Instances of std generics land in the user's units by the owners rule.
- **The link step writes `types.js` and `main.js`** afresh every build: the program's type table,
  and its starts.
- **Lowering still runs over the whole program** each build, on the checker's incremental work.

## Generated code

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
- **Calls:** a direct call is a JS call to the imported or local function. A function value's call
  goes through its closure.

**Values keep the Definition's shapes:** bigint `Int`, tagged composites, the language's maps. So
`valuesEqual`, `mapOf`, the std natives and the JSON boundary are reused unchanged. Values are
immutable to the program.

**In place where it's safe:** the emitter tracks, per register and per cell no closure captures,
whether it alone holds its value's top node.
- **Becomes sole holder:** by a build, or by a move whose source dies before it is read again.
- **Stops being sole holder:** when the value is copied out (a move, a capture, a value argument, a
  store of it as a value).
- **What it allows:** a sole holder's top node is changed in place (`[...dst, item]`, `push`,
  `setIndex`, a `store`'s first step). Everything below the top node, and every other value, is
  copied along the path.
- **For natives:** a `&` argument tells its native's `changes` whether its place is the sole holder.
  Building a collection item by item stays linear without counting plain data.

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
  `if (zeroes.length) collect()`. A collection runs whole before the next instruction:
  - rounds go newest first, as `lifetimes/collector.ts` orders them;
  - a declared `dispose` runs as code;
  - each kind does what `lifetimes/disposal.ts` says.
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
  - the capabilities live code reaches are implemented here: futures, waits, slots, weak side,
    resources, random and logs;
  - instances, contexts and testing are absent, so a program needing them fails at link, naming the
    extern;
  - the std natives and `runtime/boundary` are reused unchanged.
- **Traces:** each unit carries a line → span table, also written as a source map. A panic's trace
  is read off the JavaScript stack, so nothing is paid on the hot path.
- **Host API:** `main.js` exports one function per start, taking the host's externs as today's
  `HostExterns` (JSON in, JSON or a promise of it out) and the start's JSON arguments.

## Where it lives

- **`src/codegen/`:**
  - `units.ts`: the split into units;
  - `emit/`: one emitter per instruction family, a typed table over the kinds;
  - `link.ts` and `cache.ts`.
- **`src/live/`:** the runtime library. It imports only `definition/values`, `foundation`, the
  `stdlib` natives and `runtime/boundary`, so it bundles for a browser. Both folders need entries in
  `.dependency-cruiser.mjs`.
- **`compiler/lowering/`:** the roots option, `key`, `owners` and `counted`.
- **`cli/commands/build.ts`:** `ista build <entry> --target js --out <dir>`.
- **Verification:** a differential runner runs every live corpus program and spec example on both
  backends. It diffs outcomes, logs, host calls and disposal order, beside the corpus runners
  (`run.sweep.test.ts`). FormBuilder's views stay byte-identical.

## Out of scope

Ista code, contexts, instances, jobs, snapshots, mocks and `ista test` stay on the interpreter.
Proposal 9 (native runtime) is a separate target that can reuse `src/live/`.
