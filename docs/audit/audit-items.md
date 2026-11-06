---
description: full-codebase generality, modularity, DRY, and architecture audit (post-M5 and language-features @ cf4a7d8) — read before refactoring or starting M6–M8
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-28
last_updated: 2026-10-28
tags: [review, audit, architecture, refactoring, generality, dry]
---

# Codebase Audit (`main @ cf4a7d8` — Post-M5 & Language Features)

Systematic unit-by-unit and module-by-module review of `src/`, `docs/spec.md`, and `test/` evaluating:
1. **Narrow solutions to extract, generalize, and reuse on a wider scope**
2. **Solutions hard-coded for specific types instead of generic mechanisms**
3. **Spec tricky parts that can be generalized instead of specialized per-section logic**
4. **Modularity & plugin architecture across phases**
5. **Cross-module dependencies on extractable shared solutions**
6. **DRY violations & double standards (two ways/shapes for one problem/concept)**
7. **Language pitfalls solved vs. pitfalls remaining compared to other languages**

---

## Audit Progress & Module-by-Module Findings

### Part 1 — Foundation & Contracts (`src/structures/`, `src/language/`, `src/text/`, `src/diagnostics/`, `src/compiler/syntax/`, `src/definition/`)

#### 1.1 `src/structures/` & `src/language/`
- **`ValueSemantics` map-key equality recursion (`src/language/values.ts`, D100):**
  - `ValueSemantics.equal` and `structuralKey` use explicit heap stacks so deep values never overflow the JS stack, and the banner states *"Every walk keeps its own stack"*. However, `#sameKeys` calls `this.entryValue(other, key)` → `this.entryPosition(map, key)` → `this.equal(entry[0], key)`, recursing on the host JS stack when maps are nested inside map keys.
- **Three separate implementations of module-qualified naming (`src/language/well-known.ts`, `src/compiler/lowering/tables/names.ts`, `src/definition/extern-key.ts`, D174):**
  - `qualifiedName({ module, name })` in `src/language/well-known.ts`, `qualifiedNameOf` in `src/compiler/lowering/tables/names.ts`, and `${signature.module}.${signature.name}` in `src/definition/extern-key.ts` all format `${module}.${name}` independently, even though `stdlib/std-module.ts` relies on `qualifiedName` matching lowering's type-table names and extern keys.

#### 1.2 `src/text/`
- **Double standard & OOM hazard in `codePoints` vs. `codePointWidth` (`src/text/code-points.ts`, D195):**
  - `utf16Offset` and `codePointPositions` step through UTF-16 strings in $O(1)$ space using `codePointWidth(text, offset)`.
  - Right beside them, `export const codePoints = (s: string): string[] => [...s]` allocates a full JS array of single-character strings. `src/stdlib/prelude/strings.ts` calls `codePoints(s).length` for `s.length()` and `codePoints(s)` for iteration/reversal, causing large strings to crash the V8 process with `heap out of memory` instead of counting in $O(1)$ space. Extracting a non-allocating `codePointCount(s: string): number` in `src/text/code-points.ts` fixes `length()` and gives all code-point counting one home.

#### 1.3 `src/compiler/syntax/`
- **Inconsistent AST modeling: boolean flags vs. distinct node kinds (`src/compiler/syntax/declarations/index.ts`, `expressions/index.ts`, `expressions/chains.ts`, Q4, Q11):**
  - `declarations.ts`'s banner states: *"The tree keeps each declaration form apart where the forms hold different things, so a consumer never meets a combination the syntax can't produce."* Yet `shared struct` is modeled as `isShared: boolean` on `StructDeclaration` (requiring ~12 call sites across checker and lowering to check `isShared`), and `new X{…}` is modeled as `isNew: boolean` on `StructLiteral`.
  - Similarly, optional chaining uses `isOptional: boolean` on `MemberAccess`, `TupleElement`, `Index`, and `Call`, but `operator: '*' | '->' | '?->'` on `Dereference` (`expressions/chains.ts`).
- **Missing `unparenthesized` helper for `Pattern` and `TypeNode` (`src/compiler/syntax/patterns.ts`, `types.ts`, D214):**
  - `src/compiler/syntax/expressions/index.ts` exports `unparenthesized(node: Expression): Expression`, which every phase uses. `syntax/patterns.ts` has `ParenthesizedPattern` and `syntax/types/index.ts` has `ParenthesizedType`, but neither exports an `unparenthesized` helper, forcing `src/compiler/checker/patterns/walk.ts` to define a local `unparenthesized(pattern: Pattern)` copy.
- **Parallel destructuring-target helpers split across `syntax/statements.ts` and `syntax/patterns.ts`:**
  - Because `VariableDeclaration.targets` and `For.targets` are `Pattern[]` while `Assignment.targets` are `Expression[]`, `syntax/statements.ts` defines `destructuringOf`, `isTarget`, `destructures`, `targetParts`, `isUnnamedTarget`, and `hasUnnamedTarget`, while `syntax/patterns.ts` defines `targetLeaves`, `targetNames`, and `hasUnnamedPart`.
- **Synthetic field-default functions tracked via a module-global `WeakSet` (`src/compiler/syntax/declarations/field-defaults.ts`, B9, Q5):**
  - `fieldsFunctionOf` synthesizes a `FunctionDeclaration` (with `body: undefined`, `isExtern: false`) for structs and enum variants whose fields have default values, and records it in a module-global `const made = new WeakSet<FunctionDeclaration>()` queried via `isFieldsFunction(declaration)`.
  - For an enum variant (`fieldsFunctionOf(enumDecl, variant)`), it sets `name: owner.name` (the variant's name) and `owner: undefined` (dropping the enum's name). Consequently, two enums in the same module that both have a variant `Circle { r: int = 1 }` collide on the lowered default function name `main.Circle/r`.

#### 1.4 `src/definition/`
- **Write-only struct helpers in `declared-values.ts` causing three different ways to read struct values (`src/definition/declared-values.ts`, `json-values.ts`, `src/stdlib/native-values.ts`, `src/runtime/testing/run-tests.ts`, Q16, Q17, D201):**
  - `declared-values.ts` states: *"Values built and read through their type entry's declaration: a struct's fields and an enum's variants by name, never by position."* However, `declared-values.ts` only provides constructors (`structOf`, `variantOf`) and type lookups (`fieldTypeOf`, `variantFieldType`), with **no `fieldValueOf(types, structValue, fieldName)` reader** and an unexported `variantShape`.
  - As a result, reading a struct or enum value happens three different ways:
    1. `src/stdlib/native-values.ts` implements its own `fieldNamed(types, candidate, name)` (which looks up `declared.fields.findIndex`) AND positional `fieldOf(candidate, index)` (used by `regex/natives.ts` on `Regex`).
    2. `src/runtime/testing/run-tests.ts` (`listedOf`) manually implements `entry.fields.findIndex((each) => each.name === name)` to read `Listed` structs.
    3. `src/definition/json-values.ts` (`findJsonType`) manually implements `entry.variants.findIndex((each) => each.name === name)` instead of using `declared-values.ts`.
  - Moving `fieldNamed` (as `fieldValueOf`) and exporting `variantShape` in `src/definition/declared-values.ts` gives all TypeScript-side reading and building of declared values a single home.
- **Missing `closureOf(value)` narrowing helper (`src/definition/values.ts`, Q15):**
  - `values.ts` exports `elementsOf`, `mapValueOf`, `handleTarget`, and `isComposite`, but no `closureOf(candidate)`, leaving 7 sites across `runtime/` and `stdlib/` to repeat `isComposite(v) && v.kind === 'closure'`.
- **Ambiguous `'cell'` role in `ExternRole` (`src/definition/types.ts`, Q4):**
  - `externRole = z.enum(['cell', 'future', 'instance'])` conflates user-declared `shared struct` handles with compiler-synthesized `_Cell<T>` mutable variable cells, forcing `isResourceType` to add `&& entry.role !== 'cell'`.
