# Lowering Catalog (`src/compiler/lowering`)

## src/compiler/lowering/calls/closed-calls.ts — Closes generic resolved calls to concrete function instances or `any`/union dispatches
- closeCallWithin(resolved, within, program) — closes a resolved call inside a body owner's substitution and witnesses; [exp]; callers: 1
- leavesOut(checker, call) — tests if a closed function call omits default parameters or an empty array rest; [exp]; callers: 1
- ClosedCall — union of a concrete `ClosedFunctionCall` or a trait `Dispatch` with its argument binding; [exp]; callers: 9
- calledParameters(checker, called) — returns the declared signature parameters of a closed call's function or requirement; [exp]; callers: 1
- resultOfCall(checker, call) — returns the concrete substituted result type of a closed call or dispatch; [exp]; callers: 1
- substitutionOfCall(checker, call) — builds the type-parameter substitution for a closed function call or dispatch; [exp]; callers: 0
- dispatchSubstitution(checker, dispatch) — maps a required function's trait, `Self`, and own type parameters for a dispatch; [exp]; callers: 1
- ClosedFunctionCall — a closed call targeting a concrete `FunctionInstance` with its parameter binding; [exp]; callers: 0
- Dispatch — a runtime dispatch over an `any` type or union's trait member with concrete type arguments and witnesses; [exp]; callers: 2
- closeCall(resolved, within, program) — closes a resolved call inside an optional `FunctionInstance`; [exp]; callers: 4
- closedCall(closed) — converts a witness-closed `ResolvedCall` into a `ClosedCall` or `Dispatch`
- closeFunctionCall(call, within, program) — closes a direct `FunctionCall` to its concrete `FunctionInstance`; [exp]; callers: 1
- closeWitness(witness, dispatch, program) — closes a trait witness call inside the requirement's dispatch instance; [exp]; callers: 1

## src/compiler/lowering/calls/emit-call.ts — Emits `call` instructions, binds default/rest/pack arguments, and inline-constructs full variants
- CallToEmit — span, function id or callee operand, and value/reference arguments for a raw `call` instruction; [exp]; callers: 0
- emitCall(context, call, dst?) — allocates `dst` and emits a `call` instruction to a function entry or callee value; [exp]; callers: 9
- FunctionCallToEmit — span, `ClosedCall`, and evaluated arguments in binding order; [exp]; callers: 0
- emitFunctionCall(context, toEmit, dst?) — binds arguments/defaults/rests and emits a call, dispatch, or inline variant build; [exp]; callers: 5
- boundParameters(context, toEmit) — maps call arguments in parameter order, building rest arrays/packs and `omitted` defaults
- restParameters(context, rest, items) — collects rest arguments into an `array` instruction or flattened pack tuple elements
- registerOf(argument) — extracts the value register from a call argument, rejecting references and omitted slots
- referenceTo(register) — wraps a register as a whole-value `&` reference call argument; [exp]; callers: 2
- emitCallAt(context, site, argumentRegisters, dst?) — emits the closed call recorded at a syntax site with value registers; [exp]; callers: 3
- emitImplicitCall(context, node, role, argumentList) — emits the implicit protocol or helper call recorded for a node and role; [exp]; callers: 7
- CallTarget — discriminated union of a closed function call or a function-value register callee; [exp]; callers: 3
- emitTo(context, span, target, given) — emits a call to either a `ClosedCall` or a function-value register; [exp]; callers: 2

## src/compiler/lowering/calls/packs.ts — Flattens instantiated type packs into concrete tuple elements for parameters and call spreads
- packElements(concrete) — returns the concrete tuple element types an instantiated pack substitutes to; [exp]; callers: 1
- packElementsOf(context, tuple, { type, span }) — reads each element of a pack's tuple register by field position; [exp]; callers: 1

## src/compiler/lowering/calls/waits.ts — Emits `wait`, per-case `resolver` handoff to `onAwait`, and `await` instructions
- WaitCase — callback that hands a wait case's resolver register to its awaitable's `onAwait`; [exp]; callers: 1
- openWait(context, cases, span) — emits `wait`, creates and releases each case's `resolver` after calling its `WaitCase`; [exp]; callers: 2
- awaitWait(context, wait, span) — allocates a result register and emits an `await` instruction on an open wait; [exp]; callers: 1
- awaitFuture(context, future, type, span) — awaits a prelude `Future<T, K>` from synthesized code via its `onAwait` instance; [exp]; callers: 2

## src/compiler/lowering/constructs/expressions/access/names.ts — Lowers identifier, qualified member, and type-application value reads
- lowerName(context, node) — lowers a bare identifier expression as a value; [exp]; callers: 1
- lowerApplied(context, node) — lowers `name<T>` as a resolved function value closure or a fieldless generic struct; [exp]; callers: 1
- lowerNamed(context, name, read) — lowers a named function value, fieldless variant, constant, bare struct, extern/context const, or local; [exp]; callers: 1

## src/compiler/lowering/constructs/expressions/access/optionals.ts — Lowers force-unwrap `a!` and nullish coalescing `a ?? b`
- lowerUnwrap(context, node) — reads a non-`none` optional value or calls prelude `panic` on `none`; [exp]; callers: 1
- lowerNullish(context, node) — returns the non-`none` left value or evaluates the right fallback only on `none`; [exp]; callers: 1

## src/compiler/lowering/constructs/expressions/calls.ts — Evaluates call callees, receivers, reference places, spreads, and arguments in source order
- lowerCall(context, node) — lowers a `Call` node (or fieldless `Variant()`), emitting the call and writing back `&` copies; [exp]; callers: 0
- PreparedCall — a call target, evaluated `PassedArgument`s, ordered `Argument`s, and deferred-call function slot index; [exp]; callers: 0
- preparedCall(context, node, references) — evaluates callee/receiver and arguments in source order for a call or deferred call; [exp]; callers: 0
- receiverOf(context, node, receiver, byReference) — evaluates a method receiver by value, `&self` place, or optional chain target
- valueCallee(context, node) — evaluates a function-value call's callee from an optional chain, struct field read, or expression
- PassedArgument — an evaluated call `Argument` paired with its optional copy-out `leave` callback; [exp]; callers: 0
- parametersByArgument(context, called) — maps binding argument indices to their target `SignatureParameter`s
- restKindAt(parameterAt, index) — returns whether spread argument `index` fills an `'array'` or `'pack'` rest parameter
- passedArguments(context, node, passing) — evaluates receiver and written arguments in source order, materializing array spreads
- valueArguments(context, node, passed) — reorders arguments for a function-value call and flattens pack spreads into elements
- argumentOf(context, argument, byReference) — evaluates one argument as a value register or enters its `&`-referenced place
- referencedPlace(argument, byReference) — unwraps `&x` or returns the receiver expression when taken as `&self`
- leaveAll(argumentList) — runs copy-out `leave` callbacks of `&` arguments in reverse order after a call; [exp]; callers: 0

## src/compiler/lowering/constructs/expressions/closures.ts — Lowers lambdas, local functions, and top-level/constructor function values to closures
- lowerLambda(context, node) — lowers a lambda expression into a new `closure` register capturing its outer variables; [exp]; callers: 0
- lowerLocalFunction(context, node) — declares a local `fn` variable and initializes it with its `closure`; [exp]; callers: 1
- lowerFunctionValue(context, site) — emits a captureless `closure` for a top-level/static function or variant constructor; [exp]; callers: 1
- closureOf(context, node, dst) — emits a `closure` instruction for a lambda or local `fn` with its captured registers

## src/compiler/lowering/constructs/expressions/collections/collections.ts — Lowers array/map/declared collection literals, ranges, spreads, and indexing
- appendElement(context, span, dst, item) — appends `item` to the array in `dst` by emitting a spread-plus-item `array`; [exp]; callers: 0
- lowerArrayLiteral(context, node) — lowers `[...]` as an `array`, an empty `map`, or a declared collection via `default`/`setIndex`; [exp]; callers: 1
- arrayOf(context, elements, span) — builds an array from written elements, whole-copied spreads, and cursor-iterated spreads
- lowerMapLiteral(context, node) — lowers `[k: v]` as a `map` instruction or a declared collection via `default`/`setIndex`; [exp]; callers: 1
- lowerRange(context, node) — lowers `a..b` / `a..=b step s` into a `prelude.Range` struct, calling `_inclusiveEnd` for `..=`; [exp]; callers: 1
- lowerIndex(context, node) — lowers `x[k]` as a resolved `index` call or a struct keyed-field read; [exp]; callers: 1
- built(context, parts, nodes) — batches contiguous items/copied spreads into collection instructions and loops over cursor spreads
- spreadArray(context, spread) — returns a spread's array register directly if copied whole, or builds one via `arrayOf`; [exp]; callers: 1
- fittedItem(context, spread, item) — applies the checker-recorded item `Fit` to each element produced by a spread's cursor
- lowerDeclaredLiteral(context, node, entries) — builds a non-builtin collection from `default()` in a cell and `setIndex` calls
- optionalInt(context, span, value) — wraps a range bound register into `Int?` (`someOf` or `noneOf`)

## src/compiler/lowering/constructs/expressions/collections/comprehensions.ts — Lowers iterator-based and struct-field array comprehensions
- lowerComprehension(context, node) — lowers `[for x in c if cond: body]` using `emitLoopOver` and `appendElement`; [exp]; callers: 1
- lowerFieldComprehension(context, node) — lowers `[for k, v of s: body]` by unrolling one pass per struct field; [exp]; callers: 1

## src/compiler/lowering/constructs/expressions/control/await.ts — Lowers `await expr` and builds `WaitCase` callbacks for `onAwait`
- lowerAwait(context, node) — evaluates the operand, opens a single-case wait via `awaitedAt`, and emits `await`; [exp]; callers: 1
- awaitedAt(context, node, operand) — returns a `WaitCase` that calls the implicit `onAwait` recorded at `node`; [exp]; callers: 0

## src/compiler/lowering/constructs/expressions/control/control.ts — Lowers `if`/`elif`/`else` expressions with condition-scoped bindings and constant pruning
- lowerIf(context, node) — lowers reachable branches of an `If` into one result register, defaulting missing `else` to unit; [exp]; callers: 1
- lowerBranch(context, branch, { result, end }) — lowers one `if`/`elif` branch inside `lowerGuarded` and jumps to `end`

## src/compiler/lowering/constructs/expressions/control/matching.ts — Lowers `match` and `is` expressions over checked patterns
- lowerMatch(context, node) — evaluates subject once, runs each reachable case's pattern/guard in its own scope, and writes result; [exp]; callers: 1
- lowerIs(context, node) — lowers `x is P`, binding pattern variables on the passing path and writing `true` or `false`; [exp]; callers: 1

## src/compiler/lowering/constructs/expressions/control/propagate.ts — Lowers error propagation `e?` on `Result` values
- lowerPropagate(context, node) — unwraps `Ok` payload or converts `Err` payload to the enclosing function's error type and returns; [exp]; callers: 1
- returnedError(context, error) — fits an unwrapped `Err` payload to the enclosing function's `Result` error type

## src/compiler/lowering/constructs/expressions/control/select.ts — Lowers `select` expressions waiting across multiple futures with `else` fallback
- lowerSelect(context, node) — evaluates each case's future tracking held registers, opens wait, emits `select`, and lowers bodies; [exp]; callers: 1
- caseCode(context, selectCase) — evaluates a `select` case's future inside `code.allocating` to capture its held temporaries

## src/compiler/lowering/constructs/expressions/deferred-calls.ts — Lowers deferred calls `g f(args)` and synthesizes their captured zero-arg entries
- lowerDeferredCall(context, node) — evaluates taker and deferred call's arguments now, passing a closure of `deferredEntry`; [exp]; callers: 0
- deferredFunction(context, node) — copies eagerly evaluated call parts and emits a closure of the deferred call's entry
- isMade(context, node) — checks whether every call in a deferred call chain was resolved (did not stop on `Never`)
- computedNow(context, call, site) — evaluates a deferred call's callee/receiver and arguments by value and builds its `DeferredPlan`
- closure(context, entry, values, span) — allocates a register and emits a `closure` instruction capturing `values`
- deferredEntry(lowering, deferred) — synthesizes the `CodeFunction` entry that executes a `DeferredPlan` from its captures; [exp]; callers: 1
- madeCall(code, deferred, values) — reconstructs nested deferred closures and emits the deferred call from captured registers

## src/compiler/lowering/constructs/expressions/expressions.ts — Exhaustive dispatch table mapping each `Expression` syntax kind to its lowering handler
- expressionHandlers — `Handlers<FunctionContext, Expression, [], Register>` table for all expression kinds; [exp]; callers: 1

