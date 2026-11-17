---
description: phase D of structural-fixes — four inference asymmetries fixed at their exact units (call-shaped constructs' standing, packs in sameShape, settling a return before its mark is solved, associated types on the contravariant side) plus messages telling same-named parameters apart; B88, B68, B69, B91. Read to implement or examine phase D
owner: tech-lead
status: active
applies_to: compiler/checker/wiring/body, compiler/checker/types, compiler/checker/constructs/closures
last_verified: 2026-11-15
last_updated: 2026-11-15
tags: [structural-fixes, phase, inference]
---

# D: inference asymmetries

Branch `sf-d-inference`. Research: `research/plan-review.md` §QUALITY 4 (the traced mechanisms; verify each
red-first), `research/tracker-b.md` cluster D, and `findings.md` §D. D is disjoint from C, so it runs in wave 1.

Each bug is a relation or a decision applied one-sidedly. Fix the asymmetry in the unit that owns it. Add no new
layer, and never invert an associated type: they are not injective (`equal.ts` banner).

## Why, and the fix each needs

- **B88**: `wiring/body/scope-protocol.ts` (~68-97) gives `Call` the `opens` standing, but `MemberAccess`,
  `Binary`, `Unary` and `Index` the `boundary` one. `BodyScopes.checking` (`body-scopes.ts` ~81) reads standing
  before resolution, so the standing can't come from what the construct resolves to. Give these call-shaped
  kinds `opens`: a plain field read then opens a scope it never joins, which costs nothing.
- **B68**: `types/type/function-types.ts` `sameShape` (~189-219) matches a pack on `declared` against `given`'s
  parameters, but rejects a pack on `given` when `declared` has none (`given.pack === undefined`). So
  `takesLive(logged(area))` can't bind `logged`'s `A` from `takesLive`'s `fn(Int) -> Int`. Make it symmetric.
- **B69**: `queueUp work(1)` desugars to a lambda, judged after `queueUp` is chosen. Inside it, `work(v0)` joins
  the open scope with `Future<Int, K>`, `K` unsolved. `constructs/closures/returns.ts` `ReturnScope.#settled`
  (~173-184) calls `fitOf(Future<Int, K>, Future<Int, "ista">)` before `K` is solved, gets false, and settles on
  `Int`. Settle only once the scope's variables are solved, or relate rather than test the fit.
- **B91**: `R` is bound by the expected `From<Q>`, but the call is rejected first. Function parameters are
  contravariant, so `relatedByParts` (`types/inference/relate.ts` ~220) gets the variable's side (`R.Seen`) as
  `found` and checks `isComputed(expected)` only. Treat a computed type on either side alike.
- **B91's message**: `typeText` prints a type parameter by its bare name, so two distinct types read alike. Tell
  same-named distinct parameters apart in messages (display only).

## Acceptance

1. The B88, B68, B69 and B91 repros below check, and B91's message no longer prints two types alike.
2. Every existing checker test passes with unchanged expectations, except ones these fixes correct.

Reuse docs: `docs/reuse/calls-and-resolution.md`, `docs/reuse/types-and-fitting.md`, `docs/reuse/diagnostics.md`.

## Repros (verified on main at `11c7e1d0`)

B88:

```ista
struct Box:
  n: Int

fn get empty<T>(self: Box) -> Array<T>: []
fn id<T>(x: T) -> T: x

live async fn main() -> Unit:
  const b = Box{n: 1}
  const a: Array<Int> = id(empty(b))
  const c: Array<Int> = id(b.empty)
```

B68:

```ista
fn logged<...A, R>(f: Fn<A, R>) -> Fn<A, R>: f
fn takesLive(f: fn(Int) -> Int) -> Int: f(1)
fn area(n: Int) -> Int: n * n

live async fn main() -> Unit:
  const a = takesLive(logged(area))
```

B69 (passes with `work<"ista">(1)`):

```ista
K async fn work<K in Persistence>(x: Int) -> Int: x
fn queueUp(f: ista async fn() -> Int) -> Unit: ()

fn main2() -> Unit:
  queueUp work(1)
```

B91:

```ista
trait Node:
  type Seen

enum From<R is Node>:
  Fn(key: fn(R.Seen) -> String?)

enum Gen<R>:
  G(key: fn(R) -> String?)

fn b<Q is Node>(key: fn(Q.Seen) -> String?) -> From<Q>:
  From.Fn(key)

fn g<Q>(key: fn(Q) -> String?) -> Gen<Q>:
  Gen.G(key)
```

`b` fails and `g` checks.

## Tracker rows (verbatim, 2026-11-15)

| Id | Item | Size | Depends on | Filed by |
| --- | --- | --- | --- | --- |
| B88 | A call written as another construct infers a generic result from its own arguments only: a member access (a getter), a binary, a unary and an index stand as `boundary` in the scope protocol (`scope-protocol.ts`), so `id(box.empty)` with a getter generic in its result alone fails (5301) where `id(empty(box))` checks. The standing of every call-shaped construct should be one decision, `joins` as a call's is. | medium | none | transients-getters merge review |
| B68 | A pack given through a nested call isn't inferred: `takesLive(logged(area))`, `logged<...A, R>(f: Fn<A, R>) -> Fn<A, R>`, gives 5380 even with no mark involved, the outer call choosing before the inner one's `A` is bound. | medium | — | async-kinds K1c 2026-11-10 |
| B69 | A deferred call's callee generic over its mark takes no mark from its taker's parameter: `queueUp work(x)` in unmarked code, `work` a `K async fn` and `queueUp` taking an `ista async fn`, settles `K` against the code around it (5613), the deferred call checked before its taker is chosen (`deferredFunction`, constructs/expressions/deferred-calls.ts); `work<"ista">(x)` writes it. | small | — | async-kinds K1c 2026-11-10 |
| B91 | A variant constructor whose argument is typed by an associated type, `RowsFrom.Always(rows, self.rowKey)`, failed to fit a value of the identical printed type: "Expected (inert fn(R.Seen) -> String?)?, found (inert fn(R.Seen) -> String?)?". FormBuilder works around it by parameterizing `RowsFrom` by `S`. | medium | none | computed C2 |
