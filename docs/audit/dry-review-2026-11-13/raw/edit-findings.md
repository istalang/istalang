# `src/editor` DRY & Architecture Findings

### [high] Pattern-type propagation is re-implemented from scratch in `completion/places/patterns/matched-type.ts` instead of recorded by the checker's pattern walk
- where: `src/editor/language-service/completion/places/patterns/matched-type.ts:78-401`, `src/compiler/checker/constructs/patterns/walk/index.ts:81-198`, `src/compiler/checker/constructs/patterns/walk/members.ts:272-292`, `src/compiler/checker/constructs/patterns/walk/named-members.ts:37-94`, `src/compiler/checker/constructs/patterns/walk/parts.ts:127-151`, `src/compiler/checker/constructs/patterns/walk/kinds/downcasts.ts:51-75`
- evidence:
  - For expressions and struct literals, completion asks the checker (`CheckedBody.expectedOf` via tentative `checkProgram` in `expected.ts:246-256`, and `CheckedBody.literalFieldsOf` in `literal-field.ts:166`), so expression and struct-literal type propagation live in one place.
  - For patterns, `CheckedBody` records `CheckedPattern` (`patternOf`) only at the root `MatchCase`/`Is` pattern and records neither the incoming `ValuePart.type` of sub-patterns nor the resolved `FieldMember[]` of `StructPattern` / `VariantCallPattern`.
  - Consequently, `matched-type.ts` (402 lines) hand-rolls a second top-down pattern type walker (`matchedTypeOf`, `steps` over `MatchCase`, `Is`, `Parameter`, `OrPattern`, `ParenthesizedPattern`, `AsPattern`, `TuplePattern`, `ArrayPattern`, `StructPattern`, `NestedFieldPattern`, `VariantCallPattern`, `NamedPatternArgument`), duplicating:
    1. Union member selection: `memberSelected`, `membersSelected`, and `membersNamedBy` (`matched-type.ts:159-225`) duplicate `candidates` (`walk/members.ts:272-292`) and `namedMembers`/`instanceNamed` (`walk/named-members.ts:37-94`). Worse, `named-members.ts:74-82` handles `pattern.kind === 'genericAlias'`, while `matched-type.ts:220-224` calls `instancesNamed` directly and misses generic aliases with type arguments.
    2. `any` downcast resolution: `downcastOf` (`matched-type.ts:272-282`) duplicates `namedTypeOf` (`walk/kinds/downcasts.ts:51-75`).
    3. Struct and variant field lookup on patterns: `fieldsOf` and `variantFieldsOf` (`matched-type.ts:116-146, 230-248`) duplicate `structParts` (`walk/parts.ts:127-151`) and `namedVariant`/`variantOf` (`matching.ts:302-343`).
    4. Root target owners: `steps` (`matched-type.ts:336-345`) only handles `MatchCase`, `Is`, and `Parameter`. Yet `placeholder.ts:316-320` classifies `BindFieldPattern`/`CompareFieldPattern`/`NestedFieldPattern` as `'patternField'` innermost-first even inside `VariableDeclaration`, `For`, `Comprehension`, or `FieldHeader` targets (e.g. `const Pair{‸} = p`), where `matchedTypeOf` returns `undefined`.
- proposal: Have `walkPattern` and `walkTargets` (`src/compiler/checker/constructs/patterns/walk/index.ts`) record the matched `Type` of each `Pattern` node and the `readonly FieldMember[]` of each `StructPattern | VariantCallPattern` on `BodyFacts` / `CheckedBody` (joined across passes like `expectedOf` and `literalFieldsOf`), and have `expectedOfPatternStart` (`expected.ts:214`) and `offerPatternFields` (`pattern-field.ts:16`) query the tentative checker on `parsed.tree` just like `expectedOfPlaceholder` (`expected.ts:246`), deleting almost all of `matched-type.ts`.
- confidence: high

### [high] Scattered, non-exhaustive AST declaration/member tables across `editor/` cause new language constructs (`AssociatedType`, `RequiredAssociatedType`, `MemberType`) to be missed or misclassified
- where: `src/editor/language-service/semantic-tokens/name-types.ts:73-123`, `src/editor/language-service/outline/symbols.ts:64-155`, `src/editor/language-service/completion/placeholder.ts:389-416`, `src/editor/language-service/outline/folding.ts:98-111`, `src/compiler/syntax/declarations/index.ts:281-287`
- evidence:
  - Six different tables in `src/editor/language-service/` independently list declaration and member AST node kinds and extract their declared `.name` or member lists:
    1. `semantic-tokens/name-types.ts:73-123` (`rolesOf`, a partial table `{ readonly [Kind in SyntaxNode['kind']]?: ... }`) lists `TypeAliasDeclaration: named('type')` and `NamedType: (node) => qualified(node.path, 'type')`, but **completely omits `AssociatedType`, `RequiredAssociatedType`, and `MemberType`**. As a result, `Data` in `type Data = T`, `Key` in `type Key is Stringable`, and `Mode` in `Self.Mode` fall through to `node.kind === 'Identifier'` (`name-types.ts:143`) and are highlighted as `'variable'` instead of `'type'`.
    2. `outline/symbols.ts:96-135` (`symbolsOfDeclaration`) fails to call `membersAsWritten(declaration)` (`src/compiler/syntax/declarations/index.ts:281`, whose TSDoc explicitly states `"which only reading the text back (formatting, outlines) needs"`). Consequently:
       - `StructDeclaration`, `SharedStructDeclaration`, `ExternStructDeclaration`, and `EnumDeclaration` in `symbols.ts:96-124` ignore `declaration.associatedTypes` (`AssociatedType`) altogether.
       - `TraitDeclaration` in `symbols.ts:125-134` maps every non-`FunctionDeclaration` member to `'field'` (`member.kind === 'FunctionDeclaration' ? 'method' : 'field'`), misclassifying `RequiredAssociatedType` (`type Key`) as `'field'` instead of `'typeAlias'`.
    3. `completion/placeholder.ts:389-410` (`declaringKinds`) manually lists 19 node kinds whose `.name` is a declared name (`AsPattern`, `FunctionDeclaration`, `StructDeclaration`, `SharedStructDeclaration`, `ExternStructDeclaration`, `ExternConstantDeclaration`, `ContextConstantDeclaration`, `EnumDeclaration`, `Variant`, `TraitDeclaration`, `TypeAliasDeclaration`, `AssociatedType`, `RequiredAssociatedType`, `TypeParameter`, `Parameter`, `DeclaredField`, `FieldDeclaration`, `Lambda`).
    4. `outline/folding.ts:98-111` (`layoutStarts`) and `formatter/comments/comment-placement.ts:183-193` (`itemLists`) both manually list the declarations and control constructs whose members/cases stand in an indented layout block (`StructDeclaration`, `SharedStructDeclaration`, `ExternStructDeclaration`, `EnumDeclaration`, `TraitDeclaration`, `Match`, `Select`, `Block`).
