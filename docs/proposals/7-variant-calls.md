---
description: proposal 7 of docs/proposals, for building values the way other languages do — an enum variant declared with its fields in parentheses as a function's parameters are, defaults and a rest included, a function of its enum, called (`Ok(v)`, arguments in field order or by name) and named as a value (`xs.map(Result.Ok)`) as any function is, and taken apart the same way (`case Ok(v)`), why a variant is a function and not a type, how variadic types fit later, and widening a struct by a spread (`struct{...x, y, z}`) — the rules, behaviour and power changes, spec edits, implementation notes and the questions left to the human; read before specifying or implementing any of them
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-07
last_updated: 2026-11-07
tags: [proposal, language, enums, structs, patterns, functions]
---

# Proposal: variant calls and widening spreads

Two ways to build a value that people and agents write from other languages and Istalang refuses today (`docs/review/guessed-forms.md`): an enum variant declared and called like a function, and a struct widened with a spread. A variant with fields is a function of its enum: it is called, and named as a value, as any function is. The human decided every rule below, including that a variant is declared in parentheses, never braces; **Decisions** lists the choices that settled its open points. Section numbers refer to `docs/spec.md`.

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

const ctx = struct{...sc.ctx, search}                         # sc.ctx's fields, and search
```

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
- **No clash with conversions.** A variant isn't a type, so `T(x)` as a conversion (`T.from(x)`, §3.10) never applies to a variant's name. A struct's name keeps `T(x)` as its conversion, and a struct is never called (see **Decisions**).
- **A variant without fields** is a value, not a function: just its name. `Expired()` is valid, though formatter will remove parenthesis.

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
- **No narrowing.** `as` binds the enum, so in `case Rejected as r`, `r` is a `Verdict` and `r.by` doesn't read. The pattern takes the fields: `case Rejected(by, reason)`.

### 5. A variant's last field may be a rest

- **Defaults** stay as they are, now written in the parentheses: a call, a brace literal or an indented value leaves those fields out.
- **A rest field.** The last field may be declared `...name: Array<T>`. A call's positional arguments beyond the other fields go into it, as into a rest parameter (§3.3), and a spread `...xs` passes an array's items. With no extra arguments it holds `[]`.
- **Elsewhere it is an ordinary field,** the one field holding what the rest collected. In braces it is written `children: […]`. Reading it gives the array, and a pattern names it `...children` in a call pattern or `children` in braces.
- **One rest, last, with no default.** A rest field with a default, a rest that isn't last, and a variant with two rests are compile errors, as for parameters.

### 6. Widening a struct with a spread

- **The form.** `struct{...x, y, z}`, where `x` is a struct value and the other items are fields: the shape (§3.1) holding `x`'s fields and the items'.
  - An item naming one of `x`'s fields gives it the item's value, and the item's type.
  - Fields stand in name order, as in every shape. `x` is evaluated first, then the items, as written.
- **Sugar.** It is exactly `struct{y, z, for k, v in ...x: [k]: v}` (§4), which stays the general form.
- **When it widens.** A `struct{…}` literal widens unless its expected type is `x`'s own type. In that case it is today's updated copy, and an item naming a field the type lacks stays an error. A named literal, `T{...x, y}`, is always an updated copy of a `T`. A widened literal with an expected shape converts as any shape does (§3.1).
- **One spread, first,** as today.

## Why a variant is a function, not a type

- **One sum at run time: the enum.** An enum's value is its variant's index and that variant's fields (`definition/values/values.ts`). A union lowers into an anonymous enum (`lowering/tables/type-table.ts`, `lowering/values/unions.ts`):
  - a variant per member, holding the member's value;
  - a variant without fields for a literal or `None` member, a bare tag.

  The checker keeps the two apart. An enum is nominal and tagged; a union is a set that flattens, merges and collapses under substitution (§2).
- **An enum isn't sugar over a union.**
  - **Of shapes:** a shape is its fields, so `Celsius(value: Float)` and `Fahrenheit(value: Float)` would merge, every variant without fields would be `struct{}`, and `Left(v: A) | Right(v: B)` would collapse where `A = B`. A shape's fields also take no defaults or annotations (§3.1, §3.16).
  - **With a tag field:** the tag becomes a field with two meanings, two enums with equal variants become one type, and narrowing by a field's value is new to the checker.
  - **Of a struct per variant:** variants become types, so `Ok(v)` is `T(x)`, a conversion (Decision 1). A union is never inferred (§2), so `if c: Ok(1) else: Err(e)` would need a widening rule. Each value would carry two tags until a union of structs drops its wrapper (proposal 3, note 13), and snapshots, extern keys and codecs would change.
- **A variant is a function, as in Rust and Haskell.** A constructor is a function and a pattern, not a type. A variant being a function over its type, which the union route promised, comes without it.
- **Lost by this: narrowing.** A case binds the enum, never a variant (Rule 4).

## Variadic types later

- **Packs stay tuples (§3.5).** An instantiation makes a pack a concrete tuple, and lowering flattens it into single parameters (`lowering/calls/packs.ts`). Level 2, a pack mapped through a type (`Setup<each A>`, tracker F3), keeps each position's type. A rest of enum values, an `Array` of a union or an `any` type, loses it, and that route exists already: `...args: Array<any Stringable>`.
- **What this proposal keeps open for it:**
  - A variant's signature is a function signature in the model functions use. There is no variant-only binder or signature, so if an enum takes a pack one day (§3.5 refuses it today), its variants inherit binding, inference and mapped forms.
  - A rest field is one ordinary field holding what the rest collected: an array today, a pack's tuple then.
  - A variant as a value follows functions: an array's rest is one array, and a pack's would flatten.

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
| `case Rejected as r: r.by` | an error: `r` is a `Verdict` | unchanged |
| `Ok{(v)}`, `Ok{42}` | the single-field positional form | an error naming `Ok(v)`, `Ok(42)` |
| `Ok{v}` | errors 5013 and 5014 | still an error, now naming `Ok(v)` |
| `Expired()` | error 5103: no function 'Expired' | `Expired`; the formatter drops the `()` |
| `struct{...a, y: 2}`, `a: A` with no `y` | error 5013: struct has no field 'y' | the shape `{ x: Int, y: Int }` |
| `A{...a, y: 2}` | error 5013 | unchanged: a named literal is an updated copy |
| `const b: A = struct{...a, x: 2}` | an updated copy | unchanged |

## What changes in power

**Gained.**
- Variants built and taken apart by position, as in Rust, Swift, Kotlin and TypeScript's tagged unions. The single-field trap `Ok{v}` goes, since `Ok(v)` says what is meant.
- Variants passed as functions, `vs.map(Result.Ok)`, as in Rust and Haskell.
- Variants holding any number of children, built by listing them (`Group("t", a, b, c)`).
- Records widened in place, as `{ ...a, b }` does in JavaScript, with the struct comprehension left for anything more.

**Not gained.**
- Calling a struct's name to build it: `Point(1, 2)`. A struct's name already converts (`T(x)`), so a struct is built with braces or an indented value.
- Narrowing to a variant: a variant isn't a type, so `case Rejected as r` binds the enum.
- An enum taking a pack (§3.5).
- Widening a named struct (`T{...x, extra}`), or merging several spreads.
- Default or rest fields in a struct declaration through calls, since structs aren't called.

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
  - The values block gains `struct{...x, y}`.
- **§2.**
  - **Literals:** a variant called by position or name; a single field is no longer given positionally in braces.
  - **What each kind of bracket means:** `(…)` after a variant's name builds it.
- **§3.1.**
  - **Construction** gains the widening spread beside the updated copy.
  - **Defaults** names a variant's rest field, and a variant's defaults trail, as parameters' do.
- **§3.3.** Arguments bind to a variant's fields as to parameters.
- **§3.10.**
  - **Conversions:** `T(x)` converts a type; a variant's name is called, never converted.
  - `enum Step<T> { Next(value: T), Done }`.
- **§3.11.** Variants:
  - **Declaration** in parentheses, as parameters, with defaults trailing and a rest; braces refused;
  - every example: `Rejected(by: String, reason: String)`, `Pending`, `Approved`;
  - **A variant is a function** of its enum, `fn E.V<P…>(fields) -> E<P…>`, called and named as a value as functions are; its type is the enum; `Expired()` is `Expired`;
  - call patterns: positional, named, and `...`; told apart by their tag; `as` binds the enum;
  - **Referring names:** a variant with fields is written with braces or as a call pattern.
- **§3.14.** **Functions named as values** gains a variant with fields: qualified, or bare where an expected function type's result is its enum.
- **§4.** The struct comprehension's section names `struct{...x, y}` as its shorthand.

## Implementation notes

1. **Syntax.** A call whose callee is a variant needs no new node: the checker tells a variant's name from a function's by what it names, as it tells `T(x)` from a call today.
   - **Patterns:** call patterns are a new `VariantCallPattern` (callee, positional and named subpatterns, an optional `...`), parsed where a pattern's name is followed by `(` on its line (proposal 5's `atPostfix`).
   - **Declarations:** `parseVariant` (`parser/grammar/declarations/type-declarations.ts`) reads a variant's fields through `parseDelimited` at `(`, with the declared-field item (`parser/grammar/parts/structs.ts`), so separators, line breaks, recovery and annotations come with it. A rest field is a `DeclaredField` marked as rest, taken in a variant's list only. A `{` after a variant's name is read as today's list, then refused once, naming the parenthesized form.
2. **Checker.**
   - **The signature:** a variant's constructor is a function signature in the model function declarations use (`constructs/declarations/functions/signatures.ts`), derived from its declared fields, with its enum over the enum's type parameters as the result, memoized per variant declaration. Its fields' defaults trail, as parameters' do. No signature type or binding rule exists for variants alone; that is what lets a later pack fit (**Variadic types later**).
   - **Arguments:** a call binds through that signature (`resolution/choosing/applicability.ts`, `takenBy`), so defaults and a rest come with it.
   - **Function values:** `namedFunctions` (`constructs/closures/function-values.ts`) finds a variant's signature as it finds a static function's, so the expected type chooses and infers as for any function, and a bare name looks in the enum of the expected result.
   - **The value:** the built value is the brace literal's (`expressions/structs/variants.ts`).
   - **Patterns:** call patterns test the variant, as brace patterns do, then read the fields through `constructs/patterns/walk/kinds/struct-fields.ts`, positions mapped to declared order.
3. **Widening.**
   - **Checker:** `struct{...x, items}` is checked as the struct comprehension it stands for (`constructs/expressions/structs/struct-comprehensions.ts`), given the items' names. It records the comprehension it builds, as an indented value records the literal it builds (proposal 5), so lowering and computation need nothing new.
   - **Expected type:** the update or widen decision reads it through `types/fitting/expected.ts`.
4. **Lowering.**
   - **A call** lowers through the variant literal's lowering, its arguments in written order. A rest field is an array built from the extra arguments, as for a rest parameter.
   - **A function value** is a closure over a constructor function, synthesized once per variant instance on demand (`lowering/synthesized/`). Its body is that same lowering, so a variant is built in one place.
5. **The repository's sources: a scripted rewrite through the project's own parser.** Every variant declared in braces becomes the parenthesized form, keeping each field's text, default and annotations. A defaulted field before a required one moves after the required ones. No positional use exists before this proposal, so the move changes no meaning. It covers about 170 lines in std, test and example `.ista` files, the spec's examples, and the Istalang held in TypeScript tests; then `ista fmt`.
6. **Tools.**
   - Signature help over a variant call lists its fields as parameters.
   - Hover on a variant's name shows its signature, and completion offers it where a function value is expected.
   - The formatter prints a variant's declaration as a parameter list: on one line when it fits, else one field per line.
   - Hover on a call pattern's position names the field.
   - The formatter prints calls and call patterns as written, but drops `()` after a variant without fields.
7. **Tests** (fast-check, beside the code):
   - a variant called with generated positional and named arguments equals its brace literal;
   - a variant named as a value and called equals its direct call, over generated arguments, and its equality and sendability are a static function's;
   - after the rewrite, every rewritten module checks and runs as before, and its formatted form is stable;
   - `case V(…)` binds what `case V{…}` binds over generated values;
   - `struct{...x, items}` equals the struct comprehension it stands for over generated structs;
   - every refusal in the behaviour table.

## Decisions (the human's)

1. **A struct's name is never called.** `Point(1, 2)` would clash with `T(x)` as a conversion when there is one argument, so `Wrapper(x)` would mean two things. Structs keep braces and indented values.
2. **The single-field positional brace form goes.** `Ok{42}` and `Ok{(v)}` become `Ok(42)` and `Ok(v)`, so a variant has one form for positions.
3. **Call patterns ship with variant calls,** so a value is taken apart as it is built.
4. **No widening of a named literal (`Wider{...x, extra}`), and no merging of several spreads (`struct{...a, ...b}`), for now.** The struct comprehension covers both.
5. **A variant is a function of its enum,** in every enum, called and named as a value as any function is. Its type is the enum, and patterns tell variants apart by their tag.
6. **Variants aren't types, and the enum stays the one sum.** A union lowers into one, and neither is sugar for the other in the checker (**Why a variant is a function, not a type**).
7. **Variadic types stay tuples (packs).** This proposal keeps a variant's signature in the function model and a rest field one ordinary field, so a later pack fits (**Variadic types later**).
8. **The JSON tag is `_type`,** landed on its own, so a variant's field may be named `type`.
