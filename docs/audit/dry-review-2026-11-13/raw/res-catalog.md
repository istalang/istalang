## src/compiler/binder/bind.ts — Binder entry point: binds each module on its tree, then links the program
- bindProgram(program) — binds and links all module names of a Program (memoized per Program); [exp]; callers: 2 outside folder

## src/compiler/binder/constructs/declarations.ts — Binding names inside functions, lambdas, and top-level type declarations
- bindFunction(binder, node, scope) — binds type parameters, annotations, mark, parameters, return type, and body of fn/lambda; [exp]; callers: 1 outside folder
- bindParameters(binder, node, scope) — binds parameter types, defaults, patterns, and variable names in order; callers: 0 outside folder
- bindFieldDefaults(binder, owner, fieldsFunction, scope) — binds struct/variant field defaults, each seeing earlier fields; callers: 0 outside folder
- bindDefaults(binder, {node, parameters}, scope, define) — binds each parameter default before defining its name and noting scope; callers: 0 outside folder
- bindStruct(binder, node, scope) — binds a struct's type parameters, associated types, fields, and field defaults; callers: 0 outside folder
- bindAssociatedTypes(binder, node, scope) — declares and binds struct/enum associated types, checking enum variant clashes; callers: 0 outside folder
- declarationHandlers — Handlers table dispatching each Declaration kind to its binder; callers: 0 outside folder
- bindDeclaration(binder, node, scope) — binds non-generic annotations and dispatches a top-level declaration; [exp]; callers: 1 outside folder
- bindEnum(binder, node, scope) — binds an enum's type parameters, associated types, variant annotations, fields, and defaults; callers: 0 outside folder
- bindTrait(binder, node, scope) — binds Self, trait type parameters, required fields, required associated types, and methods; callers: 0 outside folder
- typeParameterScope(binder, node, scope) — creates nested scope with declaration's type parameters and binds its annotations; callers: 0 outside folder
- defineTypeParameters(binder, parameters, scope) — declares all type parameters then binds memberOf, constraints, and defaults; callers: 0 outside folder

## src/compiler/binder/constructs/expressions.ts — Binding names in expressions, qualified paths, and control-flow scopes
- bindNamed(binder, node, scope, role) — binds an identifier or TypeApplication target in the given role, else as expression; callers: 0 outside folder
- bindLiteral(binder, node, scope) — binds a struct literal's or indented value's type and field/comprehension/spread entries; callers: 0 outside folder
- expressionHandlers — Handlers table dispatching each Expression kind to its binder; callers: 0 outside folder
- bindRejectedAnnotations(binder, items, scope) — binds annotations on Invalid items inside match/select cases; callers: 0 outside folder
- bindExpression(binder, node, scope) — records visibility note and dispatches an Expression node; [exp]; callers: 1 outside folder
- bindAll(binder, nodes, scope) — binds the unwrapped value expression of each defined CallArgument; callers: 0 outside folder
- bindFieldValue(binder, name, value, scope) — binds a field initializer's value or uses its name for shorthand `{first}`; callers: 0 outside folder

## src/compiler/binder/constructs/patterns.ts — Binding references and target variable definitions in patterns
- patternHandlers — Handlers table dispatching each Pattern/PatternPart kind to its binder; callers: 0 outside folder
- bindPattern(binder, node, scope, bindings) — resolves pattern references in scope and defines bound variables into bindings; [exp]; callers: 1 outside folder
- bindAlternatives(binder, alternatives, binding) — binds `A | B` alternatives in separate scopes and adopts shared variables; callers: 0 outside folder
- adopt(binder, into, first, variable) — reuses the first alternative's VariableEntity for a name or declares it in `into`; callers: 0 outside folder
- define(binder, bindings, name, node) — declares a pattern-bound variable owned by the target declaration or pattern node; callers: 0 outside folder

## src/compiler/binder/constructs/statements.ts — Binding blocks and statements with non-hoisted lexical scoping
- statementHandlers — Handlers table dispatching each Statement kind to its binder; callers: 0 outside folder
- declaredNames — Handlers table listing identifiers each Statement declares directly in its block; callers: 0 outside folder
- bindBlock(binder, block, parent) — pre-notes block declarations for used-before-declaration, binds statements, ends scope; [exp]; callers: 1 outside folder
- spanThrough(binder, item) — returns item's span including a FunctionDeclaration's held body; [exp]; callers: 0 outside folder
- bindVariableValue(binder, node, scope) — binds a variable's or context constant's written type and initializer; [exp]; callers: 0 outside folder
- bindTargets(binder, node, scope, into) — binds a VariableDeclaration's target patterns into `into`; [exp]; callers: 0 outside folder
- bindAssignmentTarget(binder, target, scope) — binds an assignment target variable, place expression, or destructuring literal; callers: 0 outside folder

## src/compiler/binder/constructs/types.ts — Binding names in type nodes, alias bodies, type matches, and constraints
- typeHandlers — Handlers table dispatching each TypeNode kind to its binder; callers: 0 outside folder
- bindType(binder, node, scope) — records visibility note and dispatches a TypeNode; [exp]; callers: 1 outside folder
- bindAliasBody(binder, node, scope) — binds a type alias/associated type body (TypeNode or TypeMatch); [exp]; callers: 0 outside folder
- bindTypeCase(binder, node, scope) — declares `infer` variables in a TypeCase scope and binds its pattern and result type; callers: 0 outside folder
- bindStructType(binder, node, scope) — binds plain fields then mapped fields of an anonymous StructType; callers: 0 outside folder
- bindMappedField(binder, node, scope) — binds `[F in U]: T` with `U` in outer scope and `T` in `F`'s scope; callers: 0 outside folder
- bindConstraints(binder, constraints, scope) — binds trait and struct constraints after `is`; [exp]; callers: 0 outside folder
- bindStructConstraint(binder, constraint, scope) — checks struct constraint field names and binds entry types/constraints; callers: 0 outside folder
- bindFields(binder, fields, scope) — checks field member names for convention/duplicates and binds their types/annotations; [exp]; callers: 0 outside folder

## src/compiler/binder/diagnostics.ts — Binder diagnostic catalog (codes 4000–4020)
- binderDiagnostics — typed diagnostic factories for name binding and linking errors; [exp]; callers: 6 outside folder

## src/compiler/binder/entities.ts — Binder output contract: Entity union, memoized entity constructors, and Bindings queries
- VariableOwner — union of AST nodes (and OwnCall) that declare a VariableEntity; [exp]; callers: 4 outside folder
- VariableEntity — entity for a variable, constant, parameter, pattern binding, local fn, or named lambda; [exp]; callers: 18 outside folder
- localFunctionOf(variable) — returns the FunctionDeclaration or Lambda if `variable` is its own name; [exp]; callers: 6 outside folder
- FunctionsEntity — entity for a module's top-level overload set sharing a function name; [exp]; callers: 3 outside folder
- TypeEntity — entity for a nominal struct/enum/trait, type alias, associated type, or type parameter; [exp]; callers: 4 outside folder
- PrimitiveEntity — entity for a built-in primitive type name; [exp]; callers: 1 outside folder
- SelfEntity — entity for `Self` inside a TraitDeclaration; [exp]; callers: 0 outside folder
- VariantEntity — entity for a specific Variant of an EnumDeclaration; [exp]; callers: 12 outside folder
- VariantsEntity — placeholder entity for a bare name that may denote enum variants by expected type; [exp]; callers: 3 outside folder
- VariantNaming — union `VariantEntity | VariantsEntity` for qualified or bare variant references; [exp]; callers: 6 outside folder
- NamespaceEntity — entity for a `NamespaceImport` (`import * as m`); [exp]; callers: 5 outside folder
- Entity — discriminated union of all bound entity kinds; [exp]; callers: 37 outside folder
- Qualifier — entity that can qualify a dot-path (`NamespaceEntity` or enum `TypeEntity`); [exp]; callers: 2 outside folder
- qualifies(entity) — type guard testing if entity is a namespace or EnumDeclaration type; [exp]; callers: 2 outside folder
- isAlias(entity) — tests if entity is a `TypeAliasDeclaration` type entity; [exp]; callers: 1 outside folder
- namesType(entity) — type guard testing if entity is `type`, `primitive`, or `self`; [exp]; callers: 3 outside folder
- variableEntity(name, owner) — memoized constructor for a VariableEntity per Identifier node; [exp]; callers: 3 outside folder
- ownCallEntity(node, declared) — memoized constructor for an async function's hidden OwnCall variable; [exp]; callers: 1 outside folder
- typeEntity(declaration) — memoized constructor for a TypeEntity per declaration node; [exp]; callers: 7 outside folder
- selfEntity(trait) — memoized constructor for a TraitDeclaration's `Self` entity; [exp]; callers: 1 outside folder
- variantEntity(declaration, variant) — memoized constructor for a VariantEntity per Variant node; [exp]; callers: 2 outside folder
- namespaceEntity(declaration) — memoized constructor for a NamespaceEntity per NamespaceImport node; [exp]; callers: 1 outside folder
- functionsEntity(name, overloads) — sequence-memoized constructor for a FunctionsEntity per overload list; [exp]; callers: 1 outside folder
- Bindings — program-wide name resolution queries returned by `bindProgram`; [exp]; callers: 5 outside folder

## src/compiler/binder/link/index.ts — Cross-module linking: imports, prelude joining, free names, and qualified paths
- link(program, locals) — links per-module bindings across a Program into the `Bindings` surface; [exp]; callers: 1 outside folder
- Linker.visibleAt(module, offset) — builds visible name map at offset by layering variants, prelude, and linked locals; callers: 0 outside folder
- Linker.overloadsOf(functions) — joins a module's FunctionsEntity overloads with prelude overloads of the same name; callers: 0 outside folder
- Linker.#linkTopLevel(id) — links a module's named imports, checks prelude clashes, and validates test imports; callers: 0 outside folder
- Linker.#linkNames(id) — resolves a module's free names, refuses invalid function heads before `.`, and links paths; callers: 0 outside folder
- Linker.#index(id, local) — indexes entity owning modules, top-level entities, and enum variants across the program; callers: 0 outside folder
- Linker.#exported(module, name, links) — resolves an exported (or test-accessible private) entity from `module` or reports; callers: 0 outside folder
- Linker.#resolveFree(id, links, free) — resolves a free name to prelude, bare variants, or unseen ADL callee, or reports; callers: 0 outside folder
- Linker.#refuseFunctionHead(id, links, head) — reports `notOwnCall` when an imported/prelude function stands before `.`; callers: 0 outside folder
- Linker.#unseenFunction(id, name) — memoizes an empty FunctionsEntity per module item list for an ADL-only callee; callers: 0 outside folder
- Linker.#resolvePath(id, links, path) — walks a qualified path through namespaces and enums, reporting non-qualifiers; callers: 0 outside folder
- Linker.#member(current, part, role, links) — resolves the next part of a qualified path on a namespace or enum; callers: 0 outside folder
- Linker.#importedBy(namespace) — returns the ModuleId loaded by a NamespaceEntity's import declaration; callers: 0 outside folder

## src/compiler/binder/link/module-links.ts — Per-module linked state shared across linker helpers
- ModuleLinks — mutable per-module record of resolved free/path names, linked imports, refused names, and diagnostics; [exp]; callers: 0 outside folder
- resolvedImport(links, entity) — unwraps an ImportPlaceholder to its linked target entity or returns the entity; [exp]; callers: 0 outside folder

