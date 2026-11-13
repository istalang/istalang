## src/compiler/checker/rules/agreement.ts — Type agreement across producers of one value (branches, returns, collection items)
- Produced — producer record: produced type, span, value site, and whether it is an items literal; [exp]; callers: 7 outside folder
- producedBy(node, type) — build a Produced record for a checked expression; [exp]; callers: 5 outside folder
- blockTail(body, type) — build a Produced record for a block's tail expression or trailing unit; [exp]; callers: 3 outside folder
- Agreement — agreed type (if any) and the subset of producers that disagree; [exp]; callers: 0 outside folder
- agreedType(produced, checker, expected?) — compute the type producers agree on and which ones disagree; [exp]; callers: 2 outside folder
- joinedAgreement(produced, checker) — compute common type of non-Never producers when no expected type is given; callers: 0 outside folder
- rebuiltAgreement(produced, checker) — find first producer type with inner literals widened that all producers fit; callers: 0 outside folder
- wholeWidened(decided, produced, checker) — widen inner literals (or whole type) for producers like field comprehensions; [exp]; callers: 1 outside folder
- insideWidened(type, checker) — widen literal types inside child parts of a type, preserving union members; callers: 0 outside folder
- agreesOrConverts(checker, produced, decided) — test whether a producer agrees with or (if an items literal) converts into decided; callers: 0 outside folder
- settleAgreement(context, produced, expected, mismatch) — compute agreed type and fit or report each disagreeing producer; [exp]; callers: 2 outside folder
- Agreed — bundle of decided type, expected type, and mismatch diagnostic factory; [exp]; callers: 0 outside folder
- settleProduced(context, produced, agreed) — fit or report a single producer against an agreed type; [exp]; callers: 2 outside folder
- fitProduced(context, produced, expected) — fit a producer's type to expected at its value site; [exp]; callers: 1 outside folder
- decidedSoFar(context, produced) — compute widened type agreed by non-None producers so far to guide later ones; [exp]; callers: 2 outside folder

## src/compiler/checker/rules/annotations.ts — Compile-time struct annotations on fields, functions, structs, and statements (§3.16)
- AnnotationSeams — checker context and expression value-checking callback for Annotations; [exp]; callers: 0 outside folder
- Annotations — program-wide table checking and querying compile-time annotations on items and fields; [exp]; callers: 2 outside folder
- Annotations.of(module, item, place) — check and return annotations on an item at a placement; [exp]; callers: 6 outside folder
- Annotations.bodyOf(module, annotation) — return CheckedBody of an annotation's value expression; [exp]; callers: 1 outside folder
- Annotations.knownOf(annotation) — identify which well-known toolchain annotation a CheckedAnnotation is; [exp]; callers: 0 outside folder
- Annotations.ofField(field) — check and return annotations on a struct or variant field declaration; [exp]; callers: 1 outside folder
- Annotations.jsonNameOf(field) — return a field's @JsonName string or its declared name; [exp]; callers: 1 outside folder
- Annotations.waypointOf(module, statement) — return a statement's @Waypoint name if present; [exp]; callers: 1 outside folder
- Annotations.suiteTitleOf(module, declaration) — return a function's @Suite title if present; [exp]; callers: 2 outside folder
- Annotations.#textOf(annotations, name) — extract the first string field of a named known annotation; callers: 0 outside folder
- Annotations.fieldHas(field, name) — test whether a field carries a specific known annotation; [exp]; callers: 1 outside folder
- Annotations.checkFields(fields) — check field annotations and report duplicate JSON field names; [exp]; callers: 1 outside folder
- Annotations.#check(module, item, place) — evaluate, validate placement/uniqueness, and collect annotations on an item; callers: 0 outside folder
- Annotations.#fieldPlace(module, node) — find the owning declaration of a field node and resolve its declared type; callers: 0 outside folder
- Annotations.#problem(annotation, found, place, isStd) — return a diagnostic if an annotation is duplicated, misplaced, or generic; callers: 0 outside folder
- Annotations.#value(module, node) — check an annotation expression as a struct and evaluate it via computeConstant; callers: 0 outside folder
- placements — per-known-annotation placement and target-type validation rules; callers: 0 outside folder
- placeText(place) — format an annotation placement kind for diagnostics; callers: 0 outside folder
- declaresField(item, node) — test whether a top-level struct, enum, or trait declares a given field node; callers: 0 outside folder

## src/compiler/checker/rules/boundary/host-boundary.ts — Host extern JSON boundary and sendability checks (§3.6, §9)
- checkHostBoundary(checker, module, node) — verify host extern parameters are non-& Encodable and results/constants are Decodable; [exp]; callers: 1 outside folder
- crossesToHost(checker, site, type, direction) — check and report whether a type meets Encodable/Decodable at a host site; [exp]; callers: 1 outside folder

## src/compiler/checker/rules/boundary/json-forms.ts — Derived JSON codec forms and Encodable/Decodable witness derivation (§9)
- JsonFormSeams — checker and Annotations dependencies for JsonForms; [exp]; callers: 0 outside folder
- JsonForms — program-wide derived JSON forms and codec call resolution; [exp]; callers: 1 outside folder
- JsonForms.formOf(type) — return the DerivedForm of a type for codec code generation; [exp]; callers: 1 outside folder
- JsonForms.#formOf(type) — memoize a type's FormOrNone by its unaliased spelled key; callers: 0 outside folder
- JsonForms.derivedOf(site, type, direction) — derive an Encodable/Decodable witness call or explain what part lacks one; [exp]; callers: 1 outside folder
- JsonForms.skippedDefaultOf(type) — find the Default witness used for an @JsonSkip field; [exp]; callers: 1 outside folder
- JsonForms.#partMissing(site, form, direction) — find the first part of a DerivedForm that fails to meet the codec trait; callers: 0 outside folder
- JsonForms.codecOf(type, direction) — resolve the Encodable or Decodable witness call for a type; [exp]; callers: 4 outside folder
- JsonForms.callOf(name, typeArguments) — resolve a call to a json module codec helper function; [exp]; callers: 3 outside folder
- JsonForms.#form(type) — compute the FormOrNone for any Type by kind; callers: 0 outside folder
- JsonForms.#nominal(type) — compute the FormOrNone for a nominal struct, enum, shared struct, or extern type; callers: 0 outside folder
- JsonForms.#opaque(type) — decide whether an extern or shared struct crosses as a host JSON form or lacks one; callers: 0 outside folder
- JsonForms.#declaresCodecs(type) — test whether a nominal type declares a custom toJson or fromJson witness; callers: 0 outside folder
- JsonForms.#enum(type) — build an enum's DerivedForm or refuse if a variant field collides with variantTagKey; callers: 0 outside folder
- JsonForms.#field(field) — build a JsonField with @JsonName, @JsonSkip default, optionality, and @JsonBigInt codecs; callers: 0 outside folder
- JsonForms.#jsonCall(name, typeArguments) — resolve a silent call to a json module function with explicit type arguments; callers: 0 outside folder
- literalsForm(union) — group a literal-only union's members by their base primitive type; callers: 0 outside folder
- partsOf(form) — list the child types a derived codec encodes or decodes for conformance checking; callers: 0 outside folder

## src/compiler/checker/rules/boundary/outcome-codecs.ts — Recording outcome encoders for extern calls returning Instance<R> (§9)
- recordOutcomeCodecs(context, calls) — record implicit encodeOutcome codec calls on extern calls returning Instance<R>; [exp]; callers: 1 outside folder

## src/compiler/checker/rules/computation/forms.ts — ConstantForm conversions and spread helpers for compile-time evaluation
- Outcome — result of compile-time evaluation: computed ConstantForm, refused node/reason, or unknown; [exp]; callers: 0 outside folder
- unknown — singleton unknown Outcome for expressions already in error; [exp]; callers: 0 outside folder
- computed(form) — wrap a ConstantForm in a computed Outcome; [exp]; callers: 0 outside folder
- refused(part) — build a refused Outcome at an non-computable AST node; [exp]; callers: 0 outside folder
- fittedForm(form, from, fit, checker) — apply a checker Fit (conversion + union member wrap) to a ConstantForm; [exp]; callers: 0 outside folder
- convertedForm(typed, conversion, checker) — apply a non-union Fit conversion (base, tupled, untupled, shape, parts) to a form; callers: 0 outside folder
- partsForm(typed, to, checker) — recursively convert a union member, array, map, tuple, or struct ConstantForm part by part; callers: 0 outside folder
- structForm(form, to, checker) — convert a struct ConstantForm field by field into a target struct or shape type; callers: 0 outside folder
- allFitted(forms, fromAt, toAt, checker) — fit every element/field ConstantForm in a list to its target part type; callers: 0 outside folder
- fittedPart(typed, to, checker) — look up fitOf between part types and apply fittedForm to one part; callers: 0 outside folder
- itemsOf(form) — extract spread items from a computed array or map ConstantForm; [exp]; callers: 0 outside folder
- pairOf(item) — extract a [key, value] ConstantForm pair from a 2-element tuple form; [exp]; callers: 0 outside folder

## src/compiler/checker/rules/computation/index.ts — Compile-time evaluation of top-level constants and annotations (§3)
- ComputationScope — checker, CheckedBody, and constant lookup callbacks for compile-time evaluation; [exp]; callers: 0 outside folder
- computeConstant(initializer, scope) — evaluate a constant or annotation initializer to a ConstantForm or refusal; [exp]; callers: 2 outside folder
- refusalOf(outcome, notConstant) — build the diagnostic for a refused compile-time constant or endless field default; [exp]; callers: 2 outside folder
- Computation.of(node) — evaluate an expression node and apply any recorded implicit fit conversion; callers: 0 outside folder
- Computation.#own(node) — evaluate an expression node before implicit conversions by syntax kind; callers: 0 outside folder
- Computation.#fitted(node, form) — apply the body's recorded Fit at node to a computed ConstantForm; callers: 0 outside folder
- Computation.#lambda(node) — compute a captureless top-level lambda as a function ConstantForm or refuse; callers: 0 outside folder
- Computation.#struct(node) — compute a struct literal's fields in declaration order and lay them out in name order; callers: 0 outside folder
- Computation.#field(literal, source, earlier) — compute one struct literal field from its value, spread, or default; callers: 0 outside folder
- Computation.#default(call, earlier) — evaluate a struct field's default expression with cycle detection; callers: 0 outside folder
- Computation.#defaultValue(call, value, checked, earlier) — instantiate and evaluate a field default with earlier fields bound; callers: 0 outside folder
- Computation.#spreadField(source) — evaluate a spread struct expression and project one field by index; callers: 0 outside folder
- Computation.#tuple(elements) — evaluate tuple elements into a tuple ConstantForm (or null for unit ()); callers: 0 outside folder
- Computation.#array(node) — evaluate an array literal (or empty map []) and its spreads into a ConstantForm; callers: 0 outside folder
- Computation.#map(node) — evaluate a Map literal and its spreads with duplicate-key replacement; callers: 0 outside folder
- Computation.#entry(entry) — evaluate one MapEntry or Spread in a map literal; callers: 0 outside folder
- Computation.#items(spread) — evaluate a spread operand and verify it is an un-wrapped array or map; callers: 0 outside folder
- Computation.#qualified(node) — evaluate a namespace-qualified constant or bare fieldless struct; callers: 0 outside folder
- Computation.#bareStruct(node) — evaluate a bare or type-applied fieldless nominal struct to an empty struct form; callers: 0 outside folder

