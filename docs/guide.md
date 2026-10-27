---
description: A developer's guide to writing Istalang programs, breadth first — the whole language in one page, then each part with code, then the rules that bite; read it to learn the language fast, and docs/spec.md for exact rules
owner: tech-lead
status: active
applies_to: istalang
last_updated: 2026-10-27
tags: [language, guide]
---

# Istalang, level by level

Read top to bottom and stop anywhere: each level is a complete picture, only coarser than the next.

- **Level 0**: what the language is, in one paragraph.
- **Level 1**: the eight ideas that shape every program.
- **Level 2**: each idea with code.
- **Level 3**: the rules that surprise people.

The spec, `docs/spec.md`, is the source of truth; `§` numbers point into it.

---

## Level 0: what it is

Istalang is a Python-shaped, statically typed language for **durable workflows**: programs that wait for days on a person, a timer or another system, and survive restarts while they wait. At every `await` the runtime saves the program's whole state, so it can resume from that line later, even on another machine. The program reaches the outside world only through functions the host provides, declared `extern`.

```python
async fn remindLater(role: string):
    await time.delay(1d)              # saved here; resumes a day later, even after a restart
    notifications(role).send(Notice{text: "Reminder"})
```

---

## Level 1: the eight ideas

1. **Python syntax, strict types.** Indentation, `#` comments, no `any`, no implicit conversions. Locals and return types are inferred; parameters and fields are annotated.
2. **Values are copied.** Structs, arrays, maps and tuples are copied whenever they are assigned, passed, returned or sent. To change a caller's data you pass `&x`, or share a *handle*, whose copies all point at one thing.
3. **Everything that branches is an expression.** `if`, `match`, `select` and `{ … }` blocks produce values. A function returns its last expression.
4. **Errors are values; bugs panic.** A function that can fail returns `Result`, and `?` passes the error up. A bug, such as an index out of range, panics and freezes the instance for an operator.
5. **`await` is the save point.** The code between two `await`s is one atomic *segment*: it commits at the next `await`, or, after a crash, never happened. Only an `async fn` may `await`.
6. **Concurrency without threads.** An `async fn` called without `await` starts running alongside its caller. Executions coordinate through futures, `select`, slots and inboxes. `spawn` starts a separate, independent instance.
7. **Lifetimes follow blocks.** When a block ends, whatever it alone holds is disposed: unfinished calls stop, timers are cancelled and unread revertible messages are retracted. This always happens at a line you can point to.
8. **The host is the only I/O.** `extern` functions, constants and types are implemented by the host, and values cross as JSON. A deploy freezes the code: each instance runs to the end on the version it started with.

---

## Level 2: each idea, with code

### 2.1 A whole program

```python
import * as time from 'time'

struct PurchaseRequest { id: string; amount: int }
struct Verdict { role: string; ok: bool }

extern purchaseRequests: Queue<PurchaseRequest>          # provided by the host
extern fn verdicts(id: string) -> Queue<Verdict>
extern fn chargeCard(id: string, amount: int) -> Result<string>

async fn main():                                         # the one entry point
    while true:
        const req = await purchaseRequests.receive()     # saved; may wait for weeks
        spawn purchase(req)                              # each purchase is its own instance

async fn purchase(req: PurchaseRequest) -> Future<string>:
    const deadline = time.delay(5d)                      # a timer, running from now
    const verdict = await select:                        # whichever comes first
        case verdicts(req.id).receive() as v: v
        case deadline: return "expired"
    if not verdict.ok:
        return "rejected by " + verdict.role
    match chargeCard(req.id, req.amount):
        case Ok{value as receipt}: "paid: " + receipt
        case Err{error}: "failed: " + error.message
```

`Queue` and its `receive` are host declarations as well (spec §12.1). A file holds only declarations: no top-level statements and no top-level variables, though a `const` computable at compile time is allowed.

### 2.2 Syntax, types, variables (§2, §3.4)

```python
const limit: int = 50_000      # immutable, deeply
let count = 0                  # mutable, inferred int
count += 1
const a, b = (1, "x")          # destructuring
```

