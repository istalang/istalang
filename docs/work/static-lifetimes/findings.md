---
description: static lifetimes' dry-run findings — the false positives C3's analysis met over the std, the corpus, the spec and the examples, what C3 refined for each, and the ones left to C4; read before working on the analysis's precision or C4
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-12
last_updated: 2026-11-12
tags: [lifetimes, checker, findings]
---

# Static lifetimes — findings

C3's dry run (plan.md, C3 step 2) ran the analysis over the std, the corpus, the spec's suites, the
examples and the runtime tests' programs before any diagnostic was on. Here are its false positives,
what removed each, and the ones C4 must remove. The real cycles it found are in design.md §10.

## Removed in C3

| Shape | Where it showed | What removed it |
|---|---|---|
| An unknown iterator: `for x in xs` over a std cursor, taken as an unknown call | `inbox` `pending`, `futures` | a std `iterate` cursor gives its items (`KnownFunction` `items`) |
| A value passed by `&` taken as a captured `let`'s cell | everywhere `&` meets a closure | cells only for captured `let`s |
| A path re-read through the same handle as a fresh value | `inbox` `pending` re-reading `self->slot` | path nodes: a must-alias re-read is one value until a write may change it, materialized at joins (design.md §5.7) |
| A native's handle result taken as aliasing its arguments; its value result as reached by them | `take`, `put`, `Inbox.receive` | a handle result reaches its arguments, a value result aliases them, and only a handle argument reaches it |
| A write after an unknown call (`make()`) related to every escaped value | `testing` `post`, `sendRevertible` | an unknown call reaches only what it is given, the globals and what was handed to unseen code, under separation requirements (design.md §5.5) |
| A cycle through a value of a type parameter's type reported at its generic body | generic helpers over `T` | the surest path decides, and a cycle decided by a type parameter is its function's `always`, for each instantiation (design.md §5.5) |
| A closure taken as possibly being another object | `testing` `revertibleSender`'s `push` | a closure is an object of its own in the declaration graph, and types filter every pair (design.md §5.5) |
| A generic parameter's input aliasing its own variable, then reached through the declaration graph | generic `remove` | an input may be one handle with a value it shares with (`oneHandle`), so the declaration graph doesn't relate them |
| A witness called through `any` checked where its value is converted, its arguments any values of their types | FormBuilder's drawing | the witnesses of every type converted into `any T` are called at the dispatch site (design.md §5.4) |
| `let f = fn: f()` | design.md §12 | a cycle of closures and cells holding nothing else holds no disposable |
| A typed cycle kept with its deciding type only, then found at an instantiation that can't close it | `FakeReceipts<Sent>`'s `revertibleSender`, `Sent` holding nothing: spec §12.1's suite | a typed cycle carries its holder's type and what its value goes through, and a call's cycle is the object written into, of its own type (design.md §5.5) |
| A running call's frames held through its future | `WeakMap.set` after its rewrite, under the oracle | the oracle gives a running execution's future no edge to it (design.md §9.2) |
| A call's result sharing with an input taken as reaching it, and reached by it | `runtime.delegate`'s future, sharing a slot with `_jobs`, then reaching every global `_jobs` may reach | a shared result shares with the input and with what reaches it, no more; a write into an object a holder reaches, not its own cell, reaches what shares with the holder too |
| A union put into `any` taken as one type | `test/unions/any-variance.test.ts`, a crash | each member goes in as lowering puts it, and a value of another `any` as the values put into that one |

## Rewritten in C3

- **`testing` `_disposeReceipt`** called each receipt's `retract` while iterating the receipts,
  then wrote the rest back. `retract` is code nobody sees, called with the receipts' entries in
  reach, so the body relied on `receipt` sharing nothing with them: a separation requirement no
  caller can meet, since a receipt is held in the receipts it is looked up in. It now retracts once
  the rest is written back, which also keeps a retraction from seeing its own entry. Under C4's
  closure captures, `retract` is `held->value = none`, and the requirement goes.

## Left to C4

- **FormBuilder's `run`** (`forms.ista`, `view.draw(Scope{data: before, ctx}, &out)`). The loop
  awaits `out.waits`' closures, which the drawing's witnesses made (`peek`'s
  `async fn(): task->value = await eval(sc)`), and they come back out of the array as unknown
  function values reaching the scope and the tasks. That unseen code, and the suspends after it,
  relate the model, the view, the context and the inboxes by types, since `M`, `C` and `any View`
  may reach anything. Then the scope's data may reach the view's parts, and the dispatched
  witnesses' requirements fail: 4 errors at the call, and the generic ones at each generated
  form's `forms.run(…)`. `test/examples.test.ts` marks FormBuilder `it.fails` until C4's
  closure captures (design.md §5.6). Its real cycles, the `Task`s, are fixed (design.md §10).
- **`runtime.delegate`'s tests** (`src/stdlib/runtime/delegate.test.ts`, two programs). Each
  writes a delegated job's future into a context constant, `kept`, from a function it gives
  `rt.call`. That function escapes, so its requirement that `_jobs` not reach `kept` is checked by
  types, and the job table's closures may hold anything. The tests run through
  `textDespiteCycles`, the oracle checking their heaps, until C4.
- **An escaped plain function written after an `await`,** and **relinking after unlinking**
  (`node->next = other`): plan.md's C4 acceptance. C3's dry run met neither outside FormBuilder.
