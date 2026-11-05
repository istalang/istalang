# Istalang Specification (Draft v0.1)

Oct 20, 2026 · @Ares

## Cheat sheet

The whole language at a glance; each line is explained in the sections below.

**Values, variables and types**

```python fragment
const limit: Int = 50_000          # immutable, deeply
let count = 0                      # mutable; type inferred
let a, b = (1, "x")                # tuple destructuring
_ = startSomething()               # unnamed variable: held until the block ends
hold _ = startJob()                # held until the function ends, even inside a loop
hold let pending = 0               # name block scoped, holdings function scoped
drop audit.record(event)           # discard a must-use value right away
const u = new Shared{value: user}  # a shared struct: a handle to its fields
u->value.name = "x"                # read or write behind it with -> and *
const api = Service:               # an indented value: a Service, laid out as its fields are
    name: "api"
    retry:                         # a nested struct, built as the field's type
        times: 3
    env:                           # a map: a bare key is its String
        LOG_LEVEL: "debug"
    ports:                         # an array's items
        - 80
        - 443

"text"  'text'  `a ${x}`  42  1_000  0x1F  3.14  true  false  none  5d  30s
[1, 2]   ["a": 1]   [:]   [...xs, 3]   (1, "x")   0..10   0..=10

Int  Float  Bool  String  Unit  Never  None  (A, B)
A | B    "draft" | "sent"    T?                                # a union, literal types, T | None
Array<T>  Map<K, V>  Range  Future<T>  Slot<T>  Shared<T>  WeakRef<T>  Instance<T>
fn(A) -> R    async fn(A) -> R    sendable fn(A) -> R    { sku: String, qty: Int }    # anonymous struct type
```

**Structs, enums and annotations**

```python fragment
struct Pair<A, B>:
    first: A
    second: B
    meta:                          # inline anonymous struct
        tag: String
struct Req { id: Int, value: String }
struct Retry { times: Int = 3, backoff = times * 2 }   # defaults, each seeing the fields before it
struct Field<T> { value: T?, type Data = T }            # associated type: Field<Int>.Data is Int
type Data<S is struct> = { [F in keyof S]: S[F]? }       # mapped struct type, a field per key
type Keys = keyof Req                                    # "id" | "value"; Req["id"] is Int; r[k] reads one
type DataOf<D> = match D:                                # type match: its first case matching D
    case Field<infer T>: T
    case _: D

enum Result<T, E = Error>:
    Ok { value: T }
    Err { error: E }
enum Color { Red, Green, Blue }

Pair{first: 1, second: 2, meta: struct{tag: "x"}}
Pair{first, second}                # short for first: first, second: second
Ok{42}    Ok{(receipt)}            # single field, positional; a bare name needs ( )
Req{...req, value: "new"}          # updated copy
userId: Int @JsonName{"user_id"}   # annotation on a field
```

**Functions, traits and generics**

```python fragment
fn add(a: Int, b = 1):             # default parameter, types inferred
    a + b                          # the last expression is the value
fn log(level: String, ...parts: Array<String>): ...    # rest parameter
log("info", ...parts)                                  # spread into the rest
add(1, b: 2)                                           # named argument
fn call<...A, R>(f: fn(...A) -> R, ...args: A) -> R: ... # a pack: any parameters
fn push<T>(self: &Stack<T>, item: T): ...             # method, reference receiver
fn Duration.zero() -> Duration: ...                    # static function
async fn approve(req: Req) -> Future<String>: ...

fn(x): x * 2    fn x: x > 0    fn(msg): { log(msg); save(msg) }   # lambdas
const fact = fn f(n: Int) -> Int: { ... }             # named lambda: f calls itself
g(&value)    Float(3)    a[1..3]    m["a"] = 2         # reference, conversion, slice, index

trait Addable<T = Self>:
    fn add(left: T, right: T) -> T
fn sum<T is Addable & Monoid>(xs: Array<T>) -> T: ...
fn label<S in Status>(s: S) -> String: ...            # S stands for one member of Status
fn title<S is struct { title: String, [_] is Stringable }>(s: S): ...  # struct constraint
fn notifyAll(notifiers: Array<any Notifier>): ...     # values of any type meeting the trait
```

**Control flow and patterns**

```python fragment
if amount > 100:
    escalate()
elif amount > 10:
    review()
else:
    approve()
const size = if n < 10: "small" elif n < 100: "medium" else: "large"   # one-line if expression
for i in 0..10: ...
for i in 10..=0 by -2: ...                        # a step; 0 < x <= 10 chains, x in xs tests membership
while pending: ...
for field, node in ...form: ...                   # a field loop: once per field, in name order
const small = [for x in xs if x < 20: x * 2]      # array comprehension
const names = [for field, _ in ...form: field]    # one element per field
struct{for field, node in ...s: [field]: f(node)} # struct comprehension: a field per field

match decision:
    case Approved{by}: ...                        # binds the field by
    case Rejected{reason as why} if why != "": ... # rename, guard
    case Verdict{ok == false}: ...                # compare
    case Review{verdict is Verdict{ok == false}}: ... # nested
    case _: ...
const struct{title, ...rest} = form               # rest: a struct of the fields not named
match x:                                          # x: Int | String | None
    case None: ...
    case Int as n: ...                            # a type pattern selects a member
    case s: ...                                   # the remaining type: String
match status:                                     # status: "draft" | "sent" | "failed"
    case "draft": ...
    case "sent" | "failed": ...                   # exhaustive without case _
match xs:
    case [] | [_]: ...                            # alternatives; an array by its length
    case [first, ...rest]: ...                    # a rest takes the items between
match score:
    case 0..=59: ...                              # a range of ints
    case _: ...
if r is Ok{value as y} and y > 0: use(y)

user?.name    name ?? "anonymous"    found!    chargeCard(id)?    # optional chaining, fallback, unwrap or panic, propagate Err
{ const t = a * b; t + 1 }                        # block expression
x = 1; y = 2                                      # two statements on one line
type UserId = String                              # type alias
shared struct Counter { n: Int }                  # a struct whose values are handles to a cell
```

**Concurrency, persistence and the host**

```python fragment
const v = await fetch()            # every await commits, then waits
const f = fetch()                  # already running; runs alongside while held

await select:                      # first ready case wins
    case box.receive() as msg: ...
    case time.delay(5d): ...
select:                            # non-blocking
    case box.receive() as msg: ...
    else: ...

const s = Slot.create<Int>()       # await s.put(1), s.take(), s.read()
box.send(m)    _ = box.sendRevertible(m)    await box.receive()
spawn purchase(req)                # a new, independent instance
defer fn(): log("exited")          # runs when this block ends, however it ends
worker.disposing()                 # inside async fn worker: graceful-disposal signal
await runtime.commit()             # commit without waiting
panic("bug")                       # freeze the instance for an operator

import Inbox from 'inbox'          # names starting with _ are private
extern fn chargeCard(id: String) -> Result<String>
extern purchaseRequests: Queue<Req>
```

## 1. Overview

This is a strongly typed, Python-like language for durable, long-running workflows. A snapshot interpreter runs it: execution state is persisted at every `await` and can resume days later, across restarts.

Design principles:

- **Visible persistence.** `await` is the only place execution can suspend, and every `await` commits.
- **One coordination primitive.** Instances coordinate through slots. Inboxes, request/response, broadcast and fan-out are library types built on them.
- **Predictable disposal.** Resources such as pending futures, slots and inboxes are disposed when the last block holding them ends: by default, the block that created them.
- **Explicit over implicit.** Every send states whether it is durable or revertible, by calling `send` or `sendRevertible`. There is no default.
- **Strong static typing.** Every variable, parameter, field and return value has a static type, with generics. Variables are block scoped.
- **Value semantics.** Structs and collections are copied when assigned, passed, returned or sent. Data that other code holds changes only through an explicit `&` reference or a handle, such as a `Shared` value (§3.18).
- **Everything that branches is an expression.** `if`, `match` and `select` produce values, and the compiler checks that all branches have the same type.

## 2. Lexical structure and types

Blocks are defined by indentation, as in Python. Comments start with `#` and run to the end of the line; there are no block comments. Top-level declarations may appear in any order. A `;` separates statements written on one line, and only statements: `a = 1; b = 2`. Every list separates its items with `,`: the items in brackets, the fields of a struct or a variant, an enum's variants, a trait's members, a struct constraint's entries and a struct's associated types, in braces or on one line of an indented body alike. A `,` can't separate statements, since it already continues one that starts with targets (`a, b = (b, a)`, §3.15). So a `;` between a list's items, and a `,` between statements, are compile errors. The cases of a `match`, a `select` and a type `match` are neither: they stand one per line.

**Source text.**

- **Indentation** uses spaces only: a tab in a line's leading whitespace is a compile error. Any consistent width works.
- **Line breaks** are `\n`, `\r\n` or a lone `\r`. A byte order mark at the start of a file is ignored.
- **Continuation.** Inside a bracketed list a line break separates two items, as `,` does, where the item before it could end there and the next line's first token can start an item; anywhere else in brackets it is ignored, so an item spans lines. The lists are the items of `(…)`, `[…]` and `<…>`, an import's parenthesized names among them, a struct literal's and a struct pattern's braces, and the braces that list fields or variants, as in `{ sku: String, qty: Int }`. An import's bare names stay on its line (§3.13). Outside brackets the one expression that continues past a line break is an indented value (below), whose block stands on the lines after its opening. There is no backslash continuation.
  - **What starts an item:** a name, a literal, a template, `true`, `false` or `none`; an opening bracket; `fn`, `async`, `if`, `struct`, `new`, `not`, `await`, `for`, `...` or `@`; and `-`, `*`, `&`, `..` or `..=` glued to its operand (`-1`, `*x`, `&x`, `..5`) or alone at its line's end (a lone `..`, the range open at both ends), so each line of a broken list reads back as its item.
  - **What continues the item:** a binary operator, `not in` among them; `-`, `*`, `&`, `..` or `..=` followed by a space (`- 1`); `.`, `?.`, `->`, `?->`, `!`, `?`; and `else`, `elif`, `in`, `is`, `as`, `by`, `=`, `:`. So does any line ending where the item can't end: after an operator, `.`, `:`, `=`, `->`, an opening bracket or a prefix. An optional part after a complete item, a range's end after `a..` or `& B` after `any A` or a constraint, is read only where the next line starts no item: `a..` over `b` is two items.
  - **A postfix bracket stands on its operand's line:** a call's `(`, an index's `[`, a struct literal's `{` and type arguments' `<`, as a tagged template's tag does. On the next line each starts an item, or for `<`, continues as the operator.
  - `,` and line breaks mix: a `,` ending or starting a line separates once, and items sharing a line still need `,`. Blank lines and comments between two items change nothing.

  ```python statements
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
- **Trailing commas** are allowed in every comma-separated list; a list broken over lines needs none.
- **Identifiers** are ASCII letters, digits and `_`, not starting with a digit. Strings and comments may hold any Unicode.
- **Reserved words:** `fn`, `async`, `await`, `let`, `const`, `if`, `elif`, `else`, `for`, `in`, `while`, `match`, `case`, `select`, `return`, `break`, `continue`, `struct`, `enum`, `trait`, `import`, `extern`, `spawn`, `defer`, `drop`, `is`, `and`, `or`, `not`, `true`, `false`, `none` and `as`. Ten more words are keywords only where the grammar expects them and ordinary names elsewhere: `type` before an alias's name, or an associated type's in a struct, enum or trait body (§3.1, §3.10), `shared` before `struct` and `new` before a name (§3.18), `from` before an import's path, `sendable` right after `extern` or before a function type's `fn` or `async`, `any` before a trait's name in a type (§3.10), `keyof` before a type in a type (§3.1), `infer` before a type variable's name in a type `match` case's pattern (§3.17), `hold` before the variable declaration it holds (§3.4), and `by` after a range, before its step (§3.8). So `T.from` (§3.10), a field named `type` (§9) and a function named `hold` are valid. The built-in types' names, `Int`, `Float`, `Bool`, `String`, `None`, `Unit`, `Never` and `Self` (§3.10), are no keywords, but no type, variant or type parameter is declared with them, since every module sees them.

Every expression has a static type; a value whose type is known only when the program runs has a trait's, `any T` (§3.10). There are no implicit conversions, with six exceptions: a value is converted into an `any` type wherever one is expected (§3.10), a nominal struct's value is converted into its equal shape wherever that shape is expected (§3.1), a plain function fits where an async one of its parameters and result is expected (§3.14), a one-element tuple and its element each fit where the other is expected (§3.15), a value of a literal type, or of a union of literals, fits where their base type is expected, and a value is converted into a union wherever one is expected (both below).

| Type | Meaning |
| --- | --- |
| `Int`, `Float`, `Bool`, `String` | Primitives: language built-ins, not structs. `Bool` is `true \| false` (below). |
| `None` | The primitive whose one value is `none`. |
| `Unit` | The type of statements and of blocks that end in a statement. It is the empty tuple `()`. |
| `Never` | The type of `return`, `break`, `continue` and `panic`. It fits wherever any type is expected. No value of it exists, so code operating on one never runs: reading its members, calling it or through it, indexing it, an operator, a template, a comparison, `await`, `?`, `!`, `??`, `->`, a field loop or a pattern over it is allowed, gives `Never` and reports nothing. |
| `A \| B` | A union: a value of one of its member types (below). |
| `"draft"`, `42`, `-1`, `true` | Literal types: a `String`, `Int` or `Bool` literal as the type of its one value (below). |
| `T?` | Sugar for `T \| None`, which the prelude names `Optional<T>` (§3.8). The empty value is `none`. |
| `Time`, `Duration` | Standard-library structs wrapping an `Int` of milliseconds (§3.8). |
| `Array<T>`, `Map<K, V>` | Generic collections (§3.8). They are values and are copied like structs. |
| `Range` | A span of integers written `a..b`, half-open (§3.8). |
| `Slot<T>` | Handle to a slot shared by the concurrent executions of one instance: empty or full (§6). |
| `Future<T>` | Read-only view of a slot: something to wait on (§6). |
| `Instance<T>` | Handle to an instance `spawn` started, whose function returns a `T` (§9). |
| `Inbox<T>` | Standard-library message queue built on slots (§6). |
| `Shared<T>` | A shared struct of one value in the instance's own memory: every copy sees the same value, read and written as `x->value` (§3.8). |
| `WeakRef<T>` | Handle referring to a disposable value without holding it (§3.8, §7). |
| Struct types | Declared with `struct` (§3.1). They may be generic. |
| Shared struct types | Declared with `shared struct` (§3.18): handles to a cell of the instance's own memory, holding its fields. |
| Enum types | Declared with `enum` (§3.11): exactly one of several variants. `Result<T>` is one (§3.12). |
| Function types | `fn(A, B) -> R`, `async fn(A) -> R` (§3.14). |
| Tuple types | `(A, B)`: a fixed number of values, by position (§3.15). |
| `any` types | `any T`, `any A & B`: a value of any type conforming to the traits (§3.10). |

Every type name is PascalCase; the primitives are language built-ins, declared in no module and always sendable. The other built-in types are ordinary declarations in the prelude and standard library (§3.8).

**Unions.** A value of the union `A | B` is a value of one of its members, which may be any types: primitives, literal types, structs, enums, shapes, tuples, function types, `any` types and type parameters.

- **Precedence.** In a type, `|` binds looser than `?` and type arguments, and tighter than a function type's `->`: `fn() -> A | B` returns `A | B`, and `(fn() -> A) | B` holds a function type. `any A & B | C` is `(any A & B) | C`.
- **A set.** Order doesn't matter, a member that is a union gives its members (but a recursive alias's use, §3.17, which stands whole as one member), duplicates merge, `Never` drops out, and a union of one member is that member. A member that another member holds whole merges into it, so no value sits in two members: a literal type into its base type (`"a" | String` is `String`, `true | false` is `Bool`), a member a recursive alias's union already holds into that alias's use, as into an `any` member (`Json | Int` and `Json?` are `Json`, §3.8), and a type into an `any` member whose traits it meets (`Int | any Stringable` is `any Stringable`). A struct declaration and its shape stay apart, since the conversion from one to the other rebuilds the value as another type (§3.1).
- **Collapse.** Substituting type arguments (§3.5) merges members again, as the union written with them would: `T | Int` with `T = Int` is `Int`, `T?` with `T = Int?` is `Int?`, and `T | any Stringable` with `T = Int` is `any Stringable`, which a value of `T` then goes into. A value an `any` member took whole is still a value of its own type inside it, so code written for the merged union reaches it as code written for the members does: it goes in through that member, a pattern naming its type or its literal selects it there (§3.11), and a type whose `any` member took `None` is optional (§4).
- **`T?`** is `T | None`, so `T??` is `T?`, and `Map<K, V?>.get(k)` gives a `V?` in which a missing key and a stored `none` look alike; `has(k)` tells them apart. `none` needs no expected type: alone, its type is `None`.
- **Conversion into a union.** Where a union is expected, a value goes into the member of its own type, else into a member written with a type parameter that its type fills (§3.5), else into the one member it converts into by another conversion above, so an `Email` goes into `(any Notifier)?` as an `any Notifier`. Converting into several members is a compile error. A union goes into a union holding each of its members, a literal member's base, or an `any` member that takes it whole: `Int | Plain` goes into `Plain | any Stringable`. The conversion takes a whole value, once, never inside another type and never through a reference (§3.7): an `Array<Int>` is no `Array<Int | String>`.
- **Built from the expected type.** Where a union is expected, whatever takes its type from the expected one, a struct, array or map literal, a lambda, a bare variant name or a literal, takes it from the one member it fits; fitting none, or several, is a compile error. `Entry{key: "sent", value: "ok"}` against `Entry<"draft", Int> | Entry<"sent", String>` builds the second, and `[]` against `Array<Int>?` an empty array.
- **Never inferred.** A union is a type only where one is written: without one expected, an `if`'s branches (§4), a collection literal's items (below) and a type parameter's arguments (§3.5) still need one type. `const x: Int | String = if c: 1 else: "a"` checks, and `const x = if c: 1 else: "a"` is an error.
- **Using one.** No field, method or operator of a member applies to a union; a union of literals has its base type's, through the conversion below. A union is taken apart with `match` or `is` (§3.11), or used through a trait (§3.10).

**Literal types.** A `String`, `Int` or `Bool` literal is also a type, whose one value it is: `"draft"`, `42`, `-1`, `true`. `Bool` is `true | false`, and keeps its operators and methods.

- **A literal's type** is its literal type where a literal type of its base, or a union holding one, is expected, and its base type elsewhere: `const s = "draft"` is a `String`, and `const s: Status = "draft"` checks `"draft"` against `Status`. A `let` without a written type widens a literal type to its base (§3.4).
- **Fitting.** A value of a literal type, or of a union of literals of one base, fits that base type: for `s: Status`, `s + "!"` and `s.toUpperCase()` are `String`s. A value of the base never fits a literal type: `const s: Status = name` is an error, while `case "draft" as d` gives `d` the type `"draft"` (§3.11). A lone literal type meets a trait through its base's functions that take the value itself, and through `&`, only through functions declared on the literal type (§3.7). At run time a lone literal type's value is its base's.
- **Agreeing values.** Where several values take one type and none is expected (§4), values of literal types of one base agree on that base: `[k1, k2]` is an `Array<String>`, and `if c: k1 else: k2` a `String`, for `k1: "a"` and `k2: "b"`. A literal type held inside another type is no value a conversion reaches, so values holding different ones agree only when each is a literal built from its parts, a tuple, a struct literal or a collection literal: they agree on the type with every literal type inside it widened, and each is built as that type, so `[(k1, 1), (k2, 2)]` is an `Array<(String, Int)>`.

```python
type Status = "draft" | "sent" | "failed"

struct NotFound { id: String }
struct Timeout { ms: Int }

fn find(id: String) -> Result<Int, NotFound>:
    if id == "": Err{NotFound{id}} else: Ok{id.length()}

fn load(id: String, waited: Int) -> Result<Int, NotFound | Timeout>:
    if waited > 1000:
        return Err{Timeout{ms: waited}}
    Ok{find(id)? + 1}                          # a NotFound converts into NotFound | Timeout

fn mark(s: Status) -> String:
    s + "!"                                    # a Status fits String
```

Duration literals are sugar for the standard library's `Duration`: an integer plus a unit, with no space between (`500ms`, `30s`, `15m`, `2h`, `5d`). For example, `5d` means `Duration{value: 5 * 24 * 60 * 60 * 1000}`. A fractional duration such as `1.5h` is a compile error; write `90m`. Every program loads the `time` module, so a duration literal works in any module, while the name `Duration` is visible only where `time` is imported.

**Literals:**

- **Strings:** `"…"` or `'…'` on a single line, with the escapes `\n`, `\t`, `\\`, `\"`, `\'`, `` \` ``, `\$` and `\u{…}`, which takes 1 to 6 hex digits naming a Unicode scalar value. Any other escape is a compile error.
- **Templates:** `` `Purchase ${req.id} awaits ${who}` `` is a `String`. Each `${…}` holds an expression, whose value is written as text by its `toString`, found as an operator's function is (§3.9), so a program's own type, a type parameter that is `Stringable` and an `any Stringable` all work; a value with no such `toString` is a compile error. A template takes a String's escapes: `\${` writes `${`, and a `$` not before `{` is plain text. Inside `${…}` line breaks are ignored, since its one expression is no list, and a `#` comment runs to the end of its line. A template without values is a constant, as a String literal is. For text whose shape comes from data, `strings.format` remains (§3.8).
- **Tagged templates:** `` tag`a ${x} b` `` is the call `tag(["a ", " b"], x)`: the texts, one more than the values, then each value. It is an ordinary call, so `tag` is any function, method or function value, and its parameters decide what the values must be, as `fn sql(parts: Array<String>, ...values: Array<any Stringable>)` takes any text-writable ones. A tag stands on the template's line, as a call's `(` does.
- **Multi-line text:** a template, and a docstring (below), may span lines. A line break in it is `\n`, whichever the source uses. If the opening delimiter ends its line, that line break goes, and so does the one before a closing delimiter alone on its line, with the spaces before it. Then every line after the first loses the leading spaces they all share; blank lines don't count. Indentation is read before escapes are, so an escaped `\n` or `\t` is never a line break or indentation. A template, a `${…}` or a docstring left open runs to the end of the file, as in JavaScript; the error points at its opening delimiter:

```python statements
const message = `
    Dear ${name},
      your order ${id} has shipped.
    `
# "Dear Ada,\n  your order 42 has shipped."
```
- **Numbers:** `42`, `1_000_000`, `0x1F` and `0b1010` for `Int`; `3.14`, `1e9`, `2E6` and `2.5e-3` for `Float`. A `_` stands only between digits, radix prefixes are lowercase, and there are no octal literals. A float has digits on both sides of its `.`, so `2.toString()` calls a method on the `Int` `2`, and `0..10` is a range.
- **`true`, `false` and `none`.**
- **Arrays:** `[1, 2, 3]`, and `[]` when empty.
- **Maps:** `["legal": 1, "cfo": 2]`, and `[:]` when empty. Keys are expressions.
- **Spread:** `[...xs, 4]` and `[...m, "a": 2]` build a new array or map from an existing one plus more elements or entries. A spread takes anything iterable (§3.10) and spreads the items its cursor gives: an array its elements, a map its `(key, value)` entries, a string its characters, a range its ints. In a map literal the items must be `(key, value)` tuples. A literal is a map literal only when it has a `key: value` entry or is `[:]`, so `[...m]` is an array of `m`'s entries.
- **Tuples:** `(1, "x")`, and `()` for `Unit`.
- **Ranges:** `3..5` covers 3 and 4 (half-open), `3..=5` includes 5, and either end may be left out: `..5`, `3..`. `by` gives a step: `0..10 by 2`, `10..=0 by -1`.
- **Structs and enum variants:** `Pair{first: 1, second: 2}`, `Rejected{by: "legal"}`, and `Ok{42}` for a type with a single field. A type without fields is just its name. `struct{value: 1}` is a struct literal whose type comes from context (§3.1).
- **Indented values:** a struct, map or array written as an indented block of `key: value` or `- item` lines (below).
- **Lambdas:** `fn(x): x * 2` (§3.14).

**Indented values.** A struct, map or array value may be written as an indented block, as a struct declaration's fields are (§3.1): `key: value` lines build a struct or a map, and `- item` lines build an array. The block reads the same everywhere; the type it is built as decides what it means.

```python
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
```

