---
description: proposal 4 of docs/proposals, for computed types — associated types, struct constraints, mapped struct types, type `match`, field loops, struct comprehensions, rest in struct patterns and key types (`keyof S`, `s[k]`) — their syntax and the spec changes each needs; fourth in order, after the type names, structural shapes and union and literal types it builds on; read before specifying or implementing any of them
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-04
last_updated: 2026-11-04
tags: [proposal, language, types, syntax]
---

# Proposal: computed types

Lets a type be computed from another, such as a form schema's data type from the schema. Eight additions, no new reserved words; `infer` and `keyof` are contextual. Section numbers refer to `docs/spec.md`. Assumes proposals 1–3: PascalCase primitives, anonymous structs compared by shape (a *shape*, below), and union and literal types.

| Form | Example | Lands in |
| --- | --- | --- |
| Associated type | `type Data = T` in a struct, `type Data` in a trait, `Field<Int>.Data` | §3.1, §3.10 |
| Struct constraint | `T is struct { title: String; [_] is FormNode }` | §3.5 |
| Mapped struct type | `{ [F in keyof S]: S[F].Data }` | §3.1 |
| Type `match` | `type DataOf<D> = match D: case Field<infer T>: T …` | §3.17 |
| Field loop | `for field, node in ...form:` | §4 |
| Struct comprehension | `struct{for field, node in ...s: [field]: f(node)}` | §3.1, §4 |
| Rest in struct patterns | `const struct{title, ...rest} = form` | §3.11 |
| Key types | `keyof S`, `S[K]`, `s[k]` | §3.1, §3.9 |

## Example

```python
trait FormNode:
    type Data
    fn validate(self: Self, data: Self.Data) -> Array<String>

struct Field<T>:
    value: T?
    type Data = T

fn validate<T>(self: Field<T>, data: T) -> Array<String>: ...

struct Repeat<Row is FormNode>:
    row: Row                                        # the shape every row takes
    type Data = Array<Row.Data>

fn validate<R is FormNode>(self: Repeat<R>, data: Array<R.Data>) -> Array<String>:
    let errors: Array<String> = []
    for item in data:
        errors = [...errors, ...self.row.validate(item)]
    errors

struct Group<S is struct { [_] is FormNode }>:
    fields: S
    type Data = { [F in keyof S]: S[F].Data }

fn validate<S is struct { [_] is FormNode }>(self: Group<S>, data: Group<S>.Data) -> Array<String>:
    let errors: Array<String> = []
    for field, node in ...self.fields:              # checked once: node meets FormNode
        errors = [...errors, ...node.validate(data[field])]
    errors

struct OrderForm:
    country: Field<String>
    items: Repeat<Group<{ sku: Field<String>; qty: Field<Int> }>>

type Order = Group<OrderForm>.Data
# { country: String; items: Array<{ sku: String; qty: Int }> }
```

The same data type through a type `match`, without a trait:

```python
type DataOf<D> = match D:
    case Field<infer T>: T
    case Repeat<infer R>: Array<DataOf<R>>
    case Group<infer S>: DataOf<S>
    case struct: { [F in keyof D]: DataOf<D[F]> }

type Order = DataOf<OrderForm>
```

## 1. Associated types

In a struct or enum declaration:

```python
struct Field<T>:
    value: T?
    type Data = T

struct Cell<T> { value: T; type Data = T }
```

- **Declared** as `type Name = Type` in the body, among the fields or variants in any order.
  - `Name` is PascalCase, takes no type parameters, and in an enum differs from every variant's name.
  - `Type` may use the declaration's type parameters, its other associated types by bare name, and a type `match` (§4 below). An associated type can't refer to itself, as an alias can't.
  - The fields may name it bare.
- **Read** as `Type.Name` in any type position. It is an alias, the same type as what it names:
  - on a type, it substitutes: `Field<String>.Data` is `String`, and `Group<S>.Data`, with `S` a type parameter, is `{ [F in keyof S]: S[F].Data }`;
  - on a type parameter, `T.Data` for `T is FormNode` is opaque: it meets the trait's bound and is equal only to itself (§3.5).

  A static function on it is called through it: `R.Data.default()`.
