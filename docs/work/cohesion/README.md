---
description: cohesion by feature — how to scan for misplaced units, crowded folders and wide files (tsm cohesion), how to triage its hits, and what the 2026-11 reorganization left; read before moving a unit, splitting a folder, or deciding where a helper belongs
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-07
last_updated: 2026-11-07
tags: [cohesion, refactor, research, architecture]
---

# Cohesion by feature

AGENTS.md: folders are by feature, and inside a phase by language construct. A unit serving one consumer belongs beside that consumer, not beside other units of its kind (`*-types.ts`, `helpers`, `records`, a `rules/` grab-bag).

**The case that surfaced it (Q42, 2026-11-06).** The body-facts table (now `compiler/checker/body/facts/`) was the only user of:
- eight pass-join functions in `lookup/pass-views.ts`;
- `RecordedBody` with its types in `body-records.ts`;
- `instantiatedRead` in `checked-field.ts`;
- all of `types/instantiation.ts`.

Moving them into the folder made the table readable in one place. The scan below showed it was a pattern, and `plan.md` (this folder) reorganized the tree by feature.

## The scan

```
tsm cohesion --exclude '**/*.test.ts' --exclude '**/*.test-kit.ts' --exclude '**/*.bench.ts' src
```

It reports four rules:
- **Misplaced exports:** every user of an export sits under one folder (their deepest common folder), and the export doesn't live there.
- **Crowded folders:** more than 10 files directly inside a folder.
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
- **Wired by a coordinator.** The checker's `program/` and `body/` wiring, lowering's `function-lowering/index.ts` and the binder's `bind-module.ts` import every construct or table they compose. A unit only they use is still filed with its feature. `--root` on those coordinators would drop these hits.
- **Feature over use site.** A feature folder gathered across layers (e.g. `checker/rules/expansion/`) keeps every part of its rule together, even when one part serves a single folder above it.

## Before and after

| Scan | Commit | Misplaced | Crowded | Wide |
| --- | --- | --- | --- | --- |
| before (`tsm-cohesion.txt`) | `5a8a7a36` | 255 | 23 | 43 |
| after (`tsm-cohesion-after.txt`) | `2633776b` | 319 | 4 | 44 |

Misplaced exports rose because sub-folders make each home deeper. A function of a shared module that serves one sub-folder now counts, where before its user and its module shared a folder. The 319 break down as:

| Kind | Hits |
| --- | --- |
| contracts | 81 |
| layer entry points | 25 |
| wired by a coordinator | 36 |
| other | 121 |

Nearly all of the "other" hits are §1 keeps of the last three kinds above (one function, engine, lowest layer).

## What remains

- **`binder/module/flow.ts`:** only `binder/constructs/` (expressions, statements) uses it, so it belongs there. `module/` and `constructs/` also import each other: `bind-module` wires the constructs, and the constructs use `local-binder`, `scope` and `flow`. Recheck that split.
- **`checker/expressions/structs/variants.ts`:** its `checkVariantName` serves `access/` (names, member-access). The module also covers names of types in value position. Consider moving it to the expressions root.
- **Wide files left by splits:**
  - vocabularies: `checker/types/type/index.ts` (27), `syntax/statements/index.ts` (17), `checker/surface/checked-body.ts` (15);
  - single-subject: `types/type/primitives.ts` (13), `types/written/pattern-types.ts` (13), `stdlib/values/results.ts` (13), `syntax/statements/targets.ts` (11), `runtime/interpreter/registers.ts` (11).
- **Wide files the plan didn't triage**, also present in the first scan: `types/parts/type-parts.ts` (12), `types/unions/unions.ts` (12), `checker/patterns/parts.ts` (11), `resolution/choosing/candidates.ts` (11), `types/fitting/expected.ts` (11).
- **Crowded, by decision:** `checker/diagnostics/` (16) is one catalog whose parts only `index.ts` reads. `parser/parts/` (11) holds pieces several categories share.

## Open questions

1. **Threshold.** Answered by the tool: tsm groups users by their deepest common folder.
2. **Which seams are contracts.** Listed in `plan.md` §1. tsm can't skip them yet: a contract or root list given to the scan would.
3. **A check in `npm run verify`.** Still open. It needs the triage above encoded first: `--root` for coordinators, contract folders skipped, and the stated exceptions.
4. **Folder-izing.** A module that becomes `name/index.ts` takes in every unit only it uses, to a fixpoint.
