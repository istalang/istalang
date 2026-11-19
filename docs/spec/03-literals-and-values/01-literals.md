---
description: string, template, tagged-template, multi-line, number, collection, spread, tuple, range, struct and variant literals, and duration literals; read before changing a literal's syntax or meaning
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 3.1 Literals

**Literals:**

- **Strings:** `"…"` or `'…'` on a single line, with the escapes `\n`, `\t`, `\\`, `\"`, `\'`, `` \` ``, `\$` and `\u{…}`, which takes 1 to 6 hex digits naming a Unicode scalar value. Any other escape is a compile error.
- **Templates:** `` `Purchase ${req.id} awaits ${who}` `` is a `String`. Each `${…}` holds an expression, whose value is written as text by `(value).toString()`, a method call (§6.2), so a program's own type, a type parameter that is `Stringable`, an `any Stringable` and a union whose members all are work; a value with no such `toString` giving a `String` is a compile error. A template takes a String's escapes: `\${` writes `${`, and a `$` not before `{` is plain text. Inside `${…}` line breaks are ignored, since its one expression is no list, and a `#` comment runs to the end of its line. A template without values is a constant, as a String literal is. For text whose shape comes from data, `strings.format` remains (§19.2).
- **Tagged templates:** `` tag`a ${x} b` `` is the call `tag(["a ", " b"], x)`: the texts, one more than the values, then each value. It is an ordinary call, so `tag` is any function, method or function value, and its parameters decide what the values must be, as `fn sql(parts: Array<String>, ...values: Array<any Stringable>)` takes any text-writable ones. A tag stands on the template's line, as a call's `(` does.
- **Multi-line text:** a template, and a docstring (§2.3), may span lines. A line break in it is `\n`, whichever the source uses. If the opening delimiter ends its line, that line break goes, and so does the one before a closing delimiter alone on its line, with the spaces before it. Then every line after the first loses the leading spaces they all share; blank lines don't count. Indentation is read before escapes are, so an escaped `\n` or `\t` is never a line break or indentation. A template, a `${…}` or a docstring left open runs to the end of the file, as in JavaScript; the error points at its opening delimiter:

```ista statements
const message = `
    Dear ${name},
      your order ${id} has shipped.
    `
# "Dear Ada,\n  your order 42 has shipped."
```
- **Numbers:** `42`, `1_000_000`, `0x1F` and `0b1010` for `Int`; `3.14`, `1e9`, `2E6` and `2.5e-3` for `Float`. A `_` stands only between digits, radix prefixes are lowercase, and there are no octal literals. A float has digits on both sides of its `.`, so `2.toString()` calls a method on the `Int` `2`, and `0..10` is a range.
- **`true`, `false` and `none`.**
- **Arrays:** `[1, 2, 3]`, and `[]` when empty.
- **Maps:** `["legal": 1, "cfo": 2]`, and `[:]` when empty. Keys are expressions.
- **Spread:** `[...xs, 4]` and `[...m, "a": 2]` build a new array or map from an existing one plus more elements or entries. A spread takes anything iterable (§8.4) and spreads the items its cursor gives: an array its elements, a map its `(key, value)` entries, a string its characters, a range its ints. In a map literal the items must be `(key, value)` tuples. A literal is a map literal only when it has a `key: value` entry or is `[:]`, so `[...m]` is an array of `m`'s entries.
- **Tuples:** `(1, "x")`, and `()` for `Unit`.
- **Ranges:** `3..5` covers 3 and 4 (half-open), `3..=5` includes 5, and either end may be left out: `..5`, `3..`. `by` gives a step: `0..10 by 2`, `10..=0 by -1`.
- **Structs and enum variants:** `Pair{first: 1, second: 2}`, and `UserId{"u-1"}` for a struct with a single field. A variant with fields is called, its fields given as arguments by position or by name, `Ok(42)` and `Rejected(by: "legal")`, and only so: braces after a variant's name, or a block below it, are a compile error naming the call (§5.3). A type without fields is just its name. `struct{value: 1}` is a struct literal whose type comes from context (§5.2).
- **Indented values:** a struct, map or array written as an indented block of `key: value` or `- item` lines (§3.2).
- **Lambdas:** `fn(x): x * 2` (§6.4).

Duration literals are sugar for the standard library's `Duration`: an integer plus a unit, with no space between (`500ms`, `30s`, `15m`, `2h`, `5d`). For example, `5d` means `Duration{value: 5 * 24 * 60 * 60 * 1000}`. A fractional duration such as `1.5h` is a compile error; write `90m`. Every program loads the `time` module, so a duration literal works in any module, while the name `Duration` is visible only where `time` is imported.
