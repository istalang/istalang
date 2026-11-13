# typ-findings — `src/compiler/checker/types`

### [high] Parallel `Type`-rebuilding switches in `parts/type-children.ts` and `parts/type-parts.ts`
- where: `src/compiler/checker/types/parts/type-children.ts:78-154`, `src/compiler/checker/types/parts/type-parts.ts:204-276`
- evidence: `withTypeChildren` (`withPartsTaken` + `withListedParts`, 66 lines in `type-children.ts`) and `mapParts` (`partsMapped`, 53 lines in `type-parts.ts`) sit in the same `types/parts/` folder and both switch exhaustively over every non-union, non-recursive `Type` kind to rebuild a `Type` with its direct children replaced in `typeChildren(type)` order. The only differences are:
  1. `withPartsTaken` pulls the next child from a stateful `child: () => Type` closure over `children: readonly Type[]` and strips `alias`, whereas `partsMapped` calls `map(child)` on each child and preserves `alias` (and uses `mappedParts(type, map)` from `computed-reduction.ts`, which `withPartsTaken` duplicates inline at lines 122-128).
  2. For `case 'anonymous'`, `withPartsTaken` also updates `field.declared.type` when `declared !== undefined`, whereas `partsMapped` only updates `field.type`.
  Adding or modifying any `Type` variant requires updating `typeChildren`, `withPartsTaken`/`withListedParts`, and `partsMapped` in lockstep.
- proposal: Make `mapParts` (or a shared `rebuildParts(type, map, options?)` in `src/compiler/checker/types/parts/type-children.ts`) the single switch that rebuilds a non-union, non-recursive `Type` by mapping its children in `typeChildren` order. Implement `withTypeChildren(type, children)` on top of it by passing a stateful `() => children[next++]` mapper and stripping `alias`.
- confidence: high

### [high] Struct-constraint field-rule aggregation duplicated between `traits/known-constraints.ts` and `resolution/conformance/shortfalls.ts` with a semantic discrepancy on `[_]` rules
- where: `src/compiler/checker/types/traits/known-constraints.ts:313-336`, `src/compiler/checker/resolution/conformance/shortfalls.ts:322-336`
- evidence: Both `entryRules(checker, type)` in `known-constraints.ts` and `knownFields(models)` in `shortfalls.ts` aggregate `models = structConstraintsOn(checker, type)` to determine what `EntryRule`s apply to a named field `name` vs unnamed `others`:
  - In `shortfalls.ts:327-333` (`knownFields`), for any field `name` named by at least one model in `models`, it collects `model.named.find((entry) => entry.name === name)?.rule ?? model.others` from every model — recognizing that if `S is struct { x is A } & struct { y: String, [_] is B }`, field `x` must also satisfy the second constraint's `others` (`[_] is B`).
  - In `known-constraints.ts:319-323` (`entryRules`), for a literal key `name`, it collects only `models.flatMap((model) => model.named.find((entry) => entry.name === name)?.rule ?? [])`, ignoring `model.others` from other struct constraints on the same type when `name` is present in `models`.
  - Similarly, `src/compiler/checker/types/traits/struct-keys.ts:95` and `src/compiler/checker/lookup/members.ts:88-90` re-extract `models.flatMap((model) => model.named.map((entry) => entry.name))`.
- proposal: Make `src/compiler/checker/types/traits/known-constraints.ts` the single home for querying aggregated field rules of `structConstraintsOn(checker, type)` (exporting `knownStructFields` / `entryRules` that includes `model.others` for fields named by any model in `models`), and have `shortfalls.ts` (`opaqueShortfall`, `structEntailed`) and `struct-keys.ts` (`keysOf`) call it instead of re-aggregating `StructConstraintModel[]`.
- confidence: high

