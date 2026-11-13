## src/compiler/checker/contexts/body-context.ts — Interfaces for the context one function body is checked in and its per-concern units
- BodyContext — interface for checking expressions/statements, recording types/fits/fields/variants, and reaching body units; [exp]; callers: 74 outside folder
- CheckedPasses — interface with `inEach(run)` to replay post-loop decisions back into each field-loop pass; [exp]; callers: 3 outside folder
- Variables — interface for declaring variables/parameters, tracking mutability/references/captures, and recording targets/assignments; [exp]; callers: 1 outside folder
- LiteralSources — interface for recording a struct literal's field sources and resolved field members; [exp]; callers: 1 outside folder
- Functions — interface for the stack of active `FunctionFrame`s, variable capture tracking, and nested function records; [exp]; callers: 1 outside folder
- FunctionFrame — interface for one active function scope (async, codeKind, reliesOnKind, returns, enclosing, captures, cleanup); [exp]; callers: 4 outside folder
- Returns — interface for checking `return` statements and `?` error propagation against the function's result; [exp]; callers: 2 outside folder
- Enclosing — interface for tracking enclosing loops, labelled blocks, and the function's own name for `hold`; [exp]; callers: 2 outside folder
- CallRecord — interface for recording and reading resolved calls and overload candidates per call site; [exp]; callers: 1 outside folder
- DecisionRecord — interface for recording branches ruled out, operations stopped on `Never`, and type-decided conditions; [exp]; callers: 1 outside folder
- ImplicitRecord — interface for recording and reading implicit construct calls by syntax node and `ImplicitRole`; [exp]; callers: 1 outside folder
- CollectionRecord — interface for recording what form (`array` | `map` | `declared`) a collection literal builds; [exp]; callers: 1 outside folder
- ValueCallRecord — interface for recording function-value call sites and their argument bindings; [exp]; callers: 1 outside folder
- DeferralRecord — interface for recording deferred call parameter types and marking calls deferred to run later; [exp]; callers: 1 outside folder
- IterationRecord — interface for recording and reading how an iteration runs (`cursor` or `copied`); [exp]; callers: 1 outside folder
- FieldReadRecord — interface for recording and reading how a member access or key index reaches its field; [exp]; callers: 1 outside folder
- PatternRecord — interface for recording a pattern's checked tests and bindings; [exp]; callers: 1 outside folder
- Chains — interface for checking optional chain link targets, querying recorded `ChainLink`s, and testing chain continuation; [exp]; callers: 1 outside folder
- LabelRecord — interface extending `LabelResolution` to record `break`/`continue` exits and `hold` targets; [exp]; callers: 1 outside folder

## src/compiler/checker/contexts/context.ts — Program-wide checker context interface, recorded program inputs, and deferred constraint notes
- Instantiable — union of declarations taking type arguments (`FunctionDeclaration | NominalDeclaration | TypeAliasDeclaration`); [exp]; callers: 2 outside folder
- ConstraintCheck — discriminated union (`meets` | `reduces`) for deferred per-instantiation checks; [exp]; callers: 2 outside folder
- CheckerNote — entry note union (`diagnostic` | `ConstraintNote`) recorded in `Entries`; [exp]; callers: 26 outside folder
- ConstraintNote — entry note carrying a deferred `ConstraintCheck` for a module; [exp]; callers: 1 outside folder
- ProgramInputs — recorded reads of `Program` (`itemsOf`, `importedBy`, `modules`, `role`, `treeOf`, `bodyOf`, bare variants); [exp]; callers: 2 outside folder
- CheckedModule — narrow context (`checker`, `module`, `report`) shared by body checking and module-level type rules; [exp]; callers: 2 outside folder
- CheckerContext — program-wide checker services beyond `Checker` (`entries`, `inputs`, `resolveType`, `fitting`, `rootGoals`, etc.); [exp]; callers: 102 outside folder
- TraitGoal — root witness-search key (`type`, `constraint`, `onValues`); [exp]; callers: 1 outside folder
- StructGoal — root struct-constraint search key (`type`, `model`); [exp]; callers: 1 outside folder
- RootGoals — program-cached root trait witness and struct constraint queries; [exp]; callers: 3 outside folder
- AnnotationChecks — extends `AnnotationQueries` with `checkFields` for duplicate JSON field name checks; [exp]; callers: 1 outside folder

## src/compiler/checker/contexts/passes.ts — Field-loop pass tree, per-pass node tables, and pass-settled diagnostics
- Pass — one checking pass of a field loop's body with pointer to `outer` pass; [exp]; callers: 15 outside folder
- Passes — manages active `Pass`, per-pass `PassTable` creation, and holding/deduplicating loop diagnostics; [exp]; callers: 15 outside folder
- Passes.check(check) — runs `check` in a fresh child `Pass` and restores the outer pass; callers: 0 outside folder
- Passes.checkEach(items, check, report) — checks each item in its own pass, settles diagnostics, and returns `inEach` replayer; callers: 0 outside folder
- Passes.#within(pass, run) — runs `run` with `pass` temporarily set as current; callers: 0 outside folder
- Passes.hold(diagnostic) — buffers `diagnostic` on the current non-root pass until the loop settles; callers: 0 outside folder
- Passes.settled(passes) — deduplicates held diagnostics across `passes`, keeping `neverRunCodes` only if every pass reported them; callers: 0 outside folder
- sameDiagnostic(one, other) — compares two anchored diagnostics by code, message, segment, and offsets; callers: 0 outside folder
- PassRecords<Key, Value> — read-only view (`get`, `has`) of a `PassTable` at a specific `Pass`; [exp]; callers: 4 outside folder
- PassTable<Key, Value> — per-pass map looking up from the given/current pass outward to `root`; [exp]; callers: 14 outside folder
- passTable(passes) — builds a `PassTable` backed by `Map<Pass, Map<Key, Value>>` with outward chain lookup; callers: 0 outside folder
- FieldPassType — pass descriptor (`visits`: `'field' | 'others' | 'none'`, `key: Type`, `value: Type`); [exp]; callers: 5 outside folder

## src/compiler/checker/contexts/scopes.ts — Contracts for expression-level constraint scopes and postponed expressions
- ScopeMember — a generic call or literal joined to a constraint scope (`node`, `inference`, `settling`, `type`, `complete`); [exp]; callers: 2 outside folder
- PostponedMember — an expression postponed until its expected type is known (`node`, `inference`, `type`, `admits`, `judge`); [exp]; callers: 2 outside folder
- InScope — callback runner restoring the constraint scope that was active where it was captured; [exp]; callers: 2 outside folder
- Scopes — interface for interacting with the body's active constraint scope (`join`, `postpone`, `guided`, `whenSolved`, etc.); [exp]; callers: 1 outside folder

## src/compiler/checker/contexts/use-site.ts — UseSite factories for reporting diagnostics and noting per-instantiation checks
- UseSite — where a check reports diagnostics, notes instantiations (`instantiates`), and carries `toHost`/`codeKind`; [exp]; callers: 15 outside folder
- bodySite(place, at) — builds a `UseSite` at `at` in a body carrying `place.codeKind`; [exp]; callers: 7 outside folder
- useSite(checker, module, at) — builds a reporting `UseSite` that notes `'reduces'` checks for declarations and witnesses; [exp]; callers: 2 outside folder
- searchSite(checker) — builds a silent `UseSite` that reports and notes nothing; [exp]; callers: 10 outside folder
- hostSite(site) — clones `site` with `toHost: true` so host codecs skip `Sendable`; [exp]; callers: 2 outside folder
- silent(site) — clones `site` with no-op `report` and `instantiates`; [exp]; callers: 2 outside folder

## src/compiler/checker/diagnostics/boundary.ts — Checker diagnostic templates for the host boundary, annotations, and tests (5900–5999)
- boundaryTemplates — diagnostic templates for host externs, annotations (5901–5914), and `@Suite`/mock/handle tests (5950–5954); [exp]; callers: 0 outside folder

## src/compiler/checker/diagnostics/closures.ts — Checker diagnostic templates for closures and function values (5500–5599)
- closureTemplates — diagnostic templates for lambdas, captured references, and function values (5500–5508); [exp]; callers: 0 outside folder

## src/compiler/checker/diagnostics/collections.ts — Checker diagnostic templates for collections, indexing, and `&` overlap (5300–5399)
- collectionTemplates — diagnostic templates for collection literals, iteration, `setIndex`, and `&` overlap (5300–5309); [exp]; callers: 0 outside folder

## src/compiler/checker/diagnostics/concurrency.ts — Checker diagnostic templates for select, deferred calls, and marks/kinds (5600–5699)
- concurrencyTemplates — diagnostic templates for `select` (5600–5602), marks/kinds (5606–5617), and deferred calls (5640–5645); [exp]; callers: 0 outside folder

## src/compiler/checker/diagnostics/generics.ts — Checker diagnostic templates for packs, generics, traits, any, struct keys, type matches
- genericTemplates — diagnostic templates for packs, generics/calls, `any`, struct keys, type match, and `Fn`/marks; [exp]; callers: 0 outside folder
- spelledParameter(name, starts?) — formats a parameter name as `'name'` or `'this pattern'`/`'This pattern'`; [exp]; callers: 0 outside folder

