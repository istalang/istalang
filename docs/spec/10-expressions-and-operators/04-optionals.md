---
description: ?., ?->, ?? and !, and optional chains; read before changing optional operators
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 10.4 Optionals

**Optionals.** Three operators work without a `match` on a `T?`, any union holding `None`, and act on its other members, the `T`, which allows only what a union does when it is one itself (§4.2). They work alike on `None` itself, whose value is always `none`, and on a type whose `any` member took `None` whole (§4.2), such as `any Sendable`, which is its own `T`:

- `a?.b` reads the field `b`, or the element `a?.0` of a tuple, or calls a method as in `a?.m()`, or a field of a function type as in `a?.f(x)` (§6.4), when `a` isn't `none`, and yields `none` otherwise. The result is optional. `a?->b` does the same for a field behind an optional shared struct (§10.2), `f?.(x)` calls the function inside an optional `f`, as in `hooks.onDone?.(event)`, and `xs?.[i]` indexes an optional container, evaluating the arguments or the index only when there is one.
- `a ?? b` yields the value inside `a`, or `b` when `a` is `none`; `b` is evaluated only then. `b` may have type `T`, and so does the result, or `T?`, giving a `T?`, so `a ?? b ?? c` reads left to right.
- `a!` yields the value inside `a`, and panics with "Force-unwrapped none." when `a` is `none` (§12). It is postfix, beside `?`, and unwraps a whole optional chain before it: `a?.b!` is `(a?.b)!`. Every use is warned about, since `??`, `is` or `match` handles the `none` it would panic on. `x!=y` scans as `x != y`, so an unwrapped operand of `==` needs a space or parentheses: `x! == y`.

All three work only on such types; using one on any other value is an error. A `?.` or `?->` starts an **optional chain**: the links after it, such as `.c`, `.0`, `[i]`, `.m()` and `->c` in `a?.b.c`, `a?.b.0`, `a?.b[i]`, `a?.b.m()` and `a?.b->c`, work on the value inside, and when a `?.` or `?->` meets `none` the whole chain is `none`. Each reaches inside the one optional before it, so an optional read further along needs its own: `a?.b?.c` when `b` is optional too. Parentheses end a chain, and so does a prefix `*`. The chain's value is converted into `T?` once, at its end, and `T??` is `T?` (§4.2), so results never nest. A value read through `?.` or `?->` is a copy (§7.2), not a place (§7.3), so a chain can't be assigned to, nor be the receiver of a method taking `&self`.

`??` can't be mixed with `and` or `or` without parentheses, as in JavaScript. Neither operator is related to the postfix `?` on `Result`, which propagates errors (§12).

```python fragment
const limit: Int = m.get("limit") ?? 50_000
const role: String? = verdict?.role
```