## src/compiler/lowering/constructs/expressions/literals/literals.ts — Lowers duration literals to `time.Duration` constants
- lowerDurationLiteral(context, node) — builds a `durationForm` for a `DurationLiteral` and emits it as a constant; [exp]; callers: 1

## src/compiler/lowering/constructs/expressions/literals/templates.ts — Lowers tagged templates as calls and untagged templates via `toString` and `join`
- lowerTemplate(context, node) — lowers tagged templates as calls, constant templates as strings, and others via `interpolate`/`join`; [exp]; callers: 1

## src/compiler/lowering/constructs/expressions/literals/tuples.ts — Lowers tuple literals `(a, b)`, unit `()`, and tuple element reads `t.0`
- lowerTuple(context, node) — evaluates elements and builds a tuple register or unit constant; [exp]; callers: 1
- tupleOf(context, elements, span) — emits unit `null` constant for 0 elements or a `tuple` instruction; [exp]; callers: 5
- lowerTupleElement(context, node) — reads a tuple element by index from its optional-chain target; [exp]; callers: 1

## src/compiler/lowering/constructs/expressions/operators.ts — Lowers unary, binary, short-circuit logic, comparison, and chained-comparison operators
- lowerBinary(context, node) — lowers comparisons, decided comparisons, `and`/`or`, `??`, and operator function calls; [exp]; callers: 0
- lowerChainedComparison(context, node) — lowers `a < b < c`, evaluating middle operands once and short-circuiting on false; [exp]; callers: 0
- compared(context, link, [left, right]) — emits `==`/`!=`, `includes`/`not in`, or `compare` + `order` for one comparison link
- equal(context, span, [left, right], isNegated?) — emits built-in `equal` and optional `not` for `!=`; [exp]; callers: 2
- ordered(context, span, comparison, relation) — emits an `order` instruction testing a `compare` result against `relation`; [exp]; callers: 1
- lowerUnary(context, node) — lowers `not` to a `not` instruction and prefix `-`/`~` to their resolved operator call; [exp]; callers: 0
- shortCircuit(context, node, rightWhen) — lowers `and` / `or` by branching on the left operand before evaluating the right

## src/compiler/lowering/constructs/expressions/structs/structs.ts — Lowers struct/shared-struct literals, spreads, struct comprehensions, and field reads
- lowerStructLiteral(context, node) — lowers `S{...}` via `literalValue`; [exp]; callers: 1
- lowerNewStructLiteral(context, node) — lowers `new S{...}` via `literalValue`; [exp]; callers: 1
- literalValue(context, node) — builds a struct (or shared cell) in place, or calls its fields-function entry when defaults are omitted
- literalFields(context, node) — evaluates struct literal items, spreads, and struct comprehensions in source order
- comprehendedFields(context, node) — lowers a `StructComprehension` by evaluating its value in each field's pass scope
- fieldOf(context, literal, source) — reads a struct literal field from its evaluated item register or leading spread register
- lowerBareStruct(context, node) — constructs an empty struct value for a fieldless struct named bare; [exp]; callers: 1
- readsField(context, access) — tests whether `a.b` reads a struct/trait field rather than a namespace or static member; [exp]; callers: 2
- lowerFieldRead(context, node, link?) — lowers `x.f` as a positional `field` read or an `any` field-read entry call; [exp]; callers: 2
- structTypeOf(context, node) — returns the `NominalType | AnonymousStructType` of a struct expression
- registerOf(values, value) — looks up the register evaluated for a struct literal item expression

## src/compiler/lowering/constructs/expressions/structs/variants.ts — Lowers fieldless enum variants and variant tag branches/payload reads
- lowerFieldlessVariant(context, node, name) — emits a fieldless enum `variant` instruction for `node`; [exp]; callers: 2
- fieldlessVariantCalled(context, node) — returns the variant name if `node` is a `Variant()` call on a fieldless variant; [exp]; callers: 1
- VariantTest — register and variant index for a single-variant enum tag test; [exp]; callers: 0
- variantTestOf(checker, register, type, name) — resolves `name` to its variant index in `type` to build a `VariantTest`
- branchOnVariant(context, test, labels, span) — emits a `switch` jumping to `matched` on `test.variant` and `otherwise` elsewhere; [exp]; callers: 1
- payloadOf(context, register, span) — reads field 0 of a single-field enum variant (`Some`, `Ok`, `Err`, `Next`); [exp]; callers: 2
- VariantCase — register, nominal enum type, and variant name for a single-payload variant branch; [exp]; callers: 0
- payloadOr(context, tested, otherwise, span) — branches on `tested`'s variant, running `otherwise` on mismatch or returning field 0; [exp]; callers: 3
- isEnum(type) — type guard checking whether `type` is a nominal `EnumDeclaration` type; [exp]; callers: 1
- emitVariant(context, node, name, fields) — verifies `node` has an enum type and emits a `variant` instruction

## src/compiler/lowering/constructs/loops/field-passes.ts — Unrolls compile-time passes over a struct's fields for field loops and comprehensions
- VisitedFields — a `FieldHeader`, its evaluated struct subject register, and its sorted `FieldMember` list; [exp]; callers: 0
- fieldsVisited(context, header, span) — evaluates a field loop's subject and looks up its struct fields in name order; [exp]; callers: 3
- inFieldScope(context, visited, position, body) — lowers `body` in field `position`'s pass and block scope with key/value bound; [exp]; callers: 2
- valueInFieldScope(context, visited, position, value) — lowers a value-producing pass for field `position` inside `valueInBlock`; [exp]; callers: 1
- inFieldPassOf(context, visited, position, lower) — switches `FunctionContext` to the checked pass for field `position`
- bindField(context, visited, position) — binds the field's name constant and field value as a `(key, value)` tuple into `header`

## src/compiler/lowering/constructs/loops/iteration.ts — Emits cursor-based iteration loops for `for`, comprehensions, and non-copied spreads
- cursorOf(context, node, iterable) — evaluates `iterable` and calls its implicit `iterate` function to get a cursor closure; [exp]; callers: 1
- emitLoop(context, node, cursor, body) — loops calling `cursor()`, branching on `Step.Next`/`Done` and running `body`; [exp]; callers: 1
- emitLoopOver(context, node, body) — runs `emitLoop` over `node.iterable`, binding `node`'s targets in a per-iteration block scope; [exp]; callers: 2
- iterationFormOf(context, node) — returns the checker-recorded `IterationForm` (`cursor` or `copied`) for `node`; [exp]; callers: 1

## src/compiler/lowering/constructs/never-lowered.ts — Sentinel handler that throws `unreachable` for syntax nodes that never lower as values
- neverLowered(context, node) — throws `unreachable` if `Reference`, `Missing`, or `Invalid` is lowered as an expression/statement; [exp]; callers: 2

## src/compiler/lowering/constructs/parts/part-paths.ts — Reads nested parts of a value along checker `PartStep` paths for patterns and targets
- readPartAlong(context, subject, path, span) — walks `PartStep`s from `subject`, batching field positions and building rests/array slices; [exp]; callers: 1
- isBuilding(step) — tests whether a `PartStep` constructs a new value (array `length`/`item`/`rest` or struct `fieldRest`)
- builtAt(context, part, step, span) — emits `rebuiltAs` for a struct `fieldRest` or an implicit array-pattern call
- positionsOf(context, step) — resolves a non-building `PartStep` (tuple/variant index, struct field name, downcast, union member) to field indices
- stepOffsets(step) — returns the integer offset arguments for an array pattern `length`, `item`, or `rest` step

## src/compiler/lowering/constructs/parts/patterns.ts — Lowers pattern tests and variable bindings for `match` cases and `is` expressions
- Matching — subject register and `CheckedPattern` to test and bind; [exp]; callers: 0
- lowerMatching(context, matching, fail, span) — runs pattern tests jumping to `fail` on mismatch, then declares and binds pattern names; [exp]; callers: 1
- lowerTests(context, tests, run) — emits sequential pattern tests, dispatching `or` alternatives and `never` jumps
- lowerAlternatives(context, test, run) — tries each `or`-pattern alternative in turn and records the winning index in a register
- lowerTest(context, test, part, branch) — emits a single member, variant, downcast, equality, or ordering pattern test
- lowerMemberTest(context, test, part, branch) — tests union/collapsed-union membership, comparing merged literal members by value
- heldOrJump(context, value, member, { otherwise, span }) — branches on `member` being held in `value` and extracts it via `outOfUnion`
- passed(context, test, part, span) — computes the boolean result of an `equal` or `compare` pattern test
- bind(context, pattern, run, variables) — moves each bound part (unwrapped via `outOfUnion` if narrowed) into its variable register
- bindChosen(context, test, run, variables) — branches on the recorded `or`-pattern choice register to bind the matching alternative
- comparedWith(context, value, span) — lowers a pattern test's right-hand expression, integer literal, or named constant

## src/compiler/lowering/constructs/parts/places.ts — Locates, reads, writes, and copies in/out assigned places and `&`-referenced places
- AssignedPlace — `read` and `write` closures for an entered assignment target place; [exp]; callers: 1
- enterAssigned(context, node) — locates an assignment target once and returns its `read` and fit-aware `write` closures; [exp]; callers: 1
- ReferencedPlace — a Definition `Place` and optional copy-out `leave` callback for a `&` argument; [exp]; callers: 0
- enterReferenced(context, node) — locates a `&` argument place, copying accessor-backed parts into a temporary cell with copy-out; [exp]; callers: 1
- variableRegister(context, node) — looks up the frame register of the variable denoted by an `Identifier`
- cellRegister(context, type) — allocates a register and registers it as a `_Cell<T>` in the function's frame; [exp]; callers: 2
- fieldPositionOf(context, node) — returns the concrete struct field index for a `MemberAccess` place step
- locate(context, node) — decomposes a place expression into its root variable/dereference and steps, evaluating keys once
- stepped(context, location, step) — advances a `Location` by a struct/tuple field, keyed struct field, or indexed element accessor
- withFields(location, positions, type) — appends static field indices to a `place`, `accessor`, or `keyed` `Location`
- pastField(within, position, path, type) — builds the `Location` at `[position, ...path]` inside `within` for one case of a keyed switch
- readAt(context, location, span) — reads the current value at a `place`, `keyed`, or `accessor` `Location`
- writeAt(context, location, value, span) — writes `value` to `location` via `move`, `store`, or accessor read-modify-write
- changeAt(context, location, changing, change) — runs `change` on a Definition `Place`, wrapping accessors in read-modify-write or keyed switches
- elementAccessor(context, container, key, node) — builds an `Accessor` that reads via `index` and writes via `setIndex(&container, key, value)`
- lowerDereference(context, node) — lowers `*x` as a `readCell` read through `sharedAccessor`; [exp]; callers: 1
- sharedAccessor(context, node) — builds an `Accessor` for `*x` / `x->` using `readCell` and `writeCell`

## src/compiler/lowering/constructs/statements/holds.ts — Manages `hold` scope register lists for function-wide and labelled-scope lifetimes
- HoldScopes — tracks the `keep` target list registers for the enclosing function and active labelled scopes; [exp]; callers: 2
- HoldScopes.listOf(hold) — returns the `keep` list register for the labelled scope or function that `hold` targets; callers: 1
- HoldScopes.lowerScope(scope, lower) — wraps `lower` in a block owning a fresh hold-list register if any `hold` targets `scope`; callers: 1
- HoldScopes.#functionList() — lazily allocates and declares the function-wide hold-list register

## src/compiler/lowering/constructs/statements/loops.ts — Lowers `while`, `for`, `FieldLoop`, `LabelledBlock`, `break`, and `continue` statements
- LoopTargets — `exit` label, `next` label, and block scope `depth` for a loop being lowered; [exp]; callers: 1
- LoopStack — stack of active loops mapping `break`/`continue` targets; [exp]; callers: 2
- LoopStack.inside(loop, targets, body) — pushes `loop` and `targets` onto the active loop stack while lowering `body`; callers: 0
- LoopStack.of(loop, exit) — looks up the `LoopTargets` for the enclosing loop targeted by `break` or `continue`; callers: 0
- lowerWhile(context, node) — lowers a `While` statement inside its hold scope; [exp]; callers: 0
- lowerWhileLoop(context, node) — emits the condition-guarded loop body and back-edge jump for a `While` statement
- lowerFor(context, node) — lowers a `For` statement inside its hold scope via `emitLoopOver`; [exp]; callers: 0
- lowerFieldLoop(context, node) — lowers a `FieldLoop` by unrolling one scoped pass per struct field with `next`/`exit` labels; [exp]; callers: 0
- lowerLabelledBlock(context, node) — lowers a `LabelledBlock` inside its hold scope; [exp]; callers: 0
- lowerLoopExit(context, node) — ends all block scopes opened since the target loop's depth and jumps to `exit` or `next`; [exp]; callers: 0

