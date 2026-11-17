---
description: generating JavaScript from a final Definition and running it in place of the interpreter on JS hosts — why from the Definition and not from lowering, the shape of the generated code, what must stay as the interpreter does it, where code is generated on Node and on Workers, and the changes it needs; read before speeding up the runtime on a JS host, or changing how ephemeral futures run
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-09
last_updated: 2026-11-10
tags: [runtime, executors, codegen, javascript, workers, performance]
---

# JS codegen

A second executor for JS hosts: each code entry of a Definition becomes a JavaScript function that the host's engine compiles, run in place of the instruction table. Everything else stays the TS runtime's: scheduler, heap, collector, natives, snapshots.

## From the Definition, not from lowering

Generate from the final Definition. Lowering straight to JavaScript would skip the Definition, and with it:
- **The deployed, versioned unit:** kept by hash, validated on load, every instance pinned to it.
- **The snapshot's meaning:** a frame is `(function, pc, registers)`, numbered as the Definition numbers them. Generated code keeps those numbers, so the interpreter and generated code resume each other's snapshots.
- **Traces and `waitingAt`,** which read spans through the Definition's modules.
- **One lowering.** A second backend from checked bodies would repeat releases, fits, instantiation and dispatch for `any` types, which lowering already decided and the Definition records.

## The generated code

- **One function per code entry,** over the frame as data: `switch (frame.pc)` over the entry's basic blocks. Registers stay in the frame, read and written through the frame helpers (`interpreter/machine.ts`), so cells, references and release reports behave as they do now.
- **The pc stays exact at every point the runtime can observe.** That covers `call`, `await`, `select`, `spawn`, `currentCall`, a panic's trace, and the end of each block the code runs at once.
- **Primitive operators run inline.** A `call` whose callee is an extern with a known key, such as `prelude.add(Int, Int)`, becomes the `bigint` operation itself, with the same panics. This saves the most: today every operator is a full call through the function table and the mock check.
- **Calls go back to the scheduler.** A callee can suspend, be replaced by a mock or be a native, and an async callee runs on its caller's segment. So the generated function sets the pc and returns at each `call`, as the `call` handler does. Between calls it runs without dispatch.
- **Collection between instructions stays.** The segment loop collects what each instruction let go of before the next (`segment/index.ts` `#drive`), and a disposal running code is a call made before the execution goes on. So a block that releases, overwrites a register or ends a frame stops there and returns to the loop when the heap reports a release; straight-line code that lets go of nothing runs through.

## Where code is generated

- **Node:** at deploy, from the Definition's text through `new Function`, cached by the Definition's hash.
- **Cloudflare Workers:** `eval` and `new Function` are blocked at run time. So generate at build, as a module keyed by the Definition's hash and bundled with the Worker. The runtime uses that module when it has one for a hash, and interprets otherwise, so a Definition deployed at run time is always interpreted.

## Gains

- No per-instruction dispatch, and inline primitive operators. The engine optimizes each generated function like any hand-written one.
- Workers bill CPU time, so segments that compute cost less, with the runtime unchanged.
- Nothing changes for snapshots, hosts or tools: the interpreter and generated code are interchangeable per Definition.

## Use cases it enables

- Durable actors and sessions on Workers or Durable Objects whose handlers compute: validation, pricing rules, parsing, aggregation (`js-interpreter.md`, Hosting).
- Heavier segments on Node hosts, with no change of host.

## Changes to our code

- **The frame helpers become the executor contract.** `interpreter/machine.ts` documents what any executor may do to a frame, and the instruction handlers and generated code both go through it.
- **An executor seam in `LoadedDefinition`** (`scheduler/loaded-definition.ts`). It carries how each code entry runs, interpreted or by a generated function, and the segment's step dispatches on it.
- **The pc and trace contracts written down.** Where the pc must be exact, and how a panic inside an inline operator reports the `call` it replaced.
- **Conformance runs both executors** over `test/corpus/`, the runtime tests and the std suites, plus a property test over random Definitions (the instruction test kit exists). It compares outcomes, commits and traces.
- **New:** the generator, which reads only the Definition, and a build step for Workers.

## Risks

- **Code size:** one function per instantiation, since generics are compiled per instantiation. Large programs make large bundles.
- **Mocks:** inlining an operator skips the mock check. Mocks replace functions a test names, so inline only externs no mock may target, or keep tests on the interpreter.
- **Drift from the interpreter,** which only the conformance runs can catch.

## After proposal 8

Proposal 8 narrows what must be frames as data. Only `ista` code is ever persisted: a plain
function can't wait, live code never commits, and the two never call each other, so an `ista`
frame never waits in memory and a commit never lands mid-call.

- **Plain and `live` code can be native JavaScript:** real locals, `async`/`await`, a live future a
  promise, a live resolver its `resolve`, `onCancel` an `AbortSignal`. An unmarked function is
  compiled once per kind, so its live copy is native too. The frame-as-data form above is needed
  only for `ista` bodies, or they stay interpreted.
- **What stays shared:** the value and heap representation, releases (lowering's explicit release
  instructions become calls), mocks (a mocked function is called through the table) and spans for
  traces.
- **Proposal 8's runtime keeps this open:** its live futures are promise-backed and ride the
  host's event loop (`docs/work/done/async-kinds/phases.md`, R1b).
