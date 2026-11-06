---
description: architectural review of generalization opportunities, type-hardcoded rules, spec generalizations, language pitfalls, plugin modularity, cross-module extractions, and prioritized refactoring plan — read before refactoring compiler or runtime internals
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-26
last_updated: 2026-10-26
tags: [review, architecture, refactoring, debt]
---

# Codebase Review & Generalization Audit

Spec: `docs/spec.md` · Architecture: `docs/arch/architecture.md` · Tracker: `docs/work/tracker.md`

---

## 1. Narrow-Scope Solutions That Should Be Extracted and Generalized

### Established Reference Patterns Already in the Codebase

- **`ValueSemantics<Value>` (`src/language/values.ts`)**: Parameterized by `ValueView<Value>` (`shapeOf`, `sameHead`, `headKey`), allowing runtime values (`src/definition/equality.ts`) and compile-time constant forms (`src/compiler/checker/constant-form.ts`) to share one implementation of `==`, structural hashing, and map-entry insertion ordering.
- **Exhaustiveness Matrix (`src/compiler/checker/patterns/exhaustiveness/exhaustiveness.ts`)**: Maranget’s usefulness algorithm is parameterized over `Signature<T>` and `Shape`, free of AST or `Checker` types.
- **Iterative Tarjan SCC (`src/structures/strongly-connected.ts`)**: Shared by the checker’s generic expansion check (`src/compiler/checker/rules/expansion.ts`) and the runtime’s cycle-aware orphan disposal (`src/runtime/lifetimes/orphans.ts`).
- **Indentation & Separator Layout Engine (`src/compiler/parser/layout.ts`)**: Parameterized by `ItemRules<Item>`, handling module top-level items, statement blocks, struct fields, enum variants, trait members, match/select cases, one-line bodies, `{…}` block expressions, and `{ a: int; b: int }` entry braces in one loop.

### Narrow Solutions to Extract and Generalize

#### 1.1 Forward Control-Flow / Dataflow Engine (`src/compiler/checker/rules/dropped.ts`)

- **Current narrow scope:** `checkDropped` implements a full forward dataflow analysis — statement sequencing, `if`/`match`/`select` branch joins, short-circuit `and`/`or`/`??`, `break`/`continue` exit queues, and fixed-point iteration over `while`/`for` loops — solely to track `ReadonlySet<VariableEntity>` for `drop x`.
- **Wider scope:** Other flow and tree checks in the checker hand-roll ad-hoc AST walks instead:
  - `checkDisposeDeclaration` (`src/compiler/checker/rules/disposal.ts`) walks `childrenOf(node)` with parent-array slicing to check whether `dispose`’s `self` escapes.
  - `statementPlace` (`src/compiler/checker/rules/annotations.ts`) walks `childrenOf(node)` to determine whether a statement suspends (`Await` or `Select`).
  - Extracting the CFG / semilattice fixed-point walker `(State, join, transfer)` makes it reusable for `drop` flow, escape analysis, reachability, definite assignment, and lifetime checks.

#### 1.2 Destructuring / Irrefutable Target Walker (`src/compiler/checker/patterns/walk.ts` vs `src/compiler/checker/statements/assignments.ts`)

- **Current narrow scope:** `patterns/walk.ts` states that every pattern is walked there (declarations, loops, assignments, `match`, and `is`). In practice, **assignment targets do not use `walk.ts`**. Because the parser parses `a, b = (1, 2)` and `Pair{first: p.x, second} = q` as `Expression`s (`Tuple`, `StructLiteral`), `checkAssignment` in `src/compiler/checker/statements/assignments.ts` re-implements the recursive destructuring walk, tuple arity slicing, struct field lookup, and positional-vs-named error reporting.
- **Wider scope:** Extracting one structural destructuring walker parameterized over leaf nodes (or unifying target representation) eliminates the duplicate walker in `assignments.ts` and resolves **D82** (duplicate assignment-target validation between parser and checker).

#### 1.3 Copy-In / Write-Back ("Lens" / Virtual Place) Protocol (`src/compiler/lowering/parts/places.ts` & `src/compiler/checker/rules/places.ts`)

