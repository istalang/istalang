# Findings for `fnd` (`src/foundation`, `src/definition`, `src/compiler/syntax`, `src/compiler/scanner`, `src/compiler/program`, `src/compiler/compile.ts`, `src/project`)

### [high] Verbatim duplicate of `GenericDeclaration`, `genericKinds`, and `isGenericDeclaration` in `checker/types/type/function-kinds.ts`
- where: `src/compiler/syntax/declarations/index.ts:72-94`, `src/compiler/checker/types/type/function-kinds.ts:197-223`, `src/compiler/checker/resolution/type-matches/reduction-requirements.ts:104, 269-271`, `src/compiler/syntax/declarations/starts.ts:19`, `src/compiler/checker/types/written/pattern-types.ts:39`
- evidence:
  - `src/compiler/syntax/declarations/index.ts:72-94` defines and exports `type GenericDeclaration`, `const genericKinds: ReadonlySet<string> = new Set<GenericDeclaration['kind']>([...])`, and `export function isGenericDeclaration(node: { readonly kind: string }): node is GenericDeclaration` (listed in `docs/reuse/modules-and-names.md`).
  - `src/compiler/checker/types/type/function-kinds.ts:197-223` contains a verbatim private copy of `type GenericDeclaration`, `const genericKinds`, and `function isGenericDeclaration(node: SyntaxNode): node is SyntaxNode & GenericDeclaration`.
  - Meanwhile, `src/compiler/checker/resolution/type-matches/reduction-requirements.ts:269-271` defines a different `function isGenericDeclaration(declaration: Instantiable): boolean { return typeParametersOf(declaration.typeParameters).length > 0; }` (duplicating `typeParametersOf(declaration.typeParameters).length > 0` in `src/compiler/syntax/declarations/starts.ts:19`), and `src/compiler/checker/types/written/pattern-types.ts:39` exports a third `export type GenericDeclaration = NominalDeclaration;`.
- proposal: Delete the private `GenericDeclaration`, `genericKinds`, and `isGenericDeclaration` in `src/compiler/checker/types/type/function-kinds.ts:197-223` and import `GenericDeclaration` and `isGenericDeclaration` from `src/compiler/syntax/declarations/index.ts`. Add `hasTypeParameters(declaration: GenericDeclaration): boolean` to `src/compiler/syntax/declarations/index.ts` and call it in `starts.ts:19` and `reduction-requirements.ts:104`; replace `GenericDeclaration` in `pattern-types.ts:39` with `NominalDeclaration`.
- confidence: high

### [high] Double standard and parallel node kinds between `NewStructLiteral`/`StructLiteral` and `IndentedValue` (`isNew`)
- where: `src/compiler/syntax/expressions/index.ts:106-122, 156-168`, `src/compiler/syntax/expressions/literals/indented-values.ts:36, 114-122`, `src/compiler/syntax/expressions/literals/built-types.ts:12-32`, `src/compiler/lowering/constructs/expressions/structs/structs.ts:35-41`, `src/compiler/binder/constructs/expressions.ts:127-128`, `src/compiler/checker/rules/flow/build/expressions.ts:194-195`
- evidence:
  - In `src/compiler/syntax/expressions/index.ts:156-168`, an indented literal (`T:`, `new T:`, or untyped `:`) is represented as a single node kind `IndentedValue` with `readonly isNew: boolean` (`false` when `type` is `undefined`).
  - Right above it in `src/compiler/syntax/expressions/index.ts:106-122`, a braced struct literal (`T{…}`, `new T{…}`, or `struct{…}`) is split into two node kinds (`StructLiteral` and `NewStructLiteral`) plus a union `export type FieldsLiteral = StructLiteral | NewStructLiteral`.
  - Because of this split, `literalOf` (`src/compiler/syntax/expressions/literals/indented-values.ts:116-122`) converts `value.isNew` into `NewStructLiteral` vs `StructLiteral`, `buildsShared` (`src/compiler/syntax/expressions/literals/built-types.ts:31`) checks `literal.kind === 'NewStructLiteral' || (literal.kind === 'IndentedValue' && literal.isNew)`, and every `Handlers` table across `binder`, `checker`, `flow`, `lowering`, `formatter`, and `editor` has duplicate entries (e.g., `lowerStructLiteral` and `lowerNewStructLiteral` in `src/compiler/lowering/constructs/expressions/structs/structs.ts:35-41` both just call `literalValue(context, node)`).
