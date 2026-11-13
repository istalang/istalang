# Findings: `res` (`src/compiler/binder`, `src/compiler/checker/resolution`, `src/compiler/checker/check.ts`)

### [high] Argument-to-parameter slot binding is re-implemented in 4 places (`binding.ts`, `written-expectations.ts`, `struct-items.ts`, `call-at.ts`)
- where: `src/compiler/checker/resolution/choosing/binding.ts:90-271`, `src/compiler/checker/resolution/calls/resolve/written-expectations.ts:27-59`, `src/compiler/checker/surface/struct-items.ts:68-126`, `src/editor/language-service/signatures/call-at.ts:93-109`, `src/compiler/checker/constructs/patterns/walk/kinds/variant-calls.ts:255-311`, `src/compiler/checker/resolution/calls/resolve/explanations.ts:115-143`
- evidence:
  1. `bindArguments` + `argumentSlotsOf` (`binding.ts:90, 257`) is the canonical argument binder for calls, function values, and valid `VariantCallPattern`s.
  2. When a call is incomplete or fails, `expectWrittenArguments` (`written-expectations.ts:34-45`) reuses `bindArguments` by marking slots lenient (`signature.parameters.map((slot) => ({ ...slot, hasDefault: true }))`) and calling `argumentSlotsOf(signature.parameters, binding)`.
  3. By contrast, when a `VariantCallPattern` fails `bindArguments`, `takeReached` (`variant-calls.ts:227`) calls `argumentsReach` (`surface/struct-items.ts:68-126`), which hand-rolls 60 lines (`Reaching`, `reachOf`) recomputing `restAt`, `spreadAt`, `positional`, `fixed`, `byPosition`, and `firstNamed` from scratch instead of a lenient/best-effort pass in `binding.ts`.
  4. In `editor/language-service/signatures/call-at.ts:93-109`, `writtenParameter` hand-rolls a third partial argument-to-parameter mapper (`parameters.findIndex` for `NamedArgument`, `argument + receiversOf(declaration, call)`, `last.isRest`) that ignores spreads before positional arguments.
  5. Both `bindingReport` (`explanations.ts:115-143`) and `failureReport` (`variant-calls.ts:345-399`) switch over `BindingFailure`, define duplicate `namedAt` helpers (`findLast` on named arguments), and because `filled` (`binding.ts:222-238`) discards `slot.name` when `byName === false` and returns `arityOf(slots)`, `failureReport` (`variant-calls.ts:371-375`) has to re-scan `given` and `slots` by hand to recover the first missing field name.
- proposal: Make `src/compiler/checker/resolution/choosing/binding.ts` the single home for both strict (`bindArguments`) and partial/best-effort (`reachArguments`) binding, and carry the first missing slot name on `BindingFailure` (`arity`). Delete `argumentsReach`/`reachOf`/`Reaching` from `surface/struct-items.ts` and `writtenParameter` from `editor/language-service/signatures/call-at.ts`, and simplify `expectWrittenArguments` and `variant-calls.ts`.
- confidence: high

