---
description: verbatim scout report (2026-11-15) mapping every Type→text/key walk (typeKey, table spelling, extern KeyType, typeText, TypeReference), which attributes each keeps, which consumers decide on a spelling, and what is persisted — read before workstream A (type identity) or any change to type keys, type-table names or extern keys
owner: tech-lead
status: active
applies_to: compiler/checker/types/identity, compiler/lowering/tables, definition, runtime
last_verified: 2026-11-15
last_updated: 2026-11-15
tags: [structural-fixes, research, type-identity, b94]
---

# Type spellings and identity (scout report, verbatim)

Main at `11c7e1d0`, so B92's fix (`07f6bc5e`) is in. The probe programs are copied into `../a1.md` and `../a2.md`.

## B94 research: table spelling vs type keys (read-only, nothing edited)

**Bottom line:** the table spelling is two hand-written walks, `Type→KeyType` (names.ts) and `KeyType→text` (extern-key.ts). Together they repeat what `structureKeyOf` already decides. I found three ways it is non-injective over type keys, and two places that decide on it. One of them is a runtime path that B94 doesn't mention.

### 1. Attribute matrix (function-type and union attributes)

| Attribute | `typeKey` (type-keys.ts `structureKeyOf`/`functionKeyOf`) | table/extern spelling (names.ts `ownKeyType`/`structureKeyType` → extern-key.ts `keyTypeText`) | `typeText` (display) | Definition `TypeReference` (type-table.ts `reference`) |
|---|---|---|---|---|
| `&` param | yes (`${parameter.reference?'&':''}`) | **dropped** (`parameters.map(p => part(p.type))`) | yes (`slotText`) | dropped |
| send (plain/sendable/inert) | yes (`fn<mark,send>`) | **dropped** ("a key doesn't tell sendable apart") | yes (modifiers / `Fn<>`) | dropped |
| mark `live`/`ista` | yes | **kept** (`persistenceOf` = `['live','ista']`) | yes | dropped |
| mark `simple` vs a mark variable | yes | **both written as nothing** (`persistenceOf` → undefined) | yes (`Fn<…,M>`) | dropped |
| pack `...T` | yes | **dropped** | yes | dropped |
| union members | keys sorted | texts sorted, joined `' \| '`, **function members not parenthesized** | written order, function members in parens | entry id |
| `T \| None` | members | `prelude.Optional<T>` | `T?` | entry |
| nominal | entity identity number | module-qualified name | bare name (not injective) | entry id |
| type parameter | declaration identity + `within` + `meeting` | `parameterText` (name only) | name | unreachable |
| literal | `=value` (JSON for strings) | `typeText(literal)`, a display function inside a persisted key | same | its base |
| shape | fields in name order | same | same | entry |
| `any` | trait identities, sorted | qualified trait names, sorted | written order | entry |
| holds recursion | `canonicalKey` over `structureKeyOf` | preferred alias, else `canonicalKey` over `ownKeyType`, else by parts | alias, else label, else body with `…` | entry / alias entry |

Other spellings: `spelledKey` reuses `structureKeyOf` for most kinds and adds written-form detail, so it is finer than `typeKey` (used only for memo keys). `instanceName`, `conversionName` and the trait-object entry names all use `spelledType`, for traces only.

**Correction to B94:** `live` vs `simple` *is* spelled (`live fn(...)`), and the `live` probe passes. The pair spelled alike is `simple` vs a mark variable, which can't reach lowering.

### 2. Consumers that decide on a spelling