- proposal: Give `StructLiteral` the same `isNew: boolean` representation as `IndentedValue` (`(StructLiteralOf<NamedType> & { readonly isNew: boolean }) | (StructLiteralOf<undefined> & { readonly isNew: false })`) in `src/compiler/syntax/expressions/index.ts`, eliminating `NewStructLiteral` and `FieldsLiteral` and removing the duplicate `NewStructLiteral` entries across all phase `Handlers` tables.
- confidence: high

### [high] Parallel AST node kinds and duplicated member/field extraction across `For`/`FieldLoop`, `Comprehension`/`FieldComprehension`, and `StructDeclaration`/`SharedStructDeclaration`/`EnumDeclaration`
- where: `src/compiler/syntax/expressions/index.ts:47-74`, `src/compiler/syntax/statements/index.ts:79-97`, `src/compiler/syntax/statements/readings.ts:21-40`, `src/compiler/syntax/declarations/index.ts:160-179, 271-299`, `src/compiler/syntax/declarations/field-defaults.ts:67-79`, `src/compiler/checker/types/type/index.ts:91`, `src/compiler/checker/rules/expansion/types.ts:117-125`, `src/compiler/checker/types/properties/value-kinds.ts:270-283`, `src/compiler/checker/resolution/type-matches/reduction-requirements.ts:174-192`, `src/compiler/parser/grammar/statements/loops.ts:57-73`, `src/compiler/parser/grammar/expressions/literals/collections.ts:116-129`
- evidence:
  - `For` (`statements/index.ts:82`) and `Comprehension` (`expressions/index.ts:49`) both repeat `readonly targets: readonly Pattern[]; readonly iterable: Expression`, while `FieldLoop` (`statements/index.ts:93`) and `FieldComprehension` (`expressions/index.ts:69`) hold `readonly header: FieldHeader`. Both `parseForAfter` (`loops.ts:57-73`) and `parseComprehension` (`collections.ts:116-129`) parse `for <targets> in` and branch identically on `if (parser.cursor.at('...')) { const header = parseFieldHeaderAfter(parser, start, targets); ... }`.
  - `src/compiler/syntax/declarations/index.ts:271` defines `export type AssociatingDeclaration = DeclaredStruct | EnumDeclaration | ExternStructDeclaration;`, while `src/compiler/checker/types/type/index.ts:91` defines `export type NominalDeclaration = DeclaredStruct | EnumDeclaration | ExternStructDeclaration;` — an identical union under a second name.
  - Extracting all `DeclaredField`s of a struct or enum (`DeclaredStruct | EnumDeclaration`) is hand-written identically in `src/compiler/checker/rules/expansion/types.ts:117-124` (`writtenFieldsOf`) and `src/compiler/checker/types/properties/value-kinds.ts:270-275`:
    `declaration.kind === 'EnumDeclaration' ? declaration.variants.flatMap((variant) => variant.kind === 'Variant' ? variant.fields : []) : declaration.fields`.
  - In `src/compiler/checker/resolution/type-matches/reduction-requirements.ts:179-191`, `#held` manually branches on `EnumDeclaration` vs `DeclaredStruct` to call `fieldsFunctionOf(declaration, variant)` on each `variant.kind === 'Variant'` vs `fieldsFunctionOf(declaration)`, re-implementing `fieldsFunctionsOf(declaration)` from `src/compiler/syntax/declarations/field-defaults.ts:67-79`.
  - `src/editor/language-service/navigation/rename.ts:298` checks `if (holder?.kind !== 'StructDeclaration' && holder?.kind !== 'SharedStructDeclaration')` by hand instead of calling `isDeclaredStruct` (`src/compiler/syntax/declarations/index.ts:175`).
- proposal:
  1. Export `declaredFieldsOf(declaration: DeclaredStruct | EnumDeclaration): readonly DeclaredField[]` and `variantsOf(declaration: EnumDeclaration): readonly Variant[]` from `src/compiler/syntax/declarations/index.ts`, and use them in `expansion/types.ts`, `value-kinds.ts`, `binder/`, and `checker/`.
  2. Call `fieldsFunctionsOf(declaration)` in `reduction-requirements.ts:179-191` and `isDeclaredStruct` in `rename.ts:298`.
  3. Unify `AssociatingDeclaration` (`syntax/declarations/index.ts:271`) and `NominalDeclaration` (`checker/types/type/index.ts:91`) into one type in `syntax/declarations/index.ts`.
  4. Extract shared `for ... in (...)` header parsing in `parser/grammar/parts/field-headers.ts` (or unify the loop header union on `For` and `Comprehension`).
- confidence: high

