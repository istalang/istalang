---
description: review of the spec read with proposal 6 applied (its rules 1–24) — traps for developers coming from Python, TS/JS, Rust, Go, Kotlin, Swift, C# and Java, and inconsistencies of the spec with itself, with proposals 12 and 18, and with the implementation (probed); read before settling proposal 6's text or writing the guide's warnings
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [review, spec, language, traps, proposals]
---

# Spec review, 2026-11-19

This reviews `docs/spec/` as it reads with `docs/proposals/6-familiar-forms.md` applied, in its revision with rules 1–24 (`op_` operator names, regex literals, `op_call`) and Rule 18's `Holder<M>`. It checks the spec against proposals 12 and 18, and against `dist/cli/main.js`, rebuilt so that it includes the `lifetimes` module's `Holder`, with probes run in a scratch directory. Every claim below about what the compiler accepts or rejects comes from a probe.

Items already tracked and still open are not repeated here: X1, 6.1, 6.2, 6.5, 6.6, 6.7, 12.x and 18.x in `proposal-issues-2026-11-19.md`, and T14–T36 in `spec-audit-2026-11-18.md`. Choices the human already decided are not raised again, `%` truncating and `start` cancelling among them, except where a rule's consequence is new.

The proposal's revisions resolved these earlier findings:
- `finally` copying its captures.
- A user's `add` or `compare` clashing (Rule 19: `op_add`, `op_compare`).
- `[1 ⏎ -2]` merging silently.
- `%` and `//` breaking `divmod`.
- `hold e` per iteration, and labels in nested functions.
- `${x}` on an optional being an error (Rule 22).
- `const s = "draft"` being a `String`.
- A silent infinite `Float`.
- `\r`.
- Rule 17 against Rule 18, and `_` in a destructuring.
- Rule 3's spec edits and its wording.
- `implements`, mixed operators, conditional conformance and host `dispose` (Rule 19 is now structural `op_` names).
- `delegate`, `call` and `run` under Rule 12.
- `holder()`'s signature (Rules 18, 24).
- Rule 1 and getters.
- Rule 17's invariant claim.
- The §2.2, §3.1 and §19.2 stale sentences.
- The proposal's `start` comparison.
- Rule 4's clash test (now §6.3's).
- `Holder` cycles: a holder that would come to keep itself is error 5720 or 5721. The probes confirm it through a call, a capture, a cell, a `Shared`, an inbox, an array of structs and a callee that stores it.

Severity: **H** a developer gets wrong behaviour silently, or contradictory rules; **M** surprising, or a confusing error; **L** minor or wording.

## 1. Unintuitive behaviour