### [high] Dual parameter-space vs variable-space API and 13 pass-through scope wrappers on `Inference` (`types/inference/infer.ts`)
- where: `src/compiler/checker/types/inference/infer.ts:202-362`, `src/compiler/checker/types/inference/infer.ts:227-243`, `src/compiler/checker/types/inference/infer.ts:440-446`, `src/compiler/checker/wiring/body/constraint-scope.ts:44-243`
- evidence: The banners of `infer.ts` and `system.ts` state: *"This class [Inference] speaks in the parameters' names; the system of variables it speaks for is system.ts"* and *"Inference (infer.ts) speaks for one call in its parameters' names; this class [CallSystem] meets only the variables standing for them."* In reality:
  1. Because `ConstraintScope` (`wiring/body/constraint-scope.ts`) stores `#root: Inference | undefined` instead of a `CallSystem`, `Inference` carries 13 methods that do not touch `#parameters` or `#variables` at all and only forward open variable-space types to `#system` or `system-reading.ts`: `mentionsVariables`, `solveJointly`, `admitOpen`, `settleAs`, `tentativeIn`, `expectationOf`, `waitsOn`, `fixToward`, `fixDefaults`, `fixIn`, `fixedIn`, `guidedIn`, and `solved`.
  2. `Inference.guided(type, settling)` (`infer.ts:227-243`, 17 lines, only 1 caller in `resolution/calls/resolve/written-expectations.ts:56`) re-implements `Inference.guidedIn(type, settlingOf)` (`infer.ts:347-357`): `guided(type, settling)` calls `this.settledIn(type)` (which restores twin variables back to parameters) and then loops over `parametersIn(settled)` to turn unfixed parameters back into twin variables (`this.#variables.typeOf(parameter)`) or `expectedChoiceFor`. It is equivalent to `this.guidedIn(this.open(type), () => this.#variables.settlingFor(settling))`.
  3. `Inference.settledIn(declared)` (`infer.ts:440-446`) is equivalent to `this.#variables.restored(this.fixedIn(this.open(declared)))`.
- proposal: Expose the scope's `CallSystem` (or a scope-facing facet of `CallSystem`) directly to `ConstraintScope` so variable-space operations live only on `CallSystem`, and express `Inference.guided` and `Inference.settledIn` by composing `this.open(...)`, the `CallSystem` method (`guidedIn`, `fixedIn`), and `this.#variables.restored(...)`.
- confidence: high

### [high] Qualifier-parameter vs member-bounded associated-type duplication between `properties/qualifiers.ts` and `type/function-kinds.ts`
- where: `src/compiler/checker/types/properties/qualifiers.ts:21-50`, `src/compiler/checker/types/type/function-kinds.ts:162-194`, `src/compiler/checker/types/traits/data-kind.ts:33-54`
- evidence:
  1. `properties/qualifiers.ts:21` redeclares `const marks: readonly Mark[] = ['simple', ...persistences];` even though `marks` is already exported by `src/foundation/language/well-known/index.ts:141` (and imported from there by `type/function-kinds.ts:18`).
  2. `docs/reuse/types-and-fitting.md` states the one-way rule: *"`Fitting.memberUnionOf`, taking any type, undefined for one standing for no member, which every reader holding the type uses, never the declaration's or its node kind."* Yet `type/function-kinds.ts` (`isOneKind`, `isMarkVariable`, `isBoundTo`, lines 162-194) branches on `type.kind === 'parameter' && type.declaration.kind === 'TypeParameter'` (calling `isMarkParameter` / `standsForOneKind` -> `qualifierParameterOf`) vs `type.kind === 'associated'` (calling `isBoundTo(lookup, type, marks | persistences)`, which re-checks whether every member of `lookup.fitting.memberUnionOf(type)` is a literal in `marks` or `persistences`).
  3. Likewise, `traits/data-kind.ts:34` (`boundKindsOf`) guards `type.kind === 'associated' ? checker.fitting.memberUnionOf(type) : undefined`, whereas `mayBeOfKind` right below it (`data-kind.ts:48`) calls `checker.fitting.memberUnionOf(type)` directly on any `type`.
- proposal: Import `marks` from `src/foundation/language/well-known/index.ts` in `properties/qualifiers.ts`. Extract `qualifierOfUnion(union: Type | undefined): QualifierParameter | undefined` in `properties/qualifiers.ts` (or let `Fitting.qualifierOf` accept `ParameterKey | Type` via `Fitting.memberUnionOf`), and use it in `isOneKind` and `isMarkVariable` in `type/function-kinds.ts`, deleting `isBoundTo`.
- confidence: high

### [high] Verbatim re-implementation of `GenericDeclaration` and `isGenericDeclaration` in `type/function-kinds.ts`
- where: `src/compiler/checker/types/type/function-kinds.ts:197-223`, `src/compiler/syntax/declarations/index.ts:72-94`
- evidence: `src/compiler/syntax/declarations/index.ts:72-94` exports `GenericDeclaration`, `genericKinds`, and `isGenericDeclaration(node)` (indexed in `docs/reuse/modules-and-names.md`). `src/compiler/checker/types/type/function-kinds.ts:197-223` re-implements the exact same 7-kind `GenericDeclaration` type, `genericKinds` set (`FunctionDeclaration`, `StructDeclaration`, `SharedStructDeclaration`, `EnumDeclaration`, `ExternStructDeclaration`, `TraitDeclaration`, `TypeAliasDeclaration`), and `isGenericDeclaration(node)` function by hand. Furthermore, `src/compiler/checker/types/written/pattern-types.ts:39` exports a conflicting `export type GenericDeclaration = NominalDeclaration;` (only 4 kinds) that is just a redundant alias for `NominalDeclaration` (`types/type/index.ts:83`).
- proposal: Delete `GenericDeclaration`, `genericKinds`, and `isGenericDeclaration` from `src/compiler/checker/types/type/function-kinds.ts:197-223` and import `GenericDeclaration` and `isGenericDeclaration` from `src/compiler/syntax/declarations/index.ts`. Replace `export type GenericDeclaration = NominalDeclaration` in `src/compiler/checker/types/written/pattern-types.ts:39` (and its 1 external import in `constructs/patterns/walk/named-members.ts:18`) with `NominalDeclaration` (or `EnumDeclaration` in `variantEnums`).
- confidence: high

