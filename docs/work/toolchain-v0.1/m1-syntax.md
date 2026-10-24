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

Branch `m1-syntax`. Every phase runs with `qa` and `reviewer`: 1.1 sets the conventions everything inherits, and 1.2–1.3 define the tree, a high-fan-in contract. The spec-gap defaults (G1–G14, at the end) are proposals awaiting approval.

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
- Every §2 lexical form gets the right kind and value. Each malformed form (G4–G8) gives one diagnostic at the right span, and scanning continues.
- `firstOnLine` is correct.
- Every fence in the spec scans with zero diagnostics, except a fence that uses `…` as a placeholder for omitted code: there, `…` is the only thing reported.

## 1.2 Parser machinery, types, patterns, expressions

**Scope**
- Machinery: cursor, speculation (mark/reset), recovery and the Pratt tables.
- Every type form: named and generic, `T?`, tuple, function and async function, anonymous struct, `&T`, `Self`.
- Every pattern form (§3.11).
- Every expression form that has no indented body (§2–§4): literals, struct literals (all four forms plus spread), lambdas, comprehensions, calls with type arguments, `&`/spread arguments, indexing and slicing, open ranges, `?` `?.` `??` `$`, `is`, `await`, and every operator at its §3.9 precedence.

**Acceptance**
- Table-driven tree assertions cover every form above, plus G9–G12.
- Precedence property: random operator trees, printed with full parentheses and with minimal parentheses per the table, both re-parse to the same tree.
- Totality property:
  - Random token sequences never throw.
  - Child spans lie within their parent's and are ordered.
  - Every error yields at least one diagnostic.
  - Recovery never consumes past an unmatched closing bracket.

## 1.3 Layout, statements, control flow, declarations, modules

**Scope**
- Layout (G13–G14): indentation blocks, one-line bodies, `{}` block expressions with layout inside them, even within `(…)`.
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

## Spec gaps (proposed defaults)

| # | Gap | Default |
| --- | --- | --- |
| G1 | Indentation characters | Spaces only. A tab in leading whitespace is an error. Any consistent width is accepted. |
| G2 | Line endings | `\n`, `\r\n` and `\r` all end a line. A leading BOM is skipped. |
| G3 | Identifiers | ASCII letters, digits and `_`. No Unicode identifiers in v0.1. Strings and comments may contain any Unicode. |
| G4 | Reserved words | `fn async await let const if elif else for in while match case select return break continue struct enum trait import extern spawn defer drop is and or not true false none as`. Three words are keywords only by position, and plain identifiers elsewhere: `type` (alias declaration; still usable as a field name, §9), `from` (import clause; `T.from`, §3.10) and `sendable` (after `extern`). |
| G5 | Numbers | `_` only between digits. A float needs digits on both sides of `.`, so `2.pow(10)` and `0..10` scan as an int followed by `.` or `..`. Exponent `e` or `E`. Radix prefixes are lowercase only (`0x`, `0b`). Hex digits in any case. No octal. |
| G6 | Durations | An integer magnitude plus `ms`, `s`, `m`, `h` or `d`, with no space between. `1.5h` is an error. |
| G7 | Strings | Single-line only. A raw newline means the string is unterminated. `\u{…}` takes 1–6 hex digits naming a Unicode scalar value (no surrogates). Any other escape is an error. |
| G8 | Comments | `#` to the end of the line. No block or doc-comment syntax. Tooling may treat a `#` run directly above a declaration as its doc. |
| G9 | Generic call | `name<…>` is taken as type arguments when the bracket contents parse as types and are followed by `(` or `{`. The `{` case covers a generic struct literal such as `Pair<int, string>{…}`. |
| G10 | `{` in an expression | It starts a struct literal right after a name or qualified name (any case), `struct`, or a type-argument `>`. Anywhere else it starts a block. No grammar rule puts a block directly after a name, so the parser never looks at case. The checker reports a name that isn't a struct or variant. |
| G15 | Naming conventions | §2 and §3.1 state these as rules: PascalCase for types, camelCase for values. In M2 the binder reports a violation as an error. The parser doesn't depend on them. |
| G11 | `&` | Allowed only as a whole call argument, or in a parameter type. Anywhere else it is a parse error. |
| G12 | Commas | A trailing comma is allowed in every comma-separated list. |
| G13 | Continuation | A newline is ignored only inside `(…)`, `[…]` and struct-literal braces. There is no backslash continuation. Inside field-list braces (types, one-line struct/enum declarations), a newline separates entries just like `;`. |
| G14 | Continuation keywords | `elif`, `else` and `case` continue a construct when they stand at the column where that construct's line starts. This covers a multi-line `if` expression used as an initializer (§4). |