| § / file | What Istalang does | What a developer expects (language) | Sev |
|---|---|---|---|
| P6 Rule 4 (clash at the declaration) | A local `fn trim(self: String)`, `fn round(self: Float)` or `fn capitalize(self: String)` is error 5105 whenever `strings` or `math` has a function clashing with it under §6.3. A later std, or a package under P18, that adds such a function breaks every program already declaring one. | A local definition shadows or overrides the library's (Python, JS, Kotlin, Rust, Go). Adding a function to a library breaks no caller that doesn't use it. §13.1 promises exactly that (see §2). | M |
| P6 Rule 5, §2.1 | `x = (base ⏎     -discount)`, with the `-` glued and indented deeper, starts a second item: the tuple `(base, -discount)`. Only a spaced `- discount` continues. `const` infers the tuple without complaint, and an error, if any, appears only later at a use. | Python and JS join lines inside parentheses, so `(a ⏎ -b)` is `a - b`. | M |
| P6 Rule 12, §2.1 | `if ready { go() }`, `while running { … }` and `for x in xs {` (the habit from Go, Rust, Swift, Kotlin and C#) parse `ready { … }` as a deferred block given to `ready`. Today the error is 5012 "'ready' is not a struct" (probed). Neither says "a condition ends with `:`". A missing comma (`[a b]`, `f(x y)`) also becomes a deferred call for any `b`. | A message that says the header needs `:`. | M |
| P6 Rule 1 | Narrowing doesn't go through `not`: `if not (x is None): x + 1` fails while `x is not None` narrows. After `if a is None or b is None: return`, whether `a` and `b` narrow is not said. | TypeScript and Kotlin narrow through `!` and through `\|\|` early exits. Swift does the same with `guard`. | M |
| P6 Rule 18 (`holder()` in ista code) | In ista code, `const hold = holder()` then `hold.invoke work()` with an ista `work` gives error 5616 "a deferred call is simple code, so it can't hold Future<Int, \"ista\">", and error 5607 "simple code calls nothing ista" (probed). Neither message points at the fix, `holder<"ista">()` on the declaration's line. The proposal's own examples (its opening block, Rule 18's "`const hold = holder()` at a function's top", the rows of its behaviour table) are written without the mark. In ista code they fail. | Rust infers a generic argument from a later use (`Vec::new()` then `push`), and so does Kotlin's builder inference. Where a language can't infer one, its error names the declaration to annotate. | M |
| P6 Rules 14, 21 | Rule 14 gives `"""` escapes and there is no raw string, so a docstring mentioning `\d` or `C:\x` stops compiling. Regexes now have `/…/` (Rule 23). | Python's `"""` keeps an unknown escape as written (a warning since 3.12). Kotlin's `"""` is raw. | L |
| P6 Rule 12 | A deferred call reads its arguments when it runs: `let x = 1; hold onExit log(x); x = 2` logs `2`. | Go's `defer log(x)` evaluates `x` at the `defer`. A finally clause, Swift and Zig read it at exit. A Go reader is the only one surprised. | L |
| P6 Rule 11 | `user?.name` is an optional chain, and propagating then reading is `(user?).name`. | In Rust, `x?.name` propagates first. A type error usually catches it. | L |
| §11.4 | A range pattern acts like a guard, so `case ..0:` with `case 0..:` over an `Int` is non-exhaustive (error 5400, probed). | Rust checks that integer ranges are exhaustive. | L |
| §5.2 naming | `user_id` is a compile error (4013, probed). | Python's PEP 8 and Rust use snake_case. A Python-like language refusing it surprises people, and a warning would suffice. | L |
| §7.1 | Declaring a name twice in one block is error 4005 (probed). | Rust shadows with `let` in one block as an idiom. | L |
| §3.4 | `1 / 0` on `Int`s is `Infinity` (probed). | Python, whose `/` this copies, raises `ZeroDivisionError`. | L |
| §19.2 `format`, P6 Rule 4 | `strings.format("{}", 42)` is error 5001: its values are `Array<String>`. Rule 4's `template.format(...values)` invites exactly this call. | Python's `"{}".format(42)` takes any value. | L |
| P6 Rule 17, §17.4 | `_` fields are written to JSON and read back from it (probed: `{"_secret":1,…}`), so `json.stringify` hands a private field to a host or a log. | Java's Jackson and C#'s `System.Text.Json` leave private fields out by default. Python and JS include them. | L |

## 2. Inconsistencies: spec, with proposal 6, against itself

| § / file | What it says | What is true or expected | Sev |
|---|---|---|---|
| P6 Rule 20 vs §11.1, §11.2, §11.3 | Rule 20: a branch decided by literal types "must still be checked; the rule doesn't change, the checker does". It calls today's unchecked branch a compiler issue. | It is no checker bug. §11.1 says a decided branch "is neither checked nor run", and field loops are built on that. §11.2: a condition a pass's key decides "rules out the code another field selects, which that pass never checks". §11.3 says the same of ruled-out cases. Checking every decided branch breaks field loops. Probed: over `struct S { a: String, b: Int }`, `for k, v in ...x: if k == "a": n += v.length()` compiles only because the `b` pass doesn't check `v.length()` on an `Int`. The rule must change: a branch decided by a field loop's key or a member parameter stays unchecked, while one decided by a `const`'s literal type is checked. Or `const` literal types don't decide conditions at all. | H |
| P6 Rule 23 vs §2.1, Rule 5 | Rule 23: a `/` "at a line's start" opens a regex literal. | §2.1: inside brackets a line starting with a binary operator continues the item. So `(total ⏎     / count)` is now an unterminated regex instead of a division. Rule 5 settles the same question for `-` by spacing and indentation, and Rule 23 by line position. JavaScript, which Rule 23 cites, reads a `/` after an operand on the previous line as division. | M |
| P6 Rule 4 vs §13.1 | Rule 4: a function clashing under §6.3 with one a home module provides is error 5105 at the declaration. | §13.1 promises "a module adding an export breaks no importer that doesn't use it". The module broken here doesn't even import the home module, and a new std or package function breaks it. | M |
| P6 Rule 18 (`Holder<M>`) vs §9.1 | "A holder of ista values can't pass into simple code (§9.1)". | Probed, and false. An unmarked `fn clear(s: Shared<Holder<"ista">?>): s->value = none` compiles, and so do `fn keep(h: Holder<"ista">) -> Holder<"ista">: h` and an ista caller handing `clear` the holder's last reference. `clear` then releases a running ista call, which is ista disposal, in simple code. The same `clear` over `Shared<Future<Unit, "ista">?>` is error 5609. `Holder<"ista">` keeps its values in function values, which are simple data whatever they capture (§9.1), so its mark limits what `invoke` takes, not where the holder goes. Either a shared struct whose fields keep data of a kind is of that kind, or `Holder` is marked through its type parameter (as `Future`'s `K` makes it ista). | M |
| P6 Rules 18, 24 vs §19.2 and the implementation | Rule 18: "`M fn op_call<T, M in Mark>(self: Holder, make: Fn<(), T, M>)` … in an `Array<fn() -> Unit>`". Rule 24: a struct called as a function calls `op_call`. | The implementation and §19.2 have `Holder<M>`, `kept: Array<Fn<(), Unit, M>>` and a method named `invoke`, which the proposal says "Rule 24's `op_call` turns into `hold e`". That gives the call operator two names, `invoke` (Kotlin's) and `op_call`. Either Rule 24 uses `invoke`, or the method is renamed. Rule 18's signature also lacks the `<M>`. | L |
| P6 Rule 19 vs §5.2, Rule 17 | Rule 19: "`op_add` … The `_` breaks camelCase on purpose". | §5.2 makes a name breaking camelCase a compile error, and §5.2 is not in Rule 19's spec changes. Not said: whether only the listed `op_` names are allowed, or any `op_x`. Rule 17 says "`_` then means one thing in a name: private", which a public `op_add` contradicts. | L |
| P6 Rule 24 vs §6.4 | `x(args)` on a struct value calls `op_call`. | §6.4: `x.f(…)` calls a field `f` of a function type, and is ambiguous beside a method `f`. Whether a field holding an `op_call` struct (`self.hold(e)`) is called, and is ambiguous beside a method, isn't said. | L |
| P6 Rule 18 (intro) | The owners include "kept in a variable the code reads", and decision 31 says "anything kept unread goes through a holder". | Whether a disposable kept in a variable that is never read is a compile error isn't said. | L |
| §6.1 vs §8.1 | §6.1: "a function value's call gives every argument by position, with no spread". | §8.1's own `logged` example spreads a pack into a function value, `f(...args)`, and the implementation accepts it. P12's `l(...args)` relies on it too. | M |
| §7.1 vs §11.1, §11.2 | §7.1: "a loop takes its label on its own line (§11.1)". §11.2: "labels, `hold` and `await` work as in any `for`". | §11.1 puts a loop's label on the loop's line, `outer: for`. Rule 18 rewrites §7.1's labels, but §11.2's `hold` mention is not in its list. | L |
| §8.4 | "Only conversions that can't fail are written this way: … `Int(3.7)`". | The same paragraph says `Int(x)` of NaN or an infinity panics. | L |

## 3. Inconsistencies: spec against proposals 12 and 18

| § / file | What it says | What is true or expected | Sev |
|---|---|---|---|
| P12 §1 vs P6 Rule 1 | P12: `t.0` is `t[0]`, a keyed element. P6: "a path of stored fields (`.`)" narrows, an index never does. | Whether `t.0 is Int` on a `const t` narrows `t.0` follows from neither. Tuple element paths need one rule. | M |
| P6 Rule 4 vs P18 internal modules | P6: a re-export keeps its home, lookup searches that home, and a clash with a home module's function is reported at the declaration. P18: a `_` module's exports are visible only inside its package. | Not said: whether `export X from '/std/_impl'` publishes `X` to other packages, and whether lookup, and so Rule 4's clash, reaches functions in a type's `_` home module from another package. One rule should decide all three. | M |
| P12 §3 vs §17.2, §17.4 | §17.4: an extern's rest reaches the host as an array. P12 adds tuple and named rests and lists neither section. | How such a rest crosses the boundary is not said. Today an extern pack is error 5101 (a pack takes no `Encodable`, probed). P12 lifts that, so the case becomes reachable. | M |
| P18 internal modules | "A module whose … folder on its path **under `/app`** starts with `_`", then "`endings` becomes `/std/_endings`". | The std isn't under `/app`. It should say "under its package's root". | L |
| P12 §3 vs P6 Rule 17 | An open named rest is "the shape of the named arguments given". | Shapes have no module, so a `_x:` argument builds a shape whose `_` field no privacy rule covers. | L |
| P12 vs §5.3, §6.3 | P12 cites §6.3 for choice and clashes, and lists neither §5.3 nor §6.3. | Not said: whether a variant may take a tuple or named rest, and how §6.3's clash rule treats named-rest fields. | L |
| P12 §6 vs §18 | P12 recommends a single `setups`. | §18 still says "overloads for up to six" (P12 open question 1). | L |
| P18 vs §13.1 | P18 has `/std` and `/app` roots and rejects `../`. | Every bare path in the spec, and P6's new `export String from 'strings'`, needs rewriting. Listed so P6's examples aren't missed. | L |

## 4. Inconsistencies: spec against the implementation

About 30 prose claims were probed: operators, chains, escapes, labels, defaults, warnings, the `&` rules, `!`, `**`, JSON defaults, map order and equality, decimal form, durations, annotations, overload clashes, decided conditions, and §19.2's `Holder` (keeping, release order, the cycle errors). All of them behave as the spec says. These are the ones that don't:

| § / file | Spec | Implementation | Sev |
|---|---|---|---|
| §19.2 `strings.format` | "`{}` takes the next value", read as any value, which is how §3.1 and P6 Rule 4 use it. | `fn format(template: String, ...values: Array<String>)` (`src/stdlib/strings/strings.ista`). `format("{}", 42)` is error 5001. | M |
| §19.2 module table, §13.1 paths | The table lists every std module. A bare path that names both a std module and a project file is an error. | `endings` isn't listed, yet `import resultOfEnding from 'endings'` checks. It also silently reserves `endings.ista` at a project's root. | L |
| P6 Rule 2, implementation note 3 | "`Map.includes` … now an alias of `has` instead of a second extern". "`Map.includes`'s separate extern goes." | It is already no extern: `fn includes(self: Map<K, V>, key: K) -> Bool: self.has(key)` (`prelude.ista`). | L |

## Architecture doc

Not in scope. No `architecture.md` claim was checked.
