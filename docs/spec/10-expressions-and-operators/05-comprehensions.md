---
description: array and struct comprehensions, over iterables and over a struct's fields or a type's keys; read before changing comprehensions
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 10.5 Comprehensions

**Array comprehensions.** `[for x in xs: expr]` builds an array by evaluating `expr` for each element, and an `if` clause between the iterable and `:` keeps only the elements that pass:

```python fragment
const doubled = [for i in 1..10: 5 * i]
const small = [for x in doubled if x < 20: x]
const values = [for r in results if r is Ok(value): value]   # filter and destructure
```

- **The body is one expression;** a block expression gives it several statements.
- **`is` bindings in the condition flow into the body,** just as they flow from an `if` condition into its body.
- **It works on any `Iterable` (§8.4)** and builds the whole array at once. A plain `for` without brackets stays a statement and builds nothing.
- **Over a struct's fields,** `[for k, v in ...x: expr]` or `[for K in keyof S: expr]` takes a field loop's header (§11.2) and gives one element per field, in name order, `expr` checked once per pass. With no `if` clause, the elements agree on one type as an array literal's do: the type expected, such as `any X` for an object-safe `X`, or else what they agree on, `String` for `k` itself and `(String, Int)` for `(k, 1)`, whichever fields there are (§4.3, Agreeing values).

**Struct comprehensions.** A struct literal, `struct{…}` or `Name{…}`, may end with a field loop's header and `[key]: expr`, after any named fields: `struct{id, for k, v in ...rest: [k]: expr}`. It gives each field of `rest` a field named by the key, of `expr`'s value in that field's pass. The brackets hold the loop's key, a name, so the entry never reads as a field's declaration; there is no `if` clause and no spread, since the literal gives every field itself:

```python
struct Field<T> { value: T?, type Data = T }
struct SettingsForm { retries: Field<Int>, region: Field<String> }

fn current(s: SettingsForm) -> { [F in keyof SettingsForm]: SettingsForm[F].Data? }:
    struct{for field, node in ...s: [field]: node.value}
```

- **Its type** is the one expected, as a `struct{…}` literal's (§5.2), which must have exactly the named fields and `x`'s, or the one it names. A generic body builds one whose fields aren't all known yet, such as a mapped struct type over `x`'s keys. With neither, it is the shape of the named fields and each of `x`'s, typed as `expr` is there, which needs `x`'s fields known: not a type parameter with a struct constraint, or a type computed from one.
- **Checking** follows the field loop's, each `expr` against its field's type. A field both named and given by the comprehension is given twice, a compile error.
- **Evaluation** runs the named fields as written, then the comprehension in name order.
- **Over a type's keys,** `struct{for K in keyof S: [K]: expr}` builds a struct from its type alone, typed as expected: `fn Group.make<S is struct { [_] is Node }>(seed: Int) -> Group<S>: Group{fields: struct{for K in keyof S: [K]: S[K].make(seed)}}` builds any model whose every field is a `Node`.