### [high] Function-value calls (`value-calls.ts`) maintain a parallel call-application pipeline alongside `resolveCall` / `completeCall`
- where: `src/compiler/checker/constructs/closures/value-calls.ts:116-248`, `src/compiler/checker/resolution/calls/resolve/index.ts:96-241`, `src/compiler/checker/resolution/applying/applied-call.ts:77-169`
- evidence:
  1. `checkValueCall` / `applyValueCall` / `completeValueCall` (`value-calls.ts:116-248`) duplicates the constraint-scope lifecycle, argument fitting, and place-checking pipeline of `resolveCall` / `completeResolved` (`resolve/index.ts:96-241`) and `completeCall` (`applied-call.ts:127-169`).
  2. In `value-calls.ts:183-204`, `applyValueCall` manually checks `written.some(({ type }) => context.scopes.holds(type))`, calls `takenBy`, calls `context.scopes.commit` or `context.scopes.abandon`, and registers `context.scopes.whenSolved((solved) => { const settled = withSolvedTypes(written, solved); completeValueCall(...); })` — duplicating `resolveCall` (`resolve/index.ts:103-135`), `reportUnmade` (`resolve/index.ts:197-208`), and `completeCall` (`applied-call.ts:149-160`).
  3. `completeValueCall` (`value-calls.ts:224-248`) and `completeResolved` (`resolve/index.ts:211-241`) contain the exact same `fitArguments` + `filledTypes` call and the exact same 6-line `checkReferencedPlaces` call:
     ```ts
     checkReferencedPlaces(context, written, {
       name: request.name,
       isAsync: context.checker.fitting.awaitedOf(signature.result())?.value !== undefined,
       slots: written.map((_, index) => slots.get(index) ?? { reference: false }),
     });
     ```
  4. `checkValueCall` (`value-calls.ts:124-131`) also duplicates the `!context.deferrals.isDeferred(...)` guard and `checkCallKind` check from `recordChosen` (`resolve/index.ts:288-290`).
  5. Because value calls bypass `resolveCall`, `CheckedBody` has to maintain a separate `ValueCalls` table (`valueCalls`, `ValueCallMade`) beside `CallRecords` (`resolved`).
- proposal: Unify `applyValueCall`/`completeValueCall` with `resolveCall`/`completeCall` in `src/compiler/checker/resolution/` so a single-signature call (with `typeParameters: []`) joins the constraint scope, fits arguments, checks `&` places, and checks call marks through one pipeline.
- confidence: high

### [high] Member lookup (`lookup/members.ts`) re-implements candidate and static-function discovery from `resolution/choosing/candidates.ts` (and misses union trait methods)
- where: `src/compiler/checker/lookup/members.ts:99-164`, `src/compiler/checker/resolution/choosing/candidates.ts:68-127, 155-259`
- evidence:
  1. `topLevelCandidates` (`candidates.ts:68-81`) gathers candidates from four sources: (a) `namedInModule` (top-level + named imports + prelude), (b) `argumentDependent` (`declaringModule(checker, argument)` exports), (c) `requirementCandidates` (`knownConstraints` on type parameters/`any`/computed types), and (d) `traitCallCandidates` (`visibleTraits` on a union receiver).
  2. `methodNames` in `lookup/members.ts:146-163` manually reconstructs the set of candidate names to feed back into `topLevelCandidates`:
     - It walks AST `declaredFunctions({ items })` and `item.kind === 'NamedImport' ? importedNames(item).map((each) => boundName(each).text)` + `inputs.role('prelude')` instead of asking `bindings` / `candidates.ts`.
     - It duplicates `declaringModule` (`candidates.ts:258`: `const target = staticTargetOf(checker, type); return target?.kind === 'owner' ? target.module : undefined;`) inline at `lookup/members.ts:148-151`.
     - It walks `knownConstraints(checker, type).flatMap(({ trait }) => requiredFunctions(trait)...)`.
     - It completely omits source (d) (`visibleTraits` when `type.kind === 'union'`), so `methodsOf` (`lookup/members.ts:129-143`) fails to discover trait methods on a union unless a top-level function of the same name happens to be in scope or in the prelude!
  3. Similarly, `staticsOf` (`lookup/members.ts:99-123`) switches on `staticTargetOf(checker, type)` and for `case 'constrained'` collects names from `knownConstraints(checker, type)` only to pass each name back into `staticCandidates(checker, module, target, name)` (`candidates.ts:203-216`), which re-walks `knownConstraints` via `requirementsNamed`.
- proposal: Export candidate-enumeration helpers for all methods/statics on `type` in `module` directly from `src/compiler/checker/resolution/choosing/candidates.ts` (sharing `visibleTraits`, `declaringModule`, and `staticCandidatesIn`), and have `lookup/members.ts` call them instead of re-deriving candidate names from AST items and `knownConstraints`.
- confidence: high

