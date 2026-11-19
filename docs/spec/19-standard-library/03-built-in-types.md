---
description: String, Array, Map and Range semantics and methods, Default, methods on primitives, Shared and WeakRef in brief; read before changing these built-in types
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 19.3 Built-in types

- **`String`** is a sequence of Unicode code points, as in Python. `s.length()`, `s[i]` (a one-code-point string that panics out of range), `s.at(i)` (a `String?`, counting a negative index from the end), slicing and `for ch in s` all count code points, so a single emoji code point is never split. Some emoji are several code points; `strings.graphemes(s)` splits a string into user-perceived characters.
- **`Array<T>`** is an ordered, growable sequence indexed from 0, like a JavaScript array, with JavaScript's method names: `length()`, `push(x)`, `pop()` (a `T?`), `at(i)`, `slice(start = 0, end = none)`, `indexOf(x)` (`-1` when absent), `includes(x)`, `lastIndexOf(x)`, `reverse()` (in place), `flat()` on an `Array<Array<T>>`, and `join(separator)` on an `Array<String>`. Methods taking a function are `map`, `filter`, `flatMap`, `find` and `findLast` (a `T?`), `findIndex` and `findLastIndex` (`-1` when absent), `some`, `every`, `reduce(f, initial)`, and `sort()` on a `Comparable` `T` or `sort(order: fn(T, T) -> Int)`, which sort in place and keep equal elements in order. Since `for` iterates, a spread concatenates and assigning to a range splices, arrays have no `forEach`, `concat` or `splice`. `xs[i]` panics unless `0 <= i < xs.length()`; `xs.at(i)` returns `T?` and, as in JavaScript, accepts negative indexes counted from the end. Indexing with a range slices it (§10.2); `xs.slice(start, end)` is the clamping, JavaScript-style variant.
- **`Map<K, V>`** maps keys to values and compares keys with the built-in `==`, so a key holding a NaN can be stored but is never found again. `m[k]` panics on a missing key; `m.get(k)` returns `V?`. Its methods are `size()`, `get(k)`, `has(k)` and `includes(k)`, the same test, which `in` calls (§10.2), `delete(k)` (whether it held `k`), `keys()`, `values()` and `entries()`, and `Map.groupBy(items, key: fn(T) -> K) -> Map<K, Array<T>>` groups an array's items by key, keeping their order. A map keeps its entries in the order their keys were first set, as JavaScript's and Python's do: setting a key it holds keeps the entry's place, a new key goes last, and `delete` removes the entry. It iterates, lists `keys()`, `values()` and `entries()`, and spreads in that order. Two maps are `==` when they hold equal values for equal keys, whatever their order.
- **`Range`** is a plain, sendable struct with an optional `start` and `end` and a `step` (1 unless `by` gives one), built by `..` (and by `..=`, which stores the end one past the written one in the step's direction, so a range is always half-open). It reaches its start and every step from it before its end, the step's sign giving the direction, as Python's `range` does: a range whose end lies the other way reaches nothing, so iterating `5..2` gives nothing and `10..=0 by -2` gives 10, 8, 6, 4, 2 and 0. A step of 0 would reach its start forever, so using such a range panics. It is `Iterable<Int>` when both ends are given, and iterating a range without an end panics, since whether it has one is known only when it runs. `x in r` is whether `r` reaches `x`, an open end reaching without bound; with an open start, only a step of 1 or -1 has a meaning, and any other panics.
- **`Array<T>`**, **`Map<K, V>`** and **`T?`** satisfy `Default`: `Array.default()` and `Map.default()` are empty, and `Optional.default()` is `none`.
- Methods on primitives are ordinary functions whose `self` is a primitive, such as `"abc".indexOf("b")` or `2.toString()`.
- **`Shared<T>`** is the prelude's shared struct of one value (§5.4).
- **`WeakRef<T>`** refers to a disposable value without holding it (§16).
