# DRY research brief (shared by every area agent)

Repo: /Users/arash/Projects/istalang (Istalang compiler/runtime/toolchain, TypeScript). Read `AGENTS.md` and
`docs/arch/architecture.md` first, then the `docs/reuse/*.md` files relevant to your area (they index the reusable
units that already exist; anything you find that re-implements one of them is a finding).

You are a RESEARCH agent. Change NO repository file. Write only the two output files named in your task.
Scope: non-test `.ts` (skip `*.test.ts`, `*.test-kit.ts`), plus `.ista` where your task says so.
You own ONE area (in your task) and must read EVERY file of it fully. You may grep/read outside it to check
callers or compare with similar code elsewhere.

The project lead (who will merge every area's output and find cross-area issues) complains: adding/changing a
feature now needs edits in many places. Find the root causes.

## Output 1: `<area>-catalog.md` — a compact catalog of your area
For every file, in folder order:
```
## path/to/file.ts — <one-line gist of the banner: what it owns>
- name(sig-short) — what it does, in the CALLER's words; [exp]=exported; callers: N outside folder (grep)
```
List every exported symbol and every internal function/method ≥ 6 lines. One line each, ≤ 170 chars. No prose.
End the catalog with a `## Concept footprint` section: for each LANGUAGE concept your area handles (e.g. Optional/None,
Result, unions, enums/variants, any/trait objects, futures/await/select, marks/kinds (live/ista/simple), sendable,
shared structs, extern types, field loops/passes, comprehensions, deferred calls, spawn/defer, context consts,
disposal/lifetimes/holders, recursive aliases/type match, struct keys/keyof, variance, packs, indented values,
defaults/fields functions, codecs/JSON, witnesses/traits, places/&refs, patterns, templates, ranges, comparisons…),
list every function in your area that special-cases it: `concept: file:function, file:function, …`.
This footprint is the most important cross-area input: be exhaustive.

## Output 2: `<area>-findings.md` — ranked candidate findings, each with evidence
Look for:
1. **DRY violations**: two+ functions doing the same/similar job (even with different names/signatures), parallel
   switches/Handlers over the same kinds encoding one rule twice, a rule/constant/list spelled in several places,
   a reusable unit from docs/reuse re-implemented by hand.
2. **Generalization**: several near-identical versions of one function for different types/cases that one generic
   function could serve; a special case that a general mechanism already covers.
3. **Dead code (logical, not just unused exports)**: params always passed the same value, branches that can't be
   taken, options no caller sets, fallbacks for states that can't occur, code kept for a feature that was replaced,
   exports used only by tests, wrappers that only forward.
4. **Feature reduction**: a language feature implemented with its own machinery although it could be reduced to
   (desugared into) another existing feature (the project's principle: e.g. Optional is a union with None, unions
   are laid out as enums). Flag any place where two features have parallel implementations.
5. **Belongs in .ista**: TS natives/builtins/compiler special-cases that could be written in Istalang itself (std
   `.ista` modules) on top of existing features.
6. **Double standards**: different designs for the same problem in different places.
Each finding: `### [high|med|low] title` then `- where:` file:line(s), `- evidence:` the concrete code facts
(quote names, short snippets), `- proposal:` the unification (which unit becomes the one home; which call sites
change), `- confidence:` high/med/low. Verify by reading the code; no speculation without evidence. Prefer fewer,
real findings over many vague ones, but be thorough: the lead wants everything real.
Also list `## Missing from docs/reuse`: reusable exported units in your area (with callers outside their folder) that
`docs/reuse/*.md` does not list, and entries there that are wrong/stale for your area (symbol renamed/moved/gone).

## Report
When both files are written, `hcom send @leve --intent inform -- '<area> done: <paths>'`, then STAY ALIVE (keep
listening): the lead will send you follow-up questions or fork you to verify cross-area candidates.
