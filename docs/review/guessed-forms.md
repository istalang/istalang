---
description: the syntax and typing forms an agent guessed from other languages when it wrote Istalang (the FormBuilder prototype, fixed in commit cd81d645), the Istalang form each became, how clearly the spec states it, which were compiler limitations instead, and what proposals 5–8 change — read before writing or generating Istalang, briefing an agent to, or deciding which guessed forms the language should accept or diagnose better
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-05
last_updated: 2026-11-05
tags: [review, language, agents, diagnostics, form-builder]
---

# Forms agents guess from other languages

Source: commit `cd81d645` (branch `form-builder`), which made the FormBuilder prototype check (`examples/FormBuilder`). The prototype was written as a design sketch, without compiling, by an agent that knew the spec only from documents. Counts are taken from the before and after versions of every `.ista` file, the generator `generate.ts`, the `.form.json` expression strings and `form-spec.test.ts`; generated sites count once per occurrence in the generated modules. The commit's own report is `examples/FormBuilder/ista-alignment.md` on that branch.

Layout was never the problem: indentation, `:` bodies, one-line bodies, `elif`/`else`, and continuation inside brackets were all written right. `;` between the fields of a brace list was right then too; proposal 5 makes it `,`, and its rewrite script converts it.

## Guessed forms

| Category | As written | Istalang form | Likely from | Count |
| --- | --- | --- | --- | --- |
| Lambda parameters | `fn({data, ctx}): …` | `fn(sc: S): { const struct{data, ctx} = sc; … }` | JavaScript and TypeScript destructuring | 55 |
| Struct values | `{ sku: …, qty: … }`, `{ for f, n in …: [f]: … }` | `struct{…}`: a bare `{…}` in an expression is a block | JavaScript and TypeScript object literals | about 38, from 3 generator sites and 1 JSON expression |
| Optionals | `x is Some{value as y}`, `case Some{value == false}` | `match x:` with `case None:` and `case y:`; `case false:` | Rust and Swift `Option`, or Istalang before proposal 3 | 11 |
| Std method names | `.any(fn …)` | `.some(fn …)` | Python, Kotlin, Rust | 6 in generated code and form JSON, 6 in test strings |
| Async callbacks | `eval: fn(Sc) -> Future<T>` | `async fn(Sc) -> T` | TypeScript's `(sc) => Promise<T>` | 5 |
| Optionals in text | `${data.country}`, `String(x)` with `x: T?` | a helper matching `None` first (`forms.text(x)`): `None` isn't `Stringable` | JavaScript templates, which print `null` | 3 calls, 6 interpolations |
| Reference arguments | `w.get(sc, out)` | `w.get(sc, &out)` | C#, Java and JavaScript object references | 3 |
| Single-field values | `Ok{v}`, meant as the value | `Ok{(v)}`: a bare name in braces is the shorthand `v: v` | Rust's `Ok(v)` | 4 |
| Float literals | `0`, `2`, `1000` where a `Float` is expected | `0.0`, `2.0`, `1000.0` | JavaScript's one number type, Python's promotion | 8 generated sites |
| Reserved words as fields | `{ case: K, value: … }` | renamed `tag` | JavaScript and TypeScript, where a keyword may name a property | 4 |
| Errors | `Error{message: "…"}` | adds `code:` | JavaScript's `new Error(message)` | 2 |
| JSON in generic code | `fn setJson<T>` calling `json.parse<T>` | `T is Decodable` (and `Encodable`), imported from `'json'` | TypeScript and Kotlin, whose JSON reads any type | 2, and the import |
| Empty structs | `struct P {}`, `P{}` | `struct P`, and the value `P` | Rust, TypeScript, Swift | 1 declaration, 2 values |
| Trait conformance | `impl View<Sc> for FieldView<Sc, T>:` | top-level `async fn draw<Sc, T>(self: FieldView<Sc, T>, …)` | Rust | 1 block, for 6 view types |
| Widening by spread | `{ ...sc.ctx, search }` | `struct{search, for k, v in ...sc.ctx: [k]: v}` | JavaScript and TypeScript spread | 1 generator site |
| Shared structs | `DynamicView<Sc>{…}` | `new DynamicView<Sc>{…}` | Rust and Go struct literals | 1 generator site |
| Endless loops | `while true:` ending a function that returns a value | `panic("unreachable")` after the loop: `while` has type `Unit` | TypeScript and Kotlin flow analysis, Rust's `loop` | 1 |
| Prelude scope | `Inbox`, `replaceAll` used without an import | `import Inbox from 'inbox'`, `import replaceAll from 'strings'` | JavaScript globals and string methods | 2 modules |
| Missing std methods | `keys.unique()`, `m.set(k, v)` | an `indexOf` loop; `m[k] = v` | lodash and Kotlin; JavaScript's `Map` | 1 each |
| Indexing by a union key | `self.cases[k]` with `k: keyof C`; `{ … }[keyof C]` | a struct comprehension over the cases | TypeScript's indexed access over a union | 2, partly a compiler limitation (below) |

