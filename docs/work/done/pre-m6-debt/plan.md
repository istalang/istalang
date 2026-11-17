---
description: plan for the debt paid before M6 (formatter) and M7 (language service) — read before working on Q4, Q5, Q10, Q28, B3 or B12
owner: tech-lead
status: archived
applies_to: istalang
last_verified: 2026-10-29
last_updated: 2026-10-29
tags: [plan, debt, m6, m7]
---

# Debt before M6/M7

The tracker items whose shape M6 and M7 consume: syntax nodes a formatter walks, names and types a language service shows. Each item's row in `docs/work/tracker.md` is its task.

**Process:** three forks in parallel, one per branch. The items inside a branch share files, so each branch's items run in order. One pi root reviewer reads the code these items touch while the forks build. Each fork, when done, forks the root reviewer to review its own diff, so no reviewer starts cold. A last fork of the root reviewer does the merge review. No separate qa: the structural items are covered by `test/corpus` and the check, lower and run tests, and the two behaviour items (B3, B12) each start with a failing test.

| Branch | Items, in order | Area |
| --- | --- | --- |
| `debt-declarations` | Q4, Q5, B12 | Shared structs, `new X{…}`, field defaults and struct rules: syntax, parser, checker declarations, lowering's type table, Definition roles. Q4 and Q5 both reshape struct declarations and their synthesized functions, so they run in order. |
| `debt-names` | Q10, Q28 | What a name means: own calls (`f.` bound in the binder), identifier lookup. |
| `debt-type-text` | B3 | A type remembers the alias it was written through. Only the type's text reads it; equality and keys ignore it. |

**Acceptance:**
- **Q4:** no consumer tells a shared struct or `new X{…}` apart by a flag; the Definition has distinct roles for a shared struct's cell and a captured `let`'s.
- **Q5:** a field default is an entry of its own, named by owner and field; no module-level `WeakSet`; `FunctionDeclaration.owner` keeps its TSDoc's meaning.
- **B12:** expanding generic recursion is reported at the declaration, with spec §3.1 worded by the human; no type walk overflows on it.
- **Q10:** `f` before `.` means the same thing to the binder, the checker and lowering; lowering has no name-resolution override.
- **Q28:** one variable-type lookup.
- **B3:** diagnostics name a value by the alias it was written through (`Entries<int>`).

**Shared surface:** `types/type/index.ts` and `types/type-text.ts` (Q4, B3). Q4 replaces the shared-struct flag there; B3 adds only the alias. The branch that merges later rebases.

**Out of scope:** Q3, P5 and Q14 are design decisions for M7's plan.