## src/compiler/checker/rules/disposal/disposal.ts — Disposability, dispose lookup, and dispose declaration/call rules (§7)
- isDisposable(checker, type) — test whether a type is a handle with a dispose or constrained by a trait requiring dispose; [exp]; callers: 2 outside folder
- disposalOf(checker, type, found) — resolve the runtime or function Disposal for a nominal type from its candidates; [exp]; callers: 1 outside folder
- disposeKindsOf(checker, type, found) — collect the instantiated function marks of dispose candidates taking type; [exp]; callers: 1 outside folder
- isDisposeFunction(checker, declaration) — test whether a function declaration is a user-defined top-level dispose; [exp]; callers: 2 outside folder
- isOwnedHandle(checker, type) — test whether a nominal type is a confined shared struct or host handle eligible for user dispose; callers: 0 outside folder
- runtimeDisposes(checker, type) — test whether a std module declares an extern dispose for a nominal type; callers: 0 outside folder
- DisposeCandidates — candidate dispose functions for a nominal type and whether they are runtime-owned; [exp]; callers: 1 outside folder
- disposeCandidates(checker, type) — look up runtime or ADL dispose candidates for a nominal type; [exp]; callers: 1 outside folder
- checkDisposeDeclaration(checker, declaration) — validate a user dispose function's signature, target type, lookup, and self uses; [exp]; callers: 1 outside folder
- checkSelfStays(checker, declaration, self) — verify that a dispose function's self parameter is only dereferenced or passed to externs; callers: 0 outside folder
- checkDisposeUses(context, calls, mockTargets) — report any direct call or function-value reference to dispose outside mock(); [exp]; callers: 1 outside folder

## src/compiler/checker/rules/disposal/dropped.ts — Forward dataflow check for uses of variables after drop (§7)
- checkDropped(context, flow) — run forward flow analysis to report variables used after drop; [exp]; callers: 1 outside folder
- DroppedUses.run(flow, entry) — solve forward dropped-variable sets across a FlowFunction; callers: 0 outside folder
- DroppedUses.#operation(flow, operation, dropped) — check variable uses in an operation, recurse into closures, and update dropped set; callers: 0 outside folder
- DroppedUses.#report(name) — report a droppedVariableUsed diagnostic once per identifier node; callers: 0 outside folder
- droppedAfter(flow, operation, dropped) — add dropped variables on drop release and remove reassigned or scope-released ones; callers: 0 outside folder
- usesOf(operation) — list [ValueId, site] pairs read or referenced as places by an operation; callers: 0 outside folder
- without(dropped, variable) — return a Dropped set with a reassigned or re-declared variable removed; callers: 0 outside folder

## src/compiler/checker/rules/disposal/must-use.ts — Must-use discarded value check and drop statement validation (§3.3, §3.12, §7)
- checkDiscarded(context, node, type) — report a discarded statement value if it holds a Future, Result, or disposable; [exp]; callers: 2 outside folder
- checkDrop(context, node) — check a drop statement's expression and verify any named variable is droppable; [exp]; callers: 1 outside folder
- undroppable(context, entity) — explain why a variable (local fn, top-level const, capture, & param) cannot be dropped; callers: 0 outside folder
- mustUseAs(context, type) — determine how a type holding a Future, Result, or disposable must be used; callers: 0 outside folder

## src/compiler/checker/rules/expansion/edges.ts — Generic expansion graph and Tarjan SCC cycle check (§3.5)
- ArgumentEdge — expansion graph edge between two type parameters with an expanding flag; [exp]; callers: 0 outside folder
- argumentEdges(own, parameters, typeArguments) — build ArgumentEdges from own type parameters appearing in typeArguments; [exp]; callers: 0 outside folder
- endlessEdgesFrom(roots, edgesOf, targetOf) — find all expanding edges that lie on a strongly connected cycle reachable from roots; [exp]; callers: 0 outside folder

## src/compiler/checker/rules/expansion/functions.ts — Endless generic function instantiation cycle check (§3.5)
- Expansion — program-wide generic function call expansion checker with incremental entry tables; [exp]; callers: 2 outside folder
- Expansion.check(module) — report all calls in a module's generic functions that cause endless instantiation; [exp]; callers: 1 outside folder
- Expansion.#report(caller, module) — match a caller's endless edges back to call sites and report each once; callers: 0 outside folder
- sitedEdges(checker, caller) — collect ArgumentEdges with call sites from a generic function's body and defaults; callers: 0 outside folder

## src/compiler/checker/rules/expansion/type-matches.ts — Endless type match alias reduction cycle check (§3.5, §3.17)
- TypeMatchExpansion — expansion checker for recursive type match aliases; [exp]; callers: 1 outside folder
- TypeMatchExpansion.isEndless(alias) — test and report whether a type match alias's reductions expand endlessly; [exp]; callers: 2 outside folder
- reductionEdges(matches, alias) — build ReductionEdges from unreduced type match uses in an alias's case types; callers: 0 outside folder
- caseReading(own, subject, pattern, variables) — map a type match case's pattern and infer variables to subject type parameters; callers: 0 outside folder
- matchedParts(pattern, subject) — pair a case pattern type and its tuple elements with the corresponding subject parts; callers: 0 outside folder
- partsOf(argument, reading, whole) — find declaring type parameters an argument is built from and whether it grows; callers: 0 outside folder

## src/compiler/checker/rules/expansion/types.ts — Endless generic struct/enum field expansion cycle check (§3.5)
- FieldedDeclaration — union of DeclaredStruct and EnumDeclaration; [exp]; callers: 1 outside folder
- TypeExpansion — expansion checker for generic struct and enum declarations' written field types; [exp]; callers: 1 outside folder
- TypeExpansion.endlessFieldsOf(declaration) — return and report fields whose written types cause endless generic expansion; [exp]; callers: 1 outside folder
- TypeExpansion.#endlessFields(declaration) — compute endless fields via endlessEdgesFrom and report diagnostics; callers: 0 outside folder
- TypeExpansion.#fieldEdges(declaration) — build FieldEdges from nominal types mentioned in a declaration's written field types; callers: 0 outside folder
- writtenFieldsOf(declaration) — list DeclaredFields of a struct or all variants of an enum; callers: 0 outside folder

## src/compiler/checker/rules/flow/build/calls.ts — Building Flow IR for function calls, method calls, value calls, and deferred calls
- callFlow(builder, node) — emit Flow IR operations for a Call or DeferredCall and return its result ValueId; [exp]; callers: 0 outside folder
- unresolved(builder, node, into) — build compute/unknown operation for a fieldless variant call or unresolved call; callers: 0 outside folder
- calleeValue(builder, node) — emit Flow IR to evaluate a value call's callee (optional step, field read, or expression); callers: 0 outside folder
- inParameterOrder(builder, node, passed, given) — reorder value-call arguments into parameter order using the recorded binding; callers: 0 outside folder
- prepared(builder, node, call, references) — evaluate receiver and arguments in source order, entering places for & arguments; callers: 0 outside folder
- parametersOf(builder, call) — map argument indices to SignatureParameters for a resolved call; callers: 0 outside folder
- deferredFunction(builder, node) — evaluate a deferred call's immediate parts and build its closure ValueId; callers: 0 outside folder
- closureMaking(builder, node, values) — build a nested FlowFunction and closure make operation for a deferred call; callers: 0 outside folder
- isMade(builder, call) — test whether a deferred call (and any inner deferred call) was resolved by checking; callers: 0 outside folder
- computedNow(builder, call) — evaluate all values a deferred call captures when constructed; callers: 0 outside folder
- madeLater(later, call, captured) — emit the deferred call inside its nested FlowFunction using captured values; callers: 0 outside folder

## src/compiler/checker/rules/flow/build/chains.ts — Building Flow IR for optional chains (§4)
- ChainFrame — outer and newly opened OpenChain state around an expression; [exp]; callers: 0 outside folder
- openChain(builder, node) — join an active optional chain or open a new one if node is its outermost link; [exp]; callers: 0 outside folder
- closeChain(builder, node, frame, value) — copy a chain's final value into its result and join its end block; [exp]; callers: 0 outside folder
- stepTarget(builder, link, target) — evaluate a chain link's target, branching to chain end on none after ?.; [exp]; callers: 0 outside folder
- linksOf(builder, node) — collect all expressions belonging to the optional chain rooted at node; callers: 0 outside folder

## src/compiler/checker/rules/flow/build/control.ts — Building Flow IR for branching, logical/comparison operators, ?, !, await, and select
- ifFlow(builder, node) — emit Flow IR for an if expression, pruning branches ruled out by decided conditions; [exp]; callers: 0 outside folder
- guardedBranch(builder, branch, given) — emit condition evaluation and branch body for one if branch; callers: 0 outside folder
- matchFlow(builder, node) — emit Flow IR for a match expression's subject, pattern tests, guards, and case bodies; [exp]; callers: 0 outside folder
- isFlow(builder, node) — emit Flow IR for an is pattern test expression; [exp]; callers: 0 outside folder
- binaryFlow(builder, node) — emit Flow IR for comparisons, short-circuit and/or/??, or resolved binary operator calls; [exp]; callers: 0 outside folder
- chainedComparison(builder, node) — emit short-circuit Flow IR evaluating each operand of a chained comparison once; [exp]; callers: 0 outside folder
- compared(builder, link, operands, result) — emit equality compute or implicit compare/includes call for a comparison link; callers: 0 outside folder
- propagate(builder, node) — emit Flow IR for e?, branching to early-return Err or read Ok payload; [exp]; callers: 0 outside folder
- unwrap(builder, node) — emit Flow IR for e!, branching to panic on none or read inner value; [exp]; callers: 0 outside folder
- awaitFlow(builder, node) — emit onAwait call, suspend operation, and settled value read for await e; [exp]; callers: 0 outside folder
- givenBy(builder, site, future) — emit a read of the value a settled future gave at an await or select case; callers: 0 outside folder
- selectFlow(builder, node) — emit future evaluations, onAwait calls, optional suspend, and case branches for select; [exp]; callers: 0 outside folder
- valueInto(builder, result, body) — build a block and copy its tail value into a branching construct's result temporary; callers: 0 outside folder

## src/compiler/checker/rules/flow/build/expressions.ts — Exhaustive expression-kind table for building Flow IR
- named(builder, name, read) — emit Flow IR for an identifier or qualified member (function value, bare struct, variable, global); callers: 0 outside folder
- bareStruct(builder, node) — emit a fieldless struct make operation; callers: 0 outside folder
- memberAccess(builder, node) — emit Flow IR for a qualified name or struct field read; callers: 0 outside folder
- readPart(builder, node, part) — emit a part read operation on a member access or tuple element target; callers: 0 outside folder
- index(builder, node) — emit a keyed struct field read or container index call for a[k]; callers: 0 outside folder
- closureOf(builder, node) — build a nested FlowFunction for a lambda or local fn and emit its closure make operation; [exp]; callers: 0 outside folder
- bodyValue(builder, nested, node) — build the body expression or block of a nested lambda or local function; callers: 0 outside folder
- expressionFlows — exhaustive Handlers table mapping each Expression syntax kind to its Flow IR builder; [exp]; callers: 0 outside folder

## src/compiler/checker/rules/flow/build/flow-builder.ts — Mutable CFG and value builder for constructing a FlowFunction
- FlowInputs — checker bindings/parameters, module id, local body lookup, and CheckedBody for FlowBuilder; [exp]; callers: 0 outside folder
- Constructs — callbacks for building expressions, unfitted expressions, statements, and blocks; [exp]; callers: 0 outside folder
- OpenChain — active optional chain links, join block, and result temporary; [exp]; callers: 0 outside folder
- FlowBuilder — state machine constructing a FlowFunction's blocks, operations, variables, and temporaries; [exp]; callers: 0 outside folder
- FlowBuilder.inView(view, build) — temporarily switch CheckedBody view while building a field loop pass; [exp]; callers: 0 outside folder
- FlowBuilder.fit(node, value) — emit a conversion copy if checking recorded a different expected type at node; [exp]; callers: 0 outside folder
- FlowBuilder.finished(value) — close the final block with a return exit and assemble the immutable FlowFunction; [exp]; callers: 0 outside folder
- FlowBuilder.variable(entity) — get or allocate the FlowValue variable id for a body VariableEntity; [exp]; callers: 0 outside folder
- FlowBuilder.named(entity, type) — get or allocate a local variable or global FlowValue id for a VariableEntity; [exp]; callers: 0 outside folder
- FlowBuilder.captured(entity, type) — register a captured outer variable in a nested FlowBuilder; [exp]; callers: 0 outside folder
- FlowBuilder.capturedValue(type, site) — register a captured immediate value in a deferred call's nested FlowBuilder; [exp]; callers: 0 outside folder
- FlowBuilder.ownName(name, type) — register a local fn's or named lambda's self-reference variable; [exp]; callers: 0 outside folder
- FlowBuilder.valueAt(place) — emit copy and part-read operations to read the current value of a Place; [exp]; callers: 0 outside folder
- FlowBuilder.branch(count) — end the current block with a branch to count newly allocated blocks; [exp]; callers: 0 outside folder
- FlowBuilder.paths(paths) — run each callback in its own branch block and join them at a new block; [exp]; callers: 0 outside folder
- FlowBuilder.#live() — return the current open block or allocate a new unreachable block if already ended; callers: 0 outside folder

