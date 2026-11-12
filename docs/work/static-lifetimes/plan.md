---
description: plan for static lifetimes — a whole-program flow analysis rejects every disposable a cycle reaches, and the runtime disposes by counts with no walk of values or the heap; process, phases, acceptance; read before working on or examining a static-lifetimes phase
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-12
last_updated: 2026-11-12
tags: [plan, lifetimes, disposal, performance]
---

# Static lifetimes: plan

**Goal.** No cycle reaches a disposable, as the checker decides with a whole-program flow analysis.
The runtime then disposes by counting holders, and never walks values or the heap to decide a
lifetime. Rules and model: [design.md](design.md). Pre-research per phase:
[tour-checker.md](tour-checker.md), [tour-runtime.md](tour-runtime.md). Supersedes
[archive/plan.md](archive/plan.md).

**Why.** Deciding holders by reachability is about 45% of a live FormBuilder change (48 → 26 ms
with it off), and every live `await` walks the whole heap (tracker P3, P4).

## Process

One fork per phase, and a merge review after the last.

- **Three lanes:**
  - checker: L0 → L1 → L2;
  - violators: V, beside L0 and L1;
  - runtime: R1 → R2 → R3 → R4 → R5 → R6 → R7.

  R1–R3 run beside the checker lane. R4 needs L2 merged: L2 writes the `tracked` flag the runtime
  reads, and rids the corpus of real cycles.
- **Examiners.** Every phase gets a reviewer.
  - Phases that change what a program does get qa as well: L1, L2, V, R1, R5, R6, R7.
  - L0, R2, R3 and R4 skip qa: they change nothing the spec shows, and the corpus, the sweeps and
    the runtime suites, unchanged, are their check.
- **V states its rewrite for the human's approval** if it changes a std signature or conformance
  (a type becoming Disposable is must-use).
- **Precision is settled before L2 forks:** L1 ends with a dry run of the rule.
- **The human approves `@Holds`'s spec wording** before L1 commits it.
- **Behaviour changes stand alone.** R1 changes the resolver edges and R6 the order, so R4's check
  compares counts with a collector of the same edges, and R5 changes only the mechanism.
- **Each phase updates the docs it changes** (design.md, Spec and docs).
- **Bench thresholds.** V rewrites FormBuilder's `Task`, so the FormBuilder live bench is measured
  again when V merges, and R5's and R7's thresholds are restated then. 32 and 28 ms are
  placeholders.

## Phases

| Phase | Scope | Accept |
|---|---|---|
| **L0** Instances | Closing calls per instantiation and `any` dispatch move from lowering into the checker's surface, and lowering reads them there; no behaviour change | every program checks, lowers and runs as before; suites unchanged |
| **L1** Flow analysis | Objects, flow (an extern's yield included), holds, construction and mutation, and `@Holds` (prelude, extern functions with their type parameters in scope, fields), with one checker entry per body and a query of the graph. Ends with a dry run of the rule over std, examples, corpus, spec fences and runtime tests' programs; no diagnostics | unit tests per Flow and Holds bullet, per call through a function value and an `any T`, generic instantiations kept apart, and construction told from mutation; every program checks as before; `edit.bench.ts` gains an edit that changes constraints, and the solve stays within the 5 / 15 ms budgets; the first diagnostics after a cold open at most 20% slower than before L1, the human deciding if it is over; the dry run's report lists every rejection with its cause |
| **V** Violators | Rewrite the real cycles in std and examples (WeakMap; FormBuilder's `Task`), behaviour preserved | std suites and the examples' tests unchanged; L1's dry run reports neither, whichever of V and L1 merges last checking it; the FormBuilder live bench measured again |
| **L2** The rule | The rule and its diagnostic; the `tracked` flag on the Definition; fanout's `@Holds`; the corpus's real cycles (`dispose.ista` `cycle()`, on-cancel's B76) made invalid cases | an invalid corpus case per kind in What it catches; a list built by construction and a recursive async function accepted; an edit in one module that closes a cycle shows the error in another open module; a test that fanout lets go of the chain behind its slowest subscriber; std, examples, spec fences and runtime tests' programs check clean |
| **R1** Edges | design.md's resolver edges, including a disposed future cancelling its pending resolvers; spec §6, §7 and the corpus updated | a kept `Resolver.of` registered on an otherwise dropped call's future: the call stops and the resolver is cancelled; nothing else changes |
| **R2** Seams | One seam for every hold and release (interpreter, natives, decoders, waits, mocks, awaited-status changes); no behaviour change | suites unchanged; a dependency-cruiser rule lets only the seam import the raw writers |
| **R3** Identity | Every handle direct, with a creation serial (design.md, Off the id heap); no behaviour change | suites unchanged; resident sweep unchanged |
| **R4** Shadow counts | Counts kept beside the collector in a per-instance table rebuilt by every restore; whether a composite is counted decided at its first hold; the check in design.md, Contract | the check holds over the corpus, the sweeps and the runtime suites, including a legal cycle of a tracked type that reaches no disposable |
| **R5** Switch | Counts decide disposal, zeroes confirmed at the end of a step and each batch ordered as today; the collector's rounds, `orphans.ts` and the release walks go | suites unchanged, including live-run's unheld timer; dependency-cruiser bans release paths from importing the walks (`handlesIn`, `heldFrom`); FormBuilder live bench ≤ 32 ms per settled change |
| **R6** Order | §7's reverse release order replaces the creation-order sort | the order-asserting corpus updated; nothing else changes |
| **R7** Only indexes | The heap keeps only the scheduler's indexes; `dropUnheld`, `#kept`, `keepOnly` and `holders.ts` go; an ista commit writes what its roots reach in its encoding pass | live paths can't import a walk (dependency-cruiser); an untracked cell is reclaimed (finalization test); resident sweep unchanged; FormBuilder live bench ≤ 28 ms per settled change |

## Out of scope (tracker)

- A live `await` on a settled future continuing in place, the per-step collection check, and
  `newFrame`'s register array.
- Updating a value in place when its count says it is unshared (P2).
- Q49 and Q50, filed from the first plan review. R3 settles Q51.
