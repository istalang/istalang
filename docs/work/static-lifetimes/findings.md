---
description: research behind the static-lifetimes plan — the checker units to build on, the lowering's release points, everything the runtime's reachability machinery feeds, the heap and handle representation, the corpus code that breaks the rule, the tests asserting disposal order, and measurements; read before implementing a static-lifetimes phase
owner: tech-lead
status: active
applies_to: checker, lowering, runtime lifetimes, stdlib
last_verified: 2026-11-11
last_updated: 2026-11-11
tags: [lifetimes, disposal, research]
---

# Static lifetimes: findings

## Checker (L1, L2)

- **`types/properties/held.ts`.**
  - `heldType(checker, type, picks)` and `heldTypes` walk what a type holds at any depth, crossing a shared struct's contents, with `TypeCycle` as the guard.
  - `heldPartsOf` gives `[]` for a function and a type parameter. L1 makes a function give its holding, and a future its holding beside its value.
  - `must-use.ts` already asks `heldType(…, isFuture || isResult || isDisposable)`.
- **`types/properties/value-kinds.ts`** is proposal 8's "holds kinded data at any depth".
  - It has declared, composed and walked kinds, with dependent parts re-instantiated per use, memoized in `wiring/program/program-kinds.ts`.
  - It is the model for computing *tracked* per declaration, with instantiation-dependent parts.
  - It duplicates `held.ts`'s walk (written types, a nesting bound): unify them rather than add a third walk.
- **`rules/disposal/disposal.ts`.**
  - `isDisposable(checker, type)`: nominal types go through `checker.disposalOf`, parameters through their constraints requiring `dispose`.
  - It is memoized in `program-disposals.ts`.
- **Captures.**
  - `constructs/closures/lambdas.ts` records a lambda's `captures` (entity and type).
  - `capturedSend` in `types/traits/sendable.ts` derives `Send` from them through `heldTypes`. Holding follows the same path into the type.
  - `FunctionType` has only `mark`, `send`, `parameters`, `pack` and `result`.
- **Futures.** `futureOf` and `awaitedOf` are in `types/type/well-known.ts`. A call's argument types aren't in its future's type today.
- **Generics** are checked once per body. Instantiation checks go through call type arguments, as `call-kinds.ts` does for kinds.
- **Diagnostics.**
  - `diagnostics/lifetimes.ts`, block 5700–5799. 5712 is next free.
  - Concurrency kinds are 56xx.
- **Precedent:** F1 added `Kind` and `Send` slots to `Fn`, and made std's higher-order functions generic over them (F28).

## Lowering

- **Release points are the lowering's already:**
  - `release` at block and statement ends, on exits, and for `drop`;
  - `keep` for `hold`;
  - `select` cases' `holds`;
  - `return` releasing every register.

  The counting hooks are the interpreter's existing write and release sites. The Definition gains only the `tracked` flag on type entries (design.md, Contract).
- **Composites are built in many places,** which R2 gathers into one constructor:
  - `interpreter/instructions.ts` (tuple, array, map, struct, keep);
  - `scheduler/instance/waits/resolvers.ts`, `testing/mocks.ts`;
  - natives (`maps.ts`, `values/arguments.ts`, `results.ts`, `strings.ts`, `range-natives.ts`);
  - the decoders (`json-values.ts`, `declared-values.ts`);
  - `parts.ts` `withChildValues`.
- **Generics are compiled per instantiation,** so every type at an emit site is concrete. The IR is untyped by decision.
- **Stale doc:** `move`'s comment in `definition/instructions/data.ts` says it adds a holder, but it copies a register.

## Runtime machinery fed by reachability (R3–R6)

- **`lifetimes/`:**
  - `collector.ts` runs rounds: `disposablesFrom`, then `heldUnlessAll` from the roots, then `readyOrphans`.
  - `holders.ts` (`heldFrom`, `walkHolds`, `holdsOf`) also computes the commit's depth.
  - `orphans.ts` uses strongly connected components and orders by descending id.
  - `disposal.ts` holds the per-kind disposal.
- **Per instruction:** `SegmentRunner.#drive` calls `collected()`, which runs `takeReleased`, then `collect`, then `serveOwed`.
- **Per release:**
  - `registers.ts` (`writeRegister`, `clearRegister`) notes every handle in the old value: `handlesIn` is memoized per value.
  - `Heap.#noteHoldings` diffs `heldObjects` on every replace and remove.
  - `scheduler/instance/waits/` (`index.ts`, `endings.ts`) notes every resolver state change.