- **Current narrow scope:** Copy-in / mutate / write-back is split across special cases for `Index` (`index` + `setIndex`) and `Unwrap` (`unwrap` + `rewrap`) in `src/compiler/checker/rules/places.ts`, `src/compiler/lowering/parts/places.ts`, and `src/compiler/lowering/statements/variables.ts`.
- **Wider scope:** Generalizing place steps into **projected steps** (struct field or tuple index) and **accessor steps** (any `(read, write)` call pair) resolves three open limitations at once:
  - **D86**: `x.value` on `Shared<T>` (spec §3.8: "`x.value` is the same as `x$`") remains on the frontier (`sharedValueField`) because `MemberAccess` cannot resolve to an accessor step.
  - **D87**: Passing `x$` or `x$.field` by `&` (`x$.push(v)`) remains on the checker frontier (`unwrapPart`) even though `lowering/parts/places.ts` already implements copy-in/write-back for `Unwrap`.
  - **D96**: `c$ = v` and `a, c$ = (1, 2)` lower through two different paths (the destructuring path emits an extra observable `unwrap` before `rewrap`).

#### 1.4 Recursive Type-Graph Property Queries (`sendable.ts`, `json-forms/index.ts`, `struct-rules.ts`, `types/properties/held.ts`)

- **Current narrow scope:** Four separate modules walk composite and nominal `Type` graphs:
  - `isSendable` (`src/compiler/checker/traits/sendable.ts`, tracking cycles via `Set<string>` of `typeKey`)
  - `JsonForms.problemOf` (`src/compiler/checker/rules/json-forms/index.ts`, tracking cycles via `Set<string>` of `typeKey`)
  - `checkFiniteFields` (`src/compiler/checker/declarations/layout/struct-rules.ts`, tracking cycles via `Set<StructDeclaration>`)
  - `heldType` (`src/compiler/checker/types/properties/held.ts`, taking no `CheckerContext`, keeping no cycle set, and **skipping declared `StructDeclaration` and `EnumDeclaration` fields**).
- **Correctness gap in `types/properties/held.ts`:** `types/properties/held.ts` states that a declared struct’s fields are checked where it is declared, but `src/compiler/checker/declarations/declarations.ts` never checks declared struct or enum fields for must-use types (`Future`, `Result`, `Disposable`). Consequently, a function returning a non-generic `struct Holder { f: Future<int> }` can have its result silently discarded as a bare expression statement without triggering `must-use` (`checkDiscarded`), whereas an anonymous struct `{ f: Future<int> }` is caught. Extracting a single cycle-safe type-graph traversal over `CheckerContext` fixes this and unifies all four walks.

---

## 2. Solutions Hard-Coded for Specific Types Instead of Generic Mechanisms

### 2.1 `Error{...}` Default `trace` Field (`src/compiler/checker/expressions/structs/literal-fields.ts`)

- **Hard-coded behavior:** `checkLiteralFields` checks whether the target declaration is `prelude.Error` (`wellKnown.error`) and the field name is `'trace'`. When omitted, it records a special `FieldSource = { kind: 'trace' }` variant (`src/compiler/checker/check.ts`) that `src/compiler/checker/declarations/computation.ts` refuses at compile time and `src/compiler/lowering/expressions/structs.ts` lowers to a call to `prelude._trace()`.
- **Generic mechanism:** Support default field expressions on `struct` declarations (`trace: string = _trace()`), matching function parameter defaults (spec §3.3). That removes `TraceSource` and `errorTrace` from the compiler.

### 2.2 `@JsonSkip` Restricted to 3 Hard-Coded Types (`src/compiler/checker/rules/annotations.ts`, `src/compiler/lowering/boundary/decoder.ts`)

- **Hard-coded behavior:** `annotations.ts` hard-codes a 3-entry table (`[wellKnown.optional, 'none']`, `[wellKnown.array, 'array']`, `[wellKnown.map, 'map']`), and `Decoder` in `src/compiler/lowering/boundary/decoder.ts` switches on `'none' | 'array' | 'map'` to emit construction instructions. Any other type — even one implementing the built-in `Default` trait (`trait Default: fn Self.default() -> Self`) — is rejected.
- **Generic mechanism:** `Array` and `Map` already implement `Default` in `src/stdlib/prelude/prelude.ista`, and `checkDeclaredLiteral` (`src/compiler/checker/expressions/collections/collections.ts`) already resolves `T.default()` for arbitrary user types. Resolving `T.default()` (plus `Optional.default() -> None`) for `@JsonSkip` fields allows `@JsonSkip` on any `Default` type and lets `Decoder` emit a single call to the resolved `FunctionCall`.

