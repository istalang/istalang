---
description: plan for implementing proposal 8 (persistent and ephemeral async), with the slice of proposal 9 that enters persistent work — process, twelve phases with order, shared surfaces and owners, diagnostic ranges and verification; read before forking or examining an async-kinds phase
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-09
last_updated: 2026-11-09
tags: [plan, proposal-8, async]
---

# Async kinds: plan

Spec: `docs/proposals/8-persistent-and-ephemeral-async.md` (F28 folded in). Code today: `findings.md`. Scope and
acceptance per phase: `phases.md`.

## Process

**Twelve phases, each an implementer fork in its own worktree, with a pi reviewer and a qa on every
behavioural phase; a merge review at the end.** *Why:* it crosses every layer, reshapes the most
depended-on type (functions) and the runtime's commit, and soundness rests on it. It splits at
seams (front end, function type, runtime), so three phases start at once.

- **Examiners:** the plan reviewer stays as the root pi reviewer; the first behavioural phase
  spawns the root qa (`hcom pi --agent qa`). Every phase forks them.
- **Merging:** a fork fast-forwards `main` once its reviewer approves, and reports once the human
  approves.
- **Rewrites** are scripts through the project's scanner and parser, kept out of the repository
  and re-run after every rebase.
- **Profiles:** checker phases run `npm run profile:check`, runtime phases `wake.bench.ts`,
  against their base.

## Phases

| Phase | Scope | After |
|---|---|---|
| **A0** Function heads | One modifier-set parser and head printer | — |
| **T0** One function type | One constructor, one qualifier fit; `async fn(A) -> R` is `fn(A) -> Future<R>` | — |
| **R1** In-memory waits | Waits and code entries with a kind, resident instances on an async host contract, commits and re-run state per execution | — |
| **DC** Deferred calls | Defaults in the callee; `g f(args)`; `defer` and `spawn` as functions | A0, T0 |
| **P** Persistable, check 1 | `reachOf`, `ephemeral fn`, captures against the expected type, shared release points, liveness | A0, T0 |
| **K1** Two kinds | `ista fn`, `Future<T, K>`, the rewrite; ephemeral `async fn`, the kind default, the summary unit | A0, T0, R1, P |
| **CX** Contexts | Proposal 9's `runtime.at` and `ctx.call`; hosts start only `async fn`s | K1, DC |
| **E1** Effects, check 2 | `readonly`; summaries; the segment flow pass | K1 |
| **R2** Resolvers | Registered one-shot resolvers, `onCancel`, host resolvers | CX |
| **E2** `readonly` in traits | Declared and inferred requirements | E1 |
| **QV** Qualifier variables | Higher-order functions keep their arguments' qualifiers (F28) | E2 |
| **AW** Awaitables | `Awaitable`, `Resolver`, `futures` over the kind | R2 |

**Order:** {A0 ∥ T0 ∥ R1} → DC and P once A0 and T0 land → K1 → {CX ∥ E1} → R2 once CX lands, E2
once E1 lands → QV, AW once R2 lands → merge review. At most three run at once; the two chains
after K1 take the first free slots.
*Why:* a phase starts only on landed code. R1 is the largest unknown, so it starts first. DC's
`spawn` takes T0's one async type, for async and plain callees alike. P needs
no kinds (every `await` commits today), so it lands before K1, which needs its `Persistable`. K1
builds the summary unit E1 extends. Until CX lands, a host still starts a persistent `ista fn
main`: CX ends that interim, and R2 shares its runtime and host files. QV generalizes every qualifier, `readonly` included, and
E2's inferred requirements are the same polymorphism over traits. AW needs R2's resolvers.

## Shared surfaces

| Surface | Owner | Extended by |
|---|---|---|
| Modifier lists and head printer (`syntax/`) | A0 | P (`ephemeral fn`), K1 (`ista`), E1 (`readonly`) |
| `FunctionType` constructor and qualifier table (`types/type/`, `types/fitting/`) | T0 | P, E1, QV |
| The Definition's function types and extern keys without `async` | T0 | K1 |
| `await`/`select` modes and code-entry kinds in the Definition; the async host and test-world contract (`boundary.md`) | R1 | K1, R2 |
| Omitted arguments in the Definition | DC | — |
| `reachOf` (`types/traits/`); release points shared by checker and lowering | P | K1, E1 |
| Contexts and the host's `async`-only start | CX | R2, AW |
| Function-summary unit (`rules/`) | K1 | E1, E2, QV |
| Literal type arguments in the Definition | K1 | AW |

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
| T0, DC, P, K1, CX, E1, E2, QV, AW | yes | yes | Profile |
| R1, R2 | yes | yes | Soundness and store-write properties; `wake.bench.ts` |
| Merge | — | yes | `main` since A0's base |

**Out of scope, filed:** the rest of proposal 9 (CX's list, the native runtime, where `spawn` lives
long-term); proposal 10's `delegate`.
