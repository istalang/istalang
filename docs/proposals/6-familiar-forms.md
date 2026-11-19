---
description: proposal 6 of docs/proposals, for forms people and agents bring from other languages — `x is not P`, narrowing after a test and variant facts; `@AliasFor` and `@Warn` with the std aliases; an `Int` fitting where a `Float` or `Decimal` is expected; primitives in home modules and `export … from` re-exports, so std methods need no import; a line never starting an item with an operator; `%`, slices, rounding and open ranges as most languages; `?` on optionals; deferred calls that defer every call, with a block form, and `defer` renamed `finally`; enum values in constants; `"""…"""` as text; no pattern binding over a constant; JSON decoding filling defaults; `_` fields private to their module; explicit lifetimes (`_ =` discards, `@Guard`, `hold`, `fn.hold`, `drop` on variables) — the decided rules, behaviour and power changes, spec edits and implementation notes; read before specifying or implementing any of them
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-05
last_updated: 2026-11-19
tags: [proposal, language, patterns, flow, annotations, stdlib, literals]
---

# Proposal: familiar forms

Changes taken from forms that people and agents write from other languages and that Istalang refuses or reads otherwise today (`docs/review/guessed-forms.md`, and the traps of the 2026-11-18 spec audit; those still open are in `docs/review/spec-audit-2026-11-18.md`). The human decided every rule below; **Decisions** lists the choices that settled its open points. Section numbers refer to the spec (`docs/spec/`).

```python
fn label(x: Int?) -> String:
    if x is not None: `n = ${x + 1}`          # x reads as an Int here
    else: "none"

fn urgent(xs: Array<Order>) -> Bool: xs.any(fn(o): o.urgent)   # calls some; ista fmt writes some
fn scale(f: Float) -> Float: f * 2
const half: Float = 1                          # 1.0
const price: Decimal = 12.50                   # exact
fn trimmed(s: String) -> String: s.trim()      # no import
fn first(xs: Array<Int>) -> Int?: xs.at(0)? + 1 # ? on an optional
retry { save(order) }                          # deferred block: runs later, order copied now
finally { log(order) }                         # when this block ends, however it ends
hold start(job)                                # kept until this block ends
```

## Rules

### 1. `is not`, and narrowing after a test

- **`x is not P`** is `not (x is P)`. It binds nothing, so a pattern with bindings after `is not` is a compile error: `x is not Ok{value}`. Precedence and chaining are `is`'s (§10.3).
- **Narrowing.** Where a test on a name is known to hold, the name reads with the type the test leaves it:
  - `x is P` holds: the members of `x`'s type that `P` selects (§11.3, **On a union**). So `x is Int` against `Int | String` reads `x` as an `Int`, and `x is None` reads it as `None`.
  - `x is P` fails, or `x is not P` holds: the members `P` doesn't select, so `x is not None` reads a `T?` as a `T`.
  - `x == none` and `x != none` narrow as `x is None` and `x is not None` do.
- **Where a test holds** is where its bindings exist today (§11.3, **`is` outside `match`**): the body of an `if` or `elif` and of a `while`, and the right-hand side of an `and`.
  - Where it fails: the `else`, the later `elif`s, and the right-hand side of an `or`.
  - After an `if` whose body always leaves (`return`, `break`, `continue`, `panic`, anything of type `Never`), the rest of the block reads what the failing test leaves:

  ```python
  fn first(xs: Array<Int>) -> Int:
      const x = xs.at(0)
      if x is None: return 0
      x * 2                                   # x reads as an Int
  ```
- **What narrows.** Only a name that can't change between the test and its use: a `const`, a by-value parameter, a name a pattern binds, and a path of fields (`.`) from one of them, since a value is copied whole (§7.2).
  - A `let`, a `&` parameter, a read through a handle (`->`), an index and a call never narrow.
  - Bind the value first, `const w = self->when`, and test `w`; or write `self->when is T as w` where `T` names the type.
- **Nothing else changes.** `x is P as n` still binds `n`. A `match` still takes a value apart. Narrowing changes a name's type only where the test holds; it never moves a value.

### 2. Two function annotations: `@AliasFor` and `@Warn`

Two annotations the prelude declares, ordinary structs as every annotation is (§5.5), placed on function declarations in any module.

- **`@AliasFor{"name"}`** declares a function that is another name for a function of its module, its target:
  - **The declaration** is a header with no body: `@AliasFor{"some"} fn any<T>(self: Array<T>, f: fn(T) -> Bool) -> Bool`.
  - **Its signature** must be one of the target's overloads exactly, or it is a compile error. The header is written so the alias belongs to one receiver type (`contains` is `includes` on an `Array` and `has` on a `Map`), and the check keeps it from drifting from its target.
  - **Calling it** calls that overload: the same witnesses, value and messages, and lowering calls the target.
  - **Naming it** as a value names the target.
  - **Overloads:** aliases of one name overload each other as functions do (§6.3).
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
| `Map<K, V>` | `includes(k)` | `has(k)` | the prelude's own: the name `in` calls (§10.2) |

  `Map.includes` stays the function `in` calls, now an alias of `has` instead of a second extern. Because `in` calls it, the formatter leaves `in` as written; only a written call `m.includes(k)` is rewritten.
