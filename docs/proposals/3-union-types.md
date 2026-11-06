---
description: proposal 3 of docs/proposals, for union and literal types — `A | B`, `T?` as `T | None`, `"draft" | "sent"`, `Bool` as `true | false` — the decided rules, what changes in behaviour and power, the spec edits and implementation notes (unions lower as enums); third in order, after the type patterns of proposal 1 and the shapes of proposal 2 it matches on, and before proposal 4, whose keys are literal types; read before specifying or implementing it
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-04
last_updated: 2026-11-04
tags: [proposal, language, types, patterns, lowering]
---

# Proposal: union and literal types

A value of `A | B` is a value of one of its member types. `T?` becomes `T | None`, and `String`, `Int` and `Bool` literals become types. Section numbers refer to `docs/spec.md`. Assumes proposals 1 and 2: PascalCase primitives with type patterns, and anonymous structs compared by shape.

```python
type Status = "draft" | "sent" | "failed"
type Contact = Email | Sms

fn describe(x: Int | String | None) -> String:
    match x:
        case None: "nothing"
        case Int as n: `number ${n}`
        case s: s                                  # the remaining type: String

fn label(s: Status) -> String:
    match s:
        case "draft": "Draft"
        case "sent" | "failed": "Done"

const c: Contact = Email{to: "cfo"}
const r: Result<Receipt, NotFound | Timeout> = await charge(id)
```

## 1. Union types

- **Written** `A | B` in a type position. `|` binds looser than `?` and type arguments, and tighter than a function type's `->`: `fn() -> A | B` returns `A | B`, and `(fn() -> A) | B` holds a function type. `any A & B | C` is `(any A & B) | C`.
- **A set.** Order doesn't matter, a member that is a union contributes its members, duplicates merge, `Never` drops out, and a union of one member is that member.
- **One member per value.** A member that another member holds whole merges into it, so no value can sit in two members: a literal type into its base type (`"a" | String` is `String`, `true | false` is `Bool`), and a type into an `any` member whose traits it meets (`Int | any Stringable` is `any Stringable`). A nominal struct and its shape stay apart, since the conversion between them rebuilds the value as another type (`2-structural-types.md`).
- **Members** are any types: primitives, nominal structs and enums, shapes, tuples, function types, `any` types, literal types and type parameters.
- **Collapse.** Substitution can merge members: `T | Int` with `T = Int` is `Int`, and `T?` with `T = Int?` is `Int?`.
- **Recursion.** An alias still can't refer to itself (§3.17), so a recursive sum is an enum. In the recursive-types rule (§3.1), a union ends the chain as an enum does, so `struct Node { next: Node? }` stays valid.

## 2. Conversions

- **Into a union.** A value fits where a union is expected when its type is a member, or else when it converts into exactly one member through a conversion of §2: into an `any` member, a nominal struct into its shape, a plain function into an async one, or a one-element tuple and its element. Converting into several is a compile error. A union fits a union holding all its members. This replaces the wrap into `T?` among the implicit conversions (§2).
- **Whole values only.** As the wrap into `T?` does today: once, to a whole value, never inside another type and never through a reference (§3.7), so an `Array<Int>` is no `Array<Int | String>`.
- **Built from the expected type.** Where a union is expected, whatever takes its type from the expected one takes it from the one member it fits: a struct, array or map literal, a lambda, a bare variant name or a literal. Fitting none, or several, is a compile error. `Entry{key: "region", value: "eu"}` against `Entry<S, "retries"> | Entry<S, "region">` builds the second, and `[]` against `Array<Int>?` an empty array.
- **Errors.** `?` (§3.12) propagates an `Err` whose error converts into the function's error type: in a function returning `Result<T, NotFound | Timeout>`, `?` takes a `Result<U, NotFound>`.
- **Inference.** Against a union holding type parameters, an argument fills them with what the union's other members don't take, as `T?` does today (§3.5): `fn f<T>(x: T?)` called with an `Int` or an `Int?` binds `T` to `Int`, and called with `none` binds nothing.
- **Never inferred.** A union is a type only where one is expected. An `if`'s branches (§4), an array or map literal's items (§2) and a type parameter's arguments (§3.5) still need one type otherwise: `const x: Int | String = if c: 1 else: "a"` checks, `const x = if c: 1 else: "a"` is an error.

