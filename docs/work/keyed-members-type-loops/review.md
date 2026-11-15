---
description: joint review of proposals 12 (variadic tuples), 16 (keyed members) and 17 (field loops over a type) against each other, the spec and the code — consistency fixes, simplifications for the human (D1–D5), cohesion refactors and where each lands, with the code evidence; read before approving or implementing any phase of docs/work/keyed-members-type-loops/plan.md
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-15
last_updated: 2026-11-15
tags: [review, proposals, keys, tuples, packs, members, field-loops]
---

# Review: proposals 12, 16 and 17

All three extend proposal 4's keys: 12 to positions, 16 to member names, 17 to types with no value.
They agree in spirit. Below: what contradicts, what simplifies, and what to restructure first.
Paths are under `src/compiler/checker/` unless they start otherwise. Probes ran on `234223c6`.

## Consistency fixes (factual)

1. **17 ignores tuples.** Under 12, `keyof A` of a tuple is its positions. So 17's three forms visit
   positions in order, and a tuple comprehension `(for I in keyof A: e)` joins its forms.
2. **12 §1's mapping rule covers 17.** A comprehension over keys not all known, with nothing
   expected, is the mapping of those keys. That holds for `struct{for K in keyof S: …}` too.
3. **16 as first drafted** (key-named functions) had four more problems.
   - Its binder named a later parameter, against §3.5.
   - Its claim that `_` fields are private was false.
   - It contradicted itself on lookup order.
   - It named a struct `Seen<S>`, beside FormNode's `type Seen`.

   The rewrite on `index` (D2, `docs/proposals/16-keyed-members.md`) resolves them. It keeps String
   keys only and names the struct `GroupScope<S>`: inside a node's body, a bare `Scope` names its
   associated type.
4. **17's `S{for …}` is a feature it doesn't list.** A literal naming a type parameter is refused
   today (5012, `structs/literal-types.ts` `builtThrough`). `struct{for …}` expected as `S`
   already checks, so the example should use it, with no new rule.
5. **17's `S[K].make()` and `K` need a per-pass reading** (corrected by the plan review).
   - **What already works:** `staticTargetOf` (`resolution/choosing/candidates.ts`) takes a
     `field` type as constrained. `types/written/named-types.ts` `namedType`/`nameNodeOf` must
     accept an index expression as the owner; today `S` there reports 5011.
   - **What doesn't:** body type resolution is program-wide, memoized per `TypeNode`, and has no
     pass context. So `K` needs one `ParameterKey`, the loop header, as a value loop's others key
     has. Each pass's binding (a named pass's literal, the others parameter) is applied where the
     body resolves types and names.
   - **Flow building** (`rules/flow/build/`) is lowering's front end. A type loop reads no
     subject. A member parameter read as a value is its literal's constant, where a type name
     read as a value is a bare struct today.
6. **12's implementation notes are stale.**
    - `withPack` doesn't exist, and `relate.ts` has no pack case. The pack rule is
      `functionFits`/`sameShape` in `types/type/function-types.ts`, reached from
      `types/fitting/fit/parts.ts`.
    - Its order said "after variance-inference C3, C4", which are done. It now goes after
      structural-fixes B, C and D.
    - sf-D (`5f120a2b`) already made `sameShape` treat packs on either side alike (B68). 12's
      rests phase deletes that code; accepted.
7. **12 predates proposal 14.** "A product meets a derived trait both ways" should be stated for
    the derivation table (`resolution/conformance/derived-traits.ts`: Sendable, Inert, DataKind
    and the codecs), not for Sendable alone.
8. **12 §6 `enter` needs checking again** against proposal 8's kinds and static lifetimes as they
    landed: a suspended bracket holds its frame.

## Simplifications (the human decides)

**D1. A member parameter over literal types reads as its value.** Taken, generic (proposal 17).
- One rule in §3.5 replaces 16's and 17's "key binder". It is the fieldless-struct rule (§3.1,
  "its name alone being its value") applied to member parameters.
