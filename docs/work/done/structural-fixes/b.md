---
description: phase B of structural-fixes — a field's type resolved per field (no whole-declaration SCC poisoning layouts), and one source of what a generic declaration reaches (default-typed fields, requirement calls, type-entry calls) for type and function expansion; B18, B70, B81, B1, B52. Read to implement or examine phase B
owner: tech-lead
status: active
applies_to: compiler/checker/constructs/declarations, compiler/checker/rules/expansion, compiler/checker/surface
last_verified: 2026-11-15
last_updated: 2026-11-15
tags: [structural-fixes, phase, layout, expansion]
---

# B: per-field layout, and one reach for expansion

Branch `sf-b-layout-expansion`. Research: `research/plan-review.md` §QUALITY 2 and §CORRECTNESS 1 (the traced
mechanisms below come from there; verify each red-first). Also `research/tracker-b.md` clusters B/B′ and
`findings.md` §B. Decision D3: no spec change, so default-typed fields stay.

B87 is not part of this phase. Its cause is in lifetimes' summaries (see "Not here").

## Why: the traced mechanisms

**Layouts (B70, B18, B81).**
- `Layouts.#fields` (`constructs/declarations/layout/index.ts`, ~81-90) and `Parameters.#types`
  (`constructs/declarations/functions/parameters.ts`, ~106-124) are two whole-declaration `EntryTable`s that call
  each other: `#fields(A)` → `#types(fieldsFunctionOf(A))` → `#together(...)`.
- A default reading any field of `A` closes an SCC across both. The entry tables' Tarjan pass marks every
  member, fires `reportMember`, gives 5112 `defaultCycle`, and discards the inferred type. That happens even
  when the read field's type is written (B70: `f = fn(a: A) -> Int: a.x`).
- Re-entrancy: `#fieldsOf` (~line 211) runs `declaredFields` (which checks defaults) before `#ended`
  (`#expansion.endlessFieldsOf`). In B18, checking `A`'s default enters `endlessFieldsOf(B)` → edges of `A` while
  `A` is still on the stack. That reads `A`'s stand-in, so the `A→B` edge is missing.
- `rules/expansion/types.ts` takes edges from written field types only. A default-typed field adds none (B18,
  B81), so lowering overflows.

**Function reach (B1, B52).**
- `surface/resolved-call.ts` `functionCallsWithin` (~line 190) returns `[]` for a requirement call, dropping its
  witnesses. In `f<T is Loop>(t: T)` calling `t.step<(T,)>()`, the growing argument is on the requirement call,
  and the witness is only known at `f<S>`'s caller.
