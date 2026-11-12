---
description: code tour for the static-lifetimes checker lane (L0, L1, L2) — what L0 moves out of lowering, where the flow analysis takes its inputs from a checked body, the entry pattern that keeps it incremental, how calls are closed per instantiation, where `@Holds` annotations are checked and read, where the rule reports and how the Definition's tracked flag reaches lowering, the violators and the tests; read before starting or examining L0, L1 or L2
owner: tech-lead
status: active
applies_to: checker, parser, lowering type table, stdlib, corpus, editor diagnostics
last_verified: 2026-11-12
last_updated: 2026-11-12
tags: [lifetimes, flow-analysis, checker, tour]
---

# Static lifetimes: checker tour (L0, L1, L2)

What the code looks like where the checker lane lands, as of `67d50e5b`. The rules are in
[design.md](design.md). The units to call are in `docs/reuse/types-and-fitting.md` and
`docs/reuse/calls-and-resolution.md`. Paths are under `src/compiler/checker/` unless they say
otherwise.

Spec anchors, by heading: §3.3 Functions, §3.5 Generics, §3.6 Extern declarations, §3.7
references (`&`), §3.10 Traits (`any T`, `Awaitable`), §3.14 Function types and closures (captures,
deferred calls), §3.18 Shared structs, §6 Slots and inboxes (its **Resolvers** paragraph), §7
Lifetimes and disposal.

## Where the analysis sits

- **Precedent: endless expansion** (`rules/expansion/functions.ts`), the checker's one
  whole-program graph rule. It keeps three entries, and the analysis takes the same shape:
  - **Per function:** the edges, apart from where their calls stand, so an edit that moves a call
    cuts off (`#edges`, `equal: sameEdges`). The analysis's version is one body's constraints.
  - **The verdict** over the graph (`#endless`). The analysis's version is the solve and its
    cycles.
  - **Reports.** Only these read where the sites stand (`#report` through `sitedEdges`). The
    analysis's version is one diagnostic per disposable's creation site, or, for a site in std or a
    package, one on every own-code call leading to it. The cycle in the message starts from its
    first site in module-then-position order (design.md, The rule).
- **How a module's diagnostics are found.** They are whatever was reported by the entries its
  check read, transitively (`constructs/declarations/module-checks.ts`). `ModuleRules` names the
  program-wide units a module's check runs (`expansion`, `typeParameters`). The units are composed
  in `wiring/program/program-checker.ts` (`new Expansion(this)`). Every module's check reads the
  reports entry (design.md, The rule); `docs/arch/architecture.md` and incremental-checking.md say so
  in L1.
- **Entries.** `checker.entries.table({name, compute, equal})` (`EntryTable`,
  `src/foundation/structures/entries/index.ts`; incremental-checking.md §1). The cutoff compares an
  entry's value with `equal`.
  - Name an object by its body, the ordinal of its creation site in that body, and its
    instantiation. Never name it by the node: an edit makes new nodes for the edited body, and a
    node-keyed constraint is never equal.
  - Look nodes up only in the reports.
- **The editor already publishes every open module** after each pass (`src/editor/lsp/diagnostics.ts`).
  So a cycle reported in module B appears when module A is edited.
- **Whole program, from roots.** The checker checks lazily, and nothing in it enumerates instances
  today.
  - The solve starts from the program's own modules (`checker.isStd` false): every non-generic
    function body, constant initializer (`constantBodyOf`), context constant, and parameter
    defaults (`defaultsOf`).
  - It reaches the rest through calls: std bodies are analysed as they are reached, and a generic
    body is analysed once per instantiation reached.
  - Reaching a body forces its check. A cold editor therefore pays to check every std body the
    program reaches: L1 measures the first diagnostics after a cold open (plan). `edit.bench.ts`
    times only warm edits, and L1 adds one that changes a body's constraints.

## What a checked body gives (L1's inputs)

`CheckedBody` (`surface/checked-body.ts`) holds every fact lowering reads, so the analysis reads the
same facts and re-derives nothing. `instantiated(substitution, checker)` is the body as one
instantiation reads it.

