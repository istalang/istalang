# Istalang Specification (Draft v0.1)

Oct 20, 2026 · @Ares

## Cheat sheet

The whole language at a glance; each line is explained in the sections below.

**Values, variables and types**

```python
const limit: int = 50_000          # immutable, deeply
let count = 0                      # mutable; type inferred
let a, b = (1, "x")                # tuple destructuring
_ = startSomething()               # unnamed variable: held until the block ends
fn _ = startJob()                  # held until the function ends, even inside a loop
fn let pending = 0                 # name block scoped, holdings function scoped
drop audit.record(event)           # discard a must-use value right away
const u = Shared(user)             # a shared handle
u$.name = "x"                      # read or write the shared value with $

"text"  'text'  42  1_000  0x1F  3.14  true  false  none  5d  30s
[1, 2]   ["a": 1]   [:]   [...xs, 3]   (1, "x")   0..10   0..=10

int  float  bool  string  unit  never  T?  (A, B)
Array<T>  Map<K, V>  Range  Future<T>  Slot<T>  Shared<T>  WeakRef<T>
fn(A) -> R    async fn(A) -> R    { sku: string; qty: int }    # anonymous struct type
```

**Structs, enums and annotations**

```python
struct Pair<A, B>:
    first: A
    second: B
    meta:                          # inline anonymous struct
        tag: string
struct Req { id: int; value: string }

enum Result<T, E = Error>:
    Ok { value: T }
    Err { error: E }
enum Color { Red; Green; Blue }

Pair{first: 1, second: 2, meta: struct{tag: "x"}}
Pair{first, second}                # short for first: first, second: second
Ok{42}    Ok{(receipt)}            # single field, positional; a bare name needs ( )
Req{...req, value: "new"}          # updated copy
userId: int @JsonName{"user_id"}   # annotation on a field
```

**Functions, traits and generics**

```python
fn add(a: int, b = 1):             # default parameter, types inferred
    a + b                          # the last expression is the value
fn log(level: string, ...parts: Array<string>): ...    # rest parameter
fn push<T>(self: &Stack<T>, item: T): ...             # method, reference receiver
fn Duration.zero() -> Duration: ...                    # static function
async fn approve(req: Req) -> Future<string>: ...

fn(x): x * 2    fn x: x > 0    fn(msg): { log(msg); save(msg) }   # lambdas
const fact = fn f(n: int) -> int: { ... }             # named lambda: f calls itself
g(&value)    float(3)    a[1..3]    m["a"] = 2         # reference, conversion, slice, index

trait Addable<T = Self>:
    fn add(left: T, right: T) -> T
fn sum<T is Addable & Monoid>(xs: Array<T>) -> T: ...
```

**Control flow and patterns**

```python
if amount > 100:
    escalate()
elif amount > 10:
    review()
else:
    approve()
const size = if n < 10: "small" elif n < 100: "medium" else: "large"   # one-line if expression
for i in 0..10: ...
while pending: ...
const small = [for x in xs if x < 20: x * 2]      # array comprehension

match decision:
    case Approved{by}: ...                        # binds the field by
    case Rejected{reason as why} if why != "": ... # rename, guard
    case Verdict{ok == false}: ...                # compare
    case Some{value is Verdict{ok == false}}: ... # nested
    case _: ...
if r is Ok{value as y} and y > 0: use(y)

user?.name    name ?? "anonymous"    chargeCard(id)?    # optional chaining, fallback, propagate Err
{ const t = a * b; t + 1 }                        # block expression
x = 1; y = 2                                      # two statements on one line
type UserId = string                              # type alias
```

**Concurrency, persistence and the host**

```python
const v = await fetch()            # every await commits, then waits
const f = fetch()                  # already running; runs alongside while held

await select:                      # first ready case wins
    case box.receive() as msg: ...
    case time.delay(5d): ...
select:                            # non-blocking
    case box.receive() as msg: ...
    else: ...

const s = Slot.create<int>()       # await s.put(1), s.take(), s.read()
box.send(m)    _ = box.sendRevertible(m)    await box.receive()
spawn purchase(req)                # a new, independent instance
defer fn(): log("exited")          # runs when this block ends, however it ends
worker.disposing()                 # inside async fn worker: graceful-disposal signal
await runtime.commit()             # commit without waiting
panic("bug")                       # freeze the instance for an operator

import Inbox from 'inbox'          # names starting with _ are private
extern fn chargeCard(id: string) -> Result<string>
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
- **Value semantics.** Structs and collections are copied when assigned, passed, returned or sent. Data that other code holds changes only through an explicit `&` reference or a `Shared` value.
- **Everything that branches is an expression.** `if`, `match` and `select` produce values, and the compiler checks that all branches have the same type.

## 2. Lexical structure and types

Blocks are defined by indentation, as in Python. Comments start with `#`. Top-level declarations may appear in any order. A `;` separates statements written on one line: `a = 1; b = 2`.

Every expression has a static type, and there is no `any` type. There are no implicit conversions, with one exception: a `T` is wrapped into `T?` wherever an optional is expected (§3.11).

| Type | Meaning |
| --- | --- |
| `int`, `float`, `bool`, `string` | Primitives: language built-ins, not structs. Booleans are `true` / `false`. |
| `unit` | The type of statements and of blocks that end in a statement. It is the empty tuple `()`. |
| `never` | The type of `return`, `break`, `continue` and `panic`. It fits wherever any type is expected. |
| `T?` | Sugar for `Optional<T>`, an ordinary enum (§3.11). The empty value is `none`. |
| `Time`, `Duration` | Standard-library structs wrapping an `int` of milliseconds (§3.8). |
| `Array<T>`, `Map<K, V>` | Generic collections (§3.8). They are values and are copied like structs. |
| `Range` | A span of integers written `a..b`, half-open (§3.8). |
| `Slot<T>` | Handle to a slot shared by the concurrent executions of one instance: empty or full (§6). |
| `Future<T>` | Read-only view of a slot: something to wait on (§6). |
| `Inbox<T>` | Standard-library message queue built on slots (§6). |
| `Shared<T>` | Handle to a mutable value in the instance's own memory: every copy sees the same value, read and written as `x$` (§3.8). |
| Struct types | Declared with `struct` (§3.1). They may be generic. |
| Enum types | Declared with `enum` (§3.11): exactly one of several variants. `Result<T>` is one (§3.12). |
| Function types | `fn(A, B) -> R`, `async fn(A) -> R` (§3.14). |
| Tuple types | `(A, B)`: a fixed number of values, by position (§3.15). |

Primitive types are lowercase language built-ins and are always sendable. Every other type name, built-in or user-defined, is PascalCase. The other built-in types are ordinary declarations in the prelude and standard library (§3.8).

Duration literals are sugar for the standard library's `Duration`: a number plus a unit (`500ms`, `30s`, `15m`, `2h`, `5d`). For example, `5d` means `Duration{value: 5 * 24 * 60 * 60 * 1000}`.

**Literals:**

- **Strings:** `"…"` or `'…'`, with the escapes `\n`, `\t`, `\\`, `\"`, `\'` and `\u{…}`.
- **Numbers:** `42`, `1_000_000`, `0x1F` and `0b1010` for `int`; `3.14`, `1e9` and `2.5e-3` for `float`.
- **`true`, `false` and `none`.**
- **Arrays:** `[1, 2, 3]`, and `[]` when empty.
- **Maps:** `["legal": 1, "cfo": 2]`, and `[:]` when empty. Keys are expressions.
- **Spread:** `[...xs, 4]` and `[...m, "a": 2]` build a new array or map from an existing one plus more elements or entries.
- **Tuples:** `(1, "x")`, and `()` for `unit`.
- **Ranges:** `3..5` covers 3 and 4 (half-open), `3..=5` includes 5, and either end may be left out: `..5`, `3..`.
- **Structs and enum variants:** `Pair{first: 1, second: 2}`, `Rejected{by: "legal"}`, and `Ok{42}` for a type with a single field. A type without fields is just its name. `struct{value: 1}` is a struct literal whose type comes from context (§3.1).
- **Lambdas:** `fn(x): x * 2` (§3.14).

**What each kind of bracket means.** `[…]` is for collections: array and map literals, indexing and slicing. `{…}` is for structured values and blocks: after a type name or `struct` it constructs a value, in a type position it lists fields, and a bare `{…}` in an expression is a block (§4). `(…)` is for calls and conversions (§3.10), tuples and grouping. A map literal works for any type that satisfies `IndexAssignable<K, V>` and `Default` (§3.10), given an expected type `C`: `[k1: v1, k2: v2]` builds `C.default()` and assigns each entry with `c[k] = v`, and an empty `[]` or `[:]` builds just `C.default()`. Without an expected type, `[k: v]` makes a `Map<K, V>`.

**Numbers.** `int` has arbitrary precision, as in Python, so it never overflows. `float` is an IEEE 754 double. `/` always yields a `float`, and `//` is floor division on `int`s. For exact decimal arithmetic, such as money, the standard library has `Decimal`.

