---
description: building, comparing, substituting, printing and fitting checker types, well-known types, patterns and flow — read before working with Type
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-28
last_updated: 2026-10-28
tags: [reuse, checker, types, fitting, patterns, flow]
---

# Types, fitting, patterns and flow

## Units

- check a `Program` lazily and query expression types, signatures or bodies → `checkProgram`, `Checker`, `CheckedBody` (`src/compiler/checker/check.ts`)
- get built-in primitive types → `intType`, `floatType`, `boolType`, `stringType`, `unitType`, `neverType` (`src/compiler/checker/types/type.ts`)
- get `errorType`, build a primitive type, or test for a primitive → `errorType`, `primitiveType`, `isPrimitive` (`src/compiler/checker/types/type.ts`)
- build or inspect tuple types → `tupleType`, `tupleElements` (`src/compiler/checker/types/type.ts`)
- build or inspect nominal or shared-value types → `nominalType`, `isNominalEntity`, `isSharedValueType` (`src/compiler/checker/types/type.ts`)
- inspect or attach variadic type packs on function types → `isPack`, `fillsPack`, `withPack`, `packRestSlot` (`src/compiler/checker/types/type.ts`)
- compare two types or constraints for equality or fit → `sameType`, `sameConstraint`, `sameShape`, `isAssignable` (`src/compiler/checker/types/type.ts`)
- inspect or map a type's direct child types → `typeChildren`, `mapChildren` (`src/compiler/checker/types/type-parts.ts`)
- list type parameters or `any` types in a `Type` → `parametersIn`, `anyTypesIn`, `mentionsError` (`src/compiler/checker/types/type-parts.ts`)
- drop refinements (such as `sendable` on function types) at any depth → `widened` (`src/compiler/checker/types/widening.ts`)
- format a `Type` for diagnostics or instantiation names → `typeText` (`src/compiler/checker/types/type-text.ts`)
- get a canonical key for a `Type` or numeric identity for an object → `TypeKeys.typeKey`, `TypeKeys.identityOf` (`src/compiler/checker/types/type-keys.ts`)
- guard a coinductive recursive type check (`Sendable`, JSON codecs) against cycles → `TypeCycle` (`src/compiler/checker/types/type-cycle.ts`)
- build or apply a type substitution → `substitutionFor`, `substitute`, `substituteAny`, `substituteFunction` (`src/compiler/checker/types/substitution.ts`)
- view a `CheckedBody` with all recorded types substituted for one instantiation → `instantiatedBody` (`src/compiler/checker/types/instantiation.ts`)
- build or unwrap `Future<T>` or `Array<T>` → `futureOf`, `futureArgument`, `arrayOf`, `arrayElement` (`src/compiler/checker/types/well-known.ts`)
- build or unwrap any well-known type (`src/language/well-known.ts`) → `wellKnownOf`, `wellKnownArguments` (`src/compiler/checker/types/well-known.ts`)
- unwrap `T?` once or through nested optionals → `optionalInner`, `withoutOptionals` (`src/compiler/checker/types/fit.ts`)
- compute how a value fits an expected type → `fitOf`, `matchConversion`, `isExact`, `exactFit` (`src/compiler/checker/types/fit.ts`)
- unwrap a 1-element tuple type or test if a `Fit` reshapes a value → `singleElement`, `reshapes` (`src/compiler/checker/types/fit.ts`)
- check and record how a body value fits an expected type → `BodyContext.expect`, `BodyContext.fit` (`src/compiler/checker/context.ts`)
- check and record how an assignment or spread fits an expected type → `BodyContext.fitWritten`, `BodyContext.fitUnwrapped` (`src/compiler/checker/context.ts`)
- agree on one type across producers → `agreedType`, `settleAgreement`, `decidedSoFar`, `fitProduced` (`src/compiler/checker/rules/agreement.ts`)
- combine `Accepts` predicates across composite parts or producers → `partsAccept`, `agreedAccepts` (`src/compiler/checker/rules/agreement.ts`)
- collect and agree on branch bodies (`if`, `match`, `select`) → `Branches`, `branchesAccepts`, `blockAccepts` (`src/compiler/checker/rules/branches.ts`)
- check `==` / `!=` operands with optional wrapping on either side → `comparable`, `checkEqualSides` (`src/compiler/checker/types/equality.ts`)
- hint `?.`, `?[`, `?.(` or `?->` when a step fails on `T?` → `insideOptional` (`src/compiler/checker/types/inside-optional.ts`)
- search whether a type holds a matching part at any depth (`Future`, `Result`, disposable) → `heldType`, `heldParts` (`src/compiler/checker/types/held.ts`)
- check whether a declaration or type is host-provided (non-std `extern`) → `isHostExtern`, `isHostType` (`src/compiler/checker/host-externs.ts`)
- check whether an extern's types cross the host JSON boundary → `checkHostBoundary`, `crossesToHost` (`src/compiler/checker/rules/host-boundary.ts`)
- check whether a type is `Sendable` or a trait is well-known → `isSendable`, `isSendableTrait`, `isWellKnownTrait` (`src/compiler/checker/traits/sendable.ts`)
- check whether a type is `Disposable` or a function is `dispose` → `isDisposable`, `disposalOf`, `isDisposeFunction` (`src/compiler/checker/rules/disposal.ts`)
- get a well-known constraint or a trait's members → `wellKnownConstraint`, `requiredFunctions`, `requiredFields` (`src/compiler/checker/traits/constraints.ts`)
- find the field `x.f` reads and how → `fieldOf`, `structFieldOf` (`src/compiler/checker/expressions/field-reads.ts`); a required field on a concrete type → `requiredFieldRead` (`src/compiler/checker/checked-field.ts`)
- map or list constraints on a parameter or `any` → `constraintSubstitution`, `knownConstraints`, `constraintOn` (`src/compiler/checker/traits/constraints.ts`)
- look up required functions or field types on a constrained type → `requirementsNamed`, `requiredFieldType` (`src/compiler/checker/traits/constraints.ts`)
- check or resolve `any` conformance and witnesses → `meetsAny`, `reportUnmet`, `memberWitnesses` (`src/compiler/checker/resolution/trait-objects.ts`)
- walk patterns or destructuring targets → `walkPattern`, `walkTargets` (`src/compiler/checker/patterns/walk.ts`)
- find a struct item's field index → `itemField` (`src/compiler/checker/patterns/struct-items.ts`)
- take a tuple or struct target apart into its element or field parts → `takeTargets`, `takeApart`, `takeFields` (`src/compiler/checker/patterns/taking.ts`)
- analyze `match` exhaustiveness → `analyze` (`src/compiler/checker/patterns/exhaustiveness.ts`)
- list names bound by a checked pattern → `namesBound` (`src/compiler/checker/checked-pattern.ts`)
- run forward data-flow analysis over a body → `flowThrough`, `FlowRule` (`src/compiler/checker/flow/forward.ts`)
- run lazy cycle-checked queries over functions or constants → `LazyChecks` (`src/compiler/checker/lazy-checks.ts`)

## One-way rules

- Fit every value through `BodyContext.expect` / `fit` (`fitWritten` for assignments, `fitUnwrapped` for spreads) so conversions are recorded once.
- Recognize well-known types by binder entity via `src/compiler/checker/types/well-known.ts` or `optionalInner` (`fit.ts`), never by declaration name string.
- Never use a module-global counter for type or node keys; use `checker.typeKeys` (`src/compiler/checker/types/type-keys.ts`).
- Every pattern goes through `src/compiler/checker/patterns/walk.ts`, and every body flow rule goes through `flowThrough` (`flow/forward.ts`).
