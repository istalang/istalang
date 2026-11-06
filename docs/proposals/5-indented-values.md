---
description: proposal 5 of docs/proposals, for indented values — struct, map and array values written as indented blocks, the value-side mirror of the indented field block — with recursive aliases, `json.Json` redefined as a recursive union, `,` as the one list separator, with `;` only between statements, patterns as parameters, and line breaks separating the items of every bracketed list, with parenthesized import lists and import renames; the decided rules, what changes in behaviour and power, the spec edits and implementation notes; fifth in order, after the unions, literal types and computed types it builds on; read before specifying or implementing any of them
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-06
last_updated: 2026-11-06
tags: [proposal, language, syntax, types, stdlib, json]
---

# Proposal: indented values

A struct, map or array value may be written as an indented block, as a struct declaration's fields already are (§3.1): `key: value` lines build a struct or a map, and `- item` lines build an array. The block parses the same everywhere; the type it is built as decides what it means. With it come two more changes. Aliases may refer to themselves. `json.Json` becomes such an alias, a union, so JSON of any shape is written as plain literals. Three more changes stand on their own. `,` becomes the one separator in every list, and `;` stays only between statements. A parameter may be a pattern that can't fail, which takes its argument apart. Inside any bracketed list, a line break separates items as `,` does. An import's names may stand in parentheses, as such a list, and any imported name may be renamed. Section numbers refer to `docs/spec.md`.

```python
import Json from 'json'

struct Service:
    name: String
    replicas: Int = 1
    ports: Array<Int>
    env: Map<String, String>
    retry:
        times: Int
        backoffMs: Int

const api = Service:
    name: "api"
    ports:
        - 80
        - 443
    env:
        LOG_LEVEL: "debug"                     # a map's bare key is a String
        "x-region": "eu"
    retry:
        times: 3
        backoffMs: 200

const tree: Json = ["name": "api", "tags": ["web", 1, none]]   # no wrapping, at any depth
```

## Rules

### 1. Indented values

- **Opening.** An indented value opens on the lines below a line that ends right after one of these four:
  - the `=` of a `const`, a `let`, an assignment or a field's default;
  - `return`;
  - an entry's `:`;
  - an item's `-`.

  The value's lines sit deeper than that line. The **anonymous form**, nothing after the token, takes its type from the expected one, as `struct{…}` does (§3.1).
- **Named form.** A line ending in `T:` at the same places gives the value the type `T`, as `T{…}` does: `const api = Service:`, `return Pair<Int, String>:`, `retry: Retry:`. `T` is a named type with its arguments: a struct, a variant (`Rejected:`), an alias, `Map<String, Int>` or `Array<Int>`. `new T:` builds a shared struct (§3.18).
- **Nowhere else.** Headers keep their `:`, and their bodies are statements:
  - `if c:`, `while c:`, `for x in xs:`, `match x:`, `case P:`, `select:`;
  - a lambda's `fn(x):`.

  A body's line `Name:` with a block below it stays a label (§4). Inside `(…)`, `[…]` or braces, line breaks follow the list rule (§6 below), so no indented value opens there: an argument or an element is written `T{…}`.
- **Lines and ending.**
  - The value's lines stand at one column. The first line at the opening line's column, or left of it, ends the value, as any block ends (§2, §4).
  - `,` separates entries on one line. Comments and blank lines may go anywhere.
  - An entry's value is the expression on the rest of its line. It continues as any expression does, inside brackets, templates and `${…}`.
  - Nothing follows the value, on its opening line or after its block, so the statement ends with it.
- **Entries.** Each line holds one of:
  - `key: value`, where `key` is a name or a String literal (quoted, not a template);
  - `key:` alone, with the entry's value as the indented value below it, or `key: T:`;
  - a bare name, short for `name: name` (§3.1);
  - `...value`, a spread;
  - a struct comprehension, as the last entry (§4);
  - `- value`, an item. The `-` stands first on its line and is followed by a space or the line's end.
- **Items.**
  - `- value` holds an expression.
  - `- key: value` opens an anonymous keyed value. Its other entries align with `key`.
  - `- T:`, or `-` alone, opens a value on the lines below, deeper than the `-`.
  - `- -1` is the item −1. A line starting with `-1` is no item.
  - An item's expression may not start with `- `, so `- - 1` is an error. A nested array is written `- [1]`, or as a `-` with items below it.
- **The parser stays type-agnostic.** It reads every block the same way and tells entries apart by their first tokens, as it tells a struct literal's items apart (§3.1). It reads `T` as a type. What a block builds, and so whether its entries fit, is the checker's to decide, from the value's type.
- **Meaning by type:**

| The value's type | Its entries | Built as |
| --- | --- | --- |
| a struct, a variant, a shape, or an alias of one | names as keys, shorthand names, one spread first, a struct comprehension last | `T{…}` (§3.1), with defaults filling the fields left out |
| a type a map literal builds (§2) whose key type a String literal fits | names read as Strings, quoted keys, shorthand names, spreads | `["key": value, …]` |
| a type an array literal builds | items, and `- ...xs` spreads | `[…]` |
| a union | as for the one member it fits (§2) | that member's literal |
| none expected, and no `T` | names only: the shape of the entries; any quoted key: a `Map<String, V>`; items: an array | as `struct{…}`, `["k": v]` and `[…]` are typed without one |

