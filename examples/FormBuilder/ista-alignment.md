---
description: alignment of the FormBuilder prototype with the Istalang specification and compiler — assumptions validated, fixes, rewrites, and proposed language changes
owner: tech-lead
status: active
applies_to: examples/FormBuilder
last_verified: 2026-11-06
last_updated: 2026-11-13
tags: [form-builder, alignment, specification, compiler]
---

# Form Builder — Istalang Alignment Report

Validation of `examples/FormBuilder` (`forms.ista`, `order.ista`, `supplier.ista`, `generate.ts`, `order.form.json`, `supplier.form.json`, `order.gen.ista`, `supplier.gen.ista`, and `form-builder-spec.md`) against the Istalang specification (`docs/spec.md`) and compiler (`ista check`).

## Summary

| # | Assumption | Source | Status |
| --- | --- | --- | --- |
| 1 | Struct comprehensions (`struct{for f, node in ...self.fields: [f]: …}`) | spec §8 #1 | **Fixed** |
| 2 | `Variant<C>.Data` as a mapped type indexed by `keyof C`, and field name `case` | spec §8 #2 | **Rewritten** |
| 3 | Indexing `self.cases[k]` with a union key `k: keyof C` in `Variant.read()` | spec §8 #3 | **Rewritten** |
| 4 | Indexed access on a type by a literal key (`OrderPaymentCases["card"].Seen`) | spec §8 #4 | **Fixed** |
| 5 | Top-level type aliases, including generic ones (`type OrderData = …`) | spec §8 #5 | **Fixed** |
| 6 | Constructing a shape through a type alias (`OrderScope1{…}`) | spec §8 #6 | **Fixed** |
| 7 | Async lambdas and `async fn(Sc) -> T` function types | spec §8 #7 | **Fixed** |
| 8 | Struct destructuring in lambda parameters (`fn({data, ctx}): …`) | spec §8 #8 | **Fixed** |
| 9 | Generic traits and `any View<Sc>` over generic structs | spec §8 #9 | **Fixed** |
| 10 | Async trait methods and structural trait conformance (no `impl` blocks) | spec §8 #10 | **Fixed** |
| 11 | Widening a struct with a new field (`{ ...sc.ctx, search }`) | spec §8 #11 | **Rewritten** |
| 12 | Structural `==` and `!=` on structs and computed types | spec §8 #12 | **Fixed** |
| 13 | Parsing JSON into literal unions and structs (`json.parse<T>`) | spec §8 #13 | **Fixed** |
| 14 | Recursive form definitions (`CategoryModel` with `List<Group<CategoryModel>>`) | spec §8 #14 | **Fixed** |
| 15 | Struct constraints (`struct { [_] is FormNode }`) met by anonymous structs | spec §8 #15 | **Fixed** |
| 16 | Implicit conversion of a `shared struct` (`Hidden<N>`) to `(any Showable)?` | spec §8 #16 | **Fixed** |
| 17 | Empty struct declarations and values (`struct CategoryParams`) | spec §8 #17 | **Fixed** |
| 18 | Lambda parameter type annotations and bare `Fixed` variants in generic calls | spec §8 #18 | **Fixed** |
| 19 | Optionals as `T \| None` unions rather than a `Some{value}` enum | `forms.ista` | **Fixed** |
| 20 | Single-field positional construction with a variable (`Ok{(v)}`) | `forms.ista` | **Fixed** |
| 21 | `Error` struct requires both `message` and `code` | `forms.ista` | **Fixed** |
| 22 | `Int` and `Float` literals are distinct (`0.0` vs `0`) | `generate.ts` | **Fixed** |
| 23 | Standard library imports and method names (`Inbox`, `replaceAll`, `.some`, `m[k] = v`) | `forms.ista`, `*.form.json` | **Fixed** |
| 24 | Interpolating optional `Seen` values (`T?`) in message templates (`forms.text`) | `forms.ista`, `generate.ts` | **Fixed** |
| 25 | Explicit `&` at reference call sites (`w.get(sc, &out)`) | `forms.ista` | **Fixed** |
| 26 | `while true:` is a statement of type `Unit` | `forms.ista` | **Fixed** |

