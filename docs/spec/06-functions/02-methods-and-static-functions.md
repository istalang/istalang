---
description: methods and self, static dispatch, static functions on types; read before changing method calls
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 6.2 Methods and static functions

A method is an ordinary function whose first parameter is named `self`, or is a pattern named so, `Point{x, y} as self` (§6.1). Methods live in the program's definition, not inside values, so data stays plain and serializable. Dispatch is static, by the receiver's type.

```ista
struct Stack<T>:
    items: Array<T>

fn push<T>(self: &Stack<T>, item: T):     # takes a reference
    self.items.push(item)

fn top<T>(self: Stack<T>) -> T?:          # takes a copy
    self.items.at(-1)
```

`s.push(3)` calls `push` with `self` bound to `s`. When `self` is a reference, the `&` is implicit at the call, so `s.push(3)` modifies `s`. A name after `.` is a field of the receiver, else a getter or a method taking it (§5.2), found as calls find functions (§13.1), else a key of a keyed `index` taking it (§10.2).

A method can also be called as a plain function: `push(&s, 3)` is the same call as `s.push(3)`.

**Static functions.** A function without `self` can be declared on a type, and is called through it:

```ista
fn Duration.zero() -> Duration:
    Duration{value: 0}

const nothing = Duration.zero()
```

The type before the dot selects the function, so static functions never need overloading by return type. A static function is visible where a function would be: declared in the calling module, in the module of its type, in the prelude, or in a module the caller imports. Several visible static functions of one name on one type are overloads. In generic code, a type parameter takes the type's place: `T.zero()` (§8.2).
