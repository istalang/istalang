## src/compiler/checker/constructs/closures/enclosing-scopes.ts — Enclosing loops, labelled blocks, and own function name for one function scope
- EnclosingScopes(ownName) — tracks enclosing loops/labelled blocks and tests own function name; [exp]; callers: 0 outside folder

## src/compiler/checker/constructs/closures/function-scope.ts — Per-function checking scope holding asyncness, code mark, returns, loops, and captures
- OwnScope — shape of a body's root function, asyncness, and code mark; [exp]; callers: 1 outside folder
- rootScope(own, returns) — builds the root FunctionScope for a body's own code; [exp]; callers: 1 outside folder
- FunctionScope(checked, own) — tracks one function's returns, enclosing loops, captures, cleanup depth, and mark reliance; [exp]; callers: 0 outside folder
- FunctionScope.constructor(checked, own) — initializes function scope fields and EnclosingScopes for `checked?.name`
- FunctionScope.cleanup(check) — runs `check` while incrementing cleanup depth for `disposing()` select cases

## src/compiler/checker/constructs/closures/function-values.ts — Functions, variant constructors, and fieldless structs named as values (with or without `<…>`)
- checkFunctionValue(context, named, expected) — chooses, instantiates, and records a function named as a value; [exp]; callers: 3 outside folder
- recordedValue(context, site, application, made) — records a chosen function-value instantiation at `site` and returns its type; [exp]; callers: 1 outside folder
- checkAppliedFunction(context, node, expected) — checks `f<T>` as a function value or fieldless struct, reporting invalid `<…>`; [exp]; callers: 1 outside folder
- namedFunctionsAccepted(context, node) — returns the `Admits` predicate for function types `node` can be passed as; [exp]; callers: 2 outside folder
- reportUnchosen(context, named, shape) — reports why a function value could not be chosen or did not fit `shape`

## src/compiler/checker/constructs/closures/functions.ts — Stack of nested function scopes in a body, capture tracking, and untyped recursion detection
- FunctionScopes(root, passes) — manages active `FunctionFrame` stack, variable captures, and checked nested functions; [exp]; callers: 2 outside folder
- FunctionScopes.within(frames, check) — runs `check` with the function frame stack temporarily restored to `frames`
- FunctionScopes.inside(scope, check) — pushes `scope` (marking it untyped if return is inferred) and runs `check`
- FunctionScopes.noteUse(context, name, entity) — records closure captures across enclosing nested functions and checks data kinds
- FunctionScopes.typeOfFunction(context, name, entity) — returns a local function's type or reports untyped recursive self-use
- capture(context, name, entity) — reports captured `&` references and marks captured mutable `let` variables as cell-backed

## src/compiler/checker/constructs/closures/lambdas.ts — Checking lambdas and local `fn` declarations, parameter slot inference, and capture sendability
- lambdaAccepts(context, node) — returns `Admits` predicate testing whether an expected type can type `node` as a lambda; [exp]; callers: 1 outside folder
- writtenInputs(context, node) — builds a `fn(written...) -> Never` lower bound when all lambda parameters are written; [exp]; callers: 1 outside folder
- writtenParameterTypes(context, node) — resolves each parameter's whole written type (`node.type` or non-bare pattern type)
- checkLambda(context, node, expected) — checks a lambda expression against `expected` function slots and return type; [exp]; callers: 2 outside folder
- inferLambda(context, node, slots, guide?) — checks a lambda with known parameter `slots` and an open/guided return type; [exp]; callers: 2 outside folder
- bodyResultGiven(context, node, result) — unwraps expected `Future<T>` for async or plain lambdas, allowing plain lambdas to return `Future<T>`
- checkLambdaAs(context, node, slots, result) — resolves lambda parameters/kind/return expectations and delegates to `checkNested`
- checkLocalFunction(context, node) — checks a local `fn` declaration in the enclosing body and returns `Unit`; [exp]; callers: 1 outside folder
- checkNested(context, node, header) — checks a lambda or local `fn` body in a `FunctionScope` and records its `CheckedFunction`
- nestedParameters(context, nodes, slots) — resolves nested function parameters from written types or expected `slots`, rejecting defaults/array rest
- expectedSlot(node, index, slots) — reads the expected parameter slot or pack rest type at `index`
- typedAs(context, node, written) — resolves `written` parameter type node paired with `writtenByReference(node)`

## src/compiler/checker/constructs/closures/nested-types.ts — Deriving function types and code marks for lambdas and local functions
- givenKindOf(context, qualifiers, expected?) — returns the mark written on a nested function head or fixed by `expected`; [exp]; callers: 0 outside folder
- heldKindOf(checker, parameters) — infers a single mark held by a lambda's parameter types when all agree; [exp]; callers: 0 outside folder
- nestedTypeOf(context, node, parameters) — returns a builder producing a nested function's `FunctionType` for `(produces, send, mark)`; [exp]; callers: 0 outside folder
- nestedValueKind(node, given, scope) — picks a nested function's mark (`given`, `scope.codeKind` if async/relied-on, else `simpleMark`); [exp]; callers: 0 outside folder

## src/compiler/checker/constructs/closures/own-calls.ts — Declaring and recognizing an async function's own `_Call` handle variable (`fnName.disposing()`)
- declareOwnCall(context) — declares the hidden `_Call` variable in `context.variables` when entering a function; [exp]; callers: 1 outside folder
- ownCallerOf(context, node) — returns the enclosing function if `node` reads its `OwnCall` variable; [exp]; callers: 1 outside folder

## src/compiler/checker/constructs/closures/returns.ts — Tracking `return` statements, tail values, and `?` error propagation in a function or value body
- GuidedResult — a lambda node, its open return guide type, and its constraint scope callback; [exp]; callers: 0 outside folder
- ReturnScope(declared, isFunction, guided?, orFuture?) — collects `return` producers and `?` error propagations to settle body result; [exp]; callers: 1 outside folder
- ReturnScope.constructor(declared, isFunction, guided?, orFuture?) — initializes return scope with declared/guided/future return expectations
- ReturnScope.check(context, node) — checks a `return` statement against `declared` or `guided` and records its `Produced` entry
- ReturnScope.#checked(context, value) — checks a returned expression via `part`, `expect`, or `guided.inScope`
- ReturnScope.propagate(context, error, span) — checks or defers `?` error-type compatibility against the function's `Result` return type
- ReturnScope.result(context, tail) — settles all `return`s and `tail` (or joins `openAgreement`) and validates deferred `?` propagations
- ReturnScope.#settled(context, tail, declared) — fits all producers against `declared` (or `orFuture` when all return a future)
- checkPropagation(context, result, propagation) — reports when a function using `?` does not return `Result` or its error type misfits

## src/compiler/checker/constructs/closures/value-calls.ts — Calling expressions of function type (`fn(...)`), recording bindings and fitting arguments
- valueParameterTypes(callee, written, typeArguments) — returns positional parameter types when arguments match `callee` 1-to-1; [exp]; callers: 1 outside folder
- calledValueType(context, node) — returns the `FunctionType` called by value call `node` (including receiver field calls); [exp]; callers: 1 outside folder
- ValueCalls(passes) — per-pass table recording value call sites and their parameter bindings; [exp]; callers: 2 outside folder
- ValueCall — a value call node with its written arguments and optional type arguments; [exp]; callers: 0 outside folder
- checkValueCall(context, call, callee, calleeType?) — checks a call on a function-typed expression and fits/binds its arguments; [exp]; callers: 1 outside folder
- applyValueCall(context, call) — applies `call` immediately or joins the active constraint scope when arguments are open
- takenFor(context, call, given, scope?) — tests applicability of `call.takes` against `given` arguments via `takenBy`
- completeValueCall(context, call, given, taken) — explains failure or fits arguments, checks `&` places, and records binding

## src/compiler/checker/constructs/declarations/aliases/alias-recursion.ts — Classifying top-level type aliases as non-recursive, guarded recursive, cyclic, or irregular
- AliasRecursion — classification union `'none' | 'recursive' | 'cycle' | 'irregular'`; [exp]; callers: 0 outside folder
- AliasRecursions(checker, moduleOf) — analyzes alias syntax graphs for guarded recursion, cycles, regularity, and SCC groups; [exp]; callers: 0 outside folder
- AliasRecursions.constructor(checker, moduleOf) — sets up entry tables for alias references, recursion kinds, and parameter standings
- AliasRecursions.groupOf(alias) — returns the mutually recursive alias group closing together with `alias`
- AliasRecursions.writesReference(module, node, aliases) — tests whether `node` references any alias in `aliases` at any depth
- AliasRecursions.#recursionOf(alias) — computes `AliasRecursion` for `alias` and reports `irregularAlias` (5128)
- AliasRecursions.#reachedAgain(alias) — walks alias reference graph to classify self-reachability as `'none' | 'guarded' | 'cycle'`
- AliasRecursions.#irregularReference(alias) — finds the first cycle reference not passing `alias`'s own type parameters in order
- AliasRecursions.#reaches(from, to) — tests whether `from` reaches `to` through alias references
- AliasRecursions.#referencesOf(alias) — collects references from `alias`'s body to non-match top-level type aliases
- AliasRecursions.#namedIn(module, node, standing) — walks `node` collecting all `NamedType`s with their guarded/blocking standing
- AliasRecursions.#argumentStandings(module, node) — returns parameter standings when `node` names a `TypeAliasDeclaration`
- AliasRecursions.#standingsOf(alias) — computes guarded/blocking standing for each type parameter of `alias`
- AliasRecursions.#matchStanding(module, body, parameter) — computes standing of `parameter` inside a `TypeMatch` alias body
- AliasRecursions.#usesOf(module, node, parameters) — collects standings of all occurrences of `parameters` in `node`
- jointStanding(uses) — combines standings (`guards: every`, `blocks: some`)
- typeChildrenOf(node, argumentStandings) — lists direct child `TypeNode`s of `node` with their guarded/blocking step flags

## src/compiler/checker/constructs/declarations/aliases/index.ts — Resolving type aliases, associated types, and type `match` forms
- Aliases(checker, moduleOf) — entry tables resolving type aliases, associated types, recursive aliases, and type `match`es; [exp]; callers: 1 outside folder
- Aliases.constructor(checker, moduleOf) — initializes entry tables for aliased types, type matches, case types, and recursion helpers
- Aliases.#aliasedType(alias) — resolves `alias` via `RecursiveBodies`, `resolveType`, or an unreduced `matchUse`
- Aliases.#formOf(alias, body) — resolves a `TypeMatch`'s subject, `infer` variables, constraints, and case patterns
- Aliases.#patternOf(module, typeCase) — resolves one `TypeCase` pattern (`_`, `StructConstraint`, or `TypeNode`)
- Aliases.useOf(alias, typeArguments) — builds an unreduced `MatchType` for a type alias or associated type
- Aliases.argumentsFor(alias, type) — infers `alias`'s type arguments by pattern-matching its body against `type`
- Aliases.#parametersOf(alias) — returns `alias.typeParameters` or the enclosing declaration's `typeParameters`

## src/compiler/checker/constructs/declarations/aliases/recursive-bodies.ts — Closing mutually recursive type alias groups into equi-recursive types
- RecursiveBodies(checker, moduleOf, recursions) — resolves recursive alias bodies with placeholders and closes via `closeRecursive`; [exp]; callers: 0 outside folder
- RecursiveBodies.constructor(checker, moduleOf, recursions) — initializes `#bodies` entry table with cycle reporting
- RecursiveBodies.closed(alias) — substitutes group parameters, closes the recursive group via `closeRecursive`, and reports unguarded cycles
- RecursiveBodies.#bodyOf(alias) — resolves `alias.type` with group references replaced by placeholders via `resolveClosing`

## src/compiler/checker/constructs/declarations/constants.ts — Checking and compile-time evaluating top-level `const` declarations
- ConstantSeams — seams passed from `ProgramChecker` to `ConstantChecks`; [exp]; callers: 0 outside folder
- sameDeclaration(first, second) — compares two `CheckedDeclaration`s by type, `ConstantForm`, and target bindings
- sameBindings(first, second) — compares `TargetBinding[]` arrays for entry cutoff
- ConstantChecks(seams) — entry tables checking top-level constants, evaluating `ConstantForm`s, and resolving `constantNamed`; [exp]; callers: 1 outside folder
- ConstantChecks.constructor(seams) — initializes `#checks` and `#bodies` entry tables with cycle reporting
- ConstantChecks.bodyOf(declaration) — forces constant check and returns the `CheckedBody` of `declaration`'s initializer
- ConstantChecks.constantNamed(module, name) — looks up the `CheckedConstant` (and projected `formAt`) for top-level constant `name`
- ConstantChecks.#checked(declaration) — looks up `#checks` entry for a top-level constant declaration
- ConstantChecks.#check(module, declaration) — runs `computeConstant` on the checked initializer and extracts target bindings

## src/compiler/checker/constructs/declarations/context-constants.ts — Checking `context const` declarations and their `ista` initializer bodies
- ValueBody — callback type creating a `BodyChecker` for a standalone value expression; [exp]; callers: 0 outside folder
- ContextConstantChecks(checker, valueBody) — entry tables for `context const` types and initializer bodies with cycle detection; [exp]; callers: 1 outside folder
- ContextConstantChecks.constructor(checker, valueBody) — initializes `#bodies` and `#types` entry tables for context constants