| Type | Notes |
| --- | --- |
| `int` `float` `bool` `string` | `int` never overflows; `string` counts Unicode code points |
| `unit`, `never` | `unit` is `()`, the type of statements; `never` is the type of `return` and `panic` |
| `T?` | optional; empty is `none`; a `T` is wrapped into a `T?` automatically |
| `(A, B)` | tuple: `t.0`, `t.1` |
| `Array<T>`, `Map<K, V>`, `Range` | values, copied like structs |
| `fn(A) -> R`, `async fn(A) -> R` | function values |
| `Future<T>` `Slot<T>` `Inbox<T>` `Shared<T>` `WeakRef<T>` | **handles**: a copy points at the same thing |
| `Time`, `Duration`, `Decimal` | from the standard library |

Literals: `"a"` `'a'` `42` `1_000` `0x1F` `3.14` `true` `none` `500ms` `30s` `15m` `2h` `5d` `[1, 2]` `["k": 1]` `[:]` `[...xs, 3]` `(1, "x")` `0..10` (excludes 10) `0..=10`.

Names: types are `PascalCase` and everything else is `camelCase`, and the compiler enforces both. A top-level name starting with `_` is private to its module.

### 2.3 Data: structs, enums, optionals (§3.1, §3.11, §3.18)

```python
struct Order:
    id: string
    items: Array<{ sku: string; qty: int }>     # anonymous struct type
    retries: int = 3                            # field default

const o = Order{id: "o1", items: [struct{sku: "a", qty: 2}]}
const o2 = Order{...o, retries: 5}              # updated copy; o is untouched
const id = "o2"
const o3 = Order{id, items: []}                 # id is short for id: id

enum Decision:
    Approved { by: string }
    Rejected { by: string; reason: string }
    Expired
```

- **Optional** `T?` is the enum `Some{value}` or `None`. Read through it with `user?.name`, and supply a fallback with `name ?? "anon"`.
- **Result** `Result<T>` is the enum `Ok{value}` or `Err{error}`, where `error` is an `Error{message, code, trace}`.
- **Collections** use JavaScript's method names: `length()`, `push`, `pop`, `map`, `filter`, `indexOf`, `slice`. `xs[i]` panics when out of range, and `xs.at(i)` returns a `T?` and accepts negative indexes. On maps, `m[k]` panics for a missing key and `m.get(k)` returns a `V?`.

**Shared structs** are how you get identity. Their values are handles to one cell, built with `new`, read and written through `->`:

```python
shared struct Lease:
    name: string
    renewals: int = 0

fn renew(self: Lease):
    self->renewals += 1          # every copy of the handle sees it

const lease = new Lease{name: "db"}
const alias = lease              # the same lease: alias == lease
lease.renew()                    # alias->renewals is now 1
const snapshot = *lease          # a plain copy of the fields
```

`Shared<T>` is the ready-made one: `new Shared{value: v}`, then `x->value`.

### 2.4 Functions (§3.3, §3.7, §3.14)

```python
fn add(a: int, b = 1): a + b                      # default parameter; return type inferred
fn log(level: string, ...parts: Array<string>): … # rest parameter
fn area(self: Circle) -> float: …                 # a method: first parameter is self
fn push<T>(self: &Stack<T>, item: T): …           # &self lets the method change its receiver
fn Duration.zero() -> Duration: …                 # static function, called Duration.zero()
async fn fetch(id: string) -> Future<User>: …     # may await; inside it, return a User
```

- **Overloading.** Functions are told apart by parameter types, never by return type.
- **References.** A caller writes `&x` to let a function change its variable. A reference lives only for the call: it can't be stored or returned.

  ```python
  fn bump(n: &int): n += 1
  let x = 1
  bump(&x)                 # x is 2
  ```

- **Lambdas.** `fn(x): x * 2` and `fn x: x > 0`; several statements go in a block, `fn(m): { log(m); save(m) }`. A closure shares the `let`s it captures and copies the `const`s.
- **Conversions.** `float(3)`, `int(3.7)` (3) and `string(42)` can't fail. Fallible ones return a `Result`, such as `int.parse("42")`.