- **Map keys.** A bare key may be any name, even one the naming rules refuse as a field (`LOG_LEVEL`), and it is that name's String. A reserved word is quoted (`"for": 1`). Of two equal keys, the later one's value wins, as in a map literal (§2). A map whose key type no String literal fits is written as a bracket literal, `[1: v]`.
- **Errors**, with codes left to the implementation:
  - items where a struct or a map is built, or keys where an array is;
  - items and keys in one value;
  - a quoted key where a struct is built;
  - any key where the map's key type no String literal fits;
  - a single-field value without its name, which keeps only its brace form (`Ok{42}`).
- **A literal like any other.** An indented value builds exactly what the matching brace or bracket literal builds, with the same field order and evaluation order (§3.1). It computes at compile time where its entries do (§3), and it may hold a value written in braces or brackets.

### 2. Recursive aliases

```python
type Tree<T> = T | Array<Tree<T>>
type List = { head: Int, tail: List? }
```

- **Self-reference.** An alias may refer to itself, directly or through other aliases, when each reference stands inside a type built from others:
  - a nominal type's argument: `Array<Tree<T>>`, `Map<String, Json>`; an alias's argument only where the alias's body puts its parameter guarded (`Cell<A>` for `type Cell<T> = { v: T }`, never `Id<A>` for `type Id<T> = T`), and a type `match` alias's where every case's type does and no case's pattern inspects it;
  - a trait's argument in an `any` type: `kids: any Iterable<Tree>`;
  - a field of a shape;
  - a tuple element;
  - a function type's parameter or result.

  A reference standing as the whole body, or as a member of the body's union, names no type, and stays a compile error: `type A = A | Int`, `type A = A?`. An alias whose body is a type `match` keeps its own rules (§3.17).
- **Finite values.** The rule of §3.1 holds: `type List = { head: Int, tail: List? }` checks, while `tail: List` is an error at the field.
- **Regular.** Each reference passes the alias's own type parameters, in order. `type W<T> = T | Array<W<Array<T>>>` would need endlessly many types: that is the compile error of §3.5.
- **Identity is structural (equi-recursive), the human's decision of 2026-11-06.** Two recursive types whose unfoldings are equal are one type, whatever aliases wrote them, as a shape is one type wherever written (`2-structural-types.md`): `type A = Int | Array<A>` and `type B = Int | Array<B>` mix, inside containers too. Structs and enums stay nominal.
  - A use stands for its body with itself substituted, unfolded where it is used. Its members, fields, patterns, conversions and exhaustiveness are its body's.
  - No fold or unfold is ever written: `1` converts into a `Tree<Int>`, and `case Array<Tree<Int>> as xs` selects a member.
  - **Why:** the form builder's generated data flows into domain modules that write the shapes they consume; with iso-recursion one self-reference (a category tree) made a structural shape nominal. Plan and evidence: `docs/work/proposals/p5-equi-recursive-identity.md`.
  - **How:** a recursive type is a node of a minimized cyclic graph, built by one constructor that closes a group of alias bodies, and its key is the graph's canonical spelling (`checker/types/identity/recursive-types.ts`, `recursive-terms.ts`).
- **In a union** its members join the union, flattened as a union member's are (§2): `Json | Int` and `Json?` are both `Json`, and with `type Forest = Tree | Array<Forest>`, `Forest` is `Tree`.
- **Spelled** as the alias it was written through in messages, hovers and extern keys; a compiled program names it by its preferred alias, which identifies nothing. A static function declared on it belongs to the type.

### 3. `json.Json` as a recursive union

```python
type Json = None | Bool | Int | Float | String | Array<Json> | Map<String, Json>
```

- **Recommended, and adopted here.** JSON of any nesting is then written as plain values. Today each level is wrapped in its variant, `Object{fields: …}` and `Integer{value: 1}`; as members of a union, the values go in by the conversion every union already has.
- **Literals at any depth, with no wrapping:**
  - `const j: Json = ["a": 1, "b": [true, none]]`, or the same as an indented value;
  - a member goes in by the conversion into a union (§2), each nested item against `Json`.
- **Empty literals.** Where a union holds both an array type and a map type, `[]` is the array and `[:]` the map, so `[]` against a `Json` checks. Today it fits both members, which is error 5300.
- **Taken apart by type patterns:** `case Int as n`, `case String as s`, `case Map<String, Json> as fields`, `case Array<Json> as items`, `case None`.
- **Numbers.** `Int` and `Float` are two members. The reader makes a JSON number an `Int` or a `Float` as it decides between `Integer` and `Number` today.
- **Codecs.** `toJson(self: Json)` and `Json.fromJson` are the identity. The extern key is `json.Json`, spelled through the alias as `prelude.Optional<T>` is (`3-union-types.md`, note 11). Hosts see JSON as plain JavaScript values.
- **`Json?` is `Json`** (§2 above). There, a missing value and a JSON `null` look alike; `has(k)` still tells a missing key from a stored `null` (§2).
- **No variants.** `Null`, `Boolean`, `Integer`, `Number`, `Text`, `List` and `Object` no longer exist. A name of one is an unknown name, like any other.

