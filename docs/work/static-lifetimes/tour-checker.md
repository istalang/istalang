---
description: checker-lane code tour for static lifetimes — what a checked body gives the flow IR, the IR and its builder, where witness closing lives, diagnostics and the related locations C3 adds, how annotations are parsed, bound, placed and checked, and what C2 landed, where the analysis plugs in and what it reads, the counted flag's path into the Definition, the code the rule rejects, the editor's benches and the tests; read before planning, implementing or examining C1, C2, C3, C4 or C5
owner: tech-lead
status: active
applies_to: checker, binder, parser, lowering, stdlib, corpus, editor diagnostics, cli report
last_verified: 2026-11-12
last_updated: 2026-11-12
tags: [lifetimes, flow-analysis, checker, annotations, tour]
---

# Static lifetimes: checker tour

Read against `main` at `41160c33`, and the sections marked landed against their phase's merge. The
rules are in [design.md](design.md) and the phases in [plan.md](plan.md). The units to call are in
`docs/reuse/types-and-fitting.md` and `docs/reuse/calls-and-resolution.md`. Paths are under
`src/compiler/checker/` unless they say otherwise.

**Spec anchors, by heading:**
- §3.1 Structs (the bare form);
- §3.3 Functions;
- §3.5 Generics;
- §3.6 Extern declarations;
- §3.7 references (`&`);
- §3.10 Traits (`any T`, `Awaitable`);
- §3.13 Modules (import cycles are allowed);
- §3.14 Function types and closures (captures, deferred calls);
- §3.16 Annotations;
- §3.18 Shared structs;
- §6 Slots and inboxes (its **Resolvers** paragraph);
- §7 Lifetimes and disposal.

## Where the analysis sits (C3)

- **Precedent: the expansion graph** (`rules/expansion/functions.ts`). It keeps three entries, and
  the analysis takes the same shape:
  - **`#edges`**, per function: its edges apart from where their calls stand (`sitedEdges`, then
    `site` dropped), compared by `sameEdges`. An edit that moves a call cuts off. The analysis's
    version is a function's summary.
  - **`#endless`**, per module: the verdict over what the module's edges reach.
  - **`#reports`**, computed by `#report`: the only entry that keeps the sites. The analysis's
    version is a function's reports.
- **Graph utilities:**
  - `rules/expansion/edges.ts` serves three graph users: calls (`functions.ts`), fields
    (`types.ts`) and type `match`es (`type-matches.ts`). Its nodes are type parameters.
  - `endlessEdgesFrom` is `edgesReachedFrom` (`src/foundation/structures/reachable.ts`) plus
    `stronglyConnected` (`src/foundation/structures/strongly-connected.ts`, iterative Tarjan).
  - `stronglyConnected` is also used by `types/variance/variance.ts` and
    `src/runtime/lifetimes/orphans.ts`. Recursive groups of summaries reuse it.
- **How a module's diagnostics are found.** They are whatever was reported by the entries its check
  read, transitively (`constructs/declarations/module-checks.ts`).
  - `ModuleRules` names the program-wide units a module's check runs (`expansion`,
    `typeParameters`).
  - The units are composed in `wiring/program/program-checker.ts` (`new Expansion(this)`).
  - The analysis joins `ModuleRules` the same way.
- **Entries:** `checker.entries.table({name, compute, equal})` (`EntryTable`,
  `src/foundation/structures/entries/index.ts`; `docs/work/m6-m7/incremental-checking.md` §1). The
  cutoff compares an entry's value with `equal`.
  - Name everything by its body and its position in that body's IR, never by the syntax node: an
    edit makes new nodes for the edited body, and a node-keyed value is never equal.
  - Look nodes up only in the reports.
  - Report through `checker.report(module, …)` from inside an entry.
- **The editor publishes every open module** after each pass (`src/editor/lsp/diagnostics.ts`). So
  a report in module B appears when module A is edited.
- **The std's diagnostics are never shown to users:** `diagnose` skips the checker's diagnostics for
  std modules (`src/compiler/compile.ts`). Std must check clean, which only
  `src/stdlib/std-modules.test.ts` asserts.

## What a checked body gives (the IR's inputs)