Type annotations are required on the parameters of declared functions and on struct fields. A lambda may omit parameter types when the expected function type gives them (§3.14), and a parameter with a default value may omit its type, which is then inferred from the default. Return types may always be omitted, on any function, exported or not, and are then inferred from the body; a recursive function writes its own, since its body refers to it. A local `let` or `const` may omit its annotation when the initializer's type is unambiguous. Type parameters are written in angle brackets (§3.5).

## 3. Declarations

A program consists only of top-level declarations: imports, structs, enums, traits, type aliases, functions, `extern` declarations, and `const` values computable at compile time (literals, and structs, arrays and maps built from them). There are no top-level variables or statements.

### 3.1 Structs

A struct is a named record with typed fields, one per line. Structs are ordinary types: use them for variables, parameters, return values and inbox messages alike.

```python
struct ReviewRequest:
    purchaseId: string
    amount: int
    replyTo: Inbox<Verdict>
```

Construction lists the fields in braces after the type's name: `ReviewRequest{purchaseId: "P-1", amount: 900, replyTo: replies}`. As in JavaScript, a bare name is always short for a field of the same name: `Pair{first, second}` means `Pair{first: first, second: second}`. A struct with exactly one field may take its value without the field's name, as long as that value isn't a bare name: `UserId{"u-1"}` and `UserId{prefix + id}` are positional, while `UserId{id}` always means the field `id`. To pass a variable positionally, wrap it in parentheses: `UserId{(id)}`. Both a reader and the parser can therefore tell the forms apart without knowing the struct's fields. A struct with no fields is written bare. An updated copy spreads an existing value and overrides some fields: `Req{...req, amount: 0}` is `req` with `amount` changed, and `req` itself is untouched; `struct{...req, amount: 0}` does the same, taking the type from `req`. Structs can be destructured in `match` patterns. Fields have no visibility modifiers: any code can read them, since any module could declare a method on the struct anyway. Names of functions, methods, variables and fields are camelCase, preferring JavaScript's names where one exists (`push`, `indexOf`).

**Anonymous structs.** `struct { … }` is a struct type without a name, usable anywhere a type is. In a type position the keyword may be left out, since a `{` there can only be a field list: `Array<struct { sku: string; qty: int }>` and `Array<{ sku: string; qty: int }>` are the same type, and a formatter can pick one style. An indented block under a field is sugar for one, and any struct declaration may use braces on a single line, as in `struct Req { id: int; value: string }`.

```python
struct Response:
    id: string
    data:                          # sugar for  data: { value: int; result: string }
        value: int
        result: string
    items: Array<{ sku: string; qty: int }>

struct Req { id: int; value: string }

const value = 1
const r = Response{
    id: "x",
    data: struct{value, result: "ok"},       # value is short for value: value
    items: [struct{sku: "a", qty: 2}],
}
```

A `struct{…}` literal takes its type from context: the expected type where there is one, such as the field or array element above, and otherwise a fresh anonymous type. An anonymous struct has no name to mention elsewhere: when a shape is needed in more than one place, declare a named struct. Two anonymous structs are always different types, even with identical fields, so the type checker never compares shapes.

**Recursive types.** A struct or enum may refer to itself, directly or through other types: `struct Node { value: int; children: Array<Node> }`. A field whose type is the struct itself must be optional (`next: Node?`) or sit inside a collection, so that every value stays finite.

**No getters or setters.** Reading or assigning a field never runs code; a value computed from fields is a method, such as `order.total()`. This keeps structs plain data under value semantics.

**Value semantics.** Structs, arrays and maps are values. They are copied structurally, field by field, when assigned, passed to a function, returned or sent. A function that modifies a by-value parameter changes only its own copy. The only ways a function can change data its caller holds are an explicit reference (§3.7) and a `Shared` value (§3.8). `Slot<T>`, `Future<T>`, `Inbox<T>`, `Shared<T>`, `WeakRef<T>` and `Revertible<T>` are **handles**: copying one copies the handle, not the state behind it, and `==` compares handles by identity.

**Sendable types.** Only sendable values can leave an instance: as `spawn` arguments, or through extern declarations. Sendable types are the ones that satisfy the built-in `Sendable` trait (§3.10). A type is sendable when either:

- it is an extern struct declared `sendable` (§3.8) and all its type arguments are sendable, or
- it is a user struct whose fields are all sendable. This is derived automatically.

Futures, slots, `Shared` values, weak references and function values are never sendable, and neither is any value that contains one, such as an inbox. They therefore never leave the instance that created them: `spawn` arguments and extern declarations can't contain them, which is a compile error.

### 3.2 Slots and inboxes

`Slot<T>` is the runtime's one primitive for sharing values between the concurrent executions of an instance, and `Inbox<T>` is the standard library's message queue built on it; both are described in §6. Queues that outlive every instance aren't part of the language: the host provides its own through extern declarations (§3.6).

### 3.3 Functions

```python
fn total(items: Array<int>) -> int:                        # may not await
    ...

async fn approve(req: PurchaseRequest) -> Future<string>:  # may await
    ...

extern fn chargeCard(id: string, amount: int) -> Result<string>  # implemented by the host
```

- A function's value is the value of its body's last expression, or the value given to `return`. Its return type may be omitted and is then inferred (§2).
- An `async fn` declares its real return type, `Future<T>`. Inside it, `return` and the body's value have type `T`, and `await` on the call yields that `T`.
- Calling an `async fn` starts the callee right away. The future must be awaited, passed to `select`, stored in a variable (`_` included), or released with `drop`. Leaving it unused as a bare expression is a compile error, which catches a forgotten `await`. A stored future keeps running until it finishes or is disposed (§7).
- When a block ends, including a function's body, it releases everything its variables hold, disposing whatever nothing else holds (§3.4, §7).
- `extern fn` declares a host function with a typed signature and no body (§3.6).

```python
fn retry(times: int = 3, backoff: Duration = 1s): ...
retry()                      # retry(3, 1s)
retry(5)                     # retry(5, 1s)

fn log(level: string, ...parts: Array<string>): ...
log("info", "a", "b")        # log("info", ["a", "b"])
log("info", "a", ...more)    # parts is "a" followed by the elements of more
```

**Default parameters** are sugar for overloads. Parameters with defaults come after the others, and for each shorter call the compiler declares an overload that calls the full function with the missing values. A default is an expression evaluated at every call, and it may use earlier parameters, as in `fn window(start: int, end: int = start + 10)`. Such a parameter may omit its type, which is inferred from the default: `fn retry(times = 3)`. A generated overload that clashes with a declared one is a compile error.

**Rest parameters** are sugar for an array. The last parameter, written `...name: Array<T>`, comes after any parameters with defaults and collects the remaining arguments; `...xs` at a call site spreads an existing array into them. When a call matches both a fixed-arity overload and one with a rest parameter, the fixed one wins.

### 3.4 Variables

```python
const limit: int = 50_000          # immutable
let count = 0                      # mutable; inferred: int
count = count + 1

const roles = ["legal", "finance"]
roles.push("cfo")                  # compile error: roles is const
```

`let` declares a mutable variable and `const` an immutable one. A `const` is deeply immutable: it can't be reassigned, its fields and elements can't be changed, and you can't take `&` of it, so mutating methods like `push` are rejected. Immutability stops at handles: a `const` slot or inbox can still be used, and the contents of a `const` `Shared` can still change through `x$`, because that changes the state behind the handle, not the handle itself. The compiler warns about a `let` that is never reassigned or mutated.

Variables are block scoped: a variable is visible only inside the block that declares it and in blocks nested within it. A variable declared inside an `if` body does not exist after the `if`. A loop variable (`for x in xs`) and every variable declared in a loop body are fresh on each iteration, so closures created in different iterations never share them. Unlike Python, assigning to an undeclared name is a compile error.

**Lifetimes follow blocks too.** When a block ends, whether it finishes or is left through `return`, `break`, `continue` or disposal, it releases everything its variables hold (§7). A loop body is a block, so each iteration releases its own holdings. `fn let` and `fn const` declare a variable whose *name* is still block scoped but whose holdings last until the enclosing function ends, which is how a loop keeps what it starts. The common unnamed case has a short form: `fn _ = expr` means `fn const _ = expr`.

```python
for role in roles:
    fn _ = reviewQueue(role).sendRevertible(request)   # revertible until the function returns
```

### 3.5 Generics

Structs and functions take type parameters in angle brackets. Type arguments can always be written explicitly at a call site. Inference is best-effort: it fills them in only when it can do so unambiguously.

```python
struct Pair<A, B>:
    first: A
    second: B

fn swap<A, B>(p: Pair<A, B>) -> Pair<B, A>:
    Pair{first: p.second, second: p.first}
```

- **Explicit type arguments** use the same brackets everywhere: `swap<int, string>(p)`, `Slot.create<Verdict>()`.
- **Parsing.** In an expression, `name<...>(` is a call with type arguments when the part inside the brackets parses as a list of types, the same rule C# uses. A comparison that happens to look like that needs parentheses: `(a < b) > c`.
- **When inference has nothing to go on,** give the type arguments or annotate the variable: `let xs: Array<int> = []`.
- **Constraints.** A type parameter can be constrained by traits (§3.10) with `is`: `T is Sendable`. Several traits are joined with `&`: `T is Sendable & Comparable`.

### 3.6 Extern declarations

