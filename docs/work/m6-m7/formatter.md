---
description: M6 formatter details — approved style, the formatTree contract, comment placement, layout constraints and falsifiable acceptance; read before implementing or examining the formatter
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-29
last_updated: 2026-11-05
tags: [plan, m6, formatter]
---

# M6 — Formatter

## Style (human, 2026-10-29)

The style is canonical and has no options:
- **Indent:** 2 spaces.
- **Width:** 100.
- **Broken lists:** one item per line, with no `,` at line ends, since a line break between two items separates them (spec §2, proposal 5); a one-element tuple keeps its `,`. A list on one line separates its items with `, `.
- **Blank lines:** a run of blank lines between items or statements is kept as one.
- **One-item bodies:** a one-item body stays on its header's line when it fits, with three exceptions:
  - an item that has a body of its own (`if`, `for`, `match`…), since an outer `else` would then re-attach to it;
  - a body that has a docstring;
  - anywhere the parser requires a line break.

Where the language demands a form, the printer follows it:
- a one-line `{…}` block takes `;` (spec §4);
- `elif`/`else` stand at the indentation of the line where their `if` starts (`parser/layout.ts`), not at the `if`'s column.

## Contract (owner: this phase; M7's formatting provider consumes it)

- `formatTree(tree: SyntaxTree): string | undefined` returns `undefined` when the tree has syntax diagnostics, and those diagnostics are the reason.
- A public subpath, `istalang/formatter`, takes and returns text. Adding it touches `package.json` `exports`, the `tsdown.config.ts` entry and `test/exports.test.ts`.
- `ista fmt [files…]` defaults to the project's sources. It writes in place, and `--check` lists the files that would change. A file with syntax errors is reported and left untouched. The exit codes are `cli/command.ts`'s.
- Source discovery is `cli/project.ts` `findProjectSources`. 7B moves that module to `project/`, and whichever branch merges later updates the import.

## Decisions

- **Doc printer:** `prettier`, imported from `prettier/doc` (`builders`, `printer.printDocToString`). It is sync and needs no parser or plugin. Pin it exactly, as every other dependency is.
- **Literals print from source text** (`textOf`), so `0x1F_FF`, `5d` and escapes keep their spelling. Parentheses are tree nodes and print as written.
- **Multi-line strings, templates and docstrings** are copied whole, with their `${…}` parts. Their decoded value depends on the indentation their lines share (`scanner/multi-line.ts`). A copy shifts every line by its first line's change of indentation only when that keeps the decoded value; otherwise it doesn't shift them at all.
- **Comments.** The tree keeps comments as a flat, ordered list of spans with no owner, so the formatter places them itself, as Prettier does:
  - Each comment gets its enclosing, preceding and following node.
  - It counts as own-line, end-of-line or remaining.
  - It prints as leading, trailing or dangling.
  - A comment no printer emits throws.
  - Docstrings are `doc` nodes, not comments.
- **What text alone records.** A `Block` doesn't say whether it was indented, one-line or braced, and a struct doesn't say brace or indent, nor `;` or newline. The canonical style decides these, except where the parser requires a form.
- **Layout constraints** (`parser/cursor.ts`, `parser/layout.ts`):
  - Line breaks are insignificant only inside `()`, `[]`, `${}` and the `{}` of a struct literal or pattern. A block's `{}` and a field list's `{}` keep layout. `<…>` is not a bracket.
  - Never break after `=`, before a binary operator or `.member`, or between a callee and its `(`.
  - A tag stays on its template's line.
  - A `#` comment ends its line.
- **No parser internals.** The formatter doesn't import `parser/` internals. A layout rule both sides need moves to `compiler/syntax/`.
- **The printer table** covers every node kind, the Part unions included, through `structures/kind-table.ts` `Handlers`, the binder's pattern. Extract one `needsParentheses` beside the operator tables (`bindingPower`, `refusesUnparenthesized`) only if printing needs it.

## Acceptance

Over every corpus file (export the full list from `test/corpus/programs.ts`) and every spec example that parses clean:
1. **Idempotent:** `format(format(x)) === format(x)`.
2. **Tree kept:** `dump(parse(format(x)))` equals `dump(parse(x))`, using `syntax/tree.test-kit.ts` `dump`.
3. **Comments kept:** the comments' texts, in order, are unchanged.
4. **Width:** no line is longer than 100 unless it has no legal break point (spec §2): one comment, string, template or docstring token makes it long, or it holds an import's names or an operator run outside brackets.
5. **Whitespace-insensitive (property):** a variant of the input with random whitespace inside `()`, `[]`, `${}` and struct-literal `{}` formats to the same text. Excluded: the `${}` of a multi-line literal, which is copied; gaps holding a comment; the line a multi-line literal starts on; and line breaks inside `${}`, where only spaces vary.

Also:
6. A tree with syntax diagnostics gives `undefined`. `ista fmt` leaves that file untouched, and `--check` exits non-zero when a file would change.