## src/compiler/checker/rules/flow/build/implicit-calls.ts — Emitting resolved and implicit protocol calls into Flow IR
- CallSite — call site node, passed arguments/values, and optional destination ValueId; [exp]; callers: 0 outside folder
- implicitCall(builder, role, at) — emit a Flow IR call operation for an ImplicitRole recorded at site; [exp]; callers: 0 outside folder
- resolvedCall(builder, call, at) — emit a Flow IR call operation for a ResolvedCall (or unknown if unresolved); [exp]; callers: 0 outside folder
- emitCall(builder, call, role, at) — shared implementation emitting call or unknown operation for resolved/implicit calls; callers: 0 outside folder

## src/compiler/checker/rules/flow/build/index.ts — Entry point and WeakMap cache for building a CheckedBody's FlowFunction
- FlowRoot — root Block or Expression and its SignatureParameters for building a FlowFunction; [exp]; callers: 2 outside folder
- flowOf(inputs, root, parameters?) — build and memoize the FlowFunction for a body root on its CheckedBody; [exp]; callers: 1 outside folder
- flowsBuiltFor(body) — return all FlowFunctions built for a CheckedBody during body checking; [exp]; callers: 2 outside folder
- computed(builder, node) — build an expression's Flow IR, stopping early if checking recorded a Never stop; callers: 0 outside folder
- constructs — root Constructs implementation wiring expression, statement, and block handlers; callers: 0 outside folder
- atSite(builder, node, value) — ensure an expression's result is in a temporary owned by node; callers: 0 outside folder

## src/compiler/checker/rules/flow/build/literals.ts — Building Flow IR for struct, collection, range, comprehension, and template literals
- structLiteral(builder, node) — evaluate struct literal items in source order, resolve defaults/spreads, and emit make; [exp]; callers: 0 outside folder
- evaluatedItems(builder, node) — evaluate field values, spreads, and struct comprehensions of a FieldsLiteral; callers: 0 outside folder
- fieldOf(builder, source, values) — look up an evaluated field value or emit a spread field read; callers: 0 outside folder
- structComprehension(builder, node) — emit a fieldLoop for a struct comprehension and collect its pass values; callers: 0 outside folder
- arrayLiteral(builder, node) — emit Flow IR for an array literal, empty map literal, or declared collection literal; [exp]; callers: 0 outside folder
- mapLiteral(builder, node) — emit Flow IR for a Map literal or a declared collection literal with entries; [exp]; callers: 0 outside folder
- spreadValue(builder, spread, isPack) — emit Flow IR for a call spread argument (pack/copied or iterated array); [exp]; callers: 0 outside folder
- itemOf(builder, element) — evaluate an array/map element or iterate a Spread through itemLoop; callers: 0 outside folder
- declaredLiteral(builder, node, entries) — emit default() and setIndex ('insert') calls for a custom collection literal; callers: 0 outside folder
- comprehension(builder, node) — emit an array make and targetsLoop appending each element of an array comprehension; [exp]; callers: 0 outside folder
- fieldComprehension(builder, node) — emit an array make and fieldLoop appending each element of a field comprehension; [exp]; callers: 0 outside folder
- range(builder, node) — evaluate range start, end, step, and optional inclusiveEnd call, then emit struct make; [exp]; callers: 0 outside folder
- template(builder, node) — emit tagged template call, constant text, or interpolate + join calls for a template; [exp]; callers: 0 outside folder

## src/compiler/checker/rules/flow/build/loops.ts — Building Flow IR for cursor loops and struct field loops
- itemLoop(builder, node, iterable, passes) — emit a cursor or copied-spread loop over an iterable value; [exp]; callers: 0 outside folder
- targetsLoop(builder, node, scope, body) — evaluate iterable, bind loop targets in a pass scope, and run body; [exp]; callers: 0 outside folder
- fieldLoop(builder, node, scope, pass) — evaluate struct subject and branch into each checked pass's view and scope; [exp]; callers: 0 outside folder
- loop(builder, scope, body) — create loop top/pass/exit blocks and wire break/continue exit targets; callers: 0 outside folder

## src/compiler/checker/rules/flow/build/parts.ts — Building Flow IR for parameter bindings, destructuring targets, and pattern matching
- Lifetime — scope lifetime of a bound variable (LabelledScope, 'function', or innermost scope); [exp]; callers: 0 outside folder
- bindParameters(builder, parameters) — register function parameters and destructure any parameter patterns; [exp]; callers: 0 outside folder
- bindTargets(builder, owner, value, lifetime?) — emit part reads and variable copies for a TargetOwner's bindings; [exp]; callers: 0 outside folder
- matchPattern(builder, pattern, subject, failed) — emit pattern tests branching to failed and bind matched pattern names; [exp]; callers: 0 outside folder
- readAlong(builder, from, path, site) — emit step reads and array-step implicit calls along a PartStep path; [exp]; callers: 0 outside folder
- offsetsOf(step) — return index offset arguments for an ArrayStep (length, item, rest); callers: 0 outside folder
- matchChecked(builder, checked, matching) — run all PatternTests of a CheckedPattern and bind its variables; callers: 0 outside folder
- testPart(builder, test, matching) — emit Flow IR for one PatternTest (never, or, compare, equal, variant, member, downcast); callers: 0 outside folder
- branchTo(builder, failed) — emit a 2-way conditional branch jumping to failed on the false path; callers: 0 outside folder
- patternValueOf(builder, value, site) — evaluate the right-hand PatternValue of an equal or compare pattern test; callers: 0 outside folder
- constant(builder, site) — emit a 0-operand compute operation for a synthesized literal or offset; [exp]; callers: 0 outside folder
- bind(builder, bindings, value, lifetime) — read each binding's path from value, copy into its variable, and declare it; callers: 0 outside folder

## src/compiler/checker/rules/flow/build/places.ts — Building Flow IR for assigned and &-referenced places
- EnteredPlace — resolved Flow IR Place and its copy-out leave callback; [exp]; callers: 0 outside folder
- enterPlace(builder, node) — decompose a place expression, evaluating keys and index accessors in source order; [exp]; callers: 0 outside folder
- stepInto(builder, place, step, node) — extend a Place by a field/tuple/keyed part or an indexed element read + writeback; callers: 0 outside folder
- AssignedPlace — entered assignment target with lazy read() and write(value) callbacks; [exp]; callers: 0 outside folder
- enterAssigned(builder, target) — enter an assignment target, avoiding reading a final container index unless compound; [exp]; callers: 0 outside folder
- rootPlace(builder, root, node) — build the root Place for a variable, handle dereference (*x), or expression; callers: 0 outside folder
- partOfField(read) — convert a CheckedBody FieldRead into a Flow IR Part; [exp]; callers: 0 outside folder
- leaveAll(leaves) — invoke place writeback callbacks in reverse (innermost-first) order; [exp]; callers: 0 outside folder

## src/compiler/checker/rules/flow/build/scopes.ts — Lexical variable scopes, hold scopes, and break/continue exits in Flow IR
- Releasing — FlowBuilder callbacks (emit, end, prepend) used by Scopes to emit release operations; [exp]; callers: 0 outside folder
- Scopes — stack of open lexical and labelled hold/exit scopes for a FlowBuilder; [exp]; callers: 0 outside folder
- Scopes.inScope(node, build) — run build in a new lexical scope and emit a release of its variables at the end; [exp]; callers: 0 outside folder
- Scopes.leave(site) — emit an early release of the innermost scope's variables (e.g. on a failed guard); [exp]; callers: 0 outside folder
- Scopes.declare(variable, until?) — register a variable in the innermost scope or a named hold target scope; [exp]; callers: 0 outside folder
- Scopes.withExits(scope, breakTo, continueTo, build) — run build with break/continue targets and prepend held releases at breakTo; [exp]; callers: 0 outside folder
- Scopes.exit(scope, kind, site) — release all scopes inside target scope and jump to its break or continue block; [exp]; callers: 0 outside folder

## src/compiler/checker/rules/flow/build/statements.ts — Exhaustive statement-kind table for building Flow IR
- declaration(builder, node) — evaluate a VariableDeclaration's initializer, keep unnamed parts, and bind targets; callers: 0 outside folder
- keep(builder, node, value, lifetime) — copy a value into an unnamed temporary and register it in Scopes for disposal; callers: 0 outside folder
- assignment(builder, node) — emit Flow IR for a simple, destructuring, or compound assignment statement; callers: 0 outside folder
- compound(builder, node, only) — read assigned place, call compound operator, and write fitted result back; callers: 0 outside folder
- fitted(builder, part, value) — emit a copy with the AssignedPart's recorded Fit when needed; callers: 0 outside folder
- whileLoop(builder, node) — emit loop blocks, condition scope, and body for a while statement; callers: 0 outside folder
- statementFlows — exhaustive Handlers table mapping each Statement syntax kind to its Flow IR builder; [exp]; callers: 0 outside folder

## src/compiler/checker/rules/flow/flow-decisions.ts — Per-pass record of ruled-out branches, Never stops, and decided conditions
- FlowDecisions — PassTable-backed store of ruled-out blocks, stopped operations, and decided conditions; [exp]; callers: 2 outside folder
- FlowDecisions.ruleOut(body) — mark a branch or case block as ruled out in the current pass; [exp]; callers: 2 outside folder
- FlowDecisions.isRuledOut(body, pass?) — test whether a block was ruled out in a pass; [exp]; callers: 1 outside folder
- FlowDecisions.stopAt(operation, operands) — record that an operation stops at a Never operand after operands; [exp]; callers: 1 outside folder
- FlowDecisions.stopsAt(operation, pass?) — return the operands evaluated before an operation stops at Never; [exp]; callers: 1 outside folder
- FlowDecisions.decide(condition, value) — record the constant boolean outcome of a type-decided condition; [exp]; callers: 1 outside folder
- FlowDecisions.decidedAt(node, pass?) — return the constant boolean outcome of a condition if decided; [exp]; callers: 1 outside folder

## src/compiler/checker/rules/flow/flow-ir.ts — Control-flow graph and value-operation IR for checked bodies
- ValueId — numeric index of a FlowValue in FlowFunction.values; [exp]; callers: 20 outside folder
- BlockId — numeric index of a FlowBlock in FlowFunction.blocks; [exp]; callers: 6 outside folder
- FlowValue — discriminated union of variable, global, and temporary values in a FlowFunction; [exp]; callers: 1 outside folder
- Part — part of a value accessed by a read or place (step, behind, inside, given, keyed, item); [exp]; callers: 4 outside folder
- Place — root ValueId, Part path, site expression, and root identifier for a place; [exp]; callers: 4 outside folder
- Argument — call argument passed either by value (ValueId) or by & reference (Place); [exp]; callers: 5 outside folder
- Operation — CFG operation node (compute, make, copy, read, write, call, callValue, suspend, release, unknown); [exp]; callers: 6 outside folder
- Exit — block terminator (goto, branch, return, stop); [exp]; callers: 2 outside folder
- FlowBlock — basic block holding a list of Operations and an Exit; [exp]; callers: 2 outside folder
- FlowFunction — complete CFG for a function or closure (root, parameters, captures, self, values, blocks); [exp]; callers: 11 outside folder

## src/compiler/checker/rules/flow/solve.ts — Generic forward dataflow worklist solver over a FlowFunction
- ForwardRule — join, settled, operation transfer, and optional block-entry clone callbacks for runForward; [exp]; callers: 2 outside folder
- runForward(flow, rule, entry) — iterate a ForwardRule to a fixed point over reachable blocks of a FlowFunction; [exp]; callers: 2 outside folder
- reachedBlocks(flow) — return a boolean array indicating which blocks of a FlowFunction are reachable from block 0; [exp]; callers: 1 outside folder
- reachesAnew(rule, reaching, block, state) — join state into a successor block's reaching state and test if it grew; callers: 0 outside folder
- successorsOf(exit) — return target BlockIds of a goto or branch Exit; callers: 0 outside folder