- proposal:
  1. Add a syntax contract helper in `src/compiler/syntax/` (alongside `declarations/index.ts`) that classifies declaration/member nodes and their declared name identifier(s), and use `membersAsWritten` in `outline/symbols.ts` (mapping `AssociatedType` and `RequiredAssociatedType` to `'typeAlias'`).
  2. Add `AssociatedType: named('type')`, `RequiredAssociatedType: named('type')`, and `MemberType: (node) => [[node.name, 'type']]` to `name-types.ts:rolesOf` (or derive declaration name roles from the shared syntax helper).
- confidence: high

### [high] Three parallel implementations of lenient argument-to-parameter binding (`bindArguments`, `argumentsReach`, `writtenParameter`)
- where: `src/editor/language-service/signatures/call-at.ts:99-125`, `src/compiler/checker/surface/struct-items.ts:44-137`, `src/compiler/checker/resolution/calls/resolve/written-expectations.ts:34-36`, `src/compiler/checker/resolution/choosing/binding.ts:81-101`
- evidence:
  - When a call or call pattern is incomplete, the toolchain maps written arguments to parameter/field indices in three separate places:
    1. `written-expectations.ts:34-36` maps `signature.parameters.map((slot) => ({ ...slot, hasDefault: true }))` and calls `bindArguments(lenient, callArguments)`.
    2. `struct-items.ts:44-137` (`callPatternArguments`, `argumentsReach`, `Reaching`, `reachOf`) is 90 lines of custom positional/spread/named binding logic for `VariantCallPattern`, used by `variant-calls.ts:278`, `matched-type.ts:377`, and `pattern.ts:134, 229`.
    3. `call-at.ts:99-125` (`writtenParameter` and `receiversOf`) is a third, simplified binder used by `call-argument.ts:87` and `signature-help.ts:94`. Because `writtenParameter` does not use `bindArguments` or `argumentsReach`, it has subtle divergences:
       - If an earlier positional argument is a `Spread` (`f(...xs, y)`), `writtenParameter` uses `position = argument + receiversOf(declaration, call)` and maps `y` to fixed parameter `1` instead of the rest parameter.
       - If a method call writes `x.m(self: 1)`, `writtenParameter` matches `parameter.name?.text === 'self'` even though `binding.ts:15` forbids naming a method's `self`.
- proposal: Unify partial/lenient argument binding in `src/compiler/checker/resolution/choosing/binding.ts` (or `struct-items.ts` built on `binding.ts`) so that incomplete calls (`writtenParameter` in `call-at.ts`, `expectWrittenArguments` in `written-expectations.ts`) and call patterns (`argumentsReach` in `struct-items.ts`) all resolve argument-to-slot mappings through one algorithm.
- confidence: high

### [high] `parameterGiven` / `argumentParameter` in `completion/expected.ts` is a stale pre-`expectWrittenArguments` fallback that returns uninstantiated parameter types
- where: `src/editor/language-service/completion/expected.ts:161, 179, 187, 193-210`, `src/editor/language-service/signatures/call-at.ts:78-91`, `src/compiler/checker/resolution/calls/resolve/written-expectations.ts:27-60`
- evidence:
  - `parameterGiven` (`expected.ts:193-202`) has TSDoc: `"Where value is a call's argument, the type of the parameter it gives: checking expects nothing of an argument it couldn't choose a function for, as one being written often is."`
  - That comment and fallback were written before commit `711e71f1` added `expectWrittenArguments` (`written-expectations.ts`), whose banner states: `"What each argument of a call still being written is expected to be (§3.5), for tools to read (editor completion): a call short of an argument takes nothing... yet each written one expects what its parameter will be once the call is whole."`
  - For every single-candidate call (including `paint(‸`, `paint(Color.Red, ‸`, `paint(n: ‸`, `paint(Color.‸`, `Rejected(‸`, `Rejected(by: ‸`), `CheckedBody.expectedOf` already answers via `expectWrittenArguments` (with generic type parameters properly inferred and array rest parameters unwrapped to their element type via `argumentSlotsOf`).
  - When `expectedOf` returns `undefined` (e.g., an overloaded call where `expectWrittenArguments` intentionally declines because `"Only a call with one candidate expects anything: with several, which one is meant waits for the arguments"`, or an unguided generic type parameter), `expected.ts` falls back to `argumentParameter` -> `argumentParameterAt(cursor, cursor.offset)?.type`, which contradicts `expectWrittenArguments` by grabbing the first overload (`const [callee] = calleesOf(at.body, at.maker)`), returning its uninstantiated `TypeParameterType`, and for a rest parameter `...xs: Array<T>` returning `Array<T>` (`SignatureParameter.type`) instead of `T` (`SignatureParameter.rest.item`).
