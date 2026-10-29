---
name: dry-review
description: Audit a codebase for missed generalization, duplication, double standards, scattered concepts, copy-and-sync state, weak modularity, and spec/domain pitfalls. Report only.
disable-model-invocation: true
---

# DRY review

Audit the codebase for the issues below. This is report-only: change no code. The only files you edit are the audit file, the reuse index, and the `AGENTS.md` files that point to it.

Tests (test files, test helpers, fixtures) are out of scope.

## What to look for

### Generality

- Solutions that solve a problem for a limited part of the domain, but could be extracted into their own module, extended independently, and applied more widely.
- Solutions hard-coded for specific types that could be generic, usable by any type and configuration (or worse, where that generic version already exists).

### Duplication and consistency

- Where is DRY violated? Where are there double standards (different solutions, designs, or paradigms for similar problems)?
- Which features or semantic concepts are scattered across multiple units of code?

### Data flow

- Do we derive computations where they're needed (caching them if expensive), or do we clone, precompute, and then sync copies all over the place?

### Architecture

- Is every subsystem (each pipeline stage, layer or feature area) modular: a registry where features plug in, each developed as a standalone, separate plugin?
- Do modules depend on one another just to reuse a solution that could be extracted, generalized, and shared by both (and potentially others)?

### Spec and domain design

- Tricky parts of the spec or requirements that could be generalized, instead of forcing small specialized code for each section.
- Pitfalls of comparable systems (other languages, frameworks or products in the same domain) that we've solved, and pitfalls we still have compared to them.

## How to work

1. **Orient.** Read the project's agent instructions (`AGENTS.md`, `CLAUDE.md`) and docs index, and locate: the reuse index (e.g. `docs/reuse/`), the architecture or layering doc, the spec or requirements, the doc conventions (e.g. front-matter), and the folder that holds audits (e.g. `docs/audit/`). Use what exists; the steps below give the fallbacks.
2. **Read the reuse index first.** It lists the reusable units already in the codebase, grouped by caller need, so you can tell when code narrows, hard-codes or duplicates one. [references/build-reuse-index.md](references/build-reuse-index.md) defines its format, its entry rules and the `AGENTS.md` pointers to it. If the project has no index, build it first as that file describes, then start the audit. Keep it complete as you go: add any reusable unit or one-way rule it misses, fix entries that are wrong, and keep the `AGENTS.md` list of its files in sync.
3. **Start or resume the audit file.** If the audits folder holds an audit with `status: in-progress`, resume it from its first unchecked unit. Otherwise, create `dry-review-<YYYY-MM-DD>.md` there (in `docs/audit/` if the project has none), with front-matter that follows the project's doc conventions plus `status: in-progress`, the commit you're auditing, and a checklist of every unit to review: each source folder in layer order (from the architecture doc, otherwise the import graph; lowest layer first), then each top-level section of the spec.
4. **Review unit by unit, systematically.** Work through the checklist in order, file by file within each folder. Record each finding under its unit as soon as you find it; don't save findings for the end. Tick a unit only once its findings are written, so an interrupted run can resume from the file alone.
5. **Final pass.** Once every unit is ticked, re-review every finding with the full context you now have: merge duplicates and findings with a shared root cause, drop ones that later units disproved, widen ones that turned out larger, and add cross-unit findings that are only visible now. Then put a ranked summary at the top and set `status: active`.
