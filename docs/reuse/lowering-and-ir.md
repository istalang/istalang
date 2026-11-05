---
description: lowering to Definition IR, interned tables, function instances, calls, loops, places and synthesized code — read before changing lowering or IR
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-28
last_updated: 2026-11-05
tags: [reuse, lowering, definition, ir, instructions]
---

# Lowering and Definition IR

## Units

- lower a checked program or its `@Suite` tests into a `Definition` → `lower`, `lowerTests` (`src/compiler/lowering/lower.ts`)
- intern modules, constants, function instances or closing `any` entries → `DefinitionTables` (`src/compiler/lowering/tables.ts`)
- intern concrete `Definition` type entries → `TypeTable` (`src/compiler/lowering/type-table.ts`)
- lower a function instance or nested function body → `instanceLowering`, `nestedLowering` (`src/compiler/lowering/function-lowering/index.ts`)
- build the `LoweredFunction` for an instance or nested entry → `loweredInstance`, `loweredNested` (`src/compiler/lowering/function-lowering/frames.ts`)
- lay out the `Frame` for an instance or nested entry → `instanceFrame`, `nestedFrame` (`src/compiler/lowering/function-lowering/frames.ts`)
- close a `ResolvedCall` against an instantiation's substitution/witnesses → `closeCall`, `closeCallWithin` (`src/compiler/lowering/closed-calls.ts`), given the checker as a `Closer` (its type rules, and the witnesses a requirement on a computed type takes once known)
- close a `FunctionCall` or a trait witness call → `closeFunctionCall`, `closeWitness` (`src/compiler/lowering/closed-calls.ts`)
- build root, filling or default `FunctionInstance`s → `rootInstance`, `substitutionOf` (`src/compiler/lowering/instances.ts`), `takingPassed`, `defaultEntryOf` (`src/compiler/lowering/closed-calls.ts`)
- allocate registers, place labels, and emit jumps, branches or instructions → `CodeWriter` (`src/compiler/lowering/code-writer.ts`), via `context.code`
- write code with no syntax behind it (codecs, host wrappers, `any` dispatch, async fits) → `SynthesizedCode` (`src/compiler/lowering/synthesized-code.ts`); pass its parameters on, those it takes by `&` by `&` (into a part too) → `SynthesizedCode.passedOn`; pass by `&` a value it has no place for → `SynthesizedCode.inCell`
- build a struct from registers by its fields' names, a tuple, or `==`, with a body or without → `construct`, `tupleOf`, `equal` (`src/compiler/lowering/expressions/structs.ts`, `tuples.ts`, `operators.ts`, all on `CodeContext`); a struct's value rebuilt as another struct type, its fields by name (a nominal value as its shape, §3.1) → `rebuiltAs` (`src/compiler/lowering/expressions/structs.ts`)
- emit a direct or closed `call` instruction → `emitCall`, `emitFunctionCall`, `referenceTo` (`src/compiler/lowering/emit-call.ts`)
- emit a call recorded at a call site or implicit construct → `emitCallAt`, `emitImplicitCall` (`src/compiler/lowering/emit-call.ts`)
- emit the cursor loop of a `for`, comprehension or non-copied spread → `cursorOf`, `emitLoop`, `emitLoopOver` (`src/compiler/lowering/iteration.ts`)
- enter an assigned or `&`-referenced place → `enterAssigned`, `enterReferenced` (`src/compiler/lowering/places.ts`)
- read one field of a value, or its part along field and element positions → `CodeWriter.field`, `CodeWriter.readPath` (`src/compiler/lowering/code-writer.ts`); compare two registers with the built-in `equal` → `CodeWriter.equal`, or `equal` (`operators.ts`) for `!=` too
- a variable's register → `VariableRegisters.registerOf` (`src/compiler/lowering/statements/variables.ts`); allocate a cell → `cellRegister` (`src/compiler/lowering/places.ts`)
- read how a field access reaches its field → `CheckedBody.fieldReadOf` (`src/compiler/checker/check.ts`)
- lower pattern tests and bindings jumping to a failure label → `lowerMatching` (`src/compiler/lowering/patterns.ts`)
- build an enum variant by its declared name → `buildVariant`, `isEnum` (`src/compiler/lowering/expressions/variants.ts`); in synthesized code, `SynthesizedCode.variant`
- branch on an enum variant, or read variant field 0 → `branchOnVariant`, `payloadOf` (`src/compiler/lowering/expressions/variants.ts`); carry on with a variant's one field where a value holds it, else run what leaves → `payloadOr`
- build `none` or put a value into `T?`, or read a `T?` where it isn't `none` → `noneOf`, `someOf`, `presentOrJump`, `presentOr` (`src/compiler/lowering/optionals.ts`)
- put a value into a union, take one out as a member or a narrower union (or, where an instantiation collapsed it, as literals merged into its base, or out of the `any` type that took its members whole), write a union of literals as its base, write something per member's value → `intoUnion`, `outOfUnion`, `asBase`, `oneValueIn`, `eachMember` (`src/compiler/lowering/unions.ts`)
- where a value of one type sits in a value of another as an instantiation made both (its own variant, its literal's base's, or inside the `any` type that took it whole), and testing for it → `holdingOf`, `heldPositions`, `heldIn`, `branchOnHeld`, `jumpIfHeld`, `heldInAny` (`src/compiler/lowering/holdings.ts`); never patch a layout an instantiation changed; a union's variants in order and the one holding a member → `TypeTable.unionMembers`, `unionVariant`; never build a union's variant by hand
- convert a value, a union's member by member, into an `any` variant → `convertedIntoAny`; dispatch a required function over an `any` value's or a union's members → `dispatchEntry`, keyed by its `Dispatch` (`src/compiler/lowering/trait-objects/trait-objects.ts`)
- wrap a plain function value as an `async` closure → `madeAsync` (`src/compiler/lowering/async-fits.ts`)
- call the codec writing or reading a type, closed within an instance → `codecCall` (`src/compiler/lowering/boundary/codec-calls.ts`)
- read JSON crossing in from the host, a mismatch handled as its source says (a host's `result` panics the instance, an `input` fails the host's call) → `inboundOf`, `emitInbound` (`src/compiler/lowering/boundary/inbound.ts`)
- write a derived codec's body from its type's form, one writer per direction → `derivedCodecDirection`, `derivedCodecEntry` (`src/compiler/lowering/boundary/codecs.ts`); a new form kind is a case in `Encoder.write` and `Decoder.read`
- apply a checker-recorded `Fit` (conversion plus optional wraps) to a register → `fittedValue` (`src/compiler/lowering/function-lowering/fits.ts`)
- emit a constant or convert a `ConstantForm` / `CheckedAnnotation` → `emitConstant`, `constantValue`, `annotationValues` (`src/compiler/lowering/constants.ts`)
- release block variables or statement temporaries → `endScope`, `headerTemporaries`, `lowerGuarded`, `release` (`src/compiler/lowering/statements/scopes.ts`)
- list an instruction's operands → `operandsOf` (`src/definition/instructions/instruction.ts`)
- inspect instruction wait/termination flow → `awaitedRegisters`, `waits`, `terminates` (`src/definition/instructions/flow.ts`)
- inspect `Definition` function parameters or captures → `takesReference`, `capturesOf` (`src/definition/functions.ts`)
- check an entry can encode an instance's outcome → `encoderProblem` (`src/definition/functions.ts`)
- inspect `Definition` type references, roles, cell or resource types → `typesIn`, `isResourceType`, `isCellType`, `hasRole` (`src/definition/types.ts`)
- validate `Definition` table references or value shapes → `checkReferences`, `valueProblems` (`src/definition/references.ts`)

## One-way rules

- Emit every `call` through `emitCall` / `emitFunctionCall`, every loop through `emitLoop`, and every value conversion through `FunctionContext.fitted`.
- Lower every checked body through `instanceLowering` or `nestedLowering` (`function-lowering/index.ts`), and syntaxless code through `SynthesizedCode`.
- Never recognize a `Definition` type by name string at runtime; use `TypeDefinition.role` (`hasRole`, `isResourceType` in `src/definition/types.ts`).

## Recipes

### Add a Definition instruction kind

1. Define the schema with `defineInstruction` in `src/definition/instructions/` (`data.ts`, `calls.ts`, `control.ts`, `suspension.ts`, or `lifetimes.ts`).
2. Add its handler to `operandsOf` (`instruction.ts`), `flow.ts`, and `instructionProblem` (`src/definition/instruction-rules.ts`).
3. Add its arbitrary to `src/definition/instructions/instruction.test-kit.ts`.
4. Add its handler to `src/runtime/interpreter/instructions.ts` and snapshot holding/check rules if it waits or holds registers (`src/runtime/snapshot/`).
