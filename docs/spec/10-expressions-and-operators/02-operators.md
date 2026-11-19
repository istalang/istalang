---
description: operators as functions and traits, shared-struct access, comparison chains, membership, keyed indexing and members, slicing, equality, powers, bitwise operators, mixed-type operators; read before changing operators
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 10.2 Operators

An operator is sugar for a named function: `a + b` calls `add(a, b)`. On concrete types, the call is resolved by the same overload rules as any other function (§6.3), so mixed types work, as in `add(left: Time, right: Duration) -> Time`. Generic code can use an operator when a constraint on the type provides its function, whether through `Addable` or any other trait that requires `add` (§8.2). On primitives, the operators are built in.

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
| `x.k`, where `x`'s type has no member `k` | `index(x, "k")`, through a keyed `index` | |
| `x[k] = v` | `setIndex` | `IndexAssignable` |
| `for x in c` | `iterate` | `Iterable` |
| `await x`, a `select` case on `x` | `onAwait(x, done)`, `done` the wait's resolver (§15.2) | `Awaitable` |
| `x in c`, `x not in c` | `includes(c, x)` | `Container` |
| `T(x)` | `T.from` | `Convertible` |

**Shared structs.** `*x` is the value behind the shared struct `x` (§5.4), the shape of its fields (§5.2), so it fits wherever that shape is expected, and `*x = v` writes it, for every copy of the handle, from any value of the shape. `x->f` is `(*x).f`: a field of that value, read or written, as in C. Writing a part (`x->name = "Y"`, `x->count += 1`) changes it in the value as it is when the write happens: the value is read, the part stored into it and the value written back, all at once. So whatever changed another part meanwhile stays changed, such as a call on the right of `x->count += f()` writing `x->label`, and `x->count += v` writes exactly what `x->count = x->count + v` writes. An element written through its container works the same way (§7.3). `x?->f` reads through an optional shared struct, as `?.` does (§10.4). Both are built in and work only on shared structs, so they call no function and can't be overloaded. A `const` shared struct stays writable, since writing through it changes what is behind the handle, not the handle.

```ista statements
const u = new Account{name: "Ares", email: "a@x"}   # a shared struct (§5.4)
u->name = "Ares K"          # writes through: every alias sees it
const snapshot = *u         # a plain copy of the fields
const alias = u             # the same handle; alias == u
accounts[0]->name = "Y"     # -> works on any expression
const next = head->next?->value   # Int?: none when head->next is none
```

All four comparisons go through a single `compare(left, right) -> Int` (negative, zero or positive), so they can never contradict each other.

**Chains.** Comparisons in a row chain as in Python: `a < b <= c` is `a < b and b <= c`, and any mix of `<`, `<=`, `>`, `>=`, `==`, `!=`, `in` and `not in` chains the same way, each operand compared with the next, so `0 < x in xs` is `0 < x and x in xs`. Every operand is evaluated at most once, in order, and evaluation stops at the first comparison that fails; each comparison is checked as it would be written alone. A misreading of `x < y == flag` as `(x < y) == flag` fails to check, since it compares `y` with a `Bool`; parenthesize to mean that. `is` doesn't chain, since a pattern follows it.

**Membership.** `x in c` calls `includes(c, x)`, and `x not in c` is `not (x in c)`. An `Array` includes its elements, compared by `==`; a `Map` its keys, as `has` says; a `String` its substrings; and a `Range` the ints it reaches (§19.3).

```ista
fn add(left: Duration, right: Duration) -> Duration:
    Duration{value: left.value + right.value}

fn multiply(left: Duration, factor: Int) -> Duration:
    Duration{value: left.value * factor}
```