## src/compiler/binder/link/qualifiers.ts — Following plain type aliases to enums when resolving qualified names
- AliasLookup — seam providing moduleOf, topLevelNamed, and exportOf for following type aliases in the linker; [exp]; callers: 0 outside folder
- qualifierOf(lookup, entity) — follows plain type aliases (with cycle guard) to a namespace or enum Qualifier; [exp]; callers: 0 outside folder
- aliasedEntity(lookup, alias, declaration) — resolves the target entity of a non-generic plain-name TypeAliasDeclaration; callers: 0 outside folder

## src/compiler/binder/link/top-level-rules.ts — Top-level prelude clash and test-only import rules
- meetPrelude(links, prelude) — reports top-level declarations/imports that clash with non-overloadable prelude names; [exp]; callers: 0 outside folder
- checkTestImports(program, id, links) — reports imports of `testing` or `*.test.ista` modules from non-test modules; [exp]; callers: 0 outside folder

## src/compiler/binder/module/bind-module.ts — Single-module binding entry point, memoized per SyntaxTree
- ModuleBindings — single-module binding output combining ModuleScope and LocalResult; [exp]; callers: 3 outside folder
- bindModule(tree) — binds a module's top-level scope and all declarations in isolation (memoized per SyntaxTree); [exp]; callers: 1 outside folder

## src/compiler/binder/module/flow.ts — Flow-sensitive lexical scoping for `is`/`and`/`or` conditions, loops, and cases
- bindCondition(binder, node, scope) — binds condition expression and returns the scope where its `is` bindings hold; callers: 0 outside folder
- bindConditionValue(binder, node, scope) — binds an `is` or `and`/`or` used as a value and ends its flow bindings; [exp]; callers: 1 outside folder
- underCondition(binder, node, scope, body) — binds a conditional construct's body under its condition's flow scope; [exp]; callers: 2 outside folder
- underBindings(binder, node, scope, {define, body}) — binds a construct's body in a fresh scope populated by `define`; [exp]; callers: 1 outside folder
- underLoop(binder, node, scope, body) — binds `for`/comprehension iterable in outer scope and targets in body scope; [exp]; callers: 2 outside folder
- underFields(binder, node, scope, body) — binds field loop/comprehension subject outside and key/value in body scope; [exp]; callers: 2 outside folder
- bindingsStartOf(node) — returns the AnchoredSpan where a binding construct's own variables become visible; callers: 0 outside folder

## src/compiler/binder/module/local-binder.ts — Context and state accumulator for binding a single module's SyntaxTree
- Role — how a name is used (`'value' | 'type' | 'assignment' | 'callee'`); [exp]; callers: 1 outside folder
- FreeName — record of an unresolved identifier left for program linking; [exp]; callers: 1 outside folder
- QualifiedPath — record of a multi-part path left for program linking; [exp]; callers: 1 outside folder
- PathRole — where a qualified path stands (`'expression' | 'type' | 'named'`); [exp]; callers: 0 outside folder
- LocalResult — output of LocalBinder for one SyntaxTree; [exp]; callers: 0 outside folder
- holdsNoNames — no-op handler for AST node kinds that contain no names; [exp]; callers: 5 outside folder
- PatternBindings — destination scope and owning declaration for pattern-bound variables; [exp]; callers: 1 outside folder
- Walk — category entry callbacks wired by `bind-module.ts`; [exp]; callers: 0 outside folder
- LocalBinder — per-tree binder context recording entities, free names, paths, own calls, visibility, and diagnostics; [exp]; callers: 5 outside folder
- LocalBinder.result(topLevel) — packages LocalBinder accumulators into a LocalResult; callers: 0 outside folder
- LocalBinder.use(name, scope, role) — resolves an identifier in `scope`, or records it as a FreeName for linking; callers: 5 outside folder
- LocalBinder.useBeforeMember(name, scope) — resolves `name` before `.`, binding an enclosing async fn's OwnCall or reporting; callers: 1 outside folder
- LocalBinder.declare(scope, name, entity, rules) — records and defines `name` in `scope`, checking convention and clashes; callers: 3 outside folder
- LocalBinder.constructedType(type, scope) — binds a struct literal's or pattern's NamedType head as a value and its type args; callers: 3 outside folder
- LocalBinder.checkMemberNames(names, convention) — checks a field/variant/associated list for naming convention and duplicates; callers: 3 outside folder
- LocalBinder.#qualifyLater(parts, scope, role) — queues a multi-part path for linking when its head may qualify; callers: 0 outside folder
- LocalBinder.#ownCallOf(node) — memoizes and returns the OwnCall VariableEntity for an enclosing async function; callers: 0 outside folder

## src/compiler/binder/module/module-scope.ts — Defining a module's top-level declarations, imports, overload sets, and variants
- ModuleScope — a module's top-level scope, imports, enum variants, exports, and private declarations; [exp]; callers: 0 outside folder
- defineModuleScope(binder, module, parent) — defines all top-level items and enum variants of `module` before body binding; [exp]; callers: 0 outside folder
- TopLevelDefiner.defineItem(item) — defines one top-level declaration or import in the module scope; callers: 0 outside folder
- TopLevelDefiner.#define(name, entity, origin, convention) — declares a top-level name with import/declaration clash rules; callers: 0 outside folder
- TopLevelDefiner.#defineFunction(node) — defines the first overload of a top-level function set and records later ones; callers: 0 outside folder
- clashRule(previous, current) — selects duplicateImport, importClash, or duplicateDeclaration diagnostic factory; callers: 0 outside folder
- ownNames(topLevel) — partitions a module's non-import top-level entities into `exports` and `_`-prefixed `privates`; callers: 0 outside folder
- functionSets(module) — groups non-static top-level functions by name into FunctionsEntity overload sets; callers: 0 outside folder
- variantsOf(binder, module) — checks variant names and creates VariantEntity maps for every EnumDeclaration in `module`; callers: 0 outside folder

## src/compiler/binder/module/own-calls.ts — Helpers for an enclosing async function's own call (`fnName.disposing()`)
- noOwnCall(name, enclosing) — builds `mainNeverDisposed` or `notOwnCall` diagnostic for invalid function head before `.`; [exp]; callers: 1 outside folder
- functionsNamed(entity) — extracts the FunctionDeclaration/Lambda list from a local `functions` or `variable` entity; [exp]; callers: 0 outside folder

## src/compiler/binder/module/scope.ts — Lexical Scope chain, definition numbering for snapshots, and miss explanations
- ImportPlaceholder — module-local placeholder entity for a named import before linking; [exp]; callers: 1 outside folder
- importPlaceholder(imported, declaration) — memoized constructor for an ImportPlaceholder per ImportedName node; [exp]; callers: 0 outside folder
- LocalEntity — union `Entity | ImportPlaceholder` stored in module-local scopes; [exp]; callers: 1 outside folder
- Miss — reason a name is absent from scope (`'pending' | 'ended' | 'underOr'`); [exp]; callers: 0 outside folder
- ScopeSnapshot — a Scope paired with the definition counter `at` when the snapshot was taken; [exp]; callers: 0 outside folder
- Scope — lexical scope tracking definitions, definition numbers, miss reasons, and enclosing functions; [exp]; callers: 5 outside folder
- Scope.enclosingOf(functions) — finds the innermost enclosing function scope matching one of `functions`; callers: 0 outside folder
- Scope.define(name, entity) — defines `name` in this scope if absent, numbering it and clearing any miss note; callers: 1 outside folder
- Scope.visibleIn({scope, at}) — reconstructs the map of names defined at or before `at` along the scope chain; callers: 0 outside folder
- Scope.endUpTo(ancestor) — marks names defined below `ancestor` as `'ended'` on the nearest enclosing block scope; callers: 1 outside folder
- Scope.definedSince(ancestor) — lists all names defined in scopes from `this` up to `ancestor`; callers: 2 outside folder
- universe() — creates the root scope populated with the built-in primitive types; [exp]; callers: 0 outside folder

## src/compiler/binder/module/visibility.ts — Offset-based scope visibility queries for editor completion
- Visibility — query interface returning the map of visible local entities at a source offset; [exp]; callers: 0 outside folder
- VisibilityNotes — records per-node scope snapshots during binding and answers offset visibility queries; [exp]; callers: 0 outside folder
- VisibilityNotes.note(node, scope, start) — records a scope snapshot for `node` starting at `start` (and trailing notes); callers: 0 outside folder
- VisibilityNotes.visibility(topLevel) — builds the `Visibility` query over recorded node and trailing notes; callers: 0 outside folder
- latestStarted(notes, offset) — finds the last note in `notes` whose start offset is `<= offset`; callers: 0 outside folder
- goesOn(tree, offset, {node, start}) — tests if `offset` continues an empty node or body after blank/comment lines; callers: 0 outside folder

## src/compiler/binder/naming.ts — Naming convention and undeclared-name diagnostic helpers for the binder
- namingViolation(name, convention) — returns diagnostic if `name` is a built-in type name or breaks camel/PascalCase; [exp]; callers: 1 outside folder
- undeclaredName(name, isAssigned) — returns assignmentToUndeclared, lowercasePrimitive, or undeclared diagnostic; [exp]; callers: 1 outside folder

## src/compiler/checker/check.ts — Checker entry point and public surface contracts read by lowering and editor tooling
- VariantMember — resolved enum variant with its name and substituted FieldMember list; [exp]; callers: 7 outside folder
- Disposal — who disposes a nominal type (`none`, `runtime`, or `function` with its FunctionCall); [exp]; callers: 3 outside folder
- Kept — extern function parameter lifetime retention record (`holder` index and `kept` indices); [exp]; callers: 1 outside folder
- CheckedConstant — checked top-level constant (`type` and computed `ConstantForm`); [exp]; callers: 3 outside folder
- ContextConstantQueries — queries for `ista const` declarations (`typeOf`, `bodyOf`); [exp]; callers: 1 outside folder
- Checker — program-wide type-checking surface consumed by lowering and language-service; [exp]; callers: 47 outside folder
- CheckProgramOptions — options for `checkProgram` (`previous`, `tentative`, `observe`); [exp]; callers: 0 outside folder
- checkProgram(program, options) — returns the memoized `Checker` for `program`, taking over unchanged entries from `previous`; [exp]; callers: 7 outside folder
- TraitObjects — queries for calling, reading, converting, and downcasting `any` trait object values; [exp]; callers: 2 outside folder
- MemberConversion<Shape> — `{ called, met }` pair for variance-adapted trait object calls and field reads; [exp]; callers: 2 outside folder
- SignatureParameter — a declared function's parameter with resolved `type`, `reference`, and `rest` slot; [exp]; callers: 24 outside folder

## src/compiler/checker/resolution/applying/applied-call.ts — Choosing, instantiating, and fitting written and implicit calls
- CallApplication — request to choose and complete a call among candidates with arguments and expected type; [exp]; callers: 2 outside folder
- AppliedCall — result of applying a call (`application`, `instantiation`, `filled` parameter types, `result`); [exp]; callers: 0 outside folder
- applyCall(context, request) — chooses and immediately completes a call in one step; [exp]; callers: 0 outside folder
- chooseCall(context, request, {reports}) — filters union trait calls, runs overload choice, reports ambiguity/none, advises result; [exp]; callers: 1 outside folder
- completeCall(context, request, application) — instantiates chosen call, closes union trait calls, fits arguments, records keys; [exp]; callers: 1 outside folder
- ambiguity(checker, request, tied) — builds `severalTraits` diagnostic for tied union trait calls or `ambiguousCall`; callers: 0 outside folder