### [high] Deferred calls (`g f(args)`) duplicate closure capture, sendability, reference, and mark rules instead of reducing to the closure machinery
- where: `src/compiler/checker/resolution/calls/deferred-arguments.ts:18-48`, `src/compiler/checker/constructs/expressions/deferred-calls.ts:48-259`, `src/compiler/checker/resolution/applying/call-kinds.ts:93-130`, `src/compiler/checker/resolution/applying/argument-fit.ts:86-87`, `src/compiler/checker/resolution/calls/resolve/index.ts:288-291`, `src/compiler/checker/resolution/calls/resolve/explanations.ts:79-89, 163-167, 203-206`, `src/compiler/checker/resolution/choosing/binding.ts:91-110, 196-215`
- evidence:
  1. As `deferred-calls.ts:2-4` states, `g f(args)` is semantically `g((fn(x): fn(): f(x))(args))` — a zero-parameter function value capturing the values `f(args)` computes now.
  2. Instead of sharing the closure capture and mark machinery (`constructs/closures/` and `resolution/applying/call-kinds.ts`), deferred calls implement parallel versions of:
     - Capture mark joining: `laterMarkOf` (`deferred-calls.ts:164-182`) runs a manual `markOrder.join` loop over `checker.valueKindsOf(type)` and reports `checkerDiagnostics.kindsHeld(node.span, 'a deferred call', kindText(mark), held)`, duplicating the exact `markOrder.join` + `checkerDiagnostics.kindsHeld` loop inside `markMaking` (`call-kinds.ts:102-127`).
     - Capture sendability: `deferred-arguments.ts:25-48` (`unsendable`, `explainedCaptures`) checks `!isSendable(context.checker, type)` on each captured operand and hooks into `explainMisfit` (`explanations.ts:204`), while `deferredFunction` (`deferred-calls.ts:152-155`) also computes `capturedSend`.
     - Capture reference refusal: `refused` + `referencedReceiver` (`deferred-calls.ts:214-240`) manually checks for `&` arguments and `&self` receivers, paralleling `FunctionScopes.noteUse` / `capture` (`closures/functions.ts:89-96`).
     - Call-kind deferral: `Deferrals` (`deferred-calls.ts:48-77`) threads `context.deferrals.isDeferred` into `resolve/index.ts:288`, `value-calls.ts:124`, `argument-fit.ts:86`, `data-kinds.ts:326` (`laterOf`), and `disposal.ts:264`.
- proposal: Factor the shared mark-joining over held value types into `markMaking` (`src/compiler/checker/resolution/applying/call-kinds.ts`) so `laterMarkOf` and `markMaking` share one implementation, and unify deferred-call capture validation with closure capture rules.
- confidence: high

### [high] Qualified enum variants and plain type aliases to enums are partially resolved in the binder (`qualifiers.ts`) instead of the checker
- where: `src/compiler/binder/link/qualifiers.ts:19-62`, `src/compiler/binder/link/index.ts:251-257, 275-285, 332-409`, `src/compiler/checker/types/written/named-types.ts:154-190`, `src/compiler/checker/constructs/expressions/structs/literal-types.ts:62-97`
- evidence:
  1. The binder has no type information, yet `src/compiler/binder/link/qualifiers.ts` (`qualifierOf`, `aliasedEntity`) implements a special-case syntactic alias follower (with its own cycle-detection `Set<TypeAliasDeclaration>`) so `E.Red` resolves when `type E = Color`.
  2. Because `aliasedEntity` (`qualifiers.ts:44-62`) runs in the binder without types, it requires `written.typeArguments.length === 0 && declaration.typeParameters.length === 0`, so `type IntResult = Result<Int, String>; IntResult.Ok(1)` fails to qualify `Ok`, whereas struct aliases (`type IntPair = Pair<Int, String>`) and static calls (`IntResult.default()`) resolve in the checker (`named-types.ts`, `literal-types.ts`) and work with type arguments!
  3. Inside `qualifiers.ts:57-61`, `aliasedEntity` also re-implements qualified path walking by hand (`lookup.topLevelNamed` + `lookup.exportOf`), and `#aliasLookup.exportOf` (`binder/link/index.ts:392-395`) checks only `exports.get(name)`, diverging from `#exported` (`binder/link/index.ts:265-279`) which also grants test modules access to `privates`.
  4. In `Linker.#member` (`binder/link/index.ts:375-381`), when `qualifier` is an `EnumDeclaration` and `role === 'type'`, a path `Color.Foo` in a type annotation checks `this.#variantsOfEnum` and reports `missingVariant` (`Enum 'Color' has no variant 'Foo'`) if `Foo` is not an associated type — even though a variant can never stand in a type position (`role === 'type'`).