### 4. `,` separates every list

- **One list separator.** `,` is the one separator between the items of every list. `;` stays only between statements. The lists are:
  - in brackets: struct, array and map literals, calls, patterns, type arguments and parameters;
  - in declarations and anonymous struct types: the fields of a struct or a variant, an enum's variants, a trait's members, a struct constraint's entries and a struct's associated types;
  - in an indented value: its entries (§1 above).

  In braces and on one line of an indented body alike, `;` there changes to `,`:

| Today | Proposed |
| --- | --- |
| `{ sku: String; qty: Int }` | `{ sku: String, qty: Int }` |
| `struct Req { id: Int; value: String }` | `struct Req { id: Int, value: String }` |
| `struct Retry { times: Int = 3; backoff = times * 2 }` | `struct Retry { times: Int = 3, backoff = times * 2 }` |
| `struct Cell<T> { value: T; type Data = Array<T> }` | `struct Cell<T> { value: T, type Data = Array<T> }` |
| `enum Color { Red; Green; Blue }` | `enum Color { Red, Green, Blue }` |
| `Rejected { by: String; reason: String }` | `Rejected { by: String, reason: String }` |
| `struct { title: String; [_] is Stringable }` | `struct { title: String, [_] is Stringable }` |
| `{ id: String; [F in keyof S]: S[F].Data }` | `{ id: String, [F in keyof S]: S[F].Data }` |
| fields, variants or trait members on one line of an indented body | the same with `,` |
| entries of an indented value on one line (§1 above) | `times: 3, backoffMs: 200` |

- **Statements keep `;`.** Statements share a line as they do today: `x = 1; y = 2`, a one-line block `{ log(msg); save(msg) }`, `fn(msg): { log(msg); save(msg); msg.id }`. So do a module's declarations.
  - `,` can't take this job, because a `,` already continues a statement that starts with targets. `a, b = (b, a)` is one tuple assignment (§3.15), and `let a, b = t` declares two names.
  - So `;` between list items, and `,` between statements, are compile errors.
- **Trait members are a list.** They declare what a type has, as fields do, and nothing evaluates them in order: `trait Shape { fn area(self: Self) -> Float, type Measure }`.
- **Match and select cases are neither list nor statements: one per line, as today.** Each case has a body, and nothing may follow a one-line body on its line (§4). The cases of a type `match` (§3.17) stand one per line too.
- **The formatter** writes a list on one line with `, `, and a broken list one item per line (§6 below). Statements keep the `;` the formatter writes today.

### 5. Parameter patterns

```python
type Point = { x: Float, y: Float }

fn norm(Point{x, y}) -> Float: math.sqrt(x * x + y * y)
fn length(Point{x, y} as self) -> Float: …              # a method, p.length(); self is the whole
fn area(struct{w, h}: Rect) -> Int: w * h
fn sum((a, b): (Int, Int)) -> Int: a + b

ps.map(fn(struct{x, y}): x + y)                          # types from fn(Point) -> R
pairs.map(fn((k, v)): `${k}=${v}`)
```

- **Which patterns.** A parameter may be any declaration target (§3.15) in place of its name: a struct pattern with its rest, a tuple pattern, nested at any depth, with `field as name` renames. Its names are bound in the body, and are immutable like any parameter (§3.3). A pattern that can fail (§3.11) is a compile error, as in a declaration target: `fn f(Ok{value})`, `fn f(Verdict{ok == false})`.
- **Its type.**
  - A pattern naming its type, `Point{x, y}` or `Pair<Int, String>{first, second}`, takes no annotation. Writing one beside it is an error, since one type would be written twice.
  - A `struct{…}` or tuple pattern names none. In a declared function it is annotated, `struct{w, h}: Rect`, or takes its type from its default, as a name does (§3.3).
  - In a parameter, `{…}` is short for `struct{…}`, as `fn({data, ctx}): …` writes it. A `{` there can only be a pattern, as in a type position it can only be a field list (§3.1).
  - In a lambda, every pattern may leave its type to the expected function type (§3.14), or be annotated.
  - A generic struct named without its arguments in a declared function is an error, as a missing annotation is (§2). In a lambda, the expected type gives them.
- **Taking it apart.** The argument is passed whole and taken apart when the body is entered. Each name holds a copy of its part, as a destructuring `const` does (§3.15). The argument converts into the parameter's type first (§2), so a part is always there.
- **Its name.**
  - A destructured parameter has no name, so it is given only by position. `f(name: v)` can't reach it.
  - `Pattern as name` names the whole as well, binding it beside the parts. That name is the parameter's, for named arguments, and `as self` makes the function a method (§3.7).
  - Signatures, hovers and signature help show the parameter as written, `norm(Point{x, y}) -> Float`, and name it by its `as` name when it has one.