| Consumer | Decision | Injective? |
|---|---|---|
| `TypeTable.unionMembers` (type-table.ts:201) | sorts members by `spelledType` (ties keep written order); `unionVariant` takes the index from it; `#unionLayout` lays the entry out once per key | **No.** Verified: `&`, `sendable` and `inert` probes give `[false,true]`, `live` gives `[true,true]`. **New collision, not about `&`/send:** `Box<(fn()->Int)\|(fn()->String)>` and `Box<fn()->Int\|(fn()->String)>` both spell `…Box<fn() -> Int \| fn() -> String>` because `keyTypeText`'s union doesn't parenthesize function members (`typeText`'s `unionText` does). Verified `[false,true]`; a control with distinct spellings gives `[true,true]`. |
| Runtime `optionalOf` → `variantShape` (definition/values/declared-values.ts:157,125) | moves a union value into a `T?` entry by **variant name**, i.e. the member's `spelledType`; `findIndex` takes the first match | **No, verified:** in `Array<BU\|BF>` holding `[BU, BF]`, `xs.at(1)` reads back as BU (`["BU","BU"]`, control `["BU","BF"]`). It goes through `resultOptional`, used by `Array.at`, `pop`, `Map.get`, regex and strings natives. Duplicate variant names in one enum are not rejected anywhere in Definition validation. |
| `recordExternSignatures` (runtime/boundary/extern-signatures.ts) | `declaredType` (`spelledType` of the result), persisted in the store, compared by `!==` across deploys | Non-injective only over function types, and host-extern results must be Encodable, so injective in practice. |
| Extern keys `keyOf` → `externKey`; natives looked up by key (interpreter/function-table.ts:31) | binds an extern to its native | Not injective for function-typed params that differ in `&`, send, pack or mark variable. Host externs can't take functions (verified: error 5101, Encodable), so only std natives are exposed, and their `functionKey` builder is collision-prone by design. |
| `preferredAlias` args and `unnamedText` (names.ts) | labels only; entries are keyed by `typeKey` | Labels collide. `canonicalKey`'s partition refinement runs under the table's spell function, so terms that differ only in `&`/send merge into one class. Through `unionMembers`, a recursive member feeds the same B94 bug. |
| `anyIndex` / `anyVariant` | keyed by `typeKey` / `sameType`; names are display | Safe, but can produce duplicate variant names. |
| Instance, conversion and trait-object names | traces ("names may repeat", definition.md) | Safe. |

Ordering by `typeKey` instead isn't an option as-is: keys hold identity numbers, and "No number ever reaches lowering's output" (type-keys.ts banner).

### 3. Persisted vs internal

- **Persisted and stable:** extern and start keys (Definition `key`, natives and host tables, snapshot `pinned`, the store's `istalang-externs` record); `declaredType` (store record, compared across deploys). Any fix must leave the spelling of Encodable types byte-identical, or redeploys are refused with `externChanged`.
- **Persisted, but only through the Definition text and its content hash** (snapshots bind by hash): type entry names, union and any-enum variant names and order, function names. The runtime reads variant names (`variantOf`/`optionalOf`), and json-values.ts `memberHolding` matches `prelude.Array`/`prelude.Map` by type name. That contradicts definition.md's "the runtime recognizes no type by its name, only by its role".
- **Internal:** `typeKey`, `spelledKey`, pre-keys, `canonicalKey` output, `typeText` (diagnostics and editor). Two leaks of `typeText` into persisted keys break the extern-key.ts banner's rule ("a change of wording there must never reach it"): `ownKeyType` spells a literal by `typeText`, and `externSpelling`'s fallback `{kind:'literal', text: typeText(recursive)}` writes unqualified names and `…` into an extern key.
- **Doc claim that fails:** definition.md says "A type entry is identified by its … name and its arguments". But `TypeReference` drops `&`/send/mark, so `Box<fn(&Int)->Int>` and `Box<fn(Int)->Int>` are two entries with identical name and arguments.

### 4. Duplicated walks, DRY violations and double standards

1. **One structural walk written three times:** `structureKeyOf` (type-keys) against `ownKeyType` + `structureKeyType` + `unionKey` (names.ts) and `keyTypeText` (extern-key). Every attribute must be added to all three; B94 is what happens when it isn't.
2. **`canonicalKey` already takes `(leafKey, spell)` as parameters**, and both callers use it. But it writes union bodies itself as `|<a,b>`, so the table spelling of an unnamed cycle mixes `|<…>` with `keyTypeText`'s `a | b`: two union syntaxes in one string.
3. **Two text grammars for the same syntax:** `keyTypeText` vs `typeText`. They are kept apart on purpose, but they disagree on parenthesizing function members of a union, which is the cause of the new collision.
4. **Two shapes for one concept:** `unionName` and `recursiveName` return `EntryName {name, arguments}`, re-doing `tableSpelling.whole`'s alias step and `unionKey`'s Optional step. `aliasName` and `aliasKeyType` are parallel helpers.
5. **A fourth walk:** `TypeTable.reference` drops the same function attributes, which is behind the false doc claim in section 3.
6. **Two spelling policies:** `externSpelling` vs `tableSpelling`. This one is intentional and documented (extern keys follow the written alias).

### Probe notes

`case A` on a type parameter never matches; the control gives false. So B94's tracker example
`isFirst<…>(make(…))` returns `false` whatever the variant order, and it is not a valid repro. Use the alias
probes in `../a1.md` instead.

### Design options for an injective table spelling

- **Derive it from the key walker:** make `structureKeyOf` the only "own structure" speller, parameterized by how identity is written: numbers for keys, qualified names and alias spellings for tables. The spelling is then the key with names in place of numbers, injective by construction, which `unnamedText` already does for cycles. Keep `keyTypeText`/`KeyType` only for extern keys, frozen.
- **Smallest change:** split table spelling from extern spelling at `KeyType`. Give the table its own function node carrying `&`, send, mark and pack, and parenthesize function members of a union. This only changes spellings of non-Encodable types, so `declaredType` and keys stay stable.
- **Either way:** look up variants by index or `sameType`, not by name, in `optionalOf`. Or reject duplicate variant names when a Definition is validated, so a future collision fails loudly.
