---
description: A developer's guide to writing Istalang programs, breadth first — the whole language in one page, then each part with code, then the rules that bite; read it to learn the language fast, and docs/spec.md for exact rules
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-11
last_updated: 2026-11-15
tags: [language, guide]
---

# Istalang, level by level

Read top to bottom and stop anywhere: each level is a complete picture, only coarser than the next.
The spec, `docs/spec/`, is the source of truth; `§` numbers point into it.

---

## Level 0: what it is

Istalang is a Python-shaped, statically typed language for **durable workflows**: programs that wait for days on a person, a timer or another system, and survive restarts while they wait. At every `await` the runtime saves the program's whole state, so it can resume from that line later, even on another machine. The program reaches the outside world only through host functions declared `extern`.

```ista
ista async fn remindLater(role: String):
    await time.delay(1d)              # saved here; resumes a day later, even after a restart
    notifications(role).send(Notice{text: "Reminder"})
```

---

## Level 1: the nine ideas

1. **Python syntax, strict types.** Indentation, `#` comments, no implicit numeric or boolean conversions. Locals and return types are inferred; parameters and fields are annotated.
2. **Values are copied.** Structs, arrays, maps and tuples are copied on assignment, argument pass, return or send. Mutate caller data via `&x`, or share a *handle* (`Shared`, `shared struct`, `Slot`, `Inbox`).
3. **Everything that branches is an expression.** `if`, `match`, `select` and `{ … }` blocks produce values; all branches must agree on one type. A function returns its last expression.
4. **Errors are values; bugs panic.** Fallible functions return `Result<T, E = Error>`, and `?` propagates `Err`. Bugs (out-of-bounds index, division by zero) panic and freeze the instance for an operator.
5. **`await` is the save point.** In `ista` code, code between two `await`s is one atomic *segment*: it commits at the next `await`, or rolls back on crash. `live` code waits in memory and never commits. Only an `async fn` may `await`, and an `async fn` names its kind.
6. **Code handles only the data its mark allows.** Data is simple, live (a live future, an `extern live struct`) or ista (an ista future, a slot, an inbox). An unmarked `fn` handles and calls only simple things; a `live fn` adds live ones, an `ista fn` ista ones; `M fn`/`K async fn` are generic over the mark. A missing mark is a compile error naming the value or call; generic code passes its type parameters' values through.
7. **Concurrency without threads.** Calling an `async fn` without `await` starts it alongside the caller. Coordinate with futures, `select`, slots and inboxes; `spawn` starts an independent instance.
8. **Lifetimes follow blocks.** When a block ends, resources it alone holds are deterministically disposed: pending calls stop, timers cancel and unread revertible messages retract.
9. **The host is the only I/O.** `extern` functions, constants and types cross the host boundary as JSON. A host extern giving a future is `extern live async fn`; `ista` code reaches it through a job, `await runtime.delegate f(args)`, run as live code after the commit. Deploys freeze code: each instance finishes on the version it started with.

---

## Level 2: each idea, with code

### 2.1 A whole program

```ista
import * as time from 'time'
import * as runtime from 'runtime'

struct PurchaseRequest { id: String, amount: Int }
struct Verdict { role: String, ok: Bool }

extern purchaseRequests: Queue<PurchaseRequest>          # provided by the host
extern fn verdicts(id: String) -> Queue<Verdict>
extern fn chargeCard(id: String, amount: Int) -> Result<String>

live async fn main(): await runtime.run(runtime.id()) _main()
ista async fn _main():                                         # the one entry point
    while true:
        const req = await runtime.delegate purchaseRequests.receive()  # saved; may wait for weeks
        spawn purchase(req)                              # each purchase is its own instance

ista async fn purchase(req: PurchaseRequest) -> String:
    const deadline = time.delay(5d)                      # a timer, running from now
    const verdict = await select:                        # whichever comes first
        case runtime.delegate verdicts(req.id).receive() as v: v
        case deadline: return "expired"
    if not verdict.ok:
        return "rejected by " + verdict.role
    match chargeCard(req.id, req.amount):
        case Ok(receipt): "paid: " + receipt
        case Err(error): "failed: " + error.message
```