### Compilation status

- `forms.ista`: **0 errors, 0 warnings**
- `order.ista`: **0 errors, 0 warnings**
- `supplier.ista`: **0 errors, 0 warnings**
- `order.gen.ista`: **0 errors, 0 warnings** (and passes end-to-end runtime execution)
- `supplier.gen.ista`: **0 errors, 0 warnings** (a program building the recursive `categoryModel()` and `categoryView(…)` runs)

---

## Detailed Findings

### 1. Struct comprehensions and anonymous struct literals (spec §8 #1) — **Fixed**

- **Assumption:** `{ for f, node in ...self.fields: [f]: node.seen() }` and `{ sku: new Field<String>{}, qty: new Field<Int>{} }` build anonymous structs.
- **Spec (`docs/spec.md` §2, §3.1, §4):** In an expression position, `{ … }` is a block expression unless preceded by a type name or `struct`. Anonymous struct literals and struct comprehensions are written `struct{…}`, as in `struct{for f, node in ...self.fields: [f]: node.seen()}`.
- **Change:** Prefixed anonymous struct literals and struct comprehensions with `struct` in `forms.ista`, `generate.ts` (`lit`, `groupLiteral`, `variant` cases), and `supplier.form.json`.

### 2. `Variant<C>.Data` representation and reserved word `case` (spec §8 #2) — **Rewritten**

- **Assumption:** `Variant<C>` declares `type Data = { [K in keyof C]: { case: K, value: Group<C[K]>.Data } }[keyof C]`.
- **Spec (`docs/spec.md` §2, §3.1, §9):**
  1. `case` is a reserved word (§2) and cannot name a struct field.
  2. While `{ [K in keyof C]: … }[keyof C]` is a valid indexed mapped type (§3.1), inside generic `Variant.read<C>` it remains an unreduced `FieldType` (`of[keyof C]`), and Istalang's fitting rules (`fit/index.ts`) do not convert a struct `{ tag: k, value: … }` built with a field-loop key `k: K in keyof C` into that unreduced `FieldType`.
  3. In Istalang v0.1, general unions of structs do not derive `Encodable` or `Decodable` (§9, §14), which would prevent any form result containing a `Variant` from crossing the host/JSON boundary.
