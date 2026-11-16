---
description: phase plan and process for the IR-first rewrite (design.md) — goldens from the interpreter, the std moved to Istalang on main, and one rewrite of everything after the checker on the ir-first branch, tested late against the goldens; read before forking, building or reviewing any ir-first phase
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

Three phases. Small slices would spend their work keeping deleted code green, so the rewrite is one
phase, tested late against goldens. What can be tested now runs on main against the old pipeline.

- **R0 → (L ∥ R1).** L lands on main; R1 builds on the `ir-first` branch. The tech-lead merges
  main into the branch when L lands; R1 ports the natives L leaves after that.
- **Every phase:** qa and a reviewer when done; verify green at its end. R1's reviewer is the merge
  review, diffing the branch against its merge base with main.
- Contract amendments come to the tech-lead.

| Phase | Scope | Acceptance |
|---|---|---|
| R0 Goldens (main) | Goldens and host scenarios as data, with a runner; the coverage map; recursion floor measured and the spec amended, with the goldens it changes written by hand; baseline benches; js-codegen docs archived (`contracts.md`). | Runner green on the old pipeline, except the hand-written amended goldens. Every corpus program, spec example, std suite, scenario and FormBuilder view has its result recorded. Coverage map complete. |
| L Std in Istalang (main) | Field-loop annotations and the enum variant loop in the checker; every JSON encoder and decoder in Istalang; about 95 natives moved to Istalang, decimal first. | Goldens and verify green on the old pipeline. No TS codec synthesis, no production `decimal.js`. Strings linear. |
| R1 Rewrite (branch) | Delete the old pipeline. The new Definition, lowering, codegen and run (`design.md`), every decision there; the remaining natives on primitives; runtime services in Istalang; CLI and host API; docs rewritten. Order inside is the implementer's, the IR schema first. | Every golden green. Verify green. Typed-IR gate. Properties: the verifier fails on a dropped or doubled hold; fast-check aliasing; snapshot round trip across two builds; spill and restore. Perf gates. No native builds an `Optional`, `Result` or enum. The run bundles with no Node built-in. |
