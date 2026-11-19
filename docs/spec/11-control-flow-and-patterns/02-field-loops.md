---
description: for key, value in ...x and for K in keyof S: targets, checking per field, passes; read before changing field loops
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 11.2 Field loops

- **Field loops.** `for key, value in ...x:` runs its body once per field of `x`, in name order (§5.2), as the body written out once per field; the `...` tells it from iterating an `Iterable`, which a struct may also be. `x` is a value of a struct type, of a type parameter with a struct constraint (§8.1), or of a type computed from one, such as a mapped struct type; `...*x` runs over the value behind a shared struct (§5.4).
  - **Targets.** Exactly two. `value` is a copy of the field, a declaration's target (§4.5). `key` is a name or `_`, a value of the field's name as a String literal type: it passes as a `String`, compares with any field's name, matches and is sent like any value. It is a single key (§5.2): `y[key]` is the field it names, a place, where `y`'s type has that field.
  - **Checking.** Over a struct type, the body is checked once per field, `value` of that field's type and `key` of its name's literal type, so each pass chooses its own overloads. Over a type with a struct constraint, it is checked once per field the constraint names, and once for the other fields, where `value` has an opaque type meeting the constraint's `[_]` entry, if any, and `key` an opaque type within `keyof S`. Each pass is the body written out for its field, so a condition or case its key decides rules out the code another field selects (conditions decided by types, §11.1), which that pass never checks. Over a struct with no field, or a value of type `Never`, it is checked once, as code that never runs: `key` and `value` are of type `Never` (`keyof {}` is `Never`), whose operations report nothing (§4.1), so only a mistake that doesn't depend on a field is reported. A mistake several passes make is reported once; a case no value reaches is warned about only when it is so in every pass.
  - **Over a type's keys.** `for K in keyof S:` runs its body once per field of the type `S`, with no value to read. `K` is a member parameter the loop declares (§8.1), in each pass that field's name as a literal type, read as its value where a body names it, so `x[K]` reads the field it names; `S[K]` is that field's type, and its static functions are called through it (§8.2). The header takes `keyof` alone, which no expression starts with, so it never reads as iterating an `Iterable`. Checking is a field loop's over a value of `S`: once per field of a struct type; for a constrained `S`, once per field the constraint names and once for the others, where `S[K]` is opaque but meets the constraint's `[_]` entry.
  - **A loop like any other.** Each pass is a block of its own (§7.1), so `break`, `continue`, labels, `hold` and `await` work as in any `for`. It is a statement of type `Unit`.