## 3. `T?` is `T | None`

- **`None`** is a primitive type (`1-type-names.md`) whose one value is `none`. `T?` is sugar for `T | None`. `none` needs no expected type; alone, its type is `None`.
- **`Optional` becomes an alias,** `type Optional<T> = T | None` in the prelude, and its `Some` and `None` variants go. The static functions declared on it are `T?`'s (§3.17), so `Optional.default()` keeps `T?` `Default` (§3.10), with `none`, and the `json` module's `Optional.fromJson` stays its codec.
- **Nested optionals collapse:** `T??` is `T?`. So `Map<K, V?>.get(k)` gives a `V?` in which a missing key and a stored `none` look alike; `has(k)` tells them apart.
- **`?.`, `?->`, `??` and `!`** (§4) work on any union holding `None`, and act on the remaining type. When that remaining type is itself a union, it allows only what a union does (§6 below).
- **Patterns.** `case Some{value as v}` goes: `case None:` and then a case binding the remaining type, `case v:`, or a type pattern, `case Int as v`. What stood inside `Some{value is …}` now stands alone: `case Verdict{ok == false}`.
- **JSON** writes `none` as `null`, as today.

## 4. Literal types

- **`String`, `Int` and `Bool` literals are types:** `"draft"`, `42`, `-1`, `true`. A literal type has exactly one value. `Bool` is `true | false`, and keeps its operators and methods.
- **Inference.** A literal has its base type unless a literal type, or a union holding one, is expected: `const s = "draft"` is a `String`, and `const s: Status = "draft"` checks `"draft"` against `Status`.
- **Fitting.** A literal fits its literal type. A value of a literal type, or of a union of literals of one base type, fits that base type: for `s: Status`, `s + "!"` and `s.toUpperCase()` are `String`s. A value of the base type never fits a literal type: `const s: Status = name` is an error, and `match name: case "draft" as d:` gives `d` the type `"draft"`.
- **Agreeing values.** Where several values take one type and none is expected, values of literal types of one base agree on that base. This covers an array or map literal's items, a comprehension's and an `if`'s branches: `[k1, k2]` is an `Array<String>` for `k1: "a"` and `k2: "b"`.
- **`==` and `!=`** take two values when either fits the other's type, so `s == name` compares a `Status` with a `String`.

## 5. Matching

- **Type patterns** (`1-type-names.md`) select a member: `case Int as n`, `case Email{to}`. One naming a literal's base type selects every literal member of that base: against `Status | Int`, `case String as s` binds `s: Status`.
- **Literal patterns** select their literal member, or else the member of their base type, compared with `==`: `case "draft":`, and `case 1:` against an `Int?`.
- **Variant names** select through the union's enum members, bare as where their enum is expected (§3.11). A name that variants of two members share, or a variant and a type share, is qualified: `case Decision.Approved`.
- **Generic members.** A pattern naming a generic type selects the member instantiating it. When several members do, the pattern gives their type arguments, as only a pattern on a union may: `case Entry<Settings, "region">{value}`.
- **Shape members** (`2-structural-types.md`) are selected by their fields: `case struct{a}` takes the member whose shape has the field `a`. A pattern whose fields more than one member shape has is a compile error; name the member through its alias instead, `case Point as p`.
- **Remaining type.** A case's binder, `case v:` or `as`, has the subject's type without the members that earlier cases without a guard covered: `case None:` and then `case v:` binds `v: T`. The subject itself keeps its type.
- **Alternatives.** `A | B as x` binds `x` as the union of the members the alternatives select: `case Int | String as v`.
- **Exhaustive.** A union's members are a closed set, so a `match` covers it when it covers every member, with no `case _`. A union of literals is covered by its literals, and `Bool` by `true` and `false`, as today.
- **After a collapse,** the first case that matches wins, as among a pattern's alternatives (§3.11). A case a collapse leaves unreachable isn't reported, since another instantiation may reach it.

