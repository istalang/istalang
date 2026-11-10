---
description: plan for implementing proposal 8 (live and ista async), with `delegate` and the minimal slice of proposal 9 that lets live code run and test ista code — process, fourteen phases with order, shared surfaces and owners, diagnostic ranges and verification; read before forking or examining an async-kinds phase
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-10
last_updated: 2026-11-11
tags: [plan, proposal-8, async]
---

# Async kinds: plan

Spec: `docs/proposals/8-persistent-and-ephemeral-async.md`. Code before it: `findings.md`. Scope and
acceptance per phase: `phases.md`.

## Process

**Fourteen phases, each an implementer fork in its own worktree, with a pi reviewer and a qa on
every behavioural phase; a merge review at the end.** *Why:* it crosses every layer, reshapes the
most depended-on type (functions) and the runtime's entry, and soundness rests on it. Each
structural change the later phases build on lands first, on its own.

- **Examiners:** one root pi reviewer and one root qa (`hcom pi --agent qa`); every phase forks
  both.
- **Merging:** a fork reports ready once its reviewer and qa approve; the tech-lead fast-forwards
  `main`.
- **Rewrites** of sources go through one committed rewriter (DC's), re-run after every rebase.
- **Profiles:** checker phases run `npm run profile:check`, runtime phases `wake.bench.ts`
  (within 10% unless stated), against their base.

## Phases

| Phase | Scope | After |
|---|---|---|
| **A0** Function heads ✓ | One modifier-set parser; qualifiers grouped; one order every printer reads | — |
| **R1a** Async host ✓ | The host and test-world contract asynchronous, one driver, resident instances | — |
| **T0** One function type ✓ | One constructor, `reach` and a kind slot on the type, one qualifier fit; `async fn(A) -> R` is `fn(A) -> Future<R>` | A0 |
| **R1b** Live runs ✓ | Code-entry kinds; live runs that never commit, waiting in memory through the one-shot resume primitive | R1a |
| **DC** Deferred calls ✓ | The source rewriter; defaults in the callee; `g f(args)`; `defer` and `spawn` as functions | T0 |
| **K1a** Kind words ✓ | `live` and `ista` words; `Future<T, K>`; the start rule's one home; `awaitedOf`; the rewrite to `ista` | DC, R1b |
| **K1b** Kind calls ✓ | The stopped `k1b2` branch landed as an interim: calls between kinds in one seam, signatures over held parts, requirements' kinds, lowering per kind, kind-marked extern keys, the kind-marks rewrite | K1a |
| **F1** `Fn` types ✓ | Kind and `Send` as type slots; `Fn<Args, Result, Kind, Send>` with every spelling its sugar; `DataKind`, `Sendability`; head mark parameters; std higher-order functions take `M` and `S` (F28); `Deferred<M>`. No behaviour change | K1b |
| **R2** Resolvers ✓ | Registered one-shot resolvers of both kinds, `onCancel`, `select`'s losers cancelled | K1a |
| **K1c** Data rule | The three-valued data kind in one home, over every value; calls as its consequence, with bounded mark inference; requirements' marks; the rewrite | F1 |
| **K1d** Data-kind bounds | `DataKind` renamed `Mark`; a derived trait `DataKind<K in Mark>`; associated types' kinds from their bounds, type matches' from their cases (B72) | K1c |
| **DG** Delegate | Proposal 9's jobs: `await delegate f(args)`; host externs `live`; host-filled futures gone; sendable crossing | R2, K1c |
| **AW** Awaitables | `Awaitable`, `Resolver`, one await path, `futures` over the kind; `Self.Mode` as a requirement's mark | R2, K1d |
| **CX** Contexts | Proposal 9's minimal slice: a `Runtime` over the host's store and `rt.call(key) f(args)`, enough to run and test ista code; sendable crossing; hosts start only `live async fn main` | AW, DG |

**Order:** {A0 ∥ R1a} → {T0 ∥ R1b} → DC → K1a → {K1b ∥ R2} → F1 → K1c → {K1d ∥ DG} → AW → CX → merge review.
At most three run at once. *Why:* a phase starts only on landed code, and structure lands before
what builds on it. The `Fn` surface (F1) is structure the data rule (K1c) checks through; AW's associated-type bounds build on K1d's. DG's
result is a registered resolver, and its job is a `live` function. `Call<R>` is an awaitable.
**Interims:** until CX, a host still starts an `ista async fn main`; until DG, a host extern still
gives an `ista` future the host fills; until K1c, an unmarked function takes an implicit kind where it needs one (K1b). QV is folded into F1.

## Shared surfaces

| Surface | Owner | Extended by |
|---|---|---|
| Qualifiers grouped on the syntax tree; Rule 4's order, read by the formatter, signature help, type text and `typeKey` | A0 | T0, K1 |
| The async host and test-world contract (`boundary.md`); one driver | R1a | R1b, DG, CX |
| `FunctionType`'s constructor, its `reach` and kind, each able to hold a variable; one qualifier fit; the Definition's function types and keys without `async` | T0 | F1, K1c |
| Calls between kinds, judged in one seam; lowering per kind; the kind-marks pass | K1b | F1, K1c |
| `Fn<…>` and its sugar; kind and `Send` slots; `DataKind`, `Sendability`; head mark parameters | F1 | K1c, AW, DG, CX |
| Code-entry kinds (`simple`, `live`, `ista`); live runs; the one-shot resume primitive | R1b | K1b, K1c, R2, DG |
| Omitted arguments in the Definition; the source rewriter (`scripts/`) | DC | K1a, K1c, DG, CX |
| The entry rule's one home; `awaitedOf`; the kinds spelled once; literal type arguments in the Definition | K1a | F1, R2, K1c, DG, AW, CX |
| A value's data kind (one memoized home); the data rule; bounded mark inference | K1c | K1d, DG, AW, CX |
| `Mark`; the `DataKind<K>` trait; associated types' and type matches' kinds | K1d | AW, CX |
| Resolvers, registered, of both kinds | R2 | DG, AW, CX |
| The job inbox and its runner | DG | CX |

A contract amendment goes to the tech-lead.

## Diagnostic ranges

| Phase | Parser | Checker |
|---|---|---|
| A0 | 2044–2049 | — |
| DC | 2051–2059 | 5640–5649 |
| K1a, K1b, K1c, K1d | 2060–2069 | 5606–5629, 5650–5669 |
| F1 | 2070–2079 | 5690–5699 |
| AW | — | 5630–5639 |
| DG | — | 5670–5679 |

## Verification

| Phase | qa | reviewer | Notes |
|---|---|---|---|
| A0, R1a | no | yes | Done |
| T0, DC, K1a, K1b, F1, K1c, AW, CX | yes | yes | Profile |
| R1b, R2, DG | yes | yes | Store-write properties; `wake.bench.ts` |
| Merge | — | yes | `main` since A0's base |

**Out of scope:** the rest of proposal 9, a plan of its own later (tracker), and the native runtime.
The work ends with a working compiler and runtime.
