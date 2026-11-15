---
description: phase C of structural-fixes — one answer to "what does x.name mean" (member access through lookup's member listing) and editor features reading facts the checked body records instead of restating checker rules; B22, B51, B64, Q40, P14/P42. Read to implement or examine phase C
owner: tech-lead
status: active
applies_to: compiler/checker/constructs/expressions/access, compiler/checker/lookup, editor/language-service
last_verified: 2026-11-15
last_updated: 2026-11-15
tags: [structural-fixes, phase, members, editor]
---

# C: member meaning, answered once

Branch `sf-c-members`. Research: `research/plan-review.md` §QUALITY 3 and §CORRECTNESS 2, `research/tracker-b.md` cluster C, `research/tracker-fpq.md` cluster B;
`findings.md` §C. Churn (`research/churn.md`): `named-functions.ts`↔completion `placeholder.ts` and
`key-denotations.ts`↔`semantic-tokens/name-types.ts` co-change in fix commits.

## Why

- Checker side: `checker/constructs/expressions/access/member-access.ts` `membersNamed` feeds 5504
  (`missExplained`). It uses `topLevelCandidates` + `receiverMembers`, and filters getters by `takesAsSelf` but not
  methods.
- Completion side: `checker/lookup/members.ts` `membersOf`/`receivedBy` applies receiverCandidates,
  metThroughTraits, callableThrough and `takesAsSelf` to methods too.
- B22: `x.filter` on an Int gives 5504, while `x.filter(f)` gives 5001 at the receiver.
- B51: `calls.ts` `callMethod` records the field read (`recordFieldRead`) but no expression type, and
  `signature-help.ts` `valueCallHelp` reads `body.typeOf`.
- Q40/P14: completion re-parses with a placeholder (`completion/placeholder.ts`), maps nodes across the trees
  (`checkedTwinOf`), and `completion/places/patterns/matched-type.ts` (402 lines) restates
  `checker/constructs/patterns/walk/`.

## Do

- One unit decides which members a name on a receiver can mean. It sits in `resolution/choosing/` (for example
  beside `candidates.ts`/`receivers.ts`), beneath both `constructs/expressions` and `lookup`, because the layers
  forbid `member-access.ts` from importing `lookup/` (`.dependency-cruiser.mjs` `checkerLayers`).
  - It filters methods by `takesAsSelf`, as getters already are, and keeps `selfInference` for reporting unmet
    constraints.
  - It looks up one name only: `lookup/members.ts` `membersOf` runs `takesAsSelf` over every function (P41,
    32%), so filtering its whole listing per field read is too slow.
  - Member access, completion and the members query all go through it.
- The checked body records the facts the editor needs: the member a name resolved to, and the callee's
  expression type in `calls.ts` `callMethod` (~267-273), which fixes `signature-help.ts` `valueCallHelp` and lets
  `rules/flow/build/calls.ts` (~108) drop its `fieldGivenBy(callee.member)` workaround. Also the type a pattern
  matched. Editor features read those from the checker's surface instead of
  restating rules. Remove the restated walk in `matched-type.ts`.
- Whether the placeholder re-parse (P14) can go is for you to judge. If it stays, say why in the report.
- B64: confirm whether it belongs here (`describe.skip`). Fix it if it does; file it if it doesn't.
- Reuse docs: `docs/reuse/modules-and-names.md`, `docs/reuse/calls-and-resolution.md`,
  `docs/reuse/syntax-and-trees.md`, `docs/reuse/testing.md`. Read architecture.md's editor and checker-surface
  sections.

## Acceptance

1. B22: `x.filter` (a member read) gives 5400 `unknownField`, not 5504. `x.filter(f)` (a call) gives 5214
   `noMember` at the member, not 5001 at the receiver.
2. Signature help on a method call through a field (`o.f(‸)`) shows the signature, read from the recorded type
   (B51).
3. Completion's and the language service's tests pass with unchanged expectations, except ones B22/B51 corrects.
4. `matched-type.ts` no longer restates the pattern walk. The editor reads recorded facts.

## Repros (verified on main at `11c7e1d0`)

B22:

```ista
live async fn main() -> Unit:
  const x = 1
  const a = x.filter
  const b = x.filter(fn(n: Int) -> Bool: true)
```

B51, from a vitest test using `programAt` from `editor/language-service/language-service.test-kit.ts` and
`signatureHelpAt` from `editor/language-service/signatures/signature-help.ts`. The cursor is `‸`; compare the
two:

```
struct O:
  f: fn(Int) -> Int
fn main(o: O) -> Int:
  o.f(‸)
```

```
fn main(f: fn(Int) -> Int) -> Int:
  f(‸)
```

## Tracker rows (verbatim, 2026-11-15)

| Id | Item | Size | Depends on | Filed by |
| --- | --- | --- | --- | --- |
| B22 | Whether a name is a method is decided by name only for a member read (member-access.ts `noField`, 5504 "is a method: call it") and a call's 5214, while completion and the members query judge by the receiver: `x.filter` on an int reports "'filter' is a method", and `x.filter(f)` reports 5001 at the receiver, not 5214. One rule for all three changes diagnostics. | medium | none; can be done now | completion fix 2026-10-30 |
| B51 | Signature help for a call of a function value read from a field, `obj.f(‸)`, shows nothing: `signature-help.ts`'s `valueCallHelp` reads `body.typeOf(calledName(call))`, and checking records no type for a field read as a callee (`calls.ts` `callMethod` reads the field without checking the access). `calledValueType` (`constructs/closures/value-calls.ts`) derives that field's type as spawn and deferred calls read it; signature help reading it through the checker's surface would fix it. | easy | none; can be done now | DC 2026-11-10 |
| B64 | completion.test.ts's "completion over the corpus" is `describe.skip` and has rotted: unskipped, it fails on 33 documents, mostly names not offered where they fit (`Ok`, `Err`, `Circle`, `Next`), one with "Maximum call stack size exceeded". | medium | — | test-speed report 2026-11-10 |
| Q40 | Completion's `places/patterns/matched-type.ts` restates the checker's pattern walk (tuple elements, array items, struct and variant fields, downcasts, and now a union's member selection); the checked body could record what each pattern node matched, as it records a literal's fields, and completion read it from its placeholder check. | medium | none; can be done now | p3-unions 2026-11-05 |
| P14 | Completion outside a member or literal field re-parses the whole module with a placeholder at the cursor (`completion/placeholder.ts`; `parse()` re-scans and re-parses whole, about 9 ms on the 2,098-line module), unmeasured against the edit budget. Typed quotes, `/`, `@` and `.` read the place on every keystroke too (no token gate; `/` and quotes are frequent). Levers: parse only the segment holding the cursor; gate those triggers on the token touching the cursor. Profiled 2026-11-06: `completionsAt` also scans the whole module three times (Workspace, `tokens.ts:allTokensOf`, `placeholder.ts`); keep tokens on the SyntaxTree (`docs/work/perf/profile-2026-11-06.md` #9). | small | none; can be done now | completion C1, C2c reports 2026-10-30 |
| P42 | Completion re-scans and re-parses the whole module for every request (`completion/placeholder.ts` `parsedWith`): 46% of completion.test.ts's `std:prelude` test. | small | — | test-speed report 2026-11-10 |