- **Defaults.** A destructured parameter may have a default, `fn f(Options{retries, region} = Options.default())`. The names it binds count as earlier parameters, so a later default may use them: `fn window(Range{start, end}, step: Int = end - start)`.
- **Clashes and overloads** (§3.7) compare parameter types only, so a pattern changes nothing there: `fn f(Point{x, y})` and `fn f(p: Point)` clash.
- **Where not.**
  - A `&` parameter: a pattern binds values, while a reference passes a place.
  - A rest parameter or a pack.
  - An extern function, a trait's requirement or a function type, which have no body to bind the names in.
  - The paren-less lambda form, `fn x: …`, which takes a name only.

### 6. Line breaks between items

```python
new FieldView<OrderScope, String>{
    key: "n12"
    parent: none
    when: Prop.Computed{eval: fn({data, ctx}): logic.totalQty(data.items) > 100}
    field: m.note->node
}

const pairs = [
    (1, "a")                     # two items, not a call
    (2, "b")
]
retry(
    times: 3
    backoff: base
        * 2                      # `*` and a space: the item goes on
)
```

- **One rule for every bracketed list,** recommended over struct literals alone, so a list has one separator rule. It covers every list whose items `,` separates:
  - struct literals and their patterns;
  - array, map and tuple literals, and array and tuple patterns;
  - call arguments, parameter lists and lambda parameters;
  - type arguments, type parameters, tuple types and function types' parameters;
  - braces that list fields or variants, whose entries `,` now separates (§4 above).

  Today a line break in field and variant braces always separates entries. It now follows this rule, so an entry may span lines as any item does.
- **When a break separates.** A line break separates two items, as `,` does, where both of these hold:
  - the list's current item could end there, so the parser would take a `,` or the closer next;
  - the next line's first token can start an item.

  Anywhere else the break is ignored, as today, so an item spans lines.
- **What starts an item:**
  - a name, a literal, a template, `true`, `false`, `none`;
  - an opening bracket;
  - `fn`, `async`, `if`, `struct`, `new`, `not`, `await`, `for`, `...`;
  - `-`, `*`, `&`, `..` or `..=` glued to its operand (`-1`, `*x`, `&x`, `..5`).
- **What continues the item:**
  - a binary operator (`+`, `/`, `==`, `and`, `??`, `|`, `<` and the others);
  - `-`, `*`, `&`, `..` or `..=` followed by a space (`- 1`, `* qty`);
  - `.`, `?.`, `->`, `?->`, `!`, `?`;
  - `else`, `elif`, `in`, `is`, `as`, `by`, `=`, `:`.

  So does any line ending where the item can't end: after an operator, `.`, `:`, `=`, `->`, an opening bracket or a prefix.
- **Postfix brackets stay on their operand's line.** A call's `(`, an index's `[`, a struct literal's `{` and type arguments' `<` attach only on the line of the thing they apply to, as a tagged template's tag already must (§2). On the next line, each starts an item.
- **Mixed separators.**
  - `,` and line breaks may mix. A `,` at a line's end separates, and the break after it adds nothing, so trailing-comma style still parses.
  - A `,` starting a line separates too, so leading-comma style also parses.
  - Items sharing a line still need `,`: `[1, 2` on one line and `3, 4]` on the next is four items.
- **Blank lines and comments** between two items change nothing. The decision reads the last token before the break and the first token after it.
- **Inside `${…}`** a line break stays ignored, since its one expression is no list.
- **The formatter's canonical form:** a list on one line keeps `,`. A list broken over lines puts one item per line and no `,` at line ends, as the field lists of declarations already are.

### 7. Parenthesized import lists

```python
import (
    approve
    Verdict
    decide as decidePurchase
) from 'purchase/approve'
import a, b as bee from 'x'
```

- **Two forms.** An import's names stand bare, `import a, b from 'x'`, on one line, or in parentheses, `import (a, b, c as see) from './lib'`.
- **The parenthesized form is a bracketed list.** It follows the line-break rule of §6 above: it may span lines, one name per line with no `,`, and `,` and line breaks mix as in any list. A trailing `,` is allowed, as in any list.
- **The bare form stays on one line.** A line break after its `,` ends the import, as today: a list too long for its line is written in parentheses.
- **Renames, in both forms.** `name as alias` imports the export `name` and binds it as `alias`. Only the alias is in scope; clashes, a name imported twice, and the prelude rule (§3.13) are checked on the names bound, so `import a as x, b as x` clashes, and `import a, a as b` binds two names to one export. A function joins the prelude's overloads by its own name only, so one renamed to a prelude name (`import f as add`) clashes. `import * as m` keeps its form.
- **Tools.** Hover and go-to-definition on either name reach the export; rename of the export renames `name`, and rename of the alias renames the alias and its uses. Completion inside the parentheses offers the module's exports, as after `import`.
- **The formatter** prints an import on one line when it fits, bare as written or in parentheses as written, and a parenthesized import too long for its line one name per line. A bare import too long for its line is printed in parentheses, broken: the one change of form the formatter makes, since the bare form has no broken shape.

## What changes in behaviour