`extern` marks a top-level declaration whose implementation lives in the host, outside any workflow instance. It applies to functions, which have no body, to constants, written `extern name: Type` with no initializer, and to struct types the host implements, such as `extern sendable struct Queue<T>`. Extern constants, and the parameters and results of extern functions, must have sendable types (§3.1). An extern function may also return a `Future<T>` or a `Revertible<T>`: the runtime creates the handle, and the host fills it, or is told when it is released.

```python
extern fn chargeCard(purchaseId: string, amount: int) -> Result<string>
extern approvalDeadline: Duration
extern purchaseRequests: Queue<PurchaseRequest>     # a queue the host provides
```

- **Provided by the host.** The host supplies each extern constant's value and keeps it outside instance snapshots, so it outlives every instance and every deploy.
- **Sendable only.** An extern constant must have a sendable type (§3.1), since any instance may read it.
- **Constant binding.** An extern can't be reassigned. Its internal state can still change through its methods, for example when a message is sent into a queue the host provides.
- **Checked at deploy.** The runtime refuses a program whose extern declaration has a different type from the one it already holds under that name, so one name always means one type.
- **Deterministic reads.** Reading an extern value is recorded in the snapshot, like an `extern fn` result, so a resumed segment sees the same value.

### 3.7 Methods and references

A method is an ordinary function whose first parameter is named `self`. Methods live in the program's definition, not inside values, so data stays plain and serializable. Dispatch is static, by the receiver's type.

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
async fn collectSignature(sigs: &Array<Signature>, signer: string):
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

- **Explicit at the call site.** An argument passed by reference is written `&x`. Only a method's `self` takes its reference implicitly.
- **One kind of reference, and it allows mutation.** A read-only reference would add nothing, because a by-value parameter already can't change the caller's data.
- **References aren't values.** They can't be stored in variables or struct fields, returned or sent. Aliasing exists only for the duration of a call.
- **No references to constants.** Neither a `const` variable nor an `extern` constant can be passed by `&`.
- **No dangling references.** A referenced variable's storage stays alive until every call holding a reference to it has ended, even if its block ends first. It just can't be named after its block ends.

**Overloading.** A function is identified by its name and its parameter types, so several functions can share a name:

```python
fn area(self: Circle) -> float: ...
fn area(self: Rect) -> float: ...
fn scale(self: &Rect, factor: float): ...
fn scale(self: &Rect, factor: int): ...
```

- Calls are resolved statically from the argument types and any explicit type arguments. Return types play no part.
- A generic function is chosen through inference only when it is the single function that matches. When a concrete function matches as well, the concrete one wins: given `fn show<T>(x: T)` and `fn show(x: int)`, the call `show(5)` uses the concrete one, while `show<int>(5)` uses the generic one.
- Any other ambiguity is a compile error, resolved by giving the type arguments explicitly.
- A method can also be called as a plain function: `push(&s, 3)` is the same call as `s.push(3)`.
- Free functions `g(x: S)` and `g(x: &S)` may coexist, because the `&` at the call site tells them apart.
- The one forbidden overload is a pair that differs only in whether `self` is a value or a reference, such as `fn f(self: S)` and `fn f(self: &S)`. Method notation (`s.f()`) couldn't choose between them, so declaring both is a compile error.

**Static functions.** A function without `self` can be declared on a type, and is called through it:

```python
fn Duration.zero() -> Duration:
    Duration{value: 0}

const nothing = Duration.zero()
```

The type before the dot selects the function, so static functions never need overloading by return type. In generic code, a type parameter takes the type's place: `T.zero()` (§3.10).

### 3.8 Prelude and standard library

The **prelude** declares the built-in types the runtime implements, using the same `extern` mechanism programs use (§3.6):

```python
extern sendable struct Array<T>
extern sendable struct Map<K, V>
extern struct Slot<T>                       # not sendable
extern struct WeakRef<T is Disposable>      # not sendable
extern struct Future<T>                     # not sendable
extern struct Shared<T>                     # not sendable

extern fn Slot.create<T>() -> Slot<T>                       # starts empty
extern fn put<T>(self: Slot<T>, value: T) -> Future<unit>   # waits until empty, then fills
extern fn take<T>(self: Slot<T>) -> Future<T>               # waits until full, then empties
extern fn read<T>(self: Slot<T>) -> Future<T>               # waits until full, keeps the value
extern fn deref<T is Disposable>(self: WeakRef<T>) -> T?
extern fn disposed<T is Disposable>(self: WeakRef<T>) -> Future<unit>
```

The prelude also contains `Optional`, `Result`, `Error`, the built-in traits (§3.10, including `Disposable`) and `panic`.

The **standard library** is a set of modules, imported explicitly, for example `import * as time from 'time'`. Pure modules are plain code in the language; runtime-backed ones declare externs the runtime implements. Nothing in it reaches a file system, shell, environment, network or reflection: a workflow affects the outside world only through externs its operator provides.