## src/compiler/checker/resolution/applying/argument-fit.ts — Fitting call arguments to instantiated parameter slots and recording key literals
- FittedArgument — argument descriptor for `fitArguments` and `recordArgumentKeys`; [exp]; callers: 0 outside folder
- filledTypes(rules, {slots}, substitution, count) — substitutes the parameter slot type filled by each of `count` arguments; [exp]; callers: 1 outside folder
- recordArgumentKeys(context, argumentList, {application, instantiation}) — records String literal arguments filling `keyof` parameters; [exp]; callers: 0 outside folder
- fitArguments(context, argumentList, expected) — fits each non-spread argument (or records deferred call) to its parameter type; [exp]; callers: 1 outside folder
- argumentListText(argumentList) — formats argument types (`&T`, `_` for decided) for overload diagnostics; [exp]; callers: 1 outside folder
- withSolvedTypes(given, solved) — maps `solved` over each argument's type once its constraint scope settles; [exp]; callers: 2 outside folder

## src/compiler/checker/resolution/applying/call-kinds.ts — Proposal 8 call-rule checking (`live`/`ista`/`simple` marks) on calls and closures
- kindOfCall(checker, call) — computes the instantiated mark `Type` of a `ResolvedCall` (including requirement substitution); callers: 0 outside folder
- judgedCall(context, made) — builds `ResolvedCall` via `callMade` and checks call/data marks for it and its witnesses; [exp]; callers: 1 outside folder
- markMaking(checker, made, start) — computes least mark `>= start` allowing `call`, its witnesses, and its type args, or reports; [exp]; callers: 2 outside folder
- leastMarkMaking(checker, call) — returns least mark from `"simple"` up that can make `call`, or `undefined` if kinds meet; [exp]; callers: 1 outside folder
- handledBy(checker, frame, type) — marks a nested function frame as relying on its code kind when `type` has value kinds; [exp]; callers: 2 outside folder
- CallOfKind — descriptor for checking a single call against its caller frame's code kind; [exp]; callers: 0 outside folder
- checkCallKind(context, call) — checks that caller frame's mark admits `calleeKind` and notes `relyOnKind`, or reports; [exp]; callers: 3 outside folder
- kindText(kind) — formats a mark type as its literal string (`live`/`ista`) or `typeText`; [exp]; callers: 3 outside folder
- callerName(frame) — formats the caller's name (`'fnName'`, `'a lambda'`, or `'this code'`) for diagnostics; [exp]; callers: 1 outside folder

## src/compiler/checker/resolution/applying/implicit.ts — Resolving and recording implicit language-construct and prelude calls
- ImplicitCalls — per-pass body table recording implicit `ResolvedCall`s by AST node and `ImplicitRole`; [exp]; callers: 2 outside folder
- ImplicitRequest — request for an extensible implicit protocol call (`iterate`, `setIndex`, `compare`, etc.); [exp]; callers: 1 outside folder
- ImplicitOperand — operand `{ type, node }` for `implicitOperatorCall`; [exp]; callers: 1 outside folder
- ImplicitOperatorRequest — request for an implicit `compare` or `includes` operator call; [exp]; callers: 0 outside folder
- PreludeRequest — request for a prelude-owned helper call (`length`, `_patternItem`, `panic`, `join`, etc.); [exp]; callers: 0 outside folder
- preludeCall(context, request) — resolves and records a prelude-owned implicit call, panicking if missing; [exp]; callers: 5 outside folder
- implicitOperatorCall(context, request) — resolves and records a `compare` or `includes` call for an operator; [exp]; callers: 2 outside folder
- implicitCall(context, request) — applies and records an implicit construct call, returning its result type; [exp]; callers: 3 outside folder
- applyImplicitCall(context, request) — applies an implicit call without recording it yet; [exp]; callers: 1 outside folder
- recordImplicitCall(context, request, applied) — judges an applied implicit call by the call rule and records it; [exp]; callers: 1 outside folder

## src/compiler/checker/resolution/applying/silent-choice.ts — Silent overload choice and instantiation for toolchain-synthesized calls
- silentCall(checker, candidates, callArguments) — silently chooses and instantiates a plain `FunctionCall` by arguments; [exp]; callers: 1 outside folder
- callWithTypes(checker, candidates, typeArguments) — silently chooses and instantiates a plain `FunctionCall` by type arguments; [exp]; callers: 2 outside folder
- functionCallOf(checker, application) — instantiates `application` at a silent search site and builds its `FunctionCall`; callers: 0 outside folder

## src/compiler/checker/resolution/calls/call-records.ts — Per-pass body table of resolved calls and considered candidates
- CallRecords — per-pass body table storing `ResolvedCall` and candidate `FunctionDeclaration[]` per `ResolvedSite`; [exp]; callers: 2 outside folder

## src/compiler/checker/resolution/calls/collection-functions.ts — Checking `setIndex` element writes and synchronous collection accessors
- ElementWrite — descriptor for a `setIndex(&container, key, element)` implicit call; [exp]; callers: 0 outside folder
- writeElement(context, write) — resolves and records a synchronous `setIndex` call for an element write; [exp]; callers: 1 outside folder
- runsAtOnce(context, call, at) — reports `asyncCollectionFunction` if `index` or `setIndex` returns a `Future`; [exp]; callers: 0 outside folder

## src/compiler/checker/resolution/calls/deferred-arguments.ts — Explaining unsendable captures on deferred calls (`g f(args)`)
- DeferredArgument — a `DeferredCall` node paired with the operands its deferred call computes now; [exp]; callers: 1 outside folder
- explainedCaptures(context, deferred, expected) — reports each unsendable value captured by `deferred` when `expected` is sendable; [exp]; callers: 1 outside folder

## src/compiler/checker/resolution/calls/operators.ts — Resolving unary and binary operators that call overloadable functions
- AppliedOperator — operator spelling paired with the function name it calls (`add`, `sub`, etc.); [exp]; callers: 0 outside folder
- binaryApplied(operator) — builds `AppliedOperator` for a calling binary operator; [exp]; callers: 1 outside folder
- unaryApplied(operator) — builds `AppliedOperator` for a calling unary operator; [exp]; callers: 1 outside folder
- applied(spelling, meaning) — pairs an operator token with its function name; [exp]; callers: 1 outside folder
- Operand — expression node and its checked `Type` for an operator call; [exp]; callers: 1 outside folder
- resolveOperator(context, site, operator, operands) — resolves a prefix/binary operator call via `resolveCall`; [exp]; callers: 2 outside folder

## src/compiler/checker/resolution/calls/places.ts — Mutability, `&`-reference aliasing, keyed fields, and element write-backs on places
- PlaceUse — whether a changing place is `'assigned'` or `'referenced'`; [exp]; callers: 0 outside folder
- checkChangedPlace(context, node, use) — checks `node` as an expression and validates that it is a changeable place; [exp]; callers: 2 outside folder
- changePlace(context, node, use) — validates trait fields, root mutability, element `setIndex` writes, and multi-keyed fields; callers: 0 outside folder
- referencesOneField(context, steps, use) — refuses passing a place by `&` through a struct key that may name several fields; callers: 0 outside folder
- severalKeyedFields(context, node) — returns the list of field types when `s[k]` indexes a struct by a multi-key type; [exp]; callers: 1 outside folder
- holdsFieldByTrait(context, type, name) — tests if `type` only has field `name` through a trait or `any` rather than a struct constraint; callers: 0 outside folder
- ReferencingCallee — callee metadata (`name`, `isAsync`, `slots`) for checking `&` arguments; [exp]; callers: 0 outside folder
- checkReferencedPlaces(context, written, callee) — checks `&` arguments for async accessors, overlapping elements, and shared handles; [exp]; callers: 2 outside folder
- placeIdentity(context, target) — computes static root variable and field/tuple step path of a place if known at compile time; callers: 0 outside folder
- stepName(context, step) — returns the static field, tuple element, or single-literal key name for a `PlaceStep`; callers: 0 outside folder
- placesOverlap(first, second) — tests whether one static `PlaceIdentity` is a prefix of the other on the same root; callers: 0 outside folder
- checkDistinctPlaces(context, parts) — reports duplicate or overlapping target places in a destructuring assignment; [exp]; callers: 1 outside folder
- accessorsOf(context, node) — lists `Dereference` root and element `Index` steps of a place; callers: 0 outside folder
- writesElement(context, node) — resolves synchronous `setIndex` write-back for a mutated indexed element step; callers: 0 outside folder
- changeReceiver(context, receiver) — validates a method's `&self` receiver as a referenced changing place; [exp]; callers: 1 outside folder
- immutableKind(owner) — returns `'a parameter'` or `'a const'` for mutability diagnostics; [exp]; callers: 1 outside folder
- requireChangeable(context, root, passedByReference) — checks that root variable is changeable and notes change/reference; callers: 0 outside folder

## src/compiler/checker/resolution/calls/resolve/explanations.ts — Diagnostics explaining why a call or overload failed
- explain(context, request, reason) — reports the specific `Inapplicability` reason when a single candidate fails; [exp]; callers: 2 outside folder
- explainNone(context, request, reasons) — reports why no candidate matched a call or operator; [exp]; callers: 0 outside folder
- ExplainedCall — subset of `CallRequest` needed to report an `Inapplicability`; [exp]; callers: 0 outside folder
- bindingReport(request, reason) — builds the diagnostic for a `BindingFailure` on a single candidate; callers: 0 outside folder
- packReport(request, reason) — builds the diagnostic for a `pack` or `packTypeArgument` failure; callers: 0 outside folder
- explainMisfits(context, request, misfits) — reports each argument misfit, falling back to `noMatchingOverload`; callers: 0 outside folder
- explainMisfit(context, argument, expected) — reports unsendable deferred captures, type misfit, or checks postponed placeholder; callers: 0 outside folder
- severalMembersReport(context, request, reason) — builds `severalMembersArgument` diagnostic for a `T in U` member parameter; callers: 0 outside folder

## src/compiler/checker/resolution/calls/resolve/index.ts — Resolving written calls in a body's constraint scope
- WrittenArgument — a written call argument with its node, passing, type, literal, name, spread, or deferred call; [exp]; callers: 5 outside folder
- CallRequest — full descriptor for resolving a written call, method call, or operator in a body; [exp]; callers: 0 outside folder
- resolveCall(context, request) — chooses a call, joins the active constraint scope, and schedules completion or error reporting; [exp]; callers: 4 outside folder
- chosenCall(context, request, {scope, openArguments}) — chooses among candidates, retrying with fixed defaults on open args; callers: 0 outside folder
- applicationOf(context, request, scope) — builds a `CallApplication` for `chooseCall` / `completeCall`; callers: 0 outside folder
- reportUnmade(context, request) — abandons open args and schedules post-solve error reporting for an unchosen call; callers: 0 outside folder
- completeResolved(context, request, applying, {chosen, frame}) — completes call after scope settles, records it, checks `&` places; callers: 0 outside folder
- callArgumentOf(argument) — converts a `WrittenArgument` to choosing's `CallArgument`; [exp]; callers: 1 outside folder
- appliedArgumentOf(argument) — converts a `WrittenArgument` to `CallArgument & { node }`; [exp]; callers: 1 outside folder
- Chosen — descriptor for `recordChosen`; [exp]; callers: 0 outside folder
- recordChosen(context, chosen) — builds and records a `ResolvedCall`, judging call kinds unless it is a function value or deferred; [exp]; callers: 1 outside folder

