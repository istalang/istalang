---
description: the operator precedence table and associativity; read before changing the expression parser
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 10.3 Precedence

| Precedence, tightest first | Operators |
| --- | --- |
| 1 | postfix: calls, indexing, `.`, `?.`, `->`, `?->`, the error-propagating `?`, the unwrapping `!` |
| 2 | `**`, grouping to the right |
| 3 | prefix: `await`, unary `-`, `~`, `*`, `&`, and a deferred call, `g f(…)` (§6.5) |
| 4 | `*`, `/`, `//`, `%` |
| 5 | `+`, `-` |
| 6 | `<<`, `>>` |
| 7 | `&` |
| 8 | `^` |
| 9 | `\|` |
| 10 | `..`, `..=`, and `by` |
| 11 | `<`, `<=`, `>`, `>=`, `==`, `!=`, `in`, `not in`, which chain; `is` |
| 12 | `not` |
| 13 | `and` |
| 14 | `or` |
| 15 | `??`, which can't be mixed with `and` or `or` without parentheses |

Binary operators on the same level associate to the left, but for `**`, and comparisons, which chain.