- **Only the type's own declaration** declares one. An extern struct, a shape and a union have none.
- **`type` is contextual** here as before an alias's name (§2): `type: X` is still a field named `type`.

In a trait:

```python
trait Keyed:
    type Key is Stringable & Encodable
    fn key(self: Self) -> Self.Key
```

- **A requirement.** A type meets it with an associated type of that name, which meets the bound, if one is given.
- **Meeting a function requirement** (§3.10), `Self.Name` is the type's own: `fn validate<T>(self: Field<T>, data: T)` meets `fn validate(self: Self, data: Self.Data)`, since `Field<T>.Data` is `T`.
- **Object safety.** `Self.Name` counts as `Self`, so a trait whose functions use an associated type beyond the receiver can't follow `any`, nor be met by a union through its members (`3-union-types.md`, §6).
- **Inference** never goes through an associated type or a type `match`: `fn f<D>(x: DataOf<D>)` is called `f<OrderForm>(x)`, or with another argument that gives `D`.

## 2. Struct constraints

A struct constraint is a constraint on a struct's fields, written after `is`:

```python
fn fieldNames<S is struct { title: String; [_] is FormNode }>(form: S) -> Array<String>:
    const struct{title, ...rest} = form
    [for field, _ in ...rest: `${title}.${field}`]
```

| Constraint | Meets it |
| --- | --- |
| `struct` | any struct |
| `struct { [_] is X }` | a struct whose every field meets `X` |
| `struct { title: String; [_] is X }` | a struct with `title: String`, every other field meeting `X` |
| `struct { title: String }` | a struct with `title: String`, and any other fields |
| `struct { [_]: Int }` | a struct whose every field is an `Int` |

- **Structs only.** A *struct type* here is a struct declaration or a shape, with its type arguments. Only a struct type meets a struct constraint. A shared struct, an extern struct, an enum, a tuple, a union or any other type doesn't.
- **Entries**, separated by `;` as in any field list:
  - `name: Type` requires the field with exactly that type, after aliases resolve. In a type `match` case, the type may hold `infer` (§4 below): `id: infer K`.
  - `name is C` requires the field to meet `C`: traits joined with `&`, or a struct constraint.
  - `[_]: Type` and `[_] is C` do the same for every field the constraint doesn't name. One `[_]` entry at most.
- **`:` takes a type, `is` a constraint,** as everywhere else (`x: Int`, `T is Sendable`).
- **Open.** A struct may have fields the constraint doesn't name, unconstrained unless a `[_]` entry constrains them.
- **`&` inside and outside.** Inside the braces, `[_] is A & B` constrains each field; outside, `T is struct { [_] is A } & Sendable` constrains `T` itself.
- **Where.**
  - After `is` on any type parameter, as a type `match` case, and on an `infer` variable.
  - It is a constraint, never a type: it can't stand where a type is expected, or follow `any`.
  - In a constraint or a case, `struct { … }` is always a struct constraint. `{ … }` without the keyword is the shape it spells, which a case matches exactly.
- **Checked at each use,** as every constraint (§3.5): `Group<{ note: String }>` fails with "field `note: String` doesn't meet `FormNode`".
- **In a generic body,** checked once, a value `t` of `T`:
  - reads and writes each named field by name, `t.title`, typed as its entry: the exact type, or an opaque type meeting `C`;
  - reaches the other fields only through field loops (§5 below), mapped struct types (§3 below), struct comprehensions (§6 below), rest patterns (§7 below) and keys (§8 below). It never learns their names or count.

## 3. Mapped struct types

```python
{ [F in keyof S]: T }
{ id: String; [F in keyof S]: S[F].Data }
{ [K in "retries" | "region"]: Int }       # { region: Int; retries: Int }
```