## src/compiler/checker/resolution/calls/resolve/written-expectations.ts — Recording expected parameter types on incomplete calls for completion
- expectWrittenArguments(context, request) — binds partial arguments leniently on a single-candidate call and records expected types; [exp]; callers: 0 outside folder

## src/compiler/checker/resolution/calls/stopped-operations.ts — Short-circuiting operations on `Never` or `error` operands
- StoppingOperand — `{ node, type }` operand in evaluation order; [exp]; callers: 2 outside folder
- stoppedOperation(context, operation, operands) — returns `errorType` or `neverType` (recording `stopAt`) if an operand has no value; [exp]; callers: 13 outside folder

## src/compiler/checker/resolution/choosing/applicability.ts — Testing whether a candidate takes given call arguments and inferring bounds
- Given — call arguments, written type arguments, binder, site, and scope inference passed to `takenBy`; [exp]; callers: 0 outside folder
- Taken — successful applicability result (`inference`, `binding`, `slots` by argument index); [exp]; callers: 2 outside folder
- takenBy(checker, takes, given) — binds arguments and runs type inference against `takes`, returning `Taken | Inapplicability`; [exp]; callers: 1 outside folder
- reshapesArguments(checker, {inference, slots}, callArguments) — tests if any argument requires a reshaping conversion; [exp]; callers: 0 outside folder
- writtenFor({typeParameters}, written) — maps explicit type arguments to type parameters in order; [exp]; callers: 1 outside folder
- typeArgumentsInapplicability({typeParameters}, written) — checks explicit type argument count and pack tuple requirement; [exp]; callers: 0 outside folder
- argumentsInapplicability(callArguments, bound, inference) — matches non-placeholders, packs, then placeholders against slots; callers: 0 outside folder
- judgedArgument(index, argument, slots, inference) — checks passing mode and matches one argument against its parameter slot; callers: 0 outside folder
- typedFits(slot, argument, type, inference) — dispatches `matchReceiver`, `matchExactly`, `matchLiteral`, or `match`; callers: 0 outside folder

## src/compiler/checker/resolution/choosing/binding.ts — Binding positional, named, spread, and deferred arguments to parameter slots
- BoundSlot — parameter descriptor for argument binding (`name`, `hasDefault`, `rest`, `type`); [exp]; callers: 1 outside folder
- BoundArgument — argument descriptor for argument binding (`name`, `isSpread`, `isDeferred`); [exp]; callers: 0 outside folder
- BindingFailure — union of reasons arguments fail to bind to parameter slots; [exp]; callers: 2 outside folder
- Binder — function signature binding `BoundSlot[]` and `BoundArgument[]` into `Binding | BindingFailure`; [exp]; callers: 0 outside folder
- positionalCounts(slots) — returns minimum and maximum positional argument counts for `slots`; [exp]; callers: 1 outside folder
- bindArguments(slots, callArguments) — binds positional, named, and deferred arguments to parameter slots; [exp]; callers: 3 outside folder
- bindValue(slots, callArguments) — binds positional arguments of a function value type to parameter slots; [exp]; callers: 1 outside folder
- bindByPosition(slots, positional) — binds positional arguments to fixed parameters and collects extras/spreads into rest; callers: 0 outside folder
- bindByName(slots, sources, named) — binds named arguments to matching slots, reporting unknown, pack, or duplicate names; callers: 0 outside folder
- bindDeferred(slots, sources, deferred) — binds deferred call arguments to unfilled `fn()` parameter slots; callers: 0 outside folder
- filled(slots, sources, byName) — fills remaining slots with defaults or empty rest, or returns `missing`/`arity` failure; callers: 0 outside folder
- argumentSlotsOf(slots, binding) — maps each bound argument index to the `ParameterSlot` it fills; [exp]; callers: 1 outside folder
- isBinding(bound) — type guard testing whether `bound` is a `Binding` array rather than a `BindingFailure`; [exp]; callers: 3 outside folder

## src/compiler/checker/resolution/choosing/call-arguments.ts — Shared types for candidate parameter slots, call arguments, and inapplicability
- SignatureSlot — parameter slot with `name`, `isReceiver`, `hasDefault`, and `rest`; [exp]; callers: 2 outside folder
- Takes — `{ typeParameters, parameters }` signature shape accepted by `takenBy`; [exp]; callers: 1 outside folder
- Passing — argument passing mode (`'value' | 'reference' | 'receiver'`); [exp]; callers: 3 outside folder
- CallArgument — argument descriptor passed to overload resolution; [exp]; callers: 7 outside folder
- Misfit — `{ index, expected }` record for an argument that failed to fit its parameter slot; [exp]; callers: 1 outside folder
- Inapplicability — discriminated union of all reasons a candidate cannot take a call's arguments; [exp]; callers: 3 outside folder

## src/compiler/checker/resolution/choosing/calls-made.ts — Constructing `ResolvedCall` records from chosen applications and instantiations
- callMade(application, instantiation) — builds a `'function'` or `'requirement'` `ResolvedCall` from an application and instantiation; [exp]; callers: 4 outside folder

## src/compiler/checker/resolution/choosing/candidates.ts — Candidate lookup: scope, ADL, type-parameter requirements, union traits, statics, witnesses
- Candidate — a candidate `FunctionDeclaration` and optional `Requirement` origin; [exp]; callers: 9 outside folder
- StaticTarget — owner or constrained type target for static function lookup; [exp]; callers: 0 outside folder
- topLevelCandidates(checker, module, name, argumentTypes) — finds in-scope, ADL, requirement, and union-trait candidates; [exp]; callers: 10 outside folder
- traitCallCandidates(checker, module, name, argumentTypes) — finds union-trait call candidates when first arg is a union; callers: 0 outside folder
- visibleTraits(checker, module) — lists traits declared in `module` or exported by modules `module` sees; callers: 0 outside folder
- callCandidates(checker, named, name, argumentTypes) — combines `named` functions with ADL and requirement candidates; [exp]; callers: 2 outside folder
- callableThrough(checker, callee, methods) — filters out `&self` methods when `callee` is not a place; [exp]; callers: 2 outside folder
- namedInModule(checker, module, name) — returns top-level function overloads of `name` in `module` joined with prelude; [exp]; callers: 2 outside folder
- staticCandidates(checker, module, target, name) — finds static function candidates of `name` on `target` visible from `module`; [exp]; callers: 2 outside folder
- modulesSeenFrom(checker, module) — returns `[module, ...importedBy(module), prelude]`; [exp]; callers: 1 outside folder
- witnessCandidates(checker, type, {required, parameterTypes}) — finds coherent witness candidates declared beside `type` or the trait; [exp]; callers: 2 outside folder
- staticCandidatesIn(checker, modules, target, name) — finds static candidates on a constrained or owner `StaticTarget`; callers: 0 outside folder
- staticFunctionsAmong(checker, modules, target) — lists all static functions on `target.owner` in `modules` and its declaring module; [exp]; callers: 1 outside folder
- argumentDependent(checker, name, argumentTypes) — lists exported functions named `name` from the declaring modules of `argumentTypes`; callers: 0 outside folder
- exportedFunctions(checker, module, name) — returns exported function overloads of `name` in `module`; callers: 0 outside folder
- requirementCandidates(checker, name, argumentTypes) — lists non-static trait requirements named `name` on type params/`any`/computed types; callers: 0 outside folder
- staticTargetOf(checker, type) — builds the `StaticTarget` (`owner` or `constrained`) for static calls on `type`; [exp]; callers: 2 outside folder

## src/compiler/checker/resolution/choosing/choice.ts — Overload resolution and specificity ranking among candidates
- Signature — candidate signature with mapped `typeParameters`, `parameters`, lazy `result()`, and lazy `kind()`; [exp]; callers: 4 outside folder
- Application — applicable candidate with its `Signature` and `Taken` inference/binding/slots; [exp]; callers: 7 outside folder
- Choice — overload choice outcome (`chosen`, `none` with reasons, or `several` tied); [exp]; callers: 2 outside folder
- signatureOf(checker, declaration, substitution, inferred) — builds `Signature` for `declaration`, memoizing unmapped parameter slots; [exp]; callers: 4 outside folder
- candidateSignature(checker, candidate) — builds `Signature` for `candidate` with its requirement substitution and inferred params; [exp]; callers: 3 outside folder
- slotsOf(parameters, receives, substitution, rules) — maps `SignatureParameter[]` to substituted `SignatureSlot[]`; callers: 0 outside folder
- choose(checker, candidates, callArguments, options) — chooses the best candidate for a call's arguments and type arguments; [exp]; callers: 3 outside folder
- chooseAsValue(checker, candidates, callArguments, options) — chooses the best candidate for a function value or witness; [exp]; callers: 1 outside folder
- chosenAmong(checker, candidates, given) — filters applicable candidates and ranks by specificity and tie-breakers; callers: 0 outside folder
- isMoreSpecific(checker, first, second) — tests if `second`'s instantiated parameter types hold `first`'s and not vice versa; callers: 0 outside folder
- applicationOf(checker, candidate, given) — tests applicability of `candidate` against `given`; callers: 0 outside folder

## src/compiler/checker/resolution/choosing/named-functions.ts — Choosing and instantiating functions and variant constructors named as values
- NamedFunctions — functions named by an expression (`site`, `name`, `candidates(expected)`, `written` type args); [exp]; callers: 1 outside folder
- FunctionNaming — AST node naming a function value (`Identifier | MemberAccess | TypeApplication`); [exp]; callers: 2 outside folder
- namedFunctions(context, node) — resolves `node` to the top-level, static, or variant constructor functions it names; [exp]; callers: 5 outside folder
- namedBy(context, site, entity) — builds `NamedFunctions` for a `functions` or `variant`/`variants` entity; callers: 0 outside folder
- topLevelFunctions(context, site, entity) — builds `NamedFunctions` for a top-level overload set (with ADL from expected fn params); callers: 0 outside folder
- variantConstructors(context, site, naming) — builds `NamedFunctions` for a qualified or bare variant's constructor; callers: 0 outside folder
- openedValue(context, named, shape) — chooses `named` against `shape`'s parameters leaving its inference variables open in result; [exp]; callers: 1 outside folder
- chosenValue(context, named, shape) — chooses `named` against `shape`'s parameters, falling back to `loneFunction`; [exp]; callers: 1 outside folder
- MadeValue — instantiated function value (`instantiation` and `FunctionType`); [exp]; callers: 1 outside folder
- instantiatedValue(context, application, site, result) — advises `application` with expected `result` and instantiates it as a value; [exp]; callers: 1 outside folder
- madeValue(context, application, site) — instantiates `application`, computes its `markMaking` mark, and builds its `FunctionType`; [exp]; callers: 1 outside folder
- valueTypeOf({signature, binding}, placed, mark) — builds the `FunctionType` of an application from its bound argument slots and pack; callers: 0 outside folder
- functionsAccepted(context, named) — returns `Admits` predicate testing which expected function types `named` can take; [exp]; callers: 2 outside folder
- takesValue(context, named, shape, isOpen) — tests if `named` chooses a function for `shape` whose instantiated value fits `shape`; callers: 0 outside folder
- takesCount(context, named, shape) — tests if any candidate of `named` accepts `shape`'s parameter count and passing modes; callers: 0 outside folder
- loneFunction(context, named, shape) — returns the sole applicable candidate when non-generic or fixed by written type arguments; callers: 0 outside folder
- ownChoice(context, candidate, {written}) — tests if `candidate` can be chosen on its own from `written` type arguments and defaults; [exp]; callers: 1 outside folder
- ownArguments(slot, written, rules) — builds synthetic `CallArgument[]` for `ownChoice` from a slot's declared/substituted type; callers: 0 outside folder
- chosenFor(context, named, shape) — chooses among `named` candidates by passing `shape.parameters` as exact arguments; callers: 0 outside folder