### 2.3 `@JsonBigInt` Hard-Coded to Bare `int` (`src/compiler/checker/rules/annotations.ts`, `src/compiler/checker/rules/json-forms/index.ts`)

- **Hard-coded behavior:** `@JsonBigInt` is checked specifically for `place.type.kind === 'primitive' && place.type.name === 'int'` and wired as a dedicated boolean check `annotations.fieldHas(field, 'jsonBigInt')`. It cannot be applied to `int?` or `Array<int>`, nor can other annotations supply custom field codecs.

### 2.4 Argument-Dependent Lookup (ADL) & Type Display Hard-Coded for `Shared<T>` (`src/compiler/checker/overloads/candidates.ts`)

- **Hard-coded behavior:** ` callCandidates` unwraps one layer of `wellKnown.shared` so `Inbox<T>` (`type Inbox<T> = Shared<InboxState<T>>`) searches `InboxState`’s module (`inbox`). Because `Type` erases `TypeAliasDeclaration` (**B3**) and ADL only unwraps `Shared<T>` at depth 1, nested handles (such as `WeakRef<Inbox<T>>`) or other wrapper aliases do not carry their alias origin into ADL or diagnostics (`typeText` prints `Shared<InboxState<int>>` instead of `Inbox<int>`).

### 2.5 Must-Use Ignores Constrained Type Parameters (`src/compiler/checker/rules/must-use.ts`, D108)

- **Hard-coded behavior:** `checkDiscarded` checks `part.kind === 'nominal' && checker.disposalOf(part).kind !== 'none'`, ignoring `part.kind === 'parameter'` constrained by `T is Disposable`.

---

## 3. Tricky Parts of the Spec That Could Be Generalized

### 3.1 Implicit Optional Wrapping (`T` → `T?`, spec §2) vs. Expression-Only Recording (`src/compiler/checker/body-checker.ts`)

- **Spec rule:** Spec §2 states that a `T` is wrapped into `T?` wherever an optional is expected.
- **Specialized implementation:** `BodyChecker` records wrap counts only in a `Map<Expression, number>`. Whenever a value flows into an expected type without its own distinct `Expression` node — destructuring assignments `(a, b) = pair` into `a: int?`, compound assignments `x += 1`, and bare `return` in a function returning `unit?` — the checker falls back to `fitUnwrapped` and rejects the code (**D97**).
- **Generalization:** Attach wrap counts to every value-transfer site (`Expression`, `TargetBinding`, `AssignedPart`, and `Return`) rather than only `Expression` nodes.

### 3.2 Host Handles (`Shared<S>` of Function Fields, spec §3.6 & §9) vs. Resource Handles (`src/compiler/checker/rules/host-boundary.ts`, `src/compiler/lowering/boundary/host-externs.ts`)

- **Spec rule:** Spec §3.6 has two separate mechanisms for opaque host objects:
  1. **Host handles (`hostHandleOf`)**: an extern returning `Shared<S>` where `S` is a struct of function fields (such as `inbox.Revertible<T>`), for which lowering synthesizes `<externKey>.<field>` native entries and closure wrappers capturing the host's JSON token.
  2. **Disposable host types (`isResourceType` in `src/definition/types.ts`)**: an `extern struct` with a declared `dispose` function, whose values wrap the host’s JSON in a `resource` heap object via `_decodeHandle` and unwrap it via `_encodeHandle`.
- **Generalization:** Both represent a **host-backed capability handle** holding opaque host JSON identity with method/dispose dispatch back to the host. Unifying `HostHandle` with `extern struct` resource handles eliminates the special `handleField` and `handleFieldNative` entry kinds in `src/compiler/lowering/lower.ts` and `src/compiler/lowering/boundary/host-externs.ts`.

### 3.3 Context-Dependent / Target-Typed Call Arguments (`src/compiler/checker/overloads/decided.ts`, `src/compiler/checker/closures/lambda-arguments.ts`)

