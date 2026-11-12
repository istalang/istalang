---
description: design of static lifetimes — a whole-program flow analysis that rejects every disposable a cycle reaches, `@Holds` declarations, the checker–runtime contract, one-way resolver edges, counted disposal and its order, handles off the id heap, and what is deleted; read before implementing or reviewing a static-lifetimes phase or changing spec §3.6, §3.16, §6 or §7
owner: tech-lead
status: active
applies_to: checker, runtime lifetimes, spec §3.6 §3.16 §6 §7
last_verified: 2026-11-12
last_updated: 2026-11-12
tags: [lifetimes, disposal, design, flow-analysis]
---

# Static lifetimes: design

Supersedes [archive/design.md](archive/design.md), whose `holding` types are dropped. Code-level
pre-research: [tour-checker.md](tour-checker.md), [tour-runtime.md](tour-runtime.md).

Decided with the human (2026-11-12):
- Every disposable that any cycle reaches is an error. That includes one held by a cycle of
  non-disposables: a closure assigned to the variable it captures, holding a lease. A cycle that
  reaches no disposable is fine.
- A whole-program flow analysis decides it, apart from the type system: no type changes.
- The error is reported on the disposable only, at its creation site. Its message gives the cycle.
- What the analysis can't see or prove is declared with the `@Holds` annotation.
- §7's order becomes reverse release order.
- Greenfield: the Definition's format changes with no version bump.

## The analysis (L1)

A checker rule unit beside endless expansion, with the same three entries: per-body constraints,
the solve, and the reports (tour-checker.md). It needs the program's calls closed per
instantiation, and `any` dispatch. L0 moves both from lowering into the checker's surface, where
lowering reads them.

- **Objects.** One abstract object per creation site and generic instantiation:
  - a handle: a shared struct, or what an extern call makes (a slot, a resolver, a mock);
  - a lambda;
  - an async call's future, and a deferred call;
  - a captured `let`'s cell (`_Cell`), one per declaration;
  - a value whose type is Disposable.

  Other values (plain structs, tuples, unions, arrays, maps) are not objects. A place holding one
  holds its parts, and a store into one (a push, an element set) is a store into the place's owner.
  A disposable object is one whose type is Disposable.
- **Flow.** Inclusion constraints, flow-insensitive and context-insensitive except for generic
  instantiation:
  - every variable, parameter, return and place gets the set of objects that may flow into it;
  - a call binds arguments to parameters and returns to its result. A write through a `&`
    parameter lands on the place it refers to: a shared struct's field, or a captured `let`'s cell;
  - a call through a function value, or a method of an `any T`, calls the lambdas, functions and
    impls in its receiver's set, found as the sets grow. An `any T` value is its underlying object;
  - calls the runtime makes are calls too: a disposable's `dispose`, a callback resolver's callback,
    an `onCancel` callback;
  - a value given to a resolver flows to what it decides: the result of the `await` or `select`
    case it decides, its callback's parameter, or, as `(position, value)`, the resolver an
    at-resolver decides;
  - **what an extern yields** is apart from what it holds. Every value given to an extern object,
    to the call that made it, or, for a mock, to a call of its target, is that object's
    content. An extern's result may be any content of the objects among its arguments, receiver
    included, any object among its arguments' parts (an array's or a map's elements), or anything
    those reach, whose type fits the declared result type. So may the
    value a future it returns resolves with. That covers `WeakRef.deref`, a slot's `take` and
    `read`, and a mock's recorded calls.
- **Holds.** An object holds what flows into its places:
  - a shared struct: its fields, and the parts of the values in them;
  - a lambda: what it captures, through the cell for a captured `let`;
  - a cell: what is assigned to its variable;
  - a call's future: its callee and arguments, and its result once resolved. That includes an
    extern call's future, whose receiver is an argument: a slot operation's future holds the slot
    and the value. Not its frame: a running call is a root, and it can reach its own future only
    through what its arguments, captures or top-level cells reach;
  - a mock: the arguments of every call to the functions in its target's set, which it records;
  - any other extern object: what its `@Holds` declarations say.
- **Construction and mutation.** Each hold is one of two kinds:
  - **Construction:** made with the object, from values that already exist: fields given to a
    literal, captures, a call's callee and arguments, an extern's result holding its arguments.
    These hold only older objects.
  - **Mutation:** everything else: a field or element store, a push, assigning a captured `let`, a
    registration, a future's result.

  So every real cycle contains a mutation.
