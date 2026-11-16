---
description: phase plan and process for the IR-first rewrite (design.md) — goldens from the interpreter, then a new typed IR, lowering, run and codegen built as vertical slices on the ir-first branch with the old pipeline deleted; read before forking, building or reviewing any ir-first phase
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-16
last_updated: 2026-11-16
tags: [plan, rewrite, definition, lowering, runtime, codegen, lifetimes, natives]
---

# IR first — plan

Design: `design.md`. Contracts between phases: `contracts.md`. Evidence: `research/`.

## Process

- **R0 lands on main; everything else on the `ir-first` branch.** S1a deletes the old pipeline
  there, and the CLI moves over slice by slice. Main keeps a working CLI. The tech-lead merges main
  into the branch after each phase; the merge review diffs against their merge base.
- **Vertical slices with a ratchet.** R0's manifest assigns every golden to one phase. The runner
  holds the set of landed phases, each phase adds itself on merge, and every landed phase's goldens
  stay green. Every phase leaves verify green on the branch.
- **Each slice brings its constructs' lifetimes.** S1a lands the ownership core, so the IR's shape,
  lifetimes included, is fixed first.
- **Parallel:** C ∥ S1a, joined before S1b; S4 ∥ S2 → S3; S5b ∥ S5c. Shared files have one owner each (`contracts.md`).
- **Every phase:** qa and a reviewer when done; nothing forks on S1a's contract before it merges; updates `docs/arch` and `docs/reuse` for what it
  lands. Contract amendments come to the tech-lead. Open design questions open their phase as a
  spike.

| Phase | Scope | Acceptance |
|---|---|---|
| R0 Goldens (main) | Goldens and host scenarios as data, a runner, the manifest, the coverage map (`contracts.md`). Recursion floor measured, spec amended; the goldens it changes written by hand, expected red on the old pipeline. Baseline benches. Tag `ir-first-base`. js-codegen docs archived. | Runner green on the old pipeline. Every corpus program, spec example, std suite, scenario and FormBuilder view assigned in the manifest. Every test importing code S1a deletes mapped. No behavior change. |
| C Checker (∥ S1a) | Field-loop annotations; the enum variant loop (§3.16). | Spec examples and checker tests for both. |
| S1a Skeleton | Delete the old pipeline, and every native it does not port (`contracts.md`). The Definition contract doc and schema: typed registers, reach facts, extern entries (capabilities, keeps, holds). Native contract over primitives. Ownership core: hold/let-go, verifier, counts, declared `dispose`, collector. Object ids. Start wrapper and outcome encoder in Istalang. Codegen with inline primitive ops; minimal run, with a dependency rule keeping Node built-ins out; recursion; CLI `run`/`build`. Int, Bool, String, control flow, calls, structs. | S1a goldens green. Typed-IR gate (`contracts.md`). Verifier fails on a dropped or doubled hold (property). `Int` loop within 2× of hand-written bigint. |
| S1b Widening | Closures, cells, references, enums, collections, sync transients; split by construct family at fork time. | S1b goldens green. Typed-IR gate. |
| S2 Async | Spike: settle order in Istalang. Resumable frames, ready queue, park/unpark, stop a suspended call, `disposing()` priority; futures, resolvers, waits, `select`, timers, watches in Istalang; stop landings; async transients; host futures and the host binding. | S2 goldens green. A suspended frame spills and restores identically (property). |
| S3 Lifetimes | In place if unique (write paths, the six collection changes), weak refs. | S3 goldens green. fast-check aliasing. Linear `push` into a `let` and through a handle. |
| S4 Std in Istalang (∥ S2 → S3) | JSON codecs complete; about 95 natives in Istalang, decimal first; the rest on primitives; capabilities per extern. | S4 goldens green. No TS codec synthesis, no production `decimal.js`, no native builds an `Optional`, `Result` or enum. String linearity gate. |
| I1 (tech-lead) | Integrates S3 and S4. | FormBuilder views byte-identical, per change no slower than the R0 baseline. |
| S5a Durable core | Spike: slots in Istalang. Ista code, segments, commits, snapshots (frames as data, root walk), the ista-only externs (slots, `disposed()`, `WeakMap`, `Revertible`, `Inbox`), `crashEveryAwait`; host deploy, wake, inspect. | S5a goldens green. Snapshot round trip, also across two builds (property). |
| S5b Instances (∥ S5c) | Spawn, crossings (`copy`), result, isolate. | S5b goldens green. |
| S5c Contexts (∥ S5b) | Contexts, context constants, jobs; host retry and terminate. | S5c goldens green. |
| S6 Tests and mocks | Spikes: starts past the mock check, a function's identity as a value, cross-instance ancestor lookup. `mocked`, `mockOf`, the registry in Istalang; the test runner; CLI `test`. | Every `.test.ista` golden green. A production Definition holds no mock check. |
| S7 Finish | Export the host API; browser bundle; LLVM doc (`native-binary.md`); merge review of the branch against its merge base with main. | Every golden green. Verify green. The run bundles with no Node built-in. |
