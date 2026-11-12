---
description: the proposed design for static lifetimes — the invariant (no cycle through anything reaching a disposable), why only writes close cycles, the runtime holding protocol it needs, the per-body flow IR it runs on, the analysis (relevance, flow-sensitive reachability, bottom-up summaries with requirements, calls decided later, unseen code, and the planned refinements for closures' captures and fields), extern annotations `@Holds` and `@Keeps`, diagnostics, editor cost, reference counting and in-place updates, the code it rejects, spec edits, acceptance examples and rejected alternatives; read before planning, implementing or examining any of it
owner: tech-lead
status: proposed
applies_to: istalang
last_verified: 2026-11-12
last_updated: 2026-11-12
tags: [design, lifetimes, disposal, checker, flow, runtime, refcount, lsp]
---

# Static lifetimes — design

Proposed 2026-11-12; §14 records what the human decided. The plan is `plan.md`, and the code tours are `tour-checker.md` and
`tour-runtime.md`. Spec: §3.16, §3.18, §5, §6, §7.

**Goal.** Disposal without tracing. Today every instruction that lets go of something may start a
walk from the roots. The collector takes 33% of a live change and release walks another 20%
(`tour-runtime.md`, Measurements). The compiler instead proves that no cycle can hold a disposable,
so a count decides when a disposable loses its last holder.

**Constraints, in priority order:**
1. Sound: a program the compiler accepts never leaks a disposable.
2. No new syntax in user code. `WeakRef` is the one way to break a cycle.
3. Precise where code is common: building a structure, appending, reply channels, generic helpers,
   the std's own modules.
4. Within the editor's per-edit budget (`docs/work/m6-m7/incremental-checking.md`).

## 1. The invariant

**No heap cycle passes through an object that reaches a disposable.** Equivalently, the objects
that reach a disposable form a DAG.

- Under it, a disposable loses its last holder exactly when its count drops to zero.
- The runtime counts only what can lead to a disposable (§9.1). Everything else is reclaimed by
  the host's garbage collector and by the commit's walk, which already persists only what is
  reachable (§5).
- A cycle among objects that reach no disposable stays legal, for example `let f = fn: f()`.
- Spec §7's **Cycles** bullet becomes a compile error, fixed by holding one side through a
  `WeakRef`.

## 2. Only a write closes a cycle

An object gets its initial contents when it is made, from values that already exist, so making an
object adds edges only from a new object to older ones. A cycle needs an edge from an object to one
no older than itself, and only a write into an existing object adds such an edge. The analysis
checks writes only:

| Write | Holder |
|---|---|
| `x->f = v`, `*x = v`, a compound assignment through `->` | a shared struct's cell |
| assigning a captured `let` | its `_Cell` (§3.14) |
| a place passed by `&`: an explicit `&` argument; `a[i] = v` and a map literal's entries, through the implicit `setIndex` and `insert` calls | the place's owner: a variable's storage, a cell, or a shared struct's cell |
| a std native that keeps an argument (`put`, `onAwait`, `onCancel`) | the handle `@Keeps` names (§6) |

**A write `x <- v` is an error when `v` may reach `x` and `x`'s type reaches a disposable** (§5.1).

**An async call's future holds the call** (spec §7), and the call holds what its frames hold.
Writes to an async function's variables are still not checked as writes. Instead, a call's future
is made carrying what the call *may come to reach* (§5.3): what its frames hold at any `await`,
and its result. Any write that later makes that future reachable from one of those objects is
checked like any other write. So the cycle is caught where it closes.

## 3. What holds what

`runtime/snapshot/holdings.ts`, plus the index edges in `Heap.holds`, stays the one table of what
each object holds (`tour-runtime.md`, Holding today). The analysis's model must match it:

| Holder | What the analysis says it holds |
|---|---|
| shared structs | their fields |
| `_Cell<T>` | `T` |
| extern handles | `@Holds` |
| call futures | the call's summary |
| natives | `@Keeps` |

A contract test holds the analysis's model and the runtime's table together (§6.6).

**Two runtime facts the plan must change or respect:**

- **Registrations hold both ends today.** The future → resolver edge sits in the `resolvers` index,
  and the resolver → `on` edge in the resolver's fields. At-resolver ↔ `done` is the same. So the
  runtime makes cycles of disposables by itself on every registration.
  - **R1 picks one direction per chain, from the chain's root** (`rootOf`):
    - **case root (a wait's case):** the resolver holds `on`, `done` holds its awaited
      at-resolvers, the wait holds its awaited case resolvers, and the future only watches;
    - **callback root (`Resolver.of`):** the future holds what is registered on it, an at-resolver
      holds its `done`, and a resolver only watches `on`.
  - `disposeFuture` cancels the resolvers still registered on the future.
  - Both are spelled out in `tour-runtime.md`, R1.
- **Executions are roots,** and a call future holds nothing. The only link from a future to its
  call is the `executions` index, which disposal reads.
  - So **today a call whose variables reach its own future is never disposed**. That contradicts
    spec §7, "An async call's execution is held through its future".
  - The analysis models the spec: a call future holds its call. It rejects the program, so
    executions can stay roots under counting. The oracle adds the future → call edge (§9.2).

**Case chains are transient.** A wait's case resolver and the at-resolvers deciding it hold what
they are registered on only while the wait is pending. A wait ends deterministically, either decided
or because its waiter stops, and ending drops every hold of its chain (`ResolverEndings`).

So the analysis does not treat a case chain as objects. An awaiting call holds what it awaits
(its operand, and what the operand registers on), which puts the chain inside the call's reach
(§5.3). The oracle leaves case-chain edges out of its cycle search (§9.2).

## 4. Where it runs: a flow IR per body

The analysis runs in the checker, on each checked body, so the editor shows its diagnostics. It
needs two things: the order code runs in, and where each value goes. Today:

- `rules/flow/forward.ts` gives the order over syntax, with events for names, whole assignments and
  `drop`. It has one client, `rules/disposal/dropped.ts`.
- `rules/kinds/data-kinds.ts` walks every value a body computes, with a walk of its own.
- Only lowering knows where values actually go: a captured `let`'s cell, the 16 roles of implicit
  calls, temporaries, release points. It does so per instance, from `main`, and only for accepted
  programs, so the editor never runs it.

**Decision: a flow IR per checked body, derived in the checker from `CheckedBody`** (its facts are
listed in `tour-checker.md`) **and memoized as an entry.** It is a control-flow graph of explicit
value operations over the body's variables and temporaries:

| Operation | Meaning |
|---|---|
| `make` | a struct, tuple, array, map, shared struct, closure (its captured cells and copied `const`s) or cell, from its parts |
| `copy` | a value bound to a variable or temporary |
| `read` | a part: `x->f`, `*x`, a field, an element, a tuple element |
| `write` | a part of a place's owner (§2) |
| `call` | a resolved call, written or implicit (`madeCalls()`), with its type arguments and its arguments by value or by `&` place |
| `callValue` | a call of a function value |
| `suspend` | an `await` or `select`, with what each case awaits |
| `release` | a block's end, `drop`, overwriting |
| `return` | — |

Branches, loops, labels and the ruled-out code of `FlowDecisions` shape the graph.

- **Semantics, not layout.** No registers, offsets or instance-specific shapes. The IR is generic:
  `CheckedBody` gives calls as checked, not substituted. Lowering derives layout later (AGENTS.md).
- **First client:** `dropped.ts` moves onto it, and `forward.ts` is deleted. `data-kinds.ts` stays
  a walk of the tree: its rule reports the first refused value in a function's text, an order the
  IR doesn't keep. A sweep proves the IR covers every construct instead
  (`rules/flow/flow.sweep.test.ts`): each expression checking typed has a value at its node, and
  each call `madeCalls()` lists is a call of the IR.
- **Lowering moves onto it last** (plan C5), together with eliding redundant retain/release pairs,
  which needs the same IR. Until then the oracle (§9.2) catches any disagreement between the IR and
  lowering.
- **Flow typing (narrowing) is unrelated.** The checker has already settled every type the IR
  carries.

## 5. The analysis

### 5.1 Relevance, read off types

A type **reaches a disposable** when:
- it is disposable (`isDisposable`); or
- it holds such a type at any depth (`heldPartsOf`, with `@Holds` for externs); or
- it is a plain function type or a call future. Both hold what they capture or run, which types
  don't show, so that counts as anything (§5.6).

A sendable function type reaches nothing. Relevance is memoized per type.

- A write whose holder's type reaches no disposable is skipped. Most bodies have none, and their
  summary is trivial.
- Reach is capped by type: a value of type `X` reaches only objects of types `X` may hold.
- `reachesDisposable(type)` is also what decides which handles the runtime counts (§9.1).

### 5.2 Inside a body: reachability over variables

The abstract values are the IR's variables and temporaries, **not allocation sites**, as in
Genaim–Zanardini. A variable holds one object at a time, so the object a loop makes in this pass is
never confused with the one from the last pass.

The state at each point has three parts:
- **may-reach** (`a ⇝ b`): what `a` holds may reach what `b` holds;
- **may-alias**;
- **escaped**: reachable from inputs, globals, or code the body doesn't see.

Beside them, C3 keeps what each value was **read out of** (decided 2026-11-12). `a ⇝ b` holds both
for a part `b` read out of `a` and for a value `b` written into `a`, and sharing has no direction.
Only a part's reach is some of its whole's. So a requirement's sources, and the effects saying a
caller's input comes to reach what another holds, follow what was read out of what, and a value
written into another gains nothing of it. A relation guessed by types may be either, so it is
both.

| Operation | Effect |
|---|---|
| `make n` | `n` reaches what its parts reach; nothing reaches `n` |
| `read z <- x.f` | `x ⇝ z`; `z` reaches at most what `x` reaches |
| `write x.f <- v` | check `v ⇝ x` or `v` aliases `x` (§2); then whatever reaches `x` reaches `v` and what `v` reaches |
| `copy` to a variable | a strong update: the variable's old relations are gone |
| `release`, `drop` | the value is gone |

Paths join by union, and loops iterate to a fixpoint (the domain is finite per body).

**Prepared for fields (§5.7):** each pair carries a field label, which C3 always sets to "any
field".

### 5.3 Across calls: bottom-up summaries with requirements

Each function gets a summary over its **inputs**: parameters, captures, the context constants it
reads, and its result. Summaries hold no positions or nodes, so editing a body without changing its
effects cuts off (§8).

- **Effects:** the reach pairs a call may add among its inputs. For example, `link(a, b)` adds
  `a ⇝ b`.
- **Result:** what the result may reach or alias, and whether it is made by the call.
- **Requirements:** pairs that must not hold when the function is called. A write `p <- q` inside it
  requires `¬(q ⇝ p)`. Each requirement carries the holder's type, so it applies only where the
  instantiated type reaches a disposable.
- **Call reach** (async functions only): what the call may come to reach. This covers:
  - what its frames hold at any `await`, including what it awaits (§3), with liveness from the IR;
  - its result;
  - what it receives through its inputs' slots.

Summaries are computed bottom-up over the call graph. A group of mutually recursive functions
iterates to a fixpoint, which terminates because the lattice is finite over input positions.

They are **polymorphic by construction**: they speak of inputs, not types. So `Inbox.send`,
`Shared` and generic helpers stay precise at every call without cloning heaps.

**At a call**, the caller checks each requirement in its own state:
- If the pair may hold → an error at the call, citing the callee's write.
- If both sides are the caller's inputs → the requirement moves up into the caller's summary.
- Roots (started functions, tests, constants' initializers, context and top-level alike) have
  unrelated inputs, so a requirement ends there satisfied. **No whole-program pass exists.**

What C3 settled about requirements and defaults:
- **A requirement carries the written value's type** beside its holder's. A write closes a cycle
  only where the value written and the input it came from may both reach the holder by types. A
  typed cycle keeps the input's type among its `sources`.
- **A requirement on a parameter taken by `&` says where the write lands:** in the caller's place
  (`r = v`, `xs.push(v)`), or behind a handle the value there holds (`r->next = v`). The caller
  checks the place's owner or the value in it.
- **A default is analysed as a function of the parameters before it,** and its summary joins its
  function's. A call leaving the argument out binds that parameter to what the default's value
  relates to.
- **A default is analysed with its function, in its recursive group** (found by C4's QA): a typed
  default may call back into its function, or into the struct whose field it is, so the call
  graph's nodes are the functions with a body or defaults, and a group iterates its members'
  defaults with their bodies. Analysed apart, such a default met its function's analysis running
  and answered a stand-in that found nothing.
- **A cycle a callee's own code makes at the types a call gives it** is reported at the call as
  its own case (5724), apart from a callee's write of what it is given (5721).

### 5.4 Calls whose callee is decided later

- **A requirement called on a type parameter** (`x.render()` with `x: T`, `T is View`) has no callee
  until instantiation, so the generic body calls it as code it doesn't see (§5.5): what it is
  given escapes, and may come to reach each other as their types allow (decided 2026-11-12).
  - Each call of the function checks the witnesses it gives (`FunctionCall.witnesses`) against the
    declaration graph, for any values of their parameters' types, as a native's are.
  - So a generic program is rejected whenever its instantiated copy is, and may be where the copy
    isn't: a witness doing nothing counts as one that may link what it is given. The workaround is
    a `WeakRef`, or values kept apart.
  - A computed type's requirement, or a union's trait, runs each member's witness once known, as a
    dispatch does.
  - **If generic code is rejected too often later:** C3 first kept such a call symbolic, closing
    it per instantiation with C1's closing and reading the witness's writes off pairs of its
    arguments (commit `45610cbf`: `rules/lifetimes/symbolic.ts`, `analysis/symbolic-calls.ts`).
    Review found it missed the witness's result and effects, and how they change the rest of the
    body. The exact form is analysing each instantiation's body (findings.md).
- **A call through an `any T` value** dispatches on the value's own type, which is one of the
  types the program converts into `any T` (decided 2026-11-12):
  - an entry per module gathers the conversions into `any` in its bodies, and an entry per trait
    unions their witnesses across the program's modules, cutting off where an edit converts
    nothing new;
  - at a dispatch site the call is a call of each of those witnesses with the site's arguments,
    whose requirements the caller checks in its own state, as any callee's.
  So a witness that writes one argument into another is checked where the arguments are known.
  Checking at the conversion instead would take them as any values of their types, and it
  rejected FormBuilder's drawing.
  - The conversions are read as the checker fits each copy, by the pairs of parts lowering
    rebuilds a value by (`types/fitting/part-pairs.ts`). So a value put in part by part, into a
    shape, as a function's parameter the other way round, as its result made a future, or into a
    union holding an `any`, counts too. A union goes in member by member. A value of another `any`
    goes in as what went into that one.
  - A value of a type not known yet goes in only in a generic body, whose instantiations the
    dispatch doesn't follow: a trait some module puts one into is open, and a call through its
    `any` is code the body doesn't see. The witnesses the instantiating call gives are checked by
    types, as above.
  - A call on a union's trait, or on a computed type an instantiation made known, runs each
    member's witness, as a dispatch does.
- **A call of a function value:**
  - If the IR shows which closure it is (made in this body, or passed straight to a call), that
    closure's summary applies.
  - Otherwise it is code the body doesn't see.

### 5.5 Code the body doesn't see

Other code can change how escaped values reach each other:
- other executions between a body's `await`s;
- a call of an unknown function value or through `any`;
- code the runtime runs: a `dispose` (with the value, once nothing holds it), `Resolver.of` and
  `onCancel` callbacks, and `defer`'s function through `Deferred`'s `dispose`.

**The declaration graph** models that code, from declarations alone, with no bodies: handle type
`H` may come to hold type `V` when one of `H`'s held types fits `V`. Plain function types and call
futures may hold anything (§5.6). C3 settled three more points:
- **A closure is an object of its own.** A function value's reach is a closure, and what that
  closure holds may be anything. So a closure never *is* another object, and a value holding one
  aliases nothing through it.
- **Types filter every pair.** The reach state never adds a pair the declaration graph forbids,
  whatever adds it: a read, a call's summary or unseen code.
- **The value and its holder decide.** A cycle's deciding type is the less relevant of its holder's
  and its value's, a value the body made going by the parts that reach the holder: reach is closed
  under itself, so the values between aren't kept. A cycle decided by a type parameter is recorded with
  its holder's type and the types its value reaches the holder through. So an instantiation that
  makes it impossible, such as one whose value type reaches nothing, drops it. A call's cycle is
  the object written into, of its own type, not the callee's parameter.

- After a `suspend`, the reach among *escaped* values is closed under the declaration graph.
  Fresh values stay precise.
- **An unknown call** reaches only what it is given, the globals, what the body handed unseen code
  before, and what those reach. It relies on each input it doesn't reach sharing nothing with each
  it does. The body's callers see to that, through a `share` requirement on each such pair of
  inputs, or of their parts as §5.7 paths them. A closure's callers are themselves unseen, so in a
  closure's body an unknown call reaches everything escaped.
- A requirement that was discharged at a call holds only until the callee's first `suspend` or
  unknown call. After that, a write checks its escaped sides against the declaration graph and is
  reported in the callee.
- **Escaping closures and runtime-run code** are called with arguments the body doesn't see. So
  their requirements are discharged where they are made, against the declaration graph, with each
  parameter taken as any value of its type:
  - a closure, when it is made;
  - a `dispose`, at its declaration, for `self`.

This is the only place types stand in for flow, and only for escaped values.

- **A value the IR leaves untyped** (a pattern's step, a cursor's step, a spread's item) is any
  value: it may reach a disposable, and anything at all.
- **The declaration graph is asked twice:** with type parameters holding anything, whether a cycle
  is possible, and with them holding nothing, whether it is sure. A cycle only a type parameter's
  instantiation could close is decided by that instantiation, as any `depends` one is.

### 5.6 What closures capture: not refined

A plain function value may hold anything in the declaration graph, so a write after a `suspend`
that involves an escaped plain function is often reported. Refining "anything" into what closures
of a fitting type actually capture was planned as C4 and is not built (decided 2026-11-12): the
rule stays conservative, and a program it over-rejects has a workaround (`findings.md`, Accepted
over-rejections). FormBuilder's `run`, which awaits closures its drawing collected, is one: it
stays `it.fails` until its rewrite.

### 5.7 Fields: paths, no labels

C3 took the paths, together with §5.5's separation requirements (decided 2026-11-12). A member
of a recursive group names its inputs whole: a call within the group maps a parameter to a part
of one, so each round would name parts of parts without bound. There, an input's parts also stay
related through it: no caller is required anything of them, so nothing keeps them apart (found
by C4's review).
- **An input's parts are inputs of their own** (`self.items`, `self->_store`): a read of one is a
  path node, re-read as the same value until a write may change it. A requirement or separation on
  a part names the part, which a caller passing two fields of one value checks separately.
- **A value the body made has its parts as paths,** so a read of a field of it reaches only that
  field's value.
- **Materializing an input's path at a join** relates it to its root alone, never to its siblings.

Labels, a set of fields on each pair (`a ⇝{f} b`, Zanardini–Genaim 2014) with reads through one
field and strong updates on fields, were planned as C4 and are not built (decided 2026-11-12).
Pairs, summaries and requirements carry a label, always "any field", so they can come later
without reshaping anything. Until then relinking after unlinking (`node->next = other`) and a read
related to its parts' siblings are over-rejected (`findings.md`).

## 6. Externs

Only std natives can hold language values. A host's extern takes and gives JSON and takes nothing
by `&` (`rules/boundary/host-boundary.ts`). A native keeps a value past its call only by returning
it, by writing through `&`, or through a capability (`NativeSlots`, `NativeFutures`, `NativeWaits`,
`NativeWeakSide`, `NativeTesting`). Two annotations describe the rest.

### 6.1 Generic annotations, and annotations on types

`@Name<Types>{values}` works for any struct `Name<…>`, on extern functions and on structs. It is
general, not specific to lifetimes. Today:

| Already works | Missing |
|---|---|
| a fieldless generic `struct Holds<T>` | an annotation with type arguments: the parser takes only a name and an optional `{…}` (2017) |
| map-valued annotations on functions: `@Keeps{["x": ["x"]]}` | a bare fieldless struct value with type arguments, `Holds<Int>` (5508) |
| a field's annotation sees its struct's type parameters | a function's or a type's own annotations seeing their type parameters: the binder binds them in the module scope (4000). The checker needs no `within`: a written type's constraints come from its type parameters' declarations |
| — | annotations on struct declarations, which the checker reports as misplaced (5903) |

C2 adds all four:
- the parser takes `@Name<Types>` and `@Name<Types>{…}`;
- §3.1's bare form takes type arguments;
- a declaration's annotations are bound and checked in its type-parameter scope;
- struct and extern struct declarations take annotations, any struct's kept for tools as on fields
  and functions.

An annotation's value is still computed at compile time, once for the declaration, so its fields
never depend on those type parameters. Every instance's entry carries a field's and a function's
annotations, so those name none of them (5914); a struct declaration's, which no entry carries,
may.

### 6.2 Their home

The annotations live in a new std module, `lifetimes`, not the prelude:

```python
struct Holds<T>                        # a value of the annotated type holds what a value of T holds

struct Keeps:
  into: Map<String, Array<String>>     # a parameter's name → the parameters whose values its handle comes to hold
```

- The prelude and every std module whose externs need them import from `lifetimes`. Import cycles
  are allowed (spec §3.13), and a probe of the prelude importing a std module checks clean.
- `lifetimes` joins `std-sources.ts`'s one list.
- The toolchain reads them as well-known names, as it reads `json`'s `JsonName`.

### 6.3 `@Holds<X>` on an extern handle

```python
@Holds<T>
extern shared struct Slot<T>
@Holds<()>
extern shared struct WeakRef<T is Disposable>
@Holds<(T, Resolver<T, K>)>
extern shared struct Future<T, K in Persistence>
@Holds<(Fn<(T,), Unit, K>, Fn<(), Unit, K>)>
extern shared struct Resolver<T, K in Persistence>
```

- **It reuses `heldPartsOf`'s meaning exactly:** what a value of `X` holds. A tuple lists several
  types, and `()` holds nothing. There are no packs and no empty `<>`.
- **A future holds** its value and the resolvers registered on it: a callback's chain is held from
  its futures up (§3), as `onAwait`'s `Keeps` says. The native audit found this one missing.
- **A resolver holds** its callback, its `onCancel` callbacks, and an at-resolver's `done`: the
  callback root's direction. It doesn't hold its futures: case chains are transient (§3).
- **`Holds` names no growing instance of its own type,** as a field can't (spec §3.5): every walk
  over what values hold meets finitely many types. So a resolver's `done`, a
  `Resolver<(Int, T), K>`, isn't named: its callbacks cover it, a function value holding anything
  for the analysis (§5.1).
- **Default without it:** the type arguments, which is today's rule.
- **`heldPartsOf` reads it** (through the checker's `externHeldOf`), so it is the one home of what
  an extern holds for every reader: sendability, must-use and relevance. The data kinds still read
  every type argument (`value-kinds.ts`): a native may give back a watched argument's value, which
  code then handles.
- **Type arguments `Holds` leaves out are watched.** A native given such a handle may return any
  value of a watched type. That is how `deref` is modelled: its result may be any `T`, not
  something its argument holds.
- **Not annotated:**
  - `Fn` and a call future's call belong to the language (§5.1).
  - A `Mock` records the arguments of every call of its target while it lives. No `Holds` can name
    those arguments' types, so a mock counts as holding anything, as a plain function value does.
    Mocks live in tests only.

### 6.4 `@Keeps{…}` on an extern function

```python
@Keeps{["self": ["value"]]}
extern ista fn put<T>(self: Slot<T>, value: T) -> Future<Unit, "ista">
@Keeps{["self": ["done"]]}
extern K fn onAwait<T, K in Persistence>(self: Future<T, K>, done: Resolver<T, K>)
@Keeps{["self": ["callback"]]}
extern K fn onCancel<T, K in Persistence>(self: Resolver<T, K>, callback: Fn<(), Unit, K>)
```

- **Each entry is a write site** (§2), checked at the call: `value` must not reach `self`.
- **`onAwait` from code** passes a `done` whose root it can't know. Taking the callback direction is
  the one that persists; the case direction is transient (§3).
- **Names are checked** against the signature. The editor resolves them like key denotations
  (`lookup/key-denotations.ts`), so go-to and rename work.
- **Default without it:** a `&` parameter keeps every other parameter its type can hold, and nothing
  else is kept.
- **Results need no annotation.** A native's result reaches what its arguments hold, capped by its
  type (§5.1), plus any value of a type they watch (§6.3).
- **`resolve` keeps nothing.** Its value goes to a wait, whose resuming code binds it, or to a
  callback's call. Both are code the analysis already sees.

### 6.5 Readers of values

Natives over arrays and maps give parts of their receiver: `at`, `index`, `get`, `keys`, `values`,
`entries`, `slice`, `flat`, `_entryAt`, `_patternItem`, `_patternRest`, `pop`. The default (a
result reaches what its arguments hold) covers them with no annotation. `push` and `setIndex` keep
through `&`, which is also the default.

### 6.6 Where they may stand, and how they stay true

- **Placement:** `Holds` stands only on a std extern handle, and `Keeps` only on a std extern
  function. Elsewhere they are an error, because a host holds no language values.
- **Native audit (C3 step 0, landed):** two halves.
  - At run time (`runtime/lifetimes/native-audit.test-kit.ts`), while the std suites and the corpus
    run, each native's call is checked around it (`HeapCheck.native`): every edge it adds to what an
    argument holds, in the oracle's graph and through what the call made, must come from an argument
    its extern's `Keeps` (or the `&` default) has that argument keep. The table is the std's, read
    off the checker by extern key (`stdlib/std-externs.test-kit.ts`). A slot's waiting puts' values
    count as the slot's, since `put` keeps its value whether the slot takes it now or once served.
  - Statically (`stdlib/natives.test.ts`), every kept parameter's type must be held by the holder's
    type as its `Holds` says, or be a value made only of such parts.
  - It needs R1's edges: before them, `onAwait` added a resolver → future edge (the `on` field) that
    no `Keeps` covers.

## 7. Diagnostics

The error is reported where the cycle closes. It names the disposable, and its related locations
give the path.

| Case | Reported at |
|---|---|
| a write whose value may reach its holder | the write |
| a call whose callee's write of what it is given would close a cycle | the call (5721); related locations go down to the callee |
| a call at whose types its callee's own code closes a cycle | the call (5724); related locations go down to the callee |
| a write after a `suspend` or unknown call, where the declaration graph lets its sides reach | the write; related information names the type path |
| an escaping closure or `any` conversion whose call could close a cycle | where the closure is made or the value converted |
| `Holds` or `Keeps` misused: an unknown parameter, outside the std, on a non-handle | the annotation |

- Example message: *"`n` may already reach `tail`, so `tail->next = n` makes a cycle holding
  `Lease`, which is disposable. Hold one side through a `WeakRef`."*
- **Related locations are new.** `Diagnostic` today is `code`, `severity`, `message`, `span`, and
  the LSP publishes no `relatedInformation`. C3 adds both, and the CLI prints them. The message
  still names the path, for readers that show no related locations.
- Each site reports once. The path is found again from the IR when the report runs, since summaries
  hold no positions.
- `diagnose` never reports the checker's diagnostics for std modules. So the std must check clean,
  as `std-modules.test.ts` asserts.

## 8. Editor cost

The design follows the expansion graph's pattern (`rules/expansion/functions.ts`: `#edges`,
`#endless`, `#reports`):

- **Entries per function:** its callees and recursive group, its group's analysis, its summary,
  one table for natives, fields functions and bodies alike, compared by inputs, labels and pairs
  only, so an edit that keeps its effects stops there, and its reports, the only entry that reads
  positions. Relevance is an entry per type. A body's flow is read off its checked body, which
  checking built it for (`flowsBuiltFor`); an entry earns its place only by cutting work off.
- **What a caller reads of a callee** is its summary alone, never its body: whether a function has
  a body is read off its declaration, so an edit inside a callee's body that keeps its summary
  analyses no caller again (C4).
- **Lazy:** a module's diagnostics read only the summaries of what its functions call. The
  declaration graph is read per type, from declarations.
- **Order:** the module's check runs the constraint checks noted for it before this rule, whose
  summaries reach std bodies that walk would cross on every edit (C4).
- **Cost, measured paired against the rule off in one process** (C4, 2026-11-12):

  | | C3 | C4 |
  |---|---|---|
  | Warm edit, 2,098 lines | +6.75 ms | +2.2 to 2.9 ms |
  | Warm edit, 246 lines | +2.2 ms | +1.35 ms |
  | Cold open, 246 lines | +55 ms | +55 ms |
  | Cold open, 2,098 lines | +69 ms | +55 ms |

  Analysing what an edit changed costs about 0.3 ms. The rest is the entries' validation: each
  revision replays every entry a module's check reaches, about 1,000 of this rule's and 400 std
  ones (9,300 reads), so its cost follows how many entries there are, not what changed. The budget is 3.2 ms
  for the 2,098-line module and 2 ms for the 246-line one (decided 2026-11-12); validation that
  skips what no changed input reaches is tracker P49. A cold open analyses every std body its
  functions reach.

## 9. Runtime: counting

### 9.1 What is counted

- every disposable;
- a shared struct's cell or a `_Cell` whose Definition type entry is `counted`: the handle types
  that reach a disposable. C3 writes the flag from `reachesDisposable`, and the runtime only reads
  it;
- a composite value with a counted direct part, decided at its first hold, because natives build
  values with no instance at hand (`tour-runtime.md`, R2).

Holders are registers, heap objects' fields, and composites' parts. Every holder write goes through
one seam (R2).

### 9.2 The oracle and the shadow check

- **The oracle (R1, test-only):**
  - After each collection, it searches the counted graph for a strongly connected component that
    reaches a disposable.
  - The graph is `holdings.ts`'s held edges plus the index edges, minus case-chain edges (§3), plus
    call future → call.
  - A running execution's future gets no edge to it (decided 2026-11-12). While a call runs, it is a
    root, and what its frames hold only for that moment closes no cycle: the analysis's call reach
    is what they hold at an `await` (§5.3).
  - It stays in the test runtime for good: it is the ground truth for the analysis's soundness and
    for the IR agreeing with lowering.
- **Shadow counts (R3):** counts are kept beside tracing, and each step checks:
  - every zero is an orphan;
  - every orphan that reaches a disposable is a zero.

### 9.3 Identity off the id heap

- **Records other than executions are replaced on every change,** so a counted handle needs an
  identity that outlives a replace.
- **That identity is a serial.** It keeps creation order, which `settleOrder`, losers and
  `reachingMock` read, and serials are never reused: an object id is one since R2, the snapshot
  keeping how many were given (`objectsMade`).
- **Counts are keyed by that identity, never by value,** because values are shared by identity
  across constants, registers and restores.

### 9.4 Zeroes, order and disposal

- **A zero is confirmed at the step's end, not at the decrement,** because several paths let go
  before they hold again (`tour-runtime.md`, R3).
- **Order stays §7's:** the disposables that reach zero at one point are disposed newest first, as a
  round, holders before what they hold. A disposal's releases start the next round.
- **At zero,** a counted object leaves the heap and its indexes, and its kind's disposal runs where
  it does something.
- **Counts are rebuilt when an instance is made,** from start or restore, and never persisted.

### 9.5 Only indexes

- **The heap keeps indexes, not every object:** live paths read objects through direct references.
  Uncounted garbage goes with its last JavaScript reference.
- **A commit walks the roots once,** for both the objects it persists and the depth it checks.
- **A weak reference is kept alive by its referent,** through the `weakRefs` index.

### 9.6 Unique values in place

**Today every update of an array, map or struct copies it, and a write through `&` or a cell
rebuilds the path to the part.** `push` even copies twice (`tour-runtime.md`, Values). The runtime
copies because it can't tell whether anything else holds the old value, and value semantics require
that any other holder keep what it holds. That is why building a collection one item at a time is
quadratic (tracker P2, P8).

**Counting tells.**
- **In place:** a composite node held once (count 1), and made by this instance, is updated in
  place.
- **Copied once:** a node something else still holds (`const b = a` and then `a.push(x)`) is copied
  at its first write, and the copy holds its parts (+1 each).
- **Copying a value into another holder** costs one increment on its node, never one per handle
  inside.

**Never written in place:**
- constants (`definition.constants`, shared by every instance);
- values a restore shares with another instance or with its snapshot;
- values that derived data is keyed by (`summaries`, `#hashes`, `#tables`), unless that entry goes
  with the write.

R5 extends counting to every composite node and measures it against P2's figures.

## 10. Code the rule rejects

C3's dry run is the list that counts. Reading the code today gives:

| Where | What | Decision |
|---|---|---|
| `src/stdlib/collections/collections.ista` `WeakMap.set` | `self->entries[reference] = _Entry{value, watch}`, with `watch = _deleteOnDisposal(self, reference)`, whose call holds `self` | Done in C3, inside `collections`, leaving `WeakMap`'s type, API and conformance as they are: its entries move into a private `shared struct _Store` with an empty `dispose`, and the watch holds a `WeakRef<_Store>`. `Bus` and `_follow` already work this way (`fanout.ista`). Letting go of the map still disposes the store, its entries and their watches |
| `examples/FormBuilder/forms.ista` `Task` (built 17 times in `*.gen.ista`) | `task->running = _run(task, …)`, at lines 249 and 512 | Done in C3: `Task` declares an empty `dispose`, and `_run` holds it through a `WeakRef`. FormBuilder's `run` still fails, on closures (§5.6), until its rewrite |
| `src/stdlib/testing/testing.ista` `_disposeReceipt` | calls each receipt's `retract` while it iterates the receipts, then writes the rest back | Done in C3: it retracts once the rest is written back. Called while iterating, `retract` is unseen code that may reach the receipt, which a receipt held in the receipts always shares with (`findings.md`) |
| `test/corpus/holders/dispose.ista` `cycle()` | `b->partner = a; a->partner = b` | Done in C3: `holders/invalid-cycle.ista` |
| `src/runtime/scheduler/instance/on-cancel.test.ts`, the B76 pair and R1's "given that resolver" cases | `d2->r = r`, with `r`'s callback reading `d2`; a callback holding its own resolver | Done in C3: `holders/invalid-resolver-cycle.ista` and `holders/invalid-own-resolver.ista`; B76 closed with them |
| `src/stdlib/fanout/fanout.ista` `_publish` | put `_Link{message, retracted, next}` into `bus->_end`, then `bus->_end = next` | **accepted**: `next` and `retracted` are fresh, and `message` gives a requirement its callers discharge |

The runtime tests' own programs that declare a `shared struct` must check clean or become invalid
cases before R3 relies on them. There are 10 such files plus `callbacks.test-kit.ts`, listed in
`tour-checker.md`, Code the rule rejects.

## 11. Spec edits

- **§7 Holders:** registrations by root (§3); a call held through its future.
- **§7 Cycles:** a compile error instead of collection; `WeakRef` as the fix, with an example.
- **§7 Deterministic:** counting, with the same observable order.
- **§5:** the memory bullet as in §9.
- **§3.16:** generic annotations, annotations on struct declarations, and `lifetimes`' `Holds` and
  `Keeps` with where they stand.
- **§3.1:** the bare fieldless form with type arguments.
- **§3.8:** the `lifetimes` module in the std table.
- **§6:** the Resolvers paragraph, cancelled at its future's disposal.

## 12. Acceptance examples

These go into `test/corpus/lifetimes/`, each with the codes expected.

**Accepted:**
1. A list built in a loop: `prev = new Node{lease: open(i), next: prev}`.
2. Appending at the tail through a fresh `n`: `tail->next = n; tail = n`.
3. A reply channel: `requests.send(Ask{reply})` with a fresh `reply` inbox.
4. Spec §7's `sub->value = bus.subscribe(…)`, and its `processAll`.
5. A worker registry through weak references: `registry->workers.push(WeakRef(f))`, where the worker
   is given `registry`.
6. A recursive async fan-out whose calls hold their children's futures.
7. A generic `link<T>(a: Shared<T?>, b: T)` used with `Int`.
8. Fanout's `_publish`; `futures.first` over several futures.
9. `let f = fn: f()`, a cycle that reaches no disposable.

**Rejected:**
1. `a->next = a`, and `link(x, x)`, for a `Lease`-holding node.
2. A parent pointer: `child->parent = node`, where `node` holds `child`.
3. `s->value = worker(s)`: the call holds `s`.
4. `button->onClick = fn(): use(button)`, where `Button` holds a disposable.
5. `f.onAwait(Resolver.of(fn v: keep(f)))`.
6. `const t = s.take()` then `_ = s.put(t)`: a pending take holds its slot.
7. After an `await`, `a->x = b`, where the declarations let `b` reach `a` (reported in the callee).

## 13. Rejected alternatives

- **Syntax for regions or lifetimes in user code.** Too complex to write (the human's call).
- **A graph with one node per type**, as Nim's acyclicity check works. It rejects every recursive
  shared struct holding a disposable and every plain closure field. It survives only as §5.5's model
  of unseen code.
- **Whole-program points-to over allocation sites, solved per instantiation from the program's
  roots.** It merges a loop's objects, every inbox (all made inside `Inbox.create`), and fanout's
  links (one `Slot.create` site), which needs unchecked field annotations to undo. It isn't modular,
  so editing invalidates widely, a cold editor checks every std body reached, and errors land far
  from their cause.
- **Analysing lowered Definitions.** Whole program, per instance, only for accepted programs, and
  never in the editor.
- **Analysing syntax directly.** A third copy of where values go. Any disagreement with lowering is
  a leak. Rust moved its borrow checker to MIR for this reason.
- **Keeping tracing with a cycle collector** (Nim's ORC, CPython). That is the cost being removed.
- **Full shape analysis** (TVLA, bi-abduction). More precise than the invariant needs, and too slow
  for the budget.

## 14. Decided by the human (2026-11-12)

- The annotations are `Holds` and `Keeps`, in the std module `lifetimes`.
- `WeakMap`'s rewrite keeps its type, API and conformance (§10).
- FormBuilder gets the smallest change that checks; it is rewritten later.
- Per-field input paths and separation requirements come forward into C3 (§5.5, §5.7).
- C4 is editor performance only. Closures' captures and field labels are not built: the rule stays
  conservative, and what it over-rejects has a workaround (§5.6, §5.7, `findings.md`). FormBuilder
  stays `it.fails` until its rewrite.
- The warm edit's budget is 3.2 ms over the rule off for the 2,098-line module (§8).
- A call through `any` is checked at its dispatch site, against every type the program converts
  into it (§5.4).
- The oracle gives a running execution's future no edge to it (§9.2).

## References

- Genaim, Zanardini. *Reachability-based acyclicity analysis by abstract interpretation*. TCS 474,
  2013. arXiv:1206.2188.
- Zanardini, Genaim. *Inference of field-sensitive reachability and cyclicity*. ACM TOCL, 2014.
- Ghiya, Hendren. *Is it a tree, a DAG, or a cyclic graph?* POPL 1996.
- Calcagno, Distefano, O'Hearn, Yang. *Compositional shape analysis by means of bi-abduction*. JACM
  2011. Infer's retain-cycle check builds on it.
- Rust RFC 1211 (MIR) and RFC 2094 (NLL): flow analyses on the IR that code is generated from.
- Reinking, Xie, de Moura, Leijen. *Perceus: garbage free reference counting with reuse*. PLDI 2021:
  in-place updates of uniquely held values.
- Nim memory management: ORC and the `acyclic` annotation.