## src/compiler/checker/rules/kinds/data-kinds.ts — Proposal 8 Rule 2 data-kind checks over function bodies, constants, and declarations
- checkDataKinds(checker, module, declaration) — check that all values handled in a function's body and defaults fit its mark; [exp]; callers: 1 outside folder
- checkDefaultTypedFields(checker, module, fields) — refuse default-typed struct fields whose kind depends on type arguments; callers: 0 outside folder
- checkConstantKinds(checker, module, declaration) — check that a top-level or context const handles only allowed data kinds; [exp]; callers: 1 outside folder
- checkDeclaredKinds(checker, module, declaration) — report structs or enums whose fields hold both live and ista data kinds; [exp]; callers: 1 outside folder
- judgingOf(checker, module, body) — index a CheckedBody's madeCalls by site node for data-kind judging; callers: 0 outside folder
- judge(judging, node, handler, now?) — recursively walk AST nodes and field-loop passes to check handled value kinds; callers: 0 outside folder
- judgeNode(judging, node, handler) — check a node's expression type, fitted type, declared variable type, and call type arguments; callers: 0 outside folder
- judgeValues(judging, handler, at, types) — judge a list of types at a span, deduplicating per function handler; callers: 0 outside folder
- judgeValue(judging, handler, at, type) — report the first type whose valueKindsOf are refused by the handler's mark; callers: 0 outside folder
- nestedOf(judging, node) — build a fresh Handler for a nested Lambda or local FunctionDeclaration; callers: 0 outside folder
- judgeNested(judging, node, handler) — check a nested function's parameters, result, captures, and local fn body against its mark; callers: 0 outside folder
- laterOf(node) — collect the inner call nodes of a DeferredCall that run in the deferred function rather than now; callers: 0 outside folder

## src/compiler/checker/rules/kinds/signature-kinds.ts — Proposal 8 Rule 2 function signature mark and named-mark checks
- checkSignatureKind(checker, module, declaration) — verify a function's mark admits its parameters/result and host externs aren't ista; [exp]; callers: 1 outside folder
- isHostKind(checker, own, held) — test whether a host extern's mark and signature types are simple or live (never ista); callers: 0 outside folder
- Holding — code mark, holder name, held types with spans, and optional remedy string for heldKindRefusal; [exp]; callers: 1 outside folder
- heldKindRefusal(checker, holding) — return the diagnostic for the first held type whose data kind clashes with own mark; [exp]; callers: 1 outside folder
- refusalOf(at, holding, kind, held) — choose between kindsHeld, unmarkedHolds, and unmarkableHolds diagnostics; callers: 0 outside folder
- checkNamedMark(checker, module, declaration) — validate a named mark (M fn or Self.Mode fn) on a function head; [exp]; callers: 1 outside folder

## src/compiler/checker/rules/lifetimes/analysis/bindings.ts — Binding call arguments and closure captures to callee summary Inputs
- At — pair of active BodyAnalysis and current FlowState at a program point; [exp]; callers: 0 outside folder
- Bound — ReachState NodeIds and optional place Owner bound to a callee Input; [exp]; callers: 0 outside folder
- Bindings — map from inputKey to Bound for a call site; [exp]; callers: 0 outside folder
- functionBindings(at, call, args) — map a resolved function call's arguments (including rest items) to parameter Inputs; [exp]; callers: 0 outside folder
- closureBindings(at, closure, callee, args) — map a known closure call's arguments, captures, cells, and self to Inputs; [exp]; callers: 0 outside folder
- boundIn(at, bindings, input) — resolve an Input (including nested InputPaths, globals, and watched) against call Bindings; [exp]; callers: 0 outside folder
- argumentBound(at, argument) — resolve one value or place Argument to its live NodeIds and place Owner; callers: 0 outside folder
- globalBound(at, input) — allocate or look up the caller's live escaped node for a callee's global or watched Input; callers: 0 outside folder
- nodesGiven(at, args) — list all live value and place-owner NodeIds passed in an argument list; [exp]; callers: 0 outside folder
- ownedBy(owner) — return the heap holder node or variable node of a place Owner; [exp]; callers: 0 outside folder

## src/compiler/checker/rules/lifetimes/analysis/body.ts — Per-function lifetime analysis state updates, write checks, and requirement lifting
- AnalysisContext — type facts, callee summaries, witness lookup, and default results provided to BodyAnalysis; [exp]; callers: 3 outside folder
- Violation — cycle finding within a function before attaching its owning declaration; [exp]; callers: 3 outside folder
- NestedResult — summary, async flag, and input types returned from analysing a nested function; [exp]; callers: 0 outside folder
- Written — target node of a write and whether the write is exact or into a handle reached from it; [exp]; callers: 0 outside folder
- Holder — Written target together with the holder's Type; [exp]; callers: 0 outside folder
- BodyAnalysis — state and findings accumulator for one FlowFunction's lifetime analysis; [exp]; callers: 0 outside folder
- BodyAnalysis.canonOf(state, value) — return the canonical variable or path NodeId a temporary stands for, if still live; [exp]; callers: 0 outside folder
- BodyAnalysis.assign(state, variable, from) — update reach state and carry paths when assigning a variable from a value; [exp]; callers: 0 outside folder
- BodyAnalysis.carryPaths(state, into, from) — copy live path nodes from a source node onto a destination copy; [exp]; callers: 0 outside folder
- BodyAnalysis.release(state, value) — kill a released variable or temporary, its paths, and its callee/future records; [exp]; callers: 0 outside folder
- BodyAnalysis.endPathsFrom(state, root) — kill all live path nodes rooted at root and clear canon entries pointing to it; [exp]; callers: 0 outside folder
- BodyAnalysis.endPathsThrough(state, holder) — invalidate path nodes read through a handle cell that a write may mutate; [exp]; callers: 0 outside folder
- BodyAnalysis.write(state, holder, value, site) — check if writing value into holder closes a cycle, else lift requirements and link; [exp]; callers: 0 outside folder
- BodyAnalysis.#reachesDisposable(state, from, value) — test whether nodes on a cycle hold any relevant non-cell/non-closure disposable; callers: 0 outside folder
- BodyAnalysis.lift(state, holder, value, spec) — record caller Requirements for input pairs that could make value reach/share holder; [exp]; callers: 0 outside folder
- BodyAnalysis.liftedPairs(state, holder, value, kind) — find pairs of distinct input/path candidates carrying value and reaching holder; [exp]; callers: 0 outside folder
- BodyAnalysis.calledInput(state, callee) — identify and record an input parameter/capture called as a function value; [exp]; callers: 0 outside folder
- BodyAnalysis.require(requirement) — add or generalize a caller Requirement in the function's requirements map; [exp]; callers: 0 outside folder
- BodyAnalysis.violate(kind, site, cycle, callee) — record a concrete cycle Violation or an instantiation-dependent always TypedCycle; [exp]; callers: 0 outside folder
- BodyAnalysis.leak(state, node) — mark a node and its reachable/aliased nodes as escaped to unseen code and record leaked inputs; [exp]; callers: 0 outside folder
- placeHolds(state, holder, place, value) — record that a variable naming an exact heap place also contains a value written into it; [exp]; callers: 0 outside folder

## src/compiler/checker/rules/lifetimes/analysis/calls.ts — Applying a callee Summary at a call site and checking witness/callback cycles
- CallMade — call site, destination ValueId, callee declaration, FunctionCall, and async flag; [exp]; callers: 0 outside folder
- applySummary(at, made, summary, bindings) — check requirements/cycles, check witnesses, apply effects, bind result, and run callbacks; [exp]; callers: 0 outside folder
- calledBack(at, node, given, seen) — apply effects of a function-value argument the callee invokes (known closure or unseen code); callers: 0 outside folder
- applyEffects(at, summary, bound) — apply a summary's input-to-input reach effects, leaks, and unseen code to caller state; callers: 0 outside folder
- checkRequirement(at, made, requirement, bound) — instantiate and check one callee Requirement against bound caller arguments; callers: 0 outside folder
- checkAt(at, made, pair) — check or lift a single (target, value) requirement pair at a call site; callers: 0 outside folder
- reachesItself(at, bound) — link a bound argument's nodes and place variable to themselves for a self-reaching effect; callers: 0 outside folder
- written(at, holder, value, inside) — link a written value into a bound holder's nodes, heap owner, or reference variable; callers: 0 outside folder
- checkWitnesses(at, call, site) — check trait witnesses passed by a generic call against the declaration graph via escapingCycles; callers: 0 outside folder
- unknownCall(at, into, given, unseen?) — leak arguments, mark result escaped, and run unseen-code closure for an opaque call; [exp]; callers: 0 outside folder

## src/compiler/checker/rules/lifetimes/analysis/cycles.ts — Computing the deciding Type and through-types of a cycle closed by a write
- cycleOf(analysis, state, holder, value) — build the TypedCycle closed when writing value into holder; [exp]; callers: 0 outside folder
- pathOf(analysis, state, holder, value) — find the least relevant deciding type along the parts of value that close with holder; callers: 0 outside folder

## src/compiler/checker/rules/lifetimes/analysis/flow-state.ts — Per-point dataflow state (ReachState, canonical paths, closures, futures) and join
- MadeClosure — known closure record holding its FlowFunction, Summary, captured NodeIds, and async flag; [exp]; callers: 0 outside folder
- Given — relation of a result or future value to a NodeId; [exp]; callers: 0 outside folder
- Settled — relations and self-reach flag for the value a future settles with; [exp]; callers: 0 outside folder
- FlowState — per-point analysis state: ReachState, canon map, known callees map, and future gives map; [exp]; callers: 0 outside folder
- clonedState(state) — deep-clone a FlowState at a basic block entry; [exp]; callers: 0 outside folder
- materialize(nodes, state, node) — lazily materialize a PathNode into a FlowState from its live root, separating input siblings; [exp]; callers: 0 outside folder
- siblingsOf(nodes, state, node) — collect sibling PathNodes (and their sub-paths and canon aliases) sharing node's root; callers: 0 outside folder
- joinedStates(nodes, states) — materialize paths present in any incoming state and join all FlowStates at a merge point; [exp]; callers: 0 outside folder
- keepAgreeing(into, other, same) — intersect a Map in place with another Map using an equality predicate; callers: 0 outside folder
- sameSettled(first, second) — test whether two Settled future-value records are identical; callers: 0 outside folder
- sameKnown(first, second) — test whether two KnownFunction records denote the same closure or iterator cursor; callers: 0 outside folder

## src/compiler/checker/rules/lifetimes/analysis/given.ts — Relating call results, defaults, and watched WeakRef values in FlowState
- giveResult(at, made, summary, boundAndPlaces) — relate a call's destination node (and async future) to bound inputs and place owners; [exp]; callers: 0 outside folder
- withDefaults(at, operation, bindings) — augment call Bindings with per-call nodes for omitted parameters using defaultResult summaries; [exp]; callers: 0 outside folder
- giveValue(at, into, settled) — reset destination node fresh and apply Settled relations and self-reach; [exp]; callers: 0 outside folder
- relating — table mapping each ResultRelation kind to its ReachState update method; callers: 0 outside folder
- relate(at, into, given) — apply one ResultRelation between a fresh result node and a live argument node; callers: 0 outside folder
- withWatched(at, node, use, fresh?) — materialize a temporary watched value related by types to all live nodes when reading watched input; [exp]; callers: 0 outside folder

