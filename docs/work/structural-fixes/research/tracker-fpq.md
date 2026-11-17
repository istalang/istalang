---
description: verbatim scout triage (2026-11-15) of the open Q, F and P tracker items by structural root cause — clusters with evidence, items sharing B94's cause, stale and duplicate rows. Read before workstreams A, C, E or tracker hygiene
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-15
last_updated: 2026-11-15
tags: [structural-fixes, research, tracker]
---

# Tracker Q/F/P items: structural triage (scout report, verbatim)

## Clusters

**A. Type identity has several projections, each from its own walk (the B94 class)**
Ids: B94, P35, P32, P33, F18; related: Q46, and B91 (not verified).
Mechanism: a checker `Type` object carries both identity and spelling. Identity is `typeKey`, but it is built from a process-global counter (`numbered`), so it is not deterministic across processes, and lowering cannot persist or sort by it. Lowering therefore re-derives a second, deterministic spelling with its own switch over `Type.kind` (`ownKeyType`). That spelling goes into the extern ABI's `KeyType`, which drops detail on purpose. Display text (`typeText`) is a third walk, and it leaks into the second one.
Evidence:
- Checker key: `type-keys.ts:structureKeyOf` / `functionKeyOf` key `&`, `mark`, `send` and `pack`. `spelledKindKey` in the same file is a 4th walk.
- Lowering spelling: `names.ts:ownKeyType` → `structureKeyType` builds `{persistence, parameters, result}`, dropping `&`, `send` and `pack`. `extern-key.ts:functionKey` documents the drop ("a key doesn't tell sendable apart").
- Display leaks into keys: `names.ts:ownKeyType` `case 'literal'` uses `typeText(type)`, and `externSpelling` falls back to `typeText(recursive)`. Both contradict the "apart on purpose" banners in `extern-key.ts` and `type-text.ts`.
- Things that rely on the non-injective spelling: `TypeTable.unionMembers` (variant order) and `#unionLayout` (variant names); the runtime `definition/values/declared-values.ts:variantOf(types, type, name)` looks a variant up by name, so the first match wins; `instances.ts:instanceName` / `conversionName`, the `trait-objects.ts` names, and `runtime/testing/world/test-host.ts`, which mocks by `entry.name`.
- Correction to the B94 row: `persistenceOf` keeps `live` and `ista`, so `live` is not dropped. What is dropped is `&`, `send` and `pack` (`pack` is probably moot after instantiation; not verified).
- Unfiled risk, not run: `keyOf` builds extern keys through the same `KeyType`. Two extern overloads that differ only by `&` or `sendable` inside a function-typed parameter would share one key. The checker's clash rule uses `typeKey`, so it sees them as distinct. `definition.md:124` claims "Overloads therefore get distinct keys", and nothing checks it.
- P35 is confirmed: `spelledType` has no memo (only `unnamedText` does). P32 says it outright: `unionOf` cannot be memoized by key because spelling would leak. F18 is the display side of the same thing: unions do not keep the groups their members were written in. Q46: a type variable is a node cloned with `{...parameter}` and told apart by the `standing` WeakMap (`inference/variables.ts:twinOf`).
Refactor: make `structureKeyOf` the only structural walk and give it a naming seam (identity number or qualified name). The qualified-name version becomes an injective, deterministic "table key": order union variants by it, memoize it per `typeKey` (closes P35), and make the extern key an explicit lossy projection of it. Longer term, hash-cons types at construction to close P32 and P33.

**B. The editor re-derives facts the checker already has**
Ids: Q40, P14 (same as P42); B22 and B51 sit in the B section. Q34 was another instance (now stale).
Mechanism: completion runs a second parse with a placeholder (`completion/placeholder.ts`), maps nodes across the two trees (`checkedTwinOf`), and restates checker rules.
Evidence: `completion/places/patterns/matched-type.ts` (402 lines) restates `checker/constructs/patterns/walk/`, and borrows only fragments from `types/written/pattern-types.ts`.
Refactor: the checked body records each node's facts (the type a pattern matched, a callee's type), and the editor reads only the checker's surface.

