---
description: proposal 6 of docs/proposals, for forms people and agents reach for from other languages — `x is not P` and narrowing a name after a test (`x is None`, `x != none`); two function annotations, `@AliasFor` (a name that calls another function, which the formatter rewrites) and `@Warn` (a warning wherever a function is called), with the std aliases (`any` for `some`) and two std additions (`unique()`, and `set` under a warning) they serve; and an integer literal that is a `Float` or a `Decimal` where one is expected, patterns included — the decided rules, behaviour and power changes, spec edits and implementation notes; read before specifying or implementing any of them
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-05
last_updated: 2026-11-05
tags: [proposal, language, patterns, flow, annotations, stdlib, literals]
---

# Proposal: familiar forms

Three changes, each taken from forms that people and agents write from other languages and that Istalang refuses today (`docs/review/guessed-forms.md`). The human decided every rule below; **Decisions** lists the choices that settled its open points. Section numbers refer to `docs/spec.md`.

```python
fn label(x: Int?) -> String:
    if x is not None: `n = ${x + 1}`          # x reads as an Int here
    else: "none"

fn urgent(xs: Array<Order>) -> Bool: xs.any(fn(o): o.urgent)   # calls some; ista fmt writes some
fn scale(f: Float) -> Float: f * 2
const half: Float = 1                          # 1.0
const price: Decimal = 12                      # Decimal(12)
```

## Rules

### 1. `is not`, and narrowing after a test

- **`x is not P`** is `not (x is P)`. It binds nothing, so a pattern with bindings after `is not` is a compile error: `x is not Ok{value}`. Precedence and chaining are `is`'s (§3.9).
- **Narrowing.** Where a test on a name is known to hold, the name reads with the type the test leaves it:
  - `x is P` holds: the members of `x`'s type that `P` selects (§3.11, **On a union**). So `x is Int` against `Int | String` reads `x` as an `Int`, and `x is None` reads it as `None`.
  - `x is P` fails, or `x is not P` holds: the members `P` doesn't select, so `x is not None` reads a `T?` as a `T`.
  - `x == none` and `x != none` narrow as `x is None` and `x is not None` do.
- **Where a test holds** is where its bindings exist today (§3.11, **`is` outside `match`**): the body of an `if` or `elif` and of a `while`, and the right-hand side of an `and`.
  - Where it fails: the `else`, the later `elif`s, and the right-hand side of an `or`.
  - After an `if` whose body always leaves (`return`, `break`, `continue`, `panic`, anything of type `Never`), the rest of the block reads what the failing test leaves:

  ```python
  fn first(xs: Array<Int>) -> Int:
      const x = xs.at(0)
      if x is None: return 0
      x * 2                                   # x reads as an Int
  ```
- **What narrows.** Only a name that can't change between the test and its use: a `const`, a by-value parameter, a name a pattern binds, and a path of fields (`.`) from one of them, since a value is copied whole (§3.1).
  - A `let`, a `&` parameter, a read through a handle (`->`), an index and a call never narrow.
  - Bind the value first, `const w = self->when`, and test `w`; or write `self->when is T as w` where `T` names the type.
- **Nothing else changes.** `x is P as n` still binds `n`. A `match` still takes a value apart. Narrowing changes a name's type only where the test holds; it never moves a value.

### 2. Two function annotations: `@AliasFor` and `@Warn`

Two annotations the prelude declares, ordinary structs as every annotation is (§3.16), placed on function declarations in any module.

