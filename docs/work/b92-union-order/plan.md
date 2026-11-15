---
description: plan for B92 — make the type table's spelling of a recursive type a function of its key, so union variant order is stable; process, one phase, acceptance criteria. Read before forking or examining it
owner: tech-lead
status: done
applies_to: compiler/lowering/tables
last_verified: 2026-11-15
last_updated: 2026-11-15
tags: [plan, b92, type-table, recursive-types]
---

# Plan: B92, union variant order

Cause: `diagnosis.md`. A union's variants are sorted by spelled member names. A recursive member that no
recursive alias names is spelled the way it was written, not by its key, so the layout and the lookup disagree.

## Process

One phase, one implementer fork in its own worktree, then a cold reviewer and a cold qa. There is one root cause
in one unit (`lowering/tables/names.ts`), so splitting would only add overhead. The change touches the persisted
Definition (variant order and names), so a cold examination is required. There is no merge review: the phase
review sees the whole diff.

## Decisions (human approval)

- **D1 (default):** with no preferred alias, a recursive type is spelled canonically from its minimized graph:
  qualified names, `~i` back-references, reusing `canonicalKey` (`recursive-terms.ts`) with leaves and structure
  spelled the way `keyType` spells them, memoized per key. That one spelling gives both the order and the names.
  Rejected: memoizing the first spelling met per key. Names would stay readable, but order and names would
  depend on traversal order and change across revisions.
- **D2 (default):** names and order change for recursive types that no alias names. This is pre-release, so
  there are no persisted instances to migrate.
- Extern keys keep their spelling (the alias the signature writes).

## Phase 1: key-stable table spelling

Scope: the table spelling (`tableSpelling` / `spelledKeyType`) per D1. Update the banners of `names.ts` and
`type-table.ts`, `docs/arch/definition.md` ("Recursive types" and the union row), and `docs/reuse/` if a
reusable unit appears.

Acceptance:
1. The `diagnosis.md` repro compiles to a valid Definition and prints `"none none"`.
2. A generic instance that passes `none` as `R.Seen?`, with `R` a group whose `Seen` is recursive, delivers
   `none`. Covers the whole matrix: `none` built and matched under either spelling.
3. Property: types with one key, reached through different aliases or associated types, have one table spelling.
4. `npm run verify` is green. The only Definition fixture changes are names of alias-less recursive types.

Post-merge (tech-lead): on `computed-forms`, a `categoryModel(graph, x)` that takes its data passes
`supplier.test.ista`. Restoring the data-taking factories belongs to the computed C3 owner.
