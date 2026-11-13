# `src/compiler/checker/constructs` — DRY & Architecture Findings

### [high] Three parallel struct-literal item loops and three parallel struct-comprehension pass loops
- where: `src/compiler/checker/constructs/expressions/structs/literal-fields/items.ts:96-137`, `src/compiler/checker/constructs/expressions/structs/structs.ts:302-335`, `src/compiler/checker/constructs/expressions/structs/struct-comprehensions.ts:84-209, 236-323`
- evidence:
  - Struct literal items (`node.items`) are walked, validated for duplicate field names (`checkerDiagnostics.repeatedField`), checked for misplaced spreads/positional items, recorded via `context.recordField`, and turned into `FieldSource`s in **three separate loops**:
    1. `checkLiteralFields` -> `checkItem` (`literal-fields/index.ts:95-97`, `literal-fields/items.ts:96-137`) + `sourcesOf` (`literal-sources.ts:80-106`) for known/declared shapes.
    2. `freshAnonymous` (`structs.ts:302-335`) for untyped `struct{…}` literals: manually loops `for (const item of node.items)`, checks `given.some((each) => each.name === item.name.text)` to report `checkerDiagnostics.repeatedField`, rejects `Spread`/`PositionalInitializer`, builds `{ field, source }` pairs, sorts with `inFieldOrder`, and calls `context.literals.record`. (Note: `freshAnonymous` forgets to call `context.recordField(item.name, field)`, unlike `checkItem` and `checkNamedItem`!)
    3. `checkOpaqueComprehended` -> `checkNamedOf` -> `checkNamedItem` (`struct-comprehensions.ts:281-323`) for `struct{…}` building a mapped/opaque struct type: manually loops `for (const item of node.items)`, checks `keys.some((each) => sameType(each, key))` to report `checkerDiagnostics.repeatedField` or `unknownField`, calls `context.recordField`, and builds `FieldSource[]`. Worse, in `checkNamedOf` (`struct-comprehensions.ts:286-288`), `if (item.kind === 'PositionalInitializer' || item.kind === 'Spread')` sets `fits = false` without reporting any diagnostic — if the comprehension's subject already covers `expected`'s keys (`givesKeysOf` is true), the misplaced spread/positional initializer is silently accepted with zero diagnostics!
  - Similarly, `struct-comprehensions.ts` has **three separate `inFieldPasses` callbacks** that duplicate field-pass validation:
    1. `checkComprehended` / `comprehendedField` (`struct-comprehensions.ts:84-136`): checks `visits.kind === 'others'` -> `comprehendedFieldsUnknown`, `visits.kind === 'field'` -> `unknownField` or `repeatedField`.
    2. `freshComprehended` (`struct-comprehensions.ts:180-209`): checks `visits.kind === 'others'` -> `comprehendedFieldsUnknown`, `visits.kind === 'field'` -> `repeatedField`.
    3. `checkOpaqueComprehended` (`struct-comprehensions.ts:236-269`): checks `visits.kind === 'field'` -> `repeatedField`.
- proposal: Unify struct item checking and struct comprehension pass checking into one parameterized item/comprehension pass walker in `expressions/structs/literal-fields/` that takes a field-lookup strategy (known `FieldMember[]`, opaque `fieldType(expected, key)`, or fresh anonymous field creation), reporting misplaced spreads/positional items, duplicate fields (`repeatedField`), and `context.recordField` in one place.
- confidence: high

### [high] `TypeParameters` duplicates `resolveConstraintSet`, runs `impliedConstraints` twice per parameter, and splits `memberOf` across three places
- where: `src/compiler/checker/constructs/declarations/type-parameters.ts:76-119, 247-317`, `src/compiler/checker/constructs/declarations/declarations.ts:65-83, 169-179`, `src/compiler/checker/types/traits/struct-keys.ts:122-147`, `src/compiler/checker/wiring/program/program-checker.ts:325-327`
- evidence:
  - `type-parameters.ts:43` already imports `resolveConstraintSet` from `../../types/traits/struct-constraints.ts` and uses it in `resolveAssociatedBounds` (line 253: `const bounds = resolveConstraintSet(checker, module, requirement.constraints, () => self);`).
  - Immediately below (lines 293-317), `type-parameters.ts` re-implements `resolveConstraintSet`'s two branches by hand as `resolveConstraints` and `resolveStructConstraints`:
    ```ts
    function resolveConstraints(checker: CheckerContext, module: ModuleId, parameter: TypeParameter): readonly Constraint[] { ... }
    function resolveStructConstraints(checker: CheckerContext, module: ModuleId, parameter: TypeParameter): readonly StructConstraintModel[] { ... }
    ```
  - In `TypeParameters.constructor` (`type-parameters.ts:81-109`), `#constraints` and `#structConstraints` are separate `EntryTable`s that **both** call `impliedConstraints(checker, checker.inputs.treeOf(module), parameter)` — walking the declaration's syntax tree twice per `TypeParameter`!
  - Meanwhile, the third part of a parameter's bounds — `parameter.memberOf` (`T in U`) — is not cached in `TypeParameters` at all (`ProgramChecker.memberUnionOf` calls `memberUnionOf` in `struct-keys.ts:122` uncached on every query), and the single-type `in` bound error (`checkerDiagnostics.memberOfMemberParameter`) is checked in **two** separate functions in `declarations.ts` (`checkTypeParameters` at line 74 via `namesMemberParameter` and `checkAssociatedBounds` at line 176 via `namesOneType`), while `memberUnionOf` (`struct-keys.ts:126`) and `resolveAssociatedBounds` (`type-parameters.ts:263`) silently substitute `errorType`. Because `declarations.ts` only checks top-level `GenericDeclaration`s, a `MappedField`'s parameter `[F in K]: V` where `K` is a member parameter hits `namesMemberParameter -> errorType` in `memberUnionOf` without `memberOfMemberParameter` ever being reported!
