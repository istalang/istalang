---
description: cohesion by feature — how to scan for misplaced units, crowded folders, loose files and wide files (tsm cohesion), how to triage its hits, and what the 2026-11 reorganization and folder-shape pass left; read before moving a unit, splitting a folder, or deciding where a helper belongs
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-07
last_updated: 2026-11-07
tags: [cohesion, refactor, research, architecture]
---

# Cohesion by feature

AGENTS.md: folders are by feature, and inside a phase by language construct. A unit serving one consumer belongs beside that consumer, not beside other units of its kind (`*-types.ts`, `helpers`, `records`, a `rules/` grab-bag).

**The case that surfaced it (Q42, 2026-11-06).** The body-facts table (now `compiler/checker/wiring/body/facts/`) was the only user of:
- eight pass-join functions in `lookup/pass-views.ts`;
- `RecordedBody` with its types in `body-records.ts`;
- `instantiatedRead` in `checked-field.ts`;
- all of `types/instantiation.ts`.

Moving them into the folder made the table readable in one place. The scan below showed it was a pattern, and `plan.md` (this folder) reorganized the tree by feature. `folders-plan.md` then regrouped wide folders and the loose files beside sub-folders.

## The scan

```
tsm cohesion --exclude '**/*.test.ts' --exclude '**/*.test-kit.ts' --exclude '**/*.bench.ts' --max-loose-files 4 src
```

It reports five rules:
- **Misplaced exports:** every user of an export sits under one folder (their deepest common folder), and the export doesn't live there.
- **Crowded folders:** more than 10 files and sub-folders directly inside a folder.
- **Loose files:** more than 4 files beside the sub-folders of a folder. Opt-in: checked only with `--max-loose-files`.
- **Long files:** more than 500 lines of code.
- **Wide files:** more than 10 exports in a file.

Pass every check's flags. The saved scans omitted `*.bench.ts`, which adds one file each to `parser/` and `language-service/`.

The output is candidates, not verdicts. Read each hit against the triage below.

## Triage

`plan.md` §1 lists the hits that stay, by kind:
- contracts and vocabularies (`syntax/`, `definition/`, `language/`, `structures/`, `text/`, `diagnostics/`, `binder/entities.ts`, the checker's `surface/`);
- layer entry points used by the layer above;
- app-level helpers (`cli/`);
- one function of a cohesive module;
- an engine used by one construct;
- a unit already at the lowest layer serving all its users.

The reorganization added two kinds:
- **Wired by a coordinator.** The checker's `wiring/` (program and body), lowering's `functions/index.ts` and the binder's `bind-module.ts` import every construct or table they compose. A unit only they use is still filed with its feature. `--root` on those coordinators would drop these hits.
- **Feature over use site.** A feature folder gathered across layers (e.g. `checker/rules/expansion/`) keeps every part of its rule together, even when one part serves a single folder above it.

## Before and after

| Scan | Commit | Misplaced | Crowded | Loose | Wide |
| --- | --- | --- | --- | --- | --- |
| before (`tsm-cohesion.txt`) | `5a8a7a36` | 255 | 23 | | 43 |
| after (`tsm-cohesion-after.txt`) | `2633776b` | 319 | 4 | | 44 |
| folder shape, before (`tsm-cohesion-2.txt`, `--all`) | `16b7c1ff` | 319 | 2 | | 44 |
| folder shape, after (`tsm-cohesion-3.txt`, `--all`) | `b08bbe5a` | 337 | 2 | 13 | 44 |

The first three scans count only files as crowded; the last counts files and sub-folders. Its 2 crowded folders are by decision (below).

Misplaced exports rose because sub-folders make each home deeper, again in the folder-shape pass (319 to 337). A function of a shared module that serves one sub-folder now counts, where before its user and its module shared a folder. The 319 break down as:

| Kind | Hits |
| --- | --- |
| contracts | 81 |
| layer entry points | 25 |
| wired by a coordinator | 36 |
| other | 121 |

Nearly all of the "other" hits are §1 keeps of the last three kinds above (one function, engine, lowest layer).

## What remains

- **`binder/module/flow.ts`:** only `binder/constructs/` (expressions, statements) uses it, so it belongs there. `module/` and `constructs/` also import each other: `bind-module` wires the constructs, and the constructs use `local-binder`, `scope` and `flow`. Recheck that split.
- **`checker/constructs/expressions/structs/variants.ts`:** its `checkVariantName` serves `access/` (names, member-access). The module also covers names of types in value position. Consider moving it to the expressions root.
- **Wide files left by splits:**
  - vocabularies: `checker/types/type/index.ts` (27), `syntax/statements/index.ts` (17), `checker/surface/checked-body.ts` (15);
  - single-subject: `types/type/primitives.ts` (13), `types/written/pattern-types.ts` (13), `stdlib/values/results.ts` (13), `syntax/statements/targets.ts` (11), `runtime/interpreter/registers.ts` (11).
- **Wide files the plan didn't triage**, also present in the first scan: `types/parts/type-parts.ts` (12), `types/unions/unions.ts` (12), `constructs/patterns/walk/parts.ts` (11), `resolution/choosing/candidates.ts` (11), `types/fitting/expected.ts` (11).
- **Crowded, by decision:** `stdlib/` (22) has one folder per std module; `runtime/` (11) keeps its four contracts at its root, since inside `host/` they would make `host/` and `scheduler/` import each other.
- **Loose files** (more than 4 beside sub-folders), 13 folders:
  - by decision (`folders-plan.md`): `stdlib/`; `formatter/` (6: construct printers, peers of `expressions/`); `parser/grammar/` (5: categories and wiring beside the category folders); `completion/places/` (7) and `lsp/providers/` (8), one provider per file.
  - files that are construct peers of one family folder, untriaged: `syntax/expressions/` (9, beside `literals/`), `parser/grammar/expressions/` (7, beside `literals/`), `constructs/patterns/walk/` (6, beside `kinds/`), `foundation/structures/` (9, beside `entries/`), `foundation/language/` (7, beside `well-known/`), `cli/` (8, beside `commands/`), `language-service/completion/` (8, beside `places/` and `presentation/`), `editor/lsp/` (5, beside `providers/`).

## Open questions

1. **Threshold.** Answered by the tool: tsm groups users by their deepest common folder.
2. **Which seams are contracts.** Listed in `plan.md` §1. tsm can't skip them yet: a contract or root list given to the scan would.
3. **A check in `npm run verify`.** Still open. It needs the triage above encoded first: `--root` for coordinators, contract folders skipped, and the stated exceptions.
4. **Folder-izing.** A module that becomes `name/index.ts` takes in every unit only it uses, to a fixpoint.
