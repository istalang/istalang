---
description: concurrent multi-agent execution plan for codebase audit items — partitions fixes and refactors into strictly disjoint file-ownership groups to prevent merge conflicts and duplicate research
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-28
last_updated: 2026-10-28
tags: [review, audit, plan, concurrency, refactoring]
---

# Concurrent Multi-Agent Audit Plan

Companion to `docs/audit/audit-items.md`. This plan partitions all actionable bugs, generalizations, and DRY refactors into **6 concurrent Wave 1 agent groups (Groups A–F)** with **strictly disjoint file ownership**, followed by **Wave 2** for cross-contract items that span multiple phases.

---

## 0. Rules for Concurrent Agents (Zero-Conflict Discipline)

1. **Strict File Ownership:** Each Wave 1 agent may **only** edit files listed in its **Owned Files** section (plus the colocated `*.test.ts` / `test/corpus/...` files for its domain). Never edit a file owned by another group.
2. **Do Not Edit Shared Coordination Docs in Sub-Agents:** Sub-agents must **not** edit `docs/work/tracker.md`, `docs/audit/*`, `.dependency-cruiser.mjs`, `src/compiler/checker/check.ts`, or `src/compiler/checker/contexts/context.ts`. The orchestrator updates `docs/work/tracker.md` once after Wave 1 merges.
3. **Diagnostic Catalogs (`src/compiler/checker/diagnostics/`):** Only **Group C** may edit `src/compiler/checker/diagnostics/{boundary,lifetimes}.ts`. Other groups use existing diagnostic factories in `checkerDiagnostics`.
4. **Red → Fix → Green & Verification:** For every bug fix, write a failing test first, confirm it fails for the expected reason, apply the fix, and run `npm run verify` before committing.

---

## 1. Wave 1 — File-Ownership Matrix (Strictly Disjoint)

| Group | Domain / Subsystem | Exclusive `src/` Ownership | Items Covered |
| --- | --- | --- | --- |
| **Group A** | **Front-End: Scanner, Parser, Program & Binder** | `src/compiler/scanner/**`<br>`src/compiler/parser/**`<br>`src/compiler/syntax/expressions/index.ts`<br>`src/compiler/program/**`<br>`src/compiler/binder/**`<br>`src/cli/file-loader.ts` | **D186, D197, D209, D210, D220, D221**, `qualifiedPath` deduplication, stale `>>` comment in `punctuators.ts` |
| **Group B** | **Checker Core: Types, Inference, Resolution, Target-Typing, Closures & Places** | `src/compiler/checker/types/{type,fit,type-text,well-known,widening}.ts`<br>`src/compiler/checker/types/inference/**`<br>`src/compiler/checker/resolution/{call-arguments,choice,applicability,binding,packs,typed-call,conformance,declared-witness,default-witness}.ts`<br>`src/compiler/checker/resolution/calls/**`<br>`src/compiler/checker/constructs/closures/**`<br>`src/compiler/checker/constructs/declarations/functions/signatures.ts`<br>`src/compiler/checker/rules/{agreement,branches,clashes}.ts`<br>`src/compiler/checker/constructs/expressions/{expressions,tuples,collections,calls}.ts`<br>`src/compiler/checker/constructs/statements/assignments.ts` | **D101, D122, D144, D153, D160, Q8, D168, D173, D180, D190, D217, D219, D222, D223, D229, D230**, `agreedAccepts`/`tupleAccepts` partial-type bug, `typeText` entity check |
| **Group C** | **Checker Declarations, Field Defaults, Compile-Time Constants, Annotations, JSON & Rules** | `src/compiler/syntax/declarations/field-defaults.ts`<br>`src/compiler/checker/constructs/declarations/{declarations,constants,struct-rules}.ts`<br>`src/compiler/checker/types/properties/held.ts`<br>`src/compiler/checker/rules/{computation,annotations,disposal,must-use,suites}.ts`<br>`src/compiler/checker/rules/json-forms/**`<br>`src/compiler/checker/diagnostics/{boundary,lifetimes}.ts` | **D120, Q5, Q7, Q9, D216**, `waits` on non-blocking `select`, `suites.ts` `madeCalls()`, stale `${name}$` in 5702 |
| **Group D** | **Patterns, Exhaustiveness, Chained Comparisons & Lowering** | `src/compiler/syntax/patterns.ts`<br>`src/compiler/checker/checked-pattern.ts`<br>`src/compiler/checker/constructs/patterns/**`<br>`src/compiler/checker/resolution/applying/implicit.ts`<br>`src/compiler/checker/constructs/expressions/{operators,optionals,templates}.ts`<br>`src/compiler/lowering/**` (except `lowering/tables/names.ts`) | **B8, D149, Q12, D214, Q19, D224, B11, D226**, `optionalInt` → `buildVariant` |
| **Group E** | **Runtime: Interpreter, Scheduler, Lifetimes, Snapshot & Testing** | `src/runtime/**` | **D115, D116, D130, D155, D165, D176, D179, D182, D184, D198, D199, D203, D212** |
| **Group F** | **Foundation, Definition, Stdlib, CLI & Guide Examples** | `src/language/**`<br>`src/text/**`<br>`src/definition/**`<br>`src/compiler/lowering/tables/names.ts`<br>`src/stdlib/**`<br>`docs/guide.md`<br>`test/corpus/spec-examples.ts`<br>`test/spec-suites/purchase.test.ista` | **D100, D174, Q15 (definition+stdlib side), Q16 (definition side), D183, D188, Q17 (definition+stdlib side), D194, D195, D201, D202, D219 (extern-key side)**, time-unit constants, `compareOrdered` |

