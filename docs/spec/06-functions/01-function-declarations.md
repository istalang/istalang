---
description: function heads, bodies and results, async functions, parameter immutability, parameter patterns, arguments, defaults, named and rest parameters; read before changing calls or parameters
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 6.1 Function declarations

```python
fn total(items: Array<Int>) -> Int:                        # may not await
    ...

ista async fn approve(req: PurchaseRequest) -> String:  # may await
    ...

extern fn chargeCard(id: String, amount: Int) -> Result<String>  # implemented by the host
```

- A function's value is the value of its body's last expression, or the value given to `return`. Its return type may be omitted and is then inferred (§4.4).
- An `async fn` gives a future of its kind: `ista async fn f() -> T` gives `Future<T, "ista">`. Inside it, `return` and the body's value have type `T`, and `await` on the call yields that `T`. A head writing `-> Future<…>` writes what its call gives, of the head's kind.
- Calling an `async fn` starts the callee right away, inside the caller's segment (§14): the callee runs until its first `await`, which doesn't commit but hands the future back to the caller, and what the callee did so far commits or rolls back with the caller's segment. A future is a must-use value (§16), which catches a forgotten `await`; it can also be passed to `select`. A stored future keeps running until it finishes or is disposed (§16).
- When a block ends, including a function's body, it releases everything its variables hold, disposing whatever nothing else holds (§7.1, §16).
- `extern fn` declares a host function with a typed signature and no body (§17.2).
- **Parameters are immutable,** as if declared `const` (§7.1): a by-value parameter can't be reassigned, changed in part or passed by `&`. Only a reference parameter (`&T`, §7.3) changes, and what it changes is the caller's place.
- **Parameter types.** A declared function's parameter has a type: written after `:`, named by its pattern (below), or taken from its default. A parameter with none of these is a compile error.

**Parameter patterns.** A parameter may be a declaration target (§4.5) in place of its name: a pattern that can't fail, which takes its argument apart when the body is entered.

```python
import * as math from 'math'

type Point = { x: Float, y: Float }
type Rect = { w: Int, h: Int }

fn norm(Point{x, y}) -> Float: math.sqrt(x * x + y * y)
fn area(struct{w, h}: Rect) -> Int: w * h
fn sum((a, b): (Int, Int)) -> Int: a + b
fn moved({x, y} as start: Point, dx: Float = x) -> Point: Point{x: start.x + dx, y}
```

- **Its names.** They are bound in the body and are immutable, like any parameter. The argument converts into the parameter's type first (§4.1), so every part is there, and each name holds a copy of its part, as a destructuring `const`'s does (§4.5). A pattern that can fail (§11.3) is a compile error: `fn f(Ok(value): Result<Int>)`.
- **Its type.** A pattern naming its type, `Point{x, y}` or `Pair<Int, String>{first, second}`, takes no annotation: one beside it would write the type twice. A generic type named without its type arguments is an error, as a missing annotation is. A `struct{…}` or tuple pattern names none, so it is annotated or takes its type from its default, as a name does. In a parameter, `{…}` is short for `struct{…}`, in its pattern and every pattern nested in it, since a `{` there can only be a pattern.
- **Its name.** A destructured parameter has no name, so a call gives it by position only. `Pattern as name` names the whole as well, bound beside the parts; that name is the parameter's, for named arguments, and `as self` makes the function a method (§6.2).
- **Where not.** A pattern binds values, while a reference passes a place, so a `&` parameter is a name; so is a rest parameter or a pack. An extern function and a trait's requirement have no body of their own to bind a pattern's names in, so theirs are names too. Clashes and overloads compare parameter types only (§6.3): `fn f(Point{x, y})` and `fn f(p: Point)` clash.

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

**Arguments.** A call fills its function's parameters as a struct literal fills fields (§5.2): by position, then by name, and each parameter it leaves out takes its default. A variant's call fills the variant's fields the same way, its fields being its parameters, defaults and a rest included (§5.3). A call broken over lines needs no `,` between its arguments (§2.1).

- **Defaults.** Parameters with defaults come after the others. Defaults are part of the function, as in JavaScript and Kotlin: a default is an expression computed at the start of each call that leaves its parameter out, in the function's scope and before its body, never awaiting. It may use earlier parameters, as in `fn window(start: Int, end: Int = start + 10)`, the names an earlier parameter's pattern binds among them: `fn window(Range{start, end}, step: Int = end - start)`. It is a value, not part of the function's body, so neither `return` nor `?` can leave it, and the function's own call (§16) isn't its to read. A panic in it names the function, at the default. Such a parameter may omit its type, which is inferred from the default: `fn retry(times = 3)`. A struct's fields have defaults the same way (§5.2).
- **Named arguments.** `f(name: value)` gives the parameter of that name, so a call can leave out a default before one it gives: `retry(backoff: 2s)`. Named arguments follow the positional ones, in any order. A positional argument or a spread after a named one is a compile error, and so is a parameter given twice. A `&` parameter is named with its `&`: `f(target: &x)`. A destructured parameter is named only by its `as` name. A method's `self` is given before the dot, never by name.
- **Order.** Arguments are evaluated in the order they are written; the call then starts, computing each default left out, in parameter order, so a default sees the parameters before it however they were given. A call made later, such as a deferred or spawned one (§6.5, §17.1), therefore computes its defaults when it runs.
- **Rest parameters** are sugar for an array. The last parameter, written `...name: Array<T>`, comes after any parameters with defaults and collects the remaining positional arguments. `...xs` at a call spreads anything iterable into them, as in an array literal (§3.1), mixed freely with single arguments; a spread anywhere else is a compile error. Named, the rest parameter takes a whole array: `log(level: "info", parts: more)`. An extern function's rest parameter reaches its host as an array (§17.4). A rest parameter may instead be a pack, `...args: A`, which collects the arguments into a tuple (§8.1).
- **Function values.** Names and defaults aren't part of a function's type (§6.4), so a function value's call gives every argument by position, with no spread.
