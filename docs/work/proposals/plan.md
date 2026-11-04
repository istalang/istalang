---
description: plan for implementing docs/proposals 1–4 in order — each proposal's status, the audit items to clear before each one (so it doesn't duplicate a rule it extends), the human's decisions so far, the fast wins and the audit items no proposal touches; read before starting or briefing any proposal
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-05
last_updated: 2026-11-05
tags: [plan, proposals, audit, debt]
---

# Proposals 1–4

Specs: `docs/proposals/1-type-names.md` to `4-computed-types.md`, implemented in their numbered order. Audit references are to `docs/audit/dry-review-2026-10-30.md`: `#N` is its ranked summary, `unit N` its per-folder findings.

**Process:** one fresh expert per proposal, in a worktree of its own.
- **Debt first:** the branch first clears the audit items below its proposal. Each is a rule the proposal extends that lives in several copies today, so the proposal would otherwise edit every copy.
- **Commits:** structural and behavioural changes may share a commit. The expert takes the fastest path to a finished, clean result.
- **Mechanical changes** across many files are scripted rewrites: precise regexps, or the project's own scanner and parser, never hand edits.
- **Verification:** a fork of the pi root reviewer (`hcom pi --agent reviewer`, prepared on the codebase, architecture, `docs/reuse/` and the spec), plus a cold `qa` agent on the proposal's behaviour table.
- **Merge:** the expert merges once both pass, without waiting for the human.

| Proposal | Status |
| --- | --- |
| 1 Type names | done, `43d9b81` |
| 2 Structural types | done, `b6de118`, with its debt items (Q30 left open) |
| 3 Union types | done, `5bbe9d3` and its fixes, with its debt items (tracker F17–F21, Q39–Q41, B27, B29) |
| 4 Computed types | ready; its Before P4 items open |

## Decisions so far (the human's)

- **P1, Definition spelling** (note 2): renamed everywhere. Every program with externs is refused once on its next deploy, and hosts re-key extern tables from `(int)` to `(Int)`.
- **P1, `json.Json`'s `Bool` variant** became `Boolean`, since a bare `Bool` names the primitive.
- **P1, built-in type names are reserved** (4019): no type, alias, type parameter, trait or variant may be named `Int` … `Never` or `Self`.
- **Fast wins, item 4:** `T is (Comparable)` is legal; `unparenthesizedType` sees through parentheses.
- **B25** (does an alias of an enum qualify its variants, `E.Red`): yes, decided during P2. Only an alias naming an enum plainly qualifies, with no type parameters of its own and no type arguments given, which a variant would drop (§3.17).

## Debt before each proposal

**Before P1** (done)

| Item | Audit | Where it closed |
| --- | --- | --- |
| Binding vs. referring decided by case two ways; `'_'` checks instead of `isUnnamed` | units 2, 6, 9, 11 | fast wins, `60f153f` |
| The `any` downcast rule in three copies | unit 32 | P1: `checker/types/named-types.ts` |
| Spec: reserved names split between §2 and §3.10 | unit 35 | P1's spec edit |

