---
description: lowering to Definition IR, interned tables, function instances, calls, loops, places and synthesized code — read before changing lowering or IR
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-12
last_updated: 2026-11-12
tags: [reuse, lowering, definition, ir, instructions]
---

# Lowering and Definition IR

## Units

- lower a checked program or its `@Suite` tests into a `Definition` → `lower`, `lowerTests` (`src/compiler/lowering/lower.ts`)
- intern modules, constants, function instances or closing `any` entries → `DefinitionTables` (`src/compiler/lowering/tables/tables.ts`)
- intern concrete `Definition` type entries → `TypeTable` (`src/compiler/lowering/tables/type-table.ts`)
- lower a function instance or nested function body → `instanceLowering`, `nestedLowering` (`src/compiler/lowering/functions/index.ts`); the entry of a function with no body of its own, built from its parameters once its prologue computed them (a struct's or variant's fields, a host extern's wrapper, a native extern's defaults) → `builtLowering`, `FunctionLowering.lowerBuilt`, and its entries `structEntry`, `constructorEntry`, `hostExternEntry`, `externDefaultsEntry` (`src/compiler/lowering/functions/built-entries.ts`); what an instance's own entry is made of, decided once for lowering and the tables → `ownEntryOf` (`src/compiler/lowering/tables/own-entries.ts`)
- build the `LoweredFunction` for an instance or nested entry → `loweredInstance`, `loweredNested`; an instance's defaults as its prologue reads them → `defaultsReading` (`src/compiler/lowering/functions/frames.ts`)
- lay out the `Frame` for an instance, a built or a nested entry → `instanceFrame`, `builtFrame`, `nestedFrame` (`src/compiler/lowering/functions/frames.ts`)
- declare a frame's parameters, running its prologue: each parameter a call leaves out computed from its default, read through `EntryContext.inDefaults`, then the `body` marker → `declareFrame` (`src/compiler/lowering/functions/frame-variables.ts`); never compute a default in a caller
- close a `ResolvedCall` against an instantiation's substitution/witnesses → `closeCall`, `closeCallWithin` (`src/compiler/lowering/calls/closed-calls.ts`), given the checker as a `Closer` (its type rules, and the witnesses a requirement on a computed type takes once known)
- close a `FunctionCall` or a trait witness call → `closeFunctionCall`, `closeWitness` (`src/compiler/lowering/calls/closed-calls.ts`)
- read what a closed call gives, or how it or a dispatch maps its function's types (the constraint's trait arguments and `Self` included) → `resultOfCall`, `substitutionOfCall`, `dispatchSubstitution` (`src/compiler/lowering/calls/closed-calls.ts`)
- build a root `FunctionInstance` → `rootInstance`, `substitutionOf` (`src/compiler/lowering/tables/instances.ts`); the entry a call leaving parameters out calls, its function's own or an extern's defaults entry → `DefinitionTables.leavingOutIndex`; whether a function value of a shorter type leaves any out → `leavesOut` (`src/compiler/lowering/calls/closed-calls.ts`)
- allocate registers, place labels, and emit jumps, branches or instructions → `CodeWriter` (`src/compiler/lowering/functions/code-writer.ts`), via `context.code`
- write code with no syntax behind it (codecs, a host's extern constant's read, `any` dispatch, async fits) → `SynthesizedCode` (`src/compiler/lowering/synthesized/index.ts`); pass its parameters on, those it takes by `&` by `&` (into a part too) → `SynthesizedCode.passedOn`; pass by `&` a value it has no place for → `SynthesizedCode.inCell`
- build a struct from registers by its fields' names, a tuple, or `==`, with a body or without → `construct`, `tupleOf`, `equal` (`src/compiler/lowering/values/struct-values.ts`, `constructs/expressions/literals/tuples.ts`, `constructs/expressions/operators.ts`, all on `CodeContext`); a struct's value rebuilt as another struct type of some or all of its fields, by name (a nominal value as its shape, §3.1; a pattern's rest, §3.11) → `rebuiltAs` (`src/compiler/lowering/values/struct-values.ts`)
- read the part of a value a pattern or a target reaches, along the checker's steps (a struct's fields by name, tuple elements and variant fields by position; members; an array's items; a struct pattern's rest built anew) → `readPartAlong` (`src/compiler/lowering/constructs/parts/part-paths.ts`); never `readPath` over a binding's or an assigned part's path
- emit a direct or closed `call` instruction → `emitCall`, `emitFunctionCall`, `referenceTo`, and a call of what a call calls (`CallTarget`: a closed call or a function value's register) → `emitTo` (`src/compiler/lowering/calls/emit-call.ts`); a written call's or deferred call's callee, receiver and arguments evaluated, as written or by value → `preparedCall`, `leaveAll` (`src/compiler/lowering/constructs/expressions/calls.ts`)
- emit a call recorded at a call site or implicit construct → `emitCallAt`, `emitImplicitCall` (`src/compiler/lowering/calls/emit-call.ts`)
- lower a deferred call `g f(args)` (§3.14): the taker's call, given a closure of an entry of its own making `f(args)` from copies of what it computes now → `lowerDeferredCall`, `deferredEntry` (`src/compiler/lowering/constructs/expressions/deferred-calls.ts`)
- the mode of an entry lowering writes, from its function's kind, or the kind an entry built as a function of a type waits in → `codeModeOf`, `builtKindOf` (`src/compiler/lowering/functions/modes.ts`)
- emit the cursor loop of a `for`, comprehension or non-copied spread → `cursorOf`, `emitLoop`, `emitLoopOver` (`src/compiler/lowering/constructs/loops/iteration.ts`)
- lower a construct over a struct's fields (§4): its subject once, then each field's pass in a block of its own with the key and value bound → `fieldsVisited`, `inFieldScope`, and `valueInFieldScope` for a pass giving a value (`src/compiler/lowering/constructs/loops/field-passes.ts`); a block's value kept past its end → `valueInBlock` (`constructs/statements/scopes.ts`)
- lower code inside a field loop's pass (§4): its body read as that pass checked it, calls closed with its key bound, nested functions keyed per pass → `FunctionContext.inFieldPass` (`src/compiler/lowering/functions/index.ts`), `passBody` (`functions/frames.ts`), `BodyOwner.passes` and `passBindings` (`src/compiler/lowering/tables/instances.ts`)
- enter an assigned or `&`-referenced place → `enterAssigned`, `enterReferenced` (`src/compiler/lowering/constructs/parts/places.ts`); read or write the field a key of several names names, or a part past it, switching on its tag → `lowerKeyRead`, `readKeyed`, `writeKeyed`, `eachKeyedField`, and convert a value written there into the concrete field, also where an instantiation left the key one name (an `AssignedPart` whose `WrittenFit` is `'intoKeyedField'`) → `fittedInto` (`src/compiler/lowering/values/keyed-fields.ts`); run code per member of a union value → `onEachMember`, or into one register → `eachMember` (`src/compiler/lowering/values/unions.ts`)
- read one field of a value, or its part along field and element positions → `CodeWriter.field`, `CodeWriter.readPath` (`src/compiler/lowering/functions/code-writer.ts`); compare two registers with the built-in `equal` → `CodeWriter.equal`, or `equal` (`operators.ts`) for `!=` too
- a variable's register → `VariableRegisters.registerOf` (`src/compiler/lowering/constructs/statements/variables.ts`); allocate a cell → `cellRegister` (`src/compiler/lowering/constructs/parts/places.ts`)
- take a value apart into a declaration's or a parameter's targets, each name its part's copy → `bindTargets` (`src/compiler/lowering/constructs/statements/variables.ts`); a parameter's pattern is taken apart there, at its function's entry, its argument in a register of its own (`FunctionLowering`, `src/compiler/lowering/functions/index.ts`), never by a second destructuring path
- read how a field access reaches its field → `CheckedBody.fieldReadOf` (`src/compiler/checker/surface/checked-body.ts`)
- lower pattern tests and bindings jumping to a failure label → `lowerMatching` (`src/compiler/lowering/constructs/parts/patterns.ts`)
- build an enum variant by its declared name → `buildVariant`, or what a variant's constructor builds of its parameters → `buildConstructed` (`src/compiler/lowering/values/variant-values.ts`), whether a type is an enum's → `isEnum` (`src/compiler/lowering/constructs/expressions/structs/variants.ts`); in synthesized code, `SynthesizedCode.variant`
- branch on an enum variant, or read variant field 0 → `branchOnVariant`, `payloadOf` (`src/compiler/lowering/constructs/expressions/structs/variants.ts`); carry on with a variant's one field where a value holds it, else run what leaves → `payloadOr`
- build `none` or put a value into `T?`, or read a `T?` where it isn't `none` → `noneOf`, `someOf`, `presentOrJump`, `presentOr` (`src/compiler/lowering/values/optionals.ts`)
- put a value into a union, take one out as a member or a narrower union (or, where an instantiation collapsed it, as literals merged into its base, or out of the `any` type that took its members whole), write a union of literals as its base, write something per member's value → `intoUnion`, `outOfUnion`, `asBase`, `oneValueIn`, `eachMember` (`src/compiler/lowering/values/unions.ts`)
- where a value of one type sits in a value of another as an instantiation made both (its own variant, its literal's base's, or inside the `any` type that took it whole; a recursive type laid out as what it unfolds to, `laidOutAs`), and testing for it → `holdingOf`, `heldPositions`, `heldIn`, `branchOnHeld`, `jumpIfHeld`, `heldInAny`, `laidOutAs` (`src/compiler/lowering/values/holdings.ts`); never patch a layout an instantiation changed; a union's variants in order and the one holding a member → `TypeTable.unionMembers`, `unionVariant`; never build a union's variant by hand
- convert a value, a union's member by member, into an `any` variant → `convertedIntoAny` (`src/compiler/lowering/values/into-any.ts`); dispatch a required function over an `any` value's or a union's members, converting through the instantiation a member meets → `dispatchEntry`, keyed by its `Dispatch` (`src/compiler/lowering/synthesized/trait-objects.ts`)
- wrap a plain function value as an `async` closure where the checker made it async to fit → `fittedValue`, a closure of the site's entry (`DefinitionTables.asyncFitIndex`), written by `asyncFitEntry` (`src/compiler/lowering/functions/fits/index.ts`)
- call the codec writing or reading a type, closed within an instance → `codecCall`, or `foundCodecCall` where a type may have none (`src/compiler/lowering/synthesized/boundary/codec-calls.ts`)
- read JSON crossing in from the host, a mismatch handled as its source says (a host's `result` panics the instance, an `input` fails the host's call) → `inboundOf`, `emitInbound` (`src/compiler/lowering/synthesized/boundary/inbound.ts`)
- write a derived codec's body from its type's form, one writer per direction → `derivedCodecEntry` (`src/compiler/lowering/synthesized/boundary/codecs.ts`), which direction an instance is from `ownEntryOf` (`src/compiler/lowering/tables/own-entries.ts`); a new form kind is a case in `Encoder.write` and `Decoder.read`
- apply a checker-recorded `Fit` (conversion plus optional wraps) to a register → `fittedValue`; fit a value of one type to another inside a synthesized entry, as the checker fits them → `fittedIn`, and return what a function of one type gave as one of another gives it, the entry async where that gives a future → `returnedAs` (`src/compiler/lowering/functions/fits/index.ts`); a conversion of parts is rebuilt where the layout changes (`changesLayout`, `rebuilt`, `fits/parts.ts`) by one entry per pair of types (`ConversionEntry`, `src/compiler/lowering/tables/instances.ts`)
- emit a constant or convert a `ConstantForm` / `CheckedAnnotation` → `emitConstant`, `constantValue`, `annotationValues` (`src/compiler/lowering/tables/constants.ts`)
- release block variables or statement temporaries → `endScope`, `headerTemporaries`, `lowerGuarded`, `release` (`src/compiler/lowering/constructs/statements/scopes.ts`)
- copy the value a register holds, a cell's rather than the cell, into a fresh one → `copied` (`src/compiler/lowering/constructs/statements/variables.ts`)
- list an instruction's operands → `operandsOf` (`src/definition/instructions/instruction.ts`)
- inspect instruction wait/termination flow → `waitRegister`, `waits`, `terminates` (`src/definition/instructions/flow.ts`)
- write a wait: a resolver per case handed to its `onAwait`, then the instruction that waits; or await a future from synthesized code → `openWait`, `awaitWait`, `awaitFuture` (`src/compiler/lowering/calls/waits.ts`)
- inspect `Definition` function parameters or captures → `takesReference`, `mayLeaveOut`, `capturesOf`; where a code entry's body begins, past its prologue → `bodyStart` (`src/definition/tables/functions.ts`)
- check an entry can encode an instance's outcome → `encoderProblem` (`src/definition/tables/functions.ts`); the encoder an `Instance<T>` type entry names for what it spawns → `outcomeEncoderOf` (`src/definition/tables/types.ts`)
- inspect `Definition` type references, roles, cell or resource types → `typesIn`, `isResourceType`, `isCellType`, `hasRole` (`src/definition/tables/types.ts`)
- validate `Definition` table references or value shapes → `checkReferences`, `valueProblems` (`src/definition/validation/references.ts`)

## One-way rules

- Emit every `call` through `emitCall` / `emitFunctionCall`, every loop through `emitLoop`, and every value conversion through `FunctionContext.fitted`.
- Lower every checked body through `instanceLowering`, `nestedLowering` or, for a context constant's initializer, `accessorLowering` (`functions/index.ts`), and syntaxless code through `SynthesizedCode`.
- Lower std code a program needs only once it reaches a function, as the job server once it reaches `runtime.delegate`, from `lowerReached` (`lower.ts`), naming it in the Definition as `main` is, never from code every program reaches.
- Never recognize a `Definition` type by name string at runtime; use `TypeDefinition.role` (`hasRole`, `isResourceType` in `src/definition/tables/types.ts`).
- The lowering decides every release point, and the runtime never infers a scope (`src/definition/instructions/lifetimes.ts`): `release` at a block's end on every exit, a statement's or header's end and `drop`, `keep` for `hold`, a `select` case's `holds`, and `return` releasing every register. A `release` lists a block's variables in the order they were declared.

## Recipes

### Add a Definition instruction kind

1. Define the schema with `defineInstruction` in `src/definition/instructions/` (`data.ts`, `calls.ts`, `control.ts`, `prologue.ts`, `suspension.ts`, or `lifetimes.ts`).
2. Add its handler to `operandsOf` (`instruction.ts`), `flow.ts`, and `instructionProblem` (`src/definition/validation/instruction-rules.ts`).
3. Add its arbitrary to `src/definition/instructions/instruction.test-kit.ts`.
4. Add its handler to `src/runtime/interpreter/instructions.ts` and snapshot holding/check rules if it waits or holds registers (`src/runtime/snapshot/`).
