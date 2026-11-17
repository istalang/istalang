---
description: M1 (syntax) phase details — scope, falsifiable acceptance criteria and lexical/layout spec-gap defaults for scanner and parser; read before implementing or examining an M1 phase
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-24
last_updated: 2026-10-24
tags: [plan, m1, scanner, parser]
---

# M1 — Syntax

Branch `m1-syntax`. Every phase runs with `qa` and `reviewer`: 1.1 sets the conventions everything inherits, and 1.2–1.3 define the tree, a high-fan-in contract. The spec gaps found while planning are resolved in `docs/spec.md`.

## 1.1 Scaffold, text, diagnostics, scanner

**Scope**
- Scaffold:
  - `package.json` (scripts for build, typecheck, lint, test), tsconfig (strict, nodenext, erasable syntax only), `biome.json` (preset `all`, tuned to one convention), vitest + fast-check
  - `.editorconfig`, `.gitignore`, `README.md`, and AGENTS.md at the root and in each major folder
- `text/`, `diagnostics/` (model + per-phase catalog helper; the renderer comes in M2), and `compiler/syntax/` token kinds.
- `compiler/scanner/`.
- A corpus helper that reads the fenced examples of `docs/spec.md` at test time, tagged by section. No copies are generated.

**Acceptance**
- build, typecheck, lint and test all pass. Lint fails a file over 400 lines, an import cycle, and an upward import between the existing layers.
- Totality and losslessness are property tests over arbitrary strings, including random Unicode and broken literals:
  - `scan` never throws.
  - Tokens, comments and whitespace tile the input exactly, ordered and contiguous.
- Every §2 lexical form gets the right kind and value. Each malformed form gives one diagnostic at the right span, and scanning continues.
- `firstOnLine` is correct.
- Every fence in the spec scans with zero diagnostics, except a fence that uses `…` as a placeholder for omitted code: there, `…` is the only thing reported.

## 1.2 Parser machinery, types, patterns, expressions

**Scope**
- Machinery: cursor, speculation (mark/reset), recovery and the Pratt tables.
- Every type form: named and generic, `T?`, tuple, function and async function, anonymous struct, `&T`, `Self`.
- Every pattern form (§3.11).
- Every expression form that has no indented body (§2–§4): literals, struct literals (all four forms plus spread), lambdas, comprehensions, calls with type arguments, `&`/spread arguments, indexing and slicing, open ranges, `?` `?.` `??` `$`, `is`, `await`, and every operator at its §3.9 precedence.

**Acceptance**
- Table-driven tree assertions cover every form above, plus the rules of §3.5 (generic calls), §3.7 (`&`), and §2 (braces, trailing commas).
- Precedence property: random operator trees, printed with full parentheses and with minimal parentheses per the table, both re-parse to the same tree.
- Totality property:
  - Random token sequences never throw.
  - Child spans lie within their parent's and are ordered.
  - Every error yields at least one diagnostic.
  - Recovery never consumes past an unmatched closing bracket.

## 1.3 Layout, statements, control flow, declarations, modules

**Scope**
- Layout (§2 continuation, §4 one-line bodies and continuing a construct): indentation blocks, one-line bodies, `{}` block expressions with layout inside them, even within `(…)`.
- Every statement form.
- `if`/`match`/`select` as expressions (multi-line and one-line).
- Every declaration form, annotations, imports, and the top-level-only rule.

**Acceptance**
- Every full-program fence in the spec parses with zero diagnostics, including all of §12. Fragment fences are classified by an explicit list that gives a reason for each.
- Table-driven invalid cases, one per layout rule (unexpected indent, inconsistent dedent, `;` after a one-line body, a one-line block without `;`, a top-level statement):
  - Each gives the specified diagnostic code at the right span.
  - Declarations after the error still parse.
- Totality property over corpus mutations (random deletion, duplication and swapping of lines and tokens): never throws, and spans stay nested and ordered.
- A 10k-line synthetic module scans and parses in under 200 ms.

## Spec gaps

Resolved and stated in `docs/spec.md`: §2 (source text, literals, braces), §3.1 (naming), §3.5 (generic-call parsing), §3.7 (where `&` stands), §4 (one-line bodies, continuing a construct). The spec is their only home.
