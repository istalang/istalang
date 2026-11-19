---
description: the Fn type and its sugar, mark and sendability orders, closures, lambdas, async function types, functions named as values, equality, sendable and inert function types; read before changing function values
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 6.4 Function types and closures

A function type is written `fn(Int, String) -> Bool` or `ista async fn(String) -> Result<String>`, which is `ista fn(String) -> Future<Result<String>, "ista">`; its last parameter may be a pack, `fn(...A) -> R` (§8.1), but not an array's rest, which a function value takes as one array. A value of a function type refers to a named function or a closure, and calling it runs that function.

**One function type.** Every function type is the prelude's `Fn<Args, Result, Kind = "simple", Send = "plain">`, and every other spelling is its sugar, as a function's head is: `fn(A, B) -> R` is `Fn<(A, B), R>`, `live fn(A) -> R` is `Fn<(A,), R, "live">`, `sendable fn(A) -> R` is `Fn<(A,), R, "simple", "sendable">`, and `fn(x: &A)` is `Fn<(&A,), Unit>`. `Args` is the tuple of the parameters, `(A,)` for one and `()` for none, or a pack (§8.1); an item written `&T` is a parameter taken by reference, which only an `Fn`'s tuple may hold. `Kind` is the code's mark, a `Mark` member, and `Send` its `Sendability`. A type whose `Kind` or `Send` is a type parameter is written as `Fn`: `Fn<(T,), U, M, S>`.

- **Two orders, of their own.** `Mark` is ordered `"simple"` below `"live"` and `"ista"`, which are apart, and `Sendability` `"sendable"` below `"inert"` below `"plain"`. They are orders on these two types alone, not subtyping between their members: a function fits where one of a mark and sendability at or above its own is expected, so an unmarked function fits where a `live fn` is expected and a `sendable fn` where a `fn` is.
- **Keeping an argument's.** A higher-order function keeps its argument's mark and sendability through written parameters, `M in Mark` and `S in Sendability`: `logged<...A, R, M in Mark, S in Sendability>(f: Fn<A, R, M, S>) -> Fn<A, R, M, S>` gives a sendable function exactly when `f` is one. A closure's `Send` is the least its captures allow: `"sendable"` when everything it captures is sendable, `"inert"` when everything is inert, the `S` of the only function values keeping it from being sendable, and `"plain"` otherwise. Function values of `S` beside inert captures would make it the greater of `S` and `"inert"`, which no member names, so that closure is `"plain"`.

```ista
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

**A closure is sugar.** Each captured `let` moves into a cell, as a shared struct's fields live in one (§5.4), which the outer code and the closure share; the compiler reads and writes it on both sides. The closure itself is an anonymous struct holding those cells and copies of the captured `const`s, paired with a reference to the function's code.

- **`const` variables are copied** into the closure.
- **`let` variables are shared.** The closure and the outer code use the same storage, so a change made on either side is visible on the other, as in JavaScript. The loop variable and any `let` declared in a loop body are fresh on each iteration (§7.1); a `let` declared outside the loop is shared by every closure created in it.
- **No `&` references** can be captured, because references can't be stored.
- **Copying a closure shares its state.** The struct is copied, but the cells inside it are the same storage, so `const g = next` is a second name for the same counter.
- **Calling through a `const` binding is allowed,** since immutability stops at handles (§7.1).
- **Lambdas** are written with `fn` and no name: `fn(x): x * 2`, `fn(x: Int, y: Int) -> Int: x * y`, `async fn(msg): await handle(msg)`. With exactly one untyped parameter, the parentheses may be dropped, as in Python's `lambda`: `xs.filter(fn a: a > 0)`; that form takes a name only. Parameter types may be omitted when the expected function type gives them. A parameter may be a pattern (§6.1), which takes each argument apart: `ps.map(fn(struct{x, y}): x + y)`, `pairs.map(fn((k, v)): k)`. The body after `:` is an expression, which ends at the next `,` or `)`.
- **Named lambdas.** A lambda may carry a name that is visible only inside its own body, so it can call itself: in `const fact = fn f(n: Int) -> Int: { … }`, the body can call `f`, while outside it the function is only `fact`.
- **Several statements** go in a block expression (§10.1): `fn(msg): { log(msg); save(msg); msg.id }`, or the same block spread over several indented lines. There is no brace-less form with `;`.
- **Overloaded names** passed as values, like `xs.map(add)`, need an expected function type to choose the overload; otherwise they are a compile error.

```ista statements
bus.subscribe(fn(msg): {
    if msg.urgent:
        alert(msg)
    save(msg)
})
```

**Functions are values.** A local `fn` declaration is the same as binding a lambda to a `const` at that point. There is no hoisting inside a function, so a local function can only be used after its declaration. These two are equivalent:

```ista
fn main():
    const result = fn(): 5

