---
description: structs: construction, field defaults, associated types, anonymous, mapped and key types, field order, recursion, getters; read before changing struct typing, shapes or keyof
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 5.2 Structs

A struct is a named record with typed fields, one per line. Structs are ordinary types: use them for variables, parameters, return values and inbox messages alike.

```python
struct ReviewRequest:
    purchaseId: String
    amount: Int
    replyTo: Inbox<Verdict>
```

Construction lists the fields in braces after the type's name: `ReviewRequest{purchaseId: "P-1", amount: 900, replyTo: replies}`. The same value may be written as an indented value (§3.2), its fields on the lines below `ReviewRequest:`, or below a line ending in `=` where the type is expected, as the declaration lays them out. As in JavaScript, a bare name is always short for a field of the same name: `Pair{first, second}` means `Pair{first: first, second: second}`. A struct with exactly one field may take its value without the field's name, as long as that value isn't a bare name: `UserId{"u-1"}` and `UserId{prefix + id}` are positional, while `UserId{id}` always means the field `id`. To pass a variable positionally, wrap it in parentheses: `UserId{(id)}`. Both a reader and the parser can therefore tell the forms apart without knowing the struct's fields. A struct with no fields is written bare, its name alone being its value (`struct Marker` makes the value `Marker`), a generic one given its type arguments after its name, `Tag<Int>`, or taking them from the type expected of it; braces after it are a compile error. An updated copy spreads an existing value and overrides some fields: `Req{...req, amount: 0}` is `req` with `amount` changed, and `req` itself is untouched; `struct{...req, amount: 0}` does the same, taking the type from `req`. The spread comes first and only once, its value has the literal's type, and the fields named after it override it; `Req{...req}` is a plain copy. A literal may instead end with a struct comprehension, which gives each field of a struct a field of its own (§10.5): `struct{id, for k, v in ...rest: [k]: f(v)}`. Structs can be destructured in `match` patterns, and by the targets of declarations and assignments (§4.5). Fields have no visibility modifiers: any code can read them, since any module could declare a method on the struct anyway. Names of functions, methods, variables and fields are camelCase, preferring JavaScript's names where one exists (`push`, `indexOf`). A name that breaks these conventions, or the PascalCase rule for types (§4.1), is a compile error.

**Field defaults.** A field of a struct or a variant may have a default after its type: `times: Int = 3`. As a parameter's default does (§6.1), it is part of building the value: it is computed at every literal or call that leaves the field out, in the declaring module's scope and before the value is built, and it may use the fields before it, as in `backoff: Int = times * 2`. A field with a default may omit its type, which is then the default's: `backoff = times * 2`. A literal written with names alone may leave out any field with a default, wherever the field stands; a spread gives every field, so it runs no default. A default never awaits, and a panic in it names the struct or variant it builds, at the default. A top-level `const` computes a default when compile time computes its expression (§5.1). JSON reads none: a field missing from an object fails as any missing field does (§17.4). Only a declaration's fields have defaults, not an anonymous struct type's or a trait's, nor associated types, and an anonymous struct type's fields take no annotations either (§5.5). A variant's fields are declared as a function's parameters are (§5.3), so its defaults trail: every field after one with a default has one too, and its last field may be a rest.

**Associated types.** A struct or enum declares a type computed from its type arguments among its fields or variants, in any order: `type Data = T`.

```python
struct Field<T>:
    value: T?
    type Data = T

struct Cell<T> { value: T, type Data = Array<T> }
```

- **Declared** as `type Name = Type` in the body. `Name` is PascalCase, takes no type parameters and, in an enum, differs from every variant's name. `Type` may use the declaration's type parameters and its other associated types by bare name, or be a type `match` (§4.6), and the fields may name it bare. It can't refer to itself, unless its body is a type `match` (§4.6), not even through an instantiation, as `type Data = { [F in keyof S]: S[F].Data }` would for an `S` holding the type again: each associated type on that cycle names no type, a compile error where an instantiation reaching it is written, a written type's arguments or those a call or literal infers. A top-level alias may (§4.6).
- **Read** as `Type.Name` in any type position, an alias for what it names: `Field<String>.Data` is `String`. On a type parameter whose trait requires it, `T.Data` is opaque (§8.1): it meets the trait's bound and is equal only to itself. A static function on it is called through it: `R.Data.default()`.
- **Only the type's own declaration** declares one, a shared struct's and an extern struct's too, the latter in a body holding only associated types (§17.2): an anonymous struct type, a union and an `any` type have none. A trait requires one with `type Name`, met by the type's own (§8.2).