- **Opening.** An indented value opens on the lines below a line that ends right after the `=` of a `const`, a `let`, an assignment or a field's default; after `return`; after an entry's `:`; or after an item's `-`. Its lines stand deeper than that line. With nothing after the token, it takes its type from the expected one, as `struct{…}` does (§3.1).
- **Named form.** A line ending in `T:` at those places gives the value the type `T`, as `T{…}` does: `const api = Service:`, `return Pair<Int, String>:`, `retry: Retry:`. `T` is a named type with its arguments: a struct, a variant (`Rejected:`), an alias, `Map<String, Int>` or `Array<Int>`. `new T:` builds a shared struct (§3.18).
- **Nowhere else.** Headers (`if c:`, `while c:`, `for x in xs:`, `match x:`, `case P:`, `select:`) and a lambda's `fn(x):` keep their `:`, and their bodies are statements. A body's line `Name:` with a block below it is a label (§4). Inside `(…)`, `[…]` or braces no indented value opens, since line breaks follow the list rule there: an argument or an element is written `T{…}`.
- **Lines.** The value's lines stand at one column, and the first line at the opening line's column, or left of it, ends the value, as any block ends. `,` separates entries on one line. Comments and blank lines may go anywhere. An entry's value is the expression on the rest of its line, which continues as any expression does, inside brackets, templates and `${…}`. Nothing follows the value, on its opening line or after its block.
- **Entries.** Each line holds `key: value`, where the key is a name or a String literal (quoted, not a template); `key:` alone, with the entry's value as the indented value below it, or `key: T:`; a bare name, short for `name: name`; `...value`, a spread; a struct comprehension, as the last entry (§4); or `- value`, an item, whose `-` stands first on its line and is followed by a space or the line's end.
- **Items.** `- value` holds an expression. `- key: value` opens an anonymous keyed value whose other entries line up with `key`. `- T:`, or `-` alone, opens a value on the lines below, deeper than the `-`. A name whose `:` ends the item's line is told by its case, as a pattern's bare name is (§3.11): `- Point:` names the value's type, while `- nested:` is a key whose value is the block below. `- -1` is the item −1, while a line starting with `-1` holds no item. An item's expression can't start with `- `, so `- - 1` is an error: a nested array is written `- [1]`, or as a `-` with items below it.
- **Meaning by type.** The parser reads every block the same way, telling entries apart by their first tokens, as it tells a struct literal's items apart. What a block builds, and so whether its entries fit, comes from the value's type, the first row it matches:

| The value's type | Its entries | Built as |
| --- | --- | --- |
| an `Array` | items, and `- ...xs` spreads | `[…]` |
| a `Map` whose key type a String literal fits | names read as Strings, quoted keys, shorthand names, spreads | `["key": value, …]` |
| a struct, a variant, a shape, or an alias of one | names as keys, shorthand names, one spread first, a struct comprehension last | `T{…}` (§3.1), defaults filling the fields left out |
| another type a map literal builds | as for a `Map` | `["key": value, …]` |
| a union | as for the one member it fits (§2) | that member's literal |
| none expected, and no `T` | names only: the shape of the entries; any quoted key: a `Map<String, V>`; items: an array | as `struct{…}`, `["k": v]` and `[…]` are typed without one |

- **Map keys.** A bare key may be any name, even one the naming rules refuse as a field (`LOG_LEVEL`), and it is that name's String. A reserved word is quoted (`"for": 1`). Of two equal keys, the later one's value wins. A map whose key type no String literal fits is written as a bracket literal, `[1: v]`.
- **Errors:** items where a struct or a map is built, or keys where an array is; items and keys in one value; a quoted key where a struct is built; a struct comprehension where a map is built; any key where the map's key type no String literal fits; and a single-field value given without its name, which keeps only its brace form (`Ok{42}`).
- **A literal like any other.** An indented value builds exactly what the matching brace or bracket literal builds, with the same field order and evaluation order (§3.1). It is computed at compile time where its entries are (§3), and it may hold a value written in braces or brackets.

**Docstrings.** `"""…"""` says what a module, function, struct, enum or trait is for; tools show it, and the program never reads it. It is the first line of the declaration's indented body, or of a module, where only comments may come before it. A declaration without an indented body, such as an `extern fn`, a trait's requirement, an `extern struct` or a struct in braces, takes it on the next line, indented deeper. Fields, variants, aliases and constants take none, and a docstring anywhere else is a compile error. Its text is raw, with no escapes or values, ends at the first `"""`, and lays out its lines as a template does:

```python
trait Notifier:
    """Sends a message to whoever a value stands for."""
    fn notify(self: Self, text: String) -> Unit
        """Delivers `text`; nothing waits for an answer."""

fn greet(name: String) -> String:
    """
    A greeting for `name`,
    in one line.
    """
    `Hello ${name}`
```

**What each kind of bracket means.** `[…]` is for collections: array and map literals, indexing and slicing. A block below `=`, `return`, a key's `:` or an item's `-` builds a value too, with no bracket around it (indented values, above). `{…}` is for structured values and blocks: right after a name, a qualified name, type arguments or `struct` it constructs a value, in a type position it lists fields, and any other `{…}` in an expression is a block (§4). No construct puts a block right after a name, so the parser never needs to know what a name means; the compiler reports a name before `{` that isn't a struct or variant. `(…)` is for calls and conversions (§3.10), tuples and grouping. A map literal works for any type that satisfies `IndexAssignable<K, V>` and `Default` (§3.10), given an expected type `C`: `[k1: v1, k2: v2]` builds `C.default()` and assigns each entry with `c[k] = v`, and an empty `[]` or `[:]` builds just `C.default()`; a spread's entries are assigned the same way. Where a `Map` is expected, `[]` is an empty map; where a union holds both an array type and a map type, `[]` is the array and `[:]` the map. A literal whose own type doesn't go into an expected union is built as the one member its items can build it as, so `[1, [2]]` where a `Tree<Int>` (§3.17) or a `Json` is expected builds that union's array member, each item against the union again. Without an expected type, `[k: v]` makes a `Map<K, V>`. An array literal's elements, and a map literal's keys and its values, each have one type, as the branches of an `if` do (§4): the expected type's decides when there is one, otherwise the first item's, so an empty `[]` or `[:]` needs an expected type. Of two equal keys in one map literal, the later one's value wins.

**Numbers.** `Int` has arbitrary precision, as in Python, so it never overflows. `Float` is an IEEE 754 double. `/` always yields a `Float` and divides as IEEE 754 does, so dividing by zero gives an infinity or NaN; `//` is floor division on `Int`s, and `//` or `%` by zero panics (§3.12). For exact decimal arithmetic, such as money, the standard library has `Decimal`.

Type annotations are required on the parameters of declared functions and on struct fields. A lambda may omit parameter types when the expected function type gives them (§3.14), and a parameter with a default value may omit its type, which is then inferred from the default. Return types may always be omitted, on any function, exported or not, and are then inferred from the body; a recursive function writes its own, since its body refers to it, unless it is a lambda taking its result from the function type it is expected as (§3.14). A local `let` or `const` may omit its annotation when the initializer's type is unambiguous. Type parameters are written in angle brackets (§3.5).

## 3. Declarations

A program consists only of top-level declarations: imports, structs, enums, traits, type aliases, functions, `extern` declarations, and `const` values computable at compile time (literals, `none`, lambdas, and tuples, structs, arrays and maps built from them, in any literal form, each put into a union where one is expected, indented values (§2) among them, a field left to its default (§3.1) computed as its default is; a spread there spreads another array or map so built; never a shared struct, whose cell lives in an instance (§3.18)). A lambda there reads other constants but captures nothing, so it is a function value made once (§3.14). A top-level `const` may destructure its value as a local one does (§3.15), each name a constant of its own. There are no top-level variables or statements.

### 3.1 Structs

A struct is a named record with typed fields, one per line. Structs are ordinary types: use them for variables, parameters, return values and inbox messages alike.

```python
struct ReviewRequest:
    purchaseId: String
    amount: Int
    replyTo: Inbox<Verdict>
```

Construction lists the fields in braces after the type's name: `ReviewRequest{purchaseId: "P-1", amount: 900, replyTo: replies}`. The same value may be written as an indented value (§2), its fields on the lines below `ReviewRequest:`, or below a line ending in `=` where the type is expected, as the declaration lays them out. As in JavaScript, a bare name is always short for a field of the same name: `Pair{first, second}` means `Pair{first: first, second: second}`. A struct with exactly one field may take its value without the field's name, as long as that value isn't a bare name: `UserId{"u-1"}` and `UserId{prefix + id}` are positional, while `UserId{id}` always means the field `id`. To pass a variable positionally, wrap it in parentheses: `UserId{(id)}`. Both a reader and the parser can therefore tell the forms apart without knowing the struct's fields. A struct with no fields is written bare, its name alone being its value (`struct Marker` makes the value `Marker`); braces after it are a compile error. An updated copy spreads an existing value and overrides some fields: `Req{...req, amount: 0}` is `req` with `amount` changed, and `req` itself is untouched; `struct{...req, amount: 0}` does the same, taking the type from `req`. The spread comes first and only once, its value has the literal's type, and the fields named after it override it; `Req{...req}` is a plain copy. A literal may instead end with a struct comprehension, which gives each field of a struct a field of its own (§4): `struct{id, for k, v in ...rest: [k]: f(v)}`. Structs can be destructured in `match` patterns, and by the targets of declarations and assignments (§3.15). Fields have no visibility modifiers: any code can read them, since any module could declare a method on the struct anyway. Names of functions, methods, variables and fields are camelCase, preferring JavaScript's names where one exists (`push`, `indexOf`). A name that breaks these conventions, or the PascalCase rule for types (§2), is a compile error.

**Field defaults.** A field of a struct or a variant may have a default after its type: `times: Int = 3`. As a parameter's default does (§3.3), it runs at every literal that leaves the field out, in the declaring module's scope, and it may use the fields before it, as in `backoff: Int = times * 2`. A field with a default may omit its type, which is then the default's: `backoff = times * 2`. A literal written with names alone may leave out any field with a default, wherever the field stands; a spread gives every field, so it runs no default. A default runs as code of its own called from the literal, so it can't `await`, and a panic in it names it. A top-level `const` computes a default when compile time computes its expression (§3). JSON reads none: a field missing from an object fails as any missing field does (§9). Only a declaration's fields have defaults, not an anonymous struct type's or a trait's, nor associated types, and an anonymous struct type's fields take no annotations either (§3.16).

**Associated types.** A struct or enum declares a type computed from its type arguments among its fields or variants, in any order: `type Data = T`.

```python
struct Field<T>:
    value: T?
    type Data = T

struct Cell<T> { value: T, type Data = Array<T> }
```

- **Declared** as `type Name = Type` in the body. `Name` is PascalCase, takes no type parameters and, in an enum, differs from every variant's name. `Type` may use the declaration's type parameters and its other associated types by bare name, or be a type `match` (§3.17), and the fields may name it bare. It can't refer to itself, unless its body is a type `match` (§3.17); a top-level alias may (§3.17).
- **Read** as `Type.Name` in any type position, an alias for what it names: `Field<String>.Data` is `String`. On a type parameter whose trait requires it, `T.Data` is opaque (§3.5): it meets the trait's bound and is equal only to itself. A static function on it is called through it: `R.Data.default()`.
- **Only the type's own declaration** declares one, a shared struct's too: an extern struct, an anonymous struct type, a union and an `any` type have none. A trait requires one with `type Name`, met by the type's own (§3.10).

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

A `struct{…}` literal takes its type from context: the expected type where there is one, such as the field or array element above, the one member it fits where that is a union (§2), and otherwise the shape of its named items, so `struct{value: 1}` is `{ value: Int }`. When a shape is needed in more than one place, name it with an alias (§3.17), or declare a struct for a distinct type.

**Nominal to shape.** A value of a struct declaration fits where a shape is expected when its fields, with its type arguments substituted, are that shape, and none of its fields is annotated (§3.16): `struct Pixel { y: Int, x: Int }` fits `{ x: Int, y: Int }`, and the conversion copies the value as the shape. It applies as the conversion into a union does (§2): to a whole value, once, never inside another type, so an `Array<Pixel>` is no `Array<{ x: Int, y: Int }>`, and a struct whose field is a nominal struct fits only a shape naming that same struct there. A shape never fits a struct declaration; a literal builds one.

**Mapped struct types.** `{ [F in keyof S]: T }` is an anonymous struct type with a field of type `T` for each String literal of the union after `in` that no named entry in its braces names: `{ [K in "retries" | "region"]: Int }` is `{ region: Int, retries: Int }`, and `{ id: String, [F in keyof S]: S[F].Data }` takes `id` from its named entry. One mapped entry at most; each key must be a valid field name. `F` is a type, PascalCase: inside `T` it is that field's name as a literal type, and in `[F in keyof S]`, `S[F]` is that field's type. `S` is a struct type or a type parameter with a struct constraint (§3.5); any other type is a compile error. The mapped fields are visited in name order, as every struct's are, and take no defaults or annotations from `S`. A mapped struct type is a shape, the same type as any anonymous struct type with its fields, built by any struct literal that expects it. `T` is checked once per field of a struct type; for a constrained `S`, once per named entry of its constraint and once for its other fields, where `S[F]` meets the `[_]` entry's constraint, so a field the constraint names is named in the braces, which skips it, or `T` must fit it.

**Key types.** `keyof S` is the union of `S`'s field names as String literal types: `keyof Req` is `"id" | "value"`, and `keyof {}` is `Never`. Over a type parameter with a struct constraint it is opaque, holding the literals of the fields the constraint names. `S[K]` is the type of the field the key `K` names, and, for a union of keys, the union of their types: `Req[keyof Req]` is `Int | String`. For a key standing for one of several fields not known yet, a member type parameter `K in keyof S`, `S[K]` is that one field's type, opaque, unless the constraint gives every field `K` may name the same exact type: under `S is struct { a: Int, [_]: Int }` it is `Int`. `.Name`, `[K]` and `?` bind tightest, then `keyof`, then `|`, so `keyof S[K]` is `keyof (S[K])`. A key is a value like any String literal: compared, matched by literal patterns, passed where a `String` is expected, sent. `s[k]` reads the field `k` names (§3.9). A struct with a member type parameter pairs a key with its field's type, and a mapped type indexed by its own keys gives the union of one such entry per key:

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

**Field order.** Every struct's fields, nominal or shape, are visited in name order, sorted as JSON sorts keys (§9). Declaration order matters only to evaluation: a field default sees the fields declared before it, and a literal evaluates its fields as written.

**Recursive types.** A struct or enum may refer to itself, directly or through other types: `struct Node { value: Int, children: Array<Node> }`. A field whose type is the struct itself must be in a union, such as an optional (`next: Node?`), or sit inside a collection, so that every value stays finite. The rule follows fields through other structs, tuples and anonymous structs, so `struct A { b: B }` with `struct B { a: A }` is an error at both fields, while a union, an enum or a collection on the way ends the chain. A recursive alias (§3.17) is held to the same rule: `type List = { head: Int, tail: List? }` checks, while `tail: List` is an error at the field, and `type T = (Int, T)` at the alias.

**Shared structs.** `shared struct Inbox<T>: …` declares a struct whose values are handles to one cell holding its fields, built with `new` and read through with `->` (§3.18).

**No getters or setters.** Reading or assigning a field never runs code; a value computed from fields is a method, such as `order.total()`. This keeps structs plain data under value semantics.

**Value semantics.** Structs, arrays and maps are values. They are copied structurally, field by field, when assigned, passed to a function, returned or sent. A by-value parameter is immutable (§3.3). The only ways a function can change data its caller holds are an explicit reference (§3.7) and a handle, such as a `Shared` value (§3.8). `Slot<T>`, `Future<T>` and `WeakRef<T>` are **handles**, and so is every shared struct (§3.18), such as `Shared<T>`, `Inbox<T>` and `Revertible<T>`: copying one copies the handle, not the state behind it, and `==` compares handles by identity.

**Sendable types.** Only sendable values can leave an instance: as `spawn` arguments, or through extern declarations. Sendable types are the ones that satisfy the built-in `Sendable` trait (§3.10). A type is sendable when it is:

- a primitive or a literal type (§2);
- an extern struct declared `sendable` (§3.8) whose type arguments are all sendable;
- a user struct or enum whose fields are all sendable, a tuple whose elements are, or a union whose members are. This is derived automatically, and a recursive type is sendable unless something in its cycle isn't;
- a type parameter constrained `is Sendable`;
- a sendable function type, `sendable fn(A) -> R` (§3.14). It refers to code, so it goes only to an instance of the same program, through `spawn`: an extern declaration, or `json`, whose types contain one is a compile error.

Handles, such as futures, slots, `Shared` values, inboxes and weak references, and values of plain function types are never sendable, and neither is any value that contains one. They therefore never leave the instance that created them: `spawn` arguments and extern declarations can't contain them, which is a compile error.

### 3.2 Slots and inboxes

`Slot<T>` is the runtime's one primitive for sharing values between the concurrent executions of an instance, and `Inbox<T>` is the standard library's message queue built on it; both are described in §6. Queues that outlive every instance aren't part of the language: the host provides its own through extern declarations (§3.6).

### 3.3 Functions

```python
fn total(items: Array<Int>) -> Int:                        # may not await
    ...

async fn approve(req: PurchaseRequest) -> Future<String>:  # may await
    ...

extern fn chargeCard(id: String, amount: Int) -> Result<String>  # implemented by the host
```

- A function's value is the value of its body's last expression, or the value given to `return`. Its return type may be omitted and is then inferred (§2).
- An `async fn` declares its real return type, `Future<T>`. Inside it, `return` and the body's value have type `T`, and `await` on the call yields that `T`.
- Calling an `async fn` starts the callee right away, inside the caller's segment (§5): the callee runs until its first `await`, which doesn't commit but hands the future back to the caller, and what the callee did so far commits or rolls back with the caller's segment. A future is a must-use value (§7), which catches a forgotten `await`; it can also be passed to `select`. A stored future keeps running until it finishes or is disposed (§7).
- When a block ends, including a function's body, it releases everything its variables hold, disposing whatever nothing else holds (§3.4, §7).
- `extern fn` declares a host function with a typed signature and no body (§3.6).
- **Parameters are immutable,** as if declared `const` (§3.4): a by-value parameter can't be reassigned, changed in part or passed by `&`. Only a reference parameter (`&T`, §3.7) changes, and what it changes is the caller's place.
- **Parameter types.** A declared function's parameter has a type: written after `:`, named by its pattern (below), or taken from its default. A parameter with none of these is a compile error.

**Parameter patterns.** A parameter may be a declaration target (§3.15) in place of its name: a pattern that can't fail, which takes its argument apart when the body is entered.

```python
import * as math from 'math'

type Point = { x: Float, y: Float }
type Rect = { w: Int, h: Int }

fn norm(Point{x, y}) -> Float: math.sqrt(x * x + y * y)
fn area(struct{w, h}: Rect) -> Int: w * h
fn sum((a, b): (Int, Int)) -> Int: a + b
fn moved({x, y} as start: Point, dx: Float = x) -> Point: Point{x: start.x + dx, y}
```

- **Its names.** They are bound in the body and are immutable, like any parameter. The argument converts into the parameter's type first (§2), so every part is there, and each name holds a copy of its part, as a destructuring `const`'s does (§3.15). A pattern that can fail (§3.11) is a compile error: `fn f(Ok{value})`.
- **Its type.** A pattern naming its type, `Point{x, y}` or `Pair<Int, String>{first, second}`, takes no annotation: one beside it would write the type twice. A generic type named without its type arguments is an error, as a missing annotation is. A `struct{…}` or tuple pattern names none, so it is annotated or takes its type from its default, as a name does. In a parameter, `{…}` is short for `struct{…}`, in its pattern and every pattern nested in it, since a `{` there can only be a pattern.
- **Its name.** A destructured parameter has no name, so a call gives it by position only. `Pattern as name` names the whole as well, bound beside the parts; that name is the parameter's, for named arguments, and `as self` makes the function a method (§3.7).
- **Where not.** A pattern binds values, while a reference passes a place, so a `&` parameter is a name; so is a rest parameter or a pack. An extern function and a trait's requirement have no body of their own to bind a pattern's names in, so theirs are names too. Clashes and overloads compare parameter types only (§3.7): `fn f(Point{x, y})` and `fn f(p: Point)` clash.

```python statements
fn retry(times: Int = 3, backoff: Duration = 1s): ...
retry()                      # retry(3, 1s)
retry(5)                     # retry(5, 1s)
retry(backoff: 2s)           # retry(3, 2s)

fn log(level: String, ...parts: Array<String>): ...
log("info", "a", "b")        # log("info", ["a", "b"])
log("info", "a", ...more)    # parts is "a" followed by the elements of more
log(level: "info", parts: more)
```

**Arguments.** A call fills its function's parameters as a struct literal fills fields (§3.1): by position, then by name, and each parameter it leaves out takes its default. A call broken over lines needs no `,` between its arguments (§2).

- **Defaults.** Parameters with defaults come after the others. A default is an expression evaluated at every call that leaves its parameter out, and it may use earlier parameters, as in `fn window(start: Int, end: Int = start + 10)`, the names an earlier parameter's pattern binds among them: `fn window(Range{start, end}, step: Int = end - start)`. It is a value, not part of the function's body, so neither `return` nor `?` can leave it. Such a parameter may omit its type, which is inferred from the default: `fn retry(times = 3)`. A struct's fields have defaults the same way (§3.1).
- **Named arguments.** `f(name: value)` gives the parameter of that name, so a call can leave out a default before one it gives: `retry(backoff: 2s)`. Named arguments follow the positional ones, in any order. A positional argument or a spread after a named one is a compile error, and so is a parameter given twice. A `&` parameter is named with its `&`: `f(target: &x)`. A destructured parameter is named only by its `as` name. A method's `self` is given before the dot, never by name.
- **Order.** Arguments are evaluated in the order they are written, then each default left out, in parameter order, so a default sees the parameters before it however they were given. A spawned call's defaults are computed by the new instance, which runs the function (§9).
- **Rest parameters** are sugar for an array. The last parameter, written `...name: Array<T>`, comes after any parameters with defaults and collects the remaining positional arguments. `...xs` at a call spreads anything iterable into them, as in an array literal (§2), mixed freely with single arguments; a spread anywhere else is a compile error. Named, the rest parameter takes a whole array: `log(level: "info", parts: more)`. An extern function's rest parameter reaches its host as an array (§9). A rest parameter may instead be a pack, `...args: A`, which collects the arguments into a tuple (§3.5).
- **Function values.** Names and defaults aren't part of a function's type (§3.14), so a function value's call gives every argument by position, with no spread.

### 3.4 Variables

```python statements
const limit: Int = 50_000          # immutable
let count = 0                      # mutable; inferred: Int
count = count + 1

const roles = ["legal", "finance"]
roles.push("cfo")                  # compile error: roles is const
```

`let` declares a mutable variable and `const` an immutable one. A `const`, a `let` or an assignment may end its line at `=`, with an indented value on the lines below (§2), built as the variable's type. Without a written type, a variable has its initializer's type, which a `let` widens, since a later assignment may give it any value of the wider type: a literal type to its base (§2), and a sendable function type to the plain one (§3.14). A `const` is deeply immutable: it can't be reassigned, its fields and elements can't be changed, and you can't take `&` of it, so mutating methods like `push` are rejected. Immutability stops at handles: a `const` slot or inbox can still be used, and the fields of a `const` shared struct can still change through `->`, because that changes the cell behind the handle, not the handle itself. The compiler warns about a `let` that is never reassigned or mutated: assigning to one of its fields or elements, passing it by `&`, and calling a method that takes `&self` on it all count as mutating it. In a `let` declaring several names, each name never changed is warned about, to be declared as a `const` of its own.

Variables are block scoped: a variable is visible only inside the block that declares it and in blocks nested within it. A variable declared inside an `if` body does not exist after the `if`. A loop variable (`for x in xs`) and every variable declared in a loop body are fresh on each iteration, so closures created in different iterations never share them. Unlike Python, assigning to an undeclared name is a compile error. Declaring a name twice in one block is a compile error too, also for two local functions, which therefore can't be overloaded; a nested block may shadow a name from an enclosing one. Types and values share one namespace per scope.

**Lifetimes follow blocks too.** When a block ends, whether it finishes or is left through `return`, `break`, `continue` or disposal, it releases everything its variables hold (§7). A loop body is a block, so each iteration releases its own holdings. `hold let` and `hold const` declare a variable whose *name* is still block scoped but whose holdings last longer, which is how a loop keeps what it starts: until the enclosing function ends, or, written `hold(name)`, until the loop or block labelled `name` (§4) ends, however it ends; `continue` of that loop keeps them. `hold(f)` naming the enclosing function is plain `hold`. What the variable holds when its block ends is kept, while a value it held before and lost to an assignment was released then, as any overwritten value is. The common unnamed case has a short form: `hold _ = expr` means `hold const _ = expr`.

```python statements
for role in roles:
    hold _ = reviewQueue(role).sendRevertible(request) # revertible until the function returns
```

A block takes a label only so that a `hold` can name it: the label ends its line, and the block is indented below it. It is a statement of type `Unit`, and `break` and `continue` never name it.

```python statements
batch:
    for job in jobs:
        hold(batch) _ = start(job)                      # runs until the batch ends
    await allDone()
```

### 3.5 Generics