## src/compiler/checker/rules/lifetimes/analysis/index.ts — Fixed-point driver and fast path for analysing one FlowFunction
- Analysis — output of analysing a FlowFunction: Summary, Violations, and inputTypes map; [exp]; callers: 3 outside folder
- AnalyzeOptions — async, nested, references, and recursive options for analyze(); [exp]; callers: 0 outside folder
- analyze(context, flow, options) — analyse a FlowFunction via single-pass fast path or forward fixed-point iteration; [exp]; callers: 2 outside folder
- holdsNothingRelevant(nodes) — test whether no value or input in a FlowFunction can reach a disposable; callers: 0 outside folder
- analyzedOnce(context, nodes, options) — run a single recording pass for functions whose values cannot reach disposables; callers: 0 outside folder
- analyzedToFixpoint(context, nodes, options) — solve FlowState to a fixed point with runForward, then run a final recording pass; callers: 0 outside folder
- runRecording(analysis, params) — run block operations in recording mode and collect return states and async suspend states; callers: 0 outside folder
- analysisOf(context, nodes, options) — construct BodyAnalysis and its memoized nested-closure analyser; callers: 0 outside folder
- analysisFound(analysis, found) — summarize BodyAnalysis at exit states and combine its violations with nested closures'; callers: 0 outside folder
- entryState(analysis) — build the initial FlowState with live, escaped inputs and cell-to-capture holds; callers: 0 outside folder
- allowedBy(nodes) — build the Allowed type-reach filter and input-rooted predicate for ReachState; callers: 0 outside folder

## src/compiler/checker/rules/lifetimes/analysis/inputs.ts — Input and input-path candidates for lifting requirements and effects
- Candidate — pair of an Input (or InputPath) and its current NodeId in FlowState; [exp]; callers: 0 outside folder
- candidatesIn(analysis, state) — list live, relevant root Inputs and InputPaths in state for lifting; [exp]; callers: 0 outside folder
- inputPathOf(nodes, node) — recursively reconstruct the InputPath for a PathNode rooted at a stable input; callers: 0 outside folder
- inputAt(nodes, node) — return the root Input for an input node or an unassigned parameter variable; callers: 0 outside folder
- isInputRooted(nodes, node) — test whether a node is an input or a path read from an input; [exp]; callers: 0 outside folder
- apart(first, second) — test whether two Inputs lie on disjoint branches (neither is a prefix of the other); [exp]; callers: 0 outside folder

## src/compiler/checker/rules/lifetimes/analysis/nodes.ts — Node numbering, input slots, interned paths, type reach, and temporary liveness
- TypeFacts — callbacks for type relevance, handle reach, cell types, and struct field names; [exp]; callers: 0 outside folder
- InputSlot — descriptor of a function input's Input, initial NodeId, variable ValueId, and Type; [exp]; callers: 0 outside folder
- ReadKind — whether a Part read goes 'through' a handle/future or reads a value 'part'; [exp]; callers: 0 outside folder
- readKindOf(part) — classify a Part as 'through' (behind/given) or 'part'; [exp]; callers: 0 outside folder
- Nodes — per-FlowFunction node allocator and query table for values, cells, inputs, defaults, and paths; [exp]; callers: 0 outside folder
- Nodes.globalInput(entity, type) — get or allocate the InputSlot for a global constant or context constant; [exp]; callers: 0 outside folder
- Nodes.#namedInput(input, type) — allocate a negative NodeId slot for a global or watched input; callers: 0 outside folder
- Nodes.defaultOf(call, index, type) — get or allocate the NodeId for an omitted argument's default at a call operation; [exp]; callers: 0 outside folder
- Nodes.#allocate(type) — allocate the next positive NodeId for a path, default, or watched value and record its type; callers: 0 outside folder
- Nodes.path(root, part, kind, type) — intern and return the NodeId for reading part from root; [exp]; callers: 0 outside folder
- Nodes.partKey(part) — compute a canonical string key for a Part (field name, tuple index, or step object id); [exp]; callers: 0 outside folder
- Nodes.madeParts(type, parts, kind) — pair the part NodeIds of a newly constructed struct or tuple with their field/index Parts; [exp]; callers: 0 outside folder
- Nodes.typeOf(node) — return the Type of any NodeId (global, value, cell, input, or allocated path/default); [exp]; callers: 0 outside folder
- Nodes.isRelevant(node) — memoize whether a node's type may reach a disposable; [exp]; callers: 0 outside folder
- inputSlots(flow, size, cellOf) — build the initial InputSlots for parameters, captures, self, globals, and captured cells; callers: 0 outside folder
- lastUsesOf(flow) — compute block-local temporaries that can be killed immediately after their last operation use; callers: 0 outside folder
- operandsOf(operation) — list all ValueIds read by a Flow IR Operation; callers: 0 outside folder

## src/compiler/checker/rules/lifetimes/analysis/operations.ts — Transfer functions for each Flow IR Operation kind in lifetime analysis
- handlers — exhaustive table of per-Operation transfer functions updating FlowState and BodyAnalysis; callers: 0 outside folder
- dispatchedCall(at, operation, call, witnesses) — map and join summaries of known trait/any witnesses and apply them at a requirement call; callers: 0 outside folder
- cursorOver(at, cursor, iterated) — mark a std iterate cursor as holding its iterated collection and yielding items; callers: 0 outside folder
- runOperation(analysis, state, operation) — run an operation's transfer handler and kill dead defaults and block-local temporaries; [exp]; callers: 0 outside folder
- assigned(at, operation) — handle a copy into a variable (lifting & writes, writing captured let cells, updating paths); callers: 0 outside folder
- copied(at, operation) — handle a copy into a temporary (copying reach, paths, canonical root, and callee/future info); callers: 0 outside folder
- readOf(at, operation) — handle a Part read (interning a PathNode when rooted at a typed canonical node, else reading part/through); callers: 0 outside folder
- madeParts(at, operation) — populate PathNodes for the fields or elements of a newly constructed struct or tuple; callers: 0 outside folder
- carry(state, into, from) — propagate known callee and future-gives metadata across a copy; callers: 0 outside folder
- madeClosure(at, operation) — analyse a nested closure, hold and leak its captures/cells, and check escaping cycles; callers: 0 outside folder
- functionInputs(analysis, call) — build Escaping summary and substituted parameter types for a function named as a value; callers: 0 outside folder
- checkEscaping(at, site, escaping, kind) — check an escaping closure or function value for cycles via escapingCycles; callers: 0 outside folder

## src/compiler/checker/rules/lifetimes/analysis/places.ts — Resolving a Flow IR Place to its value NodeId and heap/variable Owner
- Owner — place owner variant: heap Holder (handle or captured cell), plain variable, or & reference parameter; [exp]; callers: 0 outside folder
- PlaceTarget — resolved value NodeId and Owner for a Place; [exp]; callers: 0 outside folder
- placeTarget(analysis, state, place) — resolve a Place's canonical root and determine whether writes land in a handle cell, let cell, & param, or variable; [exp]; callers: 0 outside folder

## src/compiler/checker/rules/lifetimes/analysis/summarize.ts — Projecting a finished BodyAnalysis and its exit states into a function Summary
- Return — return exit FlowState paired with its returned ValueId; [exp]; callers: 0 outside folder
- Ends — return states and async wait/stop states observed by a function's callers; [exp]; callers: 0 outside folder
- summarize(analysis, entry, ends, isAsync) — build a function's Summary from its BodyAnalysis and exit states; [exp]; callers: 0 outside folder
- callReachOf(slots, seen) — list Inputs held live across any suspension point of an async function; callers: 0 outside folder
- effectsOf(analysis, entry, states) — compute Input-to-Input reach Effects added between entry and joined exit states; callers: 0 outside folder
- effectOf(analysis, states, pair, rootOf) — test whether candidate from came to reach candidate to (or inside it) after entry; callers: 0 outside folder
- resultsOf(analysis, exits, slots, isAsync) — compute how a function's return value and settled future relate to its Inputs; callers: 0 outside folder
- givenRelations(state, given, node) — compose a future's Given relation with how its target node relates to an input node; callers: 0 outside folder
- resultRelations(state, value, node) — list all ResultRelations (aliases, reaches, reachedBy, shares) between a return value and an input; callers: 0 outside folder

## src/compiler/checker/rules/lifetimes/analysis/unseen.ts — Conservative type-graph closure at suspension points and opaque calls
- UnseenCall — nodes given to an opaque call and whether the callee is unknown to the caller; [exp]; callers: 0 outside folder
- runUnseen(analysis, state, call?) — invalidate paths through reached handles, lift share requirements, and close reach by types; [exp]; callers: 0 outside folder
- accessFrom(analysis, state, given) — compute transitive reach/alias closure from given arguments, globals, and leaked nodes; callers: 0 outside folder
- separate(analysis, state, reached, requires) — record inputs accessed by unseen code and require unreached inputs not to share with them; callers: 0 outside folder
- closeOver(analysis, state, live) — relate all nodes reachable by unseen code according to their HandleReach types; callers: 0 outside folder
- oneHandle(analysis, state, pair) — test whether two nodes are aliased handles of the same object (which cannot form a self-cycle); callers: 0 outside folder
- relateByTypes(state, first, second) — add reach, whole, alias, or share edges between two nodes as their HandleReach allows; [exp]; callers: 0 outside folder

## src/compiler/checker/rules/lifetimes/composition.ts — Remapping Summaries across parameter bindings and joining witness Summaries
- boundBy(summary, binding, substitute) — remap a witness Summary's parameter inputs and types through a call Binding; [exp]; callers: 1 outside folder
- joinedSummaries(summaries) — union the effects, results, requirements, always cycles, leaks, and calls of multiple Summaries; [exp]; callers: 1 outside folder
- joinedValues(first, second) — union two GivenValue relation lists and their reachesItself flags; callers: 0 outside folder

## src/compiler/checker/rules/lifetimes/declared.ts — Lifetime analysis of parameter/field defaults, constant initializers, and dispose functions
- DefaultsFound — violations, summaries, and per-parameter GivenValue results from a function's default expressions; [exp]; callers: 0 outside folder
- noDefaults — empty DefaultsFound constant for functions without parameter defaults; [exp]; callers: 0 outside folder
- DeclaredDeps — checker and analysis callbacks required by Declared; [exp]; callers: 0 outside folder
- defaultsFlows(checker, declaration) — collect FlowFunctions built for a function's or fields function's default values; [exp]; callers: 0 outside folder
- constantFlow(checker, declaration) — return the FlowFunction built for a top-level const or context constant initializer; [exp]; callers: 0 outside folder
- defaultsFound(checker, context, declaration, recursive) — analyse each parameter default FlowFunction and collect summaries/violations; [exp]; callers: 0 outside folder
- withDefaults(summary, defaults) — merge parameter default summaries into a function's own Summary; [exp]; callers: 0 outside folder
- Declared — analyser for declaration-site lifetime checks (constants and user dispose functions); [exp]; callers: 0 outside folder
- Declared.violationsOf(declaration) — analyse a constant initializer or check a user dispose function's summary via escapingCycles; [exp]; callers: 0 outside folder

## src/compiler/checker/rules/lifetimes/dispatch.ts — Whole-program trait-object (any) conversion tracking and witness dispatch resolution
- Conversion — record of a member Type converted into an AnyType in a module; [exp]; callers: 0 outside folder
- Dispatch — entry-cached resolver finding all concrete witness calls a RequirementCall may invoke; [exp]; callers: 0 outside folder
- Dispatch.witnessesOf(call) — return concrete FunctionCalls for an any-trait, union-member, or computed-type requirement call; [exp]; callers: 0 outside folder
- Dispatch.#dispatchedOf(trait) — collect all concrete member witnesses for a trait across modules that can name it; callers: 0 outside folder
- Dispatch.#modulesNamedBy(module) — compute transitive closure of modules imported by module (plus prelude); callers: 0 outside folder
- putInto(member, conversions, seen) — transitively expand an any member into the concrete types converted into it; callers: 0 outside folder
- anyConversionsBetween(rules, from, to, relating?) — find all conversions into any between two types using UnfoldingPairs; callers: 0 outside folder
- fitConversions(rules, from, fit, relating) — extract conversions into any from a Fit (direct any, part-by-part, or union); callers: 0 outside folder
- conversionsIn(rules, flow) — collect all conversions into any from copy operations across a FlowFunction and its closures; callers: 0 outside folder
- sameWitnesses(first, second) — compare two trait witness maps for EntryTable cutoff; callers: 0 outside folder