| Construct | Facts | Object or flow |
|---|---|---|
| `new S{…}` (`NewStructLiteral`) | `sourcesOf` (each field's value, spread or default call), `literalFieldsOf`, `typeOf` | object; its fields are construction holds |
| struct, tuple, array and map literals, comprehensions | `sourcesOf`, `collectionFormOf`, `builtLiteralOf` | no object: their parts flow on |
| lambda, local `fn` | `functionOf(node)`: `CheckedFunction.captures` (entity and type), `parameters`, `result` | object; captures are construction holds |
| captured `let` | `inCell(name)`, which is true for a `let` a closure captures and for a variable passed by `&` | a cell object only when captured: a `&` reference is never stored |
| call | `resolved`; `madeCalls()`, which adds implicit calls (`implicitCallOf`: `iterate`, `onAwait`), field defaults and functions named as values; `FunctionCall.{function, typeArguments, witnesses, binding}`; `argumentsInOrder`, `parameterOfArgument` | parameters ← arguments, result ← returns |
| requirement call | `RequirementCall`: `constraint` on a type parameter (the instance's witness), `constraint` on an `AnyType` (dispatch on the receiver's objects), `members`, `computed` | callees as resolved |
| call of a function value | `valueCalls` (`ValueCallMade.binding`) | callees are the lambdas and functions in the callee's set |
| async call | `checker.resultOf`; the head is made by `headResult`/`madeAsync` (`types/type/function-types.ts`) | a future object holding callee and arguments |
| deferred call (`f(x)` given as a function, `spawn f(x)`) | a `DeferredCall` site in `resolved`; `deferredFunctionOf`; `constructs/expressions/deferred-calls.ts` | an object holding callee and arguments |
| assignment | `assignedOf` (`target`, `path`, `type`, `fit`): `a->f = v`, a captured `let`, `a[i] = v` through `setIndex` | mutation of the target's owner |
| reads | `fieldReadOf`, `chainOf`, `Dereference`, `targetsOf` (destructuring), `patternOf` (match bindings), `iterationOf` | flow out of a place |
| conversion | `fitAt(site)`; `{kind: 'any', to}` | an `any T` value is its object |
| `await`, `select` | the `onAwait` implicit call, with the wait's resolver (`constructs/expressions/control/await.ts`) | the case resolver is a flow node, never an object: what is resolved into it flows to the `await`'s result or the case's binding; holds to or from it, and from at-resolvers deciding it, are dropped (design.md, case chain) |
| field loops, dead branches | `passesOf(header)` gives each pass's body view; `isRuledOut(block)` | read every pass; skip ruled-out branches |

Kinds of node are in `src/compiler/syntax/expressions/index.ts` and `syntax/statements/index.ts`.

## Closing calls per instantiation (L0)

- **The logic exists only in lowering:**
  - `lowering/calls/closed-calls.ts` (`Closer`) substitutes the instance's type arguments, turns a
    requirement into the instance's witness, and takes a computed type's witness;
  - `lowering/synthesized/trait-objects.ts` dispatches on an `any` value's own type. The `Dispatch`
    comment in `closed-calls.ts` still names `../trait-objects/`.
- **The checker can't import lowering** (`compiler/checker`'s layer in `.dependency-cruiser.mjs`
  excludes it), and a second closer would break DRY. So L0 moves the part both need into the
  checker's surface, and lowering reads it there, with no behaviour change: every program checks,
  lowers and runs as before.
- **Queries already on the surface:**
  - `callsMadeWith`, `functionCallsWithin`, `witnessCallsOf` and `instantiatingTypesOf`
    (`surface/resolved-call.ts`);
  - `checker.traitObjects`, which gives how an `any` value is called, at the instantiation the
    value's own type meets the trait (`resolution/conformance/met-instantiations/`).
- **What lowering keys an instance by** (`lowering/tables/instances.ts`): the declaration and its
  type arguments. Witnesses are coherent, so the types decide them. A lambda is keyed by its owner's
  instance plus its node. The analysis keys its instances the same way.

## Calls the program never writes

The runtime makes these calls, so the solve adds them (design.md, Flow):

| Call | When | Unit |
|---|---|---|
| `dispose` | on each disposable object, at zero | `disposalOf`, `disposeCandidates` (`rules/disposal/disposal.ts`) |
| a `Resolver.of` callback | with each resolved value | from its `Resolver.of` object |
| an `onCancel` callback | once its resolver is cancelled | from the object it was registered on |
| field defaults and implicit `iterate`/`onAwait` | — | already in `madeCalls()` |

## Objects, disposables, handles

- **Handles** are `isHandleType`/`isHandleDeclaration` (`types/properties/handles.ts`): shared structs
  and `extern shared struct`s (`Slot`, `Future`, `Resolver`, `_Cell`, `WeakRef`, `_Call`, `Mock`). A
  plain `extern struct` (`Array`, `Map`, `Fn`) is a value.
- **Disposable** is `isDisposable` (`rules/disposal/disposal.ts`), memoized in
  `wiring/program/program-disposals.ts`. It covers a nominal type with a `dispose`, a parameter, or
  an `any` whose constraints require one. Host resources are disposable values (`extern struct`
  with a `dispose`, spec §3.6).