### [med] Near-identical open-union matching in `inference/equal.ts` (`equalUnion`) and `inference/relate.ts` (`intoUnionHolding`)
- where: `src/compiler/checker/types/inference/equal.ts:121-144`, `src/compiler/checker/types/inference/relate.ts:158-180`
- evidence: `equalUnion(declared, given, equating)` and `intoUnionHolding(expected, found, relating)` both:
  1. Partition `declared.members` / `expected.members` into `open` (members mentioning unknown inference variables) and `fixed` (members without).
  2. Filter `left = givenMembers.filter((each) => !fixed.some((member) => sameType(each, member)))`.
  3. Return `true` if `left.length === 0`.
  4. If `open.length === 1` (`open.length <= 1`), relate `only` with `unionOfNormalized(left)`.
  5. Otherwise relate `open` and `left` pairwise at matching indices (`open.length === left.length && open.every(...)`).
  The only difference is that `equalUnion` also requires every `fixed` member to be present in `givenMembers` and relates via `equalTypes`, whereas `intoUnionHolding` requires `found.kind === 'union'` and relates via `relating.constrain`.
- proposal: Extract a shared `matchUnionMembers(declared, givenMembers, isUnknown, relateMember, requireAllFixed)` helper in `types/inference/` (using `sameItems(relateMember)(open, left)` for step 5) and call it from both `equalUnion` and `intoUnionHolding`.
- confidence: high

### [med] Two incompatible functions exported under the same name `isKnown(type: Type): boolean` in `types/`
- where: `src/compiler/checker/types/parts/type-parts.ts:130-132`, `src/compiler/checker/types/unions/equality.ts:49-52`, `src/compiler/checker/types/unions/equality.ts:145-147`
- evidence:
  - `types/parts/type-parts.ts:130` exports `isKnown(type: Type): boolean`: `return parametersIn(type).length === 0 && computedTypesIn(type).length === 0;` (deep check: no type parameters or unreduced computed types anywhere in `type`; allows `Never` and `errorType`).
  - `types/unions/equality.ts:145` also exports `isKnown(type: Type): boolean`: `return !isOpaque(type) && type.kind !== 'error' && !isPrimitive(type, 'Never');` (shallow top-level check: not `parameter`/`ComputedType`, not `error`, and not `Never`).
  - Moreover, inside `types/unions/equality.ts` itself, line 50 defines `function unchecked(type: Type): boolean { return type.kind === 'error' || isPrimitive(type, 'Never'); }`, which `isKnown` on line 146 duplicates inline (`type.kind !== 'error' && !isPrimitive(type, 'Never')`) instead of calling `!unchecked(type)`.
- proposal: Rename one of the two functions to reflect its distinct meaning (e.g., `isClosedType(type)` or `isConcreteType(type)` in `parts/type-parts.ts`, keeping `isKnown` in `unions/equality.ts` as `return !isOpaque(type) && !unchecked(type)`), and document both in `docs/reuse/types-and-fitting.md`.
- confidence: high

### [med] `keyName` (`traits/struct-keys.ts`) re-implemented inline in 9 places across `types/` and `checker/`
- where: `src/compiler/checker/types/traits/struct-keys.ts:62-64`, `src/compiler/checker/types/traits/known-constraints.ts:129,139,319`, `src/compiler/checker/types/written/key-types.ts:113,135`, `src/compiler/checker/types/properties/qualifiers.ts:47`, `src/compiler/checker/surface/checked-field.ts:53`, `src/compiler/checker/resolution/calls/places.ts:162,308`, `src/compiler/checker/constructs/expressions/literals/indented-values.ts:208`
- evidence: `src/compiler/checker/types/traits/struct-keys.ts:62-64` exports:
  ```ts
  export function keyName(key: Type): string | undefined {
    return key.kind === 'literal' && typeof key.value === 'string' ? key.value : undefined;
  }
  ```
  Yet 9 other places — including 3 in `traits/known-constraints.ts` (in the same `types/traits/` folder!) and 2 in `written/key-types.ts` — write `key.kind === 'literal' && typeof key.value === 'string'` by hand instead of calling `keyName(key)` (or a `stringLiteralValue(type)` helper in `types/type/primitives.ts`).