- The code already models all of these as member parameters (`{kind: 'parameter', within}`): a
  field loop's key, a rest pattern and a mapped type's parameter. `bareStructValue`
  (`constructs/expressions/access/names.ts`) already reads a type name as a value.
- In the spec, `Entry<S, K>` no longer needs its `key: K` field. 17's header is then just a member
  parameter declared by the loop.

**D2. Proposal 16 through the `index` operator, not key-named functions.** Taken: 16 is rewritten
on it (`docs/proposals/16-keyed-members.md`).
- **Rule** (a row in §3.9's operator table): `x.k`, where `x`'s type has no member `k`, is
  `x["k"]`. It applies through an `index` whose key is a member parameter of String literals, so
  `Map<String, V>` is unaffected.
- **One meaning per name** stays as decided: a member and such an `index` both serving `k` is an
  error at the use.
- **Methods:** `x.k(args)` calls the function the `index` returns, as `x.g(…)` does for a getter
  (§3.1).
- **FormBuilder:** `fn index<S is struct { [_] is FormNode }, K in keyof S>(self: GroupScope<S>, key: K) -> S[K].Scope: self._m[key].scope()`.
- **It already almost works.** Probed: `index(d, "country")` checks, and `d.index("countyr")`
  reports. The `[]` operator doesn't bind the member parameter, which is filed as B98 and fixed
  first.
- **Each key has its own result type,** `S[K].Scope`, since each key is its own instantiation.
  Probed with `Reads<S>`:
  - `index(d, "city")` is `String?`, and `index(d, "company")` is `Reads<Company>`;
  - a wrong expected type is reported;
  - `d.index("company").index("size")` is `Int?`.
  - The nested plain call `index(index(d, "company"), "size")` reports 5380. So `x.k` must choose
    as a method call does, the receiver given exactly. P16's acceptance includes `d.company.size`.
- **Removes from `supplier.gen.ista`** 51 forwarding getters and 13 scope structs. The engine gains
  one `index`, and FormNode gains `Scope`/`scope` per node kind.
  - Today the generator reads some groups whole (`card`, and `address` under `Hidden`) and scopes
    others (`company`, `deposit`). A Group's `Scope` makes every one of them scoped, so
    expressions using such a group as data need a look.
- **It removes most of 16's cost:**
  - no new head syntax, so the parser, formatter and VS Code grammar don't change;
  - no K-as-value need;
  - no nameless function. `FunctionDeclaration.name` has 100 reads in 55 non-test files across
    binder, checker, lowering, runtime traces and the editor, and a nameless function would touch
    all of them.
- **Prior art:** this is Swift's `@dynamicMemberLookup`. 16 rejected it for needing key paths and
  covering reads only. Here literal key types are the key paths, and a returned function covers
  methods.
- **What you lose:** `&self` members, per-call type arguments, and overloads by member name.
- **If you keep 16 as written:** add a structural first commit that reads a function's name
  through one unit, and define how a nameless declaration is spelled in Definitions, traces and
  the outline.

*D3–D5 concern proposal 12 and wait for its own plan.*

**D3. 12's named rests become their own phase.** Recommended (process only). Struct rests don't
depend on tuples. They touch binding and `calls/emit-call.ts` alone.

**D4. 12 §7 (refinement by patterns) is out of this plan.** Recommended. It gets its own plan after
§1–§6 are in use, filed when proposal 12 is planned. Nothing in 16 or 17 needs it.

**D5. One positional rest per function.** Optional; my lean is to take it.
- **It drops** the even split of several tuple rests (decisions 3–4, partly):
  - the count split in binding;
  - function types with several trailing spreads;
  - §7's k-runs.
- **It keeps** several packs and `where`. Calls then say where each group starts:
  `run((f, g), 1, "a")`, `pairs((1, "x"), (true, 2.0))`.

## Refactors: cohesion and DRY, and the phase that does each

| # | Today | Change | Phase |
|---|---|---|---|
| R1 | The key-as-member-parameter is built by hand four times: `constructs/loops/field-passes.ts` (others pass), `constructs/patterns/walk/kinds/struct-fields.ts` (rest), `types/written/key-types.ts` (mapped), `types/traits/known-constraints.ts` `mappedStructConstraint` | One constructor beside `keysOf` | P17, structural commit |
| R2 | A product's keys and fields are re-derived outside `types/traits/struct-keys.ts`: `wiring/body/facts/instantiation.ts` `knownFields`, `struct-comprehensions.ts` `givesKeysOf`, `resolution/calls/places.ts` `keyMembers`, `access/indexing.ts`, `known-constraints.ts` `keyedFieldTypes`, exhaustiveness `shapes.ts`, `type-match-patterns.ts`, `fitting/part-pairs.ts`. `struct-keys.ts` also holds body-context helpers (`keyOwnerOfValue`, `recordPatternKeys`) | Route them through `keysOf`/`fieldTypeOf`, so tuples are added in one file. Rename it `product-keys.ts`. Move the body-context helpers to their constructs | proposal 12's plan |
| R3 | Field passes are unrolled in two places: checker `instantiation.ts` (`knownFields`) and lowering `tables/instances.ts` (`passBindings`, `ownerSubstitution`) | One home, read by the other side. P17's key-only passes and tuple positions then change one place | P17, structural commit |
| R4 | `struct-comprehensions.ts` switches on `visits.kind` three times | Once | P17, structural commit |
| R5 | Pack rules are copied: "what a rest collects" 4 times (`signatures.ts`, `lambdas.ts`, `clashes.ts`, `parameters.ts`), two unrelated `packOf`s, a local `fillsPack` shadowing the real one, and `type.pack` walked in 7 files | Deleted. Rest kinds go in one phase; trailing spreads replace `FunctionType.pack` in another | proposal 12's plan |
| R6 | Member lookup answers three ways (`member-access.ts` `membersNamed`, `calls.ts` `callMethod`, `lookup/members.ts` `membersOf`) | structural-fixes C's unit. P16's fallback is added there only | sf-C, then P16 |

Optional, with proposal 12: `types/traits/sendability.ts` mixes sendability with lifetimes'
relevance. 12's constraint phase touches derived traits, so it could split them first.

## Code map for implementers

- **Field loops:**
  - `constructs/loops/field-passes.ts` (`checkedFieldPasses`, `inFieldPasses`), shared by
    `statements/loops.ts`, `collections/comprehensions.ts` and `structs/struct-comprehensions.ts`;
  - the pass model is in `contexts/passes.ts`;
  - flow is `rules/flow/build/loops.ts` `fieldLoop`;
  - lowering is `lowering/flow/layout.ts` (`FieldPassStep` in `lowering/tables/instances.ts`).
- **Keys:**
  - `types/traits/struct-keys.ts`;
  - written forms in `types/written/key-types.ts`;
  - the model in `types/type/computed-types.ts`;
  - reduction in `types/parts/computed-reduction.ts`.
- **Member parameters:** `types/type/index.ts` (`isMemberParameter`, `ParameterKey`).
  `memberUnionOf` is in `struct-keys.ts`.
- **Packs:**
  - `types/type/function-types.ts` (`isPack`, `fillsPack`, `RestSlot`, `functionFits`);
  - `resolution/choosing/{binding,packs,named-functions,applicability}.ts`;
  - `types/inference/{binding,fillings}.ts`;
  - `lowering/calls/{packs,emit-call}.ts`;
  - `lowering/functions/frame-variables.ts`;
  - diagnostics 5080–5087 in `diagnostics/generics.ts`;
  - std `mock`, `calls` and the 5 `setups` overloads in `src/stdlib/testing/testing.ista`;
  - `test/corpus/packs/`.
- **Statics:** `types/written/named-types.ts` (`staticOwnerOf`, `namedType`) and
  `resolution/choosing/candidates.ts` (`staticTargetOf`).
- **Derived traits:** `resolution/conformance/derived-traits.ts` and
  `types/traits/sendability.ts`.
