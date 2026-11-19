---
description: inconsistencies in proposals 6 (familiar forms), 12 (variadic tuples) and 18 (packages) against the spec, the implementation and each other, to fix before implementing them; § numbers are the spec's after its 2026-11-19 reorganization; traps are out of scope
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [review, proposals, spec]
---

# Proposal issues, 2026-11-19

Checked against the reorganized spec (`docs/spec/`) and the implementation (`ista check` probes at
`5b69b662` plus the working tree). Each item is a contradiction or a gap that makes the proposal's
own text wrong or unimplementable as written. Traps (surprising but consistent behaviour) are a
separate work item.

## Across proposals

| # | Issue | Fix |
|---|---|---|
| X1 | **Two flow models for one test.** P6 Rule 1: a test's facts hold in `if`/`elif` bodies, `while`, the right of `and`; its complement in `else`, later `elif`s and the right of `or`; and after an `if` whose body always leaves (`if x is None: return`). P12 §7: facts hold in a case and its guard, `if`, `while`, the right of `and`; complements in later cases and `else`; "**an early exit teaches nothing after it**". Same `x is P`, different regions. | One "where a test holds / fails" region, computed once (P6's, which already includes early exits), feeding both name narrowing (P6) and type-parameter facts (P12). Whichever lands second reuses it. |

## Proposal 6 — familiar forms

| # | Issue | Fix |
|---|---|---|
| 6.1 | **`set` rationale contradicts §10.2.** "It is no alias, since `m[k] = v` is no function to name", but §10.2 says `x[k] = v` calls `setIndex(&x, k, v)`. | Either alias `set` to `setIndex` (`@AliasFor{"setIndex"}`, rewritten to `setIndex`, not to `m[k] = v`), or keep `@Warn` and correct the reason. |
| 6.2 | **Spec changes list misses text Rule 1 contradicts.** §11.1 "Conditions decided by types" ends "Nothing narrows: an undecided condition leaves its operands' types as they are"; §21 "Narrowing from function results" describes today's no-narrowing. | Add §11.1 and §21 to the list. |
| 6.3 | **Rule 3 vs the join of §4.2.** The literal takes `Float` only from an expected type. Without one, items and branches join (§3.3, §4.2; the implementation agrees in any order), and `Int` never joins `Float`: `[1, 2.5]` and `if c: 1 else: 2.5` stay errors, while §4.2 already special-cases `None` in the same join. The behaviour table doesn't list these. | **Resolved 2026-11-19** by proposal 6's new Rule 3: an `Int` fits a `Float` or `Decimal`, with joins. |
| 6.4 | **Rule 3's `Decimal` is integers only.** `const d: Decimal = 12` checks, `= 12.5` stays error 5001 (a `Float` never converts), so "numbers as people write them where a `Decimal` is plainly meant" holds only for whole numbers. | **Resolved 2026-11-19** by Rule 3: a `.` literal where a `Decimal` is expected is that decimal, read from its text. |
| 6.5 | **`any`/`all` aliases clash with `futures.any`/`futures.all` (§19.2).** `xs.all(f)` would mean `every`, `futures.all(fs)` "await every `Ok`"; `xs.any(f)` `some`, `futures.any(fs)` "first `Ok`". One name, two unrelated meanings on arrays. | Drop the `any`/`all` aliases, or rename the combinators. |
| 6.6 | **`WeakMap.includes` left out.** §19.2's `collections.WeakMap` has `includes(k)`, "the same test, which `in` calls", the exact pattern Rule 2 turns into an alias for `Map`. | Make it an alias of `has` too, or say why not. |
| 6.7 | **Stale implementation paths.** `checker/rules/annotations.ts` and `checker/rules/flow/forward.ts` don't exist. | Point at the current files. |

## Proposal 12 — variadic tuples