## src/compiler/lowering/constructs/statements/scopes.ts — Emits `keep` and `release` instructions at block, header, and guarded-scope exits
- endScope(context, scope, span) — groups `scope.kept` by target list to emit `keep`, then emits `release` for `scope.declared`; [exp]; callers: 4
- valueInBlock(context, span, lower) — lowers a value-producing block, copying variable results before releasing block locals and temporaries; [exp]; callers: 1
- headerTemporaries(context, header) — lowers a condition/subject header and returns its result register and temporary registers; [exp]; callers: 1
- Guarded — callbacks and span for a scope entered through a boolean condition or pattern guard; [exp]; callers: 0
- lowerGuarded(context, guarded) — lowers a guarded scope, releasing header temporaries before the body and all locals on failure; [exp]; callers: 2
- release(context, registers, span) — emits a `release` instruction when `registers` is non-empty; [exp]; callers: 2

## src/compiler/lowering/constructs/statements/statements.ts — Dispatches statement kinds and lowers blocks, function bodies, `return`, and `drop`
- lowerStatement(context, node) — dispatches a statement handler and releases its temporary registers unless it jumps/returns; [exp]; callers: 1
- lowerBlock(context, block) — lowers a `Block` inside `valueInBlock` and returns its tail value or unit register; [exp]; callers: 1
- lowerBody(context, block) — lowers a function body's statements and tail expression (or fitted unit) without a block release; [exp]; callers: 1
- lowerDrop(context, node) — emits `release` for `drop variable` or evaluates `drop expr` as a statement temporary

## src/compiler/lowering/constructs/statements/variables.ts — Tracks variable/cell registers, block scopes, destructuring bindings, and assignments
- CellRegister — a register index paired with its `_Cell<T>` `TypeId` for frame cell initialization; [exp]; callers: 1
- Lifetime — `'block'` or `{ into: Register }` indicating where a variable's value goes when its block ends; [exp]; callers: 0
- Kept — a held variable's register and the hold-scope list register it is kept into; [exp]; callers: 0
- BlockScope — registers declared and kept within one lexical block scope; [exp]; callers: 0
- VariableRegisters — tracks per-body variable registers, cell registers, released temporaries, and open block scopes; [exp]; callers: 2
- VariableRegisters.declareUnnamed(register, lifetime?) — records an unnamed variable in the innermost block scope (and hold list if held)
- VariableRegisters.inBlock(lower) — runs `lower` inside a new lexical block scope and returns its result and `BlockScope`
- VariableRegisters.scopeSince(depth) — collects declared and kept registers from all blocks opened since `depth`, innermost first
- VariableRegisters.temporariesAmong(registers) — filters out variables and already-released registers, marking the rest released
- VariableRegisters.registerOf(declaring) — returns the register allocated for a variable's declaring `Identifier`
- declareVariable(context, declaring, type, lifetime?) — allocates a plain or cell register and declares `declaring` in the current scope; [exp]; callers: 3
- lowerVariableDeclaration(context, node) — evaluates initializer, preserves unnamed `_` parts, and binds destructuring targets; [exp]; callers: 0
- bindTargets(context, owner, value, span) — reads each target binding's path from `value` and moves it into a newly declared variable; [exp]; callers: 4
- copied(context, value, span) — allocates a fresh register and moves `value` into it; [exp]; callers: 1
- lowerAssignment(context, node) — lowers `=` and compound `op=` assignments across target parts and places; [exp]; callers: 0
- lowerCompound(context, node, place, part) — reads `place`, calls the compound assignment's operator function, and writes the fitted result back

## src/compiler/lowering/context.ts — Defines the `FunctionContext` and `CodeContext` seams shared across lowering modules
- CodeContext — subset of `FunctionContext` (`checker`, `tables`, `code`, `constant`) used by body-less and shared helpers; [exp]; callers: 22
- FunctionContext — per-function lowering interface providing body queries, sub-node lowering, and frame state units; [exp]; callers: 36

## src/compiler/lowering/functions/bodies.ts — Looks up a function declaration's syntax body and a nested function's full span
- writtenBodyOf(program, module, declaration) — retrieves `declaration`'s `Block` body from its module's `SyntaxTree`; [exp]; callers: 2
- nestedSpanOf(program, module, node) — returns a lambda's span or a local function's header-plus-body span; [exp]; callers: 2

## src/compiler/lowering/functions/built-entries.ts — Builds `CodeFunction` entries for declarations without syntax bodies (structs, variants, externs)
- constructorEntry(lowering, instance) — builds a variant constructor's entry that constructs the variant after its default prologue; [exp]; callers: 1
- structEntry(lowering, instance) — builds a struct fields-function's entry that constructs the struct/shared cell after defaults; [exp]; callers: 1
- hostExternEntry(lowering, instance) — builds a host extern's wrapper entry that runs defaults then encodes/calls/decodes JSON; [exp]; callers: 1
- externDefaultsEntry(lowering, instance) — builds a std native extern's defaults entry that computes omitted defaults then calls the native; [exp]; callers: 1
- structTypeOf(type) — narrows a struct fields-function's result `Type` to `NominalType`

## src/compiler/lowering/functions/code-writer.ts — Linear register allocator, instruction buffer, waypoint tracker, and single-pass label patcher
- Label — opaque label identifier for forward and backward jumps; [exp]; callers: 7
- SelectCaseCode — held registers, optional `as` binding register, and target `Label` for one `select` case; [exp]; callers: 1
- WrittenInstruction — a Definition `Instruction` carrying an `AnchoredSpan` prior to tree span resolution; [exp]; callers: 0
- WrittenCode — finished register count and resolved `Instruction[]` for a function entry; [exp]; callers: 0
- CodeWriter — emits instructions, allocates registers, and patches label targets for one function entry; [exp]; callers: 3
- CodeWriter.allocating(write) — runs `write()` and returns its result along with all registers allocated during the call
- CodeWriter.place(label) — binds `label` to the next instruction index and runs any pending forward-jump patches
- CodeWriter.jump(target, span) — emits a `jump` instruction and patches `target` when placed
- CodeWriter.branch(condition, whenTrue, whenFalse, span) — emits a conditional `branch` instruction and patches both target labels
- CodeWriter.given(parameter, target, span) — emits a prologue `given` instruction jumping to `target` if `parameter` was passed
- CodeWriter.contextConstant(dst, name, target, span) — emits a `contextConstant` instruction jumping to `target` if already initialized
- CodeWriter.switch(value, targets, span, otherwise?) — emits a variant-index `switch` instruction and patches all target labels
- CodeWriter.withWaypoint(waypoint, write) — attaches `@Waypoint` label `waypoint` to `await` and `select` instructions emitted inside `write`
- CodeWriter.select(wait, cases, otherwise, span) — emits a `select` instruction over `wait` and patches each case's and `otherwise`'s label
- CodeWriter.finish(tree) — verifies all referenced labels were placed and resolves every instruction's `AnchoredSpan` in `tree`
- CodeWriter.#refer(label, patch) — applies `patch` immediately if `label` is already placed, or queues it until `place(label)`

## src/compiler/lowering/functions/fits/index.ts — Applies checker-recorded implicit conversions, union wraps, async function wraps, and part conversions
- TypedRegister — a value register paired with its `Type`; [exp]; callers: 0
- fittedValue(context, typed, fit, where) — converts `typed` and wraps it into a union as recorded by `fit` at a body site; [exp]; callers: 1
- appliedFit(context, typed, fit, how) — runs `convertedValue` for `fit.conversion` and wraps into `fit.into` via `intoUnion`
- convertedValue(context, typed, conversion, how) — applies `any`, `async`, `shape`, `tupled`, `untupled`, `base`, or `parts` conversion
- partsConverted(context, typed, to, how) — emits a `wrapping` closure or `converting` call when a `parts` conversion changes layout
- closureOf(context, entry, captures, span) — allocates a register and emits a `closure` instruction for `entry`
- applyingIn(code, at) — builds the `Applying` strategy used inside a synthesized conversion entry
- fittedIn(code, typed, to, at) — fits `typed` into `to` inside a synthesized entry using `checker.fitOf`; [exp]; callers: 1
- rebuildingIn(code, how) — builds the `Rebuilding` callbacks (`converted`, `converter`, `wrapped`) for `rebuilt`
- fitBetween(context, from, to) — looks up `checker.fitOf(from, to)` or throws `unreachable`
- convertingEntry(lowering, entry) — synthesizes the `CodeFunction` entry converting a value of `entry.from` into `entry.to` part by part; [exp]; callers: 1
- wrappingEntry(lowering, entry) — synthesizes the `CodeFunction` entry wrapping a function of type `entry.from` as `entry.to`; [exp]; callers: 1
- returnedAs(code, called, { from, to }, at) — awaits/fits a wrapped or deferred call's result to `to.result` and emits `return`; [exp]; callers: 1
- structTypeOf(type) — narrows a type converted into a shape to `StructValueType`
- functionTypeOf(type) — narrows a type made async to `FunctionType`
- asyncFitClosure(context, fit, value) — emits a closure of `asyncFitIndex(fit)` capturing the plain function `value`
- asyncFitEntry(context, fit) — synthesizes the async wrapper entry for a plain function converted by `conversion.kind === 'async'`; [exp]; callers: 1

## src/compiler/lowering/functions/fits/parts.ts — Derives layout-changing part-by-part value conversions for tuples, structs, enums, arrays, and maps
- Rebuilding — callbacks and span for recursive part-by-part value rebuilding; [exp]; callers: 0
- changesLayout(checker, from, to, relating?) — tests whether converting `from` to `to` changes runtime value representation; [exp]; callers: 0
- fitChangesLayout(checker, from, fit, relating) — checks whether `fit` wraps into a union, unwraps a multi-literal tag, or changes any part's layout
- pairsOf(checker, from, to) — returns paired part types unless the outer container itself changes layout (union, nominal-to-shape, resolved future)
- rebuilt(context, value, to, how) — rebuilds `value` of `value.type` into `to` across unions, shapes, functions, tuples, and nominals; [exp]; callers: 0
- rebuiltTuple(context, value, to, how) — reads and converts each element of a tuple and constructs the target tuple
- rebuiltStruct(context, value, to, how) — reads and converts each field of a struct/shape in name order and constructs `to`
- rebuiltNominal(context, value, to, how) — dispatches nominal part conversion across `Array`, `Map`, structs, enums, or unchanged host handles
- mappedWith(context, value, { from, to }, how) — calls prelude `map` or `_mapValues` with a conversion closure for `Array` or `Map`
- rebuiltVariant(context, value, to, how) — switches over an enum's variants, converting each variant's fields and rebuilding the variant in `to`

## src/compiler/lowering/functions/frame-variables.ts — Declares frame parameters, captures, prologues for omitted defaults, `self`, and `_Call`
- EntryContext — extends `FunctionContext` with `frame`, `owner`, and `inDefaults` for frame prologue lowering; [exp]; callers: 0
- FrameSlot — a `SignatureParameter` paired with its flattened tuple element types when it is a pack rest parameter; [exp]; callers: 0
- EntryParameter — a Definition parameter's register, `reference` flag, and `hasDefault` flag; [exp]; callers: 0
- frameSlots(context) — maps `frame.parameters` to `FrameSlot`s, expanding pack rest parameters to their concrete tuple elements; [exp]; callers: 0
- declareFrame(context, slots) — allocates parameter/capture registers, runs default prologues and pattern destructuring, and builds pack tuples; [exp]; callers: 0
- mayBeLeftOut(parameter) — tests if a value parameter has a default expression or is an array rest parameter
- enterParameters(context, parameters) — emits default prologues, destructures parameter patterns in order, and emits the `body` marker
- computeLeftOut(context, parameter, register) — emits `given` to skip the default when passed, else evaluates the default and releases its temporaries
- defaultOf(context, parameter) — lowers `parameter`'s default expression in `inDefaults` or emits an empty array for an array rest
- declareArgument(context, parameter) — allocates and declares a parameter's register (named or unnamed for pattern-only parameters); [exp]; callers: 0
- takeApart(context, parameter, register) — binds a parameter pattern's target names from its argument register; [exp]; callers: 0
- declareOwnCall(context) — emits `currentCall` into the hidden variable when an async function's body references its own call; [exp]; callers: 0
- declareFilled(context, name, fill) — allocates and declares `name`'s register and emits the instruction built by `fill`; [exp]; callers: 0