- **Alternative used:** Renamed `case` to `tag` (matching `Variant.tag` and the schema's `tag` property), simplified `Variant<C is struct { [_] is FormNode }>` so `cases: C` holds each case's `Group<…>` directly, and used `form-builder-spec.md` §8 #2's fallback struct:
  ```python
  struct Variant<C is struct { [_] is FormNode }>:
      tag: Field<keyof C>
      cases: C
      type Data = { tag: keyof C, value: { [K in keyof C]: C[K].Data? } }
      type Seen = { tag: (keyof C)?, value: { [K in keyof C]: C[K].Seen? } }
  ```
  Both `keyof C` (a union of string literals) and `{ [K in keyof C]: C[K].Data? }` derive `Encodable` and `Decodable` (§9).

### 3. Reading a struct field with a union-typed key in `Variant.read()` (spec §8 #3) — **Rewritten**

- **Assumption:** `self.cases[k].read()?` where `k: keyof C`.
- **Spec (`docs/spec.md` §3.1, §3.10, §4):** Because each field of `C` has its own `Group` type with a distinct `Data` associated type, `self.cases[k]` for an unnarrowed `k: keyof C` is a union of distinct `Group` types, and a union has no associated types (§3.1, §3.10).
- **Alternative used:** Built `Variant.read()` with a struct comprehension over `...self.cases`, where each pass types `g` at its own key `k` and only the active case calls `g.read()?`:
  ```python
  fn read<C is struct { [_] is FormNode }>(self: Variant<C>) -> Result<Variant<C>.Data>:
      const active = self.tag.read()?
      const activeStr: String = active
      Ok{struct{tag: active, value: struct{for k, g in ...self.cases: [k]: if activeStr == k: g.read()? else: none}}}
  ```
  (`active` is widened to `String` before comparing with `k` so the runtime compares the underlying strings rather than a union variant against a bare string.)

### 4. Indexed access on a type by a literal key (spec §8 #4) — **Fixed**

- **Assumption:** `OrderPaymentCases["card"].Seen` indexes a struct type by a string literal type.
- **Spec (`docs/spec.md` §3.1):** `S[K]` is built in. With `OrderPaymentCases` mapping each case key to its `Group<{ … }>`, `OrderPaymentCases["card"].Seen` works directly.

### 5. Top-level type aliases, including generic ones (spec §8 #5) — **Fixed**

- **Assumption:** `type Date = String`, `type OrderData = Group<OrderModel>.Data`, etc.
- **Spec (`docs/spec.md` §3.17):** Top-level `type` aliases, generic or concrete, are supported as written.

### 6. Constructing a value by an alias of an anonymous struct type (spec §8 #6) — **Fixed**

- **Assumption:** `OrderScope1{data: sc.data, ctx: sc.ctx, item: r1.seen()}` where `OrderScope1` is an alias for `{ data: …, ctx: …, item: … }`.
- **Spec (`docs/spec.md` §3.17):** An alias of a shape may stand before `{` to construct a value of that shape.

### 7. Async lambdas and async function types (spec §8 #7) — **Fixed**

- **Assumption:** `async fn(…): await …` and `eval: fn(Sc) -> Future<T>`.
- **Spec (`docs/spec.md` §3.3, §3.14):**
  1. An async function type is written `async fn(Sc) -> T`, not `fn(Sc) -> Future<T>` (which types a synchronous function returning a `Future`). Calling an `async fn(Sc) -> T` yields `Future<T>`, and a plain `fn(Sc) -> T` converts implicitly to `async fn(Sc) -> T`.
  2. A lambda with an explicit return type annotation writes `async fn(sc: Sc) -> Future<T>: …` (§3.3).
- **Change:** Updated `Prop.Awaited`, `awaited`, `Check.Later`, `later`, `Options.Search`, and `ScopedView.scope` in `forms.ista` to use `async fn(…) -> …`, and annotated `forms.later`'s check lambda with `-> Future<String?>` (or `-> String?` when synchronous) in `generate.ts` so `if …: none else: "…"` has expected type `String?`.

### 8. Struct patterns as lambda parameters (spec §8 #8) — **Fixed**

- **Assumption:** `fn({data, ctx, item}): item.qty > 0` destructures the scope parameter in the parameter list.
- **Spec (`docs/spec.md` §3.3, §3.14, §3.15):** A parameter may be any pattern that can't fail; in a parameter, `{…}` is short for `struct{…}`, and a lambda's pattern takes its type from the expected function type or an annotation.
- **Change:** `generate.ts` (`lam`) emits:
  ```python
  fn({data, ctx}: OrderScope): <expr>
  ```

### 9. Generic traits and `any Trait<P>` over generic structs (spec §8 #9) — **Fixed**

- **Assumption:** `any View<OrderScope>` holds heterogeneous view structs (`LayoutView<OrderScope>`, `FieldView<OrderScope, String>`, `RepeatView<OrderScope, …>`, etc.).
- **Spec (`docs/spec.md` §3.10):** Object-safe generic traits and `any View<Sc>` are supported as written.

### 10. Async trait methods and structural trait conformance (spec §8 #10) — **Fixed**

- **Assumption:** `trait View<Sc>: async fn draw(…)` and `impl View<Sc> for FieldView<Sc, T>:`.
- **Spec (`docs/spec.md` §3.10):** Async trait methods are supported; conformance is structural via ordinary top-level functions (`async fn draw<Sc, T>(self: FieldView<Sc, T>, …)`) with no `impl` blocks.
- **Change:** Replaced `impl View<Sc> for FieldView<Sc, T>:` with top-level `async fn draw` functions for `FieldView`, `RepeatView`, `VariantView`, `LayoutView`, `ScopedView`, and `DynamicView` in `forms.ista`.

### 11. Spreading a struct into an anonymous struct literal to add a field (spec §8 #11) — **Rewritten**

- **Assumption:** `const ctx = { ...sc.ctx, search }` widens `sc.ctx` with a new `search` field.
- **Spec (`docs/spec.md` §3.1, §4):** A leading spread `struct{...req, field: v}` constructs an updated copy of `req` of the **same** type, overriding existing fields; it cannot add new fields. A struct comprehension `struct{search, for k, v in ...sc.ctx: [k]: v}` (§4) builds a shape with named fields plus every field of `sc.ctx`.
- **Alternative used:** Updated `generate.ts` (`options` for `search` widgets) to emit:
  ```python
  const ctx = struct{search, for k, v in ...sc.ctx: [k]: v}
  ```

### 12. Structural `==` on structs and computed types (spec §8 #12) — **Fixed**

- **Assumption:** `if task->sc != sc` and `if after == before` compare scopes and `Seen` data structurally.
- **Spec (`docs/spec.md` §3.1, §3.9):** Built-in `==` and `!=` compare all value types (structs, shapes, tuples, enums, arrays, maps) structurally and handles by identity.

### 13. Parsing JSON into literal unions and computed types (spec §8 #13) — **Fixed**

- **Assumption:** `json.parse<T>(value)` parses JSON strings into primitives, structs, and literal unions (`"small" | "medium" | "large"`).
- **Spec (`docs/spec.md` §3.5, §9):** The compiler derives `Encodable` and `Decodable` for structs, enums, tuples, literal types, and unions of literals (§9). Generic functions calling `json.parse<T>` or `json.stringify` must constrain `T is Decodable` / `T is Encodable` (§3.5).
- **Change:** Constrained `setJson<T is Decodable>` and `FieldView.draw<Sc, T is Encodable & Decodable>` in `forms.ista`.

### 14. Recursive types through generic containers (spec §8 #14) — **Fixed**

- **Assumption:** A local form definition `#category` mounting itself inside a repeat (`struct CategoryModel { name: Field<String>, children: List<Group<CategoryModel>> }`) works with generic `Group<S>` and `List<R>`.
- **What works after fixing `Group<S>`:**
  - In `forms.ista`, `Group<S>` originally wrote `type Data = { [F in keyof S]: S[F].Data }` and `type Seen = { [F in keyof S]: S[F].Seen }`. Per `docs/spec.md` §3.1 and §3.17, only an alias or associated type whose body is a `type match` may refer to itself; a non-`match` associated type on a recursive struct caused a stack overflow in `substituteMapped`.
  - Wrapping `Group<S>`'s associated types in a `type match` (`type Data = match S: case _: { [F in keyof S]: S[F].Data }` and `type Seen = match S: case _: { [F in keyof S]: S[F].Seen }`) fixes the stack overflow and resolves `Group<CategoryModel>.Data` and `Group<CategoryModel>.Seen` to recursive shapes (§3.17).
- **Spec (`docs/spec.md` §3.5):** A recursive struct type meets a struct constraint when its fields do, assuming the struct itself meets it while its fields are checked. So `CategoryModel is struct { [_] is FormNode }`, which reaches itself through `List<Group<CategoryModel>> is FormNode` and `Group<CategoryModel> is FormNode`, holds.
- **Status:** `supplier.gen.ista` checks with no errors, and a program building `categoryModel()` and `categoryView(…)` runs.

### 15. Struct constraints satisfied by nested anonymous structs (spec §8 #15) — **Fixed**

- **Assumption:** `Group<{ sku: Field<String>, qty: Field<Int> }>` satisfies `S is struct { [_] is FormNode }`.
- **Spec (`docs/spec.md` §3.5):** Both nominal `struct` declarations and anonymous struct types (shapes) satisfy `struct { … }` constraints when their fields meet the entries. Once anonymous struct literals in `generate.ts` were written `struct{…}`, this compiled without changes.

### 16. Implicit conversion of a shared struct to `any Trait` (spec §8 #16) — **Fixed**

- **Assumption:** `hide: m.city` (`Hidden<Field<String>>`) converts implicitly into `(any Showable)?`.
- **Spec (`docs/spec.md` §2, §3.10):** A value of any type meeting `Showable` converts into `any Showable`, and into `(any Showable)?` through the union conversion (§2).

### 17. Empty struct declarations (spec §8 #17) — **Fixed**

- **Assumption:** `struct CategoryParams {}` declares an empty struct and `CategoryParams{}` constructs it.
- **Spec (`docs/spec.md` §3.1):** A struct without fields is declared `struct CategoryParams` and its value is written bare as `CategoryParams`; braces after a fieldless struct name in an expression are a compile error.
- **Change:** Updated `generate.ts` to emit `struct ${P}Params` and bare `${P}Params` when a local def has no parameters.

### 18. Lambda parameter types and variant literals in generic calls (spec §8 #18) — **Fixed**

- **Assumption:** Untyped lambdas `fn(sc): …` and qualified `Prop.Fixed{…}` inside generic calls (`forms.min(Prop.Fixed{1})`, `forms.rule(fn(sc): …)`) infer `Sc` from the enclosing field's expected type.
- **Spec (`docs/spec.md` §3.5, §3.11, §3.14):**
  1. A lambda passed to a generic function (`forms.rule<Sc, T>`, `forms.awaited<Sc, T>`, `forms.later<Sc, T>`) is checked before the call's return type is matched against the enclosing expected type; annotating `fn(sc: ${sc.type})` binds `Sc` directly from the lambda argument.
  2. A qualified variant literal `Prop.Fixed{1}` passed as a call argument is checked eagerly before the call is chosen (where `Sc` is unknown because `Fixed { value: T }` does not mention `Sc`), whereas a bare variant `Fixed{1}` is deferred until the chosen function's parameter type `Prop<Sc, T>` is known (§3.5, §3.11).
- **Change:** Annotated scope lambda parameters with `sc: ${sc.type}` and emitted bare `Fixed{…}` in `checks` in `generate.ts`.

### 19. Optionals are unions `T | None`, not `Some{value}` — **Fixed**

- **Assumption:** `forms.ista` matched optional values with `is Some{value as x}` and `case Some{value == false}:`.
- **Spec (`docs/spec.md` §2, §3.11):** `T?` is `T | None`, taken apart with `match` (`case None:` then `case x:`), literal patterns (`case false:`), or `?.` and `??`.
- **Change:** Replaced all `Some{…}` patterns in `forms.ista` with union patterns and optional chaining.

### 20. Single-field struct/variant positional construction with a variable — **Fixed**

- **Assumption:** `Ok{v}` and `Ok{out}` in `forms.ista`.
- **Spec (`docs/spec.md` §3.1, §3.11):** A bare identifier in braces is always field shorthand (`Ok{v: v}`); passing a variable positionally to a single-field struct or variant requires parentheses: `Ok{(v)}`, `Ok{(out)}`.
- **Change:** Updated single-field `Ok` constructions in `forms.ista` to `Ok{(v)}` and `Ok{(out)}`.

### 21. `Error` requires `code` — **Fixed**

- **Assumption:** `Error{message: "unanswered"}` in `forms.ista`.
- **Spec (`docs/spec.md` §3.12):** `Error` has required fields `message: String` and `code: String` (with `trace: String = _trace()` defaulted).
- **Change:** Added `code` to all `Error` literals in `forms.ista`.

### 22. `Int` and `Float` literals are distinct — **Fixed**

- **Assumption:** JSON numbers (`0`, `2`, `1000`) emitted as `0`, `2`, `1000` fit `Float` fields and `Float?` UI props (`Hstack.grow`, `multipleOf`, `min` on `number` fields).
- **Spec (`docs/spec.md` §2):** `Int` does not implicitly convert to `Float`, and a `Float` literal requires digits on both sides of `.` (`0.0`, `2.0`, `1000.0`).
- **Change:** Added `litFloat` in `generate.ts` for `Float`-typed fields, bounds, and UI props.

### 23. Standard library imports and method names — **Fixed**

- **Assumption:** `Inbox` and `String.replaceAll` are in the prelude; `Array` has `.any(fn …)` and `.unique()`; `Map` has `.set(k, v)`.
- **Spec (`docs/spec.md` §3.8, §3.9):**
  - `Inbox` is imported from `'inbox'` and `replaceAll` from `'strings'`.
  - `Array<T>` uses JavaScript's `.some(fn …)`, and has no `.unique()`.
  - `Map<K, V>` sets entries with `m[k] = v`.
- **Change:** Added `import Inbox from 'inbox'` and `import replaceAll from 'strings'`, replaced `.any(` with `.some(` in `order.form.json` and `supplier.form.json`, replaced `out.inputs.set(k, v)` with `out.inputs[k] = v`, and implemented duplicate-key detection in `List.sync` with `keys.indexOf(keys[i]) != i`.

### 24. Formatting optional `Seen` values in message templates — **Fixed**

- **Assumption:** Template interpolations `${data.country}` and `String(data.country)` work directly on `Seen` fields of type `T?`.
- **Spec (`docs/spec.md` §2, §3.8, §3.10):** `None` does not implement `Stringable`, so `T?` (`T | None`) does not satisfy `Stringable`.
- **Change:** Added `fn text<T is Stringable>(v: T?) -> String` in `forms.ista` and updated `generate.ts` (`templateSpans`) to wrap template interpolations in `forms.text(…)`.

### 25. Reference arguments require explicit `&` at call sites — **Fixed**

- **Assumption:** `w.get(sc, out)` passes `out: &Drawing` by reference without `&`.
- **Spec (`docs/spec.md` §3.7):** Only a method's `self` takes `&` implicitly; every other reference argument is written `&out` at the call site.
- **Change:** Updated calls to `get` and `_check` in `forms.ista` to pass `&out`.

### 26. `while true:` is a statement of type `Unit` — **Fixed**

- **Assumption:** A function returning `Future<Group<M>.Data>` can end with a `while true:` loop that returns via `return d` inside the loop.
- **Spec (`docs/spec.md` §4):** `while` is always a statement of type `Unit` (a bare `true` is not a type-decided condition), so a block ending in `while true:` has type `Unit`.
- **Change:** Added `panic("unreachable")` (of type `Never`) after the `while true:` loop in `forms.run`.

### 27. No disposable on a cycle (static lifetimes) — **Fixed**

- **Assumption:** A drawing can collect handles (inputs, lists, shown `Hidden`s) and closures (the runs the form waits for), and a task's run can write back into the task holding its future.
- **Spec (`docs/spec.md` §7):** No disposable may be reachable from a cycle, and the checker rejects a write that may close one. A plain closure, an `any` value and a future may hold anything, and a value a `WeakRef` gives may be anything, so the checker can't see these as acyclic.
- **Change:** `Drawing` holds values alone: flags, the pass's number and the keys it drew. Events reach their fields through the view tree (`View.route`), the model unshows its `Hidden`s before each pass (`FormNode.unshow`), and the loop finds the runs going on through the tree (`View.runs`), racing them with `futures.first`. Props' lambdas, a list's `make` and a search's `from` are `sendable`. A task's run writes a cell the task holds, never the task, and notifies no one. `generate.ts` builds search options with `forms.search`, which makes their task.