- proposal: Have `TypeParameters` compute a single cached `AssociatedBounds` (`{ traits, structs, memberOf }`) entry per `TypeParameter | RequiredAssociatedType` using `resolveConstraintSet` once + `impliedConstraints` once + a single `resolveMemberBound` helper that reports `memberOfMemberParameter` where `memberOf` is resolved. Delete `resolveConstraints`, `resolveStructConstraints`, `namesMemberParameter`, and both duplicate `memberOfMemberParameter` checks in `declarations.ts`.
- confidence: high

### [high] `PatternScope` (`bodyScope`) and `PatternTests` (`testsIn`) are obsolete indirection layers over `BodyContext`
- where: `src/compiler/checker/constructs/patterns/walk/parts.ts:31-78`, `src/compiler/checker/constructs/patterns/walk/pattern-tests.ts:88-113`, `src/compiler/checker/constructs/patterns/matching.ts:109-135`, `src/compiler/checker/constructs/patterns/targets.ts:24-35`, `src/compiler/checker/constructs/statements/assignments.ts:196-204`, `src/compiler/checker/constructs/patterns/walk/index.ts:75-143`
- evidence:
  - `PatternScope` (`parts.ts:31`) states in its comment: `/** What a pattern reads and where it reports, in a body or in a top-level constant. */`. Top-level constants are now checked inside a `BodyChecker` (`BodyChecker.checkConstant`), so **every** caller of `bodyScope` in the entire codebase (`matching.ts:117`, `targets.ts:30`, `assignments.ts:198`) already has a `BodyContext`. `bodyScope(context)` allocates a 12-closure wrapper object on every pattern, target, and assignment just to forward `BodyContext` and `CheckerContext` methods.
  - Even within `patterns/walk/kinds/`, `downcasts.ts:39` (`downcastOf(context: BodyContext, ...)`) and `ranges.ts:19` (`rangeLeaf(context: BodyContext, ...)`) already take `BodyContext` directly!
  - Because `walk/index.ts` takes `tests: PatternTests | undefined` instead of `context: BodyContext` and `refutable: boolean`, `matching.ts` imports `downcastOf` and `rangeLeaf` from `walk/kinds/`, wraps them in `testsIn(context)` (`matching.ts:125-135`), and passes them back into `walkPattern`, which calls `tests.downcast` (`walk/selections.ts:128`) and `tests.range` (`walk/index.ts:156`) — a round-trip from `walk/` -> `PatternTests` -> `matching.ts` -> `walk/kinds/`.
  - `walkPattern` has only 1 caller (`matching.ts:117`), which always passes `testsIn(context)`.
- proposal: Pass `BodyContext` directly as the scope in `Taking` / `walkPattern` / `walkTargets` (replacing `PatternScope` and deleting `bodyScope`), replace `tests: PatternTests | undefined` with `refutable: boolean`, and call the refutable leaf handlers directly from `walk/` (moving `arrayTest` into `walk/kinds/arrays.ts` and `namedVariant`/`variantOf` into `walk/kinds/variant-calls.ts`).
- confidence: high

### [high] `assignedPlace` (`assignments.ts`) and `checkChangedPlace` / `requireChangeable` (`resolution/calls/places.ts`) duplicate root-variable mutability checks with a silent-error gap
- where: `src/compiler/checker/constructs/statements/assignments.ts:239-260`, `src/compiler/checker/resolution/calls/places.ts:58-94, 305-325`
- evidence:
  - `assignedPlace` (`assignments.ts:239-260`) special-cases `target.kind === 'Identifier'` to check `entity.kind !== 'variable'` (reporting `notAssignable`), `!context.variables.isChangeable(entity)` (reporting `constReassigned`), and `context.variables.noteChanged(entity)`. For non-`Identifier` targets it delegates to `checkChangedPlace(context, target, 'assigned')`.
  - `checkChangedPlace` -> `changePlace` -> `requireChangeable` (`places.ts:305-325`) performs the same root-identifier check (`entity = context.entityOf(root)`, `entity?.kind !== 'variable'`, `!context.variables.isChangeable(entity)`, `context.variables.noteChanged(entity)`).
  - Because the two are split: when `root.kind === 'Identifier'` denotes a non-variable that is still a valid value expression — e.g. `&Empty` (fieldless struct), `&fnName` (function value), `Color.Red = 1`, or `ns.constVal = 1` (where `root` is namespace `ns`) — `isPlace` is `true`, `context.expression(node)` succeeds with a non-error `Type`, and `requireChangeable` sees `entity?.kind !== 'variable'` and returns `false` **without reporting any diagnostic**, returning `errorType` silently!