## src/compiler/checker/diagnostics/index.ts — Combined checker diagnostic catalog (5000–5999)
- checkerDiagnostics — the checker's `defineDiagnostics` catalog merging shared codes (5001–5028) and all feature template objects; [exp]; callers: 98 outside folder

## src/compiler/checker/diagnostics/lifetimes.ts — Checker diagnostic templates for disposal, labels, @Holds/@Keeps, cycles, and weak side
- lifetimeTemplates — diagnostic templates for `dispose`, `drop`, labels (5700–5711), and `@Holds`/`@Keeps` (5750–5752); [exp]; callers: 0 outside folder
- cycleTemplates — diagnostic templates for static-lifetime cycles reaching a disposable (5720–5724); [exp]; callers: 0 outside folder
- weakSideTemplates — diagnostic template for `await` inside a `disposing()` cleanup case (5802); [exp]; callers: 0 outside folder

## src/compiler/checker/diagnostics/patterns.ts — Checker diagnostic templates for patterns, propagation, and optionals (5400–5499)
- patternTemplates — diagnostic templates for `match`, `?`, `!`, `??`, range/array/call patterns, and decided conditions (5400–5433); [exp]; callers: 0 outside folder

## src/compiler/checker/diagnostics/values.ts — Checker diagnostic templates for templates, tuples, structs, shared structs, indented values
- valueTemplates — diagnostic templates for templates (5060) and tuples/structs/places/shared structs/indented values (5200–5228); [exp]; callers: 0 outside folder

## src/compiler/checker/diagnostics/variance.ts — Checker diagnostic templates for variance markers and ambiguous `any` instantiations
- varianceTemplates — diagnostic templates for `gives`/`takes` variance rules (5260–5262) and `severalInstantiations` (5370); [exp]; callers: 0 outside folder

