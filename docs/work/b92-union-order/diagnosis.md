---
description: B92 root cause — a union's variant order follows a recursive member's path-dependent spelling, so `none` gets the wrong variant; evidence and repro. Read before changing how the type table spells or orders types
owner: tech-lead
status: active
applies_to: compiler/lowering/tables
last_verified: 2026-11-15
last_updated: 2026-11-15
tags: [b92, type-table, recursive-types, unions]
---

# B92 diagnosis

## Mechanism

1. Every union gets one enum entry, keyed by type key (`TypeTable.#typeEntry`). Its layout is computed
   once, from the first union object that reaches it.
2. Variants are ordered by each member's spelled name (`TypeTable.unionMembers`, sorted by `spelledType`).
   `unionVariant(type, member)` runs that sort again on the union object it is handed.
3. `spelledType` spells a recursive type by its key's preferred alias (`preferredAlias`, memoized per key).
   When no recursive alias names it, as with a computed associated type (`Group<S>.Seen`), the fallback is
   `typeText` (`spelledKeyType` in `names.ts`). `typeText` prints the alias the type was *written through*:
   `SupplierCategoriesRow.Seen`, `Group<CategoryModel>.Seen` and `CategoryChildrenRow.Seen` are one type, one
   key, and three spellings.
4. So two union objects with one key sort differently: `None` sorts before `S…` but after `G…`/`C…`. The layout
   says `[None, X]`, the lookup `[X, None]`, and `none` comes out as variant 1. Depending on which spelling met
   the layout first, the result is an invalid Definition (`variant: type 314 takes 1 fields, not 0`) or a value
   where `none` was meant.

`definition.md` ("Recursive types") specifies this fallback ("else the alias the type was written through") and
also claims the name "never depends on which alias lowering meets first". Those two statements contradict each
other. `any` entries look variants up by `sameType`, so only their names depend on the path, not their
indexes. Union order is the one index that follows the path.

## Evidence

- Failing instruction: `supplier.gen.categoryModel`, `variant {type: 314, variant: 1, fields: []}`, where type
  314 is `prelude.Optional` with variants `[None, SupplierCategoriesRow.Seen(value)]`.
- Spelling the fallback from the type key (experiment on a scratch copy of `dist`) fixes both programs below.

## Repro

Fails on main with an invalid Definition. Once fixed it prints `"none none"`:

```ista
trait Node:
  type Seen
struct Field<T>:
  v: T? = none
  type Seen = T?
struct Many<R is Node>:
  rows: Array<R> = []
  type Seen = Array<R.Seen>
struct Group<S is struct { [_] is Node }>:
  fields: S
  type Seen = match S:
    case _: { [F in keyof S]: S[F].Seen }
struct M:
  name: Field<String>
  children: Many<Group<M>>
type Row = Group<M>
fn viaRow(x: Row.Seen?) -> String:
  match x:
    case None: "none"
    case _: "value"
fn viaGroup(x: Group<M>.Seen?) -> String:
  match x:
    case None: "none"
    case _: "value"
live async fn main() -> String:
  `${viaRow(none)} ${viaGroup(none)}`
```

Real case: on `computed-forms`, `categoryModel(graph, x: Group<CategoryModel>.Seen? = none)` passing
`fn(x): categoryModel(graph, x)` and `x?.children ?? []` to `List.make`, then `supplier.test.ista` fails. The
tracker's own repro passes on main: it uses a single spelling.