## src/compiler/lowering/functions/frames.ts — Builds `Frame` and `LoweredFunction` descriptors for function instances, built entries, accessors, and closures
- Lowering — pair of `Checker` and `DefinitionTables` passed to entry builders; [exp]; callers: 1
- LoweredFunction — `Lowering` plus `BodyOwner` and instantiated `CheckedBody`; [exp]; callers: 0
- BodyReading — a `BodyOwner` paired with its optional `CheckedBody`; [exp]; callers: 0
- Frame — header, `CodeMode`, parameters, captures, syntax node, result type, and `self` name for a lowered entry; [exp]; callers: 0
- instanceKind(checker, instance) — substitutes an instance's type arguments into its declaration's function mark
- loweredInstance(lowering, instance) — instantiates `instance`'s `CheckedBody` and pairs it with its `BodyOwner`; [exp]; callers: 0
- defaultsReading(checker, instance) — instantiates `instance`'s defaults `CheckedBody` for prologue evaluation; [exp]; callers: 0
- loweredNested(lowering, owner) — resolves `owner`'s instantiated `CheckedBody` stepped through any enclosing field-loop passes; [exp]; callers: 0
- passBody(checker, body, step) — selects the `CheckedBody` for field-loop pass `step`, instantiating the `others` pass if needed; [exp]; callers: 0
- bodyOfOwner(checker, owner) — retrieves the instantiated `CheckedBody` for a function, defaults, constant, or context constant owner
- instanceFrame(lowered, instance, startHeader?) — builds the `Frame` for a top-level function instance; [exp]; callers: 0
- builtFrame(lowering, instance, awaited?) — builds the `Frame` for a body-less entry (struct/variant fields, host extern, extern defaults); [exp]; callers: 0
- accessorFrame(lowering, declaration, result) — builds the `Frame` for a context constant's lazy initializer entry; [exp]; callers: 0
- nestedFrame(lowered, nested, startHeader?) — builds the `Frame` for a lambda or local function from its checked closure facts; [exp]; callers: 0

## src/compiler/lowering/functions/index.ts — Composes `FunctionLowering` (`FunctionContext`) to compile function, built, accessor, nested, and start entries
- StartEdges — per-parameter JSON decoder callbacks and optional `self` closure constant for a host start entry; [exp]; callers: 1
- instanceLowering(lowering, instance, startHeader?) — creates a `FunctionLowering` for a top-level function instance with a body; [exp]; callers: 2
- builtLowering(lowering, instance, awaited?) — creates a `FunctionLowering` for a body-less entry with parameter defaults; [exp]; callers: 0
- accessorLowering(lowering, declaration) — creates a `FunctionLowering` for a context constant's accessor entry; [exp]; callers: 1
- nestedLowering(lowering, nested, startHeader?) — creates a `FunctionLowering` for a lambda or local function instance; [exp]; callers: 2
- FunctionLowering.inFieldPass(header, field, lower) — temporarily switches `#reading` to the pass of `header` visiting `field`
- FunctionLowering.inDefaults(lower) — temporarily switches `#reading` to the function instance's defaults `CheckedBody`
- FunctionLowering.#readingAs(reading, lower) — swaps `this.#reading` for the duration of `lower()`
- FunctionLowering.lower(block) — declares frame variables, lowers `block`, emits `return`, and finishes the `CodeFunction`
- FunctionLowering.lowerBuilt(build) — declares frame variables (running default prologue), emits `build`, and returns its result
- FunctionLowering.lowerAccessor(declaration, name) — emits `contextConstant`, lazy initializer evaluation, `makeContextConstant`, and `return`
- FunctionLowering.lowerNested(node) — declares frame variables, lowers a lambda or local function's body, and emits `return`
- FunctionLowering.lowerStart(edges, body) — decodes JSON start arguments into parameters, binds `self`/`ownCall`, and lowers `body`
- FunctionLowering.expression(node) — lowers an expression (handling `stopsAt` and optional chains) and applies its recorded `Fit`
- FunctionLowering.statement(node) — lowers a statement under its `@Waypoint` annotation if present
- FunctionLowering.#entry(parameters) — finishes `CodeWriter` against the module's tree and assembles the `CodeFunction`
- checkedAt(answer, at, what) — unwraps a checker fact for `at` or throws `unreachable`

## src/compiler/lowering/functions/modes.ts — Computes a lowered entry's `CodeMode` (`'simple' | 'live' | 'ista'`) from its async flag and mark
- codeModeOf(isAsync, kind) — returns `'simple'` when not async, else `persistenceOf(kind) ?? 'live'`; [exp]; callers: 3
- builtKindOf(checker, type) — returns the future mode of `type.result` if it is a `Future`, else `type.mark`; [exp]; callers: 2

## src/compiler/lowering/lower.ts — Entry point that lowers a checked program or test suites into a `Definition` via a reachability worklist
- lower(checker, main) — lowers `main`, all startable functions, and everything they reach into a `Definition`; [exp]; callers: 1
- Suite — a `@Suite` test function declaration paired with its suite title; [exp]; callers: 0
- lowerTests(checker, suites) — lowers test suites and the `testing` module's `_list`/`_run` runners into a `Definition`; [exp]; callers: 1
- lowerReached(checker, tables) — drains `tables.nextPending()`, queueing the job server `_serve` if `runtime.delegate` is reached
- jobDeclarationsOf(checker) — looks up `delegate` and `_serve` in the `runtime` std module when loaded
- pendingEntry(checker, tables, pending) — dispatches a `PendingEntry | ClosingEntry` to its entry builder
- entryOf(checker, tables, instance) — dispatches a `FunctionInstance` by `ownEntryOf` to struct, constructor, codec, host, body, or native
- bodyEntry(lowering, instance) — lowers a function instance's syntax `Block` body via `instanceLowering`
- nativeEntry(lowering, instance) — builds an `ExternFunction` table entry for a std native extern instance
- nestedEntryOf(checker, tables, nested) — lowers a lambda or local function via `nestedLowering`

## src/compiler/lowering/synthesized/boundary/codec-calls.ts — Resolves and closes `Encodable`/`Decodable` codec calls for boundary types
- codecCall(checker, within, type, direction) — returns the closed `write` or `read` codec call for `type`, or throws `unreachable`; [exp]; callers: 0
- foundCodecCall(checker, within, type, direction) — closes `checker.json.codecOf(type, direction)` within `within` if one exists; [exp]; callers: 1

## src/compiler/lowering/synthesized/boundary/codecs.ts — Synthesizes derived `json._toJson<T>` and `json._fromJson<T>` entries from `DerivedForm`
- CodecLowering — `Checker`, `DefinitionTables`, and `FunctionInstance` for a derived codec entry; [exp]; callers: 0
- derivedCodecEntry(lowering, direction) — synthesizes the `CodeFunction` for a derived `_toJson<T>` or `_fromJson<T>` instance; [exp]; callers: 1

## src/compiler/lowering/synthesized/boundary/decoder.ts — Synthesizes the body of `json._fromJson<T>` from `T`'s `DerivedForm`
- Decoder — emits instructions decoding `Json` and `path` into `Result<T>` for a derived `_fromJson<T>` entry; [exp]; callers: 0
- Decoder.read(form) — dispatches on `DerivedForm` (`host`, `record`, `tuple`, `enum`, `literals`) to emit decoding code
- Decoder.#enum(form, json, path) — reads the `$tag` field, branches over variant names to decode fields, or returns `_unknownVariant`
- Decoder.#literals(form, json, path) — tries each base type's decoder and compares against allowed literal values, else calls `_notAmong`
- Decoder.#fields(fields, { object, path }) — decodes each `JsonField` of a struct or enum variant into a name-keyed register map
- Decoder.#field(field, { object, path }) — decodes one field (or calls its `@JsonSkip` default / custom codec) and unwraps `Ok`
- Decoder.#passed(result) — unwraps `Ok` from a `Result` register or returns `Err(error)` from the decoder entry

## src/compiler/lowering/synthesized/boundary/encoder.ts — Synthesizes the body of `json._toJson<T>` from `T`'s `DerivedForm`
- Encoder — emits instructions encoding a value of `T` into the `json.Json` union for a derived `_toJson<T>` entry; [exp]; callers: 0
- Encoder.write(form) — dispatches on `DerivedForm` (`host`, `record`, `tuple`, `enum`, `literals`) to emit encoding code
- Encoder.#literal(type, value) — encodes a literal or union of literals through each member's base type codec
- Encoder.#enum(form, value) — switches on an enum's variant tag and encodes `$tag` plus the variant's fields as a `Json` object
- Encoder.#object(fields, read, before) — encodes non-skipped fields into a `Map<String, Json>` and wraps it into the `Json` union

## src/compiler/lowering/synthesized/boundary/host-externs.ts — Synthesizes JSON-crossing wrappers and native table entries for host externs
- HostCall — descriptor for a host extern wrapper's native target, parameter/result types, future mode, and error path; [exp]; callers: 0
- hostCallOf(lowering, instance) — builds the `HostCall` descriptor for a host extern function instance; [exp]; callers: 1
- hostConstantEntry(lowering, declaration, type) — synthesizes the wrapper entry that calls a host constant's native and decodes JSON; [exp]; callers: 1
- hostNativeEntry(lowering, declaration) — builds the `ExternFunction` entry for a host extern function taking and returning `Json`; [exp]; callers: 1
- constantNativeEntry(lowering, declaration, type) — builds the `ExternFunction` entry for a host extern constant returning `Json`; [exp]; callers: 1
- jsonOf(checker) — resolves the well-known `json.Json` recursive alias type
- nativeParts(lowering, declaration) — builds the common header, `Json` parameter list builder, and `Json`/`Future<Json>` result for a host native
- writeHostCall(context, call, parameters, span) — encodes arguments to `Json`, calls the host native (awaiting if async), and decodes result; [exp]; callers: 1

## src/compiler/lowering/synthesized/boundary/inbound.ts — Emits JSON decoding plus `_hostResult`/`_hostInput` acceptance for inbound host values
- InboundSource — `'result'` (panics on mismatch) or `'input'` (refuses host start on mismatch); [exp]; callers: 0
- Inbound — error path, closed `decode` call, and closed `accept` (`_hostResult`/`_hostInput`) call; [exp]; callers: 0
- inboundOf(checker, within, type, { from, path }) — resolves and closes the decoder and acceptor calls for an inbound JSON value; [exp]; callers: 0
- emitInbound(context, json, inbound, span) — emits the decoder call on `json` and `inbound.path`, followed by the acceptor call; [exp]; callers: 0

## src/compiler/lowering/synthesized/boundary/starts.ts — Discovers startable functions/lambdas and synthesizes their JSON-decoding start entries
- Startable — a startable function or constant lambda with its host key, parameter types, and outcome type; [exp]; callers: 0
- startables(checker) — collects all startable functions and constant lambdas across non-std modules in source order; [exp]; callers: 1
- startableOf(checker, item) — returns a `Startable` if `item` is a startable function or sendable constant lambda with JSON codecs; [exp]; callers: 1
- functionStartable(checker, declaration) — checks `isStartable` and JSON codecs for a top-level `FunctionDeclaration`
- lambdaStartable(checker, declaration) — checks `isStartable` and JSON codecs for a top-level constant holding a sendable lambda
- crossing(checker, startable) — verifies that all parameter types are `Decodable` and the outcome type is `Encodable`
- listStart(lowering, startable) — registers `startable` and its outcome encoder in `DefinitionTables.starts`; [exp]; callers: 1
- startEntry(lowering, startable) — compiles `startable`'s body as a start entry that decodes each `Json` argument via `emitInbound`; [exp]; callers: 1

## src/compiler/lowering/synthesized/index.ts — Builder for syntax-less `CodeFunction` entries (codecs, dispatches, conversions, wrappers)
- Callee — `FunctionId | ClosedCall` accepted by `SynthesizedCode.call`; [exp]; callers: 0
- SynthesizedCode — implements `CodeContext` to build a syntax-less `CodeFunction` with parameters, captures, and cells; [exp]; callers: 6
- SynthesizedCode.call(callee, values) — emits a direct or closed function call at `this.span`
- SynthesizedCode.array(items) — emits an `array` instruction of item registers at `this.span`
- SynthesizedCode.map(entries) — emits a `map` instruction of `[key, value]` register pairs at `this.span`
- SynthesizedCode.passedOn(index, references, path?) — forwards parameter `index` by `&` (if `references[index]`) or by value
- SynthesizedCode.inCell(value, type) — moves `value` into a new `_Cell<T>` register and returns a `&` reference argument to it
- SynthesizedCode.ok(result, type, failed) — unwraps `Ok` payload from a `Result` register or runs `failed(error)` on `Err`
- SynthesizedCode.entry(header, mode, references?) — finishes `CodeWriter` and assembles the `CodeFunction` entry