Structs and functions take type parameters in angle brackets. Type arguments can always be written explicitly at a call site. Otherwise they are inferred: each argument's type is matched against its parameter's type, and a struct's fields fill a shape (§3.1), so `fn f<T>(p: { x: T, y: T })` called with a `struct Pixel { x: Int, y: Int }` binds `T` to `Int`. Against a union holding type parameters, an argument fills them with what the union's other members don't take (§2): `fn f<T>(x: T?)` called with an `Int` or an `Int?` binds `T` to `Int`, and called with `none`, or any `None` value, binds nothing. A type parameter the arguments leave open is taken from the type the call is expected to have, once the function is chosen, and then from its default. Two different types for one parameter, which inference never joins into a union, or a parameter still open, is a compile error that asks for the type arguments.

```python
struct Pair<A, B>:
    first: A
    second: B

fn swap<A, B>(p: Pair<A, B>) -> Pair<B, A>:
    Pair{first: p.second, second: p.first}
```

- **Explicit type arguments** use the same brackets everywhere: `swap<Int, String>(p)`, `Slot.create<Verdict>()`. Trailing ones that have defaults may be left out.
- **Defaults.** Any type parameter may have a default, on a struct, enum, trait, alias or function alike: `enum Result<T, E = Error>`. A default fills a type argument that is neither written nor inferred.
- **Parsing.** In an expression, `name<...>` takes type arguments when the part inside the brackets parses as a list of types and is followed by `(` or `{`, the same rule C# uses: `swap<Int, String>(p)`, `Pair<Int, String>{first: 1, second: "x"}`. Types include unions, literal types and a field's type by key, so `a < 1 > (b)`, `a < b | c > (d)` and `a < b[c] > (d)` are calls too. A comparison that happens to look like that needs parentheses: `(a < b) > c`.
- **When inference has nothing to go on,** give the type arguments or annotate the variable: `let xs: Array<Int> = []`.
- **Constraints.** A type parameter can be constrained by traits (§3.10) with `is`: `T is Sendable`. Several traits are joined with `&`: `T is Sendable & Comparable`. Every type argument, written or inferred, is checked against its parameter's constraints wherever it appears: in a call, an annotation or a literal.
- **Struct constraints.** After `is`, `struct { … }` constrains a struct's fields: `S is struct { title: String, [_] is FormNode }`. Only a struct type meets one: a struct declaration's, not a shared or extern struct's, or an anonymous struct type (§3.1). `name: Type` requires the field with exactly that type, after aliases; `name is C` requires it to meet `C`, traits joined with `&` or a struct constraint; `[_]: Type` and `[_] is C` do the same for every field the constraint doesn't name, one such entry at most. A struct may have fields the constraint doesn't name. Inside the braces `&` constrains each field, outside it the parameter: `T is struct { [_] is A } & Sendable`. Bare `struct` is met by any struct. A recursive struct type (§3.1, §3.17) meets one when its fields do, assuming the struct itself meets it while its fields are checked. A type parameter meets one when its own struct constraints imply it: they name each field it names, with an entry implying that entry, and, when it constrains the other fields, every field they name beyond its own and every field their `[_]` entries cover meets that; so `S is struct { a: Int, [_] is Stringable }` meets `struct { [_] is Stringable }`, since `Int` meets `Stringable`. A struct constraint is never a type: it stands only after `is`.
- **Checked once.** A generic body is checked once, not per instantiation: inside it, a value of a type parameter supports only what the parameter's constraints require, plus `==`. A struct constraint's named fields are read and written by name, `t.title`, typed as their entry: the exact type, or an opaque type meeting its constraints; its other fields are out of reach. An associated type of a type parameter, `T.Data`, is opaque too, equal only to itself (§3.1), and so is a use of a type `match` its type parameters don't decide yet, equal only to the same alias with the same arguments (§3.17). Using a generic function therefore never reports an error inside its body.
- **Inference never goes through an associated type or a type `match`:** `fn f<T>(x: Field<T>.Data)` is called `f<Int>(x)`, and `fn g<D>(x: DataOf<D>)` is called `g<OrderForm>(x)`, or with another argument, or an expected result, that gives the parameter.
- **Packs.** A function's type parameter written `<...A>` stands for a tuple of types, so one declaration takes any number of arguments of any types. It is used as a rest parameter, `...args: A`, as the rest of a function type, `fn(Int, ...A) -> R`, and anywhere a tuple type can stand, such as `Array<A>`. Substituting a tuple for it flattens a rest: `fn(...A)` with `A` as `(Int, String)` is `fn(Int, String)`, and with `()` is `fn()`. A pack is inferred from the arguments its rest parameter collects, as the tuple of their types, or from a function argument's parameters (`logged(area)` binds `A` to `(Int, Int)`); written, it is a tuple type: `logged<(Int, Int), Int>(area)`. Inside its function a pack is opaque: a value of it can be passed, kept and compared with `==` as any type parameter's, and spread with `...` only where a rest of the same pack takes it, as `f(...args)` does. The arguments a pack's rest collects are single values by position, or one such spread; nothing names them. A pack takes no constraint and no default, a struct, enum, trait or alias takes none, and a function has one rest, an array or a pack.
- **Member parameters.** A type parameter written `<S in U>` stands for exactly one member of the union `U`, never several; `U` may mention earlier parameters, but is no member parameter, which stands for one type already (`<S in S>` and `<A in B, B in A>` are errors). An argument whose type is one member of `U` fills it, a literal with its literal type (§2): `describe("draft")` below binds `S` to `"draft"`; a literal type whose base is a member fills it with that base. An argument whose type is a union of several members doesn't, a compile error as for overloads (§3.7): narrow it first, with a literal or type pattern (§3.11). A type argument written for it, to a call or to a type, is one member too, or a member parameter whose own union's members all are, never a type parameter that could be any type: `Entry<T>` is an error for an unconstrained `T`, and `Entry<K>` checks for `K in Status`. The body is checked once, with `S` known only to be one member of `U`, so its values fit `U`; each member it is used with is its own instantiation. A value of `S` compares by `==` and literal patterns (§3.11) as that member: with any literal of its base, always unequal to one no member equals, a condition decided by types (§4), and cases covering each literal member of `U` cover `S`. Declarations take one as functions do, `struct Entry<V, K in Status>`, and it takes no default and no `is` constraint beside its union.
- **Compiled per instantiation.** A generic function or type is compiled once for each set of concrete type arguments it is used with, so every call has a fixed target and the runtime never needs types to make one (§3.10). A generic function or type that would need endlessly many instantiations, such as `f<T>` calling `f<Array<T>>`, or `struct W<T>` with a field of type `W<(T,)>?`, is therefore a compile error, and so is a type `match` reducing to itself that way, `W<T>` to `W<Array<T>>` (§3.17).

```python
fn logged<...A, R>(f: fn(...A) -> R) -> fn(...A) -> R:
    fn(...args: A) -> R: f(...args)          # wraps a function of any parameters

fn area(width: Int, height: Int) -> Int: width * height

fn measured() -> Int:
    const measure = logged(area)             # A is (Int, Int): fn(Int, Int) -> Int
    measure(3, 4)
```

```python
type Status = "draft" | "sent" | "failed"

fn describe<S in Status>(s: S) -> String:    # one instantiation per member used
    `status ${s}`

fn report(status: Status) -> String:
    match status:
        case "draft" as d: describe(d)        # d: "draft"; describe(status) is an error
        case _: describe("sent")
```

### 3.6 Extern declarations

`extern` marks a top-level declaration whose implementation lives in the host, outside any workflow instance. It applies to functions, which have no body, to constants, written `extern name: Type` with no initializer, and to struct types the host implements, such as `extern sendable struct Queue<T>`. Their values cross as JSON (§9), so the parameters of extern functions must be `Encodable`, and their results and extern constants `Decodable` (§3.10), which makes all of them sendable (§3.1). The one exception is sendability: what crosses to the host crosses as JSON, so a disposable host type, below, which isn't sendable, still crosses to its own host, alone or inside other values. An extern function may also return a `Future<T>`, which the runtime creates and the host fills. A host object with operations of its own is an extern type with extern functions taking it, and one whose release the host must learn of is a disposable host type, below: a queue the host provides gives a revertible send as one, which the `inbox` module's `Revertible.holding` keeps until its holder is released (§6, §12.1).

```python
extern fn chargeCard(purchaseId: String, amount: Int) -> Result<String>
extern approvalDeadline: Duration
extern purchaseRequests: Queue<PurchaseRequest>     # a queue the host provides
```

- **Provided by the host.** The host supplies each extern constant's value and keeps it outside instance snapshots, so it outlives every instance and every deploy.
- **Sendable only.** An extern constant is `Decodable`, so sendable (§3.1), since any instance may read it. A function type, even a sendable one (§3.14), has no JSON form, so it never crosses.
- **Constant binding.** An extern can't be reassigned. Its internal state can still change through its methods, for example when a message is sent into a queue the host provides.
- **Checked at deploy.** The runtime refuses a program whose extern declaration has a different type from the one it already holds under that name, so one name always means one type.
- **Deterministic reads.** An instance reads an extern constant once, at its first read, and keeps that value in its snapshot for its whole life, so every segment, resumed or not, sees the same value.
- **Disposable host types.** A host type is disposable when a `dispose` is declared beside it (§7): an extern one its host implements, or code that passes the value to the host's externs. Each value of it then has an identity of its own: it arrives as the JSON the host gave, which the instance keeps while it holds the value, and leaves to the host as that same JSON. So such a type can't be declared `sendable`, it isn't `Encodable` or `Decodable`, and no extern constant, which every read shares, can hold one.

### 3.7 Methods and references

A method is an ordinary function whose first parameter is named `self`, or is a pattern named so, `Point{x, y} as self` (§3.3). Methods live in the program's definition, not inside values, so data stays plain and serializable. Dispatch is static, by the receiver's type.

```python
struct Stack<T>:
    items: Array<T>

fn push<T>(self: &Stack<T>, item: T):     # takes a reference
    self.items.push(item)

fn top<T>(self: Stack<T>) -> T?:          # takes a copy
    self.items.at(-1)
```

`s.push(3)` calls `push` with `self` bound to `s`. When `self` is a reference, the `&` is implicit at the call, so `s.push(3)` modifies `s`.

**References.** A parameter of type `&T` refers to the caller's variable instead of a copy. Changes made through it are visible to the caller, including to other concurrent executions of the same instance:

```python
async fn collectSignature(sigs: &Array<Signature>, signer: String):
    _ = signQueue(signer).sendRevertible(SignRequest{signer: signer})
    sigs.push(await signatures(signer).receive())

async fn signContract(contract: Contract) -> Future<Array<Signature>>:
    let sigs: Array<Signature> = []
    const a = collectSignature(&sigs, "alice")
    const b = collectSignature(&sigs, "bob")
    await a
    await b
    sigs
```

The rules:

- **Explicit at the call site.** An argument passed by reference is written `&x`. Only a method's `self` takes its reference implicitly, so `x.f()` passes `x` by reference when the chosen `f` takes `&self`; `x` must then be a place that may change (a variable, a field or element of one, or the value behind a shared struct, `*x`, or a part of one), never a call's result, a `const`, or a value read through an optional chain (§4). `&` may stand only before a whole call argument, and `&T` only as a parameter's type; anywhere else either is a compile error.
- **Exact types.** A reference names the caller's own variable, so its type must be the parameter's exactly: no value is converted into a union through a reference.
- **One kind of reference, and it allows mutation.** A read-only reference would add nothing, because a by-value parameter can't change at all (§3.3).
- **What can be referenced.** A `let` variable or a `&` parameter, a field or tuple element path of one (`&self.items`, `&t.0`), a field a struct's key names when the key is one name (`&s[k]`, §3.9), a field path as `&s.region` is, an element of any indexable value (`&m["a"]`), or the value behind a shared struct or a path of one (`&*u`, `&u->items`). A reference parameter passed on with `&` passes the same reference. One variable may be passed by `&` twice in one call, and both refer to it; but not when either reaches through an element of it (`f(&xs[i], &xs[j])`, `f(&a[0].x, &a[0].y)`, `f(&xs, &xs[0])`), a compile error, since an element is a copy for the call. Nor may one call be passed two places that reach through shared structs (`f(&u->a, &w->b)`), since such a value is a copy too and two handles may be one. An element is read through its container's `index` and written back with `setIndex`, whether the container is an `Array`, a `Map` or a user type (§3.9).
- **Elements and shared structs' values are copied in and out.** An element passed by `&` (`&m["a"]`, or `m["a"].f()` for a method taking `&self`) is read with `index` before the call, which panics for a key the map doesn't hold, and written back with `setIndex` when the call returns. A shared struct's value passed by `&` (`&u->items`, or `u->items.push(x)`) is read from its cell and written back the same way (§3.9). During the call the container, or the handle, still holds the old value, as a closure sharing it or a second `&` to it sees. When the call returns, the copy is written into the container or the handle's value as it holds it then, so what changed another part of it during the call stays changed. An async call returns its future before its callee ends, so passing an element or a shared struct's value by `&` to an async function is a compile error: copy it into a `let`, pass that, and assign it back.
- **References aren't values.** They can't be stored in variables or struct fields, returned or sent. Aliasing exists only for the duration of a call.
- **No references to constants.** Neither a `const` variable nor an `extern` constant can be passed by `&`.
- **No dangling references.** A referenced variable's storage stays alive until every call holding a reference to it has ended, even if its block ends first. It just can't be named after its block ends.

**Overloading.** A function is identified by its name and its parameter types, so several functions can share a name:

```python
fn area(self: Circle) -> Float: ...
fn area(self: Rect) -> Float: ...
fn scale(self: &Rect, factor: Float): ...
fn scale(self: &Rect, factor: Int): ...
```

- Calls are resolved statically from the argument types and any explicit type arguments. Return types play no part.
- A literal argument whose items each have a type of their own, such as `struct{c: 3}`, `(3,)` or `[1, 2]`, has its own type when choosing. Where that type doesn't fit a parameter whose type is known, but its items fit that type's, the literal is built as the parameter's type, as an expected type builds it: `f(struct{c: 3})` calls `fn f(x: { c: Int? })`. Inference never goes through this: a parameter type still to be found takes the literal's own type.
- A generic function is chosen through inference only when it is the single function that matches. When a concrete function matches as well, the concrete one wins: given `fn show<T>(x: T)` and `fn show(x: Int)`, the call `show(5)` uses the concrete one, while `show<Int>(5)` uses the generic one.
- With explicit type arguments, only generic functions that take that many type arguments are considered.
- When a call fits both a function with a rest parameter and one without, the one without wins, after a concrete function has beaten a generic one (§3.3); a pack is a rest parameter, so a function of fixed arity beats one taking a pack. After that, a function taking every argument as it is beats one that makes a plain function argument async (§3.14), converts between a one-element tuple and its element (§3.15), converts a struct's value into its shape (§3.1) or builds a literal argument as a type other than its own, so `fn mock(target: fn(...A) -> R, …)` and `fn mock(target: async fn(...A) -> R, …)` each keep their target's own type, a call fitting both `fn f(p: Pixel)` and `fn f(p: { x: Int, y: Int })` with a `Pixel` takes the first, and `pick([1])` takes `fn pick(x: Array<Int>)` over `fn pick(x: Array<Int?>)`.
- A named argument rules out every function without a parameter of that name (§3.3); names tell functions apart in no other way.
- A union argument takes only an overload whose parameter takes the whole union, or a wider one: `f(x: A)` and `f(x: B)` together don't take an `A | B`, which a `match` takes apart first (§3.11).
- Any other ambiguity is a compile error, resolved by giving the type arguments explicitly.
- Two functions of one name clash, a compile error, when some call by position could fit both and no rule above prefers one: for some number of arguments, counting defaults left out and a rest parameter's items, their parameters have the same types, both by value or both by `&`. Shapes are the same type wherever written (§3.1), so `fn f(p: Point)` and `fn f(p: { x: Int, y: Int })` clash for `type Point = { x: Int, y: Int }`. Generic ones are compared up to the names of their type parameters. A pack's items count as the same as any type. A type counts as the same as a union holding it, since the conversion into a union (§2) would make every call to the pair ambiguous: `fn f(x: A)` clashes with `fn f(x: A | B)`, and `fn f(x: "a")` with `fn f(x: String)`, which absorbs it, while unions that only overlap don't clash; `fn(A) -> R` and `async fn(A) -> R` differ, as the rule above tells them apart. This covers the prelude's overloads too.
- A method can also be called as a plain function: `push(&s, 3)` is the same call as `s.push(3)`.
- Free functions `g(x: S)` and `g(x: &S)` may coexist, because the `&` at the call site tells them apart.
- The one forbidden overload is a pair that differs only in whether `self` is a value or a reference, such as `fn f(self: S)` and `fn f(self: &S)`. Method notation (`s.f()`) couldn't choose between them, so declaring both is a compile error.

**Static functions.** A function without `self` can be declared on a type, and is called through it:

```python
fn Duration.zero() -> Duration:
    Duration{value: 0}

const nothing = Duration.zero()
```

The type before the dot selects the function, so static functions never need overloading by return type. A static function is visible where a function would be: declared in the calling module, in the module of its type, in the prelude, or in a module the caller imports. Several visible static functions of one name on one type are overloads. In generic code, a type parameter takes the type's place: `T.zero()` (§3.10).

### 3.8 Prelude and standard library

The **prelude** declares the built-in types the runtime implements, using the same `extern` mechanism programs use (§3.6):

```python
extern sendable struct Array<T>
extern sendable struct Map<K, V>
extern struct Slot<T>                       # not sendable
extern struct WeakRef<T is Disposable>      # not sendable
extern struct Future<T>                     # not sendable
extern sendable struct Instance<T>          # compared by identity, never Encodable (§9)
shared struct Shared<T> { value: T }        # not sendable (§3.18)

extern fn Slot.create<T>() -> Slot<T>                       # starts empty
extern fn put<T>(self: Slot<T>, value: T) -> Future<Unit>   # waits until empty, then fills
extern fn take<T>(self: Slot<T>) -> Future<T>               # waits until full, then empties
extern fn read<T>(self: Slot<T>) -> Future<T>               # waits until full, keeps the value
extern fn WeakRef.from<T is Disposable>(value: T) -> WeakRef<T>   # WeakRef(x): the one weak handle to x
extern fn deref<T is Disposable>(self: WeakRef<T>) -> T?
extern fn disposed<T is Disposable>(self: WeakRef<T>) -> Future<Unit>
extern fn result<T is Sendable>(self: Instance<T>) -> Future<Result<T>>   # its first end (§9)
```

The prelude also contains `type Optional<T> = T?`, whose static functions are every optional's (§3.17), `Result`, `Step` (§3.10), `Error`, the built-in traits (§3.10, including `Disposable`, `Stringable` and `Parsable`, which `Int`, `Float`, `Bool` and `String` satisfy), the `Waypoint` annotation (§10) and `panic`.

The **standard library** is a set of modules, imported explicitly, for example `import * as time from 'time'`. Pure modules are plain code in the language; runtime-backed ones declare externs the runtime implements. Nothing in it reaches a file system, shell, environment, network or reflection: a workflow affects the outside world only through externs its operator provides.

