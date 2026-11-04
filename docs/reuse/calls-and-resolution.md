---
description: candidate lookup, ADL, overload choice, inference, trait witnesses and implicit calls — read before resolving calls, operators or witnesses
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-28
last_updated: 2026-11-04
tags: [reuse, checker, calls, resolution, overloads, traits, witnesses]
---

# Calls, overload resolution and witnesses

## Units

- build a `UseSite` (reporting, silent, or host-crossing) → `useSite`, `searchSite`, `hostSite`, `silent` (`src/compiler/checker/use-site.ts`)
- look up top-level functions in a module (prelude joined) → `namedInModule` (`src/compiler/checker/resolution/candidates.ts`)
- look up call candidates with ADL and type-parameter requirements → `topLevelCandidates`, `callCandidates` (`src/compiler/checker/resolution/candidates.ts`)
- keep the methods a call through a member access may mean, `&self` ones only through a place → `callableThrough` (`src/compiler/checker/resolution/candidates.ts`)
- apply a call: choose among candidates, report ambiguity or a caller's `none`, instantiate, fit the arguments (conversions and wraps), give the result → `applyCall` (`src/compiler/checker/resolution/applied-call.ts`); written calls (`resolveCall`) and implicit ones (`implicitCall`) both go through it, and add only what they record
- look up static or trait witness candidates → `staticCandidates`, `staticTargetOf`, `witnessCandidates` (`src/compiler/checker/resolution/candidates.ts`)
- list the modules a module sees (its own, its imports, the prelude), or every static function on a type they declare → `modulesSeenFrom`, `staticFunctionsAmong` (`src/compiler/checker/resolution/candidates.ts`)
- bind call or function-value arguments to parameter slots → `bindArguments`, `bindValue`, `positionalCounts` (`src/compiler/checker/resolution/binding.ts`)
- map bound arguments to slots or test for a valid binding → `argumentSlotsOf`, `isBinding` (`src/compiler/checker/resolution/binding.ts`)
- map argument indices to parameter indices or test if all parameters are passed → `parameterOfArgument`, `passesAll` (`src/compiler/checker/resolved-call.ts`)
- test whether one candidate takes given arguments → `takenBy` (`src/compiler/checker/resolution/applicability.ts`)
- infer type arguments by matching declared and given types, `match` where the value may convert, `matchExactly` where it must have its type (a reference, a spread's items, a witness) → `Inference` (`src/compiler/checker/inference/infer.ts`)
- fill uninferred type parameters from declared defaults → `completeInference` (`src/compiler/checker/inference/complete.ts`)
- choose the best candidate among overloads → `choose`, `chooseAsValue`, `signatureOf` (`src/compiler/checker/resolution/choice.ts`)
- instantiate a chosen candidate and resolve its witnesses → `instantiate` (`src/compiler/checker/resolution/conformance.ts`)
- check trait conformance or find constraint witnesses → `meets`, `witnessesFor`, `conformWitnesses` (`src/compiler/checker/resolution/conformance.ts`)
- check for or choose a declared witness for a trait requirement → `declaresWitness`, `chooseWitness` (`src/compiler/checker/resolution/declared-witness.ts`)
- resolve a type's `Default` witness (`default()`) → `defaultWitness`, `resolveDefault` (`src/compiler/checker/resolution/default-witness.ts`)
- build a `ResolvedCall` (`function` or `requirement`) from an `Application` and `Instantiation` → `callMade` (`src/compiler/checker/resolution/calls-made.ts`)
- make a call the toolchain makes on its own to a plain function (no written call site), by its arguments or by explicit `typeArguments` → `silentCall`, `callWithTypes` (`src/compiler/checker/resolution/silent-choice.ts`)
- resolve and record an implicit construct call → `implicitCall` (`src/compiler/checker/resolution/implicit.ts`)
- resolve an implicit `compare` or `includes` operator call → `implicitOperatorCall` (`src/compiler/checker/resolution/implicit.ts`)
- resolve and record a prelude-owned helper call (panics if absent) → `preludeCall` (`src/compiler/checker/resolution/implicit.ts`)
- resolve a written call in a body → `resolveCall`, `recordChosen`, `explain` (`src/compiler/checker/calls/resolve.ts`)
- fit a chosen call's arguments (written or implicit) to the types they fill, or spell its argument list in a report → `filledTypes`, `fitArguments`, `argumentListText` (`src/compiler/checker/resolution/argument-fit.ts`)
- infer untyped lambda arguments after overload choice → `checkDecidedLambdas` (`src/compiler/checker/calls/lambda-arguments.ts`)
- resolve a prefix or binary operator call in a body → `resolveOperator`, `binaryApplied`, `unaryApplied`, `applied` (`src/compiler/checker/calls/operators.ts`)
- check `setIndex` element writes or synchronous collection calls → `writeElement`, `runsAtOnce` (`src/compiler/checker/calls/collection-functions.ts`)
- check an assigned or `&`-referenced place → `checkChangedPlace` (`src/compiler/checker/calls/places.ts`)
- check aliasing of `&` arguments or destructuring places → `checkReferencedPlaces`, `checkDistinctPlaces` (`src/compiler/checker/calls/places.ts`)
- mark a method receiver changed → `changeReceiver` (`src/compiler/checker/calls/places.ts`); test if a variable may change → `context.variables.isChangeable` (`src/compiler/checker/statements/variables.ts`)
- resolve a type or fieldless struct in value/pattern position → `namedType`, `nameNodeOf`, `fieldlessStructOf` (`src/compiler/checker/resolution/named.ts`)
- the type a binder entity names (a declared type with no arguments, a primitive, an alias) → `entityType` (`src/compiler/checker/types/named-types.ts`); with arguments found for a generic declaration, the one dispatch from a name to its type → `typeOfEntity` (`src/compiler/checker/types/resolve-type.ts`)
- what static functions on a type are declared on (a nominal declaration, a primitive, a shape's key), and what a static function's owner names → `staticOwnerOf`, `declaredOwnerOf`, `StaticOwner` (`src/compiler/checker/types/named-types.ts`); never resolve a static's owner another way
- the type a pattern naming an entity tests for, what it downcasts an `any` value to, or whether it names a value's own type → `patternTypeOf`, `downcastTargetOf`, `namesOwnType` (`src/compiler/checker/types/named-types.ts`); the checker's patterns and completion both read them, never their own copy
- choose a bare or qualified enum variant against an expected type → `chooseVariant` (`src/compiler/checker/resolution/named.ts`)
- check `for`/comprehension/spread iteration → `checkIterated`, `iteratedItem`, `checkLoopOver` (`src/compiler/checker/rules/iteration.ts`)

## One-way rules

- Every resolved call is built through `callMade` (`src/compiler/checker/resolution/calls-made.ts`).
- Extensible protocol calls (`iterate`, `setIndex`, `compare`, `includes`, `toString`) use `implicitCall`; prelude-owned helpers use `preludeCall`.
- Silent resolution without a written call site uses `silentCall`, or `callWithTypes` when type arguments are given (`silent-choice.ts`).

## Recipes

### Add an implicit construct or prelude call

1. Spell the function's name once in `src/language/well-known.ts`.
2. Add its role to `ImplicitRole` in `src/compiler/checker/resolved-call.ts`.
3. In the checker handler, call `preludeCall` (prelude-owned) or `implicitCall` with `topLevelCandidates` (`src/compiler/checker/resolution/implicit.ts`).
4. In lowering, read `context.body.implicitCallOf(node, role)` and emit it with `emitImplicitCall` / `emitCall` (`src/compiler/lowering/emit-call.ts`).