### 2.5 Generics, traits, operators (§3.5, §3.9, §3.10)

```python
fn swap<A, B>(p: Pair<A, B>) -> Pair<B, A>: Pair{first: p.second, second: p.first}

trait Monoid:
    fn Self.zero() -> Self
    fn add(left: Self, right: Self) -> Self

fn sum<T is Monoid>(xs: Array<T>) -> T:
    let total = T.zero()
    for x in xs: total = total + x
    total
```

- **Traits only constrain type parameters.** They are never the type of a variable. A type satisfies a trait just by having the functions, with no `impl` blocks.
- **Operators are functions.** `a + b` calls `add(a, b)`, so declaring `fn add(left: Money, right: Money) -> Money` gives `Money` a `+`. `<`, `>`, `<=` and `>=` all go through one `compare`, `x[k]` through `index`, and `for` through `iterate`.
- **`==` is built in.** It compares values structurally and handles by identity, and it can't be overloaded.

### 2.6 Control flow and patterns (§4, §3.11)

```python
const size = if n < 10: "small" elif n < 100: "medium" else: "large"
for i in 0..10: total += i
for key, value in m: …
const evens = [for x in xs if x % 2 == 0: x * 2]          # comprehension
const t = { const base = price * qty; base + tax(base) }  # block expression

const text = match decision:          # must cover every variant, or end with case _
    case Approved{by}: "approved by " + by
    case Rejected{reason as why} if why != "": "rejected: " + why
    case Rejected{by}: "rejected by " + by
    case Expired: "expired"

if r is Ok{value as y} and y > 0: use(y)                  # a pattern outside match
```

Inside a pattern's braces: `field` binds it, `field as name` renames it, `field == expr` compares it, and `field is Pattern` nests a pattern.

### 2.7 Errors (§3.12)

```python
async fn pay(req: Req) -> Future<Result<string>>:
    const receipt = chargeCard(req.id, req.amount)?   # on Err, return the Err from pay
    Ok{(receipt)}
```

- **A `Result` must be used.** Match it, `?` it, store it, or `drop` it (`drop audit.record(e)`).
- **`panic("msg")`** commits nothing and freezes the instance at its last save, with nothing disposed. An operator then retries it or terminates it.

### 2.8 Persistence (§5)

- **Every `await` commits**, even on a future that has already resolved. To commit without waiting, write `await runtime.commit()`.
- **A segment is atomic.** Its state changes, messages and disposals all commit together, or none of them do.
- **Execution is deterministic.** `now()` returns the time its segment started, and extern results are recorded in the snapshot.
- **Extern calls are not transactional.** A segment discarded by a crash re-runs, and calls its externs again, so make them idempotent.
- **Versions are frozen.** An instance runs its whole life on the code it started with, while a deploy starts the new version's `main`.

### 2.9 Concurrency (§6, §8, §9)

```python
const a = fetchA()          # started already; runs alongside
const b = fetchB()
const both = (await a, await b)
```

- **`select`** waits for the first of several futures. Every losing case is disposed, so a call that lost is stopped and a `receive` that lost consumes nothing.

  ```python
  const deadline = time.delay(5d)           # create once, reuse in every iteration
  while true:
      await select:
          case jobs.receive() as job: handle(job)
          case deadline: break
  ```

  A `select` without `await` never waits and needs an `else:` case.
- **Slots** are the one primitive. A `Slot<T>` is empty or full, and its `put(v)`, `take()` and `read()` each return a future.
- **Inboxes** are queues built on slots: `Inbox.create<T>()`, then `box.send(m)` (durable), `_ = box.sendRevertible(m)` (retracted if unread when its holder goes) and `await box.receive()`.
- **The library** builds the rest: `futures` (`all`, `any`, `race`, `timeout`, `retry`, `quorum`), `rpc` for request and response, and `fanout` for broadcast.
- **`spawn f(args)`** starts a new, independent instance and doesn't wait. Its arguments must be *sendable*, meaning plain data: no handles, and no closures unless typed `sendable fn`.

### 2.10 Lifetimes and disposal (§7)