| Module | Contents |
| --- | --- |
| `time` | `Time`, `Duration`, `now()`, `at(t)` (the runtime's only time primitive) and `delay(d)`, which is `at(now() + d)`; ISO 8601 parsing and formatting with time zones |
| `math` | `abs`, `min`, `max`, `pow`, `sqrt`, `floor`, `ceil`, `round`, `clamp` |
| `decimal` | `Decimal`: arbitrary-precision decimal numbers, for exact arithmetic such as money |
| `text` | String utilities: padding, case, splitting, formatting; `graphemes(s)` for user-perceived characters and `utf16Length(s)` for the length JavaScript counts |
| `json` | `stringify(v)` and a typed `parse<T>(s) -> Result<T>`, using the boundary mapping (§9); the `JsonName` and `JsonSkip` annotations (§3.16) |
| `regex` | Regular expressions with a linear-time engine |
| `crypto` | Hashing, HMAC, constant-time comparison, base64 and hex encoding |
| `random` | Random integers and UUIDs, recorded in the snapshot |
| `log` | Structured logs, committed together with their segment |
| `runtime` | The instance's id and version, and `commit()`, an already-resolved future: `await runtime.commit()` commits without waiting |
| `inbox` | `Inbox<T>`, a FIFO message queue built on slots, with `send`, `sendRevertible` and `receive`, and `Revertible<T>`, the holder of a revertible message (§6) |
| `collections` | `WeakMap<K, V>`, which keeps an entry only while its key is alive; built on `WeakRef` and `disposed()` |
| `futures` | `all`, `any`, `race`, `allSettled`, `quorum(n, fs)`, `timeout(f, d)`, `retry`; built on one runtime primitive, `first(fs)`, that races a list of futures |
| `rpc` | `create<P, R>()` makes a method. `onMessage(handler)` serves calls, the handler's return value being the reply, and `await method.call(msg)` calls it, returning `Result<R>`. Each reply travels in a one-shot slot. |
| `fanout` | `create<M>()` makes a fan-out. `subscribe(handler)` returns a future that runs the handler for each message until it is disposed. `bus.send(msg)` delivers a message to every subscriber, and `bus.sendRevertible(msg)` lets it be retracted. Messages form one stream of slots that every subscriber reads. |
| `testing` | Test modules only: `mock`, `start`, `handle<T>()`, and the test library (§10) |

```python
# from the time module
struct Duration:
    value: int              # milliseconds

struct Time:
    value: int              # milliseconds since the Unix epoch

fn add(left: Time, right: Duration) -> Time:     # Time + Duration
    Time{value: left.value + right.value}
```

- **`string`** is a sequence of Unicode code points, as in Python. `s.length`, `s[i]` (a one-code-point string that panics out of range), `s.at(i)` (a `string?`), slicing and `for ch in s` all count code points, so a single emoji code point is never split. Some emoji are several code points; `text.graphemes(s)` splits a string into user-perceived characters.
- **`Array<T>`** is an ordered, growable sequence indexed from 0, like a JavaScript array, with JavaScript's method names (`push`, `pop`, `at`, `length`, `map`, `filter`, …). `xs[i]` panics when `i` is out of range; `xs.at(i)` returns `T?` and, as in JavaScript, accepts negative indexes counted from the end. Indexing with a range slices it (§3.9); `xs.slice(start, end)` is the clamping, JavaScript-style variant.
- **`Map<K, V>`** maps keys to values and compares keys with the built-in `==`. `m[k]` panics on a missing key; `m.get(k)` returns `V?`. The order in which a map stores and iterates its entries is unspecified, so implementations are free to use hashing or sorting.
- **`Range`** is a plain, sendable struct with an optional `start` and `end`, built by `..` (and by `..=`, which stores `end + 1`). With both ends given, it is `Iterable<int>`.
- An `extern struct` is not sendable unless it says `sendable`.
- A sendable generic struct is sendable only when its type arguments are sendable: `Array<int>` is sendable, `Array<Future<int>>` is not.
- Primitives are always sendable. `Time` and `Duration` are plain structs of `int`, so they are sendable by derivation.
- Methods on primitives are ordinary functions whose `self` is a primitive, such as `"abc".indexOf("b")` or `2.pow(10)`.
- **`Shared<T>`** is a mutable value in the instance's own memory, created with `Shared(value)`. Copying a `Shared` copies the handle, so every copy sees the same value. `x$` reads the value and `x$ = v` or `x$.field = v` writes it (§3.9); `x.value` is the same as `x$`. It is not sendable, and it lives as long as it is reachable (§5).
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
| `<`, `<=`, `>`, `>=` | `compare` | `Comparable` |
| `x[k]` | `index` | `Indexable` |
| `x[k] = v` | `setIndex` | `IndexAssignable` |
| `x$` | `unwrap` | `Wrapper` |
| `x$ = v` | `rewrap` | `MutableWrapper` |
| `for x in c` | `iterate` | `Iterable` |
| `T(x)` | `T.from` | `Convertible` |

**Unwrapping.** `x$` calls `unwrap(x)`, and `x$ = v` calls `rewrap(x, v)`. A field write such as `x$.name = "Y"` is sugar for reading with `unwrap`, changing the field and writing back with `rewrap`, atomically within the segment. `rewrap` takes `self` by value, so a `const` handle stays writable; this also means only handle types, like `Shared<T>`, can usefully implement `MutableWrapper`.

```python
const u = Shared(User{name: "Ares", email: "a@x"})
u$.name = "Ares K"          # writes through: every alias sees it
const snapshot = u$         # a plain copy of the contents
const alias = u             # the same handle; alias == u
users[0]$.name = "Y"        # $ works on any expression
```

All four comparisons go through a single `compare(left, right) -> int` (negative, zero or positive), so they can never contradict each other.

```python
fn add(left: Duration, right: Duration) -> Duration:
    Duration{value: left.value + right.value}

fn multiply(left: Duration, factor: int) -> Duration:
    Duration{value: left.value * factor}
```

- **Fixed syntax.** Precedence and associativity are fixed by the language (table below). Overloads can't change them, and no new operator symbols can be defined, so parsing never depends on types.
- **Indexing.** `x[k]` calls `index(x, k)`, and `x[k] = v` calls `setIndex(&x, k, v)`, so assigning through an index needs a `let` binding. `x[k] += 1` is sugar for `x[k] = x[k] + 1`. `index` is the panicking form; a type can offer a separate safe `get(k)` that returns an optional, as `Array` and `Map` do.
- **Slicing** is indexing with a `Range`, through ordinary `index` and `setIndex` overloads. `a[3..5]` returns a copy, so changing it never affects `a`. `a[3..5] = xs` replaces that span of `a` in place, even with a different length. A range outside the bounds panics; `a.slice(start, end)` clamps instead. Strings slice the same way: `s[1..3]`.
- **Equality is built in.** `==` and `!=` work on every type and can't be overloaded: values compare structurally, handles by identity (§3.1). This keeps `Map` keys consistent.
- **Floor division and remainder share a trait,** because they are defined together: `a == (a // b) * b + a % b` always holds. A type can thus offer exact division, floor division, or both.
- **Not overloadable:** `and`, `or` and `not` (they short-circuit, and a function call would evaluate both sides), `=`, `.` and `&`. `await` and `select` aren't overloaded either; they work on futures (§6).
- **Compound assignment.** `x += y` is sugar for `x = x + y`.
- **No implicit conversions.** Mixed-type operators work only through overloads. The prelude declares them for primitives, such as `add(int, float) -> float` and `add(string, int) -> string`, so `"Total: " + count` just works. Anything else converts explicitly with `T(x)` (§3.10).

| Precedence, tightest first | Operators |
| --- | --- |
| 1 | postfix: calls, indexing, `.`, `?.`, `$`, the error-propagating `?` |
| 2 | prefix: `await`, unary `-`, `&` |
| 3 | `*`, `/`, `//`, `%` |
| 4 | `+`, `-` |
| 5 | `..`, `..=` |
| 6 | `<`, `<=`, `>`, `>=`, `==`, `!=`, `is` |
| 7 | `not` |
| 8 | `and` |
| 9 | `or` |
| 10 | `??`, which can't be mixed with `and` or `or` without parentheses |

Binary operators on the same level associate to the left.

### 3.10 Traits

A trait is a named set of functions, and optionally fields, that a type must have. Traits are used only as constraints on type parameters (`T is Addable`), never as the type of a variable, field or parameter.

```python
trait Addable<T = Self>:
    fn add(left: T, right: T) -> T

trait Comparable<T = Self>:
    fn compare(left: T, right: T) -> int

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

- **`Self` and defaults.** `Self` is the constrained type: in `T is Addable`, `Self` is `T`. Trait type parameters may have defaults, so `T is Addable` means `T is Addable<T>`. A trait may take several type parameters, such as `trait Convertible<To, From = Self>`.
- **Several traits.** `T is X & Y` requires both. In this position `&` joins traits; it never means a reference.
- **Structural conformance.** A type satisfies a trait when functions with the required signatures exist for it, wherever they are declared. There are no `impl` blocks.
- **Constraints only.** Because traits are never value types, there is no dynamic dispatch. The interpreter always knows the concrete type at a call, and snapshots and messages never have to record which type is hiding behind a trait.
- **Fields.** A trait may require fields, written like struct fields: `value: int`.
- **Static functions.** A trait may require a static function, declared on `Self`, such as `fn Self.zero() -> Self`. Generic code calls it through the type parameter: `T.zero()` (§3.7).
- **Generic requirements.** A required function may have type parameters of its own, such as `fn map<U>(self: Self, f: fn(T) -> U) -> Array<U>`.

**Built-in traits:**

| Trait | Required | Used by |
| --- | --- | --- |
| `Sendable` | nothing: a marker, derived for user structs (§3.1) | `spawn` arguments, extern constants, parameters and results |
| `Disposable` | `dispose`, synchronous; only runtime and extern types, including instantiations such as `Shared<Lease>` (§7) | values the runtime disposes when their last holder ends (§7) |
| `Wrapper<T, W = Self>` | `unwrap(self: W) -> T` | `x$` |
| `MutableWrapper<T, W = Self>` | `rewrap(self: W, value: T)` | `x$ = v`, `x$.field = v` |
| `Iterable<T, C = Self>` | `iterate`, returning an `Array<T>` | `for x in c` |
| `Indexable<K, V, C = Self>` | `index(self, key) -> V` | `x[k]` |
| `IndexAssignable<K, V, C = Self>` | `setIndex(self: &C, key, value)` | `x[k] = v` |
| `Convertible<From, T = Self>` | `fn Self.from(value: From) -> Self` | `T(x)` |
| `Default` | `fn Self.default() -> Self` | map literals for other types (§2) |
| `Addable`, `Subtractable`, `Multipliable`, `Divisible`, `FloorDivisible`, `Negatable`, `Comparable` | the functions in §3.9 | operators in generic code |

**Iterable.** `for x in c` calls `iterate(c)` and loops over the returned array, so any type can support `for` by declaring `iterate`. Because `iterate` returns a copy, changing `c` inside the loop doesn't affect the iteration. `Array<T>` is iterable as it is, `Map<K, V>` is `Iterable<(K, V)>` (so `for key, value in m:` works directly), and a `Range` with both ends is `Iterable<int>` (so `for i in 0..10:` works). `Array` and `Map` also satisfy `Indexable` and `IndexAssignable`: `Array<T>` with `int` keys (and `Range` keys for slicing), `Map<K, V>` with `K`.

**Conversions.** `T(x)`, a type applied to one argument in parentheses, converts `x` to `T`. It is sugar for the static function `T.from(x)` that `Convertible<From, T = Self>` requires. It never clashes with construction, which uses braces. Only conversions that can't fail are written this way: `float(3)`, `int(3.7)` (which truncates toward zero) and `string(42)`. Fallible ones are ordinary functions returning `Result`, such as `int.parse("42")`.

### 3.11 Enums

An enum is a type whose value is exactly one of several named variants, each with its own fields. Enums are values like structs: they are copied, they are sendable when all their fields are, and `match` handles them exhaustively.

```python
enum Decision:
    Approved { by: string }
    Rejected { by: string; reason: string }
    Expired

const text: string = match decision:
    case Approved{by}:
        "approved by " + by
    case Rejected{by, reason}:
        by + " rejected: " + reason
    case Expired:
        "expired"
```

- **Construction.** Variants are declared with a field list, as in `Rejected { by: string; reason: string }`, and built like structs: `Rejected{by: "legal", reason: "missing contract"}`. A variant without fields is written bare: `Expired`. A variant with exactly one field may take its value without the field's name, under the same rule as structs (§3.1): `Ok{42}` and `Ok{(receipt)}` are positional, while `Ok{value}` means the field `value`. Like a struct, an enum may be declared on one line: `enum Color { Red; Green; Blue }`.
- **Qualified names.** Where the expected type is known (in a `match`, or when assigning to a typed variable), bare variant names are enough. Elsewhere they are qualified: `Decision.Expired`.
- **Generics and defaults.** Enums and structs take type parameters like functions, and, like traits, may give them defaults: `enum Result<T, E = Error>`.
- **Exhaustive `match`.** A `match` on an enum must cover every variant or end with `case _:`.
- **Optional.** `T?` is sugar for the prelude enum `Optional<T>`, with the variants `Some { value: T }` and `None`. `none` means `None`, a `T` is wrapped in `Some` automatically where a `T?` is expected, and `?.` and `??` (§4) are sugar over `match`.

**Patterns** mirror construction. Inside a pattern's braces, each item is one of:

- **`field`** binds the field to a variable of the same name: `case Approved{by}`.
- **`field as name`** binds it under another name: `case Rejected{reason as why}`. Only a variable name may follow `as`.
- **`field == expr`**, or any other comparison, tests it: `case Verdict{ok == false}`, `case Order{amount > 1000}`.
- **`field is Pattern`** matches the field against a nested pattern: `case Some{value is Verdict{ok == false} as v}`. Only a pattern may follow `is`.

A pattern can also be a literal (`case 0:`, `case "cfo":`), a tuple of patterns (`case (a, _):`) or `_`. There is no positional binding in struct patterns, not even for a type with a single field: a bare name always binds the field of that name, and `as` renames it, as in `case Ok{value as receipt}`. An anonymous struct is matched with `case struct{…}`. For exhaustiveness, `==` against a literal or an enum variant counts as a pattern, while other comparisons act like guards (§4) and don't count. Nested patterns count by the same rules.

**`is` outside `match`.** `x is Pattern` is a boolean expression. Its bindings exist only where the match is known to have succeeded: in the body of an `if` or `while`, and on the right-hand side of an `and`. `or` can't introduce bindings, because afterwards it isn't known which side matched.

```python
if r is Ok{value as y} and y > 0:
    use(y)            # y exists only here
```

### 3.12 Errors

There is no `try`/`catch`. A function that can fail returns a `Result`, from the prelude:

```python
enum Result<T, E = Error>:
    Ok { value: T }
    Err { error: E }

struct Error:
    message: string
    code: string
    trace: string          # filled in by the runtime when the Err is created
```

```python
async fn pay(req: PurchaseRequest) -> Future<Result<string>>:
    const receipt = chargeCard(req.id, req.amount)?    # returns early on Err
    Ok{(receipt)}

match await pay(req):
    case Ok{value as receipt}:
        ...
    case Err{error}:
        ...
```

- **`?` propagates.** `expr?` on a `Result` yields the `Ok` value, or returns the `Err` from the enclosing function. That function must itself return a `Result` with the same error type.
- **Results must be used.** Leaving a `Result` unused as a bare expression is a compile error. Handle it with `match` or `?`, keep it in a variable (`_` included), or `drop` it.
- **Results are data.** A `Result` of sendable types is sendable, so a service can reply with one into a `replyTo` inbox.
- **Bugs panic; expected failures return `Result`.** Network, parsing and business failures return `Result`. Programming errors such as an out-of-range index, division by zero or a missing map key panic. The safe variants return optionals: `xs.at(i)` returns `T?`, and `m.get(k)` returns `V?`.

**Panic.** `panic(message: string) -> never` stops the instance at once:

- **Nothing is committed.** The current segment is discarded, so the instance stays at its last snapshot. Effects of `extern fn` calls already made in that segment remain (§5).
- **The instance is frozen,** marked as panicked. Nothing it holds is disposed and no deferred function runs: its revertible messages stay in their inboxes, and the instances it spawned keep running.
- **An operator decides what happens next.** Through the host, an operator can inspect the instance, retry it from its last snapshot, or terminate it. Terminating disposes everything it holds (§7).
- **A result from the host that doesn't match its declared type** panics the instance at the `extern fn` call, since it's a bug in the host (§9).

### 3.13 Modules

A program is made of modules, one per file; source files use the `.ista` extension. The compiler merges the entry module and everything it imports, directly or transitively, into a single definition. A program's code therefore never changes partially: a deploy always replaces the whole set. Code from other projects comes in as packages (§11).

```python
import approve, Verdict from 'purchase/approve'
import * as runtime from 'runtime'

fn _normalize(id: string) -> string:     # private to this module
    ...
```

- **Exports.** Every top-level declaration is exported, except names starting with `_`. There are no default exports, and imported names are not re-exported.
- **Imports.** `import a, b from 'path'` brings named exports into scope. `import * as m from 'path'` binds them under a namespace, used as `m.name`. A name imported twice, or clashing with a local declaration, is a compile error.
- **Paths.** What a path string refers to is decided by the runtime's module resolver, much as a bundler resolves imports. The language only requires that each path names exactly one module.
- **Cycles.** Modules contain only declarations, never top-level code, so import cycles are allowed.
- **Argument-dependent lookup.** A function is also found through the modules that declare its arguments' types. `a + b` on two `Duration`s finds `add` in `Duration`'s module without an explicit import.
- **Externs** are bound by module-qualified name, so two modules can declare externs with the same short name.
- **The prelude** is imported implicitly into every module.

### 3.14 Function types and closures

A function type is written `fn(int, string) -> bool` or `async fn(string) -> Result<string>`. A value of a function type refers to a named function or a closure, and calling it runs that function.

```python
fn twice(f: fn(int) -> int, x: int) -> int:
    f(f(x))

const limit = 50_000
const isLarge = fn(amount: int): amount > limit     # limit is copied

fn makeCounter(start: int) -> fn() -> int:
    let count = start
    fn next() -> int:                               # count is shared with next
        count += 1
        count
    next
```

**A closure is sugar.** Each captured `let` becomes a `Shared` (§3.8) that the outer code and the closure share; the compiler inserts the `.value` access on both sides. The closure itself is an anonymous struct holding those `Shared` values and copies of the captured `const`s, paired with a reference to the function's code.

- **`const` variables are copied** into the closure.
- **`let` variables are shared.** The closure and the outer code use the same storage, so a change made on either side is visible on the other, as in JavaScript. The loop variable and any `let` declared in a loop body are fresh on each iteration (§3.4); a `let` declared outside the loop is shared by every closure created in it.
- **No `&` references** can be captured, because references can't be stored.
- **Copying a closure shares its state.** The struct is copied, but the `Shared` values inside it are handles to the same storage, so `const g = next` is a second name for the same counter.
- **Calling through a `const` binding is allowed,** since immutability stops at handles (§3.4).
- **Lambdas** are written with `fn` and no name: `fn(x): x * 2`, `fn(x: int, y: int) -> int: x * y`, `async fn(msg): await handle(msg)`. With exactly one untyped parameter, the parentheses may be dropped, as in Python's `lambda`: `xs.filter(fn a: a > 0)`. Parameter types may be omitted when the expected function type gives them. The body after `:` is an expression, which ends at the next `,` or `)`.
- **Named lambdas.** A lambda may carry a name that is visible only inside its own body, so it can call itself: in `const fact = fn f(n: int) -> int: { … }`, the body can call `f`, while outside it the function is only `fact`.
- **Several statements** go in a block expression (§4): `fn(msg): { log(msg); save(msg); msg.id }`, or the same block spread over several indented lines. There is no brace-less form with `;`.
- **Overloaded names** passed as values, like `xs.map(add)`, need an expected function type to choose the overload; otherwise they are a compile error.

```python
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

