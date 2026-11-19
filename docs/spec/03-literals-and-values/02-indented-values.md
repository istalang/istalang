---
description: structs, maps and arrays written as indented blocks: where they open, their entries and items, what each builds; read before changing indented values
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 3.2 Indented values

**Indented values.** A struct, map or array value may be written as an indented block, as a struct declaration's fields are (§5.2): `name: value` lines build a struct, `"key": value` lines a map, and `- item` lines an array. Its lines alone say what a block builds; the type it is built as only types it, as it types the matching brace or bracket literal.

```python
struct Service:
    name: String
    replicas: Int = 1
    ports: Array<Int>
    env: Map<String, String>
    retry:
        times: Int
        backoffMs: Int

const api = Service:
    name: "api"
    ports:
        - 80
        - 443
    env:
        "LOG_LEVEL": "debug"                   # a map's keys are quoted
        "x-region": "eu"
    retry:
        times: 3
        backoffMs: 200
```

- **Opening.** An indented value opens on the lines below a line that ends right after the `=` of a `const`, a `let`, an assignment or a field's default; after `return`; after an entry's `:`; or after an item's `-`. Its lines stand deeper than that line. With nothing after the token, it takes its type from the expected one, as `struct{…}` and `[…]` do (§5.2, §3.3).
- **Named form.** A line ending in `T:` at those places builds the struct `T`, as `T{…}` does: `const api = Service:`, `return Pair<Int, String>:`, `retry: Retry:`. `T` is a named struct type with its arguments: a struct, or an alias of a struct or a shape; a variant named there is a compile error naming its call (§5.3). `new T:` builds a shared struct (§5.4). A map or an array takes its type from where it goes: `const env: Map<String, String> =` with the block below.
- **Nowhere else.** Headers (`if c:`, `while c:`, `for x in xs:`, `match x:`, `case P:`, `select:`) and a lambda's `fn(x):` keep their `:`, and their bodies are statements. A body's line `Name:` with a block below it is a label (§11.1). Inside `(…)`, `[…]` or braces no indented value opens, since line breaks follow the list rule there: an argument or an element is written `T{…}`.
- **Lines.** The value's lines stand at one column, and the first line at the opening line's column, or left of it, ends the value, as any block ends. `,` separates entries on one line. Comments and blank lines may go anywhere. An entry's value is the expression on the rest of its line, which continues as any expression does, inside brackets, templates and `${…}`. Nothing follows the value, on its opening line or after its block.
- **Entries.** Each line holds `key: value`, where the key is a name, or a String literal (quoted, not a template) in a map; `key:` alone, with the entry's value as the indented value below it, or `key: T:`; a bare name, short for `name: name`; `...value`, a spread; a struct comprehension, as the last entry (§10.5); or `- value`, an item, whose `-` stands first on its line and is followed by a space or the line's end.
- **Items.** `- value` holds an expression. `- key: value` opens an anonymous keyed value whose other entries line up with `key`. `- T:`, or `-` alone, opens a value on the lines below, deeper than the `-`. A name whose `:` ends the item's line is told by its case, as a pattern's bare name is (§11.3): `- Point:` names the value's type, while `- nested:` is a key whose value is the block below. `- -1` is the item −1, while a line starting with `-1` holds no item. An item's expression can't start with `- `, so `- - 1` is an error: a nested array is written `- [1]`, or as a `-` with items below it.
- **What it builds.** The parser tells entries apart by their first tokens, as it tells a struct literal's items apart, and the entries tell what a block builds; it is then typed as that literal is, by the type expected, a union's one member it fits (§4.2), or with none as the literal alone types it:

| Its entries | Built as |
| --- | --- |
| items, and `- ...xs` spreads | `[…]` |
| quoted keys, and spreads | `["key": value, …]` |
| names as keys, shorthand names, one spread first, a struct comprehension last; any entries below `T:` | `T{…}` or `struct{…}` (§5.2), defaults filling the fields left out |

- **Map keys.** A map's keys are quoted, so any text is one, a reserved word or a name the naming rules refuse as a field among them (`"for": 1`, `"LOG_LEVEL": 1`). Of two equal keys, the later one's value wins. A map whose key type no String literal fits is written as a bracket literal, `[1: v]`.
- **Errors:** items and keys in one value; quoted keys and names in one value; a struct comprehension among quoted keys; items or quoted keys below `T:`; and a single-field value given without its name, which keeps only its brace form (`UserId{"u-1"}`).
- **A literal like any other.** An indented value builds exactly what the matching brace or bracket literal builds, with the same field order and evaluation order (§5.2). It is computed at compile time where its entries are (§5.1), and it may hold a value written in braces or brackets.