---

## 2. Detailed Wave 1 Agent Briefs

### Group A — Front-End: Scanner, Parser, Program & Binder

**Owned files:**
- `src/compiler/scanner/{punctuators,scan,templates,numbers}.ts` (+ `*.test.ts`)
- `src/compiler/parser/{layout,cursor,parser,annotations}.ts` (+ `*.test.ts`)
- `src/compiler/parser/expressions/{expression,parselet,postfix,precedence.test-kit}.ts` (+ `*.test.ts`)
- `src/compiler/parser/parts/names.ts`
- `src/compiler/syntax/expressions/index.ts`
- `src/compiler/program/program.ts` (+ `*.test.ts`)
- `src/compiler/binder/{diagnostics,expressions,link}.ts` (+ `*.test.ts`)
- `src/cli/file-loader.ts` (+ `*.test.ts`)

**Tasks in Group A:**
1. **Fix nested multi-line `{ … }` block expressions (D186 — `parser/layout.ts`, `parser/cursor.ts`):**
   - **Cause:** In `src/compiler/parser/layout.ts` (`placeOfNextLine`), `if (!cursor.separatesItems || cursor.closesEnclosing(next.kind)) return 'outside'` runs *before* `if (next.kind === cursor.closer) return cursor.ownsCloser ? 'ownCloser' : 'outside'`. When an inner multi-line `{ … }` block sits inside an outer `{ … }` block (or inside `(` within `{ … }`), the inner block's closing `}` on a new line matches the outer `{`'s `}` in `cursor.closesEnclosing('}')`, returning `'outside'` instead of `'ownCloser'`.
   - **Fix:** Check `if (next.kind === cursor.closer && cursor.ownsCloser) return 'ownCloser'` before `cursor.closesEnclosing(next.kind)`, and ensure `closesEnclosing` does not reach past an enclosing region that owns its own bracket closer when inside another bracket.
2. **Encapsulate template-value cursor state in `Cursor` (D221 — `parser/parser.ts`, `parser/cursor.ts`):**
   - Give `Cursor` its end-token reading (`"the end of the input"` vs. `"'}'"`) alongside `origin`, so `Parser.withinTemplateValue` swaps only `#cursor` and `Parser.describeNext` delegates `'end'` to `this.#cursor`.
3. **Isolate `Scanner.#scanValue` line state & stopping offset (D220 — `scanner/scan.ts`, `scanner/templates.ts`) + fix stale `punctuators.ts` comment:**
   - Have `Scanner.#scanValue` save and restore `#lineHasToken` and `#indentationTab`, and return `end: number` on `ScannedValue` so `#scanToken` doesn't need the post-hoc `this.#lineHasToken = true` repair and `TemplateScanner.#addValue` reads `value.end` directly.
   - Update `src/compiler/scanner/punctuators.ts` banner comment (which falsely says the language has no `>>` shift operator).
4. **Derive `parseSpawn` callee steps from `infixParselets` (D209 — `parser/expressions/expression.ts`, `parselet.ts`):**
   - Add a boolean flag (e.g., `inSpawnCallee?: boolean`) on `InfixParselet` and derive `calleeStep` in `expression.ts` from `infixParselets` instead of maintaining the duplicate `calleeSteps` `Set`.
5. **Decouple precedence property test oracle from parser helpers (D210 — `parser/expressions/precedence.test-kit.ts`):**
   - State right-associative (`'**'`) and prefix-refusal (`'**'`) rules directly in `precedence.test-kit.ts` instead of calling `rightOperandLevel` and `refusesPrefixedLeft` from `syntax/operators.ts`.
6. **Deduplicate `qualifiedPath` between Parser and Binder (`syntax/expressions/index.ts`, `parser/parts/names.ts`, `binder/constructs/expressions.ts`):**
   - Move `qualifiedPath(expression: Expression): QualifiedName | undefined` into `src/compiler/syntax/expressions/index.ts` and call it from `parser/parts/names.ts` (or directly in `parser/annotations.ts` and `parser/expressions/postfix.ts`) and `binder/constructs/expressions.ts` (deleting `qualifiedPathOf`).
