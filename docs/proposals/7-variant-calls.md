---
description: proposal 7 of docs/proposals, for building values the way other languages do — an enum variant declared with its fields in parentheses as a function's parameters are, defaults and a rest included, a function of its enum, called (`Ok(v)`, arguments in field order or by name) and named as a value (`xs.map(Result.Ok)`) as any function is, and taken apart the same way (`case Ok(v)`), and why a variant is a function and not a type — the rules, behaviour and power changes, spec edits, implementation notes and the questions left to the human; read before specifying or implementing any of them
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-07
last_updated: 2026-11-07
tags: [proposal, language, enums, patterns, functions]
---

# Proposal: variant calls

A way to build a value that people and agents write from other languages and Istalang refuses today (`docs/review/guessed-forms.md`): an enum variant declared and called like a function. A variant with fields is a function of its enum: it is called, and named as a value, as any function is. The human decided every rule below, including that a variant is declared in parentheses, never braces; **Decisions** lists the choices that settled its open points. Section numbers refer to `docs/spec.md`.

```python
enum Node:
    Text(value: String)
    Group(title: String, collapsed: Bool = false, ...children: Array<Node>)
    Empty

enum Verdict:
    Approved
    Rejected(by: String, reason = "no reason given")

fn page(user: User) -> Node:
    Group("Profile", Text(user.name), Text(user.email))        # in field order; the rest takes the others

fn wrap(v: Int) -> Result<Int>: Ok(v)                         # no `Ok{(v)}`
fn reject() -> Verdict: Rejected(by: "legal")                # reason defaulted
fn wrapAll(vs: Array<Int>) -> Array<Result<Int>>: vs.map(Result.Ok)   # a variant is a function value

fn titleOf(n: Node) -> String:
    match n:
        case Text(value): value
        case Group(title, ...): title
```

## Status

Implemented on `refactor/folders` (`fb190abc` onward).

## Rules

### 1. A variant is declared like a function's parameters

- **The declaration.** A variant with fields lists them in parentheses after its name, written as a function's parameters are (§3.3): `Ok(value: T)`, `Rejected(by: String, reason: String = "")`. A variant without fields is its name alone, `Expired`.
- **What a field takes.** Each field is `name: Type`, or `name: Type = default` where `Type` is optional when a default value is provided. The last may be a rest, `...name: Array<T>` (Rule 5). Annotations stand on a field as they do on a field in braces today (`by: String @JsonName{"by"}`).
- **Defaults trail, as for parameters.** Every field after one with a default has one too, since a call gives its arguments in order (§3.3). In braces today, any field may have a default.
- **Braces no longer declare a variant.** `Rejected { by: String }` is a compile error naming `Rejected(by: String)`, as `;` between list items names `,` (proposal 5). An enum's associated types stay in its body, beside its variants (§3.1).
- **One per line, or `,` on one line,** as variants stand today (§2): `enum Verdict { Approved, Rejected(by: String) }`. Inside the parentheses, the line-break rule of proposal 5 applies, so a long field list breaks one field per line.
- **Field order is declaration order.** It is the order positional arguments and positional patterns follow. The value's layout is not affected; the checker maps positions to fields by name.

### 2. A variant is a function of its enum

- **Every enum, every variant with fields.** In `enum E<P…>`, the variant `V(fields)` is the static function `fn E.V<P…>(fields) -> E<P…>`: its fields are its parameters, defaults and a rest included, and its result is its enum. `Result`'s `Ok` is `fn Result.Ok<T, E = Error>(value: T) -> Result<T, E>`.
- **The call.** `V(args)` builds the variant `V`. Its arguments bind to the variant's fields as a call's arguments bind to parameters (§3.3):
  - positional ones in the order the fields are declared;
  - then named ones, by field name;
  - a field with a default may be left out.

  So `Ok(v)`, `Err(e)`, `Rejected("legal", "no contract")` and `Rejected(by: "legal", reason: "no contract")` all build values. The arguments are evaluated in the order written, as a call's are.
