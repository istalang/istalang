---
description: ARCHIVED (superseded by the flow-analysis design, 2026-11-12) — plan for static lifetimes — the checker rejects any disposable reachable from a handle cycle, and the runtime disposes by counts with no walk of values or the heap; process, phases, acceptance; read before working on or examining a static-lifetimes phase
owner: tech-lead
status: archived
applies_to: istalang
last_verified: 2026-11-11
last_updated: 2026-11-12
tags: [plan, lifetimes, disposal, performance]
---

# Static lifetimes: plan

**Goal.** No disposable is reachable from a cycle of handles; the checker decides it from types. The runtime then disposes by counting holders of what can hold a disposable, and never walks values or the heap to decide a lifetime. Rules and model: [design.md](design.md). Evidence and units to reuse: [findings.md](findings.md).

**Why.** Deciding holders by reachability is about 45% of a live FormBuilder change (48 → 26 ms with it off), and every live `await` walks the whole heap (tracker P3, P4).

## Process

One fork per phase, qa and reviewer on every phase: lifetimes are semantics every program relies on. Merge review after the last phase.

- **L0 is a design gate.** The human approves the design and its wording, with the violators rewritten on paper in the proposed syntax. No code before that.
- **Two lanes.**
  - The checker lane runs L1 → L2.
  - The runtime lane runs R1 → R2 → R3 → R4 → R5 → R6.
  - R1 and R2 can run beside the checker lane. R3 needs L2 merged, because L2 writes the contract the runtime reads: the Definition's `tracked` flag (design.md, Contract) and the corpus rid of real cycles.
- **Behaviour changes stand alone.** R1 changes the resolver edges and R5 the order, so R3's check compares counts with a collector of the same edges, and R4 changes only the mechanism.
- **Each phase updates the architecture docs it changes** (`definition.md`, `architecture.md` `lifetimes/`, the reuse docs), so later forks read them current.
- **Runtime phases start after async-kinds' CX has merged,** because both touch `scheduler/instance`.
- **Bench thresholds.** L2 rewrites the benchmark's own form, so when L2 merges the FormBuilder live bench is re-measured on the rewritten form: baseline, and with release noting off. R4's and R6's thresholds are then restated against those two numbers. 32 and 28 ms are placeholders.

## Phases

| Phase | Scope | Accept |
|---|---|---|
| **L0** Design | Spec wording, committed later by the phase that makes it true (design.md, Spec and docs), for holding (§3.3, §3.14; decided in design.md), extern held type parameters and held arguments, resolver edges and `onAwait`'s `done` (§6), counted disposal and its exact order (§7); the costs in design.md decided; `definition.md`'s decision on counts | the human approves; FormBuilder (`Task`, `Prop`, the views), `Deferred`/`defer`, `Revertible`, `Resolver.of`, `WeakMap`, `fanout` and §7's `Shared` example rewritten in the syntax |
| **L1** Holding | The holding slot: inference from captures and call arguments, fit, print; std functions that store a function, future or resolver generic over `H` | lambda, call, resolver and trait-object types print their holding; every existing program checks as before (must-use and `Send` read what they read today) |
| **L2** The rule | First one held-parts walk for kinds, sendability and holding (unifying `value-kinds.ts`'s); then tracked types, extern held type parameters and held arguments, the rule, the Definition's `tracked` flag; every violator rewritten inside its module; the corpus `cycle()` invalid | an invalid case per cycle kind (data, call, closure, resolver, `any`), and for a holder widened to unknown before `onAwait` and an `onCancel` callback reaching its resolver's type; std, examples and spec fences check clean; std behaviour suites unchanged |
| **R1** Edges | The collector's holding rules take design.md's resolver edges: one-way registrations, a case resolver cancelled when its waiting call stops; spec §6, §7 and the corpus updated | each changed behaviour has a corpus case (a kept `Resolver.of` registered on an otherwise dropped call's future: the call stops and the resolver is cancelled); an unregistered at-resolver let go of still panics; nothing else changes |
| **R2** Seams | One constructor for composite values and one seam for every holder write and release (interpreter, natives, decoders, waits, mocks); no behaviour change | suites unchanged; no composite literal outside the constructor (lint or test) |
| **R3** Shadow counts | Counts kept beside the collector in a per-instance table, rebuilt by every restore (decoded or a resident's in-memory `take()`); a check that counts' zeroes equal the collector's orphans | the check holds over the corpus, the sweeps and the runtime suites |
| **R4** Switch | Counts decide disposal, each batch of zeroes ordered as today; the collector's rounds, `orphans.ts` and the release walks go | suites unchanged; a release never walks (profile); FormBuilder live bench ≤ 32 ms per settled change |
| **R5** Order | §7's reverse release order replaces the creation-order sort | the order-asserting corpus updated to the approved wording; nothing else changes |
| **R6** Off the id heap | Every handle direct, with a creation serial; the heap keeps only the scheduler's indexes; `dropUnheld`, `#kept`, `keepOnly` and `holders.ts` go; an ista commit writes what its roots reach in its encoding pass | a live run never walks; an untracked cell is reclaimed (finalization test); resident sweep unchanged; FormBuilder live bench ≤ 28 ms per settled change |

## Out of scope (tracker)

- A live `await` on a settled future continuing in place, the per-step collection check, `newFrame`'s register array (measured in findings.md).
- Updating a value in place when its count says it is unshared (P2).
- Q49–Q51, filed from the plan review.
