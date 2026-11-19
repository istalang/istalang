---
description: blocks as expressions, block expressions, one-line bodies, continuing an if; read before changing blocks or bodies
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 10.1 Blocks

Every block is an expression whose value is its last expression. A block that ends in a statement has type `Unit`. All branching constructs (`if`, `match`, `select`) are expressions. **All their branches must agree on one type (§4.2), and the compiler checks this.** A branch that ends in `return`, `break` or `continue` has type `Never`, which fits any expected type. `return` gives the value on its line, or the indented value on the lines below it, deeper than its own (§3.2), built as the function's return type; with neither, it returns `Unit`.

**Block expressions.** A bare `{ … }` in an expression position is always a block expression: its statements run in order, its variables are scoped to it, and its value is its last expression. Indentation still applies inside the braces. Written on one line, a block must contain at least one `;`, since braces around a single expression add nothing: write `if urgent: alert(msg)` rather than `if urgent: { alert(msg) }`.

```ista statements
const total = { const base = price * qty; base + shipping(base) }

if urgent: { alert(msg); save(msg) }     # a one-line body
```

**One-line bodies.** Any `:` that introduces a body (after `if`, `elif`, `else`, `while`, `for`, `case` or `fn`) may instead be followed by exactly one statement on the same line, with no braces, as in `for x in xs: total += x`. Chained on one line, `if`, `elif` and `else` form an `if` expression like any other, so every branch must have the same type:

```ista statements
const size = if n < 10: "small" elif n < 100: "medium" else: "large"
const fact = fn f(n: Int) -> Int: if n < 2: 1 else: n * f(n - 1)
if urgent: alert(msg)
```

A `;` directly after a one-line body is a compile error, because readers coming from Python would expect `if x: s1; s2` to put both statements in the body. Write `if x: { s1; s2 }` for both, or put `s2` on the next line.

**Continuing a construct.** `elif` and `else` continue an `if` when they stand at the column where the `if`'s line starts, which is how a multi-line `if` can be an initializer (§11.1). A dangling `else` belongs to the nearest `if` whose line it lines up with, so after `if a: if b: x` it belongs to `if b`. The `case` lines of a `match` or `select` always stand in its indented body.