## src/compiler/checker/constructs/declarations/declarations.ts — Dispatching top-level declaration checks across a module
- checkTypeParameters(checker, declaration) — checks variance markers, packs, constraints, member unions, and defaults on type parameters
- checkPack(checker, declaration, pack) — reports type parameter packs outside functions or with constraints/defaults
- checkFunction(checker, node) — checks a function declaration's type parameters, annotations, signature, body, kinds, extern rules, and `@Suite`
- checkFieldDefaults(checker, fieldsFunction) — checks parameters, defaults, and data kinds of a synthesized fields function
- checkOutcome(checker, node, module) — checks that non-std `main` returns an `Encodable` outcome
- annotatedNowhere(description) — returns a handler checking that `node` carries no annotations
- checkStruct(checker, node, module) — checks a struct or shared struct declaration's annotations, type parameters, fields, defaults, and kinds
- checkAssociatedBounds(checker, module, requirement) — resolves a trait associated type's bounds and reports single-type `in` bounds
- checkAssociatedTypes(checker, node, module) — checks annotations and alias bodies of a declaration's associated types
- checkAlias(checker, alias) — resolves an alias, checks finiteness, resolves type `match` case types, and checks endless expansion
- refuseRequiredDefaults(checker, module, required) — reports default values on trait required function parameters
- refusePatterns(checker, module, declaration, what) — reports destructuring patterns on extern or trait-requirement parameters
- checkDeclaration(checker, module, declaration) — dispatches `declaration` to its `declarationHandlers` entry; [exp]; callers: 0 outside folder