- proposal: Remove `parameterGiven` and `argumentParameter` from `src/editor/language-service/completion/expected.ts` (relying on `CheckedBody.expectedOf` from `expectWrittenArguments`), and keep `argumentParameterAt` in `call-at.ts` solely for `call-argument.ts:46` (or move it into `call-argument.ts`).
- confidence: high

### [high] `givenAsValue`, `functionGivenAsValue`, and `variantGivenAsValue` in `presenting.ts` duplicate function-value binding and type construction from `named-functions.ts`
- where: `src/editor/language-service/completion/presentation/presenting.ts:114-228`, `src/compiler/checker/resolution/choosing/named-functions.ts:146-180, 253-270, 419-439`
- evidence:
  - In `presenting.ts:136-173`, `givenAsValue` manually maps parameters to `{ hasDefault, rest }`, calls `bindValue(slots, shape.parameters.map(() => ({})))`, checks `sameType(shape.parameters[bound.index]?.type ?? errorType, parameters[index]?.type ?? errorType)`, constructs `functionType({ send: sendableSend, mark, parameters: parameters.filter((_parameter, index) => binding[index]?.kind === 'argument')..., result })`, and tests `checker.fitOf(value, expected) !== undefined`.
  - This duplicates `valueTypeOf` (`named-functions.ts:253-270`) and `chosenFor`/`takesValue` (`named-functions.ts:294-309, 419-439`).
  - Furthermore, `constructorOf(variant, enumType)` in `presenting.ts:219-227` looks up the `Variant` AST node by scanning `declaration.variants.find((each) => each.kind === 'Variant' && each.name.text === variant.name)` and calling `fieldsFunctionOf(declaration, node)`, duplicating `variantConstructors` in `named-functions.ts:146-180` (and `hover.ts:267`).
  - Because `presenting.ts` hand-rolls a non-generic subset (`if (typeParametersOf(declaration.typeParameters).length > 0 || isMethod(declaration)) return [];` at line 181), generic functions that fit an expected function type via `chooseAsValue` in `named-functions.ts` are not recognized as fitting in `functionGivenAsValue`.
- proposal: Expose a query on the checker / `named-functions.ts` that tests whether a `FunctionDeclaration` or `VariantMember` on `enumType` can be passed as a value for `expected: Type`, reusing `chooseAsValue` and `valueTypeOf`, and delete `ValueParameter`, `ValueFunction`, `givenAsValue`, `functionGivenAsValue`, `variantGivenAsValue`, and `constructorOf` from `presenting.ts`.
- confidence: high

### [med] Dead `VariantEntity` (`kind === 'variant'`) handling in completion's `entity-items.ts`, `expected.ts`, and `pattern.ts`, plus repeated `!isBareVariant` filtering across callers of `visibleNames`
- where: `src/editor/language-service/completion/presentation/entity-items.ts:61, 127-133`, `src/editor/language-service/completion/expected.ts:115-121`, `src/editor/language-service/completion/places/patterns/pattern.ts:184`, `src/editor/language-service/completion/places/grammar/expression.ts:46-48`, `src/editor/language-service/completion/places/literal-field.ts:228`, `src/compiler/binder/link/index.ts:148-165`
- evidence:
  - In `src/editor/language-service/completion/`, `{ kind: 'entity', entity }` `Subject`s are only ever created from `Bindings.visibleAt` (`visible.ts:19`), `Bindings.exportsOf` (`member.ts:154`, `import.ts:150`), or `typeEntity(associated)` (`member.ts:174`).
  - Neither `Bindings.visibleAt` (`link/index.ts:148-165`) nor `Bindings.exportsOf` (`module-scope.ts:173-184`) can ever contain a `VariantEntity` (`kind: 'variant'`): `visibleAt` only yields `VariantsEntity` (`kind: 'variants'`), and `exportsOf` only yields top-level declarations. Qualified and expected variants are always created with `subject: { kind: 'variant', variant, enum }` (`expected.ts:94`, `member.ts:185`, `pattern.ts:97`).
  - Therefore:
    1. The entire `variant` handler in `entityItems` (`entity-items.ts:127-132`: `variant: (presenting, { enum: declaration, variant }, name) => ({ kind: 'variant', detail: declaration.name.text, order: declaration.variants.indexOf(variant), ...constructed(...) })`) is unreachable dead code.
    2. `entity.kind === 'variant'` in `groupOf` (`entity-items.ts:61`), `isVariantEntity` (`expected.ts:120`), and `mayRefer` (`pattern.ts:184`) is always `false`.
  - Moreover, `Bindings.visibleAt` has only one production caller in the entire repo (`visible.ts:19`), and `visibleAt` injects every `VariantsEntity` (`kind: 'variants'`) in the program only so that `expected.ts:69` (`if (expected?.kind === 'error') return visibleNames(cursor, isVariantEntity);`) can offer bare variants when the expected type is `errorType`. Every other value/pattern caller of `visibleNames`/`visibleCandidates` (`expression.ts:47`, `literal-field.ts:228`, `pattern.ts:184`) has to manually filter `VariantsEntity` back out (`!isBareVariant(candidate)` / `!isVariant`).
