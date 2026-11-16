---
description: phase plan and process for the IR-first refactor (design.md) — every program lowered to one typed IR, one run, every executor alike; read before forking, building or reviewing any ir-first phase
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-16
last_updated: 2026-11-16
tags: [plan, refactor, definition, lowering, runtime, codegen, lifetimes, natives]
---

# IR first — plan

Design: `design.md`. Evidence: `research/`. Greenfield: no compatibility, no interim second way.

## Process

- **Leaves to root (Mikado).** Two pairs run in parallel, in worktrees: G1 ∥ G2 and G6 ∥ G7.
  Everything else is sequential, because each phase builds on the IR or run shape before it:
  - G3 types what G1 reshapes;
  - G4 needs those types;
  - G5's structs need G4's lowered holds;
  - G8 merges runs that G5 has emptied of services.
- **Why services move before the runs merge:** moving them to Istalang first shrinks the merge
  instead of merging their twins.
- **Every phase merges to main on its own,** green, with qa and a reviewer.
  - Structural phases (G0, G1) prove themselves by byte-identical Definitions, so their qa is that
    check.
- **G8 gets a sub-lead,** who writes its sub-plan for the human's approval.
- **G9 is the merge review of the whole feature.**

| Phase | Scope | Acceptance |
|---|---|---|
| G0 Ground | Seams, counts, collector, settle order, random draws, boundary and the snapshot contract move out of the interpreter's folder into a shared core. Lowering's quick deletes. Docs that contradict this design are rewritten (`js-codegen/`, `definition.md`, `linker/`). | No behavior change: Definitions byte-identical over the corpus. Verify green. dependency-cruiser has no live→runtime allow-list. |
| G1 Lowering reshaped (∥ G2) | One entry builder; entry kinds as a table; `DefinitionTables` split; ownership explicit in `FlowWriter`; no ambient state (`research/lowering-audit.md` §4, steps 1–3). | Definitions byte-identical over the corpus and spec examples. Verify green. |
| G2 Natives speak primitives (∥ G1) | Results built in `.ista` wrappers; about 95 natives move to `.ista`, decimal first; capabilities per extern in the Definition, checked at bind; one resolver, one native-context builder, one host binding. | No native builds an `Optional`, `Result` or enum value. `interpreterNativeKeys`, the stubs and `decimal.js` are gone. Runner and std suites green. Interpreter cost of the moved loops reported. |
| G3 Typed IR | Cell and reference instructions; `field` split; flavors as variants; typed registers (one per pass in field loops); reach on every type entry. `counted` and its inference deleted. | Validator: every register typed, every type entry states its reach. Property: a runtime tracks a register exactly when its type reaches a disposable. No per-value reach walk. FormBuilder ≤ 1 ms per change. Runner green. |
| G4a Lifetimes emitted | Hold and let-go, stop landings, `select` holdings, each extern's keeps and holds; the ownership verifier. Runs still count on their own. | The verifier passes on every corpus program, spec example and std module, and fails on IR with a hold or let-go dropped or doubled (property). Runner green. |
| G4b Lifetimes executed | Both runs execute them. Write counting, holder writes, reach walks, the generator `finally` lists and collect-point choices are deleted. `select` losers let go per the spec on both. | No run holds or lets go of anything the IR didn't say (instrumented sweep). Runner green. FormBuilder ≤ 1 ms. |
| G4c In place | "In place if unique" for write paths and the six collection changes, derived-data forgets inside. `InPlace`'s own-set and `Place`'s always-copy go. | `push` into a `let` and through a handle is linear on both (n=10⁵ / 10⁴ < 15). fast-check: no shared value observably changes. FormBuilder ≤ 1 ms. |
| G5 Services in Istalang | Futures, resolvers, waits, slots, timer grouping, watches and settle order become Istalang over run primitives (park, unpark, enqueue, timer-at, host token, current execution). | Heap kinds: cell, resource, weakRef, execution, contextConstant. The services and twins listed in `research/runtime-audit.md` §3 (c), (d) are gone. Runner and std suites green. Wake bench and FormBuilder within 10% of G4c. |
| G6 Protocols lowered (∥ G7) | The start wrapper; `copy` at crossings; `mocked` in test builds with the run's `mockOf` and an Istalang registry; collect points. | `root-outcome`, `crossing` and mock dispatch on call paths are gone. A production Definition holds no mock check. Runner green. |
| G7 Frames as data (∥ G6) | The executor contract. Compiled async entries become resumable functions over frame records; the interpreter runs over the same records. One recursion rule. | Property: a suspended compiled frame spills and restores into an identical run. No generators remain. FormBuilder ≤ 1 ms. |
| G8 One run | One run under both executors: segments, commits, snapshots, contexts, instances, jobs, `ista test`, `crashEveryAwait`, the host API. The scheduler and `src/live`'s run merge. `emitProgram` refuses nothing. | The whole corpus, ista code, std `.test.ista` suites and `crashEveryAwait` are green on both executors. A snapshot committed on one resumes on the other (property). No interpreter-only feature remains. |
| G9 Close | The interpreter's fate (design, Open 1); `native-binary.md` gains reference counts, the cycle collector and the frame shape; architecture docs final. | Merge review of the whole feature. |