- **Type arguments** the arguments don't fix come from the expected type when it is the same enum, else from their defaults, as a variant's do today (§3.11): `Ok(1)` is a `Result<Int, String>` where one is expected, and a `Result<Int>` elsewhere.
- **Its type is the enum.** `Ok(1)` is a `Result<Int>`. A variant isn't a type (§3.11): it is the function that builds its enum's value, and the tag that value carries.
- **Naming the variant** works as in braces (§3.11): qualified, `Prop.Fixed(1)`; or bare, `Fixed(1)`, where the expected type gives the enum. Type arguments go where the brace form takes them.
- **No clash with conversions.** A variant isn't a type, so `T(x)` as a conversion (`T.from(x)`, §3.10) never applies to a variant's name.
- **A variant without fields** is a value, not a function: just its name. `Expired()` and `Decision.Expired()` are still `Expired`, warned of, since the name alone says as much; the formatter prints them as written. A variant whose fields all have defaults or are a rest is called with `()`, as `List()` builds `List` with `items: []`, and isn't warned of, nor is a call given type arguments, which only a call carries (`Opt.Nothing<Int>()`).

### 3. A variant is a function value

- **Named as a value** as a static function is (§3.14): `vs.map(Result.Ok)`, `const reject = Verdict.Rejected`.
- **Bare** where an expected function type's result is an enum having it: `const f: fn(Int) -> Result<Int> = Ok`. With no enum to find it in, as in `xs.map(Ok)`, where `map`'s result is still open, it is an error naming `Result.Ok`.
- **It behaves as the function it is.** It is a closure capturing nothing, so its type is sendable. It equals another naming the same variant with the same type arguments. Calling it builds the variant.
- **Defaults and rest,** as for any function value (§3.14):
  - `Verdict.Rejected` fits `fn(String) -> Verdict`, computing `reason` at each call, and `fn(String, String) -> Verdict`;
  - `Node.Group` takes its rest as one array: `fn(String, Bool, Array<Node>) -> Node`.

### 4. Patterns mirror the call

- **Call patterns.** `case Ok(v)` matches the variant and its fields in declared order, each against a pattern. `case Rejected(by: "legal")` matches a field by name. `case Group(title, ...)` leaves the rest, and the brace patterns stay (`case Rejected{by}`). A pattern binds by position exactly as a call binds, so a value is taken apart as it was built.
- **Told apart by their tag.** Every enum value carries its variant at run time. `case Ok(v)` tests it, then takes the fields apart, `v` typed by `Ok`'s declared field over the subject's type arguments. Exhaustiveness counts an enum's variants (§3.11), as today.
- **Fields left out.** A field a call may leave out, one with a default or the rest field, may be left out of a call pattern, and then matches any value. Any other field is given, as `_` where nothing is tested, or left with a last `...`, which leaves every field no argument gives. Positions past the fixed fields match the rest field's items as an array pattern's do, its length included: `case Group(_, _, first, ...others)`; a lone spread takes the rest field whole, and a last `...` after items leaves the items past them.
- **No narrowing.** `as` binds the enum, so in `case Rejected(...) as r`, `r` is a `Verdict` and `r.by` doesn't read. The pattern takes the fields: `case Rejected(by, reason)`.

### 5. A variant's last field may be a rest

- **Defaults** stay as they are, now written in the parentheses: a call, a brace literal or an indented value leaves those fields out.
- **A rest field.** The last field may be declared `...name: Array<T>`. A call's positional arguments beyond the other fields go into it, as into a rest parameter (§3.3), and a spread `...xs` passes an array's items. With no extra arguments it holds `[]`.
- **Elsewhere it is an ordinary field,** the one field holding what the rest collected. In braces it is written `children: […]`. Reading it gives the array, and a pattern names it `...children` in a call pattern or `children` in braces.
- **One rest, last, with no default.** A rest field with a default, a rest that isn't last, and a variant with two rests are compile errors, as for parameters.

## Why a variant is a function, not a type

- **One sum at run time: the enum.** An enum's value is its variant's index and that variant's fields (`definition/values/values.ts`). A union lowers into an anonymous enum (`lowering/tables/type-table.ts`, `lowering/values/unions.ts`):
  - a variant per member, holding the member's value;
  - a variant without fields for a literal or `None` member, a bare tag.

  The checker keeps the two apart. An enum is nominal and tagged; a union is a set that flattens, merges and collapses under substitution (§2).
- **A variant is a function, as in Rust and Haskell.** A constructor is a function and a pattern, not a type.
- **Lost by this: narrowing.** A case binds the enum, never a variant (Rule 4).