**Functions stay in their instance.** Function values aren't sendable (§3.1): they refer to code, and possibly to captured `Shared` values, so they can't be passed to `spawn` or to an extern function. Code never travels between instances, which also keeps it from crossing versions.

### 3.15 Tuples

A tuple groups a fixed number of values by position. Its type is written `(int, string)`, and a tuple is built with parentheses: `(5, "x")`.

```python
fn minMax(xs: Array<int>) -> (int, int):
    (xs.min(), xs.max())

const lo, hi = minMax(scores)
const _, max = minMax(scores)         # _ holds the first value, unnamed
let a, b = (1, 2)
a, b = (b, a)                         # swap two existing variables
for key, verdict in answered.entries():
    ...
```

- **Tuples are values.** They are copied like structs, sendable when all their elements are, and compared structurally by `==`.
- **`unit` is the empty tuple** `()`.
- **Building needs parentheses:** `(5, 7)`, including in `return (5, 7)`. A one-element tuple is written `(x,)`; `(x)` is just a parenthesized expression.
- **Destructuring** works in `const` and `let` declarations, in `for` loops, and in plain assignment to existing variables. The number of names must match the tuple's size. `_` is an unnamed variable: it holds its value like any other variable (§7), it just can't be referred to.
- **No named tuples.** When positions need names, use a struct. A good guideline: tuples for two or three positional values, structs beyond that.

### 3.16 Annotations

An annotation attaches a compile-time value to a declaration. It is a struct value written with `@` before it, and it applies to the declaration on the same line or, standing on its own line, to the next declaration:

```python
struct GithubUser:
    login: string
    userId: int @JsonName{"user_id"}
    @JsonName{"avatar_url"}
    @Deprecated{"use avatar instead"}
    avatarUrl: string?
    cache: Map<string, int> @JsonSkip
```

- **Annotations are ordinary structs.** Any struct can be used as one, so libraries and tools declare their own. The `json` module declares `JsonName` (a single `string` field) and `JsonSkip` (no fields).
- **Short forms come from the struct rules (§3.1):** a single-field struct takes its value without a field name, as in `@JsonName{"user_id"}`, and a struct without fields is written bare, as in `@JsonSkip`.
- **Checked at compile time.** An unknown annotation, a misspelled field or a wrong value type is a compile error. Annotation values must be computable at compile time, the same rule as top-level `const`.
- **Where.** Annotations apply to struct fields, to functions (`@Suite`, §10) and to statements (`@Waypoint`, §10). Using one where it has no meaning is a compile error.
- **Read by the runtime.** The boundary conversion, the `json` module and the test runner read annotations. There is no user-facing reflection in v0.1.

