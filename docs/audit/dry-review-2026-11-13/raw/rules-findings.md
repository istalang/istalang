# DRY & Quality Findings — `src/compiler/checker/rules`

### [high] Parallel AST-to-operations lowering in `rules/flow/build/` and `compiler/lowering/`
- where: `src/compiler/checker/rules/flow/build/{calls,chains,control,expressions,literals,loops,parts,places,scopes,statements}.ts` vs. `src/compiler/lowering/constructs/{expressions,loops,parts,statements}/` and `src/compiler/lowering/values/optionals.ts`
- evidence: Every construct module in `rules/flow/build/` explicitly re-implements the AST desugaring and evaluation-order logic of `compiler/lowering/` over the same `CheckedBody` facts (as noted in their banners):
  - **Calls**: `flow/build/calls.ts:45–284` (`callFlow`, `calleeValue`, `inParameterOrder`, `prepared`, `parametersOf`) mirrors `lowering/constructs/expressions/calls.ts:48–285` (`lowerCall`, `preparedCall`, `valueCallee`, `valueArguments`, `parametersByArgument`).
  - **Deferred calls**: `flow/build/calls.ts:207–284` (`deferredFunction`, `closureMaking`, `isMade`, `computedNow`, `madeLater`) mirrors `lowering/constructs/expressions/deferred-calls.ts:43–187` (`lowerDeferredCall`, `deferredFunction`, `isMade`, `computedNow`, `deferredEntry`).
  - **Struct & collection literals**: `flow/build/literals.ts:47–211` (`structLiteral`, `evaluatedItems`, `fieldOf`, `structComprehension`, `spreadValue`, `declaredLiteral`) mirrors `lowering/constructs/expressions/structs/structs.ts:43–130` (`literalValue`, `literalFields`, `comprehendedFields`, `fieldOf`) and `lowering/constructs/expressions/collections/collections.ts` (`lowerDeclaredLiteral`, `spreadArray`).
  - **Places**: `flow/build/places.ts:28–175` (`enterPlace`, `stepInto`, `enterAssigned`, `rootPlace`, `writeElement`, `leaveAll`) mirrors `lowering/constructs/parts/places.ts` (`enterReferenced`, `enterAssigned`, `stepInto`, `leaveAll`).
  - **Patterns & target paths**: `flow/build/parts.ts:38–217` (`bindParameters`, `bindTargets`, `matchPattern`, `readAlong`, `matchChecked`, `testPart`, `offsetsOf`) mirrors `lowering/constructs/parts/part-paths.ts` (`readPartAlong`) and `lowering/constructs/parts/patterns.ts` (`lowerMatching`, `lowerTests`, `lowerAlternatives`).
  - **Optional chains**: `flow/build/chains.ts:28–98` (`openChain`, `closeChain`, `stepTarget`, `linksOf`) mirrors `lowering/values/optionals.ts` (`Chains`).
  - **Control & loops**: `flow/build/control.ts:46–310` and `flow/build/loops.ts:34–144` mirror `lowering/constructs/expressions/control/` and `lowering/constructs/loops/{iteration,field-passes}.ts`.
  Adding or changing any expression or statement construct requires parallel edits across both `checker/rules/flow/build/` and `lowering/constructs/`.
- proposal: Unify the AST-to-CFG step: either (a) extract shared construct-decomposition helpers on `CheckedBody` / `syntax/` (call argument preparation & ordering, deferred-call capture lists, struct literal item evaluation, place path decomposition) consumed by both `FlowBuilder` and `FunctionContext`, or (b) lower `CheckedBody` once into the generic `FlowFunction` CFG and have `compiler/lowering/` emit `Definition` instructions per instantiation from `FlowFunction` instead of walking the AST a second time.
- confidence: high