- proposal: Exclude `variants` from `visibleNames` by default (or have `Bindings.visibleAt` not mix program-wide bare variant candidates into lexical scope lookup), so callers don't have to filter `!isBareVariant` out, and collapse `entityItems.variant` + `entityItems.variants` in `entity-items.ts`.
- confidence: high

### [med] `WrittenName` (`Identifier | StringLiteral`) lookup, denotation query, and spelling are duplicated between `navigation/declarations.ts`, `hover.ts`, and `reading/identifier-at.ts`
- where: `src/editor/language-service/reading/identifier-at.ts:13-33`, `src/editor/language-service/navigation/declarations.ts:33-65, 125-135`, `src/editor/language-service/hover.ts:67, 207-225`
- evidence:
  - `reading/identifier-at.ts` defines two near-identical pairs of functions:
    ```ts
    export function identifierAt(tree: SyntaxTree, offset: number): Identifier | undefined {
      return innermostIdentifier(tree, offset) ?? innermostIdentifier(tree, offset - 1);
    }
    function innermostIdentifier(tree: SyntaxTree, offset: number): Identifier | undefined {
      const innermost = nodesAt(tree, offset).at(-1);
      return innermost?.kind === 'Identifier' && !isMissingName(innermost) ? innermost : undefined;
    }
    export function stringLiteralAt(tree: SyntaxTree, offset: number): StringLiteral | undefined {
      return innermostLiteral(tree, offset) ?? innermostLiteral(tree, offset - 1);
    }
    function innermostLiteral(tree: SyntaxTree, offset: number): StringLiteral | undefined {
      const innermost = nodesAt(tree, offset).at(-1);
      return innermost?.kind === 'StringLiteral' ? innermost : undefined;
    }
    ```
  - `navigation/declarations.ts:33-64` defines `export type WrittenName = Identifier | StringLiteral`, `export function spelledName(name: WrittenName): string`, and dispatches `name.kind === 'Identifier' ? checker.lookup.denotationsOf(module, name) : checker.lookup.keyDenotationsOf(module, name)`.
  - `hover.ts:207-225` re-implements all three by hand instead of sharing them:
    ```ts
    function isName(node: SyntaxNode): node is Identifier | StringLiteral {
      return node.kind === 'Identifier' || node.kind === 'StringLiteral';
    }
    function nameHover({ checker, module, tree }: CheckedModule, name: Identifier | StringLiteral): Hover | undefined {
      const denotations =
        name.kind === 'Identifier'
          ? checker.lookup.denotationsOf(module, name)
          : checker.lookup.keyDenotationsOf(module, name);
      ...
      const text = name.kind === 'Identifier' ? name.text : name.value;
    ```
- proposal: Move `WrittenName` and `spelledName` to `reading/identifier-at.ts` (along with a single generic `innermostAt` helper and `writtenNameAt(tree, offset)`), and add a shared `denotationsOfName(checker, module, name: WrittenName)` helper used by both `navigation/declarations.ts` and `hover.ts`.
- confidence: high

### [med] `call-argument.ts` and `pattern.ts` duplicate named-argument / named-field-argument label offering, and `present.ts` duplicates `field` and `fieldArgument` presentation
- where: `src/editor/language-service/completion/places/call-argument.ts:51-93`, `src/editor/language-service/completion/places/patterns/pattern.ts:121-155`, `src/editor/language-service/completion/presentation/present.ts:103-143`, `src/editor/language-service/completion/candidate.ts:30-37`
- evidence:
  - Both `call-argument.ts` (`isNamedOnward`, `argumentNames`, `ungiven`) and `pattern.ts` (`fieldLabels`) check whether any argument at or before the cursor is named (`call.arguments.slice(0, at + 1).some(({ kind }) => kind === 'NamedArgument' / 'NamedPatternArgument')`), restrict the completion list to argument labels alone when `namedOnward` is true, and format each ungiven slot as `${name}:`.
  - In `present.ts:103-143`, `presenters.field` and `presenters.fieldArgument` duplicate field presentation:
    ```ts
    field: ({ place }, { field }, name) => {
      const { declared } = field;
      return {
        kind: 'field',
        detail: typeText(field.type),
        ...(declared === undefined ? {} : { priority: hasDefault(declared.node) ? 1 : 0 }),
        ...(givesValue.has(place.kind)
          ? { insert: { kind: 'text', text: `${name}: ` }, next: 'completion' }
          : {}),
      };
    },
    ...
    fieldArgument: (presenting, { field }, name) => {
      const { declared } = field;
      return {
        kind: 'field',
        detail: typeText(field.type),
        ...(declared === undefined ? {} : { priority: hasDefault(declared.node) ? 1 : 0 }),
        ...labelled(presenting, field.name, `${name} `),
      };
    },
    ```
  - Notice also the double standard between `presenters.field` and `presenters.fieldArgument`: `fieldArgument` uses `labelled(presenting, field.name, `${name} `)` (which checks `presenting.follows === ':'` so it inserts `field.name` alone when `:` already follows on the line), whereas `field` in `givesValue` (`literalField` / `annotation`) hardcodes `{ insert: { kind: 'text', text: `${name}: ` }, next: 'completion' }` even if `:` already follows!
- proposal: Unify `field` and `fieldArgument` in `Subject` / `present.ts` (using `labelled(presenting, field.name, `${field.name}: `)` whenever the place labels a field value/pattern), and extract the shared `field` detail/priority helper.
- confidence: high