The runtime disposes a resource, such as an unfinished call's future, a slot, an inbox, a timer or a revertible message, when its **last holder** lets go. Holders are variables, fields, elements and captures, and a block releases its variables when it ends.

```python
_ = startJob()              # held until this block ends
hold _ = startJob()         # held until the function ends, even when written in a loop
drop x                      # release now
defer fn(): log("exited")   # runs when the block ends, however it ends
```

```python
async fn approve(req: Req, roles: Array<string>) -> Future<string>:
    for role in roles:
        hold _ = reviewQueue(role).sendRevertible(req) # kept until approve returns
    …
    # when approve returns by any path, every unread review request is retracted
```

- **Storing or returning** a resource keeps it alive. There is no escape rule.
- **Graceful stop.** Inside `async fn worker`, a `case worker.disposing():` in a `select` runs synchronous cleanup when the call is being disposed.
- **Watching without holding.** A `WeakRef(x)` refers to `x` without keeping it alive. `w.deref()` returns an optional, and `w.disposed()` is a future that resolves when `x` goes.
- **Custom resources.** Only a shared struct or an extern type can be disposable, by declaring `fn dispose(self: T)` beside it.

### 2.11 Modules, host, JSON, tools (§3.6, §3.13, §9, §11)

```python
import approve, Verdict from 'purchase/approve'   # a project file: purchase/approve.ista
import * as time from 'time'                      # a standard-library module
import helper from './helper'                     # relative to this file
```

- **Modules.** Every top-level name is exported unless it starts with `_`. Import cycles are fine, and the prelude (`Optional`, `Result`, `Array`, `panic`, …) needs no import.
- **Standard library modules:** `time`, `math`, `decimal`, `strings`, `json`, `regex`, `crypto`, `random`, `log`, `runtime`, `inbox`, `collections`, `futures`, `rpc`, `fanout` and `testing`. None of them touches files, the network or the environment.
- **Externs.** `extern fn`, `extern name: Type` and `extern struct` are implemented by the host. Their values cross as JSON: a struct becomes an object, an enum an object with a `"type"` field, `none` becomes `null` or a missing field, and `@JsonName{"user_id"}` or `@JsonSkip` adjust a field. Inbound JSON is validated before the program sees it.
- **JSON in code.** `json.parse<T>(s)` returns a `Result<T>`, and `json.stringify(v)` goes the other way.
- **Tools:**

  | Command | Does |
  | --- | --- |
  | `ista check` | type-checks every `.ista` file |
  | `ista run main.ista` | runs `main` and prints its outcome |
  | `ista run --store <dir>`, `--resume <id>` | runs with saves kept on disk, then resumes from them |
  | `ista run --host host.js` | implements the externs in JavaScript |
  | `ista vendor`, `ista verify` | copy dependencies into `vendor/`, then check them |

  Packages are Git repositories, pinned in `ista.json` and vendored.

### 2.12 Testing (§10)

```python
@Suite{"purchase"}
fn suite() -> Array<Test>: [
    test("expires after 5 days", withPurchaseEnv, async fn(env): {
        const t = testing.start(purchase, PurchaseRequest{id: "p1", amount: 900})
        await t.idle()                    # everything so far has committed
        env.clock.advance(5d)
        assertEq(await t.result(), "expired")
    }),
]
```

- **Isolation.** Each test runs in a fresh instance, and only `*.test.ista` files may import `testing`.
- **Mocks.** `hold _ = mock(chargeCard, fakeCharge)` replaces a function while the mock is held, and `FakeClock` controls time by mocking `time.now` and `time.at`.
- **Crash testing.** `testing.start(f, args…, crashEveryAwait = true)` re-runs every segment once before committing it, which catches extern calls that aren't idempotent.
- **Waypoints.** `@Waypoint{"approval"}` on an `await` names the spot, for `t.reaches("approval")` and for operators.

---

## Level 3: rules that bite

**Syntax**
- Indent with spaces only; a tab is an error.
- `if x: a; b` is an error, since readers would expect both in the body. Write `if x: { a; b }`.
- `??` mixed with `and` or `or` needs parentheses.
- `f<A>(x)` parses as type arguments, so a comparison that looks like one needs parentheses: `(a < b) > c`.
- These are missing in v0.1: string interpolation (write `"id: " + id`), `try`/`catch`, force-unwrap `!` and top-level statements.