- **Overlapping boolean flags in `KeyParameter` (`src/definition/extern-key.ts`, D219):**
  - `KeyParameter` has `{ readonly type: KeyType; readonly reference: boolean; readonly rest?: boolean }` instead of a mutually exclusive `passing?: 'reference' | 'rest'` union.
- **Hard-coded test runner arity in `references.ts` (`src/definition/references.ts`, Q16):**
  - `runnerArity = { list: 2, run: 4 }` duplicates the contract between `testing.ista` and `runtime/testing/run-tests.ts`.
- **JS call-stack recursion in `valueProblems` (`src/definition/references.ts`):**
  - Unlike `values.ts` (`summaryOf`), `codec.ts` (`jsonDepth`), and `language/values.ts` (`equal`, `structuralKey`), which walk values iteratively on an explicit heap stack, `valueProblems` recurses on the JS stack for every nested child value.

---

### Part 2 — Front-End: Scanner, Parser, Program & Binder (`src/compiler/scanner/`, `parser/`, `program/`, `binder/`)

#### 2.1 `src/compiler/scanner/`
- **Stale banner comment contradicting L5 shift operators (`src/compiler/scanner/punctuators.ts`):**
  - The banner states: *"There is deliberately no `>>` (the language has no shift operators), so `Array<Array<int>>` closes two type-argument lists without the parser splitting a token."* L5 added `<<`, `>>`, `<<=`, and `>>=` to `syntax/tokens.ts` and token-splitting (`restAfterAngle`) to `parser/cursor.ts`, making this comment false.
- **Coupled mutable state between `Scanner.#scanValue` and `TemplateScanner` (`src/compiler/scanner/scan.ts`, `templates.ts`, D220):**
  - `Scanner.#scanValue` re-enters `#scanTokens(true)` mutating the outer scanner's `#offset`, `#lineHasToken`, and `#indentationTab`. Consequently, `#scanToken` must unconditionally reset `this.#lineHasToken = true` after `scanLexeme()`, and `TemplateScanner.#addValue` must reconstruct the end offset from `value.tokens.at(-1)?.span.start ?? this.#text.length` instead of `#scanValue` saving/restoring line state and returning its stopping offset.

#### 2.2 `src/compiler/parser/`
- **Root cause of nested multi-line `{ … }` block failure (`src/compiler/parser/layout.ts`, `cursor.ts`, D186):**
  - In `src/compiler/parser/layout.ts`, `placeOfNextLine` checks:
    ```ts
    if (!cursor.separatesItems || cursor.closesEnclosing(next.kind)) {
      return 'outside';
    }
    if (next.kind === cursor.closer) {
      return cursor.ownsCloser ? 'ownCloser' : 'outside';
    }
    ```
  - Because `cursor.closesEnclosing('}')` checks `this.#enclosing.some((region) => region.closer === '}')` *before* checking whether `next.kind === cursor.closer && cursor.ownsCloser`, whenever a multi-line `{ … }` block expression is nested inside another `{ … }` block expression (or inside parentheses that are themselves inside a `{ … }` block), the inner block's own closing `}` on a new line matches the outer block's `'}'` in `#enclosing`! `placeOfNextLine` returns `'outside'` instead of `'ownCloser'`, `moveToItem` refuses to `crossLineBreak()` onto the `}`, `parseEnclosedIn` fails to see `}` (reporting 2002 unclosed `{`), and the outer block prematurely closes on the inner `}`.
  - Checking `if (next.kind === cursor.closer && cursor.ownsCloser) return 'ownCloser'` *before* `cursor.closesEnclosing(next.kind)` (and stopping `closesEnclosing` at a region that `ownsCloser` for a bracket) fixes the root cause.
- **Duplicate `qualifiedPath` extraction in Parser and Binder (`src/compiler/parser/parts/names.ts` vs. `src/compiler/binder/expressions.ts`):**
  - `parser/parts/names.ts` defines `qualifiedPath(expression: Expression): QualifiedName | undefined` (walking non-optional `MemberAccess` chains down to an `Identifier`), and `binder/expressions.ts` defines an identical `qualifiedPathOf(node: MemberAccess): QualifiedName | undefined`. Moving `qualifiedPathOf` into `src/compiler/syntax/expressions/` lets both phases share it.
- **Duplicate postfix step list in `parseSpawn` (`src/compiler/parser/expressions/expression.ts`, D209):**
  - `parseSpawn` hard-codes `const calleeSteps: ReadonlySet<CursorKind> = new Set(['.', '?.', '->', '?->', '[', '{'])` plus a special case for `<` (`parseTypeApplication`), duplicating the postfix subset of `infixParselets`.
- **Two separate field swaps in `Parser.withinTemplateValue` (`src/compiler/parser/parser.ts`, D221):**
  - `withinTemplateValue` swaps `#cursor` and `#endReading` by hand instead of `Cursor` carrying its end-token description alongside `origin`.

#### 2.3 `src/compiler/program/` & `src/compiler/binder/`
- **Path syntax hardcoded in `program.ts` and `binder/diagnostics.ts` (`src/compiler/program/program.ts`, `src/compiler/binder/diagnostics.ts`, D197):**
  - `program.ts` states that the core imposes no path syntax and `ModuleId` is an opaque URL under any scheme, yet `isTestModule(module: ModuleId)` tests `module.endsWith(testModuleSuffix)` on the URL string, and `binder/diagnostics.ts` hard-codes the literal `'.test.ista'` in diagnostic 4015 instead of `testModuleSuffix`.
- **Enclosing async function call (`worker.disposing()`) not bound in Binder (`src/compiler/binder/`, `src/compiler/checker/closures/own-calls.ts`, Q10):**
  - `worker` in `worker.disposing()` is bound by the binder as the `FunctionsEntity` (or outer `VariableEntity`) of `worker`, forcing `OptionalChains.target` in the checker to intercept it, synthesize a hidden `Identifier` and `VariableEntity`, and store `ownCallReadAt(name)` in a side table that lowering must check before `bindings.entityOf`.

---

### Part 3 — Checker: Surface, Types, Inference, Traits, Resolution & Calls (`src/compiler/checker/`)

#### 3.1 `check.ts`, `context.ts`, `program-checker.ts`, `body-checker.ts` & `types/instantiation.ts`
- **Upward type-imports in `context.ts` bypassing layer enforcement (`src/compiler/checker/context.ts`, Q13):**
  - `context.ts` is the foundational checker contract imported by every checker subfolder, yet it type-imports concrete classes (`FunctionScopes`, `OwnCalls`, `ReturnScope`, `EnclosingScopes`, `CollectionForms`, `StructLiterals`, `OptionalChains`, `LabelTargets`, `CheckedPatterns`, `ImplicitCalls`, `Annotations`, `Iterations`, `VariableScope`) from the highest checker layers (`closures/`, `expressions/`, `flow/`, `patterns/`, `resolution/`, `rules/`, `statements/`). Because `.dependency-cruiser.mjs` does not enable type-only dependency checking, these upward dependencies and cycles go unflagged.
