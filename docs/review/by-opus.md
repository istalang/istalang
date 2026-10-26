---
description: generality review of M1–M3 (extractable solutions, type-hardcoded rules, spec generalizations, other languages' pitfalls, plugin modularity, cross-module extractions) — read before refactoring compiler or runtime internals or starting M4
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-26
last_updated: 2026-10-26
tags: [review, architecture, refactoring, debt]
---

# Generality review (main @ 40cb3f3, M1–M3)

Spec: `docs/spec.md` · Architecture: `docs/arch/architecture.md` · Tracker: `docs/work/tracker.md` (D133–D143 filed from this review)

**Verdict: changes required.** Three small fixes before M4 starts; eleven items filed (six in the code, five spec decisions).

## Must fix before M4

1. **Context-sensitive arguments go through a closed switch** (Step back, Registries). `overloads/decided.ts` `decidedByCall` sits outside the expression table, and its `default` returns undefined. Only a top-level `none`, lambda, name or variant literal gets its parameter's type. Checked against one non-generic overload with `dist/cli`:
   - `f([])` gives 5300;
   - `h([fn(x): x + 1])` gives 5501;
   - `k((1, fn(x): x))` gives 5501;
   - `const e: Array<fn(int) -> int> = [fn(x): x + 1]` checks clean.

   D84 and D102 are instances of this. Fix: give the expression table an `accepts` facet, exhaustive per kind and recursing through tuple, array, map, block and `if`. Check an argument against its parameter once the candidates agree on that parameter's type. This also removes the overloads→closures and overloads→expressions imports (D135). *If unfixed:* every literal form repeats the bug, and users must annotate where the language says they needn't.
2. **`NativeContext` is a 16-member context every native receives** (ISP, OCP). It lives in `runtime/natives.ts` and reaches everything from `add(int, int)` up. Each runtime capability is wired through `natives.ts`, `scheduler/native-calls.ts` and `host.ts`, and M4 adds about ten std modules plus the Logger seam. Fix: split it into capability interfaces that a natives module declares, assembled at the composition root. Land these with it:
   - D79: the key helper copied in four files;
   - D128: static names spelled in many places;
   - the parse→`Result` helper duplicated in `prelude/text-forms.ts` and `time/natives.ts`.

   *If unfixed:* every M4 module widens a root interface and copies the natives template.
3. **Dead code** (B.7). `frontier.ts` `elementAssignment` and `elementReference`, and `unsupported.ts` `unsupportedHandler`, have no users, though `frontier.ts`'s own banner says a lifted key is deleted. Add knip to `npm run verify` so an unused export fails the build instead of waiting for a reviewer.

## Spec decisions: generalize to delete special cases (filed)

| # | Finding | Proposal |
| --- | --- | --- |
| D139 | `Shared<T>` plays four roles, each a separate structural special case: the cell of a captured or referenced variable; a module's resource type (`isOwnedHandle`); the one ADL exception (`candidates.ts` `lookupTypes`); a host handle when its struct has only function fields (`hostHandleOf`). The root: a module can't declare a nominal type with identity, so `type Inbox<T> = Shared<InboxState<T>>` smuggles identity through a transparent alias. D105 has the same root. | A nominal handle declaration, which deletes all four special cases. |
| D140 | JSON is a closed compiler table, not traits: `leafHelpers`, `containers` (Array, Optional, Map), 34 `codecHelpers` names in `language/well-known.ts`, and the same three types again in `annotations.ts` `emptyValues`. Every other type-directed feature goes through a trait (operators, `for`, `x[k]`, `$`, `T(x)`, `toString`), so this is a second way to do one thing. M4's Decimal or a Set would need compiler edits to cross. | Real `Encodable`/`Decodable` traits, in the Codable/serde shape. Container codecs become generic json-module overloads; the compiler derives codecs only for structs, enums and tuples. |
| D141 | `iterate` returns `Array<T>`, so every `for` materializes what it loops over. `for i in 0..n` allocates n ints and persists them in every snapshot taken while the loop runs. Each pass also makes three function-table calls. | A persistable lazy form: an indexable view with a length, or a cursor struct. |
| D142 | Mixed arithmetic is an overload matrix. The prelude has 20 int/float natives, plus `add(string, int\|float\|bool)` but no `add(int, string)`. M4's Decimal makes it nine combinations per operator. | One numeric promotion rule, plus `add<T is Stringable>(string, T)`. |
| D143 | Witnesses are chosen per call site, so two modules can see different `compare`/`toString` for one type and disagree about one value. This is the incoherence of Scala implicits and Haskell orphan instances. `json-forms` already fixes a type's functions at the type's own module. | Decide whether that is the rule for every trait. |

## Code debt (filed)

| # | Finding |
| --- | --- |
| D133 | Flow analysis for `drop` (`rules/dropped.ts`) is a switch over about 14 kinds whose `default` treats any new control-flow construct as straight-line code. Two more ad-hoc walks (`waits`, `checkSelfStays`) each decide again where a nested function cuts. Extract one flow model, and one "walk this body, not nested functions" helper, before a second flow rule arrives. |
| D134 | The heap has no indexes, and its scans are filed one at a time: D107, D111 and D113, plus the host token, pending `first`s and due timers. Decide one derived-index layer, measured with D44. |
| D135 | All 12 checker folders form one import cycle. `rules/` has no entry and about 50 importers, and traits↔overloads is one engine split across two folders. Lowering imports checker internals besides `check.ts`. Extract a `resolution/` unit, move variant naming out of `expressions/`, and have dependency-cruiser enforce the inner layers. |
| D136 | `CheckedBody` grows a side table per feature: 15 now, and every M3 slice changed `check.ts`. Decide before M7: keep per-concern records, or have the checker produce an elaborated tree (Roslyn's BoundTree, rustc's THIR). |
| D137 | The checker is memoized per Program, so every edit re-checks every body the LSP asks for. Plan M7 with early cutoff. |
| D138 | The Definition and the runtime recognize `prelude.Shared` and `prelude.Future` by name (`definition/types.ts`, `host-natives.ts`). Give extern type entries a role instead. |

## Modularity: are features plugins?

- **Within a phase: yes.**
  - Parser categories meet only through the Grammar record, and dependency-cruiser enforces it.
  - Binder, checker, lowering and interpreter dispatch through exhaustive `Handlers` tables, so a new node or instruction kind fails compilation until every table handles it.
- **Across phases: no.** A feature is a vertical slice, not a plugin. Each M3 slice touched 36–92 source files in 16–29 folders. Every phase's subfolders also form one import cycle: checker 12, runtime 7, stdlib 6, lowering 4.
- **Recommendation:** keep phase-major tables; rustc, TypeScript and Roslyn are built the same way, and the tables buy type-checked exhaustiveness. The achievable step is to make the kind tables the only dispatch:
  - facets per kind (check, accepts, flow) instead of switches with a `default` (`decided.ts`, `dropped.ts`);
  - one entry per engine: resolution, flow, heap queries.

## Already general (keep)

- `ValueSemantics` (`language/values.ts`) is the one home of `==` and map keys, for both runtime values and compile-time constants.
- `patterns/` has one walk with injected tests, and `exhaustiveness.ts` doesn't depend on the checker's types.
- Every sugar call is recorded once by (node, role). There is one emitted loop, one wrap site and one `call` writer.
- Well-known types are recognized by entity, except at `type-text.ts` and D138.
- One function builds extern keys for both lowering and the natives tables.

## Pitfalls of other languages

**Avoided:**
- Temporal and Durable Functions replay history; frames here are data, so there is no replay nondeterminism.
- Java's equals/hashCode drift: `==` is built in, so map keys can't disagree with it.
- Python's separate `__lt__`/`__gt__`: everything goes through one `compare`.
- C++ templates checked per instantiation: generic bodies are checked once, plus a .NET-style expanding-cycle rule.
- Implicit coercions: there are none.
- Finalizer nondeterminism: disposal happens at the last holder.
- Polymorphic serialization: traits are never value types.
- Turbofish (`::<>`): parser speculation handles it.

**Present:**
- Swift-style value semantics without Swift's copy-on-write: building a collection is quadratic (D76). Swift's fix is `isKnownUniquelyReferenced`.
- Eager iteration (D141).
- Primitive operators are mockable function-table natives, so each `i + 1` is a call. Measure with D44, and use an intrinsic unless mocking `add(int, int)` is a feature.
- Incoherent witnesses (D143).
- No interfaces, so behaviour objects are structs of closures in a `Shared` (D139).
- A TypeScript-style whole-program recheck on every edit (D137).

## Integration

- Lowering reads checker internals: `rules/{futures,host-boundary,json-forms/form}.ts`, `closures/function-scope.ts`, `types/type-keys.ts` (D135).
- The IR knows std types by name (D138).

## Architecture doc: two claims are false today

- "Construct modules reach each other only through their context." Counterexamples: overloads→closures/expressions (`decided.ts`), patterns→`expressions/variants.ts`, rules↔overloads.
- "Used only through its entry module." Lowering imports the checker internals listed above. Either name them as the checker's surface or route them through `check.ts`.