- **Specialized implementation:** Expressions whose type depends on the parameter type of the chosen overload are split across three mechanisms:
  1. `decidedByCall` (`src/compiler/checker/overloads/decided.ts`) handles `none`, bare enum variants, and overloaded function names via an `accepts?: (expected: Type) => boolean` predicate during `choose()`.
  2. `checkDecidedLambdas` (`src/compiler/checker/closures/lambda-arguments.ts`) checks lambdas with untyped parameters *after* `choose()` but *before* `instantiate()`, passing `errorType` as an implicit sentinel for an uninferred return type (**D95**).
  3. Empty collection literals (`[]`, `[:]`), context-typed `struct{...}`, and tuples containing context-dependent elements (`(1, none)`, **D84**) are not delayed at all, and conversions `T(x)` do not propagate written type arguments (`Shared<Array<string>>([])`, **D102**).
- **Generalization:** Replace `decidedByCall` and `checkDecidedLambdas` with a single bidirectional delayed-argument pass in `src/compiler/checker/overloads/` covering all target-typed expressions (`none`, bare variants, untyped lambdas, empty `[]`/`[:]`, `struct{...}`, and tuples containing them).

### 3.4 `worker.disposing()` via Enclosing Function Name (spec §7, `src/compiler/checker/closures/own-calls.ts`)

- **Specialized implementation:** Because a function’s name normally denotes its overload set (`FunctionsEntity`) or closure (`VariableEntity`), intercepting `<enclosingAsyncFn>.disposing()` requires dedicated hooks across `expressions/calls.ts`, `closures/own-calls.ts`, `CheckedBody.watchedCallOf`, `CheckedBody.ownCallOf`, `lowering/function-lowering.ts`, and the `currentCall` instruction to synthesize a hidden variable at the function's span and capture it across nested closures.

---

## 4. Pitfalls Solved vs. Pitfalls Remaining Compared to Other Languages

### Pitfalls of Other Languages Solved by Istalang

| Pitfall in Other Languages | How Istalang Solves It |
| --- | --- |
| **Replay non-determinism** (Temporal in Go/TS/Python: replay breaks on wall clock, RNG, map order, or mutated globals) | **Snapshot VM (`src/runtime/`)**: Call frames are data persisted at every `await`; `now()` is pinned to segment start; `extern` constants are pinned in the snapshot on first read; maps keep deterministic insertion order. |
| **Hidden aliasing & mutation at a distance** (JS, Python, Go, Java) | **Value semantics + explicit `&` and `Shared<T>`**: Structs, arrays, maps, and tuples are deeply immutable values copied on assignment/call; parameters are `const`; mutating a caller’s variable requires `&` or `Shared<T>` (`x$`). |
| **Reference-counting cycles & non-deterministic GC finalizers** (Rust `Rc` leaks, Python/Go/JS finalizers) | **Reachability-based deterministic disposal (`src/runtime/lifetimes/`)**: Disposables are collected at scope/statement release points; Tarjan SCC (`orphans.ts`) disposes cycles together newest-first; holders are disposed before what they hold. |
| **Unhandled errors & forgotten `await`s** (Go ignored errors, JS floating promises) | **Transitive must-use (`src/compiler/checker/rules/must-use.ts`)**: `Future<T>`, `Result<T, E>`, and `Disposable` (and containers holding them) cannot be discarded without `drop expr` or `_ = expr`. |
| **Channel cancellation races & lost messages** (Go channels, Tokio `select!`) | **Single `Slot<T>` primitive + `select` holdings (`src/runtime/scheduler/slots.ts`, `src/stdlib/inbox/inbox.ista`)**: Losing `select` cases release and dispose their created futures/holders, retracting `sendRevertible` messages and aborting losing async calls. |
| **JSON precision loss & `NaN`/`Infinity` traps** (JS `Number` 53-bit truncation) | **`bigint` integers + canonical `lossless-json` (`src/definition/codec.ts`)**: Arbitrary-precision `int` end-to-end, sorted object keys, and compiled per-type JSON codecs (`src/compiler/lowering/boundary/`). |
| **Post-monomorphization template errors vs. trait-object serialization** (C++ templates, Rust `dyn Trait`) | **Checked-once generics + monomorphized witnesses (`src/compiler/checker/traits/`, `src/compiler/lowering/tables/instances.ts`)**: Generic bodies are type-checked once against trait constraints, and witnesses are resolved statically and monomorphized so snapshots never store vtables. |

### Pitfalls Istalang Currently Has Compared to Other Languages