- **Side-table proliferation on `CheckedBody` & manual substitution in `instantiatedBody` (`src/compiler/checker/check.ts`, `types/instantiation.ts`, Q1, Q2, Q3, P5):**
  - `CheckedBody` exposes 16 per-feature side-table methods (`typeOf`, `calls`, `madeCalls`, `implicitCallOf`, `collectionFormOf`, `iterationOf`, `fitAt`, `targetsOf`, `assignedOf`, `inCell`, `functionOf`, `sourcesOf`, `patternOf`, `chainOf`, `ownCallReadAt`, `ownCallOf`, `labels`), and `instantiatedBody` (`types/instantiation.ts`) must manually wrap and substitute each typed query (which previously caused `OrPattern` alternatives' types to be missed until `3dfddbc`).
  - `BodyChecker.entityOf` mutates closure capture state as a side effect of name lookup (`this.functions.noteUse(this, name, entity)`, Q2).

#### 3.2 `src/compiler/checker/types/` & `src/compiler/checker/inference/`
- **Duplicate 5-step implicit conversion hierarchy in `types/fitting/fit.ts` and `inference/infer.ts` (D222):**
  - `fitOf` (`types/fitting/fit.ts`) and `Inference.match` (`inference/infer.ts`) implement the exact same 5-way implicit conversion sequence:
    1. Exact / assignable match (`isAssignable` vs. `#matchExact`)
    2. Plain function → `async` function (`fitsAsync` vs. `#matchMadeAsync`)
    3. Value ↔ 1-element tuple (`singleConversion` vs. `#matchSingle`)
    4. Value → `any` trait object (`expected.kind === 'any'` vs. `#convertsInto`)
    5. `T` → `T?` optional wrapping (`optionalInner` recursion)
  - Both modules duplicate the predicates for `fitsAsync`/`#matchMadeAsync` and `singleConversion`/`#matchSingle` because they differ only in how leaf types are compared (`isAssignable`/`sameType` vs. `#matchExact`). Extracting one parameterized conversion matcher eliminates the duplication.
- **Function-type assignability ignores `never` return type (`src/compiler/checker/types/type/index.ts`, D180):**
  - `isAssignable(source, target)` checks `isPrimitive(source, 'never')` only at the top level, and compares function types with `sameShape(first, second, sameType)`. Consequently, a function or lambda whose body always panics (`fn(x: int) -> never`) is rejected where `fn(int) -> string` or `fn(int) -> unit` is expected.
- **`typeText` checks `Optional` by string name instead of entity, and drops alias/shared-struct origins (`src/compiler/checker/types/type-text.ts`, B3, D153):**
  - `nominalText` checks `name === wellKnown.optional.name` (`'Optional'`) by bare string instead of checking the prelude's `Optional` entity, whereas every other module in the checker checks `Optional` by entity.
  - `typeText` also prints `AnonymousStructType` whose `origin` is a `StructDeclaration` (the value `*x` behind a `shared struct`) as `struct { ... }`, producing confusing diagnostics like `Expected struct { value: int }, found struct { value: int }`.
- **Incomplete helpers in `types/well-known.ts` causing scattered `Array` and `Optional` unpacking (Q8):**
  - `types/well-known.ts` defines `futureOf` and `futureArgument`, but has no `arrayOf` / `arrayElement` or `optionalArgument`. As a result, `wellKnownArguments(checker, wellKnown.array, type)?.[0]` is repeated at 7 sites across 6 files, `wellKnownOf(..., wellKnown.array, [T])` at 3 sites, and `wellKnownArguments(..., wellKnown.optional, ...)` at 2 sites alongside `optionalInner` at ~15 sites.

#### 3.3 `src/compiler/checker/traits/`, `resolution/` & `calls/`
- **Hard-coded derived-trait branches and three duplicate type-cycle guards (`src/compiler/checker/resolution/conformance/conformance.ts`, `traits/sendable.ts`, `rules/json-forms/index.ts`, `types/properties/held.ts`, Q7):**
  - `conform` (`resolution/conformance/conformance.ts`) hard-codes an `if (isSendableTrait(...))` branch and an `if (direction !== undefined)` (`codecWitness`) branch before falling through to general trait conformance.
  - Meanwhile, coinductive cycle detection over `checker.typeKeys.typeKey(type)` ("a recursive type meets the property while its parts are being decided") is written three separate times: `deciding` in `traits/sendable.ts`, `#deciding` in `rules/json-forms/index.ts`, and `walked` in `types/properties/held.ts`.
- **Conflated `'none'` outcome in `witnessOf` hiding inner constraint failures (`src/compiler/checker/resolution/conformance/conformance.ts`, `declared-witness.ts`, D173):**
  - `witnessOf` returns `'none'` both when no candidate matches (`choice.kind !== 'chosen'`) and when a chosen candidate's own constraints fail to instantiate (`isFailure(instantiation)`). Consequently, `declaresWitness` treats a declared-but-uninstantiable witness as declared (blocking derived fallback), and `conform` reports that the outer function is missing rather than reporting the unmet inner constraint on its type parameter.
- **Redundant parameter/slot shapes and upward type-imports in `resolution/` (`src/compiler/checker/check.ts`, `types/type/index.ts`, `resolution/choosing/binding.ts`, `resolution/choosing/choice.ts`, D229, D230):**
  - `signatureOf` (`resolution/choosing/choice.ts`) rebuilds `RestSlot` (`restSlotOf`) on every candidate of every call, re-extracting the `Array<T>` element type that `declarations/functions/signatures.ts` already checked.
  - `{ readonly type: Type; readonly reference: boolean }` is duplicated as `ParameterSlot` (`types/type/index.ts`) and `ArgumentSlot` (`resolution/choosing/binding.ts`).
  - `CallArgument`, `Passing`, `Accepts`, and `Inapplicability` sit in `resolution/choosing/choice.ts`, forcing `applicability.ts` and `packs.ts` (which `choice.ts` calls) to type-import upward from `choice.ts`.
- **Incomplete target-typed lambda result inference (`src/compiler/checker/calls/lambda-arguments.ts`, `body-checker.ts`, D160):**
  - While `acceptsOf` recurses through `Tuple`, `ArrayLiteral`, `MapLiteral`, `If`, and `BlockExpression`, `checkDecidedLambdas` only inspects top-level `unparenthesized(node).kind === 'Lambda'`, and `BodyChecker.inferLambda` throws `unreachable` on any non-lambda expression.
- **`callWithTypes` assumes all candidates share the first candidate's arity (`src/compiler/checker/resolution/typed-call.ts`, D122):**
  - `callWithTypes` builds `decided` from `checker.parametersOf(candidates[0].declaration).length`, which would mis-resolve overloaded helpers with different arities.
- **Potential silent failure in `explain` (`src/compiler/checker/calls/resolve.ts`, D217):**
  - When a 1-candidate call fails with `reason.kind === 'arguments'` on a target-typed argument (`argument.type === undefined`), `explain` calls `context.expect(argument.node, expected)`. If `expect` reports no diagnostic, `resolveCall` returns `errorType` with zero diagnostics emitted.

---

### Part 4 — Checker: Patterns, Flow, Rules, Declarations, Closures, Expressions & Statements (`src/compiler/checker/`)

#### 4.1 Order-Dependence & Partial-Type Loss in `agreedAccepts` and `tupleAccepts` (`src/compiler/checker/rules/agreement.ts`, `expressions/literals/collections.ts`, `expressions/tuples.ts`, `rules/branches.ts`, D190)
- **Asymmetric first-producer assumption in `agreedAccepts` (`src/compiler/checker/rules/agreement.ts`):**
  - `agreedAccepts` begins with:
    ```ts
    export function agreedAccepts(producers: readonly (Accepts | undefined)[]): Accepts | undefined {
      if (producers[0] === undefined) {
        return undefined;
      }
      return (expected, isOpen) => producers.every((accepts) => accepts?.(expected, isOpen) ?? true);
    }
    ```
  - Because it checks only `producers[0] === undefined` instead of whether *any* producer needs target typing (`producers.every((a) => a === undefined)`), a collection literal or branching expression whose *first* item has a known type (`"a"`) and whose *second* item is target-typed (`none`, `[]`, a bare variant, or an untyped lambda) returns `acceptsOf === undefined`!
  - Consequently:
    - `f([none, "a"])` and `f(if c: none else: "a")` pass `acceptsOf` and receive `f`'s parameter type (`Array<string?>`, `string?`), checking cleanly.
    - `f(["a", none])`, `same<Array<string?>>(xs, ["a", none])` (**D190**), and `f(if c: "a" else: none)` return `acceptsOf === undefined`, are checked immediately with `expected = undefined`, infer `"a"`'s `string` as `decidedSoFar`, and fail with 5108 (`'none' needs an optional type`)!
- **Dropped known element types inside `agreedAccepts` and `tupleAccepts` (`src/compiler/checker/rules/agreement.ts`, `expressions/tuples.ts`):**
  - In both `agreedAccepts` (`producers.every((accepts) => accepts?.(expected, isOpen) ?? true)`) and `tupleAccepts` (`expected.elements.every((type, index) => elements[index]?.(type, isOpen) ?? true)`), any sibling element that *does* have a type of its own (`accepts === undefined`) evaluates to `?? true` during overload selection!
  - As a result, `[none, "a"]` accepts `Array<int?>` during `choose`, and `(1, none)` accepts `(string, int?)` during `choose`, causing false overload ambiguity (`5003`) whenever overloads differ in the typed sibling's position.
  - **General fix:** In composite expressions (`Tuple`, `ArrayLiteral`, `MapLiteral`, `If`, `Match`, `Select`), if *any* child has `accepts !== undefined`, children with their own type should contribute `(expected, isOpen) => isOpen(expected) || context.checker.fitOf(childType, expected) !== undefined` instead of `?? true`.

#### 4.2 `src/compiler/checker/patterns/`
- **Two stages conflated in `exhaustiveness.ts` `Shape` union & string-encoded array lengths (D224):**
  - `Shape` in `patterns/exhaustiveness/exhaustiveness.ts` combines pre-normalization AST shapes (`or`, `array`) with matrix-specialization shapes (`any`, `constructor`), forcing `Matrix.useful`, `specialize`, and `shapes.ts` `witnessText` to guard against `array` / `or` with `unreachable`.
  - Array-length constructors encode their semantics in strings (`[3]` vs. `[3+]`) and parse them back via `isLongerKey` (`key.endsWith('+]')`).
- **Side-channel `walk.downcasts` map and duplicate `unparenthesized` in `patterns/walk.ts` (D214):**
  - `takeDowncast` writes the narrowed `ValuePart` into `walk.downcasts` keyed by AST node, and `AsPattern` reads it back through a file-private `unparenthesized(node: Pattern)` helper instead of `walk.take` returning the matched `ValuePart` directly.
- **False user diagnostics on prelude-owned pattern and operator helpers (`patterns/matching.ts`, `expressions/access/optionals.ts`, `expressions/literals/collections.ts`, `expressions/templates.ts`, B11):**
  - Calls to toolchain-invariant prelude functions (`_patternItem`, `_patternRest`, `length`, `compare`, `_inclusiveEnd`, `panic`, `join`) go through `implicitCall`, which requires a user-facing `failure: () => Diagnostic` callback that invents impossible user errors if the prelude lacks them.

#### 4.3 `src/compiler/checker/flow/` & `src/compiler/checker/rules/`
- **Ad-hoc recursive AST walks outside `flow/forward.ts` (`rules/annotations.ts`, `rules/disposal.ts`, `rules/suites.ts`):**
  - `flow/forward.ts` provides an exhaustive table-driven control-flow walk for `rules/dropped.ts`, but three other body rules still hand-roll AST walks over `childrenOf` / `bodyChildrenOf`:
    1. `waits(node)` in `rules/annotations.ts` (which also checks `node.kind === 'Select'` without checking `node.awaits`, treating a non-blocking `select:` with `else:` as a waiting statement for `@Waypoint`).
    2. `checkSelfStays` in `rules/disposal.ts` (walking `childrenOf(node)` with parent-chain array slicing).
    3. `firstEffect` in `rules/suites.ts` (walking `bodyChildrenOf(node)` and checking only `body.calls` — missing implicit calls and struct field-default calls in `body.madeCalls()`).
- **Compile-time constant evaluation ignores recorded `Fit` conversions (`src/compiler/checker/rules/computation.ts`, D216):**
  - `Computation.of` never reads `this.#scope.checked.fitAt(node)`. Consequently, `const x: int? = 1` computes bare `1n` instead of `Some{1n}` (breaking `x ?? 0` at runtime), and 1-tuple conversions (`const t: (int,) = 1`) and plain-to-async function conversions (`const f: async fn() -> int = fn(): 1`) produce unconverted values in the Definition's constant table.
- **String-encoded parameter keys in overload clash checking (`src/compiler/checker/rules/clashes.ts`, D219, D223):**
  - `clashes.ts` encodes parameter passing and pack items into strings (`packItemKey = '...'` and `'&' + typeKey`) and parses them back via `!other.startsWith('&')`, and uses `slot.name !== undefined` to distinguish a method's `self` receiver from other parameters (conflating `self` with unnamed function-type parameters).
- **Stale `${name}$` syntax in diagnostic 5702 (`src/compiler/checker/diagnostics/lifetimes.ts`):**
  - `disposeSelfEscapes` (code 5702) still reads: `"In 'dispose', '${name}' can only be used as '${name}$' or passed to an extern function..."`, referencing the removed `x$` syntax instead of `*${name}` / `${name}->f`.

#### 4.4 `src/compiler/checker/expressions/` & `src/compiler/checker/statements/`
- **Duplicated comparison & membership checking across binary operators, chains, and patterns (`src/compiler/checker/expressions/operators.ts`, `patterns/matching.ts`, D226):**
  - `checkBinary` and `checkMembership` resolve binary `<` / `==` / `in` one way (via `resolveOperator`, recording in `body.calls`), while `checkChainedComparison` and `checkLinkCall` resolve chained `a < b == c in d` a second way (via `implicitCall`, recording at `link.right` in `body.implicitCallOf`).
  - Meanwhile, ordering tests in patterns are split across three representations (`compare` test on `CompareFieldPattern`, `bound` test on `RangePattern`, and `length` + implicit `compare` on `ArrayPattern`).
- **Single-target vs. destructuring assignment split and `_ = e` error suppression (`src/compiler/checker/statements/assignments.ts`, `calls/places.ts`, D101, D168):**
  - `_ = e` checks `_` via `assignedPlace`, which returns `errorType`, and then passes `expected = errorType` into `context.expression(node.value, place)`. Because `errorType` fits everything, type errors inside `e` (such as `_ = if c: 1 else: "two"`) are silently suppressed (**D101**).
  - Single-target assignment `x = e` passes `place` as `expected` to `e`, whereas destructuring assignment `a, b = e` checks `e` with `expected = undefined`, rejecting `xs, n = ([], 1)` and `o, n = (none, 1)` (**D168**).
  - Place identity/overlap is computed by string paths in `assignments.ts` (`placeName`, `overlap`) and by binder entities/AST steps in `calls/places.ts` (`rootVariable`, `throughShared`, `reachesAccessor`).

---

### Part 5 — Lowering & Compiler Coordinator (`src/compiler/lowering/`, `src/compiler/compile.ts`)

#### 5.1 Re-Derivation of Checker Facts & Implicit Contracts (`src/compiler/lowering/`)
- **Unrecorded function-value calls relying on `calls.get(node) === undefined` (`src/compiler/lowering/expressions/calls.ts`, Q1):**
  - `lowerCall` treats `context.body.calls.get(node) === undefined` as meaning "call `node.callee` as a closure value" (`lowerValueCall`). Any checker path that forgets to record a resolved call silently compiles into a closure call instead of failing an invariant check.
- **Re-deriving struct field indices and `any` field dispatches in lowering (`src/compiler/lowering/parts/places.ts`, `expressions/structs/structs.ts`, `trait-objects/trait-objects.ts`, Q12, Q19):**
  - `lowerFieldRead` (`lowering/expressions/structs/structs.ts`) re-inspects `base.kind === 'any'` and otherwise calls `fieldIndexOf` (`lowering/parts/places.ts`), which re-runs `fieldsOf(type).findIndex(...)`.
  - Because `x.f(...)` on a function-typed struct field never checks `x.f` (`MemberAccess`) as an expression in the checker, `lowerFieldRead` and `fieldIndexOf` take a `link: Expression = node` workaround parameter to look up `chainOf(link)?.base`.
  - `anyFieldEntry` (`lowering/trait-objects/trait-objects.ts`) re-scans `on.constraints` with a local `isField` predicate (instead of `requiredFields`) and looks up `(checker.fieldsOf(type) ?? []).findIndex(...)` without guarding against `-1`.
- **Bidirectional import cycle between `function-lowering/` and `boundary/` (`src/compiler/lowering/function-lowering/index.ts` ↔ `src/compiler/lowering/boundary/starts.ts`, Q12):**
  - `function-lowering/index.ts` imports `emitInbound` and `Inbound` from `boundary/inbound.ts` to implement `FunctionLowering.lowerStart`, while `boundary/starts.ts` imports `instanceLowering`, `nestedLowering`, and `StartEdges` from `function-lowering/index.ts`.

#### 5.2 Duplication & Edge Cases in Construct Lowering (`src/compiler/lowering/`)
- **Copy-pasted `buildVariant` in `optionalInt` (`src/compiler/lowering/expressions/collections/collections.ts` vs. `variants.ts`):**
  - `optionalInt` in `lowering/expressions/collections/collections.ts` manually allocates a register, looks up `tables.types.index(optional)` and `variantIndexOf(context.checker, optional, name)`, and emits `{ kind: 'variant', ... }`, duplicating `buildVariant` from `lowering/expressions/structs/variants.ts` (from which `collections.ts` already imports `variantIndexOf`).
- **Three copies of comparison/equality/negation emission (`src/compiler/lowering/expressions/operators.ts` vs. `lowering/parts/patterns.ts`, D226):**
  - `lowerBinary` (`operators.ts`), `compared` (`operators.ts` for `ChainedComparison`), and `passed` (`patterns.ts` for pattern tests) all emit `equal` + `not` and `compare` + `order` separately, with `patterns.ts` defining its own local `equal` helper.
- **Case-less `select` with `else:` emits invalid bytecode (`src/compiler/lowering/expressions/control/select.ts`, D149):**
  - `select:\n  else: v` passes type-checking, and `lowerSelect` emits a `select` instruction with `cases: []`, which fails Definition schema validation (`cases: z.array(selectCase).min(1)` in `definition/instructions/suspension.ts`).
- **Spread elements cannot wrap `T` into `T?` (`src/compiler/lowering/expressions/collections/collections.ts`, `checker/expressions/collections/collections.ts`, B8):**
  - `[0, ...xs]` where `xs: Array<int>` and `Array<int?>` is expected is rejected because a spread copies or iterates its items without per-item conversion/wrapping.
- **10-kind closed worklist in `DefinitionTables` (`src/compiler/lowering/tables/tables.ts`, `lower.ts`):**
  - `PendingEntry | ClosingEntry` hard-codes 10 entry kinds (`instance`, `nested`, `hostNative`, `constantNative`, `externConstant`, `start`, `asyncFit`, `dispatch`, `anyConversion`, `anyField`), each with its own indexing method on `DefinitionTables` and dispatch arm in `lower.ts`.

---

### Part 6 — Runtime: Interpreter, Scheduler, Lifetimes, Snapshot, Boundary & Testing (`src/runtime/`)

#### 6.1 Heap Object Registries, Root Rules & Lifetimes (`src/runtime/snapshot/`, `lifetimes/`, `scheduler/`)
- **Inconsistent root rules across 6 sites (`src/runtime/scheduler/instance/index.ts`, `segment/index.ts`, `heap.ts`, `lifetimes/holders.ts`, `lifetimes/orphans.ts`, D165, D198):**
  - `scheduler/instance/index.ts` defines `isRoot(object)` as `object.kind === 'execution' || object.kind === 'answer'`, and `segment/index.ts` passes `answers()` in `#roots()`.
  - However, `lifetimes/holders.ts` (`holdsOf`, `valuesOf`), `lifetimes/orphans.ts` (`orphansFrom`), and `scheduler/heap.ts` (`#noteHoldings`) check only `object.kind === 'execution'`, ignoring `'answer'`.
- **Two different patterns for exhaustive `HeapObject['kind']` tables (`src/runtime/snapshot/check.ts` vs. `holdings.ts` & `lifetimes/disposal.ts`, D165):**
  - `snapshot/check.ts` uses `Handlers` from `src/structures/kind-table.ts`, while `snapshot/holdings.ts` and `lifetimes/disposal.ts` hand-roll mapped types with unsafe `as` casts in `entryOf` / `stateEntry`, and `FutureState` is defined in both `scheduler/futures.ts` and `snapshot/holdings.ts`.
- **Ambiguous `weakRef` with `target: undefined` & mixed id/handle API on `WeakSide` (`src/runtime/snapshot/objects.ts`, `scheduler/weak-side.ts`, `scheduler/native-calls.ts`, D115, D116):**
  - A `weakRef` with `target === undefined` represents both a disposed referent (`w.disposed()` resolves immediately) and a returned async call (`worker.disposing()` never resolves); the persisted state cannot distinguish them.
  - `WeakSide` takes/returns object IDs (`number`) on `reference`, `target`, `disposed`, and `onReturned`, but `Value` handles on `watch` and `whenDisposed`, forcing `nativeWeakSideOf` to adapt two methods and forward two.

#### 6.2 Scheduler, Mocks, Test World & Seam Boundaries (`src/runtime/scheduler/`, `testing/`, `natives.ts`)
- **Same-instance mock calls bypass `arriving`, breaking resource disposal in tests (`src/runtime/scheduler/mocks.ts`, D182):**
  - When a child instance calls a mock held by a parent test (`relayCall`), the result passes through `arriving(instance, given.value)`, wrapping any disposable host extern (`isResourceType`) into a heap `resource` object so its `dispose` mock runs when dropped.
  - When code in the test's *own* instance calls a mock held by the test's own instance (`mockedCall`), `arriving` is never called: `testing.handle<T>()` stays a raw `{ kind: 'extern' }` value and is never disposed.
- **Uncached snapshot decoding in `storedEnds` vs. cached `#snapshotOf` in `World` (`src/runtime/scheduler/instance-ends.ts` vs. `testing/world/index.ts`, D184, D212):**
  - `World.#snapshotOf` caches `{ text, snapshot }` per instance so unchanged snapshots are parsed once, whereas `storedEnds` (`scheduler/instance-ends.ts`) calls `snapshotFormat.read(text)` (full Zod validation + reference check) on every watched instance at the start of every segment.
  - `World` also queries `snapshot.objects` inline in three places (`#withdrawAnswersTo` twice and `#watchHolds`) with inconsistent status checks.
- **Bag-of-optionals `AdvanceFirst` & incomplete `replayOf` (`src/runtime/scheduler/wake.ts`, D199):**
  - `AdvanceFirst` has three mutually exclusive optional fields (`arrival`, `answering`, `withdrawn`) instead of a discriminated union, and `replayOf` only preserves `arrival` on panic.
- **Production scheduler branches on optional `LoadedDefinition.world?` (`src/runtime/scheduler/wake.ts`, `mocks.ts`, `native-calls.ts`, D176):**
  - Instead of a null-object `TestWorld` for production runtimes, the scheduler checks `loaded.world !== undefined` across three modules.
- **Upward type-imports in `runtime/natives.ts` (`src/runtime/natives.ts`, D179) & duplicate `namedType` in `native-calls.ts` (Q17):**
  - `runtime/natives.ts` (imported by every `stdlib/` module) type-imports `TestWatch` from `scheduler/futures.ts` and `Inspection` from `scheduler/inspect.ts`.
  - `scheduler/native-calls.ts` defines a private `namedType(type: TypeReference): TypeId | undefined` beside `definition/declared-values.ts`'s throwing `namedType`.
- **Unbounded call-frame stack in the VM (`src/runtime/scheduler/segment/index.ts`, `limits.ts`, D155):**
  - Because `SegmentRunner.call` allocates frames on the heap (`execution.frames` and `#runStack`), unbounded recursion (`fn loop(): loop()`) grows the array until V8 crashes with out-of-memory instead of throwing a `Panic` at a maximum frame depth in `limits.ts` (the way `requireDepth` bounds value nesting at `maximumDepth`).
- **Spawned instance outcomes lack JSON encoding for host inspection (`src/runtime/boundary/outbound.ts`, `compiler/lowering/expressions/calls.ts`, B4):**
  - Unlike host-started functions (which run through start entries that encode their outcome to `Json`), `spawn` invokes the function or filling entry directly, so `DeployedProgram.outcome` / `outcomeText` throws `Refusal('noJsonForm')` on a spawned instance's finished state.

---

### Part 7 — Standard Library, CLI & Documentation (`src/stdlib/`, `src/cli/`, `docs/`)

#### 7.1 `src/stdlib/`
- **Duplicate time-unit constants between Scanner and `stdlib/time/iso.ts` (`src/compiler/scanner/numbers.ts` vs. `src/stdlib/time/iso.ts`):**
  - Both `scanner/numbers.ts` and `stdlib/time/iso.ts` define `millisecondsPerSecond = 1000n`, `secondsPerMinute = 60n`, `minutesPerHour = 60n`, `hoursPerDay = 24n`, `millisecondsPerMinute`, and `millisecondsPerHour`. Moving these constants to `src/language/` gives the language's time units one home.
- **Duplicate `compareOrdered` vs. `compareCodeUnits` (`src/stdlib/prelude/natives.ts` vs. `src/language/values.ts`):**
  - `compareOrdered` in `stdlib/prelude/natives.ts` and `compareCodeUnits` in `language/values.ts` have identical implementations (`if (left === right) return 0; return left < right ? -1 : 1;`).
- **Scattered `Instance<T>` handle construction and extraction (`src/runtime/interpreter/instructions.ts`, `stdlib/prelude/instance-natives.ts`, `stdlib/runtime/natives.ts`, `stdlib/testing/natives.ts`, Q18):**
  - Knowledge that `Instance<T>` is an extern value whose `payload` is the instance name string is spread across 4 modules instead of `NativeInstances.spawn` returning the `Instance<T>` value directly and one helper reading it.
- **Positional `fieldOf` on struct values in `regex/natives.ts` & manual `Json.Object` construction in `json/natives.ts` (Q17, D201):**
  - `regex/natives.ts` (`programOf`) reads `Regex.pattern` positionally via `fieldOf(regex, 0)` instead of `fieldNamed(context, regex, 'pattern')`.
  - `json/natives.ts` (`_object`) manually constructs `{ kind: 'variant', type: shape.type, variant: shape.variants.Object, fields: [mapOf(entries)] }` instead of using `declared-values.ts` / `resultVariant`.
- **Full-string `[...s]` allocation in `prelude/strings.ts` and `strings/natives.ts` (D195):**
  - `prelude/strings.ts` (`length`, `at`, `index`) and `strings/natives.ts` (`slice`, `padding`) call `codePoints(text(s))` (allocating an array of single-code-point strings), even though `text/code-points.ts` already provides $O(1)$-space `utf16Offset` and `codePointWidth`.
- **Unbounded precision in `decimal` `dividedTo` and negative `power` (`src/stdlib/decimal/arithmetic.ts`, D194):**
  - `placesOf` allows up to `maximumDigits = 1e9`, so `decimal.divide(Decimal(1), 7, 20_000_000)` stalls the host thread for >60s, and `power(base, -exponent)` computes the exact positive power up to $10^9$ digits before dividing to 34 digits.
- **Repeated test-setup boilerplate for `FakeClock` and revertible `FakeQueue` receipts (`src/stdlib/testing/testing.ista`, `test/spec-suites/purchase.test.ista`, F2, D183, D188):**
  - Installing `FakeClock` requires mocking both `time.now` and `time.at` by hand in every suite (`futures.test.ista`, `purchase.test.ista`).
  - `FakeQueue` lacks built-in receipt tracking for host revertible sends (`_sendRevertible` + `dispose`), forcing `purchase.test.ista` to implement `Receipts` and per-queue filtering manually.

#### 7.2 `src/cli/` & `docs/`
- **Coupling compiler `stdlibLoader` to runtime natives (`src/stdlib/std-modules.ts`, `stdlib-loader.ts`, Q14):**
  - `std-modules.ts` bundles each std module's `.ista` source with its `natives.ts` implementation, so importing `stdlib-loader.ts` (used by the compiler to load `.ista` sources) pulls in all runtime natives (`decimal.js`, `re2js`, `temporal-polyfill`, `node:crypto`).
- **Missing `ista.json` project-root discovery in `cli/project.ts` (F1) & missing store/compiler package exports (B7):**
  - `cli/project.ts` always sets `projectRoot: cwd` instead of walking up to `ista.json` (§3.13).
  - `package.json` exports `./runtime` and `./stdlib`, but not `memoryStore` / `directoryStore` or `./compiler`.
- **Untested code examples in `docs/guide.md` & non-exhaustive spec fence assertions (`docs/guide.md`, `test/corpus/spec-examples.ts`, `src/compiler/checker/check.test.ts`, B2, D202):**
  - `docs/guide.md` contains 16 fenced code blocks that `test/corpus/spec-examples.ts` does not parse or check, and `check.test.ts` only asserts that `docs/spec.md` fences do not throw during checking rather than asserting zero unexpected diagnostics.

---

## Synthesis by Audit Question

### 1. Narrow Solutions That Can Be Extracted, Generalized & Used on a Wider Scope

1. **Unified Implicit-Conversion Matcher (`src/compiler/checker/types/fitting/fit.ts` & `src/compiler/checker/inference/infer.ts`, D222):**
   - Both `fitOf` and `Inference.match` implement the exact same 5-step conversion hierarchy (exact/assignable → plain-to-async function → 1-tuple ↔ element → `any` trait object → `Optional` wrapping), differing only in how leaf types compare. Extracting one parameterized conversion matcher makes adding or changing an implicit conversion a single-file edit.
2. **Whole-Body AST / Control-Flow Analysis (`src/compiler/checker/flow/forward.ts` vs. `rules/annotations.ts`, `rules/disposal.ts`, `rules/suites.ts`):**
   - `flow/forward.ts` models intra-function control flow (skipping nested functions via `nestsFunction`), while `waits` (`annotations.ts`), `checkSelfStays` (`disposal.ts`), and `firstEffect` (`suites.ts`) each hand-roll recursive AST walks over `childrenOf` / `bodyChildrenOf`.
3. **Coinductive Type-Graph Traversal (`src/compiler/checker/traits/sendable.ts`, `rules/json-forms/index.ts`, `types/properties/held.ts`, `declarations/layout/struct-rules.ts`, Q7):**
   - Four modules walk composite/nominal `Type` graphs with their own visited-set cycle guards (`deciding`, `#deciding`, `walked`, `seen`). Extracting a cycle-safe type-graph reducer unifies all four.
4. **Comparison & Membership Checking and Lowering (`src/compiler/checker/expressions/operators.ts`, `patterns/matching.ts`, `src/compiler/lowering/expressions/operators.ts`, `lowering/parts/patterns.ts`, D226):**
   - Binary comparisons/memberships (`a < b`, `x in c`), chained comparisons (`a < b in c`), and pattern ordering tests (`amount > 1000`, `1..=5`, `[a, ...rest]`) are checked and lowered through three separate code paths. Unifying them into one `ComparisonLink` / ordering helper eliminates the triplication.
5. **Declared-Value Field & Variant Readers (`src/definition/declared-values.ts` vs. `stdlib/native-values.ts`, `definition/json-values.ts`, `runtime/testing/run-tests.ts`, Q16, Q17, D201):**
   - `declared-values.ts` builds structs and variants by declared name, but lacks `fieldValueOf` (reading a struct field by name) and keeps `variantShape` private, causing 3 other modules to re-implement field/variant index lookup.

### 2. Solutions Hard-Coded for Specific Types Instead of Generic Mechanisms

1. **Derived Trait Conformance Hard-Coded for `Sendable`, `Encodable`, and `Decodable` (`src/compiler/checker/resolution/conformance/conformance.ts`, Q7):**
   - `conform` hard-codes `if (isSendableTrait(...))` and `if (direction !== undefined)` (`codecWitness`), while `Disposable` is resolved through a separate ad-hoc path in `rules/disposal.ts` (`runtimeDisposes` / `declaredDispose`). Replacing these with a derived-trait registry keyed by `WellKnownDeclaration` makes trait derivation uniform and extensible.
2. **`@JsonBigInt` Hard-Coded to Bare `int` (`src/compiler/checker/rules/annotations.ts`, `rules/json-forms/index.ts`, Q9):**
   - `@JsonBigInt` is restricted to `place.type.kind === 'primitive' && place.type.name === 'int'`, even though `JsonField.codec` is already a general per-field `{ write: FunctionCall; read: FunctionCall }` override.
3. **`typeText` Hard-Coding `'Optional'` by String Name (`src/compiler/checker/types/type-text.ts`):**
   - `nominalText` checks `name === wellKnown.optional.name` (`'Optional'`) by string rather than by the prelude's `Optional` entity.

### 3. Tricky Parts of the Spec That Could Be Generalized

1. **Bidirectional Target-Typing of Composite Arguments (`src/compiler/checker/rules/agreement.ts`, `expressions/tuples.ts`, `calls/lambda-arguments.ts`, D160, D168, D190):**
   - Target-typed argument checking (`Accepts`), lambda return-type inference (`checkDecidedLambdas`), and destructuring assignment (`checkAssignment`) are three partial solutions to one problem: propagating expected types into composite expressions (`Tuple`, `ArrayLiteral`, `MapLiteral`, `If`, `Match`, `Select`).
   - Because `agreedAccepts` returns `undefined` whenever `producers[0]` has a known type, `f(["a", none])` fails while `f([none, "a"])` succeeds; because `agreedAccepts` and `tupleAccepts` replace typed siblings with `?? true`, `[none, "a"]` and `(1, none)` lose their known element types during overload resolution; and because `checkDecidedLambdas` only checks top-level lambdas, a lambda inside a tuple or branch never binds call type parameters.
2. **Compile-Time Constant Evaluation Ignoring Recorded `Fit`s (`src/compiler/checker/rules/computation.ts`, D216):**
   - Top-level constants (`const x: int? = 1`, `const t: (int,) = 1`, `const f: async fn() -> int = fn(): 1`) are type-checked with full implicit conversions (`fitAt`), but `computeConstant` ignores `fitAt` and emits the unconverted value.
3. **`shared struct` (`isShared`) and `new X{…}` (`isNew`) as Boolean Flags on `StructDeclaration` / `StructLiteral` (`src/compiler/syntax/`, `definition/types.ts`, Q4):**
   - Modelling `shared struct` as a boolean flag on `StructDeclaration` and `role: 'cell'` (shared with `_Cell<T>`) forces ~12 special-case checks across the compiler and runtime.

### 4. Modularity: Are Phases Standalone Plugin Registries?

- **Within each phase's AST / bytecode dispatch: Yes.**
  - Parser (`prefixParselets`, `infixParselets`, `typeParselets`, `patternParselets`, `statementParselets`, `topLevelParselets`), Binder (`declarationHandlers`, `statementHandlers`, `expressionHandlers`, `patternHandlers`, `typeHandlers`), Checker (`declarationHandlers`, `statementHandlers`, `expressionHandlers`, `acceptsHandlers`, `typeHandlers`, `patternHandlers`, `flow/forward.ts` `constructs`), Lowering (`expressionHandlers`, `statementHandlers`), Definition (`operandTable`, `instruction-rules.ts`), and Runtime (`interpreter/instructions.ts`) all use exhaustive `Handlers` tables.
- **Where plugin modularity still breaks down:**
  1. **`CheckedBody` / `BodyContext` / `instantiatedBody` (`src/compiler/checker/check.ts`, `context.ts`, `types/instantiation.ts`, Q3, Q13):** Every feature adds side-table methods to `CheckedBody`, concrete class imports to `context.ts`, and manual substitution wrappers to `instantiatedBody`.
  2. **`DefinitionTables` worklist (`src/compiler/lowering/tables/tables.ts`, `lower.ts`):** `PendingEntry | ClosingEntry` is a closed 10-variant union with 10 separate indexing methods.
  3. **Runtime `HeapObject` tables (`src/runtime/snapshot/holdings.ts`, `lifetimes/disposal.ts`, `snapshot/check.ts`, D165, D198):** Split across 3 files with 2 different table patterns and 6 inconsistent `isRoot` checks.

### 5. Cross-Module Dependencies on Extractable Shared Solutions

1. **`qualifiedPath` in Parser and Binder (`src/compiler/parser/parts/names.ts` & `src/compiler/binder/expressions.ts`):** Identical functions walking non-optional `MemberAccess` chains to an `Identifier`; belongs in `src/compiler/syntax/expressions/`.
2. **Time unit constants in Scanner and Stdlib (`src/compiler/scanner/numbers.ts` & `src/stdlib/time/iso.ts`):** Identical millisecond conversion constants; belongs in `src/language/`.
3. **Ordered primitive comparator in Language and Stdlib (`src/language/values.ts` `compareCodeUnits` & `src/stdlib/prelude/natives.ts` `compareOrdered`):** Identical `<` / `===` comparator.
4. **Canonical JSON & Versioned Format Envelope in `definition/` (`src/definition/codec.ts`, `format.ts`):** Generic persistence utilities used by `definition/`, `runtime/snapshot/`, and `runtime/boundary/extern-signatures.ts`.
5. **Upward Type-Imports in Contracts (`src/compiler/checker/context.ts` [Q13], `src/compiler/checker/resolution/choosing/choice.ts` [D230], `src/runtime/natives.ts` [D179]):** Root contract modules importing types from upper implementation modules.

### 6. Summary of DRY Violations & Double Standards

| Concept / Rule | Home 1 | Home 2 (+ others) |
| --- | --- | --- |
| 5-step implicit conversion (`Fit` vs. `Inference`) | `checker/types/fitting/fit.ts` (`fitOf`) | `checker/inference/infer.ts` (`Inference.match`) (D222) |
| Binary vs. chained vs. pattern comparisons | `checker/expressions/operators.ts` (`checkBinary`) & `lowering/expressions/operators.ts` (`lowerBinary`) | `checkChainedComparison` / `compared` & `patterns/matching.ts` / `lowering/parts/patterns.ts` (D226) |
| Module-qualified name `${module}.${name}` | `language/well-known.ts` (`qualifiedName`) | `lowering/tables/names.ts` (`qualifiedNameOf`), `definition/extern-key.ts` (`externKey`) (D174) |
| Member-access chain → `QualifiedName` | `parser/parts/names.ts` (`qualifiedPath`) | `binder/expressions.ts` (`qualifiedPathOf`) |
| Millisecond time unit constants | `scanner/numbers.ts` | `stdlib/time/iso.ts` |
| `<` / `===` ordered comparator | `language/values.ts` (`compareCodeUnits`) | `stdlib/prelude/natives.ts` (`compareOrdered`) |
| Reading a struct `Value`'s field by name | `stdlib/native-values.ts` (`fieldNamed`) | `runtime/testing/run-tests.ts` (`listedOf`), positional `fieldOf` in `regex/natives.ts` (Q16, Q17, D201) |
| Narrowing a closure `Value` | `isComposite(v) && v.kind === 'closure'` at 7 sites | No `closureOf(v)` in `definition/values.ts` (Q15) |
| `Instance<T>` extern payload construction/reading | `interpreter/instructions.ts` (`spawn`) | `stdlib/runtime/natives.ts`, `stdlib/testing/natives.ts`, `stdlib/prelude/instance-natives.ts` (Q18) |
| Unpacking `Array<T>` element type in checker | `wellKnownArguments(checker, wellKnown.array, type)?.[0]` at 7 sites | No `arrayElement` helper in `checker/types/well-known.ts` (Q8) |
| What heap objects are roots | `scheduler/instance/index.ts` (`'execution' \| 'answer'`) | `lifetimes/holders.ts`, `lifetimes/orphans.ts`, `scheduler/heap.ts` (`'execution'` only) (D165, D198) |
| Building an `Optional<int>` variant in lowering | `lowering/expressions/structs/variants.ts` (`buildVariant`) | `lowering/expressions/collections/collections.ts` (`optionalInt`) |
| Unparenthesizing AST nodes | `syntax/expressions/index.ts` (`unparenthesized`) | `checker/patterns/walk.ts` (private `unparenthesized` for patterns) (D214) |

### 7. Language Pitfalls Solved vs. Pitfalls Remaining

#### Solved Compared to Other Languages
- **Durable execution without replay non-determinism (vs. Temporal / Durable Functions):** Call frames, registers, and heap objects are serialized as data at every `await`; `now()` is pinned per segment; `random` uses a persisted HMAC-SHA-256 counter seed; extern constants are pinned on first read; maps preserve insertion order.
- **Value semantics without hidden aliasing (vs. JS / Python / Go / Java):** Structs, arrays, maps, and tuples are deeply immutable values; mutation requires explicit `&` or `shared struct` (`*x`, `x->f`).
- **Deterministic cycle-collecting resource disposal without GC finalizers or `Rc` leaks (vs. Rust `Rc`, Python/Go/JS):** Reachability-based orphan collection at every scope/statement release point using Tarjan SCC (`orphans.ts`) disposes cycles newest-first and holders before held objects.
- **Coherent structural traits without orphan-instance incoherence (vs. Scala implicits / Haskell orphans):** Witness lookup (`resolution/choosing/candidates.ts` `witnessCandidates`) searches only functions declared beside the argument types or beside the trait, guaranteeing global coherence across modules.
- **Lazy cursor iteration without eager array allocation (vs. M3 `iterate -> Array<T>`):** `Iterable<T>` returns a persistable closure cursor `fn() -> T?`, so `for i in 0..1_000_000_000` allocates $O(1)$ state in snapshots.
- **Trait-based JSON boundary (`Encodable` / `Decodable`) with arbitrary-precision `int`:** No 53-bit `Number` truncation, canonical key sorting, and compiler-derived codecs for structs, enums, and tuples when none are declared.

#### Remaining Pitfalls
1. **Quadratic immutable collection construction ($O(N^2)$ `push`, comprehensions, and map inserts — P2):** Because `Array` and `Map` are backed by copied JS arrays, building a 20k-element array in a comprehension or loop copies the array on every step.
2. **Unbounded recursion and huge string/decimal operations can OOM/stall the host V8 process (D155, D194, D195):** No call-frame depth limit in the VM (`SegmentRunner.call`), `[...s]` allocation in `codePoints(s).length`, and `1e9` max digits in `decimal.divide`.
3. **Copy-in / write-back aliasing window on `&container[key]` and `&*shared`:** During a synchronous call `f(&m[k])`, `m[k]` is copied into a temporary cell and written back via `setIndex` only after `f` returns; observing `m` inside `f` sees the pre-call value.
4. **Full-snapshot JSON encode+decode round-trip on every commit (P1, D212):** Every `await` serializes the entire snapshot through Zod + canonical JSON and immediately re-parses it, dominating scheduler runtime on high-frequency messaging workloads.

---

## Prioritized Refactoring & Bug-Fix Sequence (Leaves → Root)

| Priority | Item & Location | Kind | Blast Radius | Effort |
| --- | --- | --- | --- | --- |
| **1** | **Fix nested multi-line `{ … }` block parsing (`src/compiler/parser/layout.ts` `placeOfNextLine`, D186):** Check `next.kind === cursor.closer && cursor.ownsCloser` before `cursor.closesEnclosing(next.kind)`. | Bug Fix (Parser) | 2 files (`layout.ts`, `cursor.ts`) | S |
| **2** | **Fix `agreedAccepts` & `tupleAccepts` order-dependence and partial-type loss (`src/compiler/checker/rules/agreement.ts`, `expressions/tuples.ts`, `expressions/literals/collections.ts`, D190):** Trigger target-typing when *any* producer has `accepts !== undefined`, and check typed siblings against `expected` instead of `?? true`. | Bug Fix / Generalization (Checker) | 4 files in `checker/` | S |
| **3** | **Fix `_ = e` error suppression & destructuring assignment expected types (`src/compiler/checker/statements/assignments.ts`, D101, D168):** Don't pass `errorType` as `expected` for `_ = e`, and propagate target types into destructuring assignments. | Bug Fix (Checker) | 2 files in `checker/statements/` | S |
| **4** | **Apply recorded `Fit` conversions in compile-time constant evaluation (`src/compiler/checker/rules/computation.ts`, D216):** Wrap `Some`, convert 1-tuples, and refuse/convert async fits on top-level `const` values. | Bug Fix (Checker) | 2 files in `checker/` | S |
| **5** | **Fix same-instance mock return values bypassing `arriving` (`src/runtime/scheduler/mocks.ts`, D182):** Pass same-instance mock results through `arriving` so `testing.handle<T>()` resources are disposed. | Bug Fix (Runtime) | 2 files in `runtime/scheduler/` | S |
| **6** | **Fix case-less `select:` with `else:` (`src/compiler/lowering/expressions/control/select.ts`, D149) & stale `${name}$` in diagnostic 5702 (`src/compiler/checker/diagnostics/lifetimes.ts`):** Lower 0-case `select` directly to its `else` body; update 5702 message to `*${name}`. | Bug Fix (Lowering / Diagnostics) | 2 files | XS |
| **7** | **Guard host process against VM frame-depth OOM, `[...s]` string-length OOM, and unbounded `decimal` places (`src/runtime/scheduler/segment/limits.ts`, `src/text/code-points.ts`, `src/stdlib/decimal/arithmetic.ts`, D155, D194, D195):** Enforce max frame depth in `SegmentRunner.call`, add $O(1)$-space `codePointCount`, and cap `decimal` places. | Resilience / Safety | 5 files | S |
| **8** | **Leaf DRY extractions (`qualifiedName` [D174], `qualifiedPath`, time-unit constants, `compareOrdered`, `closureOf` [Q15], `fieldValueOf` in `declared-values.ts` [Q16, Q17, D201], `optionalInt` → `buildVariant`, `arrayElement` in `types/well-known.ts` [Q8]):** Deduplicate leaf helpers from foundation upward. | DRY | ~18 leaf files | S |
| **9** | **Unify 5-step implicit conversion logic between `types/fitting/fit.ts` and `inference/infer.ts` (D222) + `never` return type assignability (D180):** Extract shared conversion matcher parameterized by leaf comparison. | Generalization / DRY | 3 files in `checker/` | M |
| **10** | **Unify comparison & membership checking and lowering (`expressions/operators.ts`, `patterns/matching.ts`, `lowering/expressions/operators.ts`, `lowering/parts/patterns.ts`, D226):** One checker function and one lowering function over `ComparisonLink` and pattern ordering tests. | DRY / Generalization | 4 files in `compiler/` | M |
| **11** | **Unify runtime `HeapObject` kind tables, `isRoot`, and `WeakSide` handle surface (`src/runtime/snapshot/holdings.ts`, `lifetimes/`, `scheduler/`, D115, D116, D165, D198):** One `isRoot(object)` in `holdings.ts`, `Handlers` for all kind tables, and consistent handle/id methods on `WeakSide`. | Architecture / DRY | 6 files in `runtime/` | M |
| **12** | **Remove upward type-imports in contracts (`checker/context.ts` [Q13], `checker/resolution/choosing/choice.ts` [D230], `runtime/natives.ts` [D179]) and enable type-import cycle checking:** Move shared vocabularies to lower modules. | Layering / DIP | 8 files | M |