- proposal: Keep the binder's path resolution strictly for module namespaces (`NamespaceEntity`), and resolve `Type.Member` (enum variants, static functions, associated types, through any `TypeAliasDeclaration` generic or instantiated) uniformly in the checker (`types/written/named-types.ts` and `resolve-type.ts`).
- confidence: high

### [med] Type-parameter constraint checking and admissibility are duplicated across 4 places (`admits.ts`, `receivers.ts`, `conformance.ts`, `type-parameters.ts`)
- where: `src/compiler/checker/resolution/conformance/admits.ts:16-33`, `src/compiler/checker/resolution/choosing/receivers.ts:70-89`, `src/compiler/checker/resolution/conformance/conformance.ts:133-164`, `src/compiler/checker/constructs/declarations/type-parameters.ts:78-105, 189-208, 279-302`
- evidence:
  1. `admitting` (`admits.ts:16-33`) and `meetsWhereFound` (`receivers.ts:70-89`) both test whether a type parameter's inferred bound meets its constraints that mention no still-open type parameter:
     - `admitting`:
       ```ts
       checker.constraintsOf(parameter).every((constraint) => {
         const mapped = substituteConstraint(constraint, own, checker.typeRules);
         return mapped.arguments.some((argument) => parametersIn(argument).length > 0) || meets(type, mapped);
       })
       ```
     - `meetsWhereFound`:
       ```ts
       checker.constraintsOf(parameter).every((constraint) => {
         const mapped = substituteConstraint(constraint, substitution, checker.typeRules);
         return mapped.arguments.flatMap(parametersIn).some(isOpen) || meets(site, found, mapped);
       })
       ```
     Yet `admitting` also checks `isOneMember(union, type, ...)` while `meetsWhereFound` omits `memberUnionOf`, and both omit `structConstraintsOf(parameter)`!
  2. `witnessesOf` (`conformance.ts:140-161`) and `TypeParameters.#check` (`type-parameters.ts:189-208`) both run the same three checks for a type parameter's argument: (a) `standsForMember(site, parameter, argument, substitution)`, (b) `meetsStructConstraints(site, parameter, { argument, substitution }, ...)`, and (c) substituting `checker.constraintsOf(parameter)` and checking conformance.
  3. In `type-parameters.ts:78-105, 279-302`, `resolveConstraints` and `resolveStructConstraints` re-implement `resolveConstraintSet(checker, module, parameter.constraints, () => parameterType(parameter))` from `types/traits/struct-constraints.ts:30` (which `type-parameters.ts` already imports on line 48!), and `impliedConstraints(checker, checker.inputs.treeOf(module), parameter)` is computed twice per parameter (once in `#constraints` for `.traits` and once in `#structConstraints` for `.structs`).
- proposal: Unify `admitting` and `meetsWhereFound` in `src/compiler/checker/resolution/conformance/admits.ts` (including member-union and struct-constraint checks), and in `type-parameters.ts` resolve a parameter's `ConstraintSet` once via `resolveConstraintSet` + `impliedConstraints`.
- confidence: high