## 6. Using a union

- **Nothing directly.** No field, method or operator of a member applies to a union; a union of literals has only its base type's, through the conversion (§4 above). Take it apart with `match` or `is`, or call through a trait.
- **Traits.** A union has no module, so argument-dependent lookup (§3.13) finds nothing for it. It meets a trait in either of two ways:
  - through functions declared for it, as a shape does (`2-structural-types.md`): in the trait's module, or in the module of another type they take. That is how `T?` meets `Default` (§3 above);
  - when every member meets the trait and the trait could follow `any` (object safety, §3.10). A static requirement, such as `T.zero()`, has no value to dispatch on, so it can't be met this way. Neither can `Encodable` and `Decodable` (JSON below).
- **Calls through a trait.** A call on a union that no function takes whole, such as `x.toString()` or `${x}`, calls the requirement of that name in a trait the union meets, among the traits visible at the call: declared there, imported, or the prelude's. Finding none, or several, is a compile error. The call runs the member's own function. So `x.toString()` works on `Int | Email` when both are `Stringable`, and `x` passes where `T is Stringable` or `any Stringable` is expected.
- **Overloads.** A union argument takes only an overload whose parameter takes the union, or a wider one: `f(A)` and `f(B)` together don't take an `A | B`. `fn f(x: A)` and `fn f(x: A | B)` clash (§3.7), as `T` and `T?` do today. So do `fn f(x: "a")` and `fn f(x: String)`, since `"a" | String` is `String`.
- **Values.** `==` compares the members' types, then the values, as for `any` values (§3.10), so a union may be a map key. A union is sendable when every member is, and must be used (§7) when a member must.
- **JSON.** `T | None` crosses as today's `T?`, and `T` may itself be a union of literals. A union of literals crosses as its literals, through codecs the compiler derives. Every other union is neither `Encodable` nor `Decodable` for now, even when its members are. How codecs read an untagged member is left open until codecs move into the language (§14).

## 7. Member type parameters

```python
fn describe<S in Status>(s: S) -> String: …      # instantiated once per member of Status

const status: Status = load()
describe(status)                                # error: Status may be several members
match status:
    case "draft" as d: describe(d)              # d: "draft", one member
    case _: …
```

- **`T in U`** in a type-parameter list declares a parameter that stands for exactly one member of the union `U`, never several. `U` may mention earlier parameters: `<S is struct, K in keyof S>` (`4-computed-types.md`, §8).
- **Inference.** An argument whose type is one member of `U` fills it. A literal argument fills it with its literal type: `get(settings, "region")`. An argument whose type is a union of several members doesn't fill it. That is a compile error, as for overloads (§6 above): narrow the argument first, with a literal or type pattern.
- **Checked once.** In the body, `T` is opaque, known only to be one member of `U`, and its values fit `U`. Each member it is used with is its own instantiation (§3.5).
- **Declarations** take it as functions do: `struct Entry<S is struct, K in keyof S>`. It takes no default and no `is` constraint beside the membership.

## What changes in behaviour

| Code | Today | Proposed |
| --- | --- | --- |
| `Int?` | the enum `Optional<Int>` | `Int \| None`; `Optional<Int>` is its alias |
| `case Some{value as v}` | binds the value | gone: `case None:`, then `case v:` or `case Int as v` |
| `case 1:` against an `Int?` | an error: `case Some{value == 1}` | matches `1` |
| `T??` | a type of its own, which JSON refuses | `T?` |
| `Map<K, V?>.get(k)` | `V??`, missing apart from a stored `none` | `V?`, the two alike |
| `Bool` | a primitive | `true \| false` |
| `if c: 1 else: "a"` | an error | still an error; checks where `Int \| String` is expected |
| a `match` on a closed set of types | only `any`, which needs `case _` | a union, exhaustive without it |
| the wrap into `T?` | one of four implicit conversions | the conversion into a union |
| `?` on a `Result<U, NotFound>` returning `Result<T, NotFound \| Timeout>` | an error: the error types differ | propagates |
| `a < 1 > (b)` | a chained comparison | a call with the type argument `1`; parenthesize the comparison |