`CheckedBody` (`surface/checked-body.ts`) holds every fact lowering reads, so the IR reads the same
facts and derives nothing again. Calls come as checked, not substituted.
`instantiated(substitution, checker)` returns `resolved`, `valueCalls`, `madeCalls`,
`implicitCallOf` and `sourcesOf` as checked (`asChecked` in `wiring/body/facts/index.ts`). That
suits a generic IR.

| Construct | Facts | IR |
|---|---|---|
| `new S{…}` (`NewStructLiteral`) | `sourcesOf` (each field's value, spread, or default call), `literalFieldsOf`, `typeOf` | `make` of a cell |
| struct, tuple, array and map literals, comprehensions | `sourcesOf`, `collectionFormOf`, `builtLiteralOf`; a map literal's entries through the implicit `insert` | `make` of a value; comprehensions as loops |
| lambda, local `fn` | `functionOf(node)`: `CheckedFunction.captures` (entity and type), `parameters`, `result` | `make` of a closure from its cells and copied `const`s; its body is an IR of its own |
| captured `let` | `inCell(name)`, true for a `let` a closure captures and for a variable passed by `&` | a cell only when captured; a `&` reference is never stored |
| call | `resolved`; `madeCalls()`, which adds the implicit calls, field defaults and functions named as values; `FunctionCall.{function, typeArguments, witnesses, binding}`; `argumentsInOrder`, `parameterOfArgument` | `call` |
| implicit calls | `implicitCallOf`, `ImplicitRole` (`surface/resolved-call.ts`): `iterate`, `onAwait`, `inclusiveEnd`, `compare`, `includes`, `length`, `item`, `rest`, `panic`, `write` (`a[i] = v` through `setIndex`), `default`, `insert`, `interpolate`, `join`, `encodeOutcome` | `call`, with `&` places for `write` |
| requirement call | `RequirementCall`: `constraint` on a type parameter, `constraint` on an `AnyType` (dispatch on the receiver), `members`, `computed` | `call`; on a type parameter, code the body doesn't see (design.md §5.4) |
| call of a function value | `valueCalls` (`ValueCallMade.binding`) | `callValue` |
| async call | `checker.resultOf`; the head comes from `headResult`/`madeAsync` (`types/type/function-types.ts`) | `call` whose result is a call future |
| deferred call (`f(x)` given as a function, `spawn f(x)`) | a `DeferredCall` site in `resolved`; `deferredFunctionOf`; `constructs/expressions/deferred-calls.ts` | `make` of a closure holding the callee and arguments |
| assignment | `assignedOf` (`target`, `path`, `type`, `fit`): `a->f = v`, a captured `let` | `write`, or `copy` for a local |
| reads | `fieldReadOf`, `chainOf`, `Dereference`, `targetsOf` (destructuring), `patternOf` (match bindings), `iterationOf` | `read` |
| conversion | `fitAt(site).conversion`; `{kind: 'any', to}` puts a value into an `any T` | `copy`; into `any`, where the bundle's requirements are discharged |
| `await`, `select` | the implicit `onAwait`, with the wait's resolver (`constructs/expressions/control/await.ts`) | `suspend`: the awaiting call holds what each case awaits; the case resolver is no object (design.md §3) |
| field loops, dead branches | `passesOf(header)` gives each pass's body view; `isRuledOut(block)` | each pass as its own path; ruled-out blocks left out |

The node kinds are in `src/compiler/syntax/expressions/index.ts` and `syntax/statements/index.ts`.

## The flow IR (C1, landed)

- **The model** is `rules/flow/flow-ir.ts`: per function (`FlowFunction`), its values (a variable
  the body declares, a global, or a temporary of a node), its parameters, captures and own name
  (`self`, a local `fn`'s or named lambda's closure), and blocks of operations ending in an `Exit`
  (`goto`, `branch`, `return`, `stop`). A closure's function is held by its `make`. `suspend`
  waits on futures; what one gave is a `read` of its `given` part.
  - A use of a variable is a `copy` out of it at its name; a place (`Place`: a root value and
    `Part`s) passed by `&` or written names its root's variable. Any operation writing `into` a
    variable declares or assigns it.
  - Releases (`build/scopes.ts`): a scope's variables at its end and on every path leaving it
    early (an exit, a failing guard, a condition's false path); an `if` branch, a loop's pass and
    a case are scopes their header binds into. A `hold(name)`'s at the end of the scope it names,
    however it ends. `drop` is a `release` of reason `drop`. A target with no name keeps the value
    as a temporary of its scope. A `return` releases everything; a temporary ends with its
    statement and an assignment ends what its variable held, with no operation.
  - `unknown` is code checking found a mistake in: its operands run, its value is unknown.
- **The builder** is `rules/flow/build/`: `flowOf(inputs, root, parameters)`, memoized on the
  `CheckedBody`, reading only the body's facts, `bindings`, `parametersOf` and, through
  `FlowInputs.localBodyOf`, local functions' bodies, which the tree holds apart. `index.ts` builds every expression alike: a `Never` operand stops the path
  (`stopsAt`), the outermost link of an optional chain opens it (`chains.ts`), its value is a
  temporary of its node, and a fitted value is copied into one of the expected type with its
  `Fit`. `expressionFlows` and `statementFlows` are exhaustive by kind; the rest is per construct
  (`calls.ts`, `places.ts`, `parts.ts`, `literals.ts`, `loops.ts`, `control.ts`).
  - Calls follow lowering: arguments in the order written, a `&` argument or `&self` receiver a
    place, an element reached through `index` and written back with the implicit `write`; a value
    call's arguments in its parameters' order (`ValueCallMade.binding`); a deferred call computes
    now by value and makes a closure of a function making the call later. A chain's step target is
    fitted after `?.` unwraps it (`stepTarget`). A struct literal evaluates its items in the order
    written, then takes its fields in declaration order (`sourcesOf`), a default computed by a
    call of its fields function on the fields before it, and makes the struct, a handle for `new`.
  - A field loop is a loop whose each pass may follow any, read in that pass's view (`inView`).
  - Decided conditions (`decidedOf`) and ruled-out bodies (`isRuledOut`) shape the graph; code no
    path reaches is kept in blocks nothing jumps to.
- **Rules:** `rules/flow/solve.ts` `runForward` runs a forward rule to a fixed point.
  `rules/disposal/dropped.ts` is the first, run once a body is checked (`BodyChecker.#finished`).
- **Coverage:** `rules/flow/flow.sweep.test.ts` checks, over every body of the corpus and the
  spec's fences (functions', defaults', fields functions', constants'), that each typed expression
  has a value at its node or is part of a place, that each made call is an IR call (but an
  element's unread `index` and a wildcard's array reads), and that a program checking accepts has
  no `unknown` operation.
- **`data-kinds.ts` stays a tree walk** (decided 2026-11-12): it reports the first refused value
  in a function's text, an order the IR doesn't keep, across segments of a local `fn`'s body.
- **`iterationOf`** answers undefined for an iteration never checked; lowering asserts it
  (`lowering/constructs/loops/iteration.ts` `iterationFormOf`).
- **Cost:** on 2026-11-12 the IR and `dropped` took 1.1% of `profile:check`'s fb-warm and 2.4% of
  decimal16 (the old walker 0.6% and 1.2%); the warm edit stayed within noise. C3 adds to this.

## Witness closing (C1, landed)

- **The algorithm is on the checker's surface** (`surface/witness-closing.ts`), and lowering reads
  it there.
  - `Closer = Pick<Checker, 'typeRules' | 'traitObjects'>`; `Closing` is a substitution plus the
    witnesses an instance was given; `closingIn(instance)` builds one from a `FunctionInstance`
    (declaration, type arguments, witnesses).
  - `closedInside(resolved, closing, closer)`: a `constraint` requirement on a type parameter takes
    `closing.witnesses.get(on)?.[constraint]?.[member]`, closed again inside the required
    function's instance, its binding composed with the call's. A `computed` requirement asks
    `traitObjects.memberWitnesses(through, 0, on)[member]` once `on` isn't opaque. A requirement on
    an `any` value, on a union's trait, or on another function's type parameters stays open.
  - `closedFunctionCall` closes a `FunctionCall` into the `FunctionInstance` it runs.
- **What stays in lowering** (`lowering/calls/closed-calls.ts`): what a closed call targets, an
  entry or a `Dispatch` (`closeCall`, `closeCallWithin`, which adds the field loops' keys to the
  substitution), `leavesOut`, and the readers of a closed call's types.
- **What a call records:** `FunctionCall.witnesses` is a
  `ReadonlyMap<TypeParameter, readonly (readonly ResolvedCall[])[]>`: per callee type parameter, per
  constraint, per required function in the trait's order, the call it resolves to. It is set by
  `instantiate` (`resolution/conformance/conformance.ts`) and `callMade`
  (`resolution/choosing/calls-made.ts`). Inside a generic caller, these are `RequirementCall`s on
  the caller's own type parameters, so they stay open. C3 closes a callee's summary at a call site
  with `closingIn(instanceOf(call))`.
- **Instance keys** (`lowering/tables/instances.ts`): the declaration and its type arguments, since
  witnesses are coherent and the types decide them. A lambda is keyed by its owner's instance plus
  its node.

## Diagnostics (C3)

- **`Diagnostic<Where, Module>`** (`src/foundation/diagnostics/diagnostic.ts`) is `code`,
  `severity`, `message`, `span` and `related`: each a `message`, the `module` it stands in and a
  `span` there. `Module` defaults to `never`, so every catalog's diagnostic has none; a reader of
  any takes `Diagnostic<Span, string>`.
  - The checker's notes and `checker.report` take `Diagnostic<AnchoredSpan, ModuleId>`; a report
    with related locations is `{ ...catalog.code(at, …), related: [{ module, span, message }] }`.
  - `diagnosticIn(tree, diagnostic, treeOf)` (`syntax/tree/positions.ts`) places each related span
    in its own module's tree; `ModuleChecks.diagnosticsOf` passes the program's.
- **The LSP** sends them as `relatedInformation`, each at its module's URI
  (`src/editor/lsp/diagnostics.ts`).
- **The CLI** prints each as a `note:` excerpt after its diagnostic (`renderDiagnostic`, and
  `renderDiagnostics` over every diagnosed module, `src/foundation/diagnostics/render.ts`).
- **Codes:** `diagnostics/lifetimes.ts` holds block 5700–5799, and 5712 is the next free code.
  The cycles are 5720–5724 (`cycleTemplates`: a write, a call, an escaping function, a witness,
  a cycle a callee makes at a call's types),
  apart so that tests running cyclic programs can let them through (`lifetimes.test-kit.ts`
  `isCycle`). `rules/lifetimes/reports.ts` makes each finding a diagnostic, a call's or a
  witness's with the callee as a related location. `ModuleChecks` runs `checker.lifetimes.check`
  per module, which reports through the `lifetime reports` entry. `checker.lifetimes` is built
  with the checker, never lazily, since an edit's checker replays entries by table name.
  5700 is `disposeType`: a `dispose` on anything but a confined handle (`isOwnedHandle`,
  `rules/disposal/disposal.ts`). The weak side is 5800–5899.

## Annotations (C2, landed)

- **Syntax** (`parser/layout/annotations.ts`): an annotation is a possibly qualified struct name,
  with type arguments or not, bare or followed by `{…}`: `@Holds<T>` parses as a `TypeApplication`,
  `@Keeps<A>{…}` as a `StructLiteral` whose `NamedType` has arguments. Anything else, a call
  included, is 2017. A function's annotation stands on its own line before it; a field's may follow
  it on the same line. A module item's annotations attach in
  `parser/grammar/declarations/declaration.ts`.
- **Values:**
  - A fieldless generic struct named with type arguments is its value of that instance (§3.1):
    `constructs/closures/function-values.ts` `checkAppliedFunction`, after the functions the name
    may name; compile time computes it (`rules/computation/index.ts` `#bareStruct`), and lowering
    makes it (`lowering/constructs/expressions/access/names.ts` `lowerApplied`).
  - `Holds<T>{}` on a fieldless struct is still 5206; a struct can't take a pack (5081), so `Holds`
    takes one tuple type. Map-valued annotations, `@Keeps{["x": ["x"]]}`, work as any value.
- **Scope** (`binder/constructs/declarations.ts`): a generic declaration (`isGenericDeclaration`,
  `syntax/declarations/index.ts`) binds its annotations right after defining its type parameters
  (`bindFunction` before its parameters, `typeParameterScope`, `bindTrait`); `bindDeclaration` and
  `bindBlock` bind any other's in the scope around it. So `@Holds<U>` on `fn f<U>` names `U`, and
  nothing a function declares after its type parameters; a local function's see its own name, as a
  top-level one's do. A field's annotations see its struct's. The checker needed no `within`: a
  written type's constraints come from its type parameters' declarations, so `@Tag<U>` with
  `Tag<T is Encodable>` is 5101 unless `U is Encodable`.
- **Parsing them on an item's line:** a `<` after an annotation's name is always type arguments
  (`Parser.typeApplication`, `parseCommittedTypeApplication` in
  `parser/grammar/expressions/postfix.ts`), so `@Tag<Int> fn f(): 1` reads.
- **Lowered values:** every instance's entry carries a function's and a field's annotations, which
  are computed once, so those name none of their declaration's type parameters (5914, through the
  types their values are built of, `typesIn` in `surface/constant-form.ts`;
  `test/corpus/boundary/invalid-generic-annotations.ista`). A struct declaration's annotations,
  which no entry carries, may (`@Holds<T>`). So lowering reads annotations as before, and no
  instance check reads them.
- **A fieldless struct named with type arguments in code,** `Tag<D>`, is among a generic body's or
  field default's reduction requirements (`madeBare` in
  `resolution/type-matches/reduction-requirements.ts`), and postpones as a bare variant does
  (`bareStructAccepts` in `constructs/expressions/access/names.ts`).
- **Placement** (`rules/annotations.ts` `placements`, `Record<Known | 'any', …>`):
  - Places (`surface/checked-annotation.ts` `AnnotationPlace`): field; function, extern or not
    (`functionPlace`); struct, extern or not (shared included); statement; other, named.
  - `any` stands on fields, functions and struct declarations, kept for tools. Enums, aliases,
    traits, associated types and imports stay `other` (5903). A field's or a function's names no
    type parameter (5914).
  - `holds` stands on a struct place, `keeps` on a function place, each 5903 elsewhere; on a
    non-extern or outside the std (`checker.isStd(module)`), 5750 and 5751.
- **Known annotations** are well-known names (`src/foundation/language/well-known/index.ts`:
  `holds`, `keeps` beside `waypoint` and `json`'s), read with `knownOf`, `ofField` and `fieldHas`.
  An annotation's type arguments are on `CheckedAnnotation.type` (`surface/checked-annotation.ts`).
- **Trap:** a struct with an annotated field no longer fits a shape (§3.1, "Nominal to shape";
  `constructs/declarations/layout/index.ts`).
- **The `lifetimes` module** (`src/stdlib/lifetimes/lifetimes.ista`): a language module, a role
  (`languageModules.lifetimes`, `stdRoles`), so every program loads it and `wellKnownEntity` finds
  it; the prelude imports `Holds, Keeps` from it, an import cycle the binder needs no fixpoint for.
  It is not the prelude's: a program imports it to name either.
- **Reading them** (`rules/lifetimes/externs.ts`), by position, never by name:
  - `externHeldOf(type)` (on `Checker`): an extern type's `@Holds` types at its arguments, a tuple's
    elements and `()` none; its arguments without one. `heldPartsOf` reads it.
  - `keepsOf(extern)` (on `Checker`): `Kept { holder, kept }[]` by parameter position, from
    `@Keeps`, a name no parameter has keeping nothing; without one, each `&` parameter keeps every
    other. A pure query, no entry of its own.
  - `checkKeeps`, run by `checkFunction` on externs: 5752 at each String literal naming no
    parameter, or at the annotation where a constant gave the name.
  - `Holds` names no growing instance of its own type (§3.5), so `Resolver`'s doesn't name its
    `done`; nothing enforces it beyond the std's tests, since only the std writes `Holds`.
- **Parameter names as denotations:** `lookup/key-denotations.ts` `keptParameterDenotations`: a
  String literal in a function's `@Keeps` denotes the parameter it names, so go-to reaches it.
  References read the std's String literals in annotations, none in its bodies
  (`editor/language-service/navigation/references.ts`); rename refuses std declarations.
- **`heldPartsOf`'s readers, audited:**
  - `held.ts` `heldType`/`heldTypes` and `rules/disposal/must-use.ts` read `Holds`: a
    `WeakRef<Future<…>>` may be lost, where a tuple of a future must be used.
  - `types/traits/sendable.ts` reads it too; the std's `Holds` stand only on handles that stay in
    their instance, which never cross, and the one sendable handle, `Instance`, has none.
  - `types/properties/value-kinds.ts` reads every extern type argument, held or watched: a native may
    give back a watched argument's value (`deref`), which code then handles.

### What the std declares (C2, landed)

`src/stdlib/prelude/prelude.ista` unless noted:

| Declaration | Annotation |
|---|---|
| `extern shared struct Slot<T>` | `@Holds<T>` (the default, written for clarity) |
| `extern shared struct WeakRef<T is Disposable>` | `@Holds<()>`: `T` watched |
| `extern shared struct Future<T, K>` | `@Holds<(T, Resolver<T, K>)>`: its value, and the resolvers registered on it (C3 step 0); its call belongs to the language |
| `extern shared struct Resolver<T, K>` | `@Holds<(Fn<(T,), Unit, K>, Fn<(), Unit, K>)>`; an at-resolver's `done` is covered by them |
| `extern shared struct _Cell<T>` | the default, `T` |
| `extern shared struct _Call` | none: no type arguments, so it holds nothing |
| `extern shared struct Mock<F>` (`testing.ista`) | none: a mock holds anything (design.md §6.3) |
| `extern sendable struct Instance<T>`; `extern live struct Store`, `_Runtime` (`runtime.ista`) | none: sendable handles hold no handles, and live ones none of the instance's |
| `put` (method) | `@Keeps{["self": ["value"]]}` |
| `onAwait(self: Future, done)` | `@Keeps{["self": ["done"]]}` |
| `onCancel(self, callback)` | `@Keeps{["self": ["callback"]]}` |
| `push`, `setIndex` (`self: &Array<T>`, `&Map<K, V>`) | none: the `&` default |
| `Resolver.of`, `Resolver.at`, `take`, `read`, `disposed`, `_mock`, `_calls` | none: the result default |
| `deref` (method) | none: `WeakRef`'s watched `T` gives it |
| value readers (`at`, `index`, `get`, `keys`, `values`, `entries`, `slice`, `flat`, `_entryAt`, `_patternItem`, `_patternRest`, `pop`) | none: the result default |
| `spawn`, `_isolated`, `spawnCrashingEveryAwait` | none: they take sendable functions |

## What the analysis reads (C3)

- **Handles:** `isHandleType`/`isHandleDeclaration` (`types/properties/handles.ts`):
  - shared structs and `extern shared struct`s, with instance identity;
  - `extern live struct`s, with process identity;
  - `extern sendable struct`s, with global identity.

  A plain `extern struct` (`Array`, `Map`, `Fn`) is a value.
- **Disposables:** `isDisposable` (`rules/disposal/disposal.ts`) reads the memoized
  `checker.disposalOf` for a nominal type (`wiring/program/program-disposals.ts` memoizes
  `disposeCandidates`, `disposalOf`, `disposeKindsOf`). It also covers parameters, `associated` and
  `field` kinds, and an `any` whose constraints require a `dispose`.
  - A disposable host type is a confined handle (`extern shared` or `extern live struct`, spec
    §3.6), never a value.
- **Pruning by declared type:** `isSendable` (`types/traits/sendable.ts`) and `isSendableFunction`
  (`types/type/function-types.ts`), whose kinds are memoized in `wiring/program/program-kinds.ts`.
  A sendable value reaches no handle of the instance.
- **Natives (C2):** `checker.keepsOf(extern)` gives what each parameter keeps, by position, and
  `checker.externHeldOf(type)` what a handle holds one level down; the type arguments `Holds` leaves
  out are watched (design.md §6.3), so read them off the declaration's type parameters. The
  Definition carries neither: the native audit (step 0) reads `keepsOf` off a checker of every std
  module, by the extern key lowering gives (`stdlib/std-externs.test-kit.ts` `stdNativeKeeps`).
- **Calls the program never writes, which the runtime makes** (design.md §5.5):

  | Call | When | Unit |
  |---|---|---|
  | `dispose` | on each disposable, once nothing holds it | `disposalOf`, `disposeCandidates` |
  | a `Resolver.of` callback | with each resolved value | from its `Resolver.of` |
  | an `onCancel` callback | once its resolver is cancelled | from the call that registered it |
  | a `defer`'s function | through `Deferred`'s `dispose` (`prelude.ista`) | `dispose` |
  | field defaults and implicit calls | — | already in `madeCalls()` |

- **The `counted` flag's path into the Definition:**
  - Lowering builds type entries in `src/compiler/lowering/tables/type-table.ts`, taking `disposal`
    from `checker.disposalOf`. `counted` goes the same way, through the public `Checker`
    (`check.ts`).
  - The schema is `external` in `src/definition/tables/types.ts`. Shared structs are `extern`
    entries with role `shared`, cells have role `cell`, and there is one entry per instantiation.
  - **Hand-written extern type entries** gain the flag too: `test/definitions/broadcast.ts`,
    `src/runtime/lifetimes/lifetimes.test-kit.ts`, `src/definition/definition.test-kit.ts`,
    `src/definition/definition.test.ts` and `src/definition/values/json-values.test.ts`.
    `test/definitions/fixture-kit.ts` builds only function entries.
  - The format has one version (`src/definition/formats/format.ts`). It is greenfield, so there is
    no bump.
  - Document the flag in `docs/arch/definition.md`, "Types and locations".

## Code the rule rejects (C3)

| Where | What | Decision |
|---|---|---|
| `src/stdlib/collections/collections.ista` `WeakMap.set` | `self->entries[reference] = _Entry{value, watch}`, with `watch` from `_deleteOnDisposal(self, reference)`, an `ista async fn` that holds the map until the key is disposed. `WeakMap` declares no `dispose` | rewritten inside `collections`, `WeakMap`'s type, API and conformance unchanged: the entries move into a private `shared struct _Store` with an empty `dispose`, which the watch holds through a `WeakRef<_Store>` (design.md §10). `Bus` declares `ista fn dispose<M>(self: Bus<M>): ()` for the same reason |
| `examples/FormBuilder/forms.ista` `Task` | `task->running = _run(task, …)` at lines 249 and 512, where `_run` writes `task->value` and `task->done`. Tasks are built through `awaited(` and `later(` 12 times in `supplier.gen.ista` and 5 in `order.gen.ista`; `catalog/contact-card@^1.ista` builds none | `Task` declares an empty `dispose`, and `_run` holds it through a `WeakRef`. FormBuilder still fails on its `run`, `it.fails` in `test/examples.test.ts` until its rewrite (`findings.md`) |
| `src/stdlib/testing/testing.ista` `_disposeReceipt` | calls each receipt's `retract` while iterating the receipts, which unseen code then may have made reach them | it retracts once the rest is written back (`findings.md`) |
| `test/corpus/holders/dispose.ista` `cycle()` | `b->partner = a; a->partner = b` | `holders/invalid-cycle.ista` |
| `src/runtime/scheduler/instance/on-cancel.test.ts`, the B76 pair and R1's "given that resolver" cases | `d2->r = r`, with `r`'s callback reading `d2`; `watching.onCancel` capturing `watching` | `holders/invalid-resolver-cycle.ista`, `holders/invalid-own-resolver.ista` |

**Accepted with no annotation:** fanout's `_publish` (`src/stdlib/fanout/fanout.ista`):

```python
ista fn _publish<M>(bus: Bus<M>, message: M) -> Shared<Bool>:
  const retracted = new Shared<Bool>{value: false}
  const next = Slot.create<_Link<M>>()
  drop bus->_end.put(_Link{message, retracted, next})
  bus->_end = next
  retracted
```

- `retracted` and `next` are fresh, so neither reaches the slot being put into.
- `message` gives a requirement that callers discharge, by type when `M` is concrete.
- The second write's value, `next`, has had nothing written into it.

A subscriber's call (`_follow`) walks the chain with `read` and reaches the bus only through a
`WeakRef<Bus<M>>`.

**Runtime tests' programs that declare a `shared struct`:**
- `host/contexts.test.ts`;
- in `scheduler/instance/`: `awaitables.test.ts`, `callbacks.test.ts`,
  `context-constants.test.ts`, `on-cancel.test.ts`, `races.test.ts`, `waits.test.ts`, and
  `callbacks.test-kit.ts`;
- `scheduler/live-run.test.ts`;
- `scheduler/segment/end-instance.test.ts`;
- `scheduler/spawn.test.ts`.

`boundary/host-codecs.test.ts`, `boundary/host-resources.test.ts` and `testing/run-tests.test.ts`
declare only `extern shared struct`s.

## The editor's cost (C3, C4)

- **Warm edits:** `src/editor/language-service/edit.bench.ts` (`npm run bench`), 5 warmup
  iterations. The budget is 5 ms for 246 lines and 15 ms for 2,098.
- **A cold open** is timed by `edit.bench.ts` too, through `workspace.ts`: a new workspace's first
  diagnostics of each module.
- **Measure the rule paired:** skip `checker.lifetimes.check` in `module-checks.ts` behind a
  temporary environment switch read at compute time, then edit two workspaces in turn in one
  process, one with the switch on, so both run under the same load. Separate runs on a shared
  machine differ by more than the rule costs. design.md §8 has C3's and C4's figures.
- **What a warm edit costs** is mostly validation, not analysis: each revision replays every entry
  a module's check reaches. Count what is replayed and computed per table (`#takeOver` and the
  `observe` seam in `foundation/structures/entries/index.ts`) before changing anything; tracker
  P49.
- **C4 found two edges an edit kept crossing:** a caller asked whether its callee had a body
  through the callee's body input, which changes with every edit inside it (now
  `hasBody` reads the declaration), and the module's walk for noted constraint checks crossed the
  std bodies the rule's summaries reach (now run before the rule, `module-checks.ts`).