- **Where.** A type position. In `[F in keyof S]`, `S` is a struct type (§2 above), a type parameter with a struct constraint, or a type `match`'s subject inside a struct-constraint case (§4 below). Any other type is a compile error.
- **Meaning.** An anonymous struct type.
  - The mapped entry `[K in U]: T` gives a field of the type `T` to each String literal of the union `U` that no named entry in the braces names. Each must be a valid field name.
  - Named entries are fields, as in any field list.
  - One mapped entry at most.
  - `K` is a type, so PascalCase. Inside `T`, it is that field's name as a literal type, and in `[F in keyof S]`, `S[F]` is that field's type.
  - A union has no order, and neither does a shape, so the mapped fields need none: they are visited in name order, as every struct's are (`2-structural-types.md`).
- **Checking.** `T` is checked as a field loop's body is (§5 below): once per field of a struct type. For a constrained `S`, it is checked once per named entry of its constraint, and once for its other fields, where `S[F]` meets the `[_]` entry's constraint, if any. A field the constraint names, such as `title: String`, is either named in the braces, which skips it in the mapping, or `T` must fit it.
- **Nothing else carries over.** The fields take no defaults or annotations from `S`.
- **Identity.** A mapped struct type is a shape (`2-structural-types.md`): the same type as any anonymous struct type with its fields, so `Group<OrderForm>.Data` equals a hand-written `{ country: String; items: … }`. One reached again through a type `match` reduction (§4 below) keeps its alias and arguments as its identity.
- **Values** are built by any struct literal that expects the type (§3.1), or by a struct comprehension (§6 below).

## 4. Type `match`

```python
type DataOf<D> = match D:
    case Field<infer T>: T
    case Repeat<infer R>: Array<DataOf<R>>
    case struct: { [F in keyof D]: DataOf<D[F]> }

type IdOf<T> = match T:
    case struct { id: infer K }: K

DataOf<Field<Int> | Field<String>>          # Int | String: a union distributes
```

- **Where.** The whole right-hand side of a type alias or an associated type. The subject is any type; `match (A, B):` matches two at once.
- **Cases** are tried in order, and the first that matches gives the type. A case's type stands after its `:`, on the same line or indented below.
  - **`case P:`** matches a type of `P`'s form.
    - In `P`, `infer T` binds a new type variable to the part standing there, visible in the case's type. A later bare `T` in `P` must be that same part: `case Pair<infer T, T>:`.
    - A variable may be constrained, `Field<infer T is Encodable>`, and the case then matches only when the constraint holds.
    - Without `infer`, `P` is matched as the type itself, after aliases resolve.
    - Matching is exact: no conversion into a union and no one-element tuple conversion (§2). The one exception: a literal type matches a case naming its base type, so a `Bool` subject, `true | false`, meets `case Bool:`.
  - **`case struct …:`** matches a struct type meeting the struct constraint (§2 above). A type that doesn't meet it isn't an error: the case just doesn't match. Its type may map the subject and use the constraint's `infer` variables.
  - **`case _:`** matches any type.
- **Unions distribute.** When the subject is a union, each member is matched on its own and the cases' types join into a union.
  - Inside a case, a subject written as a type parameter, as in `match D:`, stands for the member being matched.
  - `Never`, a union of no members, gives `Never`.
  - A tuple isn't a union, so `match (D,):` matches a union whole.
- **No case matching** is a compile error where the alias is used: `DataOf<Int>`: no case matches `Int`.
- **Reduction.** At a use, the match reduces to its first matching case. In a generic body (§3.5), it reduces only when the first case that could match matches whatever its type parameters become, unions included. Otherwise it stays unreduced: opaque, and equal only to the same alias with the same arguments, as a type parameter is equal only to itself.
- **Recursion.** An alias whose body is a `match` may refer to itself, directly or through others.
  - `DataOf<Tree>` is one type, so a reduction that reaches it again refers to it, as a recursive struct refers to itself, under the same finiteness rule (§3.1).
  - A reduction that never repeats, such as `W<T>` reducing to `W<Array<T>>`, is the endless instantiation of §3.5, a compile error.

## 5. Field loops

```python
for field, node in ...form:
    log.info(`${field} is filled`)
```

