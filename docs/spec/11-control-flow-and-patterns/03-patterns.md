---
description: call, struct, literal, alternative, array, range, referring-name and type patterns, ruled-out cases, patterns on unions and any values, remaining types, is outside match; read before changing pattern matching
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 11.3 Patterns

**Patterns** mirror construction. A **call pattern** takes a variant apart as a call builds it: `case Ok(v)`, `case Rejected("legal", reason)`, `case Rejected(by: "legal", ...)`. Its arguments bind to the variant's fields as a call's bind to parameters (§6.1), by position in declaration order, then by name, `name: Pattern`, each matching its field against its pattern; as in a call, the named ones come last. A field a call may leave out, one with a default or the rest field, may be left out, and a last `...` leaves every field no argument gives: such a field matches any value. Any other field must be given. A spread takes the rest field whole, `case Group(title, ...children)`, and arguments past the fixed fields match its items as an array pattern's do, its length included: `case Group(_, _, first, ...others)`, or at least that many before a last `...`, `case Group(_, _, first, ...)`. A pattern writes a variant as it is built: one without fields bare, `case Expired`, and one with fields with its fields, as a call pattern. So `case Expired()` is warned of, its name alone saying as much; a bare `case Rejected` is warned of, naming `Rejected(...)`, which matches it whatever its fields hold, except where every field is `Unit` at the subject's type arguments (`case Ok` on a `Result<Unit>`), as there is nothing to take apart; and `case List()`, whose fields all have defaults or are a rest, is warned of too, since it matches every `List`, not only one built with its defaults, as `List(...)` says. Each still matches as written. The variant is told apart by its tag, and `as` binds the enum: in `case Rejected(by, ...) as r`, `r` is a `Decision`, so `r.by` doesn't read. Only a variant is taken apart as a call; a struct is taken apart in braces.

Inside a struct pattern's braces, each item is one of:

- **`field`** binds the field to a variable of the same name: `case Point{x}`.
- **`field as name`** binds it under another name: `case Order{amount as total}`. Only a variable name may follow `as`.
- **`field == expr`**, or any other comparison, tests it: `case Verdict{ok == false}`, `case Order{amount > 1000}`.
- **`field is Pattern`** matches the field against a nested pattern: `case Review{verdict is Verdict{ok == false} as v}`. Only a pattern may follow `is`.
- **`...name`**, the last item, binds a struct of the fields no other item names, a copy: `case Page{title == "", ...rest}`. Its type is the mapped struct type `{ [F in K]: S[F] }` (§5.2), `K` being the keys of the matched struct `S` but those the pattern names: for a struct whose fields are known, the shape of those fields, and for a type parameter with a struct constraint (§8.1) an opaque struct meeting that constraint without the entries the pattern names, such as `struct { [_] is C }`, whose fields field loops, struct comprehensions and keys reach (§5.2, §10.5). A rest can't fail; `..._` takes none.

A struct pattern on a type parameter with a struct constraint takes the fields its constraint names, as reading them does (§8.1): `const struct{title, ...rest} = form`.

A pattern can also be a literal (`case 0:`, `case "cfo":`), a tuple of patterns (`case (a, _):`), `_`, or a bare name. A camelCase bare name binds a new variable, as `a` does in `case (a, _):`, while a PascalCase one refers to a variant, a struct without fields or a type, as in `case Expired:`, `case Marker:` or `case Int:`; a qualified name (`case Decision.Expired:`, `case limits.max:`) always refers. A constant, being camelCase, is therefore compared through a qualified name or a guard (`case n if n == limit:`). There is no positional binding in a pattern's braces, not even for a type with a single field: a bare name always binds the field of that name, and `as` renames it, as in `case Pair{first as a}`; a variant's fields are taken by a call pattern, `case Ok(receipt)`. An anonymous struct is matched with `case struct{…}`, or through an alias naming its shape (§4.6), `case Point{x, y}`; against an `any` value, such a pattern matches a value whose own type is that shape, while a struct declaration's value inside keeps its own type, so it doesn't match.