## src/compiler/checker/rules/lifetimes/escaping.ts — Type-based cycle checks for escaping closures, function values, witnesses, and dispose
- EscapingFacts — type relevance and handle-reach callbacks for escaping checks; [exp]; callers: 0 outside folder
- typesBreak(facts, pair, kind) — test whether values of holder and value types can reach/alias or share handles; [exp]; callers: 1 outside folder
- decidingType(facts, holder, value) — return whichever of holder and value type has lower disposable Relevance; [exp]; callers: 1 outside folder
- cycleRelevance(facts, cycle) — determine whether a TypedCycle closes never ('no'), always ('yes'), or per instantiation ('depends'); [exp]; callers: 1 outside folder
- escapingCycles(facts, summary, typeOf) — convert a summary's requirements and always cycles into TypedCycles using parameter types; [exp]; callers: 2 outside folder

## src/compiler/checker/rules/lifetimes/externs.ts — Reading @Holds and @Keeps annotations on std extern structs and functions (§3.16)
- externHeldOf(checker, type) — return the one-level held types of an extern nominal type from its @Holds<X> or type arguments; [exp]; callers: 1 outside folder
- keepsOf(checker, declaration) — return parameter holder-to-kept index pairs from @Keeps or default & parameter rules; [exp]; callers: 1 outside folder
- checkKeeps(checker, declaration) — report any parameter names in an extern function's @Keeps that do not match its parameters; [exp]; callers: 1 outside folder
- positionsOf(checker, declaration) — map a function's parameter names to their 0-based parameter indices; callers: 0 outside folder
- annotationNamed(checker, declaration, name) — look up a CheckedAnnotation for @Holds or @Keeps on an extern declaration; callers: 0 outside folder
- keptNames(keeps) — extract [holderName, keptNames[]] entries from a @Keeps map ConstantForm; callers: 0 outside folder

## src/compiler/checker/rules/lifetimes/facts.ts — Entry-cached TypeFacts (relevance, handle reach, cells, struct field names) for lifetimes
- typeFactsOf(checker) — create EntryTable-backed TypeFacts queries for a CheckerContext; [exp]; callers: 0 outside folder
- declaredFieldNamesOf(checker, type) — return field names in declaration order for an anonymous or declared struct type; callers: 0 outside folder

## src/compiler/checker/rules/lifetimes/finding.ts — LifetimeFinding and FindingDeclaration types for static lifetime violations
- LifetimeFinding — violation record with kind, site node, holderType, optional callee, and owning declaration; [exp]; callers: 1 outside folder
- FindingDeclaration — union of FunctionDeclaration, ContextConstantDeclaration, and VariableDeclaration; [exp]; callers: 0 outside folder

## src/compiler/checker/rules/lifetimes/groups.ts — Call-graph SCC grouping and fixed-point convergence predicates for lifetimes
- Call — directed call-graph edge between two FunctionDeclarations; [exp]; callers: 0 outside folder
- groupOf(edges, declaration, position) — find and deterministically sort the recursive SCC group of a FunctionDeclaration; [exp]; callers: 0 outside folder
- hasBody(declaration) — test whether a FunctionDeclaration has a source body (neither extern nor a fields function); [exp]; callers: 0 outside folder
- hasCode(declaration) — test whether a FunctionDeclaration has a body or parameter default expressions; [exp]; callers: 0 outside folder
- FunctionAnalysis — a function's body Analysis combined with its DefaultsFound; [exp]; callers: 0 outside folder
- DefaultResults — map from parameter index to its default's GivenValue; [exp]; callers: 0 outside folder
- GroupAnalyses — map from FunctionDeclaration to FunctionAnalysis for an SCC group; [exp]; callers: 0 outside folder
- doesNothing — bottom FunctionAnalysis with emptySummary used to seed recursive SCC fixed-point iteration; [exp]; callers: 0 outside folder
- sameGroupAnalyses(first, second) — test whether two rounds of GroupAnalyses have equal function and default summaries; [exp]; callers: 0 outside folder

## src/compiler/checker/rules/lifetimes/input.ts — Summary Input model (parameters, captures, cells, self, globals, watched, paths)
- Input — discriminated union of callee inputs and nested InputPaths; [exp]; callers: 8 outside folder
- sameInput(first, second) — test whether two Inputs have identical keys, read kinds, and spelled types; [exp]; callers: 2 outside folder
- inputKey(input) — serialize an Input to a canonical string key; [exp]; callers: 8 outside folder
- InputPair — holder and value Input pair for a Requirement; [exp]; callers: 1 outside folder

## src/compiler/checker/rules/lifetimes/lifetimes.ts — Program-wide bottom-up static lifetime analysis coordinator and EntryTables
- Lifetimes — program-wide static lifetimes engine with incremental EntryTables for callees, groups, summaries, and reports; [exp]; callers: 2 outside folder
- Lifetimes.#contextOf(checker) — build the AnalysisContext shared by all function body analyses; callers: 0 outside folder
- Lifetimes.reachesDisposable(type) — test whether values of type may reach a disposable (used by lowering for refcounting); [exp]; callers: 1 outside folder
- Lifetimes.findingsOf(module) — return all LifetimeFindings in a module (used by lifetime test kit); [exp]; callers: 0 outside folder
- Lifetimes.check(module) — compute and report all lifetime cycle diagnostics for a module's declarations; [exp]; callers: 1 outside folder
- Lifetimes.#violationsOf(declaration) — collect and deduplicate body, default, and declaration-site Violations for a declaration; callers: 0 outside folder
- Lifetimes.#report(declaration, module) — emit diagnostics for each Violation of a declaration; callers: 0 outside folder
- Lifetimes.#calleesOf(caller) — collect all functions with code called by a function's body and defaults (including witnesses); callers: 0 outside folder
- Lifetimes.#groupFrom(declaration) — compute the strongly connected recursive group of a function in the reachable call graph; callers: 0 outside folder
- Lifetimes.#analyzeGroup(members) — iterate #analyzeRound over a recursive function group until summaries converge; callers: 0 outside folder
- Lifetimes.#analyzeRound(members, guesses, recursive) — run one round of #analyzeFunction for all members of an SCC group; callers: 0 outside folder
- Lifetimes.#analyzeFunction(declaration, group, recursive) — analyse a function's body and defaults using current group guesses; callers: 0 outside folder
- Lifetimes.#ownAnalysis(declaration, context, recursive) — run analyze() on a function's body FlowFunction or build its bodiless summary; callers: 0 outside folder
- Lifetimes.#flowsOf(module) — list all FlowFunctions (bodies, defaults, constants) in a module for Dispatch; callers: 0 outside folder
- Lifetimes.#defaultResult(callee, index, group) — return the GivenValue summary of a callee's parameter default; callers: 0 outside folder
- Lifetimes.#summaryOf(declaration) — return a function's converged Summary (body + defaults, native, or constructor); callers: 0 outside folder
- Lifetimes.#bodilessSummary(declaration) — build nativeSummary for an extern fn or constructorSummary for a fields fn; callers: 0 outside folder
- substitutedIn(checker, type, call) — substitute a callee's type parameters with a FunctionCall's type arguments; callers: 0 outside folder
- constantsOf(items) — filter a module's items to ContextConstantDeclarations and top-level VariableDeclarations; callers: 0 outside folder

## src/compiler/checker/rules/lifetimes/reach-state.ts — Mutable abstract reachability, alias, share, whole-part, and escape graph
- NodeId — numeric identifier of a node in ReachState; [exp]; callers: 13 outside folder
- Allowed — type-compatibility predicates (reach, alias, share, whole) filtering edges added to ReachState; [exp]; callers: 1 outside folder
- ReachState — abstract heap graph tracking reach, alias, share, wholes, escaped, leaked, and live NodeIds; [exp]; callers: 3 outside folder
- ReachState.join(other) — union another ReachState into this one and return whether any fact was added; [exp]; callers: 2 outside folder
- ReachState.size() — return total count of edges and set members in the state for fixed-point detection; [exp]; callers: 1 outside folder
- ReachState.carriedBy(value, whole) — test whether value is, aliases, reaches, was read out of, or non-inverse shares with whole; [exp]; callers: 2 outside folder
- ReachState.addWhole(part, whole) — record that part was read out of whole (and its aliases) and propagate whole-origins; [exp]; callers: 1 outside folder
- ReachState.#carry(node, other) — propagate whole-origins from other to node when node comes to reach or alias other; callers: 0 outside folder
- ReachState.kill(node) — remove node and all incident edges from reach, alias, share, wholes, escaped, leaked, and live; [exp]; callers: 3 outside folder
- ReachState.addReach(from, to) — add a directed reach edge (plus implied share and whole propagation) if allowed by types; [exp]; callers: 2 outside folder
- ReachState.addAlias(first, second) — add a symmetric alias edge (plus implied share and whole propagation) if allowed by types; [exp]; callers: 3 outside folder
- ReachState.addShare(first, second) — add a symmetric share edge if allowed by types; [exp]; callers: 1 outside folder
- ReachState.copy(into, from) — reset into fresh, alias it with from, and inherit from's reach, alias, share, and escape facts; [exp]; callers: 2 outside folder
- ReachState.contain(into, part) — alias into with part and inherit part's relations when into is a composite containing part; [exp]; callers: 3 outside folder
- ReachState.#contained(into, part, apart?) — copy alias, reach, incoming reach, share, and escape from part to into, excluding apart; callers: 0 outside folder
- ReachState.hold(into, part) — add reach and share edges from a newly created handle into to a held part; [exp]; callers: 3 outside folder
- ReachState.share(into, node) — add share edges between into and node (plus everything reaching or aliasing node); [exp]; callers: 1 outside folder
- ReachState.readThrough(into, from, apart?) — relate into as a value read through from's handle cell or future, excluding apart; [exp]; callers: 3 outside folder
- ReachState.readPart(into, from, apart?) — relate into as a direct value part read from from, excluding apart siblings; [exp]; callers: 2 outside folder
- ReachState.link(holder, value, options) — update reach and share for all nodes reaching holder when value is written into it; [exp]; callers: 1 outside folder
- ReachState.escape(node) — mark node and everything it reaches or aliases as both escaped and leaked; [exp]; callers: 2 outside folder
- joined(into, from) — union all adjacency sets of one Pairs map into another; callers: 0 outside folder
- added(pairs, from, to) — insert a directed edge into a Pairs adjacency map; callers: 0 outside folder
- countOf(pairs) — sum the sizes of all sets in a Pairs adjacency map; callers: 0 outside folder

## src/compiler/checker/rules/lifetimes/reports.ts — Formatting cycle Violations into checker Diagnostics with related callee locations
- diagnosticOf(checker, violation) — build the cycleWrite/cycleCall/cycleInstance/cycleEscaping/cycleWitness Diagnostic for a Violation; [exp]; callers: 0 outside folder

## src/compiler/checker/rules/lifetimes/summary.ts — Function Summary model, equality cutoffs, and native/constructor summary builders
- Label — placeholder field-label interface ({ kind: 'any' }); [exp]; callers: 0 outside folder
- anyField — singleton Label constant ({ kind: 'any' }); [exp]; callers: 3 outside folder
- Effect — input-to-input reach effect added by a function call; [exp]; callers: 1 outside folder
- ResultRelation — relation ('reaches' | 'reachedBy' | 'aliases' | 'shares') between a call result and an Input; [exp]; callers: 3 outside folder
- GivenValue — relations to Inputs and self-reach flag for a call's return value or settled future value; [exp]; callers: 3 outside folder
- unrelatedValue — empty GivenValue constant; [exp]; callers: 0 outside folder
- Requirement — caller precondition that value Input must not reach or share with holder Input; [exp]; callers: 2 outside folder
- TypedCycle — instantiation-dependent cycle description with holder, through, sources, kind, and deciding Type; [exp]; callers: 2 outside folder
- mappedCycle(cycle, map) — apply a Type mapping function to all types in a TypedCycle; [exp]; callers: 1 outside folder
- Summary — complete function lifetime summary (effects, result, gives, requirements, always, callReach, leaks, unseen, calls, access); [exp]; callers: 7 outside folder
- emptySummary — identity Summary doing nothing; [exp]; callers: 1 outside folder
- sameValue(first, second) — test whether two GivenValues have equal relations and reachesItself flags; [exp]; callers: 0 outside folder
- sameSummary(first, second) — test whether two Summaries are equal in all fields for EntryTable cutoff; [exp]; callers: 0 outside folder
- nativeSummary(checker, native) — derive the Summary of an extern function from its signature, @Keeps, and @Holds; [exp]; callers: 0 outside folder
- nativeResult(checker, native) — compute ResultRelations of an extern function's return type to its parameters and watched input; callers: 0 outside folder
- givesOf(holding, anything) — compute ResultRelations for the value an extern function's returned Future settles with; callers: 0 outside folder
- holdsDirectly(checker, type, value) — test whether an extern handle type holds a given value type directly via @Holds or arguments; callers: 0 outside folder
- constructorSummary(checker, fields) — build the Summary of a bodiless struct/variant fields function; [exp]; callers: 0 outside folder
- watchesIn(checker, type, result) — test whether an extern handle watches a type argument (omitted from @Holds) that appears in result; callers: 0 outside folder

