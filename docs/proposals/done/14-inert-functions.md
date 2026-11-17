---
description: proposal 14 of docs/proposals, inert function types — `inert fn`, a third sendability whose values capture only values that reach no disposable, and the derived `Inert` trait naming such types, so callbacks kept in handles (observers, computeds) pass §7's cycle rule; rules, inference, lifetimes, what it takes, spec edits and the decisions; read before designing or implementing it, or a library that stores closures in shared structs
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-14
last_updated: 2026-11-14
tags: [proposal, language, functions, closures, lifetimes, sendable, computed, f33]
---

# Proposal: inert function types

**Motivation.** §7 forbids a cycle of holding through a value that reaches a disposable. A plain
function type says nothing about what its closure captured, so the checker takes it as reaching
anything (static-lifetimes design §5.1, §5.6). The upshot: any library that keeps closures in
shared structs is rejected wherever a closure may capture the struct's owner, even in a program with
no disposable at all.

- **An observer.** A listener that captures its owner closes a cycle with no disposable in it, and
  the call is rejected (5721):

  ```python
  shared struct Emitter:
      listeners: Array<fn(Int) -> Unit> = []

  fn on(self: Emitter, f: fn(Int) -> Unit):
      self->listeners = [...self->listeners, f]

  shared struct Model:
      emitter: Emitter
      count: Int = 0

  fn wire(m: Model):
      fn bump(n: Int):
          m->count += n
      m->emitter.on(bump)       # 5721: a cycle holding Emitter, "which reaches a disposable"
  ```

- **Computeds** (`docs/work/done/computed/design.md`, tracker F33). The library keeps each computed's
  `refresh` closure in its `Dependency`. As written, it gets three 5722 errors: at the transient's
  restore, at `refresh`, and at `read`. Typing `refresh` as a `sendable fn` alone clears all
  three, which shows the plain function is the only cause. But `refresh` must capture a `Shared`
  cell and `eval`, which `sendable` doesn't allow.

`sendable` is too strong: it excludes every handle. What these libraries need is narrower: a
closure that captures handles, provided nothing it captures can reach a disposable.

## Inert types

`Inert` is a built-in trait, a marker derived like `Sendable` (§3.1): a type is inert when its
values reach no disposable at any depth. This is what the cycle rule already computes, now with a
name. A type is inert when it is:

- a primitive or a literal type;
- a struct, enum, tuple or union whose parts are all inert;
- a shared struct whose fields are all inert and that declares no `dispose`, so `Shared<T>` when
  `T` is;
- an extern type that isn't disposable and whose `@Holds` holds only inert types; a `WeakRef`,
  which holds nothing;
- a sendable or inert function type (below);
- a type parameter constrained `is Inert`, or by a trait implying it;
- an `any` type one of whose traits is `Inert` or implies it.

A recursive type is inert unless something in its cycle isn't. Every sendable type is inert, so
`Sendable`, `Encodable` and `Decodable` imply `Inert`. The types that aren't inert are:
- disposables: futures, slots, inboxes, revertibles, `Deferred`, and shared structs declaring
  `dispose`;
- plain function types;
- other `any` types;
- unconstrained type parameters;
- anything holding one of these.

## Inert function types

```python
shared struct Emitter:
    listeners: Array<inert fn(Int) -> Unit> = []

fn on(self: Emitter, f: inert fn(Int) -> Unit):
    self->listeners = [...self->listeners, f]
```

`Model` and `Emitter` are now inert, so `wire` above passes: `bump` captures `m`, an inert value,
so it is inert itself, and writes into inert values close no cycle the rule cares about.

**The rules:**
- **A third sendability.** `type Sendability = "sendable" | "inert" | "plain"`, ordered
  `"sendable"` below `"inert"` below `"plain"`. `inert fn(A) -> R` is
  `Fn<(A,), R, "simple", "inert">`, and `inert live async fn(A) -> R` is its live twin. A
  function fits where one of its sendability or above is expected: a sendable function fits where
  an inert one is expected, and an inert one where a plain one is.
- **What it captures:** only inert values. That covers copies of captured `const`s and parameters,
  captured `let` cells whose variable's type is inert, and function values that are inert or
  sendable. Unlike a sendable function, an inert one may capture a `let`'s cell and handles.
- **Inferred, as sendability is** (§3.14). A closure's or a deferred call's `Send` is the least
  its captures allow: `"sendable"` when they are all sendable, `"inert"` when they are all inert,
  and `"plain"` otherwise. A function named as a value captures nothing, so it stays sendable.
  `S in Sendability` keeps an argument's sendability through a higher-order function when every
  other capture is sendable, as today. A closure capturing functions of `S` and inert values would
  be the greater of `S` and `"inert"`, which no member names, so it is `"plain"`: conservative,
  and `Sendability`'s join already gives it.