- **Fixed syntax.** Precedence and associativity are fixed by the language (§10.3). Overloads can't change them, and no new operator symbols can be defined, so parsing never depends on types.
- **Indexing by key.** A struct is indexed by its keys (§5.2), built in like `->` and before any `index`: `s[k]` with `k` within `keyof S` reads the field `k` names when the program runs, typed `S[K]`. Where `S` declares no `index` of its own the brackets expect a key, so `s["region"]` is one; where it does, `s["region"]` calls it, and a value whose type is a key reads the field. A key that is one name, a literal or a member type parameter `K in keyof S` (§8.1), names one field, a place as `s.name` is (§7.3): read, written, passed by `&` and the receiver of a method taking `&self`, with nothing copied in or out. Through a key that may name several fields, `s[k] = v` needs `v` to fit every field it may name, each through its own conversion, and a compound assignment reads first, so `s[k] += 1` needs `S[K]` to allow `+`: it does when every field is an `Int`, not for `Int | String`. Neither `&s[k]` nor a method taking `&self` takes one, since the callee could write another field's type. A key's value is a tag of the union of its literals, and each struct type has a static table from that tag to its field's position, so nothing is looked up by name.
- **Keyed members.** An `index` whose key is a member type parameter of String literals, `K in keyof S` or `K in "click" | "hover"` (§8.1), is keyed, and member syntax reads through it: `x.k`, where `x`'s type has no field, getter or method `k`, is `x["k"]`. `x[k]` chooses `index` as the method call `x.index(k)` does (§6.2), `x` giving its type parameters exactly (§8.1), among the `index` functions taking `x` and the key by value, a literal key having its literal type where `index` takes one, and each key is its own instantiation, so each read has its own type: with `fn index<S is struct { [_] is FormNode }, K in keyof S>(self: GroupScope<S>, key: K) -> S[K].Scope`, `data.city` is a `String?` and `data.company` a `GroupScope<Company>`, whose `.size` reads through it again. An `index` taking any `String`, as a `Map<String, V>`'s does, is not keyed, so a map has no such members. `x.k(…)` calls the function the read gives, as for a getter (§5.2), and `x?.k` is `x?.["k"]` (§10.4). A name no member and no key serves is a compile error listing the keys. A keyed read only reads: it is no place, so `x.k = v` and `&x.k` are compile errors; it is never stored and meets no trait's field requirement, since which names it serves is known only per instance.
- **Indexing.** `x[k]` calls `index(x, k)`, chosen as the method call `x.index(k)` is (§6.2), and `x[k] = v` calls `setIndex(&x, k, v)`, so assigning through an index needs a `let` binding. `x[k] += 1` is sugar for `x[k] = x[k] + 1`. An element is a place like a field (§7.3): `a[i].b = v`, `a[i][j] = v` and `&m[k]` read it with `index` and write it back with `setIndex`. `index` is the panicking form; a type can offer a separate safe `get(k)` that returns an optional, as `Array` and `Map` do. A `String` has no `setIndex`, so `s[i] = x` is a compile error. An element is read with `index` and written back with `setIndex` around the change made to it, and a map literal is built by `default` and `setIndex` before it has a value, so none of them may be `async`.
- **Slicing** is indexing with a `Range`, through ordinary `index` and `setIndex` overloads. `a[3..5]` returns a copy, so changing it never affects `a`. `a[3..5] = xs` replaces that span of `a` in place, even with a different length. A range's open start means 0 and its open end the length, so `a[..]` copies `a`; a range outside the bounds, or ending before it starts, panics, and `a.slice(start, end)` clamps instead. Strings slice the same way: `s[1..3]`. A stepped range selects every step-th item, as Python's extended slices do: `a[.. by 2]` gives the items at even positions, and a negative step runs backward, its open ends defaulting to the last item and to before the first, so `a[.. by -1]` is `a` reversed. Writing a stepped slice replaces each item it selects, so it needs exactly as many, and panics otherwise.
- **Equality is built in.** `==` and `!=` work on every type and can't be overloaded: values compare structurally, handles by identity (§7.2), floats as IEEE 754 does (a NaN equals nothing, itself included, so a value holding one is unequal to itself, and `0.0 == -0.0`), and a union's values by their members' types, then the values, as `any` values do (§8.3). This keeps `Map` keys consistent, a union's too. They take two values when either fits the other's type, so `s == name` compares a `Status` with a `String`, or two literals of one base, a constant comparison, so a field loop's key compares with any field's name (§11.2).
- **Floor division and remainder share a trait,** because they are defined together: `a == (a // b) * b + a % b` always holds. A type can thus offer exact division, floor division, or both.
- **Powers.** `**` groups to the right, `2 ** 3 ** 2` being `2 ** 9`, and binds tighter than a prefix operator on its right, so `2 ** -1` reads as written. A prefix operator directly on its left (`-x ** 2`) is a syntax error, since languages disagree on whether the sign applies first: write `(-x) ** 2` or `-(x ** 2)`. An `Int` to an `Int` power is an exact `Int`, which a negative exponent can't be, so it panics; any `Float` operand makes a `Float`. `Powerable<E = Self, T = Self>` lets the exponent have a type of its own, as a `Decimal`'s `Int` does.
- **Bitwise operators** work on `Int` only, as on a two's complement of unbounded width, as in Python: `~x` is `-x - 1`, and `>>` rounds toward negative infinity, so `-9 >> 1` is `-5`. A negative shift count panics. A type of a program's own takes `&`, `|`, `^` and `~` through `Bitwise`, and the shifts through `Shiftable`, which a set of flags has no use for.
- **Not overloadable:** `and`, `or` and `not` (they short-circuit, and a function call would evaluate both sides), `=`, `.`, `->`, prefix `*` and `&`. `await` and `select` aren't overloaded either: they wait on any awaitable, through its `onAwait` (§15.2, §19.1).
- **Compound assignment.** `x += y` is sugar for `x = x + y`.
- **No implicit conversions.** Mixed-type operators work only through overloads, for primitives as for a program's own types. The prelude declares them for `Int` and `Float`, such as `add(Int, Float) -> Float`, and `Decimal` declares its own beside it for `Int` only: mixing it with `Float` would bring back the rounding it exists to avoid. Any `Stringable` value appends to a string, on either side, through `add<T is Stringable>(left: String, right: T)` and its mirror, so `"Total: " + count` and `count + " items"` just work. Anything else converts explicitly with `T(x)` (§8.4).