- proposal: Unify root-place validation in `checkChangedPlace` / `requireChangeable` (`resolution/calls/places.ts`), parameterized by `PlaceUse` (`'assigned' | 'referenced'`) and whether `steps.length === 0` (`constReassigned` vs `constantChanged`), and report `notAssignable` whenever `entity.kind !== 'variable'`. `assignedPlace` in `assignments.ts` then reduces to `checkChangedPlace(context, target, 'assigned')`.
- confidence: high

### [high] `checkValueCall` (`closures/value-calls.ts`) re-implements the call application, scope-joining, and completion pipeline of `resolveCall` / `completeCall`
- where: `src/compiler/checker/constructs/closures/value-calls.ts:169-274`, `src/compiler/checker/resolution/calls/resolve/index.ts:74-242`, `src/compiler/checker/resolution/applying/applied-call.ts:76-165`
- evidence:
  - The banner of `closures/value-calls.ts` states: *"its arguments are judged, reported and fitted as a chosen function's are (resolution/calls/resolve/index.ts), as one signature with no type parameters, so every argument rule has one home."*
  - In reality, `applyValueCall`, `takenFor`, and `completeValueCall` (`value-calls.ts:206-274`) manually re-implement the constraint-scope and argument-fitting pipeline from `resolveCall` (`resolve/index.ts:74-242`) and `completeCall` (`applied-call.ts:125-165`):
    - Checking `written.some(({ type }) => context.scopes.holds(type))`
    - Calling `context.scopes.commit(taken.inference)` vs `context.scopes.abandon(written.map(({ type }) => type))`
    - Deferring completion via `context.scopes.whenSolved((solved) => { const settled = withSolvedTypes(written, solved); ... })`
    - Calling `explain(context, { site: node, name, arguments: given, typeArguments }, taken)`
    - Calling `fitArguments(context, given.map(appliedArgumentOf), filledTypes(typeRules, taken, noSubstitution, given.length))`
    - Calling `checkReferencedPlaces(context, given, { name, isAsync: context.checker.fitting.awaitedOf(callee.result)?.value !== undefined, slots: given.map((_, index) => taken.slots.get(index) ?? { reference: false }) })`
  - Moreover, `ValueCalls` (`value-calls.ts:97-118`) only records `{ binding }` and discards `calleeType`, forcing `calledValueType` (`value-calls.ts:86-94`, called only by `deferred-calls.ts`) to re-derive the callee's `FunctionType` by re-running `fieldOf(context.checker, context.typeOf(callee.target), callee.member.text)` when `callee` is a `MemberAccess`.