- **Per live segment:** `Instance.dropUnheld` runs `#kept` (`heldFrom`, a full-heap scan, the depth), then `keepOnly` and `forgetGone`.
- **Per commit:** `persisted` runs `#kept`; `continueFrom` runs `keepOnly`.
- **Slots:** `#owed`/`serveOwed` exist because serving waits on collection after a `select`'s losers are let go.
- **Weak side.** `disposal.ts`'s `watched()` makes otherwise inert objects disposable while watched. Watches resolve in `Collector.#gone`, through `weak.disposed`.
- **Resolvers.** `live-resolvers.ts` has `onCancel` through `futures.onDisposed`. The host's dropped resolver uses a `FinalizationRegistry`, not the walk.
- **Duplication noted:**
  - `dropUnheld` and `continueFrom` repeat the same pair of calls.
  - Losers are released on two paths (`releaseLosers` and `enterCase`).
  - `LiveExecution.disposing` is never read.

## Heap and handles (R6)

- **Handles.** A handle is `{kind:'handle', object: id}`.
  - `==` compares ids (`equality.ts` `sameHead`); hashing is `handle:${id}`.
  - `handleTo` has 20 non-test call sites; `heap.of(…,'cell')` has 2. Every cell read and write goes through `FrameHeap` in `registers.ts`.
- **Shared state.** `storedObject` returns the live object, and a resident's `take()` restores from the in-memory committed snapshot without decoding. So a count kept on a value or heap record would be shared across the two.
- **Heap.**
  - 11 object kinds and 9 indexes. No index covers cells.
  - Ids are reused above the highest live one. The comments in `snapshot/objects.ts` ("never reused") and `heap.ts` disagree.
- **Snapshots.**
  - Objects are written in ascending id order, with referential closure checked.
  - A restore rebuilds the heap by id.
  - Resident instances `continueFrom` the live objects.
- **Live runs** use the same `Instance` and `Heap`.
- **Raw handle reads that bypass the helpers:** `equality.ts`, and `mocks.ts`'s `asHostValue`/`leaving`, which are two copies of one walk.

## Code that breaks the rule

**Real cycles at run time:**

| Where | Kind | Cycle |
|---|---|---|
| `collections.WeakMap` | call | map → entry → `watch` future → `_deleteOnDisposal(map, …)` |
| FormBuilder `Task` | call | `task->running = _run(task, …)` |
| `test/corpus/holders/dispose.ista` `cycle()` | data | `Lease.partner` |

**Breaks by type only** (no run-time cycle, but the rule rejects it):

| Where | Why |
|---|---|
| `fanout` | `_Link<M>.next: Slot<_Link<M>>`, an acyclic chain of a recursive type |
| `Deferred`, `Revertible`, `Mock`, `_Receipts` | tracked handles holding functions of unknown holding |
| spec §7 example `new Shared<Future<…>?>{value: bus.subscribe(…)}` | a tracked handle holding a future of unknown holding |

**More violators:**
- FormBuilder's `FieldView`, `RepeatView` and `DynamicView` hold `Prop<Sc, T>`, whose variants hold unknown functions and a tracked `Task`. They also hold `any View` and `any Showable`. These are the handles of the benchmark program itself.
- **Resolver registrations are runtime 2-cycles in no type:**
  - A future holds its pending resolvers, and each resolver holds `state.on` (`heap.ts` `#indexedHolds`, `holdings.ts`).
  - `Resolver.at`'s `done` holds its awaited at-resolvers.
- **`held.ts` gaps:**
  - It returns every extern type argument, which over-approximates `WeakRef` and `Instance`, which hold nothing.
  - It gives `[]` for `any T` and for type parameters.

**Within the rule:** `rpc`, `inbox` and `futures._Race`.

## Tests asserting today's semantics

- **Order and cycles:**
  - `lifetimes/orphans.test.ts`;
  - corpus `holders/dispose.ista`, `defer.ista`, `function-holdings.ista`, `hold-scopes.ista`, `lifetimes.ista`, `exits.ista`;
  - `combined/scope-teardown.ista`;
  - `testing/mocks.test.ts:78`.
- **Weak side:** `weak-side/*.ista`, `instance/weak-side.test.ts`, `collections.test.ista`.
- **Live run:** `live-run.test.ts:198`, "lets go of a timer nothing waits on".
- **Commits:** `wake.test.ts` `:240`, `:324` and `:332`, and the resident sweep.
- **Runners:** the corpus runs through `wake.sweep.test.ts`, `resident.sweep.test.ts` and `cli/commands/run.sweep.test.ts`.

## Measurements (2026-11-11, live FormBuilder `supplierForm`)

**Per change, live form:**

| Run | Per change, settled | First view | Notes |
|---|---|---|---|
| As-is | 48 ms | 24 ms | 3 views per change |
| Releases not noted (ceiling) | 26 ms | 12 ms | |

Share of a change's profile: collector 33%, release walks 20%, `newFrame` 13%.

**Live micro-benchmarks (n = 2000):**

| Loop | Before | After |
|---|---|---|
| `await` loop, with a settled-future fast path | 50 ms | 33 ms |
| per-step check without allocation | | −15% |
| map set (quadratic, P2) | 183 ms | |