## src/compiler/checker/constructs/declarations/functions/clashes.ts — Detecting ambiguous overload clashes within a module and against `prelude`
- checkClashes(checker, module) — groups functions/statics in `module` and reports overloads that clash; [exp]; callers: 1 outside folder
- preludeOverloads(checker, module, declaration) — returns same-named `prelude` functions for non-static functions outside `prelude`
- clash(checker, first, second, overloads) — tests whether any positional argument count produces a call where `first` and `second` tie
- slotPairs(count, first, second) — pairs parameter/rest slots of `first` and `second` for `count` positional arguments
- instantiatedPairs(checker, pairs, typeParameters) — unifies type parameters across paired slots to make parameter types as alike as possible
- mixedCalls(pairs) — generates candidate `CallArgument[]` lists picking each position's type from either slot
- argumentFor(slot, other) — builds a `CallArgument` for `slot` (using `other`'s type or `Unit` for a pack)
- shapeOf(checker, declaration) — extracts `Shape` (type parameters, fixed/rest slots, minimum arity) if error-free
- passingOf(slot) — maps a `SignatureSlot` to `'receiver' | 'reference' | 'value'`

## src/compiler/checker/constructs/declarations/functions/functions.ts — Entry tables for declared function return types and checked function bodies
- FunctionSeams — seams providing `checker` and `checkBody` to `FunctionChecks`; [exp]; callers: 0 outside folder
- sameOptionalType(first, second) — compares two `Type | undefined` values with `sameTypeSpelled`
- FunctionChecks(seams) — entry tables computing function return types (with cycle detection) and checked bodies; [exp]; callers: 1 outside folder
- FunctionChecks.constructor(seams) — initializes `#declaredResults`, `#results`, and `#bodies` entry tables
- FunctionChecks.bodyOf(declaration) — forces `resultOf` when return type is inferred, then returns `#checkedBody`
- FunctionChecks.#checkedBody(declaration) — returns `#bodies.get(declaration)` when `declaration` has a body

## src/compiler/checker/constructs/declarations/functions/parameters.ts — Entry tables for function parameter signatures and default-value bodies
- DefaultsBody — a `DefaultValues` sink that finishes into a `CheckedBody`; [exp]; callers: 1 outside folder
- DefaultsChecking — callbacks used by `defaultsBody` to check defaults, declare parameters, and finish flow; [exp]; callers: 0 outside folder
- defaultsBody(checking) — creates a `DefaultsBody` tracking parameters declared before each default expression; [exp]; callers: 1 outside folder
- sameParameters(first, second) — compares `SignatureParameter[]` lists for entry cutoff
- sameRest(first, second) — compares two `RestSlot | undefined` values for entry cutoff
- Parameters(unit) — entry tables for function parameters and default-value bodies, splitting when types depend on defaults; [exp]; callers: 1 outside folder
- Parameters.constructor(unit) — initializes `#types`, `#defaults`, and `#together` entry tables
- Parameters.defaultsOf(declaration) — returns the `CheckedBody` of `declaration`'s parameter defaults if any exist
- Parameters.#checkDefaults(declaration) — checks defaults of a function whose parameters all have written types
- typesWaitOnDefaults(declaration) — tests whether any parameter of `declaration` has a default and no written type

## src/compiler/checker/constructs/declarations/functions/signatures.ts — Resolving function parameter types, rest slots, defaults, and declared return types
- DefaultValues — interface for checking parameter defaults and declaring parameters sequentially; [exp]; callers: 0 outside folder
- declaredParameters(checker, module, declaration, defaults) — resolves function parameters, checking defaults, order, and rest rules; [exp]; callers: 0 outside folder
- checkGiven(checker, module, node, state) — reports missing default after a defaulted parameter or missing parameter type
- writtenParameters(checker, module, declaration) — resolves parameters from written types alone (cycle stand-in); [exp]; callers: 0 outside folder
- writtenTypeOf(checker, module, node) — returns `node.type` or the type named by `node.pattern`; [exp]; callers: 1 outside folder
- namedByPattern(checker, module, node) — returns `patternNamedType(node)` when its entity is a type
- wholeWrittenTypeOf(checker, module, node) — returns `node.type` or a non-bare-generic pattern type for a lambda parameter; [exp]; callers: 1 outside folder
- wholeTypeNamedByPattern(checker, module, node) — returns `namedByPattern` unless it is a bare generic type
- ParameterSite — `{ checker, module, report }` context for `checkPatternParameter`; [exp]; callers: 0 outside folder
- checkPatternParameter(site, node, byReference) — reports a parameter with both `: T` and a typed pattern, or a pattern on `&`; [exp]; callers: 1 outside folder
- signatureParameter(checker, node, type) — builds a `SignatureParameter` with `writtenByReference` and `restSlotOf`
- restSlotOf(checker, node, type) — builds `RestSlot` (`packRestSlot` or `{ kind: 'array', item }`) for a rest parameter
- checkRest(checker, module, rest) — reports a rest parameter that is not last, has a default, or is not `Array<T>`/pack
- declaredResultOf(checker, module, declaration) — returns declared body result or nominal owner type for a fields function; [exp]; callers: 0 outside folder
- declaredBodyResult(checker, module, declaration) — resolves `returnType`, unwrapping `Future<T>` on `async` heads; [exp]; callers: 1 outside folder

## src/compiler/checker/constructs/declarations/functions/statics.ts — Indexing static functions per module by their `StaticOwner`
- StaticFunctions(checker) — per-module entry table indexing static `FunctionDeclaration`s by `StaticOwner`; [exp]; callers: 1 outside folder
- StaticFunctions.constructor(checker) — initializes `#byModule` entry table
- StaticFunctions.#index(module) — groups static functions in `module` by `declaredOwnerOf`

## src/compiler/checker/constructs/declarations/layout/index.ts — Layouts of structs, shared structs, and enums (declared order vs name order)
- sameFields(first, second) — compares `FieldMember[]` lists for entry cutoff
- Layouts(checker) — entry tables computing declared/sorted struct fields, shared struct values, nominal shapes, and enum variants; [exp]; callers: 1 outside folder
- Layouts.constructor(checker) — initializes `#fields`, `#variants`, and `TypeExpansion`
- Layouts.fieldsOf(type) — returns fields of a struct or shape in name order, substituted for type arguments
- Layouts.sharedValueOf(type) — returns the anonymous shape behind a `SharedStructDeclaration` instance
- Layouts.nominalShapeOf(type) — returns the anonymous shape a nominal struct converts into (none if any field is annotated)
- Layouts.variantsOf(type) — returns an enum's variants with fields substituted for `type.arguments`
- Layouts.#variantsOf(declaration, defaultsOf) — resolves declared variants and their fields for `declaration`
- Layouts.#fieldsOf(declaration, fields, defaults) — resolves declared fields and replaces endless-expansion fields with `errorType`
- Layouts.#ended(declaration, fields) — replaces fields in `endlessFieldsOf(declaration)` with `errorType`
- instantiated(fields, substitution, rules) — substitutes type arguments across a `FieldMember[]` list

## src/compiler/checker/constructs/declarations/layout/struct-rules.ts — Finiteness checks rejecting value-type cycles in struct fields and recursive aliases
- checkFiniteFields(checker, declaration) — reports struct fields that hold their own struct type by value; [exp]; callers: 1 outside folder
- checkFiniteAlias(checker, alias) — reports a recursive type alias whose unfolded body holds itself by value; [exp]; callers: 1 outside folder

## src/compiler/checker/constructs/declarations/module-checks.ts — Checking a module's items, clashes, expansions, constraints, and lifetimes
- ModuleRules — program-wide `expansion`, `typeParameters`, and `lifetimes` units run per module; [exp]; callers: 0 outside folder
- ModuleChecks(checker, rules) — entry tables running all declaration and module-wide checks and rendering sorted diagnostics; [exp]; callers: 1 outside folder
- ModuleChecks.constructor(checker, rules) — initializes `#modules`, `#items`, `#clashes`, `#expansions`, and `#lifetimes` tables
- ModuleChecks.diagnosticsOf(module, treeOf) — runs module checks and returns deduplicated text-span `Diagnostic`s
- diagnosticsIn(module, treeOf, notes) — converts anchored diagnostic notes for `module` to text spans, sorted and deduplicated

## src/compiler/checker/constructs/declarations/type-parameters.ts — Resolving type parameter constraints, associated type bounds, and deferred instantiation checks
- TypeParameters(checker, moduleOf) — entry tables for trait/struct constraints, associated bounds, and deferred instantiation checks; [exp]; callers: 1 outside folder
- TypeParameters.constructor(checker, moduleOf) — initializes `#constraints`, `#structConstraints`, `#bounds`, and `#checks` tables
- TypeParameters.checkNoted(module) — drains and runs all `ConstraintNote`s reached while checking `module`
- TypeParameters.#noted(module, done) — filters `entries.notesReached()` for unchecked `ConstraintNote`s in `module`
- TypeParameters.#check(module, check) — executes a deferred `'reduces'` or `'meets'` constraint check at its `UseSite`
- checkKey(note) — memoizes a canonical string key for a `ConstraintNote` for incremental entry reuse
- resolveAssociatedBounds(checker, module, requirement) — resolves trait, struct, and `in` member bounds on a `RequiredAssociatedType`
- sameAssociatedBounds(first, second) — compares two `AssociatedBounds` records for entry cutoff
- traitRequiring(checker, module, requirement) — finds the `TraitDeclaration` in `module` containing `requirement`
- resolveConstraints(checker, module, parameter) — resolves trait constraints on `parameter`
- resolveStructConstraints(checker, module, parameter) — resolves struct constraints on `parameter`

## src/compiler/checker/constructs/declarations/variance-markers.ts — Validating written `gives`/`takes` variance markers on type parameters
- checkVarianceMarkers(checker, declaration) — checks every written variance marker on `declaration.typeParameters`; [exp]; callers: 0 outside folder
- checkMarker(checker, declaration, written) — reports variance on handles, non-type declarations, or contradicting derived variance

## src/compiler/checker/constructs/expressions/access/dereference.ts — Checking `*x` and `x->` shared-struct handle dereferences
- checkDereference(context, node) — checks `*x` or `x->` (as chain link) and returns the shared struct's inner shape; [exp]; callers: 1 outside folder
- valueBehind(context, node, handle, isLink) — unwraps `sharedValueOf(handle)` or reports `insideOptional`/`notShared`

## src/compiler/checker/constructs/expressions/access/indexing.ts — Checking `x[k]` struct key reads and `index(x, k)` collection calls
- checkIndex(context, node, expected) — checks `s[k]` as a struct key read (`S[K]`) or resolves `index(x, k)`; [exp]; callers: 1 outside folder
- declaresIndex(context, container) — tests whether `container` has an `index` candidate taking it as `self`

## src/compiler/checker/constructs/expressions/access/member-access.ts — Checking `x.f` field reads, qualified variants, function values, and namespace members
- checkMemberAccess(context, node, expected) — checks `node` as a qualified entity, function value, or struct/trait field read; [exp]; callers: 1 outside folder
- readsNothing(context, link, access) — handles missing member names or unexported namespace members already reported; [exp]; callers: 1 outside folder
- readsThroughNamespace(context, access) — tests whether `access.target` names a namespace import; [exp]; callers: 1 outside folder
- recordFieldRead(context, access, found) — records `found.read` on `access` and `found.member` on `access.member`; [exp]; callers: 1 outside folder
- FieldReads(passes) — per-pass table mapping `MemberAccess | Index` nodes to `FieldRead`; [exp]; callers: 2 outside folder
- noField(context, node, type) — builds diagnostic for a missing field (`->` on shared struct, `?.` on optional, method as value, or unknown)

## src/compiler/checker/constructs/expressions/access/names.ts — Checking identifier expressions, context constant reads, and bare fieldless structs
- checkName(context, node, expected) — resolves `node` via `useEntity` and returns its value type; [exp]; callers: 1 outside folder
- nameAccepts(context, node) — returns `Admits` predicate for a bare identifier (variant, fieldless struct, or function); [exp]; callers: 1 outside folder
- memberAccepts(context, node) — returns `Admits` predicate for a `MemberAccess` (qualified variant, struct, or function); [exp]; callers: 1 outside folder
- bareStructAccepts(context, name) — returns `Admits` predicate matching nominal instances of a generic fieldless struct
- entityValueType(context, node, entity, expected) — dispatches on `entity` kind to compute the value type of `node`; [exp]; callers: 0 outside folder
- contextConstantRead(context, node, declaration) — checks call-kind rule (`ista`) on reading a `context const` and returns its type
- declaredOutsideBodies(checker, variable) — returns the type of an extern, context, or top-level constant outside bodies; [exp]; callers: 1 outside folder
- bareStructValue(context, node, entity, expected) — instantiates a bare fieldless struct against `expected`

## src/compiler/checker/constructs/expressions/access/optionals.ts — Optional chains (`?.`, `?->`), force unwrap (`!`), and nullish coalescing (`??`)
- OptionalChains(passes) — tracks active optional chain links, unwrapping `presentType` at `?.` and wrapping the chain result; [exp]; callers: 2 outside folder
- OptionalChains.target(context, link) — checks `step.target` settled and unwraps `presentType` when `link` continues a chain
- OptionalChains.linked(context, node, value) — records a chain link and wraps `value` into `optionalOf` if not already optional
- OptionalChains.#baseOf(context, step, targetType) — unwraps `presentType(carried)` for an optional step or reports `needsOptional`
- checkUnwrap(context, node, expected) — checks `a!`, warns `forceUnwrap`, records `panic` prelude call, and unwraps `presentType`; [exp]; callers: 1 outside folder
- checkNullish(context, node, expected) — checks `a ?? b`, unwrapping `presentType(left)` and fitting `right` to inner or optional; [exp]; callers: 1 outside folder
- reportedNeedsOptional(context, operand, operator, type) — reports `needsOptional` and returns `errorType`

## src/compiler/checker/constructs/expressions/call-arguments.ts — Checking call arguments as written (values, `&` references, spreads, named arguments)
- writtenArgument(context, argument, known) — checks one `CallArgument` (spread, named, `&` reference, or value) against `known`; [exp]; callers: 0 outside folder
- spreadArgument(context, argument, known) — checks a spread call argument, recording `'copied'` for an `ArrayLiteral` joining the scope
- valueArgument(context, argument, known) — checks a value or `&` reference argument, preserving `writtenLiteral` for fresh literals

## src/compiler/checker/constructs/expressions/calls.ts — Checking function, method, static, conversion, variant-constructor, and value calls
- checkCall(context, node, expected) — checks a `Call` (isolating scope if it continues an optional chain); [exp]; callers: 0 outside folder
- CallToCheck — input bundle for `checkCallMade` (`node`, `expected`, `value`, optional deferred `given`); [exp]; callers: 0 outside folder
- checkCallMade(context, callToCheck) — checks written arguments (and deferred function) then dispatches the call via `calledBy`; [exp]; callers: 0 outside folder
- calledBy(context, call, value) — routes `call` to `checkValueCall`, `callEntity`, `callMethod`, or `callStatic`
- calledValue(context, node) — pre-reads the callee's value/receiver type before checking arguments when known; [exp]; callers: 0 outside folder
- receiverField(context, node, callee) — pre-reads receiver type and field type for `x.f(...)` when `callee` is a receiver member access
- CalledValue — `{ type, receiver? }` pre-read by `calledValue`; [exp]; callers: 0 outside folder
- callMethod(context, call, callee, read) — resolves `x.f(...)` as a method call or field function-value call, reporting ambiguity
- callEntity(context, call, callee, entity) — resolves a call whose callee denotes a `functions` set, variable, variant, or conversion type
- callStatic(context, call, owner, name) — resolves a static function or `from` conversion call on type `owner`
- resolve(context, call, name, candidates) — forwards a non-method `WrittenCall` and `candidates` to `resolveCall`

## src/compiler/checker/constructs/expressions/collections/collections.ts — Shared collection literal helpers, `Default`+`setIndex` literals, and spread items
- CollectionForms(passes) — per-pass table recording whether a collection literal lowers as `'array' | 'map' | 'declared'`; [exp]; callers: 2 outside folder
- expectedArrayItem(context, expected) — extracts the item type when `expected` targets an `Array`; [exp]; callers: 0 outside folder
- checkDeclaredLiteral(context, node, type) — checks `[...]`/`[k: v]` against a nominal type via `Default` and `setIndex`; [exp]; callers: 0 outside folder
- insertEntry(context, entry, type, failure) — checks one `MapEntry` or `Spread` and resolves its `setIndex` call on `type`
- spreadArgumentType(context, spread, item) — checks a call spread argument as a pack or iterable of `item`; [exp]; callers: 1 outside folder
- itemsOf(context, spread, type, item?) — returns array element type (recording `'copied'` if exact) or `iteratedItem` via `iterate`; [exp]; callers: 0 outside folder
- collectedBy(context, spread) — returns the `Array<T>` or pack type a checked spread argument collects into; [exp]; callers: 1 outside folder
- producedValue(context, node, expected) — checks `node` expecting `expected` and wraps it as a `Produced` item; [exp]; callers: 0 outside folder
- agreeOn(context, produced, expected, part) — settles agreement across collection items, reporting `itemTypes` on mismatch; [exp]; callers: 0 outside folder
- pairOf(context, spread, item) — extracts `[key, value]` from a 2-tuple spread item or reports `mapSpreadItems`; [exp]; callers: 0 outside folder

## src/compiler/checker/constructs/expressions/collections/comprehensions.ts — Checking `[for x in xs: e]` and `[for k, v in ...s: e]` array comprehensions
- checkComprehension(context, node, expected) — checks an iterable comprehension and returns `Array<element>`; [exp]; callers: 1 outside folder
- checkFieldComprehension(context, node, expected) — checks a field comprehension across passes, agreeing and widening elements; [exp]; callers: 1 outside folder
- agreedElement(context, produced, expected) — computes agreed element type across field passes, widening keys when untyped

## src/compiler/checker/constructs/expressions/collections/empty-collections.ts — `Admits` predicates for postponed empty `[]` and `[:]` literals
- emptyArrayAdmits(context, _node) — returns `Admits` predicate accepting any `collectionTarget` for `[]`; [exp]; callers: 1 outside folder
- emptyMapAdmits(context, _node) — returns `Admits` predicate accepting `'map'` or `'declared'` targets for `[:]`; [exp]; callers: 1 outside folder

## src/compiler/checker/constructs/expressions/collections/joining-literals.ts — Array and map literals joining an open constraint scope
- checkArray(context, node, expected) — routes `ArrayLiteral` to `checkJoiningArray` when a scope is open, else `checkArrayLiteral`; [exp]; callers: 1 outside folder
- checkMap(context, node, expected) — routes `MapLiteral` to `checkJoiningMap` when a scope is open, else `checkMapLiteral`; [exp]; callers: 1 outside folder
- checkJoiningArray(context, node) — checks an `ArrayLiteral`'s elements inside the open constraint scope via `joinedCollection`
- checkJoiningMap(context, node) — checks a `MapLiteral`'s entries and spreads inside the open constraint scope via `joinedCollection`
- joinedItem(context, node) — checks one collection item (settled if a written literal, else in scope)
- joinedCollection(context, collection, items, agree) — opens `Array`/`Map` type parameters in the constraint scope and settles items on completion
- settledItem(context, item, settled, inference) — re-checks written literals against `settled` parameter type or solves `item.produced.type`
- agreeOnNone(context, items) — tests whether `items` have no common type so they bound the collection parameter via `matchApart`
- itemsSettling(checker, owner, parameters, items) — builds `Settling` falling back to `agreedDefault` of `items` per parameter

## src/compiler/checker/constructs/expressions/collections/literals.ts — Checking standalone `Array`, `Map`, and `Range` literals
- checkMapLiteral(context, node, expected) — checks a `MapLiteral` against expected `Map` or declared collection type; [exp]; callers: 0 outside folder
- SpreadPairs — a map spread's node, key/value types, and whether its operand is a `Map`; [exp]; callers: 0 outside folder
- entriesOf(context, node, map) — checks each `MapEntry` and `Spread` of `node`, collecting key/value `Produced` lists
- spreadPairs(context, spread, map) — checks a map spread expression as a `Map<K, V>` or iterable of `(K, V)` pairs; [exp]; callers: 0 outside folder
- settleMapSpread(context, spreadPairs, agreed) — fits a map spread's `(K, V)` to `agreed`, recording `'copied'` or cursor iteration; [exp]; callers: 0 outside folder
- checkArrayLiteral(context, node, expected) — checks an `ArrayLiteral` (or empty `[]` as `Map`/declared collection); [exp]; callers: 0 outside folder
- elementsProduced(context, elements, expectedItem) — checks array elements and spreads sequentially with `decidedSoFar`
- agreedElement(context, elements, produced, expectedItem) — agrees on array element type and settles array spreads; [exp]; callers: 0 outside folder
- spreadItems(context, spread, item) — checks an array spread expression as `Array<T>` or iterable; [exp]; callers: 0 outside folder
- settleSpread(context, spread, item) — records `'copied'` or cursor iteration for an array spread once `item` is agreed
- checkRange(context, node) — checks `Range` bounds/step as `Int`, records `_inclusiveEnd` for `..=`, and returns `Range`; [exp]; callers: 1 outside folder

## src/compiler/checker/constructs/expressions/control/await.ts — Checking `await` expressions and resolving `onAwait` for awaitables
- checkAwait(context, node, expected) — checks `await e` via `awaitedThrough` and returns the awaited value type; [exp]; callers: 1 outside folder
- AwaitedOperand — input descriptor for `awaitedThrough` (`node`, `operand`, `type`, `failure`, `checksKind`); [exp]; callers: 0 outside folder
- awaitedThrough(context, awaited) — resolves `onAwait(x, done)` and validates `Resolver<T, M>` and wait mark; [exp]; callers: 0 outside folder
- checkWaitKind(context, at, found, mode) — verifies the awaited `mode` matches `context.codeKind`, reporting mark mismatches
- reportWait(context, at) — reports `awaitOutsideAsync` or `awaitInCleanup` when waiting is invalid; [exp]; callers: 0 outside folder

## src/compiler/checker/constructs/expressions/control/branches.ts — Accumulating and settling branch types for `if`, `match`, and `select`
- Branches(context, node, expected) — collects branch `Produced` results and settles their agreed type; [exp]; callers: 0 outside folder
- Branches.add(body) — checks `body` block expecting `expected` or `decidedSoFar` and records its tail
- Branches.agreedType() — settles branch agreement via `openAgreement` or `settleAgreement`, reporting `branchTypes`

## src/compiler/checker/constructs/expressions/control/control.ts — Checking `if` expressions and ruling out statically decided branches
- checkIf(context, node, expected) — checks `if`/`else` branches, rules out dead branches via `decidedValue`, and agrees types; [exp]; callers: 1 outside folder
- checkCondition(context, condition) — checks `condition` settled as `Bool` and records `decidedValue` if fixed by types

## src/compiler/checker/constructs/expressions/control/match.ts — Checking `match` and `is` expressions, ruling out impossible cases, and exhaustiveness
- checkMatch(context, node, expected) — checks `match` cases with `remainingType`, rules out `cantMatch` cases, and checks coverage; [exp]; callers: 1 outside folder
- checkIs(context, node, expected?) — checks `x is P`, records pattern keys, and decides `false` when `cantMatch`; [exp]; callers: 1 outside folder
- reportCoverage(context, node, subject, cases) — runs exhaustiveness `analyze` and reports `nonExhaustiveMatch` and `unreachableCase`

## src/compiler/checker/constructs/expressions/control/propagate.ts — Checking `e?` error propagation on `Result<T, E>`
- checkPropagate(context, node) — unwraps `Ok` type `T` from `Result<T, E>` and registers `E` with `context.returns.propagate`; [exp]; callers: 1 outside folder

## src/compiler/checker/constructs/expressions/control/select.ts — Checking `select` and `await select` over racing futures
- checkSelect(context, node, expected) — checks `select` form, case futures, cleanup bodies, and branch type agreement; [exp]; callers: 1 outside folder
- watchesOwnDisposal(context, future) — tests whether `future` calls `prelude.disposing()` on the enclosing function's `OwnCall`
- reportForm(context, node) — validates `await select` vs `else` clause requirements
- checkCaseFuture(context, selectCase, checksKind) — checks a `SelectCase`'s future via `awaitedThrough` and binds or discards its value

## src/compiler/checker/constructs/expressions/deferred-calls.ts — Checking deferred calls `g f(args)` and synthesizing their zero-arg closure type
- Deferrals(passes) — per-pass table recording the parameter function type each deferred call is built as; [exp]; callers: 2 outside folder
- checkDeferredCall(context, node, expected) — checks `g f(args)` as a call to `g` with a synthesized closure for `f(args)`; [exp]; callers: 0 outside folder
- missingComma(context, node) — reports `missingComma` when a deferred call's taker is a non-callable value
- deferredFunction(context, node) — checks `node.call` settled and builds the `fn() -> R` `WrittenArgument` passed to `node.taker`
- laterMarkOf(context, callee, computed) — joins `callee`'s mark with the data kinds of values `computed` now
- laterCallKind(context, call) — computes `markMaking` for a resolved deferred call or reads a function value's `mark`
- unmade(context, call) — returns `Never` for a stopped call or reports `notDeferrable` on a fieldless variant call
- refused(context, call) — reports `&` reference arguments/receivers or optional-chain calls inside a deferred call
- referencedReceiver(context, call) — returns the receiver expression if `call` resolved to a `&self` method
- computedNow(context, call) — lists operands evaluated eagerly by `call` (callee/receiver, arguments, nested deferreds)
- calleeNow(context, call) — returns the `[callee]` or `[receiver]` operand evaluated eagerly by `call`

## src/compiler/checker/constructs/expressions/expressions.ts — Exhaustive `Handlers` dispatch table over `Expression` node kinds
- misplacedReference(context, node) — checks inner expression of a misplaced `&x` (already reported by parser) and returns `errorType`
- expressionHandlers — `Handlers` table mapping each `Expression` kind to its checker function; [exp]; callers: 1 outside folder

## src/compiler/checker/constructs/expressions/literals/indented-values.ts — Resolving an `IndentedValue`'s literal form (array, map, or struct) and checking it
- checkIndentedValue(context, node, expected) — determines `LiteralForm`, validates entries/keys, builds `literalOf`, and checks it; [exp]; callers: 1 outside folder
- buildingOf(context, node, expected) — decides `{ form, target }` from `node.type` or `expected`
- anonymousForm(context, node, expected) — decides `LiteralForm` for an untyped indented value from `expected` or `untypedForm`
- namesStruct(context, entity) — tests whether `entity` names a declared struct or an alias of a shape
- formOf(context, type) — maps `type` to `'array' | 'map' | 'struct'` (or `undefined` if `type` decides none)
- isStructType(context, type) — tests whether `type` is an anonymous shape or a nominal struct with fields
- reportLeftOut(context, node, form) — reports mixed items/keys or entries incompatible with `form`
- leftOutDiagnostic(entry, form) — builds the diagnostic for an `IndentedEntry` rejected by `form`
- keysFit(context, node, form, target) — verifies that a map built from an indented value accepts `String` keys
- takesStrings(context, key) — tests whether `key` accepts a string literal or `String`
- checkValuesAlone(context, entries) — checks entry expressions standalone when the indented value itself is invalid
- indentedAccepts(context, node) — returns `Admits` predicate for an untyped `IndentedValue` in a constraint scope; [exp]; callers: 1 outside folder

## src/compiler/checker/constructs/expressions/literals/literals.ts — Checking `DurationLiteral` expressions against `time.Duration`
- checkDurationLiteral(context, node) — returns `time.Duration` or reports `missingStdModule`; [exp]; callers: 1 outside folder

## src/compiler/checker/constructs/expressions/literals/templates.ts — Checking tagged and untagged template literals (`toString` and `join`)
- checkTemplate(context, node, expected) — checks a tagged template as `taggedCall(node)` or an untagged template via `toString`/`join`; [exp]; callers: 1 outside folder
- join(context, node) — records the prelude `join` call for a non-constant untagged template
- interpolate(context, operand) — resolves and records the `toString` implicit call for one template interpolation

## src/compiler/checker/constructs/expressions/literals/tuples.ts — Checking tuple literals `(a, b)` and tuple element reads `t.0`
- checkTuple(context, node, expected) — checks tuple elements guided by `expectedTuple` and returns `Unit` or `TupleType`; [exp]; callers: 1 outside folder
- checkTupleElement(context, node) — checks `t.0` (including in optional chains) and returns the element type at `node.element`; [exp]; callers: 1 outside folder

## src/compiler/checker/constructs/expressions/operators/decided-conditions.ts — Type-decided `==`, `!=`, `is`, and boolean conditions (`if` dead-branch elimination)
- decidedValue(context, condition) — evaluates constant boolean value of `condition` from type-decided comparisons and `not`/`and`/`or`; [exp]; callers: 1 outside folder
- EqualityAt — location and operator metadata for `checkEquality`; [exp]; callers: 0 outside folder
- checkEquality(context, left, right, at) — fits `==`/`!=` operands, records struct keys, and warns when types fix the result; [exp]; callers: 0 outside folder
- decideComparison(context, node, value) — records `value` for `node` in `context.decisions` and warns `decidedCondition`; [exp]; callers: 1 outside folder
- decidedLogic(context, node) — combines `decidedValue` across `and`/`or` operands with short-circuiting

## src/compiler/checker/constructs/expressions/operators/operators.ts — Checking binary, unary, and chained comparison operators
- checkBinary(context, node, expected) — checks comparison, logic, `??`, or function-backed binary operators; [exp]; callers: 1 outside folder
- checkUnary(context, node, expected?) — checks `not` or unary operator calls, preserving signed number literal types; [exp]; callers: 1 outside folder
- checkChainedComparison(context, node) — checks chained comparisons (`a < b <= c`) via `checkComparisons`; [exp]; callers: 1 outside folder
- checkComparisons(context, comparison, links) — checks comparison links once per shared operand, dispatching `compare`/`includes`/`==`
- checkLinkCall(context, link, operator, sides) — resolves `compare` or `includes` for one comparison link and verifies `Bool` for `in`
- operandsOf(context, node) — evaluates `left` and `right` of a binary operator into `Operand[]`

## src/compiler/checker/constructs/expressions/postponed.ts — Postponing context-dependent expressions in constraint scopes and narrowing expected unions
- Postponing — `{ admits, expected, check }` input bundle for `postponed`; [exp]; callers: 0 outside folder
- postponed(context, node, postponing) — creates a scope placeholder for `node` and registers its `judge` callback; [exp]; callers: 5 outside folder
- postponedAdmits(context, node) — returns the unfolded `Admits` predicate if `node` must be postponed in an open scope; [exp]; callers: 1 outside folder
- memberBuilt(context, node, expected, admits) — narrows an expected union to the single member `node` is built as; [exp]; callers: 1 outside folder
- memberAdmitted(context, node, expected, admits) — recursively narrows a union to the unique member admitted by `admits`
- formAdmits(context, node, expected) — returns a form-based `Admits` predicate for non-empty array, map, and tuple literals
- ownAdmits(context, node) — dispatches on `node.kind` to get its raw `Admits` predicate if postponable
- judgeLambda(context, node, expected) — checks a postponed lambda once its parameter slots (and optional return guide) are known
- judgeNamed(context, node, expected, check) — checks a postponed function/variant name, joining the scope if its return is still open

## src/compiler/checker/constructs/expressions/structs/literal-fields/index.ts — Checking struct literal items in a constraint scope and recording field sources
- LiteralSetting — `{ spread?, expected?, checked? }` options for `checkLiteralFields`; [exp]; callers: 0 outside folder
- checkLiteralFields(context, node, shape, setting?) — infers struct literal type arguments in the current scope and completes fields; [exp]; callers: 1 outside folder
- completeLiteral(context, checked) — settles literal type arguments, fits items/spread/comprehension, checks missing fields, records sources
- fitItems(context, items, substitution) — fits each given field value to its substituted field type and records struct keys
- spreadGiven(context, spread, type) — builds `{ from, names }` for a struct literal's leading spread
- decidedArguments(shape, parameters) — maps pre-known type arguments to `shape`'s type parameters
- complete(context, items, settling) — completes type argument inference for `shape.owner` and notes constraint checks

## src/compiler/checker/constructs/expressions/structs/literal-fields/items.ts — Checking individual struct literal items, missing fields, and field default calls
- LiteralShape — descriptor of the struct or aliased shape a literal builds; [exp]; callers: 2 outside folder
- LiteralSpread — leading `Spread` node and optional pre-checked `Type`; [exp]; callers: 1 outside folder
- GivenField — a field's value expression, checked type, declared type, and `isLiteral` flag; [exp]; callers: 0 outside folder
- LiteralItems — mutable accumulator of given fields and fit status while checking a literal; [exp]; callers: 0 outside folder
- checkItem(context, items, item, spread) — checks one `FieldsLiteral` item, reporting misplaced spreads or unknown/duplicate fields; [exp]; callers: 0 outside folder
- checkRefused(context, value) — checks an invalid/excess item's expression and abandons its open scope variables; [exp]; callers: 1 outside folder
- checkFieldValue(context, items, fieldValue) — checks a field's value against known field type or matches it in `items.inference`
- checkedValue(context, items, value, expected) — returns pre-checked type of `value` when `items.checked`, else checks `value`
- reportMisfit(context, items, item, field) — reports `positionalNeedsOneField`, `unknownField`, or `repeatedField`
- reportMissing(context, items, type, comprehended) — reports `missingField` for omitted non-defaulted fields without a spread; [exp]; callers: 0 outside folder
- defaultCalls(context, shape, given, typeArguments) — resolves the `fieldsFunction` call for omitted fields that have defaults; [exp]; callers: 0 outside folder
- literalName(node) — returns `'struct'` or the last identifier of `node.type.path`; [exp]; callers: 0 outside folder

## src/compiler/checker/constructs/expressions/structs/literal-sources.ts — Recording struct literal field sources and field layouts per pass
- StructLiterals(passes) — per-pass tables storing `FieldSource[]` and `FieldMember[]` for `FieldsLiteral`s; [exp]; callers: 2 outside folder
- StructLiterals.made() — collects all `MadeCall`s from field defaults across all struct literals in the body
- LiteralGiven — inputs to `sourcesOf` (`fields`, `given`, `spread`, `defaulted`, `comprehended`); [exp]; callers: 1 outside folder
- sourcesOf(literalGiven) — assembles `FieldSource[]` in declaration order from values, spread, defaults, and comprehension; [exp]; callers: 1 outside folder

## src/compiler/checker/constructs/expressions/structs/literal-types.ts — Resolving the struct or aliased shape a named struct literal builds
- Built — discriminated union (`'declared'` struct vs `'shape'` alias) returned by `builtThrough`; [exp]; callers: 0 outside folder
- knownArguments(context, typeNode, owner) — resolves explicit type arguments on `typeNode` via `typeArgumentsFor`
- builtThrough(context, node, entity, expected) — resolves `entity` to a declared struct or aliased shape and narrows `expected`; [exp]; callers: 0 outside folder
- aliasedShape(context, declaration) — returns the unfolded `AnonymousStructType` when `declaration` is a shape alias; [exp]; callers: 1 outside folder
- builtMember(context, node, declaration, expected) — picks the single nominal member of `declaration` in an expected union whose fields fit
- itemsFit(context, node, type) — tests whether `node`'s items can fit the fields of `type`

## src/compiler/checker/constructs/expressions/structs/struct-comprehensions.ts — Checking `for k, v in ...x: [k]: e` inside struct literals
- comprehensionOf(node) — returns the trailing `StructComprehension` of `node.items` if present; [exp]; callers: 1 outside folder
- ComprehensionTarget — declared fields, literal name, `Inference`, and `isGiven` predicate for `checkComprehended`; [exp]; callers: 0 outside folder
- Comprehended — result of `checkComprehended` (`node`, `passes`, per-pass `given` fields); [exp]; callers: 1 outside folder
- checkComprehended(context, literal, target) — checks a struct comprehension against declared `target` fields across field passes; [exp]; callers: 1 outside folder
- comprehendedField(context, node, target, pass) — checks one field pass of `node` against `target.fields`, reporting unknown/repeated fields
- fitComprehended(context, comprehended, substitution) — fits each pass's comprehended field value after type arguments settle; [exp]; callers: 1 outside folder
- comprehendedGiven(comprehended) — returns `{ node, indices }` of fields supplied by `comprehended`; [exp]; callers: 1 outside folder
- freshComprehended(context, literal, named) — checks a comprehension in an untyped `struct{…}` and collects its fields/source; [exp]; callers: 0 outside folder
- checkComprehensionAlone(context, node) — checks `node.value` across field passes when the enclosing literal is invalid; [exp]; callers: 0 outside folder
- givesKeysOf(context, named, subject, target) — tests whether `named` keys unioned with `keyof subject` equal `keyof target`
- checkOpaqueComprehended(context, node, comprehension, expected) — checks `struct{…}` with a comprehension building an opaque struct; [exp]; callers: 0 outside folder
- checkNamedOf(context, node, expected) — checks explicit named items of `node` against `expected` via `checkNamedItem`
- checkNamedItem(context, item, expected, keys) — checks one `FieldInitializer` against `fieldType(expected, key)`

## src/compiler/checker/constructs/expressions/structs/structs.ts — Checking named (`T{…}`, `new T{…}`) and anonymous (`struct{…}`) struct literals
- checkStructLiteral(context, node, expected) — dispatches `node` to `checkNamedLiteral` or `checkAnonymousLiteral`; [exp]; callers: 1 outside folder
- checkNamedLiteral(context, node, expected) — forwards to `namedLiteralType` for `T{…}` and `new T{…}`; [exp]; callers: 1 outside folder
- namedLiteralType(context, node, expected) — checks a named struct or `new` shared-struct literal, refusing variants and fieldless structs
- checkNew(context, node, isShared) — reports `sharedNeedsNew` or `newNotShared` when `new` mismatches `SharedStructDeclaration`
- checkAnonymousLiteral(context, node, expected, spread) — checks `struct{…}` from `expected`, leading `spread`, opaque keys, or fresh shape
- shapeOf(context, type) — builds a `LiteralShape` for an anonymous struct or nominal struct with fields
- unionHolding(expected, entity) — returns `expected` when it is a union containing a nominal member of `entity`
- declaredShape(context, entity, known) — builds a `LiteralShape` for a `DeclaredStruct` entity
- builtOnceExpected(context, node, shape, expected) — postpones a spreadless `struct{…}` with lower shape bound `shape` in an open scope
- builtAs(context, node, shape, expected) — re-checks a postponed `struct{…}` against `expected` once settled, or keeps `shape`
- memberTaking(context, union, shape) — returns the unique member of `union` that takes or fits `shape`
- freshAnonymous(context, node) — builds an `AnonymousStructType` and records sources from `node`'s own named items and comprehension
- checkValuesAlone(context, node) — checks all item expressions of a rejected struct literal via `checkRefused`

## src/compiler/checker/constructs/expressions/structs/variants.ts — Checking enum variants as values, constructors, and calls, plus `none`
- variantNameAccepts(context, node, naming) — returns `Admits` predicate for a bare variant name (fieldless value or constructor); [exp]; callers: 1 outside folder
- qualifiedVariantAccepts(context, node) — returns `Admits` predicate for a qualified fieldless variant of a generic enum; [exp]; callers: 1 outside folder
- variantCallAccepts(context, node) — returns `Admits` predicate for a bare variant constructor call `V(...)`; [exp]; callers: 1 outside folder
- checkNone() — returns `noneType` for a `NoneLiteral`; [exp]; callers: 1 outside folder
- checkVariantValue(context, node, naming, expected) — checks a bare or qualified variant as a constructor function value or enum value; [exp]; callers: 2 outside folder
- asksForVariant(expected, naming) — tests whether `expected` asks for an enum value of `naming` rather than a function
- checkVariantName(context, node, naming, expected) — chooses a variant, reports `variantFields` if it has fields, and instantiates its enum
- VariantCall — `{ node, expected, typeArguments, written }` input for `checkVariantCall`; [exp]; callers: 0 outside folder
- checkVariantCall(context, call, callee, naming) — resolves `V(args)` via `fieldsFunctionOf` or checks `()` on a fieldless variant; [exp]; callers: 1 outside folder
- refuseVariantLiteral(context, at, name, options) — reports `variantInBraces` (`V{…}` / `V:`) and records chosen bare variant; [exp]; callers: 1 outside folder

## src/compiler/checker/constructs/loops/field-passes.ts — Computing and running per-field checking passes for `for ... in ...s` and comprehensions
- checkedFieldPasses(context, header) — checks `header.subject` settled and computes `FieldPassType[]` passes; [exp]; callers: 3 outside folder
- inFieldPasses(context, header, passes, each) — runs `each` in every pass of `passes` with `header`'s key/value targets declared; [exp]; callers: 3 outside folder
- fieldPassesOver(checker, subject, header) — derives `FieldPassType[]` for `subject`'s named literal keys and opaque other keys

## src/compiler/checker/constructs/loops/iteration.ts — Checking `iterate` protocol calls for `for` loops, comprehensions, and spreads
- Iterations(passes) — per-pass table mapping `Iteration` nodes to `IterationForm` (`'cursor'` or `'copied'`); [exp]; callers: 2 outside folder
- checkIterated(context, node, iterable, expected?) — checks `iterable` and resolves its `iterate` cursor call via `iteratedItem`; [exp]; callers: 1 outside folder
- iteratedItem(context, node, iterable, type) — resolves `iterate(iterable) -> fn() -> Step<T>`, checks cursor mark, and records form; [exp]; callers: 2 outside folder
- checkLoopOver(context, node) — checks `node.iterable` and declares `node`'s loop targets with the item type; [exp]; callers: 2 outside folder

## src/compiler/checker/constructs/patterns/exhaustiveness/exhaustiveness.ts — Maranget pattern-matrix usefulness and missing-witness algorithm
- Shape — pattern shape union (`AnyShape | ConstructorShape | OrShape | ArrayShape`); [exp]; callers: 7 outside folder
- WitnessShape — missing-value witness shape union (`AnyShape | ConstructorShape`); [exp]; callers: 0 outside folder
- AnyShape — `{ kind: 'any' }` wildcard shape interface; [exp]; callers: 0 outside folder
- ConstructorKey — `string | LengthKey` identifying a type constructor or array length; [exp]; callers: 0 outside folder
- anyShape — singleton `{ kind: 'any' }` shape; [exp]; callers: 9 outside folder
- nothingShape — singleton empty `OrShape` matching no value; [exp]; callers: 2 outside folder
- lengthKey(length, orMore?) — builds a `LengthKey` for array length constructors; [exp]; callers: 0 outside folder
- sameConstructorKey(left, right) — tests equality of two `ConstructorKey`s; [exp]; callers: 0 outside folder
- ConstructorOf — `{ key, arguments }` descriptor of one constructor of a type; [exp]; callers: 0 outside folder
- Signature — callback mapping a type `T` to its `ConstructorOf<T>[]` or `{ items: T }`; [exp]; callers: 0 outside folder
- Analysis — `{ missing, unreachable }` result of `analyze`; [exp]; callers: 0 outside folder
- CaseShape — `{ shape, guarded }` input descriptor for one `match` case; [exp]; callers: 1 outside folder
- analyze(signature, type, cases) — computes unreachable case indices and up to 3 missing `WitnessShape`s; [exp]; callers: 1 outside folder
- longArrays(shapes) — computes the threshold array length from which longer arrays share one constructor; [exp]; callers: 0 outside folder
- arrayExtents(shape) — collects all nested `ArrayShape`s within `shape`
- withLengths(shape, longer) — rewrites `ArrayShape`s inside `shape` into `LengthKey` constructor / `or` shapes
- Matrix.useful(written, vector, types) — tests whether `vector` is useful with respect to `written` rows
- Matrix.missing(written, types) — finds up to `witnessLimit` witness vectors not covered by `written` rows
- Matrix.#completeSignature(rows, type) — returns all constructors of `type` if every constructor is mentioned in `rows`'s head column
- Matrix.#unlistedConstructor(rows, type) — builds a `WitnessShape` for a constructor of `type` not mentioned in `rows`
- Matrix.#constructors(type) — returns `type`'s constructors, expanding array `{ items }` into `LengthKey` constructors up to `#longer`
- withAlternatives(rows) — expands leading `OrShape` heads into separate `SpecializedRow`s
- specialize(rows, key, arity) — specializes `rows` for constructor `key` of `arity`

## src/compiler/checker/constructs/patterns/exhaustiveness/remaining.ts — Narrowing a union subject by unguarded earlier `match` cases
- remainingType(checker, subject, cases) — filters out union members of `subject` already covered by unguarded `cases`; [exp]; callers: 1 outside folder
- subjectPart(subject, remaining) — builds the root `ValuePart` for a pattern with `narrowedFrom: subject` when narrowed; [exp]; callers: 1 outside folder

## src/compiler/checker/constructs/patterns/exhaustiveness/shapes.ts — Mapping checker `Type`s to exhaustiveness `Signature`s and formatting witnesses
- ShapeChecker — subset of `Checker` and `CheckerContext` needed to inspect constructors of a `Type`; [exp]; callers: 0 outside folder
- structKey — `'struct'` constructor key constant; [exp]; callers: 1 outside folder
- tupleKey — `'tuple'` constructor key constant; [exp]; callers: 1 outside folder
- signatureOf(checker) — returns the exhaustiveness `Signature<Type>` function for `checker`; [exp]; callers: 1 outside folder
- constructorsOf(checker, type) — returns `ConstructorOf<Type>[]` for non-array types (unfolding recursives and member parameters)
- ownConstructors(type) — returns constructors for `Bool`, `Unit`, tuples, unions, and literal types
- declaredConstructors(checker, type) — returns constructors for nominal enums (variants) and structs (fields)
- memberShape(member, inside) — builds a union-member `ConstructorShape` wrapping `inside`; [exp]; callers: 2 outside folder
- nullaryShape(key) — builds a zero-argument `ConstructorShape` for `key`; [exp]; callers: 1 outside folder
- literalShape(node) — builds a `nullaryShape` for a boolean, string, or signed number literal; [exp]; callers: 1 outside folder
- literalKey(node) — returns the constructor key string for a literal expression `node`
- literalValueKey(value) — formats a `LiteralValue` into its constructor key string
- witnessText(checker, shape, type) — formats a missing `WitnessShape` as an Istalang pattern string; [exp]; callers: 1 outside folder
- structWitness(name, fields, parts) — formats a missing struct witness (`Name{…}` or `Name{f is p}`)
- variantWitness(name, fields, parts) — formats a missing variant call pattern witness (`Name(…)` or `Name(f: p, ...)`)
- arrayWitness(checker, shape, items) — formats a missing array witness (`[_, ..._]`)
- memberWitness(checker, shape, union) — formats a missing union member witness
- fieldsOfConstructor(checker, type, key) — returns the `FieldMember[]` of struct or variant constructor `key` on `type`

## src/compiler/checker/constructs/patterns/matching.ts — Checking refutable `match` and `is` patterns and building `PatternTests`
- CheckedPatterns(passes) — per-pass table storing `CheckedPattern`s by `Pattern` node; [exp]; callers: 2 outside folder
- checkPattern(context, pattern, subject, remaining?) — walks `pattern` with `testsIn(context)`, declares bound names, and records it; [exp]; callers: 1 outside folder
- testsIn(context) — builds the `PatternTests` callback bag for refutable pattern constructs in `context`
- arrayTest(context, items, part) — checks an array pattern against `Array<T>`, recording `length`/`_patternItem`/`_patternRest` calls
- literal(context, node, part) — checks a `LiteralPattern` via `fitEqualSides` and `decidedEquality`
- comparison(context, item, part) — checks a `CompareFieldPattern` (`==`, `!=`, or ordering via `implicitOperatorCall`)
- valueShape(context, value, part) — returns the exhaustiveness `Shape` for a literal, `none`, or nullary variant value
- reference(context, node, part) — checks a non-binding `NamePattern` as a variant, type pattern, or top-level constant
- typeLeaf(context, node, entity, part) — checks a type `NamePattern` via `namesOwnType` or reports `otherTypeNamed`
- namedVariant(context, at, naming, part) — chooses and validates an enum variant against `part.type`
- variantOf(context, part, name) — looks up variant `name` on `part.type` and builds its `VariantPart` test
- variantLeaf(variantPart) — builds a `Leaf` for a bare variant pattern covering `anyShape` for each field

## src/compiler/checker/constructs/patterns/targets.ts — Declaring destructuring targets for `let`/`const`, `for`, comprehensions, and parameters
- declareTargets(context, owner, type) — walks `owner`'s targets against `type`, declares bound variables, and records `TargetBinding[]`; [exp]; callers: 4 outside folder
- declareParameter(context, parameter) — declares a parameter's own name and any destructuring pattern targets in `context`; [exp]; callers: 4 outside folder

## src/compiler/checker/constructs/patterns/walk/index.ts — Unified walk over refutable patterns and irrefutable destructuring targets
- WalkedPattern — `{ tests, bindings, shape }` result of `walkPattern`; [exp]; callers: 1 outside folder
- walkPattern(scope, tests, pattern, part) — walks `pattern` against `part` using `tests` for refutable constructs; [exp]; callers: 1 outside folder
- walkTargets(scope, targets, type, typed?) — walks irrefutable `targets` against `type` and returns `TargetBinding[]`; [exp]; callers: 1 outside folder
- newWalk(scope, tests, typed?) — creates a `Walk` accumulator for `scope` and `tests`
- patternHandlers — `Handlers` table dispatching each `Pattern | PatternPart` kind during a walk
- takeMatched(walk, written, part) — unwraps parens, handles `OrPattern` and refused variant calls/braces, or calls `takeSelecting`
- refusedCall(walk, node, part) — handles a `VariantCallPattern` that does not name a variant, binding inner names at `errorType`
- refusedBraces(walk, node, part) — reports `variantInBracesPattern` when a `StructPattern` names a variant
- takeSelecting(walk, node, part) — handles `Never` parts, applies union/downcast `selectionOf`, and dispatches to `patternHandlers`
- takeSelected(walk, node, selection) — records `selection.test` and walks `node` against `selection.part`
- takeRuledOut(walk, node, part) — records `neverTest` and binds `node`'s names at `Never`
- binds(walk, node) — tests whether `NamePattern` binds a variable rather than referring to a variant/type/constant
- takeAlternatives(walk, node, part) — walks `OrPattern` alternatives, filters ruled-out ones, checks `sameNames`, and merges parts
- takeStruct(walk, node, part) — walks a `StructPattern` (by name for unknown structs or via `takeApart`) and adds `restBinding`
- refutable(walk, node, part, check) — runs `check(walk.tests)` or refuses `node` as a `refutableTarget` in target mode
- refused(walk, node, part) — reports `refutableTarget` and binds `node`'s target names at `errorType`
- bindAt(walk, node, part, type) — binds all variable names in `node` to `type` at `part.path`
- spanOf(targets) — returns the `AnchoredSpan` across `targets`

## src/compiler/checker/constructs/patterns/walk/kinds/alternatives.ts — Or-pattern binding consistency and union/downcast part merging
- partSelected(part, selected, rules) — computes the `ValuePart` bound by `as` on an `OrPattern` from its alternatives' selections; [exp]; callers: 1 outside folder
- castSelected(part, selected, rules) — unions the types downcast or literal-selected from an `AnyType` across alternatives
- sameNames(first, other) — tests whether two alternatives bind the exact same variable names with compatible types; [exp]; callers: 1 outside folder

## src/compiler/checker/constructs/patterns/walk/kinds/arrays.ts — Walking array patterns and variant rest-field item patterns
- ItemTaking — `Taking` extension carrying `found: PatternTest[]`; [exp]; callers: 0 outside folder
- takeArray(walk, tests, items, part) — records array length test and walks prefix, suffix, and `...rest` elements; [exp]; callers: 1 outside folder

## src/compiler/checker/constructs/patterns/walk/kinds/downcasts.ts — Downcasting `any` trait-object values in patterns
- Downcast — `{ test, part }` produced when a pattern downcasts an `AnyType`; [exp]; callers: 1 outside folder
- downcastOf(context, node, part) — builds the `Downcast` test and narrowed `ValuePart`, or `'ruledOut'`/`undefined`; [exp]; callers: 1 outside folder
- namedTypeOf(context, node, from) — resolves the downcast target type via `downcastTargetOf` and reports invalid/generic targets

## src/compiler/checker/constructs/patterns/walk/kinds/ranges.ts — Checking integer range patterns (`1..10`, `1..=10`, `..0`)
- rangeLeaf(context, node, part) — checks `RangePattern` bounds as `Int`, reports empty ranges, and emits `compare` tests; [exp]; callers: 1 outside folder
- compareFunction — re-export of `binaryOperators['<'].meaning.function` (`'compare'`); [exp]; callers: 1 outside folder

## src/compiler/checker/constructs/patterns/walk/kinds/struct-fields.ts — Struct patterns over opaque/constrained structs and `...rest` field bindings
- isStructNotKnown(scope, type) — tests whether `type` has struct keys (`keyof`) but no known `fieldsOf` list; [exp]; callers: 1 outside folder
- takeFieldsByName(taking, items, part) — walks struct pattern `items` against an opaque struct using `fieldType`; [exp]; callers: 1 outside folder
- fieldTypeNamed(scope, part, name) — looks up `fieldType(part.type, name)`, recording the field or reporting `unknownField`
- restBinding(rules, pattern, part) — builds the `PartBinding` for a struct pattern's `...rest` as a mapped struct type; [exp]; callers: 1 outside folder
- restType(rules, of, named, rest) — constructs `{ [F in keyof S except named]: S[F] }` via `rules.mappedType`

## src/compiler/checker/constructs/patterns/walk/kinds/variant-calls.ts — Checking variant call patterns `V(a, b: p, ...rest)` and refused `V{…}` patterns
- VariantBraced — descriptor for a `StructPattern` that erroneously names an enum variant; [exp]; callers: 0 outside folder
- variantBraced(scope, node) — returns `VariantBraced` when `node` is a `StructPattern` naming a variant; [exp]; callers: 1 outside folder
- takeVariantBraces(walk, tests, braced, part) — walks a refused `V{…}` pattern's items at `errorType` while still testing the variant; [exp]; callers: 1 outside folder
- declaresVariant(type, braced) — tests whether `type` is the enum declaring `braced`'s variant
- calledVariant(scope, node) — returns `VariantNaming` for `node.callee` or reports `notVariantCalled`; [exp]; callers: 1 outside folder
- takeVariantCall(walk, tests, node, part) — binds call pattern arguments to variant fields via `bindArguments` and walks them; [exp]; callers: 1 outside folder
- warnEmpty(walk, node, slots) — warns on `V()` when `V` is fieldless (`fieldlessCalled`) or all fields have defaults/rest (`defaultsCallPattern`)
- slotOf(field, leaves) — builds a `BoundSlot` for a variant `field`
- boundArgument(argument) — converts a `BoundPatternArgument` to `{ name, isSpread }` for `bindArguments`
- takeField(walk, tests, taken, part) — walks a single argument or rest array items bound to a variant field
- takeRestItems(walk, tests, items, part) — walks arguments collected into a variant's `...rest` field via `takeArray` or whole spread
- takeReached(walk, call, variant, part) — walks arguments of an ill-bound call pattern against best-effort `argumentsReach` fields
- recordGiven(walk, argument, field) — records `field` on `argument` (or `argument.name`) in `walk.scope`
- failureReport(call, variant, failure) — maps a `BindingFailure` on a call pattern to its checker diagnostic

## src/compiler/checker/constructs/patterns/walk/members.ts — Selecting union members in refutable patterns
- unionPart(part) — returns the `UnionType` `part` selects from (`part.narrowedFrom` or `part.type`); [exp]; callers: 1 outside folder
- memberTaken(scope, node, part, union) — resolves the `Selection` of `union` members matched by `node`; [exp]; callers: 0 outside folder
- leftOf(part, selected) — narrows `selected` union members to those still remaining in `part.type`; [exp]; callers: 1 outside folder
- selectsMember(scope, node, part) — tests whether `node` selects union members rather than matching the union type as a whole; [exp]; callers: 0 outside folder
- namesType(scope, node) — tests whether `NamePattern` refers to a type rather than a variant or constant
- selectedMembers(scope, node, union, single) — finds candidate members of `union` for `node` and reports `severalMembers` if ambiguous
- telling(node, texts) — formats the disambiguation hint for `severalMembers` on non-call patterns
- variantTelling(scope, node, members) — formats the disambiguation hint (`Enum.Variant` vs `Variant<T>`) for a `VariantCallPattern`
- candidates(scope, node, union) — dispatches on `node.kind` to find candidate union members via `literalSelected`/`kindMembers`/`namedMembers`
- literalSelected(scope, members, value) — returns union `members` matching literal `value` via `literalMembers`
- literalTypeOf(value) — returns the `LiteralType`, `None`, or `Float` of a pattern's literal `value`; [exp]; callers: 0 outside folder

## src/compiler/checker/constructs/patterns/walk/named-members.ts — Selecting union members by type, variant, or constant name (and `<…>`)
- namedMembers(scope, written, union) — resolves union members selected by a named type, variant, or constant in a pattern; [exp]; callers: 0 outside folder
- instanceNamed(scope, entity, written, state) — filters selected union members by explicit type arguments written in the pattern
- typeParameterCount(pattern, enums) — returns the expected type parameter count for `typeArgumentCount` diagnostics

## src/compiler/checker/constructs/patterns/walk/parts.ts — Pattern `ValuePart` steps, `PatternScope` adapter, and tuple/struct part extraction
- PatternScope — interface of checker/body queries used while walking patterns; [exp]; callers: 2 outside folder
- bodyScope(context) — wraps a `BodyContext` into a `PatternScope`; [exp]; callers: 3 outside folder
- ValuePart — `{ type, path, narrowedFrom? }` describing a sub-part of a matched value; [exp]; callers: 9 outside folder
- elementParts(scope, part, count, span) — extracts `count` tuple element `ValuePart`s from `part` or reports `tupleArity`; [exp]; callers: 0 outside folder
- structParts(scope, named, type, span) — validates and returns `FieldMember[]` for a struct destructuring target; [exp]; callers: 0 outside folder
- otherTypeNamed(scope, entity, named, type) — builds `genericAliasPattern` or `typeMismatch` diagnostic for a mismatched pattern type; [exp]; callers: 1 outside folder
- structFieldStep(part, name) — builds a `{ kind: 'field', of: part.type, name }` `FieldStep`; [exp]; callers: 1 outside folder
- fieldPart(scope, fields, item, part) — resolves the `FieldMember` and `ValuePart` for one struct pattern/target field item; [exp]; callers: 1 outside folder

## src/compiler/checker/constructs/patterns/walk/pattern-tests.ts — Contracts (`Leaf`, `Selection`, `PatternTests`) between the pattern walk and `matching.ts`
- Leaf — `{ tests, shape }` returned by a refutable pattern leaf check; [exp]; callers: 2 outside folder
- failed — `Leaf` constant `{ tests: [], shape: undefined }` for a reported pattern error; [exp]; callers: 2 outside folder
- ruledOutLeaf — `Leaf` constant `{ tests: [neverTest], shape: nothingShape }` for an impossible pattern; [exp]; callers: 1 outside folder
- ArrayItems — `{ site, elements, isOpen? }` input for array pattern testing; [exp]; callers: 3 outside folder
- ArrayPart — `{ test, items }` output of `PatternTests.array`; [exp]; callers: 1 outside folder
- VariantPart — `{ test, key, fields }` output of `PatternTests.variant`; [exp]; callers: 2 outside folder
- Selection — `{ test, part, decided, shapeOf }` union-member or downcast selection before destructuring; [exp]; callers: 0 outside folder
- ruledOutSelection(part) — builds a `Selection` with `neverTest` and `neverType` part for a ruled-out selection; [exp]; callers: 0 outside folder
- PatternTests — callback interface for refutable pattern leaves (literals, comparisons, variants, arrays, ranges, downcasts); [exp]; callers: 3 outside folder

## src/compiler/checker/constructs/patterns/walk/selections.ts — Pre-destructuring pattern selection (union member selection and `any` downcasts)
- selectionOf(scope, tests, node, part) — computes the union-member or `any`-downcast `Selection` for `node` on `part`; [exp]; callers: 0 outside folder
- namesOtherType(scope, node, type) — tests whether `node` names a known type or variant disjoint from non-union `type`
- isDowncasting(scope, node, type) — tests whether `node` downcasts `AnyType` `type` rather than naming `type` itself
- downcastSelection(tests, node, part) — wraps `tests.downcast(node, part)` into a guard `Selection`
- literalThroughAny(scope, node, part) — selects a literal member absorbed into an `AnyType`
- literalPart(node, part) — narrows `part.type` to `node`'s literal type when `node` is a `LiteralPattern` over its base type; [exp]; callers: 0 outside folder
- refuseTypeArguments(scope, node) — reports `typeArgumentsOutsideUnion` if `node` has `<…>` without selecting a union member; [exp]; callers: 0 outside folder

## src/compiler/checker/constructs/patterns/walk/taking.ts — Shared tuple and struct destructuring walk for patterns, targets, and assignments
- Taking — `{ scope, take }` interface for recursive target/pattern destructuring; [exp]; callers: 3 outside folder
- takeTargets(taking, targets, part, span) — takes a single target whole or multiple targets as a tuple; [exp]; callers: 1 outside folder
- takeApart(taking, destructuring, part) — destructures a tuple or struct `ValuePart` across its elements or fields; [exp]; callers: 1 outside folder
- takeFields(taking, items, fields, part) — walks struct `items` against `fields` and returns per-field exhaustiveness shapes
- constructed(key, shapes) — builds a `ConstructorShape` when all argument `shapes` are defined (non-guard); [exp]; callers: 2 outside folder

## src/compiler/checker/constructs/statements/assignments.ts — Checking `=`, destructuring assignments, and `op=` compound assignments
- checkAssignment(context, node) — checks simple, destructuring, or compound assignments and records `AssignedPart[]`; [exp]; callers: 0 outside folder
- prepareTarget(context, target) — recursively checks assignment target places in source order before checking `node.value`
- expectedOf(target) — computes the type `target` expects of the assigned value to guide inference
- checkCompound(context, node, target, operator) — checks `x op= v` by resolving binary `operator` and recording the fit
- writtenFit(context, target, written) — fits `written.type` to `target` (or each field of `severalKeyedFields`)
- assigningIn(context, valueSpan) — creates the `Assigning` (`Taking`) state for destructuring an assigned value
- assignPart(context, assigning, target, part) — fits a leaf `place` target or recurses on a nested `destructuring` target
- assignedPlace(context, written) — checks that `written` is a mutable variable or place and returns its type

## src/compiler/checker/constructs/statements/loops.ts — Checking `while`, `for`, field loops, labelled blocks, `break`, `continue`, and `hold`
- checkWhile(context, node) — checks `node.condition` as `Bool` and checks the loop body in `checkScope`; [exp]; callers: 0 outside folder
- checkFor(context, node) — checks `checkLoopOver` and checks the loop body in `checkScope`; [exp]; callers: 0 outside folder
- checkLabelledBlock(context, node) — checks a labelled block statement in `checkScope`; [exp]; callers: 0 outside folder
- checkLoopExit(context, node) — resolves `break`/`continue` target loop, records it in `context.labels`, and returns `Never`; [exp]; callers: 0 outside folder
- checkHoldScope(context, hold) — resolves `hold(label)` against enclosing scopes or own function name and records it; [exp]; callers: 0 outside folder
- checkFieldLoop(context, node) — checks `for k, v in ...s:` across `checkedFieldPasses` in `checkScope`; [exp]; callers: 0 outside folder
- checkScope(context, scope, checkBody?) — validates `scope.label` uniqueness, runs `checkBody` inside `enclosing`, and warns if unused
- LabelTargets() — records resolved `break`/`continue` targets and `hold` scopes for flow analysis and lowering; [exp]; callers: 2 outside folder
- LabelTargets.recordExit(exit, target) — records `target` for `exit` and marks `target` as named when `exit.label` is present

## src/compiler/checker/constructs/statements/statements.ts — Dispatching statement kinds and checking value/effect blocks
- statementHandlers — `Handlers` table mapping each `Statement | Invalid` kind to its checker function; [exp]; callers: 1 outside folder
- BlockUse — discriminated union (`'value'` with `expected` vs `'effect'`) for `checkBlock`; [exp]; callers: 0 outside folder
- checkBlock(context, block, use) — checks block statements, passing `expected` to a value block's tail and checking discarded values; [exp]; callers: 1 outside folder
- checkTail(context, node, expected) — checks a value block's final statement, joining the constraint scope via `context.part`

## src/compiler/checker/constructs/statements/variables.ts — Declaring variables/parameters, tracking mutability/cells, and warning on unused `let`
- VariableScope(passes, handles?) — tracks variable types, mutability, cell storage, targets, assignments, and unused-`let` warnings; [exp]; callers: 2 outside folder
- VariableScope.constructor(passes, handles?) — initializes per-pass tables for variable types, targets, and assignments
- VariableScope.declareParameter(parameter) — declares a parameter's identifier and records whether it is a `&` reference
- VariableScope.isChangeable(variable) — tests whether `variable` is a mutable `let` or a `&` reference parameter
- VariableScope.warnUnchanged(context) — warns `letNeverReassigned` on any `let` binding never mutated in the body
- checkVariableDeclaration(context, node) — checks a local `let`/`const` declaration, widens `let` type, and declares targets; [exp]; callers: 0 outside folder

## Concept footprint
- Optional/None: closures/lambdas.ts:lambdaAccepts, closures/value-calls.ts:checkValueCall, declarations/functions/clashes.ts:checkClashes, expressions/access/member-access.ts:checkMemberAccess, expressions/access/member-access.ts:readsNothing, expressions/access/member-access.ts:readsThroughNamespace, expressions/access/member-access.ts:noField, expressions/access/optionals.ts:OptionalChains.continues, expressions/access/optionals.ts:OptionalChains.target, expressions/access/optionals.ts:OptionalChains.linked, expressions/access/optionals.ts:OptionalChains.#baseOf, expressions/access/optionals.ts:checkUnwrap, expressions/access/optionals.ts:checkNullish, expressions/access/optionals.ts:reportedNeedsOptional, expressions/calls.ts:checkCall, expressions/calls.ts:calledBy, expressions/calls.ts:calledValue, expressions/calls.ts:callMethod, expressions/deferred-calls.ts:refused, expressions/expressions.ts:expressionHandlers, expressions/structs/variants.ts:variantCallAccepts, expressions/structs/variants.ts:checkNone, patterns/exhaustiveness/shapes.ts:ownConstructors, patterns/matching.ts:literal, patterns/matching.ts:valueShape, patterns/walk/members.ts:memberTaken, patterns/walk/members.ts:literalTypeOf
- Result/`?`: closures/returns.ts:ReturnScope.propagate, closures/returns.ts:ReturnScope.result, closures/returns.ts:checkPropagation, expressions/control/propagate.ts:checkPropagate, expressions/expressions.ts:expressionHandlers
- unions: declarations/aliases/alias-recursion.ts:typeChildrenOf, declarations/declarations.ts:checkTypeParameters, declarations/declarations.ts:checkAssociatedBounds, declarations/type-parameters.ts:resolveAssociatedBounds, expressions/literals/indented-values.ts:takesStrings, expressions/postponed.ts:memberBuilt, expressions/postponed.ts:memberAdmitted, expressions/postponed.ts:formAdmits, expressions/structs/literal-fields/items.ts:LiteralShape, expressions/structs/literal-types.ts:builtMember, expressions/structs/structs.ts:unionHolding, expressions/structs/structs.ts:builtAs, expressions/structs/structs.ts:memberTaking, expressions/structs/variants.ts:asksForVariant, loops/field-passes.ts:fieldPassesOver, patterns/exhaustiveness/remaining.ts:remainingType, patterns/exhaustiveness/remaining.ts:subjectPart, patterns/exhaustiveness/shapes.ts:constructorsOf, patterns/exhaustiveness/shapes.ts:ownConstructors, patterns/exhaustiveness/shapes.ts:memberShape, patterns/exhaustiveness/shapes.ts:witnessText, patterns/exhaustiveness/shapes.ts:memberWitness, patterns/walk/index.ts:takeSelected, patterns/walk/index.ts:takeAlternatives, patterns/walk/kinds/alternatives.ts:partSelected, patterns/walk/members.ts:unionPart, patterns/walk/members.ts:memberTaken, patterns/walk/members.ts:leftOf, patterns/walk/members.ts:selectsMember, patterns/walk/members.ts:namesOwn, patterns/walk/members.ts:selectedMembers, patterns/walk/members.ts:telling, patterns/walk/members.ts:variantTelling, patterns/walk/members.ts:candidates, patterns/walk/members.ts:literalSelected, patterns/walk/named-members.ts:namedMembers, patterns/walk/named-members.ts:instanceNamed, patterns/walk/selections.ts:selectionOf, patterns/walk/selections.ts:refuseTypeArguments
- enums/variants: closures/function-values.ts:checkAppliedFunction, declarations/declarations.ts:declarationHandlers, declarations/layout/index.ts:Layouts.variantsOf, declarations/layout/index.ts:Layouts.declaredVariantsOf, declarations/layout/index.ts:Layouts.#variantsOf, declarations/variance-markers.ts:checkMarker, expressions/access/member-access.ts:checkMemberAccess, expressions/access/names.ts:nameAccepts, expressions/access/names.ts:memberAccepts, expressions/access/names.ts:entityValueType, expressions/calls.ts:callEntity, expressions/deferred-calls.ts:unmade, expressions/literals/indented-values.ts:checkIndentedValue, expressions/postponed.ts:ownAdmits, expressions/structs/structs.ts:namedLiteralType, expressions/structs/variants.ts:variantNameAccepts, expressions/structs/variants.ts:qualifiedVariantAccepts, expressions/structs/variants.ts:variantCallAccepts, expressions/structs/variants.ts:checkVariantValue, expressions/structs/variants.ts:asksForVariant, expressions/structs/variants.ts:checkVariantName, expressions/structs/variants.ts:checkVariantCall, expressions/structs/variants.ts:refuseVariantLiteral, patterns/exhaustiveness/shapes.ts:declaredConstructors, patterns/exhaustiveness/shapes.ts:witnessText, patterns/exhaustiveness/shapes.ts:variantWitness, patterns/exhaustiveness/shapes.ts:fieldsOfConstructor, patterns/matching.ts:valueShape, patterns/matching.ts:reference, patterns/matching.ts:namedVariant, patterns/matching.ts:holdsNothing, patterns/matching.ts:variantOf, patterns/matching.ts:enumOf, patterns/matching.ts:variantLeaf, patterns/walk/index.ts:patternHandlers, patterns/walk/index.ts:refusedCall, patterns/walk/index.ts:refusedBraces, patterns/walk/kinds/variant-calls.ts:variantBraced, patterns/walk/kinds/variant-calls.ts:takeVariantBraces, patterns/walk/kinds/variant-calls.ts:declaresVariant, patterns/walk/kinds/variant-calls.ts:calledVariant, patterns/walk/kinds/variant-calls.ts:takeVariantCall, patterns/walk/kinds/variant-calls.ts:warnEmpty, patterns/walk/kinds/variant-calls.ts:slotOf, patterns/walk/kinds/variant-calls.ts:takeField, patterns/walk/kinds/variant-calls.ts:takeRestItems, patterns/walk/kinds/variant-calls.ts:takeReached, patterns/walk/kinds/variant-calls.ts:failureReport, patterns/walk/members.ts:namesType, patterns/walk/members.ts:variantTelling, patterns/walk/members.ts:candidates, patterns/walk/named-members.ts:namedMembers, patterns/walk/named-members.ts:instanceNamed, patterns/walk/named-members.ts:typeParameterCount, patterns/walk/parts.ts:structParts, patterns/walk/selections.ts:namesOtherType
- any/trait objects: declarations/aliases/alias-recursion.ts:typeChildrenOf, declarations/variance-markers.ts:whyNone, expressions/postponed.ts:formAdmits, patterns/walk/index.ts:takeSelecting, patterns/walk/kinds/alternatives.ts:partSelected, patterns/walk/kinds/alternatives.ts:castSelected, patterns/walk/kinds/downcasts.ts:downcastOf, patterns/walk/kinds/downcasts.ts:namedTypeOf, patterns/walk/parts.ts:ValuePart, patterns/walk/selections.ts:selectionOf, patterns/walk/selections.ts:isDowncasting, patterns/walk/selections.ts:downcastSelection, patterns/walk/selections.ts:literalThroughAny
- futures/await/select: closures/function-scope.ts:FunctionScope, closures/lambdas.ts:lambdaAccepts, closures/lambdas.ts:bodyResultGiven, closures/lambdas.ts:checkLambdaAs, closures/lambdas.ts:checkNested, closures/nested-types.ts:nestedTypeOf, closures/nested-types.ts:nestedValueKind, closures/own-calls.ts:declareOwnCall, closures/own-calls.ts:ownCallerOf, closures/returns.ts:ReturnScope, closures/returns.ts:ReturnScope.#checked, closures/returns.ts:ReturnScope.#settled, closures/value-calls.ts:completeValueCall, declarations/functions/functions.ts:FunctionChecks, declarations/functions/signatures.ts:declaredBodyResult, expressions/control/await.ts:checkAwait, expressions/control/await.ts:awaitedThrough, expressions/control/await.ts:checkWaitKind, expressions/control/await.ts:reportWait, expressions/control/select.ts:checkSelect, expressions/control/select.ts:watchesOwnDisposal, expressions/control/select.ts:reportForm, expressions/control/select.ts:checkCaseFuture, expressions/expressions.ts:expressionHandlers
- marks/kinds (live/ista/simple): closures/function-scope.ts:FunctionScope, closures/functions.ts:FunctionScopes.noteUse, closures/lambdas.ts:lambdaAccepts, closures/lambdas.ts:writtenInputs, closures/lambdas.ts:checkLambdaAs, closures/lambdas.ts:checkLocalFunction, closures/lambdas.ts:checkNested, closures/nested-types.ts:givenKindOf, closures/nested-types.ts:heldKindOf, closures/nested-types.ts:nestedTypeOf, closures/nested-types.ts:nestedValueKind, closures/value-calls.ts:checkValueCall, declarations/declarations.ts:checkFunction, declarations/declarations.ts:checkFieldDefaults, declarations/declarations.ts:checkStruct, declarations/declarations.ts:declarationHandlers, declarations/functions/functions.ts:FunctionChecks, declarations/type-parameters.ts:resolveAssociatedBounds, expressions/access/names.ts:contextConstantRead, expressions/control/await.ts:checkAwait, expressions/control/await.ts:checkWaitKind, expressions/deferred-calls.ts:deferredFunction, expressions/deferred-calls.ts:laterMarkOf, expressions/deferred-calls.ts:laterCallKind, loops/iteration.ts:iteratedItem, statements/variables.ts:VariableScope.declare
- sendable: closures/lambdas.ts:writtenInputs, closures/lambdas.ts:checkNested, expressions/deferred-calls.ts:deferredFunction
- shared structs (`new`, `*`, `->`): declarations/declarations.ts:checkStruct, declarations/declarations.ts:declarationHandlers, declarations/layout/index.ts:Layouts.sharedValueOf, declarations/variance-markers.ts:checkMarker, expressions/access/dereference.ts:checkDereference, expressions/access/dereference.ts:valueBehind, expressions/access/member-access.ts:noField, expressions/expressions.ts:expressionHandlers, expressions/structs/literal-fields/index.ts:spreadOf, expressions/structs/structs.ts:checkNamedLiteral, expressions/structs/structs.ts:namedLiteralType, expressions/structs/structs.ts:checkNew, expressions/structs/structs.ts:declaredShape
- extern types/functions/constants: declarations/declarations.ts:checkFunction, declarations/declarations.ts:declarationHandlers, declarations/declarations.ts:refusePatterns, declarations/variance-markers.ts:checkMarker, expressions/access/names.ts:declaredOutsideBodies
- field loops/passes (`for k, v in ...s`): closures/functions.ts:FunctionScopes, closures/value-calls.ts:ValueCalls, declarations/module-checks.ts:diagnosticsIn, expressions/access/member-access.ts:FieldReads, expressions/access/optionals.ts:OptionalChains, expressions/collections/collections.ts:CollectionForms, expressions/collections/comprehensions.ts:checkFieldComprehension, expressions/collections/comprehensions.ts:agreedElement, expressions/deferred-calls.ts:Deferrals, expressions/structs/literal-sources.ts:StructLiterals, expressions/structs/struct-comprehensions.ts:checkComprehended, expressions/structs/struct-comprehensions.ts:comprehendedField, expressions/structs/struct-comprehensions.ts:fitComprehended, expressions/structs/struct-comprehensions.ts:freshComprehended, expressions/structs/struct-comprehensions.ts:checkComprehensionAlone, expressions/structs/struct-comprehensions.ts:checkOpaqueComprehended, loops/field-passes.ts:checkedFieldPasses, loops/field-passes.ts:inFieldPasses, loops/field-passes.ts:fieldPassesOver, loops/iteration.ts:Iterations, patterns/matching.ts:CheckedPatterns, statements/loops.ts:checkFieldLoop, statements/statements.ts:statementHandlers, statements/variables.ts:VariableScope
- comprehensions (array & struct): expressions/collections/comprehensions.ts:checkComprehension, expressions/collections/comprehensions.ts:checkFieldComprehension, expressions/collections/comprehensions.ts:agreedElement, expressions/expressions.ts:expressionHandlers, expressions/literals/indented-values.ts:leftOutDiagnostic, expressions/postponed.ts:ownAdmits, expressions/structs/literal-fields/index.ts:checkLiteralFields, expressions/structs/literal-fields/index.ts:completeLiteral, expressions/structs/literal-fields/items.ts:checkItem, expressions/structs/literal-fields/items.ts:reportMissing, expressions/structs/literal-sources.ts:sourcesOf, expressions/structs/literal-types.ts:itemsFit, expressions/structs/struct-comprehensions.ts:comprehensionOf, expressions/structs/struct-comprehensions.ts:checkComprehended, expressions/structs/struct-comprehensions.ts:comprehendedField, expressions/structs/struct-comprehensions.ts:fitComprehended, expressions/structs/struct-comprehensions.ts:comprehendedGiven, expressions/structs/struct-comprehensions.ts:freshComprehended, expressions/structs/struct-comprehensions.ts:checkComprehensionAlone, expressions/structs/struct-comprehensions.ts:checkOpaqueComprehended, expressions/structs/structs.ts:checkAnonymousLiteral, expressions/structs/structs.ts:freshAnonymous, expressions/structs/structs.ts:checkValuesAlone, loops/iteration.ts:checkLoopOver, patterns/targets.ts:declareTargets
- deferred calls (`g f(args)`): closures/value-calls.ts:checkValueCall, expressions/calls.ts:checkCallMade, expressions/deferred-calls.ts:Deferrals, expressions/deferred-calls.ts:checkDeferredCall, expressions/deferred-calls.ts:missingComma, expressions/deferred-calls.ts:deferredFunction, expressions/deferred-calls.ts:laterMarkOf, expressions/deferred-calls.ts:laterCallKind, expressions/deferred-calls.ts:unmade, expressions/deferred-calls.ts:refused, expressions/deferred-calls.ts:referencedReceiver, expressions/deferred-calls.ts:computedNow, expressions/deferred-calls.ts:calleeNow, expressions/expressions.ts:expressionHandlers
- context constants (`context const`): declarations/context-constants.ts:ContextConstantChecks, declarations/declarations.ts:declarationHandlers, expressions/access/names.ts:entityValueType, expressions/access/names.ts:contextConstantRead, expressions/access/names.ts:declaredOutsideBodies
- disposal/lifetimes/holders (`dispose`, `drop`, `hold`, `@Keeps`): closures/function-scope.ts:FunctionScope.cleanup, closures/own-calls.ts:declareOwnCall, closures/own-calls.ts:ownCallerOf, declarations/declarations.ts:checkFunction, declarations/declarations.ts:declarationHandlers, declarations/module-checks.ts:ModuleChecks, expressions/control/await.ts:reportWait, expressions/control/select.ts:checkSelect, expressions/control/select.ts:watchesOwnDisposal, expressions/control/select.ts:checkCaseFuture, statements/loops.ts:checkHoldScope, statements/loops.ts:checkScope, statements/loops.ts:LabelTargets, statements/statements.ts:statementHandlers, statements/statements.ts:checkBlock, statements/variables.ts:checkVariableDeclaration
- recursive aliases & type `match`: declarations/aliases/alias-recursion.ts:AliasRecursions, declarations/aliases/alias-recursion.ts:typeChildrenOf, declarations/aliases/index.ts:Aliases, declarations/aliases/recursive-bodies.ts:RecursiveBodies, declarations/declarations.ts:checkAlias, declarations/layout/index.ts:Layouts.fieldsOf, declarations/layout/struct-rules.ts:checkFiniteAlias, declarations/type-parameters.ts:TypeParameters.#check, expressions/postponed.ts:postponedAdmits, expressions/postponed.ts:memberAdmitted, expressions/postponed.ts:formAdmits, expressions/structs/literal-types.ts:aliasedShape, patterns/exhaustiveness/shapes.ts:constructorsOf, patterns/matching.ts:checkPattern, patterns/walk/parts.ts:elementParts
- struct keys/`keyof`/`S[K]`/mapped types: declarations/aliases/alias-recursion.ts:typeChildrenOf, declarations/declarations.ts:checkTypeParameters, declarations/declarations.ts:checkAssociatedBounds, declarations/type-parameters.ts:TypeParameters.#check, declarations/type-parameters.ts:resolveAssociatedBounds, expressions/access/indexing.ts:checkIndex, expressions/control/match.ts:checkMatch, expressions/control/match.ts:checkIs, expressions/operators/decided-conditions.ts:checkEquality, expressions/structs/literal-fields/index.ts:fitItems, expressions/structs/struct-comprehensions.ts:givesKeysOf, expressions/structs/struct-comprehensions.ts:checkOpaqueComprehended, expressions/structs/struct-comprehensions.ts:checkNamedItem, expressions/structs/structs.ts:checkAnonymousLiteral, expressions/structs/structs.ts:hasKeys, loops/field-passes.ts:fieldPassesOver, patterns/walk/index.ts:takeStruct, patterns/walk/kinds/struct-fields.ts:isStructNotKnown, patterns/walk/kinds/struct-fields.ts:takeFieldsByName, patterns/walk/kinds/struct-fields.ts:fieldTypeNamed, patterns/walk/kinds/struct-fields.ts:restBinding, patterns/walk/kinds/struct-fields.ts:restType, statements/assignments.ts:writtenFit
- variance (`gives`/`takes`): declarations/declarations.ts:checkTypeParameters, declarations/variance-markers.ts:checkVarianceMarkers, declarations/variance-markers.ts:checkMarker
- variadic type packs (`...P`): closures/lambdas.ts:lambdaAccepts, closures/lambdas.ts:nestedParameters, closures/lambdas.ts:restOf, closures/lambdas.ts:fillsRest, closures/lambdas.ts:expectedSlot, closures/nested-types.ts:nestedTypeOf, closures/value-calls.ts:valueParameterTypes, closures/value-calls.ts:checkValueCall, declarations/declarations.ts:checkTypeParameters, declarations/declarations.ts:checkPack, declarations/functions/clashes.ts:clash, declarations/functions/clashes.ts:argumentFor, declarations/functions/clashes.ts:restSlotOf, declarations/functions/signatures.ts:restSlotOf, declarations/functions/signatures.ts:checkRest, expressions/collections/collections.ts:spreadArgumentType, expressions/collections/collections.ts:collectedBy
- indented values: expressions/expressions.ts:expressionHandlers, expressions/literals/indented-values.ts:checkIndentedValue, expressions/literals/indented-values.ts:buildingOf, expressions/literals/indented-values.ts:anonymousForm, expressions/literals/indented-values.ts:namesStruct, expressions/literals/indented-values.ts:formOf, expressions/literals/indented-values.ts:reportLeftOut, expressions/literals/indented-values.ts:keysFit, expressions/literals/indented-values.ts:indentedAccepts, expressions/postponed.ts:postponed, expressions/postponed.ts:ownAdmits
- defaults & fields functions: closures/lambdas.ts:nestedParameters, declarations/declarations.ts:checkFunction, declarations/declarations.ts:checkFieldDefaults, declarations/declarations.ts:checkStruct, declarations/declarations.ts:declarationHandlers, declarations/declarations.ts:refuseRequiredDefaults, declarations/functions/clashes.ts:shapeOf, declarations/functions/parameters.ts:defaultsBody, declarations/functions/parameters.ts:Parameters, declarations/functions/parameters.ts:typesWaitOnDefaults, declarations/functions/signatures.ts:declaredParameters, declarations/functions/signatures.ts:checkGiven, declarations/functions/signatures.ts:writtenParameters, declarations/functions/signatures.ts:checkRest, declarations/functions/signatures.ts:declaredResultOf, declarations/layout/index.ts:Layouts, declarations/layout/index.ts:Layouts.#variantsOf, declarations/layout/index.ts:Layouts.#fieldsOf, expressions/structs/literal-fields/index.ts:completeLiteral, expressions/structs/literal-fields/items.ts:reportMissing, expressions/structs/literal-fields/items.ts:defaultCalls, expressions/structs/literal-sources.ts:StructLiterals.made, expressions/structs/literal-sources.ts:sourcesOf, expressions/structs/structs.ts:declaredShape, expressions/structs/variants.ts:checkVariantCall, patterns/walk/kinds/variant-calls.ts:warnEmpty, patterns/walk/kinds/variant-calls.ts:slotOf
- codecs/JSON/host boundary: declarations/declarations.ts:checkFunction, declarations/declarations.ts:checkOutcome, declarations/declarations.ts:declarationHandlers
- witnesses/traits/associated types: declarations/aliases/index.ts:Aliases, declarations/declarations.ts:checkTypeParameters, declarations/declarations.ts:checkStruct, declarations/declarations.ts:checkAssociatedBounds, declarations/declarations.ts:checkAssociatedTypes, declarations/declarations.ts:declarationHandlers, declarations/declarations.ts:refuseRequiredDefaults, declarations/declarations.ts:refusePatterns, declarations/type-parameters.ts:TypeParameters, declarations/type-parameters.ts:resolveAssociatedBounds, declarations/type-parameters.ts:traitRequiring, declarations/type-parameters.ts:resolveConstraints, declarations/type-parameters.ts:resolveStructConstraints, declarations/variance-markers.ts:whyNone, expressions/collections/collections.ts:checkDeclaredLiteral
- places & `&` references: closures/functions.ts:capture, closures/lambdas.ts:lambdaAccepts, closures/lambdas.ts:nestedParameters, closures/lambdas.ts:typedAs, closures/value-calls.ts:valueParameterTypes, closures/value-calls.ts:completeValueCall, declarations/functions/clashes.ts:passingOf, declarations/functions/parameters.ts:defaultsBody, declarations/functions/parameters.ts:sameParameters, declarations/functions/signatures.ts:declaredParameters, declarations/functions/signatures.ts:checkPatternParameter, declarations/functions/signatures.ts:signatureParameter, expressions/call-arguments.ts:valueArgument, expressions/calls.ts:callMethod, expressions/deferred-calls.ts:refused, expressions/deferred-calls.ts:referencedReceiver, expressions/expressions.ts:misplacedReference, statements/assignments.ts:checkAssignment, statements/assignments.ts:prepareTarget, statements/assignments.ts:checkCompound, statements/assignments.ts:writtenFit, statements/assignments.ts:assignPart, statements/assignments.ts:assignedPlace, statements/variables.ts:VariableScope.declareParameter, statements/variables.ts:VariableScope.isReference, statements/variables.ts:VariableScope.isChangeable, statements/variables.ts:VariableScope.noteReferenced
- patterns & destructuring: closures/lambdas.ts:lambdaAccepts, closures/lambdas.ts:checkNested, closures/lambdas.ts:nestedParameters, declarations/constants.ts:ConstantChecks.#check, declarations/declarations.ts:refusePatterns, declarations/functions/signatures.ts:declaredParameters, declarations/functions/signatures.ts:writtenTypeOf, declarations/functions/signatures.ts:namedByPattern, declarations/functions/signatures.ts:wholeWrittenTypeOf, declarations/functions/signatures.ts:wholeTypeNamedByPattern, declarations/functions/signatures.ts:checkPatternParameter, expressions/control/match.ts:checkMatch, expressions/control/match.ts:checkIs, expressions/control/match.ts:reportCoverage, loops/field-passes.ts:inFieldPasses, loops/iteration.ts:checkLoopOver, patterns/exhaustiveness/exhaustiveness.ts:analyze, patterns/exhaustiveness/remaining.ts:remainingType, patterns/exhaustiveness/shapes.ts:signatureOf, patterns/exhaustiveness/shapes.ts:witnessText, patterns/matching.ts:checkPattern, patterns/targets.ts:declareTargets, patterns/targets.ts:declareParameter, patterns/walk/index.ts:walkPattern, patterns/walk/index.ts:walkTargets, statements/assignments.ts:checkAssignment, statements/assignments.ts:prepareTarget, statements/assignments.ts:assignPart, statements/variables.ts:checkVariableDeclaration
- templates: expressions/expressions.ts:expressionHandlers, expressions/literals/templates.ts:checkTemplate, expressions/literals/templates.ts:join, expressions/literals/templates.ts:interpolate
- ranges (`..`, `..=`): expressions/collections/literals.ts:checkRange, expressions/expressions.ts:expressionHandlers, patterns/matching.ts:testsIn, patterns/walk/index.ts:patternHandlers, patterns/walk/kinds/ranges.ts:rangeLeaf, patterns/walk/members.ts:candidates
- comparisons (`==`, `!=`, `<`, `in`, chained): expressions/expressions.ts:expressionHandlers, expressions/operators/decided-conditions.ts:decidedValue, expressions/operators/decided-conditions.ts:checkEquality, expressions/operators/decided-conditions.ts:decideComparison, expressions/operators/operators.ts:checkBinary, expressions/operators/operators.ts:checkChainedComparison, expressions/operators/operators.ts:checkComparisons, expressions/operators/operators.ts:checkLinkCall, patterns/matching.ts:literal, patterns/matching.ts:comparison, patterns/matching.ts:reference, patterns/walk/index.ts:patternHandlers, patterns/walk/kinds/ranges.ts:rangeLeaf