- **`@Holds`.** The prelude declares `struct Holds<...A>{}`. Annotations extend to extern
  declarations (§3.16).
  - **On an extern function,** its receiver, or its result when it has none, holds its arguments
    whose declared parameter type is one of `A`. `A` may name the function's and its type's type
    parameters. An extern function without one holds nothing,
    beyond what its future holds as a call's (Holds). Std declares:
    - `Slot.put`, and the stores of `Array` and `Map`;
    - `Future.onAwait` (the future holds `done`), `onCancel` (the resolver holds its callback),
      `Resolver.of` (its callback), `Resolver.at` (the resolver it decides).

    `WeakRef`, `Instance` and `_Call` declare nothing: they hold nothing.
  - **On a field,** `@Holds<…>` replaces what the analysis infers it holds, and `@Holds` holds
    nothing.
    - It is for a pattern the analysis can't prove, such as fanout's chain of slots: one
      `Slot.create` site makes every link's `next`, so the abstract slot holds itself.
    - Any code may write it, std, packages and programs alike. It is the language's one unchecked
      declaration.
    - A wrong one hides a real cycle. A disposable it hides is then never disposed: a lease is never
      released, and a call is never stopped.
    - Each one in std has a test that its holdings are let go of. For fanout, that is the chain
      behind the slowest subscriber.
- **A wait's case chain is not modelled:** its case resolver, and the at-resolvers deciding it. They
  are pending only while their wait is, and a resolver that is no longer pending holds nothing. The
  waiting call reaches its own future only through what its arguments, captures or top-level cells
  reach, which the analysis models. Holds declared to or from them are dropped.
- **Incremental.** Each function body's constraints are a checker entry (incremental-checking.md), so
  an edit recomputes one body's, and an equal result skips the solve. The solve covers the whole
  program, std included, from its own modules' bodies; a generic body is analysed once per
  instantiation reached. It may skip any place whose declared type can't reach a disposable, such
  as a sendable type.

## The rule (L2)

- **Error:** a disposable object reached from a cycle of holds that contains a mutation. In graph
  terms: a strongly connected component with a mutation edge inside it, and every disposable it
  reaches. A cycle of construction holds only is objects merged by the abstraction (a list built in
  a loop), never a real one.
- **Where:**
  - One diagnostic per disposable's creation site. When that site is in std or a package, it goes
    on every call in the program's own code that leads to it.
  - The message names the cycle starting from its first site, in module-then-position order, so a
    report never depends on what was checked first.
  - Every module's check reads the reports entry. The editor therefore shows a report in its own
    module, whichever module was edited.
- **What it catches:**

  | Kind | Example |
  |---|---|
  | data | `a->partner = b; b->partner = a`, where a partner holds a lease |
  | call | `task->running = _run(task, …)`; WeakMap's watch |
  | closure | `f = fn: { use(lease); f() }` |
  | resolver | `s->sub.onAwait(Resolver.of(fn v: s->last = v))`; `r.onCancel(cb)` with `cb` reaching `r` |
  | `any` | `Hub{subs: Array<any Listener>}`, with a listener holding the hub |
  | mock | a mock recording an argument that reaches the mock |

- **Accepted:**
  - a list or tree built by construction, and a recursive async function;
  - a path through a `WeakRef`, a top-level cell, or a field declared `@Holds`.

  A call that reaches its own future through one of these still runs on as a root, as it does
  today.
- **Precision beyond this** (per-call contexts for helpers that pass values through) is added only
  if L1's dry run shows false errors that `@Holds` shouldn't cover, and is designed with the human.

## Contract between the lanes

- **The flag.** L2 writes `tracked` on the Definition's type entries: some object of the type may
  reach a disposable. The checker is its one home; the runtime only reads it.
- **What the runtime counts:**
  - every disposable;
  - a handle or cell whose type is tracked;
  - a composite value, when one of its direct parts is counted. That is decided at its first hold
    (R4), because natives build values with no instance at hand.
- **Exact where it matters.** The rule keeps every object that reaches a disposable out of cycles,
  so the counts of those objects are exact.
  - An object of a tracked type may still sit in a cycle that reaches no disposable (`let f = fn:
    f()`). It never reaches zero, which nothing observes: it disposes nothing, and the weakly keyed
    count table lets it go with its last reference.
  - R4's check is therefore: every zero is an orphan, and every orphan that reaches a disposable is
    a zero.

## Resolver edges (R1)

Today a registration holds both its ends: a future holds its pending resolvers, and each resolver
holds its future. That is a 2-cycle by construction (heap `#indexedHolds`, holdings `state.on`).
Each edge becomes one-way, a behaviour change of its own. The other direction is a watch: an index
entry, never a count.