- proposal: Record `calleeType` in `ValueCallMade` when `checkValueCall` runs (eliminating `calledValueType`'s `fieldOf` reconstruction), and share a single post-choice argument completion helper between `completeResolved` (`resolution/calls/resolve/index.ts`) and `completeValueCall` (`closures/value-calls.ts`).
- confidence: high

### [med] Double standard in per-node `PassTable` storage: four single-table wrapper classes in `constructs/` vs `bodyRecords`
- where: `src/compiler/checker/constructs/expressions/access/member-access.ts:124-137` (`FieldReads`), `src/compiler/checker/constructs/expressions/collections/collections.ts:57-70` (`CollectionForms`), `src/compiler/checker/constructs/loops/iteration.ts:38-51` (`Iterations`), `src/compiler/checker/constructs/patterns/matching.ts:89-102` (`CheckedPatterns`), `src/compiler/checker/wiring/body/body-records.ts:26-37`
- evidence:
  - `bodyRecords` (`wiring/body/body-records.ts:26-37`) stores 8 per-pass node tables directly (`types`, `expected`, `givenFields`, `keyOwners`, `builtLiterals`, `chosenVariants`, `fits`, `fieldPasses`).
  - Meanwhile, 4 other single-table node records are wrapped in dedicated classes in `constructs/` with inconsistent method names (`of`, `formOf`, `patternOf`) and separate interfaces in `contexts/body-context.ts`:
    - `FieldReads` (`member-access.ts:124`): wraps 1 `PassTable<FieldReading, FieldRead>` with `record` / `of`
    - `CollectionForms` (`collections.ts:57`): wraps 1 `PassTable<ArrayLiteral | MapLiteral, CollectionForm>` with `record` / `of`
    - `Iterations` (`iteration.ts:38`): wraps 1 `PassTable<Iteration, IterationForm>` with `record` / `formOf`
    - `CheckedPatterns` (`matching.ts:89`): wraps 1 `PassTable<Pattern, CheckedPattern>` with `record` / `patternOf`
  - Each wrapper class requires boilerplate across 6 files (`constructs/...`, `contexts/body-context.ts`, `wiring/body/body-checker.ts`, `wiring/body/facts/recorded-body.ts`, `wiring/body/facts/index.ts`).
- proposal: Move passive single-`PassTable` node records (`fieldReads`, `collectionForms`, `iterations`, `patterns`) into `bodyRecords` in `wiring/body/body-records.ts` (exposed via `BodyContext` methods like `recordField`/`recordBuilt`), deleting the 4 wrapper classes and 4 `BodyContext` record interfaces.
- confidence: high

### [med] `checkJoiningMap` and `checkMapLiteral` duplicate map entry collection, key/value agreement, and map-spread settling
- where: `src/compiler/checker/constructs/expressions/collections/joining-literals.ts:100-143`, `src/compiler/checker/constructs/expressions/collections/literals.ts:49-110`
- evidence:
  - For arrays, `literals.ts:221` extracts `agreedElement(context, elements, produced, expectedItem)` so `checkArrayLiteral` (`literals.ts:194`) and `checkJoiningArray` (`joining-literals.ts:94`) share element agreement and spread settling.
  - For maps, no counterpart was extracted: `checkJoiningMap` (`joining-literals.ts:100-143`) and `checkMapLiteral` + `entriesOf` (`literals.ts:49-110`) both loop over `node.entries` (`MapEntry` vs `Spread`), call `spreadPairs`, push synthetic `{ type: pairs.key, span: entry.span, site: undefined }` / `{ type: pairs.value, span: entry.span, site: undefined }` producers, run:
    ```ts
    const key = agreeOn(context, producedKeys, expectedKey, 'key') ?? expectedKey ?? neverType;
    const value = agreeOn(context, producedValues, expectedValue, 'value') ?? expectedValue ?? neverType;
    ```
    loop over spreads calling `settleMapSpread(context, ..., { key, value, isExpected: ... })`, and return `wellKnownOf(context.checker, wellKnown.map, [key, value])`.
- proposal: Extract `agreedMap(context, keys, values, spreads, expected)` in `expressions/collections/literals.ts` (mirroring `agreedElement`) and use it from both `checkMapLiteral` and `checkJoiningMap`.
- confidence: high

### [med] Missing `namesVariant(entity)` predicate in `binder/entities.ts` causes 11 hand-rolled `kind === 'variant' || kind === 'variants'` checks in `constructs/` (16 repo-wide)
- where: `src/compiler/binder/entities.ts:147-189`, `src/compiler/checker/constructs/closures/function-values.ts:104`, `src/compiler/checker/constructs/expressions/literals/indented-values.ts:63`, `src/compiler/checker/constructs/expressions/structs/structs.ts:96`, `src/compiler/checker/constructs/patterns/matching.ts:265, 272`, `src/compiler/checker/constructs/patterns/walk/members.ts:212, 265`, `src/compiler/checker/constructs/patterns/walk/parts.ts:132`, `src/compiler/checker/constructs/patterns/walk/kinds/variant-calls.ts:85, 148, 174`
- evidence:
  - `src/compiler/binder/entities.ts` defines `export type VariantNaming = VariantEntity | VariantsEntity` (line 148) and exports `namesType(entity): entity is TypeEntity | PrimitiveEntity | SelfEntity` (line 187), `qualifies(entity): entity is Qualifier` (line 175), and `isAlias(entity)` (line 182), but has no `namesVariant(entity): entity is VariantNaming` type guard.
  - Consequently, `entity?.kind === 'variant' || entity?.kind === 'variants'` is spelled out 11 times in `constructs/` and 5 more times in `types/written/pattern-types.ts:235`, `lookup/denotations/index.ts:225`, `lowering/constructs/expressions/access/names.ts:52`, `editor/language-service/completion/expected.ts:120`, and `editor/language-service/completion/places/patterns/pattern.ts:184`.
- proposal: Export `namesVariant(entity: Entity | undefined): entity is VariantNaming` from `src/compiler/binder/entities.ts` and use it across all 16 sites.
- confidence: high

### [med] Dead code in `indented-values.ts`: `collections` and `isWellKnown` check a condition `isDeclaredStruct` already excludes
- where: `src/compiler/checker/constructs/expressions/literals/indented-values.ts:25-28, 111-125`
- evidence:
  - In `indented-values.ts:111-125`:
    ```ts
    function namesStruct(context: BodyContext, entity: Entity): boolean {
      if (entity.kind !== 'type' || collections.some((each) => isWellKnown(context, entity, each))) {
        return false;
      }
      const { declaration } = entity;
      return aliasedShape(context, declaration) !== undefined || isDeclaredStruct(declaration);
    }
    const collections = [wellKnown.array, wellKnown.map];
    function isWellKnown(context: BodyContext, entity: Entity, known: WellKnownDeclaration): boolean {
      const type = context.checker.wellKnownType(known);
      return type?.kind === 'nominal' && type.entity === entity;
    }
    ```
  - `Array` and `Map` in `std:prelude` are `ExternStructDeclaration`s (`extern struct Array<gives T>`, `extern struct Map<K, gives V>`).
  - For any `ExternStructDeclaration`, `aliasedShape(context, declaration)` is `undefined` and `isDeclaredStruct(declaration)` (`declaration.kind === 'StructDeclaration' || declaration.kind === 'SharedStructDeclaration'`) is `false`.
  - Thus `collections.some((each) => isWellKnown(context, entity, each))` is leftover dead code from when `extern struct` was a flag on `StructDeclaration` (and `isWellKnown` also re-implements `entity === context.checker.wellKnownEntity(known)`).
  - Moreover, `isStructType(context, type)` (`indented-values.ts:143-148`) re-implements `isStructType(type)` from `src/compiler/checker/types/traits/struct-keys.ts:52` (or `context.checker.fieldsOf(type) !== undefined`).
- proposal: Delete `collections`, `isWellKnown`, and `isStructType` in `indented-values.ts`; use `context.checker.fieldsOf(type) !== undefined` (or `isStructType` from `struct-keys.ts`) in `formOf`.
- confidence: high

### [med] `alias-recursion.ts` `typeChildrenOf` uses a raw `switch` instead of `Handlers` and omits `MappedField.parameter.memberOf`
- where: `src/compiler/checker/constructs/declarations/aliases/alias-recursion.ts:359-418`
- evidence:
  - One-way rule in `docs/reuse/structures-and-invariants.md`: *"Open dispatches over node or instruction kinds use `Handlers` (`src/foundation/structures/kind-table.ts`), never `switch` with `default`."* `typeChildrenOf` in `alias-recursion.ts:373-417` dispatches over `TypeNode` using a `switch (node.kind)` with `default: const unhandled: never = node`.
  - In `case 'StructType'` (`alias-recursion.ts:392-395`):
    ```ts
    case 'StructType':
      return guarded(
        node.fields.flatMap((field) => (field.kind === 'Invalid' ? [] : [field.type])),
      );
    ```
    When `field.kind === 'MappedField'` (`[F in keyof S]: V`), `field.parameter.memberOf` (`keyof S`) is a `TypeNode` that `mappedKeysWritten` (`types/written/key-types.ts:98`) resolves eagerly before the mapped type can be constructed (so it is `blocking`, just like `KeyofType` and `IndexedType`), yet `typeChildrenOf` ignores `field.parameter.memberOf` completely. As a result, `AliasRecursions` misses alias references and type-parameter uses inside a mapped field's `in` clause.
- proposal: Convert `typeChildrenOf` to a `Handlers` table over `TypeNode` and include `field.kind === 'MappedField' && field.parameter.memberOf !== undefined ? blocking([field.parameter.memberOf]) : []` under `StructType`.
- confidence: high

### [med] `ReturnScope.result` inlines `settleAgreement`, and `BodyChecker.checkConstant` duplicates `checkVariableDeclaration`
- where: `src/compiler/checker/constructs/closures/returns.ts:129-164`, `src/compiler/checker/rules/agreement.ts:222-235`, `src/compiler/checker/constructs/statements/variables.ts:153-161`, `src/compiler/checker/constructs/declarations/constants.ts:105-115`, `src/compiler/checker/wiring/body/body-checker.ts:163-169`
- evidence:
  - In `ReturnScope.result` (`returns.ts:153-160`):
    ```ts
    const { decided, disagreeing } = agreedType(produced, context.checker);
    if (decided === undefined) {
      return tail.type;
    }
    for (const each of disagreeing) {
      settleProduced(context, each, { decided, expected: undefined, mismatch });
    }
    ```
    This is an exact inline copy of `settleAgreement(context, produced, undefined, mismatch) ?? tail.type` from `src/compiler/checker/rules/agreement.ts:222-235` (which `Branches.agreedType` in `expressions/control/branches.ts:74` calls directly).
  - In `ConstantChecks.#bodies` (`constants.ts:108-114`) + `BodyChecker.checkConstant` (`body-checker.ts:163-169`), resolving `declaration.type`, calling `this.expect(declaration.initializer, declared)`, computing `value = declared ?? type`, and calling `declareTargets(this, declaration, value)` duplicates `checkVariableDeclaration` (`constructs/statements/variables.ts:153-161`).
- proposal: Call `settleAgreement(context, produced, undefined, mismatch) ?? tail.type` in `ReturnScope.result`, and have `BodyChecker.checkConstant` delegate to `checkVariableDeclaration` (returning the held type).
- confidence: high

### [med] Duplicate and asymmetric handling of bare vs qualified fieldless structs, variants, and function values in `access/` and `structs/variants.ts`
- where: `src/compiler/checker/constructs/expressions/access/member-access.ts:38-64`, `src/compiler/checker/constructs/expressions/access/names.ts:45-115, 163-184`, `src/compiler/checker/constructs/expressions/structs/variants.ts:48-89`, `src/compiler/checker/constructs/closures/function-values.ts:93-103`
- evidence:
  - `checkMemberAccess` (`member-access.ts:47-56`) manually checks `qualified?.kind === 'variant'` -> `checkVariantValue(context, node, qualified, expected)` and `namedFunctions(context, node)` -> `checkFunctionValue(context, functions, expected)` before falling back to `entityValueType(context, node.member, qualified, expected)` — because `entityValueType` (`names.ts:84`) is typed to take `node: Identifier` instead of `site: Identifier | MemberAccess`, even though `namedFunctions` and `checkVariantValue` already accept `Identifier | MemberAccess`.
  - `bareStructAccepts` (`names.ts:71-81`) and `qualifiedVariantAccepts` (`variants.ts:67-79`) implement the exact same `Admits` check for a generic nominal declaration with 0 fields (`typeParametersOf(declaration.typeParameters).length === 0`, then checking whether `expected` has a nominal member of `declaration`).
  - `bareStructValue` (`names.ts:173-184`) and `checkAppliedFunction` (`function-values.ts:95-102`) both check `entity?.kind === 'type' && isNominalEntity(entity) && fieldlessStructOf(context.checker, entity) !== undefined`, because `fieldlessStructOf` (`types/written/named-types.ts:197`) returns `StructDeclaration | undefined` instead of narrowing `entity` to `NominalEntity & { readonly declaration: StructDeclaration }`.
- proposal: Generalize `entityValueType` and `nameAccepts`/`memberAccepts` in `expressions/access/names.ts` to take `Identifier | MemberAccess`, unify `bareStructAccepts` and `qualifiedVariantAccepts`, and narrow `fieldlessStructOf` to return the `NominalEntity` (or acts as a type guard).
- confidence: high

### [med] Double standard in finding an associated type's parent declaration and nominal entity (`Aliases` vs `TypeParameters` vs `nominalEntityOf`)
- where: `src/compiler/checker/constructs/declarations/aliases/index.ts:170-185, 215-218`, `src/compiler/checker/constructs/declarations/type-parameters.ts:279-290`, `src/compiler/checker/types/written/named-types.ts:53-62`
- evidence:
  - To find the declaration owning an `AssociatedType`, `Aliases.#ownerOf` (`aliases/index.ts:216`) uses `parentOf(this.#checker.inputs.treeOf(this.#moduleOf(alias)), alias)`, whereas to find the `TraitDeclaration` owning a `RequiredAssociatedType`, `traitRequiring` (`type-parameters.ts:279-290`) scans `checker.inputs.itemsOf(module).find((item): item is TraitDeclaration => item.kind === 'TraitDeclaration' && item.members.includes(requirement))`.
  - Then, in `Aliases.useOf` (`aliases/index.ts:173-184`), to get the `NominalEntity` of `owner`, it looks up `owner.name.text` by string in module/prelude scope via `this.#checker.bindings.topLevelNamed(this.#moduleOf(alias), name)` instead of `this.#checker.bindings.entityOf(this.#moduleOf(alias), owner.name)` or `nominalEntityOf(this.#checker, owner)` (`types/written/named-types.ts:53`).
- proposal: Use `parentOf(checker.inputs.treeOf(module), node)` for both `AssociatedType` and `RequiredAssociatedType`, and use `nominalEntityOf` (or `bindings.entityOf(module, owner.name)`) in `Aliases.useOf`.
- confidence: high

### [low] 22 unused exported types/interfaces, 4 test-only exports, 1 pure forwarding wrapper, 2 unused parameters, and 4 files over the 400-line limit
- where:
  - Pure forwarding wrapper: `src/compiler/checker/constructs/expressions/structs/structs.ts:79-86` (`checkNamedLiteral` only does `const type = namedLiteralType(context, node, expected); return type;`)
  - Unused parameters: `src/compiler/checker/constructs/expressions/collections/empty-collections.ts:13, 18` (`_node: ArrayLiteral` in `emptyArrayAdmits`, `_node: MapLiteral` in `emptyMapAdmits`)
  - Dangling TSDoc comment: `src/compiler/checker/constructs/patterns/walk/kinds/variant-calls.ts:60` (`/** A call pattern's argument that binds to a field: any but a last \`...\`. */`)
  - Misplaced protocol name re-export: `src/compiler/checker/constructs/patterns/walk/kinds/ranges.ts:67` (`export const compareFunction = binaryOperators['<'].meaning.function`, imported by `patterns/matching.ts:51` for array patterns instead of living in `src/foundation/language/well-known/implicit-calls.ts`)
  - 22 exports with 0 importers in `src/` and `test/`:
    1. `ValueCall` (`closures/value-calls.ts:123`)
    2. `AliasRecursion` (`declarations/aliases/alias-recursion.ts:65`)
    3. `ConstantSeams` (`declarations/constants.ts:37`)
    4. `ValueBody` (`declarations/context-constants.ts:28`)
    5. `FunctionSeams` (`declarations/functions/functions.ts:27`)
    6. `DefaultsChecking` (`declarations/functions/parameters.ts:40`)
    7. `ParameterSite` (`declarations/functions/signatures.ts:195`)
    8. `ModuleRules` (`declarations/module-checks.ts:34`)
    9. `CallToCheck` (`expressions/calls.ts:90`)
    10. `CalledValue` (`expressions/calls.ts:208`)
    11. `AwaitedOperand` (`expressions/control/await.ts:58`)
    12. `EqualityAt` (`expressions/operators/decided-conditions.ts:53`)
    13. `Postponing` (`expressions/postponed.ts:55`)
    14. `LiteralSetting` (`expressions/structs/literal-fields/index.ts:61`)
    15. `GivenField` (`expressions/structs/literal-fields/items.ts:66`)
    16. `Built` (`expressions/structs/literal-types.ts:32`)
    17. `ComprehensionTarget` (`expressions/structs/struct-comprehensions.ts:52`)
    18. `VariantCall` (`expressions/structs/variants.ts:159`)
    19. `AnyShape` (`patterns/exhaustiveness/exhaustiveness.ts:32`)
    20. `Analysis` (`patterns/exhaustiveness/exhaustiveness.ts:102`)
    21. `VariantBraced` (`patterns/walk/kinds/variant-calls.ts:67`)
    22. `BlockUse` (`statements/statements.ts:64`)
  - 4 exports in `patterns/exhaustiveness/exhaustiveness.ts` used only by `exhaustiveness.test.ts`: `ConstructorKey` (line 43), `lengthKey` (line 72), `sameConstructorKey` (line 77), `longArrays` (line 142).
  - 4 files exceeding the 400-line limit in `AGENTS.md`: `patterns/walk/index.ts` (470 lines), `closures/lambdas.ts` (460 lines), `declarations/aliases/alias-recursion.ts` (419 lines), `patterns/exhaustiveness/exhaustiveness.ts` (405 lines).
- evidence: Verified by repo-wide `rg` across `src/` and `test/` and line counts.
- proposal: Inline `namedLiteralType` into `checkNamedLiteral`; drop `_node` from `emptyArrayAdmits`/`emptyMapAdmits`; move `compare`/`includes` names to `foundation/language/well-known/implicit-calls.ts`; remove `export` from the 22 unused types/interfaces; and apply the refactorings above to bring the 4 files back under 400 lines.
- confidence: high

## Missing from docs/reuse

### Stale or wrong entries in `docs/reuse/*.md` for `constructs/`
- `docs/reuse/types-and-fitting.md:18`: lists `takeMatched` (`src/compiler/checker/constructs/patterns/walk/index.ts`) for `Never` pattern parts — `takeMatched` is private, and the `Never` check is actually in private `takeSelecting` (`walk/index.ts:275`).
- `docs/reuse/types-and-fitting.md:50`: lists `fieldPassesOver` (`src/compiler/checker/types/traits/struct-keys.ts`) — `fieldPassesOver` is no longer in `struct-keys.ts` (nor exported anywhere); it is a private function in `src/compiler/checker/constructs/loops/field-passes.ts:56` (leaving stale comments in both `struct-keys.ts:19` and `field-passes.ts:4`).
- `docs/reuse/types-and-fitting.md:69`: lists `settleSpread` (`src/compiler/checker/constructs/expressions/collections/literals.ts`) — `settleSpread` is private in `literals.ts:261`; the exported unit is `agreedElement` (`literals.ts:221`).
- `docs/reuse/types-and-fitting.md:105`: lists `takeFields` (`src/compiler/checker/constructs/patterns/walk/taking.ts`) — `takeFields` is private in `taking.ts:75`; the exported helper alongside `takeTargets`/`takeApart` is `constructed` (`taking.ts:95`).

### Reusable exported units in `constructs/` (with callers outside their folder) missing from `docs/reuse/*.md`
- `src/compiler/checker/constructs/closures/function-scope.ts`: `rootScope`, `OwnScope` (used by `wiring/body/`)
- `src/compiler/checker/constructs/closures/function-values.ts`: `recordedValue` (used by `expressions/postponed.ts`)
- `src/compiler/checker/constructs/closures/functions.ts`: `FunctionScopes` (used by `wiring/body/`)
- `src/compiler/checker/constructs/closures/lambdas.ts`: `lambdaAccepts`, `writtenInputs`, `checkLambda`, `inferLambda`, `checkLocalFunction` (used by `expressions/`, `statements/`, `wiring/body/`)
- `src/compiler/checker/constructs/closures/own-calls.ts`: `declareOwnCall`, `ownCallerOf` (used by `wiring/body/`, `expressions/control/select.ts`)
- `src/compiler/checker/constructs/closures/returns.ts`: `ReturnScope` (used by `wiring/body/`)
- `src/compiler/checker/constructs/closures/value-calls.ts`: ` checkValueCall`, `ValueCalls` (used by `expressions/calls.ts`, `wiring/body/`)
- `src/compiler/checker/constructs/declarations/aliases/index.ts`: `Aliases` (used by `wiring/program/`)
- `src/compiler/checker/constructs/declarations/constants.ts`: `ConstantChecks` (used by `wiring/program/`)
- `src/compiler/checker/constructs/declarations/context-constants.ts`: `ContextConstantChecks` (used by `wiring/program/`)
- `src/compiler/checker/constructs/declarations/functions/clashes.ts`: `checkClashes` (used by `declarations/module-checks.ts`)
- `src/compiler/checker/constructs/declarations/functions/functions.ts`: `FunctionChecks` (used by `wiring/program/`)
- `src/compiler/checker/constructs/declarations/functions/parameters.ts`: `Parameters`, `defaultsBody`, `DefaultsBody` (used by `wiring/program/`)
- `src/compiler/checker/constructs/declarations/functions/signatures.ts`: `declaredBodyResult` (used by `closures/lambdas.ts`)
- `src/compiler/checker/constructs/declarations/functions/statics.ts`: `StaticFunctions` (used by `wiring/program/`)
- `src/compiler/checker/constructs/declarations/layout/index.ts`: `Layouts` (used by `wiring/program/`)
- `src/compiler/checker/constructs/declarations/layout/struct-rules.ts`: `checkFiniteFields` (used by `declarations/declarations.ts`)
- `src/compiler/checker/constructs/declarations/module-checks.ts`: `ModuleChecks` (used by `wiring/program/`)
- `src/compiler/checker/constructs/expressions/access/member-access.ts`: `readsNothing`, `readsThroughNamespace`, `FieldReads` (used by `expressions/calls.ts`, `wiring/body/`)
- `src/compiler/checker/constructs/expressions/access/names.ts`: `nameAccepts`, `memberAccepts` (used by `expressions/postponed.ts`)
- `src/compiler/checker/constructs/expressions/access/optionals.ts`: `OptionalChains`, `checkUnwrap`, `checkNullish` (used by `wiring/body/`, `expressions/operators/operators.ts`, `expressions/expressions.ts`)
- `src/compiler/checker/constructs/expressions/collections/collections.ts`: `CollectionForms`, `spreadArgumentType`, `collectedBy` (used by `wiring/body/`, `expressions/call-arguments.ts`, `expressions/deferred-calls.ts`)
- `src/compiler/checker/constructs/expressions/collections/empty-collections.ts`: `emptyArrayAdmits`, `emptyMapAdmits` (used by `expressions/postponed.ts`)
- `src/compiler/checker/constructs/expressions/deferred-calls.ts`: `Deferrals` (used by `wiring/body/`)
- `src/compiler/checker/constructs/expressions/structs/literal-fields/index.ts`: `checkLiteralFields` (used by `expressions/structs/structs.ts`)
- `src/compiler/checker/constructs/expressions/structs/literal-fields/items.ts`: `LiteralShape`, `LiteralSpread`, `checkRefused` (used by `expressions/structs/structs.ts`, `expressions/structs/literal-types.ts`)
- `src/compiler/checker/constructs/expressions/structs/literal-sources.ts`: `StructLiterals`, `sourcesOf`, `LiteralGiven` (used by `wiring/body/`, `expressions/structs/literal-fields/index.ts`, `expressions/structs/struct-comprehensions.ts`)
- `src/compiler/checker/constructs/expressions/structs/struct-comprehensions.ts`: `comprehensionOf`, `fitComprehended`, `comprehendedGiven` (used by `expressions/postponed.ts`, `expressions/structs/literal-fields/index.ts`)
- `src/compiler/checker/constructs/expressions/structs/variants.ts`: `variantNameAccepts`, `qualifiedVariantAccepts`, `variantCallAccepts`, `checkVariantValue`, `refuseVariantLiteral` (used by `expressions/access/`, `expressions/postponed.ts`, `expressions/literals/indented-values.ts`)
- `src/compiler/checker/constructs/patterns/exhaustiveness/exhaustiveness.ts`: `Shape`, `anyShape`, `nothingShape`, `CaseShape` (used across `patterns/`, `expressions/control/match.ts`, `statements/assignments.ts`)
- `src/compiler/checker/constructs/patterns/exhaustiveness/remaining.ts`: `subjectPart` (used by `patterns/matching.ts`)
- `src/compiler/checker/constructs/patterns/exhaustiveness/shapes.ts`: `structKey`, `tupleKey`, `nullaryShape`, `literalShape`, `witnessText` (used by `patterns/walk/taking.ts`, `patterns/matching.ts`, `expressions/control/match.ts`)
- `src/compiler/checker/constructs/patterns/matching.ts`: `CheckedPatterns`, `checkPattern` (used by `wiring/body/`, `expressions/control/match.ts`)
- `src/compiler/checker/constructs/patterns/walk/kinds/downcasts.ts`: `downcastOf`, `Downcast` (used by `patterns/matching.ts`, `patterns/walk/pattern-tests.ts`)
- `src/compiler/checker/constructs/patterns/walk/kinds/ranges.ts`: `rangeLeaf`, `compareFunction` (used by `patterns/matching.ts`, `patterns/walk/index.ts`)
- `src/compiler/checker/constructs/patterns/walk/kinds/variant-calls.ts`: `variantBraced`, `takeVariantBraces`, `calledVariant` (used by `patterns/walk/index.ts`)
- `src/compiler/checker/constructs/patterns/walk/parts.ts`: `PatternScope`, `bodyScope`, `ValuePart`, `otherTypeNamed`, `structFieldStep`, `fieldPart` (used across `patterns/` and `statements/assignments.ts`)
- `src/compiler/checker/constructs/patterns/walk/taking.ts`: `Taking`, `constructed` (used across `patterns/` and `statements/assignments.ts`)
- `src/compiler/checker/constructs/statements/loops.ts`: `LabelTargets` (used by `wiring/body/`)
- `src/compiler/checker/constructs/statements/statements.ts`: `statementHandlers`, `checkBlock` (used by `wiring/body/`)
- `src/compiler/checker/constructs/statements/variables.ts`: `VariableScope` (used by `wiring/body/`)
