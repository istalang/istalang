---
description: Completion scenarios — declarations, types, imports, annotations; each scenario's snippet, trigger, expected items, what accepting inserts, and today's status through ista lsp; read when changing or testing completion
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-30
last_updated: 2026-11-04
tags: [plan, completion, lsp]
---

# Completion scenarios: declarations, types, imports, annotations

Conventions, fixture and legend: `scenarios.md`. Status is ✅ when the probe's assertions for the scenario hold today, ❌ when any fails (`Today` gives the first reasons).

## TL: Top level

Where a declaration starts or continues. A file holds declarations only (§3), so no statement and no value stands here.

### TL-01 · Blank line between declarations · P1 · ✅ pass

```
‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** Declaration keywords: `fn async struct enum trait import extern type shared const`.
- **Not:** Statement keywords (`if for while return let match …`), expression keywords (`true none not`), clause words (`case else in is and or as`), every name (`Pair`, `plus`, `Red`).
- **Accept:** The keyword alone.
- **Basis:** spec §3 (a program consists only of top-level declarations); TS offers only declaration keywords at module level, RA only item keywords.

### TL-02 · Partly typed declaration keyword · P1 · ✅ pass

```
fn‸
---
st‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** Same as TL-01 (the client filters by the typed prefix).
- **Not:** As TL-01.
- **Basis:** LSP: filtering is the client's job; server returns the position's full set.

### TL-03 · After `async` · P1 · ✅ pass

```
async ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** `fn` only.
- **Not:** Everything else.
- **Basis:** spec §3.3 (`async fn`) is the only declaration `async` starts.

### TL-04 · After `shared` · P1 · ✅ pass

```
shared ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** `struct` only.
- **Not:** Everything else.
- **Basis:** spec §3.18.

### TL-05 · After `extern` · P2 · ✅ pass

```
extern ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** `fn`, `struct`; the rest names the extern (no list).
- **Not:** Values, types, statement keywords.
- **Basis:** spec §3.6 (`extern fn`, `extern name: Type`, `extern struct`).

### TL-06 · Top-level `const` name · P1 · ✅ pass

```
const ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** Nothing: the name is declared here.
- **Not:** Everything.
- **Basis:** declaring position; TS/RA offer nothing where a binding name is written.

### TL-07 · Dot after a name at top level · P1 · ✅ pass

```
Pair.‸
---
p.‸
```
- **Where / trigger:** top level; typing `.`
- **Offer:** Nothing: no expression stands at top level.
- **Not:** Scope names (the existing guarantee).
- **Basis:** spec §3.

### TL-08 · Top-level const value · P2 · ✅ pass

```
const limit = ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** Names a compile-time constant may use: top-level constants, functions (lambda values), types and their variants as constructors, literals keywords `true false none`.
- **Not:** Statement keywords, clause words, `await`, `spawn`.
- **Basis:** spec §3 (compile-time computable const).

## DH: Declaration headers

The names, generics and parameters of `fn`, and what follows `async`, `shared`, `extern`.

### DH-01 · Function name · P2 · ✅ pass

```
fn ‸
---
async fn ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** Only type names (a static function names its type first, `fn Duration.zero()`); a new function name is written, not completed.
- **Not:** Values, functions, keywords, variants.
- **Accept:** The type name, no punctuation (the client types `.`).
- **Basis:** spec §3.7 (statics), declaring position.

### DH-02 · Static function name after the type · P2 · ✅ pass

```
fn Pair.‸
```
- **Where / trigger:** top level; typing `.`
- **Offer:** Nothing: the static's own name is declared.
- **Not:** Existing statics (`make`), fields, variants.
- **Basis:** declaring position (`fn Pair.make` is declaring `make`).

### DH-03 · Generic parameter name · P1 · ✅ pass

```
fn g<‸
---
struct Box2<‸
---
enum E<A, ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** Nothing: type parameters are declared.
- **Not:** Everything.
- **Basis:** declaring position.

### DH-04 · Generic bound · P1 · ✅ pass

```
fn g<T is ‸
---
fn g<T is Shape & ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** Traits: `Shape` and the prelude's and std's traits in scope.
- **Not:** Value names, non-trait types (`Pair`, `int`), keywords.
- **Accept:** The trait name.
- **Basis:** spec §3.5, §3.10 (`T is Addable & Monoid`).

### DH-05 · Parameter name · P1 · ✅ pass

