---
description: proposal 14's implementation map — which existing unit each rule extends, and the one predicate that unifies Sendable, Inert and lifetimes' relevance; read before implementing or reviewing inert functions
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-14
last_updated: 2026-11-14
tags: [inert, sendable, lifetimes, reuse]
---

# Inert functions: what each rule extends

Nothing new is built beside an existing unit. Every row extends the unit `docs/reuse` names for it.

## The one predicate

Today, three units classify a type's parts: `keepsInInstance` (`types/traits/sendability.ts`),
`ownRelevance` and `heldOfFunction` (`rules/lifetimes/type-reach.ts`), and `isDisposable`
(`rules/disposal`). `isDisposable` sits above `types/traits` in the layers, which is why the split
exists.

- Move `isDisposable` into `types/traits`. It reads only `checker.disposalOf` and known
  constraints.
- One per-part level, a `Sendability` member or a variable, over `heldTypes`:
  - a function: its `send`;
  - a disposable: `plain`;
  - another confined handle: `inert`;
  - a type parameter or an `any`: whatever its constraints imply;
  - anything else: `sendable`.
- A type's level is `sendabilityOrder.join` of its parts' levels:
  - `isSendable` is level = `sendable`;
  - `isInert` is level ≤ `inert`;
  - `capturedSend` is the join over the captures, with a captured changeable `let` counting at
    least `inert`. That replaces `lambdas.ts`'s `shared ? plainSend`.
- `relevanceOf`: `no` exactly when the type is inert. Otherwise it is `depends` when only type
  variables or computed types make it not inert, and `yes` when anything else does. The function
  type's seam in `topHandlesOf` reads `isInert` too.

`sendabilityOrder`'s `below` and `join` already order three members correctly; only its banner
changes. A variable joined with `inert` gives `plain`, the conservative case the proposal states.

## Extended in place

| Rule | Unit |
| --- | --- |
| `inert` word, its group, both written keeping `sendable` | `syntax/tokens/index.ts` contextual words; `modifierGroups.send` (`syntax/tokens/modifiers.ts`, which parser, completion and printers read); `readModifier` (`parser/grammar/parts/heads.ts`): the stronger of two ordered words is kept, with no report |
| The formatter dropping `inert` | nothing: it prints the tree's `Modifiers` |
| `Sendability` gains `"inert"` | prelude's `Sendability`; `sendabilities` (`foundation/language/well-known`) |
| Head to `Send`, and `Send` to printed modifiers | `sendOf`, `modifiersOf` (`types/type/function-types.ts`): the word *is* the literal |
| Fitting and inference | unchanged: `sendFits` and `sendabilityOrder` |
| Widening an inert function to plain | `sendableWidened` (`types/unions/widening.ts`), renamed for what it now does |
| The `Inert` trait | `trait Inert` in the prelude beside `Sendable`; `wellKnown.inert`; one entry in `derivationOf`'s table; `constraintsImply` and an `impliesInert` beside `impliesSendable`, implied by the sendable traits |
| The written-`inert` check | `explainedCaptures` (`resolution/calls/captured-sends.ts`), generalized from "expected sendable" to "expected level", reporting captures above it; its diagnostic is parameterized, not copied |
| `any Inert` conversion | conformance through the derivation; no code of its own |
| The VS Code grammar | the modifier regex in `ista.tmLanguage.json` |

## Docs the phase updates

- `docs/spec.md`: §2, §3.1, §3.8, §3.10, §3.14 and §7.
- The static-lifetimes design, §5.1 and §5.6, and `findings.md`'s accepted over-rejections where
  inert closures lift them.
- `docs/arch/architecture.md`: its traits folder line, refinements, and where `isDisposable` lives.
- The `docs/reuse` lines for `isSendable`, `capturedSend`, `isDisposable`, `explainedCaptures`, the
  `send` helpers and widening.
- Tracker F33.