- proposal: Move `keyName` (or `stringLiteral(type: Type): string | undefined`) to `src/compiler/checker/types/type/primitives.ts` so every layer can import it, and replace all 9 inline `x.kind === 'literal' && typeof x.value === 'string'` checks with it.
- confidence: high

### [med] Re-implementations of `encloses`, `typeParametersOf`, `sameItems`, `distinctItems`, `hasBounds`, and `wellKnown.future` inside `types/`
- where: `src/compiler/checker/types/traits/struct-keys.ts:317-320`, `src/compiler/checker/types/traits/known-constraints.ts:358-361,425`, `src/compiler/checker/types/inference/system-reading.ts:61-63,260-269`, `src/compiler/checker/types/inference/equal.ts:81-86,140-146,164-168`, `src/compiler/checker/types/inference/relate.ts:174-179`, `src/compiler/checker/types/type/type-text.ts:208,215`, `src/compiler/checker/types/properties/value-kinds.ts:156,276,293`
- evidence:
  1. `encloses` (`src/compiler/syntax/tree/positions.ts:107`): `traits/struct-keys.ts:317-320` writes `key.span.segment === entity.name.span.segment && key.span.from <= entity.name.span.from && entity.name.span.to <= key.span.to` instead of `encloses(key.span, entity.name.span)`.
  2. `typeParametersOf` (`src/compiler/syntax/declarations/index.ts:67`): `traits/known-constraints.ts:425` (`selfConstraint`) writes `trait.typeParameters.filter((each) => each.kind === 'TypeParameter')` instead of `typeParametersOf(trait.typeParameters)`. Conversely, `properties/value-kinds.ts:156,276,293` wraps `typeParametersOf(...)` around the argument to `substitutionFor(...)`, which already calls `typeParametersOf` internally (`parts/substitution.ts:45`).
  3. `distinctItems` (`src/foundation/structures/equality.ts:49`): `traits/known-constraints.ts:358-360` (`commonRules`) writes `asked.filter((trait, index) => asked.findIndex((other) => sameConstraint(other, trait)) === index && ...)` instead of `distinctItems(asked, sameConstraint)`.
  4. `sameItems` (`src/foundation/structures/equality.ts:13`): `inference/equal.ts:81-86` (`all`), `equal.ts:140-146` (`equalUnion`), `equal.ts:164-168` (`sameFieldNames`), and `inference/relate.ts:174-179` (`intoUnionHolding`) manually write `a.length === b.length && a.every((x, index) => ...)` instead of `sameItems(...)`.
  5. `hasBounds` (`src/compiler/checker/types/inference/settle.ts:168`): `inference/system-reading.ts` already imports `hasBounds` on line 16 (and uses `!hasBounds(reading.boundsOf(variable))` on line 245), yet `abandonedFrom` (`system-reading.ts:61-63`) writes `const { equal, lower, upper } = reading.boundsOf(variable); return equal === undefined && lower.length === 0 && upper.length === 0;` by hand. In the same file, `fixedIn` (`system-reading.ts:260-269`) duplicates `fixedSubstitution` (`system-reading.ts:336-348`).
  6. `wellKnown.future` (`src/foundation/language/well-known/index.ts:47`): `type/type-text.ts:208,215` defines `const futureName = 'Future';` instead of using `wellKnown.future.name` (violating `docs/reuse/modules-and-names.md`'s one-way rule against spelling well-known declaration names as string literals).
- proposal: Replace each manual re-implementation with the existing reusable unit (`encloses`, `typeParametersOf`, `distinctItems`, `sameItems`, `hasBounds`, `fixedSubstitution`, `wellKnown.future.name`) and drop the redundant `typeParametersOf` wrappers in `value-kinds.ts`.
- confidence: high

### [med] Enclosing `TypeCase` AST walk and `CaseForm` lookup duplicated across `written/type-match.ts`, `written/written-matches.ts`, `resolution/type-matches/implied-constraints.ts`, and `syntax/types/type-matches.ts`
- where: `src/compiler/checker/types/written/type-match.ts:143-160`, `src/compiler/checker/types/written/written-matches.ts:84-107`, `src/compiler/checker/resolution/type-matches/implied-constraints.ts:64-84`, `src/compiler/syntax/types/type-matches.ts:22-33`
- evidence:
  - `structCaseOf(tree, node)` in `types/written/type-match.ts:143-160` walks `parentOf(tree, ...)` to find an enclosing `TypeCase` and its parent `TypeMatch` and `AliasDeclaration` (`TypeAliasDeclaration | AssociatedType`), and `asWrittenInMatch` in `written-matches.ts:90-92` then looks up `checker.typeMatches.typeMatchOf(found.alias)?.cases.find((each) => each.node === found?.node)?.pattern`.
  - `casePatternOf(checker, tree, parameter)` in `resolution/type-matches/implied-constraints.ts:64-84` performs the exact same `parentOf` walk to `TypeCase` -> `TypeMatch` -> `TypeAliasDeclaration | AssociatedType` and the exact same `checker.typeMatches.typeMatchOf(alias)?.cases.find((each) => each.node === typeCase)?.pattern` lookup.
  - `matchPlaceOf(tree, node)` in `syntax/types/type-matches.ts:22-33` walks `parentOf(tree, ...)` to find `TypeCase` (checking `parent.pattern === child`) or `TypeMatch`.
- proposal: Provide a single `typeCaseAt(tree, node)` helper in `src/compiler/syntax/types/type-matches.ts` returning `{ readonly node: TypeCase; readonly alias: AliasDeclaration; readonly inPattern: boolean } | undefined` (which `matchPlaceOf` also uses), and a single `casePatternAt(checker, tree, node)` in `src/compiler/checker/types/written/type-match.ts` used by both `asWrittenInMatch` and `implied-constraints.ts`.
- confidence: high

### [med] `parameterType` (`written/resolve-type.ts`) and self-parameterized nominal types (`ownNominalType`) bypassed by manual object literals
- where: `src/compiler/checker/types/written/resolve-type.ts:149-151`, `src/compiler/checker/types/written/written-matches.ts:120`, `src/compiler/checker/types/written/key-types.ts:99`, `src/compiler/checker/types/inference/variables.ts:81,82,161`, `src/compiler/checker/types/properties/value-kinds.ts:59-63`, `src/compiler/checker/types/traits/known-constraints.ts:146`, `src/compiler/checker/rules/kinds/data-kinds.ts:200-204`, `src/compiler/checker/constructs/declarations/functions/signatures.ts:281-282`
- evidence:
  1. `parameterType(declaration: ParameterKey)` lives in `types/written/resolve-type.ts:149` instead of `types/type/index.ts`, and 9 places construct `{ kind: 'parameter', declaration, ... }` by hand: `written-matches.ts:120`, `variables.ts:81,82,161`, `value-kinds.ts:62`, `key-types.ts:99`, `known-constraints.ts:146`, `rules/placeholders.ts:30`, `rules/kinds/data-kinds.ts:203`, `constructs/loops/field-passes.ts:89`, and `constructs/patterns/walk/kinds/struct-fields.ts:103`.
  2. Three places build a nominal type applied to its own type parameters (`nominalType(entity, typeParametersOf(declaration.typeParameters).map(parameterType))`): `types/properties/value-kinds.ts:59-63`, `rules/kinds/data-kinds.ts:200-204`, and `constructs/declarations/functions/signatures.ts:281-282`.
- proposal: Move `parameterType(declaration: ParameterKey, within?: Type): TypeParameterType` to `src/compiler/checker/types/type/index.ts` alongside `nominalType` and `shapeType`, add `ownNominalType(entity: NominalEntity): NominalType` there, and use both at all call sites.
- confidence: high

### [med] Repeated `ConversionRules` construction in `fitting/fit/index.ts` and duplicated `literalsBase` over member parameters
- where: `src/compiler/checker/types/fitting/fit/index.ts:179-185,380-384,420-424,491-495`, `src/compiler/checker/types/unions/common-type.ts:73-80,130-133`, `src/compiler/checker/types/unions/unions.ts:153-162`
- evidence:
  1. In `src/compiler/checker/types/fitting/fit/index.ts`, `fitOf` (lines 179-185), `intoSeveral` (lines 420-424), and `constraintFits` (lines 491-495) all construct the identical `{ ...fitting, exact: (target, source) => isAssignable(source, target, fitting), same: (target, source) => isAssignableInvariantly(source, target, fitting) }` object for `matchingWith`.
  2. `baseMember` in `fitting/fit/index.ts:380-384` (`const literals = rules.memberUnionOf(member) ?? member; const base = literals === undefined ? undefined : literalsBase(literals);`) and `joinWidened` / `memberBase` in `unions/common-type.ts:76,130-133` (`literalsBase(present) ?? memberBase(present, joining)`) both compute `literalsBase(memberUnionOf(type) ?? type)` in two different ways.
- proposal: Extract `fittingRules(fitting: Fitting): Matching` in `src/compiler/checker/types/fitting/fit/index.ts` and use it in `fitOf`, `intoSeveral`, and `constraintFits`. Have `literalsBase(type, memberUnionOf?)` in `src/compiler/checker/types/unions/unions.ts` unwrap `memberUnionOf?.(type) ?? type` once so `baseMember` and `joinWidened` share it and `memberBase` in `common-type.ts` can be deleted.
- confidence: high

### [med] Written-field extraction for structs and enums duplicated between `properties/value-kinds.ts` and `rules/expansion/types.ts`
- where: `src/compiler/checker/types/properties/value-kinds.ts:269-274`, `src/compiler/checker/rules/expansion/types.ts:116-125`
- evidence: Both `writtenPartsOf` in `types/properties/value-kinds.ts:269-274` and `writtenFieldsOf` in `rules/expansion/types.ts:116-125` write the identical AST extraction for the `DeclaredField`s of a `DeclaredStruct | EnumDeclaration`:
  ```ts
  const fields =
    declaration.kind === 'EnumDeclaration'
      ? declaration.variants.flatMap((variant) =>
          variant.kind === 'Variant' ? variant.fields : [],
        )
      : declaration.fields;
  ```
- proposal: Export `writtenFieldsOf(declaration: DeclaredStruct | EnumDeclaration): readonly DeclaredField[]` from `src/compiler/syntax/declarations/index.ts` (beside `typeParametersOf` and `membersAsWritten`) and call it in both `types/properties/value-kinds.ts` and `rules/expansion/types.ts`.
- confidence: high

### [med] Well-known trait lookup duplicated across `type/well-known.ts`, `traits/constraints.ts`, and `traits/data-kind.ts`, and `awaitedOf`/`resolvedThrough` duplication
- where: `src/compiler/checker/types/type/well-known.ts:69-88,117-124`, `src/compiler/checker/types/traits/constraints.ts:43-52`, `src/compiler/checker/types/traits/data-kind.ts:57-69`
- evidence:
  1. `isWellKnownTrait` (`well-known.ts:117-124`), `wellKnownConstraint` (`constraints.ts:43-52`), and `withKindBound` (`data-kind.ts:57-69`) all call `checker.wellKnownEntity(declaration)` and check `entity?.kind === 'type' && entity.declaration.kind === 'TraitDeclaration'`. In `withKindBound`, after already resolving `const trait = entity.declaration`, line 66 even calls `isWellKnownTrait(checker, each.trait, wellKnown.dataKind)` inside `.some(...)` instead of `each.trait === trait`.
  2. In `well-known.ts:69-88`, `awaitedOf` and `resolvedThrough` have identical bodies (`const [value, mode] = wellKnownArguments(checker, declaration, type) ?? []; return value === undefined || mode === undefined ? undefined : { value, mode };`), differing only in `wellKnown.future` vs `wellKnown.resolver`.
- proposal: Add `wellKnownTrait(checker, declaration): TraitDeclaration | undefined` and a shared `awaitedArgumentsOf(checker, declaration, type)` helper in `src/compiler/checker/types/type/well-known.ts`, and let `wellKnownConstraint(checker, declaration, typeArguments = [])` in `traits/constraints.ts` and `withKindBound` in `traits/data-kind.ts` use `wellKnownTrait` / `wellKnownConstraint`.
- confidence: high

### [low] Dead code: unused `CallVariables.isVariable` method, test-only `sameShape` export, 25 unused type exports, and impossible `undefined` fallbacks
- where: `src/compiler/checker/types/inference/variables.ts:111-113`, `src/compiler/checker/types/type/function-types.ts:179`, `src/compiler/checker/types/fitting/fit/index.ts:382`, `src/compiler/checker/types/unions/equality.ts:174`, `src/compiler/checker/types/written/key-types.ts:180`, `src/compiler/checker/types/inference/system-reading.ts:92,115,312`
- evidence:
  1. `CallVariables.isVariable(key: ParameterKey): boolean` (`types/inference/variables.ts:111-113`) has zero callers in `src/` or `test/`.
  2. `sameShape` (`types/type/function-types.ts:179`) is exported and listed in `docs/reuse/types-and-fitting.md:27`, but has zero `src/` callers outside `function-types.ts` (only 1 test caller in `function-types.test.ts`), and `docs/reuse/types-and-fitting.md:120` states the one-way rule that two function types are related *only* through `functionFits`.
  3. Three places compute `const x = memberUnionOf(t) ?? t` where `t: Type` is non-nullable, then guard against `x === undefined`: `fitting/fit/index.ts:381-382` (`const literals = rules.memberUnionOf(member) ?? member; const base = literals === undefined ? undefined : literalsBase(literals);`), `unions/equality.ts:171-174` (`const ranging = memberUnionOf(type) ?? type; ... membersOf(ranging ?? type)`), and `written/key-types.ts:179-182` (`const union = fitting.memberUnionOf(declared) ?? declared; return union === undefined ? undefined : ...`).
  4. In `inference/system-reading.ts:92`, `tentativeOf(variable, reading)` does not check `reading.givenOf(variable)` (unlike `fixedByBounds` at line 142), forcing `tentativeSubstitution` (line 312) and `Inference.boundOf` (`infer.ts:213`) to manually prepend `givenOf` while leaving `tentativeIn` (line 122) missing `givenOf`.
  5. 25 exported interfaces/types in `types/` have zero imports anywhere in `src/` or `test/`: `CollectionTarget` (`fitting/expected.ts:116`), `TermSource` & `ImportedNode` (`identity/recursive-terms.ts:44,64`), `RecursiveGroup` (`identity/recursive-types.ts:46`), `Refinable` (`identity/term-signatures.ts:74`), `BindingTarget` (`inference/binding.ts:29`), `Equating` (`inference/equal.ts:32`), `Filling` (`inference/fillings.ts:23`), `InferenceSite` & `InferringCall` (`inference/infer.ts:61,72`), `SelfHolding` & `StructFieldReader` (`properties/finiteness.ts:23,28`), `DeclaredKinds` (`properties/value-kinds.ts:52`), `KindNames` (`type/function-kinds.ts:53`), `FunctionParts` (`type/function-types.ts:85`), `MemberUnionOf` & `ComparedSide` (`unions/equality.ts:150,153`), `LiteralBase` (`unions/union-members.ts:19`), `VarianceReading` (`variance/variance.ts:50`), `NamedPath` (`written/named-paths.ts:18`), `Naming` (`written/named-types.ts:119`), `DowncastTarget` & `PatternKind` (`written/pattern-types.ts:77,312`), `ClosingGroup` (`written/resolve-type.ts:91`), and `ArgumentList` (`written/type-arguments.ts:30`).
- proposal: Delete `CallVariables.isVariable`, unexport `sameShape` (testing it through `functionFits` and removing `sameShape` from `docs/reuse/types-and-fitting.md`), remove the 3 dead `undefined` guards on `memberUnionOf(t) ?? t`, start `tentativeOf` with `reading.givenOf(variable) ?? ...`, and unexport the 25 internal-only interfaces/types.
- confidence: high

## Missing from docs/reuse

### Wrong or stale entries in `docs/reuse/*.md` for `src/compiler/checker/types`
- `docs/reuse/types-and-fitting.md:50`: Lists `fieldPassesOver` under `src/compiler/checker/types/traits/struct-keys.ts` (and `struct-keys.ts:20`'s banner still mentions it), but `fieldPassesOver` was moved to `src/compiler/checker/constructs/loops/field-passes.ts:56` (where it is private).
- `docs/reuse/types-and-fitting.md:28`: Lists `typeChildren` under `src/compiler/checker/types/parts/type-parts.ts`; it is actually defined and exported in `src/compiler/checker/types/parts/type-children.ts:27`.
- `docs/reuse/types-and-fitting.md:56`: Lists `literalType` under `src/compiler/checker/types/unions/unions.ts`; it is actually defined and exported in `src/compiler/checker/types/type/primitives.ts:61`.
- `docs/reuse/types-and-fitting.md:57`: Lists `membersOf` under `src/compiler/checker/types/unions/unions.ts`; it is actually defined and exported in `src/compiler/checker/types/type/index.ts:338`.
- `docs/reuse/types-and-fitting.md:60`: Lists `RecursiveLabel` under `types/written/type-match.ts`; it is actually defined and exported in `src/compiler/checker/types/type/alias-uses.ts:53`.
- `docs/reuse/types-and-fitting.md:108`: Lists `instancesWith` as exported from `src/compiler/checker/types/written/pattern-types.ts`; `instancesWith` is private in `pattern-types.ts:213`, whereas the exported functions are `instancesNamed` (`pattern-types.ts:229`) and `variantEnums` (`pattern-types.ts:253`).
- `docs/reuse/types-and-fitting.md:27`: Lists `sameShape` (`src/compiler/checker/types/type/function-types.ts`), which has no non-test callers and contradicts the one-way rule on line 120 that function types are related only through `functionFits`.
- `docs/reuse/calls-and-resolution.md:31`: Lists `fix` on `Inference` (`src/compiler/checker/types/inference/infer.ts`), which was replaced by `fixIn`, `fixToward`, and `fixDefaults` (and `guidedIn`).

### Reusable exported units in `src/compiler/checker/types` missing from `docs/reuse/*.md`
- `src/compiler/checker/types/fitting/part-pairs.ts`: `partPairs`, `resultFitBetween`, `PartPair`, `PartRules` (called by `lowering/functions/fits/parts.ts`, `lowering/functions/fits/index.ts`, `checker/rules/lifetimes/dispatch.ts`, and `checker/rules/lifetimes/summary.ts` — mentioned in `docs/arch/architecture.md` as checker surface, but omitted from `docs/reuse/types-and-fitting.md`).
- `src/compiler/checker/types/type/function-kinds.ts`: `kindOfFunction`, `functionKindOf`, `writtenKindOf`, `persistenceOf`, `kindAdmits`, `namedMarkOf`, `kindHolderName` (14 callers outside folder across `checker/` and `lowering/`).
- `src/compiler/checker/types/type/function-types.ts`: `plainSend`, `sendableSend`, `RestSlot`, `AwaitedType`, `ResultFit` (called across `checker/` and `lowering/`).
- `src/compiler/checker/types/type/primitives.ts`: `noneType` (6 callers outside folder).
- `src/compiler/checker/types/type/well-known.ts`: `cellTypeOf` (called by `lowering/tables/type-table.ts`).
- `src/compiler/checker/types/type/field-defaults.ts`: `declaresDefault` (called by `inference/system-reading.ts` and `constructs/expressions/structs/literal-fields/index.ts`).
- `src/compiler/checker/types/type/computed-types.ts`: `ownAssociatedType`, `isMatchAlias`, `RecursiveType`, `RecursiveGraph`, `ComputedType`, `MatchType`.
- `src/compiler/checker/types/type/type-text.ts`: `constraintText`, `parameterText`, `spellingText` (called across `checker/` and `editor/`).
- `src/compiler/checker/types/type/struct-constraint.ts`: `constraintSetText` (called by `resolution/conformance/shortfalls.ts`).
- `src/compiler/checker/types/parts/type-parts.ts`: `isKnown` (3 callers outside folder; collides in name with `unions/equality.ts`'s `isKnown`), `sameConstraintSpelled`, `errorIn`.
- `src/compiler/checker/types/traits/any-types.ts` & `constraints.ts`: `resolveAnyType`, `resolveConstraint` (called by `wiring/program/program-checker.ts` and `constructs/declarations/type-parameters.ts`).
- `src/compiler/checker/types/traits/data-kind.ts`: `boundKindsOf`, `mayBeOfKind` (called by `wiring/program/program-checker.ts` and `rules/kinds/data-kinds.ts`).
- `src/compiler/checker/types/traits/struct-keys.ts`: `keyName`, `namesMemberParameter`, `recordPatternKeys` (called by `constructs/` and `surface/`).
- `src/compiler/checker/types/unions/common-type.ts`: `joinWidened`, `withinOptional` (called by `rules/agreement.ts`).
- `src/compiler/checker/types/unions/widening.ts`: `sendableWidened` (called by `rules/agreement.ts`).
- `src/compiler/checker/types/variance/variance.ts`: `markerVariances`, `isDerived`, `VariedDeclaration`, `DerivedDeclaration`, `HeldPart` (called by `constructs/declarations/variance-markers.ts` and `wiring/program/program-type-rules.ts`).
- `src/compiler/checker/types/written/named-paths.ts`: `namedPathOf` (called by `written/resolve-type.ts` and `lookup/denotations/named.ts`).
- `src/compiler/checker/types/written/named-types.ts`: `nominalEntityOf` (called by `constructs/declarations/functions/signatures.ts` and `constructs/expressions/structs/variants.ts`).
- `src/compiler/checker/types/written/pattern-types.ts`: `instancesNamed`, `variantEnums` (called by `constructs/patterns/walk/named-members.ts` and `constructs/patterns/walk/kinds/variant-calls.ts`).
- `src/compiler/checker/types/written/resolve-type.ts`: `resolveTypeNode` (called by `wiring/program/program-checker.ts`).
- `src/compiler/checker/types/written/type-match.ts`: `rebuilt`, `TypeMatchForm`, `CaseForm`, `CasePatternForm`, `InferVariable` (called by `resolution/type-matches/` and `constructs/declarations/aliases/`).
- `src/compiler/checker/types/inference/variables.ts`: `isPlaceholder`, `mentionsOnlyPlaceholders`, `mentionsAnyVariable` (called across `resolution/`, `rules/`, and `constructs/`).
- `src/compiler/checker/types/inference/system-reading.ts`: `takesShape` (called by `constructs/expressions/postponed.ts`).


