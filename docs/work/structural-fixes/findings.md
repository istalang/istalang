---
description: evidence behind the structural-fixes plan — tracker items clustered by shared root cause (several derivations of one concept, duplicated rules, scattered knowledge), churn hotspots, stale and duplicate tracker rows. Read before planning or examining a structural-fixes phase
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-15
last_updated: 2026-11-15
tags: [structural-fixes, tracker, churn, cohesion, dry]
---

# Findings (2026-11-15)

Four read-only scouts: B triage, F/P/Q triage, a type-spelling map, scc plus churn. Repros live in the session
scratchpad. Each finding below states its mechanism; "unverified" marks the ones nobody checked.

## Churn (3 weeks, 1006 src commits, 297 `fix(`)

- 150 of the 297 fixes are scoped `checker` and touch 17 folders. 157 files have 3+ fixes.
- Fix commits co-change checker↔lowering most (28), then checker↔syntax (15) and checker↔language-service (13).
- Recurring fix clusters: recursive/associated type matches; literal construction (collections/tuples/structs,
  `rules/agreement.ts`, 12 fixes); lifetimes analysis; the flow builder; call resolution and inference
  (`named-functions.ts` 10, `key-denotations.ts` 8); the runtime scheduler (`segment/index.ts` 11).
- Cross-feature fix pairs: `named-functions.ts`↔completion `placeholder.ts` (3); checker `assignments.ts`↔lowering
  `variables.ts` (3); checker↔lowering `calls.ts` (2); `key-denotations.ts`↔`semantic-tokens/name-types.ts` (2).
  Data: scratchpad `churn/files.csv`.

## A. One type, several structural walks (B94's class)

The checker's identity is `typeKey` (`type-keys.ts` `structureKeyOf`), and it carries identity numbers. Lowering
can't persist numbers, so it re-walks every type in `names.ts` (`ownKeyType`/`structureKeyType`) into the extern
ABI's `KeyType` (`extern-key.ts` `keyTypeText`). That `KeyType` is lossy by design. Entries are keyed by
`typeKey` but named and ordered by that spelling, and the runtime then decides by the names.

- **B94**: `&`, sendability and pack are dropped. `live` is kept; the row's `live` claim is wrong.
- **New, verified**: `keyTypeText` doesn't parenthesize function members of a union, so
  `Box<(fn()->Int)|(fn()->String)>` and `Box<fn()->Int|(fn()->String)>` spell alike.
- **New, verified, wrong value at runtime**: `declared-values.ts` `optionalOf`→`variantShape` moves a union value
  into a `T?` entry by variant name, first match wins. In `Array<BU|BF>`, `xs.at(1)` reads back as `BU`. Every
  `resultOptional` native goes this way (`at`, `pop`, `Map.get`, regex, strings).
- **New**: no Definition validation rejects duplicate variant names in one enum, or duplicate extern keys.
  `keyOf` uses the same lossy `KeyType`, so std natives that differ only by `&`/send inside a function parameter
  would share a key, while the checker's clash rule (by `typeKey`) calls them distinct.
- **New**: the runtime recognizes `prelude.Array`/`prelude.Map` by name (`json-values.ts` `memberHolding`), which
  contradicts definition.md ("by role"). definition.md also claims entries are identified by name plus arguments,
  but `TypeReference` drops function attributes.
- **New**: display text leaks into persisted keys. `ownKeyType` spells a literal by `typeText`, and
  `externSpelling` falls back to `typeText(recursive)`.
- **B65**: `preferredAlias` ranks every recursive alias in the program, so a Definition depends on modules its
  entry never imports.
- **P35**: `spelledType` is unmemoized (6.7% of a cold compile).
- Related: P32/P33 (hash-consing types), F18 (unions keep no written groups, display only), Q46 (type variables
  are cloned parameters told apart by a WeakMap).
- The walks: `structureKeyOf`, `spelledKindKey`, `ownKeyType`+`structureKeyType`+`unionKey`, `keyTypeText`,
  `TypeTable.reference`, `typeText`. `canonicalKey` already takes `(leafKey, spell)`, but it writes unions itself
  as `|<…>`.

## B. What an instantiation demands, enumerated per analysis

