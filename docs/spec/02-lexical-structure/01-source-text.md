---
description: blocks, comments, statement and list separators, indentation, line breaks, line continuation inside brackets, trailing commas, identifiers; read before changing the scanner, the parser's lists or the formatter's line breaking
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 2.1 Source text

Blocks are defined by indentation, as in Python. Comments start with `#` and run to the end of the line; there are no block comments. Top-level declarations may appear in any order. A `;` separates statements written on one line, and only statements: `a = 1; b = 2`. Every list separates its items with `,`: the items in brackets, the fields of a struct or a variant, an enum's variants, a trait's members, a struct constraint's entries and a struct's associated types, in braces or on one line of an indented body alike. A `,` can't separate statements, since it already continues one that starts with targets (`a, b = (b, a)`, §4.5). So a `;` between a list's items, and a `,` between statements, are compile errors. The cases of a `match`, a `select` and a type `match` are neither: they stand one per line.

**Source text.**

- **Indentation** uses spaces only: a tab in a line's leading whitespace is a compile error. Any consistent width works.
- **Line breaks** are `\n`, `\r\n` or a lone `\r`. A byte order mark at the start of a file is ignored.
- **Continuation.** Inside a bracketed list a line break separates two items, as `,` does, where the item before it could end there and the next line's first token can start an item; anywhere else in brackets it is ignored, so an item spans lines. The lists are the items of `(…)`, `[…]` and `<…>`, an import's parenthesized names among them, a struct literal's and a struct pattern's braces, and the braces that list fields or variants, as in `{ sku: String, qty: Int }`. An import's bare names stay on its line (§13.1). Outside brackets the one expression that continues past a line break is an indented value (§3.2), whose block stands on the lines after its opening. There is no backslash continuation.
  - **What starts an item:** a name, a literal, a template, `true`, `false` or `none`; an opening bracket; `fn`, `async`, `if`, `struct`, `new`, `not`, `await`, `for`, `...` or `@`; and `-`, `*`, `&`, `..` or `..=` glued to its operand (`-1`, `*x`, `&x`, `..5`) or alone at its line's end (a lone `..`, the range open at both ends), so each line of a broken list reads back as its item. In an import's parentheses `*` always starts an item, so `* as m` may head a line (§13.1).
  - **What continues the item:** a binary operator, `not in` among them; `-`, `*`, `&`, `..` or `..=` followed by a space (`- 1`); `.`, `?.`, `->`, `?->`, `!`, `?`; and `else`, `elif`, `in`, `is`, `as`, `by`, `=`, `:`. So does any line ending where the item can't end: after an operator, `.`, `:`, `=`, `->`, an opening bracket or a prefix. An optional part after a complete item, a range's end after `a..` or `& B` after `any A` or a constraint, is read only where the next line starts no item: `a..` over `b` is two items.
  - **A postfix bracket stands on its operand's line:** a call's `(`, an index's `[`, a struct literal's `{` and type arguments' `<`, as a tagged template's tag does. On the next line each starts an item, or for `<`, continues as the operator.
  - `,` and line breaks mix: a `,` ending or starting a line separates once, and items sharing a line still need `,`. Blank lines and comments between two items change nothing.

  ```ista statements
  const pairs = [
      (1, "a")                     # two items, not a call
      (2, "b")
  ]
  retry(
      times: 3
      backoff: base
          * 2                      # `*` and a space: the item goes on
  )
  ```
- **Trailing commas** are allowed in every comma-separated list; a list broken over lines needs none.
- **Identifiers** are ASCII letters, digits and `_`, not starting with a digit. Strings and comments may hold any Unicode.