A file holds only declarations: imports, `struct`, `shared struct`, `enum`, `trait`, `type`, `fn`, `extern`, compile-time `const`, and `ista const`, one value per context made at its first read (§7.1) (no top-level statements or mutable globals).

### 2.2 Syntax, types, variables (§2.1, §4.1, §7.1)

```ista statements
const limit: Int = 50_000      # immutable, deeply
let count = 0                  # mutable, inferred Int
count += 1
const a, b = (1, "x")          # destructuring
```

| Type | Notes |
| --- | --- |
| `Int` `Float` `Bool` `String` `None` | `Int` is arbitrary precision; `Float` is IEEE 754 (`0` never converts to `0.0` implicitly); `None`'s one value is `none` |
| `Unit`, `Never` | `Unit` is `()`, the type of statements and loops; `Never` is the bottom type (`return`, `break`, `continue`, `panic`) |
| `A \| B`, `"a" \| "b"`, `42`, `true` | unions and literal types (`Bool` is `true \| false`); a value converts into a union expecting it, and a literal union fits its base type |
| `T?` | sugar for `T \| None` (like TS `T \| null`, **not** Rust's `Option` — there is no `Some`) |
| `(A, B)`, `{ a: Int, b: String }` | tuples (`t.0`, `t.1`) and anonymous struct types (structural shapes) |
| `Array<T>`, `Map<K, V>`, `Range` | value collections, copied like structs |
| `fn(A) -> R`, `live fn(A) -> R`, `ista async fn(A) -> R`, `sendable fn(A) -> R` | function types, all `Fn<Args, Result, Kind, Send>`; plain `fn(A) -> R` converts to `ista async fn(A) -> R`, unmarked to `live`/`ista`, and `sendable` to plain |
| `any Trait`, `any A & B` | existential trait object (`Array<any View<Sc>>`, `(any Showable)?`) |
| `Future<T, K>` `Slot<T>` `Inbox<T>` `Shared<T>` `WeakRef<T>` `Instance<T>` | **handles**: copying copies the handle, and `==` compares identity |

- **Literals:** `"a"` `'a'` `` `x=${x}` `` `42` `1_000` `0x1F` `0b1010` `3.14` `true` `none` `500ms` `30s` `15m` `2h` `5d` `[1, 2]` `["k": 1]` `[:]` `[...xs, 3]` `(1, "x")` `(x,)` `0..10` `0..=10` `0..10 by 2`.
- **Names:** types, traits and variants are `PascalCase`; functions, variables and fields are `camelCase` (both compiler-enforced). Leading `_` on a top-level declaration makes it module-private.
- **Keywords:** `fn`, `async`, `await`, `let`, `const`, `if`, `elif`, `else`, `for`, `in`, `while`, `match`, `case`, `select`, `return`, `break`, `continue`, `struct`, `enum`, `trait`, `import`, `extern`, `drop`, `is`, `and`, `or`, `not`, `true`, `false`, `none`, `as` are reserved everywhere (never field or variable names). `type`, `shared`, `live`, `ista`, `gives`, `takes`, `new`, `from`, `sendable`, `any`, `keyof`, `infer`, `hold` and `by` are contextual and may name fields or functions.

### 2.3 Data: structs, enums, optionals (§5.2, §5.3, §5.4)

```ista
struct Order:
    id: String
    items: Array<{ sku: String, qty: Int }>     # anonymous struct type
    retries: Int = 3                            # field default

const o = Order{id: "o1", items: [struct{sku: "a", qty: 2}]}
const o2 = Order{...o, retries: 5}              # updated copy; o is untouched
const id = "o2"
const o3 = Order{id, items: []}                 # id is short for id: id
const o4 = Order:                               # an indented value: one entry per line
    id: "o4"
    items:
        - sku: "a"                              # an item; its keys align
          qty: 2

enum Decision:
    Approved(by: String)
    Rejected(by: String, reason: String)
    Expired
```

- **Indented values.** After a `const`/`let`/assignment `=`, `return`, an entry's `:` or an item's `-`, a line ending there (or in `T:`, which names the struct built) opens a value on the deeper lines below: `name: value` entries build a struct, `"key": value` entries (keys quoted) a map, `- value` items an array, typed by the expected type. Nowhere else: `if c:`, `fn(x):` and the other headers keep statement bodies, and inside brackets an argument or element is written `T{…}`.
- **Empty structs:** declared `struct Marker` (or `struct Marker {}`); constructed bare as `Marker` (`Marker{}` in an expression is a compile error).
- **Optionals (`T?`):** `T | None`. Match with `case None:` then `case v:` (which narrows `v` to `T`), chain with `user?.name`, `a?->b`, `f?.(x)`, `xs?.[i]`, or fallback with `name ?? "anon"`.
- **Result & Error:** `Result<T, E = Error>` has variants `Ok(value: T)` and `Err(error: E)`. `Error` requires **both** `message: String` and `code: String` (`trace: String = _trace()` is defaulted): `Err(Error{message: "unanswered", code: "unanswered"})`.
- **Collection methods (exact set):**
  - `Array<T>`: `length()`, `push(x)`, `pop()`, `at(i)`, `slice(start = 0, end = none)`, `indexOf(x)`, `lastIndexOf(x)`, `includes(x)`, `reverse()`, `flat()`, `join(sep)`, `map(f)`, `filter(f)`, `flatMap(f)`, `find(f)`, `findLast(f)`, `findIndex(f)`, `findLastIndex(f)`, `some(f)`, `every(f)`, `reduce(f, init)`, `sort()`, `sort(order)` (JS names: use `.some`, not Python's `.any`; no `.forEach`, `.concat`, or `.unique`).
  - `Map<K, V>`: write entries with `m[k] = v` (**no** `.set`, unlike JS `Map`), read with `m[k]` (panics if absent) or `m.get(k)` (`V?`), plus `size()`, `has(k)`, `includes(k)`, `delete(k)`, `keys()`, `values()`, `entries()`, `Map.groupBy(items, keyFn)`.

**Shared structs** give mutable identity in instance memory: built with `new`, read and written with `->`, dereferenced as a whole copy with `*`:

```ista statements
shared struct Lease:
    name: String
    renewals: Int = 0

fn renew(self: Lease):
    self->renewals += 1          # every copy of the handle sees it

const lease = new Lease{name: "db"}
const alias = lease              # the same lease: alias == lease
lease.renew()                    # alias->renewals is now 1
const snapshot = *lease          # a plain copy of the fields
```

`Shared<T>` is the built-in one-field shared struct: `new Shared{value: v}`, read/written as `x->value`.

### 2.4 Functions (§6.1, §6.2, §6.4)

```ista
fn add(a: Int, b = 1): a + b                      # default parameter; return type inferred
fn log(level: String, ...parts: Array<String>): … # rest parameter
fn area(self: Circle) -> Float: …                 # a method: first parameter is self
fn push<T>(self: &Stack<T>, item: T): …           # &self lets the method change its receiver
fn Duration.zero() -> Duration: …                 # static function, called Duration.zero()
ista async fn fetch(id: String) -> User: …     # may await; inside it, return a User
```

- **Parameter patterns.** A parameter may be a pattern that can't fail: `fn norm(Point{x, y}) -> Float`, `fn area(struct{w, h}: Rect)`, `fn sum((a, b): (Int, Int))`, `ps.map(fn({x, y}): x + y)` (`{…}` is short for `struct{…}` there). A pattern naming its type takes no annotation; a lambda's may take its type from the expected function type.
- **Overloading.** Functions overload by parameter types and arity, never by return type.
- **References (`&T`).** `&` is implicit only on a method's receiver (`s.push(x)`). Every other `&T` argument must be written `&x` at the call site, including when forwarding a `&T` parameter (`helper(&out)`). References cannot be stored in variables or fields, captured by closures, or returned.

  ```ista statements
  fn bump(n: &Int): n += 1
  let x = 1
  bump(&x)                 # x is 2
  ```

- **Lambdas & closures.** `fn(x): x * 2`, `fn x: x > 0`, `async fn(x): await f(x)`; multi-statement bodies use a block `fn(m): { log(m); save(m) }`. Captured `const`s are copied; captured `let`s share a mutable cell.
- **Async declarations vs. async function types.** A declared `ista async fn` writes `-> R`, the value its body returns; its call gives `Future<R, "ista">`, and its type is `ista async fn(A) -> R`, another spelling of `ista fn(A) -> Future<R, "ista">`. An unmarked `async fn` or `async fn` type is an error: a future names its kind. A plain `fn(A) -> R` converts where `ista async fn(A) -> R` is expected. A lambda infers its mark from its expected type or its body; a local `fn` writes its own.
- **Conversions.** Infallible conversions use `T(x)` (`Float(3)`, `Int(3.7)`, `String(42)` for any `Stringable`), backed by `fn T.from(v)`. Fallible parsing uses `T.parse(s) -> Result<T>`.

### 2.5 Generics, traits, operators (§8.1, §10.2, §8.2)

```ista
fn swap<A, B>(p: Pair<A, B>) -> Pair<B, A>: Pair{first: p.second, second: p.first}

trait Monoid:
    fn Self.zero() -> Self
    fn add(left: Self, right: Self) -> Self

fn sum<T is Monoid>(xs: Array<T>) -> T:
    let total = T.zero()
    for x in xs: total = total + x
    total
```

- **Traits & `any Trait`.** Traits constrain type parameters (`T is Sendable & Comparable`), and `any Trait` types heterogeneous values (`Array<any View<Sc>>`, `(any Showable)?`) when the trait is object-safe (every required function takes `Self` first, uses `Self` nowhere else, and is not static). Conformance is structural like Go and TypeScript (**never** Rust's `impl Trait for Type:`): declare top-level functions beside the type or the trait.
- **Operators are functions.** `a + b` calls `add`, `<`/`>`/`<=`/`>=` call `compare`, `x[k]` calls `index`, `x[k] = v` calls `setIndex`, `for x in c` calls `iterate`, `x in c` calls `includes`, and `T(x)` calls `T.from`. `==` and `!=` are built in (structural on values, identity on handles) and cannot be overloaded.
- **Keyed members.** An `index` whose key is a member parameter of String literals (`K in keyof S`) serves member syntax: `x.k`, where `x`'s type has no member `k`, is `x["k"]`, each key read with its own type (`scope.company.size`). Read only; a name served by both a member and the index is an error.
- **Packs & member parameters.** `<...A>` is a tuple pack (`fn(...args: A) -> R`); `<K in U>` stands for a single member of union `U` per instantiation (`struct Entry<S is struct, K in keyof S>`). When every member of `U` is a literal type, `K` is also a value: `fn describe<S in Status>() -> String: S`.

**Computed types and field loops (§5.2, §8.1, §4.6, §11.2):**
- **Associated types:** `type Data = T` inside a `struct` or `enum`, required in a trait with `type Data`, read as `N.Data`.
- **Struct constraints:** `S is struct { title: String, [_] is FormNode }` (met by nominal `struct`s and anonymous shapes, not `shared` or `extern` structs).
- **Mapped struct types:** `{ [F in keyof S]: S[F].Data }` (a structural shape with one field per key of `S`; named fields alongside `[F in …]` override/skip those keys).
- **Field loops & comprehensions:** `for f, node in ...s:` (or `...*s` on a shared struct) checks and runs once per field in name order; `[for f, v in ...s: …]` builds an array; `struct{id, for f, v in ...s: [f]: g(v)}` builds a struct field by field. Over a type with no value, `for K in keyof S:`: `K` is each key, a type and its value, and `S[K].make()` calls the field type's static function, so `struct{for K in keyof S: [K]: S[K].make()}` builds an `S` from its type alone.
- **`keyof S`, `s[k]`, and `type match`:** `keyof S` is the union of `S`'s field names as string literal types; `S[K]` is the field type (or union of field types), and `s[k]` reads/writes it. `type Out<D> = match D:` computes a type by pattern matching, its cases one per line below it (`case Field<infer T>: T`, then `case _: D`).

```ista
trait FormNode:
    type Data
    fn check(self: Self, data: Self.Data) -> Bool

struct Field<T>:
    value: T?
    type Data = T

fn check<T>(self: Field<T>, data: T) -> Bool: true

struct Group<S is struct { [_] is FormNode }>:
    fields: S
    type Data = { [F in keyof S]: S[F].Data }

fn check<S is struct { [_] is FormNode }>(self: Group<S>, data: Group<S>.Data) -> Bool:
    for field, node in ...self.fields:
        if not node.check(data[field]): return false
    true
```

### 2.6 Control flow and patterns (§11.1, §11.3)

```ista statements
const size = if n < 10: "small" elif n < 100: "medium" else: "large"
for i in 0..10: total += i
for key, value in m: …
outer: for row in rows:                                   # a label: break outer, continue outer
    for cell in row:
        if cell == 0: continue outer
const evens = [for x in xs if x % 2 == 0: x * 2]          # comprehension
const t = { const base = price * qty; base + tax(base) }  # block expression

const text = match decision:          # must cover every variant, or end with case _
    case Approved(by): "approved by " + by    # a call pattern: fields as a call gives them
    case Rejected(reason: why, ...) if why != "": "rejected: " + why
    case Rejected(by, ...): "rejected by " + by   # ... leaves the other fields
    case Expired: "expired"

if r is Ok(y) and y > 0: use(y)                           # a pattern outside match
```

Patterns: a variant's fields as a call gives them, `case Rejected("legal", reason)`, `case Rejected(by: "legal", ...)` (`...` leaves the others, `...children` takes a rest field); a struct's in braces, `field`, `field as name`, `field == expr`, `field is Pattern`, `...rest` (on structs and arrays: `const struct{title, ...rest} = form`, `case [first, ...rest]:`); alternatives `A | B`, int ranges `0..=59`, and type patterns `case Int as n:` (on unions and `any` values).

### 2.7 Errors (§12)

```ista
ista async fn pay(req: Req) -> Result<String>:
    const receipt = chargeCard(req.id, req.amount)?   # on Err, return the Err from pay
    Ok(receipt)
```

- **Must-use:** Futures, `Result`s, disposables and unions holding one cannot be ignored. Consume with `await`, `match` or `?`, bind to `_ =` / `hold _ =`, or discard with `drop expr`.
- **`panic("msg")` -> `Never`:** discards the uncommitted segment and freezes the instance at its last snapshot.

### 2.8 Persistence (§14)

- **Every `await` in ista code commits**, even on an already-resolved future; a live one waits in memory (`await runtime.commit()` commits without waiting).
- **Atomic segments:** state mutations, slot operations and disposals between two `await`s commit together or roll back together.
- **Deterministic:** `time.now()` is fixed per segment, `random` draws from the snapshot's seed. Extern side effects are not rolled back on crash, so make externs idempotent.

### 2.9 Concurrency (§15.1, §15.4, §17.1)

```ista
const a = fetchA()          # started already; runs alongside
const b = fetchB()
const both = (await a, await b)
```

- **`select`** waits for the first ready future (`await select:`) or polls synchronously (`select:` with `else:`). Losing cases release and dispose what their case expressions created (aborting losing calls and dropping losing `receive`s without consuming).

  ```ista statements
  const deadline = time.delay(5d)           # create once, reuse in every iteration
  while true:
      await select:
          case jobs.receive() as job: handle(job)
          case deadline: break
  ```

- **Slots & Inboxes:** `Slot.create<T>()` offers `put(v)`, `take()` and `read()`. `Inbox.create<T>()` (from `'inbox'`) offers `send(m)`, `sendRevertible(m)` (retracted if unread when its `Revertible<T>` holder is disposed), `receive()` and `pending()`.
- **Library concurrency:** `'futures'` (`first`, `all`, `allSettled`, `race`, `any`, `quorum`, `timeout`, `retry`), `'rpc'`, `'fanout'`.
- **`spawn f(args)`**, a deferred call of the prelude's `spawn` (§6.5), computes `args` now and starts a new instance making the call `f(args)`, async or plain, returning `Instance<R>` (`await inst.result()` waits for its `Result<R>`). What it computes now must be `Sendable`. `spawn(g)` starts a sendable function value `g` itself.

### 2.10 Lifetimes and disposal (§16)

Resources (pending futures, slots, inboxes, revertible sends, and shared/extern structs with `fn dispose(self: T)`) are disposed synchronously when their last holder ends.

```ista statements
_ = startJob()              # held until this block ends
hold _ = startJob()         # held until the function ends, even when written in a loop
hold(rows) _ = startJob()   # held until the loop or block labelled rows ends
drop x                      # release now
_ = defer log("exited")     # runs when the block ends, however it ends
hold _ = defer log("done")  # runs when the function ends
```

```ista
ista async fn approve(req: Req, roles: Array<String>) -> String:
    for role in roles:
        hold _ = reviewQueue(role).sendRevertible(req) # kept until approve returns
    …
    # when approve returns by any path, every unread review request is retracted
```

- **Graceful stop:** Inside `ista async fn worker`, `case worker.disposing():` in `select` runs synchronous cleanup (cannot `await`) when `worker`'s future is disposed.
- **Weak references:** `WeakRef(x)` watches a disposable without holding it (`w.deref() -> T?`, `w.disposed() -> Future<Unit, "ista">`).

### 2.11 Modules, host, JSON, tools (§13, §17)

```ista
import approve, Verdict from 'purchase/approve'   # a project file: purchase/approve.ista
import * as time from 'time'                      # a standard-library module
import helper from './helper'                     # relative to this file
```

- **Import lists and renames.** Bare names stay on one line, `import a, b as bee from 'x'`; a longer list goes in parentheses and may break one name per line: `import (approve, decide as decidePurchase) from 'purchase/approve'`. Only an alias is in scope, so `import f as add` clashes with the prelude's `add`.
- **Prelude (no import needed):** `Int`, `Float`, `Bool`, `String`, `None`, `Unit`, `Never`, `Optional`, `Result`/`Ok`/`Err`, `Error`, `Step`, `Range`, `Array`, `Map`, `Slot`, `Future`, `Resolver`, `WeakRef`, `Instance`, `Shared`, `Deferred`, `Waypoint`, `Fn`, the marks `Mark`, `Persistence` and `Sendability`, `panic`, `spawn`, `defer`, and built-in traits (`Sendable`, `DataKind`, `Awaitable`, `Disposable`, `Iterable`, `Container`, `Indexable`, `IndexAssignable`, `Convertible`, `Default`, `Stringable`, `Parsable`, `Comparable`, arithmetic/bitwise traits).
- **Standard library (must be imported):**
  - `'inbox'`: `Inbox`, `Revertible`
  - `'strings'`: `indexOf`, `lastIndexOf`, `startsWith`, `endsWith`, `slice`, `split`, `trim`, `trimStart`, `trimEnd`, `padStart`, `padEnd`, `repeat`, `replace`, `replaceAll`, `toUpperCase`, `toLowerCase`, `format`, `graphemes`, `utf16Length` (import a function by name to call it as a `String` method: `s.replaceAll(a, b)`)
  - `'json'`: `Json`, `Encodable`, `Decodable`, `parse<T>(s) -> Result<T>`, `stringify(v)`, `encode`, `decode`, `encodeText`, `decodeText`, `JsonName`, `JsonSkip`, `JsonBigInt`
  - `'regex'`: `Regex{pattern}`, `Regex.parse(s)`, `Match`, `test`, `find`, `findAll`, `replace`, `replaceAll`, `split`, `escape`
  - `'time'`, `'math'`, `'decimal'`, `'crypto'`, `'random'`, `'log'`, `'runtime'`, `'collections'` (`WeakMap`), `'futures'`, `'rpc'`, `'fanout'`, `'testing'`
- **`Json`** is the recursive union `None | Bool | Int | Float | String | Array<Json> | Map<String, Json>`: write JSON of any depth as plain values (`const j: Json = ["a": 1, "b": [true, none]]`, or as an indented value), and take it apart with type patterns (`case Map<String, Json> as fields`, `case Int as n`). `[]` against it is the array, `[:]` the map.
- **JSON codecs:** Derived automatically for structs, shapes, enums (tagged by `"type"`), tuples, literal types, and **unions of literals** (`"a" | "b"`). General non-literal unions (other than `T?`) do not derive `Encodable`/`Decodable`. Generic code calling `json.parse<T>` or `json.stringify` must constrain `T is Decodable` / `T is Encodable`.
- **CLI:** `ista check`, `ista fmt`, `ista run <entry> [--store <dir>] [--host <js>]` (running again on the same store resumes its work), `ista test`.

### 2.12 Testing (§18)

```ista
@Suite{"purchase"}
ista fn suite() -> Array<Test>: [
    test("expires after 5 days", withPurchaseEnv, async fn(env): {
        const t = spawn purchase(PurchaseRequest{id: "p1", amount: 900})
        await t.idle()                    # everything so far has committed
        env.clock.advance(5d)
        assertEq(await t.result(), Ok("expired"))
    }),
]
```

Only `*.test.ista` files may import `'testing'` (`Suite`, `Test`, `test`, `group`, `skip`, `only`, `mock`, `FakeClock`, `FakeQueue`, `handle`, `spawnCrashingEveryAwait`, `idle`, `reaches`, `waitingAt`, `state`, `assert`, `assertEq`, `expectPanic`).

---

## Level 3: rules that bite

**Syntax & literals**
- **Braces in expressions are blocks, never object literals (unlike JS/TS).** Write `struct{a: 1}` for an anonymous struct literal and `struct{for k, v in ...s: [k]: v}` for a struct comprehension. In type positions, `{ a: Int }` and `struct { a: Int }` are identical. A one-line block needs `;` (`if x: { a(); b() }`); `if x: a(); b()` is a compile error.
- **`,` separates every list's items; `;` only statements.** `{ sku: String, qty: Int }`, `enum Color { Red, Green, Blue }`, `trait Shape { fn area(self: Self) -> Float, type Measure }`; `;` between items, or `,` between statements, is a compile error (`a, b = (b, a)` is one tuple assignment).
- **A line break separates a broken list's items** where an item can end and the next line can start one, so `[` / `(1, "a")` / `(2, "b")` / `]` on four lines is two tuples, not a call. A line starting with a binary operator, `.`, `?.`, `->`, or `-`/`*` followed by a space continues the item; `-1`, `*x` and `&x` glued to their operand start one. `,` at a line's end or start still separates.
- **A parameter pattern can't fail and has no name.** `fn f(Ok(value): Result<Int>)` is an error (use `match`). A destructured parameter is passed only by position, unless named with `as` (`fn length(Point{x, y} as self)` is a method). No patterns on `&` or rest parameters, externs, trait requirements, function types, or the paren-less `fn x: …`.
- **A variant with fields is only called, never built or taken apart in braces:** `Ok(v)`, `Err(e)`, `Rejected(by: "legal")`, its arguments binding to the fields as to a function's parameters (defaults and a rest included). `Ok{42}`, `Ok{value: v}`, a block below `Rejected:` and `case Ok{value}` are errors naming `Ok(…)`. A struct with one field still takes its value positionally: `UserId{"u-1"}`, `UserId{(id)}`. A pattern takes a variant's fields as a call gives them, `case Ok(v)`, `case Rejected(by: "legal", ...)`, a field without a default given or left with a last `...`. A variant is written as built: `Expired` bare (`Expired()` and `case Expired()` are warned of), and `case Rejected` alone, matching any `Rejected`, is warned of, naming `Rejected(...)`. Named without a call, a variant with fields is a function value: `vs.map(Result.Ok)`, or bare `Ok` where the expected function type's result gives the enum (`xs.map(Ok)` is an error naming `Result.Ok`). Any function named as a value takes type arguments as its call does, `listed<Int>`, `Box.of<Int>`, `vs.map(Result.Ok<Int, String>)`, which gives `map` the error type it can't infer from `Result.Ok`.
- **Struct spread does not add new fields (unlike TS `{ ...ctx, search }`).** `Req{...r, a: 2}` and `struct{...r, a: 2}` only override existing fields of `r`'s own type. To build a wider shape with an extra field, use a struct comprehension: `struct{search, for k, v in ...ctx: [k]: v}`.
- **Template interpolation of optionals:** `${x}` and `String(x)` require `x is Stringable`. `None` is not `Stringable`, so `x: T?` fails to interpolate directly; write `${x ?? ""}` or convert through a helper taking `T?`.
- **`while true:` has type `Unit`, not `Never`.** A value-returning function whose body ends in a `while true:` loop (returning inside the loop) must follow the loop with `panic("unreachable")`.
- **Operator & call traps:** Indent with spaces only. `??` mixed with `and`/`or` needs parentheses. `f<Int>(x)` and `f<Int>` take type arguments, read so only when the names in `<…>` start with a capital and nothing after the `>` goes on with a comparison: `a < b > (c)` and `f(a < b, c > d)` compare variables, while `a < B > (c)` is a call; parenthesize such a comparison as `(a < B) > c`.

**Types, unions, and generics**
- **No implicit `Int` → `Float` conversion.** `0` is `Int`, not `Float` (unlike TS `number`); write `0.0` or `Float(n)` where `Float` or `Float?` is expected. `/` yields `Float`; `//` and `%` are integer division/remainder (panicking on 0). `1.5h` is an error; write `90m`.
- **Unions are never inferred.** `if c: 1 else: "a"` or `if c: none else: "err"` is a compile error unless the expected type (`Int | String`, `String?`) is known from a type annotation or return type.
- **Generic variants as call arguments:** In `min(Prop.Fixed(1))` where `Prop<Sc, T>.Fixed` does not mention `Sc`, qualified `Prop.Fixed(1)` is checked before `min` is chosen and fails with `Can't infer 'Sc'`. Write the bare variant `min(Fixed(1))` (which defers to the parameter's expected type) or give explicit type arguments `Prop.Fixed<Sc, Int>(1)`.
- **Lambdas passed to generic functions:** A lambda with an untyped parameter `fn(sc): …` needs the call's parameter type to already know `Sc`. When `Sc` only comes from the enclosing return context, annotate the lambda parameter (`fn(sc: OrderScope): …`).
- **Indexing `s[k]` with a union key in generic code:** For `k: keyof C`, `self.cases[k]` has the union of field types, which has no associated types (`Self.Data`). Use `for k, g in ...self.cases:` or `struct{for k, g in ...self.cases: [k]: …}` so each pass checks `g` at its own key `k`.
- **Recursive types:** An alias may refer to itself only inside a type built from others: a nominal type's argument (an alias's only where its body guards its parameter), a shape's field, a tuple element, a function's parameter or result (`type Tree<T> = T | Array<Tree<T>>`, `type List = { head: Int, tail: List? }`). As the whole body or a member of its union it is an error (`type A = A | Int`), and each self-reference passes the alias's own parameters in order. An associated type refers to itself only through a `type match` (`type Data = match S: case _: { [F in keyof S]: S[F].Data }`).
- **Recursive conformance:** A recursive struct meets a struct constraint when its fields do, assuming it meets it while they are checked, and a recursive union likewise through its members; so `CategoryModel` with `children: List<Group<CategoryModel>>` meets `struct { [_] is FormNode }`. A cycle through traits alone is still bounded, not assumed.
- **Coherence:** A type meets a trait only through functions declared in the trait's module or the type's own module (never a third module, and only by the outer type, not its type arguments).

**Mutation, references, and lifetimes**
- **`const` is deeply immutable** (`const xs = [1]; xs.push(2)` is an error), stopping only at handles (`const u = new Lease{…}; u->renewals += 1` is valid). Shared struct fields use `->` (`u.renewals` is an error); `new` is used if and only if constructing a `shared struct`.
- **Reference rules:** `&` stands only before a call argument (`&x`). Passing two element/shared-field references in one call (`f(&xs[i], &xs[j])`, `f(&u->a, &w->b)`) or passing `&xs[i]` / `&u->a` to an async function is a compile error (copy into a local `let`, pass `&local`, and assign back).
- **Loop lifetimes:** `_ = q.sendRevertible(m)` or `_ = asyncCall()` inside a loop disposes at the end of **each iteration**; use `hold _ = …` to keep it alive until the enclosing function returns.
- **Boundaries:** Handles and plain `fn` values are not `Sendable` and cannot cross `spawn` or `extern`. A `sendable fn` (all captures sendable) is what `spawn` takes, but has no JSON form and cannot cross `extern` or `json`.
- **`defer` is a function:** a bare `defer f(x)` is an error, since the `Deferred` it gives must be kept (`_ = defer f(x)`), and `x` is computed where it is written; pass a lambda, `_ = defer(fn(): …)`, to read variables when it runs.