Lowering closes instances over layouts (default-typed fields included), type-entry calls (`disposalOf`,
`#outcomeEncoder`) and body calls plus witnesses. The checker rebuilds subsets of that in three places:
- `rules/expansion/types.ts` takes edges from written field types only.
- `rules/expansion/functions.ts` takes body calls only.
- lifetimes' `#calleesOf` adds witnesses, but `analysis/operations.ts` reads a witness-less requirement call as
  unknown.

Every gap is a clean check followed by a stack overflow in lowering.
- **B1**: requirement-call witnesses.
- **B52**: type-entry calls.
- **B87**: lifetimes of requirement calls.
- **B18, B81**: default-typed fields; both reproduce as `RangeError`.
- **B70**: a default lambda reading its own struct gets 5112, though its written signature types the field.

## C. Two answers to "what does x.name mean"

`member-access.ts` `membersNamed` feeds 5504, and `lookup/members.ts` `membersOf` feeds completion. They filter
differently: `takesAsSelf` is applied to methods in one and not the other.
- **B22**, verified: `x.filter` on an Int gives 5504, while `x.filter(f)` gives 5001.
- **B51**: no expression type is recorded for a method call's value. Unverified whether it is still live.
- **B64** may belong here.

The editor re-derives checker facts: completion's `matched-type.ts` (402 lines) restates the pattern walk, and the
placeholder parse plus `checkedTwinOf` remaps nodes (**Q40**, **P14 = P42**).

## D. Expected-type standing decided per syntax kind

`wiring/body/scope-protocol.ts` gives `Call` the `opens` standing but `MemberAccess`/`Binary`/`Unary`/`Index` the
`boundary` one, though those resolve to getter and operator calls.
- **B88**, verified: `id(b.empty)` gives 5100, while `id(empty(b))` checks.
- **B68**, verified: 5380.
- **B69**: now fails with 5001.
- **B91**: a variant's `R`, used only under an associated type in a parameter position, is never bound. Its
  message is ambiguous because `typeText` prints parameters by their bare name.

## E. One judgment, two paths; conventions nothing enforces

- **Q6**: constraint witnesses are re-derived silently in `literal-fields/items.ts`.
- **Q49**: losers are released twice in `suspension.ts`.
- **Q47**: unverified.
- **Q31/P25/B30**: entry tables take a context their key doesn't derive. `root-goals.ts` ignores the key.
- **Q30**: two `moduleOf`s.
- **Q36**: annotations are bound per site, though `Invalid` handlers exist.
- **F31**: the 5505 clash is found only at uses.
- **Q48**: a rewrite pass regexes diagnostic prose.
- **B89**: a local `fn` gets no per-capture 5644, unlike a lambda.

## Stale or duplicate rows (verified by the scouts)

- Fixed: Q34 (`4bbf814e`), B15, B17 (`9aaf0196`), B29 (local functions take no type parameters), B36, B67,
  B73 (`f447fddf`), B75 (now 5409).
- Probably stale: B48 (now 5135; the seed was not re-run).
- Duplicates: B85 = B93, P14 = P42, P30 = P40, P26 ≈ P45, P10 ≈ P39.
- Stale path: Q30's path (it now lives in `program-inputs.ts`).
- Wrong: B94's `live` claim.

## Corrections from the plan review (`research/plan-review.md`)

- **B70/B18/B81** are not about lambda signatures or a missing enumerator. Two whole-declaration entry tables
  (`Layouts.#fields`, `Parameters.#types`) recurse into each other, and Tarjan marks the whole SCC (5112). Also
  `#fieldsOf` runs expansion re-entrantly. The fix is per-field type resolution.
- **B87** is not callee enumeration. Lifetimes' summaries don't represent a requirement call's result. It leaves
  this plan.
- **B1/B52**: expansion runs on generic declarations, lowering on concrete instances. One reach per generic
  declaration, not one enumerator shared with lowering.
- **B88, B68, B69, B91** are four local asymmetries: `scope-protocol.ts` standing, `sameShape` packs,
  `ReturnScope.#settled` fitting before solving, and `relate.ts` checking only `expected` for a computed type.
  The tech-lead spot-checked the last three in code.
- **C**: `member-access.ts` may not import `lookup/` (layers). The shared unit goes in `resolution/choosing/`.
  B22's codes are 5400 and 5214.
- **A**: A2's `optionalOf` is right once names are injective. Array/Map roles need `type-table.ts`, so A is one
  phase.
