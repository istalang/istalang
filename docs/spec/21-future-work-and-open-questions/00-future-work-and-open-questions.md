---
description: features deliberately left out of v0.1, and open questions; read before proposing a language feature
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 21. Future work and open questions

Features deliberately left out of v0.1:

- **Associated types with type parameters,** and associated types for types declared elsewhere, such as primitives (§5.2).
- **Filtering, renaming or making fields optional per field** in a mapped struct type, and carrying field annotations into one (§5.2).
- **Field loops over enums or tuples** (§11.2).
- **Closed struct constraints,** met only by a struct with exactly the named fields, and conformance for every struct meeting a constraint at once, such as `derive FormNode for struct { [_] is FormNode }` (§8.1).
- **Associated types of unions and `any` types,** such as `(A | B).Meta` as the union of its members' where every use of it stays sound; today neither has associated types, so neither meets a trait requiring one as a type argument (§5.2, §8.2).
- **A named field overriding a struct comprehension's,** as a mapped type's named entry skips its key; today a field both named and given by the comprehension is given twice (§10.5).
- **Union patterns with `infer` variables** beyond `infer T | rest` in a type `match` case (§4.6).
- **Indented maps with keys other than Strings,** written today as a bracket literal, `[1: v]` (§3.2).
- **Struct comprehensions in compile-time constants** (§5.1).

- **Narrowing from function results.** Type predicates, as in TypeScript, so that `fn isOk(x): x is Ok` can narrow a value's type for later code, for example a `map` after a `filter`. Inside one function, `x is Pattern as y` in an `if` or `and` already binds `y` at the narrower type, while `x` keeps its own (§11.1).
- **Codecs written in the language,** and with them JSON for any union, deciding how a codec reads a member without a tag (§17.4).
- **Inferred unions,** if ever wanted: an `if` whose branches differ, typed as their union instead of an error (§4.2).

No open questions remain for v0.1. New ones go here as they come up.