| Code | Today | Proposed |
| --- | --- | --- |
| `const c: Config =` with `retries: 3` indented below | error 2001: an expression is expected | `Config{retries: 3}` |
| `const c = Config:` with an indented block | errors 5011 and 2001 | `Config{…}` |
| `return` with an indented block | returns `Unit`, with errors 5001 and 2008 | returns the value, built for the return type |
| a body's line `Config:` with a block below | a label (warning 5711, error 2130) | still a label |
| `- 1` lines under `const xs: Array<Int> =` | error 2001 | `[1, …]` |
| `"x-id": "1"` under a `Map<String, String>` field | an error, as any line below the `=` is | the entry `"x-id": "1"` |
| `type Tree = Int \| Array<Tree>` | error 5106: the alias refers to itself | a recursive union |
| `type List = { head: Int, tail: List? }` | error 5106 (written with `;`) | a recursive shape |
| `type A = A \| Int` | error 5106 | still an error |
| `type B = Int \| Array<B>` beside `type Tree = Int \| Array<Tree>` | error 5106 at both | one type with `Tree`: a value of either goes where the other is expected |
| `type Forest = Tree \| Array<Forest>` | error 5106 | `Tree`'s members join it, so it is `Tree`, and `const b: Forest = [1]` builds the one array member |
| a `Json` literal | `Object{fields: ["a": Integer{value: 1}, "b": List{items: [Boolean{value: true}, Null]}]}`; `["a": 1, …]` is error 5304 | `["a": 1, "b": [true, none]]` |
| `case Text{value}` on a `Json` | binds the String | gone: `case String as value` |
| `Json?` | holds `none` apart from the `Null` variant | `Json` |
| `[]` where `Array<Int> \| Map<String, Int>` is expected | error 5300 | the empty array |
| `{ sku: String, qty: Int }`, `struct R { id: Int, value: String }`, `enum Color { Red, Green }` | error 2001: `;`, a line break or `}` expected | the anonymous struct type, the struct and the enum |
| `{ sku: String; qty: Int }`, `enum Color { Red; Green }` | the type, the enum | an error: `;` separates only statements |
| `x = 1; y = 2`, `{ log(msg); save(msg) }` | statements sharing a line | unchanged |
| `ps.map(fn(struct{x, y}): x + y)` | error 2001: a parameter name is expected | takes each `Point` apart |
| `pairs.map(fn((a, b)): a + b)` | error 2001 | takes each pair apart |
| `fn norm(Point{x, y}) -> Float` | errors 4013 and 2001 | a function of a `Point` |
| `fn f(Ok{value})` | errors 4013 and 2001 | still an error: the pattern can fail |
| `P{` over the lines `id: "x"` and `qty: 2`, then `}` | error 2001: `,` or `}` expected | two fields |
| `[` over the lines `1` and `2`, then `]`, and `g(` over `1` and `2` | error 2001 | two items, two arguments |
| `[g` with `(1)]` on the next line | the call `g(1)` | two items, `g` and `(1)` |
| `[a` with `-1]` on the next line | `a - 1` | two items, `a` and `-1` |
| `[a` with `- 1]` on the next line | `a - 1` | still `a - 1` |
| `ista fmt` on a list too long for its line | one item per line, each ending in `,` | one item per line, no `,` |
| `import (a, b) from 'x'`, or `(` over the lines `a` and `b`, then `) from 'x'` | error 2001 | imports `a` and `b` |
| `import a,` with `b from 'x'` on the next line | error 2001 | still an error: the bare form is one line |
| `import a as x from 'x'` | error 2001 | binds the export `a` as `x` |
| `ista fmt` on a bare import too long for its line | left on one line | parenthesized, one name per line |

Two kinds of program that compile today change meaning, both inside brackets and both unlike formatted code:
- a postfix bracket put on the line after its operand;
- `-`, `*`, `&` or `..` glued to its operand at the start of a line, meant as a binary operator.

Otherwise, each new form takes over syntax that is a compile error today, and today's `;` between list items, and `Json`'s variants, become errors.

## What changes in power

**Gained.**
- Values written the way their declarations are written. Configuration, fixtures and test data read like YAML and stay typed, checked and computed at compile time.
- One block form builds structs, maps and arrays at any depth, by type, with no type knowledge in the parser.
- Recursive data without declaring an enum: `type Tree<T> = T | Array<Tree<T>>`, and recursive shapes.
- JSON of any shape as plain literals, taken apart by type patterns.
- One separator, `,`, for every list: fields, variants, trait members, entries, arguments, elements and type arguments. `;` is left with one meaning, between statements.
- Parameters that take their argument apart, in lambdas and declared functions, with no destructuring line in the body.
- One line-break rule for every list: the items of a literal, a call or a type broken over lines need no `,`, as fields over lines in a declaration already need none.
- Imports of many names broken over lines, and imported names renamed, so two modules' exports of one name can meet in one module without a namespace.

**Not gained.**
- **YAML-compatible source.** An Istalang file is no YAML document, and a YAML document is no Istalang. In declarations the right side of `:` is a type, values hold names, and YAML's indicator characters are Istalang operators.
- **YAML syntax left out:** block scalars `|` and `>` (multi-line templates serve), `null` and `~`, anchors and aliases in source (spreads serve), and unquoted String values.
- **Where an indented value can't go:** inside brackets; as a body's last line, which is a label; with anything after it, such as a method call after its block.
- **Indented forms left out:** maps whose keys aren't Strings; nested items on one line (`- - 1`); items at their key's own column, as YAML allows.
- **Recursion left out:** recursive aliases that aren't regular, and a reference where what it names must be known first (`keyof A`, `A.Data`, `A[K]`).
- **Patterns left out of parameters:** refutable patterns, which would be overloading by pattern, patterns behind `&`, and patterns as rest parameters.