7. **Move test-module path check out of `program.ts` into `LocatedModule` (D197 — `program/program.ts`, `cli/file-loader.ts`, `binder/diagnostics.ts`):**
   - Add `readonly isTest?: boolean` to `LocatedModule` and `readonly isTest: boolean` to `ProgramModule` (derived in `cli/file-loader.ts` from `testModuleSuffix`, with `isTestModule(program, id)` reading the module's flag or falling back for tests), and use `testModuleSuffix` in `binder/diagnostics.ts` (code 4015).

---

### Group B — Checker Core: Types, Inference, Resolution, Target-Typing, Closures & Places

**Owned files:**
- `src/compiler/checker/types/{type,fit,type-text,well-known,widening}.ts` (+ `*.test.ts`)
- `src/compiler/checker/types/inference/{infer,complete}.ts` (+ `*.test.ts`)
- `src/compiler/checker/resolution/{call-arguments,choice,applicability,binding,packs,typed-call,conformance,declared-witness,default-witness}.ts` (+ `*.test.ts`)
- `src/compiler/checker/resolution/calls/{resolve,lambda-arguments,places,collection-functions,operators}.ts`
- `src/compiler/checker/constructs/closures/{lambdas,value-calls,function-values,returns,functions}.ts` (+ `*.test.ts`)
- `src/compiler/checker/constructs/declarations/functions/signatures.ts`
- `src/compiler/checker/rules/{agreement,branches,clashes}.ts` (+ `*.test.ts`)
- `src/compiler/checker/constructs/expressions/{expressions,tuples,collections,calls}.ts`
- `src/compiler/checker/constructs/statements/assignments.ts`

**Tasks in Group B:**
1. **Fix `agreedAccepts` & `tupleAccepts` order-dependence and partial-type loss (D190 & Audit §4.1 — `rules/agreement.ts`, `expressions/tuples.ts`, `expressions/literals/collections.ts`, `rules/branches.ts`):**
   - **Cause:** `agreedAccepts` returns `undefined` if `producers[0] === undefined`, so `["a", none]` and `if c: "a" else: none` fail to be treated as target-typed arguments while `[none, "a"]` succeeds. Furthermore, both `agreedAccepts` and `tupleAccepts` ignore siblings that *do* have their own type (`?? true`), losing known element types during overload selection.
   - **Fix:** Return an `Accepts` predicate whenever *any* element/producer has `accepts !== undefined`, and for each sibling with its own type `t`, check `isOpen(expectedPart) || context.checker.fitOf(t, expectedPart) !== undefined`. Also ensure explicit `call.typeArguments` in `resolution/calls/resolve.ts` / `resolution/choosing/applicability.ts` guide target-typed arguments (`same<Array<string?>>(xs, ["a", none])`).
2. **Extend target-typed lambda result inference and optional stripping (D160 — `resolution/calls/lambda-arguments.ts`, `constructs/closures/lambdas.ts`, `constructs/closures/function-values.ts`, `expressions/tuples.ts`, `expressions/structs/variants.ts`, `expressions/expressions.ts`):**
   - Allow `checkDecidedLambdas` to recurse into composite expressions holding a lambda (matching `acceptsOf`), and strip `Optional` consistently where target-typed expressions expect a structural type.
3. **Unify 5-step implicit conversion logic between `types/fitting/fit.ts` and `types/inference/infer.ts` (D222) + `never` return type assignability (D180 — `types/type/index.ts`) + recursive widening (D144 — `types/unions/widening.ts`, `rules/agreement.ts`):**
   - Extract the shared conversion sequence (exact → plain-to-async function → 1-tuple ↔ element → `any` trait object → `Optional` wrap) parameterized by how leaf parts compare.
   - In `types/type/index.ts` (`isAssignable` / `sameShape`), allow a function type returning `never` to fit an expected function type returning any `R` (D180).
   - In `rules/agreement.ts` / `types/unions/widening.ts`, allow producers with sendable vs. plain functions nested inside tuples/arrays (`[(1, g), (2, f)]`, `[[g], [f]]`) to agree on the widened type (D144).
4. **Fix `typeText` entity-based `Optional` check and `*SharedStruct` anonymous struct formatting (D153 — `types/type/type-text.ts`) + add `arrayOf`/`arrayElement`/`optionalArgument` to `types/type/well-known.ts` (Q8):**
   - In `types/type/type-text.ts`, spell an `AnonymousStructType` whose `origin` is a shared `StructDeclaration` as `*${origin.name.text}` (with any type arguments), and check `wellKnown.optional` properly.
   - Add `arrayOf` and `arrayElement` to `types/type/well-known.ts` and use them in Group B's files (`resolution/choosing/choice.ts`, `expressions/literals/collections.ts`, `constructs/declarations/functions/signatures.ts`).
5. **Unify parameter/slot models, clash keys, and resolution vocabulary (D219, D223, D229, D230 — `constructs/declarations/functions/signatures.ts`, `resolution/choosing/binding.ts`, `resolution/choosing/choice.ts`, `resolution/choosing/applicability.ts`, `resolution/choosing/packs.ts`, `rules/clashes.ts`, `constructs/closures/lambdas.ts`, `constructs/closures/value-calls.ts`):**
   - Extract `CallArgument`, `Passing`, `Accepts`, and `Inapplicability` into `src/compiler/checker/resolution/choosing/call-arguments.ts` so `applicability.ts` and `packs.ts` do not type-import upward from `choice.ts` (D230).
   - Unify `ParameterSlot` and `ArgumentSlot` (D229), compute `RestSlot` once in `signatures.ts` instead of rebuilding `restSlotOf` per candidate per call in `choice.ts`, and add `isReceiver?: boolean` on `SignatureSlot` instead of overloading `name === undefined` (D219).
   - In `rules/clashes.ts`, replace string-encoded `packItemKey = '...'` and `'&'` prefix parsing with a structured slot key `{ kind: 'any' } | { kind: 'type'; key: string; reference: boolean }` (D223).
6. **Structured `witnessOf` outcomes & `callWithTypes` per-candidate arity & `explain` fallback (D122, D173, D217 — `resolution/conformance/conformance.ts`, `resolution/conformance/declared-witness.ts`, `resolution/typed-call.ts`, `resolution/calls/resolve.ts`, `expressions/literals/collections.ts`):**
   - In `resolution/conformance/conformance.ts`, give declared-but-uninstantiable witnesses a distinct failure outcome instead of returning `'none'`, so `declaresWitness` and `conform` report the unmet inner constraint and `checkDeclaredLiteral` in `expressions/literals/collections.ts` doesn't need `declaresDefault` (D173).
   - In `resolution/typed-call.ts`, size `decided` per candidate instead of using `candidates[0]`'s arity (D122).
   - In `resolution/calls/resolve.ts`, emit `noMatchingOverload` if `explain` reported no diagnostics during `case 'arguments':` (D217).
7. **Fix `_ = e` error suppression & destructuring assignment target typing and place identity (D101, D168 — `constructs/statements/assignments.ts`, `resolution/calls/places.ts`):**
   - In `constructs/statements/assignments.ts`, do not pass `errorType` as `expected` when the target is `_` (`_ = if c: 1 else: "two"` must report 5005, D101).
   - Propagate expected types from destructuring assignment targets into `node.value` so `(xs, n) = ([], 1)` and `(o, n) = (none, 1)` infer `xs` and `o`'s types, and unify place-identity / receiver-place checks between `assignments.ts` and `resolution/calls/places.ts` (D168).

---

### Group C — Checker Declarations, Field Defaults, Compile-Time Constants, Annotations, JSON & Rules

**Owned files:**
- `src/compiler/syntax/declarations/field-defaults.ts`
- `src/compiler/checker/constructs/declarations/{declarations,constants,struct-rules}.ts`
- `src/compiler/checker/types/properties/held.ts`
- `src/compiler/checker/rules/{computation,annotations,disposal,must-use,suites}.ts` (+ `*.test.ts`)
- `src/compiler/checker/rules/json-forms/index.ts` (+ `*.test.ts`)
- `src/compiler/checker/diagnostics/{boundary,lifetimes}.ts`

**Tasks in Group C:**
1. **Apply recorded `Fit` conversions in compile-time constant evaluation (D216 — `rules/computation.ts`):**
   - In `Computation.of` (`src/compiler/checker/rules/computation.ts`), apply `this.#scope.checked.fitAt(node)` to the computed `ConstantForm` (wrapping `Some` for `wraps > 0`, wrapping/unwrapping 1-element tuples for `tupled`/`untupled`, and refusing or converting `async`/`any` fits), so `const x: int? = 1` followed by `x ?? 0` works at runtime.
2. **Qualify enum variant field-default functions with their enum (Q5 — `syntax/declarations/field-defaults.ts`, `rules/computation.ts`):**
   - In `src/compiler/syntax/declarations/field-defaults.ts` (`fieldsFunctionOf`), set `owner: declaration.kind === 'EnumDeclaration' ? declaration.name : undefined` on a variant's synthetic `FunctionDeclaration` so two enums in the same module with identically named variants (`Circle { r: int = 1 }`) produce distinct lowered default entry names (`main.Shape.Circle/r` vs. `main.Icon.Circle/r`).
3. **Unify derived-trait conformance & type-graph cycle guards (Q7, Q9 — `rules/json-forms/index.ts`, `rules/annotations.ts`, `types/properties/held.ts`, `constructs/declarations/layout/struct-rules.ts`):**
   - Extract a shared cycle guard over `TypeKeys` in `types/properties/held.ts` and reuse it in `json-forms/index.ts`.
   - Clean up `JsonForms` / `Annotations` separation (`Q9`), fix `waits(node)` in `rules/annotations.ts` so a non-blocking `select:` (`!node.awaits`) does not count as waiting for `@Waypoint`, and give annotation compile-time constant errors their own wording (or parameterized 5026 message, `D120`).
4. **Check all `madeCalls()` in `@Suite` effect validation (`rules/suites.ts`) & clean up `rules/disposal.ts` (Q8) and diagnostic 5702 (`diagnostics/lifetimes.ts`):**
   - In `src/compiler/checker/rules/suites.ts` (`firstEffect`), check `body.madeCalls()` (which includes implicit calls and field-default calls) in addition to `body.calls`.
   - In `src/compiler/checker/rules/disposal.ts` (`runtimeDisposes`), use `checker.bindings.topLevelNamed` / `overloadsOf` consistently.
   - In `src/compiler/checker/diagnostics/lifetimes.ts`, update code 5702 (`disposeSelfEscapes`) from `'${name}$'` to `'*${name}'`.

---

### Group D — Patterns, Exhaustiveness, Chained Comparisons & Lowering

**Owned files:**
- `src/compiler/syntax/patterns.ts`
- `src/compiler/checker/checked-pattern.ts`
- `src/compiler/checker/constructs/patterns/{downcasts,exhaustiveness,matching,parts,pattern-tests,shapes,struct-items,taking,walk}.ts` (+ `*.test.ts`)
- `src/compiler/checker/resolution/applying/implicit.ts`
- `src/compiler/checker/constructs/expressions/{operators,optionals,templates}.ts`
- `src/compiler/lowering/**` *(excluding `src/compiler/lowering/tables/names.ts`, which Group F owns)*

**Tasks in Group D:**
1. **Unify comparison & membership checking and lowering across binary operators, chains, and patterns (D226 — `checker/checked-pattern.ts`, `checker/constructs/expressions/operators.ts`, `checker/constructs/patterns/matching.ts`, `lowering/expressions/operators.ts`, `lowering/parts/patterns.ts`):**
   - Give binary and chained comparisons/memberships one checker function and one lowering function over a `ComparisonLink` (where a `Binary` comparison is a single link).
   - Unify pattern ordering tests (`CompareFieldPattern`, `RangePattern` bound, `ArrayPattern` rest length) into one ordering test representation so `lowering/parts/patterns.ts` (`passed`) and `lowering/expressions/operators.ts` share `ordered` and `equal`.
2. **Separate written pattern shapes from matrix shapes in exhaustiveness (D224 — `checker/constructs/patterns/exhaustiveness/exhaustiveness.ts`, `checker/constructs/patterns/exhaustiveness/shapes.ts`):**
   - Split `Shape` into `WrittenShape` (which includes `or` and `array`) and `MatrixShape` / `WitnessShape` (`any` and `constructor` only, with a structured constructor key instead of parsing `key.endsWith('+]')`), removing the `unreachable` guards in `Matrix.useful`, `specialize`, and `witnessText`.
3. **Remove `walk.downcasts` side channel & move `unparenthesized` for patterns to `syntax/patterns.ts` (D214 — `syntax/patterns.ts`, `checker/constructs/patterns/walk/index.ts`):**
   - Export `unparenthesizedPattern(node: Pattern): Pattern` from `src/compiler/syntax/patterns.ts`.
   - Have `walk.take` in `checker/constructs/patterns/walk/index.ts` return both `{ shape, part }` (or pass the narrowed `ValuePart` directly to `AsPattern`) so `walk.downcasts` is deleted.
4. **Prelude-invariant implicit calls without fake user diagnostics (B11 — `checker/resolution/applying/implicit.ts`, `checker/constructs/patterns/matching.ts`, `checker/constructs/expressions/access/optionals.ts`, `checker/constructs/expressions/templates.ts`):**
   - Add a `preludeCall` helper (or make `failure` optional for prelude-owned calls) in `src/compiler/checker/resolution/applying/implicit.ts` that calls `unreachable` if a toolchain-owned prelude function (`panic`, `_inclusiveEnd`, `length`, `_patternItem`, `_patternRest`, `compare`, `join`) is missing, removing the bogus user-diagnostic callbacks at those call sites.
5. **Fix case-less `select:` with `else:` in lowering (D149 — `lowering/expressions/control/select.ts`):**
   - When `cases.length === 0` and `node.elseClause !== undefined`, lower `node.elseClause.body` directly without emitting an empty `select` instruction (which `definition/instructions/suspension.ts` rejects).
6. **Wrap spread elements when `Array<T?>` is expected (B8 — `lowering/expressions/collections/collections.ts`) & replace `optionalInt` with `buildVariant`:**
   - Replace `optionalInt` in `src/compiler/lowering/expressions/collections/collections.ts` with `buildVariant` from `./variants.ts`.
7. **Clean up lowering re-derivations and `function-lowering` ↔ `boundary` cycle (Q12, Q19 — `lowering/parts/places.ts`, `lowering/expressions/structs/structs.ts`, `lowering/trait-objects/trait-objects.ts`, `lowering/function-lowering/index.ts`, `lowering/boundary/starts.ts`):**
   - In `lowering/trait-objects/trait-objects.ts` (`anyFieldEntry`), use `requiredFields` and guard `index < 0` with `unreachable`.
   - Break the bidirectional import between `lowering/function-lowering/index.ts` and `lowering/boundary/inbound.ts` / `starts.ts`.

---

### Group E — Runtime: Interpreter, Scheduler, Lifetimes, Snapshot & Testing

**Owned files:**
- `src/runtime/**` (+ `*.test.ts` and `*.test-kit.ts`)

**Tasks in Group E:**
1. **Fix same-instance mock return values bypassing `arriving` (D182 — `runtime/scheduler/testing/mocks.ts`):**
   - Ensure that when a mock is called within the holder's own instance (`callTargetOf` / `NativeCalls`), a returned host resource value (`testing.handle<T>()`) goes through `arriving(instance, value)` so it is wrapped in a `resource` heap object and disposed when dropped.
2. **Unify `HeapObject` kind tables and `isRoot` predicate (D165, D198 — `runtime/snapshot/holdings.ts`, `runtime/lifetimes/holders.ts`, `runtime/lifetimes/orphans.ts`, `runtime/lifetimes/disposal.ts`, `runtime/scheduler/instance/heap.ts`, `runtime/scheduler/instance/index.ts`, `runtime/scheduler/instance/futures.ts`):**
   - Export one `isRoot(object: HeapObject | LiveObject): boolean` (`object.kind === 'execution' || object.kind === 'answer'`) from `src/runtime/snapshot/holdings.ts` and use it in `instance/index.ts`, `lifetimes/holders.ts`, `lifetimes/orphans.ts`, and `scheduler/instance/heap.ts`.
   - Export `FutureState` from `snapshot/objects.ts` (or `holdings.ts`) instead of defining it twice, and use `Handlers` from `src/structures/kind-table.ts` across `holdings.ts` and `disposal.ts`.
3. **Distinguish disposed referent from returned call on `weakRef` & unify `WeakSide` handle/id surface (D115, D116 — `runtime/snapshot/objects.ts`, `runtime/scheduler/instance/weak-side.ts`, `runtime/scheduler/native-calls.ts`):**
   - Record why a `weakRef` has no target (or distinguish disposed vs. returned call) so `watch` and `whenDisposed` don't rely on caller convention (D115).
   - Make `WeakSide`'s native-facing methods consistently take and return `Value` handles, and its disposal-facing methods take `number` IDs, so `nativeWeakSideOf` simply forwards (D116).
4. **Enforce maximum call-frame depth in the VM (D155 — `runtime/scheduler/segment/index.ts`, `runtime/scheduler/segment/limits.ts`):**
   - Add a maximum frame depth check in `limits.ts` and call it when pushing frames in `SegmentRunner.call`, throwing a `Panic` on unbounded recursion instead of exhausting V8's heap.
5. **Discriminated union for `AdvanceFirst` & replay `answering` on panic (D199 — `runtime/scheduler/wake.ts`, `runtime/snapshot/snapshot.ts`):**
   - Replace the optional-bag `AdvanceFirst` with a discriminated union `{ kind: 'arrival' | 'answer' | 'withdraw' | 'none' }` + `startedAt`, and preserve `answering` in `replayOf`.
6. **Cache decoded snapshots in `storedEnds` and unify `World` snapshot queries (D184, D212 — `runtime/scheduler/instance-ends.ts`, `runtime/testing/world/index.ts`, `runtime/scheduler/inspect.ts`):**
   - Cache decoded `Snapshot`s by their text in `storedEnds` (as `World.#snapshotOf` does) so watching N child instances doesn't re-parse N snapshots on every wake.
   - Extract `World`'s inline snapshot object queries (`#watchHolds`, `#withdrawAnswersTo`) into helpers beside `inspection` (`scheduler/inspect.ts`).
7. **Null-object `TestWorld` & remove upward type-imports in `runtime/natives.ts` (D176, D179 — `runtime/natives.ts`, `runtime/instance-state.ts`, `runtime/scheduler/loaded-definition.ts`, `runtime/scheduler/testing/test-world.ts`, `runtime/scheduler/wake.ts`, `runtime/scheduler/testing/mocks.ts`, `runtime/scheduler/native-calls.ts`):**
   - Provide a default non-test `TestWorld` in `test-world.ts` / `loaded-definition.ts` so `wake.ts`, `mocks.ts`, and `native-calls.ts` never branch on `world !== undefined` (D176).
   - Move `Inspection` (and `WaitingPoint`) to `src/runtime/instance-state.ts` (or a contract file beside it) and `TestWatch` to `src/runtime/snapshot/objects.ts` so `src/runtime/natives.ts` imports nothing from `scheduler/` (D179).
8. **Unify seed derivation (`seedFrom` in `random.ts`, D203) & deduplicate lifetime test helpers (D130 — `runtime/random.ts`, `runtime/scheduler/instance/index.ts`, `runtime/testing/run-tests.ts`, `runtime/lifetimes/lifetimes.test-kit.ts`, `holders.test.ts`, `orphans.test.ts`, `snapshot/snapshot.test.ts`):**
   - Add `seedFrom(bytes: Uint8Array): string` in `src/runtime/random.ts` and use it in both `Instance.spawn` and `run-tests.ts`.
   - Move duplicate `handle(object)` into `lifetimes.test-kit.ts` and rename the distinct `heapArbitrary` in `snapshot.test.ts`.

---

### Group F — Foundation, Definition, Stdlib, CLI & Guide Examples

**Owned files:**
- `src/language/{primitives,static-names,values,well-known}.ts` (+ `*.test.ts`)
- `src/text/code-points.ts` (+ `*.test.ts`)
- `src/definition/{codec,declared-values,equality,extern-key,json-values,references,types,values}.ts` (+ `*.test.ts`)
- `src/compiler/lowering/tables/names.ts`
- `src/stdlib/**`
- `docs/guide.md`
- `test/corpus/spec-examples.ts`
- `test/spec-suites/purchase.test.ista`

**Tasks in Group F:**
1. **Unify `qualifiedName` across `language/`, `lowering/tables/names.ts`, and `definition/extern-key.ts` (D174) & make `KeyParameter` passing an enum (D219):**
   - Use `qualifiedName` from `src/language/well-known/index.ts` in `src/compiler/lowering/tables/names.ts` (`qualifiedNameOf`) and `src/definition/extern-key.ts` (`externKey`).
   - In `src/definition/extern-key.ts`, replace `reference: boolean; rest?: boolean` on `KeyParameter` with `passing: 'value' | 'reference' | 'rest'`.
2. **Add `fieldValueOf` and export `variantShape` in `definition/values/declared-values.ts`, and `closureOf` in `definition/values/values.ts` (Q15, Q16, Q17, D201):**
   - Add `fieldValueOf(types, structValue, fieldName)` and export `variantShape` in `src/definition/values/declared-values.ts`.
   - Use them in `src/stdlib/values/arguments.ts` (`fieldNamed`), `src/stdlib/regex/natives.ts` (reading `Regex.pattern` by name instead of `fieldOf(regex, 0)`), `src/definition/values/json-values.ts` (`findJsonType`), and `src/stdlib/json/natives.ts` (`_object`).
   - Add `closureOf(value: Value | undefined)` in `src/definition/values/values.ts` and use it in `src/stdlib/testing/natives.ts`.
   - Make `valueProblems` in `src/definition/validation/references.ts` iterative (or bounded) and make `ValueSemantics.#sameKeys` in `src/language/values.ts` push onto `pending` or bound key depth (D100).
3. **Deduplicate time-unit constants and `compareOrdered` (`language/`, `stdlib/prelude/natives.ts`, `stdlib/time/iso.ts`):**
   - Export `compareCodeUnits` / `compareOrdered` from `src/language/values.ts` and use it in `src/stdlib/prelude/natives.ts`.
   - Export time-unit millisecond constants from `src/language/well-known/index.ts` (or `src/language/time-units.ts`) and use them in `src/stdlib/time/iso.ts`.
4. **Fix $O(N)$ array allocation in string length/indexing (D195 — `text/code-points.ts`, `stdlib/prelude/strings.ts`, `stdlib/strings/natives.ts`) & bound `decimal` places/exponent work (D194 — `stdlib/decimal/arithmetic.ts`):**
   - Add non-allocating `codePointCount(s: string): number` (and `codePointAtPosition`) in `src/text/code-points.ts`, and use them in `src/stdlib/prelude/strings.ts` (`length`, `at`, `index`) and `src/stdlib/strings/natives.ts` (`padding`) so large strings do not crash V8 with OOM.
   - Bound `places` and negative exponent work in `src/stdlib/decimal/arithmetic.ts` so `decimal.divide` and `power` panic immediately on unreasonable precision instead of stalling the host thread for minutes.
5. **Add `FakeClock` setup and `FakeQueue` revertible-receipt support in `testing.ista` (D183, D188 — `stdlib/testing/testing.ista`, `stdlib/futures/futures.test.ista`, `test/spec-suites/purchase.test.ista`):**
   - Add a `FakeClock` setup helper in `src/stdlib/testing/testing.ista` that mocks both `time.now` and `time.at`, and use it in `futures.test.ista` and `purchase.test.ista` (D188).
   - Add revertible-receipt support to `FakeQueue` (or a `FakeReceipts` helper in `testing.ista`) and simplify `test/spec-suites/purchase.test.ista` (D183).
6. **Compile-check `docs/guide.md` code examples (D202 — `docs/guide.md`, `test/corpus/spec-examples.ts`):**
   - Add front-matter with `last_verified` to `docs/guide.md` and include its code fences in `test/corpus/spec-examples.ts`.

---

## 3. Wave 2 — Cross-Contract & Cross-Phase Refactors (Run After Wave 1 Merges)

These items touch shared phase contracts (`src/compiler/checker/check.ts`, `src/compiler/checker/contexts/context.ts`, `.dependency-cruiser.mjs`) or wire Wave 1's new `definition/` helpers into `runtime/` and `scanner/`:

1. **Layer `checker/contexts/context.ts` interfaces & enable type-import cycle checking (Q13):**
   - Replace the concrete class type-imports in `src/compiler/checker/contexts/context.ts` with narrow interfaces declared in `context.ts`, and enable `tsPreCompilationDeps` in `.dependency-cruiser.mjs`.
2. **Explicit function-value calls on `CheckedBody` & pure `entityOf` query (Q1, Q2):**
   - Record function-value calls explicitly in `CheckedBody` (`src/compiler/checker/check.ts`, `body-checker.ts`, `lowering/expressions/calls.ts`) and split `BodyChecker.entityOf` (pure query) from `useEntity` (which notes closure captures).
3. **Wire Wave 1 foundation helpers across phase boundaries (Q15, Q16, Q17, Q18):**
   - Use `closureOf` (`definition/values/values.ts`) across the 6 sites in `src/runtime/`.
   - Use `fieldValueOf` (`definition/values/declared-values.ts`) in `src/runtime/testing/run-tests.ts` (`listedOf`), and derive `runnerArity` in `definition/validation/references.ts`.
   - Give `Instance<T>` handle creation/reading one home (`Q18`) across `runtime/` and `stdlib/`.
   - Use the shared time-unit constants in `src/compiler/scanner/numbers.ts`.
4. **Assert `docs/spec.md` and `docs/guide.md` non-elided module fences check clean (B2):**
   - Tighten `src/compiler/checker/check.test.ts` so every non-elided module fence in `docs/spec.md` and `docs/guide.md` is checked for zero unexpected diagnostics.
5. **Update `docs/work/tracker.md`:**
   - Remove all resolved `D...` entries in one clean commit.

### Wave 2 additions from Wave 1's reports

6. **B8:** wrap a spread's items into `T?` (checker `expressions/literals/collections.ts`, `rules/agreement.ts`, `check.ts` `ValueSite`/`IterationForm`).
7. **B11's rest:** `..=`'s `_inclusiveEnd` through `preludeCall` (checker `expressions/literals/collections.ts`).
8. **Q12/Q19's rest:** record field positions and `any` field dispatches on `CheckedBody` (`check.ts`, `expressions/structs/structs.ts`); `requiredFields` through the checker surface (`.dependency-cruiser.mjs`).
9. **Operator classification, one home:** export `BinaryOperatorOf` from `syntax/operators.ts`, write `ImplicitOperator = BinaryOperatorOf<'order' | 'membership'>`, move `isImplicitOperator` beside `isChainingOperator`; build a single binary's `ComparisonLink` in `syntax/expressions/comparisons.ts`; share `fitArguments`/`typesText` between `resolution/calls/resolve.ts` and `resolution/applying/implicit.ts`.
10. **`rules/iteration.ts`:** `iteratedItem`'s implicit call passes `span: iterable.span`, so 5101/5003 fall on the iterable.
11. **Weak side:** remove `NativeWeakSide.whenDisposed`, switch `stdlib/prelude/weak-natives.ts` to `watch`, delete `nativeWeakSideOf`; a production `handleTo(id)` in `definition/values/values.ts` replaces the inline `{kind: 'handle', object}` literals.
12. **Test modules:** one test-suffix predicate in `language/well-known/index.ts`, used by `cli/file-loader.ts` and `program.test-kit.ts`; `parse.test.ts` titles become `$document:$line`, and `section` drops its `${path} › ` prefix.

### Wave 2 groups

Three agents in parallel, one worktree each. Wave 2 crosses contracts, so ownership is primary rather than strictly disjoint: the listed cross-edits are allowed, and the branch that merges later rebases. Item 5 is the orchestrator's. Easy code-quality items from the tracker join the group owning their files.

| Group | Items | Owns |
| --- | --- | --- |
| G — checker↔lowering contract | 1 (Q13), 2 (Q1, Q2), 8 (Q12, Q19); Q11's `lowering/parts/places.ts` part | `checker/check.ts`, `checker/contexts/context.ts`, `checker/body-checker.ts`, `checker/constructs/expressions/structs/structs.ts`, `lowering/`, `.dependency-cruiser.mjs`; the `entityOf` rename at its callers anywhere in `checker/` |
| H — checker expressions, operators, resolution | 6 (B8), 7 (B11), 9, 10; Q8, Q11 (but `lowering/parts/places.ts`), Q24 | `compiler/syntax/`, the rest of `checker/`; additive edits to `check.ts`'s `ValueSite`/`IterationForm` for B8 |
| I — cross-phase wiring, test modules | 3 (Q15–Q18, Q25), 4 (B2), 11 (Q26), 12; Q20, Q22, Q23, Q27 | `runtime/`, `stdlib/`, `definition/`, `language/`, `cli/`, `compiler/scanner/`, `program.test-kit.ts`, parse and check tests |

Agents don't edit `docs/work/tracker.md` or `docs/audit/*`; each reports the ids it closed, narrowed or filed, and the orchestrator updates the tracker.