## What changes in behaviour

| Code | Today | Proposed |
| --- | --- | --- |
| `enum V { R(by: String, reason: String = "") }` | error 2001: `,`, a line break or `}` expected | the variant `R` with two fields |
| `enum V { R { by: String } }` | the variant `R` | an error naming `R(by: String)` |
| `R(a: Int = 0, b: Int)` | error 2001; in braces, a variant with a default first | an error: every field after a defaulted one has a default |
| `fn f(v: Int) -> Result<Int>: Ok(v)` | error 5103: no function 'Ok' | `Ok` with `value` = `v` |
| `V.R(by: "x")`, where `R` has a defaulted `reason` | error 5010: 'R' can't be called | `R` with `reason` defaulted |
| `Group(title: String, ...children: Array<Node>)`, then `Group("t", a, b)` | errors 2001 at the declaration | `children: [a, b]` |
| `vs.map(Result.Ok)`, `vs: Array<Int>` | an error: `Ok` is written with braces | an `Array<Result<Int>>` |
| `const f: fn(Int) -> Result<Int> = Ok` | an error: `Ok` is written with braces | a function value building `Ok` |
| `xs.map(Ok)` | an error | an error naming `Result.Ok` |
| `case Ok(v): v` | errors 5109 and 2001 | binds `v` to the value |
| `case Rejected(...) as r: r.by` | an error: `r` is a `Verdict` | unchanged |
| `Ok{(v)}`, `Ok{42}` | the single-field positional form | an error naming `Ok(v)`, `Ok(42)` |
| `Ok{v}` | errors 5013 and 5014 | still an error, now naming `Ok(v)` |
| `Expired()` | error 5103: no function 'Expired' | `Expired`, with a warning naming `Expired` |

## What changes in power

**Gained.**
- Variants built and taken apart by position, as in Rust, Swift, Kotlin and TypeScript's tagged unions. The single-field trap `Ok{v}` goes, since `Ok(v)` says what is meant.
- Variants passed as functions, `vs.map(Result.Ok)`, as in Rust and Haskell.
- Variants holding any number of children, built by listing them (`Group("t", a, b, c)`).

**Not gained.**
- Narrowing to a variant: a variant isn't a type, so `case Rejected(...) as r` binds the enum.

**Lost.**
- Declaring a variant in braces, `Rejected { by: String }`, replaced by `Rejected(by: String)`.
- A variant's defaulted field before a required one: defaults trail.
- The single-field positional brace form, `Ok{42}` and `Ok{(v)}`, replaced by `Ok(42)` and `Ok(v)`.

## Spec changes

- **Cheat sheet:**
  - The enum line declares a variant in parentheses, `Rejected(by: String, reason: String)`.
  - `Ok{42}` and `Ok{(receipt)}` become `Ok(42)` and `Ok(receipt)`.
  - The values block gains `Rejected(by: "legal")` and `vs.map(Result.Ok)`.
  - The patterns block gains `case Ok(v)`.
- **§2.**
  - **Literals:** a variant called by position or name; a single field is no longer given positionally in braces.
  - **What each kind of bracket means:** `(…)` after a variant's name builds it.
- **§3.1.** **Defaults** names a variant's rest field, and a variant's defaults trail, as parameters' do.
- **§3.3.** Arguments bind to a variant's fields as to parameters.
- **§3.10.**
  - **Conversions:** `T(x)` converts a type; a variant's name is called, never converted.
  - `enum Step<T> { Next(value: T), Done }`.
- **§3.11.** Variants:
  - **Declaration** in parentheses, as parameters, with defaults trailing and a rest; braces refused;
  - every example: `Rejected(by: String, reason: String)`, `Pending`, `Approved`;
  - **A variant is a function** of its enum, `fn E.V<P…>(fields) -> E<P…>`, called and named as a value as functions are; its type is the enum; `Expired()` is `Expired`, warned of;
  - call patterns: positional, named, and `...`; told apart by their tag; `as` binds the enum;
  - **Referring names:** a variant with fields is written with braces or as a call pattern.
- **§3.14.** **Functions named as values** gains a variant with fields: qualified, or bare where an expected function type's result is its enum.

## Implementation notes

