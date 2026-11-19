---
description: traps in Istalang still undecided — forms a developer from another language reads one way and Istalang another, which proposal 6 (familiar forms) doesn't settle yet; read before deciding a familiar form or writing the guide's warnings
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [review, spec, language, traps]
---

# Open traps

Left from the 2026-11-18 audit of the spec and proposals 6, 12 and 18 (numbers kept from it). Everything else that audit found is done: the spec's inconsistencies were fixed and the spec reorganized (2026-11-19), the proposals' issues moved to `proposal-issues-2026-11-19.md`, and the other traps were decided into proposal 6 or fixed in the spec. § numbers are the spec's (`docs/spec/README.md`).

Severity: **H** a developer will hit it and get wrong behaviour or a confusing error; **M** surprising, but loud or rare; **L** minor.

| # | Sev | Form | Assumed (from) | Istalang |
|---|---|---|---|---|
| T14 | M | `"n: " + a + b` with ints | (JS's own trap) | `"n: 12"` for `a=1,b=2`: `+` concatenates any `Stringable` left to right. |
| T19 | M | struct fields in declaration order | Go/Rust/TS/Kotlin keep it | name order wherever order shows: field loops, struct comprehensions, mapped types, JSON. Declaration order matters only to defaults and evaluation. |
| T22 | M | `T??` | nested optional (Swift, Rust `Option<Option>`) | `T??` is `T?`; a generic `T?` at `T = Int?` loses "missing vs none" (`Map<K, V?>.get`). |
| T25 | L | `a, b = b, a` | swap (Python) | RHS needs parentheses: `(b, a)`. |
| T26 | L | `new Foo{…}` for a plain struct | constructs (JS/Java/C#) | error: `new` only for shared structs. |
| T27 | L | `s.push` as a value | bound method (JS, Python) | error; wrap in a lambda. |
| T29 | L | `Json` round trip of `1.0` | stays a float | whole JSON numbers decode as `Int`. NaN/±Infinity encode as `null` and never read back. |
| T33 | L | P18: same library mounted at two paths | one package (npm dedupes types structurally in TS) | two copies, two incompatible types, even at one commit; re-mounting renames running work's functions and extern keys. |
| T35 | M | P12: several tuple rests, `pairs(1, "x", true, 2.0)` | — | k rests split m arguments m/k each, in order: `((1, true), ("x", 2.0))`; one more argument flips the call between another pairing and an error. |
| T36 | M | P12: open named rest `...opts: S`, `S is struct` | a typo is an error | any named argument naming no parameter becomes a field: `retires: 3` is accepted. |