**Lost.**
- Telling a missing value from a JSON `null` where a `Json?` is expected, since `Json?` is `Json`.
- Inside brackets, a call's `(`, an index's `[`, a literal's `{` or type arguments on the line after their operand.
- Inside brackets, a binary `-`, `*`, `&` or `..` glued to its right operand at a line's start, such as `a` over `-1`, which now starts an item.

## Spec changes

- **Every list using `;`** (§4 above) takes `,`, section by section. Statements' `;` stays: in the cheat sheet's `fn(msg): { log(msg); save(msg) }`, `{ const t = a * b; t + 1 }` and `x = 1; y = 2`, §2's `a = 1; b = 2`, §3.14's lambda block, and §4's block expressions, `if urgent: { alert(msg); save(msg) }` and the rule on `;` after a one-line body.
  - **Cheat sheet:** the field and variant lists of `{ sku: String, qty: Int }`, `struct Req`, `struct Retry`, `struct Field<T>` and `enum Color`, and the struct constraint of `fn title`.
  - **§2:** "A `;` separates statements written on one line" gains "and only statements: every list separates its items with `,`". The **Continuation** bullet's `{ sku: String; qty: Int }` and "as `;` does" move to `,`.
  - **§3.1:** `struct Cell`, `Array<{ sku: String, qty: Int }>`, `struct Req`, `{ a: Int, b: Int }`, `struct Pixel`, the mapped-type examples, `S is struct { a: Int, [_]: Int }`, `struct Settings`, `struct Entry` and `struct Node`.
  - **§3.5:** `fn f<T>(p: { x: T, y: T })`, `struct Pixel`, and the struct constraints `S is struct { title: String, [_] is FormNode }` and `{ a: Int, [_] is Stringable }`.
  - **§3.7:** `fn f(p: { x: Int, y: Int })` and `type Point = { x: Int, y: Int }`.
  - **§3.10:** `enum Step<T> { Next { value: T }, Done }`, and trait members on one line are separated by `,`.
  - **§3.11:** `Rejected { by: String, reason: String }`, twice, and `enum Color { Red, Green, Blue }`.
  - **§3.17:** `type Point = { x: Int, y: Int }` and `type Pair<A, B> = { first: A, second: B }`; a type `match`'s cases stand one per line.
  - **§4:** `struct Field<T> { value: T?, type Data = T }` and `struct SettingsForm { retries: Field<Int>, region: Field<String> }`. The `match` and `select` cases stand one per line, as today.
- **Cheat sheet**, beyond `;`: the values block gains an indented value with a nested field, a map and items, and the types line gains a recursive alias.
- **§2.**
  - **Continuation:** "A line break is ignored inside `(…)`, `[…]` and the braces of a struct literal" becomes the rule of §6 above.
    - A line break inside a bracketed list, a field or variant list included, separates items where the item could end and the next line can start one; anywhere else it is ignored.
    - A postfix bracket stands on its operand's line.
    - An import's parenthesized names are such a list; its bare names stay on one line.
    - An indented value is the one expression that continues past a line break outside brackets.
  - **Templates:** "Inside `${…}` line breaks are ignored, as inside brackets" becomes "line breaks are ignored".
  - **Trailing commas:** a list broken over lines needs none.
  - New paragraph **Indented values**, from §1 above, after **Literals**. The literal list gains a bullet for it.
  - **What each kind of bracket means:** a block below `=`, `return`, a key or `-` builds a value. Where a union holds both an array type and a map type, `[]` is the array and `[:]` the map.
  - **Unions:** a recursive alias's members join the union; a union equal to a recursive alias is that alias.
- **§3.** A top-level `const`'s "in any literal form" covers indented values.
- **§3.1.**
  - Construction gains the indented form after the brace form.
  - **Recursive types:** a recursive alias is held to the same finiteness rule.
- **§3.3.**
  - A parameter may be a declaration target (§3.15), from §5 above.
  - **Defaults:** names a pattern binds count as earlier parameters.
  - **Arguments:** a call broken over lines needs no `,` (§2).
  - **Named arguments:** a destructured parameter is named only by its `as` name.
- **§3.4.** A `const`, a `let` and an assignment may end their line at `=`, with an indented value below.
- **§3.13 Imports:** the two forms, bare on one line and parenthesized as a list (§2), and `name as alias` in both, with clashes checked on the names bound. The example gains a parenthesized import broken over lines and a rename.
- **§3.7.** A method's first parameter is named `self`, or is a pattern `… as self`.
- **§3.8.** The `json` row: `Json` is the recursive union.
- **§3.11.** Variants are built by `Name:` too.
- **§3.14.** **Lambdas:** a parameter may be a pattern, which takes its type from the expected function type. The paren-less form keeps a name. **Parameter types** covers patterns.
- **§3.15.** **Declaration targets:** they also stand as parameters (§3.3).
- **§3.17.** "An alias can't refer to itself, directly or through other aliases, unless its body is a type `match`" becomes the rules of §2 above: self-reference, finite, regular, and identity by alias and arguments.
- **§4.** `return` may end its line, with an indented value below. **Labels:** a body's line `Name:` with a block below it is a label, never a value.
- **§9.** The mapping table's `json.Json` row is the union.
- **§14 Future work.** Additions:
  - indented maps with keys other than Strings.

