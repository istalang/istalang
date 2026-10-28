---
description: candidate lookup, ADL, overload choice, inference, trait witnesses and implicit calls — read before resolving calls, operators or witnesses
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-28
last_updated: 2026-10-28
tags: [reuse, checker, calls, resolution, overloads, traits, witnesses]
---

# Calls, overload resolution and witnesses

## Units

- build a `UseSite` (reporting, silent, or host-crossing) → `useSite`, `searchSite`, `hostSite`, `silent` (`src/compiler/checker/use-site.ts`)
- look up top-level functions in a module (prelude joined) → `namedInModule` (`src/compiler/checker/resolution/candidates.ts`)
- look up call candidates with ADL and type-parameter requirements → `topLevelCandidates`, `callCandidates` (`src/compiler/checker/resolution/candidates.ts`)
- look up static or trait witness candidates → `staticCandidates`, `staticTargetOf`, `witnessCandidates` (`src/compiler/checker/resolution/candidates.ts`)
- bind call or function-value arguments to parameter slots → `bindArguments`, `bindValue`, `positionalCounts` (`src/compiler/checker/resolution/binding.ts`)
- map bound arguments to slots or test for a valid binding → `argumentSlotsOf`, `isBinding` (`src/compiler/checker/resolution/binding.ts`)
- map argument indices to parameter indices or test if all parameters are passed → `parameterOfArgument`, `passesAll` (`src/compiler/checker/resolved-call.ts`)
- test whether one candidate takes given arguments → `takenBy` (`src/compiler/checker/resolution/applicability.ts`)
- infer type arguments by matching declared and given types → `Inference` (`src/compiler/checker/inference/infer.ts`)
- fill uninferred type parameters from declared defaults → `completeInference` (`src/compiler/checker/inference/complete.ts`)
- choose the best candidate among overloads → `choose`, `chooseAsValue`, `signatureOf` (`src/compiler/checker/resolution/choice.ts`)
- instantiate a chosen candidate and resolve its witnesses → `instantiate` (`src/compiler/checker/resolution/conformance.ts`)
- check trait conformance or find constraint witnesses → `meets`, `witnessesFor`, `conformWitnesses` (`src/compiler/checker/resolution/conformance.ts`)
- check for or choose a declared witness for a trait requirement → `declaresWitness`, `chooseWitness` (`src/compiler/checker/resolution/declared-witness.ts`)
- resolve a type's `Default` witness (`default()`) → `defaultWitness`, `resolveDefault` (`src/compiler/checker/resolution/default-witness.ts`)
- build a `ResolvedCall` (`function` or `requirement`) from an `Application` and `Instantiation` → `callMade` (`src/compiler/checker/resolution/calls-made.ts`)
- choose and instantiate a call silently (no written call site) → `chooseSilently` (`src/compiler/checker/resolution/silent-choice.ts`)
- resolve a toolchain-known generic call by explicit `typeArguments` → `callWithTypes` (`src/compiler/checker/resolution/typed-call.ts`)
- resolve and record an implicit construct call → `implicitCall` (`src/compiler/checker/resolution/implicit.ts`)
- resolve an implicit `compare` or `includes` operator call → `implicitOperatorCall`, `isImplicitOperator` (`src/compiler/checker/resolution/implicit.ts`)
- resolve and record a prelude-owned helper call (panics if absent) → `preludeCall`, `preludeCandidates` (`src/compiler/checker/resolution/implicit.ts`)
- resolve a written call in a body and fit its arguments → `resolveCall`, `recordChosen`, `fitArguments`, `explain` (`src/compiler/checker/calls/resolve.ts`)
- infer untyped lambda arguments after overload choice → `checkDecidedLambdas` (`src/compiler/checker/calls/lambda-arguments.ts`)
- resolve a prefix or binary operator call in a body → `resolveOperator`, `binaryApplied`, `unaryApplied`, `applied` (`src/compiler/checker/calls/operators.ts`)
- check `setIndex` element writes or synchronous collection calls → `writeElement`, `runsAtOnce` (`src/compiler/checker/calls/collection-functions.ts`)
- check an assigned or `&`-referenced place → `checkChangedPlace` (`src/compiler/checker/calls/places.ts`)
- check aliasing of `&` arguments or destructuring places → `checkReferencedPlaces`, `checkDistinctPlaces` (`src/compiler/checker/calls/places.ts`)
- mark a method receiver changed or test if a variable is mutable → `changeReceiver`, `isChangeable` (`src/compiler/checker/calls/places.ts`)
- resolve a type or fieldless struct in value/pattern position → `namedType`, `nameNodeOf`, `fieldlessStructOf` (`src/compiler/checker/resolution/named.ts`)
- choose a bare or qualified enum variant against an expected type → `chooseVariant`, `sameEnum` (`src/compiler/checker/resolution/named.ts`)
- check `for`/comprehension/spread iteration → `checkIterated`, `iteratedItem`, `checkLoopOver` (`src/compiler/checker/rules/iteration.ts`)

## One-way rules

- Every resolved call is built through `callMade` (`src/compiler/checker/resolution/calls-made.ts`).
- Extensible protocol calls (`iterate`, `setIndex`, `compare`, `includes`, `toString`) use `implicitCall`; prelude-owned helpers use `preludeCall`.
- Silent resolution without a written call site uses `chooseSilently` (`silent-choice.ts`), or `callWithTypes` (`typed-call.ts`) when type arguments are given.

## Recipes

### Add an implicit construct or prelude call

1. Spell the function's name once in `src/language/well-known.ts`.
2. Add its role to `ImplicitRole` in `src/compiler/checker/resolved-call.ts`.
3. In the checker handler, call `preludeCall` (prelude-owned) or `implicitCall` with `topLevelCandidates` (`src/compiler/checker/resolution/implicit.ts`).
4. In lowering, read `context.body.implicitCallOf(node, role)` and emit it with `emitImplicitCall` / `emitCall` (`src/compiler/lowering/emit-call.ts`).
