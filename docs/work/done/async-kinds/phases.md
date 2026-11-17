---
description: scope, acceptance and spec edits of each async-kinds phase (proposal 8, with `delegate` and the minimal slice of proposal 9 that enters contexts) — the text fork briefs quote verbatim; read before forking or examining a phase
owner: tech-lead
status: archived
applies_to: istalang
last_verified: 2026-11-10
last_updated: 2026-11-11
tags: [plan, proposal-8, async]
---

# Async kinds: phases

"Rule N" is proposal 8's. Each phase also edits the docs it touches (`architecture.md`,
`docs/reuse/`, `boundary.md`, `definition.md`) and its tracker rows. Its acceptance names every
fixture and corpus diagnostic it is expected to move; nothing else moves.

## A0 Function heads: done (`321bc5da`)

One modifier-set parser for every head, any order, each at most once (2044 repeated, 2045
conflicting, 2046 misplaced); syntax qualifiers grouped (`reach`, `kind`); one order every printer
reads. K1a regrouped `kind`.

## R1a Async host: done (`e4debfd6`, `b591f0fc`)

The host and test-world contract asynchronous, one driver (`host/drive.ts`), active instances
resident (`scheduler/resident.ts`). Concurrent host calls on one instance aren't serialized yet:
R1b's.

## T0 One function type: done (`ebd1a8d3`..`fd249976`)

One `FunctionType` constructor carrying `reach`; one qualifier fit; `async fn(A) -> R` is
`fn(A) -> Future<R>`; the Definition's function types and keys without `async`. F1 makes `reach`
`Fn`'s `Send` slot.

## R1b Live runs: done (`71f3a5f2`..`51cc0b0c`)

Code-entry kinds (`plain`, F1's `simple`; `live`; `ista`); live runs in memory, never committing,
their waits through the one-shot resume primitive; host calls on one instance serialized; `now()`
the clock in a live run.

## DC Defaults and deferred calls: done (`56e13911`..`8d28e871`)

The source rewriter (`scripts/rewrite`); defaults in the callee (B16); `g f(args)`; `defer` and
`spawn` prelude functions, `Instance<R>` carrying its encoder (B4).

## K1a Kind words: done (`6a451ee8`..`01c0aaaf`)

`live` and `ista` as contextual words; `Future<T, K in Persistence>`; the start rule's one home;
`awaitedOf`; the kinds spelled once; the `kinds` rewrite to `ista async fn` and `Future<T, "ista">`.
Interim: an unmarked `async` head gives `Future<T, "ista">`, which K1b ends.

## K1b Kind calls (interim): done (`c5a76717`)

One seam judging calls between kinds, written and implicit; signatures over every kind they hold;
requirements' kinds; lowering per kind; kind-marked extern keys; the kind-marks pass.
Interim: an unmarked function takes an implicit kind where its signature needs one, which K1c ends;
its debt is B54, B56–B58, B60, B61.

## F1 `Fn` types: done (`b8997ecd`)

`Fn<Args, Result, Kind, Send>` with every spelling its sugar; `DataKind`, `Sendability`; mark and send as
type slots; head mark parameters; std higher-order functions over `M`; `Deferred<M>`. Order bounds and
least-mark settling (B62), mark parameters by entity (B63): K1c.

## R2 Resolvers: done (`c2f00558`)

One resolver per wait, registered on what it waits on; futures resolving together decide at the
first case; a select's losers released as it is decided; live host externs take `call.resolver()`;
disposal notices at once in live runs, after commit in instances. Host-visible ista notices: DG, AW.

## K1c The data rule: done (`edc49ee5`..`410f49a2`)

Marks from heads alone; the data rule over every value a body handles; mixed-kind types refused;
lambdas infer their mark; Rule 4 witness marks; least-mark settling; the corpus marked through the
rewriter. A kind hidden in an `any` value stays sound (spec §3.3). B72 goes to K1d; its profile
cost (B71) is K1d's first fix.

## K1d Data-kind bounds: done (`c79f4e49`..`28f683e2`)

`DataKind` renamed `Mark`; the derived trait `DataKind<K in Mark>`; an associated type's kind its
bounds', unbounded `DataKind<"simple">`; a type match's its cases' (B72). K1c's profile cost cut,
its residual left as B71.

## DG Delegate: done (`2b4a62ec`, `a2954bc9`, `fd8be1c4`)

DG1: top-level `ista const`, one value per context. DG2: `runtime.delegate` in Istalang over an
`ista const` inbox, jobs run as live code by each runtime's loop, run again until their result
commits, withdrawn when their future is released; natives only for the runtime's instance keys and
its own calls. DG3: a host's externs unmarked or live (5913); host fills gone; the `host-futures`
rewrite; tests mock the program's own ista seam. Debt F30, P47, P48, B80.

## AW Awaitables: done (`6544d98b`, `bba96c1e`, `3342bb51`)

AW1: member-bounded associated types, `Self.Mode fn`, `Future`'s `type Mode = K`. AW2: `Awaitable`
and `Resolver`; `await` and `select` as an implicit `onAwait` on an explicit wait register. AW3:
`Resolver.of` and `onCancel` as runs of their own; `Resolver.at` tagging positions in the same step,
a resolver registered on several futures, so `futures` is plain Istalang and keeps §8's guarantees;
composing through callbacks decides later, as documented. Design: `aw-design.md`.

## CX Contexts: done (`741dee51`)

`Runtime.open(runtime.hostStore())`, `rt.call(key) f(args)` giving a live `Call<R>`, and
`runtime.run(key) f()`; contexts as store instances by key, driven inside the live run's loop;
opening a runtime resumes the store, so `--resume` goes; hosts start only live code; every
`ista async fn main` rewritten to a live `main` calling `_main` in a context. Test-suite cost +13%,
from every program now importing `runtime`.