- **A wait's case resolver:**
  - its wait holds it while it is awaited, and an awaitable may keep it too;
  - it holds the futures it is registered on, the at-resolvers registered to decide it, and its
    `onCancel` callbacks;
  - it lets go of them once resolved or cancelled. It is cancelled when its waiting call stops, as
    today.
- **A callback resolver** (`Resolver.of`): the future it is registered on holds it. It holds its
  callback and its `onCancel` callbacks.
- **An at-resolver** takes the direction of the resolver its chain ends in:
  - in a case chain, `done` holds the at-resolvers, and they hold their futures;
  - in a callback chain, the futures hold the at-resolvers, and they hold `done`.
- **A future disposed first** cancels the pending resolvers registered on it, found through the
  resolvers index. With one-way edges they no longer share its last holder.
- **Awaited edges** (a wait holding its case resolver, a resolver holding an at-resolver) change
  when another object's status changes (`Waits.register`, `ResolverEndings.replace`). The holder
  seam covers them.

## Counted disposal (R2–R6)

- **Where counts live:** in a per-instance table keyed weakly by object, never on values or heap
  records, which in-memory snapshots share. Every restore rebuilds the table in one pass over what
  it restores: a decode, or a resident's in-memory `take()`.
- **Holders:** what `snapshot/holdings.ts` and `Heap.holds` hold today, their one home, with the
  resolver edges above.
- **At zero:**
  - confirmed at the end of a step, not at the decrement, since several paths let go before they
    hold again;
  - an object confirmed at zero leaves the heap and its indexes: resolved futures, timers and cells
    included;
  - a disposable is disposed first, then the object's direct parts are let go of. That frees the
    dead object's parts and never walks the live state.
- **Calls:** a call is a root until it finishes, and its frames take counts. A future reaching zero
  stops its call, at its next `await` when it is running, as disposing a call's future does today.
- **Order (R6):** what one release lets go of is disposed last-held first:
  - a block's variables go last-declared first, and a composite's parts last-first;
  - a holder is disposed, its dispose code run, before its parts are let go of, depth-first;
  - zeroes made by a dispose's own code are handled before that dispose's siblings.
- **Kept:**
  - per-kind disposal (`disposal.ts`), and dispose code on the run stack (`disposal-runs.ts`);
  - weak watches, resolved when their target is disposed;
  - `Slots.#owed`;
  - an ending instance's recovery (`collectEnding`), rebuilt by R5 over the queue of zeroes.

## Off the id heap (R3, R7)

- **Identity (R3):** every handle refers to its object directly, with a creation serial for `==`,
  hashing, snapshot ids and the creation order the scheduler reads (`Heap.find`). That settles
  Q51, and R4's count table is keyed by identity from the start.
- **Only indexes (R7):** the heap keeps only the scheduler's indexes. An object's membership changing
  over its life touches neither its handles nor its count. Live runs never walk, and an ista commit
  writes what its roots reach in its encoding pass.
- Handles' identity across a record's replacement, the in-memory and stored forms, and the full
  index list: [tour-runtime.md](tour-runtime.md).

## Deleted

| Phase | What goes |
|---|---|
| R5 | the collector's rounds (it becomes a queue of zeroes); `orphans.ts`; `handlesIn`/`summaryOf` for releases; `Heap.noteReleased`/`takeReleased`; the commit's invariant scan (P4) |
| R7 | `holders.ts`; `Instance.dropUnheld`, `#kept`, `Heap.keepOnly`; holding rules in `snapshot/holdings.ts` that only served the walks; id handles |

## Spec and docs

Each phase commits the sections it makes true, so the spec never describes behaviour the code lacks.

- §3.6 (externs) and §3.16 (annotations): `@Holds` (L1).
- §7: the cycles bullet becomes the rule (L2). The one-way edges replace "a registration holds both
  its ends" (R1), with §6's resolver wording. Holders by count, and a call as a root (R5). The
  order (R6).
- `docs/arch/architecture.md`:
  - the checker's and lowering's entries, and "Phase contracts": instantiation closure and `any`
    dispatch move to the checker (L0);
  - the analysis unit, and its solve as an entry that every module's check reads (L1).
- `docs/work/m6-m7/incremental-checking.md`: changed if module checks read the solve differently
  (L1).
- `docs/arch/definition.md`:
  - the Holders rows for future, wait and resolver (R1);
  - the "Disposable cycles" row (L2);
  - the Rejected column of "What a snapshot stores", which rejects reference counts, is reversed
    (R5). Counts are derived in memory, never stored, rebuilt on every restore, and checked against
    the collector in R4.
- `docs/reuse/runtime-and-persistence.md`'s one-way rule narrows to "never persist counts" (R5).
