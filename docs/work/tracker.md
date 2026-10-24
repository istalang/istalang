---
description: status of toolchain milestones and filed debt/out-of-scope items — read to know what is done, in flight, or deferred
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-24
last_updated: 2026-10-24
tags: [tracker]
---

# Tracker

## Milestones (plan: `docs/work/toolchain-v0.1/plan.md`)

| Milestone | Status |
| --- | --- |
| M1 Syntax | planned |
| M2 Skeleton | planned |
| M3 Feature slices | planned |
| M4 Standard library | planned |
| M5 Test runner | planned |
| M6 Formatter | planned |
| M7 Language service and LSP | planned |
| M8 Packages | planned |

## Filed

| # | Item | Source | Status |
| --- | --- | --- | --- |
| D1 | `InstanceStore` must store the Definition once by content hash; instances reference it, never embed a copy (arch says "persisted with each instance" — N copies per `spawn`) | plan review 2026-10-24, arch A2 | resolved: arch `lower` row / InstanceStore (2026-10-24) |
| D2 | Layer-DAG import rule and the 400-line file limit are "enforced by lint" but no mechanism is named; Biome covers cycles/restricted imports only. Decide (dependency-cruiser, per-folder Biome overrides, or custom script) in M1.1 scaffold | plan review 2026-10-24, arch A8 | resolved: arch Layers › Mechanisms (2026-10-24) |
| D3 | Scanner `#startsLexemeOrTrivia` re-encodes the lexeme-start dispatch of `#scanLexeme`/`#skipTrivia`; a lexeme start added to one and not the other is silently swallowed by an `unknown` run. One classifier, used by both (DRY) | M1.1 phase review 2026-10-24 | resolved: one `#lexemeScannerAt` classifier (2026-10-24) |
| D4 | The valid string escapes live twice: `simpleEscapes` in `scanner/strings.ts` and the hard-coded list in the `invalidEscape` message. Derive the message from the table (DRY) | M1.1 phase review 2026-10-24 | resolved: message lists `validEscapes`, derived from the table (2026-10-24) |
| D5 | Per-phase code blocks (scanner 1000s, parser 2000s…) are convention only: `defineDiagnostics` rejects duplicates within one catalog, not codes outside the phase's block, so cross-catalog collisions pass. Make the block a parameter and check it | M1.1 phase review 2026-10-24 | resolved: `code-blocks.ts` assigns blocks; `defineDiagnostics(phase, …)` rejects codes outside the phase's block (M1.2) |
| D6 | Parser `Cursor` has two views of the stream: `kind`/`at`/`eat` respect line regions, while `token`/`advance` ignore them. Grammar code that reads `token` without first dispatching on `kind` silently crosses a line break, and `parsePrimaryPattern` needs an explicit `case 'lineBreak'` to avoid it. Settle this when 1.3 adds layout: make the default view line-aware, and give the statement layer one explicit way to step over a break (contain complexity) | M1.2 phase review 2026-10-24 | open |
| D7 | A type-argument list closed by a `>` glued to `=` (`let xs: Array<int>= []`) fails with two diagnostics, because the scanner emits `>=`. Split the token when closing `<…>`, or record "space required" as a G-gap | M1.2 phase review 2026-10-24 | open |
| D8 | Totality property "every error yields a diagnostic" passes whenever any one diagnostic exists, so with token soup it is close to vacuous. Strengthen it: apply one mutation to a valid printed tree, then assert at least one diagnostic or unconsumed tokens | M1.2 phase review 2026-10-24 | resolved: `recovery.test.ts` "no silent errors" breaks valid expressions (drops a parenthesis or inserts a token no expression contains) and asserts a diagnostic or unparsed tokens (M1.2) |
| D9 | Parser nits: `isNode` is duplicated in `syntax/tree.ts` and `tree.test-kit.ts`; `Cursor.#innermost`'s fallback region is dead (the root region always exists); `parseCollection` consumes `[:]` through an array literal built only for its side effects | M1.2 phase review 2026-10-24 | resolved: `isNode` exported from `tree.ts`; the cursor keeps `#current` plus `#enclosing`; `[:]` consumed in a block (M1.2) |
| D10 | List shells restate what `closerOf` already knows: `parseDelimited`/`parseEnclosed`/`parseEntries` take an opener the caller consumed plus a closer the caller spells out, at 12 sites; the three `(…)` parsers (expression, type, pattern) repeat the tuple-or-grouped ternary. Let the list functions consume the opener, derive the closer from `closerOf` (add `<`), and return the list's span (DRY, contain complexity) | M1.2 phase review 2 2026-10-24 | resolved: `parseEnclosed`/`parseDelimited`/`parseEntries` consume the opener and take the closer from `openers` in cursor.ts, and return the span; the `(…)` parsers are one ternary each (M1.2) |
| D11 | Test helpers redefined per file: `named`/`type`/`int`/`param` dump builders in five parser test files, and the "reports %j once" `reported(…)` → `{codes, spanTexts}` assertion in seven. One home in `parse.test-kit.ts` (B.6) | M1.2 phase review 2 2026-10-24 | resolved: `named`, `int` and `reportedOnce` live in `parse.test-kit.ts`, mirroring the scanner kit, so helpers still return observations (M1.2) |
| D12 | The `[async] fn` head is parsed twice (`parseLambda`, `parseFunctionType`); 1.3's `fn` declaration makes a third. Extract `parseFunctionHead` into `parts/` when 1.3 adds it | M1.2 phase review 2 2026-10-24 | resolved: `parts/functions.ts` `parseFunctionKeyword`, used by lambdas and function types (M1.2) |
| D13 | Parser nits: `parseCollection` opens the `]` region twice (peek, then consume `[:]`) because `parseDelimited` opens its own; `structLiteralParselet` uses `path && …` where the rest uses `=== undefined`; `parseEntry` re-checks `lineBreak` that `atListEnd` covers; `parseFunctionType` tests `opener === undefined` twice; `binaryOperatorLevels` keys are `string`, not checked against `TokenKind`, so `binaryParselets` spreads untyped keys into the infix table | M1.2 phase review 2 2026-10-24 | resolved: one region per collection, `=== undefined` checks, `atRegionEnd` covers line breaks, one `(` check in function types, `binaryOperatorLevels` satisfies `Partial<Record<TokenKind, …>>` (M1.2) |