## src/compiler/lowering/synthesized/trait-objects.ts — Synthesizes closing entries for `any`/union trait dispatch, `any` upcasts, and trait field reads
- dispatchEntry(lowering, dispatch) — synthesizes the closing entry switching over an `any` or union's members to call a trait method; [exp]; callers: 1
- convertedResult(code, result, { met, called }, at) — fits a trait witness's return value from its met instantiation to the called signature
- anyConversionEntry(lowering, from, to) — synthesizes the closing entry converting a value of `any` type `from` into `any` type `to`; [exp]; callers: 1
- anyFieldEntry(lowering, on, required) — synthesizes the closing entry switching over `on`'s members to read and fit a trait field; [exp]; callers: 1
- memberReceiver(code, receiver, { on, type, references }) — extracts or materializes the receiver passed to a member's witness in `dispatchEntry`
- switchOverMembers(code, on, value, write) — emits a `switch` over `on`'s `any` or union variants (or runs once if collapsed)

## src/compiler/lowering/tables/constants.ts — Converts compile-time `ConstantForm`s and annotations into persisted `Value`s and `constant` instructions
- emitConstant(context, value, span) — interns `value` in `DefinitionTables` and emits a `constant` instruction; [exp]; callers: 4
- constantValue(tables, form) — recursively converts a checker `ConstantForm` into a persisted Definition `Value`; [exp]; callers: 4
- annotationValues(tables, annotations) — converts `CheckedAnnotation[]` into persisted `Value[]` for function/field tables; [exp]; callers: 0

## src/compiler/lowering/tables/instances.ts — Models function/nested/deferred/conversion instances, body owners, keys, and Definition names
- NestedInstance — a lambda or local function node paired with its enclosing `BodyOwner`; [exp]; callers: 3
- BodyOwner — owner of a lowered body (function instance, defaults, constant, or context constant, plus field-loop passes); [exp]; callers: 5
- ownerInstance(owner) — returns the `FunctionInstance` of a function or defaults `BodyOwner`, or `undefined` for constants; [exp]; callers: 1
- FieldPassStep — a `FieldHeader` paired with the struct field name visited in one pass; [exp]; callers: 1
- passBindings(passes?) — builds a `Substitution` mapping each `FieldPassStep.header` to its field name's string literal type; [exp]; callers: 1
- ownerDeclaration(owner) — returns the syntax declaration (`FunctionDeclaration | VariableDeclaration | ContextConstantDeclaration`) of `owner`; [exp]; callers: 3
- ownerSubstitution(owner) — combines `owner`'s function instance substitution with its active field-loop `passBindings`; [exp]; callers: 2
- rootInstance(lookup, declaration, written?) — builds a root `FunctionInstance`, defaulting unwritten mark parameters to `"simple"`; [exp]; callers: 4
- AsyncFit — site, owner, plain `FunctionType`, and target async `FunctionType` for an async function fit entry; [exp]; callers: 1
- DeferredFunction — `BodyOwner` and `DeferredPlan` for the synthesized entry of a deferred call; [exp]; callers: 1
- DeferredPlan — plan describing how a deferred call's synthesized entry invokes its target from captured values; [exp]; callers: 3
- ConversionEntry — a `converting` (value rebuild) or `wrapping` (function wrapper) part-conversion entry descriptor; [exp]; callers: 1
- ConversionSite — `ModuleId` and `AnchoredSpan` where a part conversion was first encountered; [exp]; callers: 2
- conversionKey(keys, entry) — returns the interning key for a `ConversionEntry`; [exp]; callers: 0
- conversionName(checker, entry) — spells `"<From> as <To>"` for a `ConversionEntry`'s Definition header; [exp]; callers: 1
- nestedKey(keys, nested) — returns the interning key for a `NestedInstance`; [exp]; callers: 0
- deferredKey(keys, deferred) — returns the interning key for a `DeferredFunction`; [exp]; callers: 0
- asyncFitKey(keys, fit) — returns the interning key for an `AsyncFit`; [exp]; callers: 0
- ownerKey(keys, owner) — builds the canonical key prefix for a `BodyOwner` including its field-loop passes
- nestedName(checker, nested, where) — formats `"<owner>.<name>"` or `"<owner>.lambda@<line>:<col>"` for a nested function; [exp]; callers: 0
- deferredName(checker, deferred, where) — formats `"<owner>.deferred@<line>:<col>"` for a deferred call's entry; [exp]; callers: 0
- asyncFitName(checker, fit, where) — formats `"<owner>.async@<line>:<col>"` for an async fit entry; [exp]; callers: 0
- ownerName(checker, owner) — formats the human-readable Definition name prefix for a `BodyOwner` and its field passes
- instanceKey(keys, instance) — builds the canonical interning key `"<declId><<argKeys>>"` for a `FunctionInstance`; [exp]; callers: 0
- instanceName(checker, instance) — formats the module-qualified Definition name `"mod.fn<Args>"` for a `FunctionInstance`; [exp]; callers: 0

## src/compiler/lowering/tables/names.ts — Spells module-qualified declaration names, extern/start keys, and canonical union/recursive type names
- qualifiedNameOf(checker, declaration) — returns `"module.name"` for any declaration lowering names; [exp]; callers: 2
- nameOf(declaration) — extracts the unqualified name of a function (including `Owner.fn` / fields), constant, or type declaration
- keyOf(checker, declaration, parameters) — builds the canonical host/extern signature key `"module.name(Types)"`; [exp]; callers: 3
- externSpelling(checker) — builds a `Spelling` that prefers the recursive alias written in an extern's signature
- passingOf(parameter) — returns `'reference' | 'rest' | 'value'` for a parameter in an extern key
- spelledType(checker, type) — spells `type` in canonical module-qualified key format (e.g. `prelude.Optional<Int>`); [exp]; callers: 3
- unionName(checker, type) — names a union entry after its recursive alias, `prelude.Optional<T>`, or its members; [exp]; callers: 0
- namedUnionOf(spelling, type) — returns the recursive alias name or `prelude.Optional<T>` for a union if applicable
- recursiveName(checker, type) — names a recursive type entry by its `preferredAlias` or its spelled type text; [exp]; callers: 0
- preferredAlias(checker, type) — selects a deterministic preferred `TypeAliasDeclaration` for a recursive type key across the program
- recursiveAliases(checker) — lists all recursive type aliases in the program sorted by std-first, module name, and alias name
- spelledKeyType(spelling, type) — converts a `LiteralType` or `RecursiveType` into its `KeyType` descriptor
- unionKey(spelling, type) — converts a `UnionType` into a named (`Optional`/recursive alias) or member-list `KeyType`
- structureKeyType(spelling, type) — converts a `TupleType`, `AnonymousStructType`, or `FunctionType` into its `KeyType`
- keyType(spelling, given) — folds `given` and converts any concrete `Type` into a `definition/extern-key` `KeyType`

## src/compiler/lowering/tables/own-entries.ts — Classifies what kind of function-table entry a `FunctionInstance` has
- OwnEntry — discriminated union classifying an instance's entry (`struct`, `constructor`, `hostExtern`, `body`, `native`, `derivedCodec`); [exp]; callers: 0
- ownEntryOf(checker, instance) — classifies how `instance`'s own function-table entry is built; [exp]; callers: 1
- derivedCodecDirection(checker, instance) — returns `'write'` for `json._toJson` or `'read'` for `json._fromJson`, else `undefined`

## src/compiler/lowering/tables/tables.ts — Interns modules, types, constants, functions, starts, and worklist/closing entries into Definition `Tables`
- PendingEntry — union of worklist entry descriptors waiting to be lowered; [exp]; callers: 1
- ClosingEntry — union of `any`/union switching entries (`dispatch`, `anyConversion`, `anyField`) re-emitted as variants grow; [exp]; callers: 1
- HostExternDeclaration — `FunctionDeclaration | ExternConstantDeclaration`; [exp]; callers: 1
- StartTarget — `FunctionDeclaration | ConstantDeclaration` that a host may start; [exp]; callers: 1
- EntryHeader — `Pick<FunctionDefinition, 'name' | 'module' | 'span' | 'annotations'>`; [exp]; callers: 3
- DefinitionTables — interns modules, types, constants, starts, and function worklist/closing entries; [exp]; callers: 8
- DefinitionTables.moduleIndex(module) — interns `module` with its `lineStarts` and returns its module-table index
- DefinitionTables.treeAt(index) — returns the `SyntaxTree` of the module at `index` in the module table
- DefinitionTables.constant(contents) — interns a persisted `Value` by its canonical JSON encoding and returns its constant index
- DefinitionTables.entryHeader(instance) — builds the `EntryHeader` (with lowered annotations) for a `FunctionInstance`
- DefinitionTables.nestedHeader(nested) — builds the `EntryHeader` for a lambda or local function instance
- DefinitionTables.asyncFitHeader(fit) — builds the `EntryHeader` for an `AsyncFit` wrapper entry
- DefinitionTables.deferredHeader(deferred) — builds the `EntryHeader` for a `DeferredFunction` entry
- DefinitionTables.#ownedHeader(owner, at, nameAt) — builds an `EntryHeader` with `line:col`-formatted name in `owner`'s module
- DefinitionTables.declarationHeader(declaration) — builds the `EntryHeader` for a whole declaration (host extern, start, context const)
- DefinitionTables.headerAt(name, module, at) — resolves `at` in `module`'s tree and builds an `EntryHeader` with empty annotations
- DefinitionTables.callIndex(call) — returns the `FunctionId` for a `ClosedCall` (using `leavingOutIndex` when defaults are omitted)
- DefinitionTables.dispatchIndex(dispatch) — interns and queues a closing `dispatch` entry for `dispatch`
- DefinitionTables.anyConversionIndex(from, to) — interns and queues a closing `anyConversion` entry from `from` to `to`
- DefinitionTables.anyFieldIndex(on, required) — interns and queues a closing `anyField` entry for `required` on `on`
- DefinitionTables.functionIndex(instance) — interns and queues `instance`'s own function-table entry
- DefinitionTables.leavingOutIndex(instance) — returns `functionIndex(instance)`, or queues an `externDefaults` entry for a std native extern
- DefinitionTables.asyncFitIndex(fit) — interns and queues an `asyncFit` entry
- DefinitionTables.deferredIndex(deferred) — interns and queues a `deferred` call entry
- DefinitionTables.conversionIndex(entry) — interns and queues a `converting` or `wrapping` part-conversion entry
- DefinitionTables.nestedIndex(nested) — interns and queues a `nested` lambda/local-function entry
- DefinitionTables.hostNativeIndex(declaration) — interns and queues a `hostNative` entry for a host extern function
- DefinitionTables.constantNativeIndex(declaration, type) — interns and queues a `constantNative` entry for a host extern constant
- DefinitionTables.contextConstantIndex(declaration) — interns and queues a `contextConstant` accessor entry
- DefinitionTables.externConstantIndex(declaration, type) — interns and queues an `externConstant` wrapper entry
- DefinitionTables.startIndex(target, key, encoder) — interns and queues a `start` entry and records it in `starts`
- DefinitionTables.nextPending() — shifts the next worklist entry, or returns a closing entry whose variant count grew
- DefinitionTables.#nextStale() — finds a closing entry whose `any` type gained variants since it was last written
- DefinitionTables.#variantsOf(given) — returns the current number of variants a closing entry over `given` switches on
- DefinitionTables.#numbered(key, queue) — allocates a `FunctionId` slot on first sight of `key` and invokes `queue(index)`
- DefinitionTables.define(index, entry) — stores the lowered `FunctionDefinition` at `index`
- DefinitionTables.finish(main, jobServer) — verifies all queued functions were defined and returns the finished `Tables`
- closedOver(entry) — returns the `AnyType` or `UnionType` whose variants a `ClosingEntry` switches over