### [med] Linear scans over sorted `codeTokensOf(tree)` instead of `lastIndexAtMost` bisection, and duplicated `tokenBefore` / `nextToken` lookups
- where: `src/editor/language-service/reading/tokens.ts:85-87`, `src/editor/language-service/completion/cursor.ts:39`, `src/editor/language-service/completion/placeholder.ts:145, 206, 370`, `src/editor/language-service/completion/presentation/presenting.ts:88`, `src/editor/language-service/completion/places/grammar/item-starts.ts:69`, `src/editor/language-service/completion/places/grammar/position.ts:305, 378`, `src/editor/language-service/outline/folding.ts:93-94`, `src/editor/language-service/semantic-tokens/angle-brackets.ts:56-57`, `src/editor/language-service/signatures/call-at.ts:178-187`
- evidence:
  - `docs/reuse/structures-and-invariants.md` states: `"find the last of items kept in ascending order whose key is at most a value, by bisection → lastIndexAtMost (src/foundation/structures/sorted.ts)"`.
  - `reading/tokens.ts:37-38` notes: `"without it [templates] the tokens end in the order they start, and can be searched by either"`.
  - Three files (`folding.ts:94`, `angle-brackets.ts:57`, `call-at.ts:179`) use `lastIndexAtMost` on `codeTokensOf(tree)`, each defining its own local helper (`introduced` in `folding.ts`, `lastEndingBy` in `angle-brackets.ts`, `nextTokenIndex`/`nextTokenStart` in `call-at.ts`).
  - Meanwhile, `reading/tokens.ts:85-87` (`tokenBefore`) and six other sites (`cursor.ts:39`, `placeholder.ts:145, 206, 370`, `presenting.ts:88`, `item-starts.ts:69`, `position.ts:305, 378`) linearly scan `codeTokensOf(tree)` with `.findLastIndex`, `.findLast`, `.find`, or `.some`:
    - `tokens.ts:86`: `codeTokensOf(tree).findLast(({ span }) => span.end <= token.span.start)` (same query as `lastEndingBy` in `angle-brackets.ts:56` and `introduced` in `folding.ts:94` and `placeholder.ts:145`).
    - `cursor.ts:39`: `tokens.findLastIndex(({ span }) => span.start < offset)` (same query as `nextTokenIndex(tokens, offset) - 1` in `call-at.ts:140, 178`).
    - `presenting.ts:88`: `codeTokensOf(cursor.tree).find(({ span }) => span.start >= end)` (same query as `tokens[nextTokenIndex(tokens, end)]` in `call-at.ts:186`).
- proposal: Implement `tokenEndingAtMost(tree, offset)` (backing `tokenBefore`) and `tokenStartingAtLeast(tree, offset)` in `src/editor/language-service/reading/tokens.ts` using `lastIndexAtMost`, and call them from `folding.ts`, `angle-brackets.ts`, `call-at.ts`, `cursor.ts`, `placeholder.ts`, `presenting.ts`, `item-starts.ts`, and `position.ts`.
- confidence: high

### [med] Re-implementations of existing reusable helpers from `docs/reuse/` inside `src/editor/`
- where:
  1. `src/editor/language-service/completion/places/grammar/index.ts:47-57` (re-implements `writtenByReference` from `src/compiler/syntax/expressions/parameters.ts:64`)
  2. `src/editor/language-service/navigation/rename.ts:328-335` (re-implements `nodesUnder` from `src/compiler/syntax/tree/index.ts:108`)
  3. `src/editor/language-service/completion/places/literal-field.ts:98, 102, 113-114` (re-implements `indentationAt` from `src/foundation/text/line-map.ts:116`)
  4. `src/editor/language-service/completion/places/literal-field.ts:183` (reads `Map` type argument by hand instead of `wellKnownArguments` from `src/compiler/checker/types/type/well-known.ts:74`)
  5. `src/editor/language-service/completion/placeholder.ts:219`, `src/editor/language-service/completion/places/imports/import.ts:100`, `src/editor/language-service/completion/places/grammar/position.ts:232, 272` (slice `tree.source.text.slice(span.start, span.end)` by hand instead of `textOf` from `src/foundation/text/span.ts:16`)
  6. `src/editor/language-service/completion/visible.ts:28` and `src/editor/language-service/completion/places/imports/import.ts:123` (construct `{ name, subject: { kind: 'keyword' } }` by hand instead of `wordCandidates` from `src/editor/language-service/completion/places/grammar/words.ts:64`)