### [high] Six hand-rolled re-implementations of `foundation/structures/equality.ts` combinators (`distinctItems`, `sameMembers`, `sameEntries`, `sameItems`)
- where: `src/foundation/structures/equality.ts:14-56`, `src/compiler/program/program.ts:199-201`, `src/compiler/checker/rules/lifetimes/dispatch.ts:79-82, 255-264`, `src/compiler/checker/rules/lifetimes/type-reach.ts:224-229`, `src/compiler/checker/resolution/type-matches/type-matches.ts:361-372`, `src/compiler/checker/rules/lifetimes/analysis/flow-state.ts:156-165`
- evidence:
  - `locateImport` in `src/compiler/program/program.ts:199-201` writes `const distinct = answers.filter((answer, index) => answers.findIndex(({ id }) => id === answer.id) === index)` instead of `distinctItems(answers, (a, b) => a.id === b.id)` (`src/foundation/structures/equality.ts:54`).
  - `src/compiler/checker/rules/lifetimes/dispatch.ts:80-81` writes `equal: (first, second) => first.size === second.size && [...first].every((each) => second.has(each))` instead of `equal: sameMembers` (`equality.ts:35`), even though `dispatch.ts` already imports `sameItems` from `equality.ts`.
  - `sameHandles` in `src/compiler/checker/rules/lifetimes/type-reach.ts:228` writes `return first.size === second.size && [...first].every((each) => second.has(each));` instead of `return sameMembers(first, second);`.
  - `sameWitnesses` in `src/compiler/checker/rules/lifetimes/dispatch.ts:260-263` writes `first.size === second.size && [...first].every(([position, calls]) => sameCalls(calls, second.get(position) ?? []))` instead of `sameEntries(sameCalls)(first, second)` (`equality.ts:22`).
  - `sameRecursion` in `src/compiler/checker/resolution/type-matches/type-matches.ts:361-372` writes `first.size === second.size && [...first].every(([key, verdict]) => { const other = second.get(key); ... })` instead of `sameEntries(...)`.
  - `sameSettled` in `src/compiler/checker/rules/lifetimes/analysis/flow-state.ts:159-164` writes `first.relations.length === second.relations.length && first.relations.every(...)` instead of `sameItems(...)` (which `src/compiler/checker/rules/lifetimes/summary.ts:162-163` uses for the same `ResultRelation` comparison).
- proposal: Replace all six hand-rolled checks with `distinctItems`, `sameMembers`, `sameEntries`, and `sameItems` from `src/foundation/structures/equality.ts`.
- confidence: high

### [high] Three separate definitions of `TargetOwner` across `syntax`, `binder`, and `checker`
- where: `src/compiler/syntax/statements/targets.ts:117-148`, `src/compiler/binder/module/local-binder.ts:128`, `src/compiler/checker/surface/checked-pattern.ts:29-35`
- evidence:
  - `src/compiler/syntax/statements/targets.ts:117` exports `export type TargetOwner = VariableDeclaration | For | Comprehension | FieldHeader | Parameter;`.
  - `src/compiler/binder/module/local-binder.ts:128` re-declares the exact same 5-member union locally: `type TargetOwner = VariableDeclaration | For | FieldHeader | Comprehension | Parameter;`.
  - `src/compiler/checker/surface/checked-pattern.ts:29-35` re-spells all 5 members and appends `SelectCase`: `export type TargetOwner = VariableDeclaration | For | FieldHeader | Comprehension | Parameter | SelectCase;`.
- proposal: Import `TargetOwner` from `src/compiler/syntax/statements/targets.ts` in `src/compiler/binder/module/local-binder.ts` and in `src/compiler/checker/surface/checked-pattern.ts` (`export type TargetOwner = DeclaredTargetOwner | SelectCase;`).
- confidence: high