- **A written `inert` is checked where the closure is made:** a capture of a type that isn't inert
  is a compile error naming the capture, for example "'bump' captures 'f', a Future, which may
  reach a disposable; an inert function captures only inert values". Converting into an `any` type
  bounded by `Inert` checks the value the same way.
- **Orthogonal to marks.** `inert` concerns what a function captures, not what kind of code it
  is, which the data rule checks on its own: an inert function may capture a value of a kind that
  reaches no disposable, such as an `extern live struct` declaring no `dispose`, never a future.

## Lifetimes

- **Inert values never matter to the cycle rule** (§7). An inert value reaches no disposable, so
  writes among inert values are never checked, and cycles among them are allowed. That covers an
  observer capturing its owner, and a computed's environment holding the computed.
- **For the checker,** an inert function type reaches nothing, as a sendable one does today. A
  closure of that type may hold only inert handles, and none of those can lead back to a holder
  that reaches a disposable, since a value that isn't inert can't be held by an inert one. Inert
  values can only reach other inert values, which is what keeps this sound without looking at
  closure bodies.
- **Not closure refinement (C4).** C4 would have inferred what each closure actually captures,
  across the program; it was decided against on 2026-11-12. Here the type states the guarantee, and
  the check is local to where the closure is made, as `sendable`'s is.
- **The runtime is unchanged.** Whether a handle is counted already follows whether it reaches a
  disposable (static-lifetimes design §9.1), and inert values reach none.

## What it takes

- **Syntax:** `inert` is a contextual word in a function type's modifiers, in `sendable`'s group.
  The formatter prints it in `sendable`'s place: `inert live async fn(A) -> R`. The VS Code
  grammar lists it.
- **Both written:** `sendable inert fn`, in either order, is no error. Sendable implies inert, so
  the head means `sendable fn`, and the formatter removes `inert`. The parser keeps the stronger
  word of the two, so the tree holds `sendable` alone and the formatter prints what it holds.
- **Prelude:** `Sendability` gains `"inert"`.
- **Checker:**
  - **One predicate.** `Inert`'s derivation and the lifetime rule's "reaches no disposable" are the
    same predicate in one home, so the trait and type-reach can't disagree.
  - **Function types:** the three-level order in fitting and inference.
  - **Inference and checks:** sendability inference for closures and deferred calls; the check at
    a written `inert`; the `any` bound and conversion check.
  - **Type-reach:** an inert function type reaches nothing.
- **Lowering, the Definition and the runtime:** none. Sendability never reaches the Definition.
- **What users will see:** closures that capture only inert values now print as `inert fn` in
  hovers and diagnostics, so expectations that print inferred closure types change.

**Spec edits:**
- §2: `inert` among the contextual words ("Seventeen"), the function type's modifier group (both
  written mean `sendable`), and the types table's spellings.
- §3.1: every sendable type is inert.
- §3.8: the prelude's `Sendability`.
- §3.10: `Inert` among the built-in traits; an `any` type's inertness.
- §3.14: inert function types, their order, inference and check.
- §7: inert values reach no disposable, so the cycle rule never applies to them.

Docs: the static-lifetimes design (§5.1, §5.6; inert functions are the declared answer to §5.6's
over-rejections), and tracker F33.

## Its first user

The computed library (`docs/work/done/computed/design.md`) keeps its design:
- `refresh: inert fn(Dependency) -> Unit`;
- `eval: inert fn() -> T`, with `Computed<T is Inert>`;
- the version check that stops an update at an equal result.

FormBuilder's values, scopes and models are inert. Futures must still stay out of the graph, since
a future isn't inert. Fetches become data a driver runs, which is that design's other open point.

## Decisions (proposed, for the human)

- **The name `inert`:** short, says "holds nothing live", and doesn't claim purity, as `pure`
  would.
- **A level of `Sendability`, not a new axis.** Sendable implies inert, so the levels form one
  chain, `Fn` keeps its four parameters, and `S in Sendability` covers it already.
- **Inferred for closures,** as sendability is; written only in types.
- **`Inert` is derived only,** like `Sendable`: no type opts in or out.

**Rejected:**
- **WeakRefs:** they need the target to be disposable, which makes the graph reach a disposable
  for real, and they don't remove the plain closure that causes the rejection.
- **Refining closures' captures (C4):** program-wide, and decided against on 2026-11-12.
- **Restructuring libraries around sendable functions with an explicit environment:** it works
  for computeds only by giving up the equal-result stop, and it pushes every library that stores
  callbacks into threading environments by hand.
