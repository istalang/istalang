---
description: proposal 2 of docs/proposals, for structural anonymous struct types — named structs stay nominal, anonymous ones compare by shape, aliases name shapes, nominal values fit equal shapes — the rules, what changes in behaviour and power, the spec edits and implementation notes; second in order, since mapped struct types in proposal 4 become plain shapes once it lands, which drops their identity rules; read before specifying or implementing it
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-04
last_updated: 2026-11-04
tags: [proposal, language, types, checker, lowering]
---

# Proposal: structural anonymous struct types

`struct` declarations stay nominal. Anonymous struct types, `{ … }` and `struct { … }`, compare by shape: their field names and the fields' types, in any order. An alias names a shape, and a nominal struct's value fits an equal shape. No new syntax; one new conversion. Section numbers refer to `docs/spec.md`. Written against today's spec: with `1-type-names.md` in, read `int`, `string` and the other primitives as `Int`, `String` and so on.

```python
struct Order:                        # nominal, as today
    id: string
    total: int

type Point = { x: int; y: int }      # a named shape: the alias is the type's spelling

fn norm(p: { x: int; y: int }) -> float: ...

const a: Point = struct{x: 1, y: 2}
norm(a)                              # one type: Point is { x: int; y: int }

struct Pixel { x: int; y: int }
norm(Pixel{x: 3, y: 4})              # a nominal value fits its equal shape
```

## Rules

- **Identity.** An anonymous struct type is its shape: its field names and their types. Two with the same fields, written anywhere and in any order, are one type: `{ a: int; b: int }` is `{ b: int; a: int }`.
- **Field order.** Every struct's fields, nominal or shape, are visited in name order, sorted as JSON sorts keys (§9). That applies to whatever enumerates them, such as the field loops, struct comprehensions and rest patterns of `4-computed-types.md`. Declaration order matters only to evaluation: a field default sees the fields declared before it (§3.1), and a literal evaluates its fields as written.
- **Named shapes are aliases.** `type Point = { x: int; y: int }` names the shape; the alias stays only its spelling (§3.17), shown in messages. A generic alias names a family: `type Pair<A, B> = { first: A; second: B }`.
- **Literals.** `struct{…}` takes the expected type as today; without one, its type is the shape of its named items, `struct{value: 1}` being `{ value: int }`. A literal may also be written through an alias of a shape: `Point{x: 1, y: 2}`.
- **Only fields.** An anonymous struct type has no defaults, as today, no associated types, and now no annotations: an annotation on its field is a compile error.
- **Nominal to shape.** A value of a nominal struct fits where a shape is expected when its fields, with its type arguments substituted, are that shape, and none of its fields is annotated. The conversion copies the value as the shape. It applies as the wrap into `T?` does (§2): to a whole value, once, never inside another type, so an `Array<Pixel>` is no `Array<Point>`, and nested nominal types must be the same. A shape never fits a nominal struct; a literal builds one.
- **Functions on shapes.**
  - A function taking a shape takes every value of it, whatever alias or literal wrote it.
  - Overloads and their clashes (§3.7) compare shapes, so `fn f(p: Point)` and `fn f(p: { x: int; y: int })` clash.
  - A call fitting both `fn f(p: Pixel)` and `fn f(p: Point)` with a `Pixel` takes the first. Taking an argument as it is beats converting it, as for a one-element tuple (§3.7).
  - Inference sees a nominal value's fields where a shape is expected: `fn f<T>(p: { x: T; y: T })` called with a `Pixel` binds `T` to `int`.
  - A shape has no module, so argument-dependent lookup (§3.13) finds nothing for it; its functions are found as any function is, by import. A static function on an alias of a shape is the shape's (§3.17).
- **Traits.** A shape has no module, so the coherence rule (§3.10) finds its functions in the trait's module, or in the module of another type they take. `Sendable`, `Encodable` and `Decodable` are derived for it as for any anonymous struct.
- **Shared structs.** `*x` is the shape of the shared struct's fields, so it fits wherever that shape is expected, and any value of the shape spreads into `new Lease{…}` or writes `*x`.
- **`any` values.** A pattern naming an alias of a shape, `case Point{x, y}`, matches a value whose own type is that shape. A nominal value inside an `any` keeps its nominal type, so a shape's pattern doesn't match it.
- **Recursion.** An alias still can't refer to itself (§3.17): a recursive shape is written as a nominal struct. A computed type that reaches itself (`4-computed-types.md`, §4) keeps its alias and arguments as its identity, the one shape that isn't compared field by field.

## What changes in behaviour

| Code | Today | Proposed |
| --- | --- | --- |
| `{ a: int }` written in two places | two types | one type |
| `{ a: int; b: int }` and `{ b: int; a: int }` | two types | one type |
| `struct Pixel { y: int; x: int }` where `{ x: int; y: int }` is expected | a compile error | converts |
| `type P = { x: int }` | an alias of a type usable only through `P` | a named shape, the same type as every `{ x: int }` |
| `fn f(p: { x: int })` | callable only with a literal that takes its type from `p` | callable with any value of the shape, and any nominal struct of it |
| `struct{value: 1}` with no expected type | a fresh type of its own | `{ value: int }` |
| `if c: struct{a: 1} else: struct{a: 2}` | one type, by the later-branch rule | one type, by shape |
| `Point{x: 1, y: 2}` through an alias | a compile error | builds the shape |
| annotation on an anonymous struct's field | allowed (§9 table) | a compile error |
| a nominal value where its shape is expected | a compile error | converts |
| `*x` of a shared struct | a type of its own, per shared struct | the shape of its fields |
| two overloads over equal shapes written apart | two functions | a clash |