## What changes in power

- **Gained.**
  - Sums of existing types without declaring an enum, such as error unions that `?` propagates into: `Result<T, NotFound | Timeout>`.
  - Literal unions as lightweight enums, matched exhaustively.
  - One rule for optionals, unions and their conversions.
  - Code instantiated per member of a union (`T in U`), which keeps a key and a value whose type follows from it together (`4-computed-types.md`, §8).
  - The literal types proposal 4 builds its keys on (`keyof S`).
- **Not gained.** Inferred unions; recursive unions through an alias; using a member's fields or methods without matching; dispatching a call over members except through a trait; conversion inside containers; JSON for unions beyond optionals and literals.
- **Lost.** Telling `T??` from `T?`, and `Some` as a pattern.

## Spec changes

- **Cheat sheet.** The type line gains `A | B`, `"a" | "b"` and `T?` as `T | None`. In the patterns block, `case Some{value is Verdict{ok == false}}` becomes `case Verdict{ok == false}`, and the block gains `case Int as n` over a union.
- **§2.**
  - The type table: `T?` is `T | None`, `Bool` is `true | false`, and new rows for unions, literal types and `None`.
  - The implicit conversions: the wrap into `T?` becomes the conversion into a union, and a literal type's value fits its base type.
- **§3.1.**
  - The `struct{…}` literal paragraph: where a union is expected, a struct literal builds the one member it fits (§2 above).
  - **Recursive types:** a union ends the chain, as an enum does.
- **§3.5.**
  - Inference: "where a `T` may fill a `T?`" becomes the union rule (§2 above), and a union is never inferred, only expected.
  - **Parsing:** type arguments may hold `|` and literal types, so `a < 1 > (b)` and `a < b | c > (d)` read as calls.
  - New bullet **Member parameters**, `T in U`, from §7 above.
- **§3.7.**
  - **Exact types:** no conversion into a union through a reference.
  - The clash rule's "a parameter's `T` counts as the same as `T?`" becomes "a type counts as the same as a union holding it".
- **§3.8.** The prelude declares `None` and the alias `Optional`; `Optional.default()` is still `none`.
- **§3.9.**
  - **Chains:** "never wrapped into an optional" becomes "never converted into a union".
  - **Equality:** `==` takes two values when either fits the other's type.
- **§3.10.**
  - A union meets a trait through functions declared for it, or through its members under the object-safety rule, and a call on it goes through a visible trait (§6 above).
  - **Conversion:** "as a `T` is wrapped into `T?`" becomes "as a value converts into a union".
- **§3.11.**
  - The **Optional** bullet becomes §3 above, and **Qualified names** gains a union's enum members.
  - The `field is Pattern` example drops `Some`, and the **Literals** bullet's `case Some{value == 1}` becomes `case 1`.
  - Patterns gain the remaining type, and type, literal, variant, generic and field patterns selecting members.
  - **Exhaustiveness** counts a union's members as its constructors.
- **§3.12.** `?` propagates an `Err` whose error converts into the function's error type.
- **§3.13.** Argument-dependent lookup finds nothing for a union.
- **§3.14, §3.15.** "The wrap into `T?`" becomes "the conversion into a union".
- **§4.** **Optionals:** `?.`, `?->`, `??` and `!` work on unions holding `None`.
- **§9.** The nested-optional `T??` exclusion goes. The mapping table gains literal types, and unions cross only as `T | None` or as literals.
- **§14 Future work.** Codecs written in the language, and with them JSON for any union; inferred unions, if ever wanted.

## Implementation notes

