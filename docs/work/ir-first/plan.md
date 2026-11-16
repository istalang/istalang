---
description: phase plan and process for the IR-first rewrite (design.md) — goldens from the interpreter, a new typed IR, lowering, run and codegen built as vertical slices beside the old pipeline, then the old deleted; read before forking, building or reviewing any ir-first phase
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-16
last_updated: 2026-11-16
tags: [plan, rewrite, definition, lowering, runtime, codegen, lifetimes, natives]
---

# IR first — plan

Design: `design.md`. Evidence: `research/`. Greenfield: no compatibility; breakage is caught by
goldens and tests.

## Process

- **Rewrite in vertical slices.** Each slice runs its constructs end to end, through new lowering,
  IR, codegen and run, and turns a named set of goldens green. The first slice fixes the IR's
  shape, so a contract flaw surfaces in week one, not at integration.
- **Old code moves aside.** R0 moves the old pipeline into `src/legacy/`, so new code takes the
  final folder names. The CLI keeps the old pipeline until S7, which deletes `src/legacy/`.
- **Parallel pairs.** S2 ∥ S4: async and the std live in different layers, and S4 writes Istalang
  against S1's contract. The rest is sequential:
  - lifetimes dispose S2's futures;
  - durability persists what S2 and S3 make;
  - tests and mocks run on durable instances.
- **Contract amendments come to the tech-lead,** who broadcasts them. Every phase merges to main,
  green, with qa and a reviewer. S7's reviewer reviews the whole feature as the merge review.

| Phase | Scope | Acceptance |
|---|---|---|
| R0 Goldens | Capture the interpreter's results (design, Decision 1) as files under `test/golden/`, with a runner. Amend the spec (design, Spec amendments) and mark the goldens those amendments change. Move the old pipeline into `src/legacy/`. | The golden runner is green against the legacy pipeline. Every corpus program, spec example, std suite, host scenario and FormBuilder view has a golden. The spec is amended. No behavior change. |
| S1 Skeleton | The new IR (schema, validation) with typed registers, reach facts, cells, references and split fields. New lowering, codegen with inline primitive operations, and a minimal run for simple and live code with no waits: values, control flow, calls, closures, structs, enums, collections, primitive natives. | The goldens of every program within those constructs are green on the new pipeline (named list). The `Int` loop is within 2× of hand-written bigint. |
| S2 Async (∥ S4) | Live async entries as resumable functions over frame records; the ready queue; park and unpark; futures, resolvers, waits, `select`, slots, timers, watches and settle order in Istalang over run primitives; host futures; the host binding. | Async, waits, `select`, slots and timers goldens green. A suspended frame spills and restores into an identical run (property). |
| S3 Lifetimes | Hold and let-go, stop landings, keeps and holds, disposal and the collector, weak refs, `disposed()`/`disposing()`, declared `dispose`, in place if unique; the ownership verifier. | Holders, weak-side and disposal goldens green. The verifier fails on IR with a hold or let-go dropped or doubled (property). Linear `push` into a `let` and through a handle (n=10⁵ / 10⁴ < 15). fast-check aliasing. FormBuilder views byte-identical, ≤ 1 ms per change. |
| S4 Std in Istalang (∥ S2) | Field-loop annotations and the enum variant loop in the checker; every JSON encoder and decoder in Istalang; about 95 natives moved to Istalang (decimal first); the rest take and give primitives; capabilities per extern. | Std suites and JSON goldens green on the new pipeline. No TS codec synthesis and no `decimal.js`. No native builds an `Optional`, `Result` or enum. |
| S5 Durable | Ista code, segments, commits, snapshots (frames as data, root walk, ids), contexts, context constants, instances, spawn and crossings, jobs, retry, terminate, `crashEveryAwait`, the recursion rule. | Every durable-feature golden green, `crashEveryAwait` included. Property: a snapshot commits, restores and continues identically. |
| S6 Tests and mocks | `ista test` on the new pipeline; `mocked` in test builds with `mockOf` and the registry in Istalang. | Every std and corpus `.test.ista` golden green. A production Definition holds no mock check. |
| S7 Switch and delete | The CLI (`run`, `test`, `build`) and the host API on the new pipeline; `src/legacy/` (interpreter, scheduler, old lowering, old Definition, old live run and codegen) deleted; architecture, Definition and LLVM docs rewritten. | Every golden green. Verify green. No `src/legacy/`. Merge review of the whole feature. |