The commit's other changes were design changes, not guesses: the variant's data reshaped around `tag`, each case held as a `Group`, the `…` placeholders implemented, and the `.py` file names (chosen for editor support) renamed.

**Top five by count and impact:**
1. Lambda parameter destructuring (55). Proposal 5 Rule 5 makes it valid.
2. `{…}` for a struct value (about 38). Still an error, and the costliest guess, since the braces silently read as a block until a later error.
3. `Some{…}` patterns (11).
4. `fn(…) -> Future<T>` for an async callback: legal syntax with another meaning, so the error appears only at the call site.
5. A missing `&`, `Ok{v}`, and `.any`: small and frequent.

## How clearly the spec states each

Stated clearly:
- `&` at the call site: §3.7, **Explicit at the call site**.
- `Ok{(receipt)}`: the cheat sheet, "a bare name needs ( )".
- A type without fields is just its name: §2, **Literals**.
- Arrays take JavaScript's method names: §3.8, `Array<T>`.
- `case` is reserved: §2, **Reserved words**.
- `while` is a statement of type `Unit`: §4.
- `T?` is `T | None`: §2, **Unions**.
- `Error`'s fields: §3.12.
- `new` builds a shared struct: §3.1, §3.18.

Easy to guess wrong:
- **Braces.** The cheat sheet shows the anonymous struct type as `{ sku: String, qty: Int }`, but a value needs `struct{…}`. Only §2 **What each kind of bracket means** says a bare `{…}` in an expression is a block.
- **Async function types.** `async fn(A) -> R` and `fn(A) -> Future<R>` are both legal and nothing contrasts them. A declaration writes `async fn f(x: A) -> Future<R>`, yet its type is written `async fn(A) -> R`.
- **Spread.** The spec shows only the updated copy (`Req{...req, value: "new"}`); nothing says a spread can't add fields.
- **JSON in generic code** needs `T is Decodable`; the spec shows it only in an extern's signature (`receive<T is Decodable>`).
- **`Int` never converts to `Float`.** Only implied, by its absence from §2's list of six implicit conversions.
- **Prelude against modules.** That `Inbox` lives in `'inbox'` and `replaceAll` in `'strings'` is only in §3.8's tables.

## Compiler and toolchain limitations, not guesses

- **Lambdas in generic calls.** A lambda passed to a generic call is checked before the call's result is matched to its expected type, so `Sc` isn't inferred from the expected type. This forced 59 `sc: Scope` annotations, and 22 bare `Fixed{…}` in place of `Prop.Fixed{…}`.
- **Branches without an expected type.** `if …: none else: "…"` needed one, so 2 lambdas gained `-> Future<String?>`.
- **A stack overflow.** `Group`'s `type Data = { [F in keyof S]: S[F].Data }` overflowed `substituteMapped` on a recursive struct, so both associated types were wrapped in a type `match`.
- **Recursive conformance**, error 5134 on `CategoryModel`: fixed on `p5-indented` by `7a743115`, coinductive struct-constraint and union-member conformance.
- **Unions of structs.** `of[keyof C]` isn't fitted inside a generic body, and a union of structs derives no JSON codec (§9, §14). Together they forced the tag-based variant.
- **Import paths.** `'forms'` became `'./forms'` in about 30 places, because the project root is the working directory rather than the folder holding `ista.json` (tracker F1).

## Two questions the human asked