1. **Coherence hazard in structural trait conformance (`src/compiler/checker/traits/conformance.ts`):**
   - Because traits have no `impl` blocks and witnesses are resolved at each call site from in-scope functions + ADL, the same type `T` can satisfy a trait with two different functions in two different modules. Lowering keeps them sound by including `witnessesKey` in `instanceKey` (`src/compiler/lowering/tables/instances.ts`), but behavior depends on call-site scope.
2. **Eager array materialization for `Iterable` (`src/stdlib/prelude/prelude.ista`, `src/compiler/lowering/iteration.ts`):**
   - `Iterable<T>` requires `fn iterate(self: C) -> Array<T>`. Iterating over a `Range` (`for i in 0..1_000_000`) or `Map` allocates and populates the entire `Array` upfront before the loop starts, rather than stepping a lazy cursor/iterator protocol.
3. **Quadratic immutable collection construction (**P2**, `src/compiler/lowering/expressions/comprehensions.ts`, `src/stdlib/prelude/`):**
   - Arrays and maps are plain JS arrays and entry arrays copied on every `push`, comprehension iteration (`[for x in xs: f(x)]` emits an `array` spread instruction on every pass), or `m[k] = v`. Building an $N$-element collection in a loop or comprehension is $O(N^2)$ without persistent data structures or single-holder in-place mutation.
4. **Copy-in / copy-out aliasing gap on `&container[key]` (`src/compiler/lowering/parts/places.ts`):**
   - Passing `&m[k]` or calling `m[k].mutate()` copies the element into a temporary cell before the call and writes it back with `setIndex` after the call returns. If the callee observes `m` during the call (for instance through a captured `Shared`), it sees the stale pre-call element.
5. **Full-snapshot round-trip and heap scans on commits/disposals (**P1, P3, D111, P4, D113**):**
   - Every `await` encodes the snapshot to canonical JSON text and parses it back (`src/runtime/scheduler/wake.ts`), and disposing call futures or weak references scans heap object lists linearly (`src/runtime/lifetimes/disposal.ts`, `src/runtime/scheduler/weak-side.ts`).

---

## 5. Modularity: Are the Phases True Plugin Registries?

**Assessment: Halfway.** Dispatch over syntax and instruction kinds is table-driven and exhaustive (`Handlers` in `src/structures/kind-table.ts`), and per-concern state lives in focused units, **but language features are not standalone plugins** — adding a feature slice requires editing **6 to 10 central coordinator modules**.

### What Is Table-Driven Today

- **Exhaustive `Handlers` registries (`src/structures/kind-table.ts`):**
  - Parser: prefix and infix parselets (`src/compiler/parser/expressions/expression.ts`)
  - Binder: declaration, statement, expression, pattern, and type tables (`src/compiler/binder/`)
  - Checker: `expressionHandlers`, `statementHandlers`, `declarationHandlers`, `typeHandlers`, `patternHandlers`
  - Lowering: `expressionHandlers`, `statementHandlers`
  - Definition & Runtime: `instructionRules` (`src/definition/instruction-rules.ts`), instruction `handlers` (`src/runtime/interpreter/instructions.ts`), disposal `kinds` (`src/runtime/lifetimes/disposal.ts`)

### Where Standalone Plugin Modularity Breaks Down

1. **Centralized side-table wiring in `CheckedBody`, `BodyContext`, and `BodyChecker` (`src/compiler/checker/check.ts`, `context.ts`, `body-checker.ts`):**
   - Every feature adds dedicated properties and query methods (`implicitCallOf`, `collectionFormOf`, `wrapsOf`, `targetsOf`, `assignedOf`, `inCell`, `functionOf`, `sourcesOf`, `patternOf`, `chainOf`, `watchedCallOf`, `ownCallOf`) to all three files.
2. **Manual type substitution in `instantiatedBody` (`src/compiler/lowering/tables/instances.ts`):**
   - `instantiatedBody` manually wraps 5 methods of `CheckedBody` (`typeOf`, `functionOf`, `targetsOf`, `chainOf`, `patternOf`) to apply `substitute(..., substitution)`. Any new feature side-table holding a `Type` that isn't manually added to `instantiatedBody` will silently leak unsubstituted `TypeParameterType`s during generic lowering.