| Module | Contents |
| --- | --- |
| `time` | `Time`, `Duration`, `now()`, `at(t)` (the runtime's only time primitive) and `delay(d)`, which is `at(now() + d)`; `t + d`, `d + d` and `d * n` for an `Int` `n`; both types are `Comparable`, as the milliseconds they hold, and `Stringable` and `Parsable` in ISO 8601, `Time` as JavaScript's `Date.toJSON` writes it (`2026-10-25T12:00:00.000Z`) and `Duration` as `Temporal.Duration` does (`PT1H30M`). Time zones: `Zone`, an IANA zone, a type the runtime implements that holds the zone's canonical id, so `==` and map keys compare zones, read by `Zone.parse(id)` in any case, given by `utc()`; `DateTime`, a wall-clock reading with no zone, `Stringable` and `Parsable` as `2026-10-25T13:00:00`, with `weekday()` (1 is Monday, 7 Sunday) and `addDays(n)` (calendar days, so a wall-clock time survives a change of offset); `t.inZone(z)`, the reading of `t` in `z`; `Time.of(dt, z)`, the instant `dt` reads in `z`, the earlier of two where a change of offset repeats `dt` and moved forward by the gap where one skips it, which panics on a date that doesn't exist; and `t.format(z)`, ISO 8601 with `z`'s offset (`2026-10-25T13:00:00.000+01:00`), which `Time.parse` reads. Zone rules are the host's time-zone data, so two hosts with different data can disagree |
| `math` | `abs(x)` of an `Int` or a `Float`; `floor(x)`, `ceil(x)` and `round(x, mode = Rounding.HalfEven)` of a `Float`, which keep its type, so `Int(math.floor(x))` is the int at or below `x`; `sqrt(x)` of an `Int` or a `Float`, a `Float`, NaN for a negative number as IEEE 754 gives; `min(a, b)`, `max(a, b)` and `clamp(self, low, high)` of any `Comparable` type, each giving the first of equal arguments, and `clamp` panicking when `low > high`; `Rounding`, the rounding modes `math` and `decimal` share: `Floor`, `Ceiling`, `TowardZero`, `AwayFromZero`, `HalfEven` (a tie goes to the even neighbour) and `HalfAwayFromZero`. Each function takes its number as `self`, so one imported by name is also a method: `x.abs()`, `x.round()`. Powers are the `**` operator (§3.9) |
| `decimal` | `Decimal`, an exact decimal number of any size, for arithmetic such as money. `Decimal(i)` converts an `Int`, and `Decimal.parse(s)` reads an optional `-`, digits and an optional fraction, such as `-12.50`, and nothing else. A value has one form, so `==` and map keys compare numbers: `toString` writes it with no exponent, no trailing zeros after the point and no `-0` (`-12.5`), and `toFixed(places, mode = Rounding.HalfEven)` with exactly `places` digits after the point (`-12.50`); it crosses as JSON as text (§9). Every function of two numbers takes a `Decimal` or an `Int` on either side, never a `Float`, whose rounding is what `Decimal` avoids (`==` is built in and compares two values of one type, so `d == Decimal(1)`, §3.9): `+`, `-` and `*` are exact; `/` rounds half to even to 34 significant digits, as IEEE 754's decimal128 does, and `divide(a, b, places, mode = Rounding.HalfEven)` rounds to `places` digits after the point; `//` and `%` are related as on `Int`s (§3.9); a division by zero panics, there being no infinite `Decimal`. `Int(d)` truncates toward zero and `Float(d)` is the nearest float. `abs`, `floor`, `ceil` and `round(places = 0, mode = Rounding.HalfEven)` give a `Decimal`, and `d ** n` is exact for an `Int` exponent of at least 0 and divides as `/` does for a negative one, so a `Decimal` is `Powerable<Int>`. A negative `places` panics |
| `strings` | String methods, with JavaScript's names and counting code points as `s[i]` does (`includes` is the prelude's, since `in` calls it, §3.9): `indexOf(search, from = 0)` (`-1` when absent), `lastIndexOf`, `startsWith`, `endsWith`, `slice(start = 0, end = none)` (clamping, a negative index counted from the end), `split(separator)` (an empty one splits into code points), `trim`, `trimStart`, `trimEnd`, `padStart(length, fill = " ")`, `padEnd`, `repeat(n)` (panics on a negative `n`), `replace(search, replacement)` and `replaceAll`, which match plain text; `toUpperCase` and `toLowerCase`, by Unicode's default case mapping and never a locale, so a re-run segment always computes the same; `format(template, ...values)`, where `{}` takes the next value, `{n}` value `n` and `{{` and `}}` write a brace, and a placeholder without a value or a stray brace panics; `graphemes(s)` for user-perceived characters and `utf16Length(s)` for the length JavaScript counts. Called as `strings.trim(s)`, or as `s.trim()` where `trim` is imported |
| `json` | `Encodable` and `Decodable`, the traits of types that cross as JSON (§3.10, §9), with their `toJson` and `fromJson` for every primitive, `Json`, `Array`, `T?` and `Map`; `stringify(v)` and a typed `parse<T>(s) -> Result<T>`, through them; `Json`, the recursive union `None | Bool | Int | Float | String | Array<Json> | Map<String, Json>` (§3.17) holding JSON of any shape, written as plain values at any depth (`const j: Json = ["a": 1, "b": [true, none]]`, or the same as an indented value) and taken apart by type patterns (`case Int as n`, `case Map<String, Json> as fields`, `case None`), a JSON number an `Int` where it is whole and a `Float` otherwise, so `Json?` is `Json`, and `has(k)` tells a missing key from a stored `null`; with `encode(v) -> Json` and `decode<T>(j) -> Result<T>` between it and typed values; `encodeText(v)` and `decodeText<T>(j, path)`, the codecs of a type that crosses as the text its `toString` writes; the `JsonName`, `JsonSkip` and `JsonBigInt` annotations (§3.16) |
| `regex` | Regular expressions with RE2's linear-time engine and syntax: flags inline (`(?i)`, `(?m)`, `(?s)`), named groups `(?P<name>…)` or `(?<name>…)`, and no backreferences or lookaround. `Regex{pattern}` is a plain struct, so `Regex{"\\d+"}` is a literal one, which panics where it is used if the pattern is invalid; `Regex.parse(text) -> Result<Regex>` checks a pattern from outside. It is `Stringable` and `Parsable` as its pattern, and crosses as JSON as text (§9). `test(s)` (a match anywhere), `find(s) -> Match?`, `findAll(s) -> Array<Match>`, `replace(s, replacement)` and `replaceAll`, which expand `$1`, `$<name>`, `$&` and `$$` as JavaScript does, `split(s)`, and `escape(s)`, the pattern matching `s` literally. A `Match` has the `text` matched, the `index` it starts at in code points, `captures: Array<String?>` (group `n` is `captures[n - 1]`, `none` when it took no part) and `named: Map<String, String>`, the named groups that took part |
| `crypto` | `hash(algorithm, data, encoding = Encoding.Hex)` and `hmac(algorithm, key, data, encoding = Encoding.Hex)`, with `algorithm` a `Hash` (`Sha1`, for interop with older systems only, `Sha256`, `Sha384` or `Sha512`); `timingSafeEqual(a, b)`, which takes the same time whatever two strings of one length hold, and is `false` for strings of different lengths; `encode(text, encoding)` and `decode(text, encoding) -> Result<String>`, with `encoding` an `Encoding` (`Hex`, `Base64`, or `Base64Url`, unpadded). There is no bytes type, so text goes in as its UTF-8, a key included, and digests come out as text; `decode` fails on text that isn't the encoding's canonical form, or whose bytes aren't UTF-8 |
| `random` | `integer(range)`, uniform over the ints a range with both ends reaches, its step included (`random.integer(1..=6)`, `random.integer(0..100 by 5)`), which panics on an empty or open one; `fraction()`, a float uniform from 0 up to 1, written over `integer`; and `uuid()`, a version 4 UUID (RFC 9562) in lowercase. The draws come from a secret seed and a count kept in the snapshot, so a segment that runs again draws the same values (§5), and they are unpredictable enough to serve as tokens. A spawned instance's seed is drawn from its parent's (§9) |
| `log` | `debug`, `info`, `warn` and `error`, each taking a message and optionally `fields` of any `Encodable` type, as in `log.info("charged", struct{amount, card})`, all through one extern, `write(level: Level, message: String, fields: json.Json)`, so mocking `write` captures every log (§10). A record, holding its level, message, fields, instance and its segment's start time, reaches the host when its segment commits (§9); a segment that is discarded logged nothing |
| `runtime` | `id()`, the instance's name as its host gave it (§9); `version()`, the content hash of the program it runs, which is fixed for its life (§5); `commit()`, an already-resolved future: `await runtime.commit()` commits without waiting; and `isolate(f)`, which runs `f`, a sendable function taking nothing, as an instance of its own and gives a `Future<Result<T>>`: `f`'s result, or its panic as an `Err` (§9) |
| `inbox` | `Inbox<T>`, a FIFO message queue built on slots, with `send`, `sendRevertible`, `receive` and `pending`, and `Revertible<T>`, the holder of a revertible message (§6) |
| `collections` | `WeakMap<K is Disposable, V>`, a shared struct keeping an entry only while its key is alive, with `WeakMap.create<K, V>()`, `get(k) -> V?`, `set(k, v)`, `has(k)`, `includes(k)`, the same test, which `in` calls, and `delete(k)` (whether it held `k`). It is built on `WeakRef` and `disposed()`: each entry holds a future that waits for its key's `disposed()` and then deletes the entry, so the entry and its value are released when that future resumes, after the segment that disposed the key. Like JavaScript's, it can't be listed or counted |
| `futures` | Combinators written in the language over one runtime primitive, `first<T>(fs: Array<Future<T>>) -> Future<(Int, T)>`, which races a list of futures: it resolves with the position and value of the first to resolve, the lowest position among futures that resolved together, panics on an empty list, and disposes none of them. A failure is a `Result`, so the combinators that stop early read `Ok` and `Err`: `all(fs)` gives every `Ok` value in position order, or the first `Err` as soon as it arrives (`Result<Array<T>, E>`); `allSettled(fs)` every value in position order, once all resolved; `race(fs)` the first value, and panics on an empty list; `any(fs)` the first `Ok`, or every error in position order once all failed (`Result<T, Array<E>>`); `quorum(n, fs)` the first `n` `Ok` values in the order they arrived, or the errors once `n` can't be reached (`Result<Array<T>, Array<E>>`), and panics unless `0 <= n <= fs.length()`; `timeout(f, d)` the value, or `none` if `d` passes first (`T?`); `retry(attempt, times = 3, backoff = 1s)` calls `attempt`, a plain or `async` function returning a `Result`, up to `times` times, waiting `backoff` before the first retry and twice as long before each next one, and gives the first `Ok` or the last `Err`; it panics when `times < 1`. Like `first`, none disposes a future it is given: it lets go of them when it returns, so a loser nothing else holds, such as one created in the call's own statement, is disposed once that statement has ended and the combinator returned, while one held in a variable lives on (§7) |
| `rpc` | `create<P, R>()` makes a `Method<P, R>`. `m.call(msg)` returns a `Future<Result<R>>`: the reply, or an `Err` with code `unanswered` when the call is let go without one, because the server handling it is disposed or the method dies with the call still queued. A call is sent revertibly and held while its caller waits, so one whose caller lets go of it before a server takes it, such as a loser of a `select` (§8), is withdrawn; waiting callers don't keep the method alive. `m.onMessage(handler)`, for a plain or `async` handler from `P` to `R`, serves calls one at a time in the order they arrived, the handler's return value being the reply, until the future it returns is disposed. Several servers of one method share its calls, each call going to one of them. Calls queue in an inbox, and each reply travels in a one-shot slot. |
| `fanout` | `create<M>()` makes a `Bus<M>`, disposable like an inbox. `bus.subscribe(handler)`, for a plain or `async` handler of `M`, returns a `Future<Unit>` that runs the handler for each message sent after the call, in the order they were sent, one at a time, until it is disposed, or until the bus is disposed and it has handled every message sent before; a subscription doesn't keep the bus alive. `bus.send(msg)` delivers a message to every subscriber, and `bus.sendRevertible(msg)` returns a `Revertible<M>` (§6) whose release retracts the message from every subscriber that hasn't read it yet. Messages form one stream of slots that every subscriber reads. |
| `testing` | Test modules only (§10): the `Suite` annotation and `Test`; `mock` and `Mock<F>`; `spawnCrashingEveryAwait`, an `Instance`'s inspection (`idle`, `reaches`, `waitingAt`, `state`) and `InstanceState`; `handle<T>()`; and the test library: `test`, `group`, `skip`, `only`, `Setup`, `setups`, `FakeClock`, `FakeQueue`, `assert`, `assertEq` and `expectPanic` |

```python
# from the time module
struct Duration:
    value: Int              # milliseconds

struct Time:
    value: Int              # milliseconds since the Unix epoch

fn add(left: Time, right: Duration) -> Time:     # Time + Duration
    Time{value: left.value + right.value}
```

- **`String`** is a sequence of Unicode code points, as in Python. `s.length()`, `s[i]` (a one-code-point string that panics out of range), `s.at(i)` (a `String?`, counting a negative index from the end), slicing and `for ch in s` all count code points, so a single emoji code point is never split. Some emoji are several code points; `strings.graphemes(s)` splits a string into user-perceived characters.
- **`Array<T>`** is an ordered, growable sequence indexed from 0, like a JavaScript array, with JavaScript's method names: `length()`, `push(x)`, `pop()` (a `T?`), `at(i)`, `slice(start = 0, end = none)`, `indexOf(x)` (`-1` when absent), `includes(x)`, `lastIndexOf(x)`, `reverse()` (in place), `flat()` on an `Array<Array<T>>`, and `join(separator)` on an `Array<String>`. Methods taking a function are `map`, `filter`, `flatMap`, `find` and `findLast` (a `T?`), `findIndex` and `findLastIndex` (`-1` when absent), `some`, `every`, `reduce(f, initial)`, and `sort()` on a `Comparable` `T` or `sort(order: fn(T, T) -> Int)`, which sort in place and keep equal elements in order. Since `for` iterates, a spread concatenates and assigning to a range splices, arrays have no `forEach`, `concat` or `splice`. `xs[i]` panics unless `0 <= i < xs.length()`; `xs.at(i)` returns `T?` and, as in JavaScript, accepts negative indexes counted from the end. Indexing with a range slices it (§3.9); `xs.slice(start, end)` is the clamping, JavaScript-style variant.
- **`Map<K, V>`** maps keys to values and compares keys with the built-in `==`, so a key holding a NaN can be stored but is never found again. `m[k]` panics on a missing key; `m.get(k)` returns `V?`. Its methods are `size()`, `get(k)`, `has(k)` and `includes(k)`, the same test, which `in` calls (§3.9), `delete(k)` (whether it held `k`), `keys()`, `values()` and `entries()`, and `Map.groupBy(items, key: fn(T) -> K) -> Map<K, Array<T>>` groups an array's items by key, keeping their order. The order in which a map stores and iterates its entries is unspecified, so implementations are free to use hashing or sorting, and two maps are `==` when they hold equal values for equal keys, whatever their order.
- **`Range`** is a plain, sendable struct with an optional `start` and `end` and a `step` (1 unless `by` gives one), built by `..` (and by `..=`, which stores the end one past the written one in the step's direction, so a range is always half-open). It reaches its start and every step from it before its end, the step's sign giving the direction, as Python's `range` does: a range whose end lies the other way reaches nothing, so iterating `5..2` gives nothing and `10..=0 by -2` gives 10, 8, 6, 4, 2 and 0. A step of 0 would reach its start forever, so using such a range panics. It is `Iterable<Int>` when both ends are given, and iterating a range without an end panics, since whether it has one is known only when it runs. `x in r` is whether `r` reaches `x`, an open end reaching without bound; with an open start, only a step of 1 or -1 has a meaning, and any other panics.
- **`Array<T>`**, **`Map<K, V>`** and **`T?`** satisfy `Default`: `Array.default()` and `Map.default()` are empty, and `Optional.default()` is `none`.
- An `extern struct` is not sendable unless it says `sendable`.
- A sendable generic struct is sendable only when its type arguments are sendable: `Array<Int>` is sendable, `Array<Future<Int>>` is not.
- Primitives are always sendable. `Time` and `Duration` are plain structs of `Int`, so they are sendable by derivation.
- Methods on primitives are ordinary functions whose `self` is a primitive, such as `"abc".indexOf("b")` or `2.toString()`.
- **`Shared<T>`** is a shared struct of one mutable value in the instance's own memory (§3.18), created with `new Shared{value: v}`. Copying a `Shared` copies the handle, so every copy sees the same value, which `x->value` reads and writes (§3.9). It is not sendable, and it lives as long as it is reachable (§5).
- **`WeakRef<T>`** refers to a disposable value without holding it (§7).

### 3.9 Operator overloading

An operator is sugar for a named function: `a + b` calls `add(a, b)`. On concrete types, the call is resolved by the same overload rules as any other function (§3.7), so mixed types work, as in `add(left: Time, right: Duration) -> Time`. Generic code can use an operator when a constraint on the type provides its function, whether through `Addable` or any other trait that requires `add` (§3.10). On primitives, the operators are built in.

| Operator | Function | Trait |
| --- | --- | --- |
| `a + b` | `add` | `Addable` |
| `a - b` | `subtract` | `Subtractable` |
| `a * b` | `multiply` | `Multipliable` |
| `a / b` | `divide` | `Divisible` |
| `a // b`, `a % b` | `floorDivide`, `remainder` | `FloorDivisible` |
| `-a` | `negate` | `Negatable` |
| `a ** b` | `power` | `Powerable` |
| `a & b`, `a \| b`, `a ^ b`, `~a` | `bitAnd`, `bitOr`, `bitXor`, `bitNot` | `Bitwise` |
| `a << n`, `a >> n` | `shiftLeft`, `shiftRight` | `Shiftable` |
| `<`, `<=`, `>`, `>=` | `compare` | `Comparable` |
| `x[k]` | `index` | `Indexable` |
| `x[k] = v` | `setIndex` | `IndexAssignable` |
| `for x in c` | `iterate` | `Iterable` |
| `x in c`, `x not in c` | `includes(c, x)` | `Container` |
| `T(x)` | `T.from` | `Convertible` |

**Shared structs.** `*x` is the value behind the shared struct `x` (§3.18), the shape of its fields (§3.1), so it fits wherever that shape is expected, and `*x = v` writes it, for every copy of the handle, from any value of the shape. `x->f` is `(*x).f`: a field of that value, read or written, as in C. Writing a part (`x->name = "Y"`, `x->count += 1`) changes it in the value as it is when the write happens: the value is read, the part stored into it and the value written back, all at once. So whatever changed another part meanwhile stays changed, such as a call on the right of `x->count += f()` writing `x->label`, and `x->count += v` writes exactly what `x->count = x->count + v` writes. An element written through its container works the same way (§3.7). `x?->f` reads through an optional shared struct, as `?.` does (§4). Both are built in and work only on shared structs, so they call no function and can't be overloaded. A `const` shared struct stays writable, since writing through it changes what is behind the handle, not the handle.

```python statements
const u = new Account{name: "Ares", email: "a@x"}   # a shared struct (§3.18)
u->name = "Ares K"          # writes through: every alias sees it
const snapshot = *u         # a plain copy of the fields
const alias = u             # the same handle; alias == u
accounts[0]->name = "Y"     # -> works on any expression
const next = head->next?->value   # Int?: none when head->next is none
```

All four comparisons go through a single `compare(left, right) -> Int` (negative, zero or positive), so they can never contradict each other.

**Chains.** Comparisons in a row chain as in Python: `a < b <= c` is `a < b and b <= c`, and any mix of `<`, `<=`, `>`, `>=`, `==`, `!=`, `in` and `not in` chains the same way, each operand compared with the next, so `0 < x in xs` is `0 < x and x in xs`. Every operand is evaluated at most once, in order, and evaluation stops at the first comparison that fails. An operand between two comparisons is compared on both sides, so it is never converted into a union for one of them. A misreading of `x < y == flag` as `(x < y) == flag` fails to check, since it compares `y` with a `Bool`; parenthesize to mean that. `is` doesn't chain, since a pattern follows it.

**Membership.** `x in c` calls `includes(c, x)`, and `x not in c` is `not (x in c)`. An `Array` includes its elements, compared by `==`; a `Map` its keys, as `has` says; a `String` its substrings; and a `Range` the ints it reaches (§3.8).

```python
fn add(left: Duration, right: Duration) -> Duration:
    Duration{value: left.value + right.value}

fn multiply(left: Duration, factor: Int) -> Duration:
    Duration{value: left.value * factor}
```

- **Fixed syntax.** Precedence and associativity are fixed by the language (table below). Overloads can't change them, and no new operator symbols can be defined, so parsing never depends on types.
- **Indexing by key.** A struct is indexed by its keys (§3.1), built in like `->` and before any `index`: `s[k]` with `k` within `keyof S` reads the field `k` names when the program runs, typed `S[K]`. Where `S` declares no `index` of its own the brackets expect a key, so `s["region"]` is one; where it does, `s["region"]` calls it, and a value whose type is a key reads the field. A key that is one name, a literal or a member type parameter `K in keyof S` (§3.5), names one field, a place as `s.name` is (§3.7): read, written, passed by `&` and the receiver of a method taking `&self`, with nothing copied in or out. Through a key that may name several fields, `s[k] = v` needs `v` to fit every field it may name, each through its own conversion, and a compound assignment reads first, so `s[k] += 1` needs `S[K]` to allow `+`: it does when every field is an `Int`, not for `Int | String`. Neither `&s[k]` nor a method taking `&self` takes one, since the callee could write another field's type. A key's value is a tag of the union of its literals, and each struct type has a static table from that tag to its field's position, so nothing is looked up by name.
- **Indexing.** `x[k]` calls `index(x, k)`, and `x[k] = v` calls `setIndex(&x, k, v)`, so assigning through an index needs a `let` binding. `x[k] += 1` is sugar for `x[k] = x[k] + 1`. An element is a place like a field (§3.7): `a[i].b = v`, `a[i][j] = v` and `&m[k]` read it with `index` and write it back with `setIndex`. `index` is the panicking form; a type can offer a separate safe `get(k)` that returns an optional, as `Array` and `Map` do. A `String` has no `setIndex`, so `s[i] = x` is a compile error. An element is read with `index` and written back with `setIndex` around the change made to it, and a map literal is built by `default` and `setIndex` before it has a value, so none of them may be `async`.
- **Slicing** is indexing with a `Range`, through ordinary `index` and `setIndex` overloads. `a[3..5]` returns a copy, so changing it never affects `a`. `a[3..5] = xs` replaces that span of `a` in place, even with a different length. A range's open start means 0 and its open end the length, so `a[..]` copies `a`; a range outside the bounds, or ending before it starts, panics, and `a.slice(start, end)` clamps instead. Strings slice the same way: `s[1..3]`. A stepped range selects every step-th item, as Python's extended slices do: `a[.. by 2]` gives the items at even positions, and a negative step runs backward, its open ends defaulting to the last item and to before the first, so `a[.. by -1]` is `a` reversed. Writing a stepped slice replaces each item it selects, so it needs exactly as many, and panics otherwise.
- **Equality is built in.** `==` and `!=` work on every type and can't be overloaded: values compare structurally, handles by identity (§3.1), and a union's values by their members' types, then the values, as `any` values do (§3.10). This keeps `Map` keys consistent, a union's too. They take two values when either fits the other's type, so `s == name` compares a `Status` with a `String`, or two literals of one base, a constant comparison, so a field loop's key compares with any field's name (§4).
- **Floor division and remainder share a trait,** because they are defined together: `a == (a // b) * b + a % b` always holds. A type can thus offer exact division, floor division, or both.
- **Powers.** `**` groups to the right, `2 ** 3 ** 2` being `2 ** 9`, and binds tighter than a prefix operator on its right, so `2 ** -1` reads as written. A prefix operator directly on its left (`-x ** 2`) is a syntax error, since languages disagree on whether the sign applies first: write `(-x) ** 2` or `-(x ** 2)`. An `Int` to an `Int` power is an exact `Int`, which a negative exponent can't be, so it panics; any `Float` operand makes a `Float`. `Powerable<E = Self, T = Self>` lets the exponent have a type of its own, as a `Decimal`'s `Int` does.
- **Bitwise operators** work on `Int` only, as on a two's complement of unbounded width, as in Python: `~x` is `-x - 1`, and `>>` rounds toward negative infinity, so `-9 >> 1` is `-5`. A negative shift count panics. A type of a program's own takes `&`, `|`, `^` and `~` through `Bitwise`, and the shifts through `Shiftable`, which a set of flags has no use for.
- **Not overloadable:** `and`, `or` and `not` (they short-circuit, and a function call would evaluate both sides), `=`, `.`, `->`, prefix `*` and `&`. `await` and `select` aren't overloaded either; they work on futures (§6).
- **Compound assignment.** `x += y` is sugar for `x = x + y`.
- **No implicit conversions.** Mixed-type operators work only through overloads, for primitives as for a program's own types. The prelude declares them for `Int` and `Float`, such as `add(Int, Float) -> Float`, and `Decimal` declares its own beside it for `Int` only: mixing it with `Float` would bring back the rounding it exists to avoid. Any `Stringable` value appends to a string, on either side, through `add<T is Stringable>(left: String, right: T)` and its mirror, so `"Total: " + count` and `count + " items"` just work. Anything else converts explicitly with `T(x)` (§3.10).

| Precedence, tightest first | Operators |
| --- | --- |
| 1 | postfix: calls, indexing, `.`, `?.`, `->`, `?->`, the error-propagating `?`, the unwrapping `!` |
| 2 | `**`, grouping to the right |
| 3 | prefix: `await`, unary `-`, `~`, `*`, `&` |
| 4 | `*`, `/`, `//`, `%` |
| 5 | `+`, `-` |
| 6 | `<<`, `>>` |
| 7 | `&` |
| 8 | `^` |
| 9 | `\|` |
| 10 | `..`, `..=`, and `by` |
| 11 | `<`, `<=`, `>`, `>=`, `==`, `!=`, `in`, `not in`, which chain; `is` |
| 12 | `not` |
| 13 | `and` |
| 14 | `or` |
| 15 | `??`, which can't be mixed with `and` or `or` without parentheses |

Binary operators on the same level associate to the left, but for `**`, and comparisons, which chain.

### 3.10 Traits

A trait is a named set of functions, and optionally fields, that a type must have. A trait constrains a type parameter (`T is Addable`), and after `any` it types a value of any type meeting it (`any Notifier`, below).

```python
trait Addable<T = Self>:
    fn add(left: T, right: T) -> T

trait Comparable<T = Self>:
    fn compare(left: T, right: T) -> Int

trait Monoid:
    fn Self.zero() -> Self
    fn add(left: Self, right: Self) -> Self

fn sum<T is Monoid>(xs: Array<T>) -> T:
    let total = T.zero()
    for x in xs:
        total = total + x
    total

fn maxSendable<T is Sendable & Comparable>(xs: Array<T>) -> T?:
    ...
```

- **Members** are a list, as a struct's fields are (§2): one per line in the trait's body, or separated by `,`, on one line of it or in braces: `trait Shape { fn area(self: Self) -> Float, type Unit }`. Nothing evaluates them in order.
- **`Self` and defaults.** `Self` is the constrained type: in `T is Addable`, `Self` is `T`. Trait type parameters may have defaults, so `T is Addable` means `T is Addable<T>`. A trait may take several type parameters, such as `trait Convertible<To, From = Self>`.
- **Several traits.** `T is X & Y` requires both. In this position `&` joins traits; it never means a reference.
- **Structural conformance.** A type satisfies a trait when functions with the required signatures exist for it. There are no `impl` blocks. The required functions must be declared beside the types they take or beside the trait: in the module declaring one of those types (the prelude, for a primitive), for a static function also its own type's, or in the trait's own module. Only the types themselves count, not their type arguments, as in argument-dependent lookup (§3.13). So a module declaring a trait can declare its functions for types it doesn't own, such as primitives, and no caller has to import them.
- **Coherence.** Where a type meets a constraint, such as a generic call, never decides how: the functions found are the same in every module, and they are the ones every instantiation calls. Two modules therefore can't disagree about one value, as when one sorts an array that another searches, or one writes a value that another parses back. A module owning neither the type nor the trait can't make the one meet the other; it passes a function value instead (§3.14). A function's parameters must take the type as it is: one taking it only as a union's member, such as `fn add<T>(left: T?, right: T?) -> T`, is a function for `T?`, not for `T`. A shape (§3.1) has no module, so it meets a trait through functions declared in the trait's module, or in the module of another type they take; `Sendable`, `Encodable` and `Decodable` are derived for it as for any struct. An associated type is declared only by its type (§3.1), so it is the same in every module.
- **Unions.** A union (§2) has no module either. It meets a trait through functions declared for it, found as a shape's are, as `Optional.default` makes every `T?` `Default` (§3.8); or when each member meets the trait, a recursive union assuming itself meets it while its members are checked, and the trait could follow `any` (object safety, below), which a static requirement such as `T.zero()`, having no value to dispatch on, rules out, and which never makes it `Encodable` or `Decodable` (§9). A call on a union that no function takes whole, such as `x.toString()` or `${x}`, calls the requirement of that name in a trait the union meets, among the traits visible at the call: declared there, imported, or the prelude's. It runs the member's own function, so `x.toString()` works on an `Int | Email` when both are `Stringable`, and `x` passes where `T is Stringable` or `any Stringable` is expected. Nothing at such a call names the trait's type arguments: one with a default takes it, and one without is inferred from the call's arguments, or from the type it is expected to give, as a function's own are (§3.5), so `e.apply(&settings)` on a union of `Entry` structs meeting `Applies<Settings>` (§3.1, Key types) calls through `Applies<Settings>`; a member that doesn't meet the trait with them is a compile error. Finding no such trait, or several, is a compile error.
- **Fields.** A trait may require fields, written like struct fields: `value: Int`. A struct satisfies one with a field of the same name and type. Generic code reads a field its type parameter's trait requires but can't change it, since the parameter may be an `any` type, through which only the value's own type has the field. A struct constraint (§3.5) states a struct's own fields instead, which generic code may also write.
- **Associated types.** A trait may require an associated type, `type Key`, maybe with a bound: `type Key is Stringable & Encodable`. A type meets it with an associated type of that name (§3.1) meeting the bound. Meeting a function requirement, `Self.Name` is the type's own: `fn validate<T>(self: Field<T>, data: T)` meets `fn validate(self: Self, data: Self.Data)`, since `Field<T>.Data` is `T`. `T.Data` is one type: where several traits of `T` require `Data`, it meets each one's bound. A union or an `any` type has none (§3.1), so neither meets a trait requiring one where a type must, as a type argument does; a call through such a trait on a union's value still runs its member's function, each member meeting the trait with its own (Unions, above).
- **Static functions.** A trait may require a static function, declared on `Self`, such as `fn Self.zero() -> Self`. Generic code calls it through the type parameter: `T.zero()` (§3.7).
- **Generic requirements.** A required function may have type parameters of its own, such as `fn map<U>(self: Self, f: fn(T) -> U) -> Array<U>`. A function satisfies it when it is generic in the same way, up to the names of its type parameters.
- **Calls through a requirement.** A call through a constraint or an `any` value binds its arguments against the required function's own parameters (§3.3): names are its parameters', and its rest parameter reaches the function meeting it as one array. A required function has no defaults, since each type meeting the trait could give another; the function meeting it may have more parameters, each with a default, which it computes when called through the trait.

**Trait objects.** `any A & B` is the type of a value of any type meeting each of its traits; `any T?` is `(any T)?`. It is how values of different types share a collection, a field or a parameter:

```python fragment
trait Notifier:
    fn send(self: Self, text: String)

const notifiers: Array<any Notifier> = [Email{to: "cfo"}, Sms{number: "555"}]
for notifier in notifiers:
    notifier.send("approved")
```

- **Conversion.** A value converts into an `any` type wherever one is expected and its type meets every trait, as a value converts into a union (§2); an `any` type converts into another whose traits are among its own. The traits are a set: their order doesn't matter, and naming one twice is an error.
- **Calls.** A function a trait requires is called on an `any` value like any other, `notifier.send(text)`, and runs the one the value's own type meets the trait with. An `any` type meets its own traits, so its values pass where `T is Notifier` is expected, and `String(x)` takes an `any Stringable`. A field a trait requires is read the same way and can't be written through the `any` value; a method taking `&self` changes the value inside it.
- **Object safety.** A trait can follow `any` only when each function it requires takes `Self` first, as its receiver, by value or `&`, and nowhere else, and none is static; and no field it requires is built from `Self`. An associated type of `Self`, `Self.Data`, counts as `Self`. So `any Stringable` and `any Iterable<Int>` are types, but `any Comparable`, whose `compare` takes a second `Self`, and `any Default`, whose `default` is static, are errors.
- **Values.** `==` compares the values' types, then the values, so an `any` value can be a map key. An `any` type is sendable only when one of its traits is `Sendable`, or `Encodable` or `Decodable`, which imply it, as in `any Notifier & Sendable`, and a value converted into one must be sendable. JSON derives no form for an `any` type and decodes nothing into one; `any Encodable` writes the JSON of the value inside.
- **Matching.** A pattern naming a type matches an `any` value holding one, primitives included: a bare type name (`case Int as n`, `case Email as e`, §3.11), a struct pattern (`case Email{to}`), or a variant qualified by its enum (`case Decision.Approved{by}`). An alias names the type it stands for. The rest of the pattern then matches the value inside, and `as` binds that value with its own type. A pattern gives no type arguments, so it can't name a generic type, and it can't name a type that doesn't meet the traits. The types an `any` type holds are an open set, so a `match` on one ends with `case _`.
- **Running.** A value keeps its own type inside an `any` value, in snapshots and messages too, so the interpreter knows the type at every call through a trait. Which types an `any` type holds is decided over the whole program; an `any` value has no JSON form, so it reaches only instances of the same program, whose code is fixed for their whole lifetime (§5).

**Built-in traits:**

| Trait | Required | Used by |
| --- | --- | --- |
| `Sendable` | nothing: a marker, derived for user structs (§3.1) | `spawn` arguments; whatever crosses to the host, through `Encodable` and `Decodable` |
| `Disposable` | `dispose`, synchronous; only shared structs (§3.18) and extern types (§7) | values the runtime disposes when their last holder ends (§7) |
| `Iterable<T, C = Self>` | `iterate`, returning a cursor, `fn() -> Step<T>` | `for x in c`, comprehensions and spreads |
| `Indexable<K, V, C = Self>` | `index(self, key) -> V` | `x[k]` |
| `IndexAssignable<K, V, C = Self>` | `setIndex(self: &C, key, value)` | `x[k] = v` |
| `Convertible<From, T = Self>` | `fn Self.from(value: From) -> Self` | `T(x)` |
| `Default` | `fn Self.default() -> Self` | map literals for other types (§2); what a `@JsonSkip` field reads back as (§9) |
| `Stringable` | `toString(self) -> String` | `String(x)`; appending to a string with `+` (§3.9); map keys in JSON, and `json.encodeText` (§9) |
| `Parsable` | `fn Self.parse(text: String) -> Result<Self>` | reading map keys from JSON, and `json.decodeText` (§9) |
| `Encodable`, `Decodable` | `toJson(self) -> json.Json`, and `fn Self.fromJson(json: json.Json, path: String) -> Result<Self>`, the codecs that write and read a type as JSON (§9); each implies `Sendable`, since a value written as JSON and read back is a copy, as sending makes one. Declared in the `json` module, so code naming them imports them; derived for a struct, an enum, a tuple, a literal type, a union of literals or a host type declaring neither function | extern parameters, and extern results and constants (§3.6); `json` |
| `Container<T, C = Self>` | `includes(self: C, item: T) -> Bool` | `x in c`, `x not in c` (§3.9) |
| `Addable`, `Subtractable`, `Multipliable`, `Divisible`, `FloorDivisible`, `Negatable`, `Powerable`, `Bitwise`, `Shiftable`, `Comparable` | the functions in §3.9 | operators in generic code |

**Iterable.** `for x in c` calls `iterate(c)` once, for a cursor: a function that gives a `Step<T>` each time it is called, `Next{(item)}` holding the next item, or `Done` once there are no more; the prelude declares `enum Step<T> { Next { value: T }, Done }`. A cursor gives a `Step` rather than a `T?` because an item may itself be `none` and `T??` is `T?` (§2): a `for` over an `Array<Int?>` holding `[1, none, 3]` runs three times. The loop calls the cursor until it gives `Done`, so any type can support `for` by declaring `iterate`, and a cursor that never gives `Done` runs for as long as the loop does. A cursor holds what it runs over as `iterate` was given it, a copy (§3.1), so changing `c` inside the loop doesn't affect the iteration. It is a plain function value (§3.14), kept in snapshots like any other, so a loop that waits mid-way keeps only the cursor's own state: a range's few ints, never its items. `Array<T>` is iterable as it is, `Map<K, V>` is `Iterable<(K, V)>` (so `for key, value in m:` works directly), a `String` gives its characters, and a `Range` with both ends is `Iterable<Int>` (so `for i in 0..10:` works). A type's `iterate` can hand over another's cursor, such as `self.items.iterate()`. `Array` and `Map` also satisfy `Indexable` and `IndexAssignable`: `Array<T>` with `Int` keys (and `Range` keys for slicing), `Map<K, V>` with `K`.

**Conversions.** `T(x)`, a type applied to one argument in parentheses, converts `x` to `T`. It is sugar for the static function `T.from(x)` that `Convertible<From, T = Self>` requires. It never clashes with construction, which uses braces. Only conversions that can't fail are written this way: `Float(3)`, `Int(3.7)` (which truncates toward zero) and `String(42)`. `String(x)` converts any `Stringable` value through its `toString`, the one place a type says how it is written. A float that is no number, NaN or an infinity, has no int, so `Int(x)` of one is a bug and panics (§3.12). Fallible ones are ordinary functions returning `Result`, such as `Int.parse("42")`, the `Parsable` requirement.

### 3.11 Enums

An enum is a type whose value is exactly one of several named variants, each with its own fields. Enums are values like structs: they are copied, they are sendable when all their fields are, and `match` handles them exhaustively.

```python fragment
enum Decision:
    Approved { by: String }
    Rejected { by: String, reason: String }
    Expired

const text: String = match decision:
    case Approved{by}:
        "approved by " + by
    case Rejected{by, reason}:
        by + " rejected: " + reason
    case Expired:
        "expired"
```

- **Construction.** Variants are declared with a field list, as in `Rejected { by: String, reason: String }`, and built like structs: `Rejected{by: "legal", reason: "missing contract"}`, or as an indented value below `Rejected:` (§2). A variant without fields is written bare: `Expired`. A variant with exactly one field may take its value without the field's name, under the same rule as structs (§3.1): `Ok{42}` and `Ok{(receipt)}` are positional, while `Ok{value}` means the field `value`. Like a struct, an enum may be declared on one line: `enum Color { Red, Green, Blue }`.
- **Qualified names.** Where an enum type is expected (in a `match`, an annotated variable, an argument, a field or a `return`), bare variant names are enough, and so are those of a union's enum members where the union is; a name that variants of two members share, or a variant and a type share, is qualified there: `case Decision.Approved`. Elsewhere they are qualified: `Decision.Expired`. A bare variant with no enum type expected is a compile error.
- **Generics and defaults.** Enums and structs take type parameters like functions, and may give them defaults (§3.5): `enum Result<T, E = Error>`.
- **Exhaustive `match`.** A `match` on an enum must cover every variant or end with `case _:`.
- **Optionals** are no enum: `T?` is `T | None` (§2), taken apart as any union is (below), with `case None:` and then `case v:`, which binds the `T`, or with a pattern on the `T` itself, as `case Int as v` or `case Verdict{ok == false}`. `?.`, `??` and `!` (§4) are sugar over `match`.

**Patterns** mirror construction. Inside a pattern's braces, each item is one of:

- **`field`** binds the field to a variable of the same name: `case Approved{by}`.
- **`field as name`** binds it under another name: `case Rejected{reason as why}`. Only a variable name may follow `as`.
- **`field == expr`**, or any other comparison, tests it: `case Verdict{ok == false}`, `case Order{amount > 1000}`.
- **`field is Pattern`** matches the field against a nested pattern: `case Review{verdict is Verdict{ok == false} as v}`. Only a pattern may follow `is`.
- **`...name`**, the last item, binds a struct of the fields no other item names, a copy: `case Page{title == "", ...rest}`. Its type is the mapped struct type `{ [F in K]: S[F] }` (§3.1), `K` being the keys of the matched struct `S` but those the pattern names: for a struct whose fields are known, the shape of those fields, and for a type parameter with a struct constraint (§3.5) an opaque struct meeting that constraint without the entries the pattern names, such as `struct { [_] is C }`, whose fields field loops, struct comprehensions and keys reach (§3.1, §4). A rest can't fail. A variant is no struct, so its pattern takes no rest; `..._` takes none.

A struct pattern on a type parameter with a struct constraint takes the fields its constraint names, as reading them does (§3.5): `const struct{title, ...rest} = form`.

A pattern can also be a literal (`case 0:`, `case "cfo":`), a tuple of patterns (`case (a, _):`), `_`, or a bare name. A camelCase bare name binds a new variable, as `a` does in `case (a, _):`, while a PascalCase one refers to a variant, a struct without fields or a type, as in `case Expired:`, `case Marker:` or `case Int:`; a qualified name (`case Decision.Expired:`, `case limits.max:`) always refers. A constant, being camelCase, is therefore compared through a qualified name or a guard (`case n if n == limit:`). There is no positional binding in struct patterns, not even for a type with a single field: a bare name always binds the field of that name, and `as` renames it, as in `case Ok{value as receipt}`. An anonymous struct is matched with `case struct{…}`, or through an alias naming its shape (§3.17), `case Point{x, y}`; against an `any` value, such a pattern matches a value whose own type is that shape, while a struct declaration's value inside keeps its own type, so it doesn't match.

- **Literals** are compared with `==`. On a union, a literal selects a member first (below), so `case 1:` matches against an `Int?`; against an `any` value that takes its type, it matches the value of that type inside equal to it. `as` after one binds its literal type: `case "draft" as d` gives `d` the type `"draft"`. `none` is `None`'s value, and a negative number is written `-1`. A literal the subject's type can't hold never matches (ruled-out cases, below).
- **Alternatives.** `A | B` matches what either matches, anywhere a pattern stands: `case 1 | 2:`, `case (0, x) | (x, 0):`, `x is Circle{radius as n} | Square{side as n}`. Every alternative binds the same names, of the same types, and the first alternative that matches gives their values. `A | B as x` binds the whole value, as `(A | B) as x`; on a union, as the union of the members the alternatives select: `case Int | String as v`; on an `any` value, as the union of the types they match inside it.
- **Arrays.** `[a, b]` matches an `Array` of exactly two items, and a rest takes any number between the items before and after it: `[first, ...rest]`, `[first, ...middle, last]`, `[..._, last]`. `...rest` binds a new array of those items, and `..._` binds nothing. A pattern has one rest at most.
- **Ranges.** `1..=5`, `0..10`, `..0` and `90..` match an `Int` between their bounds, which are int literals, a negative one included: `..` leaves its end out and `..=` takes it in, and either end may be left open. A range that holds no int, such as `5..1`, is an error.
- **Patterns that can fail:** an alternative, an array pattern, a range, a literal, a comparison, a referring name, an enum variant, a type pattern against an `any` value (§3.10), and a pattern selecting among a union's members (below). A declaration's or loop's target (§3.15) must always match, so it can hold none of them; they belong in `match` and `is`.
- **Referring names** name a variant, a type, or a top-level constant through a qualified name. A variant with fields is written with braces, as when it is built; a constant is compared with `==`.
- **Type patterns.** A bare type name tests a value's type, and `as` binds the value with that type: `case Int as n`, `x is String as s`. Against an `any` value it matches the values of that type inside (§3.10), so, giving no type arguments, it names no generic one, and a type not meeting the `any` type's traits is never inside: the pattern is ruled out (below). Against a union it selects members (below). Against any other value it names that value's own type, a generic one by its bare name whatever its type arguments (`case Box` against a `Box<Int>`), and matches every value of it, as `_` does, so it covers the type for exhaustiveness; another type, or a variant of another enum, is ruled out. A struct without fields is such a pattern, its one value matched by its name. An alias names the type it stands for, before braces too (`case Mail{to}`); a generic alias stands for no one type, and `Never`, which no value has, names none. An `any` value's own type is never an `any` type, so an alias of one names only the subject's own type. A variant isn't a type, so one with fields is still written with braces.
- **Ruled-out cases.** A pattern its subject's type can't hold never matches: a literal outside the subject's literal types or base (`case "c"` against `"a" | "b"` or an `Int`), `none` where no value of the type is `none`, a type or struct pattern naming another type, or a variant of another enum, against a value whose type is known where the pattern is checked (not a type parameter's, §3.5), a type an `any` value never holds (§3.10), a field compared by `==` or `!=` with what its type fixes to fail, and, on a union, a pattern selecting no member (below). Such a case is warned of once, its guard and body are neither checked nor run, and it covers nothing for exhaustiveness; an or-pattern leaves out an alternative so ruled out, and `x is` such a pattern is always false (§4). A field loop's pass gives its value one field's type (§4), so `match v: case Int as n: … case String as s: …` runs each field's own case, and a case is warned of only when every pass rules it out.