### [med] Witness parameter adaptation (`!reference && literal ? baseOf : type`) and witness signature matching are duplicated between `declared-witness.ts` and `witness-bindings.ts`
- where: `src/compiler/checker/resolution/conformance/declared-witness.ts:67-84`, `src/compiler/checker/resolution/conformance/met-instantiations/witness-bindings.ts:109-165`, `src/compiler/checker/resolution/choosing/named-functions.ts:375-380, 444-491`
- evidence:
  1. `chooseWitnessAmong` (`declared-witness.ts:74-80`) and `byValue` (`witness-bindings.ts:163-165`) encode the exact same rule for adapting a required slot's type when matching a witness (widening a by-value literal to its base while keeping `&Self` exact):
     - `declared-witness.ts:76`: `type: !reference && each.kind === 'literal' ? baseOf(each) : each`
     - `witness-bindings.ts:164`: `return !slot.reference && slot.type.kind === 'literal' ? baseOf(slot.type) : slot.type;`
  2. `bindingAs` (`witness-bindings.ts:116-125`) manually checks `own.parameters.length >= taken.length && own.parameters.every((slot, index) => { const slotTaken = taken[index]; return slotTaken === undefined ? slot.hasDefault : slotTaken.reference === slot.reference; })`, which is the exact parameter-count/default/reference rule that `bindValue` (`choosing/binding.ts:116`) + `judgedArgument` (`choosing/applicability.ts:218`) enforce for `chooseWitnessAmong`.
  3. `passingOf(reference: boolean): Passing` (`reference ? 'reference' : 'value'`) in `named-functions.ts:489` is re-spelled inline in `declared-witness.ts:77` and `clashes.ts:229`.
- proposal: Export a shared `witnessArgumentType(slot)` (or `witnessArgumentsOf(required)`) helper from `src/compiler/checker/resolution/conformance/declared-witness.ts` and reuse it in `witness-bindings.ts`, and export `passingOf` from `src/compiler/checker/resolution/choosing/call-arguments.ts`.
- confidence: high

### [med] Parent-chain walks to find a node's enclosing `TypeCase` and `AliasDeclaration` are written 3 times (`implied-constraints.ts`, `type-match.ts`, `type-matches.ts`)
- where: `src/compiler/checker/resolution/type-matches/implied-constraints.ts:64-83`, `src/compiler/checker/types/written/type-match.ts:145-162`, `src/compiler/checker/types/written/written-matches.ts:82-104`, `src/compiler/syntax/types/type-matches.ts:23-35`
- evidence:
  1. `casePatternOf` (`implied-constraints.ts:64-83`) walks `parentOf(tree, node)` up to `TypeCase`, then checks `parentOf(tree, typeCase)` (`TypeMatch`) and `parentOf(tree, typeMatch)` (`TypeAliasDeclaration | AssociatedType`), then looks up `checker.typeMatches.typeMatchOf(alias)?.cases.find((each) => each.node === typeCase)?.pattern`.
  2. `structCaseOf` (`types/written/type-match.ts:145-162`) walks `parentOf(tree, node)` up to `TypeCase`, checks `alias = parentOf(tree, parentOf(tree, parent) ?? parent)` (`TypeAliasDeclaration | AssociatedType`), and its sole caller `asWrittenInMatch` (`written-matches.ts:89-92`) immediately runs the exact same lookup:
     ```ts
     const found = structCaseOf(treeOf(written), node);
     const form = found === undefined ? undefined : written.checker.typeMatches.typeMatchOf(found.alias);
     const pattern = form?.cases.find((each) => each.node === found?.node)?.pattern;
     ```
  3. `matchPlaceOf` (`syntax/types/type-matches.ts:23-35`) walks the same `parentOf(tree, node)` chain to test if `node` is under `TypeCase.pattern` or `TypeMatch`.
- proposal: Provide a single `enclosingTypeCase(tree, node)` helper in `src/compiler/syntax/types/type-matches.ts` returning `{ typeCase, alias, inPattern: boolean }` and a single `resolvedCaseOf(checker, tree, node)` helper in `src/compiler/checker/types/written/type-match.ts`, used by `implied-constraints.ts`, `written-matches.ts`, and `matchPlaceOf`.
- confidence: high