- evidence:
  1. `completion/places/grammar/index.ts:54-56` writes `owner.kind === 'Parameter' && owner.type !== undefined && unparenthesizedType(owner.type).kind === 'ReferenceType'`, which is identical to `writtenByReference(owner)` (`src/compiler/syntax/expressions/parameters.ts:64`).
  2. `navigation/rename.ts:328-335` (`shapeWriters`) imports `nodesUnder` at line 41 and uses it at line 274, then at line 328 writes a manual stack walk `const pending: SyntaxNode[] = [tree.root]; for (let node = pending.pop(); node !== undefined; node = pending.pop()) { ... pending.push(...childrenOf(tree, node)); }`, which is `nodesUnder(tree, tree.root)`.
  3. `completion/places/literal-field.ts:98-114` (`indentedEntryPlaceAt`) calls `indentationAt(text, ...)` at line 111, but computes `const column = start - lineStart;` (lines 98, 102) and `const at = spanIn(tree, first.span).start; return at - lineStartAt(text, at) === column;` (lines 113-114) by hand, violating `docs/reuse/text-and-positions.md` (`"count the spaces a line or text opens with, or the indentation of the line holding an offset → leadingSpaceCount, indentationAt"`). Also, lines 98-100 of `indentedEntryPlaceAt` and lines 133-138 of `literalWithItemBefore` duplicate the exact same first-on-later-line check (`text.slice(lineStartAt(text, start), start).trim() !== '' || lineStartAt(text, start) <= before.span.end`).
  4. `completion/places/literal-field.ts:183` (`mapKeys`) writes `const key = type?.kind === 'nominal' ? type.arguments[0] : undefined;`, violating `docs/reuse/types-and-fitting.md` (`"never a well-known type's arguments read by hand"` — use `wellKnownArguments(checker, wellKnown.map, type)`).
  5. `placeholder.ts:219`, `import.ts:100`, and `position.ts:232, 272` write `tree.source.text.slice(token.span.start, token.span.end)` instead of `textOf(tree.source, token.span)`.
  6. `visible.ts:28` (`keywords.map((keyword): Candidate => ({ name: keyword, subject: { kind: 'keyword' } }))`) and `import.ts:123` (`function word(name: 'as' | 'from'): Candidate { return { name, subject: { kind: 'keyword' } }; }`) duplicate `wordCandidates` (`words.ts:64`).
- proposal: Replace each manual re-implementation with the existing helper (`writtenByReference`, `nodesUnder`, `indentationAt` + a shared `startsLaterLineAfter(tree, before, start)` helper in `literal-field.ts`, `wellKnownArguments`, `textOf`, and `wordCandidates`).
- confidence: high

### [med] `visibleCandidates` in `completion/visible.ts` is misused in `annotation.ts` and offers all reserved keywords in single-field struct literals in `literal-field.ts`
- where: `src/editor/language-service/completion/visible.ts:25-30`, `src/editor/language-service/completion/places/annotation.ts:61-72`, `src/editor/language-service/completion/places/literal-field.ts:219, 228`
- evidence:
  - `visibleCandidates(cursor)` (`visible.ts:25-30`) concatenates `visibleNames(cursor)` and every reserved keyword (`keywords`). Its banner states it is `"what a place with no list of its own offers"`, from before every `PlaceKind` had its own provider.
  - It has only two callers in the codebase:
    1. `annotation.ts:61`: calls `visibleCandidates(cursor).filter(({ subject }) => { if (subject.kind !== 'entity') return false; ... })` — allocating candidate objects for every reserved keyword only to immediately filter all of them out! It should call `visibleNames(cursor, ...)` directly.
    2. `literal-field.ts:219, 228`: calls `visibleCandidates(cursor)` for `shorthandFor` (which immediately filters `candidate.subject.kind === 'entity' && candidate.subject.entity.kind === 'variable'`) and for `values` (`takesValue ? visible.filter((candidate) => !isBareVariant(candidate)) : []`), which causes `Box{‸}` (a single-field struct literal invoked without trigger) to offer statement/declaration keywords like `import`, `struct`, `enum`, `trait`, `return`, `while`, `let`, `const`, `for`, `drop` alongside visible names!
- proposal: Change `annotation.ts:61` and `literal-field.ts:219` to use `visibleNames` (and `operandWordsIn` if expression keywords are wanted for `takesValue`), and delete `visibleCandidates` from `completion/visible.ts`.
- confidence: high

### [low] `hold(label)` call-syntax recognition is spelled three times across `completion/placeholder.ts` and `completion/places/grammar/position.ts`
- where: `src/editor/language-service/completion/placeholder.ts:343-353`, `src/editor/language-service/completion/places/grammar/position.ts:170-173, 294-306`
- evidence:
  - Because `hold(label)` before `let`/`const`/`_` parses as a `Call` whose callee is the identifier `'hold'`, three separate functions check for it by hand:
    - `placeholder.ts:351`: `const { callee } = call; return callee.kind === 'Identifier' && callee.text === 'hold' ? 'grammar' : 'callArgument';`
    - `position.ts:170-172`: `function holds(call: Extract<SyntaxNode, { readonly kind: 'Call' }>, node: SyntaxNode): boolean { const { callee } = call; return callee.kind === 'Identifier' && callee.text === 'hold' && callee !== node; }`
    - `position.ts:294-302`: `if (call?.kind !== 'Call' || call.callee.kind !== 'Identifier' || call.callee.text !== 'hold') { return undefined; }`
- proposal: Extract a single `isHoldCall(call: Call): boolean` helper in `completion/places/grammar/` (or `placeholder.ts`) and reuse it in all three sites.
- confidence: high

### [low] Partial kind-table boilerplate (`{ readonly [Kind in SyntaxNode['kind']]?: ... }` + `as` cast) is repeated in 6 files in `editor/language-service/`
- where: `src/editor/language-service/outline/symbols.ts:64-68, 164-166`, `src/editor/language-service/outline/folding.ts:79-85, 120-122`, `src/editor/language-service/completion/placeholder.ts:306, 270`, `src/editor/language-service/hover.ts:169-183`, `src/editor/language-service/semantic-tokens/name-types.ts:31-35, 139`, `src/editor/language-service/completion/places/patterns/matched-type.ts:336, 89`
- evidence:
  - `outline/symbols.ts:64-68, 164-166` defines an exhaustive table `type SymbolsOf = { readonly [Kind in Declaration['kind']]: ... }` and casts `symbolsOfDeclaration[item.kind] as (declaration: Declaration) => readonly OutlineSymbol[]` instead of using `Handlers` and `handlerOf` from `src/foundation/structures/kind-table.ts`.
  - Five other files (`folding.ts`, `placeholder.ts`, `hover.ts`, `name-types.ts`, `matched-type.ts`) each define a custom partial mapped type `{ readonly [Kind in SyntaxNode['kind']]?: (node: Extract<SyntaxNode, { readonly kind: Kind }>, ...) => ... }` with a `// biome-ignore-start lint/style/useNamingConvention` block and a manual `table[node.kind] as ...` type cast at the lookup site.