## src/compiler/checker/resolution/choosing/packs.ts — Matching variadic type pack rest arguments during overload applicability
- packItems(takes, binding) — returns the set of argument indices bound to pack rest parameters; [exp]; callers: 0 outside folder
- packInapplicability(takes, binding, callArguments, inference) — matches pack rest args against pack params or returns `Inapplicability`; [exp]; callers: 0 outside folder
- packOf(items) — builds the tuple type (or spread pack type) filling a pack parameter from `items`; callers: 0 outside folder

## src/compiler/checker/resolution/choosing/receivers.ts — Probing whether a method's `self` accepts a receiver type and meets constraints
- takesAsSelf(checker, candidate, type) — probes whether `candidate` is a method whose `self` takes `type` and meets constraints; [exp]; callers: 2 outside folder
- selfInference(checker, candidate, type) — runs applicability on `candidate`'s `self` parameter alone with `type` as receiver; [exp]; callers: 1 outside folder
- meetsWhereFound(checker, parameters, inference) — checks that every inferred type parameter bound meets its closed constraints; callers: 0 outside folder

## src/compiler/checker/resolution/conformance/admits.ts — Admissibility check for type parameter bounds during inference settling
- admitting(checker, meets) — returns `Admits` callback checking member-union inclusion and closed trait constraints; [exp]; callers: 0 outside folder

## src/compiler/checker/resolution/conformance/conformance.ts — Instantiating generic calls and searching trait/struct conformance witnesses
- Instantiation — settled `typeArguments`, `substitution`, and `witnesses` for a generic call; [exp]; callers: 4 outside folder
- instantiate(site, application) — settles type arguments, resolves constraint witnesses, and notes reduction checks; [exp]; callers: 3 outside folder
- instantiateAt(site, application, search) — settles inference and resolves witnesses within `search`; callers: 0 outside folder
- witnessesOf(site, parameters, completion, search) — checks member/struct constraints and resolves trait witnesses for `parameters`; callers: 0 outside folder
- settlingAt(site, signature, search) — builds `Settling` policy with `admitting` and `kindsSettledAt` for `signature`; [exp]; callers: 3 outside folder
- meets(site, type, constraint) — checks whether `type` meets `constraint` (reporting at `site` if not); [exp]; callers: 4 outside folder
- witnessesFor(site, type, constraint) — returns the witness calls for `type` meeting `constraint` via `rootGoals`; [exp]; callers: 1 outside folder
- rootSearches — `RootGoals` implementation running root trait and struct constraint searches; [exp]; callers: 1 outside folder
- callWitnessesFor(site, type, constraint) — returns value-call witnesses for a union meeting `constraint` (skipping associated types); [exp]; callers: 0 outside folder
- conformWitnesses(site, type, constraint) — resolves witnesses distinguishing `'undeclared'` from `'failed'`; [exp]; callers: 0 outside folder
- conform(meeting, search, unmet) — checks derived lacking, field/associated shortfalls, and resolves required function witnesses; callers: 0 outside folder
- silentMeets(site, search) — builds a silent `Meets` judge for recursive/coinductive trait and struct checks; [exp]; callers: 1 outside folder
- lacks({site, type, constraint}, missing) — reports `notConforming` at `site` and returns `'failed'`; callers: 0 outside folder
- undeclaredWitness(meeting, derivation, search) — resolves an undeclared requirement via union members or trait derivation, or reports; callers: 0 outside folder
- throughMembers(meeting, members, search) — checks union member conformance coinductively and builds the dispatching witness call; callers: 0 outside folder
- functionWitnesses(meeting, search, unmet) — resolves witnesses for all required functions of a trait constraint; callers: 0 outside folder
- witnessOf(site, type, required, search) — chooses and instantiates a declared witness for one required function; callers: 0 outside folder
- witnessChosen(site, choice, {type, signature}, search) — instantiates chosen witness and verifies its result type and mark kind; callers: 0 outside folder