3. **Ad-hoc whole-body AST switches outside the handler tables:**
   - `DropFlow` (`src/compiler/checker/rules/dropped.ts`), `Computation` (`src/compiler/checker/declarations/computation.ts`), and `waits` (`src/compiler/checker/rules/annotations.ts`) each maintain their own `switch (node.kind)` over syntax nodes instead of using `Handlers` or a shared flow pass.
4. **Closed `PendingEntry` union in lowering (`src/compiler/lowering/tables/tables.ts`, `src/compiler/lowering/lower.ts`):**
   - `PendingEntry` hard-codes 8 worklist entry kinds (`instance`, `nested`, `hostNative`, `constantNative`, `handleFieldNative`, `handleField`, `externConstant`, `start`).
5. **Six separate `switch (object.kind)` blocks over `HeapObject` in the runtime (**D110, D126**):**
   - `src/runtime/snapshot/snapshot.ts` (`valuesIn`, `directHolds`, `watchedObjects`), `src/runtime/snapshot/check.ts`, `src/runtime/scheduler/instance.ts` (`liveObject`, `storedObject`), and `src/runtime/lifetimes/disposal.ts` all switch over heap object kinds independently.

### How to Make Features True Standalone Plugins

- Replace fixed side-table methods on `CheckedBody` with a typed **`Facet<Key, Value>` registry**, where each facet declares an optional `substitute(value, substitution)` hook so `instantiatedBody` substitutes all facets automatically.
- Replace the 6 `switch (object.kind)` blocks in `src/runtime/` with a single exhaustive `Handlers` table over `HeapObject['kind']` defining `{ valuesIn, directHolds, watchedObjects, check, toLive, toStored, disposal }`.

---

## 6. Cross-Module Dependencies That Should Be Extracted and Shared

1. **Generic persistence envelope & canonical JSON codec inside `src/definition/` (`src/definition/codec.ts`, `src/definition/format.ts`)**
   - `src/runtime/snapshot/snapshot.ts` and `src/runtime/boundary/extern-signatures.ts` import `defineFormat`, `FormatError`, and `contentHashText` from `src/definition/`.
   - `codec.ts` and `format.ts` are generic canonical-JSON (`lossless-json` + sorted keys + SHA-256 + `{format, version, body}` Zod envelope) persistence utilities with no dependency on bytecode Definitions.
2. **Stdlib `json.Json` enum marshalling inside `src/definition/json-values.ts`**
   - `src/definition/json-values.ts` hard-codes `wellKnown.json` (`'json.Json'`) and its 7 variant names (`Null`, `Bool`, `Integer`, `Number`, `Text`, `List`, `Object`), and is imported by both `src/stdlib/json/natives.ts` and `src/runtime/boundary/`.
3. **Duplicate UTF-16 code-unit comparator in `src/language/values.ts` and `src/definition/codec.ts`**
   - `byCodeUnits` (`src/language/values.ts`) and `compareCodeUnits` (`src/definition/codec.ts`) are identical functions (`definition` already lists `language` in `foundation` in `.dependency-cruiser.mjs`).
4. **Cross-feature imports inside `src/compiler/checker/`**
   - `patterns/matching.ts` imports `fieldlessStructOf` from `expressions/names.ts` and `chooseVariant`, `nameNodeOf` from `expressions/variants.ts`.
   - `closures/function-values.ts` imports `namedType` from `expressions/variants.ts` (resolving a type named in value position, unrelated to enum variants).
   - `closures/functions.ts` and `closures/lambdas.ts` import `isChangeable` from `rules/places.ts`, and `closures/lambdas.ts` imports `declaredBodyResult`, `writtenByReference` from `declarations/functions/signatures.ts` and `blockTail`, `ReturnScope` from `statements/returns.ts`.
   - `expressions/calls.ts` and `closures/function-values.ts` import `staticTargetOf` from `traits/conformance.ts` to resolve static calls (`Duration.zero()`) even when no traits are involved.
5. **Duplicate frame-holding extraction between `src/runtime/lifetimes/holders.ts` and `src/runtime/snapshot/snapshot.ts` (**D110**)**
   - `holders.ts` imports `heldObjects` and `valuesIn` from `snapshot.ts`, then re-implements `valuesOfFrame` and `cellsOfFrame` beside `snapshot.ts`’s `frameValues` and `directHolds` because live `ActiveFrame` and stored `Frame` use different register array shapes.
