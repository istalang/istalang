---
description: every expression's static type, the implicit conversions (the only ones), the built-in type table; read before adding a type or a conversion
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 4.1 Built-in types and conversions

Every expression has a static type; a value whose type is known only when the program runs has a trait's, `any T` (§8.3). There are no implicit conversions, with six exceptions: a value is converted into an `any` type wherever one is expected (§8.3), a nominal struct's value is converted into its equal shape wherever that shape is expected (§5.2), a function fits where one of its parameters giving a future of its result is expected (§6.4), a one-element tuple and its element each fit where the other is expected (§4.5), a value of a literal type, or of a union of literals, fits where their base type is expected, and a value is converted into a union wherever one is expected (§4.3, §4.2). Operators convert nothing: mixed operand types work through overloads, `"Total: " + count` among them (§10.2).

| Type | Meaning |
| --- | --- |
| `Int`, `Float`, `Bool`, `String` | Primitives: language built-ins, not structs. `Bool` is `true \| false` (§4.3). |
| `None` | The primitive whose one value is `none`. |
| `Unit` | The type of statements and of blocks that end in a statement. It is the empty tuple `()`. |
| `Never` | The type of `return`, `break`, `continue` and `panic`. It fits wherever any type is expected. No value of it exists, so code operating on one never runs: reading its members, calling it or through it, indexing it, an operator, a comparison, `await`, `?`, `!`, `??`, `->`, a field loop or a pattern over it is allowed, gives `Never` and reports nothing. |
| `A \| B` | A union: a value of one of its member types (§4.2). |
| `"draft"`, `42`, `-1`, `true` | Literal types: a `String`, `Int` or `Bool` literal as the type of its one value (§4.3). |
| `T?` | Sugar for `T \| None`, which the prelude names `Optional<T>` (§19.1). The empty value is `none`. |
| `Time`, `Duration` | Standard-library structs wrapping an `Int` of milliseconds (§19.2). |
| `Array<T>`, `Map<K, V>` | Generic collections (§19.3). They are values and are copied like structs. |
| `Range` | A span of integers written `a..b`, half-open (§19.3). |
| `Slot<T>` | Handle to a slot shared by the concurrent executions of one instance: empty or full (§15.1). |
| `Future<T, K>` | Something to wait on, of kind `K`, `"live"` or `"ista"` (§9.1, §15.2). |
| `Instance<T>` | Handle to an instance `spawn` started, whose outcome is a `T` (§17.1). |
| `Inbox<T>` | Standard-library message queue built on slots (§15.3). |
| `Shared<T>` | A shared struct of one value in the instance's own memory: every copy sees the same value, read and written as `x->value` (§19.1). |
| `WeakRef<T>` | Handle referring to a disposable value without holding it (§19.1, §16). |
| Struct types | Declared with `struct` (§5.2). They may be generic. |
| Shared struct types | Declared with `shared struct` (§5.4): handles to a cell of the instance's own memory, holding its fields. |
| Enum types | Declared with `enum` (§5.3): exactly one of several variants. `Result<T>` is one (§12). |
| Function types | `Fn<Args, Result, Kind, Send>`, written as its sugar: `fn(A, B) -> R`, `live fn(A) -> R`, `sendable fn(A) -> R`, `inert fn(A) -> R`, `ista async fn(A) -> R` (§6.4). |
| Tuple types | `(A, B)`: a fixed number of values, by position (§4.5). |
| `any` types | `any T`, `any A & B`: a value of any type conforming to the traits (§8.3). |

Every type name is PascalCase; the primitives are language built-ins, declared in no module and always sendable. The other built-in types are ordinary declarations in the prelude and standard library (§19.1).
