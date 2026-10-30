---
description: full-codebase DRY, generality, consistency, data-flow, modularity and spec audit at main @ a748669 — read before refactoring or planning debt paydown
owner: tech-lead
status: in-progress
applies_to: istalang
last_verified: 2026-10-30
last_updated: 2026-10-30
tags: [audit, dry-review, generality, consistency, architecture, spec]
---

# DRY Review (`main @ a748669`)

Report-only audit of `src/` (in layer order, lowest layer first) and `docs/spec.md` against `docs/reuse/` and `docs/work/tracker.md`.

## Checklist

- [ ] 1. `src/structures/` (including `entries/`)
- [ ] 2. `src/language/`
- [ ] 3. `src/text/`
- [ ] 4. `src/diagnostics/`
- [ ] 5. `src/definition/` (including `instructions/`)
- [ ] 6. `src/compiler/syntax/` (including `expressions/`)
- [ ] 7. `src/compiler/scanner/`
- [ ] 8. `src/compiler/parser/` — machinery & shared parts (`parse.ts`, `parser.ts`, `grammar.ts`, `brackets.ts`, `held-bodies.ts`, `reuse.ts`, `recovery.ts`, `nesting.ts`, `annotations.ts`, `docstrings.ts`, `diagnostics.ts`, `cursor/`, `layout/`, `parts/`)
- [ ] 9. `src/compiler/parser/` — grammar categories (`types.ts`, `patterns.ts`, `expressions/`, `statements/`, `declarations/`)
- [ ] 10. `src/compiler/program/`
- [ ] 11. `src/compiler/binder/`
- [ ] 12. `src/compiler/checker/` — root contracts, contexts & wiring (`check.ts`, `context.ts`, `program-inputs.ts`, `program-checker.ts`, `body-checker.ts`, `use-site.ts`, `resolved-call.ts`, `checked-pattern.ts`, `checked-field.ts`, `constant-form.ts`, `json-form.ts`, `checked-annotation.ts`, `struct-items.ts`, `denotation.ts`, `host-externs.ts`, `declaring-modules.ts`, `diagnostics/`)
- [ ] 13. `src/compiler/checker/types/`
- [ ] 14. `src/compiler/checker/inference/` & `src/compiler/checker/traits/`
- [ ] 15. `src/compiler/checker/resolution/`
- [ ] 16. `src/compiler/checker/calls/`
- [ ] 17. `src/compiler/checker/patterns/` & `src/compiler/checker/flow/`
- [ ] 18. `src/compiler/checker/rules/` (including `rules/json-forms/`)
- [ ] 19. `src/compiler/checker/declarations/` & `src/compiler/checker/closures/`
- [ ] 20. `src/compiler/checker/expressions/`, `src/compiler/checker/statements/` & `src/compiler/checker/lookup/`
- [ ] 21. `src/compiler/lowering/` — core, tables & function lowering (`lower.ts`, `context.ts`, `tables.ts`, `type-table.ts`, `names.ts`, `constants.ts`, `instances.ts`, `filling-entry.ts`, `async-fits.ts`, `bodies.ts`, `code-writer.ts`, `synthesized-code.ts`, `emit-call.ts`, `iteration.ts`, `places.ts`, `optional-chains.ts`, `patterns.ts`, `packs.ts`, `never-lowered.ts`, `function-lowering/`)
- [ ] 22. `src/compiler/lowering/boundary/` & `src/compiler/lowering/trait-objects/`
- [ ] 23. `src/compiler/lowering/expressions/` & `src/compiler/lowering/statements/`
- [ ] 24. `src/compiler/compile.ts`
- [ ] 25. `src/runtime/` — core, values, snapshot, lifetimes & interpreter (`natives.ts`, `store.ts`, `refusal.ts`, `random-seed.ts`, `instance-state.ts`, `instance-group.ts`, `settle.ts`, `host.ts`, `values/`, `snapshot/`, `lifetimes/`, `interpreter/`)
- [ ] 26. `src/runtime/scheduler/`, `src/runtime/boundary/` & `src/runtime/testing/`
- [ ] 27. `src/stdlib/` — infrastructure & prelude (`std-sources.ts`, `stdlib-loader.ts`, `std-module.ts`, `std-modules.ts`, `natives.ts`, `native-values.ts`, `numeric.ts`, `positions.ts`, `ranges.ts`, `prelude/`)
- [ ] 28. `src/stdlib/` — standard library modules (`collections/`, `crypto/`, `decimal/`, `fanout/`, `futures/`, `inbox/`, `json/`, `log/`, `math/`, `random/`, `regex/`, `rpc/`, `runtime/`, `strings/`, `testing/`, `time/`)
- [ ] 29. `src/formatter/`
- [ ] 30. `src/project/`
- [ ] 31. `src/language-service/` — core, navigation, semantic-tokens & editor queries (`workspace.ts`, `checked-module.ts`, `tokens.ts`, `identifier-at.ts`, `call-at.ts`, `signatures.ts`, `docstrings.ts`, `namespaces.ts`, `folding.ts`, `symbols.ts`, `hover.ts`, `inlay-hints.ts`, `signature-help.ts`, `navigation/`, `semantic-tokens/`)
- [ ] 32. `src/language-service/completion/` (including `grammar/` and `places/`)
- [ ] 33. `src/lsp/` (including `providers/`)
- [ ] 34. `src/cli/` (including `commands/`) & `src/vscode-client/`
- [ ] 35. `docs/spec.md` — Cheat sheet, §1 Overview, §2 Lexical structure and types
- [ ] 36. `docs/spec.md` — §3 Declarations
- [ ] 37. `docs/spec.md` — §4 Expressions and control flow, §5 Persistence, §6 Slots and inboxes, §7 Lifetimes and disposal, §8 `select`
- [ ] 38. `docs/spec.md` — §9 Program structure, §10 Testing, §11 Packages, §12 Examples, §13 Open questions, §14 Future work

---

## Findings by Unit