fn main():
    fn result(): 5
```

The only difference is that a lambda can also be bound with `let` and reassigned, while a named `fn` is always constant. Both can call themselves: a named `fn` through its name, and a lambda through its own name if it has one. Top-level functions are module declarations, so they may appear in any order (§2.1).

**What a lambda or local function may be.**

- **One value.** A lambda or a local `fn` can't be generic, or have default values or an array's rest parameter: a function value is one function, and its call gives every argument by position (§6.1). Its rest may be a pack of the function around it, `fn(...args: A)`, since each instantiation flattens it into single parameters (§8.1).
- **Parameter types.** A lambda's untyped parameter takes its type from the function type the lambda is expected as; with none, it is a compile error. A pattern naming its type with its type arguments, or one that takes none, writes the parameter's type; a generic one named bare takes its type arguments from the expected function type. Passed to a generic function, a lambda, or a function named as a value, waits until the type parameters its parameters' types mention are settled (§8.1), from the other arguments, the type the call is expected to have and any other such argument giving them. A struct literal gives the types of what it holds once it is built, so a lambda inside one waits for it; and one expected as a computed type waits for what decides that type's fields: in `Pick{sel: c, cases: struct{x: Case{body: fn(sc): sc.a}}}`, with `cases: { [K in keyof C]: Case<Sc> }`, `C` is settled from `c`, the `struct{…}` is built as `{ x: Case<Sc> }`, and only then is `sc` an `Sc`. Its result is then checked against what the call's expected type says of it, and bounds the type parameters that remain: `vs.map(fn x: Ok(x))` expected as an `Array<Result<Int, String>>` gives `Ok` its `String`.
- **Its own function.** `return` in a lambda returns from the lambda, `break` and `continue` can't leave it, and `await` needs an `async fn` lambda.
- **Its mark.** A lambda's mark is its head's, else the one the function type expected of it gives, else the one kind its parameters' values are of, else, where its body calls, waits on or handles anything of a kind, that of the code around it, and simple otherwise (§9.1). An `async` lambda given none takes the kind its expected type gives, even written whole: `takesLive(async fn() -> Int: 1)` is a live one. A closure's body handles what it captures, so it captures only data its mark allows. A local `fn` is a declaration: its mark is its head's.
- **Captures.** A by-value parameter is immutable (§6.1), so it is captured as a copy, like a `const`.
- **Async function types.** `ista async fn(A) -> R` is another spelling of `ista fn(A) -> Future<R, "ista">`, and `live async fn(A) -> R` of its live twin: one type, written and printed alike. An unmarked `async fn` type is a compile error, its future having no kind (§9.1). Calling a function of it yields a `Future<R, K>`, and `await` gives the `R`. A declared `ista async fn f(x: A) -> R` is therefore the value `ista fn(A) -> Future<R, "ista">`. A function giving a value fits where one giving a future of it is expected, `fn(A) -> R` where `ista async fn(A) -> R` is, sendable alike: calling it yields a future that is already resolved, and the call never suspends. A function giving a future fits where one giving a future of a wider value is expected, so a function type varies in what its future gives as in what it gives: calling it yields a future of its own following the one it gives, which settles as that one does with its value converted, so the call is the function's own, waiting, disposed and started (§6.1, §15.2, §16) as an unconverted call is, and the future it gives stays as it is for whatever else reaches it. As with the conversion into a union (§4.2), it reaches inside another type as that type's variance allows (§8.1): an `Array<fn()>` is an `Array<ista async fn()>`. A function type's parameters are contravariant and its result covariant, so `fn(Int?) -> Int` fits where `ista async fn(Int) -> Int?` is expected, converting what it takes and gives; a `&` parameter takes exactly its type. Where a future is expected of a lambda's call, its body gives the future's value, a plain lambda's made a future already resolved, or a plain lambda's the future itself, as one forwarding a call does: `fn(x): later(x)`.
- **Functions named as values.** A top-level or static function named as a value, as in `xs.map(inc)` or `Duration.zero`, is a closure that captures nothing, and so is a variant with fields, its enum's function (§5.3): qualified, `Result.Ok`, or bare where an expected function type's result is its enum. A method is called, never named as a value: `s.push` without a call is a compile error; wrap the call in a lambda.
- **Type arguments after a function's name** are a call's (§8.1): `parse<Int>`, `math.parse<Int>`, `Box.of<Int>`, `Result.Ok<Int, String>`, or `Ok<Int, String>` where the expected function type's result is `Result`. They are counted, defaulted and constrained as a call's are and choose among overloads as theirs do, the expected function type inferring the type parameters they leave out; the value is the function they instantiate, a closure that captures nothing, equal to another naming that function, whatever type arguments it is given (Equality, below). So `vs.map(Result.Ok<Int, String>)` is an `Array<Result<Int, String>>`, whose `String` `vs.map(Result.Ok)` can't infer, and `pick<Int>` names the one `pick` taking a single type argument. After the name of anything else, a variable, a type or a variant without fields, type arguments are a compile error; only a call gives a variant without fields its type arguments (§5.3). A function with defaults also fits a function type that leaves trailing ones out, as a value or an argument, and computes them at each call; one with a rest parameter takes it as one array, so `log` is a `fn(String, Array<String>)`. Passed to a generic function, a generic function or overloaded one named as a value is chosen like a lambda: after the other arguments, by the parameter types they give, and by what they give of its result, its result then inferring the type parameters that remain as a call's would, with whatever else bounds them: `vs.map(Result.Ok)` is an `Array<Result<Int>>` for `vs: Array<Int>`, and `take(apply(1, Result.Ok), "hello")` for `fn take<T>(r: Result<Int, T>, t: T)` gives `Ok` its `String`; where nothing gives its parameters, a lone function is its whole type, as `id(greet)` is.
- **Fields of function types.** `x.f(…)` calls a field `f` of a function type when `x`'s type has no method `f`. When it has both, the call is ambiguous, which is a compile error; `(x.f)(…)` calls the field.
- **Equality.** Two function values are equal when they run the same body with equal captures: one declared function, lambda or local function, whatever type arguments it or the function holding it was instantiated with, so `f<Int> == f<String>` for an `fn f<T>(n: Int) -> Int`. A captured `let` is a cell, so it compares by identity (§7.2).

**Sendable function types.** A plain function value isn't sendable (§7.4): it may capture a cell, such as a captured `let`'s, or a shared struct. `sendable fn(A) -> R` and `sendable ista async fn(A) -> R` are the function types whose values capture only sendable values, so they can be spawned:

- A function value has a sendable function type when every capture's type is sendable. A captured `let` is a cell, which isn't sendable, so a closure capturing one isn't either (it is inert when the variable's type is, below); a top-level or static function named as a value captures nothing, so its type is sendable.
- A `sendable fn(A) -> R` fits wherever an `fn(A) -> R` is expected, never the reverse.
- It satisfies `Sendable`, so it may be part of sendable data, and `spawn` starts a new instance with one, its captures copied into it (§17.1).
- It refers to code, so it never leaves for the host: an extern declaration or `json` whose types contain one is a compile error. Code reaches only instances of the same program, which keeps it from crossing versions (§14).

**Inert function types.** `inert fn(A) -> R` and `inert live async fn(A) -> R` are the function types whose values capture only inert values (§7.4): unlike a sendable function, an inert one may capture handles and a captured `let`'s cell, provided nothing it captures can reach a disposable. Libraries that keep callbacks in handles, such as observers whose listeners capture their owner, take them, so the cycle rule passes them (§16):

- A function value has an inert function type when every capture's type is inert, a captured `let` counting as its cell, which is inert when its variable's type is.
- A `sendable fn(A) -> R` fits wherever an `inert fn(A) -> R` is expected, and an inert one wherever an `fn(A) -> R` is, never the reverse.
- Where an inert function is expected, a closure capturing a value that isn't inert is a compile error naming the capture, as one capturing a value that isn't sendable is where a sendable function is expected.
- It satisfies `Inert`. `inert` concerns what a function captures, not its mark, which the data rule checks on its own (§9.1): an inert function may capture a value of a kind that reaches no disposable, such as an `extern live struct` declaring no `dispose`, and never a future, which is disposable.
