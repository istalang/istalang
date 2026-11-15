---
description: phase A of structural-fixes — one structural walk of a type; the table key derived from it orders and names union variants; extern keys a frozen projection; nothing decides by a label (validation, Array/Map by role); B94, B65, P35, union-parenthesis collision, runtime variant mix-up. Read to implement or examine phase A
owner: tech-lead
status: active
applies_to: compiler/checker/types/identity, compiler/lowering/tables, definition, runtime
last_verified: 2026-11-15
last_updated: 2026-11-15
tags: [structural-fixes, phase, type-identity, b94]
---

# A: type identity, one structural walk

Branch `sf-a-type-identity`. Contract: `type-identity.md`. Research: `research/type-spellings.md` (the full
attribute matrix, the consumers, what is persisted) and `research/plan-review.md` §QUALITY 1 and 5. Also
`findings.md` §A.

## Why

- The checker's identity is `typeKey` (`checker/types/identity/type-keys.ts`, `structureKeyOf`/`functionKeyOf`).
  It carries identity numbers, so lowering can't persist it.
- Lowering walks every type again (`lowering/tables/names.ts`: `ownKeyType`, `structureKeyType`, `unionKey`) into
  the extern ABI's `KeyType` (`definition/extern-key.ts`, `keyTypeText`), which is lossy on purpose.
- `TypeTable.unionMembers` (`lowering/tables/type-table.ts`) sorts union members by that spelling, to order the
  variants and to name them. Ties keep the written order, so two equal-key unions get opposite variant orders.
- The runtime then decides by those names: `declared-values.ts` `optionalOf` matches `variant.name`, first match
  wins. So a name collision returns the wrong member from `Array.at`, `pop`, `Map.get`, regex and strings.
  `optionalOf` is correct once names are injective; the bug is the names.
- Every attribute a type gains must be added to three walks. B92 and B94 are what happens when one is missed.

## Code map

- `type-keys.ts`: `structureKeyOf` (spells a type's own structure around its parts' keys), `functionKeyOf`,
  `spelledKindKey` (a 4th walk), and `numbered` (identity numbers, process-global).
- `recursive-terms.ts` `canonicalKey(type, leafKey, spell)` is already parameterized, but it writes unions itself
  as `|<…>`.
- `names.ts` (table and extern spellings): `spelledType`, `tableSpelling`, `externSpelling`, `ownKeyType`,
  `structureKeyType`, `unionKey`, `unionName`, `recursiveName`, `unnamedText`. A literal is spelled by `typeText`
  (a leak).
- `recursive-aliases.ts` (91 lines, from B92): `preferredAlias` ranks every recursive alias in the program,
  which is B65; also `reachesItselfUnnamed`. Once the table key exists, both are redundant (decision D1).
- `type-table.ts`: `unionMembers`, `unionVariant`, `#unionLayout`, `anyIndex`/`anyVariant` (by `sameType`, so
  only their names are affected), `reference` (`TypeReference`: layout, kept), and the extern-role table
  `satisfies Record<Exclude<ExternRole, 'shared'>, WellKnownDeclaration>` (lines ~114-118).
- `definition/tables/types.ts` `externRole` (~line 139). `runtime/.../json-values.ts` `memberHolding` matches
  `prelude.Array`/`prelude.Map` by name.
- `definition/validation/references.ts`: where to reject duplicate variant names and duplicate extern keys.
- `instances.ts` `instanceName`/`conversionName` and `synthesized/trait-objects.ts` names use `spelledType` for
  traces only.
- Persisted and frozen: extern and start keys (`keyOf` → `externKey`) and `declaredType`
  (`runtime/boundary/extern-signatures.ts`, compared across deploys).

## Do

Commit the structural change first, then the behaviour.

- Make `structureKeyOf` the only structural walk, parameterized by how an identity is spelled: numbers for
  `typeKey`, qualified names for the table key. Run `canonicalKey` with that same walk, so cycles and unions get
  one grammar.
- The table key is canonical, injective and program-independent: no numbers and no aliases. Memoize it per
  `typeKey` (P35). `unionMembers` sorts by it, and each variant's `name` is it.
- The Definition names nothing by an alias (D1): entry names come from the table key too. Delete
  `recursive-aliases.ts`, and rewrite `recursive-names.test.ts`'s alias expectations to the new names. B65 goes
  with it.
- The extern projection keeps its own walk, frozen, with its bytes unchanged, and is used only for extern and
  start keys and `declaredType`. It stops reading `typeText`: move the literal formatting into it,
  byte-identical.