- **`for key, value in ...x:`** runs its body once per field of `x`, in name order (`2-structural-types.md`), as the body written out once per field.
  - The `...` tells it from iterating an `Iterable` (§3.10), which a struct may also be.
  - `x` is a value of a struct type, of a type parameter with a struct constraint (§2 above), or a rest bound by a struct pattern (§7 below).
  - `...*x` loops over the value behind a shared struct.
- **Targets.** Exactly two. `value` is a copy of the field, a declaration target (§3.15). `key` is a name or `_`.
- **`key`** is a value of the field's name as a String literal type, so it passes as a `String`, compares, matches and is sent like any value.
  - It is a single key (§8 below): `y[key]` is the field it names, a place (§3.7), where `y`'s type has that field.
  - That `y` may be `x`'s type, the struct `x` was taken from by a rest pattern, or a mapped struct type over either that gives the field.
- **Checking.**
  - For a struct type, the body is checked once per field: `value` has that field's type and `key` its name's literal type. A field's type may involve type parameters.
  - For a type with a struct constraint, or a rest of one, it is checked once per named entry, with its type, and once for the other fields.
  - For the other fields, `value` has an opaque type meeting the `[_]` entry's constraint, if any. `key` has an opaque type within `keyof S`, and `y[key]` on a mapped struct type has the mapped entry's type, with `S[F]` as that opaque type.
- **A loop like any other.** Each pass is a block of its own (§3.4), so `break`, `continue`, labels, `hold` and `await` work as in any `for`. It is a statement of type `Unit`.
- **Array comprehensions** take the same header, `[for k, v in ...x: expr]`. The array has one element type (§4), such as `String` for `k` itself (`3-union-types.md`, §4), or `any X` for an object-safe `X`.

## 6. Struct comprehensions

```python
struct SettingsForm:
    retries: Field<Int>
    region: Field<String>

fn current(s: SettingsForm) -> { [F in keyof SettingsForm]: SettingsForm[F].Data? }:
    struct{for field, node in ...s: [field]: node.value}
```

- **Form.** A struct literal, `struct{…}` or `Name{…}`, ends with a field loop's header and `[key]: expr`, after any named fields: `struct{id, for k, v in ...rest: [k]: expr}`.
  - The bracket holds the loop's `key`, so the entry never reads as a field declaration.
  - There is no `if` clause and no spread (§3.1): the literal gives every field itself.
- **Type.**
  - From the expected type, as a `struct{…}` literal's (§3.1), which has exactly the named fields and `x`'s.
  - Without one, the shape of the named fields and each of `x`'s, typed as `expr` is there. That needs `x`'s fields known: not a constrained type parameter, or a rest of one.
- **Checking** follows the field loop's (§5 above), each `expr` against its field's expected type.
- **Evaluation** runs the named fields as written, then the comprehension in name order.

## 7. Rest in struct patterns

```python
const struct{title, ...rest} = form
match page:
    case Page{title == "", ...rest}: ...
```

- **Form.** `...name` as the last item of a struct pattern, named or `struct{…}`, in a declaration target (§3.15) or a `match` (§3.11). It binds a struct of the fields the pattern doesn't name, a copy.
- **Type.**
  - For a struct type, the shape of those fields.
  - For a type parameter with a struct constraint, an opaque struct meeting the constraint without the entries the pattern names, such as `struct { [_] is C }`. Field loops, struct comprehensions and keys take it (§5, §6, §8).
- **Can't fail,** so it is allowed in declaration targets.

## 8. Key types

```python
struct Settings { retries: Int; region: String }

fn read(s: Settings, k: keyof Settings) -> Int | String:
    s[k]                                    # the field k names, chosen when the program runs

const which: keyof Settings = "region"      # a literal type checks against the keys
type RetryType = Settings["retries"]        # Int
```

- **`keyof S`** is the union of `S`'s field names as String literal types (`3-union-types.md`). `S` is as in a mapped struct type (§3 above).
  - Over a type parameter with a struct constraint, `keyof S` is opaque, and holds the constraint's named fields' literals.