### 3.17 Type aliases

`type` gives an existing type another name: `type UserId = string`. The alias and the original are the same type and mix freely. Aliases may be generic, as in `type Entries<T> = Array<(string, T)>`. A *distinct* type with the same contents is a single-field struct instead, such as `struct UserId { value: string }`, which the type checker keeps apart from `string`.

## 4. Expressions and control flow

Every block is an expression whose value is its last expression. A block that ends in a statement has type `unit`. All branching constructs (`if`, `match`, `select`) are expressions. **All their branches must have the same type, and the compiler checks this.** A branch that ends in `return`, `break` or `continue` has type `never`, which fits any expected type.

**Block expressions.** A bare `{ … }` in an expression position is always a block expression: its statements run in order, its variables are scoped to it, and its value is its last expression. Indentation still applies inside the braces. Written on one line, a block must contain at least one `;`, since braces around a single expression add nothing: write `if urgent: alert(msg)` rather than `if urgent: { alert(msg) }`.

```python
const total = { const base = price * qty; base + shipping(base) }

if urgent: { alert(msg); save(msg) }     # a one-line body
```

Braces always mean one of three things, told apart by what comes before them: after a type name or `struct`, they construct a value (§3.1); in a type position, they list fields; and a bare `{` in an expression starts a block.

**One-line bodies.** Any `:` that introduces a body (after `if`, `elif`, `else`, `while`, `for`, `case` or `fn`) may instead be followed by exactly one expression on the same line, with no braces. Chained on one line, `if`, `elif` and `else` form an `if` expression like any other, so every branch must have the same type:

```python
const size = if n < 10: "small" elif n < 100: "medium" else: "large"
const fact = fn f(n: int) -> int: if n < 2: 1 else: n * f(n - 1)
if urgent: alert(msg)
```

A `;` directly after a one-line body is a compile error, because readers coming from Python would expect `if x: s1; s2` to put both statements in the body. Write `if x: { s1; s2 }` for both, or put `s2` on the next line.

**Array comprehensions.** `[for x in xs: expr]` builds an array by evaluating `expr` for each element, and an `if` clause between the iterable and `:` keeps only the elements that pass:

```python
const doubled = [for i in 1..10: 5 * i]
const small = [for x in doubled if x < 20: x]
const values = [for r in results if r is Ok{value}: value]   # filter and destructure
```

- **The body is one expression,** the same rule as a one-line `if`; a block expression gives it several statements.
- **`is` bindings in the condition flow into the body,** just as they flow from an `if` condition into its body.
- **It works on any `Iterable` (§3.10)** and builds the whole array at once. A plain `for` without brackets stays a statement and builds nothing.

```python
const label: string = if amount > 50_000:
    "large"
else:
    "normal"

const verdictText: string = match v:
    case Verdict{ok == true}:
        "approved by " + v.role
    case Verdict{ok == false}:
        "rejected by " + v.role
```

The rules:

- `if` without `else` must have type `unit`.
- `match` must be exhaustive. Use `case _:` for the rest. Patterns are described in §3.11.
- A `case` may have a guard: `case Verdict{ok == false} as v if v.role == "cfo":`. A guarded case matches only when its condition is true, so guarded cases don't count toward exhaustiveness.
- `x is Pattern` tests a value against a pattern outside `match`, as in `if r is Ok{value as y}:` (§3.11).
- `while` and `for x in xs` are statements of type `unit`. `for` works on any type that satisfies `Iterable` (§3.10). `break` and `continue` work as in Python.
- `return expr` exits the enclosing function; `expr` must have the function's return type.

**Optionals.** Two operators work on `T?` values without a `match`:

- `a?.b` reads the field `b`, or calls a method as in `a?.m()`, when `a` isn't `none`, and yields `none` otherwise. The result is optional.
- `a ?? b` yields the value inside `a`, or `b` when `a` is `none`. `b` must have type `T`, and so does the result.

`??` can't be mixed with `and` or `or` without parentheses, as in JavaScript. Neither operator is related to the postfix `?` on `Result`, which propagates errors (§3.12).

```python
const limit: int = m.get("limit") ?? 50_000
const role: string? = verdict?.role
```

## 5. Persistence

`await` is the only persistence point, and it is allowed only inside an `async fn`. The compiler checks only that rule; persistence itself is the runtime's job. The runtime is an interpreter that executes the program's syntax tree over an instance's memory snapshot. **Every `await` commits**, whether or not its future has already resolved: the snapshot is persisted (locals, call frames, position in the code, reference counts and pending futures), and only then does the instance wait. The code alone therefore tells you what is durable: the code between two `await`s is one atomic segment, and every `await` ends one. The runtime may skip a physical write that would change nothing observable. To commit without waiting, write `await runtime.commit()`.

- **Frames are data.** The interpreter keeps call frames in the snapshot, not on the host language's stack. An `await` at any depth in a call chain can therefore be persisted and resumed.
- **Atomic segments.** The code between two `await`s runs in memory. Its effects (state changes, slot operations and disposals) commit atomically at the next `await`. If the segment is interrupted before it commits, by a crash or a panic, it never happened.
- **Disposal points.** Since segments are atomic, disposing a running execution can only stop it at an `await`.
- **Determinism.** `now()` and the results of `extern fn` calls are recorded in the snapshot.
- **Memory is reachability-based.** A snapshot persists only what is still reachable from the instance's live state, so unreachable `Shared` values and closure environments simply disappear. Disposable values are reference-counted instead, so that disposal happens at a predictable point (§7).
- **Extern effects aren't transactional.** The runtime doesn't make `extern fn` calls atomic with the segment. If a segment is discarded, the effects of extern calls it made remain, and a re-run calls them again. Idempotency is the developer's responsibility; an extern can, for example, return its own commit and abort handles for the workflow to call once it decides. Slot operations are exactly-once; anything the host provides is the host's responsibility.

```python
async fn remindLater(role: string):
    await time.delay(1d)              # persisted; resumes after a day
    notifications(role).send(Notice{text: "Reminder"})
```

**Versioning.** An instance's code is fixed for its whole lifetime: the definition is snapshotted when the instance is created and persisted with it. Nothing that refers to code or to an instance's memory is sendable (§3.1), so nothing crosses between versions. When a new version is deployed, the runtime starts its `main`. Everything else about the transition, such as keeping an old version's services running, is up to the program, and how what the host provides deals with versions is up to the host.

## 6. Slots and inboxes

**Slots.** A `Slot<T>` is the runtime's one primitive for communication: a place that is either empty or full, shared by the concurrent executions of one instance and persisted with it. It is created empty with `Slot.create<T>()`, and three operations use it, each returning a future:

| Operation | Waits until | Then |
| --- | --- | --- |
| `slot.put(v)` | the slot is empty | fills it with `v` |
| `slot.take()` | the slot is full | empties it and yields the value |
| `slot.read()` | the slot is full | yields the value and leaves it there |

Competing takes are atomic: when several executions wait to `take` from one slot, exactly one gets each value, the one that has waited longest. When the runtime or the host fills a slot, it wakes the waiters even if the whole instance is suspended and persisted, which only the runtime can do. Awaiting any of these operations commits, like every `await`.

**Futures.** A `Future<T>` is the read-only view of a slot: it can only be waited on. Every wait in the language is a wait on a slot, filled by one of three producers:

- **User code,** with `put`: an inbox's `receive()` or an `rpc` reply.
- **The runtime:** when an async call returns, when a `time.delay` or `time.at` timer fires, and when a value is disposed (`disposed()`, `worker.disposing()`).
- **The host,** through what it provides.

`await` and `select` work only on futures. A future resolves once and stays resolved.

**Inboxes.** The standard library's `Inbox<T>` is a FIFO message queue built on slots, the way Haskell builds its channels on `MVar`s. It is created with `Inbox.create<T>()`:

```python
const box = Inbox.create<Verdict>()
box.send(v)                            # durable
_ = box.sendRevertible(v)              # revertible: held until this block ends
const next: Verdict = await box.receive()
```

- **Order.** Messages come out in commit order: the order in which the senders' segments committed. Sends within one segment keep their program order.
- **Receivers.** Each message goes to exactly one receiver. When several are waiting, the one that has waited longest gets the next message.
- **Capacity.** An inbox is unbounded, so `send` never waits.
- **Durable messages** live until they are received, or until the inbox is disposed.
- **Revertible messages** are held weakly by the inbox (§7). The only strong reference is the `Revertible<T>` holder that `sendRevertible` returns: kept in `_`, it lasts until the sending block ends, with `fn _` until the sending function ends, and stored elsewhere, as long as it is held there. When the holder is released while the message is still unread, the message is retracted.
- **Receiving upgrades a revertible message** to a strong reference, so once received, it can't be retracted. Receivers skip retracted entries, and everything else keeps its order.

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
- **Not only inboxes.** `disposed()` works for any disposable: a future, a slot, a revertible message's holder.
- **Queues the host provides** are kept by the host, so watching one resolves only if the host disposes it.