**Before P2** (done in the P2 branch, but `DeclaringModules`: Q30 stays open, see the audit's item 8)

| Item | Audit | Why P2 needs it |
| --- | --- | --- |
| Three static-owner resolvers, a second entity-to-type dispatch, B25 | #4, units 15, 19, 32 | a shape's alias builds literals and owns statics |
| Three call-checking pipelines; `lowerSpawn` copies call lowering | #5, units 15, 16, 19, 23 | the shape conversion and its ranking in one place |
| Field members and variable types each looked up two ways; `DeclaringModules` (Q30) | #8, unit 20 | field order and the annotation refusal |
| Lowering: struct, tuple and equality builders copied; variant built by position; reference forwarding three times | units 21, 22 | a value rebuilt under the shape's type id |
| `sameType`'s anonymous branch; the function-header check twice | unit 13 | P2's note 1 makes identity `typeKey` equality |

**Before P3**

| Item | Audit | Why P3 needs it | Status |
| --- | --- | --- | --- |
| `Optional` handling scattered: `optionalInner` vs. `optionalArgument`, recognition by name string, five `Some` test-and-unwrap copies in lowering, `'value'`/`'error'` literals, `optionalValue` reading `fields[0]`, slice `end` unwrapping | #6, units 5, 23, 27 | `T?` becomes `T \| None` | done, `2a53aab` |
| Expected-type decomposition: `enumTypeFor` vs. `bareStructValue`; `inferNestedLambdas` re-walking composites | #6, unit 16 | literals, lambdas and bare variants built from one member of the expected union | done, `c6e8c0e` |
| Negative numeric literal read three ways, `-0` key | unit 17 | literal types and patterns | done, fast wins |
| Object safety and derived traits: `unsafetyOf` by hand, Q7, Q9 | units 14, 18, 22 | unions meet traits through members; literal-union codecs | done, `c38d7db`, `d630ae7`, `554d9f9`; Q9 keeps `@JsonBigInt` |
| Completion restates the parser's keyword tables (Q35); `unparenthesizedType` | units 6, 9 | `\|`, literal types, `in`, later `infer`, `keyof` | done, `9ec6f96` |
| Spec: refutable patterns split between §3.11 and §3.15; must-use rules stated four times; text codecs listed twice (§3.8, §9) | units 36–38 | P3 edits these lists | done, `62d7cbd` |

P1's report adds: `None` goes into `primitiveNames`, and generic patterns on unions extend `PatternType`'s `generic` case. Both done in `5bbe9d3`.

P2's report adds: a generic alias's static owners are keyed by the alias's own parameters, so a family is reached only through that alias. `Optional` as an alias owning `T?`'s statics needs a family matched against concrete types, an addition with nothing blocking it. Done in `5bbe9d3`: a union holding `None` keys its statics as `T?`'s.

**Before P4**

| Item | Audit | Why P4 needs it | Status |
| --- | --- | --- | --- |
| `bindLoopTargets` copied `declareTargets` | unit 18 | field loops | done, fast wins |
| `Expansion` and `TypeExpansion` run the same graph walk | unit 19 | type `match` recursion | open |
| The formatter lists bracketed children twice (`bodies.ts`, `brackets.ts`) | unit 29 | mapped types, struct comprehensions | open |
| Nominal structs keep declaration-order layout; only shapes are in name order (P2's deviation, unobservable today) | P2 report | field loops, comprehensions and rest patterns must visit name order (P2's field-order rule) | open |

P3's report adds: computed types substitute into unions, where an `any` member absorbs nothing after substitution (tracker F21); and struct rest patterns extend a pattern part's path, which writes a union member's unwrap as field `0` (Q41).

## Fast wins (done, `60f153f`)

The 16 items are marked done in the audit:
- the `'_'` checks, `declareTargets`, `qualifies` and `unparenthesizedType`;
- the signed-literal reader, `heldType`, `sameTypes` and `isPack`;
- the `programBinder` memo (a host operation went from 1.94 ms to 14.6 µs) and the `extentIn` memo;
- the formatter's print memo (16-deep hugged calls went from 458 ms to 0.39 ms) and `LineMap.lineSpan`;
- `addToGroup` at every copy-on-append site, and `lastIndexAtMost`;
- the one-way-rule breaches and the small deduplications;
- the spec wording and the stale docs.

Deferred and still open in the audit:
- the anonymous-struct and function-header parts of unit 13, now in P2;
- the token re-scan of #2;
- the CLI's text round trip before deploy;
- the §3.11/§3.15 refutability split, listed above under P3.

## Not touched by any proposal

These can go anytime, alone or beside a proposal:
- #3, the transitive reads in `notesOfReads` (P10);
- #7, the JSON serialization and the recursive value walks (Q29);
- the token re-scan of #2;
- the runtime's `callProblems` and `closureOf` unpacking;
- `buildProgram`'s re-reads and the LSP's full-project glob on every edit (F11);
- the code-point stepping loops;
- the binder's namespace lookup.

## Known gaps

- Proposals 2–4 still spell primitives in lowercase in their examples; read them as PascalCase.
- `case Int` against an `Int?` is a compile error until P3.
- `lsp/providers/completion.test.ts`'s std documents come near the 5 s limit under load (B21).
