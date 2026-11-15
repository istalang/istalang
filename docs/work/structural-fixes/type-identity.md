---
description: workstream A contract of structural-fixes — one structural walk of a type, the table key derived from it, the extern key as a frozen projection, nothing deciding by a label. Read before changing type keys, type-table names or order, extern keys, or how the runtime matches variants
owner: tech-lead
status: active
applies_to: compiler/checker/types/identity, compiler/lowering/tables, definition, runtime
last_verified: 2026-11-15
last_updated: 2026-11-15
tags: [structural-fixes, type-identity, type-table, extern-key]
---

# Workstream A: type identity

## Meanings, one derivation each

| Meaning | What it is | Derived from |
| --- | --- | --- |
| identity (checker) | `typeKey`, with numbers | the structural walk, identities spelled as numbers |
| table key (lowering, persisted) | canonical, injective, program-independent, no numbers and no aliases | the same walk, identities spelled as qualified names; memoized per `typeKey` |
| extern key (ABI, persisted) | `KeyType`/`keyTypeText`, frozen bytes, lossy on purpose | its own projection, used only for extern and start keys and `declaredType` |
| label (diagnostics, editor) | readable, may use aliases, identifies nothing | `typeText` |

- There is one structural walk: `structureKeyOf`, parameterized by how an identity is spelled. Recursion goes
  through `canonicalKey` with the same walk, which also writes the unions. No other `Type`→key switch remains
  except the extern projection and `TypeTable.reference` (layout).
- The extern projection doesn't read `typeText`. Its bytes stay identical for everything it spells today.

## Rules

- A union's variant order and each variant's `name` come from the members' table keys. The variant name is
  therefore an identity, and Definition validation rejects two equal ones in one enum. An entry's `name` is
  spelled from its table key too, but nothing identifies an entry by it.
- No consumer decides by a label. The runtime matches variants by their identity field, and recognizes
  well-known types by role (`json-values.ts`).
- Definition validation rejects two functions with one extern key. definition.md states what identifies an
  entry and what is only a label.

## Phase

One phase, A (`a.md`). It was split in two once, but the split shared `type-table.ts` (the extern-role table)
and left the runtime half with no code of its own: `optionalOf` is right once names are injective. See
`research/plan-review.md` §QUALITY 1.

- Entry names come from the table key too (D1). No alias is in the Definition, and `recursive-aliases.ts` goes.
