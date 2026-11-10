---
description: plan for implementing proposal 8 (live and ista async), with `delegate` and the minimal slice of proposal 9 that lets live code run and test ista code — process, eleven phases with order, shared surfaces and owners, diagnostic ranges and verification; read before forking or examining an async-kinds phase
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-10
last_updated: 2026-11-10
tags: [plan, proposal-8, async]
---

# Async kinds: plan

Spec: `docs/proposals/8-persistent-and-ephemeral-async.md`. Code before it: `findings.md`. Scope and
acceptance per phase: `phases.md`.

## Process

**Eleven phases, each an implementer fork in its own worktree, with a pi reviewer and a qa on
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
| **T0** One function type | One constructor, `reach` and a kind slot on the type, one qualifier fit; `async fn(A) -> R` is `fn(A) -> Future<R>` | A0 |
| **R1b** Live runs | Code-entry kinds; live runs that never commit, waiting in memory through the one-shot resume primitive | R1a |
| **DC** Deferred calls | The source rewriter; defaults in the callee; `g f(args)`; `defer` and `spawn` as functions | T0 |
| **K1** Kinds | `live` and `ista`; `Future<T, K>`; an unmarked function takes its caller's kind; the call rule; the rewrite | DC, R1b |
| **R2** Resolvers | Registered one-shot resolvers of both kinds, `onCancel`, `select`'s losers cancelled | K1 |
| **QV** Reach variables | Higher-order functions keep their arguments' `sendable` (F28), on K1's variables | K1 |
| **DG** Delegate | Proposal 9's jobs: `await delegate f(args)`; host externs `live`; host-filled futures gone | R2 |
| **AW** Awaitables | `Awaitable`, `Resolver`, one await path, `futures` over the kind | R2 |
| **CX** Contexts | Proposal 9's minimal slice: a `Runtime` over the host's store and `rt.call(key) f(args)`, enough to run and test ista code; hosts start only live code | AW, DG |

**Order:** {A0 ∥ R1a} → {T0 ∥ R1b} → DC → K1 → {R2 ∥ QV} → {DG ∥ AW} → CX → merge review. At most
three run at once. *Why:* a phase starts only on landed code, and structure lands before what
builds on it. K1 needs live runs and the rewriter. DG's result is a registered resolver, and its
job is a `live` function. `Call<R>` is an awaitable. **Interims:** until CX, a host still starts an
`ista async fn main`; until DG, a host extern still gives an `ista` future the host fills.

## Shared surfaces

| Surface | Owner | Extended by |
|---|---|---|
| Qualifiers grouped on the syntax tree; Rule 4's order, read by the formatter, signature help, type text and `typeKey` | A0 | T0, K1 |
| The async host and test-world contract (`boundary.md`); one driver | R1a | R1b, DG, CX |
| `FunctionType`'s constructor, its `reach` and kind, each able to hold a variable; one qualifier fit; the Definition's function types and keys without `async` | T0 | K1, QV |
| Code-entry kinds (plain, `live`, `ista`); live runs; the one-shot resume primitive | R1b | K1, R2, DG |
| Omitted arguments in the Definition; the source rewriter (`scripts/`) | DC | K1, DG, CX |
| The entry rule's one home; `awaitedOf`; the kinds spelled once; kind variables; a type's reach, `live` included; literal type arguments in the Definition | K1 | QV, R2, DG, AW, CX |
| Resolvers, registered, of both kinds | R2 | DG, AW, CX |
| The job inbox and its runner | DG | CX |

A contract amendment goes to the tech-lead.

## Diagnostic ranges

| Phase | Parser | Checker |
|---|---|---|
| A0 | 2044–2049 | — |
| DC | 2051–2059 | 5640–5649 |
| K1 | 2060–2069 | 5606–5629, 5650–5669 |
| AW | — | 5630–5639 |
| DG | — | 5670–5679 |
| QV | — | 5690–5699 |

## Verification

| Phase | qa | reviewer | Notes |
|---|---|---|---|
| A0, R1a | no | yes | Done |
| T0, DC, K1, QV, AW, CX | yes | yes | Profile |
| R1b, R2, DG | yes | yes | Store-write properties; `wake.bench.ts` |
| Merge | — | yes | `main` since A0's base |

**Out of scope:** the rest of proposal 9, a plan of its own later (tracker), and the native runtime.
The work ends with a working compiler and runtime.