- **`@AliasFor{"name"}`** declares a function that is another name for a function of its module, its target:
  - **The declaration** is a header with no body: `@AliasFor{"some"} fn any<T>(self: Array<T>, f: fn(T) -> Bool) -> Bool`.
  - **Its signature** must be one of the target's overloads exactly, or it is a compile error. The header is written so the alias belongs to one receiver type (`contains` is `includes` on an `Array` and `has` on a `Map`), and the check keeps it from drifting from its target.
  - **Calling it** calls that overload: the same witnesses, value and messages, and lowering calls the target.
  - **Naming it** as a value names the target.
  - **Overloads:** aliases of one name overload each other as functions do (§3.7).
  - **The formatter rewrites each use to the target's name**, `xs.any(f)` to `xs.some(f)`, so formatted code keeps one spelling. That needs the checked program, which knows what a name calls. `ista fmt` and the language server's formatting both have it; the formatter given a tree alone leaves names as written.
  - **The language server** shows a use with a hint naming the target and offers the same rewrite as a quick fix. Hover and go-to-definition reach the target. Completion offers an alias only once its prefix is typed.
- **`@Warn{"message"}`** marks a function whose every call, and every use as a value, is a warning carrying the message (one new warning code). `ista check` reports it and the language server shows it, as every checker diagnostic is. The function itself is ordinary: calling it does what its body does.
- **The std aliases**, from the names agents reached for (`docs/review/guessed-forms.md`), each with the language it comes from:

| Type | Alias | Target | From |
| --- | --- | --- | --- |
| `Array<T>` | `any(f)` | `some(f)` | Python, Kotlin, Rust, Swift |
| `Array<T>` | `all(f)` | `every(f)` | Python, Kotlin, Rust |
| `Array<T>`, `String` | `contains(x)` | `includes(x)` | Kotlin, Java, Swift, Rust |
| `Map<K, V>` | `contains(k)`, `containsKey(k)` | `has(k)` | Kotlin, Java, Swift |
| `Map<K, V>` | `includes(k)` | `has(k)` | the prelude's own: the name `in` calls (§3.9) |

  `Map.includes` stays the function `in` calls, now an alias of `has` instead of a second extern. Because `in` calls it, the formatter leaves `in` as written; only a written call `m.includes(k)` is rewritten.
- **Two std additions:**
  - **`unique()`** on an `Array<T>`: the items in their first order, each kept once by `==` (§3.9).
  - **`set(k, v)`** on a `Map<K, V>`, taking the map by reference as `push` does: it stores `v` at `k`. It carries `@Warn{"write m[k] = v"}`, since `m[k] = v` is the one way to write an entry. It is no alias, since `m[k] = v` is no function to name.

### 3. An integer literal takes the expected number type

- **The rule.** An integer literal, written in any radix and with an optional `-` (§2), takes the expected type where that type is `Float` or `Decimal`, or holds exactly one of them as its only number member. Examples:
  - `const half: Float = 1`, and `scale(3)` for `scale(f: Float)`;
  - `[1, 2.5]` as an `Array<Float>`, an indented value's entry, a `Float` field's default, `Float?`;
  - `const price: Decimal = 12`, which is `Decimal(12)`.

  Anywhere else it is an `Int`, with its literal type (§2), as today: `let x = 2` is an `Int`.
- **Only literals.** An `Int` value still never converts: `let n = 2; scale(n)` is error 5001, as today. So `2` means one thing wherever its type is decided by what it is, and a name always keeps its type.
- **Choosing stays exact first.** Where an `Int` could take it, the literal is an `Int`:
  - a union holding `Int`, such as `Int | Float` and `Json`, takes the `Int` member, as a value goes into the member of its own type (§2);
  - between overloads `f(Int)` and `f(Float)`, `f(2)` calls `f(Int)`; with `f(Float)` alone, it calls that;
  - a type parameter inferred from `2` is `Int`.
- **Exactly representable.** A `Decimal` holds any integer. A `Float` must hold the literal exactly: beyond ±2⁵³, an integer the nearest `Float` would change is a compile error, so no digit is lost silently.
- **Patterns too.** An integer literal pattern against a `Float` or `Decimal` subject is that number: `case 2:` matches `2.0`. So a literal means the same in a pattern as in a value.
- **Compile time.** A literal so typed is folded as its type: `const half: Float = 1` holds `1.0`, and shows as `1.0` in hovers and inlay hints.

## What changes in behaviour