### [high] Deferred calls (`g f(args)`) implemented with separate machinery in 6 places instead of reducing to one closure plan
- where: `src/compiler/checker/constructs/expressions/deferred-calls.ts:154–262`, `src/compiler/checker/rules/flow/build/calls.ts:207–284`, `src/compiler/lowering/constructs/expressions/deferred-calls.ts:43–187`, `src/compiler/checker/rules/kinds/data-kinds.ts:226–229, 347–358`, `src/compiler/checker/rules/disposal/disposal.ts:287–289`, `src/compiler/syntax/tree/index.ts:218–227`
- evidence: As `constructs/expressions/deferred-calls.ts:2–3` states, `g f(args)` is semantically `g((fn(x): fn(): f(x))(args))`. Instead of reducing `DeferredCall` or recording its capture/call plan once during checking, six places independently reconstruct what runs now vs. later:
  - `constructs/expressions/deferred-calls.ts:240–262` implements `computedNow(context, call)` and `calleeNow(context, call)` to find captured operands for `capturedSend` and `laterMarkOf`, plus `Deferrals.isMadeLater` (`lines 87–89`).
  - `rules/flow/build/calls.ts:237–284` re-implements `isMade(builder, call)`, `computedNow(builder, call)`, `closureMaking(builder, node, values)`, and `madeLater(later, call, captured)`.
  - `lowering/constructs/expressions/deferred-calls.ts:65–187` re-implements `isMade(context, node)`, `computedNow(context, call, site)`, and `deferredEntry`.
  - `rules/kinds/data-kinds.ts:347–358` implements `laterOf(node)` (`for (let call: Expression = node.call; ; call = call.expression) { later.add(call); if (call.kind !== 'Parenthesized') return later; }`) to skip nodes evaluated in the deferred closure, even though `Deferrals.isMadeLater` already exists on `BodyChecker`.
  - `rules/disposal/disposal.ts:287` special-cases `const captured = node.kind === 'DeferredCall' && child === node.call` in `checkSelfStays`.
  - `syntax/tree/index.ts:223–226` special-cases `DeferredCall` in `bodyChildrenOf`.
- proposal: Record the resolved `DeferredCall` plan (its immediate `computedNow` operands, target call, and synthesized 0-arg closure type) once in `Deferrals` (`constructs/expressions/deferred-calls.ts`) — or desugar `DeferredCall` into a closure — so `flow/build/calls.ts` and `lowering/constructs/expressions/deferred-calls.ts` consume that single plan without re-implementing `isMade`/`computedNow`, and remove `laterOf` in `data-kinds.ts`.
- confidence: high

### [high] Untyped temporaries in `flow/build/` pun `type: undefined` ("error/unknown") with "omitted by builder", defeating `holdsNothingRelevant` and dropping destructured input paths in `lifetimes`
- where: `src/compiler/checker/rules/flow/flow-ir.ts:40–52`, `src/compiler/checker/rules/flow/build/parts.ts:90–106, 158, 195–217`, `src/compiler/checker/rules/flow/build/literals.ts:87–98, 272`, `src/compiler/checker/rules/flow/build/loops.ts:48, 103`, `src/compiler/checker/rules/flow/build/control.ts:143, 221, 252`, `src/compiler/checker/rules/lifetimes/analysis/nodes.ts:22–25, 289–307`, `src/compiler/checker/rules/lifetimes/analysis/operations.ts:280–297`, `src/compiler/checker/rules/lifetimes/analysis/index.ts:63–98`
- evidence:
  - `flow-ir.ts:40` documents `FlowValue.type: Type | undefined` as: `"A type is undefined where checking recorded none, in code it found a mistake in."`
  - `lifetimes/analysis/nodes.ts:289–307` treats `type === undefined` as maximally conservative (`isRelevant` returns `true`; `reachOf` returns `anyReach`).
  - However, `flow/build/` calls `builder.temporary(site, undefined)` in 13 places for ordinary, well-typed code: `constant(builder, site)` (`parts.ts:196`, used for range bounds, template separators, array pattern offsets, field loop keys, `unwrap` panic text), `readAlong` (`parts.ts:98`, used for all pattern and destructuring target steps), `testPart`'s boolean `holds` (`parts.ts:158`), `itemLoop`'s `step` (`loops.ts:48`), `fieldLoop`'s `field` tuple (`loops.ts:103`), `template`'s `joined` array (`literals.ts:272`), `fieldOf`'s spread read (`literals.ts:96`), etc.
  - **Effect 1 (defeated fast path)**: `holdsNothingRelevant(nodes)` (`lifetimes/analysis/index.ts:69–74`) checks `nodes.flow.values.every((_, value) => !nodes.isRelevant(value))`. Any function containing a range, template, `for` loop, field loop, destructuring `let (x, y) = ...`, `match`/`is`, `??`, `?`, or `!` has an untyped temporary with `isRelevant === true`, bypassing the single-pass `analyzedOnce` fast path (`index.ts:64`) even when the function only touches `Int` and `String`.
  - **Effect 2 (lost path precision on destructuring)**: In `bind` (`parts.ts:202–217`), `TargetBinding` and `PartBinding` carry `type: Type`, but `bind` ignores `type` and calls `readAlong`, which allocates `const read = builder.temporary(site, undefined)`. In `readOf` (`lifetimes/analysis/operations.ts:280–297`), `const type = analysis.nodes.typeOf(into); if (root !== undefined && type !== undefined && state.reach.isLive(root))` is therefore `false`! Consequently, destructuring `let { a, b } = p` or `fn f({ a, b }: Pair)` fails to intern `Nodes.path` nodes and fails to separate siblings `p.a` and `p.b`, unlike `let a = p.a; let b = p.b` (where `MemberAccess` uses `temporaryOf(node)` with a known `Type`).
  - **Effect 3 (struct-field punning in `literals.ts:96–97`)**: `fieldOf` for a struct spread emits `const step = { kind: 'step', step: source.index } as const`, using a numeric tuple position (`#0` in `Nodes.partKey`) instead of `{ kind: 'field', of, name: source.field }` (`.name` in `Nodes.partKey`), violating the `PartStep` invariant (`surface/checked-pattern.ts:39`: `"never a position ... for a struct's field"`) and preventing spread reads from matching `Nodes.madeParts` (`nodes.ts:251`).