- **Literals** are compared with `==`. On a union, a literal selects a member first (below), so `case 1:` matches against an `Int?`; against an `any` value that takes its type, it matches the value of that type inside equal to it. `as` after one binds its literal type: `case "draft" as d` gives `d` the type `"draft"`. `none` is `None`'s value, and a negative number is written `-1`. A literal the subject's type can't hold never matches (ruled-out cases, below).
- **Alternatives.** `A | B` matches what either matches, anywhere a pattern stands: `case 1 | 2:`, `case (0, x) | (x, 0):`, `x is Circle(n) | Square(n)`. Every alternative binds the same names, of the same types, and the first alternative that matches gives their values. `A | B as x` binds the whole value, as `(A | B) as x`; on a union, as the union of the members the alternatives select: `case Int | String as v`; on an `any` value, as the union of the types they match inside it.
- **Arrays.** `[a, b]` matches an `Array` of exactly two items, and a rest takes any number between the items before and after it: `[first, ...rest]`, `[first, ...middle, last]`, `[..._, last]`. `...rest` binds a new array of those items, and `..._` binds nothing. A pattern has one rest at most.
- **Ranges.** `1..=5`, `0..10`, `..0` and `90..` match an `Int` between their bounds, which are int literals, a negative one included: `..` leaves its end out and `..=` takes it in, and either end may be left open. A range that holds no int, such as `5..1`, is an error.
- **Patterns that can fail:** an alternative, an array pattern, a range, a literal, a comparison, a referring name, an enum variant, a type pattern against an `any` value (§8.3), and a pattern selecting among a union's members (below). A declaration's or loop's target (§4.5) must always match, so it can hold none of them; they belong in `match` and `is`.
- **Referring names** name a variant, a type, or a top-level constant through a qualified name. A variant with fields is written with its fields, as a call pattern, as when it is built (named alone, it is warned of, above); a constant is compared with `==`.
- **Type patterns.** A bare type name tests a value's type, and `as` binds the value with that type: `case Int as n`, `x is String as s`. Against an `any` value it matches the values of that type inside (§8.3), so, giving no type arguments, it names no generic one, and a type not meeting the `any` type's traits is never inside: the pattern is ruled out (below). Against a union it selects members (below). Against any other value it names that value's own type, a generic one by its bare name whatever its type arguments (`case Box` against a `Box<Int>`), and matches every value of it, as `_` does, so it covers the type for exhaustiveness; another type, or a variant of another enum, is ruled out. A struct without fields is such a pattern, its one value matched by its name. An alias names the type it stands for, before braces too (`case Mail{to}`); a generic alias stands for no one type, and `Never`, which no value has, names none. An `any` value's own type is never an `any` type, so an alias of one names only the subject's own type. A variant isn't a type, so one with fields is still written with its fields.
- **Ruled-out cases.** A pattern its subject's type can't hold never matches: a literal outside the subject's literal types or base (`case "c"` against `"a" | "b"` or an `Int`), `none` where no value of the type is `none`, a type or struct pattern naming another type, or a variant of another enum, against a value whose type is known where the pattern is checked (not a type parameter's, §8.1), a type an `any` value never holds (§8.3), a field compared by `==` or `!=` with what its type fixes to fail, and, on a union, a pattern selecting no member (below). Such a case is warned of once, its guard and body are neither checked nor run, and it covers nothing for exhaustiveness; an or-pattern leaves out an alternative so ruled out, and `x is` such a pattern is always false (§11.1). A field loop's pass gives its value one field's type (§11.2), so `match v: case Int as n: … case String as s: …` runs each field's own case, and a case is warned of only when every pass rules it out.

```ista
import toUpperCase from 'strings'

struct Email { to: String }

fn toString(self: Email) -> String: "mail to " + self.to

fn describe(x: any Stringable) -> String:
    match x:
        case Int as n: `a number, ${n}`
        case Email as e: `mail to ${e.to}`
        case _: String(x)

fn shout(x: any Stringable) -> String:
    if x is String as s: s.toUpperCase() else: String(x)
```

- **`as`** binds the whole matched part with its own type. Variants aren't types, so in `case Approved(by) as d`, `d` is a `Decision`.
- **On a union,** a pattern selects the members it can match, then matches the rest of itself against the selected member's value: a type pattern its type's member, a union's alias every member of it, a generic type's by its bare name the members instantiating it, and a literal's base type every literal member of that base, so against `Status | Int`, both `case Status as s` and `case String as s` bind `s: Status`; a literal its own literal member, else its base type's; `none` the `None` member; a type pattern, a struct pattern naming a type, or a literal, whose type or base no member is but an `any` member may hold, one that took it whole or one a value of it converts into through its traits' variance (§8.3), that `any` member, matching the values of that type inside it as against an `any` value, so `case Int as n` against `Plain | any Stringable` binds `n: Int`; a variant, bare or qualified (§5.3), the enum member declaring it; a struct pattern the member of the type it names, and `struct{…}` the shape member having its fields; a tuple, array or range pattern the member of its kind. A pattern selecting no member is ruled out (above); one selecting several that takes the value apart is a compile error, such as `case Box{value}` against `Box<Int> | Box<String>`: it names its member through an alias, `case Point as p`, or with type arguments, `case Box<Int>{value}`, which only a pattern on a union may give; a variant takes its enum's, `case Some<Int>(n)` against `Opt<Int> | Opt<String>`.
- **Remaining type.** On a union, a case's binder, `case v:` or `as`, has the subject's type without the members that earlier cases without a guard covered: after `case None:`, `case v:` binds the `T` of a `T?`. The subject itself keeps its type.

```ista
type Status = "draft" | "sent" | "failed"

fn describe(x: Int | String | None) -> String:
    match x:
        case None: "nothing"
        case Int as n: `number ${n}`
        case s: s                                  # the remaining type: String

fn label(s: Status) -> String:
    match s:
        case "draft": "Draft"
        case "sent" | "failed": "Done"             # every member: no case _
```

**`is` outside `match`.** `x is Pattern` is a boolean expression. Its bindings exist only where the match is known to have succeeded: in the body of an `if` or `while`, and on the right-hand side of an `and`. `or` can't introduce bindings, because afterwards it isn't known which side matched.

```ista statements
if r is Ok(y) and y > 0:
    use(y)            # y exists only here
```
