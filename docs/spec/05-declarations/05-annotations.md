---
description: annotations as compile-time struct values and where each applies; read before adding or reading an annotation
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 5.5 Annotations

An annotation attaches a compile-time value to a declaration. It is a struct value written with `@` before it, a struct's name, given its type arguments or not, bare or followed by its fields in braces (`@JsonName{"user_id"}`, `@Holds<T>`), and it applies to the declaration on the same line or, standing on its own line, to the next declaration:

```python
import JsonName, JsonSkip from 'json'

struct Deprecated:
    reason: String

struct GithubUser:
    login: String
    userId: Int @JsonName{"user_id"}
    @JsonName{"avatar_url"}
    @Deprecated{"use avatar instead"}
    avatarUrl: String?
    cache: Map<String, Int> @JsonSkip
```

- **Annotations are ordinary structs.** Any struct can be used as one, so libraries and tools declare their own. The `json` module declares `JsonName` (a single `String` field), `JsonSkip` and `JsonBigInt` (no fields), and the prelude declares `Waypoint` (a single `String` field).
- **Short forms come from the struct rules (§5.2):** a single-field struct takes its value without a field name, as in `@JsonName{"user_id"}`, and a struct without fields is written bare, as in `@JsonSkip`.
- **Checked at compile time.** An unknown annotation, a misspelled field or a wrong value type is a compile error. Annotation values must be computable at compile time, the same rule as top-level `const`. A declaration's annotations are written in the scope of its type parameters, as a field's are in its struct's, and their values are computed once for the declaration, whatever its instance. So a struct declaration's may name its type parameters (`@Holds<T>` on `Slot<T>`), while a field's and a function's, which every instance carries, name none of them: `@Tag<T>` on a field of `Box<T>` is a compile error.
- **Where.** `JsonName`, `JsonSkip` and `JsonBigInt` apply to fields of struct declarations and enum variants (§17.4 says which fields), `@Suite` to functions (§18), and `@Waypoint` to a statement that awaits or selects (§18). The `lifetimes` module's `Holds` applies to an extern struct and `Keeps` to a function, both of the std's only (§19.2): a host keeps no language values (§17.4), and any other code shows what its values hold and keep; `Keeps` names the function's parameters, as `@Keeps{["self": ["value"]]}` on the prelude's `put` says that a slot keeps the value put in it. Any other struct may annotate fields, functions and struct declarations, extern ones included, for tools to read, and statements take only `@Waypoint`. A field of an anonymous struct type, a shape (§5.2), takes none, since no declaration carries it: a field needing `@JsonName` lives in a struct. Using an annotation anywhere else, or the same one twice on one item, is a compile error.
- **Read by the toolchain.** The boundary conversion, the `json` module and the test runner read annotations, and the compiler reads `lifetimes`' (§16). There is no user-facing reflection in v0.1; a field loop (§11.2) is resolved at compile time and reaches only a struct's fields.
