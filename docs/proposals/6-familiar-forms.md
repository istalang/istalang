---
description: proposal 6 of docs/proposals, for forms people and agents bring from other languages — `x is not P`, narrowing after a test and variant facts; `@AliasFor` and `@Warn` with the std aliases; a compile-time integer fitting where a `Float` or `Decimal` is expected; primitives in home modules and `export … from` re-exports, so std methods need no import; a line starting with an operator joined only when indented, the formatter showing the split; `%`, slices, rounding and open ranges as most languages; `?` on optionals; deferred calls as lambdas, with a block form, and `defer` replaced by `onExit`; enum values in constants; `"""…"""` as text; no pattern binding over a constant; JSON decoding filling defaults; `_` fields private to their module; explicit lifetimes (`_ =` discards, `holder`, `onExit`, `start`, `drop` on variables); operator functions named `op_…`; `/regex/flags` literals; structs called through `op_call`; `//` dropped; `const` literal types; `\r`, `\0`, `\xNN` escapes; `none` printing as `"None"` — the decided rules, behaviour and power changes, spec edits and implementation notes; read before specifying or implementing any of them
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-05
last_updated: 2026-11-19
tags: [proposal, language, patterns, flow, annotations, stdlib, literals]
---

# Proposal: familiar forms

Changes taken from forms that people and agents write from other languages and that Istalang refuses or reads otherwise today (`docs/review/guessed-forms.md`, and the traps of the 2026-11-18 spec audit; those still open are in `docs/review/spec-audit-2026-11-18.md`). The human decided every rule below; **Decisions** lists the choices that settled its open points. Section numbers refer to the spec (`docs/spec/`).

```ista
fn label(x: Int?) -> String:
    if x is not None: `n = ${x + 1}`          # x reads as an Int here
    else: "none"

fn urgent(xs: Array<Order>) -> Bool: xs.any(fn(o): o.urgent)   # calls some; ista fmt writes some
fn scale(f: Float) -> Float: f * 2
const half: Float = 1                          # 1.0
const price: Decimal = 12.50                   # exact
fn trimmed(s: String) -> String: s.trim()      # no import
fn first(xs: Array<Int>) -> Int?: xs.at(0)? + 1 # ? on an optional
retry { save(order) }                          # deferred block: a lambda retry calls
const hold = holder()                          # keeps what it is given until this block ends
hold start(job)                                # the future, kept
hold onExit { log(order) }                     # runs when the block ends, however it ends
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

  ```ista
  fn first(xs: Array<Int>) -> Int:
      const x = xs.at(0)
      if x is None: return 0
      x * 2                                   # x reads as an Int
  ```
- **What narrows.** Only a name that can't change between the test and its use: a `const`, a by-value parameter, a name a pattern binds, and a path of stored fields (`.`) from one of them, since a value is copied whole (§7.2). A getter (§5.2) and a keyed member (§10.2) are calls, so they don't.
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

  `Map.includes` stays the function `in` calls, now an alias of `has` instead of a function calling it. Because `in` calls it, the formatter leaves `in` as written; only a written call `m.includes(k)` is rewritten.
- **Two std additions:**
  - **`unique()`** on an `Array<T>`: the items in their first order, each kept once by `==` (§10.2).
  - **`set(k, v)`** on a `Map<K, V>`, taking the map by reference as `push` does: it stores `v` at `k`. It carries `@Warn{"write m[k] = v"}`, since `m[k] = v` is the one way to write an entry. It is no alias, since `m[k] = v` is no function to name.

### 3. An integer known at compile time fits where a `Float` or a `Decimal` is expected

- **The rule.** A value of an integer literal type, a literal or a `const` holding one (Rule 20), is the `Float` or `Decimal` of that number wherever one is expected, as Swift and Go take a literal: `const half: Float = 1`, `scale(2)` for `scale(f: Float)`, `const rate = 2` then `scale(rate)`, `const price: Decimal = 12`. It reaches inside other types as the conversion into a union does (§4.2): `const xs: Array<Float> = [1, 2.5]`.
- **No value converts implicitly,** as in Kotlin, Swift, Rust and Go: an `Int` computed at run time goes into a `Float` by `Float(n)` (§8.4). Mixed operators keep the prelude's mixed overloads (`add(Int, Float) -> Float`, §10.2), as today.
- **Exactness is decided at compile time.** An integer the nearest `Float` would change is a compile error where a `Float` is expected, so no written digit is lost and none is silently infinite. A literal with a `.` where a `Decimal` is expected is that decimal exactly, read from its text: `const p: Decimal = 12.50`.
- **Choosing stays exact first.** Where the integer can go as an `Int`, it does: a union holding `Int`, such as `Int | Float` and `Json`, takes the `Int` member (§4.2); between overloads `f(Int)` and `f(Float)`, `f(2)` calls `f(Int)`, and with `f(Float)` alone, that; a type parameter inferred from one is `Int`. A union holding `Float` and `Decimal` but no `Int` takes neither (§4.2).
- **Joins.** Where several values take one type and none is expected (§4.2), integers known at compile time join a `Float` as `Float`s: `[1, 2.5]` is an `Array<Float>`, `if c: 1 else: 2.5` a `Float`. An `Int` computed at run time joins no `Float`.
- **Patterns.** An integer literal pattern against a `Float` or `Decimal` subject is that number: `case 2:` matches `2.0`.

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
- **A clash is reported at the declaration.** A function declared beside one its argument types' home modules provide, clashing with it by §6.3's rule, is error 5105 at the declaration, as a clash with the prelude is (§13.1): a local `fn trim(self: String)` beside `strings`'. Today such a clash is no error at the declaration and error 5003 at every call (a local `add(Duration, Duration)` beside `time`'s).
- `testing`'s `Instance` inspection keeps its import: `testing` doesn't declare `Instance`, so lookup doesn't reach it, by the same rule.

### 5. A line starting with an operator: shown by the formatter, joined only when indented

- **§2.1's rule stays:** in brackets, a line starting with `-`, `*`, `&`, `..` or `..=` glued to its operand (`-2`) starts an item, and one followed by a space (`- 2`) continues the item before it. `[1 ⏎ -2 ⏎ -3]` is three items.
- **A continuing line is indented deeper** than the line its item starts on. A spaced `- 2` line at the same indentation is a compile error, since it can start no item either: never a silent join. `x = (a ⏎     - b)`, indented as people write it, is `a - b`.
- **The formatter writes a `,`** at the end of a line whose next line starts with a glued `-`, `*`, `&`, `..` or `..=`, or a `/` (Rule 23), and only there, though a list broken over lines otherwise drops its commas (§2.1): `[1, ⏎ -2]`, `(a, ⏎ -b)`. Formatted code then shows every such split, so `(a, ⏎ -b)` reads as the tuple it is.
- Outside brackets nothing continues past a line break but an indented value (§3.2), as today. Its `- item` lines are untouched: there a line's leading `- ` is the item marker, after a `key:` that opens the listing, and `- -1` stays the item −1.

### 6. `%` as most languages; no `//`