- **`S[K]`** in a type position is the type of the field `K` names, for `K` one literal. For a union of `S`'s keys, it is the union of their types: `Settings[keyof Settings]` is `Int | String`.
- **A key is a value** like any String literal: compared, matched by literal patterns, passed where a `String` is expected, sent.
- **`s[k]`** with `k: K` reads the field `k` names when the program runs, typed `S[K]`.
  - It applies whenever `K` is within `keyof S`, before any `index` (§3.9). Any other key calls `index`, as today.
  - The brackets expect `keyof S` when `S` has no `index`, so a literal there is a key: `s["region"]`. On a struct with an `index`, `s["region"]` calls it.
- **A single key is a place.** When `K` is one literal, or a member type parameter `K in keyof S` (`3-union-types.md`), `s[k]` is a place, a field path as `s.name` is (§3.7).
  - It can be read, written, passed by `&`, and be the receiver of a method taking `&self`. As a field path, not an element, nothing is copied in and out.
  - Inside a generic body, `S[K]` is then one field's type, opaque.
  - A field loop's key is a single key.
- **Writing through several keys.** When `K` may be several keys, `s[k] = v` needs `v` to fit every field `K` may name, each through its own conversion.
  - A compound assignment reads first, so `s[k] += 1` needs `S[K]` to allow `+`. It does when every field is an `Int`; a union of several types doesn't (`3-union-types.md`, §6).
  - `&s[k]`, and a method taking `&self` on `s[k]`, need a single key, since a reference to a union-typed place would let the callee write another member's type.
- **Running.** A key's value is a tag of the union of literals, as for any such union (`3-union-types.md`).
  - Each struct type has a static table from that tag to its field's position, so `s[k]` reads the field at that position and converts it into the union, with no lookup by name.
  - A write through several keys switches on the tag, converting `v` into each field's type.

**Entries.** A key and a value whose type follows from it are a struct with a member type parameter, and a key chosen at runtime is the union of one entry per key. No rule beyond those above:

```python
struct Entry<S is struct, K in keyof S> { key: K; value: S[K] }
type AnyEntry<S is struct> = { [K in keyof S]: Entry<S, K> }[keyof S]
# AnyEntry<Settings> is Entry<Settings, "retries"> | Entry<Settings, "region">

trait Applies<S>:
    fn apply(self: Self, target: &S)

fn apply<S is struct, K in keyof S>(self: Entry<S, K>, target: &S):
    target[self.key] = self.value           # one key per instantiation

const e: AnyEntry<Settings> = Entry{key: "region", value: "eu"}
e.apply(&settings)                          # the union meets Applies; the call runs the member's
```

- `AnyEntry` indexes a mapped struct type by its own keys, giving the union of its fields' types (`S[K]` above).
- `Entry{key: "region", …}` builds the one member it fits (`3-union-types.md`, §2).
- The union meets `Applies` because every member does (`3-union-types.md`, §6).

## Grammar

```
Constraint       += StructConstraint
StructConstraint  = "struct" [ "{" [ ConstraintEntry { ";" ConstraintEntry } ] "}" ]
ConstraintEntry   = ( name | "[" "_" "]" ) ":" Type          # Type may hold infer in a case
                  | ( name | "[" "_" "]" ) "is" Constraint   # [_]: every field not named
Type             += Type "." TypeName                        # Field<Int>.Data, Self.Data
                  | Type "[" Type "]"                        # a field's type, by key
                  | "keyof" Type                             # the union of a struct's field names
                  | "{" { FieldEntry ";" } "[" TypeName "in" Type "]" ":" Type { ";" FieldEntry } "}"
                  | "infer" TypeName [ "is" Constraint ]     # in a type match case only
                  # .Name, [K] and ? bind tightest, then keyof, then |: keyof S[K] is keyof (S[K])
AliasBody        += TypeMatch
TypeMatch         = "match" Type ":" INDENT TypeCase+ DEDENT
TypeCase          = "case" ( Type | StructConstraint | "_" ) ":" TypeBody
StructItem       += "type" TypeName "=" ( Type | TypeMatch )
TraitItem        += "type" TypeName [ "is" Constraint ]
FieldHeader       = "for" Target "," Target "in" "..." Expr
ForStmt          += FieldHeader ":" Body
ArrayCompr       += "[" FieldHeader ":" Expr "]"
StructLiteral    += ( Name [ TypeArgs ] | "struct" ) "{" { FieldInit "," } FieldHeader ":" "[" name "]" ":" Expr "}"
StructPattern    += "..." name                               # last item
```

