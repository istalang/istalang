---
description: verbatim scout triage (2026-11-15) of the open B (behaviour) tracker items by structural root cause — clusters with evidence, items sharing B94's cause, stale rows, local ones. Read before workstreams B, C, D or tracker hygiene
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-15
last_updated: 2026-11-15
tags: [structural-fixes, research, tracker]
---

# Tracker B items: structural triage (scout report, verbatim)

The scout ran its repros against main at `11c7e1d0`. The repros the phases need are copied into the phase docs.

## Clusters

**A. One type has several spellings (B94's cluster): B94, B65, B91 (B92 already fixed)**
- **Mechanism:** the checker's identity is `typeKeys.typeKey`. Lowering builds its own spelling of the same type. Table entries are *keyed* by typeKey but *named and ordered* by that spelling, so the spelling has to be injective, and nothing makes it so.
- **Copies:**
  - `checker/types/identity/type-keys.ts` `structureKeyOf`/`functionKeyOf` key a function as `fn<mark,send>(&p,...pack)->r`.
  - `lowering/tables/names.ts` `spelledType` → `tableSpelling` → `ownKeyType`/`structureKeyType` reuse the extern `KeyType` (`definition/extern-key.ts`). That keeps only persistence, parameter types and result; it drops `&`, send, pack and the rest of the mark.
  - Consumers of the spelling: `type-table.ts` `unionMembers` (sort), the variant names, `unionName`, `anyIndex` names, and the instance names in `instances.ts:224`. Entries themselves are keyed by typeKey (`#indexes`, `tables.ts`).
- **B65:** `recursive-aliases.ts` `preferredAlias` → `recursiveAliases` ranks every recursive alias in `program.modules`. So a table spelling depends on modules the entry never imports. Mechanism verified in code, no repro.
- **B91:** the error message prints two different types the same way, because `typeText` prints a type parameter by its bare name. Renaming the caller's parameter shows it: "Expected fn(R.Seen) -> String?, found fn(Q.Seen) -> String?". The underlying bug belongs to cluster D: the variant's `R`, used only under an associated type in a parameter position, is never bound. Results, tuples and optionals in that position check fine.
- **Refactor:** have one traversal (`structureKeyOf`) take a leaf-naming function: identity numbers for the checker, qualified names for tables. The table spelling then carries every field the key does by construction, and the extern `KeyType` becomes a host-only projection of it. Choose the preferred alias by key alone, or among modules the entry reaches. Add a fast-check property: different typeKeys ⇒ different `spelledType`. Messages should qualify same-named but distinct parameters.

**B. What an instantiation reaches is listed separately by each analysis: B1, B18, B52, B81, B87 (B73 was one instance, now fixed)**
- **Mechanism:** lowering instantiates by walking three things:
  - layouts, including fields typed by their default;
  - the calls a type entry makes (`type-table.ts` `disposalOf`, `#outcomeEncoder`);
  - body calls plus witnesses (`witness-closing.ts`).
- The checker rebuilds subsets of this:
  - `rules/expansion/types.ts` takes edges from written field types only; its banner says a default-typed field adds none.
  - `rules/expansion/functions.ts` `sitedEdges` uses only `madeCalls()` through `functionCallsWithin`. That returns `[]` for requirement calls (B1) and never sees type-entry calls (B52).
  - `rules/lifetimes/lifetimes.ts` `#calleesOf` adds `witnessesOf` and `witnessesConvertedIn`. But `analysis/operations.ts` turns a requirement call with no witnesses into `unknownCall` (B87).
- **Effect:** each gap means a clean check followed by a lowering stack overflow. B18 and B81 reproduce as RangeError; B18 overflows even `check`, in `substitution.js`.
- **Refactor:** one "instantiation demands" enumerator on the checker surface (types made and function instances called, including default-typed fields, entry calls and requirement witnesses), used by expansion, lifetimes, data kinds and lowering's closing.

**B′. A field typed by its default: B18, B70, B81**
- The field's type exists only after checking a default that reads the layout being built. So B70 gets 5112 (reproduced) and B18/B81 get no expansion edge.
- **Possible spec simplification:** a field whose default isn't self-typing must write its type. That removes the special path in both layout and expansion.

**C. Two ways to list a receiver's members: B22, B51 (B64 possibly, not verified)**
- `constructs/expressions/access/member-access.ts` `membersNamed` feeds the 5504 check (`missExplained`). It uses `topLevelCandidates` + `receiverMembers`, and filters getters by `takesAsSelf` but not methods.
- `lookup/members.ts` `membersOf`/`receivedBy` feeds completion. It applies receiverCandidates, metThroughTraits, callableThrough and the takesAsSelf filter to methods as well.
- B22 reproduces: `x.filter` on an Int gives 5504; `x.filter(f)` gives 5001 at the receiver.
- B51: `calls.ts` `callMethod` records the field read (`recordFieldRead`) but no expression type, while `signature-help.ts` `valueCallHelp` reads `body.typeOf`. The `calledValueType` the row names no longer exists; whether the bug remains is not verified.
- **Refactor:** member-access reads `lookup.membersOf` filtered by name, so one place answers "what does x.name mean", recorded on the surface for the editor.

**D. Which constructs take an expected type, and when, is decided per syntax kind: B88, B68, B69, B91**
- `wiring/body/scope-protocol.ts` has `Call: opens` but `MemberAccess`, `Binary`, `Unary` and `Index` as `boundary`, though they resolve to getter or operator calls.
- B88 reproduces: `id(b.empty)` gives 5100 while `id(empty(b))` checks.
- B68 reproduces with 5380.
- B69 still fails but with a different error now: 5001 "found Future<Int, "ista">". `work<"ista">` checks.
- **Refactor:** decide standing from the resolved call, not the syntax kind. The outer call chooses only after its postponed inner arguments (packs, marks, the expected result) are bound.

**Small double standards**
- **B89:** `resolution/calls/captured-sends.ts` `explainedCaptures` returns early when the closure is not a `Lambda`. A local `fn` therefore gets "Expected sendable fn() -> Int, found inert fn() -> Int" where a lambda gets 5644 per capture (reproduced).
- **B82:** an instance outcome has two holders. A returned one is disposed with the root frame (`returns.ts` `landReturn`); an awaited one is held by the `outcome` object (`root-outcome.ts`). The `it.fails` test is present; nothing else verified.

## Items sharing B94's root cause
B94 and B65 directly: the table spelling is not a function of the type key alone. B91 only through its message (`typeText` is not injective); its real cause is in cluster D. Not verified: whether duplicate instance names (`instances.ts:224`) can actually misbehave.

## Stale
- **B15:** `f<Int>(y)` with `y: Int?` now gives 5001 "Expected Int, found Int?".
- **B17:** `f(panic("x"))` checks clean; `bindNeverWhereOpen` was removed in 9aaf0196.
- **B29:** local functions can no longer have type parameters at all (5500), so the item is moot.
- **B36:** the row's repro checks clean.
- **B67:** `wrap(takesPlain)` checks clean (probably fixed by f447fddf).
- **B73:** `callsMadeWith`, `witnessCallsOf` and `functionCallsWithin` now all live in `surface/resolved-call.ts`, and `call-kinds.ts`/`data-kinds.ts` import from it (f447fddf).
- **B75:** `next == none or not next.tryResolve(x)` now gives 5409, matching spec §4 "Nothing narrows"; it never reaches lowering.
- **B48 (probably stale):** the row's declaration is now refused with 5135; the property seed was not re-run.
- **B85 and B93** describe the same broken generator in `shared-values.test.ts`; keep one.

Re-checked and still valid: B18, B22, B24 (26 parse diagnostics per spec unit), B35, B50 (both inputs crash), B53 (FormatError on run), B64 (`describe.skip`), B70, B81, B82, B83, B84 (`it.fails` present), B88, B89, B91.

## Not structural / local
B5, B7, B10, B13, B14, B19, B20, B23, B24, B26, B27, B30, B34, B35, B48, B50, B53, B64, B71, B74, B77, B80, B83, B84, B85/B93, B86, B90.

Two of these lean structural: B53 (a rule the Definition schema enforces but the checker doesn't) and B19 (rename hand-lists the names the language binds by name).