**C. One judgment, two paths**
Ids: Q47, Q6, Q49, F17; B36 and B88 in the B section.
Evidence:
- Q6: `types/written/type-arguments.ts:constrainArguments` defers through `constrainLater` and reports; `literal-fields/items.ts:270` calls `silent-choice.ts:callWithTypes` again, silently, for the witnesses.
- Q49: `interpreter/suspension.ts` releases losers in `releaseLosers` and again in `enterCase` → `releaseCase`.
- Q47: not verified.
- F17 and B36 are the same double standard: `const x: T = literal` builds the literal from `T`, while an argument literal takes its own type. Checked against the rows only, not the code.
Refactor: one path per judgment. The deferred constraint check hands back its witnesses, everything settles later, and losers are released once.

**D. Incremental correctness rests on unenforced conventions**
Ids: Q31, Q30, P25; B30 in the B section.
Evidence:
- `foundation/structures/entries/index.ts` `get(key, context)`: nothing derives the context from the key. `resolution/conformance/root-goals.ts` is a live case: `compute: (_key, asked) => this.#searched(asked)` ignores the key entirely.
- Q30: `wiring/program/program-inputs.ts:DeclaringModules.moduleOf` searches trees with `parentOf`, while `binder/entities.ts:259` `Bindings.moduleOf` answers by entity.
Refactor: entry tables take a structured key only, with the context derived from it. Keep one `moduleOf`, by entity.

**E. A per-site duty instead of one rule**
Ids: Q36, F31.
Evidence:
- Q36: `binder.annotations(...)` is called separately at `bind-module.ts:47`, `statements.ts:96`, `expressions.ts:193`, `types.ts:191` and `declarations.ts:236/263`. Meanwhile the handler tables already have an `Invalid: holdsNoNames` entry (`patterns.ts:34`, `types.ts:60`, `expressions.ts:82`).
- F31: 5505 is reported only where a use finds the clash (`member-access.ts:besideMethod`).
Refactor: the `Invalid` handler binds its annotations, and the per-site calls go. The field/getter/method clash moves to a check on the declaration.

**Prose used as a contract (Q48)**
The `Diagnostic` value (`foundation/diagnostics/diagnostic.ts`) has only `code`, `message` and `span`, with no structured payload. So `scripts/rewrite/passes/kind-marks` has to regex the message text (`asksForMark`), and any other tool reading a diagnostic would have to do the same.

**Duplicate rows in the tracker itself:** P14 = P42, P30 = P40, P26 ≈ P45, P10 ≈ P39; P22 includes P34's witness half.

## Shares a root cause with B94 / type-identity spelling
P35, P32, P33 and F18 directly. Q46 is the identity of type variables. The extern-key collision risk above is unfiled. B91 likely belongs here (same printed type, different keys; not verified). F16 is loosely related: a shape is identified by its structure, but rename works on declaration nodes.

## Stale
- **Q34:** fixed in `4bbf814e`. `literal-field.ts:219` now uses `expressionCandidates`, and `visibleCandidates` no longer exists anywhere in `src`.
- **Q30:** its path is stale (`checker/declaring-modules.ts` is gone; the logic is now in `program-inputs.ts`), but the item itself still holds.
- **Q44:** mostly done. `docs/work/done/cohesion/plan.md` is archived; its README "What remains" lists two moves and some wide files, and adding the scan to verify is still open.
- **P17:** `openAtEnd` is gone (the bracket code moved to `parser/cursor/brackets.ts`). Whether the pre-pass cost remains was not checked.
- **B94 row:** its `live` claim is wrong, as noted in cluster A.

## Not structural / local
Q9, Q33, Q45 (substituter closures duplicated inside one file), Q50, Q52, Q53, Q54, Q55; F1–F11, F2, F14, F15, F19, F20, F22, F24, F27, F29, F30; P1, P2, P6, P7, P9, P10, P11, P12, P13, P15, P16, P18–P22, P26–P31, P34, P36–P41, P43–P52.