1. **Syntax.** A call whose callee is a variant needs no new node: the checker tells a variant's name from a function's by what it names, as it tells `T(x)` from a call today.
   - **Patterns:** call patterns are a new `VariantCallPattern` (callee, positional and named subpatterns, an optional `...`), parsed where a pattern's name is followed by `(` on its line (proposal 5's `atPostfix`).
   - **Declarations:** `parseVariant` (`parser/grammar/declarations/type-declarations.ts`) reads a variant's fields through `parseDelimited` at `(`, with the declared-field item (`parser/grammar/parts/structs.ts`), so separators, line breaks, recovery and annotations come with it. A rest field is a `DeclaredField` marked as rest, taken in a variant's list only. A `{` after a variant's name is read as today's list, then refused once, naming the parenthesized form.
2. **Checker.**
   - **The signature:** a variant's constructor is a function signature in the model function declarations use (`constructs/declarations/functions/signatures.ts`), derived from its declared fields, with its enum over the enum's type parameters as the result, memoized per variant declaration. Its fields' defaults trail, as parameters' do. No signature type or binding rule exists for variants alone.
   - **Arguments:** a call binds through that signature (`resolution/choosing/applicability.ts`, `takenBy`), so defaults and a rest come with it.
   - **Function values:** `namedFunctions` (`resolution/choosing/named-functions.ts`) finds a variant's signature as it finds a static function's, so the expected type chooses and infers as for any function, and a bare name looks in the enum of the expected result.
   - **The value:** the built value is the brace literal's (`expressions/structs/variants.ts`).
   - **Patterns:** call patterns test the variant, as brace patterns do, then read the fields through `constructs/patterns/walk/kinds/struct-fields.ts`, positions mapped to declared order.
3. **Lowering.**
   - **A call** lowers through the variant literal's lowering, its arguments in written order. A rest field is an array built from the extra arguments, as for a rest parameter.
   - **A function value** is a closure over a constructor function, synthesized once per variant instance on demand (`lowering/synthesized/`). Its body is that same lowering, so a variant is built in one place.
4. **The repository's sources: a scripted rewrite through the project's own parser.** Every variant declared in braces becomes the parenthesized form, keeping each field's text, default and annotations. A defaulted field before a required one moves after the required ones. No positional use exists before this proposal, so the move changes no meaning. It covers about 170 lines in std, test and example `.ista` files, the spec's examples, and the Istalang held in TypeScript tests; then `ista fmt`.
5. **Tools.**
   - Signature help over a variant call lists its fields as parameters.
   - Hover on a variant's name shows its signature, and completion offers it where a function value is expected.
   - The formatter prints a variant's declaration as a parameter list: on one line when it fits, else one field per line.
   - Hover on a call pattern's position names the field.
   - The formatter prints calls and call patterns as written, `Expired()` included: only checking knows that `()` adds nothing there.
6. **Tests** (fast-check, beside the code):
   - a variant called with generated positional and named arguments equals its brace literal;
   - a variant named as a value and called equals its direct call, over generated arguments, and its equality and sendability are a static function's;
   - after the rewrite, every rewritten module checks and runs as before, and its formatted form is stable;
   - `case V(…)` binds what `case V{…}` binds over generated values;
   - every refusal in the behaviour table.

## Decisions (the human's)

1. **The single-field positional brace form goes.** `Ok{42}` and `Ok{(v)}` become `Ok(42)` and `Ok(v)`, so a variant has one form for positions.
2. **Call patterns ship with variant calls,** so a value is taken apart as it is built.
3. **A variant is a function of its enum,** in every enum, called and named as a value as any function is. Its type is the enum, and patterns tell variants apart by their tag.
4. **Variants aren't types, and the enum stays the one sum.** A union lowers into one, and neither is sugar for the other in the checker (**Why a variant is a function, not a type**).
5. **The JSON tag is `_type`,** landed on its own, so a variant's field may be named `type`.
6. **`Expired()` stays as written, warned of.** The formatter never drops it, since only checking tells it from `List()`, whose `()` builds a value with its defaults.
7. **Call patterns may leave fields out as a call does** (Rule 4, **Fields left out**): a field with a default or the rest field left out matches anything, and a last `...` leaves the others, so `case Rejected("legal", ...)` stands as written.