## 7. Lifetimes and disposal

Pending futures, slots and inboxes, and revertible messages are **disposable**: they satisfy the built-in `Disposable` trait, and the runtime calls `dispose` when nothing holds them anymore. Only runtime and extern types may be disposable, but that includes a specific instantiation of one, which is how user code gets a disposable resource: `fn dispose(self: Shared<Lease>)` makes every `Shared<Lease>` disposable, while `Shared<int>` stays an ordinary handle. A plain struct that declares `dispose` is a compile error, because copies of a value have no single identity to count.

```python
trait Disposable:
    fn dispose(self: Self)
```

**Holders.** A disposable value is reference-counted. Its holders are variables (`_` included), struct fields, array and map elements, closure captures and values waiting in a slot. Copying a value that contains a disposable handle adds a holder, overwriting a variable or field releases the old value, and returning a value hands it to the caller. When a block ends, it releases everything its variables hold, except `fn let` and `fn const` variables, which the enclosing function releases when it ends (§3.4); every disposable that has just lost its last holder is disposed. **Temporaries**, such as the result of `parent.deref()` used inside one expression, are released at the end of their statement.

**Unnamed and dropped values.** A value that must be used (a future, a `Result` or a disposable) is a compile error when left as a bare expression. `_ = expr` keeps it in an unnamed variable, so it lasts until the block ends, and `fn _ = expr` until the function ends. `drop expr` says "I don't need this": a disposable is disposed right away if nothing else holds it, and anything else is simply discarded. A typical use is a best-effort call whose failure doesn't matter, such as `drop audit.record(event)`, which ignores its `Result` on purpose. `drop x` releases the variable `x`, which can't be used afterwards. Neither ever makes a disposed value observable.

In the common case nothing is stored anywhere else, so a disposable lives exactly as long as the function that created it. That isn't forced, though: storing, returning or sending a disposable keeps it alive, and doing so is the developer's choice.

- **Deterministic.** Disposal happens when the last holder's block ends, never at snapshot time, because `dispose` has visible effects.
- **Synchronous.** `dispose` can't `await`. It can send signals, retract messages and mark work as aborted. Anything that must clean up gracefully does so in its own execution, after receiving the signal.
- **Ordered.** Values that lose their last holder at the same block exit are disposed in reverse creation order.
- **Atomic.** The effects of disposal commit with the segment in which the block ends.
- **Within one instance.** Counts never cross instances: disposable handles aren't sendable (§3.1), and what the host provides is owned by the host.
- **Cycles.** Disposables that hold each other in a cycle never reach zero. The snapshot-time reachability pass (§5) finds such cycles, disposes them and logs a warning.

**What disposing does,** as implemented by the standard library:

| Value | Disposing it |
| --- | --- |
| `Future` of an async call | resolves the call's `disposing()`, then stops the call at its next `await` |
| a pending `take`, `read` or timer | drops the wait without consuming / cancels the timer |
| `Slot` or `Inbox` | it dies, along with the values in it |
| `Revertible<T>` holder | retracts the message if it hasn't been received |

In every case, each `disposed()` future watching the value resolves afterwards.

**Weak references.** `WeakRef<T is Disposable>` refers to a value without holding it. Its `deref()` returns `T?`, which is `none` once the last holder has released the value. Its `disposed()` returns a `Future<unit>` that resolves at that moment, and waiting on it holds nothing. Weak references aren't sendable. Revertible messages are built on them: an inbox holds such a message weakly (§6).

**Disposing early.** To dispose something you hold before its block ends, `drop` it. A value is disposed only when its last holder releases it, so a disposed value is never observable. To stop something that other code may also need to reach, keep the only holder in a `Shared` and share that. Setting its value to `none` releases the holder, and everyone else then sees `none` rather than a disposed value:

```python
const sub = Shared<Future<unit>?>(bus.subscribe(fn msg: show(msg)))
...
sub$ = none               # the subscription is disposed here
```

Code that copies the future out (`const f = sub.value`) becomes a holder itself, and keeps it alive.

**Graceful disposal.** Inside an `async fn`, the function's own name gives the current call's context. `worker.disposing()` returns a `Future<unit>` that resolves when the call is disposed, which gives the call a chance to clean up:

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
- **Cleanup can't wait.** Because the next `await` aborts the call, cleanup is synchronous by construction, and the compiler warns about an `await` inside a `disposing()` case.
- **Lexical.** `worker.disposing()` always refers to the enclosing call of `worker`, also from a nested local function, so nested functions are never ambiguous.

**Defer.** `defer f` runs the function `f` when the current block ends, whether it finishes, is left through `return`, `break` or `continue`, or is disposed at an `await`. `f` is a lambda or a function reference of type `fn() -> unit`, as in `defer fn(): log("exited")` or `defer cleanup`, so it can't await. Several deferred functions run in reverse order, last first, and a `defer` in a loop body runs at the end of each iteration, as in Swift. `defer` is sugar for holding a disposable guard in a hidden local, so it needs no new machinery. Unlike `disposing()`, it also runs on a normal exit; to act only on disposal, check a flag:

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

**Example.** `processAll` keeps every job it starts with `fn _`, and disposes its inbox, and any job still running, as soon as it returns:

```python
async fn processAll(jobs: Array<Job>) -> Future<Array<Outcome>>:
    const results = Inbox.create<Outcome>()
    for job in jobs:
        fn _ = runJob(job, results)         # runs concurrently until processAll returns
    let outcomes: Array<Outcome> = []
    while outcomes.length() < jobs.length():
        outcomes.push(await results.receive())
    outcomes
```

**No escape rule.** Because disposal follows holders, a future, slot or inbox may be returned or stored freely; doing so simply keeps it alive.

## 8. select

`await select` waits until one of several futures resolves, then runs that case. It is an expression: its value is the value of the winning case's body.

```python
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
- **Same type.** All case bodies must have the same type, and that type is the type of the `select`.

**Future reuse.** A future resolves once and stays resolved. Create a deadline once, outside a loop, and every iteration races against the same deadline:

```python
const deadline: Future<unit> = time.delay(5d)    # created once
while not done:
    await select:
        case work.receive() as w:
            handle(w)
        case deadline:
            break
```

**Non-blocking form.** A `select` without `await` must have an `else:` case. If no future has resolved at evaluation time, `else` runs. It replaces a separate "try receive" operation:

```python
const cancelled: bool = select:
    case cancels(id).receive():
        true
    else:
        false
```

## 9. Program structure

Every program has exactly one `async fn main()`. The runtime starts it when a version is deployed. When `main` returns, everything it holds is disposed (§7).

**spawn.** `spawn f(args)` starts `f` as a new, independent workflow instance with its own snapshot, then continues immediately. It is a statement of type `unit`. The arguments are copied into the new instance, so they must be sendable (§3.1). The new instance runs until it finishes by itself, on the version it started with, and its return value is recorded as its outcome, which the host can see. Concurrency inside an instance needs no `spawn`: an async call that isn't awaited right away already runs alongside its caller.

```python
async fn main():
    while true:
        const req: PurchaseRequest = await purchaseRequests.receive()
        spawn purchase(req)