## Implementation notes

1. **One syntax node** (`src/compiler/syntax/expressions/index.ts`): `IndentedValue`, holding an optional `NamedType` and its entries. The entry kinds are the struct literal's items (named, shorthand, spread, comprehension), plus a quoted key and an item. It is one node whatever the block builds.
2. **The parser.** A new `src/compiler/parser/grammar/expressions/literals/indented-values.ts` is called where a line ends after one of the opening tokens:
   - `=` in the statement parsers (`parser/grammar/statements/`) and in field defaults (`parser/grammar/parts/structs.ts`);
   - `return`;
   - its own keys and items.

   Its lines go through the one block loop, `parseItemEntries` in `parser/layout/index.ts`, which already gives columns, a separator within a line (`,` after §4 above), dedent errors and comments. Entries are told apart by their first tokens, as `parser/grammar/expressions/literals/struct-literals.ts` tells items apart. Headers and labels (`parser/grammar/statements/statement.ts`) are unchanged.
3. **The checker** dispatches an `IndentedValue` by its type to the checks that exist, so each rule keeps one home:
   - struct literals: `checker/constructs/expressions/structs/structs.ts` and `literal-fields.ts`;
   - map and array literals: `checker/constructs/expressions/collections/collections.ts` and `collection-accepts.ts`;
   - building from an expected union: `checker/types/fitting/expected.ts`.

   One adapter reads the entries as those checks read items. The checked form is the literal's, so `src/compiler/lowering/` needs nothing.
4. **The formatter** prints an indented value as it was written (`src/formatter/expressions/literals.ts`, `bodies.ts`), never turning braces into a block or back.
5. **The language service:**
   - completion of field names and map keys in an indented value, as inside braces (`src/language-service/completion/places/`);
   - hover and go-to-definition on keys (`src/language-service/navigation/`);
   - folding for the block (`src/language-service/folding.ts`);
   - semantic tokens: a map's bare key is a String, a struct's a field (`src/language-service/semantic-tokens/`);
   - the VS Code grammar (`.vscode/extensions/ista/syntaxes/`) gains `- ` items.