## src/compiler/checker/rules/lifetimes/type-reach.ts — Declaration-based disposable Relevance and HandleReach graph over Types
- Relevance — whether values of a type may reach a disposable ('no' | 'depends' | 'yes'); [exp]; callers: 2 outside folder
- lessRelevant(first, second) — test whether first Relevance is strictly below second; [exp]; callers: 1 outside folder
- moreRelevant(first, second) — return the maximum of two Relevance values; [exp]; callers: 1 outside folder
- relevanceOf(checker, type) — compute whether values of type can reach a disposable at any depth; [exp]; callers: 0 outside folder
- ownRelevance(checker, type) — compute the immediate Relevance of a type (disposable, function, any, or type parameter); callers: 0 outside folder
- HandleReach — sets of handle declarations (and closure flags) a type holds directly (top) and behind cells (inner); [exp]; callers: 3 outside folder
- anyReach — HandleReach constant able to hold and reach any handle or closure; [exp]; callers: 2 outside folder
- Unknown — whether opaque/type-parameter parts count as holding 'anything' or 'nothing'; [exp]; callers: 0 outside folder
- handleReachOf(checker, type, unknown?) — compute the top and inner HandleReach of a type from declarations; [exp]; callers: 0 outside folder
- innerOf(checker, handles, unknown) — compute transitive handle declarations and closures reachable behind a set of handles; callers: 0 outside folder
- mayReach(holder, value) — test whether holder's inner handles/closures intersect value's top handles/closures; [exp]; callers: 2 outside folder
- mayAlias(first, second) — test whether two HandleReaches share any top handle declaration or top closure; [exp]; callers: 2 outside folder
- mayShare(first, second) — test whether two HandleReaches share any handle declaration or closure at top or inner depth; [exp]; callers: 2 outside folder
- meet(first, second) — test whether two Handles sets ('any' or ReadonlySet<NominalEntity>) intersect; callers: 0 outside folder
- sameHandleReach(first, second) — test whether two HandleReaches are equal for EntryTable cutoff; [exp]; callers: 0 outside folder
- sameHandles(first, second) — test whether two Handles sets are equal; callers: 0 outside folder
- topHandlesOf(checker, type, unknown) — walk non-handle value parts of type to collect direct handles, closures, or open 'any'; callers: 0 outside folder

## src/compiler/checker/rules/open-agreement.ts — Type agreement for producers inside an open inference constraint scope
- Producers — expression node, Produced list, expected type, and mismatch factory for openAgreement; [exp]; callers: 0 outside folder
- Agreeing — callback computing an agreed fallback type from a settled Substitution; [exp]; callers: 1 outside folder
- agreedDefault(checker, produced) — build an Agreeing fallback that substitutes settled variables and runs agreedType; [exp]; callers: 1 outside folder
- openAgreement(context, producers) — join a placeholder variable bounded by producers into an open constraint scope; [exp]; callers: 2 outside folder

## src/compiler/checker/rules/placeholders.ts — Constraint-scope placeholder variables for postponed expressions and fresh literals
- placeholderOf(context, node) — create and commit a top-level Placeholder inference variable for an expression in an open scope; [exp]; callers: 2 outside folder
- freshLiteralOf(context, node, expected) — bind a written literal to a fresh placeholder variable in an open constraint scope; [exp]; callers: 1 outside folder

## src/compiler/checker/rules/testing.ts — Rules for @Suite functions and testing.mock / testing.handle calls (§10)
- checkTestingCalls(context, calls) — validate mock() targets and handle<T>() host types in a body and return mock target nodes; [exp]; callers: 1 outside folder
- checkTarget(context, site, mock) — verify mock()'s first argument names a non-variant function passing all defaults without async fit; callers: 0 outside folder
- checkHandle(context, site, made) — verify that testing.handle<T>()'s type argument is a host extern type; callers: 0 outside folder
- checkSuite(checker, module, declaration) — verify an @Suite function's signature (non-async, 0-arg, -> Array<Test>) and effect-free body; [exp]; callers: 1 outside folder
- firstEffect(effectSites, node) — find the first AST node in a suite body that constructs a shared struct or calls an extern/handle fn; callers: 0 outside folder

