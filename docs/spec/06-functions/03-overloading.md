---
description: overloads, how a call chooses among them, and when two clash; read before changing overload resolution
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 6.3 Overloading

**Overloading.** A function is identified by its name and its parameter types, so several functions can share a name:

```python
fn area(self: Circle) -> Float: ...
fn area(self: Rect) -> Float: ...
fn scale(self: &Rect, factor: Float): ...
fn scale(self: &Rect, factor: Int): ...
```

- Calls are resolved statically from the argument types and any explicit type arguments. Return types play no part.
- A literal argument whose items each have a type of their own, such as `(3,)` or `[1, 2]`, has its own type when choosing, which converts into a parameter's its items convert into (§8.1): `g((3,))` calls `fn g(x: (Int?,))`. A `struct{…}` is decided by where it goes: it takes a struct it gives every field of, but those with a default, or a shape its fields fit, so `f(struct{c: 3})` calls `fn f(x: { c: Int? })`; its shape bounds what a type parameter it is passed for is given (§5.2, §8.1).
- A generic function is chosen through inference only when it is the single function that matches. When a concrete function matches as well, the concrete one wins: given `fn show<T>(x: T)` and `fn show(x: Int)`, the call `show(5)` uses the concrete one, while `show<Int>(5)` uses the generic one.
- With explicit type arguments, only generic functions that take that many type arguments are considered.
- When a call fits both a function with a rest parameter and one without, the one without wins, after a concrete function has beaten a generic one (above); a pack is a rest parameter, so a function of fixed arity beats one taking a pack. After that, a function taking every argument as it is beats one that makes a plain function argument async (§6.4), converts between a one-element tuple and its element (§4.5), converts a struct's value into its shape (§5.2), converts an argument part by part (§8.1) or builds a literal argument as a type other than its own, so a plain function argument fitting both `fn run(f: fn() -> Int)` and `fn run(f: ista async fn() -> Int)` takes the first, a call fitting both `fn f(p: Pixel)` and `fn f(p: { x: Int, y: Int })` with a `Pixel` takes the first, and `pick([1])` takes `fn pick(x: Array<Int>)` over `fn pick(x: Array<Int?>)`. Then the most specific wins, as in C#, Kotlin and Java: one whose parameter types, as the call instantiates them, each fit the other's, and not all the reverse, so `f(1)` takes `fn f(x: Int)` over `fn f(x: Int?)`, and `f("a")` takes `fn f(x: "a")` over `fn f(x: String)`.
- A named argument rules out every function without a parameter of that name (§6.1); names tell functions apart in no other way.
- A union argument takes only an overload whose parameter takes the whole union, or a wider one: `f(x: A)` and `f(x: B)` together don't take an `A | B`, which a `match` takes apart first (§11.3).
- Any other ambiguity is a compile error, resolved by giving the type arguments explicitly.
- Two functions of one name clash, a compile error, when some call by position could fit both and no rule above prefers one: for some number of arguments, counting defaults left out and a rest parameter's items, their parameters take the same arguments at each position, both by value or both by `&`, with neither more specific. Shapes are the same type wherever written (§5.2), so `fn f(p: Point)` and `fn f(p: { x: Int, y: Int })` clash for `type Point = { x: Int, y: Int }`. Generic ones with different numbers of type parameters never clash, since written type arguments tell them apart; otherwise each instantiates its own, as at a call, so `fn f<T>(a: T, b: Int)` and `fn f<T>(a: Int, b: T)` clash, as a call giving two `Int`s fits both alike. A pack's items count as any type. A type beside one holding it (a union holding it, a literal type's base, a type it converts into part by part) is more specific, so `fn f(x: A)` and `fn f(x: A | B)` coexist, as do `fn f(x: "a")` and `fn f(x: String)`, and `fn f(xs: Array<Int>)` and `fn f(xs: Array<Int?>)`, while two functions each narrower at some position clash, as `fn f(a: Array<Int>, b: Array<Int?>)` and `fn f(a: Array<Int?>, b: Array<Int>)` do, and unions that only overlap don't; type arguments may make the narrower type hold the wider, so `fn f<T>(x: T)` and `fn f<T>(x: T?)` clash, as do `fn f<T>(xs: Array<T>)` and `fn f<T>(xs: Array<T?>)`. A one-element tuple and its element each hold the other only converted, so the rule above tells them apart. `fn(A) -> R` and `ista async fn(A) -> R` differ, as the rule above tells them apart, while `ista async fn(A) -> R` and `ista fn(A) -> Future<R, "ista">` are one type (§6.4), so overloads on the two clash. This covers the prelude's overloads too.
- Free functions `g(x: S)` and `g(x: &S)` may coexist, because the `&` at the call site tells them apart.
- The one forbidden overload is a pair that differs only in whether `self` is a value or a reference, such as `fn f(self: S)` and `fn f(self: &S)`. Method notation (`s.f()`) couldn't choose between them, so declaring both is a compile error.
