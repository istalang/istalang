---
description: plan for implementing proposal 8 (persistent and ephemeral async), with the slice of proposal 9 that enters persistent work — process, thirteen phases with order, shared surfaces and owners, diagnostic ranges and verification; read before forking or examining an async-kinds phase
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-09
last_updated: 2026-11-09
tags: [plan, proposal-8, async]
---

# Async kinds: plan

Spec: `docs/proposals/8-persistent-and-ephemeral-async.md` (F28 folded in). Code today:
`findings.md`. Scope and acceptance per phase: `phases.md`.

## Process

**Thirteen phases, each an implementer fork in its own worktree, with a pi reviewer and a qa on
every behavioural phase; a merge review at the end.** *Why:* it crosses every layer, reshapes the
most depended-on type (functions) and the runtime's commit, and soundness rests on it. Each
structural change the later phases build on lands first, on its own.

- **Examiners:** the plan reviewer stays as the root pi reviewer; the first behavioural phase
  spawns the root qa (`hcom pi --agent qa`). Every phase forks them.
- **Merging:** a fork fast-forwards `main` once its reviewer approves, and reports once the human
  approves.
- **Rewrites** of sources go through one committed rewriter (DC's), re-run after every rebase.
- **Profiles:** checker phases run `npm run profile:check`, runtime phases `wake.bench.ts`
  (within 10% unless stated), against their base.

## Phases

| Phase | Scope | After |
|---|---|---|
| **A0** Function heads | One modifier-set parser; qualifiers grouped; one order every printer reads | — |
| **R1a** Async host | The host and test-world contract asynchronous, one driver, resident instances; every `await` still commits | — |
| **T0** One function type | One constructor, `reach` on the type, one qualifier fit; `async fn(A) -> R` is `fn(A) -> Future<R>` | A0 |
| **R1b** In-memory waits | Wait modes and code-entry kinds, the resume primitive, commits and re-run state per execution | R1a |
| **DC** Deferred calls | `callsMadeBy`, the source rewriter; defaults in the callee; `g f(args)`; `defer` and `spawn` as functions | T0 |
| **P** Persistable, check 1 | The flow engine's hooks, release points; `reachOf`, inferred requirements, `ephemeral fn`, captures, liveness | T0 |
| **K1** Two kinds | One entry rule, `awaitedOf`; `ista fn`, `Future<T, K>`, the rewrite; ephemeral `async fn`, the summary unit | DC, P, R1b |
| **R2** Resolvers | Registered one-shot resolvers replacing host tokens, `onCancel` | K1 |
| **E1** Effects, check 2 | `readonly`; summaries; the segment flow pass; the soundness property | K1 |
| **AW** Awaitables | `Awaitable`, `Resolver`, one await path, `futures` over the kind | R2 |
| **E2** `readonly` in traits | Declared requirements, and P's inferred ones extended | E1 |
| **CX** Contexts | Proposal 9's `runtime.at`, `ctx.call` and invocation identity; hosts start only `async fn`s | AW |
| **QV** Qualifier variables | Higher-order functions keep their arguments' qualifiers (F28) | E2 |

**Order:** {A0 ∥ R1a} → T0, R1b as each lands → {DC ∥ P} once T0 lands → K1 → {R2 ∥ E1} → AW
→ CX, and E2 → QV → merge review. At most three run at once. *Why:* a phase starts only on landed
code, and structure lands before what builds on it: A0's qualifier shape before T0's, the async
host before in-memory waits, `callsMadeBy`, the rewriter and the flow engine before K1. P needs no
kinds (every `await` commits today), so it lands before K1, which needs its `Persistable`. R2
needs K1's kinds; `Call<R>` is an awaitable, so CX follows AW. Until CX lands, a host still
starts a persistent `ista fn main`: a bounded interim CX ends.

## Shared surfaces

| Surface | Owner | Extended by |
|---|---|---|
| Qualifiers grouped on the syntax tree (`reach`, `kind`, `readonly`); Rule 4's order, read by the formatter, signature help, type text and `typeKey` | A0 | T0, P, K1, E1 |
| The async host and test-world contract (`boundary.md`); one driver | R1a | R1b, R2, CX |
| `FunctionType`'s constructor, its `reach` (later `readonly`), each able to hold a variable; one qualifier fit; the Definition's function types and keys without `async` | T0 | P, E1, QV, K1 |
| `await`/`select` modes; code-entry kinds (T0 changes only their source); the one-shot resume primitive | R1b | K1, R2 |
| `callsMadeBy(f)`; omitted arguments in the Definition; the source rewriter (`scripts/`) | DC | K1, E1, CX |
| The flow engine's await, call and release hooks; release points; the committing-await predicate; `reachOf`; inferred requirements on type parameters | P | K1, E1, E2 |
| The entry rule's one home; `awaitedOf`; the kinds spelled once; the function-summary unit (on entries, per strongly connected component); literal type arguments in the Definition | K1 | E1, E2, QV, AW, CX |
| Resolvers, host ones by id | R2 | AW, CX |

`resolution/` and `types/` reach the summaries only through seams wired in `wiring/program/`,
never by importing `rules/`. A contract amendment goes to the tech-lead.

## Diagnostic ranges

| Phase | Parser | Checker |
|---|---|---|
| A0 | 2044–2049 | — |
| DC | 2051–2059 | 5640–5649 |
| P | — | 5509–5519, 5650–5659 |
| K1 | 2060–2069 | 5606–5629 |
| E1 | — | 5660–5679 |
| E2 | — | 5680–5689 |
| QV | — | 5690–5699 |
| AW | — | 5630–5639 |

## Verification

| Phase | qa | reviewer | Notes |
|---|---|---|---|
| A0 | no | yes | Only the modifier order changes; covered by the parser, formatter idempotence, signature-help and VS Code grammar tests |
| R1a | no | yes | Behaviour-neutral: the full suite on the async contract, and a resident run agreeing with one restored from the store at every step |
| T0, DC, P, K1, E1, E2, QV, AW, CX | yes | yes | Profile |
| R1b, R2 | yes | yes | Store-write properties; `wake.bench.ts` |
| Merge | — | yes | `main` since A0's base |

**Out of scope, filed:** the rest of proposal 9 (CX's list, the native runtime, where `spawn` lives
long-term); proposal 10's `delegate`.
