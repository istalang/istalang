---
description: plan for proposal 14 (inert function types and the derived `Inert` trait) — process, the one phase and its acceptance criteria; read before forking or examining it
owner: tech-lead
status: archived
applies_to: istalang
last_verified: 2026-11-14
last_updated: 2026-11-14
tags: [plan, inert, sendable, lifetimes, closures]
---

# Plan: inert functions

Spec: `docs/proposals/14-inert-functions.md`. What each change extends: `design.md` (same folder).

## Process

One phase, one implementer fork, two commits: a behavior-preserving refactor, then the feature. The
change is small, and its one shared surface, the `send` qualifier, is too thin to split on. QA and a
cold reviewer run concurrently. QA's runs are under the lifetimes oracle, since an unsound `Inert`
is a leak, not a wrong message. The reviewer sees the whole diff, so there's no separate merge
review.

## I1: inert functions

**Commit 1, refactor (no behavior change).** Sendable and reaching a disposable become one
predicate, the per-part sendability level in `design.md`. `isDisposable` moves beneath
`types/traits`, so that predicate can read it.
- Every existing test passes unchanged.
- `isSendable`, `capturedSend` and `relevanceOf` all derive from the one per-part level, and no
  second classification of parts remains.
- Cohesion improves, never the reverse:
  - The level and every predicate read off it share one `types/traits` module, named for what it
    now holds.
  - `isDisposable` joins the trait predicates there, carrying every symbol only it uses.
  - `rules/disposal` keeps only what runs disposal.
  - No module picks up a concern unrelated to its own, and no module is left behind as a
    pass-through.

**Commit 2, feature.** The proposal, whole: syntax, prelude, the `Inert` trait, the three-level
`Sendability`, inference, the written-`inert` check, type-reach, spec §2, §3.1, §3.8, §3.10, §3.14
and §7, and docs.
- The proposal's `wire` passes with no 5721. `Emitter` and `Model` meet `T is Inert`.
- The same graph is still rejected (5721/5722) once `Model` holds a `Future`, or once a listener
  captures a plain function or a shared struct declaring `dispose`.
- A closure that captures a `Future`, a plain function or an unconstrained `T`, passed where an
  `inert fn` is expected, gets one error per capture, naming it. Converting it into `any Inert` is
  refused.
- Fitting: sendable fits inert, and inert fits plain; plain doesn't fit inert, and inert doesn't
  fit sendable.
- Inferred `Send`:
  - only sendable captures give `sendable`, and a named function value is `sendable`;
  - captured handles, or `let` cells of an inert type, give `inert`;
  - a captured `Future` gives `plain`;
  - a deferred call gets the same result as its closure;
  - `S` passes through when every other capture is sendable, and is `plain` when the other
    captures are inert.
- `Inert`: `Sendable`, `Encodable` and `Decodable` imply it. `Shared<T>` is inert exactly when `T`
  is. A shared struct declaring `dispose` isn't inert, and neither is a type holding one. A
  `WeakRef` is inert. A recursive type is inert unless something in its cycle isn't.
- Syntax: `inert live async fn(A) -> R` round-trips through the formatter.
  - `sendable inert fn` and `inert sendable fn` parse with no diagnostic as `sendable`, and format
    to `sendable fn`.
  - `inert inert` reports a repeat. `inert` on a lambda or a declaration reports a misplaced
    modifier.
  - `inert` elsewhere is still an identifier. The VS Code grammar test passes.
- Hover and diagnostics print an inferred inert closure as `inert fn`.
- Programs that store inert closures in handles, with disposables nearby, keep the lifetimes
  oracle's invariant at every instruction.
- `npm run verify` passes.

## Out of scope

The computed library (F33), which builds on this. FormBuilder's rewrite.