**Anonymous structs.** `struct { … }` is a struct type without a name, usable anywhere a type is. In a type position the keyword may be left out, since a `{` there can only be a field list: `Array<struct { sku: String, qty: Int }>` and `Array<{ sku: String, qty: Int }>` are the same type, and a formatter can pick one style. An indented block under a field is sugar for one, and any struct declaration may use braces on a single line, as in `struct Req { id: Int, value: String }`. An anonymous struct type is its *shape*: its field names and their types. Two with the same fields, written anywhere and in any order, are one type, so `{ a: Int, b: Int }` is `{ b: Int, a: Int }`, while struct declarations stay nominal: two declarations are two types even with identical fields.

```python
struct Response:
    id: String
    data:                          # sugar for  data: { value: Int, result: String }
        value: Int
        result: String
    items: Array<{ sku: String, qty: Int }>

struct Req { id: Int, value: String }

const value = 1
const r = Response{
    id: "x",
    data: struct{value, result: "ok"},       # value is short for value: value
    items: [struct{sku: "a", qty: 2}],
}
```

A `struct{…}` literal takes its type from context: the expected type where there is one, such as the field or array element above, the one member it fits where that is a union (§4.2), and otherwise the shape of its named items, so `struct{value: 1}` is `{ value: Int }`. When a shape is needed in more than one place, name it with an alias (§4.6), or declare a struct for a distinct type.

**Nominal to shape.** A value of a struct declaration fits where a shape is expected when its fields, with its type arguments substituted, are that shape, and none of its fields is annotated (§5.5): `struct Pixel { y: Int, x: Int }` fits `{ x: Int, y: Int }`, and the conversion copies the value as the shape. It applies as the conversion into a union does (§4.2): once, and inside another type as its variance allows (§8.1), so an `Array<Pixel>` is an `Array<{ x: Int, y: Int }>`, and a struct whose field is a nominal struct fits a shape whose field is that struct's shape. A shape never fits a struct declaration; a literal builds one.

**Mapped struct types.** `{ [F in keyof S]: T }` is an anonymous struct type with a field of type `T` for each String literal of the union after `in` that no named entry in its braces names: `{ [K in "retries" | "region"]: Int }` is `{ region: Int, retries: Int }`, and `{ id: String, [F in keyof S]: S[F].Data }` takes `id` from its named entry. One mapped entry at most; each key must be a valid field name. `F` is a type, PascalCase: inside `T` it is that field's name as a literal type, and in `[F in keyof S]`, `S[F]` is that field's type. `S` is a struct type or a type parameter with a struct constraint (§8.1); any other type is a compile error. The mapped fields are visited in name order, as every struct's are, and take no defaults or annotations from `S`. A mapped struct type is a shape, the same type as any anonymous struct type with its fields, built by any struct literal that expects it. `T` is checked once per field of a struct type; for a constrained `S`, once per named entry of its constraint and once for its other fields, where `S[F]` meets the `[_]` entry's constraint, so a field the constraint names is named in the braces, which skips it, or `T` must fit it.

**Key types.** `keyof S` is the union of `S`'s field names as String literal types: `keyof Req` is `"id" | "value"`, and `keyof {}` is `Never`. Over a type parameter with a struct constraint it is opaque, holding the literals of the fields the constraint names. `S[K]` is the type of the field the key `K` names, and, for a union of keys, the union of their types: `Req[keyof Req]` is `Int | String`. For a key standing for one of several fields not known yet, a member type parameter `K in keyof S`, `S[K]` is that one field's type, opaque, unless the constraint gives every field `K` may name the same exact type: under `S is struct { a: Int, [_]: Int }` it is `Int`. `.Name`, `[K]` and `?` bind tightest, then `keyof`, then `|`, so `keyof S[K]` is `keyof (S[K])`. A key is a value like any String literal: compared, matched by literal patterns, passed where a `String` is expected, sent. `s[k]` reads the field `k` names (§10.2). `keyof` also heads a loop over a type's keys, `for K in keyof S` (§11.2). A struct with a member type parameter pairs a key with its field's type, and a mapped type indexed by its own keys gives the union of one such entry per key:

