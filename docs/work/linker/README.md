---
description: ways to run a Definition beyond today's TypeScript interpreter — JS interpreter, JS codegen, native interpreter, native binary — with what each gains, the use cases each enables and what each changes in our code and design, plus why durability is snapshots and not memory dumps; read before proposing a new runtime target or changing how the runtime runs code
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-05
last_updated: 2026-11-05
tags: [runtime, executors, definition, durability, performance, ideas]
---

# Executors

Ideas and their notes, not a plan: nothing here is scheduled. One doc per executor:

- `js-interpreter.md`: today's runtime, what it costs, and hosting it on Cloudflare Durable Objects.
- `js-codegen.md`: JavaScript generated from a Definition, run in place of the interpreter on JS hosts.
- `native-interpreter.md`: the runtime rewritten in Rust or C, still interpreting the Definition.
- `native-binary.md`: machine code from LLVM IR generated from the Definition.

## What every executor keeps

Durability is the language's core promise (spec §5). An executor is another way to run a Definition, never another lowering:

- **The Definition stays the deployed unit.** It is kept by content hash and validated when loaded, and every instance is pinned to it for life (docs/arch/definition.md).
- **Frames stay data:** `(function, pc, registers)`. A stopped execution's pc is its `await` or `select`, and each commit writes the snapshot through the `InstanceStore` (`runtime/store.ts`, `runtime/scheduler/wake.ts`).
- **A segment re-run computes the same.** `now()` is the segment's start, random draws are counted in the snapshot and extern constants are pinned (spec §3.6, §3.8). `crashEveryAwait` checks this (§10).
- **Released objects are collected after every instruction.** The segment loop runs one instruction per step and collects before the next (`scheduler/segment/index.ts` `#drive`, `#step`). A disposal that runs code is a call on the run stack, made before the execution goes on (definition.md, Holders).

Keep these, and a snapshot one executor commits is one any other resumes.

## Why snapshots, not memory dumps

A Go or Rust binary can checkpoint its whole process (CRIU-style) and restore it later. A dump saves a process. A snapshot saves the program's state, in a form the language defines.

| Concern | Process memory dump | Istalang snapshot |
| --- | --- | --- |
| Resuming elsewhere | Needs the same binary, OS, kernel features and CPU architecture; a rebuilt binary can't read an old dump | Canonical JSON pinned to a Definition by hash; any runtime resumes it, and old instances finish on their own code after a deploy |
| When state is saved | Any moment: mid-syscall, mid-write, holding a lock | Only at commit points; a crash between them re-runs the segment from the last commit |
| The outside world | Dead sockets, file descriptors, threads, TLS sessions and timers | Externs and futures: a pending host call is a token the host fills; a host resource is a `resource` object behind a handle |
| Time and randomness | The clock jumps; deadlines in the heap are stale | Segment start time, counted random draws, pinned extern constants; timers are data the host wakes on |
| Size | The whole address space, garbage and allocator state included | Only what can't be derived: frames and reachable objects, so millions of waiting instances fit a store |
| Granularity | One process per dump | Many instances per runtime, each persisted alone; spawned children are instances of their own |
| Safety checks | None | Deploy checks host extern signatures across deploys; waking checks the snapshot against its Definition |
| Operations | Opaque bytes | `inspect` with `waitingAt` and source spans, `retry`, `terminate` with disposal |
| Crash testing | Impractical | `crashEveryAwait` runs every segment twice and panics if they differ |

A dump is better when any code must be checkpointed, when commits would cost too much, and for compute-heavy batch jobs checkpointed rarely. A native executor that dumped memory would keep the speed and lose every row above, so each executor here keeps the snapshot model.

## The four executors

| | JS interpreter (today) | JS codegen | Native interpreter | Native binary |
| --- | --- | --- | --- | --- |
| Runs code by | The instruction table (`runtime/interpreter/instructions.ts`) | Generated JS per code entry, which the JS engine compiles | An instruction loop in Rust or C | Machine code from LLVM IR |
| Runs on | Node, or any JS host with `node:crypto` (Workers under `nodejs_compat`) | The same | Any OS and architecture the runtime builds for; embeddable through a C ABI | The same, per target |
| Gains | The reference semantics; everything works today | CPU: no per-instruction dispatch, inline primitive operators | No Node, a small static binary, fast cold start, embeddable | The most CPU, unboxed values once registers are typed |
| Enables | Workflow engines, I/O-bound agents, durable actors on Durable Objects | CPU-billed hosts (Workers), heavier segments on JS hosts | Edge and IoT, robotics and lab automation, mobile and desktop embedding, durable CLI tools | Batch data jobs, financial computation, simulations and game logic |
| Changes to existing code | A host adapter per platform | Shared frame helpers, an executor seam per code entry | A conformance spec, JS-defined std semantics settled, a host ABI, a runtime seam for tests | The native interpreter's, plus typed registers in the Definition |
| New code | Small | Medium | Large: the runtime and 203 natives | The largest |

Speed only matters when CPU time between commits outweighs a commit's cost. For I/O-bound work, such as API glue, agents waiting on models or humans, and most workflows, store latency dominates and the interpreter is enough.

## Shared prerequisites

1. **An executor contract.** The frame helpers in `runtime/interpreter/machine.ts` (`readRegister`, `writeRegister`, cells, `releaseFrame`, `storeAt`) are what a handler may do to a frame. Every executor implements them, or calls them.
2. **A conformance suite.** Run `test/corpus/`, the runtime tests and the std `.test.ista` suites against every executor. Add golden vectors for `language/values.ts` (`==`, map keys, order), canonical JSON, and the text of `Int`, `Float`, `String` and `Decimal`.
3. **Std semantics defined by JavaScript, settled in the spec.** The `strings` module takes "JavaScript's names", `regex` expands `$1` "as JavaScript does", `strings.utf16Length` counts as JavaScript does, JSON keys sort in UTF-16 order (§9), and a primitive's text is JavaScript's `String(value)` (`stdlib/prelude/text-forms.ts`). A non-JS executor must match them bit for bit.
4. **Delta snapshots,** for executors that make segments compute more. Each commit encodes and writes the whole snapshot (`wake.ts` `commit`), so large state makes every `await` costly whatever runs the code.

## Suggested order

1. Host the TS runtime on Durable Objects (`js-interpreter.md`). No core change.
2. JS codegen, behind an executor seam, checked against the interpreter.
3. A native interpreter, once a use case needs no-Node deployment or embedding.
4. A native binary on top of the native runtime, once a use case is CPU-bound between commits; then typed registers.