## src/compiler/lowering/tables/type-table.ts — Interns concrete `TypeDefinition` entries and `TypeReference`s, laying out unions and `any` as enums
- TypeTableSeams — callbacks into `DefinitionTables` for function indices, call indices, host natives, and annotation values; [exp]; callers: 0
- anyEnum(entry) — converts a mutable `AnyEntry` into its final `enum` `TypeDefinition` with one variant per member type
- TypeTable — interns concrete types, unions, recursive aliases, and open `any` enums into `TypeDefinition` entries; [exp]; callers: 0
- TypeTable.reference(type) — builds the `TypeReference` for `type`, folding recursive tuples/functions to alias entries
- TypeTable.index(type) — returns the interned `TypeId` for a nominal, anonymous struct, or union type
- TypeTable.unionMembers(type) — returns a union's member types sorted by their canonical `spelledType` name
- TypeTable.unionVariant(type, member) — returns the variant index of `member` in `type`'s sorted union enum
- TypeTable.anyIndex(type) — interns an `AnyType` as a growable `AnyEntry` and returns its `TypeId`
- TypeTable.anyVariant(type, member) — returns (or appends) the variant index for `member` in `type`'s `AnyEntry`
- TypeTable.anyMembers(type) — returns the member types converted into `type` so far, in variant order
- TypeTable.#anyEntry(type) — looks up the `AnyEntry` for `type` in `#entries`
- TypeTable.#typeEntry(type) — reserves a `TypeId` slot before computing `#layout(type)` so recursive types can self-reference
- TypeTable.#aliasEntry(type, unfolded) — reserves a `TypeId` slot and builds an `alias` `TypeDefinition` for a recursive tuple/function
- TypeTable.#layout(type) — builds the `struct`, `enum`, or `extern` `TypeDefinition` for `type` with roles, disposal, and `counted`
- TypeTable.#unionLayout(type) — builds the `enum` `TypeDefinition` for a `UnionType` (marking `role: 'json'` for `json.Json`)
- TypeTable.#roleOf(roles, declaration) — matches `declaration` against well-known `externRoles` or `enumRoles`
- TypeTable.#outcomeEncoder(instance) — resolves the outcome JSON encoder `FunctionId` for an `Instance<T>` extern type entry
- TypeTable.#disposal(disposal) — converts a checker `Disposal` into a Definition extern `disposal` descriptor
- TypeTable.#fields(fields) — converts `FieldMember[]` into Definition field descriptors with lowered field annotations

## src/compiler/lowering/values/holdings.ts — Derives where a member value sits inside a union or `any` type after generic instantiation
- TypedValue — a `Register` paired with its concrete `Type`; [exp]; callers: 4
- Holding — describes which union `variant` and/or absorbing `inAny` member holds a value inside a holder type; [exp]; callers: 0
- laidOutAs(type) — unfolds a top-level `RecursiveType` to the type its values are laid out as; [exp]; callers: 2
- holdingOf(context, given, member) — derives how `given` holds a value of `member` (direct variant, literal base, or absorbed into `any`); [exp]; callers: 1
- heldPositions(holder, holding) — returns the `[0]` / `[0, 0]` field path from `holder` down to a held value; [exp]; callers: 1
- HeldValue — a `member` type paired with a lazy `inside()` register producer; [exp]; callers: 0
- heldIn(context, { member, inside }, given, span) — wraps `inside()` into `given`'s union variant and/or `any` variant as `holdingOf` dictates; [exp]; callers: 0
- IntoAny — value register, concrete `from` type, and target `AnyType`; [exp]; callers: 0
- heldInAny(context, { value, from, to }, span) — emits a `variant` instruction wrapping `value` into `to`'s `any` enum for `baseOf(from)`; [exp]; callers: 0
- branchOnHeld(context, { value, members }, { matched, otherwise }, span) — emits `switch`(es) testing if `value` holds any of `members`; [exp]; callers: 1
- branchOnAnyVariants(context, { value, members }, { matched, otherwise }, span) — emits a `switch` on an `any` value for `members`' variants
- jumpIfHeld(context, { value, member }, to, span) — jumps to `to` when `value` holds `member`, else falls through; [exp]; callers: 0
- memberValue(context, { union, member, fields }, span) — emits a `variant` instruction for `member`'s variant in `union`; [exp]; callers: 0

## src/compiler/lowering/values/into-any.ts — Converts concrete, union, or `any` values into an `AnyType` enum variant
- convertedIntoAny(context, { value, from, to }, span) — converts `value` of `from` into `to` via `anyConversionIndex`, `eachMember`, or `heldInAny`; [exp]; callers: 2

## src/compiler/lowering/values/keyed-fields.ts — Reads and writes struct fields dynamically indexed by a multi-literal key union `s[k]`
- KeyedField — struct type `on` paired with the `TypedValue` of a key union; [exp]; callers: 1
- readKeyed(context, { keyed, result }, readAt, span) — switches over `keyed.key`'s literal members to read each field into `result`; [exp]; callers: 1
- writeKeyed(context, { keyed, value, site }, writeAt) — switches over `keyed.key`'s literal members, fitting and writing `value` to each field; [exp]; callers: 1
- fittedInto(context, value, type, site) — fits `value` into a concrete keyed field's `type` at `site`; [exp]; callers: 1
- lowerKeyRead(context, container, key, node) — lowers `s[k]` as a static field read when collapsed to one key, or via `readKeyed`; [exp]; callers: 1
- eachKeyedField(context, { on, key }, span, visit) — switches on `key`'s union variants and calls `visit(field, position)` for each; [exp]; callers: 1

## src/compiler/lowering/values/optionals.ts — Lowers `none`, `T?` wrapping/unwrapping, and short-circuiting optional chains `?.` / `?->`
- OptionalRead — register, optional `type`, and unwrapped target type `to`; [exp]; callers: 0
- noneOf(context, type, span) — emits `none` as a value of `type` (union `None` variant, `null`, or absorbed into `any`); [exp]; callers: 2
- someOf(context, optional, value, span) — wraps `value` into `optional` via `intoUnion` unless already of `optional`; [exp]; callers: 1
- presentOrJump(context, read, absent, span) — jumps to `absent` if `read` is `none`, else unwraps it as `read.to` via `outOfUnion`
- presentOr(context, read, absent, span) — unwraps `read` when non-`none` or runs `absent()` on `none`; [exp]; callers: 1
- optionalType(given) — unfolds `given` and narrows it to `UnionType | AnyType`
- OptionalChains — lowers optional chains (`a?.b`, `a?.()`, `a?->b`), jumping to the chain's end on `none`; [exp]; callers: 2
- OptionalChains.lower(context, link) — lowers the outermost link of an optional chain, wrapping its result with `someOf` or `noneOf`
- OptionalChains.target(context, link) — lowers a chain step's target, unwrapping with `presentOrJump` on `?.`/`?->` and applying its `Fit`

## src/compiler/lowering/values/struct-values.ts — Constructs structs by field name in canonical name order and wraps shared structs in cells
- structValue(context, type, named, span) — constructs a struct in name order, wrapping it in a `newCell` if `type` is a shared struct; [exp]; callers: 2
- construct(context, type, named, span) — lays out `named` field registers in `fieldsOf(type)` name order and emits `struct`; [exp]; callers: 4
- rebuiltAs(context, value, { from, to }, span) — reads `to`'s fields by name from `value` (of type `from`) and constructs `to`; [exp]; callers: 2

