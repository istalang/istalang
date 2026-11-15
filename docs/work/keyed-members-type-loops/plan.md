---
description: plan for proposals 16 (keyed members, through `index`) and 17 (field loops over a type), with the field-loop refactors proposal 12 will build on — process, three phases with falsifiable acceptance, order, shared files and owners; approved 2026-11-15, plan review approved; P16 widened to FormBuilder's scopes by the human 2026-11-15; read before forking or examining a phase of this plan
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-15
last_updated: 2026-11-15
tags: [plan, proposals, keys, members, index, field-loops, forms]
---

# Plan: keyed members and field loops over a type (proposals 16, 17)

Findings, the code map and the refactors are in `review.md`. Proposal 12 is planned separately,
later. Its D3–D5 and refactors R2 and R5 go with it. This plan does R1, R3 and R4, which 17 needs
and 12 builds on.

## Process

Three phases and a merge review. Each phase is a fork of the tech-lead checkpoint in its own
worktree, examined by the pi reviewer and pi qa roots, forked per phase. A cold plan review runs
before the checkpoint.
*Why:* member lookup and field passes have high fan-in, so every phase gets a review and a QA run.
The two compiler phases run in parallel, each owning the functions listed under "Shared files". FormBuilder's engine and generator
change once, for both proposals.

**Prerequisite:** structural-fixes A–D have merged; they run in another session. This plan's
phases build on:
- C's member-meaning unit (P16);
- D's getter reads joining inference (P16's chains);
- B's one expansion reach, which `S[K].make` calls join (P17), as a value loop's `node.seen()`
  requirement calls do. Static lifetimes reads both alike; their witness reach is B87's, not this
  plan's.

## Phases

| Phase | Scope | Accept |
|---|---|---|
| **P16** Keyed members, compiler (`docs/proposals/16-keyed-members.md`) | B98 first, with a red test. Then the keyed read in the member-meaning unit, the one-meaning check over both kinds of member, and misses listing the keys. `x.k(args)` calls the read's value. Flow building passes the key as `index`'s second argument (`rules/flow/build/member-values.ts`). Editor: a keyed read denotes its `index` call, as a getter read denotes its getter. Spec §3.9, §3.1, §3.7. **FormBuilder's scoped reads** (the human's, 2026-11-15): `GroupScope<S>` and its keyed `index`, FormNode's `type Scope` and `fn scope`; the generator stops emitting scope structs and forwarding getters | The proposal's Acceptance items 1–8 and 10, on corpus programs, run end to end; `lookup.sweep.test.ts` and `hover.sweep.test.ts` pass. Item 9 for scopes: no scope struct or forwarding getter is left in the `.gen.ista` files; `contact.card.phone` and `data.company.address?.city` check as scoped reads |
| **P17** Field loops over a type, compiler (`docs/proposals/17-type-field-loops.md`) | **Structural first:** R1, R3, R4 (`review.md`). **Then:**<br>- the three forms over `keyof T`;<br>- **one representation for `K`:** the loop header is its one `ParameterKey`, as for a value loop's others-pass key. The pass's binding (header → the field's literal in a named pass, the others parameter in the others pass) is held in the body context and applied by the body's type resolution and name typing, so `S[K]`, `S[K].make` and `K` read per pass;<br>- flow building runs a type loop's passes with no subject read (`rules/flow/build/loops.ts`);<br>- D1: every member parameter over literal types reads as its value, built as that literal's constant (`rules/flow/build/expressions.ts`, `rules/computation/`), never a bare struct;<br>- statics through `S[K]` (`types/written/named-types.ts` takes an index expression as owner);<br>- hover on `K` and `S[K]` shows the pass's key and field type.<br>Spec §4, §3.10, §3.1, §3.5 | The structural commit moves no expectation. A corpus `Group.make` over `S is struct { [_] is Node }`, built with `struct{for K in keyof S: [K]: S[K].make(…)}`, checks and runs for a nested model. So do `for K in keyof OrderLike` over a concrete struct, and a constraint naming a field (`S is struct { id: Field<String>, [_] is Node }`), each pass resolving `S[K]` to its field's type. The loop's passes go in name order, with one others-pass for an opaque `S`. `K` reads as `"name"` in a pass, and `describe<S in Status>()` reads `S` as a value. A member parameter over `String` is no value (5011). `describe` and the loop's `K` run. `break` and `await` work in a type loop. Hover on `K` and `S[K]` shows each pass's. `S{…}` on a type parameter stays 5012 |
| **FB** FormBuilder on 17 | **Engine:** FormNode's `fn Self.make(graph: Graph, data: Self.Seen?) -> Self` for every node kind (`Field`, `Group`, `List`, `Variant`, `Hidden`, `Local`, `Dynamic`). `List` holds its `graph` and makes rows with `R.make` in place of its `make` field. The catalog's `contact-card` and the tests calling the generated factories (`order.test.ista`, `supplier.test.ista`, `forms/form.test.ista`) move to `make`. **Generator:** stops emitting factories and row makers; the `.gen.ista` files are regenerated | No factory or row maker is left in `order.gen.ista` or `supplier.gen.ista`; only the context getters (`params`) stay. `form-spec.test.ts`, `computed.test.ista` and both forms' tests pass. `npm run profile:check` `fb-warm` is within noise |

## Order

```
P16 ∥ P17 → FB → merge review
```

*Why:* the two compiler phases are independent. P16 moves FormBuilder's scopes itself (the human's
change); FB's factories need 17.

## Shared files and owners

| Surface | Owner |
|---|---|
| sf-C's member-meaning unit, the `[]` operator's choosing; `calls.ts` `calledValue`/`callMethod` and `desugaring/deferred-calls.ts`'s member paths; `lookup/denotations/` for member reads; `rules/flow/build/member-values.ts` | P16 |
| `constructs/loops/field-passes.ts`, the comprehensions, pass unrolling (checker `wiring/body/facts/instantiation.ts`, lowering `tables/instances.ts`, `flow/layout.ts`) | P17 |
| `constructs/expressions/access/names.ts` (a member parameter as a value); `types/written/named-types.ts` and `calls.ts` `callStatic`'s owner; `lookup/denotations/` for type-loop keys; `rules/flow/build/{loops,expressions}.ts`, `rules/computation/` | P17 |
| `examples/FormBuilder/` | P16 (scopes), then FB (factories) |
| `docs/spec.md` | each phase its own sections; §3.1 both, different paragraphs |
| `architecture.md`, `docs/reuse/`, `tracker.md` | each phase its own lines; the second to merge rebases |

Each phase edits the docs its change affects (`guide.md` and the cheat sheet where they change,
`architecture.md`'s tree, `docs/reuse/`) and its tracker rows.

**Out of this plan:** proposal 12, including tuples in 17's forms. Its plan extends them, as it
extends every key-reading construct.