| Code | Today | Proposed |
| --- | --- | --- |
| `if x is not None: x + 1` (`x: Int?`) | error 2001: a pattern is expected | `x` reads as an `Int` |
| `if x != none: x + 1` | error 5016: `+` isn't defined for `Int?` and `Int` | `x` reads as an `Int` |
| `if x is None: return 0` then `x * 2` | error 5016 | `x` reads as an `Int` after the `if` |
| `if x is Int: x + 1` (`x: Int \| String`) | error 5016: `+` isn't defined for `Int \| String` and `Int` | `x` reads as an `Int` |
| `let x: Int? = …` then `if x is not None: x + 1` | error 2001 | error 5016: a `let` doesn't narrow |
| `if self->when is not None: self->when.get()` | error 2001 | still an error: a read through a handle doesn't narrow |
| `x is not Ok{value}` | error 2001 | still an error: `is not` binds nothing |
| `xs.any(fn(x): x > 0)` | error 5214: `Array<Int>` has no field or method 'any' | calls `some`, with a hint; `ista fmt` writes `xs.some(…)` |
| `@AliasFor{"some"}` on a header whose signature isn't one of `some`'s | error 4000: 'AliasFor' is not declared | a compile error naming the overloads |
| `m.set("a", 1)` | error 5214 | stores the entry, with the warning "write m[k] = v" |
| `xs.unique()` | error 5214 | the items, each once |
| `fn g(x: Float) -> Float: x` then `g(2)` | error 5001: expected `Float`, found `Int` | `g(2.0)` |
| `const xs: Array<Float> = [1, 2.5]` | error 5001 | `[1.0, 2.5]` |
| `const d: Decimal = 12` | error 5001 | `Decimal(12)` |
| `case 2:` against a `Float` | warning 5422: no value reaches the case, so it never runs | matches `2.0` |
| `let n = 2; g(n)` | error 5001 | unchanged |
| `const j: Json = 2` | the `Int` member | unchanged |

## What changes in power

**Gained.**
- An optional checked and then used as its value, with no `match`, no `as` and no new name.
- The names people guess accepted and called, then written by the formatter as the language's own, so code still reads one way.
- A function that warns at every call, for std and libraries alike: a forgiving name like `set` points at the one way.
- Numbers written as people write them where a `Float` or a `Decimal` is plainly meant.

**Not gained.**
- Narrowing a `let`, a handle's field, an index or a call's result. Each can change between the test and the use, so a `const` or an `as` binding is written instead.
- Narrowing by comparison with any value but `none`, such as `x == 1` reading `x` as the literal type `1`.
- Converting an `Int` value into a `Float` or a `Decimal`: `Float(n)` and `Decimal(n)` stay the way.

**Lost.** Nothing that compiles today changes meaning. `x is not P`, the aliases, `unique` and `set` take over forms that are errors today. A literal takes a `Float` or a `Decimal` only where an `Int` was an error.

## Spec changes

- **§2.**
  - **Literals:** "an integer literal is an `Int`, or a `Float` or a `Decimal` where one is expected", with the exactness rule.
  - **Conversion into a union:** a literal an `Int` member can take goes there.
- **§3.5.** A type parameter inferred from an integer literal is `Int`.
- **§3.7.** Overload choice takes an integer literal as an `Int` first.
- **§3.8.**
  - The `Array<T>`, `String` and `Map<K, V>` method lists name their aliases, `Array`'s `unique()`, and `Map`'s `set(k, v)` with its warning.
  - `Map`'s `includes` becomes an alias of `has`.
- **§3.9.** `is not` beside `is` in the precedence table.
- **§3.11.**
  - **`is` outside `match`** gains `is not`.
  - A new **Narrowing** bullet carries Rule 1.
  - Literal patterns take Rule 3's typing.
- **§3.16.** The prelude declares `AliasFor` and `Warn`. **Where** says both apply to functions, with Rule 2's meaning.
- **Cheat sheet:** `x is not None`, and `@AliasFor{"some"}` beside the other annotations.