- proposal: Use `Handlers` + `handlerOf` in `outline/symbols.ts`, and add `PartialHandlers` / `partialHandlerOf` to `src/foundation/structures/kind-table.ts` for open partial node-kind tables so the unsafe cast lives in `kind-table.ts` alone.
- confidence: high

### [low] `inlay-hints.ts` checks `parameter.type === undefined` instead of `!writesType(parameter)` on lambda parameters, and manually switches on `TargetOwner` kinds
- where: `src/editor/language-service/inlay-hints.ts:59-78`, `src/compiler/syntax/expressions/parameters.ts:50-52`, `src/compiler/syntax/statements/targets.ts:87-105`
- evidence:
  - In `inlay-hints.ts:60-76`:
    ```ts
    switch (node.kind) {
      case 'VariableDeclaration':
        return node.type === undefined ? node.targets.flatMap(targetNames) : [];
      case 'ContextConstantDeclaration':
        return node.type === undefined ? [node.name] : [];
      case 'For':
        return node.targets.flatMap(targetNames);
      case 'FieldHeader':
        return declaredTargets(node).flatMap(targetNames);
      case 'Lambda':
        return node.parameters.flatMap((parameter) =>
          parameter.kind === 'Parameter' && parameter.type === undefined
            ? parameterNames(parameter)
            : [],
        );
    ```
  - For `For` and `VariableDeclaration`, `node.targets` is accessed directly while `FieldHeader` calls `declaredTargets(node)`, even though `declaredTargets` (`targets.ts:96`) handles all of them.
  - For `Lambda`, `parameter.type === undefined` ignores `patternNamedType(parameter)` (`writesType(parameter)` in `src/compiler/syntax/expressions/parameters.ts:50`, which `signatures.ts:82` checks so it doesn't print `: Point` after `Point{x, y} as p`). If a lambda parameter is written `fn(Point{x, y} as p): x + y`, `parameter.type === undefined` is true and `parameterNames(parameter)` includes `p`, emitting a redundant `: Point` inlay hint on `as p`.
- proposal: Use `declaredTargets(node)` for target owners in `ownUntypedNames`, and for `Parameter` with `patternNamedType(parameter) !== undefined`, omit `parameter.name` (`as p`) since its type is already written by the pattern head.
- confidence: high

### [low] Unused exports and test-only exports in `src/editor/`
- where:
  - `src/editor/language-service/completion/triggers.ts:27` (`export type PlaceTest`)
  - `src/editor/language-service/workspace.ts:41, 54` (`export type ProgramChecking`, and constructor parameter `check: ProgramChecking = checkAfter`)
  - `src/editor/lsp/diagnostics.ts:36` (`export interface DiagnosticsPublisher`)
  - `src/editor/language-service/completion/index.ts:35` (`export interface CompletionRequest`)
  - `src/editor/language-service/hover.ts:42, 181` (`export interface Hover`, `export function shownAs`)
  - `src/editor/language-service/inlay-hints.ts:24` (`export interface InlayHint`)
  - `src/editor/language-service/navigation/declarations.ts:108` (`export interface NameAt`)
  - `src/editor/language-service/navigation/references.ts:34` (`export interface Reference`)
  - `src/editor/language-service/navigation/rename.ts:72, 83` (`export type Renaming`, `export interface Renamed`)
  - `src/editor/language-service/outline/folding.ts:35` (`export interface LineRange`)
  - `src/editor/language-service/semantic-tokens/semantic-tokens.ts:25` (`export interface ClassifiedSpan`)
  - `src/editor/language-service/signatures/signature-help.ts:28` (`export interface SignatureHelp`)
  - `src/editor/language-service/completion/places/grammar/words.ts:35` (`export const wordNeeds`)
  - `src/editor/language-service/completion/presentation/item.ts:80` (`export const rankGroups`)
  - `src/editor/lsp/providers/completion.ts:74` (`export function completionItem`)
- evidence:
  - `PlaceTest`, `ProgramChecking`, `DiagnosticsPublisher`, `CompletionRequest`, `Hover`, `InlayHint`, `NameAt`, `Reference`, `Renaming`, `Renamed`, `LineRange`, `ClassifiedSpan`, and `SignatureHelp` have 0 imports anywhere in `src/` or `test/`.
  - `shownAs` (`hover.ts:181`), `wordNeeds` (`words.ts:35`), `rankGroups` (`item.ts:80`), `completionItem` (`lsp/providers/completion.ts:74`), and the `check` constructor parameter of `Workspace` (`workspace.ts:54`) are only used by tests.
  - Also in `outline/symbols.ts:99-100`, `struct` types `readonly fields?: readonly (DeclaredField | Invalid)[]` as optional and writes `declaration.fields ?? []`, even though `StructDeclaration`, `SharedStructDeclaration`, and `ExternStructDeclaration` all have a required `fields` array (`declarations/index.ts:158, 236`).
- proposal: Unexport internal-only types/functions where tests can exercise the public entry points, and tighten `struct`'s parameter type in `outline/symbols.ts:96` to `DeclaredStruct | ExternStructDeclaration` (or `AssociatingDeclaration` via `membersAsWritten`).
- confidence: high

## Missing from docs/reuse

### Exported units in `src/editor/` with callers outside their folder that are missing from `docs/reuse/*.md`
- `src/editor/language-service/completion/candidate.ts`: `Candidate` (15 callers outside folder), `Subject` (1 caller outside folder)
- `src/editor/language-service/completion/expected.ts`: `expectedLiterals` (2 callers outside folder; `docs/reuse/modules-and-names.md:55` lists `expectedTypeAt`, `expectedVariants`, `isBareVariant`, but omits `expectedLiterals`)
- `src/editor/language-service/completion/index.ts`: `completionsAt` (1 caller outside folder)
- `src/editor/language-service/completion/placeholder.ts`: `ParsedPlace` (11 callers outside folder), `PlaceholderParse` (1 caller outside folder), `followsNew` (1 caller outside folder; `docs/reuse/modules-and-names.md:45` only names `parsedPlaceAt`)
- `src/editor/language-service/completion/places/grammar/chain.ts`: `holderIn` (4 callers outside folder)
- `src/editor/language-service/completion/places/grammar/words.ts`: `wordCandidates` (3 callers outside folder)
- `src/editor/language-service/completion/places/patterns/matched-type.ts`: `patternStartedBy` (1 caller outside folder; `docs/reuse/modules-and-names.md:49` lists `matchedTypeOf` and `fieldsMatchedBy`, omitting `patternStartedBy`)
- `src/editor/language-service/completion/triggers.ts`: `completionTriggers` (1 caller outside folder)
- `src/editor/language-service/hover.ts`: `hoverAt` (1 caller outside folder)
- `src/editor/language-service/inlay-hints.ts`: `inlayHintsIn` (1 caller outside folder)
- `src/editor/language-service/outline/folding.ts`: `foldingRangesOf` (1 caller outside folder)
- `src/editor/language-service/outline/symbols.ts`: `symbolsOf`, `DocumentSymbol`, `SymbolKind` (1 caller outside folder each)
- `src/editor/language-service/reading/checked-module.ts`: `CheckedModule` (5 callers outside folder; `docs/reuse/modules-and-names.md:62` lists `checkedModule` only)
- `src/editor/language-service/reading/tokens.ts`: `tokenBefore` (2 callers outside folder; `docs/reuse/syntax-and-trees.md:19` lists `allTokensOf`, `codeTokensOf`, `closingBracketsOf`, omitting `tokenBefore`)
- `src/editor/language-service/semantic-tokens/built-keys.ts`: `builtKeyTypesOf` (1 caller outside folder)
- `src/editor/language-service/semantic-tokens/semantic-tokens.ts`: `semanticTokensOf` (1 caller outside folder)
- `src/editor/language-service/semantic-tokens/semantic-types.ts`: `semanticTypes` (1 caller outside folder)
- `src/editor/language-service/signatures/call-at.ts`: `argumentParameterAt` (2 callers outside folder), `CallAt` (1 caller outside folder; `docs/reuse/modules-and-names.md:44` lists `callAt`, `calleesOf`, `writtenParameter`, omitting `argumentParameterAt` and `CallAt`)
- `src/editor/language-service/signatures/signature-help.ts`: `signatureHelpAt` (1 caller outside folder)
- `src/editor/lsp/providers/provider.ts`: `Provider` (6 callers outside folder)
- `src/editor/lsp/server.ts`: `serveLanguage` (1 caller outside folder: `src/cli/commands/lsp.ts`)
- `src/editor/lsp/std-source-request.ts`: `stdSourceRequest` (2 callers outside folder: `src/editor/lsp/providers/std-source.ts`, `src/editor/vscode-client/extension.ts`)

### Wrong or stale entries in `docs/reuse/*.md` for `src/editor/`
- `docs/reuse/modules-and-names.md:48`: lists `checkedTwinOf` (`src/editor/language-service/completion/places/patterns/matched-type.ts`), which is a **private** (`function checkedTwinOf`, non-exported) function with 0 callers outside `matched-type.ts`.
- `docs/reuse/modules-and-names.md:54`: lists `completionItem` (`src/editor/lsp/providers/completion.ts`), which has 0 non-test callers outside `completion.ts`.
- `docs/reuse/modules-and-names.md:40, 41, 43, 45, 50, 60`: lists `actedOnBy`, `isSamePlace`, `NamePlace`, `WrittenName` (`navigation/declarations.ts`), `namesDenoting` (`navigation/references.ts`), `cursorAt` (`completion/cursor.ts`), `placeAt` (`completion/place.ts`), `parsedPlaceAt` (`completion/placeholder.ts`), `modulePathsAt` (`completion/places/imports/module-paths.ts`), and `ranksBefore` (`completion/presentation/item.ts`), all of which have 0 non-test callers outside their own folder.
- `docs/reuse/types-and-fitting.md:36`: lists `functionTypeSignature` (`src/editor/language-service/signatures/signatures.ts`), which has 0 callers outside `signatures/`.
- `docs/reuse/types-and-fitting.md:107`: lists `instancesWith` (`src/compiler/checker/types/written/pattern-types.ts`, described as shared with completion), which is private in `pattern-types.ts`; the exported symbol is `instancesNamed`.
- `docs/reuse/testing.md:34-35`: line 34 (`- parse a few lines as a module for a language-service feature's test → treeOf (src/editor/language-service/language-service.test-kit.ts)`) is duplicated by line 35 (`- parse a few lines as a module for a language-service feature's test, or check them beside the std modules with a cursor marked ‸ → treeOf, programAt (src/editor/language-service/language-service.test-kit.ts)`).