## src/compiler/checker/lookup/denotations/index.ts — Identifier denotation query routing by enclosing syntax node
- denotationsOf(checker, module, name) — returns `Denotation[]` for `name` in `module` from binder and checker records; [exp]; callers: 1 outside folder
- chosenIn — `Handlers` table mapping `NameHolder` syntax kinds to their checker-resolved `Denotation[]`; callers: 0 outside folder
- chosenWhereItStands(site) — dispatches `site`'s parent node through `chosenIn` if it is a `NameHolder`; callers: 0 outside folder
- itemNamed(site, item) — resolves a `FieldInitializer` name to its struct field or indented-map bare key field (plus shorthand variable); callers: 0 outside folder
- memberDenotations(site, access) — resolves `access.member` to a field read, callee, tagged template, function value, or associated type; callers: 0 outside folder
- associatedNamed(checker, type) — resolves an associated type to its declaring `AssociatedType`/`RequiredAssociatedType` entities; callers: 0 outside folder
- calleeDenotations(site, call) — resolves a call's callee to its resolved function(s), conversion target type, or variant; callers: 0 outside folder
- heldFunction(site, hold) — resolves `hold(fnName)`'s label to the enclosing function's own name denotation; callers: 0 outside folder
- parameterNamed(site, holders) — resolves a `NamedArgument` name to the called function's parameter or variant constructor's field; callers: 0 outside folder
- builtField(checker, made, variant, field) — looks up `field` on `variant` of nominal enum type `made`; callers: 0 outside folder
- declaredField(site) — resolves a `DeclaredField` or `FieldDeclaration` name to its `FieldMember` via `declaredFieldOf`; callers: 0 outside folder
- writtenTypeName(site, node, holder) — resolves the last identifier of a `NamedType` (or struct literal's type) to its `Denotation[]`; callers: 0 outside folder

## src/compiler/checker/lookup/denotations/named.ts — Entity-based identifier denotations refined by resolved calls and variable types
- NameSite — context for an identifier lookup (`checker`, `module`, `name`, `holders`, `body`); [exp]; callers: 0 outside folder
- named(site, type?) — resolves `site.name` via `bindings.entityOf`, refined by `fromEntity` and `site.body`; [exp]; callers: 0 outside folder
- fromEntity(site, entity, type) — maps a binder `Entity` to `Denotation[]`, refining function calls/values and bare variants; callers: 0 outside folder
- variantDenotation(entity, type) — builds a variant `Denotation` typed as `type` if it is its enum's nominal type, else the enum's own type; callers: 0 outside folder
- declaredVariableType(site, entity) — finds a variable entity's declared type outside bodies, in its body, or on its function; callers: 0 outside folder
- calledAt(site, call, type) — maps `body.callsAt(call)` to function or constructed-variant `Denotation[]`; [exp]; callers: 0 outside folder
- calledDenotation(called, type) — builds a `Denotation` for one `ResolvedCall` (variant denotation for a variant constructor, else function); callers: 0 outside folder
- builtType(called) — returns the nominal enum `Type` constructed by `called` if it is a variant constructor call; [exp]; callers: 0 outside folder
- functionDenotation(declaration, type) — wraps a `FunctionDeclaration` and optional value `type` into a `Denotation`; [exp]; callers: 0 outside folder

## src/compiler/checker/lookup/holders.ts — Finding the top-level item and joined checked body holding a syntax node
- Holders — `Pick<CheckerContext, ...>` required by `bodyHolding`; [exp]; callers: 0 outside folder
- itemHolding(tree, node) — returns the top-level `Declaration` in `tree` containing `node`; [exp]; callers: 0 outside folder
- bodyHolding(checker, module, node) — returns the `JoinedBody` (across enclosing field-loop passes) holding `node`; [exp]; callers: 2 outside folder
- bodyInItem(checker, inward) — finds the raw `CheckedBody` holding a path inside a top-level declaration (function, trait, const, defaults); callers: 0 outside folder
- bodyInFunction(checker, declaration, part, inner) — returns `bodyOf(declaration)` for its body/pattern or `defaultsOf` for a default; callers: 0 outside folder
- fieldDefaultsOf(checker, fields) — returns `checker.defaultsOf(fields)` when a struct/variant has a `FieldsFunction`; callers: 0 outside folder

## src/compiler/checker/lookup/key-denotations.ts — Denotations of String literals naming struct keys or @Keeps parameters
- keyDenotationsOf(checker, module, literal) — resolves a `StringLiteral` to its `@Keeps` parameter or struct key field `Denotation[]`; [exp]; callers: 0 outside folder
- keptParameterDenotations(checker, module, literal) — resolves `literal` in a `@Keeps` annotation to the parameter's `Denotation[]`; callers: 0 outside folder
- keyedFieldDenotations(checker, owner, key) — resolves field `key` on struct `owner` to its field `Denotation[]`; [exp]; callers: 1 outside folder
- keyOwnersAt(checker, module, literal) — finds struct types whose key `literal` is (from `LiteralType` parent or `body.keyOwnerOf`); callers: 0 outside folder
- typeKeyOwners(checker, module, tree, literal) — finds struct key owners for `LiteralType` in `S["k"]` or generic type arguments; callers: 0 outside folder
- instantiationsAt(checker, module, tree, node) — extracts `{ parameters, typeArguments }` instantiated at `NamedType` or `TypeApplication`; callers: 0 outside folder
- callInstantiations(checker, module, call) — extracts `{ parameters, typeArguments }` for a `Call` (functions or fieldless variant); callers: 0 outside folder
- functionsInstantiated(calls) — maps `FunctionCall`s in `calls` to `{ parameters, typeArguments }`; callers: 0 outside folder
- instantiationOfType(checker, module, tree, node) — extracts `{ parameters, typeArguments }` from a `NamedType` or struct literal's type; callers: 0 outside folder

## src/compiler/checker/lookup/lookup.ts — Implementation of Checker.lookup queries for editor tooling
- Lookup — implements `LookupQueries` (`denotationsOf`, `keyDenotationsOf`, `bodyHolding`, `typeOfNode`, `membersOf`, `constraintsOf`); [exp]; callers: 1 outside folder
- Lookup.constraintsOf(type) — returns `knownConstraints(checker, type)` excluding the implicit `DataKind<"simple">` bound; callers: 0 outside folder
- Lookup.#itemChecked(module, node) — ensures the top-level item holding `node` is checked before reading side tables; callers: 0 outside folder

## src/compiler/checker/lookup/members.ts — Discovering fields, variants, methods, statics, and associated types of a Type
- membersOf(checker, module, type, access) — returns `TypeMembers` (`fields`, `variants`, `methods`, `statics`, etc.) of `type`; [exp]; callers: 0 outside folder
- fieldsOf(checker, type) — returns struct fields, positional tuple fields, or trait/struct-constraint fields of `type`; callers: 0 outside folder
- staticsOf(checker, module, type) — returns visible static `FunctionDeclaration`s on `type` (from owner modules or trait constraints); callers: 0 outside folder
- methodsOf(checker, module, type, access) — finds visible functions taking `type` as `self` (filtering `&self` by place for `access`); callers: 0 outside folder
- methodNames(checker, module, type) — collects candidate method names from `module`, `prelude`, `type`'s module, and `knownConstraints`; callers: 0 outside folder

## src/compiler/checker/lookup/pass-views.ts — Joining CheckedBody views across enclosing field-loop passes for editor queries
- PassAnswers<Answer> — non-empty tuple `readonly [Answer, ...Answer[]]` of per-pass answers; [exp]; callers: 2 outside folder
- passesAround(body, path, rules) — collects `CheckedBody` passes of `OverFields` nodes on `path` and joins them via `joinedWith`; [exp]; callers: 0 outside folder

## src/compiler/checker/surface/checked-annotation.ts — Surface model and placement helpers for compile-time annotations
- AnnotationPlace — discriminated union (`field` | `function` | `struct` | `statement` | `other`) of annotated item positions; [exp]; callers: 1 outside folder
- CheckedAnnotation — a checked annotation (`node`, `type: NominalType`, `form: ConstantForm`); [exp]; callers: 4 outside folder
- canAnnotate(entity) — tests whether `entity` is a `StructDeclaration` (not shared or extern); [exp]; callers: 2 outside folder
- functionPlace(declaration) — builds `{ kind: 'function', isExtern: declaration.isExtern }`; [exp]; callers: 5 outside folder
- statementPlace(statement) — builds `functionPlace` for a local `fn` or `{ kind: 'statement', waits }` for other statements; [exp]; callers: 4 outside folder
- waits(node) — recursively tests whether `node` (excluding nested functions) contains an `Await` or `await select`; callers: 0 outside folder
- AnnotationQueries — surface interface on `Checker.annotations` (`of`, `ofField`, `waypointOf`, `suiteTitleOf`, `bodyOf`); [exp]; callers: 2 outside folder

## src/compiler/checker/surface/checked-body.ts — Surface contract for a checked body's node facts and its instantiated/joined views
- CheckedFunction — checked lambda or local `fn` (`type`, `result`, `parameters`, `captures`); [exp]; callers: 3 outside folder
- NestedFunction — `Lambda | FunctionDeclaration`; [exp]; callers: 8 outside folder
- CapturedVariable — closure capture entry (`entity: VariableEntity`, `type: Type`); [exp]; callers: 1 outside folder
- FieldSource — how a struct literal field gets its value (`value` | `spread` | `default` | `comprehension`); [exp]; callers: 7 outside folder
- ChainLink — optional chain link record (`base: Type`, `carried: Type`); [exp]; callers: 3 outside folder
- WrittenFit — assignment conversion (`Fit | 'intoKeyedField'`); [exp]; callers: 2 outside folder
- AssignedPart — destructuring assignment target part (`target`, `path`, `type`, `fit`); [exp]; callers: 7 outside folder
- ValueSite — node where a `Fit` or expected type is recorded (`Expression | Return | Block | Spread`); [exp]; callers: 9 outside folder
- FieldGiver — node that gives a struct/variant field (`Identifier | PatternArgument`); [exp]; callers: 4 outside folder
- Iteration — iterable construct (`For | Comprehension | Spread`); [exp]; callers: 3 outside folder
- CollectionForm — what a collection literal builds (`'array' | 'map' | 'declared'`); [exp]; callers: 2 outside folder
- IterationForm — how an iteration runs (`{ kind: 'cursor', item } | { kind: 'copied' }`); [exp]; callers: 4 outside folder
- FieldPass — a `FieldPassType` paired with its pass's `body: CheckedBody`; [exp]; callers: 1 outside folder
- LabelResolution — queries for `exitOf(break|continue)`, `heldUntil(hold)`, and `isHoldScope(scope)`; [exp]; callers: 1 outside folder
- BodyFacts — all 28 fact queries recorded for a checked body; [exp]; callers: 1 outside folder
- CheckedBody — extends `BodyFacts` with `instantiated(substitution, checker)` and `joinedWith(others, rules)`; [exp]; callers: 19 outside folder

## src/compiler/checker/surface/checked-field.ts — Surface model and constructors for how field reads reach their fields
- RequiredField — a trait-required field (`trait: TraitDeclaration`, `field: FieldDeclaration`); [exp]; callers: 2 outside folder
- FieldRead — discriminated union (`position` | `dispatch` | `required` | `named` | `keyed`) for field accesses; [exp]; callers: 6 outside folder
- FieldReading — syntax node reading a field (`MemberAccess | Index`); [exp]; callers: 4 outside folder
- keyedFieldRead(checker, type, key) — builds a `FieldRead` for `s[k]` (or `namedFieldRead` when `key` is one string literal); [exp]; callers: 2 outside folder
- requiredFieldRead(checker, type, required) — builds a trait `FieldRead` (`dispatch` on `any`, `required` on opaque, else named); [exp]; callers: 3 outside folder
- namedFieldRead(checker, type, name) — builds `{ kind: 'named' }` on an opaque type or `{ kind: 'position' }` on a concrete struct; [exp]; callers: 2 outside folder
- FoundField — pairs a `member: FieldMember` with its `read: FieldRead`; [exp]; callers: 2 outside folder
- structFieldOf(checker, type, name) — looks up field `name` on struct `type` and returns its `FoundField` with positional index; [exp]; callers: 1 outside folder

## src/compiler/checker/surface/checked-pattern.ts — Surface model for checked patterns, destructuring target bindings, and part paths
- TargetOwner — node binding targets (`VariableDeclaration | For | FieldHeader | Comprehension | Parameter | SelectCase`); [exp]; callers: 4 outside folder
- PartStep — step from a pattern value to a nested part (`number | member | downcast | ArrayStep | StructStep`); [exp]; callers: 6 outside folder
- StructStep — step into a struct (`FieldStep | { kind: 'fieldRest', from, to }`); [exp]; callers: 2 outside folder
- FieldStep — step into a struct field by name (`{ kind: 'field', of, name }`); [exp]; callers: 3 outside folder
- TargetStep — step along a destructuring target path (`number | StructStep`); [exp]; callers: 1 outside folder
- ArraySite — node where array pattern prelude calls are recorded (`ArrayPattern | VariantCallPattern`); [exp]; callers: 1 outside folder
- ArrayStep — array pattern step (`length` | `item` | `rest` at `site: ArraySite`); [exp]; callers: 2 outside folder
- TargetBinding — a name bound by a target (`name`, `type`, `path: readonly TargetStep[]`); [exp]; callers: 6 outside folder
- PartBinding — a name bound by a pattern (`name`, `type`, `path: readonly PartStep[]`, `narrowedFrom?`); [exp]; callers: 4 outside folder
- PatternTest — one test in a `CheckedPattern` (`variant` | `downcast` | `member` | `equal` | `compare` | `or` | `never`); [exp]; callers: 11 outside folder
- neverTest — singleton `{ kind: 'never' }` test for a pattern branch ruled out by types; [exp]; callers: 2 outside folder
- cantMatch(tests) — tests whether `tests` contains `never` or an `or` whose alternatives all `cantMatch`; [exp]; callers: 2 outside folder
- PatternValue — right-hand value of an `equal` or `compare` pattern test (`expression` | `constant` | `int`); [exp]; callers: 2 outside folder
- CheckedPattern — checked pattern (`tests: readonly PatternTest[]`, `bindings: readonly PartBinding[]`); [exp]; callers: 7 outside folder
- namesBound(pattern) — lists all `PartBinding`s bound by `pattern` (taking the first alternative of each `or` test); [exp]; callers: 2 outside folder

## src/compiler/checker/surface/constant-form.ts — Compile-time ConstantForm model, path projection, and ValueSemantics equality
- ConstantForm — compile-time value representation (`primitive` | `struct` | `tuple` | `array` | `map` | `member` | `function`); [exp]; callers: 4 outside folder
- typesIn(form) — collects all struct and union/member `Type`s embedded in `form`; [exp]; callers: 1 outside folder
- durationForm(type, milliseconds) — builds a `ConstantForm` struct for a `time.Duration` literal; [exp]; callers: 2 outside folder
- formAt(form, path, fieldsOf) — projects `form` along a `TargetStep[]` path (including `fieldRest` reconstruction); [exp]; callers: 1 outside folder
- formStep(form, step, fieldsOf) — projects `form` across a single `TargetStep` (index, named field, or `fieldRest`); callers: 0 outside folder
- formSemantics — `ValueSemantics<ConstantForm>` instance providing `==` and map key hashing for compile-time forms; [exp]; callers: 2 outside folder
- sameForm(first, second) — iterative structural equality of two `ConstantForm`s (with map entry order and spelled types); [exp]; callers: 2 outside folder
- sameHeads(left, right) — compares two `ConstantForm` nodes shallowly (using `sameTypeSpelled` on struct/union types); callers: 0 outside folder
- partsOf(form) — returns direct child `ConstantForm`s of a struct, tuple, array, or union member form; callers: 0 outside folder

## src/compiler/checker/surface/denotation.ts — Surface types for editor lookup queries, type members, and pass-joined bodies
- Denotation — what an identifier or key literal denotes (`declared`, `type`); [exp]; callers: 8 outside folder
- TypeMembers — members of a `Type` (`fields`, `variants`, `methods`, `statics`, `associatedTypes`); [exp]; callers: 2 outside folder
- LookupQueries — surface interface for `Checker.lookup` (`denotationsOf`, `keyDenotationsOf`, `bodyHolding`, `typeOfNode`, etc.); [exp]; callers: 2 outside folder
- listedFacts — maps per-pass `BodyFacts` keys (`resolved`, `implicitCallOf`, `functionOf`) to their multi-pass `ListedFacts` names; [exp]; callers: 1 outside folder
- ListedFacts — multi-pass call/function queries (`callsAt`, `implicitCallsOf`, `functionsOf`) on a `JoinedBody`; [exp]; callers: 1 outside folder
- JoinedBody — `BodyFacts` with `resolved`, `implicitCallOf`, and `functionOf` replaced by `ListedFacts`; [exp]; callers: 6 outside folder

## src/compiler/checker/surface/host-externs.ts — Predicates distinguishing host-implemented externs from stdlib runtime externs
- isHostExtern(checker, declaration) — tests whether `declaration` is an extern function/constant declared outside std modules; [exp]; callers: 5 outside folder
- isHostType(checker, type) — tests whether `type` is a nominal `ExternStructDeclaration` declared outside std modules; [exp]; callers: 3 outside folder

## src/compiler/checker/surface/json-form.ts — Surface model for derived JSON codecs and Checker.json queries
- JsonDirection — `'write' | 'read'`; [exp]; callers: 6 outside folder
- jsonTraits — maps `JsonDirection` (`write`, `read`) to `wellKnown.encodable` and `wellKnown.decodable`; [exp]; callers: 3 outside folder
- JsonField — a struct or variant field in a derived JSON codec (`name`, `key`, `type`, `skipped`, `optional`, `codec`); [exp]; callers: 3 outside folder
- variantTagKey — `'_type'`, the JSON discriminant property for enum variants; [exp]; callers: 3 outside folder
- DerivedForm — derived JSON codec shape (`record` | `enum` | `tuple` | `literals` | `host`); [exp]; callers: 4 outside folder
- JsonFormQueries — surface interface on `Checker.json` (`formOf`, `codecOf`, `callOf`); [exp]; callers: 1 outside folder
- DerivedCodec — outcome of deriving a JSON codec (`{ kind: 'derived', call } | { kind: 'lacking', missing }`); [exp]; callers: 2 outside folder
- JsonCodecs — extends `JsonFormQueries` with `derivedOf` and `skippedDefaultOf` for checker rules; [exp]; callers: 2 outside folder

## src/compiler/checker/surface/named-variants.ts — Identifying enum variants named by bare or qualified call expressions
- VariantNames — `{ entityOf, chosenVariantOf }` lookup interface for `calledVariant`; [exp]; callers: 0 outside folder
- variantNamed(names, name) — returns `VariantEntity` for `name` (directly if `variant`, or via `chosenVariantOf` if `variants`); callers: 0 outside folder
- calledVariant(names, call) — returns the `VariantEntity` called by non-optional `call`, or `undefined`; [exp]; callers: 4 outside folder

## src/compiler/checker/surface/resolved-call.ts — Surface model for resolved calls, parameter bindings, witnesses, and implicit call roles
- ResolvedCall — `FunctionCall | RequirementCall`; [exp]; callers: 27 outside folder
- FunctionCall — resolved call to a declared function (`function`, `typeArguments`, `witnesses`, `binding`, `receiver?`); [exp]; callers: 17 outside folder
- Binding — `readonly ParameterSource[]` mapping each parameter slot to `argument`, `rest`, or `default`; [exp]; callers: 8 outside folder
- RestItem — one argument collected by a rest parameter (`index`, `isSpread`); [exp]; callers: 0 outside folder
- ValueCallMade — record for a function-value call (`binding: Binding | undefined`); [exp]; callers: 1 outside folder
- argumentsInOrder(binding) — flattens `binding` into `RestItem[]` in parameter order; [exp]; callers: 2 outside folder
- parameterOfArgument(binding) — builds a `ReadonlyMap<number, number>` from argument index to parameter index; [exp]; callers: 4 outside folder
- passesAll(binding) — tests whether `binding` passes every parameter positionally with no defaults or rest; [exp]; callers: 2 outside folder
- RequirementCall — resolved call to a trait requirement (`function`, `requirement`, `substitution`, `typeArguments`, `witnesses`); [exp]; callers: 3 outside folder
- RequirementOrigin — `ConstraintRequirement | MembersRequirement | ComputedRequirement`; [exp]; callers: 2 outside folder
- MembersRequirement — union-member trait dispatch origin (`{ kind: 'members', on, through, member }`); [exp]; callers: 2 outside folder
- MadeCall — pairs a call `site: NodeOf<string>` with its `call: ResolvedCall`; [exp]; callers: 2 outside folder
- Witnesses — `ReadonlyMap<TypeParameter, readonly (readonly ResolvedCall[])[]>` of constraint witnesses; [exp]; callers: 3 outside folder
- functionCallsWithin(call) — returns `call` (if a `FunctionCall`) plus all `FunctionCall`s inside its `witnesses` recursively; [exp]; callers: 3 outside folder
- witnessCallsOf(witnesses) — flattens `witnesses` into all `FunctionCall`s they make at any depth; [exp]; callers: 2 outside folder
- callsMadeWith(call) — returns `[call, ...witnessCallsOf(call.witnesses)]`; [exp]; callers: 2 outside folder
- instantiatingTypesOf(call) — returns `call`'s `typeArguments` (prefixed by `call.substitution.values()` for a `RequirementCall`); [exp]; callers: 2 outside folder
- ResolvedSite — union of syntax nodes that can resolve to a `ResolvedCall`; [exp]; callers: 11 outside folder
- namesFunctionValue(site) — tests whether `site` is `Identifier | MemberAccess | TypeApplication` naming a function value; [exp]; callers: 2 outside folder
- ImplicitRole — union of 14 implicit call role names (`iterate`, `onAwait`, `compare`, `includes`, `encodeOutcome`, etc.); [exp]; callers: 9 outside folder

## src/compiler/checker/surface/struct-items.ts — Field resolution for struct items and tolerant argument-to-field matching for call patterns
- itemField(named, fields) — returns the index of `named` in `fields` (or `0` when unnamed and `fields.length === 1`, else `-1`); [exp]; callers: 4 outside folder
- ReachedField — `{ index: number, isItem: boolean }` describing which variant field a call-pattern argument reaches; [exp]; callers: 0 outside folder
- BoundPatternArgument — `Exclude<PatternArgument, OtherFieldsPattern>`; [exp]; callers: 1 outside folder
- callPatternArguments(written) — partitions `written` pattern arguments into `given` (bindable) and `refused` (syntax/order errors); [exp]; callers: 1 outside folder
- argumentsReach(fields, written) — maps each argument of `written` to the `ReachedField` it targets in `fields`; [exp]; callers: 3 outside folder
- reachOf(binding, argument) — resolves one `BoundPatternArgument` to its fixed, rest, or named `ReachedField`; callers: 0 outside folder

## src/compiler/checker/surface/witness-closing.ts — Closing generic ResolvedCalls and witnesses inside a concrete FunctionInstance
- FunctionInstance — a concrete function instantiation (`declaration`, `typeArguments`, `witnesses`); [exp]; callers: 14 outside folder
- Closer — `Pick<Checker, 'typeRules' | 'traitObjects'>` needed to close calls; [exp]; callers: 1 outside folder
- Closing — `{ substitution: Substitution, witnesses: Witnesses }` context for closing a call; [exp]; callers: 1 outside folder
- substitutionOf(instance) — builds the `Substitution` mapping `instance.declaration.typeParameters` to `instance.typeArguments`; [exp]; callers: 8 outside folder
- closingIn(instance) — returns `Closing` for `instance` (or empty maps when `instance` is `undefined`); [exp]; callers: 1 outside folder
- instanceOf(call) — extracts `{ declaration: call.function, typeArguments, witnesses }` from a `FunctionCall`; [exp]; callers: 1 outside folder
- closedFunctionCall(call, within, program) — substitutes `call.typeArguments` and closes `call.witnesses` inside `within`; [exp]; callers: 1 outside folder
- closedInside(resolved, within, program) — closes `resolved` (`FunctionCall` or `RequirementCall`) inside `within`; [exp]; callers: 1 outside folder
- composed(binding, required) — composes a witness's parameter `binding` with the `required` call's argument binding; callers: 0 outside folder
- closeWitnesses(witnesses, within, program) — recursively applies `closedInside` to every call in `witnesses`; callers: 0 outside folder

## src/compiler/checker/wiring/body/body-checker.ts — BodyContext implementation composing body units, constraint scopes, and whole-body checks
- BodyChecker — implements `BodyContext` to check a function body, defaults, constant, or annotation value; [exp]; callers: 1 outside folder
- BodyChecker.constructor(checker, module, kind) — initializes `Passes`, body units, `BodyScopes`, `ReturnScope`, and root `FunctionFrame`; callers: 0 outside folder
- BodyChecker.checkFunction(body, parameters) — declares parameters and own-call, checks `body`, and runs `#finished`; callers: 0 outside folder
- BodyChecker.checkConstant(declaration) — checks a top-level `const` initializer, declares its targets, and runs `#finished`; callers: 0 outside folder
- BodyChecker.#finished(roots, result) — runs whole-body rules (`warnUnchanged`, `checkTestingCalls`, `checkDisposeUses`, `checkDropped`); callers: 0 outside folder
- BodyChecker.expression(node, given?) — checks `node` in its scope-protocol place and returns its recorded type; callers: 0 outside folder
- BodyChecker.#checked(node, given, admits) — unfolds `given` and either postpones `node` in the open scope or checks it via `#checkedAs`; callers: 0 outside folder
- BodyChecker.#checkedAs(node, expected, admits) — records `expected`/key owner, narrows union, and invokes `expressionHandlers`; callers: 0 outside folder
- BodyChecker.inferLambda(node, parameters, guide?) — unwraps parens and delegates to `inferLambda` to check a lambda with known parameters; callers: 0 outside folder
- BodyChecker.#keep(table, key, type, handled) — writes `type` (and its solved form when open in a scope) to `table`, marking `handledBy`; callers: 0 outside folder
- BodyChecker.expect(node, expected) — checks `node` with `expected` and fits its result via `this.fit`; callers: 0 outside folder
- BodyChecker.fit(found, expected, site, at?) — fits `found` to `expected` (or defers via `whenSolved`) and records non-exact `Fit`; callers: 0 outside folder
- BodyChecker.statement(node, expected?) — checks statement annotations and dispatches `node` to `statementHandlers` with scopes suspended; callers: 0 outside folder
- BodyChecker.useEntity(name) — resolves `name` via `entityOf` and records closure captures on `this.functions`; callers: 0 outside folder
- BodyChecker.fieldPasses(header, passes, check) — runs `check` per field-loop pass with scopes suspended and records `CheckedPass[]`; callers: 0 outside folder
- BodyChecker.recordKey(value, owner) — records `owner` on `value` when `unparenthesized(value)` is a `StringLiteral`; callers: 0 outside folder

## src/compiler/checker/wiring/body/body-kinds.ts — Descriptor of what kind of body is being checked and its root function scope
- BodyKind — discriminated union (`function` | `value`) describing a body's owner, asyncness, and `declaredResult`; [exp]; callers: 1 outside folder
- ownScopeOf(lookup, kind) — builds the root `OwnScope` (`function`, `isAsync`, `codeKind`) from a `BodyKind`; [exp]; callers: 0 outside folder

## src/compiler/checker/wiring/body/body-records.ts — Per-pass node tables owned directly by BodyChecker
- CheckedPass — extends `FieldPassType` with `pass: Pass`; [exp]; callers: 0 outside folder
- bodyRecords(passes) — creates 8 per-pass `PassTable`s (`types`, `expected`, `givenFields`, `keyOwners`, `fits`, etc.); [exp]; callers: 1 outside folder

## src/compiler/checker/wiring/body/body-scopes.ts — Scopes implementation managing the current ConstraintScope per expression
- BodyScopes — implements `Scopes`, opening/joining/suspending `ConstraintScope`s according to `scope-protocol.ts`; [exp]; callers: 0 outside folder
- BodyScopes.constructor(record, decidesItems) — initializes scope-settling callbacks and `decidesItems` predicate; callers: 0 outside folder
- BodyScopes.checking(node, given, check, postponable) — places `node` (`boundary`, `decided`, `joins`, `opens`) and runs `check`; callers: 0 outside folder
- BodyScopes.join(member) — joins `member` to the active `ConstraintScope`, or opens and immediately settles one if none is open; callers: 0 outside folder
- BodyScopes.abandon(types) — abandons open inference variables in `types` to `errorType`; callers: 0 outside folder
- BodyScopes.whenSolved(work) — queues `work` on the active `ConstraintScope` or runs it immediately if none is open; callers: 0 outside folder
- BodyScopes.#within(scope, check) — runs `check` with `#current` set to `scope` and restores the outer scope in `finally`; callers: 0 outside folder
- BodyScopes.#opening(scope, check) — runs `check` in `scope` and guarantees `scope.settle` runs in `finally`; callers: 0 outside folder
- closed(expected) — returns `undefined` if `expected` mentions any inference variable, else `expected`; [exp]; callers: 0 outside folder

## src/compiler/checker/wiring/body/constraint-scope.ts — Joint constraint system solving generic calls, literals, and postponed expressions
- ScopeSettling — callbacks (`suspended`, `record`) used when settling a `ConstraintScope`; [exp]; callers: 0 outside folder
- ConstraintScope — holds the shared root `Inference`, joined `ScopeMember`s, `PostponedMember`s, and `whenSolved` callbacks; [exp]; callers: 0 outside folder
- ConstraintScope.commit(inference) — adopts `inference` as `#root` or commits it into `#root`; callers: 0 outside folder
- ConstraintScope.settle(through) — judges all postponed members, solves `#root` jointly, runs `#waiting`, and completes `#members`; callers: 0 outside folder
- ConstraintScope.#judgeAll() — iteratively picks and judges postponed members (ready first, then non-waiting, then FIFO); callers: 0 outside folder
- ConstraintScope.#readyOf(waiting) — finds a ready postponed member, fixing toward `waiting` placeholders if none is ready yet; callers: 0 outside folder
- ConstraintScope.#judge(member) — fixes inputs waited on by `member`, runs `member.judge(expected)`, and settles its placeholder; callers: 0 outside folder
- ConstraintScope.#isReady(member, waiting) — tests whether `member`'s expected head is known and it waits on no other member in `waiting`; callers: 0 outside folder
- ConstraintScope.#waitsOn(member, waiting) — tests whether `waitedOnBy(expectation)` depends on variables given by `waiting`; callers: 0 outside folder
- ConstraintScope.#givenBy(other) — returns the type `other` bounds when judged (`other.shape`, function result, or `other.type`); callers: 0 outside folder
- ConstraintScope.#expectationOf(member) — reads `member`'s expected type from `#root`, narrowing a union to what `member.admits`; callers: 0 outside folder
- waitedOnBy(expectation) — returns input types that must be fixed before judging against `expectation` (inputs or `formDecidedBy`); callers: 0 outside folder
- inputsOf(shape) — packs a `FunctionType`'s parameter types and pack into a single tuple `Type`; callers: 0 outside folder

## src/compiler/checker/wiring/body/facts/index.ts — Table-driven CheckedBody and JoinedBody construction across passes and instantiations
- bodyFacts — exhaustive table defining `at` (per pass), `instantiated`, and `joined` (across passes) for every `BodyFacts` key; callers: 0 outside folder
- checkedAt(recorded, pass) — builds a `CheckedBody` reading `recorded` at `pass`; [exp]; callers: 1 outside folder
- bodyOf(factOf) — constructs a `CheckedBody` from `factOf` with `instantiated` and `joinedWith` wired through `bodyFacts`; callers: 0 outside folder
- joinedOf(bodies, rules) — builds a `JoinedBody` by applying each fact's `joined` reducer across `bodies`; callers: 0 outside folder
- joinedFact(name, answers, rules) — invokes `bodyFacts[name].joined(answers, rules)`; callers: 0 outside folder
- sameCallee(one, other) — compares two `ResolvedCall`s by declaration (and type arguments for variant constructors); callers: 0 outside folder
- readThrough(read, part) — wraps a node query `read` so non-undefined results are mapped by `part`; callers: 0 outside folder

## src/compiler/checker/wiring/body/facts/instantiation.ts — Substituting recorded types in a generic CheckedBody for one instantiation
- Instantiation — bundle of part-substitution functions (`concrete`, `fit`, `field`, `fieldRead`, `target`, `pattern`, `pass`, etc.); [exp]; callers: 0 outside folder
- instantiationBy(substitution, checker) — creates an `Instantiation` with memoized `concrete` unfolding and substituting types; [exp]; callers: 0 outside folder
- instantiatedPart(part, substitution, rules) — substitutes types and path in an `AssignedPart`; callers: 0 outside folder
- instantiatedFunction(checked, substitution, rules) — substitutes type, result, parameters, and captures of a `CheckedFunction`; callers: 0 outside folder
- instantiatedTarget(binding, substitution, rules) — substitutes type and `TargetStep[]` path of a `TargetBinding`; callers: 0 outside folder
- instantiatedTargetPath(path, substitution, rules) — substitutes struct steps in a `TargetStep[]`; callers: 0 outside folder
- instantiatedPattern(checked, substitution, rules) — substitutes all types in a `CheckedPattern`'s tests, steps, and bindings; callers: 0 outside folder
- instantiatedStep(step, substitution, rules) — substitutes union/member or struct types in a `PartStep`; callers: 0 outside folder
- instantiatedStructStep(step, substitution, rules) — substitutes struct types in a `StructStep`; callers: 0 outside folder
- substitutedFit(fit, substitution, rules) — substitutes `fit.conversion` and `fit.into`, collapsing union wraps when the union collapses; callers: 0 outside folder
- substitutedConversion(conversion, substitution, rules) — substitutes the target type of an `any`, `shape`, `parts`, or `async` conversion; callers: 0 outside folder
- instantiatedRead(checker, read, concrete) — substitutes `read.on` (and `read.key`) and re-resolves `required`/`named`/`keyed` `FieldRead`s; callers: 0 outside folder

## src/compiler/checker/wiring/body/facts/pass-joins.ts — Combinators for joining BodyFacts answers across field-loop passes
- typesJoined(answers, rules) — joins per-pass `Type | undefined` queries into their normalized union via `unionOf`; [exp]; callers: 0 outside folder
- firstFound(answers) — returns the first non-undefined answer across passes; [exp]; callers: 0 outside folder
- firstListed(answers) — returns the first non-empty array answer across passes; [exp]; callers: 0 outside folder
- everyListed(answers) — concatenates and deduplicates array answers across passes; [exp]; callers: 0 outside folder
- everyDistinct(answers, same) — collects distinct non-undefined answers across passes using `distinctItems(..., same)`; [exp]; callers: 0 outside folder
- inEveryPass(answers) — returns `true` only when every pass's predicate returns `true`; [exp]; callers: 0 outside folder
- firstRecorded(answers) — joins `PassRecords` across passes (`get` returns first found, `has` tests `some`); [exp]; callers: 0 outside folder
- firstPass(answers) — returns `answers[0]`; [exp]; callers: 0 outside folder

## src/compiler/checker/wiring/body/facts/recorded-body.ts — Bundle of body records and construct units read by bodyFacts
- RecordedBody — `{ records: BodyRecords, units: BodyUnits, result: Type }` passed to `checkedAt`; [exp]; callers: 0 outside folder

## src/compiler/checker/wiring/body/reported-fits.ts — Fitting a value's type to an expected type and reporting unmet traits or misfits
- reportedFit(context, found, expected, at) — returns `checker.fitOf(found, expected)` or reports misfit and returns `exactFit`; [exp]; callers: 0 outside folder

## src/compiler/checker/wiring/body/scope-protocol.ts — Expression standing table for constraint scopes
- Standing — `'opens' | 'joins' | 'boundary' | 'decided'`; [exp]; callers: 0 outside folder
- ScopeHolding — `{ holds, decidesItems }` interface queried by `standingOf`; [exp]; callers: 0 outside folder
- collectionStanding(scopes, items, expected) — returns `'decided'` if `items` is empty or `expected` is closed and `decidesItems`; callers: 0 outside folder
- standings — exhaustive `Handlers` table mapping every `Expression` kind to its `Standing`; callers: 0 outside folder
- standingOf(scopes, node, expected) — dispatches `node` through `standings`; [exp]; callers: 0 outside folder
- placeOf(scopes, node, expected, postponable) — upgrades `'boundary'`/`'decided'` to `'joins'` when `postponable` is true; [exp]; callers: 0 outside folder

## src/compiler/checker/wiring/program/program-checker.ts — Composition root for program-wide lazy type checking and incremental entries
- CheckerOptions — `{ previous?, tentative?, observe? }` options for `ProgramChecker`; [exp]; callers: 1 outside folder
- ProgramChecker — implements `CheckerContext` and `Checker`, composing all declaration/rule units over `Entries`; [exp]; callers: 1 outside folder
- ProgramChecker.constructor(program, options?) — wires `Entries`, `recordedBindings`, `programInputs`, and all checker subsystems; callers: 0 outside folder
- ProgramChecker.#checkBody(module, declaration, declaredResult) — creates a `'function'` `BodyChecker` and checks `declaration`'s body; callers: 0 outside folder
- ProgramChecker.#valueBody(module, declaredResult, within?) — creates a `'value'` `BodyChecker` for a constant, annotation, or default; callers: 0 outside folder
- ProgramChecker.#defaultsBody(declaration) — creates a `DefaultsBody` adapter over `#valueBody` for parameter defaults; callers: 0 outside folder
- ProgramChecker.anyTypeOf(module, traits, argumentType) — delegates to `resolveAnyType`; callers: 0 outside folder
- ProgramChecker.wellKnownType(declaration, typeArguments?) — looks up `wellKnownEntity(declaration)` and builds a `NominalType`; callers: 0 outside folder

## src/compiler/checker/wiring/program/program-disposals.ts — Entry tables for per-type dispose candidates, disposal calls, and dispose kinds
- programDisposals(checker) — wires `'dispose candidates'`, `'disposals'`, and `'dispose kinds'` entry tables by unaliased key; [exp]; callers: 0 outside folder
- sameCandidates(first, second) — compares two `DisposeCandidates` results by `runtime` flag and candidate declarations; callers: 0 outside folder

## src/compiler/checker/wiring/program/program-inputs.ts — Recorded Program and Bindings inputs for incremental revision reuse
- programInputs(entries, program, bindings) — wraps `Program` reads (`itemsOf`, `importedBy`, `role`, `bodyOf`) in `entries.input`; [exp]; callers: 0 outside folder
- recordedBindings(entries, bindings) — wraps every `Bindings` query in `entries.input` with structural equality where needed; [exp]; callers: 0 outside folder
- declaringInputs(entries, program) — wraps `DeclaringModules` (`moduleOf`, `itemModuleOf`) and `isStdModule` in `entries.input`; [exp]; callers: 0 outside folder
- DeclaringModules — indexes top-level items, trait members, type parameters, associated types, and fields functions to their `ModuleId`; callers: 0 outside folder
- DeclaringModules.itemModuleOf(node) — looks up `node` in lazily built `#items` map across all module trees; callers: 0 outside folder
- DeclaringModules.#moduleHolding(node) — scans program trees with `parentOf` to find the module holding a local declaration; callers: 0 outside folder
- declared(item) — lists `item`, its `typeParameters`, trait members, `associatedTypes`, and `fieldsFunctionsOf(item)`; callers: 0 outside folder

## src/compiler/checker/wiring/program/program-kinds.ts — Entry tables for function marks, type value kinds, and qualifier parameters
- programKinds(checker) — wires `'function kinds'`, `'declared kinds'`, `'walked kinds'`, and `'composed kinds'` entry tables; [exp]; callers: 0 outside folder
- programQualifiers(checker) — wires `'qualifier parameters'` entry table mapping `standingFor(parameter)` to its `QualifierParameter`; [exp]; callers: 0 outside folder

## src/compiler/checker/wiring/program/program-type-rules.ts — Wiring TypeRules and Fitting over program EntryTables
- ProgramTypeRules — `{ typeRules: TypeRules, fitting: Fitting }`; [exp]; callers: 0 outside folder
- TypeRuleSeams — `{ layouts: { nominalShapeOf } }` seam passed to `programTypeRules`; [exp]; callers: 0 outside folder
- programTypeRules(checker, seams) — wires `TypeRules` (`absorbs`, `associatedType`, `fieldType`, `keysOf`, `matchType`) and `Fitting`; [exp]; callers: 0 outside folder
- memberUnionOf(checker, type) — returns the union `type` (`associated` or `parameter`) stands for one member of; callers: 0 outside folder
- instantiationsIn(checker) — wires `'met instantiations'` and `'proposed instantiations'` entry tables for `Fitting`; callers: 0 outside folder
- sameMet(first, second) — compares two `MetInstantiation` results by kind and `sameConstraint`; callers: 0 outside folder
- partsOf(checker, declaration) — lists covariant/invariant `HeldPart`s of a struct, enum, alias, or trait for variance derivation; callers: 0 outside folder

## Concept footprint
- Optional/None: diagnostics/generics.ts:genericTemplates, diagnostics/patterns.ts:patternTemplates, surface/checked-body.ts:ChainLink, surface/checked-body.ts:BodyFacts, surface/json-form.ts:JsonField, wiring/body/body-checker.ts:BodyChecker, wiring/body/scope-protocol.ts:standings
- Result/propagation: contexts/body-context.ts:Returns, diagnostics/patterns.ts:patternTemplates, wiring/body/scope-protocol.ts:standings
- unions: contexts/context.ts:CheckerContext, diagnostics/generics.ts:genericTemplates, diagnostics/index.ts:checkerDiagnostics, diagnostics/patterns.ts:patternTemplates, diagnostics/values.ts:valueTemplates, lookup/denotations/index.ts:madeTypes, lookup/key-denotations.ts:typeKeyOwners, lookup/key-denotations.ts:instantiationsAt, lookup/key-denotations.ts:callInstantiations, surface/checked-pattern.ts:PartStep, surface/checked-pattern.ts:PartBinding, surface/checked-pattern.ts:PatternTest, surface/constant-form.ts:ConstantForm, surface/constant-form.ts:typesIn, surface/constant-form.ts:formSemantics, surface/constant-form.ts:sameHeads, surface/resolved-call.ts:MembersRequirement, surface/witness-closing.ts:closedInside, wiring/body/body-checker.ts:#checkedAs, wiring/body/constraint-scope.ts:#expectationOf, wiring/body/facts/instantiation.ts:instantiatedPattern, wiring/body/facts/instantiation.ts:instantiatedStep, wiring/body/facts/instantiation.ts:substitutedFit, wiring/body/facts/pass-joins.ts:typesJoined, wiring/program/program-type-rules.ts:programTypeRules, wiring/program/program-type-rules.ts:memberUnionOf
- enums/variants: contexts/body-context.ts:BodyContext, contexts/context.ts:ProgramInputs, contexts/context.ts:CheckerContext, diagnostics/generics.ts:genericTemplates, diagnostics/patterns.ts:patternTemplates, lookup/denotations/index.ts:chosenIn, lookup/denotations/index.ts:calleeDenotations, lookup/denotations/index.ts:madeTypes, lookup/denotations/index.ts:parameterNamed, lookup/denotations/index.ts:builtField, lookup/denotations/index.ts:declaredField, lookup/denotations/named.ts:fromEntity, lookup/denotations/named.ts:variantDenotation, lookup/denotations/named.ts:calledDenotation, lookup/denotations/named.ts:builtType, lookup/holders.ts:bodyInItem, lookup/key-denotations.ts:callInstantiations, lookup/members.ts:membersOf, surface/checked-body.ts:BodyFacts, surface/checked-pattern.ts:PatternTest, surface/json-form.ts:variantTagKey, surface/json-form.ts:DerivedForm, surface/named-variants.ts:variantNamed, surface/named-variants.ts:calledVariant, surface/struct-items.ts:callPatternArguments, surface/struct-items.ts:argumentsReach, wiring/body/body-checker.ts:BodyChecker, wiring/body/body-records.ts:bodyRecords, wiring/body/facts/index.ts:bodyFacts, wiring/body/facts/index.ts:sameCallee, wiring/program/program-checker.ts:ProgramChecker, wiring/program/program-inputs.ts:programInputs, wiring/program/program-type-rules.ts:partsOf
- any/trait objects: contexts/context.ts:CheckerContext, diagnostics/generics.ts:genericTemplates, diagnostics/variance.ts:varianceTemplates, surface/checked-field.ts:FieldRead, surface/checked-field.ts:requiredFieldRead, surface/checked-pattern.ts:PartStep, surface/checked-pattern.ts:PatternTest, surface/resolved-call.ts:RequirementOrigin, surface/resolved-call.ts:MembersRequirement, surface/witness-closing.ts:Closer, surface/witness-closing.ts:closedInside, wiring/body/facts/instantiation.ts:instantiatedPattern, wiring/body/facts/instantiation.ts:substitutedFit, wiring/body/facts/instantiation.ts:substitutedConversion, wiring/body/facts/instantiation.ts:instantiatedRead, wiring/body/reported-fits.ts:reportedFit, wiring/program/program-checker.ts:ProgramChecker, wiring/program/program-type-rules.ts:programTypeRules, wiring/program/program-type-rules.ts:instantiationsIn, wiring/program/program-type-rules.ts:partsOf
- futures/await/select: contexts/body-context.ts:BodyContext, contexts/body-context.ts:FunctionFrame, diagnostics/boundary.ts:boundaryTemplates, diagnostics/concurrency.ts:concurrencyTemplates, diagnostics/index.ts:checkerDiagnostics, diagnostics/lifetimes.ts:weakSideTemplates, surface/checked-annotation.ts:statementPlace, surface/checked-annotation.ts:waits, surface/checked-pattern.ts:TargetOwner, surface/resolved-call.ts:ImplicitRole, wiring/body/body-checker.ts:BodyChecker, wiring/body/body-kinds.ts:BodyKind, wiring/body/body-kinds.ts:ownScopeOf, wiring/body/facts/instantiation.ts:substitutedConversion, wiring/body/scope-protocol.ts:standings, wiring/program/program-checker.ts:#checkBody, wiring/program/program-type-rules.ts:programTypeRules
- marks/kinds (live/ista/simple): contexts/body-context.ts:BodyContext, contexts/body-context.ts:FunctionFrame, contexts/context.ts:CheckerContext, contexts/use-site.ts:UseSite, contexts/use-site.ts:bodySite, diagnostics/boundary.ts:boundaryTemplates, diagnostics/concurrency.ts:concurrencyTemplates, diagnostics/generics.ts:genericTemplates, lookup/lookup.ts:Lookup.constraintsOf, wiring/body/body-checker.ts:BodyChecker, wiring/body/body-kinds.ts:ownScopeOf, wiring/program/program-checker.ts:ProgramChecker, wiring/program/program-kinds.ts:programKinds, wiring/program/program-kinds.ts:programQualifiers, wiring/program/program-type-rules.ts:programTypeRules
- sendable: diagnostics/concurrency.ts:concurrencyTemplates, wiring/program/program-kinds.ts:programQualifiers
- shared structs: diagnostics/collections.ts:collectionTemplates, diagnostics/generics.ts:genericTemplates, diagnostics/lifetimes.ts:lifetimeTemplates, diagnostics/values.ts:valueTemplates, lookup/denotations/index.ts:declaredField, lookup/holders.ts:bodyInItem, surface/checked-annotation.ts:canAnnotate, wiring/body/scope-protocol.ts:standings, wiring/program/program-checker.ts:ProgramChecker
- extern types/functions/constants: contexts/use-site.ts:UseSite, contexts/use-site.ts:hostSite, diagnostics/boundary.ts:boundaryTemplates, diagnostics/lifetimes.ts:lifetimeTemplates, lookup/key-denotations.ts:keptParameterDenotations, surface/checked-annotation.ts:AnnotationPlace, surface/checked-annotation.ts:functionPlace, surface/host-externs.ts:isHostExtern, surface/host-externs.ts:isHostType, surface/json-form.ts:DerivedForm, wiring/program/program-checker.ts:ProgramChecker
- field loops/passes: contexts/body-context.ts:BodyContext, contexts/body-context.ts:CheckedPasses, contexts/passes.ts:Pass, contexts/passes.ts:Passes, contexts/passes.ts:PassRecords, contexts/passes.ts:PassTable, contexts/passes.ts:FieldPassType, diagnostics/generics.ts:genericTemplates, lookup/holders.ts:bodyHolding, lookup/pass-views.ts:PassAnswers, lookup/pass-views.ts:passesAround, surface/checked-body.ts:FieldPass, surface/checked-body.ts:BodyFacts, surface/checked-body.ts:CheckedBody, surface/checked-pattern.ts:TargetOwner, surface/denotation.ts:listedFacts, surface/denotation.ts:ListedFacts, surface/denotation.ts:JoinedBody, wiring/body/body-checker.ts:BodyChecker, wiring/body/body-records.ts:CheckedPass, wiring/body/body-records.ts:bodyRecords, wiring/body/facts/index.ts:bodyFacts, wiring/body/facts/index.ts:checkedAt, wiring/body/facts/index.ts:joinedOf, wiring/body/facts/instantiation.ts:instantiationBy, wiring/body/facts/pass-joins.ts:typesJoined, wiring/body/facts/pass-joins.ts:firstFound, wiring/body/facts/pass-joins.ts:firstListed, wiring/body/facts/pass-joins.ts:everyListed, wiring/body/facts/pass-joins.ts:everyDistinct, wiring/body/facts/pass-joins.ts:inEveryPass, wiring/body/facts/pass-joins.ts:firstRecorded, wiring/body/facts/pass-joins.ts:firstPass
- comprehensions: diagnostics/generics.ts:genericTemplates, diagnostics/values.ts:valueTemplates, surface/checked-body.ts:FieldSource, surface/checked-body.ts:Iteration, surface/checked-pattern.ts:TargetOwner, wiring/body/scope-protocol.ts:standings
- deferred calls: contexts/body-context.ts:DeferralRecord, diagnostics/concurrency.ts:concurrencyTemplates, lookup/denotations/index.ts:chosenIn, lookup/denotations/index.ts:parameterNamed, surface/checked-body.ts:BodyFacts, surface/resolved-call.ts:ResolvedSite, wiring/body/body-checker.ts:BodyChecker, wiring/body/facts/index.ts:bodyFacts, wiring/body/scope-protocol.ts:standings
- context consts: lookup/holders.ts:bodyInItem, wiring/body/body-kinds.ts:BodyKind, wiring/body/body-kinds.ts:ownScopeOf, wiring/program/program-checker.ts:ProgramChecker
- disposal/lifetimes/holders: contexts/body-context.ts:FunctionFrame, contexts/body-context.ts:Enclosing, contexts/body-context.ts:LabelRecord, diagnostics/boundary.ts:boundaryTemplates, diagnostics/generics.ts:genericTemplates, diagnostics/index.ts:checkerDiagnostics, diagnostics/lifetimes.ts:lifetimeTemplates, diagnostics/lifetimes.ts:cycleTemplates, diagnostics/lifetimes.ts:weakSideTemplates, lookup/denotations/index.ts:chosenIn, lookup/denotations/index.ts:heldFunction, lookup/key-denotations.ts:keptParameterDenotations, surface/checked-body.ts:LabelResolution, wiring/body/body-checker.ts:#finished, wiring/program/program-checker.ts:ProgramChecker, wiring/program/program-disposals.ts:programDisposals
- recursive aliases/type match: contexts/context.ts:ConstraintCheck, contexts/context.ts:CheckerContext, contexts/use-site.ts:useSite, diagnostics/generics.ts:genericTemplates, surface/checked-field.ts:requiredFieldRead, surface/checked-field.ts:namedFieldRead, surface/witness-closing.ts:closedInside, wiring/body/body-checker.ts:part, wiring/body/body-checker.ts:#checked, wiring/body/body-checker.ts:#record, wiring/body/constraint-scope.ts:waitedOnBy, wiring/body/facts/instantiation.ts:instantiationBy, wiring/body/facts/instantiation.ts:instantiatedPattern, wiring/body/facts/instantiation.ts:instantiatedStep, wiring/body/facts/instantiation.ts:substitutedFit, wiring/program/program-checker.ts:ProgramChecker, wiring/program/program-type-rules.ts:programTypeRules
- struct keys/keyof/mapped types: contexts/body-context.ts:BodyContext, contexts/context.ts:CheckerContext, diagnostics/generics.ts:genericTemplates, lookup/denotations/index.ts:itemNamed, lookup/key-denotations.ts:keyDenotationsOf, lookup/key-denotations.ts:keyedFieldDenotations, lookup/key-denotations.ts:keyOwnersAt, lookup/key-denotations.ts:typeKeyOwners, lookup/members.ts:fieldsOf, surface/checked-body.ts:WrittenFit, surface/checked-body.ts:BodyFacts, surface/checked-field.ts:FieldRead, surface/checked-field.ts:keyedFieldRead, wiring/body/body-checker.ts:#checkedAs, wiring/body/body-checker.ts:recordKey, wiring/body/body-records.ts:bodyRecords, wiring/body/facts/index.ts:bodyFacts, wiring/body/facts/instantiation.ts:instantiatedPart, wiring/body/facts/instantiation.ts:instantiatedRead, wiring/program/program-checker.ts:ProgramChecker, wiring/program/program-type-rules.ts:programTypeRules
- variance: diagnostics/variance.ts:varianceTemplates, wiring/program/program-type-rules.ts:programTypeRules, wiring/program/program-type-rules.ts:instantiationsIn, wiring/program/program-type-rules.ts:partsOf
- packs: contexts/body-context.ts:BodyContext, diagnostics/generics.ts:genericTemplates, wiring/body/body-checker.ts:inferLambda, wiring/body/constraint-scope.ts:inputsOf
- indented values: contexts/body-context.ts:BodyContext, diagnostics/values.ts:valueTemplates, lookup/denotations/index.ts:itemNamed, surface/checked-body.ts:BodyFacts, wiring/body/body-checker.ts:recordBuilt, wiring/body/body-records.ts:bodyRecords, wiring/body/facts/index.ts:bodyFacts, wiring/body/scope-protocol.ts:standings
- defaults/fields functions: diagnostics/concurrency.ts:concurrencyTemplates, diagnostics/generics.ts:genericTemplates, diagnostics/index.ts:checkerDiagnostics, diagnostics/patterns.ts:patternTemplates, lookup/denotations/index.ts:parameterNamed, lookup/denotations/named.ts:calledDenotation, lookup/denotations/named.ts:builtType, lookup/holders.ts:bodyInItem, lookup/holders.ts:bodyInFunction, lookup/holders.ts:fieldDefaultsOf, surface/checked-body.ts:FieldSource, surface/json-form.ts:JsonField, surface/json-form.ts:JsonCodecs, surface/resolved-call.ts:Binding, surface/resolved-call.ts:passesAll, surface/resolved-call.ts:ImplicitRole, wiring/body/body-checker.ts:defaults, wiring/body/body-kinds.ts:BodyKind, wiring/body/body-kinds.ts:ownScopeOf, wiring/body/facts/index.ts:bodyFacts, wiring/body/facts/index.ts:sameCallee, wiring/program/program-checker.ts:#defaultsBody, wiring/program/program-checker.ts:defaultsOf, wiring/program/program-inputs.ts:declared
- codecs/JSON: contexts/context.ts:CheckerContext, contexts/context.ts:AnnotationChecks, contexts/use-site.ts:UseSite, contexts/use-site.ts:hostSite, diagnostics/boundary.ts:boundaryTemplates, surface/json-form.ts:JsonDirection, surface/json-form.ts:jsonTraits, surface/json-form.ts:JsonField, surface/json-form.ts:variantTagKey, surface/json-form.ts:DerivedForm, surface/json-form.ts:JsonFormQueries, surface/json-form.ts:DerivedCodec, surface/json-form.ts:JsonCodecs, surface/resolved-call.ts:ImplicitRole, wiring/body/body-checker.ts:#finished, wiring/program/program-checker.ts:ProgramChecker
- witnesses/traits/associated types: contexts/context.ts:CheckerContext, contexts/context.ts:TraitGoal, contexts/context.ts:StructGoal, contexts/context.ts:RootGoals, contexts/use-site.ts:useSite, diagnostics/generics.ts:genericTemplates, lookup/denotations/index.ts:chosenIn, lookup/denotations/index.ts:memberDenotations, lookup/denotations/index.ts:associatedNamed, lookup/denotations/index.ts:declaredField, lookup/holders.ts:bodyInItem, lookup/lookup.ts:Lookup.constraintsOf, lookup/members.ts:membersOf, lookup/members.ts:fieldsOf, lookup/members.ts:staticsOf, lookup/members.ts:methodsOf, lookup/members.ts:methodNames, surface/checked-field.ts:RequiredField, surface/checked-field.ts:FieldRead, surface/checked-field.ts:requiredFieldRead, surface/resolved-call.ts:RequirementCall, surface/resolved-call.ts:RequirementOrigin, surface/resolved-call.ts:Witnesses, surface/resolved-call.ts:functionCallsWithin, surface/resolved-call.ts:witnessCallsOf, surface/resolved-call.ts:callsMadeWith, surface/witness-closing.ts:FunctionInstance, surface/witness-closing.ts:Closer, surface/witness-closing.ts:Closing, surface/witness-closing.ts:closedFunctionCall, surface/witness-closing.ts:closedInside, surface/witness-closing.ts:composed, surface/witness-closing.ts:closeWitnesses, wiring/program/program-checker.ts:ProgramChecker, wiring/program/program-checker.ts:#aliasModuleOf, wiring/program/program-inputs.ts:declared, wiring/program/program-type-rules.ts:programTypeRules, wiring/program/program-type-rules.ts:memberUnionOf, wiring/program/program-type-rules.ts:partsOf
- places/&refs/cells: contexts/body-context.ts:Variables, diagnostics/boundary.ts:boundaryTemplates, diagnostics/closures.ts:closureTemplates, diagnostics/collections.ts:collectionTemplates, diagnostics/concurrency.ts:concurrencyTemplates, diagnostics/generics.ts:genericTemplates, diagnostics/patterns.ts:patternTemplates, diagnostics/values.ts:valueTemplates, lookup/members.ts:methodsOf, surface/checked-body.ts:AssignedPart, surface/checked-body.ts:BodyFacts, wiring/body/facts/index.ts:bodyFacts, wiring/body/facts/instantiation.ts:instantiatedPart, wiring/body/scope-protocol.ts:standings, wiring/program/program-checker.ts:cellOf
- patterns/targets: contexts/body-context.ts:Variables, contexts/body-context.ts:PatternRecord, contexts/passes.ts:neverRunCodes, diagnostics/patterns.ts:patternTemplates, diagnostics/values.ts:valueTemplates, lookup/denotations/index.ts:chosenIn, lookup/holders.ts:bodyInFunction, surface/checked-body.ts:FieldGiver, surface/checked-body.ts:BodyFacts, surface/checked-pattern.ts:TargetOwner, surface/checked-pattern.ts:PartStep, surface/checked-pattern.ts:StructStep, surface/checked-pattern.ts:FieldStep, surface/checked-pattern.ts:TargetStep, surface/checked-pattern.ts:ArraySite, surface/checked-pattern.ts:ArrayStep, surface/checked-pattern.ts:TargetBinding, surface/checked-pattern.ts:PartBinding, surface/checked-pattern.ts:PatternTest, surface/checked-pattern.ts:neverTest, surface/checked-pattern.ts:cantMatch, surface/checked-pattern.ts:PatternValue, surface/checked-pattern.ts:CheckedPattern, surface/checked-pattern.ts:namesBound, surface/constant-form.ts:formAt, surface/constant-form.ts:formStep, surface/struct-items.ts:itemField, surface/struct-items.ts:callPatternArguments, surface/struct-items.ts:argumentsReach, wiring/body/body-checker.ts:checkFunction, wiring/body/body-checker.ts:checkConstant, wiring/body/facts/index.ts:bodyFacts, wiring/body/facts/instantiation.ts:instantiatedTarget, wiring/body/facts/instantiation.ts:instantiatedTargetPath, wiring/body/facts/instantiation.ts:instantiatedPattern, wiring/body/facts/instantiation.ts:instantiatedStep, wiring/body/facts/instantiation.ts:instantiatedStructStep
- templates: diagnostics/values.ts:valueTemplates, lookup/denotations/index.ts:chosenIn, lookup/denotations/index.ts:memberDenotations, surface/resolved-call.ts:ImplicitRole, wiring/body/scope-protocol.ts:standings
- ranges: diagnostics/patterns.ts:patternTemplates, surface/resolved-call.ts:ImplicitRole, wiring/body/scope-protocol.ts:standings
- comparisons/decided conditions: contexts/body-context.ts:DecisionRecord, contexts/passes.ts:neverRunCodes, diagnostics/patterns.ts:patternTemplates, surface/checked-body.ts:BodyFacts, surface/checked-pattern.ts:PatternTest, surface/resolved-call.ts:ImplicitRole, wiring/body/facts/index.ts:bodyFacts, wiring/body/scope-protocol.ts:standings
