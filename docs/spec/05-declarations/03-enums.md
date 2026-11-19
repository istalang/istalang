---
description: enums, variants as functions and function values, building only by call, qualified names; read before changing enums or variants
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 5.3 Enums

An enum is a type whose value is exactly one of several named variants, each with its own fields. Enums are values like structs: they are copied, they are sendable when all their fields are, and `match` handles them exhaustively.

```ista fragment
enum Decision:
    Approved(by: String)
    Rejected(by: String, reason: String)
    Expired

const text: String = match decision:
    case Approved(by):
        "approved by " + by
    case Rejected(by, reason):
        by + " rejected: " + reason
    case Expired:
        "expired"
```

- **Declaration.** A variant with fields lists them in parentheses after its name, written as a function's parameters are (§6.1): `Rejected(by: String, reason: String = "no reason given")`. Each field is `name: Type`, `name: Type = default` or `name = default`, and takes annotations as a struct's field does (§5.5). Every field after one with a default has one too, as for parameters. The last may be a rest, `...children: Array<Node>`, an `Array<T>` with no default: elsewhere it is an ordinary field holding an array, given by name as `children: […]` and read as `children`. Inside the parentheses a line break separates two fields (§2.1), so a long list stands one field per line. Braces after a variant's name in its declaration are a compile error naming the parenthesized form. A variant without fields is its name alone: `Expired`.
- **A variant is a function** of its enum. In `enum E<P…>`, a variant with fields, `V(fields)`, is the static function `fn E.V<P…>(fields) -> E<P…>`, its constructor: `Result`'s `Ok` is `fn Result.Ok<T, E = Error>(value: T) -> Result<T, E>`. Calling it builds the variant, its arguments binding to the fields as a call's bind to parameters (§6.1): by position in declaration order, then by name, a field with a default left out and a rest collecting the positional arguments left over. So `Ok(v)`, `Rejected("legal", "no contract")` and `Rejected(by: "legal")` all build values, their arguments evaluated in the order written. The value's type is the enum: a variant isn't a type. Type arguments are written at the call, `Result.Ok<Int, String>(1)`, or else inferred as any generic call's (§8.1): the expected type advises, and an argument taking its type from where it stands, such as a generic struct's literal or a qualified variant without fields, takes its field's as the call settles it. So `Ok(1)` is a `Result<Int, String>` where one is expected, and a `Result<Int>` elsewhere. A variant without fields is a value, not a function: `Expired()` is `Expired`, and is warned of, its name alone saying as much; a variant whose fields all have defaults or are a rest is called with `()`, as `List()` builds `List` with an empty rest, and so is one given type arguments, `Opt.Nothing<Int>()`.
- **A variant is a function value** where it is named without a call and no enum is expected of it (§6.4): qualified, `vs.map(Result.Ok)` or `const reject = Verdict.Rejected`, or bare where an expected function type's result is its enum, `const wrap: fn(Int) -> Result<Int> = Ok`. Bare with no such type, as in `xs.map(Ok)`, where `map`'s result is still to be found, it is a compile error naming `Result.Ok`; where its enum is expected, a variant with fields named without them is one too.
- **Only by its call.** A variant is built by calling it and taken apart by a call pattern (§11.3): braces after its name, `Rejected{by: "legal"}` or `Ok{42}`, and a block below it (§3.2) are compile errors naming the call, and so is a pattern's `case Rejected{by}`. A variant without fields is written bare: `Expired`. Like a struct, an enum may be declared on one line: `enum Color { Red, Green, Blue }`.
- **Qualified names.** Where an enum type is expected (in a `match`, an annotated variable, an argument, a field or a `return`), bare variant names are enough, and so are those of a union's enum members where the union is; a name that variants of two members share, or a variant and a type share, is qualified there: `case Decision.Approved`. Elsewhere they are qualified: `Decision.Expired`. A bare variant with no enum type expected is a compile error.
- **Generics and defaults.** Enums and structs take type parameters like functions, and may give them defaults (§8.1): `enum Result<T, E = Error>`.
- **Exhaustive `match`.** A `match` on an enum must cover every variant or end with `case _:`.
- **Optionals** are no enum: `T?` is `T | None` (§4.2), taken apart as any union is (§11.3), with `case None:` and then `case v:`, which binds the `T`, or with a pattern on the `T` itself, as `case Int as v` or `case Verdict{ok == false}`. `?.`, `??` and `!` (§10.4) are sugar over `match`.