**Values and mutation**
- A `const` is deeply immutable (`const xs = []; xs.push(1)` is an error), but a handle behind it still changes: `const u = new Lease{…}; u->name = "x"` is fine.
- Parameters are immutable. To change the caller's data, take a `&T` parameter.
- `&` stands only before a whole call argument. `f(&xs[i], &xs[j])` is an error.
- Passing an element (`&xs[i]`) or a shared struct's part (`&u->items`) to an **async** function is an error. Copy it into a `let`, pass that, and assign it back.
- `a[1..3]` is a copy, and `for x in c` iterates over a copy.
- A shared struct's fields are reached only with `->`; `x.field` is an error. `new` builds only shared structs, and shared structs only with `new`.
- Two anonymous structs with the same fields are still different types. Name the struct to reuse a shape.
- A field whose type is its own struct must be optional (`next: Node?`) or sit inside a collection.

**Construction and patterns**
- `Ok{value}` means *the field named `value`*, never "the variable `value` positionally". Write `Ok{(value)}` or `Ok{value: value}`. Patterns have no positional form at all: `case Ok{value as receipt}`.
- A bare variant needs an expected enum type. Otherwise qualify it: `Decision.Expired`.
- An empty `[]` or `[:]` needs an expected type: `let xs: Array<int> = []`.
- In a pattern, a bare camelCase name **binds** a new variable. To compare against a constant, use a guard (`case n if n == limit`).
- A literal pattern isn't wrapped into an optional. Against an `int?`, write `case Some{value == 1}`.

**Numbers**
- `/` always yields a `float`; `//` is integer floor division. `x // 0` and `x % 0` panic, while `x / 0` gives an infinity.
- `int(3.7)` is 3, and `int` of NaN or an infinity panics.
- `1.5h` is an error; write `90m`.

**Functions**
- A lambda or local `fn` can't be generic or have defaults or a rest parameter.
- An untyped lambda parameter needs an expected function type to infer it from.
- A method isn't a value: `s.push` without a call is an error, so wrap it as `fn x: s.push(x)`. An overloaded function named as a value needs an expected type to pick the overload.
- A recursive function declares its return type.
- Local functions aren't hoisted, so declare one before using it.
- `fn f(self: S)` and `fn f(self: &S)` can't coexist.

**Async and persistence**
- A future or a `Result` left as a bare statement is a compile error, which catches a forgotten `await`. Await it, keep it in `_ =`, or `drop` it.
- Calling an async function runs it at once, inside your segment, until its first `await`.
- Extern calls may run twice after a crash. Test with `crashEveryAwait`.
- `select` evaluates its cases top to bottom, and the first case wins a tie. A case without `as` discards its value, so a future of a `Result` needs `as`.
- A timer created inside a loop restarts every iteration. Create a deadline once, outside it.
- An `await` inside a `disposing()` case aborts the call; the compiler warns about it.

**Lifetimes**
- `_ = q.sendRevertible(m)` **inside a loop** retracts the message at the end of each iteration. Use `hold _` to keep it until the function returns.
- `_ = slowCall()` stops that call when the block ends, unless it has finished by then.
- Temporaries are released at the end of their statement, and an `if` or `while` condition's temporaries before its body runs.
- When `main`, or any instance's root function, returns, everything it holds is disposed.
- A panic disposes nothing and runs no `defer`.
- A variable can't be used after `drop x`, unless a `let` is assigned again first.

**Crossing boundaries**
- `spawn` arguments and extern types must be sendable. Handles, plain closures and anything containing them are compile errors. A `sendable fn` may be spawned but never crosses to the host.
- A function with a `&` parameter can't be spawned.
- A JSON field is required even when the struct gives it a default, a float NaN is written as `null` and can't be read back, and an enum variant can't have a field named `type`.
- A map compares keys with `==`, so a key containing NaN is stored but never found again, and map iteration order is unspecified.