### [med] Three separate parenthesized AST wrappers and `unparenthesized*` helpers, plus manual `Parenthesized*` loops in callers
- where: `src/compiler/syntax/expressions/index.ts:94`, `src/compiler/syntax/expressions/readings.ts:134, 151-165`, `src/compiler/syntax/patterns.ts:40, 223`, `src/compiler/syntax/types/index.ts:40, 124`, `src/compiler/syntax/expressions/parameters.ts:55-61`, `src/compiler/checker/types/written/resolve-type.ts:421`, `src/compiler/checker/constructs/patterns/walk/index.ts:209`
- evidence:
  - `Parenthesized` uses `.expression` (`expressions/index.ts:94`), `ParenthesizedPattern` uses `.pattern` (`patterns.ts:40`), and `ParenthesizedType` uses `.inner` (`types/index.ts:40`), with three separate recursive functions `unparenthesized`, `unparenthesizedPattern`, `unparenthesizedType`.
  - Inside `src/compiler/syntax/expressions/parameters.ts:55-60`, `typingPattern` manually loops `while (pattern?.kind === 'ParenthesizedPattern') { ({ pattern } = pattern); }` instead of calling `unparenthesizedPattern(parameter.pattern)` from `../patterns.ts` (which `parameters.ts` already imports from).
  - Inside `src/compiler/syntax/expressions/readings.ts:151-165`, `isItemsLiteral` has `case 'Parenthesized': return isItemsLiteral(node.expression);` instead of unwrapping with `unparenthesized(node)` defined 17 lines above in the same file.
  - Outside `syntax/`, `src/compiler/checker/types/written/resolve-type.ts:421` manually loops `while (named?.kind === 'ParenthesizedType') { named = named.inner; }` instead of calling `unparenthesizedType`, and `src/compiler/checker/constructs/patterns/walk/index.ts:209` writes `written.kind === 'ParenthesizedPattern' ? unparenthesizedPattern(written.pattern) : written` instead of `unparenthesizedPattern(written)`.
- proposal: Call `unparenthesizedPattern` in `parameters.ts:55` and `walk/index.ts:209`, `unparenthesized` in `readings.ts:151`, and `unparenthesizedType` in `resolve-type.ts:421`; optionally unify the child property name across `Parenthesized`, `ParenthesizedPattern`, and `ParenthesizedType`.
- confidence: high

### [med] `ValueSemantics` (`foundation/language/values.ts`) and `TupleSet` (`foundation/structures/entries/tuple-set.ts`) hand-roll `addToGroup` and `memo`
- where: `src/foundation/language/values.ts:123-128, 263-279`, `src/foundation/structures/groups.ts:9`, `src/foundation/structures/memo.ts:23, 39-51`, `src/foundation/structures/entries/tuple-set.ts:17-30`
- evidence:
  - `src/foundation/structures/groups.ts` states in its banner: `"Groups of items kept per key, filled one item at a time: the positions under each hash..."`. Yet `ValueSemantics` in `src/foundation/language/values.ts` hand-rolls `const bucket = table.get(hash); if (bucket === undefined) { table.set(hash, [...]); } else { bucket.push(...); }` twice: in `setEntryInPlace` (lines 123–128) and in `#tableOf` (lines 271–277).
  - `#tableOf` in `src/foundation/language/values.ts:263-279` also hand-rolls `const known = this.#tables.get(map); if (known !== undefined) return known; ... this.#tables.set(map, table); return table;` instead of calling `memo(this.#tables, map, () => ...)`.
  - `TupleSet.add` in `src/foundation/structures/entries/tuple-set.ts:19-25` hand-rolls `let next = prefix.next.get(item); if (next === undefined) { next = { next: new Map(), added: false }; prefix.next.set(item, next); } prefix = next;` instead of `prefix = memo(prefix.next, item, () => ({ next: new Map(), added: false }))`, which `SequenceMemo.get` in sibling `src/foundation/structures/memo.ts:45` uses.
- proposal: Use `addToGroup` and `memo` in `src/foundation/language/values.ts`, and `memo` in `src/foundation/structures/entries/tuple-set.ts`.
- confidence: high

### [med] `encoderProblem` in `definition/tables/functions.ts` re-implements `takesArguments(entry, 1)` defined 15 lines above
- where: `src/definition/tables/functions.ts:146-173`, `src/definition/validation/entries.ts:55-76`, `src/runtime/snapshot/check/calls.ts:26-62`
- evidence:
  - `src/definition/tables/functions.ts:146-152` defines `export function takesArguments(entry: FunctionDefinition, given: number): boolean { return given <= entry.parameters.length && entry.parameters.every((_, index) => index < given || mayLeaveOut(entry, index)); }`.
  - Immediately below at lines 163–173, `encoderProblem` writes:
    `const takesOneValue = entry.parameters.length > 0 && !takesReference(entry, 0) && entry.parameters.every((_, index) => index === 0 || mayLeaveOut(entry, index));`
    where `entry.parameters.length > 0 && entry.parameters.every((_, index) => index === 0 || mayLeaveOut(entry, index))` is `entry.parameters.length >= 1 && takesArguments(entry, 1)`.
  - Checking that a function entry takes `N` value arguments (none by reference), 0 captures, and returns at once / runs in allowed modes is also repeated in `checkCalledEntry` (`src/definition/validation/entries.ts:55-76`) and `callProblems` / `calledBackProblems` (`src/runtime/snapshot/check/calls.ts:26-62`).