- **Two std additions:**
  - **`unique()`** on an `Array<T>`: the items in their first order, each kept once by `==` (§10.2).
  - **`set(k, v)`** on a `Map<K, V>`, taking the map by reference as `push` does: it stores `v` at `k`. It carries `@Warn{"write m[k] = v"}`, since `m[k] = v` is the one way to write an entry. It is no alias, since `m[k] = v` is no function to name.

### 3. An `Int` fits where a `Float` or a `Decimal` is expected

- **The rule.** An `Int` converts into a `Float` (the nearest, as `Float(n)` gives) or a `Decimal` (exactly) wherever one is expected: a seventh implicit conversion (§4.1). It reaches inside other types as variance allows, as the conversion into a union does (§4.2): an `Array<Int>` is an `Array<Float>`, a `Slot<Int>` no `Slot<Float>`.
  - `const half: Float = 1`, `scale(n)` for `scale(f: Float)` and an `Int` `n`, `const price: Decimal = qty * 12`.
- **Choosing stays exact first.** Where an `Int` can go as it is, it does:
  - a union holding `Int`, such as `Int | Float` and `Json`, takes the `Int` member (§4.2);
  - between overloads `f(Int)` and `f(Float)`, `f(2)` calls `f(Int)`; with `f(Float)` alone, it calls that;
  - a type parameter inferred from an `Int` is `Int`.
  - A union holding `Float` and `Decimal` but no `Int` takes neither: converting into several members is a compile error (§4.2).
- **Joins.** Where several values take one type and none is expected (§4.2), `Float` holds `Int` and `Decimal` holds `Int`: `[1, 2.5]` is an `Array<Float>`, `if c: 1 else: 2.5` a `Float`. `Float` and `Decimal` never join.
- **Comparisons are exact.** `==` and `compare` between an `Int` and a `Float` compare their values as numbers, not after converting, as Python does: `2 ** 53 + 1 == Float(2 ** 53)` is `false`. A `Map<Float, V>` key converts as any value does.
- **Literals.** An integer literal the nearest `Float` would change is a compile error where a `Float` is expected, so no written digit is lost. A literal with a `.` where a `Decimal` is expected is that decimal exactly, read from its text: `const p: Decimal = 12.50`.
- **Patterns.** An integer literal pattern against a `Float` or `Decimal` subject is that number: `case 2:` matches `2.0`.
- **What goes.** The prelude's mixed overloads (`add(Int, Float) -> Float` and the like) and `Decimal`'s `Int` overloads: the conversion covers them.

### 4. Every type has a home module, primitives included

- **The rule.** Every type is declared in exactly one module, its home, primitives included: `String` in `strings`, `Int` and `Float` in `math`, as `Time` is in `time`; `Bool`, `None`, `Unit` and `Never` stay in the prelude. A primitive's declaration is an `extern struct` without fields (§19.1), as `Array`'s is; what makes it a primitive (its literals, its built-in operators, always sendable, §4.1) is unchanged.
- **Re-exports.** Imported names aren't exported today (§13.1). A module re-exports with `export`, written as an import is, its names on the line or in parentheses (§2.1):
  - `export a, b from 'path'` exports those exports of `path` under their own names, `export a as b from 'path'` under another;
  - `export * from 'path'` exports every export of `path`.
  - A re-exported name is the declaration it names, so two ways to it are one (§13.1), and its home stays its module: argument-dependent lookup still searches `strings` for a `String`. A re-export clashing with a declaration or another export of the module is a compile error, and a `_` name is never one to re-export.
  - `export` is a contextual word (§2.2), a keyword only at a statement's start before a name, `*` or `(`.
- **The prelude re-exports the primitives:** `export String from 'strings'` and `export Int, Float from 'math'`, so every module still knows the names, with no rule of the prelude's own.
- **Argument-dependent lookup does the rest** (§13.1): a call finds the functions of the modules declaring its arguments' types, so `s.trim()`, `trim(s)`, `x.abs()` and `sqrt(x)` find `strings`' and `math`'s functions with no import, as `a + b` on two `Duration`s finds `time`'s `add`. Nothing is listed by hand, and no name joins the prelude.
- **Made methods:** `strings.format(template, ...values)` becomes `template.format(...values)`, and `graphemes(s)`, `utf16Length(s)` take `self`.
- `testing`'s `Instance` inspection keeps its import: `testing` doesn't declare `Instance`, so lookup doesn't reach it, by the same rule.

### 5. A line never starts an item with an operator