### [med] Constraint and struct-constraint key/text/conformance helpers are duplicated between `witness-outcomes.ts`, `shortfalls.ts`, `type-match-patterns.ts`, `type-keys.ts`, and `struct-constraint.ts`
- where: `src/compiler/checker/resolution/conformance/witness-outcomes.ts:313-351`, `src/compiler/checker/types/identity/type-keys.ts:195-199, 302-306`, `src/compiler/checker/types/type/struct-constraint.ts:97-115`, `src/compiler/checker/resolution/conformance/shortfalls.ts:138-156, 214-239, 342-344`, `src/compiler/checker/resolution/type-matches/type-match-patterns.ts:317-337`
- evidence:
  1. `constraintKey` in `witness-outcomes.ts:330` (`${keys.identityOf(trait)}<${args.map(keys.key).join(',')}>`) is duplicated verbatim in `type-keys.ts:197` and `type-keys.ts:304`.
  2. `structModelKey` and `entryRuleKey` in `witness-outcomes.ts:334-351` mirror `structConstraintText` and `ruleText` in `types/type/struct-constraint.ts:97-111`, while `shortfalls.ts:342-344` defines a second `ruleText(rule: EntryRule)` function (`rule.kind === 'type' ? typeText(rule.type) : constraintSetText(rule)`) which `struct-constraint.ts:106` could call as ``rule.kind === 'type' ? `: ${ruleText(rule)}` : ` is ${ruleText(rule)}` ``.
  3. Checking whether a `Type` satisfies a `ConstraintSet` (`traits` + `structs`) is written three times: `ruleShortfall` (`shortfalls.ts:224-237`), `boundShortfall` (`shortfalls.ts:146-155`), and `variableMeets` (`type-match-patterns.ts:326-332`).
- proposal: Move `constraintKey`/`structModelKey` (or a generic `formatStructConstraint`) into `types/identity/type-keys.ts` / `types/type/struct-constraint.ts`, export `ruleText` from `struct-constraint.ts`, and share a `constraintSetShortfall` helper in `shortfalls.ts` used by `ruleShortfall`, `boundShortfall`, and `variableMeets`.
- confidence: high

### [med] Dead/unimported exports and test-only exports across `binder/`, `check.ts`, and `resolution/`
- where: `src/compiler/binder/entities.ts:132`, `src/compiler/binder/module/local-binder.ts:92`, `src/compiler/checker/check.ts:201, 222`, `src/compiler/checker/resolution/applying/argument-fit.ts:27, 55`, `src/compiler/checker/resolution/applying/call-kinds.ts:158`, `src/compiler/checker/resolution/applying/implicit.ts:84, 92`, `src/compiler/checker/resolution/calls/collection-functions.ts:26, 61`, `src/compiler/checker/resolution/calls/operators.ts:28`, `src/compiler/checker/resolution/calls/places.ts:55, 185`, `src/compiler/checker/resolution/calls/resolve/explanations.ts:75, 112`, `src/compiler/checker/resolution/calls/resolve/index.ts:70, 266`, `src/compiler/checker/resolution/choosing/applicability.ts:38, 97, 135`, `src/compiler/checker/resolution/choosing/binding.ts:45, 69`, `src/compiler/checker/resolution/choosing/candidates.ts:56`, `src/compiler/checker/resolution/conformance/conformance.ts:215, 228`, `src/compiler/checker/resolution/conformance/declared-witness.ts:53, 67, 93`, `src/compiler/checker/resolution/conformance/shortfalls.ts:77, 97, 394, 415`, `src/compiler/checker/resolution/conformance/trait-calls.ts:88`, `src/compiler/checker/resolution/conformance/union-traits.ts:43, 49, 68, 93`, `src/compiler/checker/resolution/conformance/witness-outcomes.ts:120`, `src/compiler/checker/resolution/type-matches/reduction-requirements.ts:269`, `src/compiler/checker/resolution/type-matches/type-match-patterns.ts:48`, `src/compiler/checker/resolution/type-matches/type-matches.ts:211-212`
- evidence:
  1. `SearchGoals` (`witness-outcomes.ts:120`) and `BoundArgument` (`binding.ts:45`) are exported solely for unit tests (`witness-outcomes.test.ts`, `binding.test.ts`) and have 0 non-test importers.
  2. `Checker.topLevelFunctions(module, name)` (`check.ts:201`, implemented in `program-checker.ts:374` as `return namedInModule(this, module, name);`) is a 1-line forwarding wrapper over `namedInModule` (`candidates.ts:145`) with only 1 external caller (`lowering/lower.ts`).
  3. `isGenericDeclaration` in `reduction-requirements.ts:269` (`return typeParametersOf(declaration.typeParameters).length > 0;`) shadows the project's `isGenericDeclaration` naming from `syntax/declarations/index.ts:84` and is only used once at line 104 (`declaration.kind === 'FunctionDeclaration' && !isGenericDeclaration(declaration)`).
  4. `type-matches.ts:211-212` has a stale duplicate TSDoc comment (`/** The reductions under way now. */` immediately before `/** Whether no reduction is under way... */`).
  5. 17 exported types/interfaces have 0 importers anywhere in `src/` or `test/`: `SelfEntity` (`entities.ts:132`), `PathRole` (`local-binder.ts:92`), `CheckProgramOptions` (`check.ts:222`), `FittedArgument` (`argument-fit.ts:27`), `CallOfKind` (`call-kinds.ts:158`), `ImplicitOperatorRequest` & `PreludeRequest` (`implicit.ts:84, 92`), `ElementWrite` (`collection-functions.ts:26`), `AppliedOperator` (`operators.ts:28`), `PlaceUse` & `ReferencingCallee` (`places.ts:55, 185`), `ExplainedCall` (`explanations.ts:112`), `Chosen` (`resolve/index.ts:266`), `StaticTarget` (`candidates.ts:56`), `StructJudge` (`shortfalls.ts:394`), `ClosedTraitCall` (`trait-calls.ts:88`), `MembersCall` (`union-traits.ts:43`), `Outcome` (`type-match-patterns.ts:48`).