1. **A `union` type kind** (`src/compiler/checker/types/type/index.ts`). Its constructor normalizes:
   - it flattens member unions and merges duplicates by `typeKey`;
   - it merges a literal into its base and a member into an `any` member whose traits it meets;
   - it drops `Never` and gives a lone member back as itself.

   So `true | false` is `Bool`. `substitute` builds through the constructor, so collapse falls out. The key is the members' keys, sorted (`types/identity/type-keys.ts`). Messages print the union as written (`aliasedAs`, `type-text.ts`).
2. **A `literal` type kind:** a base primitive and a constant. Its key is the base and the value. A literal value's expected type decides whether it gets the literal type or its base. A lone literal type lowers as its base's value; only as a union member is it a tag (note 4).
3. **Fitting** (`types/fitting/fit.ts`).
   - The conversion into a union replaces the wrap into `T?`: `optionalInner`, `withoutOptionals`, `enumsExpected` and their callers move to unions holding `None`.
   - A value goes into the member of its own type, or else into the one member it converts into.
   - A union converts into a wider one.
   - A literal type's value, or a union of literals', converts to its base.
4. **Lowering: a union is an enum** in the type table (`src/compiler/lowering/type-table.ts`), one variant per member, in key order, holding the member's value, as `any` is lowered today. `Bool` stays the primitive.
   - A literal member is a variant without fields: a literal type's value carries no data, and a union of literals is just a tag.
   - The conversion into a union picks the member's variant; between unions it maps variant indexes, and to a base type it writes the tag's literal.
   - Each instantiation builds its own union after substitution, so collapsed members are one variant, and the `match` it lowers keeps the first arm.
   - The runtime and the snapshot format gain nothing, since enums exist.
5. **Patterns** (`checker/patterns/matching.ts`, `walk.ts`): type, literal, variant, generic and field patterns select a variant and bind its value, and a pattern on a union accepts type arguments. Each case computes its binder's remaining type. **Exhaustiveness** (`patterns/exhaustiveness.ts`) treats members as constructors.
6. **Trait calls.** A call through a trait dispatches per member, as a call on an `any` value does (`resolution/trait-objects.ts`, `memberWitnesses`). A call on a union looks for the requirement among the traits visible at the call. A union meets a trait through functions declared for it as a shape does (`resolution/candidates.ts` gives it no owner).
7. **Clashes** (`rules/clashes.ts`): a parameter's type counts as the same as a union holding it, generalizing the `T?` rule. A literal type then clashes with its base, which absorbs it.
8. **Parser:** `|` in type positions, at its precedence. Literal types in type positions: quoted strings, integers (a leading `-` included), `true` and `false`. `name in Type` in type-parameter lists, and type arguments in struct patterns.
9. **Member parameters.** A `parameter` type carries its union. Inference (`src/compiler/checker/inference/`) fills it only from a type that is one member, giving a literal argument its literal type, and instantiation proceeds per member as for any type argument. Building from an expected union tries each member and keeps the one that fits.
10. **The standard library.**
    - `src/language/primitives.ts` gains `None`.
    - `prelude.ista`'s `enum Optional<T>` becomes `type Optional<T> = T | None`, keeping `fn Optional.default`. `json.ista`'s `fn Optional.fromJson` and `fn toJson<T>(self: T?)` stay.
    - The `Some{value}` matches in those modules move to the remaining type.
11. **Extern keys.** `src/definition/extern-key.ts` spells `T?` as `prelude.Optional<T>`. Keep that spelling for `T | None`, through the alias, so existing keys and host tables don't change. Other unions spell their members in key order.
12. **Tests** (fast-check):
    - normalization is idempotent and order-free, and merges literals into their base;
    - `typeKey` is equal exactly when `sameType` holds, over generated unions;
    - exhaustiveness holds over generated member sets;
    - collapse after substitution keeps the first arm.
13. **Optimization, later.** Wrapping a struct in a variant boxes it once per value. Struct values already carry their type id (`src/definition/values.ts`), so a union of nominal structs could skip the wrapper.