## Spec changes

- **Cheat sheet.** Add a line per form:
  - `type Data = T` in a struct, and `Field<Int>.Data`;
  - `T is struct { title: String; [_] is X }`;
  - `{ [F in keyof S]: S[F]? }`;
  - `type DataOf<D> = match D: case Field<infer T>: T`;
  - `for field, node in ...form:`;
  - `struct{for field, node in ...s: [field]: f(node)}`;
  - `const struct{title, ...rest} = form`;
  - `keyof S` and `s[k]`.
- **§2.** The contextual-keyword sentence gains `type` before an associated type's name in a struct, enum or trait body. It also gains two new words: `infer` before a type variable's name in a type `match` case, and `keyof` before a type in a type position.
- **§3.1 Structs.**
  - New paragraphs **Associated types**, **Mapped struct types** and **Key types**, from §1, §3 and §8 above.
  - **Construction:** a struct literal may end with a struct comprehension (§6 above).
  - **Anonymous structs:** "Only a declaration's fields have defaults, not an anonymous struct type's" gains "nor associated types".
  - **Identity:** a mapped struct type is a shape, as `2-structural-types.md` makes every anonymous struct type.
- **§3.5 Generics.**
  - **Constraints:** a constraint may be a struct constraint, from §2 above.
  - **Checked once:** an associated type of a type parameter, `T.Name`, and an unreduced type `match` are opaque, each equal only to itself.
  - **Inference:** never through an associated type or a type `match`.
  - **Parsing:** type arguments may hold `S[K]`, so `a < b[c] > (d)` reads as a call.
  - **Compiled per instantiation:** the endless-instantiation error covers a type `match`'s reductions.
- **§3.7 Methods and references.** What can be referenced gains `&s[k]` with a single key, a field path; a union of keys is a compile error there.
- **§3.9 Operator overloading.** **Indexing:** a struct is indexed by its keys, `s[k]`, built in like `->` and before any `index`. A single key is a place, and a write through several keys needs a value fitting each field (§8 above).
- **§3.10 Traits.**
  - New bullet **Associated types:** requirements, bounds, and `Self.Name` when meeting a function requirement.
  - **Coherence:** an associated type is declared only by its type, so it is the same in every module.
  - **Object safety:** `Self.Name` counts as `Self`.
  - **Fields:** a trait's field requirement serves any type and `any` values. A struct constraint (§3.5) states a struct's fields, which generic code may also write.
- **§3.11 Enums and patterns.** Struct patterns gain a rest, from §7 above.
- **§3.15 Tuples.** Declaration targets may hold a struct pattern's rest.
- **§3.16 Annotations.** "There is no user-facing reflection in v0.1" gains "; a field loop (§4) is resolved at compile time and reaches only a struct's fields".
- **§3.17 Type aliases.**
  - An alias's body may be a type `match`, which distributes over a union subject, from §4 above.
  - "An alias can't refer to itself" gains "unless its body is a type `match`".
- **§4 Expressions and control flow.**
  - The `for` rule gains field loops, from §5 above.
  - **Comprehensions** gain the field-loop header for arrays (§5 above) and struct comprehensions (§6 above).
- **§14 Future work.** Add what this proposal leaves out:
  - associated types with type parameters, and for types declared elsewhere, such as primitives;
  - field loops over enums or tuples;
  - filtering, renaming or making fields optional per field in a mapped type;
  - carrying field annotations into a mapped type;
  - closed struct constraints, met only by a struct with exactly the named fields;
  - conformance for every struct meeting a constraint at once, such as `derive FormNode for struct { [_] is FormNode }`, in place of a wrapper like `Group`.