6. **Scattered `Owner.fn` static naming and prelude native keys (**D79, D128**)**
   - `${a}.${b}` static function naming is repeated across `lowering/tables/names.ts`, `checker/expressions/calls.ts`, `checker/closures/function-values.ts`, `checker/closures/own-calls.ts`, `lowering/boundary/host-externs.ts`, and `stdlib/` native tables instead of sharing one helper in `src/definition/extern-key.ts`.

---

## 7. Prioritized Refactoring Plan (Leaves → Root)

Ranked by **correctness impact × fan-in (root stability) × blast-radius reduction**:

| Priority | Target & Location | Category | Blast Radius | Effort | Sequence / Prerequisite |
| --- | --- | --- | --- | --- | --- |
| **1** | **Fix `heldType` + `must-use` for declared structs/enums and `T is Disposable`** (`src/compiler/checker/types/properties/held.ts`, `src/compiler/checker/rules/must-use.ts` — **D108** + silent discard of structs holding `Future`/`Result`/`Disposable`) | Bug / Type-Graph Generalization | 2 files in `checker/` | S | Pass `CheckerContext` + cycle set into `heldType` so declared struct/enum fields and constrained type parameters are checked. |
| **2** | **Deduplicate leaf helpers (`compareCodeUnits`, `staticName`, `preludeKey`)** (`src/language/values.ts`, `src/definition/codec.ts`, `src/definition/extern-key.ts`, `src/stdlib/prelude/` — **D79, D128**) | DRY | ~12 leaf files | S | Zero-dependency leaf cleanup. |
| **3** | **Extract shared entity/type-lookup helpers in `checker/`** (`namedType`, `staticTargetOf`, `fieldlessStructOf`, `isChangeable`) out of `expressions/variants.ts`, `traits/conformance.ts`, and `rules/places.ts` | Cohesion / Decoupling | 8 files in `checker/` | S | Removes cross-feature imports between `patterns/`, `closures/`, `expressions/`, and `traits/`. |
| **4** | **Unify `HeapObject` kind table, Frame view, and Snapshot builder in `runtime/`** (`src/runtime/snapshot/objects.ts`, `snapshot.ts`, `scheduler/instance.ts`, `lifetimes/holders.ts` — **D110, D123, D126**) | Open/Closed Registry & DRY | 6 files in `runtime/` | M | Replaces 6 `switch (object.kind)` blocks and duplicate `frameValues`/`valuesOfFrame` with one `Handlers` table. |
| **5** | **Generalize `@JsonSkip` to use the `Default` trait** (`src/compiler/checker/rules/annotations.ts`, `src/compiler/checker/rules/json-forms/`, `src/compiler/lowering/boundary/decoder.ts`) | Type Generalization | 4 files in `checker/` & `lowering/` | S | Resolve `Default` (plus `Optional`) in the checker and store the `FunctionCall` on `JsonField.skipped` for `Decoder` to call. |
| **6** | **Generalize Virtual Places (Accessor Steps) in `places.ts`** (`src/compiler/checker/rules/places.ts`, `src/compiler/lowering/parts/places.ts`, `src/compiler/lowering/statements/variables.ts` — **D86, D87, D96**) | Place Generalization | 4 files in `checker/` & `lowering/` | M | Unifies `Index`, `Unwrap` (`x$`), and `Shared.value` into one copy-in/write-back step protocol; lifts `sharedValueField` and `unwrapPart` from the frontier. |
| **7** | **Unify Destructuring Target Walk & Value-Transfer Wraps** (`src/compiler/checker/patterns/walk.ts`, `src/compiler/checker/statements/assignments.ts`, `src/compiler/checker/body-checker.ts` — **D82, D97**) | DRY / Spec Generalization | 5 files in `checker/` & `lowering/` | M | Attaches optional-wrap counts to bindings/assigned parts/returns and deletes the duplicate destructuring walk in `assignments.ts`. |
| **8** | **Unify Context-Dependent / Target-Typed Argument Checking** (`src/compiler/checker/overloads/decided.ts`, `src/compiler/checker/closures/lambda-arguments.ts`, `src/compiler/checker/expressions/` — **D84, D95, D102**) | Spec Generalization | 6 files in `checker/` | M | Replaces `decidedByCall` + `checkDecidedLambdas` (`errorType` sentinel) with one delayed bidirectional argument-checking pass. |
