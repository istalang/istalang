---
description: diagnostic model, per-phase catalogs, code blocks, rendering and test assertions — read before adding, reporting, rendering or testing diagnostics
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-29
last_updated: 2026-11-04
tags: [reuse, diagnostics, errors, testing]
---

# Diagnostics

## Units

- declare a phase's diagnostic catalog with typed message factories and code checks → `defineDiagnostics` (`src/foundation/diagnostics/catalog.ts`)
- look up a phase's 1000-code block → `codeBlocks`, `codeBlockSize`, `DiagnosticPhase` (`src/foundation/diagnostics/code-blocks.ts`)
- test whether a `Diagnostic` is an error (stops compilation) vs a warning → `isError`, `Diagnostic`, `Severity` (`src/foundation/diagnostics/diagnostic.ts`)
- list diagnostics in their one order: position, then code and message → `compareDiagnostics` (`src/foundation/diagnostics/diagnostic.ts`)
- format one `Diagnostic` with `path:line:column` header, source line and caret → `renderDiagnostic` (`src/foundation/diagnostics/render.ts`)
- write all module diagnostics with an error and warning summary count → `reportDiagnostics` (`src/cli/report.ts`)
- report command-line paths that name no file → `reportUnreadable` (`src/cli/report.ts`)
- one module's diagnostics from every phase, sorted (an editor's document) → `diagnoseModule` (`src/compiler/compile.ts`); every module's → `diagnose`

## One-way rules

- Never build a `Diagnostic` literal by hand; call the typed factory in the phase's `diagnostics.ts` catalog (`src/foundation/diagnostics/catalog.ts`). A factory makes a `Diagnostic<Where>` at a span of either kind: the binder and checker report at anchored spans and convert as their diagnostics leave (`diagnosticIn`); the scanner, parser and program report at text spans.
- Each phase returns its diagnostics as values with its result; there is no global sink (`docs/arch/architecture.md`, Phase contracts).
- Tests assert `reportedIn(source, diagnostics)` against codes and span texts, never message wording or raw offsets (`src/foundation/diagnostics/diagnostic.test-kit.ts`).

## Recipes

### Add a diagnostic code

1. Pick the next unused code in the phase's block (`src/foundation/diagnostics/code-blocks.ts`).
2. Add `name: { code, severity?, message: (...) => ... }` to the phase's `diagnostics.ts` (or `src/compiler/checker/diagnostics/`).
3. Call the factory at the offending `Span` (or `UseSite` in the checker) and assert it with `reportedIn` / `reportedOnce`.