```python
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

- **`as`** binds the whole matched part with its own type. Variants aren't types, so in `case Approved{by} as d`, `d` is a `Decision`.
- **On a union,** a pattern selects the members it can match, then matches the rest of itself against the selected member's value: a type pattern its type's member, a union's alias every member of it, a generic type's by its bare name the members instantiating it, and a literal's base type every literal member of that base, so against `Status | Int`, both `case Status as s` and `case String as s` bind `s: Status`; a literal its own literal member, else its base type's; `none` the `None` member; a type pattern, a struct pattern naming a type, or a literal, whose type or base no member is but an `any` member took whole, that `any` member, matching the values of that type inside it as against an `any` value, so `case Int as n` against `Plain | any Stringable` binds `n: Int`; a variant, bare or qualified (above), the enum member declaring it; a struct pattern the member of the type it names, and `struct{…}` the shape member having its fields; a tuple, array or range pattern the member of its kind. A pattern selecting no member is ruled out (above); one selecting several that takes the value apart is a compile error, such as `case Box{value}` against `Box<Int> | Box<String>`: it names its member through an alias, `case Point as p`, or with type arguments, `case Box<Int>{value}`, which only a pattern on a union may give.
- **Remaining type.** On a union, a case's binder, `case v:` or `as`, has the subject's type without the members that earlier cases without a guard covered: after `case None:`, `case v:` binds the `T` of a `T?`. The subject itself keeps its type.

```python
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

**Exhaustiveness.** A `match` covers its subject's type when every value of it matches a case without a guard. A type is made of its constructors: an enum of its variants, a union of its members, a literal type of its one value, so `Bool` of `true` and `false`, a tuple or a struct of its one shape, field by field, and an `Array` of its lengths, so `[]`, `[x]` and `[x, y, ...rest]` cover every array. An alternative covers what any of its alternatives covers, and a range acts like a guard. `Int`, `Float`, `String` and the other types have no such list, so their literals never cover them; only a pattern taking anything does, or one naming the type. `==` against a literal or an enum variant counts as that pattern, so `next == none` covers a `T?`'s `None` member, while other comparisons, and `==` against a constant, act like guards (§4) and don't count. Nested patterns count by the same rules. A missing case is reported with examples of what isn't handled, and a case no value can reach, given the cases before it, is warned about. After a collapse (§2), the first case that matches wins, as among a pattern's alternatives; a case the collapse leaves unreachable isn't reported, since another instantiation may reach it.

**`is` outside `match`.** `x is Pattern` is a boolean expression. Its bindings exist only where the match is known to have succeeded: in the body of an `if` or `while`, and on the right-hand side of an `and`. `or` can't introduce bindings, because afterwards it isn't known which side matched.

```python statements
if r is Ok{value as y} and y > 0:
    use(y)            # y exists only here
```

### 3.12 Errors

There is no `try`/`catch`. A function that can fail returns a `Result`, from the prelude:

```python fragment
enum Result<T, E = Error>:
    Ok { value: T }
    Err { error: E }

struct Error:
    message: String
    code: String
    trace: String = _trace()   # the frames where the Error is built
```

```python statements
async fn pay(req: PurchaseRequest) -> Future<Result<String>>:
    const receipt = chargeCard(req.id, req.amount)?    # returns early on Err
    Ok{(receipt)}

match await pay(req):
    case Ok{value as receipt}:
        ...
    case Err{error}:
        ...
```

- **`?` propagates.** `expr?` on a `Result` yields the `Ok` value, or returns the `Err` from the enclosing function. That function must itself return a `Result` whose error type the error converts into (§2): in a function returning `Result<T, NotFound | Timeout>`, `?` takes a `Result<U, NotFound>`. With an inferred return type, each `?` acts as a `return` of an `Err`: what the function's other returns and its last expression agree on must be a `Result` whose error type that error converts into. A `?` outside any function, such as in a parameter's default, is an error. `?` doesn't take an optional apart; `??` and `match` do (§4).
- **Traces.** An `Error` literal may leave out `trace`, whose default (§3.1) is the frames where the `Error` is built, innermost first, one line each: `at function (module:line:column)`. A `trace` written in the literal, or carried over by a spread as in `Error{...error, message: "retry failed"}`, is kept.
- **Results must be used** (§7). A `Result` is also handled with `match` or `?`.
- **Results are data.** A `Result` of sendable types is sendable, so a service can reply with one into a `replyTo` inbox.
- **Bugs panic; expected failures return `Result`.** Network, parsing and business failures return `Result`. Programming errors such as an out-of-range index, integer division by zero (`//` or `%`) or a missing map key panic. The safe variants return optionals: `xs.at(i)` returns `T?`, and `m.get(k)` returns `V?`.

**Panic.** `panic(message: String) -> Never` stops the instance at once:

- **Nothing is committed.** The current segment is discarded, so the instance stays at its last snapshot. Effects of `extern fn` calls already made in that segment remain (§5).
- **The instance is frozen,** marked as panicked. Nothing it holds is disposed and no deferred function runs: its revertible messages stay in their inboxes, and the instances it spawned keep running.
- **The panic is recorded** with its message and the trace of the frames it happened in, in the format of `Error`'s `trace`. `ista run` prints both and exits with a non-zero code.
- **An operator decides what happens next.** Through the host, an operator can inspect the instance, retry it from its last snapshot, or terminate it. Terminating disposes everything it holds (§7), and the terminated instance keeps the panic's message and trace. An instance `runtime.isolate` started needs no operator: its panic terminates it at once (§9).
- **A result from the host that doesn't match its declared type** panics the instance at the `extern fn` call, since it's a bug in the host (§9).

### 3.13 Modules

A program is made of modules, one per file; source files use the `.ista` extension. The compiler merges the entry module and everything it imports, directly or transitively, into a single definition. A program's code therefore never changes partially: a deploy always replaces the whole set. Code from other projects comes in as packages (§11).

```python
import approve, Verdict from 'purchase/approve'
import (
    approvePurchaseRequest
    rejectPurchaseRequest
    PurchaseVerdict
    notifyReviewers as notify             # bound as `notify`
) from 'purchase/requests'
import * as runtime from 'runtime'

fn _normalize(id: String) -> String:     # private to this module
    ...
```

- **Exports.** Every top-level declaration is exported, except names starting with `_`, which only a test module (§10) may also name, from the modules it imports. There are no default exports, and imported names are not re-exported.
- **Imports.** `import a, b from 'path'` brings named exports into scope, its names on the import's line. In parentheses, `import (a, b) from 'path'`, they are a list (§2), which may span lines, one name per line with no `,`. In either form `name as alias` binds the export `name` as `alias`, and only the alias is in scope, so one export may be bound under several names. `import * as m from 'path'` binds them under a namespace, used as `m.name`. A name bound twice, or clashing with a local declaration, is a compile error.
- **Paths.** Each path must name exactly one module: a path that names none, or several, is a compile error. Which module a path names is decided by the module loaders of whatever runs the compiler, much as a bundler resolves imports, so a host may use its own paths and its own module store.
- **The toolchain's paths.** The `ista` toolchain resolves a path as names separated by `/`, with the `.ista` extension implied. A path starting with `./` or `../` is relative to the importing file. Any other path names a standard-library module, or a module under the project root: the directory holding `ista.json` (§11), or the directory the toolchain runs in when there is none. A path that matches both a standard-library module and a project file is therefore an error.
- **Project sources.** Without explicit files, `ista check` checks every `.ista` file under the project root, skipping the project's `vendor/` folder (§11), every `node_modules/` folder and hidden directories.
- **Cycles.** Modules contain only declarations, never top-level code, so import cycles are allowed.
- **Argument-dependent lookup.** A function is also found through the modules that declare its arguments' types. `a + b` on two `Duration`s finds `add` in `Duration`'s module without an explicit import. Only the arguments' own types count, not their type arguments, so `Inbox<T>`, a handle the `inbox` module declares (§3.18), finds that module's functions, while an `Array<Duration>` doesn't find `Duration`'s. Only exported functions are found this way, and a call through a namespace (`m.f(x)`) looks only in `m`. A shape (§3.1) or a union (§2) has no module, so argument-dependent lookup finds nothing for it: its functions are found as any function is, by import.
- **Externs** are bound by module-qualified name, so two modules can declare externs with the same short name.
- **The prelude** is imported implicitly into every module. A module's top-level declarations and the names its imports bind can't reuse a prelude name, with one exception: a top-level function, declared or imported under its own name, joins the prelude's overloads of its name, as `fn add(left: Time, right: Duration)` does (§3.9). A function imported under another name joins nothing, so an alias can't take a prelude name.

### 3.14 Function types and closures

A function type is written `fn(Int, String) -> Bool` or `async fn(String) -> Result<String>`; its last parameter may be a pack, `fn(...A) -> R` (§3.5), but not an array's rest, which a function value takes as one array. A value of a function type refers to a named function or a closure, and calling it runs that function.

```python
fn twice(f: fn(Int) -> Int, x: Int) -> Int:
    f(f(x))

const limit = 50_000
const isLarge = fn(amount: Int): amount > limit     # limit is copied

fn makeCounter(start: Int) -> fn() -> Int:
    let count = start
    fn next() -> Int:                               # count is shared with next
        count += 1
        count
    next
```

**A closure is sugar.** Each captured `let` moves into a cell, as a shared struct's fields live in one (§3.18), which the outer code and the closure share; the compiler reads and writes it on both sides. The closure itself is an anonymous struct holding those cells and copies of the captured `const`s, paired with a reference to the function's code.

- **`const` variables are copied** into the closure.
- **`let` variables are shared.** The closure and the outer code use the same storage, so a change made on either side is visible on the other, as in JavaScript. The loop variable and any `let` declared in a loop body are fresh on each iteration (§3.4); a `let` declared outside the loop is shared by every closure created in it.
- **No `&` references** can be captured, because references can't be stored.
- **Copying a closure shares its state.** The struct is copied, but the cells inside it are the same storage, so `const g = next` is a second name for the same counter.
- **Calling through a `const` binding is allowed,** since immutability stops at handles (§3.4).
- **Lambdas** are written with `fn` and no name: `fn(x): x * 2`, `fn(x: Int, y: Int) -> Int: x * y`, `async fn(msg): await handle(msg)`. With exactly one untyped parameter, the parentheses may be dropped, as in Python's `lambda`: `xs.filter(fn a: a > 0)`; that form takes a name only. Parameter types may be omitted when the expected function type gives them. A parameter may be a pattern (§3.3), which takes each argument apart: `ps.map(fn(struct{x, y}): x + y)`, `pairs.map(fn((k, v)): k)`. The body after `:` is an expression, which ends at the next `,` or `)`.
- **Named lambdas.** A lambda may carry a name that is visible only inside its own body, so it can call itself: in `const fact = fn f(n: Int) -> Int: { … }`, the body can call `f`, while outside it the function is only `fact`.
- **Several statements** go in a block expression (§4): `fn(msg): { log(msg); save(msg); msg.id }`, or the same block spread over several indented lines. There is no brace-less form with `;`.
- **Overloaded names** passed as values, like `xs.map(add)`, need an expected function type to choose the overload; otherwise they are a compile error.