- proposal: Use `takesArguments(entry, 1)` in `encoderProblem` (`src/definition/tables/functions.ts:165`), and share a common helper in `src/definition/tables/functions.ts` for checking uncaptured value-argument callability across `encoderProblem`, `validation/entries.ts`, and `snapshot/check/calls.ts`.
- confidence: high

### [med] Duplicate field-ordering helpers: `inDeclaredOrder` (`definition/values/declared-values.ts`) vs `laidOut` (`checker/types/type/field-order.ts`)
- where: `src/definition/values/declared-values.ts:57-66`, `src/compiler/checker/types/type/field-order.ts:15-46`
- evidence:
  - `src/compiler/checker/types/type/field-order.ts` has no checker dependencies (imports only `compareOrdered` and `unreachable` from `src/foundation/`) and defines `inFieldOrder`, `laidOut(fields, named)`, and `namedValues(fields, values)` to map `{ readonly name: string }[]` to field values by name or fail with `unreachable`.
  - `src/definition/values/declared-values.ts:57-66` defines `inDeclaredOrder(declared: readonly { readonly name: string }[], fields: NamedFields): Value[]` doing the same lookup-by-name in `declared` order with `unreachable` on a missing field.
- proposal: Move `inFieldOrder`, `laidOut`, and `namedValues` from `src/compiler/checker/types/type/field-order.ts` to `src/foundation/language/` (preserving `null` values via `.has`/`Object.hasOwn`) and use `laidOut` in `src/definition/values/declared-values.ts`.
- confidence: high

### [med] Duplicated extern text-payload and enum variant-name helpers between `definition/values/` and `stdlib/values/`
- where: `src/definition/values/instance-handles.ts:12-24`, `src/definition/values/declared-values.ts:122-177`, `src/stdlib/values/arguments.ts:43-68`, `src/stdlib/values/results.ts:116-118`
- evidence:
  - `src/definition/values/instance-handles.ts` defines `instanceHandle(type, name)` (`{ kind: 'extern', type, payload: name }`) and `instanceNameOf(handle)` (`handle !== undefined && isComposite(handle) && handle.kind === 'extern' && typeof handle.payload === 'string' ? handle.payload : unreachable(...)`).
  - `src/stdlib/values/results.ts:116-118` defines `function externOf(type: TypeId, payload: unknown): Value { return { kind: 'extern', type, payload }; }`, and `src/stdlib/values/arguments.ts:43-55` defines `externPayloadOf` and `textPayloadOf(value)` doing the identical `isComposite(value) && value.kind === 'extern'` + `typeof payload === 'string'` check.
  - Similarly, `src/stdlib/values/arguments.ts:61-68` defines `function variantName(context, value)` to look up `declared.variants[value.variant]?.name` on a variant `Value`, which `optionalOf` in `src/definition/values/declared-values.ts:154` also computes inline (`enumVariants(types, value.type)[value.variant]?.name`).
- proposal: Move `externOf`, `externPayloadOf`, and `textPayloadOf` to `src/definition/values/values.ts` (and `variantNameOf(types, value)` to `src/definition/values/declared-values.ts`), and have `instance-handles.ts`, `stdlib/values/arguments.ts`, and `stdlib/values/results.ts` delegate to them.
- confidence: high

### [med] Ordering `Relation` union spelled twice across `syntax/expressions/operators.ts` and `definition/instructions/data.ts`
- where: `src/foundation/language/order.ts`, `src/compiler/syntax/expressions/operators.ts:36`, `src/definition/instructions/data.ts:113`, `src/runtime/interpreter/instructions.ts:45-50`
- evidence:
  - `src/definition/tables/functions.ts:25, 49` imports `marks` from `src/foundation/language/well-known/index.ts` for `z.enum(marks)`, and `src/definition/tables/types.ts:35, 39` imports `primitiveNames` from `src/foundation/language/primitives.ts` for `z.enum(primitiveNames)`.
  - By contrast, `src/definition/instructions/data.ts:113` hardcodes `relation: z.enum(['less', 'lessOrEqual', 'greater', 'greaterOrEqual'])`, while `src/compiler/syntax/expressions/operators.ts:36` separately declares `export type Relation = 'less' | 'lessOrEqual' | 'greater' | 'greaterOrEqual';`.
- proposal: Export `export const orderRelations = ['less', 'lessOrEqual', 'greater', 'greaterOrEqual'] as const; export type Relation = (typeof orderRelations)[number];` from `src/foundation/language/order.ts`, and import it in both `src/compiler/syntax/expressions/operators.ts` and `src/definition/instructions/data.ts`.
- confidence: high

