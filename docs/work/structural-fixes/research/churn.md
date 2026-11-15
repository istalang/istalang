---
description: verbatim scc + git churn analysis of src/ (2026-10-24..2026-11-14) — fix-commit hotspots, churn×complexity, co-change pairs across feature folders, repeat-fix files and recurring fix clusters. Read before choosing refactor targets or judging where cohesion fails
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-15
last_updated: 2026-11-15
tags: [structural-fixes, research, churn, hotspots]
---

# Churn and hotspots (scout report, verbatim)

**How to rerun.** Use `scc --by-file --format json src`, plus `git log --numstat` over src/. Count commits whose
subject starts with `fix(`, and skip commits touching more than 25 files for co-change. The raw data was session
scratch only and was not kept.

Data caveats: history spans 2026-10-24..2026-11-14 (about 3 weeks), so "60 days" equals "overall". 1006 commits touch src/ (297 `fix(`). I did not follow file renames (`git log` without --follow). Many files moved mid-history, so churn and fix counts are split between old and new paths. Both paths appear in the tables (e.g. checker/expressions/* vs checker/constructs/expressions/*). Non-test .ts files with data: 733, total 80,168 LOC, complexity 16,872. Commits touching more than 25 files were excluded from the co-change and repeat-fix analyses. Complexity is scc's. Columns: loc, cx = complexity, c = commits, fx = fix commits, ch = lines added+deleted.

## Top files by fix commits (paths under src/)
|path|loc|cx|c|fx|ch|
|---|---|---|---|---|---|
|compiler/checker/check.ts|164|1|113|13|1926|
|compiler/checker/rules/agreement.ts|162|32|51|12|1595|
|runtime/scheduler/segment/index.ts|275|43|43|11|1318|
|compiler/checker/diagnostics/generics.ts|341|3|28|11|428|
|compiler/checker/resolution/choosing/named-functions.ts|349|84|23|10|1074|
|compiler/checker/lookup/key-denotations.ts|193|82|27|8|753|
|compiler/checker/wiring/body/body-checker.ts|339|43|39|8|788|
|compiler/checker/rules/lifetimes/analysis/operations.ts|363|133|22|8|822|
|compiler/checker/types/inference/system-reading.ts|291|92|14|8|672|
|compiler/checker/constructs/closures/lambdas.ts|343|99|27|7|684|
|compiler/checker/rules/lifetimes/analysis/nodes.ts|294|89|17|7|737|
|compiler/checker/rules/lifetimes/analysis/index.ts|250|53|16|7|856|
|compiler/checker/rules/flow/build/literals.ts|215|60|15|7|713|
|compiler/checker/types/fitting/expected.ts|134|39|22|7|261|
|compiler/checker/contexts/body-context.ts|222|0|34|6|605|
|compiler/checker/constructs/expressions/calls.ts|297|73|25|6|1105|
|runtime/scheduler/instance/index.ts|270|23|43|6|874|
|compiler/checker/rules/lifetimes/summary.ts|284|34|15|6|986|
|compiler/checker/rules/lifetimes/analysis/calls.ts|294|83|15|6|967|
|compiler/checker/constructs/expressions/structs/structs.ts|269|94|16|6|432|
|compiler/checker/types/inference/settle.ts|293|64|13|6|627|
|compiler/checker/types/inference/system.ts|322|35|14|6|1286|
|compiler/checker/rules/lifetimes/analysis/body.ts|311|70|18|5|1062|

(Rows 24-30 all have 5 fix commits, mostly more of checker/rules/flow/build/* and checker/testing.)

## Top by churn x complexity (path, loc, cx, c, fx, ch)
1. checker/rules/lifetimes/analysis/operations.ts 363/133/22/8/822 (hot 109k)
2. checker/constructs/patterns/walk/kinds/variant-calls.ts 306/117/14/5/797 (93k)
3. checker/resolution/choosing/named-functions.ts 349/84/23/10/1074 (90k)
4. checker/constructs/expressions/calls.ts 297/73/25/6/1105 (81k)
5. checker/rules/lifetimes/analysis/calls.ts 294/83/15/6/967 (80k)
6. checker/rules/lifetimes/analysis/body.ts 311/70/18/5/1062 (74k)
7. checker/constructs/closures/lambdas.ts 343/99/27/7/684 (68k)
8. checker/types/inference/infer.ts 298/63/14/5/1061 (67k)
9. checker/rules/lifetimes/analysis/nodes.ts 294/89/17/7/737 (66k)
10. checker/types/inference/system-reading.ts 291/92/14/8/672 (62k)
11. checker/lookup/key-denotations.ts 193/82/27/8/753 (62k)
12. checker/types/inference/bounds.ts 282/74/10/2/820 (61k)
13. runtime/scheduler/wake.ts 240/49/38/4/1201 (59k)
14. runtime/scheduler/segment/index.ts 275/43/43/11/1318 (57k)
15. checker/desugaring/deferred-calls.ts 211/65/6/2/855 (56k)
16. checker/rules/agreement.ts 162/32/51/12/1595 (51k)
17. runtime/scheduler/instance/heap.ts 249/74/19/5/631 (47k)
18. checker/rules/lifetimes/lifetimes.ts 300/37/21/5/1250 (46k)
19. checker/rules/flow/build/control.ts 310/53/14/3/855 (45k)
20. checker/types/inference/system.ts 322/35/14/6/1286 (45k)

## Co-change in fix commits, top file pairs (non-test)
|n|pair|
|---|---|
|7|checker/expressions/collections.ts <> checker/rules/agreement.ts|
|5|checker/types/inference/settle.ts <> checker/types/inference/system-reading.ts|
|5|checker/context.ts <> checker/program-checker.ts|
|5|checker/expressions/tuples.ts <> checker/rules/agreement.ts|
|5|checker/expressions/collections.ts <> checker/rules/branches.ts|
|5|checker/rules/agreement.ts <> checker/rules/branches.ts|
|5|checker/calls/resolve.ts <> checker/expressions/tuples.ts|
|4|flow/build: literals.ts with flow-builder.ts, places.ts, expressions.ts and parts.ts; parts.ts with statements.ts|
|4|lifetimes/analysis: calls.ts with operations.ts, index.ts, ../composition.ts and ../summary.ts; body.ts with index.ts; flow-state.ts with index.ts; index.ts with composition.ts and summary.ts; composition.ts with summary.ts|
|4|inference: settle.ts <> system.ts; system-reading.ts <> system.ts|
|4|checker/constructs/closures/function-values.ts <> checker/resolution/choosing/named-functions.ts|
|4|checker/lookup/denotations.ts <> checker/lookup/key-denotations.ts|
|4|checker/resolution/type-matches.ts <> each of types/written-matches.ts, resolution/type-parameters.ts and types/type.ts|
|4|checker/resolution/shortfalls.ts <> checker/traits/known-constraints.ts|
|4|checker/resolution/type-match-patterns.ts <> checker/types/type-parts.ts|

## Co-change by folder (fix commits, two levels)
|n|pair|
|---|---|
|28|compiler/checker <> compiler/lowering|
|15|compiler/checker <> compiler/syntax|
|13|compiler/checker <> editor/language-service|
|8|compiler/lowering <> compiler/syntax|
|8|compiler/checker <> compiler/parser|
|8|compiler/parser <> compiler/syntax|
|7|runtime/lifetimes <> runtime/scheduler|
|7|compiler/syntax <> editor/language-service|
|6|compiler/binder <> compiler/checker|
|5|compiler/lowering <> editor/language-service|
|5|compiler/parser <> editor/language-service|
|5|compiler/checker <> language-service/completion|
|4|compiler/binder <> compiler/parser|
|4|compiler/binder <> compiler/syntax|
|3|foundation/language <> runtime/scheduler; runtime/natives.ts <> runtime/scheduler; runtime/scheduler <> runtime/snapshot; runtime/host <> runtime/scheduler; definition/validation <> runtime/scheduler; compiler/lowering <> compiler/parser|
|2|compiler/checker <> definition/validation; compiler/checker <> foundation/language; compiler/checker <> runtime/scheduler; compiler/binder <> compiler/lowering; runtime/natives.ts <> stdlib/prelude|

Cross-folder file pairs (n = fix commits):
- 3 checker/resolution/choosing/named-functions.ts <> editor/language-service/completion/placeholder.ts
- 3 checker/statements/assignments.ts <> compiler/lowering/statements/variables.ts
- 2 checker/constructs/expressions/calls.ts <> lowering/constructs/expressions/calls.ts
- 2 checker/contexts/body-context.ts <> lowering/.../calls.ts and lowering/.../deferred-calls.ts
- 2 checker/disposal/disposal.ts <> lowering/.../calls.ts
- 2 checker/surface/{checked-body,resolved-call}.ts <> lowering/.../{calls,deferred-calls}.ts
- 2 lowering/.../calls.ts <> syntax/expressions/readings.ts
- 2 runtime/natives.ts <> stdlib/prelude/{arrays,maps}.ts
- 2 checker/lookup/key-denotations.ts <> editor/language-service/semantic-tokens/name-types.ts
- 2 binder/module/local-binder.ts <> checker/constructs/declarations/declarations.ts

## Repeat fixes: 157 files with 3+ fix commits (shown: 4+)
Most-hit files by fix count (all dates 10-26..11-13):
- checker/expressions/collections.ts: 14
- checker/expressions/structs.ts: 12
- checker/types/type.ts: 11
- checker/rules/agreement.ts: 10 (dated 11-05 to 11-09; 12 counted by path)
- checker/diagnostics/generics.ts: 10
- checker/resolution/conformance.ts: 10
- runtime/scheduler/segment/index.ts: 9
- checker/lookup/denotations.ts: 9
- checker/body-checker.ts: 9
- checker/resolution/choosing/named-functions.ts: 8
- checker/types/type-text.ts, type-matches.ts, program-checker.ts, type-parts.ts, expressions/calls.ts, expressions/tuples.ts: 8 each

Recurring subjects by cluster:
- Recursive and associated type matches (type.ts, type-matches.ts, type-parts.ts, type-keys.ts, type-text.ts, type-parameters.ts, known-constraints.ts, written-matches.ts, conformance.ts, program-checker.ts), 11-05 and 11-06: "make every associated type on a cycle of expansion...", "refuse type matches that are themselves or never...", "label a recursive type match use...", "spell an associated type's unreduced use...", "reduce a type's associated types on each use...", "judge constraints by one implication rule".
- Literal construction (collections.ts, structs.ts, tuples.ts, agreement.ts, branches.ts, calls.ts), 10-28 and 11-05: "build a literal as another type from its items", "build a literal argument of typed items...", "check an argument literal's items...".
- Lifetimes (analysis/{operations,calls,body,index,nodes,flow-state,summarize}.ts, composition.ts, summary.ts, reach-state.ts, lifetimes.ts), 11-12 and 11-13: "check witnesses as instantiated wherever...", "sum up what a watching handle gave...", "keep a default a call left out...", "analyse defaults in a recursive group...".
- Flow builder (flow/build/{literals,places,calls,expressions,statements,parts,flow-builder}.ts, variant-calls.ts), all 11-13: "type every flow value...", "give every temporary the type it holds", "type chain links as their steps".
- Call resolution and inference (named-functions.ts, denotations.ts, key-denotations.ts, system-reading.ts, settle.ts, structs/structs.ts, function-values.ts, lambdas.ts, postponed.ts, body-context.ts), 11-07 to 11-13: "choose a call by what only a default decides...", "know a lone candidate's parameters in call resolution", "relate advice to requirements in either order", "capture a deferred call's operands...".
- Runtime scheduler (segment/index.ts, instance/index.ts, instance/heap.ts, runtime/natives.ts), 11-10 to 11-13: "collect after a readied call answered at once", "pass over only a decided wait's losers", "release an instance's awaited outcome...", "report a holder write only while every object...", "dispose what a round lets go of...".
- Binder visibility.ts, 10-30: five fixes, all "see a trait's/body's names ...".

## Fix scopes: count and distinct two-level folders touched
|scope|fixes|folders|
|---|---|---|
|checker|150|17|
|runtime|26|25|
|language-service|19|13|
|lifetimes|16|6|
|lowering|10|2|
|binder|10|1|
|compiler|10|12|
|parser|10|9|
|completion|5|4|
|editor|5|4|
|syntax|5|5|
|flow|4|2|
|patterns|3|5|
|compiler,runtime|1|7|

Smaller scopes (cli, formatter, language, definition, testing, naming, lsp and others): 1 to 3 fixes each, touching 0 to 5 folders.

## Notable patterns
- checker <> lowering is the top cross-feature fix co-change (28 fix commits), then checker <> syntax (15) and checker <> language-service (13).
- The fix hot zone is compiler/checker. 150 of 297 fixes carry the `checker` scope, and there are 157 files with 3+ fix commits. The densest sub-areas are recursive and associated type matches, literal construction (collections/tuples/structs, agreement.ts), lifetimes analysis and the flow builder.
- Runtime fixes are spread widely (26 fixes touching 25 folders) but concentrate in runtime/scheduler (segment, instance, heap). The `runtime` scope's fixes touch more folders than any other scope in proportion to its count.