## src/compiler/lowering/values/unions.ts — Puts values into unions, extracts narrowed members/sub-unions, and switches over union variants
- UnionValue — register and `UnionType` for a union value; [exp]; callers: 0
- oneValueIn(context, holder, member, span) — emits the single value of `member` (a literal or `None`) held inside `holder`; [exp]; callers: 1
- intoUnion(context, value, union, span) — puts `value` into `union` (or an absorbing `AnyType`), remapping union-to-union variant by variant; [exp]; callers: 2
- outOfUnion(context, value, given, span) — extracts `given` (a member or sub-union) from `value`, handling collapsed unions and `any` absorption; [exp]; callers: 2
- outOfAny(context, value, to, span) — extracts a sub-union `to` from an `AnyType` that absorbed all of `to`'s members
- asBase(context, value, span) — converts a literal or union-of-literals value to its base primitive value; [exp]; callers: 1
- oneValueOf(member) — returns the runtime `Value` of a single-value type (a literal's value or `null` for `None`)
- literalValue(type) — returns the runtime primitive `Value` of a `LiteralType`; [exp]; callers: 1
- remapped(context, value, to, span) — switches over `value`'s union variants to re-wrap each reachable member into union `to`
- literalIn(context, value, to, span) — compares a base primitive `value` against `to`'s literal members and builds the matching variant
- eachMember(context, value, span, each) — switches over `value`'s union variants, unwrapping each member and moving `each(member)` into one register; [exp]; callers: 2
- eachVariant(context, value, span, cases) — switches over reachable union variants and moves each case's register into a result register
- onEachMember(context, value, span, cases) — emits a `switch` over `value`'s union variants, running `each(member)` in each kept branch; [exp]; callers: 0

## src/compiler/lowering/values/variant-values.ts — Emits enum `variant` instructions by variant name or constructor instance
- VariantValue — nominal enum `type`, variant `name`, and positional `fields` registers; [exp]; callers: 0
- buildVariant(context, value, span, dst?) — resolves `value.name` to its variant index and emits a `variant` instruction; [exp]; callers: 4
- variantIndexOf(checker, type, name) — finds the declaration-order index of variant `name` in `type`; [exp]; callers: 1
- ConstructorCall — variant constructor `FunctionInstance` and field registers; [exp]; callers: 0
- buildConstructed(context, call, span, dst?) — substitutes the constructor's enum return type and emits its `variant`; [exp]; callers: 2

## Concept footprint

- **Optional / `None` / `?` / `!` / `??` / optional chains**: `constructs/expressions/access/optionals.ts:lowerUnwrap`, `constructs/expressions/access/optionals.ts:lowerNullish`, `constructs/expressions/calls.ts:receiverOf`, `constructs/expressions/calls.ts:valueCallee`, `constructs/expressions/collections/collections.ts:optionalInt`, `constructs/expressions/expressions.ts:expressionHandlers`, `constructs/expressions/operators.ts:lowerBinary`, `constructs/parts/places.ts:sharedAccessor`, `functions/index.ts:FunctionLowering.expression`, `synthesized/boundary/decoder.ts:Decoder.#field`, `tables/names.ts:unionName`, `tables/names.ts:namedUnionOf`, `tables/names.ts:optionalOfOne`, `values/holdings.ts:heldIn`, `values/optionals.ts:noneOf`, `values/optionals.ts:someOf`, `values/optionals.ts:presentOrJump`, `values/optionals.ts:presentOr`, `values/optionals.ts:optionalType`, `values/optionals.ts:OptionalChains.lower`, `values/optionals.ts:OptionalChains.target`, `values/unions.ts:oneValueIn`, `values/unions.ts:oneValueOf`
- **`Result` / `Ok` / `Err` / `?` propagation**: `constructs/expressions/control/propagate.ts:lowerPropagate`, `constructs/expressions/control/propagate.ts:errorOf`, `constructs/expressions/control/propagate.ts:returnedError`, `synthesized/boundary/codecs.ts:bodyWriters`, `synthesized/boundary/decoder.ts:Decoder.read`, `synthesized/boundary/decoder.ts:Decoder.#enum`, `synthesized/boundary/decoder.ts:Decoder.#literals`, `synthesized/boundary/decoder.ts:Decoder.#passed`, `synthesized/boundary/decoder.ts:Decoder.#ok`, `synthesized/index.ts:SynthesizedCode.ok`
- **Unions & literal types (including instantiation collapse/absorption)**: `constructs/parts/part-paths.ts:positionsOf`, `constructs/parts/patterns.ts:lowerMemberTest`, `constructs/parts/patterns.ts:heldOrJump`, `constructs/parts/patterns.ts:bind`, `functions/fits/index.ts:appliedFit`, `functions/fits/index.ts:convertedValue`, `functions/fits/index.ts:baseOfAll`, `functions/fits/parts.ts:fitChangesLayout`, `functions/fits/parts.ts:pairsOf`, `functions/fits/parts.ts:rebuilt`, `synthesized/boundary/decoder.ts:Decoder.#literals`, `synthesized/boundary/encoder.ts:Encoder.#literal`, `synthesized/boundary/encoder.ts:Encoder.#member`, `synthesized/trait-objects.ts:dispatchEntry`, `synthesized/trait-objects.ts:memberReceiver`, `synthesized/trait-objects.ts:switchOverMembers`, `tables/constants.ts:constantValue`, `tables/names.ts:unionName`, `tables/names.ts:namedUnionOf`, `tables/names.ts:spelledKeyType`, `tables/names.ts:unionKey`, `tables/tables.ts:DefinitionTables.#variantsOf`, `tables/tables.ts:closedOver`, `tables/type-table.ts:TypeTable.reference`, `tables/type-table.ts:TypeTable.unionMembers`, `tables/type-table.ts:TypeTable.unionVariant`, `tables/type-table.ts:TypeTable.#unionLayout`, `values/holdings.ts:holdingOf`, `values/holdings.ts:heldPositions`, `values/holdings.ts:heldIn`, `values/holdings.ts:branchOnHeld`, `values/holdings.ts:jumpIfHeld`, `values/holdings.ts:memberValue`, `values/into-any.ts:convertedIntoAny`, `values/unions.ts:oneValueIn`, `values/unions.ts:intoUnion`, `values/unions.ts:outOfUnion`, `values/unions.ts:outOfAny`, `values/unions.ts:asBase`, `values/unions.ts:oneValueOf`, `values/unions.ts:literalValue`, `values/unions.ts:remapped`, `values/unions.ts:literalsOf`, `values/unions.ts:literalIn`, `values/unions.ts:eachMember`, `values/unions.ts:eachVariant`, `values/unions.ts:onEachMember`
- **Enums & variants (including constructors & `Variant()`)**: `calls/emit-call.ts:emitFunctionCall`, `constructs/expressions/access/names.ts:lowerNamed`, `constructs/expressions/calls.ts:lowerCall`, `constructs/expressions/structs/variants.ts:lowerFieldlessVariant`, `constructs/expressions/structs/variants.ts:fieldlessVariantCalled`, `constructs/expressions/structs/variants.ts:variantTestOf`, `constructs/expressions/structs/variants.ts:branchOnVariant`, `constructs/expressions/structs/variants.ts:payloadOf`, `constructs/expressions/structs/variants.ts:payloadOr`, `constructs/expressions/structs/variants.ts:isEnum`, `constructs/expressions/structs/variants.ts:emitVariant`, `constructs/parts/patterns.ts:lowerTest`, `functions/built-entries.ts:constructorEntry`, `functions/fits/parts.ts:rebuiltNominal`, `functions/fits/parts.ts:rebuiltVariant`, `lower.ts:entryOf`, `synthesized/boundary/decoder.ts:Decoder.#enum`, `synthesized/boundary/encoder.ts:Encoder.#enum`, `synthesized/index.ts:SynthesizedCode.variant`, `tables/own-entries.ts:ownEntryOf`, `tables/type-table.ts:TypeTable.#layout`, `values/variant-values.ts:buildVariant`, `values/variant-values.ts:variantIndexOf`, `values/variant-values.ts:buildConstructed`
- **`any` / trait objects & witnesses (including union trait dispatch & variance conversions)**: `calls/closed-calls.ts:closeCallWithin`, `calls/closed-calls.ts:calledParameters`, `calls/closed-calls.ts:resultOfCall`, `calls/closed-calls.ts:substitutionOfCall`, `calls/closed-calls.ts:dispatchSubstitution`, `calls/closed-calls.ts:closedCall`, `calls/closed-calls.ts:closeWitness`, `calls/emit-call.ts:emitFunctionCall`, `calls/emit-call.ts:boundParameters`, `constructs/expressions/structs/structs.ts:lowerFieldRead`, `constructs/parts/part-paths.ts:positionsOf`, `constructs/parts/patterns.ts:lowerTest`, `functions/fits/index.ts:convertedValue`, `lower.ts:pendingEntry`, `synthesized/trait-objects.ts:dispatchEntry`, `synthesized/trait-objects.ts:convertedResult`, `synthesized/trait-objects.ts:anyConversionEntry`, `synthesized/trait-objects.ts:anyFieldEntry`, `synthesized/trait-objects.ts:memberReceiver`, `synthesized/trait-objects.ts:switchOverMembers`, `tables/names.ts:keyType`, `tables/tables.ts:DefinitionTables.callIndex`, `tables/tables.ts:DefinitionTables.dispatchIndex`, `tables/tables.ts:DefinitionTables.anyConversionIndex`, `tables/tables.ts:DefinitionTables.anyFieldIndex`, `tables/tables.ts:DefinitionTables.#nextStale`, `tables/tables.ts:DefinitionTables.#variantsOf`, `tables/tables.ts:closedOver`, `tables/type-table.ts:anyEnum`, `tables/type-table.ts:TypeTable.reference`, `tables/type-table.ts:TypeTable.anyIndex`, `tables/type-table.ts:TypeTable.anyVariant`, `tables/type-table.ts:TypeTable.anyMembers`, `values/holdings.ts:holdingOf`, `values/holdings.ts:heldPositions`, `values/holdings.ts:heldIn`, `values/holdings.ts:heldInAny`, `values/holdings.ts:branchOnHeld`, `values/holdings.ts:branchOnAnyVariants`, `values/into-any.ts:convertedIntoAny`, `values/unions.ts:intoUnion`, `values/unions.ts:outOfUnion`, `values/unions.ts:outOfAny`
- **Futures / `await` / `select` / `Awaitable` / `Resolver` / `@Waypoint`**: `calls/waits.ts:openWait`, `calls/waits.ts:awaitWait`, `calls/waits.ts:awaitFuture`, `constructs/expressions/control/await.ts:lowerAwait`, `constructs/expressions/control/await.ts:awaitedAt`, `constructs/expressions/control/select.ts:lowerSelect`, `constructs/expressions/control/select.ts:caseCode`, `functions/built-entries.ts:hostExternEntry`, `functions/code-writer.ts:CodeWriter.withWaypoint`, `functions/code-writer.ts:CodeWriter.wait`, `functions/code-writer.ts:CodeWriter.resolver`, `functions/code-writer.ts:CodeWriter.await`, `functions/code-writer.ts:CodeWriter.select`, `functions/fits/index.ts:convertedValue`, `functions/fits/index.ts:wrappingEntry`, `functions/fits/index.ts:returnedAs`, `functions/fits/index.ts:asyncFitClosure`, `functions/fits/index.ts:asyncFitEntry`, `functions/fits/parts.ts:pairsOf`, `functions/frame-variables.ts:declareOwnCall`, `functions/frames.ts:instanceFrame`, `functions/frames.ts:builtFrame`, `functions/frames.ts:nestedFrame`, `functions/index.ts:FunctionLowering.statement`, `functions/modes.ts:codeModeOf`, `functions/modes.ts:builtKindOf`, `synthesized/boundary/host-externs.ts:hostCallOf`, `synthesized/boundary/host-externs.ts:nativeParts`, `synthesized/boundary/host-externs.ts:writeHostCall`, `synthesized/boundary/starts.ts:functionStartable`, `synthesized/boundary/starts.ts:lambdaStartable`, `synthesized/index.ts:SynthesizedCode.await`, `synthesized/trait-objects.ts:dispatchEntry`, `tables/type-table.ts:externRoles`
- **Marks / code kinds (`simple` / `live` / `ista`) & sendability**: `constructs/expressions/deferred-calls.ts:deferredEntry`, `functions/fits/index.ts:convertingEntry`, `functions/fits/index.ts:wrappingEntry`, `functions/fits/index.ts:asyncFitEntry`, `functions/frame-variables.ts:declareOwnCall`, `functions/frames.ts:instanceKind`, `functions/frames.ts:instanceFrame`, `functions/frames.ts:builtFrame`, `functions/frames.ts:accessorFrame`, `functions/frames.ts:nestedFrame`, `functions/modes.ts:codeModeOf`, `functions/modes.ts:builtKindOf`, `synthesized/boundary/starts.ts:lambdaStartable`, `synthesized/trait-objects.ts:dispatchEntry`, `tables/instances.ts:rootInstance`, `tables/names.ts:structureKeyType`
- **Shared structs & cells (`new S{...}`, `*x`, `x->f`, `_Cell<T>`)**: `constructs/expressions/closures.ts:closureOf`, `constructs/expressions/collections/collections.ts:lowerDeclaredLiteral`, `constructs/expressions/structs/structs.ts:lowerNewStructLiteral`, `constructs/parts/places.ts:enterReferenced`, `constructs/parts/places.ts:cellRegister`, `constructs/parts/places.ts: locate`, `constructs/parts/places.ts:changeAt`, `constructs/parts/places.ts:lowerDereference`, `constructs/parts/places.ts:sharedAccessor`, `constructs/parts/places.ts:cellTypeIndex`, `constructs/statements/variables.ts:VariableRegisters.addCell`, `constructs/statements/variables.ts:declareVariable`, `constructs/statements/variables.ts:copied`, `functions/index.ts:FunctionLowering.#entry`, `synthesized/index.ts:SynthesizedCode.inCell`, `synthesized/index.ts:SynthesizedCode.entry`, `tables/type-table.ts:externRoles`, `tables/type-table.ts:TypeTable.#layout`, `values/struct-values.ts:structValue`
- **Extern functions, extern constants, extern types & host boundary**: `calls/emit-call.ts:emitFunctionCall`, `constructs/expressions/access/names.ts:lowerNamed`, `functions/built-entries.ts:hostExternEntry`, `functions/built-entries.ts:externDefaultsEntry`, `functions/fits/parts.ts:rebuiltNominal`, `lower.ts:pendingEntry`, `lower.ts:entryOf`, `lower.ts:nativeEntry`, `synthesized/boundary/ decoder.ts:Decoder.read`, `synthesized/boundary/encoder.ts:Encoder.write`, `synthesized/boundary/host-externs.ts:hostCallOf`, `synthesized/boundary/host-externs.ts:hostConstantEntry`, `synthesized/boundary/host-externs.ts:hostNativeEntry`, `synthesized/boundary/host-externs.ts:constantNativeEntry`, `synthesized/boundary/host-externs.ts:nativeParts`, `synthesized/boundary/host-externs.ts:writeHostCall`, `synthesized/boundary/inbound.ts:inboundOf`, `synthesized/boundary/inbound.ts:emitInbound`, `tables/names.ts:keyOf`, `tables/names.ts:externSpelling`, `tables/own-entries.ts:ownEntryOf`, `tables/tables.ts:DefinitionTables.leavingOutIndex`, `tables/tables.ts:DefinitionTables.hostNativeIndex`, `tables/tables.ts:DefinitionTables.constantNativeIndex`, `tables/tables.ts:DefinitionTables.externConstantIndex`, `tables/type-table.ts:externRoles`, `tables/type-table.ts:TypeTable.#layout`, `tables/type-table.ts:TypeTable.#disposal`
- **Field loops & field comprehensions (`for k, v of s`)**: `constructs/expressions/collections/comprehensions.ts:lowerFieldComprehension`, `constructs/expressions/structs/structs.ts:literalFields`, `constructs/expressions/structs/structs.ts:comprehendedFields`, `constructs/loops/field-passes.ts:fieldsVisited`, `constructs/loops/field-passes.ts:inFieldScope`, `constructs/loops/field-passes.ts:valueInFieldScope`, `constructs/loops/field-passes.ts:inFieldPassOf`, `constructs/loops/field-passes.ts:bindField`, `constructs/statements/loops.ts:lowerFieldLoop`, `functions/frames.ts:loweredNested`, `functions/frames.ts:passBody`, `functions/index.ts:FunctionLowering.inFieldPass`, `tables/instances.ts:passBindings`, `tables/instances.ts:ownerSubstitution`, `tables/instances.ts:ownerKey`, `tables/instances.ts:ownerName`
- **Comprehensions & cursor iteration (`for x in c`, spreads, `iterate`, `Step`)**: `calls/emit-call.ts:restParameters`, `constructs/expressions/calls.ts:passedArguments`, `constructs/expressions/collections/collections.ts:arrayOf`, `constructs/expressions/collections/collections.ts:lowerMapLiteral`, `constructs/expressions/collections/collections.ts:built`, `constructs/expressions/collections/collections.ts:spreadArray`, `constructs/expressions/collections/collections.ts:fittedItem`, `constructs/expressions/collections/collections.ts:lowerDeclaredLiteral`, `constructs/expressions/collections/comprehensions.ts:lowerComprehension`, `constructs/loops/iteration.ts:cursorOf`, `constructs/loops/iteration.ts:emitLoop`, `constructs/loops/iteration.ts:emitLoopOver`, `constructs/loops/iteration.ts:iterationFormOf`, `constructs/statements/loops.ts:lowerFor`
- **Deferred calls (`g f(args)`)**: `constructs/expressions/calls.ts:preparedCall`, `constructs/expressions/calls.ts:valueArguments`, `constructs/expressions/deferred-calls.ts:lowerDeferredCall`, `constructs/expressions/deferred-calls.ts:deferredFunction`, `constructs/expressions/deferred-calls.ts:isMade`, `constructs/expressions/deferred-calls.ts:computedNow`, `constructs/expressions/deferred-calls.ts:deferredEntry`, `constructs/expressions/deferred-calls.ts:madeCall`, `functions/index.ts:FunctionLowering.deferredIndex`, `lower.ts:pendingEntry`, `tables/instances.ts:deferredKey`, `tables/instances.ts:deferredName`, `tables/tables.ts:DefinitionTables.deferredHeader`, `tables/tables.ts:DefinitionTables.deferredIndex`
- **`spawn` / `Instance<T>` / `delegate` / job server**: `lower.ts:lowerReached`, `lower.ts:jobDeclarationsOf`, `tables/tables.ts:DefinitionTables.finish`, `tables/type-table.ts:externRoles`, `tables/type-table.ts:TypeTable.#layout`, `tables/type-table.ts:TypeTable.#outcomeEncoder`
- **Context constants (`ista const`)**: `constructs/expressions/access/names.ts:lowerNamed`, `functions/code-writer.ts:CodeWriter.contextConstant`, `functions/frame-variables.ts:declareOwnCall`, `functions/frames.ts:bodyOfOwner`, `functions/frames.ts:accessorFrame`, `functions/index.ts:accessorLowering`, `functions/index.ts:FunctionLowering.lowerAccessor`, `lower.ts:pendingEntry`, `tables/instances.ts:ownerInstance`, `tables/instances.ts:ownerDeclaration`, `tables/instances.ts:ownerKey`, `tables/instances.ts:ownerName`, `tables/tables.ts:DefinitionTables.contextConstantIndex`
- **Disposal, lifetimes, `hold`, `drop`, and temporary release**: `calls/waits.ts:openWait`, `constructs/expressions/control/matching.ts:lowerMatch`, `constructs/expressions/control/select.ts:lowerSelect`, `constructs/statements/holds.ts:HoldScopes.listOf`, `constructs/statements/holds.ts:HoldScopes.lowerScope`, `constructs/statements/holds.ts:HoldScopes.#functionList`, `constructs/statements/loops.ts:lowerWhile`, `constructs/statements/loops.ts:lowerFor`, `constructs/statements/loops.ts:lowerFieldLoop`, `constructs/statements/loops.ts:lowerLabelledBlock`, `constructs/statements/loops.ts:lowerLoopExit`, `constructs/statements/scopes.ts:endScope`, `constructs/statements/scopes.ts:valueInBlock`, `constructs/statements/scopes.ts:headerTemporaries`, `constructs/statements/scopes.ts:lowerGuarded`, `constructs/statements/scopes.ts:release`, `constructs/statements/statements.ts:lowerStatement`, `constructs/statements/statements.ts:lowerBlock`, `constructs/statements/statements.ts:lowerDrop`, `constructs/statements/variables.ts:VariableRegisters`, `constructs/statements/variables.ts:lowerVariableDeclaration`, `constructs/statements/variables.ts:lifetimeOf`, `constructs/statements/variables.ts:bindTargets`, `constructs/statements/variables.ts:lowerAssignment`, `functions/frame-variables.ts:computeLeftOut`, `tables/type-table.ts:TypeTable.#layout`, `tables/type-table.ts:TypeTable.#disposal`
- **Recursive types & recursive aliases**: `functions/fits/parts.ts:changesLayout`, `functions/fits/parts.ts:rebuilt`, `synthesized/boundary/encoder.ts:Encoder.constructor`, `tables/names.ts:externSpelling`, `tables/names.ts:tableSpelling`, `tables/names.ts:namedUnionOf`, `tables/names.ts:recursiveName`, `tables/names.ts:preferredAlias`, `tables/names.ts:recursiveAliases`, `tables/names.ts:spelledKeyType`, `tables/names.ts:keyType`, `tables/type-table.ts:TypeTable.reference`, `tables/type-table.ts:TypeTable.#typeEntry`, `tables/type-table.ts:TypeTable.#aliasEntry`, `values/holdings.ts:laidOutAs`
- **Struct keys (`keyof` / `s[k]` dynamic key unions)**: `constructs/expressions/collections/collections.ts:lowerIndex`, `constructs/expressions/structs/structs.ts:lowerFieldRead`, `constructs/parts/places.ts:enterAssigned`, `constructs/parts/places.ts:enterReferenced`, `constructs/parts/places.ts:stepped`, `constructs/parts/places.ts:withFields`, `constructs/parts/places.ts:pastField`, `constructs/parts/places.ts:readAt`, `constructs/parts/places.ts:changeAt`, `values/keyed-fields.ts:readKeyed`, `values/keyed-fields.ts:writeKeyed`, `values/keyed-fields.ts:fittedInto`, `values/keyed-fields.ts:lowerKeyRead`, `values/keyed-fields.ts:eachKeyedField`
- **Variance & part-by-part conversions (including anonymous shapes & single-element tuples)**: `functions/fits/index.ts:fittedValue`, `functions/fits/index.ts:convertedValue`, `functions/fits/index.ts:partsConverted`, `functions/fits/index.ts:fittedIn`, `functions/fits/index.ts:rebuildingIn`, `functions/fits/index.ts:convertingEntry`, `functions/fits/index.ts:wrappingEntry`, `functions/fits/index.ts:returnedAs`, `functions/fits/parts.ts:changesLayout`, `functions/fits/parts.ts:fitChangesLayout`, `functions/fits/parts.ts:pairsOf`, `functions/fits/parts.ts:rebuilt`, `functions/fits/parts.ts:rebuiltTuple`, `functions/fits/parts.ts:rebuiltStruct`, `functions/fits/parts.ts:rebuiltNominal`, `functions/fits/parts.ts:mappedWith`, `functions/fits/parts.ts:rebuiltVariant`, `synthesized/trait-objects.ts:dispatchEntry`, `synthesized/trait-objects.ts:convertedResult`, `synthesized/trait-objects.ts:anyFieldEntry`, `values/struct-values.ts:rebuiltAs`
- **Type packs (`...P`)**: `calls/emit-call.ts:restParameters`, `calls/packs.ts:packElements`, `calls/packs.ts:packElementsOf`, `constructs/expressions/calls.ts:passedArguments`, `constructs/expressions/calls.ts:valueArguments`, `functions/frame-variables.ts:frameSlots`, `functions/frame-variables.ts:declareFrame`
- **Indented values**: `constructs/expressions/expressions.ts:expressionHandlers`
- **Default parameters & struct/variant fields functions**: `calls/closed-calls.ts:leavesOut`, `calls/emit-call.ts:emitFunctionCall`, `calls/emit-call.ts:boundParameters`, `constructs/expressions/structs/structs.ts:literalValue`, `constructs/expressions/structs/structs.ts:literalFields`, `functions/built-entries.ts:constructorEntry`, `functions/built-entries.ts:structEntry`, `functions/built-entries.ts:hostExternEntry`, `functions/built-entries.ts:externDefaultsEntry`, `functions/code-writer.ts:CodeWriter.given`, `functions/frame-variables.ts:declareFrame`, `functions/frame-variables.ts:mayBeLeftOut`, `functions/frame-variables.ts:enterParameters`, `functions/frame-variables.ts:computeLeftOut`, `functions/frame-variables.ts:defaultOf`, `functions/frames.ts:defaultsReading`, `functions/frames.ts:bodyOfOwner`, `functions/index.ts:FunctionLowering.inDefaults`, `lower.ts:pendingEntry`, `lower.ts:entryOf`, `tables/own-entries.ts:ownEntryOf`, `tables/tables.ts:DefinitionTables.callIndex`, `tables/tables.ts:DefinitionTables.leavingOutIndex`
- **JSON & derived codecs (`@JsonName`, `@JsonSkip`, `@JsonBigInt`)**: `lower.ts:entryOf`, `synthesized/boundary/codec-calls.ts:codecCall`, `synthesized/boundary/codec-calls.ts:foundCodecCall`, `synthesized/boundary/codecs.ts:derivedCodecEntry`, `synthesized/boundary/decoder.ts:Decoder`, `synthesized/boundary/encoder.ts:Encoder`, `synthesized/boundary/host-externs.ts:jsonOf`, `synthesized/boundary/host-externs.ts:nativeParts`, `synthesized/boundary/host-externs.ts:writeHostCall`, `synthesized/boundary/inbound.ts:inboundOf`, `synthesized/boundary/inbound.ts:emitInbound`, `synthesized/boundary/starts.ts:crossing`, `synthesized/boundary/starts.ts:listStart`, `synthesized/boundary/starts.ts:startEntry`, `tables/own-entries.ts:ownEntryOf`, `tables/own-entries.ts:derivedCodecDirection`, `tables/type-table.ts:enumRoles`, `tables/type-table.ts:TypeTable.#unionLayout`, `tables/type-table.ts:TypeTable.#outcomeEncoder`
- **Places & `&` references (`&x`, `&self`, copy-in/copy-out)**: `calls/emit-call.ts:emitCall`, `calls/emit-call.ts:referenceTo`, `constructs/expressions/calls.ts:preparedCall`, `constructs/expressions/calls.ts:receiverOf`, `constructs/expressions/calls.ts:argumentOf`, `constructs/expressions/calls.ts:referencedPlace`, `constructs/expressions/calls.ts:leaveAll`, `constructs/expressions/collections/collections.ts:lowerDeclaredLiteral`, `constructs/parts/places.ts:enterAssigned`, `constructs/parts/places.ts:enterReferenced`, `constructs/parts/places.ts:locate`, `constructs/parts/places.ts:stepped`, `constructs/parts/places.ts:writeAt`, `constructs/parts/places.ts:changeAt`, `constructs/parts/places.ts:elementAccessor`, `constructs/parts/places.ts:sharedAccessor`, `functions/built-entries.ts:externDefaultsEntry`, `functions/fits/index.ts:wrappingEntry`, `functions/fits/index.ts:asyncFitEntry`, `synthesized/index.ts:SynthesizedCode.passedOn`, `synthesized/index.ts:SynthesizedCode.inCell`, `synthesized/trait-objects.ts:dispatchEntry`, `synthesized/trait-objects.ts:memberReceiver`
- **Patterns & destructuring targets (including array patterns, struct rest, `or` patterns)**: `constructs/expressions/control/matching.ts:lowerMatch`, `constructs/expressions/control/matching.ts:lowerIs`, `constructs/expressions/control/select.ts:lowerSelect`, `constructs/loops/field-passes.ts:bindField`, `constructs/loops/iteration.ts:emitLoopOver`, `constructs/parts/part-paths.ts:readPartAlong`, `constructs/parts/part-paths.ts:isBuilding`, `constructs/parts/part-paths.ts:builtAt`, `constructs/parts/part-paths.ts:positionsOf`, `constructs/parts/part-paths.ts:stepOffsets`, `constructs/parts/patterns.ts:lowerMatching`, `constructs/parts/patterns.ts:lowerTests`, `constructs/parts/patterns.ts:lowerAlternatives`, `constructs/parts/patterns.ts:lowerTest`, `constructs/parts/patterns.ts:lowerMemberTest`, `constructs/parts/patterns.ts:passed`, `constructs/parts/patterns.ts:bind`, `constructs/parts/patterns.ts:bindChosen`, `constructs/parts/patterns.ts:comparedWith`, `constructs/statements/variables.ts:lowerVariableDeclaration`, `constructs/statements/variables.ts:bindTargets`, `constructs/statements/variables.ts:lowerAssignment`, `functions/frame-variables.ts:enterParameters`, `functions/frame-variables.ts:declareArgument`, `functions/frame-variables.ts:takeApart`, `functions/index.ts:FunctionLowering.lowerStart`
- **Templates (tagged and untagged)**: `constructs/expressions/literals/templates.ts:lowerTemplate`
- **Ranges (`..`, `..=`, `step`)**: `constructs/expressions/collections/collections.ts:lowerRange`, `constructs/expressions/collections/collections.ts:optionalInt`
- **Comparisons, chained comparisons & decided conditions (`==`, `!=`, `<`, `in`, `not in`)**: `constructs/expressions/control/control.ts:lowerIf`, `constructs/expressions/control/matching.ts:lowerMatch`, `constructs/expressions/control/matching.ts:lowerIs`, `constructs/expressions/operators.ts:lowerBinary`, `constructs/expressions/operators.ts:lowerChainedComparison`, `constructs/expressions/operators.ts:compared`, `constructs/expressions/operators.ts:equal`, `constructs/expressions/operators.ts:ordered`, `constructs/parts/patterns.ts:passed`, `functions/code-writer.ts:CodeWriter.equal`, `synthesized/index.ts:SynthesizedCode.equal`
- **Annotations (`@Suite`, `@Waypoint`, declaration/field annotations)**: `functions/code-writer.ts:CodeWriter.withWaypoint`, `functions/index.ts:FunctionLowering.statement`, `lower.ts:lowerTests`, `tables/constants.ts:annotationValues`, `tables/tables.ts:DefinitionTables.entryHeader`, `tables/type-table.ts:TypeTable.#fields`