### [med] `misplacedArgument` / `givenOutOfOrder` in `syntax/expressions/arguments.ts` treats `Invalid` recovery nodes as positional arguments
- where: `src/compiler/syntax/expressions/arguments.ts:14-35`, `src/compiler/parser/grammar/expressions/postfix.ts:148-151`, `src/compiler/parser/grammar/patterns.ts:275-295`, `src/compiler/checker/surface/struct-items.ts:42-60`
- evidence:
  - `misplacedArgument` in `src/compiler/syntax/expressions/arguments.ts:14-20` passes `(argument) => argument.kind === 'NamedArgument' ? 'name' : 'position'` to `givenOutOfOrder`, classifying `Invalid` recovery nodes as `'position'`.
  - `parseCall` in `src/compiler/parser/grammar/expressions/postfix.ts:148-150` works around this with `if (misplaced !== undefined && misplaced.kind !== 'Invalid')`, which means if an `Invalid` node precedes a positional argument after a named argument (`f(a: 1, @bad, 2)`), `misplacedArgument` returns the `Invalid` node and `2` goes unreported.
  - Conversely, `parseVariantCallPattern` in `src/compiler/parser/grammar/patterns.ts:275-295` does not check `afterNamed.kind !== 'Invalid'`, so an `Invalid` node after a `NamedPatternArgument` is reported a second time as `positionalAfterNamed`.
  - Meanwhile, `callPatternArguments` in `src/compiler/checker/surface/struct-items.ts:49-56` re-implements positional-after-named detection (`argument.kind !== 'NamedPatternArgument' && named !== -1 && index > named`) separately from `givenOutOfOrder`.
- proposal: Return `undefined` for `'Invalid'` (and `'Missing'`) in `misplacedArgument` and `givenAs` so `givenOutOfOrder` ignores recovery nodes, remove `&& misplaced.kind !== 'Invalid'` in `postfix.ts:149`, and share the classification with `callPatternArguments`.
- confidence: high

### [med] Unexported AST/Value interfaces and bypassed `fnd` helpers (`declaredFunctions`, `typeParametersOf`, `awaits`, `namedTypeText`, `withPushed`)
- where: `src/compiler/syntax/patterns.ts:36-42, 95, 198-203`, `src/definition/values/values.ts:122-158`, `src/compiler/compile.ts:116-123`, `src/compiler/checker/types/traits/known-constraints.ts:425`, `src/compiler/checker/rules/lifetimes/analysis/index.ts:232`, `src/compiler/checker/rules/lifetimes/analysis/operations.ts:141, 191`, `src/compiler/checker/rules/lifetimes/lifetimes.ts:307`, `src/compiler/checker/constructs/patterns/walk/kinds/variant-calls.ts:350`, `src/compiler/checker/constructs/expressions/deferred-calls.ts:127-129`, `src/compiler/checker/constructs/closures/function-values.ts:114`, `src/compiler/lowering/constructs/statements/variables.ts:107-115`
- evidence:
  - `TuplePattern` (`src/compiler/syntax/patterns.ts:36`) is not exported, forcing `src/editor/language-service/completion/places/patterns/matched-type.ts:153` to write `Extract<SyntaxNode, { kind: 'TuplePattern' }>`, and `matched-type.ts:150-154` and `src/editor/language-service/hover.ts:120-125` to independently define the 4-kind set `StructPattern | VariantCallPattern | TuplePattern | ArrayPattern` (`TakingPattern` / `takingApart`).
  - `ClosureOf` and `VariantOf` (`src/definition/values/values.ts:134, 144`) are not exported, forcing `src/runtime/scheduler/testing/mocks.ts:69, 83`, `src/definition/values/json-values.ts:206`, `src/definition/values/declared-values.ts:185`, and `src/runtime/interpreter/instructions.ts:268` to write `Extract<CompositeValue, { kind: 'closure' }>` and `Extract<Value, { kind: 'variant' }>`.
  - `compileTests` in `src/compiler/compile.ts:116-123` iterates `tree.root.items` and checks `item.kind === 'FunctionDeclaration'` twice instead of calling `declaredFunctions(tree.root)` (`src/compiler/syntax/declarations/index.ts:384`).
  - `src/compiler/checker/types/traits/known-constraints.ts:425` writes `trait.typeParameters.filter((each) => each.kind === 'TypeParameter')` instead of `typeParametersOf(trait.typeParameters)` (`src/compiler/syntax/declarations/index.ts:67`).
  - Four sites in `src/compiler/checker/rules/lifetimes/` (`analysis/index.ts:232`, `analysis/operations.ts:141, 191`, `lifetimes.ts:307`) check `.qualifiers.async !== undefined` directly instead of calling `awaits(qualifiers)` (`src/compiler/syntax/tokens/modifiers.ts:62`).
  - `src/compiler/checker/constructs/patterns/walk/kinds/variant-calls.ts:350` writes `node.callee.path.map((name) => name.text).join('.')` on a `NamedType` instead of calling `namedTypeText(node.callee)` (`src/compiler/syntax/types/index.ts:260`), and `deferred-calls.ts:127-129` and `function-values.ts:114` do the same on `qualifiedPath(...)`.
  - `VariableRegisters.inBlock` (`src/compiler/lowering/constructs/statements/variables.ts:107-115`) manually pushes onto `this.#blocks` and pops in `try / finally` instead of calling `withPushed` (`src/foundation/structures/stack.ts:9`).