- A line break between two items in brackets separates them as today (§2.1), except where the next line starts with `-`, `*`, `&`, `..` or `..=`: such a line always continues the item before it, its token read as the binary operator, glued to what follows or not. `(a ⏎ -b)` is `a - b`, and `f(⏎ x ⏎ -y)` passes `x - y`.
- An item starting with one of them follows a `,`: `[1, ⏎ -2]`. The rule replaces §2.1's glued-or-spaced distinction, so spacing never decides an item.
- **The formatter keeps that `,`.** It writes a list broken over lines without commas at its lines' ends (§2.1), so it would turn `[1, ⏎ -2]` into `[1 ⏎ -2]`, which is `[1 - 2]`. It keeps, and writes, a `,` at the end of a line whose next item starts with `-`, `*`, `&`, `..` or `..=`, and only there; formatting never changes what a list holds.
- The `- item` lines of an indented value (§3.2) are untouched: there a line's leading `- ` is the item marker, after a `key:` that opens the listing, and `- -1` stays the item −1.

### 6. `%` as most languages, `//` as Python's

- **`a % b` truncates,** taking the dividend's sign, as C, Java, JavaScript, Go, Rust, Kotlin and Swift: `-7 % 3 == -1`.
- **`a // b` stays floor division,** the one language that has the operator, Python, gives it that meaning: `-7 // 2 == -4`.
- They no longer form a pair, so `FloorDivisible` splits: `FloorDivisible` requires `floorDivide`, `Remaindering` requires `remainder`.
- **`math.mod(a, b)`** is the floored modulo (Python's `%`, Java's `floorMod`), for cyclic indexes: `math.mod(-1, 7) == 6`. `Decimal` follows `Int`.

### 7. Slices clamp

- `a[r]` with a range cuts the range to the bounds, as Python does: `xs[1..100]` is every item from position 1, and a range ending before it starts gives `[]`. `a[r] = ys` splices the clamped span. Strings alike.
- A single index still panics out of range (§19.3); `a.slice(start, end)` stays for negative indexes counted from the end.
- A stepped slice clamps too; assigning one still needs exactly as many items as it selects.

### 8. Rounding half away from zero by default

- The default `Rounding` mode of `round` (`math` and `decimal`), `toFixed` and `decimal.divide` becomes `HalfAwayFromZero`, as C, C++, Rust, Swift and Go round: `round(2.5) == 3.0`, `round(-2.5) == -3.0`.
- `Decimal`'s `/` still rounds its 34th significant digit half to even, as IEEE 754's decimal128 does: that is its precision, not a rounding a caller chooses.

### 9. An open-ended range iterates

- `for i in 3..:` counts up without end, and `10.. by -1` down; `break` or `return` ends the loop. A range without a start still panics when iterated: it has no first item.
- `[for i in 0..: …]` never ends, as any comprehension over an endless iterable.

### 10. Variant facts

- Where Rule 1's test is known to hold, a name it proves to hold one variant reads that variant's fields with `.`: after `x is Rejected(...)`, in `case Rejected(...)` on a subject `x`, and for `r` in `case Rejected(...) as r`, `x.by` and `r.by` read the field.
- A variant stays no type (§5.3): the name keeps its enum type; only its member reads gain the variant's fields, read-only as fields of a value are. What narrows is Rule 1's: a `const`, a by-value parameter, a name a pattern binds.

### 11. `?` on optionals

- `x?` on a value whose type holds `None` gives the value without `None`, or returns `none` from the enclosing function, whose result type must hold `None`. `?` on a `Result` is unchanged (§12).
- A type holding both a `Result` and `None` is a compile error under `?`: take it apart with `match`. A `Result`'s `?` in a function returning an optional, or an optional's in one returning a `Result`, is a compile error naming the conversion to write (`?? return Err(…)`, `match`).
- `x?.b` stays an optional chain (§10.4), `?.` being one token: propagating, then reading, is `(x?).b`.

### 12. Deferred calls defer every call

- **`g expr`** gives `g` a function that computes `expr` when `g` calls it, `expr` being any expression, binding as prefix `await`'s operand does (§10.3): `later x + 1` is `(later x) + 1`. Today only a call may follow (error 5640).
- **Every call is deferred:** in `g f(args)`, `f`'s arguments too: `retry singleFn(g(), h(x, y))` calls `g`, `h` and `singleFn` each time `retry` runs it.
- **`g { … }`**, and `g(its own args) { … }`, is the block form: the statements run inside the function `g` gets, when `g` calls it. `g expr` is `g { expr }`.
- **Captures are values of now.** Every variable the call or block reads from outside is copied when the function is made, as a `const` is captured (§6.4), the receiver of a method call included. Assigning one inside is a compile error, as assigning a lambda's by-value parameter is; a change made outside afterwards isn't seen. Locals declared inside are the function's own. To share a variable, pass a lambda: `retry(fn(): { … })`.
- **Parsing.** A `{` right after a camelCase name or path, or after `g(…)` on its line, opens a deferred block; after a PascalCase name it is a struct literal (§5.2), as types are PascalCase (§2.2). An indented `g:` line stays a label (§11.1).
- **When it runs is `g`'s choice:** `retry` calls it at once and again on failure, `finally` when a block ends, `hold` at once (Rule 18).
- **Inside.** `await` makes the block an async function of the kind `g` takes (§6.4). `return`, and a `?` that would return, are compile errors inside a deferred block or call, so nothing written there reads as leaving the code around it; `break` and `continue` can't leave it either (§6.4). A `&` argument stays a compile error.
- **`spawn` and `finally`** follow: `spawn purchase(load(id))` loads in the new instance, its captures copied there, so sendable (§7.4).
- **`defer` is renamed `finally`.** It runs its call when the block holding it ends, however it ends, as a `finally` clause does: `finally log(summary())` computes `summary()` then. Its `Deferred` is a `@Guard` (Rule 18), so it stands alone as a statement, held by its block, as Swift's and Zig's `defer` are. `processAll.finally log(x)` runs it when the function ends, as Go's `defer` does (Rule 18).

