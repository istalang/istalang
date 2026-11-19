---
description: the built-in traits table, Iterable and cursors, T(x) conversions; read before changing a built-in trait
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 8.4 Built-in traits

**Built-in traits:**

| Trait | Required | Used by |
| --- | --- | --- |
| `Sendable` | nothing: a marker, derived for user structs (§7.4) | what a spawned function captures (§17.1); whatever crosses to the host, through `Encodable` and `Decodable` |
| `Inert` | nothing: a marker, derived (§7.4), met by a type whose values reach no disposable; `Sendable`, `Encodable` and `Decodable` imply it | what an inert function captures (§6.4), such as a callback a library keeps in a handle |
| `DataKind<K in Mark>` | nothing: derived, met by a type whose kind (§9.1) is among `K`'s marks, `"simple"` where its values hold no kind; `Sendable` implies `DataKind<"simple">`, and `DataKind<K1>` implies `DataKind<K2>` when `K1`'s marks are `K2`'s | an associated type's bound, which gives it its kind, `"simple"` where none is written (§9.2) |
| `Disposable` | `dispose`, synchronous; only shared structs (§5.4) and extern types (§16) | values the runtime disposes when their last holder ends (§16) |
| `Iterable<T, C = Self>` | `iterate`, returning a cursor, `fn() -> Step<T>` | `for x in c`, comprehensions and spreads |
| `Indexable<K, V, C = Self>` | `index(self, key) -> V` | `x[k]` |
| `IndexAssignable<K, V, C = Self>` | `setIndex(self: &C, key, value)` | `x[k] = v` |
| `Convertible<From, T = Self>` | `fn Self.from(value: From) -> Self` | `T(x)` |
| `Default` | `fn Self.default() -> Self` | map literals for other types (§3.3); what a `@JsonSkip` field reads back as (§17.4) |
| `Stringable` | `toString(self) -> String` | `String(x)`; appending to a string with `+` (§10.2); map keys in JSON, and `json.encodeText` (§17.4) |
| `Parsable` | `fn Self.parse(text: String) -> Result<Self>`, failing with the prelude's `Error.unparsed(text, what)`: code `parse`, message `'<text>' is not <what>.`, `what` naming the type with its article (`an Int`) | reading map keys from JSON, and `json.decodeText` (§17.4) |
| `Encodable`, `Decodable` | `toJson(self) -> json.Json`, and `fn Self.fromJson(json: json.Json, path: String) -> Result<Self>`, the codecs that write and read a type as JSON (§17.4); each implies `Sendable`, since a value written as JSON and read back is a copy, as sending makes one. Declared in the `json` module, so code naming them imports them; derived for a struct, an enum, a tuple, a literal type, a union of literals or a host type declaring neither function | extern parameters, and extern results and constants (§17.2); `json` |
| `Container<T, C = Self>` | `includes(self: C, item: T) -> Bool` | `x in c`, `x not in c` (§10.2) |
| `Addable`, `Subtractable`, `Multipliable`, `Divisible`, `FloorDivisible`, `Negatable`, `Powerable`, `Bitwise`, `Shiftable`, `Comparable` | the functions in §10.2 | operators in generic code |

**Iterable.** `for x in c` calls `iterate(c)` once, for a cursor: a function that gives a `Step<T>` each time it is called, `Next(item)` holding the next item, or `Done` once there are no more; the prelude declares `enum Step<T> { Next(value: T), Done }`. A cursor gives a `Step` rather than a `T?` because an item may itself be `none` and `T??` is `T?` (§4.2): a `for` over an `Array<Int?>` holding `[1, none, 3]` runs three times. The loop calls the cursor until it gives `Done`, so any type can support `for` by declaring `iterate`, and a cursor that never gives `Done` runs for as long as the loop does. A cursor holds what it runs over as `iterate` was given it, a copy (§7.2), so changing `c` inside the loop doesn't affect the iteration. It is a plain function value (§6.4), kept in snapshots like any other, so a loop that waits mid-way keeps only the cursor's own state: a range's few ints, never its items. `Array<T>` is iterable as it is, `Map<K, V>` is `Iterable<(K, V)>` (so `for key, value in m:` works directly), a `String` gives its characters, and a `Range` with both ends is `Iterable<Int>` (so `for i in 0..10:` works). A type's `iterate` can hand over another's cursor, such as `self.items.iterate()`. `Array` and `Map` also satisfy `Indexable` and `IndexAssignable`: `Array<T>` with `Int` keys (and `Range` keys for slicing), `Map<K, V>` with `K`.

**Conversions.** `T(x)`, a type applied to one argument in parentheses, converts `x` to `T`. It is sugar for the static function `T.from(x)` that `Convertible<From, T = Self>` requires. It never clashes with construction: a struct is built with braces, and a variant isn't a type, so its name before `(` is called, never converted (§5.3). Only conversions with no expected failure are written this way: `Float(3)`, `Int(3.7)` (which truncates toward zero) and `String(42)`. `String(x)` converts any `Stringable` value through its `toString`, the one place a type says how it is written. A float that is no number, NaN or an infinity, has no int, so `Int(x)` of one is a bug and panics (§12). Fallible ones are ordinary functions returning `Result`, such as `Int.parse("42")`, the `Parsable` requirement.
