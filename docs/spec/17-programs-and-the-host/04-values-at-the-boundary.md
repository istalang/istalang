---
description: JSON codecs at the boundary, declared and derived codecs, stable references, the JSON mapping; read before changing what crosses to the host or json
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 17.4 Values at the boundary

**Values at the boundary.** Every value that crosses between the host and an instance has a declared type: extern constants, extern function parameters and results, and the arguments of an instance the host starts. Each crosses through its type's codecs, the `toJson` that `Encodable` requires and the `fromJson` that `Decodable` does (§8.4), so workflow code needs no reflection. Inbound JSON is validated before it enters the instance; a mismatch fails the host's call, so malformed data never reaches workflow code. `json.parse<T>(s)` and `json.stringify(v)` go through the same codecs for JSON held in strings.

- **Declared codecs.** The `json` module declares them for the types the language has, and a module may declare them beside its own types, as the `time` module does for `Time`. A type that crosses as text (the table below lists the standard ones) declares each with one call: `fn toJson(self: Money) -> Json: json.encodeText(self)` writes its `toString`, and `fn Money.fromJson(j: Json, path: String) -> Result<Money>: json.decodeText(j, path)` reads it back through its `parse`. A `fromJson` names the `path` of what it reads in an `Err`, as `$.items[2].amount`.
- **Derived codecs.** A struct, an enum, a tuple or a host type that declares neither function, in its own module or the `json` module, gets both from the compiler, and so do a literal type and a union of literals. A derived codec writes and reads each part through that part's own codecs, found as every trait's functions are (§8.2), so it is the same wherever the type is used. A type that declares one codec has the other neither derived nor otherwise, so it is never written one way and read another.
- **Stable references.** A value given to a host again, unchanged, is the same JavaScript object, at every depth, so a host can skip work by reference equality (React's `memo`). Identity follows the value kept, not equality: a part the program held and passed again (not rebuilt) is the object the host got for it before, a value rebuilt equal is a new one, and so is a value changed and every value holding it. What a host gets, an extern's argument or an outcome, is frozen. Primitives are their own identity. It holds within one instance, never across instances or restarts, since a value crossing between them is a copy.
- **Codecs are pure.** Every value is written through `json.encode`, the json module's own codecs and the derived ones too, which gives the JSON it wrote before for a value written as the same type and unchanged since, so a `toJson` runs at most once per such value: one with effects would run fewer times than called. In a test (§18), where a mock may replace a codec, nothing is kept, so a mock sees every call.

The mapping follows JavaScript's `JSON.stringify`:

| Type | JSON |
| --- | --- |
| struct, named or anonymous, deriving its codecs | object keyed by field name, or, in a named struct, by the name given with `@JsonName`; a named struct's fields marked `@JsonSkip` are left out, and read back as their type's `default()` (§8.4), so only a field whose type is `Default` may be skipped |
| `Array<T>`, tuple | array; a tuple's has exactly its length |
| `Map<K, V>` | object keyed by each key's `toString`, so `K` must be `Stringable` (and `Parsable` to be read) |
| `Int` | number, parsed and printed exactly at any size; a string of its digits with `@JsonBigInt` |
| `Float` | number; NaN and ±Infinity are written as `null`, as JavaScript does, so they can't be read back: a `Float` that may be missing is a `Float?` |
| `Bool`, `String` | boolean, string |
| `T?`, which is `T \| None` | `null`, or a missing field, for `none`; `T` may itself be a union of literals |
| literal type, union of literals | the literal: string, number or boolean; reading another value fails |
| enum deriving its codecs | object with a `"_type"` field naming the variant, plus the variant's fields |
| `Decimal`, `Regex`, `Time`, `Duration`, `Zone`, `DateTime` | string, their `toString` text, by `json.encodeText`: `"-12.5"`, `"2026-10-25T12:00:00.000Z"`, `"PT1H30M"` |
| `json.Json` | the JSON it holds: `none` is `null`, an `Int` or a `Float` a number, an `Array<Json>` an array and a `Map<String, Json>` an object; its codecs are the identity, and a host sees plain JavaScript values, every integer a `bigint` (§4.6, the extern key `json.Json`) |
| `Unit` | `null` |
| extern type | whatever JSON its host gives it, handed back unchanged, by `json` too. A disposable one keeps that JSON while the instance holds it (§17.2) |

Every object's keys are emitted sorted, in UTF-16 order as JavaScript sorts strings, so equal values always produce the same JSON, whatever order a struct declares its fields in or a map stores its entries in. Unknown fields in inbound objects are ignored, so producers can add fields without breaking consumers. A missing field that isn't optional fails validation, even one with a default (§5.2). A type that isn't `Encodable`, or `Decodable`, can't cross that way, at the boundary or through `json`, which is a compile error where it would: a function type, a handle (§7.2), a union other than `T | None` and a union of literals, even of members that cross (§21), a map whose keys aren't `Stringable`, or a type with a part that can't cross. So is an enum deriving its codecs with a variant field whose key, its name or its `@JsonName`, is `_type`, which would collide with the tag.