```python statements
bus.subscribe(fn(msg): {
    if msg.urgent:
        alert(msg)
    save(msg)
})
```

**Functions are values.** A local `fn` declaration is the same as binding a lambda to a `const` at that point. There is no hoisting inside a function, so a local function can only be used after its declaration. These two are equivalent:

```python
fn main():
    const result = fn(): 5

fn main():
    fn result(): 5
```

The only difference is that a lambda can also be bound with `let` and reassigned, while a named `fn` is always constant. Both can call themselves: a named `fn` through its name, and a lambda through its own name if it has one. Top-level functions are module declarations, so they may appear in any order (§2).

**What a lambda or local function may be.**

- **One value.** A lambda or a local `fn` can't be generic, or have default values or an array's rest parameter: a function value is one function, and its call gives every argument by position (§3.3). Its rest may be a pack of the function around it, `fn(...args: A)`, since each instantiation flattens it into single parameters (§3.5).
- **Parameter types.** A lambda's untyped parameter takes its type from the function type the lambda is expected as; with none, it is a compile error. A pattern naming its type with its type arguments, or one that takes none, writes the parameter's type; a generic one named bare takes its type arguments from the expected function type. Passed to a generic function, a lambda is checked after the other arguments, so they give its parameter types, and its result then infers the type parameters that remain (§3.5).
- **Its own function.** `return` in a lambda returns from the lambda, `break` and `continue` can't leave it, and `await` needs an `async fn` lambda.
- **Captures.** A by-value parameter is immutable (§3.3), so it is captured as a copy, like a `const`.
- **Async function types.** Calling an `async fn(A) -> R` yields a `Future<R>`, and `await` gives the `R`. A declared `async fn f(x: A) -> Future<R>` is therefore the value `async fn(A) -> R`. A plain function fits where an async one of the same parameters and result is expected, `fn(A) -> R` where `async fn(A) -> R` is and `sendable fn(A) -> R` where `sendable async fn(A) -> R` is: calling it yields a future that is already resolved, and the call never suspends. As with the conversion into a union (§2), this fits the value passed or assigned, not one inside another type: an `Array<fn()>` isn't an `Array<async fn()>`.
- **Functions named as values.** A top-level or static function named as a value, as in `xs.map(inc)` or `Duration.zero`, is a closure that captures nothing. A method is called, never named as a value: `s.push` without a call is a compile error; wrap the call in a lambda. A function with defaults also fits a function type that leaves trailing ones out, and computes them at each call; one with a rest parameter takes it as one array, so `log` is a `fn(String, Array<String>)`.
- **Fields of function types.** `x.f(…)` calls a field `f` of a function type when `x`'s type has no method `f`. When it has both, the call is ambiguous, which is a compile error; `(x.f)(…)` calls the field.
- **Equality.** Two function values are equal when they run the same function with equal captures. A captured `let` is a cell, so it compares by identity (§3.1).

**Sendable function types.** A plain function value isn't sendable (§3.1): it may capture a cell, such as a captured `let`'s, or a shared struct. `sendable fn(A) -> R` and `sendable async fn(A) -> R` are the function types whose values capture only sendable values, so they can be spawned and sent to `spawn`:

- A function value has a sendable function type when every capture's type is sendable. A captured `let` is a cell, so a closure capturing one has a plain function type; a top-level or static function named as a value captures nothing, so its type is sendable.
- A `sendable fn(A) -> R` fits wherever an `fn(A) -> R` is expected, never the reverse.
- It satisfies `Sendable`, so it may be a `spawn` argument or part of sendable data. `spawn f(args)` accepts any expression of a sendable function type as `f`; its captures are copied into the new instance with the arguments (§9).
- It refers to code, so it never leaves for the host: an extern declaration or `json` whose types contain one is a compile error. Code reaches only instances of the same program, which keeps it from crossing versions (§5).

### 3.15 Tuples

A tuple groups a fixed number of values by position. Its type is written `(Int, String)`, and a tuple is built with parentheses: `(5, "x")`.

```python statements
fn minMax(xs: Array<Int>) -> (Int, Int):
    (xs.min(), xs.max())

const lo, hi = minMax(scores)
const _, max = minMax(scores)         # _ holds the first value, unnamed
let a, b = (1, 2)
a, b = (b, a)                         # swap two existing variables
for key, verdict in answered.entries():
    ...
```

- **Tuples are values.** They are copied like structs, sendable when all their elements are, and compared structurally by `==`.
- **`Unit` is the empty tuple** `()`.
- **Building needs parentheses:** `(5, 7)`, including in `return (5, 7)`. A one-element tuple is written `(x,)`; `(x)` is just a parenthesized expression.
- **A one-element tuple converts.** A `(T,)` fits where a `T` is expected, giving its element, and a `T` fits where a `(T,)` is, as a one-element tuple, so a pack of one (§3.5) reads as its value. The conversion applies to a whole value, once, before any conversion into a union (§2), never inside a collection or a function type: an `Array<(T,)>` is no `Array<T>`.
- **Elements by position:** `t.0`, `t.1`, as a decimal number after the dot. `t.0 = v` assigns one and `&t.0` passes one by reference. `t.0.1` reads an element of an element.
- **Destructuring** works in `const` and `let` declarations, in `for` loops, and in plain assignment to existing variables. `_` is an unnamed variable: it holds its value like any other variable (§7), it just can't be referred to.
- **Declaration targets** are patterns that can't fail (§3.11): names, `_`, tuple patterns and struct patterns, a struct pattern's rest included, nested at any depth, with `as` to rename. Several targets are a tuple of them: `let (a, b), c = t`, `const Pair{first, second as s} = p`, `const struct{first} = p`, which takes the type from the value, and `const struct{title, ...rest} = form`. A pattern that can fail (§3.11) is a compile error here. Each level's count must match its tuple's size. A declaration target also stands as a parameter, taking its argument apart (§3.3).
- **Assignment targets** are places, or tuples and struct literals of targets: `a, b = (b, a)`, `(a, b), c = t`, and `Pair{first: p.x, second} = q`, which assigns `q.first` to `p.x` and `q.second` to the variable `second`. The value is evaluated first, then each part is assigned, left to right. An assignment writes each place once: `a, a = t`, `p, p.x = t` and `*x, x->a = t` are errors. Where two places may be one only when the program runs, two elements `xs[i], xs[j]` or two variables holding one handle, they are written left to right.
- **No named tuples.** When positions need names, use a struct. A good guideline: tuples for two or three positional values, structs beyond that.

### 3.16 Annotations

An annotation attaches a compile-time value to a declaration. It is a struct value written with `@` before it, and it applies to the declaration on the same line or, standing on its own line, to the next declaration:

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
- **Short forms come from the struct rules (§3.1):** a single-field struct takes its value without a field name, as in `@JsonName{"user_id"}`, and a struct without fields is written bare, as in `@JsonSkip`.
- **Checked at compile time.** An unknown annotation, a misspelled field or a wrong value type is a compile error. Annotation values must be computable at compile time, the same rule as top-level `const`.
- **Where.** `JsonName`, `JsonSkip` and `JsonBigInt` apply to fields of struct declarations and enum variants (§9 says which fields), `@Suite` to functions (§10), and `@Waypoint` to a statement that awaits or selects (§10). Any other struct may annotate fields and functions, for tools to read, and statements take only `@Waypoint`. A field of an anonymous struct type, a shape (§3.1), takes none, since no declaration carries it: a field needing `@JsonName` lives in a struct. Using an annotation anywhere else, or the same one twice on one item, is a compile error.
- **Read by the runtime.** The boundary conversion, the `json` module and the test runner read annotations. There is no user-facing reflection in v0.1; a field loop (§4) is resolved at compile time and reaches only a struct's fields.

### 3.17 Type aliases

`type` gives an existing type another name: `type UserId = String`. The alias and the original are the same type and mix freely. Aliases may be generic, as in `type Entries<T> = Array<(String, T)>`. A static function declared on an alias is the aliased type's, so `fn Entries.empty<T>() -> Entries<T>` gives `Array<(String, T)>` an `empty`, and one declared on an alias of `T | None`, such as the prelude's `Optional<T>`, is every optional's: `Optional.default()` and the `json` module's `Optional.fromJson` serve each `T?`. An alias of a shape names it (§3.1), `type Point = { x: Int, y: Int }`, so the alias is only the shape's spelling, shown in messages: it may stand before `{` to build the shape, `Point{x: 1, y: 2}`, and a static function declared on it is the shape's, whichever alias of the shape it is called through; a generic one names a family, `type Pair<A, B> = { first: A, second: B }`, whose static functions are called through it. An alias naming an enum plainly, with no type parameters of its own and no type arguments given, qualifies its variants as the enum does: with `type Hue = Color`, `Hue.Red` is `Color.Red`, in an expression, a literal or a pattern; any other alias would lose what its arguments say. An alias of a struct declaration names it only as a type: its literal names the struct. A *distinct* type with the same contents is a single-field struct instead, such as `struct UserId { value: String }`, which the type checker keeps apart from `String`, and a type with an identity of its own is a shared struct (§3.18).

**Recursive aliases.** An alias may refer to itself, directly or through other aliases, where each reference stands inside a type built from others: a type argument, a field of a shape, a tuple element, or a function type's parameter or result.

```python
type Tree<T> = T | Array<Tree<T>>
type List = { head: Int, tail: List? }
type Machine = fn(Int) -> Machine
```

- **Guarded.** A reference standing as the whole body, as a member of the body's union, or where what it names must be known first (`A.Data`, `A[K]`, `keyof A`) names no type: `type A = A | Int` and `type A = A?` are compile errors at the alias. An alias whose body is a type `match` keeps its own rules (below).
- **Finite.** Its values are finite as a struct's are (§3.1).
- **Regular.** Each reference to an alias of its cycle passes the alias's own type parameters, in order: `type W<T> = T | Array<W<Array<T>>>` would need endlessly many types, a compile error at the alias.
- **Identity.** A use is a type of its own, keyed by its alias and its arguments (`Tree<Int>`, `json.Json`): it stands for its body with itself substituted, unfolded where it is used, so its members, fields, patterns, conversions and exhaustiveness are its body's. No fold or unfold is ever written: `1` converts into a `Tree<Int>`, and `case Array<Tree<Int>> as xs` selects a member. Two recursive aliases with equal bodies stay two types, which don't mix inside containers.
- **In a union** a use stands as one member, and a member its body holds merges into it (§2): `Tree<Int> | Int` is `Tree<Int>`.
- **Spelled** as its alias in messages, hovers and extern keys. A static function declared on it belongs to it: `fn Tree.leaf<T>(value: T) -> Tree<T>`.

**Type `match`.** The whole body of an alias or an associated type may be a type `match`, whose type is that of its first case matching its subject:

```python
struct Field<T> { value: T? }
struct Repeat<Row> { row: Row }

type DataOf<D> = match D:
    case Field<infer T>: T
    case Repeat<infer R>: Array<DataOf<R>>
    case struct: { [F in keyof D]: DataOf<D[F]> }

type IdOf<T> = match T:
    case struct { id: infer K }: K
    case _: None
```

- **Cases** stand one per line and are tried in order, and a case's type stands after its `:`, on the same line or indented below. `case P:` matches a type of `P`'s form. In `P`, `infer T` binds a new type variable to the part standing there, visible in the case's type, and a later bare `T` in `P` must be that same part: `case Pair<infer T, T>:`. `infer T is C` matches only a part meeting `C`, and a variable standing beside other members of a union, `infer T | None`, binds what the type has beyond them. Without `infer`, `P` is matched as the type itself, after aliases. Matching is exact, with no conversion into a union and no one-element tuple (§2), except that a literal type matched whole, as the subject or the member a union distributes, matches a case naming its base type: `true` meets `case Bool:`. Inside another type it is a part of a different type: `Box<"a">` doesn't meet `case Box<String>:`. A pattern is a type, so its type arguments meet their parameters' constraints, and a variable standing at a constrained parameter meets that parameter's constraints in the case's type, beside any it is written with: with `struct Field<T is Encodable>`, `case Field<infer T>:` knows `T is Encodable`.
- **`case struct …:`** matches a struct type meeting the struct constraint (§3.5), binding its entries' variables, `case struct { id: infer K }:`; a type not meeting it just doesn't match. In the case's type, the subject written as a type parameter meets the constraint, so its keys and fields are known there (§3.1). **`case _:`** matches any type. **`match (A, B):`** matches two types at once, as a tuple.
- **Unions distribute.** A union subject is matched member by member, the subject written as a type parameter standing for the member inside its case, and the cases' types join into a union: `DataOf<Field<Int> | Field<String>>` is `Int | String`. `Never`, no member, gives `Never`; a tuple is no union, so `match (D,):` matches a union whole.
- **A use no case matches** is a compile error where it is written: no case of `DataOf<Int>` matches `Int`. A use an instantiation reaches is written where the instantiation is: `f<Int>(…)` for `fn f<D>(x: DataOf<D>)`, `Holds<Int>` for `struct Holds<D> { data: DataOf<D> }`, and so for a type `match` a generic function's code writes, or one a call it makes reaches.
- **Reduction.** A use is the type of its first matching case. In a generic body (§3.5) it reduces only when the first case that could match matches whatever its type parameters become, unions included; otherwise it stays unreduced, opaque and equal only to the same alias with the same arguments, until an instantiation reduces it. So a use whose subject is a type parameter that may stand for `Never` or a union, as an unconstrained one may, stays unreduced even when every case could match it, `case _:` included: `Never` gives `Never`, and a union distributes. A member parameter (§3.5) or one with a struct constraint stands for neither. Inside a type `match`, a use of a type `match` alias stays as written until a use of its own alias gives its arguments.
- **Recursion.** An alias whose body is a type `match` may refer to itself, directly or through others. `DataOf<Tree>`, for a recursive `struct Tree`, is one type: a reduction reaching it again refers to it, as a recursive struct refers to itself, so it is a struct type whose fields hold it, under the finiteness rule of §3.1: a use whose values would hold another by value, such as `R<Int>` for `case _: { a: R<T> }`, is a compile error where it is written. A reduction reaching the same use again before any struct type holds it, `case _: A<T>` or `case _: A<T> | Int`, would make the use itself, which no type is, as an alias's unguarded reference to itself names none: a compile error where the use is written. One reducing to itself with a type built from its own type parameter, `W<T>` to `W<Array<T>>`, would need endlessly many reductions, the compile error of §3.5, reported at the alias by the uses its cases' types write, whichever case a subject picks.
- **`infer`** stands only in a case's pattern, and a type `match` only as the whole body of an alias or an associated type.

### 3.18 Shared structs

A `shared struct` is a struct whose values are handles to a cell of the instance's own memory, holding its fields. A module declares one when it needs values with an identity, such as a queue or a resource, where a struct, copied whenever it is passed, has none.

```python
shared struct Lease:
    name: String
    renewals: Int = 0

fn renew(self: Lease):
    self->renewals += 1        # every copy of the handle sees it
```

- **Built with `new`.** `new Lease{name: "db"}` makes a new cell holding the fields, from a literal like any struct's (§3.1): defaults, shorthand and a leading spread, which takes the value behind another (`new Lease{...*other}`). Only a shared struct is built with `new`, and only with `new`; either way round, the other is a compile error.
- **Read through, never with `.`.** `x->field` reads or writes a field, and `*x` the whole value, the shape of the fields (§3.1, §3.9), which any value of that shape writes or spreads into `new Lease{…}`. The fields are that value's, not the handle's, so `x.field` is a compile error, a struct pattern doesn't take a shared struct apart, and a shared struct never meets a trait's field requirement (§3.10). Methods are called with `.`, as on any type: `lease.renew()`.
- **Identity.** Copying a shared struct copies the handle, not the cell, and `==` compares handles by identity (§3.1). A shared struct is never sendable, so it stays in its instance, and has no JSON form (§9). Its fields may hold the shared struct itself, since what they hold is a handle: `shared struct Node { next: Node? }`.
- **Its own module.** A shared struct is a nominal type of the module declaring it, so argument-dependent lookup finds that module's functions for it (§3.13), and a diagnostic names it as declared.
- **Disposal.** A shared struct has an identity, so a `dispose` declared beside it makes it disposable (§7), which is how a module makes a resource of its own.
- **`Shared`.** The prelude's `Shared<T>` is `shared struct Shared<T> { value: T }`, a shared struct of any one value: `new Shared{value: v}`, read and written as `x->value`. It is the prelude's, so only the prelude could make it disposable.

## 4. Expressions and control flow

Every block is an expression whose value is its last expression. A block that ends in a statement has type `Unit`. All branching constructs (`if`, `match`, `select`) are expressions. **All their branches must have the same type, and the compiler checks this.** A branch that ends in `return`, `break` or `continue` has type `Never`, which fits any expected type. `return` gives the value on its line, or the indented value on the lines below it, deeper than its own (§2), built as the function's return type; with neither, it returns `Unit`.

**Block expressions.** A bare `{ … }` in an expression position is always a block expression: its statements run in order, its variables are scoped to it, and its value is its last expression. Indentation still applies inside the braces. Written on one line, a block must contain at least one `;`, since braces around a single expression add nothing: write `if urgent: alert(msg)` rather than `if urgent: { alert(msg) }`.

```python statements
const total = { const base = price * qty; base + shipping(base) }

if urgent: { alert(msg); save(msg) }     # a one-line body
```

Braces always mean one of three things, told apart by what comes before them: after a name, a qualified name, type arguments or `struct`, they construct a value (§3.1); in a type position, they list fields; and any other `{` in an expression starts a block.

**One-line bodies.** Any `:` that introduces a body (after `if`, `elif`, `else`, `while`, `for`, `case` or `fn`) may instead be followed by exactly one statement on the same line, with no braces, as in `for x in xs: total += x`. Chained on one line, `if`, `elif` and `else` form an `if` expression like any other, so every branch must have the same type:

```python statements
const size = if n < 10: "small" elif n < 100: "medium" else: "large"
const fact = fn f(n: Int) -> Int: if n < 2: 1 else: n * f(n - 1)
if urgent: alert(msg)
```

A `;` directly after a one-line body is a compile error, because readers coming from Python would expect `if x: s1; s2` to put both statements in the body. Write `if x: { s1; s2 }` for both, or put `s2` on the next line.

**Continuing a construct.** `elif` and `else` continue an `if` when they stand at the column where the `if`'s line starts, which is how a multi-line `if` can be an initializer (below). A dangling `else` belongs to the nearest `if` whose line it lines up with, so after `if a: if b: x` it belongs to `if b`. The `case` lines of a `match` or `select` always stand in its indented body.

**Array comprehensions.** `[for x in xs: expr]` builds an array by evaluating `expr` for each element, and an `if` clause between the iterable and `:` keeps only the elements that pass:

```python fragment
const doubled = [for i in 1..10: 5 * i]
const small = [for x in doubled if x < 20: x]
const values = [for r in results if r is Ok{value}: value]   # filter and destructure
```

- **The body is one expression;** a block expression gives it several statements.
- **`is` bindings in the condition flow into the body,** just as they flow from an `if` condition into its body.
- **It works on any `Iterable` (§3.10)** and builds the whole array at once. A plain `for` without brackets stays a statement and builds nothing.
- **Over a struct's fields,** `[for k, v in ...x: expr]` takes a field loop's header (below) and gives one element per field, in name order, `expr` checked once per pass. With no `if` clause, the elements agree on one type as an array literal's do: the type expected, such as `any X` for an object-safe `X`, or else what they agree on, `String` for `k` itself and `(String, Int)` for `(k, 1)`, whichever fields there are (§2, Agreeing values).

**Struct comprehensions.** A struct literal, `struct{…}` or `Name{…}`, may end with a field loop's header and `[key]: expr`, after any named fields: `struct{id, for k, v in ...rest: [k]: expr}`. It gives each field of `rest` a field named by the key, of `expr`'s value in that field's pass. The brackets hold the loop's key, a name, so the entry never reads as a field's declaration; there is no `if` clause and no spread, since the literal gives every field itself:

```python
struct Field<T> { value: T?, type Data = T }
struct SettingsForm { retries: Field<Int>, region: Field<String> }

fn current(s: SettingsForm) -> { [F in keyof SettingsForm]: SettingsForm[F].Data? }:
    struct{for field, node in ...s: [field]: node.value}
```

- **Its type** is the one expected, as a `struct{…}` literal's (§3.1), which must have exactly the named fields and `x`'s, or the one it names. A generic body builds one whose fields aren't all known yet, such as a mapped struct type over `x`'s keys. With neither, it is the shape of the named fields and each of `x`'s, typed as `expr` is there, which needs `x`'s fields known: not a type parameter with a struct constraint, or a type computed from one.
- **Checking** follows the field loop's, each `expr` against its field's type. A field both named and given by the comprehension is given twice, a compile error.
- **Evaluation** runs the named fields as written, then the comprehension in name order.

```python fragment
const label: String = if amount > 50_000:
    "large"
else:
    "normal"

const verdictText: String = match v:
    case Verdict{ok == true}:
        "approved by " + v.role
    case Verdict{ok == false}:
        "rejected by " + v.role
```

The rules:

