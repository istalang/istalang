---
description: tuples, one-element conversion, destructuring declarations and assignments; read before changing tuples or destructuring
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 4.5 Tuples

A tuple groups a fixed number of values by position. Its type is written `(Int, String)`, and a tuple is built with parentheses: `(5, "x")`.

```python statements
fn minMax(xs: Array<Int>) -> (Int, Int):
    (xs.min(), xs.max())

const lo, hi = minMax(scores)
const _, max = minMax(scores)         # _ holds the first value, unnamed
let a, b = (1, 2)
a, b = (b, a)                         # swap two existing variables
for key, verdict in answered.entries():
    ...
```

- **Tuples are values.** They are copied like structs, sendable when all their elements are, and compared structurally by `==`.
- **`Unit` is the empty tuple** `()`.
- **Building needs parentheses:** `(5, 7)`, including in `return (5, 7)`. A one-element tuple is written `(x,)`; `(x)` is just a parenthesized expression.
- **A one-element tuple converts.** A `(T,)` fits where a `T` is expected, giving its element, and a `T` fits where a `(T,)` is, as a one-element tuple, so a pack of one (§8.1) reads as its value. The conversion applies to a whole value, once, before any conversion into a union (§4.2), never inside a collection or a function type: an `Array<(T,)>` is no `Array<T>`.
- **Elements by position:** `t.0`, `t.1`, as a decimal number after the dot. `t.0 = v` assigns one and `&t.0` passes one by reference. `t.0.1` reads an element of an element.
- **Destructuring** works in `const` and `let` declarations, in `for` loops, and in plain assignment to existing variables. `_` is an unnamed variable: it holds its value like any other variable (§16), it just can't be referred to.
- **Declaration targets** are patterns that can't fail (§11.3): names, `_`, tuple patterns and struct patterns, a struct pattern's rest included, nested at any depth, with `as` to rename. Several targets are a tuple of them: `let (a, b), c = t`, `const Pair{first, second as s} = p`, `const struct{first} = p`, which takes the type from the value, and `const struct{title, ...rest} = form`. A pattern that can fail (§11.3) is a compile error here. Each level's count must match its tuple's size. A declaration target also stands as a parameter, taking its argument apart (§6.1).
- **Assignment targets** are places, or tuples and struct literals of targets: `a, b = (b, a)`, `(a, b), c = t`, and `Pair{first: p.x, second} = q`, which assigns `q.first` to `p.x` and `q.second` to the variable `second`. The value is evaluated first, then each part is assigned, left to right. An assignment writes each place once: `a, a = t`, `p, p.x = t` and `*x, x->a = t` are errors. Where two places may be one only when the program runs, two elements `xs[i], xs[j]` or two variables holding one handle, they are written left to right.
- **No named tuples.** When positions need names, use a struct. A good guideline: tuples for two or three positional values, structs beyond that.