- **Per-closure entries don't pay:** lambdas aren't segments of their own
  (`parser/incremental/reuse.ts`), so an edit inside a closure makes every closure of its function
  anew; after an edit inside a callee they saved nothing measurable once callers stopped reading
  its body.
- **What closures capture and field labels** are not built (design.md §5.6, §5.7). C3 carries a
  label in pairs, summaries and requirements, always `anyField`, and `heldOfFunction`
  (`type-reach.ts`) is the seam a refinement of closures would take.

## Lowering on the IR (C5)

Lowering compiles per instance from `main` through a worklist (`lowering/lower.ts`,
`tables/tables.ts`) and reads `CheckedBody` directly (`docs/reuse/lowering-and-ir.md`). C5 makes it
read the IR for where values go: one home for that knowledge. Then C5 elides the retain/release
pairs the IR shows to be redundant.

## Tests

- **Invalid programs:** a corpus case's header is `# error: <code> at <line>:<column>` lines
  (`test/corpus/programs.ts`). See `test/corpus/holders/invalid-*.ista`.
- **Checker units:** `check.test-kit.ts`; `rules/expansion/functions.test.ts` is the precedent for a
  graph rule's tests, and `rules/lifetimes/externs.test.ts` (`reportedInStd`) for a std module's own
  diagnostics.
- **"Checks as before":**
  - the checker's sweeps: `order.sweep.test.ts`, `revisions.sweep.test.ts` (whose adoption check
    covers new entries) and `lookup/lookup.sweep.test.ts`;
  - `src/compiler/compile.sweep.test.ts` and `src/editor/lsp/diagnostics.sweep.test.ts`;
  - `test/examples.test.ts`;
  - the spec's fences (`test/corpus/spec-examples.ts`);
  - the std suites (`*.test.ista`, `npm run test:std`), and `src/stdlib/std-modules.test.ts` for the
    std's own diagnostics;
  - the corpus runners (`wake.sweep.test.ts`, `resident.sweep.test.ts`,
    `cli/commands/run.sweep.test.ts`).
- **C3's dry run** runs over the program sets the suites already build: the std, examples, the
  corpus, the spec's fences, and the runtime tests' programs.
- **Fragment soups** for C3's properties: `test/soup.ts`.
- **Commute laws** across generic → instantiated (`test/AGENTS.md`): a generic program is
  rejected whenever its instantiated copy is.
- Iterate on the affected tests alone, and run the whole suite once at the end.