| # | Issue | Fix |
|---|---|---|
| 12.1 | **Examples predate marks (§9.1).** `async fn all`, `async fn enter`, `type Bracket<E> = async fn(…)`, the `setups` lambdas: an unmarked `async fn` is error 5612. `Future<A[I]>`, `Future<Response>` omit `Future`'s kind, which has no default (§19.1). | Mark every head and function type (`K async fn … <K in Persistence>` or `ista`), give every `Future` its `K`. |
| 12.2 | **`enter` can't be what §6 says.** "Under proposal 8 it is an unmarked function, taking its caller's kind: in `live` code its waits don't commit": proposal 8 is the spec now (§9), and `enter` calls `Slot.create`, an `extern ista fn` (§19.1), so it is ista code and live code can't call it. | Declare `enter` ista and drop the live claim, or build it on a mark-generic primitive (none exists for slots). |
| 12.3 | **§6 code doesn't parse as meant.** `bracket(async fn(v): ⏎ await value.put(v) ⏎ await done.take())` and the multi-line `leave: async fn(): …` inside `Entered{…}`: a lambda body is one expression ending at `,` or `)` (§6.4), and a line break inside brackets separates items (§2.1). The checker reads the first as two arguments ("takes 1 argument, found 2"). | Write block bodies, `fn(v): { …; … }`, or named local functions. |
| 12.4 | **`Setup<E>` contradicts §18.** P12: `Setup<E> = async fn(async fn(E))`. §18: `Setup<E> = ista async fn(ista async fn(E) -> Unit) -> Unit`. | Use §18's type (and mark `Bracket` to match). |
| 12.5 | **Open named rests break §6.3's name filter.** §6.3: "A named argument rules out every function without a parameter of that name." With `...opts: S`, `S is struct` open, every name fits, so every such function survives every named argument. Rule 3 says choosing treats a rest's fields as named parameters, which covers closed structs only. | Say how an open named rest ranks in overload choice (e.g. below any function naming the parameter). |
| 12.6 | **Spec changes list misses §21.** §21 lists "Field loops over enums or tuples" as future work; Rule 1 implements the tuple half. | Add §21. |

## Proposal 18 — packages

| # | Issue | Fix |
|---|---|---|
| 18.1 | **The manifest can't be a compile-time constant.** A top-level `const` can't hold an enum variant (error 5026, §5.1: "literals, lambdas, other constants, and structs, arrays and maps built from them"). `links: Map<String, Source>` and the lock's `Revision` are enums. | **Resolved 2026-11-19** by proposal 6's Rule 13: enum values in constants. Proposal 18 now depends on it. |
| 18.2 | **`programs:` with unquoted keys builds a struct.** §3.2: `name: value` lines build a struct, `"key": value` lines a map; the checker reports "Expected Map<String, String>, found struct { main: String }". | Quote the keys: `"main": "/app/main"`. |
| 18.3 | **`Source.Git:` with fields below is the forbidden form.** §3.2 and §5.3: a variant is built only by its call (error 5139). | `"/lib/x": Source.Git(url: "…", ref: "…")`, or structs (18.1). |
| 18.4 | **Vendor folder keyed two ways.** `vendor/<name>@<version>/` ("no vendor folder in `Locked`, it is `name@version`"), yet "two paths at the same version share one folder, keyed by content". A branch ref or a forgotten version bump gives two contents one `name@version`. | Key by content (`name@version-<hash>`), or refuse two revisions under one version. |
| 18.5 | **Identity by path vs §17.3's extern keys and §4.6's type spelling.** P18: compiled names and extern keys use the canonical path (`/app/billing/invoice`). §17.3: a key is "the module's name …, as in `purchase.chargeCard(String, Int)`"; §4.6: a compiled program names a type "by module name". `test/golden/extern-keys.txt` encodes today's form. | Add §17.3 and §4.6 to the spec edits, with the new key spelling. |
| 18.6 | **`./` rule unclear.** "`./name` names a module in the importing file's directory": is `./sub/x` allowed? "The formatter rewrites any other local import": which, if every other local form is invalid? | Say whether `./` takes subfolders; drop the rewrite or name what it rewrites. |