- `if` without `else` must have type `Unit`.
- **Conditions decided by types.** A comparison or `is` whose outcome its operands' types fix is decided: `==` or `!=` of two literals; of a literal and a value whose type can't hold it (a literal type, a union of literals, a member parameter, a struct's keys not known yet but those its constraint names, §3.1, §3.5); of a literal or `none` and a value of a type known where it is checked that never compares with it (`u == true` against an `Int | String`); and `x is` a pattern its subject's type rules out (§3.11). It is that value, its operands still run, and it is warned of where it stands, in a field loop only when every pass decides it so. A condition built of decided ones with `not`, `and` and `or` rules out the branch that never runs, which is neither checked nor run; a bare `true` or `false` decides nothing. Always false, its own branch is ruled out; always true, every branch after it and the `else`. Nothing narrows: an undecided condition leaves its operands' types as they are.
- `match` must be exhaustive. Use `case _:` for the rest. Patterns are described in §3.11.
- The cases of a `match` and of a `select` (§8) stand one per line, with nothing after a case on its line: neither `;` nor `,` separates them (§2).
- A `case` may have a guard: `case Verdict{ok == false} as v if v.role == "cfo":`. A guarded case matches only when its condition is true, so guarded cases don't count toward exhaustiveness.
- `x is Pattern` tests a value against a pattern outside `match`, as in `if r is Ok{value as y}:` (§3.11).
- `while` and `for x in xs` are statements of type `Unit`. `for` works on any type that satisfies `Iterable` (§3.10). `break` and `continue` work as in Python, on the innermost loop.
- **Field loops.** `for key, value in ...x:` runs its body once per field of `x`, in name order (§3.1), as the body written out once per field; the `...` tells it from iterating an `Iterable`, which a struct may also be. `x` is a value of a struct type, of a type parameter with a struct constraint (§3.5), or of a type computed from one, such as a mapped struct type; `...*x` runs over the value behind a shared struct (§3.18).
  - **Targets.** Exactly two. `value` is a copy of the field, a declaration's target (§3.15). `key` is a name or `_`, a value of the field's name as a String literal type: it passes as a `String`, compares with any field's name, matches and is sent like any value. It is a single key (§3.1): `y[key]` is the field it names, a place, where `y`'s type has that field.
  - **Checking.** Over a struct type, the body is checked once per field, `value` of that field's type and `key` of its name's literal type, so each pass chooses its own overloads. Over a type with a struct constraint, it is checked once per field the constraint names, and once for the other fields, where `value` has an opaque type meeting the constraint's `[_]` entry, if any, and `key` an opaque type within `keyof S`. Each pass is the body written out for its field, so a condition or case its key decides rules out the code another field selects (conditions decided by types, above), which that pass never checks. Over a struct with no field, or a value of type `Never`, it is checked once, as code that never runs: `key` and `value` are of type `Never` (`keyof {}` is `Never`), whose operations report nothing (§2), so only a mistake that doesn't depend on a field is reported. A mistake several passes make is reported once; a case no value reaches is warned about only when it is so in every pass.
  - **A loop like any other.** Each pass is a block of its own (§3.4), so `break`, `continue`, labels, `hold` and `await` work as in any `for`. It is a statement of type `Unit`.
- **Labels.** A body's line `Name:` with a block below it is a label, never a value: an indented value opens only after `=`, `return`, a key or `-` (§2). A label stands before a loop, `outer: for x in xs:`, and `break outer` and `continue outer` leave or go on with that loop from any depth inside it, as in Java or JavaScript. A label also names a block for `hold` (§3.4). A label belongs to its function: a nested function never sees it, and it may not repeat a label around it nor take the function's own name, so a name means one loop or block. A label nothing names is warned about.
- `return expr` exits the enclosing function; `expr` must have the function's return type.

**Optionals.** Three operators work without a `match` on a `T?`, any union holding `None`, and act on its other members, the `T`, which allows only what a union does when it is one itself (§2). They work alike on `None` itself, whose value is always `none`, and on a type whose `any` member took `None` whole (§2), such as `any Sendable`, which is its own `T`:

- `a?.b` reads the field `b`, or the element `a?.0` of a tuple, or calls a method as in `a?.m()`, or a field of a function type as in `a?.f(x)` (§3.14), when `a` isn't `none`, and yields `none` otherwise. The result is optional. `a?->b` does the same for a field behind an optional shared struct (§3.9), `f?.(x)` calls the function inside an optional `f`, as in `hooks.onDone?.(event)`, and `xs?.[i]` indexes an optional container, evaluating the arguments or the index only when there is one.
- `a ?? b` yields the value inside `a`, or `b` when `a` is `none`; `b` is evaluated only then. `b` may have type `T`, and so does the result, or `T?`, giving a `T?`, so `a ?? b ?? c` reads left to right.
- `a!` yields the value inside `a`, and panics with "Force-unwrapped none." when `a` is `none` (§3.12). It is postfix, beside `?`, and unwraps a whole optional chain before it: `a?.b!` is `(a?.b)!`. Every use is warned about, since `??`, `is` or `match` handles the `none` it would panic on. `x!=y` scans as `x != y`, so an unwrapped operand of `==` needs a space or parentheses: `x! == y`.

All three work only on such types; using one on any other value is an error. A `?.` or `?->` starts an **optional chain**: the links after it, such as `.c`, `.0`, `[i]`, `.m()` and `->c` in `a?.b.c`, `a?.b.0`, `a?.b[i]`, `a?.b.m()` and `a?.b->c`, work on the value inside, and when a `?.` or `?->` meets `none` the whole chain is `none`. Each reaches inside the one optional before it, so an optional read further along needs its own: `a?.b?.c` when `b` is optional too. Parentheses end a chain, and so does a prefix `*`. The chain's value is converted into `T?` once, at its end, and `T??` is `T?` (§2), so results never nest. A value read through `?.` or `?->` is a copy (§3.1), not a place (§3.7), so a chain can't be assigned to, nor be the receiver of a method taking `&self`.

`??` can't be mixed with `and` or `or` without parentheses, as in JavaScript. Neither operator is related to the postfix `?` on `Result`, which propagates errors (§3.12).

```python fragment
const limit: Int = m.get("limit") ?? 50_000
const role: String? = verdict?.role
```

## 5. Persistence

`await` is the only persistence point, and it is allowed only inside an `async fn`. The compiler checks only that rule; persistence itself is the runtime's job. The runtime is an interpreter that executes the compiled program over an instance's memory snapshot. **Every `await` commits**, whether or not its future has already resolved: the snapshot is persisted (locals, call frames, position in the code and pending futures), and only then does the instance wait. The code alone therefore tells you what is durable: the code between two `await`s is one atomic segment, and every `await` ends one. The one `await` that doesn't end a segment is an async callee's first, reached inside its caller's segment: it hands control back to the caller, whose next `await` commits both (§3.3). The runtime may skip a physical write that would change nothing observable. To commit without waiting, write `await runtime.commit()`.

- **Frames are data.** The interpreter keeps call frames in the snapshot, not on the host language's stack. An `await` at any depth in a call chain can therefore be persisted and resumed.
- **Atomic segments.** The code between two `await`s runs in memory. Its effects (state changes, slot operations and disposals) commit atomically at the next `await`. If the segment is interrupted before it commits, by a crash or a panic, it never happened.
- **Disposal points.** Since segments are atomic, disposing a running execution can only stop it at an `await`.
- **Determinism.** `now()` returns the time its segment started, so every call within one segment sees the same time, and so does a re-run of that segment; so do the values it draws from `random` (§3.8). The results of `extern fn` calls are recorded in the snapshot.
- **Memory is reachability-based.** A snapshot persists only what is still reachable from the instance's live state, so unreachable shared structs and closure environments simply disappear. A disposable value is disposed at the point its last holder releases it instead, so that disposal is predictable (§7).
- **Persisted values nest at most 256 levels deep.** A deeper value works within a segment, but a segment that would commit one, reachable or as the outcome, panics instead (§3.12), so the instance stays at its last commit.
- **Extern effects aren't transactional.** The runtime doesn't make `extern fn` calls atomic with the segment. If a segment is discarded, the effects of extern calls it made remain, and a re-run calls them again. Idempotency is the developer's responsibility; an extern can, for example, return its own commit and abort handles for the workflow to call once it decides. Slot operations are exactly-once; anything the host provides is the host's responsibility.

```python
async fn remindLater(role: String):
    await time.delay(1d)              # persisted; resumes after a day
    notifications(role).send(Notice{text: "Reminder"})
```

**Versioning.** An instance's code is fixed for its whole lifetime: the definition is snapshotted when the instance is created and persisted with it. Nothing that refers to an instance's memory is sendable (§3.1), and what refers to code, a sendable function value, goes only to an instance of the same program, through `spawn`, so nothing crosses between versions. When a new version is deployed, the runtime starts its `main`. Everything else about the transition, such as keeping an old version's services running, is up to the program, and how what the host provides deals with versions is up to the host.

## 6. Slots and inboxes

**Slots.** A `Slot<T>` is the runtime's one primitive for communication: a place that is either empty or full, shared by the concurrent executions of one instance and persisted with it. It is created empty with `Slot.create<T>()`, and three operations use it, each returning a future:

| Operation | Waits until | Then |
| --- | --- | --- |
| `slot.put(v)` | the slot is empty | fills it with `v` |
| `slot.take()` | the slot is full | empties it and yields the value |
| `slot.read()` | the slot is full | yields the value and leaves it there |

- **One queue.** A slot's waiting operations, of every kind, form one queue, longest waiter first. Competing takes are therefore atomic: exactly one gets each value, the one that has waited longest; waiting puts fill the slot in the same order.
- **Serving the queue.** When a value arrives, the waiters are served in queue order: every `read` before the first `take` yields the value, and that `take` empties the slot. The next waiting `put` then fills it again, and the queue goes on.
- **At once when it can.** An operation that can complete when it is called (a `put` on an empty slot, a `take` or `read` on a full one) completes then, inside the caller's segment, and its future is already resolved.
- **Awaiting still commits.** Awaiting any of these futures commits, like every `await`, even one already resolved, and the execution then runs after every execution that became ready before it.

When the runtime or the host fills a slot, it wakes the waiters even if the whole instance is suspended and persisted, which only the runtime can do.

**Futures.** A `Future<T>` is the read-only view of a slot: it can only be waited on. Every wait in the language is a wait on a slot, filled by one of three producers:

- **User code,** with `put`: an inbox's `receive()` or an `rpc` reply.
- **The runtime:** when an async call returns, when a `time.delay` or `time.at` timer fires, and when a value is disposed (`disposed()`, `worker.disposing()`).
- **The host,** through what it provides.

`await` and `select` work only on futures. A future resolves once and stays resolved.

**Inboxes.** The standard library's `Inbox<T>` is a FIFO message queue built on slots, the way Haskell builds its channels on `MVar`s, and written in the language. It is a shared struct (§3.18), which the `inbox` module makes disposable by declaring its `dispose` (§7), so an inbox is a handle that a `WeakRef` can watch. It is created with `Inbox.create<T>()`, and `box.pending()` gives the messages waiting in it, oldest first, without receiving them:

```python statements
const box = Inbox.create<Verdict>()
box.send(v)                            # durable
_ = box.sendRevertible(v)              # revertible: held until this block ends
const next: Verdict = await box.receive()
```

- **Order.** Messages come out in commit order: the order in which the senders' segments committed. Sends within one segment keep their program order.
- **Receivers.** Each message goes to exactly one receiver. When several are waiting, the one that has waited longest gets the next message.
- **Capacity.** An inbox is unbounded, so `send` never waits; it returns `Unit`.
- **A receive is a wait on a slot.** `receive()` returns the future of a `take`, not of an async call, so a receive that loses a `select` and is released consumes nothing.
- **Durable messages** live until they are received, or until the inbox is disposed.
- **Revertible messages** last as long as the `Revertible<T>` holder that `sendRevertible` returns: kept in `_`, it lasts until the sending block ends, with `hold _` until the sending function ends, and stored elsewhere, as long as it is held there. When the holder is released while the message is still unread, the message is retracted. The holder doesn't keep the inbox alive.
- **Receiving a revertible message** makes it final, so once received, it can't be retracted. A retracted message is removed, and everything else keeps its order.
- **`Revertible<T>`** is written in the language too: `shared struct Revertible<T> { retract: fn() -> Unit }`, made disposable by the `inbox` module's `dispose`, which calls its `retract`. Whatever queue makes a holder supplies its own retraction, so an inbox, a fan-out and a queue the host provides all hand out the same type. A host's revertible send is a disposable host type (§3.6), and `Revertible.holding(sent)` makes a holder whose retraction lets go of it, which disposes it and so tells the host (§12.1).

**Lifetimes.** A slot or inbox is disposed when its last holder releases it, together with the values in it. Every handle holds it; code that shouldn't keep it alive holds a `WeakRef` instead (§7). Queues the host provides live as long as the host keeps them.

**Death signal.** Any code holding an inbox may send to it and receive from it, and every such handle keeps the inbox alive (§7). To notice that the other side of a conversation is gone *without* keeping it alive, hold a `WeakRef` to its inbox and watch `disposed()`:

```python
async fn child(parent: WeakRef<Inbox<Status>>, mine: Inbox<Command>):
    while true:
        await select:
            case mine.receive() as cmd:
                parent.deref()?.send(handle(cmd))   # strong only for this statement
            case parent.disposed():
                return                              # the parent's inbox is gone
```

The owner keeps its inbox and gives the child only the weak side, starting it without awaiting: `_ = child(WeakRef(status), commands)`. Once the owner releases `status`, the child's `disposed()` resolves.

- **Order.** The inbox is disposed, its unread messages are deleted, and then every `disposed()` future watching it resolves. A receiver racing `box.receive()` against `disposed()` never gets a message after the signal.
- **Every watcher is notified.** Each call returns its own future, so any number of executions can watch the same inbox.
- **Not only inboxes.** A `WeakRef` to any disposable has `disposed()`: to a future, a slot, a revertible message's holder.
- **Queues the host provides** are kept by the host, so watching one resolves only if the host disposes it.

## 7. Lifetimes and disposal

Pending futures, slots and inboxes, and revertible messages are **disposable**: they satisfy the built-in `Disposable` trait, and the runtime calls `dispose` when nothing holds them anymore. Code never calls `dispose`, or names it as a value except as a test's mock target (§10); it releases a value with `drop`. Only a value with an identity of its own can be disposable, so only a shared struct (§3.18) or an extern type may be. That is how user code gets a disposable resource: `fn dispose(self: Lease)` makes the shared struct `Lease` disposable, and a `dispose` declared for an extern type a host provides makes it disposable too. A plain struct that declares `dispose` is a compile error, because copies of a value have no single identity to dispose.

A program's `dispose` is found the way an operator's function is (§3.9), beside the type it disposes: in the module declaring that type. It is plain code: it takes the value as its one parameter, returns unit, and can't be `async`. The value can't outlive its disposal, so inside `dispose` it is used only as `*self` (or `self->field`) or passed to an extern function; storing it, copying it into a variable, capturing it or passing it to any other function is a compile error.

```python
trait Disposable:
    fn dispose(self: Self)
```

**Holders.** A disposable value is held by whatever the running instance can still reach it through: variables (`_` included), struct fields, array and map elements, closure captures and values waiting in a slot, of the executions that are live, and through other values held so. Copying a value that contains a disposable handle adds a holder, overwriting a variable or field releases the old value, and returning a value hands it to the caller. When a block ends, it releases everything its variables hold, except `hold let` and `hold const` variables, whose holdings the enclosing function releases when it ends, or the loop or block their `hold(name)` names (§3.4); every disposable that has just lost its last holder is disposed. **Temporaries**, such as the result of `parent.deref()` used inside one expression, are released at the end of their statement. The temporaries of a header, such as an `if` or `while` condition or a `match` subject, are released when it has been evaluated, before the body runs.

Some holds are implicit:

- A pending `take`, `read` or `put` holds its slot, so a waiting receiver keeps the slot alive. A slot's queue of waiting operations holds nothing.
- An async call's execution is held through its future. A running call holds its own future until it suspends, so a call that releases the last holder of its own future runs on, and is stopped at its next `await`.
- A `futures.first` holds the futures it races, and a resolved future holds its value.
- A `WeakRef` and a `disposed()` future watch what they refer to without holding it.

**Unnamed and dropped values.** A must-use value left as a bare expression is a compile error. The must-use types:

- a future (§3.3)
- a `Result` (§3.12)
- a disposable
- a union with a must-use member (§2)

Using one consumes it (`await`, `match`, `?`), as does keeping it in a variable or discarding it. `_ = expr` keeps it in an unnamed variable, so it lasts until the block ends, `hold _ = expr` until the function ends, and `hold(name) _ = expr` until the loop or block `name` ends. `drop expr` says "I don't need this": a disposable is disposed right away if nothing else holds it, and anything else is simply discarded. A typical use is a best-effort call whose failure doesn't matter, such as `drop audit.record(event)`, which ignores its `Result` on purpose. `drop x` releases the variable `x`, which can't be used afterwards: a use that some path reaches from the `drop` is a compile error, unless a `let` is assigned again first, and a variable declared again, as in a loop's next iteration, is a fresh one. Only a variable the function holds itself can be dropped: not one a closure captured from outside it, not a reference parameter, and not a top-level constant. Neither ever makes a disposed value observable.

In the common case nothing is stored anywhere else, so a disposable lives exactly as long as the function that created it. That isn't forced, though: storing, returning or sending a disposable keeps it alive, and doing so is the developer's choice.

- **Deterministic.** Disposal happens when the last holder's block ends, never at snapshot time, because `dispose` has visible effects.
- **Synchronous.** `dispose` can't `await`. It can send signals, retract messages and mark work as aborted. Anything that must clean up gracefully does so in its own execution, after receiving the signal.
- **Ordered.** Values that lose their last holder at the same block exit are disposed in reverse creation order. A value held by another one being disposed loses its last holder only once that disposal is done, so a holder is disposed before what it holds, and its `dispose` or `defer` never sees a disposed value.
- **Atomic.** The effects of disposal commit with the segment in which the block ends.
- **Within one instance.** Holding never crosses instances: disposable handles aren't sendable (§3.1), and what the host provides is owned by the host.
- **Cycles.** Disposables that hold each other in a cycle lose their last holder together, when the last one from outside the cycle releases them, and are disposed then, like any other values that lose their last holder at once.

**What disposing does,** as implemented by the standard library:

| Value | Disposing it |
| --- | --- |
| `Future` of an async call | resolves the call's `disposing()`, then stops the call at its next `await` |
| a pending `take`, `read` or timer | drops the wait without consuming / cancels the timer |
| a future the host fills | drops the wait; a later fill by the host changes nothing |
| `Slot` or `Inbox` | it dies, along with the values in it |
| `Revertible<T>` holder | retracts the message if it hasn't been received |

In every case, each `disposed()` future watching the value resolves afterwards.

**Weak references.** `WeakRef<T is Disposable>` refers to a value without holding it. Its `deref()` returns `T?`, which is `none` once the last holder has released the value. Its `disposed()` returns a `Future<Unit>` that resolves at that moment, already resolved if it has passed, and waiting on it holds nothing. `WeakRef(x)` gives the one weak reference to `x`, so two weak references are `==` exactly when they refer to the same value, also after it is disposed. Weak references aren't sendable.

**Disposing early.** To dispose something you hold before its block ends, `drop` it. A value is disposed only when its last holder releases it, so a disposed value is never observable. To stop something that other code may also need to reach, keep the only holder in a `Shared` and share that. Setting its value to `none` releases the holder, and everyone else then sees `none` rather than a disposed value:

```python statements
const sub = new Shared<Future<Unit>?>{value: bus.subscribe(fn msg: show(msg))}
...
sub->value = none         # the subscription is disposed here
```

Code that copies the future out (`const f = sub->value`) becomes a holder itself, and keeps it alive.

**Graceful disposal.** Inside an `async fn`, the function's own name gives the current call's context. `worker.disposing()` returns a `Future<Unit>` that resolves when the call is disposed, which gives the call a chance to clean up:

```python
async fn worker(jobs: Inbox<Job>):
    while true:
        await select:
            case jobs.receive() as job:
                process(job)
            case worker.disposing():     # this call is being disposed
                flushPending()           # cleanup can't await
                return
```

- **Cleanup runs inside the disposal.** When the call's last holder releases it, the runtime resolves its `disposing()` future. If the call is suspended where it can resume on that future (awaiting it, or in a `select` with a case for it), it resumes at once, in the same segment as the disposal, and that case wins over any other.
- **The next `await` aborts.** After disposal, the first `await` the call reaches stops it, and its variables are released. A call that never watches `disposing()`, or isn't waiting on it at that moment, is stopped right where it is suspended.
- **Cleanup can't wait.** Because the next `await` aborts the call, cleanup is synchronous by construction. Cleanup is decided by the future: whatever the call is suspended on, if it is the call's `disposing()` future, it resumes as cleanup. The compiler warns about an `await` inside a `select` case written as `worker.disposing()`; one held in a variable is the same future, but gets no warning.
- **Lexical.** `worker.disposing()` always refers to the enclosing call of `worker`, also from a nested local function, so nested functions are never ambiguous. It is a compile error outside an `async fn` of that name, and for `main`, which nothing holds.
- **Calls nothing can dispose.** An instance's root call, such as a spawned function, and a call that has already returned are never disposed, so their `disposing()` never resolves.

**Defer.** `defer f` runs the function `f` when the current block ends, whether it finishes, is left through `return`, `break` or `continue`, or is disposed at an `await`. `f` is a lambda or a function reference of type `fn() -> Unit`, as in `defer fn(): log("exited")` or `defer cleanup`, so it can't await. Several deferred functions run in reverse order, last first, and a `defer` in a loop body runs at the end of each iteration, as in Swift. `defer` is sugar for holding a disposable guard in a hidden local, so it needs no new machinery. Unlike `disposing()`, it also runs on a normal exit; to act only on disposal, check a flag:

```python
async fn reserveAndShip(item: Item):
    const hold = reserve(item)
    let shipped = false
    defer fn(): {
        if not shipped:
            release(hold)
    }
    await ship(item)
    shipped = true
```

**Example.** `processAll` keeps every job it starts with `hold _`, and disposes its inbox, and any job still running, as soon as it returns:

```python
async fn processAll(jobs: Array<Job>) -> Future<Array<Outcome>>:
    const results = Inbox.create<Outcome>()
    for job in jobs:
        hold _ = runJob(job, results)       # runs concurrently until processAll returns
    let outcomes: Array<Outcome> = []
    while outcomes.length() < jobs.length():
        outcomes.push(await results.receive())
    outcomes
```

**No escape rule.** Because disposal follows holders, a future, slot or inbox may be returned or stored freely; doing so simply keeps it alive.

## 8. select

`await select` waits until one of several futures resolves, then runs that case. It is an expression: its value is the value of the winning case's body.

```python statements
const got: Verdict? = await select:
    case verdicts.receive() as v:
        v
    case cancels(id).receive() as c:
        return "cancelled: " + c.reason
    case deadline:
        return "expired"
    case reminder:
        none
```

The rules:

- **Cases are expressions.** Each case expression must be a `Future`: a receive, an async call, a `delay`, or a future variable. `as name` binds the resolved value inside that case.
- **Sequential evaluation.** Case expressions are evaluated top to bottom. If one contains an `await`, evaluation suspends there and the later cases are evaluated after it resumes. Selection happens only after all cases are evaluated.
- **Left-to-right priority.** If several futures have resolved, the first case in order wins.
- **Each case holds what its expression creates.** Futures, slots and revertible holders created while evaluating a case expression are held by that case.
- **Losers are released.** Once the winner is determined, every other case's holdings are released and, if nothing else holds them, disposed: async calls are aborted, pending takes are dropped without consuming, and revertible sends are retracted. A future taken from a variable declared outside the `select` is held by that variable, so it survives and can be used again.
- **The winner's holdings move to the block enclosing the `select`,** so they live until it ends.
- **Same type.** Case bodies agree on one type as the branches of `if` and `match` do (§4), and that type is the type of the `select`.
- **A case without `as` discards its value,** so a future whose value must be used (§7), such as a `Result`, needs `as` to bind it.

**Future reuse.** A future resolves once and stays resolved. Create a deadline once, outside a loop, and every iteration races against the same deadline:

```python statements
const deadline: Future<Unit> = time.delay(5d)    # created once
while not done:
    await select:
        case work.receive() as w:
            handle(w)
        case deadline:
            break
```

**Non-blocking form.** A `select` without `await` must have an `else:` case. If no future has resolved at evaluation time, `else` runs. It never waits, so it may stand in a plain `fn` too. It replaces a separate "try receive" operation:

```python statements
const cancelled: Bool = select:
    case cancels(id).receive():
        true
    else:
        false
```

## 9. Program structure

Every program has exactly one `async fn main()`. The runtime starts it when a version is deployed. When `main` returns, everything it holds is disposed (§7).

**spawn.** `spawn f(args)` starts `f` as a new, independent workflow instance with its own snapshot, then continues immediately. It is an expression of type `Instance<T>`, `T` being what `f` returns, or the `T` of an async `f`'s `Future<T>`. Its value may be left unused, and holding it doesn't hold the new instance, which stays independent. It doesn't wait, so a plain `fn` may spawn too. The arguments are copied into the new instance, so they must be sendable (§3.1). The new instance runs until it finishes by itself, on the version it started with, and its return value is recorded as its outcome, which the host can see. Concurrency inside an instance needs no `spawn`: an async call that isn't awaited right away already runs alongside its caller.

- **What can be spawned.** `f` is a top-level function, async or not, a method or static function, an instance of a generic one, or any value of a sendable function type (§3.14), whose captures are copied with the arguments. An extern can't be spawned, and neither can a function with a `&` parameter.
- **Effects commit with the segment.** The new instance exists once the segment that spawned it commits; a segment that is discarded spawned nothing. Each spawned instance is named after its parent and a count of the parent's spawns, `<parent>/<n>`, and is written before the parent's commit, so a segment that re-runs finds it already there and doesn't spawn it twice.
- **Options are inherited.** An instance spawned by one that runs with `crashEveryAwait` (§10) runs with it too.
- **Waiting for an instance.** `inst.result()` resolves with the instance's first end: `Ok` of its outcome when it finishes, or `Err{Error{message, code: "panic", trace}}` with its panic when it panics, or was terminated after one. The outcome is copied out of the instance's last commit, so `T` must be sendable. A retry after the panic changes nothing for a wait already resolved. `Instance<T>` is sendable and compares by identity, so it may be passed to another instance; it isn't `Encodable`, so it never crosses to the host.
- **Isolating a call.** `runtime.isolate(f)` spawns `f` and waits for its `result()`, so a panic in `f` becomes an `Err` instead of freezing the caller. Its panic also terminates that instance at once, disposing what it holds (§7), so it needs no operator.

```python
async fn main():
    while true:
        const req: PurchaseRequest = await purchaseRequests.receive()
        spawn purchase(req)
```

**Host interface.** The language has no I/O of its own. Its only contact with the outside world is the host (the runtime and the applications around it), which provides the `extern` declarations a program uses (§3.6). Beyond that, the host can:

- **Start** an instance of any function, on the version it chooses, with arguments as JSON. Everything the function holds is disposed when it returns. A host may start a top-level function, or a top-level constant holding a sendable lambda (§3.14), that isn't generic and takes all its parameters by value with types that can be read from JSON.
- **Inspect** any instance: its state (waiting, panicked, finished or terminated) and where each of its executions waits, by waypoint (§10) or source location; a panicked one, or one terminated after its panic, also gives its message and trace.
- **Wake watchers:** a waiting instance names the instances whose end it waits for through `result()`. Once one of them has ended, the host wakes it, and the runtime reads that end from the instance's last commit, so no outcome passes through the host.
- **Operate** panicked instances: retry one from its last snapshot, where the failed segment runs again with the time it first started at (§5), or terminate it, which ends it as terminated and disposes what it holds (§3.12, §7).
- **Learn of spawned instances:** advancing an instance tells the host which instances it spawned, so the host runs them too.
- **Receive logs:** advancing an instance also gives the log records its committed segments wrote, in order (§3.8). They aren't kept in the snapshot, so a host that crashes before taking them loses them.

A host names what it starts, and each extern it implements, by its key: the module's name, the function's or constant's name and its parameter types, as in `purchase.chargeCard(String, Int)`, `purchase.dispose(purchase.Sent)` or `purchase.approvalDeadline`, a `T | None` spelled through its alias, `prelude.Optional<T>`. Overloads therefore have distinct keys, and every instantiation of a generic extern shares one. A host written in JavaScript works with JSON as `JSON.parse` gives it, except that every integer is a `bigint`, so an `Int` keeps every digit and reads apart from a `Float`; it may give back a `bigint` or a whole number for one. What it gives back is read as `JSON.stringify` would write it, so `undefined` is `null`, or a missing field inside an object: a function returning nothing gives `Unit` or `none`.

Communication across this boundary takes only three forms: the workflow calls an `extern fn`, the host fills something the workflow waits on (such as a queue it provides), or the host starts an instance. The host never calls workflow functions directly. Asynchronous host work hands the workflow something to wait on instead of taking a callback, for example `extern fn fetch(req: Request) -> Future<Response>`: the host names the new future with a token of its own choosing and fills it later. An extern's result, or a value an extern constant gives, that doesn't fit its declared type panics the instance; a future filled, or an instance started, with JSON that doesn't fit fails the host's call instead. Filling a future nothing waits on any more, because it was disposed (§7) or its instance ended, changes nothing; filling one of a panicked instance fails until the instance is retried.

**Running a program locally.** `ista run <entry>` is a host for development. It compiles the program whose entry module is `entry`, which must declare `async fn main()`, and runs nothing if any module has errors. It then runs `main` in a new instance, and every instance it spawns, theirs included, until all of them have settled, and prints `main`'s outcome as JSON, using the mapping below. A panic prints the panic's message and trace instead; a spawned instance that panics prints its name, message and trace to the error stream, and the run exits with a failure. One that `runtime.isolate` terminated was handled, so it fails nothing. Each log record goes to the error stream as one line of JSON. Two options stand in for what a real host provides:
- `--store <dir>` keeps the compiled program and every commit of the instance in a directory, so a run can stop and resume: `ista run --store <dir> --resume <instance>` continues an instance from its last commit, on the program it started with. A run with a store prints its instance's name to the error stream.
- `--host <module>` loads a JavaScript module whose default export implements the program's externs, keyed by their keys: each takes and returns JSON values, and one for an extern returning a `Future` may return a promise, which fills the future when it settles. A run that waits on nothing left to wake it, no timer and no promise that can still settle, reports where it waits and fails.

**Values at the boundary.** Every value that crosses between the host and an instance has a declared type: extern constants, extern function parameters and results, and the arguments of an instance the host starts. Each crosses through its type's codecs, the `toJson` that `Encodable` requires and the `fromJson` that `Decodable` does (§3.10), so workflow code needs no reflection. Inbound JSON is validated before it enters the instance; a mismatch fails the host's call, so malformed data never reaches workflow code. `json.parse<T>(s)` and `json.stringify(v)` go through the same codecs for JSON held in strings.

- **Declared codecs.** The `json` module declares them for the types the language has, and a module may declare them beside its own types, as the `time` module does for `Time`. A type that crosses as text (the table below lists the standard ones) declares each with one call: `fn toJson(self: Money) -> Json: json.encodeText(self)` writes its `toString`, and `fn Money.fromJson(j: Json, path: String) -> Result<Money>: json.decodeText(j, path)` reads it back through its `parse`. A `fromJson` names the `path` of what it reads in an `Err`, as `$.items[2].amount`.
- **Derived codecs.** A struct, an enum, a tuple or a host type that declares neither function, in its own module or the `json` module, gets both from the compiler, and so do a literal type and a union of literals. A derived codec writes and reads each part through that part's own codecs, found as every trait's functions are (§3.10), so it is the same wherever the type is used. A type that declares one codec has the other neither derived nor otherwise, so it is never written one way and read another.

The mapping follows JavaScript's `JSON.stringify`:

| Type | JSON |
| --- | --- |
| struct, named or anonymous, deriving its codecs | object keyed by field name, or, in a named struct, by the name given with `@JsonName`; a named struct's fields marked `@JsonSkip` are left out, and read back as their type's `default()` (§3.10), so only a field whose type is `Default` may be skipped |
| `Array<T>`, tuple | array; a tuple's has exactly its length |
| `Map<K, V>` | object keyed by each key's `toString`, so `K` must be `Stringable` (and `Parsable` to be read) |
| `Int` | number, parsed and printed exactly at any size; a string of its digits with `@JsonBigInt` |
| `Float` | number; NaN and ±Infinity are written as `null`, as JavaScript does, so they can't be read back: a `Float` that may be missing is a `Float?` |
| `Bool`, `String` | boolean, string |
| `T?`, which is `T \| None` | `null`, or a missing field, for `none`; `T` may itself be a union of literals |
| literal type, union of literals | the literal: string, number or boolean; reading another value fails |
| enum deriving its codecs | object with a `"type"` field naming the variant, plus the variant's fields |
| `Decimal`, `Regex`, `Time`, `Duration`, `Zone`, `DateTime` | string, their `toString` text, by `json.encodeText`: `"-12.5"`, `"2026-10-25T12:00:00.000Z"`, `"PT1H30M"` |
| `json.Json` | the JSON it holds: `none` is `null`, an `Int` or a `Float` a number, an `Array<Json>` an array and a `Map<String, Json>` an object; its codecs are the identity, and a host sees plain JavaScript values, every integer a `bigint` (§3.17, the extern key `json.Json`) |
| `Unit` | `null` |
| extern type | whatever JSON its host gives it, handed back unchanged, by `json` too. A disposable one keeps that JSON while the instance holds it (§3.6) |

Every object's keys are emitted sorted, in UTF-16 order as JavaScript sorts strings, so equal values always produce the same JSON, whatever order a struct declares its fields in or a map stores its entries in. Unknown fields in inbound objects are ignored, so producers can add fields without breaking consumers. A missing field that isn't optional fails validation, even one with a default (§3.1). A type that isn't `Encodable`, or `Decodable`, can't cross that way, at the boundary or through `json`, which is a compile error where it would: a function type, a handle (§3.1), a union other than `T | None` and a union of literals, even of members that cross (§14), a map whose keys aren't `Stringable`, or a type with a part that can't cross. So is an enum deriving its codecs with a variant field named `type`, which would collide with the tag.

## 10. Testing

Tests are ordinary code. The runtime adds a few primitives, in the `testing` module, and everything else is a library written in the language, in the same module. A test module is a file whose name ends in `.test.ista`. Only a test module may import `testing`, and only a test module may import another test module, so production code can never install a mock; either import elsewhere is a compile error. A test module also sees the private (`_`) declarations of the modules it imports, so a test can mock what a module keeps private, such as a raw extern behind a public wrapper.

**Suites.** `@Suite{"title"}` marks a function that returns the suite's tests as an `Array<Test>`. Tests are values, built by library functions:

```python
@Suite{"purchase approval"}
fn approvalSuite() -> Array<Test>: [
    test("expires after 5 days", withPurchaseEnv, async fn(env): {
        const t = spawn purchase(PurchaseRequest{id: "p1", item: "laptop", amount: 900})
        await t.idle()
        env.clock.advance(5d)
        assertEq(await t.result(), Ok{"expired"})
    }),
    group("with cancellation", [
        test("retracts review requests", withPurchaseEnv, async fn(env): { … }),
    ]),
    ...[for amount in [10, 50_000, 60_000]:
        test("amount " + amount, withPurchaseEnv, async fn(env): { … })],
]
```

- **Each test runs in a fresh instance.** Function values aren't sendable, so the runner calls the suite function again inside each new instance and runs the entry at that test's position.
- **Suite functions only build their list,** which the compiler enforces: a suite function is a plain `fn` (not `async`) that doesn't call externs or touch shared structs, slots or inboxes, so it builds the same list every time it is called. The rule is checked on the suite function's own body, not on the functions it calls or the tests it builds; in each test's instance the runner also checks that the list still holds that test's title at its position, and fails the test when it doesn't.
- **The library** provides `test(title, body)`, `test(title, setup, body)`, `group(title, tests)`, `skip(test)` and `only(test)`. A test's body is a plain or an `async` function, taking the setup's environment when it has one. Table-driven tests are comprehensions, as above.
- **Skipping and focusing.** `skip` and `only` take a test or a group, and mark it, and through a group every test in it. A skipped test is reported but not run, even when `only` marks it too, whichever was applied last and at whatever level. When any test of a run is marked `only`, directly or through its group, only those tests run, and the rest are reported as skipped.

**Environments.** A setup is an "around" function of type `Setup<E> = async fn(async fn(E))`: it prepares an environment, runs the test inside it, and tears it down afterwards. Teardown is ordinary code, so it may `await`, and holdings such as mocks are released when the function ends, even if the test fails:

```python
async fn withPurchaseEnv(test: async fn(PurchaseEnv)):
    const clock = FakeClock{start: Time{value: 0}}
    hold _ = mock(time.now, clock.now)
    hold _ = mock(time.at, clock.at)
    await test(PurchaseEnv{clock})
```

`setups(a, b)` combines several environments into one, with overloads for up to six: `setups(withPurchaseEnv, withFakeHost)` is a `Setup<(PurchaseEnv, HostEnv)>`, whose test receives both as a tuple. The first setup is the outermost: it prepares first and tears down last.

**Mocking.** `mock(target, replacement)` replaces any named function (an extern, a standard-library function or one of the program's own) while the `Mock<F>` it returns is held, `F` being the function's type, so a mock follows block lifetimes like every other resource. `mock` takes a pack (§3.5), one declaration for plain functions and one for async ones: `mock<...A, R>(target: fn(...A) -> R, replacement: fn(...A) -> R) -> Mock<fn(...A) -> R>`, and explicit type arguments name the parameters as a tuple, then the result. It applies to everything the test runs, including instances it spawns. For an overloaded name, the expected type picks the overload; a lambda can't be a target, since it has no identity to replace. A host type's `dispose`, which the runtime calls (§7), may be a mock's target, the one place it may be named. Spawning an instance isn't a call, so an instance runs the function it was spawned with, whatever mocks it. `m.calls()` returns the arguments of every call as tuples, typed from `F`: `Array<(String, Int)>` for `chargeCard`, `Array<(String,)>` for a function of one parameter, and a `Unit`, the empty tuple, per call of one of none.

- **Mocking twice.** Mocking a target that is already mocked replaces it while the new handle is held; releasing that handle brings back the mock before it.
- **Across instances.** A mock applies to the instance holding it and to every instance spawned from it. Such an instance calls the replacement in the instance holding the mock, as a host's extern is called (§9): the arguments and the result are copied between the two, so they must be sendable, or the call panics. A future the replacement returns is followed across as well. The instance answering plays the host, so a host value it receives or hands back isn't its to dispose: only the instance that got it from the call owns it (§7).

**Time.** `time.at(t)` is the runtime's only time primitive, and `delay(d)` is library code for `at(now() + d)`. Mocking `time.now` and `time.at` therefore controls all time. The library's `FakeClock` is made for that: `FakeClock{start}` stands still at `start`, and its fields `now` and `at` are the replacements, as above. `clock.advance(d)` moves it forward by `d` at once and fills every deadline it passes, the earliest first, and deadlines that tie in the order `at` was called. A deadline already reached resolves at once, and advancing by a negative duration panics.

**Host types.** `testing.handle<T>()` creates a unique, opaque value of any extern type `T`, for mocks that must return one: each call gives a value equal to no other, and a `T` that isn't an extern type is a compile error. The library's `FakeQueue<Q, T, K = String>` fakes a host's queues of type `Q` carrying `T`, with an ordinary inbox behind each: `FakeQueue<Queue<Verdict>, Verdict>{make: handle}`. Its fields are replacements for the program's externs: `open`, for a queue factory such as `verdicts`, gives the queue of a key of type `K`, made with `make` the first time; `send` and `receive` use that queue's inbox. A mock's target must name a function, so the test mocks the program's externs with them itself:

```python statements
const verdictQueues = FakeQueue<Queue<Verdict>, Verdict>{make: handle}
hold _ = mock(verdicts, verdictQueues.open)
hold _ = mock(receive, verdictQueues.receive)
verdictQueues.post("p1", Verdict{role: "legal", ok: true, comment: ""})
```

For the test, `pending(key)` gives the messages waiting in a key's queue, oldest first, `post(key, msg)` sends one into it, and `sendRevertible(queue, msg)` sends one revertibly, for a program's own revertible send to answer with.

**Driving an instance.** A test starts an instance with `spawn` (§9), which exists once the test's segment commits, and waits for its end with `result()`. `testing` inspects an `Instance<R>` too, through functions a test imports to call them as methods, since `Instance` is the prelude's (`import idle, reaches from 'testing'`):

| Member | Meaning |
| --- | --- |
| `idle() -> Future<Unit>` | resolves once every execution of the instance is waiting, or it has finished, so everything so far has committed |
| `reaches(label: String) -> Future<Unit>` | resolves once an execution of the instance is suspended at that waypoint |
| `waitingAt() -> Array<String>` | the waypoint of every `await` or `select` the instance is suspended at, or its source location (`module:line:column`) where it has none |
| `state() -> InstanceState` | `Running`, `Waiting`, `Panicked`, `Finished` or `Terminated`, as its last commit says |

`testing.spawnCrashingEveryAwait(f)` spawns `f`, a sendable function taking nothing such as `fn(): purchase(req)`, and returns its `Instance`, but the instance discards and re-runs every segment once before committing it, which catches extern calls that aren't idempotent and anything that differs between two runs of the same segment.

**Waypoints.** `@Waypoint{"approval"}` on a statement that awaits gives that suspension point a name, for `reaches` and `waitingAt`, and for the host's operator view, which can show an instance as waiting at `approval`.

**Failures.** The library's `assert` and `assertEq` panic on failure, and a panic in the test or in an instance it spawned fails the test at once, with that instance's message and trace, unless some instance waits for that instance's end through `result()`, which then gives the panic as an `Err`. `assert(condition)` and `assert(condition, message)` take a `Bool`; `assertEq(actual, expected)` takes any `Encodable` type, every struct, enum and tuple deriving it (§9), and its message shows both as JSON: `expected "expired", found "approved"`. Other values are compared with `assert(a == b)`.

`await expectPanic(f)` passes only if `f` panics, and gives the panic's message. A panic freezes the instance it happens in (§5), so `f`, a sendable plain or `async` function taking nothing, is spawned as an instance of its own, and `expectPanic` waits for its `result()`, so that panic doesn't fail the test. `expectPanic` panics when `f` returns instead.

**Built in versus library.** The runtime provides the `@Suite` runner with a fresh instance per test, `mock` and `Mock<F>`, `time.at`, `testing.handle<T>()`, `testing.spawnCrashingEveryAwait` and an `Instance`'s inspection, and the panic capture behind failures. Everything else is written in the language: `test`, `group`, `skip`, `only`, `Setup` and `setups`, `FakeClock`, `FakeQueue`, the assertions and `delay`.

**Running tests.** `ista test [paths…]` compiles every test module under the given files and directories, or under the project root without any (found as `ista check` finds sources, §3.13), into one program, and runs nothing if any module has errors. It then runs each test of every `@Suite` function, one at a time, in a fresh instance on a fresh runtime, so nothing a test leaves behind reaches the next. Instances a test spawns run alongside it. A test passes when its function returns; instances it spawned that still wait are dropped.

- **The host.** Time is real unless a test mocks it. Random values (§3.8) come from a seed made from the test's full title, so every run draws the same ones; a test fixes them by mocking `random.integer` or `random.uuid`. An extern that no mock replaces panics the instance that calls it, except a host type's `dispose`, which then does nothing: a test has nothing of its host's to release.
- **Stuck tests.** A test whose instances all wait on nothing that can wake them fails, naming where each waits; so does one still running after `--timeout <ms>` of real time, 5000 by default.
- **Selection.** `--filter <text>` runs only the tests whose full title contains `text`. A full title joins the suite's, the groups' and the test's titles with ` › `. The filter narrows what `only` selects, never widens it: a test runs only if both select it, and every other test is reported skipped.
- **Output.** One line per test, `✓`, `✗` or `-` (skipped) before its full title; a failure is followed by its message and trace, then the log records its instances committed, and a last line counts the tests that passed, failed and were skipped.
- **Exit codes.** 0 when every test that ran passed; 1 when a module has errors, a test fails or no test ran; 2 when a path can't be read or the options don't fit together.

## 11. Packages

The package system is tooling, not language: to the language, an import is just a string (§3.13). Its decisions aim at two things: builds that are exactly reproducible, and no package server to run.

- **Sources are repository URLs.** A package is a Git repository, such as one on GitHub, and a version is a semantic-versioning Git tag. No registry is needed; a registry or a caching proxy can be added later without changing anything below.
- **One manifest.** `ista.json` declares each dependency once, with its name, source URL and version range, in the spirit of `package.json`. Code imports by name (`import charge from 'billing/charge'`), never by URL, so an upgrade changes one line.
- **One version per package per program,** chosen by minimal version selection, as in Go: the highest of the minimum versions that anyone requires. It is deterministic, needs no constraint solver, and never produces two copies of a package, so two versions of the same struct type can't meet.
- **A lockfile** records each package's exact version and a hash of its contents.
- **Dependencies are vendored.** `ista vendor` copies every dependency into a `vendor/` folder that is committed with the project, as with Go's `vendor/` or Yarn's zero-installs. Builds download nothing, an upstream repository that is deleted or retagged can't break them, and every dependency change shows up as a reviewable diff. `ista verify`, typically run in CI, checks the vendored files against the lockfile's hashes, so hand edits are caught. Marking the folder as vendored (`linguist-vendored` in `.gitattributes`) keeps it out of review noise.
- **Packages are pure source.** They have no install scripts or build steps, and no file system or network access: a package's only I/O is its `extern` declarations, which list exactly what the host must provide, and tooling shows them before a dependency is added. Every package must include a license file, since vendoring redistributes it.
- **Running workflows never depend on packages.** A deploy freezes all code into the program definition that every instance snapshots (§3.13, §5), so packages matter only when building.

## 12. Examples

### 12.1 Purchase approval

One program covers a full approval flow. A purchase is reviewed in parallel by two or three roles, with a 5-day deadline, daily reminders and customer cancellation, and then charged.

**Declarations:**

```python
import * as time from 'time'
import Inbox, Revertible from 'inbox'
import Encodable, Decodable from 'json'

struct PurchaseRequest:
    id: String
    item: String
    amount: Int

struct ReviewRequest:
    purchaseId: String
    item: String
    amount: Int

struct Verdict:
    role: String
    ok: Bool
    comment: String

struct Notice:
    text: String

struct Cancel:
    reason: String

struct ChargeResult:
    ok: Bool
    receipt: String

# a queue type the host provides, and a message sent into one revertibly, which the host
# retracts when it is disposed, unless it was received
extern sendable struct Queue<T is Sendable>
extern struct Sent
extern fn dispose(self: Sent)
extern fn send<T is Encodable>(self: Queue<T>, msg: T)
extern fn _sendRevertible<T is Encodable>(self: Queue<T>, msg: T) -> Sent
extern fn receive<T is Decodable>(self: Queue<T>) -> Future<T>

fn sendRevertible<T is Encodable>(self: Queue<T>, msg: T) -> Revertible<T>:
    Revertible.holding(_sendRevertible(self, msg))

extern purchaseRequests: Queue<PurchaseRequest>
extern fn reviewQueue(role: String) -> Queue<ReviewRequest>
extern fn verdicts(purchaseId: String) -> Queue<Verdict>
extern fn notifications(role: String) -> Queue<Notice>
extern fn cancels(purchaseId: String) -> Queue<Cancel>

extern fn chargeCard(purchaseId: String, amount: Int) -> Result<String>
```

**Entry point.** Each purchase is spawned as its own instance, so it finishes on the version it started with:

```python
async fn main():
    while true:
        const req: PurchaseRequest = await purchaseRequests.receive()
        spawn purchase(req)
```

**One purchase instance.** This shows a non-blocking `select` before the irreversible step:

```python
async fn purchase(req: PurchaseRequest) -> Future<String>:
    let roles: Array<String> = ["legal", "finance"]
    if req.amount > 50_000:
        roles.push("cfo")

    const outcome: String = await approve(req, roles)
    if outcome != "approved":
        return outcome

    const cancelled: Bool = select:
        case cancels(req.id).receive():
            true
        else:
            false
    if cancelled:
        return "cancelled before payment"

    const result: ChargeResult = charge(req)
    if result.ok:
        "paid: " + result.receipt
    else:
        "payment failed"

fn charge(req: PurchaseRequest) -> ChargeResult:
    match chargeCard(req.id, req.amount):
        case Ok{value as receipt}:
            ChargeResult{ok: true, receipt}
        case Err{error}:
            ChargeResult{ok: false, receipt: error.message}
```

**Parallel approval.** Fan-out uses revertible sends into the reviewers' queues, kept with `hold _` so they stay revertible until `approve` returns, although they are sent inside loops. Verdicts come back through the host-provided `verdicts` queue, because the reviewers' side runs in separate instances (§6). The join is a `select` loop that reuses the deadline and reminder futures.

```python
async fn approve(req: PurchaseRequest, roles: Array<String>) -> Future<String>:
    for role in roles:
        hold _ = reviewQueue(role).sendRevertible(
                ReviewRequest{purchaseId: req.id, item: req.item, amount: req.amount})

    const deadline: Future<Unit> = time.delay(5d)
    let reminder: Future<Unit> = time.delay(1d)
    let answered: Map<String, Verdict> = [:]

    while answered.size() < roles.length():
        await select:
            case cancels(req.id).receive() as c:
                return "cancelled: " + c.reason
            case deadline:
                return "expired"
            case verdicts(req.id).receive() as v:
                if not v.ok:
                    return "rejected by " + v.role
                answered[v.role] = v
            case reminder:
                for role in roles:
                    if not answered.has(role):
                        hold _ = notifications(role).sendRevertible(
                                Notice{text: "Purchase " + req.id + " awaits your review"})
                reminder = time.delay(1d)
    "approved"
```

When `approve` returns by any path, everything it holds is disposed: unclaimed review requests and unread reminders are retracted, and both timers are aborted. Verdicts that arrive after that stay in `verdicts(purchaseId)`; cleaning them up is up to the program.

### 12.2 Approver side

The task-list UI shows the reviews waiting in `reviewQueue(role)`; how the host reads and claims them is up to the host. On submit, the host starts this function on the purchase's version. The verdict goes into the host-provided `verdicts` queue, because a host-started instance is separate from the purchase (§6).

```python
fn submitReview(task: ReviewRequest, role: String, ok: Bool, comment: String):
    verdicts(task.purchaseId).send(Verdict{role: role, ok: ok, comment: comment})
```

### 12.3 Broadcast with expiry

Each subscriber gets its own copy. The revertible sends give the announcement a natural expiry: when `announce` returns, every unread copy is retracted.

```python
import * as time from 'time'

struct Announcement:
    text: String

extern fn announcements(user: String) -> Queue<Announcement>   # Queue as declared in §12.1

async fn announce(text: String, users: Array<String>, visibleFor: time.Duration):
    for user in users:
        hold _ = announcements(user).sendRevertible(Announcement{text: text})
    await time.delay(visibleFor)
    # function ends: every unread copy is retracted
```

## 13. Open questions

No open questions remain for v0.1. New ones go here as they come up.

## 14. Future work

Features deliberately left out of v0.1:

- **Associated types with type parameters,** and associated types for types declared elsewhere, such as primitives (§3.1).
- **Filtering, renaming or making fields optional per field** in a mapped struct type, and carrying field annotations into one (§3.1).
- **Field loops over enums or tuples** (§4).
- **Closed struct constraints,** met only by a struct with exactly the named fields, and conformance for every struct meeting a constraint at once, such as `derive FormNode for struct { [_] is FormNode }` (§3.5).
- **Associated types of unions and `any` types,** such as `(A | B).Meta` as the union of its members' where every use of it stays sound; today neither has associated types, so neither meets a trait requiring one as a type argument (§3.1, §3.10).
- **A named field overriding a struct comprehension's,** as a mapped type's named entry skips its key; today a field both named and given by the comprehension is given twice (§4).
- **Rest in variant patterns,** the variant's fields a pattern doesn't name (§3.11).
- **Union patterns with `infer` variables** beyond `infer T | rest` in a type `match` case (§3.17).
- **Equi-recursive identity,** if equal recursive aliases from two libraries must mix: keyed by alias and arguments today, two aliases with equal bodies are two types (§3.17).
- **Indented maps with keys other than Strings,** written today as a bracket literal, `[1: v]` (§2).
- **Struct comprehensions in compile-time constants** (§3).

- **Narrowing from function results.** Type predicates, as in TypeScript, so that `fn isOk(x): x is Ok` can narrow a value's type for later code, for example a `map` after a `filter`. Inside one function, `x is Pattern` in an `if` or `and` already narrows.
- **Codecs written in the language,** and with them JSON for any union, deciding how a codec reads a member without a tag (§9).
- **Inferred unions,** if ever wanted: an `if` whose branches differ, typed as their union instead of an error (§2).