### 13. Enum values in constants

- A top-level `const` and an annotation may hold an enum value (§5.1): a variant without fields, or a variant's call whose arguments compile time computes, its defaults computed at compile time as a struct literal's are. `const links = ["/lib/x": Source.Git(url: "u", ref: "v1")]` checks.

### 14. `"""…"""` as text

- Anywhere an expression stands, `"""…"""` is a `String`, as in Python: it takes a String's escapes (§3.1), holds no `${…}` values (a `$` is plain), and lays out its lines as a template does.
- A docstring (§2.3) is the same token where §2.3 places it, so it takes the escapes too: one rule for `"""` wherever it stands.
- The formatter rewrites an expression's `"""…"""` to a backtick template, escaping each `` ` `` and `${`, so formatted code keeps one spelling (Rule 2's approach).

### 15. A pattern never binds over a constant

- A bare name in a `case` or `is` pattern, at any depth, that names a top-level constant visible there (its module's, an imported one, the prelude's) is a compile error: `case limit:` reads as a comparison in Rust, Swift and C#, and as a binding here (§11.3). The error names both ways: `case n if n == limit:` compares, another name binds.
- Locals, parameters and functions aren't constants: a pattern binding over one stays a nested scope's shadowing (§7.1), as in Rust, Python and Scala. A field's shorthand (`Config{limit}`), a name after `as`, and the parameter, `for` and declaration patterns only bind, so they are untouched.
- A qualified name still compares (`case limits.max:`).

### 16. Decoding JSON fills defaults

- A field missing from an inbound object takes its default (§5.2), computed as a struct literal leaving the field out computes it, after the fields present; a variant's fields alike. A missing field with no default is `none` if its type holds `None`, and fails otherwise.
- So a field `retries: Int? = 3` reads `3` when missing and `none` from `null`.
- A `@JsonSkip` field reads back as its default, and as its type's `default()` only without one; a skipped field needs one of the two.

### 17. `_` fields are private to their module