- proposal: Unexport `SearchGoals`, `BoundArgument`, and the 17 unimported types/interfaces; remove the duplicate TSDoc in `type-matches.ts:211`; and either use `Checker.topLevelFunctions` consistently or inline `namedInModule`.
- confidence: high

### [low] Open alias-instance construction is duplicated in `reduction-requirements.ts`
- where: `src/compiler/checker/resolution/type-matches/reduction-requirements.ts:163-166, 262-266`, `src/compiler/checker/types/written/type-match.ts:126-138`
- evidence:
  In `reduction-requirements.ts`, both `#instance` (line 163) and `associated` (line 262) construct an open `aliasInstance` with identical arguments:
  - `#instance(alias: TypeAliasDeclaration)`: `return aliasInstance(alias, checker.aliasedType(alias), new Map(), checker.typeRules);`
  - `associated(checker, declaration)`: `return declaration.associatedTypes.map((each) => aliasInstance(each, checker.aliasedType(each), new Map(), checker.typeRules));`
  Furthermore, all 4 callers of `aliasInstance` across the codebase (`resolve-type.ts:315, 320`, `known-constraints.ts:212`, `reduction-requirements.ts:165, 264`) pass `checker.aliasedType(declaration)` and `checker.typeRules`.
- proposal: Have `#instance` in `reduction-requirements.ts` accept `AliasDeclaration` (`TypeAliasDeclaration | AssociatedType`) and use it for both `TypeAliasDeclaration` and `declaration.associatedTypes`, or let `aliasInstance` in `types/written/type-match.ts` take `checker: Pick<CheckerContext, 'aliasedType' | 'typeRules'>` and default `substitution = noSubstitution`.
- confidence: high

## Missing from docs/reuse