- **Pruning by declared type:** `isSendable` (`types/traits/sendable.ts`). A sendable value reaches no
  disposable, and `isSendableFunction` (`types/type/function-types.ts`) covers `spawn` bodies. The
  memoized kinds are in `wiring/program/program-kinds.ts`.

## `@Holds` (L1)

- **Annotations today** (`rules/annotations.ts`, `Annotations`):
  - an annotation is a struct value with `@`, attached to any `Annotatable` item: declarations,
    fields and statements (`syntax/items.ts`);
  - its value is checked as a body of its own in its module (`bodyOf`, `#value`) and computed as a
    top-level constant (`checker/rules/computation/`). So the annotated declaration's type parameters
    are not in scope. `@Holds`'s type arguments may name the function's and its type's type
    parameters (`@Holds<T>` on `extern fn push<T>`), so L1 checks an annotation on a generic
    declaration in that declaration's type-parameter scope;
  - where each one may stand is the `placements` table (`Record<Known | 'any', …>`). `Holds` joins
    it: on an extern function and on a field;
  - known annotations are well-known names (`src/foundation/language/well-known/index.ts`, as
    `waypoint: {module: 'prelude', name: 'Waypoint'}`), read with `knownOf`, `ofField`, `fieldHas`;
  - the analysis reads the annotation's type arguments (`CheckedAnnotation.type`), not its value:
    `Holds<...A>` has no fields. On an extern function it picks the arguments whose *declared*
    parameter type is one of `A`, read from the signature (`checker.parametersOf`), not from what a
    call passes.
- **Trap:** a struct with an annotated field no longer fits a shape (§3.1, "Nominal to shape").
- **Std's declarations** (design.md, `@Holds`), by `src/stdlib/**/*.ista`:

  | Extern | `@Holds` |
  |---|---|
  | `push`, `setIndex` (`self: &Array<T>`, `&Map<K, V>`) | the item or value: the `&` place's owner holds it |
  | `Slot.put` | `value`: the slot holds it |
  | `onAwait(self: Future, done)` | `done`: the future holds it (mutation) |
  | `onCancel(self, callback)` | `callback`: the resolver holds it (mutation) |
  | `Resolver.of(callback)`, `Resolver.at(done, …)` | `callback` or `done`: the result holds it (construction) |
  | everything else, `WeakRef`'s, `Instance`'s and `_Call`'s included | none |

- **Rules, not `@Holds`** (design.md, Holds and Flow):
  - **An extern call's future** holds its callee, receiver and arguments, as any call's future does:
    `put`'s future holds the slot and value, `take`'s and `read`'s the slot.
  - **A mock** (`_mock` in `testing.ista`, `scheduler/testing/mocks.ts` at run time) holds the
    arguments of every call through its function. While a mock lives, every call to its `target`
    runs its `replacement` and is recorded, so in the solve the mock holds the arguments of every
    call of the functions in `target`'s set, and its `replacement` is among their callees.
  - **What an extern yields** is apart from what it holds. Whatever is given to an extern object, to
    the call that made it, or through a mock's function is that object's content. An extern's result,
    and what a future it returns resolves with, may be any content of the objects among its
    arguments, or anything a content reaches, that fits the declared result type. That gives
    `WeakRef.deref` its referent although a `WeakRef` holds nothing, `take` and `read` the slot's
    contents, and `_calls` a mock's recorded arguments.
  - Readers over value containers (`at`, `index`, `get`, `values`, `entries`, `slice`, `flat`,
    `_patternItem`, `_patternRest`, `pop`) give parts of their receiver value. `delete` and
    `reverse` store nothing new.
  - `spawn`, `_isolated` and `spawnCrashingEveryAwait` take sendable functions, so they are pruned.
- **On a field** (design.md, `@Holds`):
  - any code may write it: std, packages and programs;
  - it is the language's one unchecked declaration. A wrong one hides a real cycle, whose disposable
    is then never disposed;
  - each std one has a release test (L2).
- **Fanout's field** (L2): `_Link.next` in `src/stdlib/fanout/fanout.ista` takes `@Holds`.
  - `_publish` puts `_Link{message, retracted, next}` into `bus->_end`, where `next` comes from the
    same `Slot.create` site (line 46). Without the annotation, the abstract slot holds itself through
    a mutation.
  - Its release test: the chain behind the slowest subscriber is let go of. A subscriber's call
    (`_follow`) walks it with `read`, from its `start` slot, and reaches the bus only through a
    `WeakRef<Bus<M>>`.

