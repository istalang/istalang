---
description: compiling a Definition to machine code through LLVM IR, on top of a native runtime — what the Definition already gives a backend, what works against native code, the use cases worth it, and the changes our code and design need (typed registers above all); read before proposing native compilation or changing the Definition for a backend
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-05
last_updated: 2026-11-05
tags: [runtime, executors, native, llvm, codegen, definition, performance]
---

# Native binary

LLVM IR generated from a Definition and linked against the native runtime (`native-interpreter.md`), so code runs as machine code while the runtime keeps segments, commits, the heap and natives. It needs the native runtime first: generating code is the smaller part of the work.

## What the Definition already gives

- **Monomorphized and closed.** Every generic is compiled per instantiation, every call has one function-table target, and an `any` type is an enum closed over the program, called through a `switch` (definition.md, Decisions). There is no runtime type dispatch to emulate.
- **Linear register code with explicit control flow.** `jump`, `branch`, `switch` and `return` map onto LLVM basic blocks.
- **Explicit suspension.** A stopped frame's pc is always its `await` or `select`. Each function becomes a state machine entered through `switch (frame.pc)`, its registers spilled to the frame at each suspension and held in SSA values between them.
- **Explicit lifetimes.** `release` and `keep` stand on every exit path, and each frame lists its `cells`. Destruction points are known ahead of time.
- **Extern keys with types,** such as `prelude.add(Int, Int)` (`definition/extern-key.ts`). A backend recognizes them and emits machine operations, with no IR change.
- **Natives never call back into code** (architecture.md, Decisions), so the boundary has no re-entrancy.

## What works against native code

- **Untyped instructions.** A code entry records only `{ reference }` per parameter and a register count (`definition/functions.ts`). Without types, every register is a boxed, tagged value, the speed of a dynamic language. Types can be partly recovered from constants and the `struct` and `variant` instructions, but not through calls to code entries.
- **`Int` has arbitrary precision** (spec §2). It needs a small-integer fast path that checks for overflow and promotes to a bignum.
- **Value semantics** (§3.1). Values are immutable and copied on assignment, and `==` and map keys compare structure. That needs reference counting with copy-on-write, and `language/values.ts` ported exactly.
- **Collection after every instruction** (README, What every executor keeps). Compiled code that lets go of a disposable value must reach the collector before going on.
- **Whole-snapshot commits.** Faster code doesn't make a commit cheaper; a program that computes and awaits often needs delta snapshots.

## Use cases worth it

Native code pays only when CPU time between commits outweighs a commit:
- **Batch data jobs:** backfills, migrations, reconciliation, re-indexing. Hours-long runs resume after a crash or deploy, and parsing and transforming between checkpoints is pure CPU.
- **Financial computation:** ledgers, billing runs, settlement. `Decimal`-heavy arithmetic, with segments that re-run identically.
- **Simulations and persistent game worlds:** each entity a durable instance, game logic per tick.
- **Control logic** in robotics and automation, on top of what the native interpreter already gives there.

It is no use for I/O-bound work, and none on Workers: isolates run no OS binaries. Cloudflare Containers can, but give up the isolates' density and cold start.

## Stages

1. **Boxed values, no IR change.** Generate from today's Definition with every register a tagged value, operators inlined by extern key. This proves the state machines and snapshot compatibility against the conformance suite.
2. **Typed registers.** Unboxed integers and floats, structs laid out by their type entries, direct calls between functions that can't suspend.

## Changes to our code and design

Everything `native-interpreter.md` lists, then:

- **Register types and code-entry signatures in the Definition.** Each code entry gives each register's type entry, and its parameter and result types:
  - the schema in `definition/functions.ts`, and validation in `definition/references.ts`;
  - a format version bump. A runtime refuses a version it doesn't know, so stored Definitions of the old version need a reader of their version or a migration;
  - lowering: `CodeWriter.allocate()` (`lowering/code-writer.ts`) becomes `allocate(type)`, at 60 call sites in 31 files. Most sites have the type at hand, as the checker's type of a node, a binding's or a parameter's;
  - `function-lowering/frames.ts` writes the signatures.
- **Reverse a recorded decision.** definition.md chose untyped instructions over a typed IR, which would be "a second type system for the runtime to keep consistent with the checker's". The types here are annotations lowering copies from the checker, never a type system the runtime checks, so that reason holds. Record the change as a decision.
- **Delta snapshots** in the runtime and the store, so a commit writes what changed.

The checker and lowering's semantics need no change.