6. **Recursive aliases.**
   - `checker/constructs/declarations/aliases/index.ts` reports 5106 only for an unguarded, blocking or irregular reference. A guarded group closes through `closeRecursive` (`checker/types/identity/recursive-types.ts`) into the `RecursiveType` of `checker/types/type/computed-types.ts`: a node of a minimized graph, the bodies resolved with placeholders (`constructs/declarations/aliases/recursive-bodies.ts`).
   - It is keyed by its graph's canonical spelling (`types/identity/recursive-terms.ts`, `types/identity/type-keys.ts`) and unfolds to its node's body.
   - `types/unions/unions.ts`, through `unionOf`, flattens it and folds a union equal to it back into it.
   - `types/properties/finiteness.ts` walks `RecursiveType`.
   - A recursive type `match` use (proposal 4) closes through the same constructor with every recursive use its finding reached (`checker/resolution/type-matches/type-matches.ts`), each body reduced with those uses unreduced as placeholders, so it is a `RecursiveType` too, identified by structure. Once a group closes, `closeRecursive` reduces each computed type built from its nodes (a type `match` given the group's own use) and closes again, so none stays unreduced; `matchCase` matches a recursive type as what it unfolds to.
   - `src/compiler/lowering/tables/type-table.ts` gives it one entry per key, with its body (an enum for a union, a struct for a shape) referring to that entry, named by the preferred alias.
7. **`Json`.**
   - `src/stdlib/json/json.ista` declares the alias. Its codecs match members (`case Int as value`), and `natives.ts` builds maps and arrays.
   - `src/definition/values/json-values.ts` finds each member's variant in the union's layout (`unionLayout`, `src/language/well-known/index.ts`), not by variant name, and `jsonVariants` goes.
   - `lowering/synthesized/boundary/encoder.ts` and `decoder.ts` build and read members.
   - `time`, `decimal`, `regex` and `log` in `src/stdlib/` drop their `Text{…}` wrappers.
8. **`,` separates every list.**
   - **Scanner:** unchanged. `;` stays a token.
   - **Parser.**
     - `parser/layout/index.ts`: its one block loop takes its item separator from the block's kind. Field, variant, trait-member, constraint and indented-value blocks take `,`. Statement and module blocks take `;` (`skipSemicolons`), as today. Case blocks take one item per line.
     - `parser/cursor/recovery.ts` and `parser/grammar/parts/structs.ts`: the brace lists of fields and variants become ordinary `,` lists under note 10. Their message "Expected ';', a line break or '}'" becomes "',', a line break or '}'".
     - A `;` between list items, and a `,` between statements, each get one diagnostic naming the right separator (`parser/diagnostics.ts`).
     - `semicolonAfterInlineBody` (`parser/layout/bodies.ts`) and `blockWithoutSemicolon` (`parser/grammar/expressions/branches.ts`) stay.
   - **Formatter.** `src/formatter/lists.ts` writes `,` where its field lists write `ifBreak('', ';')`. `branches.ts` keeps `;` for one-line blocks, and `comment-placement.ts` keeps both separators.
   - **The repository's sources: a one-off scripted rewrite through the project's own scanner** (`src/compiler/scanner/scan.ts`), run before the grammar changes, then `ista fmt`. It covers:
     - `src/stdlib/`, `test/` and its corpus, `examples/` and the form builder;
     - the spec's examples;
     - the Istalang sources held in the string and template literals of `*.test.ts` and `*.test-kit.ts`.

     It rewrites only a `;` between two entries of a field, variant, trait-member or constraint list, writing `,`. A `;` between statements is left as it is.
9. **Parameter patterns.**
    - **Syntax.** The `Parameter` node (`src/compiler/syntax/expressions/index.ts`) holds a target pattern where it holds a name. `parser/grammar/parts/functions.ts` reads one with the declaration-target parser of `parser/grammar/statements/variables.ts`.
    - **Checker.** `checker/constructs/patterns/targets.ts`'s `declareTargets`, the one home for declaration targets, declares a parameter's names too, and refutability is checked as it is for targets. A pattern's own type comes from `patternTypeOf` (`checker/types/written/named-types.ts`). Named arguments and `self` read a parameter's `as` name.
    - **Lowering.** The function takes the argument as one hidden parameter and takes it apart at entry, through the same lowering a destructuring `const` uses (`lowering/statements/variables.ts`).
    - **Language service.** Signatures and hovers print the pattern (`src/language-service/signatures/signatures.ts`, `hover.ts`).
10. **Line breaks between items.**
    - **The rule's one home** is one predicate in `parser/layout/index.ts`, where every decision to move past a line break already lives: does this break separate two items of the enclosing list?
    - **Lists.** `parseDelimited` in `parser/cursor/recovery.ts`, through which every bracketed list already goes, takes a separating break as it takes `,`.
    - **Expressions.** The infix and postfix loops (`parser/grammar/expressions/expression.ts`, `postfix.ts`) stop at a separating break, and `postfix.ts` attaches `(`, `[`, `{` and `<` only on their operand's line.
    - **The token sets are derived, never listed again.** What starts an item is the prefix parselet table of `expression.ts`. What continues is its infix table.
    - **Spacing.** Tokens already carry `firstOnLine` (`syntax/tokens/index.ts`). Their spans tell whether `-`, `*`, `&` or `..` is glued to the next token, so the scanner needs no change.
    - **Formatter.** `src/formatter/lists.ts` and `brackets.ts` print a broken list one item per line without `,`; `literals.ts` follows.
    - **Completion.** The places in `src/language-service/completion/places/` that find "the next item" after a `,` find it after a separating break too.
11. **Parenthesized imports and renames.**
    - **Syntax.** `NamedImport` holds imported names, each an exported name and an optional alias, and whether they were parenthesized, which the formatter keeps.
    - **Parser** (`parser/grammar/declarations/imports.ts`): `(` reads the names through `parseDelimited`, so §6's rule and recovery come with it; the bare form reads `,`-separated names on one line, as today.
    - **Binder.** An import binds each alias, or the name where there is none, to the export it names; clashes and the prelude rule read the bound names.
    - **Language service:** hover, definition, references and rename on both names; completion of exports inside the parentheses; semantic tokens for the alias as for the name; the VS Code grammar already reads `as` as a keyword and `from` before a path, so it needs no change.
12. **Tests** (fast-check, beside the code):
    - an indented value and its brace or bracket literal check and run to equal values over generated nested values, a commutation property (`test/AGENTS.md`);
    - one parse whatever the expected type;
    - recursive aliases: `typeKey` equal exactly when `sameType` holds; `Tree<T>` instantiated with `Int` equals `Tree<Int>`; finiteness and regularity refusals;
    - `Json`: literals of generated nesting equal the values `json.parse<Json>` reads from their text;
    - after the rewrite, no list holds `;`, every rewritten module checks as before, and its formatted form is stable;
    - a `;` between list items and a `,` between statements are errors with their messages, while `x = 1; y = 2` and `a, b = (b, a)` keep their meaning;
    - a function taking a pattern runs to the same value as one taking a name and destructuring it in its first line, over generated patterns;
    - refutable patterns are refused wherever they stand;
    - in a generated list, replacing any `,` between items with a line break gives the same tree;
    - breaking an item at any point the rule says continues gives the same tree;
    - the formatter's output reparses to the tree it printed, broken lists included;
    - hostile inputs: operators at line starts, glued and spaced, and comments and blank lines between items;
    - imports: both forms and renames bind the same names as the equivalent one-line import; a parenthesized import broken over lines parses as on one line; the formatter's import output reparses to the same bindings.