- `rules/expansion/functions.ts` `sitedEdges` sees body calls only, never the calls a type entry makes
  (`disposalOf`, an `Instance<T>`'s encoder; `lowering/tables/type-table.ts`).

**Generic, not concrete.** Expansion, data kinds and lifetimes run on generic declarations. Lowering
(`witness-closing.ts`, `closed-calls.ts`) closes concrete instances. Don't merge the two: the single source is
what a generic declaration reaches, and lowering stays concrete.

## Do

Commit the structural change first, then the behaviour.

1. Resolve a field's type per field: a written type needs no default checked, and a default-typed field is its
   own entry. Whole-struct layout and expansion read those, so a default that reads a field whose type is known
   closes no cycle. Run expansion after field types, never inside `#fieldsOf` re-entrantly.
2. Give each generic declaration one reach (a surface unit beside `resolved-call.ts`):
   - the types it makes, every field's type included, default-typed ones too;
   - the functions it calls, including requirement calls through their trait requirement, with conformance
     adding edges from the requirement's parameters to each chosen witness's;
   - the calls its type entries make.

   Type expansion, function expansion and data kinds all read it.
3. Reuse docs: `docs/reuse/structures-and-invariants.md` (entry tables), `docs/reuse/calls-and-resolution.md`,
   `docs/reuse/types-and-fitting.md`. Update architecture.md's layout and expansion sections and the banners.

## Acceptance

1. B70 checks: `A{}` builds and `f` works.
2. B18 and B81 report 5125 instead of overflowing, in both `check` and `run`.
3. B1 and B52, built from their tracker rows, report 5125 (or their spec'd diagnostic) instead of overflowing in
   lowering.
4. No existing diagnostic changes except these. The corpus (`examples/`, stdlib) passes.

## Not here

B87 stays in the tracker. Lifetimes treats `t.homeOf()` on a type parameter as `unknownCall`
(`analysis/operations.ts`, ~138), so the summary records nothing about what a requirement call returned, and
`applySummary` never connects the witness's result to the write. That is a separate change to how summaries
represent requirement results.

## Repros (verified on main at `11c7e1d0`)

B18 overflows (`RangeError`):

```ista
struct B<U>:
  a: A<(U,)>?
struct A<T>:
  b = B<T>{a: none}

live async fn main() -> Unit:
  const x = B<Int>{a: none}
```

B81 overflows:

```ista
struct Phantom<T>:
  n: Int
struct Wrap<T>:
  x = Phantom<Box<(T,)>>{n: 1}
struct Box<U>:
  item: U
  w: Wrap<U>

live async fn main() -> Unit:
  const b = Box<(Int,)>{item: (1,), w: Wrap<(Int,)>{}}
```

B70 gives 5112:

```ista
struct A:
  x: Int = 1
  f = fn(a: A) -> Int: a.x

live async fn main() -> Unit:
  const a = A{}
```

## Tracker rows (verbatim, 2026-11-15)

| Id | Item | Size | Depends on | Filed by |
| --- | --- | --- | --- | --- |
| B1 | A requirement with type parameters of its own is met by a function generic the same way (spec §3.10), but constraints on those type parameters carry no witnesses: an instance of the requirement's witness can't call what they require. Nothing in the spec or the prelude declares one. The expansion rule (rules/expansion.ts) has the same blind spot: a call to such a requirement is a requirement call, which adds no edge, so a witness whose own type parameter is given a type built from the caller's, and which calls back, is never reported as endless. | medium | none; check first what L3's requirement-call witnesses already cover | slice 3.1 2026-10-25 |
| B18 | A field typed by its default adds no edge to the type-expansion graph (types/expansion-edges.ts), so `struct A<T>: b = B<T>{…}` with `struct B<U>: a: Opt<A<(U,)>>` is not reported (5125) and walking a `B<int>` still overflows. Needs a field's inferred type without checking defaults inside layout construction, or a re-entrance-safe order. | medium | none; can be done now | pre-M6 debt, B12 review 2026-10-29 |
| B52 | A function a type entry calls isn't in the expansion graph (§3.5, `rules/expansion/functions.ts`): a generic `dispose<T>(self: Lease<T>)` that makes a `Lease<Array<T>>`, or a codec whose body reaches a generic spawning wrapper (`runtime.isolate`) with a bigger `T`, whose `Instance<T>` entry's encoder is that codec again (`lowering/tables/type-table.ts`), checks clean and overflows the stack in lowering. The checker counts an outcome's codec only where an extern giving the instance is called (`rules/boundary/outcome-codecs.ts`). Count, per body, the functions the type entries it makes call (`disposalOf`, an `Instance<T>`'s encoder), found against its constraints. | low | none; can be done now | async-kinds DC 2026-11-10 |
| B70 | A struct field whose default is a lambda reading the struct's own fields, `struct A { x: Int = 1, f = fn(a: A) -> Int: a.x }`, is refused as a default depending on itself (5112), though the lambda's written result fixes the field's type: checking the default to type the field reads the layout it completes. On main before K1c too. | small | — | async-kinds K1c 2026-11-10 |
| B81 | A field typed by its default makes no edge of the expansion graph (`rules/expansion/types.ts`), and the data rule refuses such a default only when its type holds a part whose kind the type arguments decide (5617), so a default naming a type parameter it holds no values of escapes both: `struct Wrap<T>: x = Phantom<Box<(T,)>>{n: 1}` beside `struct Box<U>: item: U, w: Wrap<U>` checks, and lowering overflows the stack making `Box<(Int,)>`, `Box<((Int,),)>`, … C2's `Tag<Box<(T,)>>` value and a field annotation whose struct's default does the same are two more spellings. Either such a field writes its type, or the graph takes its edges once the default is checked. | medium | none | static-lifetimes C2 QA 2026-11-12 |