## src/compiler/checker/resolution/conformance/declared-witness.ts — Choosing declared witness functions and checking witness mark kinds
- declaresWitness(checker, type, constraint) — tests if `type` has a declared witness candidate for any function of `constraint`; [exp]; callers: 1 outside folder
- chooseWitness(checker, type, required) — looks up coherent witness candidates for `required` on `type` and chooses among them; [exp]; callers: 0 outside folder
- chooseWitnessAmong(checker, type, given, required) — filters candidates by mark kind and chooses by exact parameter types; [exp]; callers: 0 outside folder
- instanceMeetsKind(checker, required, call, self) — checks that an instantiated witness call's `leastMarkMaking` meets `required.kind()`; [exp]; callers: 0 outside folder
- meetsRequirementKind(checker, required, given, self) — checks Proposal 8 Rule 4 (simple, matching mark, or `self`'s value kind for unmarked); callers: 0 outside folder

## src/compiler/checker/resolution/conformance/default-witness.ts — Resolving `Default` (`default()`) witnesses
- defaultWitness(site, type) — returns the `ResolvedCall` for `type`'s `Default` witness, or `undefined`; [exp]; callers: 1 outside folder
- resolveDefault(site, type) — returns `ConformanceOutcome` (`met`, `undeclared`, or `failed`) for `type` meeting `Default`; [exp]; callers: 1 outside folder

## src/compiler/checker/resolution/conformance/derived-traits.ts — Compiler-derived traits table (`Sendable`, `DataKind`, `Encodable`, `Decodable`)
- Derivation — rule for a compiler-derived trait (`lacking` check and optional `derive` witness builder); [exp]; callers: 0 outside folder
- codecDerivation(direction) — builds the `Derivation` entry for `Encodable` (`'write'`) or `Decodable` (`'read'`); callers: 0 outside folder
- derivationOf(checker, trait) — looks up `trait` in the well-known derived traits table; [exp]; callers: 0 outside folder

## src/compiler/checker/resolution/conformance/kind-settling.ts — Default settling of unbound mark and sendability parameters at a call site
- kindsSettledAt(site, signature, settling) — wraps `settling` so unbound mark/sendability parameters settle to their least allowed mark; [exp]; callers: 0 outside folder

## src/compiler/checker/resolution/conformance/met-instantiations/index.ts — Finding trait instantiations a type meets through variance for `any`
- searchMetInstantiation(checker, found, constraint) — finds the closest instantiation of `constraint`'s trait that `found` meets; [exp]; callers: 1 outside folder
- memberConstraint(checker, found, constraint) — returns the `Constraint` instantiation `found` is called through inside `any`; [exp]; callers: 1 outside folder
- fittingInstantiations(checker, found, constraint) — lists proposed instantiations of `constraint`'s trait that fit `constraint` and are met; callers: 0 outside folder
- proposedInstantiations(checker, {found, trait}, kept) — returns met/proposed instantiations of `trait` for `found` (caching nominal declarations); [exp]; callers: 1 outside folder
- instantiationsOf(checker, found, trait) — proposes instantiations of `trait` for `found` and filters to met ones when closed; [exp]; callers: 1 outside folder
- proposedFor(checker, found, sought) — collects distinct known constraints and witness-implied instantiations for `sought`; callers: 0 outside folder
- instantiationsMet(checker, found, sought) — combines parameter bindings across all required functions and fields of `sought.trait`; callers: 0 outside folder
- proposalOf(checker, found, binding, sought) — builds a `ProposedInstantiation` from a consistent parameter `Binding`; callers: 0 outside folder

## src/compiler/checker/resolution/conformance/met-instantiations/witness-bindings.ts — Inferring trait and receiver type arguments from witness signatures
- candidateBindings(checker, found, requirement) — collects trait parameter bindings from all witness candidates of `requirement`; [exp]; callers: 0 outside folder
- bindingsOf(checker, {reported, unknown, leftOpen}, pairs) — matches `[declared, given]` type pairs exactly to extract `Binding`; [exp]; callers: 0 outside folder
- agreed(first, second) — merges two `Binding` maps if they agree on all shared keys; [exp]; callers: 0 outside folder
- Binding — `ReadonlyMap<ParameterKey, Type>` mapping trait/type parameters to inferred types; [exp]; callers: 0 outside folder
- candidateBinding(checker, candidate, requirement) — infers a `Binding` from `candidate`, trying fixed receiver params before free ones; callers: 0 outside folder
- bindingAs(checker, candidate, requirement, found) — matches a witness candidate's parameters and result against `requirement`; callers: 0 outside folder

## src/compiler/checker/resolution/conformance/root-goals.ts — Program-wide `Entries` memoization and diagnostic replay for root conformance goals
- programRootGoals(checker, searches) — wraps `searches` in `KeptGoals` entry tables for root trait and struct goals; [exp]; callers: 1 outside folder
- KeptGoals.found(site, goal) — looks up or computes `goal` in `#goals` (bypassing if cyclic) and replays diagnostics at `site`; callers: 0 outside folder
- KeptGoals.#searched({goal, toHost}) — runs `search` with a recording `UseSite` and captures its diagnostics; callers: 0 outside folder

## src/compiler/checker/resolution/conformance/shortfalls.ts — Checking required fields, associated types, and struct constraints (with entailment)
- Meets — conformance callback with coinductive `enter(type, goal, step)` and `reportEndless()`; [exp]; callers: 1 outside folder
- fieldShortfall(checker, type, constraint) — returns diagnostic clause for the first required field `type` lacks; [exp]; callers: 0 outside folder
- associatedShortfall(checker, type, constraint, meets) — returns diagnostic clause for the first required associated type or bound `type` lacks; [exp]; callers: 0 outside folder
- boundShortfall(checker, {requirement, associated, substitution}, meets) — checks an associated type against its `in` union, trait, and struct bounds; callers: 0 outside folder
- structShortfall(checker, type, model, meets) — returns diagnostic clause if `type` fails struct constraint `model` (coinductive on structs); [exp]; callers: 1 outside folder
- fieldsShortfall(checker, {type, target}, model, meets) — checks a concrete struct's fields against `model.named` and `model.others`; callers: 0 outside folder
- ruleShortfall(checker, field, rule, meets) — checks one field against an exact type or `meets` constraint set; callers: 0 outside folder
- opaqueShortfall(checker, type, model, meets) — checks an opaque type's known struct constraints for entailment of `model`; callers: 0 outside folder
- knownShortfall(checker, model, meets, {known, ...words}) — checks whether `KnownFields` entail `model`'s named and other rules; callers: 0 outside folder
- knownFields(models) — merges a list of `StructConstraintModel`s into combined `KnownFields`; callers: 0 outside folder
- entailed(checker, given, needed, meets) — tests whether a field meeting all `EntryRule`s in `given` necessarily meets `needed`; callers: 0 outside folder
- structEntailed(checker, given, needed, meets) — tests whether struct constraints `given` entail struct constraint `needed`; callers: 0 outside folder
- StructJudge — callback `(argument, model) => boolean` for judging a struct constraint; [exp]; callers: 0 outside folder
- meetsStructConstraints(site, parameter, {argument, substitution}, judge) — checks `argument` against all struct constraints on `parameter`; [exp]; callers: 1 outside folder
- meetsStructModel(site, argument, model, meets) — checks `argument` against `model` via `structShortfall` and reports if unmet; [exp]; callers: 0 outside folder

## src/compiler/checker/resolution/conformance/trait-calls.ts — Filtering and closing trait calls on unions
- metThroughTraits(checker, candidates) — keeps union-trait candidates met through members or replaces them with whole-union functions; [exp]; callers: 2 outside folder
- mayMeetThroughMembers(site, origin, inferred) — probes if a union can meet a trait with `errorType` standing for `inferred` params; callers: 0 outside folder
- reachedThrough(site, origin) — returns `'members'`, a whole-union `FunctionDeclaration`, or `undefined` for a union trait call; callers: 0 outside folder
- ClosedTraitCall — result of closing a union trait call (`'members'` or `'declared'`); [exp]; callers: 0 outside folder
- closedThroughMembers(site, candidate, inferred, instantiation) — closes a union trait call with its inferred trait arguments; [exp]; callers: 1 outside folder

## src/compiler/checker/resolution/conformance/trait-objects.ts — `any` trait object conformance, union absorption, and member conversions
- meetsAny(checker, found, target) — tests whether `found` (or every union member) meets each constraint of `target` (up to variance); [exp]; callers: 1 outside folder
- absorbs(checker, found, target) — tests whether `target` (`AnyType`) absorbs union member `found` by exact conformance; [exp]; callers: 1 outside folder
- meetsEach(checker, {found, target}, meetsOne) — tests `meetsOne` for every constraint of `target` across `found` or its union members; callers: 0 outside folder
- reportUnmet(site, found, target) — reports the first unmet or ambiguous constraint when converting `found` to `target`; [exp]; callers: 1 outside folder
- traitObjectsOf(checker) — builds the `TraitObjects` surface queries for `checker`; [exp]; callers: 1 outside folder
- requiredSubstitution(met, self, {required, typeArguments}) — builds substitution mapping trait params, `Self`, and method type params; callers: 0 outside folder
- memberConstraints(checker, {type, constraint, member}) — returns `{ called, met }` constraints for `member` inside `type`; callers: 0 outside folder
- meetsMember(checker, {type, constraint, member}) — tests if `member` has a met instantiation for `type`'s `constraint`-th trait; callers: 0 outside folder

## src/compiler/checker/resolution/conformance/union-traits.ts — Dispatching trait calls across union members (§6)
- MembersCall — candidate calling a trait requirement across a union's members; [exp]; callers: 0 outside folder
- MembersMeeting — descriptor for checking a union meeting a trait requirement through its members; [exp]; callers: 0 outside folder
- traitMetBy(through, type, rules) — applies `through`'s single constraint to `type` as `Self`; [exp]; callers: 1 outside folder
- membersShortfall(checker, {union, through, declaration}, memberMeets) — checks object safety and every union member meeting `through`; [exp]; callers: 0 outside folder
- membersCall(rules, union, through, call) — builds a `MembersCall` candidate for the `member`-th function of `through` on `union`; [exp]; callers: 0 outside folder
- membersRequirementOf(candidate) — extracts `MembersRequirement` if `candidate` is a union member trait call; [exp]; callers: 2 outside folder
- traitCallsOn(checker, union, trait, name) — builds `MembersCall` candidates for functions named `name` taking `Self` first in `trait`; [exp]; callers: 1 outside folder
- traitAsCalled(checker, trait) — builds the initial `Constraint` for a union trait call, marking undefaulted params as `inferred`; callers: 0 outside folder
- takesSelfFirst(checker, written, declaration) — tests if `declaration` is a non-static function whose first parameter is `Self`; callers: 0 outside folder

## src/compiler/checker/resolution/conformance/witness-outcomes.ts — Witness search state, depth bound, and Tarjan lowlink memoization for coinductive goals
- maximumDepth — depth bound (`16`) for nested witness searches; [exp]; callers: 0 outside folder
- Failure — `'failed' | 'endless'`; [exp]; callers: 0 outside folder
- isFailure(outcome) — type guard testing if `outcome` is `'failed'` or `'endless'`; [exp]; callers: 0 outside folder
- WitnessOutcome — outcome of searching one required function's witness; [exp]; callers: 0 outside folder
- ConformanceOutcome — outcome of searching a constraint's witnesses (`met`, `undeclared`, `failed`); [exp]; callers: 0 outside folder
- Search — active conformance search state (`depth`, `goals`, `endless`); [exp]; callers: 0 outside folder
- startSearch() — creates a root `Search` at depth 0 with fresh `SearchGoals`; [exp]; callers: 0 outside folder
- deeper(search) — returns `search` at `depth + 1` sharing `goals`; [exp]; callers: 0 outside folder
- boundReached(search) — marks running goals bounded and returns `{ kind: 'endless' }`; [exp]; callers: 0 outside folder
- SearchGoals — per-search memoization table tracking coinductive hypotheses via Tarjan lowlink; [exp]; callers: 0 outside folder
- SearchGoals.witnesses(key, find) — solves or reuses a trait witness goal within the search; callers: 0 outside folder
- SearchGoals.witnessesReported(key, find) — solves a trait goal, re-running cached failures so the site reports them; callers: 0 outside folder
- SearchGoals.shortfall(key, step) — solves a coinductive struct/member shortfall goal, assuming active goals hold; callers: 0 outside folder
- SearchGoals.#solve(key, reusable, run) — runs `run` on the active goal stack or reuses a kept answer, propagating lowlinks; callers: 0 outside folder
- SearchGoals.#end(key, goal, answer) — settles provisional answers resting on `goal` (dropping if falsified) and caches `answer`; callers: 0 outside folder
- SearchGoals.#provisionalSince(goal) — splices provisional keys added since `goal` started that still rest on a hypothesis; callers: 0 outside folder
- SearchGoals.#keep(key, answer, goal) — stores `answer` in `#kept`, marking it provisional if `goal.lowest < goal.index`; callers: 0 outside folder
- endlessAt(site, search, type, constraint) — reports `endlessConformance` at depth 0 and returns `'endless'`; [exp]; callers: 0 outside folder
- meetsWith(site, search, check) — builds a `Meets` function with `enter` and `reportEndless` from `check`; [exp]; callers: 0 outside folder
- goalKey(keys, type, goal, key) — formats a canonical or spelled string key for `(type, Constraint | StructConstraintModel)`; [exp]; callers: 1 outside folder
- structModelKey(keys, model) — formats a string key for a `StructConstraintModel`; callers: 0 outside folder
- entryRuleKey(keys, rule) — formats a string key for an `EntryRule`; callers: 0 outside folder

## src/compiler/checker/resolution/type-matches/implied-constraints.ts — Extracting constraints implied by where an `infer` variable stands in a type pattern
- impliedConstraints(checker, tree, parameter) — returns trait and struct constraints implied on an `infer` TypeParameter by its pattern; [exp]; callers: 1 outside folder
- casePatternOf(checker, tree, parameter) — finds the resolved `CasePatternForm` of the `TypeCase` whose pattern declares `parameter`; callers: 0 outside folder
- usesIn(type) — collects all nominal, alias, and `any` trait type-argument uses within `type`; callers: 0 outside folder
- usesInStruct(model) — collects all type-argument uses within a `StructConstraintModel`'s entry rules; callers: 0 outside folder

## src/compiler/checker/resolution/type-matches/reduction-requirements.ts — Gathering and checking type `match` and associated type uses reached by an instantiation
- failureDiagnostic(queries, at, failure) — builds the diagnostic (`noCaseMatches`, `aliasCycle`, `recursiveField`, `associatedItself`) for an `UnreducedUse`; [exp]; callers: 1 outside folder
- ReductionRequirements — per-declaration entry table of open type `match`/associated uses and instantiation failure checker; [exp]; callers: 1 outside folder
- ReductionRequirements.failure(declaration, typeArguments) — substitutes `declaration`'s requirements and returns the first `UnreducedUse` failure; callers: 0 outside folder
- ReductionRequirements.#reached(type) — returns child types, unfolded recursive body, and nominal declaration requirements of `type`; callers: 0 outside folder
- ReductionRequirements.#found(declaration) — computes the open types held by `declaration` that contain type `match` or associated uses; callers: 0 outside folder
- ReductionRequirements.#held(declaration) — collects field, variant, default, and body types held by a non-alias declaration; callers: 0 outside folder
- ReductionRequirements.#defaultsReach(fields) — collects types reached by calls and bare fieldless structs in a fields function's defaults; callers: 0 outside folder
- ReductionRequirements.#functionTypes(declaration) — collects written types, result, call type args, and bare structs in a function; callers: 0 outside folder
- ReductionRequirements.#calledThrough(bodies) — collects type arguments and callee requirements from all calls in `bodies`; callers: 0 outside folder
- ReductionRequirements.#standsIn(type) — tests if `type` contains a `match` type, `associated` type, or nominal with requirements; callers: 0 outside folder

## src/compiler/checker/resolution/type-matches/type-match-patterns.ts — Matching a type `match` case pattern against a subject type and binding `infer` variables
- Outcome — `'match' | 'fail' | 'undecided'`; [exp]; callers: 0 outside folder
- matchCase(checker, pattern, variables, type) — matches `pattern` against `type` and checks `variables`' constraints; [exp]; callers: 1 outside folder
- matchPattern(matching, pattern, type) — dispatches `'any'`, `'type'`, or `'struct'` case pattern matching; callers: 0 outside folder
- matchWhole(matching, pattern, type) — matches `pattern` against `type`, falling back to `baseOf(type)` for a literal; callers: 0 outside folder
- tried(matching, attempt) — runs `attempt` and rolls back `matching.bound` if the outcome is not `'match'`; callers: 0 outside folder
- matchType(matching, pattern, type) — structural type pattern matcher handling `infer` variables, opaques, recursion, and unions; callers: 0 outside folder
- matchParts(matching, pattern, type) — matches two non-union types of the same kind part by part; callers: 0 outside folder
- matchUnion(matching, members, type) — matches a union pattern's fixed, structured-variable, and whole-variable members; callers: 0 outside folder
- firstMatched(matching, pattern, candidates) — finds the first candidate in a union that matches `pattern`; callers: 0 outside folder
- bindVariable(matching, variable, type) — binds an `infer` variable to `type` or checks equality with its existing binding; callers: 0 outside folder
- matchStruct(matching, constraint, type) — matches a `case struct …:` pattern against `type` and binds field `infer` variables; callers: 0 outside folder
- variableMeets(matching, {constraints}, type) — checks that a bound `infer` variable meets its written trait and struct constraints; callers: 0 outside folder
- all(outcomes) — combines a sequence of lazy `Outcome` steps, short-circuiting on `'fail'`; callers: 0 outside folder

## src/compiler/checker/resolution/type-matches/type-matches.ts — Reducing type `match` uses, distributing unions, and closing recursive type `match` cycles
- TypeMatchReductions — entry tables for reducing type `match` uses, detecting recursion verdicts, and closing recursive cycles; [exp]; callers: 1 outside folder
- TypeMatchReductions.reduce(declaration, typeArguments) — reduces a type `match` use, handling cycles, recursion closing, and caching; callers: 0 outside folder
- TypeMatchReductions.#closed(use) — closes a recursive group of type `match` uses via `closeRecursive` and checks finiteness; callers: 0 outside folder
- TypeMatchReductions.#recursionOf(key, use) — runs an isolated reduction pass to find recursion verdicts (`recursive` vs `itself`); callers: 0 outside folder
- TypeMatchReductions.#reachedAgain(scope, key, use) — records `'recursive'` or `'itself'` verdicts for all uses on an active cycle; callers: 0 outside folder
- TypeMatchReductions.#structCaseOf(use) — returns the `StructType` AST node if `use`'s matched case writes a struct type directly; callers: 0 outside folder
- TypeMatchReductions.#reduced(use) — distributes union subjects and reduces each member against the alias's `TypeMatchForm`; callers: 0 outside folder
- TypeMatchReductions.#memberReduced(declaration, form, substitution, member) — matches one subject member against cases and instantiates the winning case; callers: 0 outside folder
- reducingWith(scope, key, use, reduce) — runs `reduce` with `use` pushed onto `scope.underWay`; callers: 0 outside folder
- sameRecursion(first, second) — equality comparator for `Recursion` verdict maps across revisions; callers: 0 outside folder
- instantiatedPattern(checker, {pattern}, substitution) — substitutes a `CasePatternForm` with the alias's type arguments; callers: 0 outside folder
- mayBecomeUnion(checker, type) — tests if an opaque type may instantiate to a union (distributing in a type `match`); callers: 0 outside folder

## Concept footprint
- Optional/None: binder/constructs/expressions.ts:expressionHandlers, binder/constructs/types.ts:typeHandlers, checker/resolution/choosing/named-functions.ts:instantiatedValue
- unions: binder/constructs/patterns.ts:bindAlternatives, binder/constructs/types.ts:typeHandlers, binder/module/flow.ts:bindCondition, checker/resolution/applying/applied-call.ts:chooseCall, checker/resolution/applying/applied-call.ts:completeCall, checker/resolution/applying/applied-call.ts:ambiguity, checker/resolution/calls/resolve/explanations.ts:explainNone, checker/resolution/calls/resolve/explanations.ts:severalMembersReport, checker/resolution/choosing/applicability.ts:judgedArgument, checker/resolution/choosing/candidates.ts:topLevelCandidates, checker/resolution/choosing/candidates.ts:traitCallCandidates, checker/resolution/choosing/choice.ts:chosenAmong, checker/resolution/conformance/admits.ts:admitting, checker/resolution/conformance/conformance.ts:witnessesOf, checker/resolution/conformance/conformance.ts:callWitnessesFor, checker/resolution/conformance/conformance.ts:undeclaredWitness, checker/resolution/conformance/conformance.ts:throughMembers, checker/resolution/conformance/shortfalls.ts:associatedShortfall, checker/resolution/conformance/shortfalls.ts:boundShortfall, checker/resolution/conformance/trait-calls.ts:metThroughTraits, checker/resolution/conformance/trait-calls.ts:mayMeetThroughMembers, checker/resolution/conformance/trait-calls.ts:reachedThrough, checker/resolution/conformance/trait-calls.ts:closedThroughMembers, checker/resolution/conformance/trait-objects.ts:meetsEach, checker/resolution/conformance/trait-objects.ts:reportUnmet, checker/resolution/conformance/union-traits.ts:traitMetBy, checker/resolution/conformance/union-traits.ts:membersShortfall, checker/resolution/conformance/union-traits.ts:membersCall, checker/resolution/conformance/union-traits.ts:membersRequirementOf, checker/resolution/conformance/union-traits.ts:traitCallsOn, checker/resolution/conformance/union-traits.ts:traitAsCalled, checker/resolution/conformance/union-traits.ts:takesSelfFirst, checker/resolution/type-matches/type-match-patterns.ts:matchUnion, checker/resolution/type-matches/type-matches.ts:#structCaseOf, checker/resolution/type-matches/type-matches.ts:#reduced, checker/resolution/type-matches/type-matches.ts:#memberReduced, checker/resolution/type-matches/type-matches.ts:mayBecomeUnion
- enums/variants: binder/constructs/declarations.ts:bindAssociatedTypes, binder/constructs/declarations.ts:bindEnum, binder/constructs/patterns.ts:patternHandlers, binder/entities.ts:qualifies, binder/entities.ts:variantEntity, binder/link/index.ts:Linker.visibleAt, binder/link/index.ts:Linker.variantsNamed, binder/link/index.ts:Linker.#index, binder/link/index.ts:Linker.#resolveFree, binder/link/index.ts:Linker.#member, binder/link/index.ts:declaresAssociated, binder/link/qualifiers.ts:qualifierOf, binder/module/local-binder.ts:LocalBinder.use, binder/module/local-binder.ts:LocalBinder.constructedType, binder/module/local-binder.ts:LocalBinder.#variantsNamed, binder/module/module-scope.ts:variantsOf, checker/check.ts:VariantMember, checker/resolution/choosing/named-functions.ts:namedBy, checker/resolution/choosing/named-functions.ts:variantConstructors, checker/resolution/type-matches/reduction-requirements.ts:ReductionRequirements.#held
- any/trait objects: binder/constructs/types.ts:typeHandlers, checker/check.ts:TraitObjects, checker/check.ts:MemberConversion, checker/resolution/calls/places.ts:holdsFieldByTrait, checker/resolution/choosing/candidates.ts:requirementHoldersIn, checker/resolution/choosing/candidates.ts:requirementCandidates, checker/resolution/conformance/met-instantiations/index.ts:searchMetInstantiation, checker/resolution/conformance/met-instantiations/index.ts:memberConstraint, checker/resolution/conformance/met-instantiations/index.ts:fittingInstantiations, checker/resolution/conformance/met-instantiations/index.ts:proposedInstantiations, checker/resolution/conformance/met-instantiations/index.ts:instantiationsOf, checker/resolution/conformance/met-instantiations/index.ts:instantiationsMet, checker/resolution/conformance/met-instantiations/witness-bindings.ts:candidateBindings, checker/resolution/conformance/met-instantiations/witness-bindings.ts:bindingAs, checker/resolution/conformance/trait-objects.ts:meetsAny, checker/resolution/conformance/trait-objects.ts:absorbs, checker/resolution/conformance/trait-objects.ts:reportUnmet, checker/resolution/conformance/trait-objects.ts:traitObjectsOf, checker/resolution/conformance/trait-objects.ts:memberConstraints, checker/resolution/conformance/trait-objects.ts:meetsMember, checker/resolution/conformance/union-traits.ts:traitMetBy, checker/resolution/conformance/union-traits.ts:membersShortfall, checker/resolution/conformance/union-traits.ts:traitCallsOn, checker/resolution/type-matches/implied-constraints.ts:usesIn, checker/resolution/type-matches/type-match-patterns.ts:matchParts
- futures/await/select: binder/constructs/expressions.ts:expressionHandlers, binder/entities.ts:ownCallEntity, binder/link/index.ts:Linker.#refuseFunctionHead, binder/module/flow.ts:bindingsStartOf, binder/module/local-binder.ts:LocalBinder.useBeforeMember, binder/module/local-binder.ts:LocalBinder.#ownCallOf, binder/module/own-calls.ts:noOwnCall, binder/module/own-calls.ts:functionsNamed, binder/module/scope.ts:Scope.enclosingOf, checker/resolution/calls/collection-functions.ts:runsAtOnce, checker/resolution/calls/places.ts:checkReferencedPlaces, checker/resolution/calls/resolve/index.ts:completeResolved, checker/resolution/choosing/applicability.ts:reshapesArguments, checker/resolution/choosing/named-functions.ts:instantiatedValue
- marks/kinds (live/ista/simple): binder/constructs/declarations.ts:bindFunction, checker/check.ts:Checker.kindOf, checker/check.ts:Checker.disposeKindsOf, checker/resolution/applying/call-kinds.ts:kindOfCall, checker/resolution/applying/call-kinds.ts:judgedCall, checker/resolution/applying/call-kinds.ts:markMaking, checker/resolution/applying/call-kinds.ts:leastMarkMaking, checker/resolution/applying/call-kinds.ts:handledBy, checker/resolution/applying/call-kinds.ts:checkCallKind, checker/resolution/applying/call-kinds.ts:kindText, checker/resolution/applying/call-kinds.ts:callerName, checker/resolution/applying/implicit.ts:recordImplicitCall, checker/resolution/calls/resolve/index.ts:recordChosen, checker/resolution/choosing/choice.ts:signatureOf, checker/resolution/choosing/named-functions.ts:openedValue, checker/resolution/choosing/named-functions.ts:madeValue, checker/resolution/choosing/named-functions.ts:valueTypeOf, checker/resolution/conformance/conformance.ts:settlingAt, checker/resolution/conformance/conformance.ts:witnessChosen, checker/resolution/conformance/declared-witness.ts:chooseWitnessAmong, checker/resolution/conformance/declared-witness.ts:instanceMeetsKind, checker/resolution/conformance/declared-witness.ts:meetsRequirementKind, checker/resolution/conformance/derived-traits.ts:derivations, checker/resolution/conformance/kind-settling.ts:kindsSettledAt
- sendable: checker/resolution/calls/deferred-arguments.ts:unsendable, checker/resolution/calls/deferred-arguments.ts:explainedCaptures, checker/resolution/choosing/named-functions.ts:valueTypeOf, checker/resolution/conformance/derived-traits.ts:unsendable, checker/resolution/conformance/derived-traits.ts:codecDerivation, checker/resolution/conformance/derived-traits.ts:derivations, checker/resolution/conformance/kind-settling.ts:kindsSettledAt
- shared structs: binder/constructs/declarations.ts:declarationHandlers, binder/constructs/expressions.ts:expressionHandlers, checker/check.ts:Checker.sharedValueOf, checker/resolution/calls/places.ts:changePlace, checker/resolution/calls/places.ts:checkReferencedPlaces, checker/resolution/calls/places.ts:throughShared, checker/resolution/calls/places.ts:placeIdentity, checker/resolution/calls/places.ts:accessorsOf
- extern types: binder/constructs/declarations.ts:declarationHandlers, binder/module/module-scope.ts:TopLevelDefiner.defineItem, checker/check.ts:Kept, checker/check.ts:Checker.externHeldOf, checker/check.ts:Checker.keepsOf, checker/resolution/type-matches/reduction-requirements.ts:ReductionRequirements.#held
- field loops/passes: binder/constructs/expressions.ts:bindLiteral, binder/constructs/expressions.ts:expressionHandlers, binder/constructs/statements.ts:statementHandlers, binder/module/flow.ts:underFields, binder/module/flow.ts:bindingsStartOf, checker/resolution/applying/implicit.ts:ImplicitCalls, checker/resolution/calls/call-records.ts:CallRecords
- comprehensions: binder/constructs/expressions.ts:bindLiteral, binder/constructs/expressions.ts:expressionHandlers, binder/module/flow.ts:underLoop, binder/module/flow.ts:underFields, binder/module/flow.ts:bindingsStartOf
- deferred calls: binder/constructs/expressions.ts:expressionHandlers, checker/resolution/applying/argument-fit.ts:fitArguments, checker/resolution/calls/deferred-arguments.ts: explainedCaptures, checker/resolution/calls/resolve/explanations.ts:explainNone, checker/resolution/calls/resolve/explanations.ts:bindingReport, checker/resolution/calls/resolve/explanations.ts:takerAt, checker/resolution/calls/resolve/explanations.ts:explainMisfit, checker/resolution/calls/resolve/index.ts:callArgumentOf, checker/resolution/calls/resolve/index.ts:recordChosen, checker/resolution/calls/resolve/written-expectations.ts:expectWrittenArguments, checker/resolution/choosing/binding.ts:bindArguments, checker/resolution/choosing/binding.ts:bindDeferred, checker/resolution/choosing/binding.ts:takesCall
- context consts: binder/constructs/declarations.ts:declarationHandlers, binder/module/module-scope.ts:TopLevelDefiner.defineItem, checker/check.ts:ContextConstantQueries, checker/check.ts:Checker.contextConstants
- disposal/lifetimes/holders: binder/diagnostics.ts:binderDiagnostics, binder/entities.ts:ownCallEntity, binder/link/index.ts:Linker.#refuseFunctionHead, binder/module/local-binder.ts:LocalBinder.useBeforeMember, binder/module/own-calls.ts:noOwnCall, checker/check.ts:Disposal, checker/check.ts:Kept, checker/check.ts:Checker.disposalOf, checker/check.ts:Checker.disposeKindsOf, checker/check.ts:Checker.externHeldOf, checker/check.ts:Checker.keepsOf, checker/check.ts:Checker.reachesDisposable
- recursive aliases/type match: binder/constructs/types.ts:bindAliasBody, binder/constructs/types.ts:bindTypeCase, checker/resolution/conformance/conformance.ts:instantiate, checker/resolution/conformance/shortfalls.ts:associatedShortfall, checker/resolution/conformance/shortfalls.ts:structShortfall, checker/resolution/type-matches/implied-constraints.ts:impliedConstraints, checker/resolution/type-matches/implied-constraints.ts:casePatternOf, checker/resolution/type-matches/implied-constraints.ts:usesIn, checker/resolution/type-matches/implied-constraints.ts:usesInStruct, checker/resolution/type-matches/reduction-requirements.ts:failureDiagnostic, checker/resolution/type-matches/reduction-requirements.ts:ReductionRequirements, checker/resolution/type-matches/type-match-patterns.ts:matchCase, checker/resolution/type-matches/type-match-patterns.ts:matchType, checker/resolution/type-matches/type-match-patterns.ts:matchUnfolded, checker/resolution/type-matches/type-match-patterns.ts:matchUnion, checker/resolution/type-matches/type-match-patterns.ts:matchStruct, checker/resolution/type-matches/type-match-patterns.ts:variableMeets, checker/resolution/type-matches/type-matches.ts:TypeMatchReductions
- struct keys/keyof: binder/constructs/types.ts:typeHandlers, binder/constructs/types.ts:bindStructType, binder/constructs/types.ts:bindMappedField, checker/resolution/applying/applied-call.ts:completeCall, checker/resolution/applying/argument-fit.ts:recordArgumentKeys, checker/resolution/calls/places.ts:referencesOneField, checker/resolution/calls/places.ts:isElementStep, checker/resolution/calls/places.ts:severalKeyedFields, checker/resolution/calls/places.ts:isSingleKey, checker/resolution/calls/places.ts:stepName, checker/resolution/calls/places.ts:accessorsOf, checker/resolution/type-matches/type-matches.ts:mayBecomeUnion
- variance: checker/resolution/conformance/met-instantiations/index.ts:searchMetInstantiation, checker/resolution/conformance/met-instantiations/index.ts:fittingInstantiations, checker/resolution/conformance/met-instantiations/index.ts:instantiationsOf, checker/resolution/conformance/met-instantiations/index.ts:instantiationsMet, checker/resolution/conformance/trait-objects.ts:meetsAny, checker/resolution/conformance/trait-objects.ts:absorbs, checker/resolution/conformance/trait-objects.ts:reportUnmet, checker/resolution/conformance/trait-objects.ts:traitObjectsOf
- packs: checker/resolution/calls/resolve/explanations.ts:explain, checker/resolution/calls/resolve/explanations.ts:bindingReport, checker/resolution/calls/resolve/explanations.ts:packReport, checker/resolution/choosing/applicability.ts:takenBy, checker/resolution/choosing/applicability.ts:typeArgumentsInapplicability, checker/resolution/choosing/applicability.ts:argumentsInapplicability, checker/resolution/choosing/binding.ts:bindValue, checker/resolution/choosing/binding.ts:bindByName, checker/resolution/choosing/binding.ts:argumentSlotsOf, checker/resolution/choosing/named-functions.ts:valueTypeOf, checker/resolution/choosing/named-functions.ts:functionsAccepted, checker/resolution/choosing/named-functions.ts:takesCount, checker/resolution/choosing/named-functions.ts:ownArguments, checker/resolution/choosing/named-functions.ts:chosenFor, checker/resolution/choosing/packs.ts:packItems, checker/resolution/choosing/packs.ts:packInapplicability, checker/resolution/choosing/packs.ts:packOf, checker/resolution/type-matches/type-match-patterns.ts:matchParts, checker/resolution/type-matches/type-matches.ts:mayBecomeUnion
- indented values: binder/constructs/expressions.ts:bindLiteral, binder/constructs/expressions.ts:expressionHandlers
- defaults/fields functions: binder/constructs/declarations.ts:bindParameters, binder/constructs/declarations.ts:bindFieldDefaults, binder/constructs/declarations.ts:bindDefaults, binder/constructs/declarations.ts:bindStruct, binder/constructs/declarations.ts:bindEnum, checker/check.ts:Checker.defaultsOf, checker/resolution/applying/silent-choice.ts:callWithTypes, checker/resolution/calls/resolve/written-expectations.ts:expectWrittenArguments, checker/resolution/choosing/binding.ts:positionalCounts, checker/resolution/choosing/binding.ts:filled, checker/resolution/choosing/binding.ts:unfilled, checker/resolution/choosing/choice.ts:slotsOf, checker/resolution/choosing/named-functions.ts:variantConstructors, checker/resolution/choosing/named-functions.ts:hasOwnType, checker/resolution/conformance/default-witness.ts:defaultWitness, checker/resolution/conformance/default-witness.ts:resolveDefault, checker/resolution/conformance/met-instantiations/witness-bindings.ts:bindingAs, checker/resolution/type-matches/reduction-requirements.ts:ReductionRequirements.#held, checker/resolution/type-matches/reduction-requirements.ts:ReductionRequirements.#defaultsReach, checker/resolution/type-matches/reduction-requirements.ts:ReductionRequirements.#functionTypes
- codecs/JSON: checker/check.ts:Checker.json, checker/resolution/applying/silent-choice.ts:callWithTypes, checker/resolution/conformance/derived-traits.ts:codecDerivation, checker/resolution/conformance/derived-traits.ts:derivations, checker/resolution/conformance/root-goals.ts:KeptGoals.found
- witnesses/traits: binder/constructs/declarations.ts:bindTrait, binder/constructs/types.ts:bindConstraints, binder/constructs/types.ts:bindStructConstraint, binder/entities.ts:SelfEntity, binder/entities.ts:selfEntity, checker/check.ts:TraitObjects, checker/resolution/calls/places.ts:holdsFieldByTrait, checker/resolution/choosing/calls-made.ts:callMade, checker/resolution/choosing/candidates.ts:topLevelCandidates, checker/resolution/choosing/candidates.ts:visibleTraits, checker/resolution/choosing/candidates.ts:witnessCandidates, checker/resolution/choosing/candidates.ts:staticCandidatesIn, checker/resolution/choosing/candidates.ts:requirementHoldersIn, checker/resolution/choosing/candidates.ts:requirementCandidates, checker/resolution/choosing/choice.ts:signatureOf, checker/resolution/choosing/choice.ts:candidateSignature, checker/resolution/choosing/receivers.ts:takesAsSelf, checker/resolution/choosing/receivers.ts:meetsWhereFound, checker/resolution/conformance/admits.ts:admitting, checker/resolution/conformance/conformance.ts:instantiate, checker/resolution/conformance/conformance.ts:witnessesOf, checker/resolution/conformance/conformance.ts:meets, checker/resolution/conformance/conformance.ts:witnessesFor, checker/resolution/conformance/conformance.ts:conform, checker/resolution/conformance/declared-witness.ts:declaresWitness, checker/resolution/conformance/declared-witness.ts:chooseWitness, checker/resolution/conformance/declared-witness.ts:chooseWitnessAmong, checker/resolution/conformance/derived-traits.ts:derivationOf, checker/resolution/conformance/met-instantiations/index.ts:searchMetInstantiation, checker/resolution/conformance/met-instantiations/witness-bindings.ts:candidateBindings, checker/resolution/conformance/root-goals.ts:programRootGoals, checker/resolution/conformance/shortfalls.ts:fieldShortfall, checker/resolution/conformance/shortfalls.ts:associatedShortfall, checker/resolution/conformance/shortfalls.ts:structShortfall, checker/resolution/conformance/trait-calls.ts:metThroughTraits, checker/resolution/conformance/trait-objects.ts:traitObjectsOf, checker/resolution/conformance/union-traits.ts:traitCallsOn, checker/resolution/conformance/witness-outcomes.ts:SearchGoals
- places/&refs: binder/constructs/expressions.ts:expressionHandlers, binder/constructs/statements.ts:bindAssignmentTarget, binder/constructs/types.ts:typeHandlers, checker/check.ts:Checker.cellOf, checker/check.ts:SignatureParameter, checker/resolution/applying/argument-fit.ts:argumentListText, checker/resolution/calls/collection-functions.ts:writeElement, checker/resolution/calls/places.ts:checkChangedPlace, checker/resolution/calls/places.ts:changePlace, checker/resolution/calls/places.ts:referencesOneField, checker/resolution/calls/places.ts:severalKeyedFields, checker/resolution/calls/places.ts:checkReferencedPlaces, checker/resolution/calls/places.ts:placeIdentity, checker/resolution/calls/places.ts:checkDistinctPlaces, checker/resolution/calls/places.ts:changeReceiver, checker/resolution/calls/places.ts:requireChangeable, checker/resolution/calls/resolve/explanations.ts:explain, checker/resolution/calls/resolve/index.ts:completeResolved, checker/resolution/choosing/applicability.ts:judgedArgument, checker/resolution/choosing/applicability.ts:typedFits, checker/resolution/choosing/candidates.ts:callableThrough, checker/resolution/conformance/declared-witness.ts:chooseWitnessAmong, checker/resolution/conformance/met-instantiations/witness-bindings.ts:bindingAs, checker/resolution/conformance/met-instantiations/witness-bindings.ts:byValue
- patterns: binder/constructs/declarations.ts:bindParameters, binder/constructs/expressions.ts:expressionHandlers, binder/constructs/patterns.ts:patternHandlers, binder/constructs/patterns.ts:bindPattern, binder/constructs/patterns.ts:bindAlternatives, binder/constructs/statements.ts:declaredNames, binder/constructs/statements.ts:bindTargets, binder/module/flow.ts:bindCondition, binder/module/flow.ts:underLoop, binder/module/flow.ts:underFields
- templates: binder/constructs/expressions.ts:expressionHandlers, checker/resolution/applying/implicit.ts:preludeCall, checker/resolution/applying/implicit.ts:implicitCall
- ranges: binder/constructs/expressions.ts:expressionHandlers, binder/constructs/patterns.ts:patternHandlers, checker/resolution/applying/implicit.ts:preludeCall
- comparisons: binder/constructs/expressions.ts:expressionHandlers, binder/constructs/patterns.ts:patternHandlers, checker/resolution/applying/implicit.ts:implicitOperatorCall, checker/resolution/applying/implicit.ts:preludeCall, checker/resolution/calls/operators.ts:resolveOperator