## Implementation notes

1. **`is not`.**
   - **Parser:** the `is` parselet (`parser/expressions/operators.ts`) takes an optional `not` before the pattern; the `Is` node holds whether it is negated.
   - **Checker:** a negated pattern that binds is refused where `is` patterns are checked.
2. **Narrowing.**
   - **Where tests hold:** the checker already knows where an `is` binding exists. The same flow rules (`checker/flow/forward.ts`, one table of how each construct runs) give where a test holds and where it fails.
   - **The type a test leaves:** what a pattern selects comes from `checker/patterns/members.ts`, and what it leaves from `patterns/remaining.ts`. Narrowing reads both, so no second rule says what a pattern selects.
   - **Reading a name:** a name read inside the region takes the narrowed type through the one lookup of a name's type (`checker/expressions/names.ts`). Field paths follow `checked-field.ts`.
   - **Lowering** needs nothing: a narrowed `T?` holds its value as a `T` already (`lowering/optionals.ts` reads it).
   - **Tools:** hover and inlay hints show the narrowed type at the use.
3. **`@AliasFor` and `@Warn`.**
   - **Declaring them:** the prelude declares both structs. Annotation placements (`checker/rules/annotations.ts`) allow them on functions, and a header without a body is accepted only under `@AliasFor`.
   - **Aliases:** the checker resolves an alias to the target overload whose signature equals its own, once per declaration, and records it. A call or a value naming the alias reads that record. Resolution, witnesses and lowering then see the target, so no second function exists to lower. `Map.includes`'s separate extern goes.
   - **Alias sites:** the checker records each use of an alias as a site with the target's name. `ista fmt` and the language server's format request check the module, then hand those sites to the formatter as renames to apply while printing. The formatter's API without a program has no sites and renames nothing. The quick fix and the hint read the same sites.
   - **Warnings:** a call or value of a `@Warn` function reports the new warning with the struct's message, from the one place a call's target is recorded, so calls, method calls, operators and values all warn.
   - **The std additions:** `unique` and `set` are std functions (`stdlib/prelude/`), `set` carrying its `@Warn`.
4. **Literals as `Float` or `Decimal`.**
   - **Checking:** the literal's check (`checker/expressions/literals.ts`, `literal-types.ts`) reads the expected type through `types/expected.ts`, which already decides the member a value goes into.
   - **Choosing:** overload choice (`resolution/`) ranks an exact `Int` first, as it ranks exact fits today.
   - **Values:** computation (`rules/computation/`) and lowering emit a `Float` constant, or the `Decimal` that `Decimal(n)` builds.
   - **Patterns:** literal patterns (`patterns/matching.ts`) take the subject's number type.
5. **Tests** (fast-check, beside the code):
   - narrowing agrees with `match`: `if x is not None: f(x) else: g()` runs as `match x: case None: g() case v: f(v)` over generated optionals and unions;
   - an alias and its target give the same call and value, and formatting a module with alias uses gives the module the target names would have given, a commute law (test/AGENTS.md);
   - a `@Warn` function warns at every kind of use, and calling it gives what calling it unannotated gives;
   - `g(n)` for a literal `n` equals `g(Float(n))` over generated integers within ±2⁵³, and is refused beyond them where the nearest `Float` changes the value; the same for `Decimal`, unbounded;
   - every row of the behaviour table.

## Decisions (the human's)

1. **A `let` doesn't narrow,** not now. A `const` covers the common case, and narrowing a `let` needs its assignments tracked through closures.
2. **Aliases are declared by `@AliasFor`, which the formatter rewrites, and `@Warn` warns at every call.** Both are function annotations, in place of an alias list carried by the target.
3. **Every alias in the table goes in.**
4. **`unique()` and `set(k, v)` are added,** `set` under a `@Warn`.
5. **An integer literal is a `Decimal` where a `Decimal` is expected.**
6. **An integer literal pattern matches a `Float` or `Decimal` subject.**