```

**Host interface.** The language has no I/O of its own. Its only contact with the outside world is the host (the runtime and the applications around it), which provides the `extern` declarations a program uses (§3.6). Beyond that, the host can:

- **Start** an instance of any function, on the version it chooses. Everything the function holds is disposed when it returns.
- **Operate** panicked instances: inspect one, retry it from its last snapshot, or terminate it (§3.12).

Communication across this boundary takes only three forms: the workflow calls an `extern fn`, the host fills something the workflow waits on (such as a queue it provides), or the host starts an instance. The host never calls workflow functions directly. Asynchronous host work hands the workflow something to wait on instead of taking a callback, for example `extern fn fetch(req: Request) -> Future<Response>`.

**Values at the boundary.** Every value that crosses between the host and an instance has a declared type: extern constants, extern function parameters and results, and the arguments of an instance the host starts. The runtime converts JSON to and from these values itself, guided by the declared types, so workflow code needs no reflection. Inbound JSON is validated before it enters the instance; a mismatch fails the host's call, so malformed data never reaches workflow code. `json.parse<T>(s)` and `json.stringify(v)` apply the same mapping to JSON held in strings:

| Type | JSON |
| --- | --- |
| struct, named or anonymous | object, keyed by field name, or by the name given with `@JsonName`; fields marked `@JsonSkip` are left out |
| `Array<T>`, tuple | array |
| `Map<string, V>` | object, with its keys sorted; other key types become an array of `[key, value]` pairs, sorted by key |
| `int` | number, parsed and printed exactly at any size |
| `float` | number |
| `Decimal` | string |
| `bool`, `string` | boolean, string |
| `T?` | `null`, or a missing field, for `none` |
| enum | object with a `"type"` field naming the variant, plus the variant's fields |
| `Time`, `Duration` | ISO 8601 string, milliseconds |
| `unit` | `null` |

Map keys are emitted sorted, so the same value always produces the same JSON, whatever order the map stores its entries in. Unknown fields in inbound objects are ignored, so producers can add fields without breaking consumers. A missing field that isn't optional fails validation. An enum with a variant field named `type` would collide with the tag, so converting one, at the boundary or through `json`, is a compile error.

## 10. Testing

Tests are ordinary code. The runtime adds a few primitives, in the `testing` module, and everything else is a library written in the language. Only test modules (by convention, files ending in `.test.ista`) may import `testing`, so production code can never install a mock.

**Suites.** `@Suite{"title"}` marks a function that returns the suite's tests as an `Array<Test>`. Tests are values, built by library functions:

```python
@Suite{"purchase approval"}
fn approvalSuite() -> Array<Test>: [
    test("expires after 5 days", withPurchaseEnv, async fn(env): {
        const t = testing.start(purchase, PurchaseRequest{id: "p1", item: "laptop", amount: 900})
        await t.idle()
        env.clock.advance(5d)
        assertEq(await t.result(), "expired")
    }),
    group("with cancellation", [
        test("retracts review requests", withPurchaseEnv, async fn(env): { … }),
    ]),
    ...[for amount in [10, 50_000, 60_000]:
        test("amount " + amount, withPurchaseEnv, async fn(env): { … })],
]
```

- **Each test runs in a fresh instance.** Function values aren't sendable, so the runner calls the suite function again inside each new instance and runs the entry at that test's position.
- **Suite functions only build their list,** which the compiler enforces: a suite function is a plain `fn` (not `async`) that doesn't call externs or touch `Shared` values, slots or inboxes, so it builds the same list every time it is called.
- **The library** provides `test(title, body)`, `test(title, setup, body)`, `group(title, tests)`, `skip(test)` and `only(test)`. Table-driven tests are comprehensions, as above.

**Environments.** A setup is an "around" function of type `Setup<E> = async fn(async fn(E))`: it prepares an environment, runs the test inside it, and tears it down afterwards. Teardown is ordinary code, so it may `await`, and holdings such as mocks are released when the function ends, even if the test fails:

```python
async fn withPurchaseEnv(test: async fn(PurchaseEnv)):
    const clock = FakeClock{start: Time{value: 0}}
    fn _ = mock(time.now, clock.now)
    fn _ = mock(time.at, clock.at)
    await test(PurchaseEnv{clock})
```

`setups(a, b)` combines several environments into one, with overloads for up to six: `setups(withPurchaseEnv, withFakeHost)` is a `Setup<(PurchaseEnv, HostEnv)>`.

**Mocking.** `mock<F>(target: F, replacement: F) -> Mock<F>` replaces any named function (an extern, a standard-library function or one of the program's own) while the returned handle is held, so a mock follows block lifetimes like every other resource. It applies to everything the test runs, including instances it starts. For an overloaded name, the expected type picks the overload; a lambda can't be a target, since it has no identity to replace. `m.calls()` returns the arguments of every call as tuples, typed from `F`: `Array<(string, int)>` for `chargeCard`.

**Time.** `time.at(t)` is the runtime's only time primitive, and `delay(d)` is library code for `at(now() + d)`. Mocking `time.now` and `time.at` therefore controls all time. The library's `FakeClock` does exactly that, with slots it fills as `clock.advance(d)` passes each deadline.

**Host types.** `testing.handle<T>()` creates a unique, opaque value of any extern type `T`, for mocks that must return one. The library's `FakeQueue<T>` uses it: it mocks a queue factory such as `reviewQueue` to return such handles, and mocks `send` and `receive` to use an ordinary inbox behind each handle, with `pending()` and `post(msg)` for the test.

**Driving an instance.** `testing.start(f, args…)` starts `f` as an instance and returns a handle:

| Member | Meaning |
| --- | --- |
| `idle()` | a future that resolves once every execution of the instance is waiting, so everything so far has committed |
| `reaches(label)` | a future that resolves once the instance is suspended at that waypoint |
| `waitingAt()` | the waypoints, or source locations, of every `await` the instance is suspended at |
| `state()` | running, waiting, panicked or finished |
| `result()` | a future of the instance's outcome |

`testing.start(f, args…, crashEveryAwait = true)` discards and re-runs every segment once before committing it, which catches extern calls that aren't idempotent and anything that differs between two runs of the same segment.

**Waypoints.** `@Waypoint{"approval"}` on a statement that awaits gives that suspension point a name, for `reaches` and `waitingAt`, and for the host's operator view, which can show an instance as waiting at `approval`.

**Failures.** The library's `assert` and `assertEq` panic on failure, and a panic in the test or in an instance it started fails the test with its trace. `expectPanic(f)` passes only if `f` panics.

**Built in versus library.** The runtime provides the `@Suite` runner with a fresh instance per test, `mock` and `Mock<F>`, `time.at`, `testing.handle<T>()`, `testing.start` and its members, `crashEveryAwait`, and the panic capture behind failures. Everything else is written in the language: `test`, `group`, `skip`, `only`, `Setup` and `setups`, `FakeClock`, `FakeQueue`, the assertions and `delay`.

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

struct PurchaseRequest:
    id: string
    item: string
    amount: int

struct ReviewRequest:
    purchaseId: string
    item: string
    amount: int

struct Verdict:
    role: string
    ok: bool
    comment: string

struct Notice:
    text: string

struct Cancel:
    reason: string

struct ChargeResult:
    ok: bool
    receipt: string

# a queue type the host provides
extern sendable struct Queue<T is Sendable>
extern fn send<T is Sendable>(self: Queue<T>, msg: T)
extern fn sendRevertible<T is Sendable>(self: Queue<T>, msg: T) -> Revertible<T>
extern fn receive<T is Sendable>(self: Queue<T>) -> Future<T>

extern purchaseRequests: Queue<PurchaseRequest>
extern fn reviewQueue(role: string) -> Queue<ReviewRequest>
extern fn verdicts(purchaseId: string) -> Queue<Verdict>
extern fn notifications(role: string) -> Queue<Notice>
extern fn cancels(purchaseId: string) -> Queue<Cancel>

extern fn chargeCard(purchaseId: string, amount: int) -> Result<string>
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
async fn purchase(req: PurchaseRequest) -> Future<string>:
    let roles: Array<string> = ["legal", "finance"]
    if req.amount > 50_000:
        roles.push("cfo")

    const outcome: string = await approve(req, roles)
    if outcome != "approved":
        return outcome

    const cancelled: bool = select:
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

**Parallel approval.** Fan-out uses revertible sends into the reviewers' queues, kept with `fn _` so they stay revertible until `approve` returns, although they are sent inside loops. Verdicts come back through the host-provided `verdicts` queue, because the reviewers' side runs in separate instances (§6). The join is a `select` loop that reuses the deadline and reminder futures.

```python
async fn approve(req: PurchaseRequest, roles: Array<string>) -> Future<string>:
    for role in roles:
        fn _ = reviewQueue(role).sendRevertible(
                ReviewRequest{purchaseId: req.id, item: req.item, amount: req.amount})

    const deadline: Future<unit> = time.delay(5d)
    let reminder: Future<unit> = time.delay(1d)
    let answered: Map<string, Verdict> = [:]

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
                        fn _ = notifications(role).sendRevertible(
                                Notice{text: "Purchase " + req.id + " awaits your review"})
                reminder = time.delay(1d)
    "approved"
```

When `approve` returns by any path, everything it holds is disposed: unclaimed review requests and unread reminders are retracted, and both timers are aborted. Verdicts that arrive after that stay in `verdicts(purchaseId)`; cleaning them up is up to the program.

### 12.2 Approver side

The task-list UI shows the reviews waiting in `reviewQueue(role)`; how the host reads and claims them is up to the host. On submit, the host starts this function on the purchase's version. The verdict goes into the host-provided `verdicts` queue, because a host-started instance is separate from the purchase (§6).

```python
fn submitReview(task: ReviewRequest, role: string, ok: bool, comment: string):
    verdicts(task.purchaseId).send(Verdict{role: role, ok: ok, comment: comment})
```

### 12.3 Broadcast with expiry

Each subscriber gets its own copy. The revertible sends give the announcement a natural expiry: when `announce` returns, every unread copy is retracted.

```python
import * as time from 'time'

struct Announcement:
    text: string

extern fn announcements(user: string) -> Queue<Announcement>   # Queue as declared in §12.1

async fn announce(text: string, users: Array<string>, visibleFor: Duration):
    for user in users:
        fn _ = announcements(user).sendRevertible(Announcement{text: text})
    await time.delay(visibleFor)
    # function ends: every unread copy is retracted
```

## 13. Open questions

No open questions remain for v0.1. New ones go here as they come up.

## 14. Future work

Features deliberately left out of v0.1:

- **String interpolation.** JavaScript-style template literals, such as `` `Purchase ${req.id} awaits your review` ``.
- **Lazy iteration.** `iterate` returns a whole array. Iterating lazily, for example over an endless sequence, would need an iterator type that a trait could name.
- **Narrowing from function results.** Type predicates, as in TypeScript, so that `fn isOk(x): x is Ok` can narrow a value's type for later code, for example a `map` after a `filter`. Inside one function, `x is Pattern` in an `if` or `and` already narrows.
- **Force-unwrapping optionals.** A postfix `!`, as in Swift, yielding the value inside a `T?` and panicking on `none`.
