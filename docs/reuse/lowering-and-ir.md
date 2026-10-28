---
description: lowering to Definition IR, interned tables, function instances, calls, loops, places and synthesized code — read before changing lowering or IR
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-28
last_updated: 2026-10-29
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
- close a `ResolvedCall` against an instantiation's substitution/witnesses → `closeCall`, `closeCallWithin` (`src/compiler/lowering/instances.ts`)
- close a `FunctionCall` or a trait witness call → `closeFunctionCall`, `closeWitness` (`src/compiler/lowering/instances.ts`)
- build root, filling or default `FunctionInstance`s → `rootInstance`, `takingPassed`, `defaultEntryOf`, `substitutionOf` (`src/compiler/lowering/instances.ts`)
- allocate registers, place labels, and emit jumps, branches or instructions → `CodeWriter` (`src/compiler/lowering/code-writer.ts`), via `context.code`
- write code with no syntax behind it (codecs, host wrappers, `any` dispatch, async fits) → `SynthesizedCode` (`src/compiler/lowering/synthesized-code.ts`)
- emit a direct or closed `call` instruction → `emitCall`, `emitFunctionCall`, `referenceTo` (`src/compiler/lowering/emit-call.ts`)
- emit a call recorded at a call site or implicit construct → `emitCallAt`, `emitImplicitCall` (`src/compiler/lowering/emit-call.ts`)
- emit the cursor loop of a `for`, comprehension or non-copied spread → `cursorOf`, `emitLoop`, `emitLoopOver` (`src/compiler/lowering/iteration.ts`)
- enter an assigned or `&`-referenced place → `enterAssigned`, `enterReferenced` (`src/compiler/lowering/places.ts`)
- read one field of a value, or its part along field and element positions → `CodeWriter.field`, `CodeWriter.readPath` (`src/compiler/lowering/code-writer.ts`)
- a variable's register → `VariableRegisters.registerOf` (`src/compiler/lowering/statements/variables.ts`); allocate a cell → `cellRegister` (`src/compiler/lowering/places.ts`)
- read how a field access reaches its field → `CheckedBody.fieldReadOf` (`src/compiler/checker/check.ts`)
- lower pattern tests and bindings jumping to a failure label → `lowerMatching` (`src/compiler/lowering/patterns.ts`)
- build an enum variant or look up a variant's index → `buildVariant`, `variantIndexOf`, `isEnum` (`src/compiler/lowering/expressions/variants.ts`)
- test or branch on an enum variant or read variant field 0 → `variantTestOf`, `branchOnVariant`, `payloadOf` (`src/compiler/lowering/expressions/variants.ts`)
- convert a value into an `any` variant → `convertedIntoAny` (`src/compiler/lowering/trait-objects/trait-objects.ts`)
- wrap a plain function value as an `async` closure → `madeAsync` (`src/compiler/lowering/async-fits.ts`)
- call the codec writing or reading a type, closed within an instance → `codecCall` (`src/compiler/lowering/boundary/codec-calls.ts`)
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