### Exported units in `res` with callers outside their folder not listed in `docs/reuse/*.md`
- `src/compiler/binder/diagnostics.ts`: `binderDiagnostics` (6 callers outside folder)
- `src/compiler/binder/entities.ts`: `Entity` (37 callers), `VariableEntity` (18 callers), `VariantEntity` (12 callers), `VariantNaming` (6 callers), `NamespaceEntity` (5 callers), `VariableOwner` (4 callers), `TypeEntity` (4 callers), `FunctionsEntity` (3 callers), `VariantsEntity` (3 callers)
- `src/compiler/checker/check.ts`: `SignatureParameter` (24 callers), `VariantMember` (7 callers), `CheckedConstant` (3 callers), `Disposal` (3 callers), `MemberConversion` (2 callers), `Checker.topLevelFunctions`, `Checker.languageFunctions`, `Checker.wellKnownEntity`, `Checker.wellKnownType`, `Checker.cellOf`, `Checker.sharedValueOf`, `Checker.fieldsOf`, `Checker.variantsOf`, `Checker.parametersOf`, `Checker.resultOf`, `Checker.bodyOf`, `Checker.defaultsOf`, `Checker.constantOf`, `Checker.constantBodyOf`, `Checker.constantNamed`, `Checker.contextConstants`, `Checker.aliasedType`, `Checker.aliasArgumentsFor`, `Checker.kindOf`, `Checker.reachesDisposable`
- `src/compiler/checker/resolution/applying/argument-fit.ts`: `withSolvedTypes` (2 callers), `recordArgumentKeys` (1 caller)
- `src/compiler/checker/resolution/applying/call-kinds.ts`: `checkCallKind` (3 callers), `kindText` (3 callers), `callerName` (1 caller)
- `src/compiler/checker/resolution/applying/implicit.ts`: `ImplicitCalls` (2 callers)
- `src/compiler/checker/resolution/calls/call-records.ts`: `CallRecords` (2 callers)
- `src/compiler/checker/resolution/calls/deferred-arguments.ts`: `DeferredArgument` (1 caller), `explainedCaptures` (1 caller)
- `src/compiler/checker/resolution/calls/places.ts`: `immutableKind` (1 caller)
- `src/compiler/checker/resolution/calls/resolve/index.ts`: `WrittenArgument` (5 callers), `callArgumentOf` (1 caller), `appliedArgumentOf` (1 caller)
- `src/compiler/checker/resolution/choosing/binding.ts`: `argumentSlotsOf` (1 caller), `BoundSlot` (1 caller), `BindingFailure` (2 callers)
- `src/compiler/checker/resolution/choosing/call-arguments.ts`: `CallArgument` (7 callers), `Inapplicability` (3 callers), `Passing` (3 callers), `SignatureSlot` (2 callers), `Takes` (1 caller), `Misfit` (1 caller)
- `src/compiler/checker/resolution/choosing/candidates.ts`: `Candidate` (9 callers)
- `src/compiler/checker/resolution/choosing/choice.ts`: `Application` (7 callers), `Signature` (4 callers), `Choice` (2 callers)
- `src/compiler/checker/resolution/choosing/named-functions.ts`: `ownChoice` (1 caller), `NamedFunctions` (1 caller), `MadeValue` (1 caller)
- `src/compiler/checker/resolution/choosing/receivers.ts`: `selfInference` (1 caller)
- `src/compiler/checker/resolution/conformance/conformance.ts`: `Instantiation` (4 callers), `rootSearches` (1 caller)
- `src/compiler/checker/resolution/conformance/root-goals.ts`: `programRootGoals` (1 caller)
- `src/compiler/checker/resolution/conformance/witness-outcomes.ts`: `goalKey` (1 caller)
- `src/compiler/checker/resolution/type-matches/reduction-requirements.ts`: `failureDiagnostic` (1 caller)

### Stale or inaccurate entries in `docs/reuse/*.md` for `res` (and adjacent resolution docs)
- `docs/reuse/types-and-fitting.md:93` lists `entailed`/`structEntailed` under `src/compiler/checker/resolution/conformance/shortfalls.ts` as reusable units, but both `entailed` and `structEntailed` are private (non-exported) functions in `shortfalls.ts`.
- `docs/reuse/types-and-fitting.md:107` lists `instancesWith` under `src/compiler/checker/types/written/pattern-types.ts`, but `instancesWith` is private in `pattern-types.ts`; the exported function is `instancesNamed` (along with `variantEnums`, which is exported there but unlisted).
- `docs/reuse/calls-and-resolution.md:55` lists `runsAtOnce` (`src/compiler/checker/resolution/calls/collection-functions.ts`) as a reusable unit, but `runsAtOnce` has 0 callers outside `src/compiler/checker/resolution/calls/`.