- proposal: Export `TuplePattern` (and other AST/Value variant interfaces), generalize `namedTypeText` to `qualifiedNameText(path: QualifiedName)` in `src/compiler/syntax/tree/node.ts`, and replace the manual re-implementations in `compile.ts`, `known-constraints.ts`, `checker/rules/lifetimes/`, `variant-calls.ts`, `deferred-calls.ts`, `function-values.ts`, and `variables.ts` with the existing `fnd` units.
- confidence: high

### [med] Dead code, test-only exports, and leaked internal parameters in `fnd`
- where: `src/compiler/compile.ts:138-141`, `src/foundation/diagnostics/render.ts:21-41, 55-65`, `src/definition/values/json-values.ts:129, 157`, `src/project/file-loader.ts:31-34, 37, 45, 64-79`, `src/project/project-files.ts:42-50`, `src/definition/tables/functions.ts:49`, `src/definition/values/equality.ts:24`, `src/compiler/lowering/tables/type-table.ts:118-124, 315-325`
- evidence:
  - `mainOf` (`src/compiler/compile.ts:138`) is never imported by any non-test module (only called internally by `compile` at line 89 and by `compile.test.ts`).
  - `renderDiagnostic` (`src/foundation/diagnostics/render.ts:21-41`) is never imported by any non-test module (only called internally by `renderDiagnostics` at line 63 and by `render.test.ts`), and its 2-argument overload `renderDiagnostic(source, diagnostic)` (without `sourceOf`) and `if (sourceOf === undefined) return unreachable(...)` guard exist only for `render.test.ts`. Similarly, the `keep` filter parameter on `renderDiagnostics` (`render.ts:57`) is never passed by its sole non-test caller (`src/cli/report.ts:16`); only `test/examples.test.ts:44` passes it.
  - `plainOfJson(json, shape, depth = 0)` and `jsonOfPlain(plain, shape, depth = 0)` (`src/definition/values/json-values.ts:129, 157`) expose their internal recursion counter `depth = 0` on their exported signatures; no external caller ever passes `depth`.
  - `ProjectPlaces` (`src/project/file-loader.ts:31-34`) separates `projectRoot` and `cwd` and maintains a 3-level nested cache (`Map<projectRoot, Map<cwd, Map<file, ModuleNames>>>`, lines 64–79), but its only non-test caller (`loadProject` in `src/project/project.ts:129`) always passes `{ projectRoot: cwd, cwd }` because the project root is always `cwd` (`project.ts:2-3`).
  - `overlaidFiles(open, files = diskFiles)` (`src/project/project-files.ts:42-45`) has a `files` parameter that its only non-test caller (`src/editor/lsp/project-loader.ts:32`) never passes.
  - `export const codeMode` (`src/definition/tables/functions.ts:49`) is only imported by `instruction.test-kit.ts`, and `export type MapValue = MapOf<Value>` (`src/definition/values/equality.ts:24`) is only imported by `equality.test.ts` (unused even in `equality.ts`).
  - Related to `EnumRole` (`'json'`) in `src/definition/tables/types.ts:95, 102`: in `src/compiler/lowering/tables/type-table.ts:316`, `case 'EnumDeclaration'` calls `const role = this.#roleOf(enumRoles, declaration)`, which can never match because `enumRoles` only contains `json: wellKnown.json` (`type Json = ...`, a recursive union `TypeAliasDeclaration` handled in `#unionLayout` at lines 361–365).
- proposal: Unexport `mainOf` and `renderDiagnostic` (or drop its 2-arg overload), keep `depth` internal in `json-values.ts`, simplify `ProjectPlaces` and its 3-level cache in `file-loader.ts` to a single `projectRoot: string`, remove unused default parameters, and delete `#roleOf(enumRoles, declaration)` on `EnumDeclaration` in `type-table.ts`.
- confidence: high

