---
name: spec-renumbered
description: the spec was split into docs/spec/ and renumbered on 2026-11-19; § numbers in done plans, proposals/done, audits and reviews are the OLD numbering
metadata:
  type: project
---

On 2026-11-19 the spec moved from `docs/spec.md` to `docs/spec/` (one file per subsection, 21 chapters) and was renumbered; every live § reference (src, test, guide, arch, reuse, active proposals) was rewritten.

**Why:** the old §2/§3 mixed lexical rules, types, stdlib and patterns; the user asked for one home per concept.

**How to apply:** § numbers in `docs/work/done/`, `docs/proposals/done/`, `docs/audit/`, `docs/review/` (before 2026-11-19) use the old numbering — translate via `docs/spec/README.md` by topic, never by number. Spec examples are test inputs keyed by section title (`test/corpus/spec-examples.ts`, `check.test.ts` `uncheckedExamples`), so renaming a spec heading means updating those keys.