- **`a % b` truncates,** taking the dividend's sign, as C, Java, JavaScript, Go, Rust, Kotlin and Swift: `-7 % 3 == -1`.
- **`//` goes.** Each form Rule 6 keeps is what most languages do: `%` truncates in most of them. `//` has no majority form, since only Python has it, so no meaning of it would be the familiar one. `a // b` is a compile error naming the two functions below. `/` still always gives a `Float` (§3.4).
- **Integer division is two pairs of functions,** each keeping `a == div(a, b) * b + rem(a, b)`:
  - `math.div(a, b)` truncates, pairing with `%` (C's `/` on integers);
  - `math.floorDiv(a, b)` floors, pairing with `math.mod(a, b)`, the floored modulo (Python's `//` and `%`, Java's `floorDiv` and `floorMod`), for cyclic indexes: `math.mod(-1, 7) == 6`.
- `FloorDivisible` becomes `Remaindering`, requiring `op_remainder` alone (Rule 19). By zero, all four panic (§12). `Decimal` follows `Int`.

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
- **It is a lambda.** The call or block captures as a lambda does (§6.4): a `let` is shared, read when the function runs and assignable inside, its changes seen on both sides; a `const` is copied, which reads the same. So `hold onExit { if not shipped: release(item) }` reads `shipped` when the holder is released, and `hold onExit { pending -= 1 }` compiles. Locals declared inside are the function's own. To keep a value as it is now, put it in a `const` first.
- **Parsing.** A `{` right after a camelCase name or path, or after `g(…)` on its line, opens a deferred block; after a PascalCase name it is a struct literal (§5.2), as types are PascalCase (§2.2). An indented `g:` line stays a label (§11.1).
- **When it runs is `g`'s choice:** `retry` calls it at once and again on failure, `onExit` when its disposable is released, a holder's `hold` and `start` at once (Rule 18).
- **Inside.** `await` makes the block an async function of the kind `g` takes (§6.4). `return`, and a `?` that would return, are compile errors inside a deferred block or call, so nothing written there reads as leaving the code around it; `break` and `continue` can't leave it either (§6.4). A `&` argument stays a compile error.
- **`spawn`, `runtime.delegate`, `rt.call` and `runtime.run`** follow (§14, §17.1): `spawn purchase(load(id))` loads in the new instance, and `await runtime.delegate fetch(build(x))` builds inside the job, after the commit, at least once, with the job's mark. Their captures must be sendable (§7.4), which a `let`'s shared cell isn't, so a `let` is put in a `const` first.
- **`defer` goes, for `onExit`** (Rule 18): a std function returning a disposable that runs its call when released, so the cleanup runs when whatever keeps it, a variable or a holder, lets it go; nothing says "block" or "function" but where that keeper is declared.

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
- So outside its module, a literal of the type can't give the field; it takes its default. Decoding (Rule 16) and a field loop's places (§11.2) still reach it, as privacy is of names: an invariant isn't guaranteed by it.
- **Privacy is of names, not of data.** A value is copied whole (§7.2): `==`, persistence, JSON, spreads (`T{...s}`), field loops, `keyof` and mapped types reach every field, as they do today. A field loop outside the module reads `_x` as a key like any other; it never names it.
- A leading `_` then means one thing in a name: private to where it is declared (a top-level name to its module, a field to its type's module, under proposal 18 a module to its package); `_ = e` alone discards (Rule 18).

### 18. Explicit lifetimes

Every value holding a disposable, a future included, has an owner the code names: it is consumed (`await`, `match`, `?`), returned, stored, kept in a variable (read or not: nothing reports an unread one), kept by a holder, or dropped. Nothing owns it implicitly. Leaving such a value unused is a compile error, at any depth (error 5025, as the checker does today: a struct, tuple, array or optional holding a future is must-use; §16's list says it).

- **A variable owns its value until its block ends** (§7.1), as every block-scoped language reads it. A longer lifetime is a variable declared where that lifetime ends.
- **`_ = e` discards,** as in Rust, Go, Swift, C# and Kotlin. On a value holding a disposable it is a compile error naming the choices: `await` it, keep it, or `drop` it. A JavaScript or C# reader takes `_ = start()` for fire-and-forget and a Rust reader for a cancel; neither is written by accident. `_ = r` ignores a `Result` holding none. `_` never holds, wherever it stands as a target: in a destructuring, `const (f, _) = pair` discards the second, an error if it holds a disposable (§4.5, §16's "`_` included" go).
- **`holder()`**, a std function, gives a `Holder<M>`, a shared struct that keeps what it is given for as long as it lives, as Python's `contextlib.ExitStack` does: `const hold = holder()` at a function's top keeps until the function ends, inside a block until the block ends. It is called as a function (Rule 24), `M fn op_call<T, M in Mark>(self: Holder<M>, make: Fn<(), T, M>)`, so `hold e` is a deferred call (Rule 12): it calls `make` at once and keeps its value, of any type (a closure capturing it, in an `Array<Fn<(), Unit, M>>`, so no `any` type is needed), and gives `Unit`. The values are released together when the `Holder` is, last first (§16).
  - **Marks and cycles need nothing new.** `Holder<M>` is generic over the mark of what it keeps, as `Deferred<M>` is, so a simple holder given an ista future is error 5616. It limits what `it` takes, not where the holder goes: a function value is simple data whatever it captures (§9.1), so simple code can pass a `Holder<"ista">` along and release it, as it can any closure keeping an ista value. That is intended: it can't call what it holds, and only running ista code is ista's (§9.1). Each kept value sits in a plain function value, which §16 takes to hold anything, so a holder that may come to keep itself (a kept call given the holder, a closure capturing it, a cell, a `Shared` or an inbox written with it later) is the cycle error 5720 or 5721.
  - **In ista code it is written `holder<"ista">()`:** no argument fixes its mark, and a mark nothing fixes settles to simple (§9.2).
  - **Implemented** in the std's `lifetimes` module as `hold.it e`, its method named `it` until this proposal is implemented, when it is renamed `op_call` and Rule 24 turns `hold.it e` into `hold e`; its tests and the cycle errors are in `src/stdlib/lifetimes/` and `test/corpus/holders/invalid-holder-cycles.ista`.
- **`onExit e`** returns a disposable that computes `e` when it is released: `hold onExit { log(x) }` runs when the holder goes. It reads variables when it runs (Rule 12), can't await, as disposal can't (§16), and runs on a normal end and on disposal at an `await`; a panic runs nothing (§12).
- **`start e`** calls an async block or call at once and returns its future: `hold start { await a() ⏎ await b() }` runs concurrently and is cancelled when the holder is released, owned by its holder, as a Rust future is by its owner and Java's `StructuredTaskScope` cancels on close; Kotlin's `coroutineScope`, Trio's nursery and Swift's `TaskGroup` wait instead, and Swift's `Task {}` runs on unowned.
- **A keeper's end cancels** what it keeps that hasn't finished; nothing waits for it. Work outliving its function would be fire-and-forget, which an upgrade resetting the function (proposal 10) would orphan; `spawn` starts work in an instance of its own (§17.1).
- **Nothing can be misused.** A nested function or lambda calling an outer `hold` keeps through the shared cell it captured (§6.4); if it escapes, the cell keeps the values alive, which is holding as §16 defines it.
- **`drop x`** takes a variable whose value holds a disposable, and releases it then: what it held is disposed if the variable was its last holder (§16), as a disposed value is never observable. `drop e` on an expression goes: `_ = e` ignores a `Result`, and starting something only to cancel it has no use.
- **What goes:** `hold let`, `hold const`, `hold(name)`, `hold _ = e`, `_ = e` keeping a value, `drop e`, `defer`, and block labels, which existed for `hold(name)`: a label is a loop's again (§11.1).

### 19. Operator functions are `op_` names

- **The rule.** A function an operator's symbol calls is named `op_` and its name today, as C# compiles its operators to `op_Addition`: `op_add`, `op_subtract`, `op_multiply`, `op_divide`, `op_remainder`, `op_negate`, `op_power`, `op_bitAnd`, `op_bitOr`, `op_bitXor`, `op_bitNot`, `op_shiftLeft`, `op_shiftRight`, `op_compare`, `op_index` and `op_setIndex` (§10.2). Their traits require those names (`Addable` requires `op_add`); conformance stays structural, and a type's module declares `fn op_add(a: Money, b: Money)`.
- **So common names are free.** A user's `fn add(x: Int, y: Int)` or `fn compare(a: Int, b: Int)` is an ordinary function, clashing with nothing, and `+` stays the prelude's. Today it is error 5105, then 5003 at every `+` in the module.
- **The `_` breaks camelCase on purpose:** it marks a function the syntax calls, as C#'s `op_` and Python's `__add__` do. Nothing else changes: `a.op_add(b)` is an ordinary call.
- **Functions a word or the runtime calls keep their names,** as code calls them by name too: `includes`, `iterate`, `from`, `toString`, `onAwait`, `dispose`.

### 20. A `const` keeps its literal type

- A `const` initialized with a literal, or with another such `const`, has the literal's type, as in TypeScript: `const s = "draft"` is a `"draft"`, so returning it where a `Status` (`"draft" | "sent"`) is expected checks; `const n = 5` is a `5`, `const b = true` a `true` (§4.3).
- **It widens** to `String`, `Int`, `Float` or `Bool` where it is inferred into a place that can change or hold others, unless an expected type keeps the literal: a `let`'s type, a collection's item, a struct literal's field without a declared type, and a type argument inferred from it. So `let m = n` is an `Int`, `[n]` an `Array<Int>`, and `const t: "draft" = s` keeps it.
- A `let` never has a literal type of its own; an annotation gives one.
- **A decided branch stays unchecked** (§11.1): with `const mode = "dev"`, `if mode == "prod":` is decided, so its branch is neither checked nor run, as a field loop's branches for other keys aren't (§11.2). Dead code is checked once it is live, when the constant changes; surprising, but nothing breaks.

### 21. Escapes

- A String's escapes (§3.1), in quotes, templates and `"""`, gain `\r`, `\0` and `\xNN` (two hex digits, a code point below 256), as Python, JavaScript and C have them.
- An unknown escape stays a compile error. There is no raw string form: a backslash meant as itself is written `\\`, and a regular expression takes its own literal (Rule 23).

### 22. `none` prints as `None`

- `none.toString()` is `"None"`, as Python prints it, so a `T?` is `Stringable` when `T` is: `${x}` with `x: Int?` gives the number or `None`, where it is error 5060 today.

### 23. Regular expression literals

- **`/pattern/flags`** is a `Regex` (§19.2), as in JavaScript: sugar for `Regex{"(?flags)pattern"}` on the existing `regex` module, nothing new beneath it. `/\d+/` is `Regex{"\\d+"}`, `/^ab/i` is `Regex{"(?i)^ab"}`.
- **The pattern is raw:** its text between the slashes goes to the engine unescaped, and only `\/` is read as a `/`. It stays on one line and can't be empty.
- **Checked at compile time:** an invalid pattern is a compile error, where `Regex{…}` panics where it is used.
- **Flags:** `i`, `m` and `s`, as the engine's inline flags. `g` is a compile error naming `findAll` and `replaceAll`, since a `Regex` keeps no position and a method chooses one match or all; `y`, `u`, `d` and `v` are compile errors too.
- **Where it starts:** a `/` where an expression can start (after `(`, `[`, `,`, `=`, `:`, an operator or `return`), never at a line's start, which continues the item before it in brackets (§2.1) opens one; after an operand it divides, as JavaScript reads it.
- `Regex`'s home is `regex` (Rule 4), so a literal needs no import, and its methods are found through it.
- The methods stay the regex's, receiving the text: `/\d+/.replaceAll(s, "#")`, `/x/.test(s)`; JavaScript's `s.replace(/x/, y)` is a type error, `replace` on a `String` taking a `String`.

### 24. A struct called as a function

- **`x(args)`** on a value whose type is a struct or shared struct, not a function type, calls `op_call(x, args)`, found beside the type as an operator's function is (§13.1), as Python's `__call__`, C++'s `operator()` and Kotlin's `operator fun invoke` do. So a call can be generic, overloaded, or take named arguments and defaults, which a function value can't (§6.4).
- **A deferred call reaches it** (Rule 12): `hold start(job)` gives `op_call`'s function-typed parameter the call, as a method's would.
- **It stays a struct, not a function type:** it fits no `fn(…)` parameter; `fn(x): hold(x)` wraps it. A field holding one is called as a function-typed field is (§6.4): `self.hold(e)` calls it, and is ambiguous beside a method `hold` taking `self`, as a function-typed field is. No trait names `op_call`, since its signature is any; generic code takes a function type.
- A type name stays a conversion: `Holder(x)` calls `Holder.from` (§8.4), as types are PascalCase and values camelCase (§2.2).

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
| `let n = 2; g(n)` | error 5001 | unchanged: `g(Float(n))` |
| `const rate = 2; g(rate)` | error 5001 | `g(2.0)`: a `const` of a literal type converts |
| `[1, 2.5]`, `if c: 1 else: 2.5` | error 5001 | `Array<Float>`, `Float` |
| `const xs: Array<Float> = [1, 2.5]` | error 5001 | `[1.0, 2.5]` |
| `const d: Decimal = 12` | error 5001 | `Decimal(12)` |
| `const d: Decimal = 12.50` | error 5001 | the decimal `12.50` |
| `case 2:` against a `Float` | warning 5422: no value reaches the case, so it never runs | matches `2.0` |
| `const j: Json = 2` | the `Int` member | unchanged |
| `s.trim()`, `trim(s)` with no import | error 5214, 4000 | call `strings.trim`, found through `String`'s home |
| `export trim, split from 'strings'` | error: no `export` | re-exports both |
| `ista fmt` on `[1 ⏎ -2]`, `(a ⏎ -b)` | `[1 ⏎ -2]`, `(a ⏎ -b)` | `[1, ⏎ -2]`, `(a, ⏎ -b)`: the same items, shown |
| `[1 ⏎ - 2]`, `- 2` at the item's indentation | `[1 - 2]` | compile error |
| `(a ⏎     - b)` | `a - b` | unchanged |
| `-7 % 3` | `2` | `-1` |
| `-7 // 2` | `-4` | compile error naming `math.div` and `math.floorDiv` |
| `xs[1..100]` on 3 items | panics | `xs[1..3]` |
| `math.round(2.5)` | `2.0` | `3.0` |
| `for i in 3..:` | panics: "Iterating needs a range with both ends" | counts up until `break` |
| `case Rejected(by, ...) as r` then `r.by` | error: a `Decision` has no field `by` | reads the field |
| `xs.at(0)?` in a function returning `Int?` | error: `?` takes a `Result` | the item, or returns `none` |
| `retry load(id).process()` | `load(id)` now, `process()` later | both later, reading `id` then |
| `hold onExit { if not shipped: release(item) }` | error | reads `shipped` when the holder is released |
| `retry { save(order) }` | error: a block after a name | a deferred block |
| `retry { return 1 }` | error | still an error: no `return` in a deferred block |
| `_ = defer log(x)` | runs at the block's end | error: no `defer`; `hold onExit log(x)`, with `hold` where the run should end |
| `_ = start()` | holds the future until the block ends | compile error naming `await`, keeping, `drop` |
| `hold start()`, `hold` from `holder()` | error: `hold` is a modifier | kept until `hold` is released |
| `x(1)`, `x` a struct with an `op_call` | error: not a function | calls `op_call(x, 1)` |
| `_ = audit.record(e)`, a `Result` holding no disposable | holds it until the block ends | discards it |
| `hold _ = runJob(job)` in a loop | held until the function ends | `hold runJob(job)`, `hold` declared at the function's top |
| `hold(batch) _ = start(job)`, a block label | held until `batch` ends | no block labels: a `holder()` declared in the block |
| `hold start { await a() ⏎ await b() }` | error | runs concurrently, cancelled when `hold` is released |
| `drop audit.record(e)` | discards | error: `drop` takes a variable; `_ =` ignores |
| `later x` for `later(f: fn() -> Int)` | error 5640: a call is expected | a deferred call computing `x` |
| top-level `const s = Source.Git("u", "v1")` | error 5026 | an enum constant |
| `const t = """a ⏎ b"""` | error: a docstring stands only first in a body | `"a\nb"`; `ista fmt` writes a template |
| `case limit:` with a top-level `const limit` | binds a new `limit` | compile error naming the guard |
| `json.parse<Config>("{}")`, `Config` with `retries: Int = 3` | fails: missing field | `Config{retries: 3}` |
| `s._secret`, `s["_secret"]` outside the declaring module | reads the field | compile error |
| `const s = "draft"` returned as a `Status` | error 5001 | checks |
| `"a\rb"`, `"\x41"` | error 1003 | a carriage return, `"A"` |
| `${x}`, `x: Int?` holding `none` | error 5060 | `"None"` |
| `s.replace(/\d+/g, "#")` | error: no regex literal | error naming `replaceAll` |
| `/\d+/i.test(s)` | error | a case-insensitive `Regex` |
| `fn add(x: Int, y: Int)`, `fn compare(a: Int, b: Int)` | error 5105, then 5003 at every `+` | ordinary functions |
| local `fn trim(self: String)` | (no clash today) | error 5105 at the declaration |

## What changes in power

**Gained.**
- An optional checked and then used as its value, with no `match`, no `as` and no new name.
- The names people guess accepted and called, then written by the formatter as the language's own, so code still reads one way.
- A function that warns at every call, for std and libraries alike: a forgiving name like `set` points at the one way.
- Numbers written as people write them where a `Float` or a `Decimal` is plainly meant, constants included.
- `%`, slices, rounding, open ranges, `?` on optionals and deferred calls behaving as most languages' do; std methods on strings and numbers without an import; enum constants; `"""` text.
- JSON that leaves out a defaulted field decodes, so producers can drop fields as they can add them.
- Fields hidden from code naming them outside their module.
- Every lifetime explicit and ordinary: a variable or a `holder()`, declared where the lifetime ends; cleanup as a value, `onExit`; a concurrent child, `start`. All of it std code, no lifetime syntax.

**Not gained.**
- Narrowing a `let`, a handle's field, an index or a call's result. Each can change between the test and the use, so a `const` or an `as` binding is written instead.
- Narrowing by comparison with any value but `none`, such as `x == 1` reading `x` as the literal type `1`.
- An `Int` computed at run time into a `Float` or `Decimal`, a `Float` into a `Decimal`, or anything into an `Int`: those still convert explicitly (§8.4).
- A raw string literal.

**Lost.** Rules 1–4, 10, 11, 13 and 14 take over forms that are errors today, and Rule 16 decodes that fail today. These change the meaning of code that compiles today (greenfield: no compatibility is kept): `%` on negative operands and `//` (Rule 6), slices out of range and `round` at a tie (Rules 7, 8), open ranges in loops (Rule 9), and when a deferred call's nested calls run and what its captures read (Rule 12). `defer` stops compiling under its old name, and a `return` in a deferred call does too. So do a spaced operator line at its item's indentation in brackets (Rule 5), a local function clashing with a home module's (Rule 4), a pattern binding over a top-level constant (Rule 15), a `_` field named outside its module (Rule 17), and Rule 18's removed forms: `_ = e` on a disposable, `hold let`, `hold const`, `hold(name)`, block labels, `defer`, `drop e`.

## Spec changes

- **§4.1, §4.2.** A compile-time integer into `Float` and `Decimal` where expected, values never; the joins.
- **§3.1.** A `.` literal as a `Decimal`; the exactness rule; `"""…"""` as text (and §2.3's escapes).
- **§2.1.** A spaced `-`, `*`, `&`, `..` or `..=` line continues its item only indented deeper; the formatter writes the `,` before a glued one.
- **§6.5.** Rewritten: `g expr` with any expression at prefix `await`'s precedence, every call deferred, captured as a lambda captures (§6.4), the block form; §16 for `defer`'s removal, §14 and §17.1 for `delegate`, `call`, `run` and `spawn`.
- **§3.3.** A `{` after a camelCase name opens a deferred block (the bracket table).
- **§8.4, §19.3.** A range is iterable with a start alone.
- **§5.1.** Enum values in constants.
- **§10.2, §8.4, §3.4.** `%` truncating; `//` and `FloorDivisible` gone, `Remaindering`; `math.div`, `math.floorDiv`; clamping slices.
- **§12.** `?` on optionals.
- **§4.1, §13.1, §19.1, §2.2.** Primitives declared in their home modules; `export` re-exports, the prelude's among them; `export` as a contextual word.
- **§16, §19.1, cheat sheet.** `defer` removed for `onExit`.
- **§13.1.** A clash with a function a type's home module provides is reported at the declaration (Rule 4); §13.1's "a module adding an export breaks no importer that doesn't use it" gains the exception: a declaration clashing with what a home module of its argument types adds.
- **§10.2, §8.4, §19.1, §19.3.** Operator functions renamed `op_…` (Rule 19), and §5.2's camelCase rule allows exactly the names Rule 19 lists, Rule 24's `op_call` among them, in the operator table, the traits and every std declaration.
- **§16, §7.1, §11.1, §19.1.** Rule 18: must-use at any depth; `_ =` discarding; `holder`, `onExit`, `start`; `drop` on variables; the `hold` modifiers, `hold(name)` and block labels go. Every example using `_ =`, `hold _` or `defer` (§7.1, §7.3, §15.3, §16, §18, §20, cheat sheet).
- **§19.2, §19.3.** `math.mod`; the rounding default; `format`, `graphemes`, `utf16Length` as methods; open ranges iterate.
- **§8.1.** A type parameter inferred from an integer literal is `Int`.
- **§4.3, §5.1, §7.1.** A `const` keeps its literal type, widening as Rule 20 says.
- **§3.1.** Escapes `\r`, `\0`, `\xNN`.
- **§3.1, §2.1, §19.2.** `/pattern/flags` literals and where a `/` opens one.
- **§2.2.** `hold` is no keyword (Rule 18), `export` a contextual one (Rule 4), and `String`, `Int`, `Float` are declared in their home modules (Rule 4).
- **§3.1, §19.2.** "`strings.format` remains", "where `trim` is imported" and "imported explicitly" become false under Rule 4.
- **§4.5, §16.** `_` as a destructuring target discards (Rule 18).
- **§6.4, §10.2.** A struct value called as a function calls `op_call` (Rule 24), a row of the operator table.
- **§3.1, §8.4, §19.3.** `none.toString()` is `"None"`; a `T?` is `Stringable` when `T` is.
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
   - **Aliases:** the checker resolves an alias to the target overload whose signature equals its own, once per declaration, and records it. A call or a value naming the alias reads that record. Resolution, witnesses and lowering then see the target, so no second function exists to lower. `Map.includes`'s body calling `has` goes.
   - **Alias sites:** the checker records each use of an alias as a site with the target's name. `ista fmt` and the language server's format request check the module, then hand those sites to the formatter as renames to apply while printing. The formatter's API without a program has no sites and renames nothing. The quick fix and the hint read the same sites.
   - **Warnings:** a call or value of a `@Warn` function reports the new warning with the struct's message, from the one place a call's target is recorded, so calls, method calls, operators and values all warn.
   - **The std additions:** `unique` and `set` are std functions (`stdlib/prelude/`), `set` carrying its `@Warn`.
4. **Compile-time integers into `Float` and `Decimal`.** Only a value of an integer literal type converts, so the literal's type carries it: the check of a literal and of a literal-typed `const` reads the expected type; nothing in `types/fitting/` converts a run-time `Int`.
   - **Checking:** the literal's check (`checker/constructs/expressions/literals/literals.ts`, `literal-types.ts`) reads the expected type through `types/fitting/expected.ts`, which already decides the member a value goes into.
   - **Choosing:** overload choice (`resolution/`) ranks an exact `Int` first, as it ranks exact fits today.
   - **Values:** computation (`rules/computation/`) and lowering emit a `Float` constant, or the `Decimal` that `Decimal(n)` builds, both known at compile time.
   - **Patterns:** literal patterns (`constructs/patterns/matching.ts`) take the subject's number type.
5. **Patterns over constants, JSON defaults, `_` fields.**
   - **Constants:** the binder already resolves what a bare pattern name would shadow; a top-level constant there is the new error.
   - **Defaults:** the derived decoder fills a missing field through the one place a struct literal computes its left-out defaults, so the two never differ.
   - **`_` fields:** one visibility check where a field is named (access, literal, pattern, place), reusing the `_` rule for top-level names; field loops and `keyof` don't pass through it.
6. **Explicit lifetimes.**
   - **`holder`, `onExit` and `start`** are std code (`.ista`); `onExit`'s disposable is today's `Deferred`.
   - **Must-use:** the one check (`rules/disposal/must-use.ts`, reading `types/properties/held.ts`) gains the `_ =` error, so it uses its definition of holding.
   - **Removed:** the `hold` modifiers, `hold(name)`, block labels and `defer`, from parser, checker and lowering.
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
    - `defer`'s rename to `finally` is superseded by decision 30.
14. **Enum values in top-level constants** (Rule 13), which proposal 18's manifest needs.
15. **T28: `"""…"""` is text, rewritten to a template by the formatter** (Rule 14). Review: Python's escapes, docstrings included, so the token has one meaning.
16. **Kept as they are:** T13 (half-open ranges, as Rust and Python), T23 (`UserId{id}` is the field shorthand, as Rust's; braces taking a value by position is Go's form, while Rust, Kotlin, Scala, Swift and Python build one-field types by a call), T31 (`5d` is 120 hours, as Java's `Duration.ofDays`, Kotlin's `days` and .NET's `TimeSpan` count a day; calendar days differ only across a change of offset, where `DateTime.addDays` keeps the wall-clock time).
17. **T15: a pattern binding over a constant is a compile error** (Rule 15). Review: top-level constants only, in `case` and `is` patterns; locals stay shadowable and parameter patterns untouched, as every language with patterns binds over locals.
18. **T20: decoding fills defaults** (Rule 16). Review: a `T?` field with a default reads it when missing and `none` from `null`; `@JsonSkip` reads back the field's default first.
19. **T30: `_` fields are private to the module declaring their type** (Rule 17). Review: keys too, `s["_x"]` and a `_` key through a keyed `index`; a test module importing it may name them, as it may a `_` top-level name; variants' and shared structs' fields alike; privacy is of names, so `==`, JSON, persistence and field loops still reach every field.
20. **T1–T3: explicit lifetimes** (Rule 18). Every disposable is consumed, kept or dropped, block first, longer when declared. `_ =` discards, and is an error on a disposable. `@Guard` only lifts the must-use error, making a bare statement a hidden variable; `hold`'s `Held` carries it. `hold` is a deferred-style function calling its lambda at once, any value, async blocks included; `fn.hold` and `label.hold` store into the scope's hidden variable; `fnName.onExit` is a std method (decision 30). `drop` takes a variable. A scope's end cancels, never waits: fire-and-forget would outlive a function an upgrade resets. Review: the lambda isn't kept by `Held` (its captures would outlive their variables unseen); `g expr` takes any expression (today only a call), binding as `await`'s operand.
21. **Deferred blocks and calls are lambdas** (Rule 12), superseding decision 13's copied captures: a `let` is shared and assignable, so cleanup reads variables when it runs. No eager-capture syntax: a `const` declared just before does it.
22. **T8 reversed** (Rule 5), superseding decision 9: §2.1's glued-or-spaced rule stays; a spaced operator line continues only indented deeper, else it is an error; the formatter writes the `,` before a glued one.
23. **Operator and runtime functions are `_` names** (Rule 19), so a user's `add` or `compare` clashes with nothing. A clash with a function a type's home module provides is reported at the declaration (Rule 4).
24. **`_` requirements and `implements`** (Rule 19), extending decision 23: `_` functions are private, methods and operators alike, keeping the `_add` spelling. A trait's `_` requirement is met only by a type whose own declaration says `implements` it, which closes a dummy trait reaching private functions; `implements` otherwise checks a structural conformance, as TypeScript's does. Operators on concrete types go through the conformance. Review: only the type's declaration may name its traits (else any module could claim one), and a `_` requirement is called by name only on a value typed by the trait.
25. **`//` dropped** (Rule 6), superseding decision 10's: the rule keeps what most languages do, and only Python has `//`. `math.div` (truncating, with `%`) and `math.floorDiv` (with `math.mod`).
26. **Only compile-time integers convert** (Rule 3), superseding decision 7: a run-time `Int` never converts implicitly, as in Kotlin, Swift, Rust and Go; a literal or literal-typed `const` does, its exactness decided at compile time. The mixed prelude overloads stay. Review: a `const` of a literal type counts, as Go's constants do, so `const rate = 2; scale(rate)` checks as `scale(2)` does.
27. **A `const` keeps its literal type** (Rule 20), widening as TypeScript's does.
28. **Escapes `\r`, `\0`, `\xNN`; no raw string form; unknown escapes stay errors** (Rule 21).
29. **`none` prints as `""`** (Rule 22).
30. **`defer` removed; cleanup is `fnName.onExit`** (Rules 12, 18), superseding the `finally` rename: one cleanup point, the function's end, however it ends, with no block-end form. `try { … } finally { … }` as std functions was weighed and dropped: an `await` before it, no `return` out of it, and no awaiting in its cleanup made it read unlike every language's `try`.
31. **Lifetimes are variables and std holders** (Rule 18), superseding decisions 20 and 30's syntax: `@Guard`, `Held`, scopes named by functions or labels, and `fnName.onExit` go. `holder()` gives a `hold` that keeps for as long as it lives, `onExit` is a disposable running its call when released, `start` runs a child at once. Considered: scopes as `&Scope` values (no language references lifetime scopes) and `$` for the current scope (a deferred block's `$` would be the lambda's). Review: no `_x` write-only variables are needed, as anything kept unread goes through a holder; `finalizer` would be `hold onExit`.
32. **Rule 19 withdrawn**, superseding decisions 23 and 24: `implements` added more than it solved (mixed-type operators had no conformance, conditional conformance and shapes had none). Operator functions keep their names, traits stay as they are, and no function is private by its name. A user's `fn add(x: Int, y: Int)` stays the clash it is today. Rule 4's clash at the declaration stays.
33. **`none` prints as `"None"`** (Rule 22), superseding decision 29, as Python prints it.
34. **Operator functions are `op_` names** (Rule 19), after decision 32's withdrawal: the accidental clash was the whole problem, so a name nobody writes by accident solves it with no mechanism. Review: only what a symbol calls; `includes`, `iterate`, `from`, `toString`, `onAwait`, `dispose` keep their names.
35. **Regular expression literals** (Rule 23): `/pattern/flags`, JavaScript's form, as sugar for `Regex{…}`; a raw pattern, checked at compile time. Review: `g` is an error rather than ignored, since `replace` with it would replace one match where JavaScript replaces all.
36. **A struct value can be called** (Rule 24), through `op_call`, so `holder()`'s `Holder` is called as `hold e` while its `op_call` is generic, which a closure can't be (§6.4).
37. **A branch decided by a `const`'s literal type stays unchecked** (Rule 20), as §11.1 has it: dead code is checked once live. Supersedes the compiler fix Rule 20 first named.
38. **`Holder`'s call is `it` until this proposal lands** (Rules 18, 24): `hold.it e` today, renamed `op_call` with Rule 24.
39. **A function value stays simple data** (Rule 18): simple code may pass along and release a closure or `Holder` keeping ista values, since it can't run them.