```
fn g(‸
---
fn g(a: int, ‸
---
async fn g(‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** Nothing but `self` (first parameter): parameters are declared (`...` is typed, not completed).
- **Not:** Values, types, functions, keywords.
- **Basis:** declaring position; spec §3.3, §3.7.

### DH-06 · Parameter default · P2 · ✅ pass

```
fn g(a: int, b = ‸
---
fn g(a: int, b: int = ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** Expression start (EX-01), where the parameters before `b` are visible (a default may use them), and the module's names.
- **Not:** Parameters declared at or after `b`; statement keywords.
- **Basis:** spec §3.3 (defaults run in the declaring module's scope and may use earlier parameters).

### DH-07 · Parameter after `...` · P3 · ✅ pass

```
fn g(...‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** Nothing: the rest parameter's name is declared.
- **Not:** Everything.
- **Basis:** declaring position.

## TY: Type positions

Every place the grammar wants a type (§2, §3.5, §3.14).

### TY-01 · Parameter type · P1 · ✅ pass

```
fn g(a: ‸
---
fn g(a: int, b: ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** Types: `int float bool string unit never Range`, the prelude's (`Array Map Optional Result Future Slot Shared WeakRef`), the module's structs, enums and aliases, imported namespaces (`time`), and the function-type keywords `fn`, `async`, `sendable`, plus `any`, and the literal types spelled as words, `true` and `false`.
- **Not:** Values, functions, variants, statement/clause keywords, `none`.
- **Accept:** The type name; a generic type does not add `<`.
- **Basis:** spec §2, §3.5; TS offers only types in type position, RA only types and traits.

### TY-02 · Return type · P1 · ✅ pass

```
fn g() -> ‸
---
async fn g() -> ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** As TY-01.
- **Not:** As TY-01.
- **Basis:** spec §3.3.

### TY-02b · Return type, opened by typing `>` of `->` · P2 · ✅ pass

```
fn g() ->‸
```
- **Where / trigger:** top level; typing `>`
- **Offer:** As TY-01 (the `>` trigger is not only for `->` member access).
- **Not:** As TY-01.
- **Basis:** LSP trigger characters; `->` is both a member operator and a result-type arrow, so the position decides.

### TY-03 · Annotated local · P1 · ✅ pass

```
  let x: ‸
---
  const x: ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** As TY-01.
- **Not:** As TY-01.
- **Basis:** spec §3.4.

### TY-04 · Struct field type · P1 · ✅ pass

```
struct S:
  a: ‸
---
struct S { a: int; b: ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** As TY-01.
- **Not:** As TY-01.
- **Basis:** spec §3.1.

### TY-05 · Type argument · P1 · ✅ pass

```
  let x: Array<‸
---
  let x: Map<string, ‸
---
  let x: Map<‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** As TY-01.
- **Not:** As TY-01.
- **Basis:** spec §3.5.

### TY-06 · Tuple, optional and function types · P2 · ✅ pass

```
  let x: (int, ‸
---
  let x: fn(‸
---
  let x: fn(int) -> ‸
---
  let x: async fn(int) -> ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** As TY-01.
- **Not:** As TY-01.
- **Basis:** spec §2, §3.14, §3.15.

### TY-07 · Anonymous struct type · P2 · ✅ pass

```
  let x: { sku: ‸
---
  let x: struct { sku: ‸
---
  let x: Array<{ sku: string; qty: ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** As TY-01.
- **Not:** As TY-01.
- **Basis:** spec §3.1 (anonymous structs).

### TY-08 · Type parameters in scope · P1 · ✅ pass

```
fn g<T>(x: ‸
---
fn g<A, B>(x: A) -> ‸
---
struct Box2<T>:
  v: ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** The enclosing declaration's type parameters, with the types of TY-01.
- **Not:** Type parameters of other declarations.
- **Basis:** spec §3.5.

### TY-09 · Type parameters out of scope · P1 · ✅ pass

```
fn g<T>(x: T) -> int: 1
fn h(x: ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** No `T`.
- **Not:** `T`.
- **Basis:** scoping, spec §3.5.

### TY-10 · Type parameter in the body of a generic · P1 · ✅ pass

```
fn g<T>(x: T) -> int:
  let y: ‸
---
fn g<T>(x: T) -> int:
  let y = ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** `T` (a type in the first snippet; in the second, `T` as the head of a static call `T.zero()`).
- **Basis:** spec §3.5, §3.10.

### TY-11 · Qualified type · P1 · ✅ pass

```
fn g(a: time.‸
---
fn h():
  let x: time.‸
```
- **Where / trigger:** top level; typing `.`
- **Offer:** The types the module exports (`Time`, `Duration`).
- **Not:** Functions and values of the module (`delay`, `now`).
- **Basis:** spec §3.13; TS offers only types after `ns.` in type position.

### TY-12 · Alias target · P1 · ✅ pass

```
type Other = ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** As TY-01.
- **Not:** As TY-01.
- **Basis:** spec §3.17.

### TY-13 · Trait object · P2 · ✅ pass

```
fn g(a: any ‸
---
fn g(a: Array<any ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** Traits (`Shape`).
- **Not:** Non-trait types, values.
- **Basis:** spec §3.10 (`any Notifier`).

### TY-14 · Explicit type arguments at a call · P2 · ✅ pass

```
  let q = Inbox.create<‸
---
  let j = json.parse<‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** As TY-01.
- **Not:** As TY-01.
- **Basis:** spec §3.5, §9 (`json.parse<T>(s)`).

### TY-15 · `new` takes a shared struct · P1 · ✅ pass

```
  let x = new ‸
---
  const x = new ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Shared structs only (`Lease`, `Shared`).
- **Not:** Plain structs, enums, values, keywords.
- **Accept:** The type name; `{` is typed by the user.
- **Basis:** spec §3.18 (`new` builds only shared structs).

### TY-16 · `Self` in a trait · P2 · ✅ pass

```
trait Zero:
  fn zero() -> ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** `Self` with the types of TY-01.
- **Basis:** spec §3.10.

### TY-16b · No `Self` in a method · P2 · ✅ pass

```
fn Pair.sum2(self: ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** The types of TY-01, the receiver's (`Pair`) among them.
- **Not:** `Self`, which only a trait declares.
- **Basis:** spec §3.10.

## SD: Struct, enum, trait and alias bodies

§3.1, §3.10, §3.11, §3.17.

### SD-01 · Field name in a struct body · P1 · ✅ pass

```
struct S:
  ‸
---
struct S:
  a: int
  ‸
---
struct S { a: int; ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** `type`, which declares an associated type there instead (§3.1); else nothing: the field's name is declared (`@` annotation lines aside, AN-01).
- **Not:** Everything else.
- **Basis:** declaring position; spec §3.1 Associated types.

### SD-02 · Field default · P2 · ✅ pass

```
struct R:
  times: int = 3
  backoff = ‸
  later: int = 1
---
struct R { times: int = 3; backoff: int = ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** Expression start (EX-01) where the fields **before** it are visible (`times`), plus the module's names.
- **Not:** Fields after it (`later`), the field itself; statement keywords.
- **Basis:** spec §3.1 (a default may use the fields before it).

### SD-03 · Variant name · P1 · ✅ pass

```
enum E:
  ‸
---
enum E { A; ‸
---
enum E:
  A
  ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** `type`, which declares an associated type there instead (§3.1); else nothing: the variant is declared.
- **Not:** Everything else.
- **Basis:** declaring position, spec §3.11.

### SD-03b · Variant payload field · P1 · ✅ pass

```
enum E:
  A { x: ‸
---
enum E { A { x: int; y: ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** As TY-01 (a payload field has a type).
- **Not:** As TY-01.
- **Basis:** spec §3.11.

### SD-04 · Declaring a name after `struct`, `enum`, `trait`, `type` · P1 · ✅ pass

```
struct ‸
---
enum ‸
---
trait ‸
---
type ‸
---
shared struct ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** Nothing.
- **Not:** Everything.
- **Basis:** declaring position.

### SD-05 · Trait method header · P3 · ✅ pass

```
trait Z:
  fn ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** `Self` (a static is written `fn Self.zero()`).
- **Not:** Values.
- **Basis:** spec §3.10.

### SD-05b · After `Self` in a trait method header · P3 · ✅ pass

```
trait Z:
  fn Self.‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** Nothing: the static's own name is declared.
- **Basis:** declaring position, spec §3.10.

### SD-06 · Type default of a type parameter · P3 · ✅ pass

```
enum E<T, R = ‸
---
struct B<T = ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** As TY-01.
- **Not:** As TY-01.
- **Basis:** spec §3.5, §3.11.

## IM: Imports

§3.13: names, aliases and module specifiers.

### IM-01 · Names before the path · P1 · ✅ pass

```
import ‸ from 'time'
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** What the named module exports (`Time`, `Duration`, `delay`, `now`, …), excluding what the file already imported.
- **Not:** Local names, keywords, a module's `_private` names.
- **Accept:** The name; commas are typed.
- **Basis:** spec §3.13; TS offers a module's exports in `import {‸} from "m"`.

### IM-02 · Another name after a comma · P1 · ✅ pass

```
import Time, ‸ from 'time'
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** As IM-01 minus `Time`.
- **Not:** `Time`.
- **Basis:** as IM-01.

### IM-03 · Import with no path yet · P2 · ✅ pass

```
import ‸
---
import a, ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** Nothing: what the module exports is unknown until its path is written (the keyword `from` comes after a name, IM-04).
- **Not:** Local values, types, statement keywords.
- **Basis:** the module is unknown until the path is written.

### IM-04 · Word after imported names · P2 · ✅ pass

```
import a ‸
---
import a, b ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** `from`.
- **Not:** Everything else.
- **Accept:** The word.
- **Basis:** spec §3.13 grammar.

### IM-04b · Word after `*` · P2 · ✅ pass

```
import * ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** `as`.
- **Not:** Everything else.
- **Accept:** The word.
- **Basis:** spec §3.13 grammar.

### IM-05 · Alias name · P1 · ✅ pass

```
import * as ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** Nothing: the alias is declared.
- **Not:** Everything.
- **Basis:** declaring position.

### IM-06 · Module specifier · P1 · ✅ pass

```
import x from '‸'
---
import * as m from "‸"   ⟵ typing "\""
```
- **Where / trigger:** top level; typing `'` (the second variant, `"`)
- **Offer:** Std modules (`time math decimal strings json regex crypto random log runtime inbox collections futures rpc fanout`) and the project's files (`purchase/approve`), relative ones when `./`-prefixed.
- **Not:** Names, keywords; `testing` outside a `*.test.ista`.
- **Accept:** The path text, inside the quotes.
- **Basis:** spec §3.13, §2.12; LSP: `'`, `"` and `/` as triggers; TS completes module specifiers.

### IM-07 · Relative specifier · P2 · ✅ pass

```
import x from './‸'
```
- **Where / trigger:** top level; typing `/`
- **Offer:** The `.ista` files beside this one, without the extension, and sub-folders (each followed by `/` re-triggering).
- **Not:** This file itself; names.
- **Basis:** spec §3.13 (`./helper`); LSP trigger `/`.

### IM-08 · Imported names are in scope · P1 · ✅ pass

```
import delay from 'time'
fn g():
  ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** `delay` and the namespace `time` of the other import; the file's own names.
- **Not:** Names the file did not import (`now`).
- **Basis:** spec §3.13.

## AN: Annotations

§3.16.

### AN-01 · Annotation name before a declaration · P2 · ✅ pass

```
@‸
struct S:
  a: int
---
@‸
fn g(): 1
```
- **Where / trigger:** top level; typing `@`
- **Offer:** Structs usable as annotations: `Waypoint`, `Suite`, the file's own structs, `JsonName JsonSkip JsonBigInt` once imported.
- **Not:** Values, enums, keywords.
- **Accept:** A single-field annotation inserts `Name{$0}`, a fieldless one just `Name`.
- **Basis:** spec §3.16 (any struct is an annotation); LSP trigger `@`.

### AN-02 · Annotation after a field · P2 · ✅ pass

```
struct S:
  a: int @‸
```
- **Where / trigger:** top level; typing `@`
- **Offer:** As AN-01.
- **Not:** As AN-01.
- **Basis:** spec §3.16.

### AN-03 · Annotation on a statement · P2 · ✅ pass

```
  @‸
  await fetch("a")
```
- **Where / trigger:** in `async fn t`; typing `@`
- **Offer:** `Waypoint` only (§3.16: statements take only `@Waypoint`).
- **Not:** Other structs.
- **Basis:** spec §3.16, §10.

### AN-04 · Annotation fields · P2 · ✅ pass

```
struct D:
  reason: string
  code: int
@D{‸
```
- **Where / trigger:** top level; typing `{`
- **Offer:** The annotation struct's fields (`reason: `, `code: `); a single-field annotation also takes its value positionally (LI-09).
- **Not:** Other names.
- **Accept:** As LI-01.
- **Basis:** spec §3.16 reuses the struct-literal rules.

### AN-04b · The prelude annotation's field · P2 · ✅ pass

```
@Waypoint{‸
```
- **Where / trigger:** top level; typing `{`
- **Offer:** `label: `, the one field of the prelude's `Waypoint`.
- **Not:** Other names.
- **Basis:** spec §3.16 (`Waypoint` has a single `string` field), as AN-04.

### AN-05 · No annotation in expressions · P3 · ✅ pass

```
  let x = @‸
```
- **Where / trigger:** in `fn t`; typing `@`
- **Offer:** Nothing.
- **Not:** Everything.
- **Basis:** spec §3.16 (annotations stand before declarations and statements).