Nominal structs, enums, shared structs as handles, argument-dependent lookup and coherence for nominal types, and JSON output are unchanged.

## What changes in power

**Gained.**
- A shape can be used in many places without declaring a struct, and named by an alias.
- Functions over shapes take values from any module or library holding that shape, nominal ones included.
- Types computed by mapped struct types (`4-computed-types.md`) are shapes, so they equal hand-written ones: `Group<OrderForm>.Data` is `{ country: string; items: … }` wherever written.
- Order-free shapes: field order matters neither to a shape's identity nor to fitting one.
- One enumeration order for every struct, the one JSON already uses.
- The spec loses rules: the later-branch rule for anonymous literals and "one type per place written" go.

**Not gained.**
- Width subtyping: `{ a: int; b: int }` doesn't fit `{ a: int }`.
- Deep conversion: inside a collection, an optional or a field, nominal and shape stay apart.
- Shape to nominal: a nominal value is still built by its literal.

**Lost.**
- Anonymous types as cheap distinct types: two `{ value: int }` written for different meanings now mix. A distinct type is a nominal struct (§3.17), as before.
- Annotations on anonymous struct fields: a field needing `@JsonName` lives in a nominal struct.

## Spec changes

- **§2.** "There are no implicit conversions, with four exceptions" gains a fifth: a nominal struct's value into its equal shape (§3.1).
- **§3.1 Structs.**
  - **Anonymous structs:** "Two anonymous structs are always different types, even with identical fields, so the type checker never compares shapes" becomes the identity rule above. "An anonymous struct has no name to mention elsewhere: when a shape is needed in more than one place, declare a named struct" becomes "name a shape with an alias, or declare a struct for a distinct type".
  - The `struct{…}` literal paragraph: without an expected type, its type is its items' shape; the later-branch sentence goes.
  - New paragraphs **Nominal to shape** and **Field order**, from the rules above.
  - "Only a declaration's fields have defaults" gains "or annotations".
- **§3.5.** Inference matches a nominal value's fields against a shape parameter.
- **§3.7.** Overloads and clashes compare shapes, and a function taking a nominal argument as it is beats one converting it to its shape.
- **§3.9, §3.18.** `*x` is the shape of the shared struct's fields.
- **§3.10.** Coherence: a shape has no module, so it meets a trait through the trait's module, or another type's that its functions take.
- **§3.11.** A pattern may name an alias of a shape; it matches values of that shape.
- **§3.13.** Argument-dependent lookup finds nothing for a shape.
- **§3.16.** Annotations apply to fields of struct declarations and enum variants, not of anonymous struct types.
- **§3.17.** An alias of a shape names it, may stand before `{` to build it, and takes static functions for it.
- **§9.** The codec table's "struct, named or anonymous" keeps `@JsonName` and `@JsonSkip` to named structs.

## Implementation notes

1. **One home for identity.** `typeKey` (`src/compiler/checker/types/identity/type-keys.ts`) already promises a key equal exactly when `sameType` holds, and `sameType` (`types/type/index.ts`) mirrors it as a structural walk. Define `sameType(a, b)` as `typeKey(a) === typeKey(b)`, the key memoized per type object in a `WeakMap`, and drop the walk.
2. **The anonymous key.** Today `{${identityOf(origin)}…:${field types}}`; it becomes the field names and their keys, sorted by name: `{x:int,y:int}` however the fields were written. The value behind a shared struct loses its origin and arguments in the key the same way. Keep the canonical string as the identity, never a digest: a collision would make two types one without any error.
3. **`origin` becomes spelling.** `AnonymousStructType.origin` stays on the type, as `aliasedAs` does, for go-to-definition and field locations, but no key or relation reads it. Two equal shapes from two places are one type held as two objects.
4. **Recursive computed types.** A shape reached again during a type `match` reduction keys as its alias and arguments, so keys stay finite; `TypeCycle` (`types/properties/type-cycle.ts`) already guards the coinductive checks.
5. **The conversion.**
   - A new fit in `types/fitting/fit.ts`, nominal struct to shape, recorded once through `BodyContext.fit`.
   - `resolution/choosing/choice.ts` ranks it with the async and one-element tuple conversions, below taking an argument as it is.
   - Inference (`checker/types/inference/`) matches the nominal's substituted fields against a shape parameter.
   - Lowering rebuilds the value under the shape's type id, matching fields by name. Struct values carry their type (`src/definition/values/values.ts`).
6. **Lowering's type table.** `src/compiler/lowering/tables/type-table.ts` keeps one entry per checker key, so equal shapes share an entry with no code change; its banner's "two never share an entry" goes. Type ids are per deploy, so snapshots need no migration.
7. **Lookup and clashes.** `resolution/choosing/candidates.ts` already gives an anonymous type no owner module, so argument-dependent lookup and the trait coherence rule need no change. `rules/clashes.ts` compares through keys, so equal shapes clash with no change.
8. **Literals through an alias.** The struct-literal check accepts a name resolving to an alias of a shape; the parser is unchanged, since a name before `{` already constructs.
9. **Annotations.** The annotation check refuses annotations on an anonymous struct type's fields (`FieldDeclaration` in `src/compiler/syntax/types/index.ts` is `Annotatable` today).
10. **Messages and hovers.** `types/type/type-text.ts` prints the alias when the type was written through one, otherwise the shape, never a key.
11. **Tests** (fast-check, beside the code): `typeKey` equal exactly when `sameType` holds over generated types; shapes equal under reordered fields and declaration sites; the conversion refused through containers, for annotated fields and from shape to nominal; equal shapes clashing as overloads.
