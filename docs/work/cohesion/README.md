---
description: future work — units (functions, types, constants) used by exactly one other unit but filed elsewhere by kind instead of by what they serve; the scan tool, a first-pass snapshot, how to triage, and open questions; read before a cohesion refactor or when deciding where a helper belongs
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-06
last_updated: 2026-11-06
tags: [cohesion, refactor, research, architecture]
---

# Cohesion by use: units filed by kind, not by what they serve

AGENTS.md: folders are by feature, and inside a phase by language construct. Units that serve one consumer are still found filed by *kind*, beside other units of the same kind, instead of beside the one unit they exist for.

**The case that surfaced it (Q42, 2026-11-06).** The body-facts table (`compiler/checker/body-facts/`) was the only user of:
- eight pass-join functions in `lookup/pass-views.ts`;
- `RecordedBody` with its types in `body-records.ts`;
- `instantiatedRead` in `checked-field.ts`;
- all of `types/instantiation.ts`.

Moving them into the folder made the table readable in one place and shrank three unrelated files. That was one instance; the scan below suggests it is a pattern.

## The tool

`exclusive-units.py` (this folder), run from the repo root:
- `python3 docs/work/cohesion/exclusive-units.py .` lists every exported unit of `src` whose users all sit in one other file.
- `python3 docs/work/cohesion/exclusive-units.py . --into <file-or-folder>` lists, to a fixpoint, the units used only by that file or folder. This is the check for "move X and everything only it uses into `X/`". Body-facts gives 0.

It is regex-based, and `src` and `test` users both count; a unit's own `x.test.ts` counts as the unit itself. A shadowed name can over-count users, so the output is candidates to read, not verdicts.

## First pass (main at `02e00679`)

- **708** exported units have exactly one user file. Most of them are a feature split for size inside one folder, e.g. `parser/expressions/operators.ts` serving `expression.ts`. That is the intended layout, not a violation.
- **264** have their one user in a **different folder**. These are the candidates. Folder pairs with the most units:

| Units | Lives in | Only user in |
| --- | --- | --- |
| 14 | `language-service/completion/places` | `language-service/completion` |
| 11 | `lsp/providers` | `lsp` |
| 9 | `compiler/lowering/boundary` | `compiler/lowering` |
| 7 | `compiler/checker/declarations` | `compiler/checker` |
| 6 | `compiler/lowering` | `compiler/lowering/expressions` |
| 6 | `compiler/checker/traits` | `compiler/checker/resolution` |
| 6 | `compiler/checker/expressions` | `compiler/checker` |
| 5 | `compiler/checker/types` | `compiler/checker/resolution` |
| 4 | `compiler/checker/rules` | `compiler/checker/expressions`, and 4 more → `declarations` |
| 4 | `compiler/checker/closures` | `compiler/checker/expressions` |
| 4 | `runtime/interpreter` | `runtime/scheduler/segment` |

## Triage: which candidates are fine

- **Contracts.** `compiler/syntax/`, `definition/`, and the checker surface lowering imports (architecture.md) are seams; one consumer today doesn't make them private. They stay.
- **Downward entry points.** A child folder's unit used by its parent's entry, such as an `index.ts` wiring its parts, is the folder layout working as intended. Check only that the child is a real sub-feature.
- **Sibling folders are the real signal**, e.g. `traits → resolution`, `types → resolution`, `rules → expressions`, `closures → expressions`, `interpreter → scheduler/segment`. A unit serving another feature's single unit belongs with that unit.
- **Kind-named homes.** A unit sitting in a file named for its kind (`*-types.ts`, `helpers`, `utils`, `records`) while serving one feature is the pattern to break. Group by what it serves.

## Open questions

1. Is "one user file" the right threshold, or should a unit used by one *feature folder* count too? The scan could group users by folder.
2. Which seams are contracts? Make the list explicit (architecture.md's checker surface, `syntax/`, `definition/`), so the scan can skip them instead of a reader deciding each time.
3. Should this become a check (a dependency-cruiser rule or a knip-like script in `npm run verify`) once the backlog is cleared, so new code can't reintroduce it?
4. Folder-izing (`name/index.ts`): AGENTS.md triggers it only at 400 lines. Should it also trigger when a unit gains exclusive helpers elsewhere?

## Next step

Run the scan, triage the 264 by the rules above, and file the confirmed groups as tracker Q items: one per destination unit, moved structurally with no behaviour change, as Q42's move was.