- Add `array`/`map` extern roles. `type-table.ts` emits them, and `json-values.ts` recognizes the types by role.
- Definition validation rejects duplicate variant names in one enum, and duplicate extern keys.
- Update the banners of `type-keys.ts`, `names.ts` and `type-table.ts`; `docs/arch/definition.md` ("Recursive
  types", the union row, "Names", entry identity: name plus arguments is a label, so say so or make it true);
  the `docs/reuse/` lines for any unit added, moved or removed; and `architecture.md` where it names these
  units.
- Reuse docs: `docs/reuse/types-and-fitting.md`, `docs/reuse/lowering-and-ir.md`,
  `docs/reuse/runtime-and-persistence.md`, `docs/reuse/testing.md`.

## Acceptance

1. Property (fast-check): distinct `typeKey` ⇒ distinct table key. The generators cover `&` parameters,
   plain/sendable/inert, live/ista marks, packs where they reach lowering, unions of function types, recursion
   and literals.
2. The two `(true, true)` repros give `(true, true)`. The `Array<BU|BF>` repro gives `("BU", "BF")`. B92's
   cases in `recursive-names.test.ts` still order alike.
3. Extern keys and `declaredType` are byte-identical across the stdlib and `examples/`. Prove it with a test
   that compares the before and after key sets.
4. B65: a program compiled alone and the same program inside a bigger program give equal Definition texts.
5. Hand-built Definitions with duplicate variant names, or two functions with one extern key, are rejected by
   validation. No runtime code recognizes a type by its name.
6. `spelledType` is memoized per key.

Out of scope: hash-consing (P32/P33), F18's display, `TypeReference`'s layout.

## Repros (verified on main at `11c7e1d0`)

Both programs must return `(true, true)`. B94, `&`/sendability (here `inert`); swap `R` for
`fn(&Int) -> Int` or `sendable fn(Int) -> Int`:

```ista
type P = fn(Int) -> Int
type R = inert fn(Int) -> Int
fn a(f: P) -> P | R: f
fn b(x: R | P) -> Bool:
  match x:
    case P: true
    case _: false
fn c(x: P | R) -> Bool:
  match x:
    case P: true
    case _: false
live async fn main() -> (Bool, Bool):
  const f: P = fn(n: Int) -> Int: n
  return (b(a(f)), c(a(f)))
```

The union-parenthesis collision; the control uses `fn() -> Bool` in `F`:

```ista
struct Box<T>:
  v: T
type U = (fn() -> Int) | (fn() -> String)
type F = fn() -> Int | (fn() -> String)
type BU = Box<U>
type BF = Box<F>
fn a(x: BU) -> BU | BF: x
fn b(x: BF | BU) -> Bool:
  match x:
    case BU: true
    case _: false
fn c(x: BU | BF) -> Bool:
  match x:
    case BU: true
    case _: false
live async fn main() -> (Bool, Bool):
  const u: U = fn() -> Int: 1
  const x: BU = Box { v: u }
  return (b(a(x)), c(a(x)))
```

The B94 tracker example (`isFirst<…>(make(…))`) is not a valid repro, because `case A` on a type parameter never
matches.

The runtime mix-up gives `("BU","BU")` on main:


```ista
struct Box<T>:
  v: T
type U = (fn() -> Int) | (fn() -> String)
type F = fn() -> Int | (fn() -> String)
type BU = Box<U>
type BF = Box<F>
fn which(x: (BU | BF)?) -> String:
  match x:
    case None: "none"
    case BU: "BU"
    case _: "BF"
live async fn main() -> (String, String):
  const u: U = fn() -> Int: 1
  const f: F = fn() -> Int: 2
  const xs: Array<BU | BF> = [Box { v: u }, Box { v: f }]
  return (which(xs.at(0)), which(xs.at(1)))
```

The extern overload probe (not run): two `extern fn apply` that differ only in
`f: sendable fn(Int) -> Int` against `f: fn(Int) -> Int` share one extern key.

## Tracker rows (verbatim, 2026-11-15)

| Id | Item | Size | Depends on | Filed by |
| --- | --- | --- | --- | --- |
| B94 | Function types that differ only in `&` parameters, sendability (`inert`/`sendable`/plain) or the `live`/`simple` mark have different type keys but one table spelling: `structureKeyType` (`lowering/tables/names.ts`) builds an extern `KeyType` that drops `&`, `send` and `live`. `TypeTable.unionMembers` sorts by spelling, so ties keep the written order, and `(fn(&Int) -> Int) \| (fn(Int) -> Int)` and its reverse share one enum with opposite variant orders: `isFirst<fn(Int) -> Int, fn(&Int) -> Int>(make(fn(n: Int) -> Int: n))` gives `false`. Happens with or without recursion. Make the table spelling injective over type keys (or order by something that is). | medium | none | b92-union-order QA |
| B65 | `compileProgram` for each entry of one program holding all 188 corpus programs as roots gives Definition texts other than each program compiled alone gives (and ~330 ms each, against 10 ms): a Definition may depend on modules its entry never imports. | small | — | test-speed report 2026-11-10 |
| P35 | Lowering spells a whole type recursively for every instance frame and type-table entry (`lowering/tables/names.ts:spelledType` → `extern-key.ts:keyTypeText`), unmemoized: 6.7% of the form builder's cold compile. Fix: memoize `spelledType` per type key (`docs/work/perf/full-check-2026-11-06.md` #5). | small | none; can be done now | full-check profile 2026-11-06 |
| P32 | After canonical keys were kept by pre-key (`types/identity/type-keys.ts`, 38% → 4% of the form builder's cold compile), `unionOf` is still 16.7% of it: `normalizedMembers` keys every member of a rebuilt union (7.9%; shape keys of new objects, `shapeKeyOf` 3.8% self), then `folded` (5.3%). Memoizing `unionOf` by its members' keys would answer one spelling's union for another's, so it needs members' spelled keys, or types hash-consed at construction (one object per structure and spelling, every per-object memo hitting) (`docs/work/perf/full-check-2026-11-06.md` #1, #2). | medium | none; can be done now | P23 fix, full-check profile 2026-11-06 |
| P33 | `structures/memo.ts:memo` finds a value with one lookup now, but its own frame is still 9% of the form builder's cold compile: `holdsRecursion`'s lookups are 3.1% of it. Fix: compute it once at construction as a field of the type (`docs/work/perf/full-check-2026-11-06.md` #7). | small | none; can be done now | P23 fix 2026-11-06 |