- A field whose name starts with `_`, a struct's, a shared struct's or a variant's, can be named only in the module declaring its type (§13.1), and in a test module importing it, as a `_` top-level name can: `s._x`, `s->_x`, `T{_x: …}`, a pattern naming it, `&s._x`. Elsewhere naming it is a compile error.
- **A key is a name too.** A written key starting with `_` names the field it keys, under the same rule: `s["_x"]`, and a `"_x"` literal of type `keyof S`. Member syntax never reaches a `_` key through a keyed `index` (§10.2): `x._k` there is a compile error wherever it is written, since the `index`'s module is not the field's.
- So outside its module, a literal of the type can't give the field; it takes its default, and a type with a private field without a default is built only by its module's functions, which is how a type keeps an invariant.
- **Privacy is of names, not of data.** A value is copied whole (§7.2): `==`, persistence, JSON, spreads (`T{...s}`), field loops, `keyof` and mapped types reach every field, as they do today. A field loop outside the module reads `_x` as a key like any other; it never names it.
- `_` then means one thing in a name: private to where it is declared (a top-level name to its module, a field to its type's module, under proposal 18 a module to its package); `_` alone is a held unnamed variable (§7.1).

### 18. Explicit lifetimes

Every value holding a disposable, a future included, has an owner the code names: it is consumed (`await`, `match`, `?`), returned, stored, kept in a variable it reads, held, or dropped. A variable owns its value until its block ends (§7.1); a longer lifetime is declared. Leaving such a value unused is a compile error, at any depth (error 5025, as the checker does today: a struct, tuple, array or optional holding a future is must-use; §16's list says only the outer types).

- **`_ = e` discards,** as in Rust, Go, Swift, C# and Kotlin. On a value holding a disposable it is a compile error naming the choices: `await` it, `hold` it, keep it in a variable it reads, or `drop` it. `_ = r` ignores a `Result` holding none. `_` never holds.
- **`@Guard`** on a disposable type's declaration (a shared struct or an extern type, §16) lifts only the must-use error for a statement standing alone: such a statement is a hidden `const` declaration, so its value is held until the block ends. Anywhere else the value is an ordinary one: passed to a function, the function holds it as it holds any argument; returned from one, a caller's bare call is held again. `@Guard` on a type that isn't disposable is a compile error; a union holding a `@Guard` type isn't one; no future is.
- **`hold e`** is a std function called as a deferred call (Rule 12), `fn hold<R>(make: fn() -> R) -> Held<R>`: it calls `make` at once and keeps its result in a `Held<R>`, a `@Guard` disposable, so a bare `hold e` keeps `e`'s value until the block ends. It takes any value: `hold start(job)`, `hold lease`, `hold box.sendRevertible(m)`. The lambda isn't kept after the call, so its captures aren't held by it.
  - **An async block starts a child:** `hold { await a() ⏎ await b() }` calls the async lambda, and `Held` keeps its future, so the block runs concurrently and is cancelled when the holding scope ends, as Kotlin's `launch` and Trio's `start_soon`, cancelling instead of waiting. A second `hold` signature takes `K async fn() -> R` and gives `Held<Future<R, K>>`.
  - A block keeps its last value; another value left standing inside is the lambda body's own must-use error.
- **Scopes are named.** The enclosing function's name and a block's label name scopes, as `worker.disposing()` names the current call (§16), lexically, from nested local functions too:
  - **`name.hold e`** keeps `e`'s value until that scope ends. It is storage: the value is added to a hidden variable declared at the scope's top, released with the scope's variables, last first; an upgrade resetting the function (proposal 10) resets it as any variable. It gives `Unit`.
  - **`name.finally e`** is a std method on a scope, `name.hold finally e`: `processAll.finally log(x)` runs when `processAll` ends.
  - A lambda has no name; a label inside it names a scope.

```python
ista async fn processAll(jobs: Array<Job>) -> Array<Outcome>:
    const results = Inbox.create<Outcome>()
    for job in jobs:
        processAll.hold runJob(job, results)     # until processAll ends
    …

batch:
    for job in jobs:
        batch.hold start(job)                    # until the batch ends
    await allDone()
```

- **A scope's end cancels** what it holds that hasn't finished; nothing waits for it. Work that outlives its function would be fire-and-forget, which an upgrade resetting the function would orphan; `spawn` starts work in an instance of its own (§17.1). An instance-wide `global.hold` may come later.
- **`drop x`** takes a variable whose value holds a disposable, and releases it then: what it held is disposed if the variable was its last holder (§16), as a disposed value is never observable. `drop e` on an expression goes: `_ = e` ignores a `Result`, and starting something only to cancel it has no use.
- **What goes:** `hold let`, `hold const`, `hold(name)`, `hold _ = e`, `_ = e` keeping a value, `drop e`. A block label (§7.1) now names a scope for `.hold` and `.finally`.

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
| `let n = 2; g(n)` | error 5001 | `g(2.0)`: an `Int` value converts too |
| `[1, 2.5]`, `if c: 1 else: 2.5` | error 5001 | `Array<Float>`, `Float` |
| `const xs: Array<Float> = [1, 2.5]` | error 5001 | `[1.0, 2.5]` |
| `const d: Decimal = 12` | error 5001 | `Decimal(12)` |
| `const d: Decimal = 12.50` | error 5001 | the decimal `12.50` |
| `case 2:` against a `Float` | warning 5422: no value reaches the case, so it never runs | matches `2.0` |
| `const j: Json = 2` | the `Int` member | unchanged |
| `s.trim()`, `trim(s)` with no import | error 5214, 4000 | call `strings.trim`, found through `String`'s home |
| `export trim, split from 'strings'` | error: no `export` | re-exports both |
| `ista fmt` on `[1, ⏎ -2]` | writes `[1 ⏎ -2]` | keeps the `,` |
| `(a ⏎ -b)`, `f(⏎ x ⏎ -y)` | a tuple `(a, -b)`, two arguments | `a - b`, one argument `x - y` |
| `-7 % 3` | `2` | `-1` |
| `xs[1..100]` on 3 items | panics | `xs[1..3]` |
| `math.round(2.5)` | `2.0` | `3.0` |
| `for i in 3..:` | panics: "Iterating needs a range with both ends" | counts up until `break` |
| `case Rejected(by, ...) as r` then `r.by` | error: a `Decision` has no field `by` | reads the field |
| `xs.at(0)?` in a function returning `Int?` | error: `?` takes a `Result` | the item, or returns `none` |
| `retry load(id).process()` | `load(id)` now, `process()` later | both later, `id` copied now |
| `retry { save(order) }` | error: a block after a name | a deferred block |
| `retry { return 1 }` | error | still an error: no `return` in a deferred block |
| `_ = defer log(x)` | runs at the block's end | renamed, standing alone: `finally log(x)` |
| `_ = start()` | holds the future until the block ends | compile error naming `hold`, `await`, a variable, `drop` |
| `hold start()` | error: `hold` is a modifier | holds the future until the block ends |
| `_ = audit.record(e)`, a `Result` holding no disposable | holds it until the block ends | discards it |
| `hold _ = runJob(job)` in a loop | held until the function ends | `processAll.hold runJob(job)` |
| `hold(batch) _ = start(job)` | held until `batch` ends | `batch.hold start(job)` |
| `hold { await a() ⏎ await b() }` | error | runs concurrently, cancelled when the block ends |
| `processAll.finally log(x)` | error | logs when `processAll` ends |
| `drop audit.record(e)` | discards | error: `drop` takes a variable; `_ =` ignores |
| `later x` for `later(f: fn() -> Int)` | error 5640: a call is expected | a deferred call computing `x` |
| top-level `const s = Source.Git("u", "v1")` | error 5026 | an enum constant |
| `const t = """a ⏎ b"""` | error: a docstring stands only first in a body | `"a\nb"`; `ista fmt` writes a template |
| `case limit:` with a top-level `const limit` | binds a new `limit` | compile error naming the guard |
| `json.parse<Config>("{}")`, `Config` with `retries: Int = 3` | fails: missing field | `Config{retries: 3}` |
| `s._secret`, `s["_secret"]` outside the declaring module | reads the field | compile error |

## What changes in power

**Gained.**
- An optional checked and then used as its value, with no `match`, no `as` and no new name.
- The names people guess accepted and called, then written by the formatter as the language's own, so code still reads one way.
- A function that warns at every call, for std and libraries alike: a forgiving name like `set` points at the one way.
- Numbers written as people write them where a `Float` or a `Decimal` is plainly meant, values included.
- `%`, slices, rounding, open ranges, `?` on optionals and deferred calls behaving as most languages' do; std methods on strings and numbers without an import; enum constants; `"""` text.
- JSON that leaves out a defaulted field decodes, so producers can drop fields as they can add them.
- A type that keeps an invariant: its private fields set only by its module.
- Every lifetime named where the value is made: `hold`, `name.hold`, `finally`, a variable; and a concurrent child tied to a scope, `hold { … }`.

**Not gained.**
- Narrowing a `let`, a handle's field, an index or a call's result. Each can change between the test and the use, so a `const` or an `as` binding is written instead.
- Narrowing by comparison with any value but `none`, such as `x == 1` reading `x` as the literal type `1`.
- A `Float` into a `Decimal`, or anything into an `Int`: those still convert explicitly (§8.4).
- A deferred block that changes a variable outside it: a lambda does that.

**Lost.** Rules 1–4, 10, 11, 13 and 14 take over forms that are errors today, and Rule 16 decodes that fail today. These change the meaning of code that compiles today (greenfield: no compatibility is kept): a line starting with `-`, `*`, `&` or `..` inside brackets (Rule 5), `%` on negative operands (Rule 6), slices out of range and `round` at a tie (Rules 7, 8), open ranges in loops (Rule 9), and when a deferred call's nested calls run (Rule 12). `defer` stops compiling under its old name, and a `return` in a deferred call does too. So do a pattern binding over a top-level constant (Rule 15), a `_` field named outside its module (Rule 17), and Rule 18's removed forms: `_ = e` on a disposable, `hold let`, `hold const`, `hold(name)`, `drop e`.

## Spec changes

- **§4.1, §4.2.** The seventh conversion, `Int` into `Float` and `Decimal`; the joins; exact comparisons in §10.2.
- **§3.1.** A `.` literal as a `Decimal`; the exactness rule; `"""…"""` as text (and §2.3's escapes).
- **§2.1.** A line starting with `-`, `*`, `&`, `..` or `..=` continues the item; the glued-or-spaced distinction goes; the formatter keeps the `,` before such an item.
- **§6.5.** Rewritten: `g expr` with any expression at prefix `await`'s precedence, every call deferred, captures copied, the block form; §6.4 for captures; §16 for `defer`, §17.1 for `spawn`.
- **§3.3.** A `{` after a camelCase name opens a deferred block (the bracket table).
- **§8.4, §19.3.** A range is iterable with a start alone.
- **§5.1.** Enum values in constants.
- **§10.2, §8.4.** `%` truncating, `FloorDivisible` and `Remaindering`; clamping slices.
- **§12.** `?` on optionals.
- **§4.1, §13.1, §19.1, §2.2.** Primitives declared in their home modules; `export` re-exports, the prelude's among them; `export` as a contextual word.
- **§16, §19.1, cheat sheet.** `defer` renamed `finally`.
- **§16, §7.1, §5.5, §19.1.** Rule 18: must-use at any depth; `_ =` discarding; `@Guard`; `hold`, `Held`, `name.hold`, `name.finally`; `drop` on variables; the `hold` modifiers and `hold(name)` go, labels name scopes. Every example using `_ =` or `hold _` (§7.1, §7.3, §15.3, §18, §20, cheat sheet).
- **§19.2, §19.3.** `math.mod`; the rounding default; `format`, `graphemes`, `utf16Length` as methods; mixed `Int`/`Float` overloads removed; open ranges iterate.
- **§8.1.** A type parameter inferred from an integer literal is `Int`.
- **§6.3.** Overload choice takes an integer literal as an `Int` first.
- **§19.3.**
  - The `Array<T>`, `String` and `Map<K, V>` method lists name their aliases, `Array`'s `unique()`, and `Map`'s `set(k, v)` with its warning.
  - `Map`'s `includes` becomes an alias of `has`.
- **§10.3.** `is not` beside `is` in the precedence table.
- **§11.1, §11.3, §21.**
  - **`is` outside `match`** gains `is not`.
  - A new **Narrowing** bullet carries Rules 1 and 10; §11.1's "Nothing narrows" and §21's narrowing item go.
  - Literal patterns take Rule 3's typing.
- **§5.5.** The prelude declares `AliasFor` and `Warn`. **Where** says both apply to functions, with Rule 2's meaning.
- **§11.3.** A bare name over a top-level constant is a compile error (its "compared through a qualified name or a guard" sentence goes).
- **§17.4, §5.2.** A missing field takes its default; `@JsonSkip` reads back the default first.
- **§5.2, §13.1, §5.4, §5.3, §11.2.** `_` fields private to their type's module; field loops and `keyof` still reach them.
- **Cheat sheet:** `x is not None`, and `@AliasFor{"some"}` beside the other annotations.

## Implementation notes

1. **`is not`.**
   - **Parser:** the `is` parselet (`parser/grammar/expressions/operators.ts`) takes an optional `not` before the pattern; the `Is` node holds whether it is negated.
   - **Checker:** a negated pattern that binds is refused where `is` patterns are checked.
2. **Narrowing.**
   - **Where tests hold:** the checker already knows where an `is` binding exists. The same flow rules (`checker/rules/flow/forward.ts`, one table of how each construct runs) give where a test holds and where it fails.
   - **The type a test leaves:** what a pattern selects comes from `checker/constructs/patterns/walk/members.ts`, and what it leaves from `constructs/patterns/exhaustiveness/remaining.ts`. Narrowing reads both, so no second rule says what a pattern selects.
   - **Reading a name:** a name read inside the region takes the narrowed type through the one lookup of a name's type (`checker/constructs/expressions/access/names.ts`). Field paths follow `checked-field.ts`.
   - **Lowering** needs nothing: a narrowed `T?` holds its value as a `T` already (`lowering/values/optionals.ts` reads it).
   - **Tools:** hover and inlay hints show the narrowed type at the use.
3. **`@AliasFor` and `@Warn`.**
   - **Declaring them:** the prelude declares both structs. Annotation placements (`checker/rules/annotations.ts`) allow them on functions, and a header without a body is accepted only under `@AliasFor`.
   - **Aliases:** the checker resolves an alias to the target overload whose signature equals its own, once per declaration, and records it. A call or a value naming the alias reads that record. Resolution, witnesses and lowering then see the target, so no second function exists to lower. `Map.includes`'s separate extern goes.
   - **Alias sites:** the checker records each use of an alias as a site with the target's name. `ista fmt` and the language server's format request check the module, then hand those sites to the formatter as renames to apply while printing. The formatter's API without a program has no sites and renames nothing. The quick fix and the hint read the same sites.
   - **Warnings:** a call or value of a `@Warn` function reports the new warning with the struct's message, from the one place a call's target is recorded, so calls, method calls, operators and values all warn.
   - **The std additions:** `unique` and `set` are std functions (`stdlib/prelude/`), `set` carrying its `@Warn`.
4. **`Int` into `Float` and `Decimal`.** The conversion sits beside the conversion into a union in `types/fitting/`, so expected types, joins and variance reach it as they reach that one; literals keep the steps below.
   - **Checking:** the literal's check (`checker/constructs/expressions/literals/literals.ts`, `literal-types.ts`) reads the expected type through `types/fitting/expected.ts`, which already decides the member a value goes into.
   - **Choosing:** overload choice (`resolution/`) ranks an exact `Int` first, as it ranks exact fits today.
   - **Values:** computation (`rules/computation/`) and lowering emit a `Float` constant, or the `Decimal` that `Decimal(n)` builds.
   - **Patterns:** literal patterns (`constructs/patterns/matching.ts`) take the subject's number type.
5. **Patterns over constants, JSON defaults, `_` fields.**
   - **Constants:** the binder already resolves what a bare pattern name would shadow; a top-level constant there is the new error.
   - **Defaults:** the derived decoder fills a missing field through the one place a struct literal computes its left-out defaults, so the two never differ.
   - **`_` fields:** one visibility check where a field is named (access, literal, pattern, place), reusing the `_` rule for top-level names; field loops and `keyof` don't pass through it.
6. **Explicit lifetimes.**
   - **`hold` and `Held`** are std code (`.ista`), `Held<R>` a shared struct carrying `@Guard`; `name.finally` a std method.
   - **Must-use:** the one check (`rules/disposal/must-use.ts`, reading `types/properties/held.ts`) gains the `@Guard` exemption for a statement and the `_ =` error, so both use its definition of holding.
   - **A bare `@Guard` statement** lowers as the hidden `const` it means, through the variable path, so release order is the variables'.
   - **Scopes:** a function's name or a label in `name.hold` resolves as `worker.disposing()`'s does; each scope a `.hold` names gets one hidden holder variable, declared by lowering at its top.
7. **Tests** (fast-check, beside the code):
   - narrowing agrees with `match`: `if x is not None: f(x) else: g()` runs as `match x: case None: g() case v: f(v)` over generated optionals and unions;
   - an alias and its target give the same call and value, and formatting a module with alias uses gives the module the target names would have given, a commute law (test/AGENTS.md);
   - a `@Warn` function warns at every kind of use, and calling it gives what calling it unannotated gives;
   - `g(n)` for a literal `n` equals `g(Float(n))` over generated integers within ±2⁵³, and is refused beyond them where the nearest `Float` changes the value; the same for `Decimal`, unbounded;
   - decoding the JSON of any value with defaulted fields left out gives the value a literal leaving them out builds;
   - every row of the behaviour table.

## Decisions (the human's)

1. **A `let` doesn't narrow,** not now. A `const` covers the common case, and narrowing a `let` needs its assignments tracked through closures.
2. **Aliases are declared by `@AliasFor`, which the formatter rewrites, and `@Warn` warns at every call.** Both are function annotations, in place of an alias list carried by the target.
3. **Every alias in the table goes in.**
4. **`unique()` and `set(k, v)` are added,** `set` under a `@Warn`.
5. **An integer literal is a `Decimal` where a `Decimal` is expected.**
6. **An integer literal pattern matches a `Float` or `Decimal` subject.**

Decided 2026-11-19, from the traps of the 2026-11-18 spec audit (its T-numbers; the open ones remain in `docs/review/spec-audit-2026-11-18.md`). Where the review changed the human's first wording to keep the language consistent, the change follows the decision.

7. **T6: an `Int` fits a `Float`** (Rule 3), superseding decision 5's literal-only rule. Review: `Decimal` too, comparisons exact, the exactness error kept for literals, decimal literals read from their text.
8. **T5: std methods on built-in types need no import** (Rule 4), by a general rule: primitives are declared in their home modules (`String` in `strings`), the prelude re-exports them with `export … from` (a re-export any module may write), and argument-dependent lookup finds their functions. No exception names a module or the prelude.
9. **T8: a leading `-` marks an item only in an indented value's listing** (Rule 5); in brackets a line starting with an operator continues the item.
10. **T9: `%` as the majority** (Rule 6). Review: `//` stays Python's floor division, the only language with that operator; the two stop being a pair, and `math.mod` gives the floored modulo.
11. **T10: slices clamp** (Rule 7). **T11: rounding as the majority** (Rule 8), `HalfAwayFromZero`. **T12: open ranges iterate** (Rule 9): today they panic.
12. **T16: variant facts** (Rule 10). **T17: `?` on optionals** (Rule 11).
13. **T18: deferred calls defer every call and copy every capture, with a block form; no `return` inside** (Rule 12). Review: a block opens after a camelCase name only, struct literals keeping PascalCase; a variable changed outside after the deferral isn't seen; a `?` that would return is refused with `return`.
    - **`defer` is renamed `finally`:** it runs when its block ends, however it ends, as a `finally` clause does; `later` would read as "asynchronously, some time", beside `spawn` and timers.
14. **Enum values in top-level constants** (Rule 13), which proposal 18's manifest needs.
15. **T28: `"""…"""` is text, rewritten to a template by the formatter** (Rule 14). Review: Python's escapes, docstrings included, so the token has one meaning.
16. **Kept as they are:** T13 (half-open ranges, as Rust and Python), T23 (`UserId{id}` is the field shorthand, as Rust's; braces taking a value by position is Go's form, while Rust, Kotlin, Scala, Swift and Python build one-field types by a call), T31 (`5d` is 120 hours, as Java's `Duration.ofDays`, Kotlin's `days` and .NET's `TimeSpan` count a day; calendar days differ only across a change of offset, where `DateTime.addDays` keeps the wall-clock time).
17. **T15: a pattern binding over a constant is a compile error** (Rule 15). Review: top-level constants only, in `case` and `is` patterns; locals stay shadowable and parameter patterns untouched, as every language with patterns binds over locals.
18. **T20: decoding fills defaults** (Rule 16). Review: a `T?` field with a default reads it when missing and `none` from `null`; `@JsonSkip` reads back the field's default first.
19. **T30: `_` fields are private to the module declaring their type** (Rule 17). Review: keys too, `s["_x"]` and a `_` key through a keyed `index`; a test module importing it may name them, as it may a `_` top-level name; variants' and shared structs' fields alike; privacy is of names, so `==`, JSON, persistence and field loops still reach every field.
20. **T1–T3: explicit lifetimes** (Rule 18). Every disposable is consumed, kept or dropped, block first, longer when declared. `_ =` discards, and is an error on a disposable. `@Guard` only lifts the must-use error, making a bare statement a hidden variable; `finally`'s `Deferred` and `hold`'s `Held` carry it. `hold` is a deferred-style function calling its lambda at once, any value, async blocks included; `fn.hold` and `label.hold` store into the scope's hidden variable; `fn.finally` is a std method. `drop` takes a variable. A scope's end cancels, never waits: fire-and-forget would outlive a function an upgrade resets. Review: the lambda isn't kept by `Held` (its captures would outlive their variables unseen); `g expr` takes any expression (today only a call), binding as `await`'s operand.