**Why is `fn(A) -> Future<R>` not `async fn(A) -> R`?** Both calls give a `Future<R>` that `await` reads (§3.14, **Async function types**); only an `async fn`'s body may `await`. §3.14 converts one way only: a plain function fits where an async one is expected. So `takesPlain(two)`, with `takesPlain(f: fn(Int) -> Future<Int>)` and `two: async fn(Int) -> Int`, is error 5001. Yet `fn start(x: Int) -> Future<Int>: two(x)` checks and runs, so wrapping any async function in `fn(x): f(x)` already gives the plain type. The two types differ in no observable way at a call; the missing direction is a gap, and the spellings disagree between a declaration and its type. Proposal 8 makes them one type with two equal spellings.

**Why is `Ok{v}` refused?** The parser tells a brace literal's items apart by their first tokens, without knowing the fields (§3.1). A bare name followed by `}` or `,` is always the shorthand `name: name`, as in `Pair{first}`. `Ok{v}` is `Ok{v: v}`: error 5013 "Ok has no field 'v'" and 5014 "needs a value for 'value'", neither of which names the cause. `Ok{value}` works, and `Ok{(v)}`, `Ok{42}` and `Ok{f(x)}` are positional. Proposal 7 declares a variant in parentheses and calls it, `Ok(v)`.

## What proposals 5–8 change

- **Proposal 5** (`p5-indented`):
  - Rule 5 makes `fn({data, ctx}): …` valid; `{…}` is short for `struct{…}` in a parameter. The 55 rewrites could go back to it, though the inference-order limitation still applies.
  - Rule 4 makes `;` between list items error 2038, whose message names `,`.
  - Rules 6 and 7 let generated lists break without commas, and the five `import … from './forms'` lines become one parenthesized import.
  - A bare `{a: 1}` in an expression stays a block. Rule 1's indented values are another way to write the value, not a fix for the guess.
- **Proposal 6**: `x is not None`, and narrowing after `x is None`; `@AliasFor` (`any` calls `some`, and `ista fmt` writes `some`) and `@Warn` (`Map.set` warns toward `m[k] = v`), with `unique()` added; an integer literal is a `Float` or a `Decimal` where one is expected.
- **Proposal 7**: variants declared and called as functions are, `Rejected(by: String, reason: String = "")` and `Ok(v)`, and the widening `struct{...x, y, z}`.
- **Proposal 8**: one async function type, spelled `async fn(A) -> R` or `fn(A) -> Future<R>` alike, and `async fn f() -> R` accepted as a header.

## Left as instruction, not language

The human decided that writing `struct{…}` for a struct value stays, and is taught rather than changed. Briefs and guides that ask an agent to write Istalang should state:
- **Struct values.** A struct value is `T{…}` or `struct{…}`; a bare `{…}` in an expression is a block. Types are written `{ a: Int }`, values `struct{a: 1}`.
- **No `impl`.** A type meets a trait through top-level functions taking `self` (§3.10).
- **Optionals.** `T?` is `T | None`: there is no `Some`. Take one apart with `case None:` and `case x:`, or with `?.` and `??`.
- **References.** A reference argument is written `&x` at the call.
- **JSON in generic code.** A generic function that encodes or decodes `T` constrains `T is Encodable` or `T is Decodable`.
- **Imports.** `Inbox`, `replaceAll` and other std names come from their modules (§3.8); only the prelude is implicit.

## Diagnostics worth adding

- **A block that reads like a struct.** A `{…}` whose first item reads as `name: value` or `...x`: "a struct value takes its type or `struct` before `{`: `struct{a: 1}` (§2)".
- **`Some`** (error 4000 today, "'Some' is not declared"): "optionals are `T | None`: `case None:` and `case x:`, or `?.` and `??` (§2)".
- **`impl … for …`**: "a type meets a trait through top-level functions taking `self`; declare `fn m(self: T, …)` (§3.10)".
- **A known std alias.** An unknown member on a std type that names a known alias suggests the method: `.set(k, v)` → `m[k] = v`, `.unique()` → "no such method". Proposal 6 accepts the true aliases through `@AliasFor`, and `set` under a `@Warn`.
- **A lone bare name in single-field braces.** Before proposal 7: "a bare name is the shorthand `v: v`; write `Ok{(v)}` for the value".
- **A reference parameter given a bare name**: "pass `&out`".
