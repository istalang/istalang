---
description: how a Definition becomes one JavaScript ES module — entry shapes (simple functions, resumable async frames), parks and resumes, lifetime calls per register, inline primitives, transients and traces; read before changing src/codegen or what lowering emits for a backend
owner: toolchain
status: active
applies_to: src/codegen
last_verified: 2026-11-16
last_updated: 2026-11-17
tags: [codegen, backend, frames, javascript]
---

# Codegen

`src/codegen/emit.ts` turns a Definition into the body of one ES module, `function(rt)`, which each
run instantiates over itself (docs/arch/runtime.md), so the code is emitted once per Definition and
shared by every run. Lowering made every decision (ir-first design, target shape); codegen writes
what each instruction says and nothing else.

## Entries

- **One predicate** decides an entry's calling convention: `runsOnFrames` (`entry.ts`). Every
  backend keeps that one rule; nothing else asks whether an entry is async.
- **Simple entries** are plain functions, `fN(parameters..., cl)`, `cl` the closure they run as
  (`currentClosure`). A call leaving parameters out passes them absent, and the prologue computes
  their defaults (`given`).
- **Async entries** are resumable functions over a frame record, `fN(frame)`: registers come back
  from `frame.registers`, and the body is `switch (frame.pc)` over the instructions. A `park` stops
  where the call is stopping (to its stop landing), else saves the registers and the resume pc,
  `instructions.length + index of the park`, and returns `PARKED`; the run resumes the frame with
  the position its wait was decided for (`frame.decision`). Frames are data, the snapshot's own
  shape (design decision 3).
- **Recursion** has no depth counter: the host's stack decides, and the run maps a stack overflow
  to the one panic, `A call nests deeper than the runtime allows.` (`runtime/natives.ts`,
  `panicOf`); the spec's floor is 1,000 calls.

## Lifetimes per register

A register's type gives its lifetime (`definition/tables/types.ts`, `lifetimeOf`): **counted**
registers get `hold` and `letGo`, **heap** ones `share` where a value gains a holder, **plain** ones
nothing. A `letGo` of several registers is one batched call, as is a `return`'s `releasing`, with
its value too in a frame stopping as its call is disposed (`return STOPPED`); a moved counted operand
is emptied (`cleared`), so a register never holds what it gave away. `newCell` passes its `dispose` entry, run
as the cell loses its last holder.

## Primitives, places and calls

- Primitive operations (`Int` `+`, comparisons, string concatenation, ...; `definition/instructions/
  primitive-ops.ts`) compile to inline JavaScript over the run's representation; an extern lowering
  maps to a primitive (`primitiveOfExtern`) is never a call.
- Places (`load`, `store`, `reference`) go through the run, which writes along a path in place where
  the value is unique (`Lifetimes.withPart`).
- A call of a known entry is a direct call; a call of a function value goes through `callValue`; an
  async callee starts an execution and gives its future (`Run.start`).
- `currentCall` is the frame's execution in async code and `currentExecution()` in simple code.
- `mocked` asks the run (`Run.mocked`), and writes its register only with an answer, never with
  the run's marker of none (`NOT_MOCKED`).
- A transient's cell is shared by function and register in the running execution's scope
  (`run/transients.ts`): a call finding one shares it on (`sharedTransient`), one making it shares
  its own (`shareTransient`), and each call's `return` takes back and lets go of its own share
  (`unshareTransient`, spec §3.4). An async call keeps the cells visible where it started until it
  ends, its stop included.
- `emitProgram` takes the order its functions are emitted in: a test's second build of one
  Definition shuffles it, and a snapshot one build commits resumes the same in the other.

## Traces

`lines` maps each emitted line back to its instruction's span, and the run turns a JavaScript stack
into the program's trace (`run/traces.ts`), so a panic names the program's frames, not the module's.