## The rule and its reports (L2)

- **Cycles and reach.** Strongly connected components over the solved graph, after `@Holds` fields
  replace what their places hold. A component counts
  when one of its mutation edges lies inside it, and each disposable it reaches is reported.
  `rules/expansion/edges.ts` (`endlessEdgesFrom`) is the checker's cycle search on a call graph.
  Reuse it only if its shape fits. Otherwise the new SCC pass is the second graph walk, kept beside
  it in `rules/`.
- **Diagnostics.**
  - `diagnostics/lifetimes.ts` holds block 5700–5799, and 5712 is the next free code.
  - `Diagnostic` (`src/foundation/diagnostics/diagnostic.ts`) is `code`, `severity`, `message`,
    `span`, with no related locations, so the cycle goes in the message.
  - Report through `checker.report(module, …)` from inside an entry.
- **The `tracked` flag.**
  - Lowering builds type entries in `src/compiler/lowering/tables/type-table.ts`, taking `disposal`
    from `checker.disposalOf`, and `tracked` goes the same way through the public `Checker`
    (`check.ts`).
  - The schema is `external` in `src/definition/tables/types.ts`. Shared structs are `extern`
    entries with role `shared`, cells have role `cell`, and there is one entry per instantiation.
  - Hand-written Definitions (`test/definitions/`, `fixture-kit.ts`) build entries too.
  - The format has one version (`src/definition/formats/format.ts`); greenfield, so no bump.
  - Document the flag in `docs/arch/definition.md`, "Types and locations".

## Code the rule rejects

| Where | What | Lane |
|---|---|---|
| `src/stdlib/collections/collections.ista` `WeakMap` | map → entry → watch future → `_deleteOnDisposal(map, …)` | V: rewrite, behaviour kept |
| `examples/FormBuilder/forms.ista` `Task` (+ `*.gen.ista`, `catalog/`) | `task->running = _run(task, …)` | V: rewrite; `Prop` and the views as the dry run finds them |
| `src/stdlib/fanout/fanout.ista` `_publish` | one `Slot.create` site makes every link's `next` | L2: `@Holds` on `_Link.next` |
| `test/corpus/holders/dispose.ista` `cycle()` | `b->partner = a; a->partner = b` | L2: an invalid case |
| `src/runtime/scheduler/instance/on-cancel.test.ts` B76 pair | `d2->r = r`, with `r`'s callback reading `d2` | L2: an invalid case |

`Deferred`, `Revertible`, `Mock`, `Inbox`, `Runtime` and spec §7's `Shared` example broke only the old
type rule. L1's dry run is the list that counts.

- **V runs beside L0 and L1.** Whichever of V and L1 merges last checks that the dry run reports
  neither rewrite.
- **V puts its rewrite to the human** when it changes a std signature or conformance: a type that
  becomes Disposable is must-use at every caller.

## Tests

- **Invalid programs.** A corpus case's header is `# error: <code> at <line>:<column>` lines
  (`test/corpus/programs.ts`). See `test/corpus/holders/invalid-*.ista`.
- **Checker units:** `check.test-kit.ts`; `rules/expansion/functions.test.ts`, the precedent for a
  graph rule's tests.
- **"Checks as before":**
  - the checker's sweeps: `order.sweep.test.ts` and `revisions.sweep.test.ts`, whose adoption
    check covers the new entries;
  - `test/examples.test.ts`;
  - the spec's fences (`test/corpus/spec-examples.ts`);
  - the std suites (`*.test.ista`, `npm run test:std`);
  - the corpus runners (`wake.sweep.test.ts`, `resident.sweep.test.ts`,
    `cli/commands/run.sweep.test.ts`).
- **Runtime tests' programs:** 13 runtime test files declare shared structs (tour-runtime.md, Tests).
- **L2's release test for fanout** sits in `src/stdlib/fanout/fanout.test.ista`.
- **L1's dry run** runs the rule, reporting nothing, over the program sets the suites already
  build: std (`npm run test:std`), `test/examples.test.ts`, the corpus (`test/corpus/programs.ts`),
  the spec's fences (`test/corpus/spec-examples.ts`) and runtime tests' programs. Its report lists
  every rejection with its cause, and settles precision before L2 forks.
- **Performance:** `src/editor/language-service/edit.bench.ts` (`npm run bench`). Its budget is
  5 ms for 246 lines and 15 ms for 2,098, measured warm. A cold open's first diagnostics are timed
  through the workspace (`src/editor/language-service/workspace.ts`).
- Iterate on the affected tests alone, and run the whole suite once at the end.