- proposal: Stop punning `type: undefined` on `FlowValue`. Pass the actual `Type` to `builder.temporary` (e.g. `TargetBinding.type` / `PartBinding.type` in `readAlong`/`bind`, primitive types for `constant`/`holds`, and `{ kind: 'field', of, name: source.field }` with the field's type in `literals.ts:fieldOf`), and use `errorType` when checking failed.
- confidence: high

### [high] Custom AST walks in `rules/disposal/disposal.ts` and `rules/kinds/data-kinds.ts` bypass `flowOf` and `bodyChildrenOf`/`nestsFunction`
- where: `src/compiler/checker/rules/disposal/disposal.ts:248–295`, `src/compiler/checker/rules/kinds/data-kinds.ts:219–238, 297–358`, `src/compiler/checker/rules/lifetimes/analysis/index.ts:230–235`
- evidence:
  - `docs/reuse/types-and-fitting.md` states: `"every rule over the order a body runs in or where its values go reads its flow IR (flowOf, rules/flow/build/index.ts), never a walk of its own."`
  - `docs/reuse/syntax-and-trees.md` states: `"list direct children that run in the same function body where they stand (skipping nested functions, and the call a deferred call makes later, though not what it computes now) → bodyChildrenOf, nestsFunction (src/compiler/syntax/tree/index.ts); the one home of 'runs now', which every walk asking it reads."`
  - `disposal.ts:248–295` (`checkSelfStays`) walks raw AST nodes in `dispose` to check where `self` goes (manually tracking `outer` ancestor chains, filtering `Parenthesized`, inspecting `Dereference`, `Call` + `makerOf`, `MemberAccess` + `callOfCallee`, `nestsFunction`, `node.kind === 'DeferredCall' && child === node.call`, and `bodyHeldApart` for local `FunctionDeclaration` bodies). In `FlowFunction` (`flowsBuiltFor(body)`), `self` is `flow.parameters[0]` and every use of it is already normalized to `copy`/`read`/`write`/`call`/`make` operations!
  - `data-kinds.ts:297–299` (`nestedOf`) and `lifetimes/analysis/index.ts:230–234` (`isAsyncSite`) re-implement `nestsFunction(node)` by hand (`node.kind !== 'Lambda' && node.kind !== 'FunctionDeclaration'`).
  - `data-kinds.ts:333–334` (`judgeNested`) and `disposal.ts:255–259` (`bodyHeldApart`) duplicate the lookup `node.kind === 'FunctionDeclaration' ? checker.inputs.bodyOf(module, node) : undefined`.
- proposal: Rewrite `checkSelfStays` (`disposal.ts`) over the `FlowFunction` already built for `dispose`'s body (`flowsBuiltFor`), where `self` staying means every use of `flow.parameters[0]` is either `read` with `part.kind === 'behind'` or an argument to `call` with `call.function.isExtern`; and use `nestsFunction` in `data-kinds.ts` and `lifetimes/analysis/index.ts`.
- confidence: high

### [med] Three-way duplication of escaping-function cycle checks across `lifetimes/`, with missing type substitution on generic function values and witness requirements
- where: `src/compiler/checker/rules/lifetimes/analysis/operations.ts:100–106, 369–408`, `src/compiler/checker/rules/lifetimes/analysis/calls.ts:258–282`, `src/compiler/checker/rules/lifetimes/declared.ts:154–168`, `src/compiler/checker/rules/lifetimes/escaping.ts:74–99`, `src/compiler/checker/rules/lifetimes/composition.ts:17–68`
- evidence:
  - `operations.ts:384–395` (`functionInputs`), `calls.ts:258–282` (`checkWitnesses`), and `declared.ts:154–168` (`Declared.violationsOf`) all repeat the same parameter-type lookup `(input: Input) => input.kind === 'parameter' ? parameters[input.index]?.type : undefined` and pass it to `escapingCycles(facts, summary, typeOf)` followed by `violate(...)`.
  - In `operations.ts:406`, `checkEscaping` types its parameter as `kind: 'closure' | 'witness'`, but `'witness'` is dead there (both call sites at `operations.ts:105, 373` pass `'closure'`, because witness checking was duplicated into `checkWitnesses` in `calls.ts:258`).
  - Because the substitution logic was split across callers instead of shared:
    - `functionInputs` (`operations.ts:384–395`) substitutes `parameters[input.index]?.type` via `context.substitute(type, call)`, but passes `summary` unsubstituted to `escapingCycles` — so for a generic function named as a value (`let g = f<Slot<Lease>>`), `requirement.holderType`, `requirement.valueType`, `input.type` on `path` inputs, and `summary.always` remain unsubstituted!
    - `checkWitnesses` (`calls.ts:268–276`) manually substitutes `requirement.holderType` and `summary.always`, but forgets to substitute `requirement.valueType` and `input.type` on `path` inputs (whereas `boundBy` in `composition.ts:53–59` substitutes both `holderType` and `valueType`).
- proposal: Add a single helper in `escaping.ts` (or `composition.ts`) that substitutes a `Summary`'s types (`holderType`, `valueType`, `path` input types, and `always`) and runs `escapingCycles` for a `FunctionCall` or `FunctionDeclaration`, call it from `operations.ts`, `calls.ts`, and `declared.ts`, and remove the dead `'witness'` arm on `checkEscaping` in `operations.ts`.
- confidence: high

### [med] Part-by-part constant conversion in `rules/computation/forms.ts` re-implements `partPairs` (`types/fitting/part-pairs.ts`), and `computation/index.ts` uses `switch` with `default`
- where: `src/compiler/checker/rules/computation/forms.ts:111–208` vs. `src/compiler/checker/types/fitting/part-pairs.ts:30–109`; `src/compiler/checker/rules/computation/index.ts:109–166`
- evidence:
  - `types/fitting/part-pairs.ts` (`partPairs`) is the single home for pairing a value's parts with a target type's parts under `conversion.kind === 'parts'` (handling `union`, `anonymous`, `tuple`, `array`, `map`, and `nominal` structs/enums).
  - `computation/forms.ts` (`partsForm` and `structForm`, lines 111–181) does not call `partPairs`; instead it unfolds `from` and `to` and manually re-extracts `arrayElement(checker, value)` / `arrayElement(checker, target)`, `wellKnownArguments(checker, wellKnown.map, value)` / `wellKnownArguments(checker, wellKnown.map, target)`, `tupleElements(value)?.[index]` / `tupleElements(target)?.[index]`, and `checker.fieldsOf(form.type)` / `checker.fieldsOf(to)`.
  - In `computation/index.ts:109–166`, `Computation.#own(node: Expression)` dispatches over `Expression['kind']` using a `switch (node.kind)` with `default: return refused(node)` instead of an exhaustive `Handlers` table (`foundation/structures/kind-table.ts`), violating the one-way rule in `docs/reuse/structures-and-invariants.md`.
- proposal: Use `partPairs` (`types/fitting/part-pairs.ts`) in `computation/forms.ts:partsForm` to obtain the `[fromPart, toPart]` type pairs, and replace the `switch (node.kind)` + `default` in `computation/index.ts` with `Handlers`.
- confidence: high

### [med] Re-implementations of `docs/reuse` units across `rules/` (`awaits`, `sameMembers`, `sameEntries`, `addToGroup`, `isDeclaredStruct`, `TypeCycle`, `Annotations`, `substitutionOf`)
- where:
  - `src/compiler/checker/rules/lifetimes/lifetimes.ts:307`, `src/compiler/checker/rules/lifetimes/analysis/index.ts:230–234`, `src/compiler/checker/rules/lifetimes/analysis/operations.ts:141, 191`
  - `src/compiler/checker/rules/lifetimes/dispatch.ts:79–80, 133–138, 254–264`, `src/compiler/checker/rules/lifetimes/type-reach.ts:143–156, 218–223, 236–263`, `src/compiler/checker/rules/lifetimes/groups.ts:88–97`, `src/compiler/checker/rules/lifetimes/analysis/flow-state.ts:156–166`
  - `src/compiler/checker/rules/kinds/data-kinds.ts:212–215`, `src/compiler/checker/rules/lifetimes/analysis/nodes.ts:206–207, 398–403`
  - `src/compiler/checker/rules/lifetimes/facts.ts:61–65`, `src/compiler/checker/rules/lifetimes/externs.ts:125–157`, `src/compiler/checker/rules/testing.ts:99–102`, `src/compiler/checker/rules/computation/index.ts:287–290`
- evidence:
  - **`awaits`**: `docs/reuse/syntax-and-trees.md` states `"whether a head is async (read it nowhere else) → awaits (src/compiler/syntax/tokens/modifiers.ts)"`. Yet `lifetimes.ts:307`, `analysis/index.ts:232`, and `analysis/operations.ts:141, 191` are the only places in the repo outside `modifiers.ts` that read `.qualifiers.async !== undefined` directly.
  - **`sameMembers` / `sameEntries` / `sameItems`**: `dispatch.ts:79–80` and `type-reach.ts:218–223` (`sameHandles`) re-implement `sameMembers` (`first.size === second.size && [...first].every((each) => second.has(each))`); `dispatch.ts:254–264` (`sameWitnesses`) and `groups.ts:88–97` (`sameGroupAnalyses`) re-implement `sameEntries`; `flow-state.ts:156–166` (`sameSettled`) re-implements `sameItems(sameProperties)`.
  - **`addToGroup`**: `docs/reuse/structures-and-invariants.md` states `"A group is filled in place (addToGroup, Map.groupBy), never copied to append one item ([...group, item]), which makes filling it quadratic"`. Four places in `rules/` violate this: `data-kinds.ts:214` (`calls.set(site, [...(calls.get(site) ?? []), call])`), `dispatch.ts:136` (`witnesses.set(position, [...(witnesses.get(position) ?? []), call])`), `analysis/nodes.ts:207` (`this.#pathsByRoot.set(root, [...siblings, node])`), and `analysis/nodes.ts:401` (`ending.set(at, [...(ending.get(at) ?? []), value])`).
  - **`isDeclaredStruct`**: `facts.ts:62–63` writes `declaration?.kind === 'StructDeclaration' || declaration?.kind === 'SharedStructDeclaration'` instead of `isDeclaredStruct` (`syntax/declarations/index.ts`).
  - **`TypeCycle`**: `docs/reuse/types-and-fitting.md` states `"guard a recursive walk over a type's parts ... against cycles → TypeCycle ... never a visited set of your own"`. `type-reach.ts:143–156` (`innerOf`) and `236–263` (`topHandlesOf`) both roll their own `const seen = new Set<string>(); const key = checker.typeKeys.typeKey(...)`.
  - **`Annotations`**: `lifetimes/externs.ts:125–157` (`annotationNamed`, `textOf`) manually looks up `checker.wellKnownEntity(wellKnown[name])`, matches `annotation.type.entity === entity`, and extracts string primitives, duplicating `Annotations.knownOf` and `Annotations.#textOf` (`rules/annotations.ts:60–68, 120–126, 152–156`), which already registers `holds` and `keeps` in `known`.
  - **`substitutionFor` / `substitutionOf`**: `testing.ts:99–102` and `computation/index.ts:287–290` wrap `declaration.typeParameters` in `typeParametersOf(...)` before calling `substitutionFor`, even though `substitutionFor` (`types/parts/substitution.ts:41`) already calls `typeParametersOf` and `substitutionOf` (`surface/witness-closing.ts:56`) already takes `{ declaration, typeArguments }`.
- proposal: Replace each hand-rolled copy with the existing helper from `modifiers.ts`, `equality.ts`, `groups.ts`, `declarations/index.ts`, `type-cycle.ts`, `annotations.ts`, and `witness-closing.ts`.
- confidence: high

### [med] Dead `Label`/`anyField` scaffolding, test-only `Lifetimes.findingsOf` / `LifetimeFinding.declaration`, and duplicate violation deduplication in `lifetimes/`
- where: `src/compiler/checker/rules/lifetimes/summary.ts:21, 41–53, 98, 239, 254`, `src/compiler/checker/rules/lifetimes/analysis/body.ts:53, 88, 284, 354–379`, `src/compiler/checker/rules/lifetimes/analysis/summarize.ts:138, 155, 159`, `src/compiler/checker/rules/lifetimes/analysis/unseen.ts:116`, `src/compiler/checker/rules/lifetimes/finding.ts:19–26`, `src/compiler/checker/rules/lifetimes/lifetimes.ts:150–186`, `src/compiler/checker/rules/lifetimes/lifetimes.test-kit.ts:39`
- evidence:
  - `Label` and `anyField` (`summary.ts:41–45`) are attached to every `Effect` and `Requirement` across 4 files (`summary.ts`, `body.ts`, `summarize.ts`, `unseen.ts`), with banner note `"Every pair carries a field label, always anyField: labels aren't built"`. Nothing in the codebase ever reads `.label`, not even `sameEffects` or `sameRequirements`.
  - `LifetimeFinding` (`finding.ts:19–26`) defines `readonly declaration: FindingDeclaration`, which `Violation` (`body.ts:64`) immediately strips via `Omit<LifetimeFinding, 'declaration'>`, and `Lifetimes.findingsOf` (`lifetimes.ts:150–154`) re-attaches. `Lifetimes.findingsOf` has 0 non-test callers; its sole caller `lifetimes.test-kit.ts:39` ignores `declaration` and reads only `{ site, kind }`, which are already encoded 1-to-1 in `checker.diagnosticsOf(module)` via codes `5720..5724` (`diagnostics/lifetimes.ts:74–108`).
  - `BodyAnalysis.violate` (`body.ts:363–369`) and `Lifetimes.#violationsOf` (`lifetimes.ts:169–185`) both construct `new Map<NodeOf<string>, Map<string, Violation>>()` keyed by `` `${kind}:${keyOf(holderType)}` `` and flatten it with `[...found.values()].flatMap((at) => [...at.values()])` (with `body.ts` keeping the first violation per key and `lifetimes.ts` overwriting with the last).
- proposal: Delete `Label`, `anyField`, and `.label` on `Effect` and `Requirement`; replace `LifetimeFinding` with `Violation`, derive `findingsIn` (`lifetimes.test-kit.ts`) from `checker.diagnosticsOf(module)`, delete `Lifetimes.findingsOf`, and factor `Violation` deduplication into one helper.
- confidence: high

### [med] Duplicate written-field and field-owner extraction across `rules/annotations.ts`, `rules/expansion/types.ts`, and `types/properties/value-kinds.ts`
- where: `src/compiler/checker/rules/annotations.ts:214–222, 373–390`, `src/compiler/checker/rules/expansion/types.ts:116–124`, `src/compiler/checker/types/properties/value-kinds.ts:269–282`, `src/compiler/checker/types/written/declared-fields.ts:28–55`
- evidence:
  - `expansion/types.ts:116–124` (`writtenFieldsOf`) and `types/properties/value-kinds.ts:269–274` (`writtenPartsOf`) contain identical logic to extract `DeclaredField`s from a `DeclaredStruct | EnumDeclaration`:
    ```ts
    const fields =
      declaration.kind === 'EnumDeclaration'
        ? declaration.variants.flatMap((variant) =>
            variant.kind === 'Variant' ? variant.fields : [],
          )
        : declaration.fields;
    ```
  - `annotations.ts:373–390` (`declaresField`) switches on `StructDeclaration | SharedStructDeclaration | EnumDeclaration | TraitDeclaration` to find which top-level declaration owns a field node, and then `#fieldPlace` (`annotations.ts:220`) calls `declaredFieldOf(checker, module, owner, node as Field)` (`types/written/declared-fields.ts:28`), which switches on the exact same `owner.kind` cases a second time to find the `FieldMember` with `declared.node === node`.
- proposal: Put `writtenFieldsOf(declaration: DeclaredStruct | EnumDeclaration): readonly DeclaredField[]` in `src/compiler/syntax/declarations/index.ts` and call it from `expansion/types.ts` and `value-kinds.ts`; and add `declaredFieldInModule(checker, module, node)` in `types/written/declared-fields.ts` (calling `declaredFieldOf` across `itemsOf(module)`) so `annotations.ts` drops `declaresField`.
- confidence: high

### [med] Signature kind & async future checks duplicated across `rules/kinds/signature-kinds.ts`, `rules/kinds/data-kinds.ts`, and `constructs/closures/lambdas.ts`
- where: `src/compiler/checker/rules/kinds/signature-kinds.ts:51–86`, `src/compiler/checker/rules/kinds/data-kinds.ts:297–338`, `src/compiler/checker/constructs/closures/lambdas.ts:325–332`, `src/compiler/checker/resolution/applying/call-kinds.ts:192–200`
- evidence:
  - Both `checkSignatureKind` (`signature-kinds.ts:57–60`) and `judgeNested` (`data-kinds.ts:323–326`) separately check `awaits(node.qualifiers) && node.returnType !== undefined ? [checker.resolveType(module, node.returnType)] : []` so an async function's written `Future<...>` return type is judged for data kinds.
  - Both `checkSignatureKind` (`signature-kinds.ts:70–72`) and `checkNested` (`lambdas.ts:329–331`) separately check `awaits(node.qualifiers)` against the function's kind and report `checkerDiagnostics.unkindedFuture`.
  - Function holder naming (`node.kind === 'Lambda' ? 'a lambda' : `'${declaredFunctionName(node)}'`) is repeated across `data-kinds.ts:95, 305`, `signature-kinds.ts:81`, `call-kinds.ts:192–200` (`callerName`), and `function-kinds.ts:144–155` (`kindHolderName`).
- proposal: Share the signature-held types and `unkindedFuture` check in `signature-kinds.ts` for both top-level and nested functions, and use one function-holder naming helper across `signature-kinds.ts`, `data-kinds.ts`, and `call-kinds.ts`.
- confidence: high

### [low] `JsonForms` wrapper & literal form duplication in `rules/boundary/json-forms.ts` (and unreachable non-union branch in `Encoder.#literal`)
- where: `src/compiler/checker/rules/boundary/json-forms.ts:149, 176–178, 196–199, 307–338`, `src/compiler/lowering/synthesized/boundary/encoder.ts:79–86`
- evidence:
  - `JsonForms.callOf` (`json-forms.ts:176`) is a 1-line forwarding wrapper around `#jsonCall` (`json-forms.ts:307`), which has only one other caller (`line 149`). Widening `callOf`'s parameter from `CodecHelper` to `CodecName` eliminates `#jsonCall`.
  - `JsonForms.#form` (`json-forms.ts:196–199`) builds `{ kind: 'literals', type, groups: [{ base: baseOf(type), literals: [type] }] }` for `case 'literal':` and calls `literalsForm(type)` (`lines 321–338`) for `case 'union':`. Using `membersOf(type)` (`types/type/index.ts`) in `literalsForm` handles both `literal` and `union` in one function.
  - For any lone `LiteralType`, `chooseWitnessAmong` (`resolution/conformance/declared-witness.ts:73`) widens a by-value `LiteralType` parameter to `baseOf(each)` and finds `json.ista`'s declared `toJson(self: Int | String | Bool)`, so `_toJson<T>` is never derived for a lone literal type and the non-union branch `: write({ register: value, type })` in `Encoder.#literal` (`encoder.ts:85`) is unreachable dead code.
- proposal: Inline `#jsonCall` into `callOf(name: CodecName, ...)`, unify `case 'literal'` and `case 'union'` in `literalsForm` via `membersOf(type)`, and remove the unreachable non-union branch in `Encoder.#literal`.
- confidence: high

### [low] Duplicate `references` parameter-set construction in `lifetimes/lifetimes.ts` and `lifetimes/declared.ts`
- where: `src/compiler/checker/rules/lifetimes/lifetimes.ts:302–309`, `src/compiler/checker/rules/lifetimes/declared.ts:103–112`, `src/compiler/checker/rules/flow/build/parts.ts:38–51`
- evidence: Both `Lifetimes.#ownAnalysis` (`lifetimes.ts:302–305`) and `defaultsFound` (`declared.ts:103–106`) query `checker.parametersOf(declaration)` and build `const references = new Set(flow.parameters.filter((_, index) => parameters[index]?.reference === true))` to pass into `analyze(context, flow, { ..., references })`, even though `bindParameters` (`flow/build/parts.ts:38`) already receives `parameters: readonly SignatureParameter[]` when constructing `FlowFunction`.
- proposal: Record reference parameters on `FlowValue` (alongside `inCell`) or `FlowFunction` in `bindParameters` (`flow/build/parts.ts`), eliminating the duplicate `parametersOf` lookup in `lifetimes.ts` and `declared.ts` and removing `references` from `AnalyzeOptions` and `BodyAnalysis`.
- confidence: high

### [low] 18 exported types/interfaces in `src/compiler/checker/rules/` have zero importers across the repository
- where:
  - `src/compiler/checker/rules/agreement.ts:73, 211` (`Agreement`, `Agreed`)
  - `src/compiler/checker/rules/annotations.ts:73, 120` (`AnnotationSeams`, `Annotations.knownOf`)
  - `src/compiler/checker/rules/boundary/json-forms.ts:86` (`JsonFormSeams`)
  - `src/compiler/checker/rules/computation/index.ts:56` (`ComputationScope`)
  - `src/compiler/checker/rules/flow/build/chains.ts:19` (`ChainFrame`)
  - `src/compiler/checker/rules/flow/build/implicit-calls.ts:15` (`CallSite`)
  - `src/compiler/checker/rules/flow/build/places.ts:22, 73` (`EnteredPlace`, `AssignedPlace`)
  - `src/compiler/checker/rules/flow/build/scopes.ts:18` (`Releasing`)
  - `src/compiler/checker/rules/lifetimes/analysis/body.ts:67, 75` (`NestedResult`, `Written`)
  - `src/compiler/checker/rules/lifetimes/analysis/calls.ts:37` (`CallMade`)
  - `src/compiler/checker/rules/lifetimes/analysis/index.ts:44` (`AnalyzeOptions`)
  - `src/compiler/checker/rules/lifetimes/analysis/nodes.ts:54` (`ReadKind`)
  - `src/compiler/checker/rules/lifetimes/analysis/places.ts:25` (`PlaceTarget`)
  - `src/compiler/checker/rules/lifetimes/declared.ts:45` (`DeclaredDeps`)
  - `src/compiler/checker/rules/lifetimes/dispatch.ts:37` (`Conversion`)
  - `src/compiler/checker/rules/lifetimes/escaping.ts:22` (`EscapingFacts`)
  - `src/compiler/checker/rules/lifetimes/type-reach.ts:107` (`Unknown`)
  - `src/compiler/checker/rules/open-agreement.ts:24` (`Producers`)
- evidence: Verified across all `.ts` files in `src/` and `test/`: none of these 18 exported types/interfaces is imported anywhere, and `Annotations.knownOf` has no callers outside `Annotations`.
- proposal: Remove `export` from these 18 file-local types/interfaces.
- confidence: high

## Missing from docs/reuse
- `blockTail` (`src/compiler/checker/rules/agreement.ts`, 3 callers outside folder: `lambdas.ts`, `branches.ts`, `body-checker.ts`) — missing from `docs/reuse/types-and-fitting.md` (which lists `producedBy`, `agreedType`, `settleAgreement`, `decidedSoFar`, `fitProduced`, `settleProduced`, `wholeWidened`).
- `agreedDefault`, `Agreeing` (`src/compiler/checker/rules/open-agreement.ts`, called by `constructs/expressions/collections/joining-literals.ts`) — missing from `docs/reuse/types-and-fitting.md` (which lists only `openAgreement`).
- `placeholderOf`, `freshLiteralOf` (`src/compiler/checker/rules/placeholders.ts`, 3 callers outside folder: `postponed.ts`, `structs.ts`, `body-checker.ts`) — `placeholders.ts` is not listed in `docs/reuse/*.md`.
- `Annotations` (`of`, `ofField`, `jsonNameOf`, `waypointOf`, `suiteTitleOf`, `fieldHas`, `checkFields`, `bodyOf` in `src/compiler/checker/rules/annotations.ts`, 8 callers outside folder) — `annotations.ts` is not listed in `docs/reuse/*.md`.
- `checkTestingCalls`, `checkSuite` (`src/compiler/checker/rules/testing.ts`, 2 callers outside folder: `body-checker.ts`, `declarations.ts`) — `testing.ts` is not listed in `docs/reuse/*.md`.
- `recordOutcomeCodecs` (`src/compiler/checker/rules/boundary/outcome-codecs.ts`, called by `body-checker.ts`) — `outcome-codecs.ts` is not listed in `docs/reuse/*.md`.
- `JsonForms` (`formOf`, `derivedOf`, `skippedDefaultOf`, `codecOf`, `callOf` in `src/compiler/checker/rules/boundary/json-forms.ts`, 7 callers outside folder) — `docs/reuse/calls-and-resolution.md` mentions `CheckerContext.json.skippedDefaultOf`, but `JsonForms` and its `formOf`/`derivedOf`/`codecOf`/`callOf` methods are not listed in `docs/reuse/types-and-fitting.md`.
- `computeConstant`, `refusalOf` (`src/compiler/checker/rules/computation/index.ts`, 2 callers outside folder: `constants.ts`, `annotations.ts`) — `computation/index.ts` is not listed in `docs/reuse/*.md`.
- `disposeCandidates`, `checkDisposeDeclaration`, `checkDisposeUses` (`src/compiler/checker/rules/disposal/disposal.ts`, 3 callers outside folder: `program-disposals.ts`, `declarations.ts`, `body-checker.ts`) — missing from `docs/reuse/types-and-fitting.md` (which lists only `isDisposable`, `disposalOf`, `isDisposeFunction`).
- `checkDropped` (`src/compiler/checker/rules/disposal/dropped.ts`, called by `body-checker.ts`) — `dropped.ts` is not listed in `docs/reuse/*.md`.
- `Expansion` (`src/compiler/checker/rules/expansion/functions.ts`, 2 callers outside folder) and `TypeExpansion` (`src/compiler/checker/rules/expansion/types.ts`, 1 caller outside folder) — missing from `docs/reuse/types-and-fitting.md` (which lists `edges.ts` and `type-matches.ts`).
- `reachedBlocks` (`src/compiler/checker/rules/flow/solve.ts`, called by `lifetimes/analysis/index.ts`) — missing from `docs/reuse/types-and-fitting.md` (which lists `runForward`, `ForwardRule`).
- `checkDataKinds`, `checkConstantKinds`, `checkDeclaredKinds` (`src/compiler/checker/rules/kinds/data-kinds.ts`, called by `declarations.ts`) and `checkSignatureKind`, `checkNamedMark`, `heldKindRefusal` (`src/compiler/checker/rules/kinds/signature-kinds.ts`, called by `declarations.ts`, `lambdas.ts`, `data-kinds.ts`) — neither file in `rules/kinds/` is listed in `docs/reuse/*.md`.
- `Lifetimes` (`check`, `reachesDisposable` in `src/compiler/checker/rules/lifetimes/lifetimes.ts`, 2 callers outside folder: `program-checker.ts`, `module-checks.ts`) — `lifetimes.ts` is not listed in `docs/reuse/*.md`.
