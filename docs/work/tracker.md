---
description: status of toolchain milestones and filed debt/out-of-scope items — read to know what is done, in flight, or deferred
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-24
last_updated: 2026-10-24
tags: [tracker]
---

# Tracker

## Milestones (plan: `docs/work/toolchain-v0.1/plan.md`)

| Milestone | Status |
| --- | --- |
| M1 Syntax | planned |
| M2 Skeleton | planned |
| M3 Feature slices | planned |
| M4 Standard library | planned |
| M5 Test runner | planned |
| M6 Formatter | planned |
| M7 Language service and LSP | planned |
| M8 Packages | planned |

## Filed

| # | Item | Source | Status |
| --- | --- | --- | --- |
| D1 | `InstanceStore` must store the Definition once by content hash; instances reference it, never embed a copy (arch says "persisted with each instance" — N copies per `spawn`) | plan review 2026-10-24, arch A2 | resolved: arch `lower` row / InstanceStore (2026-10-24) |
| D2 | Layer-DAG import rule and the 400-line file limit are "enforced by lint" but no mechanism is named; Biome covers cycles/restricted imports only. Decide (dependency-cruiser, per-folder Biome overrides, or custom script) in M1.1 scaffold | plan review 2026-10-24, arch A8 | resolved: arch Layers › Mechanisms (2026-10-24) |
| D3 | Scanner `#startsLexemeOrTrivia` re-encodes the lexeme-start dispatch of `#scanLexeme`/`#skipTrivia`; a lexeme start added to one and not the other is silently swallowed by an `unknown` run. One classifier, used by both (DRY) | M1.1 phase review 2026-10-24 | resolved: one `#lexemeScannerAt` classifier (2026-10-24) |
| D4 | The valid string escapes live twice: `simpleEscapes` in `scanner/strings.ts` and the hard-coded list in the `invalidEscape` message. Derive the message from the table (DRY) | M1.1 phase review 2026-10-24 | resolved: message lists `validEscapes`, derived from the table (2026-10-24) |
| D5 | Per-phase code blocks (scanner 1000s, parser 2000s…) are convention only: `defineDiagnostics` rejects duplicates within one catalog, not codes outside the phase's block, so cross-catalog collisions pass. Make the block a parameter and check it | M1.1 phase review 2026-10-24 | open |