## Concept footprint
- Optional/None: agreement.ts:joinedAgreement, agreement.ts:insideWidened, agreement.ts:decidedSoFar, boundary/json-forms.ts:JsonForms.#field, computation/index.ts:Computation.#own, flow/build/calls.ts:calleeValue, flow/build/chains.ts:openChain, flow/build/chains.ts:closeChain, flow/build/chains.ts:stepTarget, flow/build/chains.ts:linksOf, flow/build/control.ts:binaryFlow, flow/build/control.ts:unwrap
- Result: disposal/must-use.ts:mustUseAs, flow/build/control.ts:propagate
- unions: agreement.ts:insideWidened, boundary/json-forms.ts:JsonForms.#form, boundary/json-forms.ts:literalsForm, computation/forms.ts:fittedForm, computation/forms.ts:convertedForm, computation/forms.ts:partsForm, lifetimes/dispatch.ts:Dispatch.witnessesOf, lifetimes/dispatch.ts:fitConversions
- enums/variants: annotations.ts:declaresField, boundary/json-forms.ts:JsonForms.#nominal, boundary/json-forms.ts:JsonForms.#enum, boundary/json-forms.ts:partsOf, computation/index.ts:Computation.#struct, expansion/types.ts:writtenFieldsOf, flow/build/calls.ts:unresolved, kinds/data-kinds.ts:checkDeclaredKinds, testing.ts:checkTarget
- any/trait objects: boundary/json-forms.ts:JsonForms.#form, computation/forms.ts:convertedForm, disposal/disposal.ts:isDisposable, lifetimes/analysis/operations.ts:handlers, lifetimes/analysis/operations.ts:dispatchedCall, lifetimes/dispatch.ts:Dispatch.witnessesOf, lifetimes/dispatch.ts:Dispatch.#dispatchedOf, lifetimes/dispatch.ts:Dispatch.#memberCall, lifetimes/dispatch.ts:putInto, lifetimes/dispatch.ts:anyConversionsBetween, lifetimes/dispatch.ts:fitConversions, lifetimes/dispatch.ts:conversionsIn, lifetimes/type-reach.ts:ownRelevance, lifetimes/type-reach.ts:topHandlesOf
- futures/await/select: annotations.ts:placements, boundary/host-boundary.ts:checkHostBoundary, disposal/disposal.ts:checkDisposeDeclaration, disposal/must-use.ts:mustUseAs, flow/build/control.ts:awaitFlow, flow/build/control.ts:givenBy, flow/build/control.ts:selectFlow, flow/build/control.ts:awaitedAt, kinds/data-kinds.ts:judgeNested, kinds/signature-kinds.ts:checkSignatureKind, kinds/signature-kinds.ts:checkNamedMark, lifetimes/analysis/flow-state.ts:sameSettled, lifetimes/analysis/given.ts:giveResult, lifetimes/analysis/index.ts:runRecording, lifetimes/analysis/index.ts:analysisOf, lifetimes/analysis/index.ts:isAsyncSite, lifetimes/analysis/nodes.ts:readKindOf, lifetimes/analysis/operations.ts:handlers, lifetimes/analysis/operations.ts:dispatchedCall, lifetimes/analysis/operations.ts:runOperation, lifetimes/analysis/summarize.ts:summarize, lifetimes/analysis/summarize.ts:callReachOf, lifetimes/analysis/summarize.ts:resultsOf, lifetimes/analysis/summarize.ts:givenRelations, lifetimes/analysis/unseen.ts:runUnseen, lifetimes/lifetimes.ts:Lifetimes.#ownAnalysis, lifetimes/summary.ts:nativeSummary, lifetimes/summary.ts:givesOf, testing.ts:checkTarget, testing.ts:checkSuite
- marks/kinds (live/ista/simple): disposal/disposal.ts:disposeKindsOf, kinds/data-kinds.ts:checkDataKinds, kinds/data-kinds.ts:checkDefaultTypedFields, kinds/data-kinds.ts:checkConstantKinds, kinds/data-kinds.ts:checkDeclaredKinds, kinds/data-kinds.ts:judgeNode, kinds/data-kinds.ts:judgeValue, kinds/data-kinds.ts:nestedOf, kinds/data-kinds.ts:judgeNested, kinds/signature-kinds.ts:checkSignatureKind, kinds/signature-kinds.ts:isHostKind, kinds/signature-kinds.ts:heldKindRefusal, kinds/signature-kinds.ts:refusalOf, kinds/signature-kinds.ts:checkNamedMark, testing.ts:checkSuite
- sendable: agreement.ts:agreedType, boundary/host-boundary.ts:checkHostBoundary, lifetimes/type-reach.ts:relevanceOf, lifetimes/type-reach.ts:ownRelevance, lifetimes/type-reach.ts:heldOfFunction
- shared structs: annotations.ts:declaresField, boundary/json-forms.ts:JsonForms.#nominal, boundary/json-forms.ts:JsonForms.#opaque, disposal/disposal.ts:isOwnedHandle, disposal/disposal.ts:checkSelfStays, expansion/types.ts:writtenFieldsOf, flow/build/expressions.ts:expressionFlows, flow/build/literals.ts:structLiteral, flow/build/places.ts:rootPlace, kinds/data-kinds.ts:checkDeclaredKinds, lifetimes/analysis/nodes.ts:readKindOf, lifetimes/analysis/places.ts:placeTarget, lifetimes/facts.ts:declaredFieldNamesOf, testing.ts:firstEffect
- extern types: annotations.ts:placements, boundary/host-boundary.ts:checkHostBoundary, boundary/json-forms.ts:JsonForms.#nominal, boundary/json-forms.ts:JsonForms.#opaque, boundary/json-forms.ts:partsOf, boundary/outcome-codecs.ts:recordOutcomeCodecs, disposal/disposal.ts:isRuntimeDispose, disposal/disposal.ts:isOwnedHandle, disposal/disposal.ts:runtimeDisposes, disposal/disposal.ts:checkDisposeDeclaration, disposal/disposal.ts:checkSelfStays, expansion/types.ts:TypeExpansion.#fieldEdges, kinds/signature-kinds.ts:checkSignatureKind, kinds/signature-kinds.ts:isHostKind, lifetimes/externs.ts:externHeldOf, lifetimes/externs.ts:keepsOf, lifetimes/externs.ts:checkKeeps, lifetimes/externs.ts:annotationNamed, lifetimes/groups.ts:hasBody, lifetimes/lifetimes.ts:Lifetimes.#bodilessSummary, lifetimes/summary.ts:nativeSummary, lifetimes/summary.ts:nativeResult, lifetimes/summary.ts:holdsDirectly, lifetimes/summary.ts:watchesIn, testing.ts:checkHandle, testing.ts:checkSuite
- field loops/passes: agreement.ts:wholeWidened, flow/build/flow-builder.ts:FlowBuilder.inView, flow/build/literals.ts:structComprehension, flow/build/literals.ts:fieldComprehension, flow/build/loops.ts:fieldLoop, flow/build/statements.ts:statementFlows, flow/flow-decisions.ts:FlowDecisions, kinds/data-kinds.ts:judge
- comprehensions: agreement.ts:wholeWidened, computation/index.ts:Computation.#struct, flow/build/literals.ts:evaluatedItems, flow/build/literals.ts:structComprehension, flow/build/literals.ts:comprehension, flow/build/literals.ts:fieldComprehension, flow/build/loops.ts:itemLoop, flow/build/loops.ts:targetsLoop, flow/build/loops.ts:fieldLoop
- deferred calls: disposal/disposal.ts:checkSelfStays, flow/build/calls.ts:callFlow, flow/build/calls.ts:unresolved, flow/build/calls.ts:inParameterOrder, flow/build/calls.ts:deferredFunction, flow/build/calls.ts:closureMaking, flow/build/calls.ts:isMade, flow/build/calls.ts:computedNow, flow/build/calls.ts:madeLater, flow/build/flow-builder.ts:FlowBuilder.capturedValue, kinds/data-kinds.ts:judge, kinds/data-kinds.ts:laterOf
- spawn/Instance: boundary/outcome-codecs.ts:recordOutcomeCodecs, flow/build/calls.ts:encodedOutcome
- context consts: flow/build/flow-builder.ts:FlowBuilder.named, kinds/data-kinds.ts:checkConstantKinds, lifetimes/analysis/bindings.ts:globalBound, lifetimes/analysis/nodes.ts:Nodes.globalInput, lifetimes/analysis/nodes.ts:inputSlots, lifetimes/analysis/unseen.ts:accessFrom, lifetimes/declared.ts:constantFlow, lifetimes/declared.ts:Declared.violationsOf, lifetimes/lifetimes.ts:Lifetimes.#declarationsOf, lifetimes/lifetimes.ts:Lifetimes.#flowsOf, lifetimes/lifetimes.ts:constantsOf
- disposal/lifetimes/holders: annotations.ts:placements, boundary/json-forms.ts:JsonForms.#opaque, disposal/disposal.ts:isDisposable, disposal/disposal.ts:disposalOf, disposal/disposal.ts:disposeKindsOf, disposal/disposal.ts:isDisposeFunction, disposal/disposal.ts:disposeCandidates, disposal/disposal.ts:checkDisposeDeclaration, disposal/disposal.ts:checkSelfStays, disposal/disposal.ts:checkDisposeUses, disposal/dropped.ts:checkDropped, disposal/dropped.ts:droppedAfter, disposal/must-use.ts:checkDiscarded, disposal/must-use.ts:checkDrop, disposal/must-use.ts:undroppable, disposal/must-use.ts:mustUseAs, flow/build/scopes.ts:Scopes.inScope, flow/build/scopes.ts:Scopes.leave, flow/build/scopes.ts:Scopes.declare, flow/build/scopes.ts:Scopes.withExits, flow/build/scopes.ts:Scopes.exit, flow/build/statements.ts:declaration, flow/build/statements.ts:keep, flow/build/statements.ts:statementFlows, lifetimes/declared.ts:Declared.violationsOf, lifetimes/externs.ts:externHeldOf, lifetimes/externs.ts:keepsOf, lifetimes/externs.ts:checkKeeps, lifetimes/lifetimes.ts:Lifetimes.reachesDisposable, lifetimes/lifetimes.ts:Lifetimes.check, lifetimes/type-reach.ts:relevanceOf, lifetimes/type-reach.ts:ownRelevance, lifetimes/type-reach.ts:handleReachOf
- WeakRef/watched handles: lifetimes/analysis/bindings.ts:globalBound, lifetimes/analysis/body.ts:BodyAnalysis.liftedPairs, lifetimes/analysis/given.ts:withWatched, lifetimes/analysis/nodes.ts:Nodes.watchedInput, lifetimes/analysis/nodes.ts:Nodes.isWatched, lifetimes/analysis/nodes.ts:Nodes.watchedValue, lifetimes/analysis/summarize.ts:callReachOf, lifetimes/summary.ts:nativeResult, lifetimes/summary.ts:watchesIn
- recursive aliases/type match: boundary/json-forms.ts:JsonForms.#form, computation/forms.ts:partsForm, expansion/type-matches.ts:TypeMatchExpansion.isEndless, expansion/type-matches.ts:reductionEdges, expansion/type-matches.ts:caseReading, expansion/type-matches.ts:matchedParts, expansion/type-matches.ts:partsOf, expansion/type-matches.ts:usesIn, kinds/data-kinds.ts:checkDefaultTypedFields, lifetimes/dispatch.ts:anyConversionsBetween, lifetimes/type-reach.ts:ownRelevance
- struct keys/keyof: flow/build/expressions.ts:index, flow/build/loops.ts:fieldLoop, flow/build/places.ts:stepInto, flow/build/places.ts:enterAssigned, flow/build/places.ts:partOfField, flow/build/statements.ts:fitted
- packs: flow/build/calls.ts:prepared, flow/build/literals.ts:spreadValue
- indented values: computation/index.ts:Computation.#own, flow/build/expressions.ts:expressionFlows
- defaults/fields functions: boundary/json-forms.ts:JsonForms.skippedDefaultOf, computation/index.ts:Computation.#field, computation/index.ts:Computation.#default, computation/index.ts:Computation.#defaultValue, flow/build/literals.ts:structLiteral, flow/build/literals.ts:declaredLiteral, kinds/data-kinds.ts:checkDataKinds, kinds/data-kinds.ts:checkDefaultTypedFields, lifetimes/analysis/given.ts:withDefaults, lifetimes/analysis/nodes.ts:Nodes.defaultOf, lifetimes/analysis/operations.ts:runOperation, lifetimes/declared.ts:defaultsFlows, lifetimes/declared.ts:defaultsFound, lifetimes/declared.ts:withDefaults, lifetimes/groups.ts:hasBody, lifetimes/groups.ts:hasCode, lifetimes/lifetimes.ts:Lifetimes.#calleesOf, lifetimes/lifetimes.ts:Lifetimes.#analyzeFunction, lifetimes/lifetimes.ts:Lifetimes.#flowsOf, lifetimes/lifetimes.ts:Lifetimes.#defaultResult, lifetimes/lifetimes.ts:Lifetimes.#bodilessSummary, lifetimes/summary.ts:constructorSummary, testing.ts:checkTarget
- codecs/JSON: annotations.ts:Annotations.jsonNameOf, annotations.ts:Annotations.checkFields, annotations.ts:placements, boundary/host-boundary.ts:checkHostBoundary, boundary/host-boundary.ts:crossesToHost, boundary/json-forms.ts:JsonForms.formOf, boundary/json-forms.ts:JsonForms.derivedOf, boundary/json-forms.ts:JsonForms.skippedDefaultOf, boundary/json-forms.ts:JsonForms.codecOf, boundary/json-forms.ts:JsonForms.callOf, boundary/json-forms.ts:JsonForms.#form, boundary/json-forms.ts:JsonForms.#nominal, boundary/json-forms.ts:JsonForms.#opaque, boundary/json-forms.ts:JsonForms.#enum, boundary/json-forms.ts:JsonForms.#field, boundary/outcome-codecs.ts:recordOutcomeCodecs, flow/build/calls.ts:encodedOutcome
- witnesses/traits: boundary/host-boundary.ts:crossesToHost, boundary/json-forms.ts:JsonForms.#partMissing, boundary/json-forms.ts:JsonForms.codecOf, boundary/json-forms.ts:JsonForms.#declaresCodecs, disposal/disposal.ts:isDisposable, expansion/functions.ts:sitedEdges, kinds/data-kinds.ts:judgeNode, lifetimes/analysis/calls.ts:applySummary, lifetimes/analysis/calls.ts:checkWitnesses, lifetimes/analysis/operations.ts:handlers, lifetimes/analysis/operations.ts:dispatchedCall, lifetimes/composition.ts:boundBy, lifetimes/dispatch.ts:Dispatch.witnessesOf, lifetimes/dispatch.ts:Dispatch.#dispatchedOf, lifetimes/lifetimes.ts:Lifetimes.#calleesOf
- places/&refs: boundary/host-boundary.ts:checkHostBoundary, disposal/disposal.ts:checkDisposeDeclaration, disposal/dropped.ts:usesOf, disposal/must-use.ts:undroppable, flow/build/calls.ts:prepared, flow/build/expressions.ts:expressionFlows, flow/build/flow-builder.ts:FlowBuilder.valueAt, flow/build/implicit-calls.ts:emitCall, flow/build/literals.ts:declaredLiteral, flow/build/literals.ts:appendTo, flow/build/places.ts:enterPlace, flow/build/places.ts:stepInto, flow/build/places.ts:enterAssigned, flow/build/places.ts:rootPlace, flow/build/places.ts:writeElement, flow/build/statements.ts:assignment, flow/build/statements.ts:compound, lifetimes/analysis/bindings.ts:argumentBound, lifetimes/analysis/bindings.ts:ownedBy, lifetimes/analysis/body.ts:BodyAnalysis.inputNodeOf, lifetimes/analysis/body.ts:placeHolds, lifetimes/analysis/calls.ts:applySummary, lifetimes/analysis/calls.ts:checkRequirement, lifetimes/analysis/calls.ts:checkAt, lifetimes/analysis/calls.ts:reachesItself, lifetimes/analysis/calls.ts:written, lifetimes/analysis/given.ts:giveResult, lifetimes/analysis/operations.ts:handlers, lifetimes/analysis/operations.ts:assigned, lifetimes/analysis/places.ts:placeTarget, lifetimes/analysis/summarize.ts:effectOf, lifetimes/declared.ts:defaultsFound, lifetimes/externs.ts:keepsOf, lifetimes/lifetimes.ts:Lifetimes.#ownAnalysis, lifetimes/summary.ts:nativeSummary
- patterns: flow/build/control.ts:matchFlow, flow/build/control.ts:isFlow, flow/build/parts.ts:bindParameters, flow/build/parts.ts:bindTargets, flow/build/parts.ts:matchPattern, flow/build/parts.ts:readAlong, flow/build/parts.ts:matchChecked, flow/build/parts.ts:testPart, flow/build/parts.ts:patternValueOf, flow/build/parts.ts:bind, flow/build/statements.ts:declaration
- templates: computation/index.ts:Computation.#own, flow/build/literals.ts:template
- ranges: flow/build/literals.ts:range
- comparisons: flow/build/control.ts:binaryFlow, flow/build/control.ts:chainedComparison, flow/build/control.ts:compared, flow/build/parts.ts:testPart
- closures/lambdas: agreement.ts:agreedType, computation/index.ts:Computation.#lambda, disposal/disposal.ts:checkSelfStays, disposal/dropped.ts:DroppedUses.#operation, disposal/must-use.ts:undroppable, flow/build/calls.ts:closureMaking, flow/build/expressions.ts:closureOf, flow/build/expressions.ts:bodyValue, flow/build/flow-builder.ts:FlowBuilder.nested, flow/build/flow-builder.ts:FlowBuilder.captured, flow/build/flow-builder.ts:FlowBuilder.ownName, flow/build/statements.ts:statementFlows, kinds/data-kinds.ts:nestedOf, kinds/data-kinds.ts:judgeNested, lifetimes/analysis/bindings.ts:closureBindings, lifetimes/analysis/body.ts:BodyAnalysis.#reachesDisposable, lifetimes/analysis/calls.ts:calledBack, lifetimes/analysis/index.ts:analysisOf, lifetimes/analysis/index.ts:entryState, lifetimes/analysis/nodes.ts:Nodes.isCell, lifetimes/analysis/nodes.ts:inputSlots, lifetimes/analysis/operations.ts:madeClosure, lifetimes/analysis/operations.ts:checkEscaping, lifetimes/dispatch.ts:conversionsIn, lifetimes/type-reach.ts:heldOfFunction, lifetimes/type-reach.ts:handleReachOf, lifetimes/type-reach.ts:topHandlesOf
- testing (@Suite/mock/handle/@Waypoint): annotations.ts:Annotations.waypointOf, annotations.ts:Annotations.suiteTitleOf, annotations.ts:placements, disposal/disposal.ts:checkDisposeUses, testing.ts:checkTestingCalls, testing.ts:checkTarget, testing.ts:checkHandle, testing.ts:checkSuite, testing.ts:firstEffect