## Missing from docs/reuse

### Reusable exported units in `fnd` (with callers outside their folder) missing from `docs/reuse/*.md`
- `src/foundation/diagnostics/render.ts`: `renderDiagnostics`, `Diagnosed` (1 caller outside folder: `src/cli/report.ts`; `docs/reuse/diagnostics.md` lists `renderDiagnostic` instead)
- `src/foundation/language/call-rule.ts`: `mayCall` (2 callers outside folder: `src/definition/validation/entries.ts`, `src/runtime/scheduler/segment/calls.ts`)
- `src/foundation/language/starts.ts`: `StartShape` (3 callers outside folder)
- `src/foundation/language/values.ts`: `MapOf` (3 callers outside folder), `ValueView` (1 caller outside folder)
- `src/foundation/language/well-known/codecs.ts`: `CodecHelper` (4 callers outside folder), `CodecName` (1 caller outside folder)
- `src/foundation/language/well-known/implicit-calls.ts`: `partConversionFunctions` (1 caller outside folder)
- `src/foundation/language/well-known/index.ts`: `LanguageModule` (6), `WellKnownDeclaration` (12), `runtimeModule` (1), `persistences` (2), `Persistence` (4), `marks` (3), `Mark` (4), `sendabilities` (2), `Sendability` (2)
- `src/foundation/language/well-known/jobs.ts`: `jobFunctions` (1), `jobWaypoint` (1)
- `src/foundation/structures/equality.ts`: `distinctItems` (5 callers outside folder)
- `src/foundation/structures/stack.ts`: `withEmptied` (1 caller outside folder)
- `src/definition/formats/codec.ts`: `contentHashText` (1 caller outside folder: `src/runtime/snapshot/snapshot.ts`)
- `src/definition/tables/functions.ts`: `returnsAtOnce` (1), `takesArguments` (1), `CodeMode` (3), `FunctionDefinition` (7), `CodeFunction` (13)
- `src/definition/values/json-values.ts`: `JsonType` (1), `JsonError` (3)
- `src/compiler/syntax/declarations/index.ts`: `isDefaultOf` (2), `isRestField` (3)
- `src/compiler/syntax/expressions/arguments.ts`: `givenOutOfOrder` (1 caller outside folder: `src/compiler/parser/grammar/patterns.ts`)
- `src/compiler/syntax/expressions/readings.ts`: `isItemsLiteral` (1 caller outside folder: `src/compiler/checker/types/fitting/fit/index.ts`)
- `src/compiler/syntax/patterns.ts`: `isTakingApart` (2 callers outside folder)
- `src/compiler/syntax/tokens/grammar-words.ts`: `clauseWordsAfterOperand` (1), `topLevelFollowers` (1), `varianceMarkers` (1), `VarianceMarker` (4)
- `src/compiler/syntax/tokens/modifiers.ts`: `unqualified` (1), `isModifierWord` (3), `startsOf` (1), `modifiersAroundMark` (1)
- `src/compiler/scanner/characters.ts`: `isInlineWhitespace` (1 caller outside folder: `src/editor/language-service/completion/cursor.ts`)
- `src/compiler/program/program.ts`: `stdModuleIdOf` (2 callers outside folder), `LocatedModule` (4 callers outside folder)

### Stale or wrong entries in `docs/reuse/*.md` for `fnd`
- `docs/reuse/values-and-equality.md`: lists `variantShape` (`src/definition/values/declared-values.ts`), which is a file-private function (`function variantShape` at line 122), not exported.
- `docs/reuse/modules-and-names.md`: lists `primitiveKey` (`src/definition/extern-key.ts`), which is a file-private function (`function primitiveKey` at line 68), not exported.
- `docs/reuse/syntax-and-trees.md`: lists `isOptionallyChained` (`src/compiler/syntax/expressions/chains.ts`), which has 0 callers outside `src/compiler/syntax/expressions/` (only used by `src/compiler/syntax/expressions/places.ts`).
- `docs/reuse/diagnostics.md`: lists `renderDiagnostic` (`src/foundation/diagnostics/render.ts`), which has 0 non-test callers outside `render.ts`, while omitting `renderDiagnostics` (which `src/cli/report.ts` calls).
- `docs/reuse/types-and-fitting.md`: duplicates the bullet `- decide whether a host may start a function, or which is main → isStartable, isMainShaped (src/foundation/language/starts.ts), over a function's written startShapeOf and isMain (src/compiler/syntax/declarations/starts.ts) or an entry's` twice (at lines 47 and 49).
