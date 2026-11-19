---
description: the whole language at a glance, one line per construct; read first to recall a form's spelling, then follow its section for the rules
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# Cheat sheet

The whole language at a glance; each line is explained in the sections below.

**Values, variables and types**

```ista fragment
const limit: Int = 50_000          # immutable, deeply
let count = 0                      # mutable; type inferred
let a, b = (1, "x")                # tuple destructuring
_ = startSomething()               # unnamed variable: held until the block ends
hold _ = startJob()                # held until the function ends, even inside a loop
hold let pending = 0               # name block scoped, holdings function scoped
transient let depth = 0            # one per outermost call, shared by the calls nested in it
drop audit.record(event)           # discard a must-use value right away
const u = new Shared{value: user}  # a shared struct: a handle to its fields
u->value.name = "x"                # read or write behind it with -> and *
const api = Service:               # an indented value: a Service, laid out as its fields are
    name: "api"
    retry:                         # a nested struct, built as the field's type
        times: 3
    env:                           # a map: its keys are quoted
        "LOG_LEVEL": "debug"
    ports:                         # an array's items
        - 80
        - 443

"text"  'text'  `a ${x}`  42  1_000  0x1F  3.14  true  false  none  5d  30s
[1, 2]   ["a": 1]   [:]   [...xs, 3]   (1, "x")   0..10   0..=10

Int  Float  Bool  String  Unit  Never  None  (A, B)
A | B    "draft" | "sent"    T?                                # a union, literal types, T | None
Array<T>  Map<K, V>  Range  Future<T, K>  Slot<T>  Shared<T>  WeakRef<T>  Instance<T>
fn(A) -> R    live async fn(A) -> R    sendable fn(A) -> R    { sku: String, qty: Int }    # anonymous struct type
```

**Structs, enums and annotations**

```ista fragment
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
    Ok(value: T)
    Err(error: E)
enum Color { Red, Green, Blue }

Pair{first: 1, second: 2, meta: struct{tag: "x"}}
Pair{first, second}                # short for first: first, second: second
Ok(42)    Rejected(by: "legal")    # a variant with fields is called: its enum's function
vs.map(Result.Ok)                  # and named as a value, as any function is
vs.map(Result.Ok<Int, String>)     # given type arguments, as a call is
Req{...req, value: "new"}          # updated copy
userId: Int @JsonName{"user_id"}   # annotation on a field
```

**Functions, traits and generics**

```ista fragment
fn add(a: Int, b = 1):             # default parameter, types inferred
    a + b                          # the last expression is the value
fn log(level: String, ...parts: Array<String>): ...    # rest parameter
log("info", ...parts)                                  # spread into the rest
add(1, b: 2)                                           # named argument
fn call<...A, R>(f: fn(...A) -> R, ...args: A) -> R: ... # a pack: any parameters
fn push<T>(self: &Stack<T>, item: T): ...             # method, reference receiver
fn Duration.zero() -> Duration: ...                    # static function
ista async fn approve(req: Req) -> String: ...         # commits at every await
live async fn fetch(u: String) -> String: ...         # waits in memory, never commits
K async fn retry<K in Persistence, T>(f: Fn<(), Future<T, K>, K>) -> T: ...   # either kind

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

```ista fragment
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
struct{for K in keyof S: [K]: S[K].make()}        # over a type's keys: K is each key, a type and its value

match decision:
    case Approved(by): ...                        # a call pattern: fields as a call gives them
    case Rejected(by: "legal", ...): ...          # by name; ... leaves the others
    case Rejected(_, why) if why != "": ...       # a guard
    case _: ...
match review:
    case Verdict{ok == false}: ...                # a struct's fields: compare
    case Review{verdict is Verdict{ok == false}}: ... # nested
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
if r is Ok(y) and y > 0: use(y)

user?.name    name ?? "anonymous"    found!    chargeCard(id)?    # optional chaining, fallback, unwrap or panic, propagate Err
{ const t = a * b; t + 1 }                        # block expression
x = 1; y = 2                                      # two statements on one line
type UserId = String                              # type alias
shared struct Counter { n: Int }                  # a struct whose values are handles to a cell
```

**Concurrency, persistence and the host**

```ista fragment
const v = await fetch()            # an ista await commits, then waits; a live one waits in memory
const f = fetch()                  # already running; runs alongside while held

await select:                      # first ready case wins
    case box.receive() as msg: ...
    case time.delay(5d): ...
select:                            # non-blocking
    case box.receive() as msg: ...
    else: ...

const s = Slot.create<Int>()       # await s.put(1), s.take(), s.read()
box.send(m)    _ = box.sendRevertible(m)    await box.receive()
spawn purchase(req)                # a new, independent instance; req computed now
_ = defer log("exited")            # runs when this block ends, however it ends
worker.disposing()                 # inside async fn worker: graceful-disposal signal
await runtime.commit()             # commit without waiting
await runtime.delegate charge(id)  # live work, run after the commit, again until its result commits
panic("bug")                       # freeze the instance for an operator

import Inbox from 'inbox'          # names starting with _ are private
extern fn chargeCard(id: String) -> Result<String>
extern purchaseRequests: Queue<Req>
```
