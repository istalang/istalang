---
description: Completion scenarios — expected type, literals, members, calls; each scenario's snippet, trigger, expected items, what accepting inserts, and today's status through ista lsp; read when changing or testing completion
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-30
last_updated: 2026-11-10
tags: [plan, completion, lsp]
---

# Completion scenarios: expected type, literals, members, calls

Conventions, fixture and legend: `scenarios.md`. Status is ✅ when the probe's assertions for the scenario hold today, ❌ when any fails (`Today` gives the first reasons).

## ET: Expected type

Where the spec gives a position an expected type (§3.11 qualified names, §3.1), the items that fit come first.

### ET-01 · Field value · P1 · ✅ pass

```
  Cfg{color: ‸
---
  Cfg{n: 1, color: ‸}
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** The expected enum's variants bare (`Red Green Blue`, detail `Color`), the enum `Color`, then the rest of EX-01.
- **Not:** Variants of enums that are not expected (`Approved`).
- **Accept:** `Red` inserts `Red`.
- **Order:** Locals and parameters of type `Color` (`col`, `cfg.color`-style), then the variants in declaration order, then `Color`, then everything else; the first is preselected, as a local or the module's own.
- **Basis:** spec §3.11 (bare variants where an enum type is expected: "a field"); TS `isRecommended`/preselect, RA expected-type ranking, Kotlin smart completion.

### ET-02 · Call argument · P1 · ✅ pass

```
  paint(‸
---
  paint(Color.Red, ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** First argument: as ET-01. Second (`int`): `int`-typed values first (`n`), `n` preselected.
- **Not:** Variants of an enum not expected (`Red` at the `int`).
- **Order:** Matching type first.
- **Basis:** spec §3.11 ("an argument"); signature help already knows the parameter.

### ET-03 · `return` · P1 · ✅ pass

```
fn g() -> Color:
  return ‸
---
fn g() -> Color:
  ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** As ET-01 for the return type `Color` (at the second snippet's tail position too, whose last expression is the value).
- **Basis:** spec §3.11 ("a `return`").

### ET-04 · Annotated declaration · P1 · ✅ pass

```
  let c: Color = ‸
---
  const c: Color = ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** As ET-01.
- **Basis:** spec §3.11 ("an annotated variable").

### ET-05 · Assignment · P2 · ✅ pass

```
  let c: Color = col
  c = ‸
---
  let k = cfg
  k.color = ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** As ET-01 (the target's type).
- **Basis:** TS, Kotlin.

### ET-06 · Comparison · P2 · ✅ pass

```
  let b = col == ‸
---
  let b = cfg.color != ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** As ET-01: the left operand's type is expected.
- **Basis:** spec §3.9 (`==` compares same types); TS, Kotlin.

### ET-07 · Optional expectation · P1 · ✅ pass

```
  Cfg{color: col, n: 1, note: ‸
---
  let x: Color? = ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `none` and the values that fit the inner type; for `Color?`: the variants of `Color`.
- **Order:** `none`, then matching locals.
- **Basis:** spec §3.11 (a `T` is wrapped into `T?`).

### ET-08 · Collection elements · P2 · ✅ pass

```
  const cs: Array<Color> = [‸
---
  const cs: Array<Color> = [Color.Red, ‸
---
  const cm: Map<string, Color> = ["a": ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** As ET-01 for the element/value type.
- **Basis:** spec §2 (an array literal's elements take the expected type's).

### ET-09 · Variant payload fields · P2 · ✅ pass

```
  Decision.Rejected(by: "x", reason: ‸
---
  const e: Decision = Rejected(by: ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Values of the payload field's type first.
- **Basis:** spec §3.11.

### ET-10 · Boolean expectation · P3 · ✅ pass

```
  let b: bool = ‸
---
  if ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `true`, `false` ranked first among keywords; bool locals before.
- **Order:** Matching type first.
- **Basis:** TS/Kotlin rank by expected type.

### ET-11 · No expected type, no bare variants · P1 · ✅ pass

```
  let x = ‸
---
  let x = [1, 2].map(fn v: ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01 without bare variants (`Red`, `Approved`, `Some`, `None`, `Ok`, `Err` are not valid bare).
- **Not:** Bare variants.
- **Basis:** spec §3.11 ("A bare variant with no enum type expected is a compile error").

### ET-12 · Default parameter · P2 · ✅ pass

```
fn g(c: Color = ‸
```
- **Where / trigger:** top level; invoked, or typing on
- **Offer:** As ET-01.
- **Basis:** spec §3.3.

### ET-13 · Call result chosen by expected type · P3 · ✅ pass

```
  let x: int = ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Names of type `int` (locals `n`, functions returning `int`: `paint`, `sum`) before others.
- **Order:** Matching type first.
- **Basis:** TS/RA.

## LI: Struct and variant literals

§3.1, §3.11, §3.18: the field names of a literal, and everything inside it.

### LI-01 · Field names after `{` · P1 · ✅ pass

```
  Pair{‸}
---
  Pair{‸
---
  Pair{ ‸
```
- **Where / trigger:** in `fn t`; typing `{`
- **Offer:** The literal's fields (`first`, `second`), each with its type as detail.
- **Not:** Scope names, keywords, fields of other types.
- **Accept:** `first: ` — the name, the colon and one space; the item re-triggers completion (`command: editor.action.triggerSuggest`), so the value list (LI-07) opens at once.
- **Basis:** spec §3.1; Swift/Kotlin insert the label with its separator, RA's record-field completion inserts `name: `; LSP `CompletionItem.command`.

### LI-01b · Field names after `{`, invoked · P1 · ✅ pass

```
  Pair{‸}
---
  Pair{fi‸}
---
  Pair{ ‸ }
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** As LI-01, with `first: `; as the one list, however it opened (TR-09).
- **Not:** As LI-01 (but see LI-09 for single-field structs).
- **Accept:** As LI-01.
- **Basis:** as LI-01.

### LI-02 · Fields after a comma · P1 · ✅ pass

```
  Pair{first: 1, ‸}
---
  Pair{first: 1,‸}
```
- **Where / trigger:** in `fn t`; typing `,`
- **Offer:** The fields not given yet: `second`.
- **Not:** `first`; scope names.
- **Accept:** `second: `, re-triggering.
- **Basis:** spec §3.1.

### LI-03 · Fields after `, ` (space typed) · P1 · ✅ pass

```
  Pair{first: 1, ‸}
```
- **Where / trigger:** in `fn t`; typing ` `
- **Offer:** As LI-02: **the list is requested again when the space is typed**, so it stays open (the widget would otherwise close, as the space is no word character).
- **Not:** As LI-02.
- **Basis:** VS Code closes the widget on a non-word character unless it is a trigger character; LSP `triggerCharacters` may hold ` `.

### LI-04 · Fields after `{ ` (space typed) · P2 · ✅ pass

```
  Pair{ ‸}
```
- **Where / trigger:** in `fn t`; typing ` `
- **Offer:** As LI-01.
- **Not:** As LI-01.
- **Basis:** as LI-03.

### LI-05 · Typing on after a comma · P1 · ✅ pass

```
  Pair{first: 1, s‸}
---
  Pair{first: 1, ‸s}
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** As LI-02 (the client filters by `s`).
- **Not:** As LI-02.
- **Basis:** LSP: server answers the position, client filters.

### LI-06 · Fields on a continuation line · P1 · ✅ pass

```
  Pair{
    first: 1,
    ‸
  }
---
  Pair{
    ‸
  }
---
  Pair{
    first: 1,
    ‸
    }
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** The fields not given yet (all, for the empty literal).
- **Not:** Scope names.
- **Basis:** spec §3.1, formatted literals break one field per line.

### LI-07 · Value after `field: ` · P1 · ✅ pass

```
  Pair{first: ‸}
---
  Pair{second: 1, first: ‸}
```
- **Where / trigger:** in `fn t`; typing ` `
- **Offer:** The expression start (EX-01) ranked by the field's type (ET-01…).
- **Not:** Field names (a value is expected, not a field); statement keywords.
- **Basis:** LI-01's command opens it; typing `: ` by hand opens it with the space trigger.

### LI-08 · Every field given · P2 · ✅ pass

```
  Pair{first: 1, second: 2, ‸}
---
  Pair{first: 1, second: 2,‸}
```
- **Where / trigger:** in `fn t`; typing `,`
- **Offer:** Nothing.
- **Not:** Fields, names.
- **Basis:** spec §3.1.

### LI-09 · Single-field struct: field or positional value · P1 · ✅ pass

```
  UserId{‸}
```
- **Where / trigger:** in `fn t`; typing `{`
- **Offer:** The field (`id: `), plus values that are not bare names (literals, calls, constructors); a variable may be offered only as `(name)`.
- **Not:** A bare variable name (`UserId{u}` means the field `u`, not a value).
- **Accept:** Field: `id: `. Variable: `(u)` with the parentheses.
- **Basis:** spec §3.1 ("as long as that value isn't a bare name … wrap it in parentheses").

### LI-10 · Shorthand · P2 · ✅ pass

```
  const first = 1
  Pair{‸}
---
  const first = 1
  Pair{fi‸}
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** A visible variable named like an unfilled field is offered as the shorthand (`first`), ahead of the plain field.
- **Not:** Variables named like no field.
- **Accept:** The name alone (`Pair{first}`).
- **Order:** Shorthand first.
- **Basis:** spec §3.1 (`Pair{first, second}`); RA offers shorthand fields for matching locals.

### LI-11 · Spread value · P2 · ✅ pass

```
  Pair{...‸}
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Values of the literal's type first (`p`, `Pair.make()`).
- **Order:** Values of type `Pair` first.
- **Basis:** spec §3.1 (`Req{...req, amount: 0}`).

### LI-11b · Fields after a spread · P2 · ✅ pass

```
  Pair{...p, ‸}
```
- **Where / trigger:** in `fn t`; typing `,`
- **Offer:** All fields (a later field overrides the spread).
- **Not:** Scope.
- **Accept:** `first: `.
- **Basis:** spec §3.1.

### LI-12 · Spread as an item · P3 · ✅ pass

```
  Pair{‸}
```
- **Where / trigger:** in `fn t`; typing `{`
- **Offer:** `...` offered as an item after `{` (only here: "the spread comes first and only once").
- **Not:** `...` after a field.
- **Accept:** `...`
- **Basis:** spec §3.1.

### LI-13 · Braces after a variant's name · P1 · ✅ pass

```
  Decision.Rejected{‸}
---
  const e: Decision = Rejected{by: "x", ‸}
---
  const e: Result<Int> = Ok{‸}
---
  const e = Result.Ok{va‸}
```
- **Where / trigger:** in `fn t`; typing `{`, or invoked
- **Offer:** No field: a variant is built by its call (signature help names its fields), and checking refuses braces after its name, naming the call.
- **Not:** `by`, `reason`, `value`, `...`.
- **Basis:** spec §3.11 ("Only by its call").

### LI-15 · Shared struct · P1 · ✅ pass

```
  new Lease{‸}
---
  new Lease{name: "a", ‸}
```
- **Where / trigger:** in `fn t`; typing `{`
- **Offer:** `name: `, `renewals: ` (a field with a default, ranked after required ones; `renewals` detail shows `int = 0`).
- **Not:** Scope.
- **Order:** Fields without a default first.
- **Basis:** spec §3.18, §3.1 defaults.

### LI-16 · Defaults rank after required fields · P3 · ✅ pass

```
  Opts{‸}
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `zeta` (required) and `alpha` (has a default).
- **Order:** `zeta` before `alpha`, though the label order says otherwise.
- **Basis:** rank by "must give" first; Swift orders required arguments first.

### LI-17 · Nested literals · P1 · ✅ pass

```
  Cfg{color: Color.Red, n: Pair{‸}}
---
  Cfg{color: Color.Red, n: Pair{first: 1, ‸}}
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** The **inner** literal's fields (`first`, `second` / `second`).
- **Not:** The outer literal's fields (`color`, `n`, `note`).
- **Basis:** spec §3.1.

### LI-18 · Literal as an argument or element · P2 · ✅ pass

```
  paint(Color.Red, Pair{‸}.first)
---
  const a = [Pair{first: 1, ‸}]
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** The literal's fields.
- **Not:** Fields of the call's parameters.
- **Basis:** spec §3.1.

### LI-19 · Generic struct · P3 · ✅ pass

```
  Box<int>{‸}
```
- **Where / trigger:** in `fn t`; typing `{`
- **Offer:** `value` (detail `int`, the type argument substituted), `tag`.
- **Basis:** spec §3.5.

### LI-19b · Generic struct by expected type · P3 · ✅ pass

```
  const b: Box<string> = Box{‸}
```
- **Where / trigger:** in `fn t`; typing `{`
- **Offer:** `value` (detail `string`), `tag`.
- **Basis:** spec §3.5.

### LI-20 · Anonymous struct literal · P3 · ✅ pass

```
  struct{‸}
---
  const b: { sku: string; qty: int } = struct{‸}
---
  struct{...p, ‸}
```
- **Where / trigger:** in `fn t`; typing `{`
- **Offer:** With an expected type or a spread: that type's fields. Without: nothing.
- **Not:** Scope.
- **Basis:** spec §3.1.

### LI-21 · Struct without fields · P3 · ✅ pass

```
struct Marker
fn g() -> int:
  Marker{‸}
  0
```
- **Where / trigger:** top level; typing `{`
- **Offer:** Nothing (braces after it are an error).
- **Not:** Scope.
- **Basis:** spec §3.1.

### LI-22 · Mid-word · P2 · ✅ pass

```
  Pair{fi‸rst: 1}
---
  Pair{first: 1, se‸cond: 2}
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** The unfilled fields (in the first: `second`; also `first`, the field being edited).
- **Not:** Scope.
- **Basis:** the item under the cursor is not "given".

### LI-23 · Not a literal: block, declaration braces · P2 · ✅ pass

```
  const x = { ‸ }
---
struct S { ‸ }
```
- **Where / trigger:** in `fn t`; typing `{`
- **Offer:** In a block: nothing on the `{` trigger (a letter then completes as ST-01). In a declaration: nothing (SD-01).
- **Not:** Fields, scope.
- **Basis:** spec §2 ("`{…}` right after a name constructs"; elsewhere a block).

### LI-24 · Unknown type · P2 · ✅ pass

```
  Nope{‸}
---
  Nope{a: 1, ‸}
```
- **Where / trigger:** in `fn t`; typing `{`
- **Offer:** Nothing.
- **Not:** Scope names.
- **Basis:** no known fields.

## ME: Members

§4, §3.7, §3.18: what follows `.`, `?.`, `->`, `?->` and a qualifier.

### ME-01 · Value members · P1 · ✅ pass

```
  p.‸
```
- **Where / trigger:** in `fn t`; typing `.`
- **Offer:** Fields (`first`, `second`) and methods (`sum`), with types/signatures as detail.
- **Not:** Statics (`make`), keywords, scope names.
- **Accept:** Field: the name. Method: `sum($0)`, cursor inside the parentheses.
- **Basis:** spec §3.7; TS/RA.

### ME-02 · Type statics · P1 · ✅ pass

```
  Pair.‸
```
- **Where / trigger:** in `fn t`; typing `.`
- **Offer:** Statics (`make`).
- **Not:** Fields, instance methods, scope.
- **Accept:** `make($0)`.
- **Basis:** spec §3.7.

### ME-03 · Enum variants · P1 · ✅ pass

```
  Decision.‸
```
- **Where / trigger:** in `fn t`; typing `.`
- **Offer:** The variants (`Approved Rejected Expired`), payload shown as detail.
- **Not:** Scope.
- **Accept:** A variant with fields inserts its call, `Approved($0)`, and opens signature help; one without, `Expired`. Where a function value is expected, `const f: fn(String) -> Decision = Decision.‸`, a variant with fields is written alone, as a function or a static is (§3.14).
- **Basis:** spec §3.11.

### ME-04 · Namespaces · P1 · ✅ pass

```
  time.‸
```
- **Where / trigger:** in `fn t`; typing `.`
- **Offer:** The module's exports.
- **Not:** `_`-names; local names.
- **Basis:** spec §3.13.

### ME-05 · Optional chain on a non-optional · P2 · ✅ pass

```
  p?.‸
```
- **Where / trigger:** in `fn t`; typing `.`
- **Offer:** Nothing (the existing guarantee, §4).
- **Not:** Scope.
- **Basis:** spec §4.

### ME-05b · Optional chain · P1 · ✅ pass

```
  po?.‸
```
- **Where / trigger:** in `fn t`; typing `.`
- **Offer:** Members of the value inside (`first`, `second`, `sum`).
- **Not:** Members of `Optional` itself.
- **Basis:** spec §4.

### ME-06 · Shared structs: fields by `->`, methods by `.` · P1 · ✅ pass

```
  l->‸
```
- **Where / trigger:** in `fn t`; typing `>`
- **Offer:** Fields (`name`, `renewals`) after `->`; only methods after `.` (a field by `.` is an error).
- **Not:** After `->`: methods.
- **Basis:** spec §3.18.

### ME-06b · Shared struct by dot · P2 · ✅ pass

```
  l.‸
```
- **Where / trigger:** in `fn t`; typing `.`
- **Offer:** Methods only.
- **Not:** Fields (`name`, `renewals`).
- **Basis:** spec §3.18 ("x.field is an error").

### ME-07 · Chains · P1 · ✅ pass

```
  cfg.note?.‸
---
  xs.slice(0, 1).‸
---
  xs.at(0)?.‸
---
  Pair.make().‸
---
  paint(Color.Red, 1).‸
---
  (p).‸
---
  [1, 2].‸
---
  "text".‸
```
- **Where / trigger:** in `fn t`; typing `.`
- **Offer:** The members of the value so far (an `Array`'s, an `Optional`'s, a string's …).
- **Not:** Scope, keywords.
- **Basis:** spec §4.

### ME-07b · Chain members, concrete · P1 · ✅ pass

```
  Pair.make().‸
---
  xs.slice(0, 1).‸
```
- **Where / trigger:** in `fn t`; typing `.`
- **Offer:** `Pair`'s members / an `Array`'s (`length`, `map`).
- **Basis:** spec §4.

### ME-08 · Collections · P1 · ✅ pass

```
  xs.‸
---
  m.‸
```
- **Where / trigger:** in `fn t`; typing `.`
- **Offer:** `Array`: `length push pop indexOf slice at`…; `Map`: `get`, `has`…; signatures with the type arguments substituted.
- **Not:** Scope.
- **Basis:** guide §2.3.

### ME-09 · Typing on · P1 · ✅ pass

```
  p.fi‸
---
  p.‸first
---
  p.fi‸rst
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** As ME-01 (the client filters).
- **Not:** Scope.
- **Basis:** LSP filtering is the client's.

### ME-10 · A member spelled like a keyword · P2 · ✅ pass

```
  xs.in‸
---
  p.is‸
---
  m.for‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** The receiver's members (`includes`…).
- **Not:** Scope.
- **Basis:** the parser reads `in` as a keyword, the editor must still see a member.

### ME-12 · Unresolved receiver · P1 · ✅ pass

```
  nope.‸
---
  p.nothing.‸
---
  nope()?.‸
```
- **Where / trigger:** in `fn t`; typing `.`
- **Offer:** Nothing (and no scope names).
- **Not:** Scope.
- **Basis:** what is unknown has no members.

### ME-13 · Tuples · P3 · ✅ pass

```
  const tp = (1, "a")
  tp.‸
```
- **Where / trigger:** in `fn t`; typing `.`
- **Offer:** `0`, `1` with element types.
- **Not:** Scope.
- **Basis:** spec §3.15.

### ME-14 · Integer literal before a dot · P3 · ✅ pass

```
  1.‸
```
- **Where / trigger:** in `fn t`; typing `.`
- **Offer:** Nothing (`1.` starts a float).
- **Not:** Scope.
- **Basis:** spec §2 lexical.

### ME-14b · Float literal before a dot · P3 · ✅ pass

```
  3.14.‸
```
- **Where / trigger:** in `fn t`; typing `.`
- **Offer:** `float`'s members.
- **Not:** Scope.
- **Basis:** spec §2.

### ME-15 · Statics through a type parameter · P3 · ✅ pass

```
fn g<T is Zero>(x: T) -> int:
  T.‸
```
- **Where / trigger:** top level; typing `.`
- **Offer:** The statics the bounds declare (`zero`).
- **Not:** Scope.
- **Basis:** spec §3.10.

### ME-16 · Generic statics · P2 · ✅ pass

```
  Slot.‸
```
- **Where / trigger:** in `fn t`; typing `.`
- **Offer:** Statics (`create`).
- **Not:** Scope.
- **Basis:** guide §2.9 (`Slot.create<int>()`; `Inbox` needs its import).

### ME-18 · Comparison `>` · P1 · ✅ pass

```
  let b = n >‸
---
  let b = n >=‸
```
- **Where / trigger:** in `fn t`; typing `>`
- **Offer:** Nothing (the `>` trigger is no `->`).
- **Not:** Scope.
- **Basis:** spec §4.

### ME-19 · Dot after `..` · P2 · ✅ pass

```
  let r = 0..‸
---
  let s = [...‸
```
- **Where / trigger:** in `fn t`; typing `.`
- **Offer:** Nothing for `..`/`...` typed as a trigger `.`: the operator is not a member access.
- **Not:** Members of the previous operand.
- **Basis:** spec §2 (`..`, `...`).

## CA: Calls

§3.3, §3.7: arguments, named arguments, the receiver.

### CA-01 · First argument · P1 · ✅ pass

```
  plus(‸
---
  p.sum(‸
---
  xs.push(‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01, parameter names as named arguments (`a: `, `b: `) ranked by fit; for a method, the receiver is not a parameter.
- **Not:** Statement keywords.
- **Accept:** `a: ` re-triggering the value list.
- **Basis:** spec §3.3 (named arguments); Kotlin/Swift offer argument labels.

### CA-02 · Named-argument items · P1 · ✅ pass

```
  plus(‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `a:` and `b:` as items (detail `int`), inserting `a: `.
- **Accept:** `a: `, re-triggering.
- **Basis:** spec §3.3 (`add(1, b: 2)`).

### CA-03 · After a comma in a call · P1 · ✅ pass

```
  plus(1, ‸
---
  plus(1,‸
```
- **Where / trigger:** in `fn t`; typing `,`
- **Offer:** The parameters not given yet (`b:`); on the space trigger likewise.
- **Not:** `a:`.
- **Basis:** spec §3.3.

### CA-03b · After `, ` in a call (space typed) · P1 · ✅ pass

```
  plus(1, ‸
```
- **Where / trigger:** in `fn t`; typing ` `
- **Offer:** As CA-03: the list stays open.
- **Not:** As CA-03.
- **Basis:** as LI-03.

### CA-04 · After a named argument · P2 · ✅ pass

```
  plus(b: 2, ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** Only the remaining named parameters (`a:`); no positional names.
- **Not:** `b:`.
- **Basis:** spec §3.3 (positional arguments come first).

### CA-05 · Value after `name: ` · P1 · ✅ pass

```
  plus(b: ‸
```
- **Where / trigger:** in `fn t`; typing ` `
- **Offer:** EX-01, `int`-typed first.
- **Not:** `a:`, `b:`.
- **Basis:** as LI-07.

### CA-06 · Nested calls · P2 · ✅ pass

```
  plus(plus(1, ‸), 
---
  plus(plus(1), ‸
```
- **Where / trigger:** in `fn t`; typing `,`
- **Offer:** Each call's own parameters.
- **Not:** The other call's.
- **Basis:** signature help follows the same rule.

### CA-07 · Function-value call · P2 · ✅ pass

```
  const f = fn(q: int): q
  f(‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01 (a function value's parameters have no names to offer).
- **Not:** Named-argument items.
- **Basis:** spec §3.14.

### CA-08 · Rest and spread · P3 · ✅ pass

```
  logAll("a", ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01 and `...` (spread into the rest parameter).
- **Basis:** spec §3.3.

### CA-09 · Reference arguments · P3 · ✅ pass

```
  let z = 1
  bump(&‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** `let` variables.
- **Not:** Constants, parameters.
- **Basis:** spec §3.7.

### CA-10 · Conversions and generic calls · P3 · ✅ pass

```
  float(‸
---
  json.stringify(‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01.
- **Not:** Statement keywords.
- **Basis:** spec §3.10.

### CA-11 · Call result is complete, a space after · P2 · ✅ pass

```
  plus(1) ‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-02b: the infix words (`and or is in`) and the names that start a deferred call's call, `plus(1)` being shaped as its taker (§3.14).
- **Not:** Keywords that start no call. (The unspaced case is NO-07.)
- **Basis:** spec §4.

### CA-12 · Unresolved callee · P2 · ✅ pass

```
  nope(‸
```
- **Where / trigger:** in `fn t`; invoked, or typing on
- **Offer:** EX-01.
- **Not:** Named-argument items.
- **Basis:** a typo must not turn completion off.

