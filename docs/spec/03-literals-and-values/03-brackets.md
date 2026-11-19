---
description: what each kind of bracket means, map literals for other types, how collection literals take their item types; read before changing bracket parsing or collection literal typing
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 3.3 Brackets

**What each kind of bracket means.** `[…]` is for collections: array and map literals, indexing and slicing. A block below `=`, `return`, a key's `:` or an item's `-` builds a value too, with no bracket around it (§3.2). `{…}` is for structured values and blocks: right after a name, a qualified name, type arguments or `struct` it constructs a value, in a type position it lists fields, and any other `{…}` in an expression is a block (§10.1). No construct puts a block right after a name, so the parser never needs to know what a name means; the compiler reports a name before `{` that isn't a struct, a variant's included, since a variant is built by its call. `(…)` is for calls and conversions (§8.4), a variant's after its name building it (`Ok(42)`) and, in a pattern, taking it apart (`case Ok(v)`), tuples and grouping, and a variant's fields in its declaration, as a function's parameters (§5.3). A map literal works for any type that satisfies `IndexAssignable<K, V>` and `Default` (§8.4), given an expected type `C`: `[k1: v1, k2: v2]` builds `C.default()` and assigns each entry with `c[k] = v`, and an empty `[]` or `[:]` builds just `C.default()`; a spread's entries are assigned the same way. Where a `Map` is expected, `[]` is an empty map; where a union holds both an array type and a map type, `[]` is the array and `[:]` the map. A literal whose items agree on no one type is built as the one member of an expected union its items take, so `[1, [2]]` where a `Tree<Int>` (§4.6) or a `Json` is expected builds that union's array member, each item against the union again; one with a type of its own converts into the member it goes into (§8.1). Without an expected type, `[k: v]` makes a `Map<K, V>`. An array literal's elements, and a map literal's keys and its values, each have one type, as the branches of an `if` do (§10.1): the expected type's decides when there is one, otherwise the one they agree on, in any order (§4.2), so an empty `[]` or `[:]` needs an expected type. Of two equal keys in one map literal, the later one's value wins.