```python
struct Settings { retries: Int, region: String }
struct Entry<S is struct, K in keyof S> { key: K, value: S[K] }
type AnyEntry<S is struct> = { [K in keyof S]: Entry<S, K> }[keyof S]
# AnyEntry<Settings> is Entry<Settings, "retries"> | Entry<Settings, "region">

trait Applies<S>:
    fn apply(self: Self, target: &S)

fn apply<S is struct, K in keyof S>(self: Entry<S, K>, target: &S):
    target[self.key] = self.value           # one key per instantiation

fn moved() -> Settings:
    let settings = Settings{retries: 3, region: "us"}
    const e: AnyEntry<Settings> = Entry{key: "region", value: "eu"}
    e.apply(&settings)                      # the union meets Applies<Settings> through its members
    settings
```

**Field order.** Every struct's fields, nominal or shape, are visited in name order, sorted as JSON sorts keys (§17.4). Declaration order matters only to evaluation: a field default sees the fields declared before it, and a literal evaluates its fields as written.

**Recursive types.** A struct or enum may refer to itself, directly or through other types: `struct Node { value: Int, children: Array<Node> }`. A field whose type is the struct itself must be in a union, such as an optional (`next: Node?`), or sit inside a collection, so that every value stays finite. The rule follows fields through other structs, tuples and anonymous structs, so `struct A { b: B }` with `struct B { a: A }` is an error at both fields, while a union, an enum or a collection on the way ends the chain. A recursive alias (§4.6) is held to the same rule: `type List = { head: Int, tail: List? }` checks, while `tail: List` is an error at the field, and `type T = (Int, T)` at the alias. A struct or enum stays a type of its own however it refers to itself, while a recursive alias of a shape is that shape, structural: two aliases writing the same recursive shape are one type (§4.6).

**Shared structs.** `shared struct Inbox<T>: …` declares a struct whose values are handles to one cell holding its fields, built with `new` and read through with `->` (§5.4).

**Getters.** A value computed from fields may read as a field: a method declared `fn get name`, a getter, is read with `.`, and `x.g` is the call `g(x)`, made on every read.

```python
struct Person:
    first: String
    last: String

fn get full(self: Person) -> String: `${self.first} ${self.last}`

fn greeting(p: Person) -> String: `Dear ${p.full}`   # Person{first: "Ada", last: "Lovelace"} gives "Dear Ada Lovelace"
```

- **What it is.** A method of a module's own, `get` after its `fn` and before its name, taking exactly one parameter, `self`, by value, and not `async`; it may be generic, and of any mark (§9.1), which each read is judged by as its call would be. `get` makes one only before a name: `fn get(`, `fn get<` and `fn get.` declare a function named `get`, and `fn get get(…)` a getter named `get`. A trait's requirement, an extern function or a local function is never one: a trait requires a field instead, which a getter meets (§8.2).
- **Read as a field.** `x.g` reads it on any type, a shared struct's handle among them, as that type's methods are called (§5.4), and `x?.g` on the value inside an optional (§10.4). `x.g(…)` calls the function it gives, as for a field holding one, and called as a plain function, `g(x)`, it is the method it is. It is found as methods are, by the type of `self`, so a module may declare getters for types it imports (§13.1).
- **One meaning per name.** On a type, a name is a field, a getter, a method or a key of a keyed `index` (§10.2), never two: a use finding a getter beside a field or a method of its name, among those taking its receiver, or any of them beside a keyed `index` taking the name, is a compile error, as a call finding a field and a method is (§6.4).
- **Never stored.** Reading or assigning a field never runs code, and a getter is no field, nor is a keyed read (§10.2): a literal never gives one, nothing assigns one or passes it by `&`, and `==`, hashing, the JSON codecs, struct patterns, `keyof`, spreads, field loops, shapes and struct constraints see the stored fields only; a trait's field requirement, which code only reads, is met by a getter too (§8.2). This keeps structs plain data under value semantics.
