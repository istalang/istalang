---
description: building, comparing, substituting, printing and fitting checker types, well-known types, patterns and flow — read before working with Type
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-29
last_updated: 2026-11-04
tags: [reuse, checker, types, fitting, patterns, flow]
---

# Types, fitting, patterns and flow

## Units

- check a `Program` lazily and query expression types, signatures or bodies → `checkProgram`, `Checker`, `CheckedBody` (`src/compiler/checker/check.ts`)
- get built-in primitive types → `intType`, `floatType`, `boolType`, `stringType`, `unitType`, `neverType` (`src/compiler/checker/types/type.ts`)
- get `errorType`, build a primitive type, or test for a primitive → `errorType`, `primitiveType`, `isPrimitive` (`src/compiler/checker/types/type.ts`); a value expected of the error type reports nothing more → `expectsError`
- build or inspect tuple types → `tupleType`, `tupleElements` (`src/compiler/checker/types/type.ts`)
- build or inspect nominal types → `nominalType`, `isNominalEntity` (`src/compiler/checker/types/type.ts`)
- build a shape (an anonymous struct type, the value behind a shared struct included), its fields in name order → `shapeType`, `byFieldName` (`src/compiler/checker/types/type.ts`); never write `{ kind: 'anonymous', … }` by hand
- the shape a nominal struct's value converts into (none for an annotated field) → `Fitting.shapeOf` (`src/compiler/checker/types/fit.ts`), answered by `Layouts.nominalShapeOf` (`src/compiler/checker/declarations/layout.ts`); the conversion is a `Fit` of kind `shape`, ranked with `reshapes`
- the field a field's declaring node declares, given its owner (a struct, an enum, a shape's `{…}` type, a trait) → `declaredFieldOf` (`src/compiler/checker/types/declared-fields.ts`)
- the type an extern or top-level constant's declaration gives it, outside any body → `declaredOutsideBodies` (`src/compiler/checker/expressions/names.ts`)
- inspect or attach variadic type packs on function types → `isPack`, `fillsPack`, `withPack`, `packRestSlot` (`src/compiler/checker/types/type.ts`)
- compare two types or constraints for equality or fit → `sameType` (key equality, the one definition of identity), `sameConstraint`, `isAssignable` (`src/compiler/checker/types/identity.ts`); two function types' parameters and results, or a function fitting another's header → `sameShape`, `functionFits` (`src/compiler/checker/types/type.ts`)
- inspect or map a type's direct child types → `typeChildren`, `mapChildren` (`src/compiler/checker/types/type-parts.ts`)
- list type parameters, nominal or `any` types in a `Type` → `parametersIn`, `nominalsIn`, `anyTypesIn`, `mentionsError` (`src/compiler/checker/types/type-parts.ts`)
- decide whether generic uses would instantiate endlessly (§3.5): build edges, find expanding ones on a cycle → `argumentEdges`, `endlessEdges` (`src/compiler/checker/types/expansion-edges.ts`)
- drop refinements (such as `sendable` on function types) at any depth → `widened` (`src/compiler/checker/types/widening.ts`)
- tell whether a result computed again has types alike in every part (aliases by declaration and an `any`'s constraint order included) → `sameTypeSpelled` (`src/compiler/checker/types/type-parts.ts`)
- strip every alias from a type, giving the type its key names, so a result kept by key never depends on its first asker's spelling → `unaliased` (`src/compiler/checker/types/type-parts.ts`)
- spell a `Type` as written, through its alias if it has one, for messages → `typeText` (`src/compiler/checker/types/type-text.ts`)
- spell a function type in parts (head, each parameter, tail), or a parameter's type with its `&` → `functionTypeParts`, `slotText` (`src/compiler/checker/types/type-text.ts`)
- show a function as an editor does, its signature with where each parameter stands in it → `signatureOf`, `functionTypeSignature` (`src/language-service/signatures.ts`)
- give a type the alias it was written through → `aliasedAs` (`src/compiler/checker/types/type.ts`); `substitute` keeps it, `widened` drops it where it widens
- get a canonical key for a `Type` or numeric identity for an object → `typeKeys.typeKey`, `typeKeys.identityOf` (`src/compiler/checker/types/type-keys.ts`)
- keep a program-wide checker result (cached, cycle-aware, its diagnostics kept with it) → `checker.entries.table()` (`EntryTable`, `src/structures/entries/index.ts`); report through `checker.report`, inside an entry
- read a module's diagnostics, or check one top-level item whole before reading what checking decided in it → `checker.diagnosticsOf`, `checker.checkItem` (`src/compiler/checker/declarations/module-checks.ts`)
- guard a recursive walk over a type's parts (`Sendable`, JSON codecs, `heldType`) against cycles → `TypeCycle` (`src/compiler/checker/types/type-cycle.ts`); never a visited set of your own
- build or apply a type substitution → `substitutionFor`, `substitute`, `substituteAny`, `substituteFunction` (`src/compiler/checker/types/substitution.ts`)
- view a `CheckedBody` with all recorded types substituted for one instantiation → `instantiatedBody` (`src/compiler/checker/types/instantiation.ts`)
- build or unwrap `Future<T>` or `Array<T>`, → `futureOf`, `futureArgument`, `arrayOf`, `arrayElement` (`src/compiler/checker/types/well-known.ts`)
- build or unwrap any well-known type (`src/language/well-known.ts`) → `wellKnownOf`, `wellKnownArguments` (`src/compiler/checker/types/well-known.ts`)
- build a union normalized (flattened, duplicates, `Never`, literals into bases, `true | false` as `Bool`), `T?`, or a literal type → `unionOf`, `optionalOf`, `literalType`, `literalOrBase` (`src/compiler/checker/types/unions.ts`); never write `{ kind: 'union', … }` by hand
- take a union apart: its members, `T` of `T?`, what remains without some members, a member it holds, a literal's base, whether a member has one value only, members an `any` member takes → `membersOf`, `optionalInner`, `hasMember`, `baseOf`, `hasOneValue`, `absorbedInto` (`src/compiler/checker/types/unions.ts`)
- tell a value converting into several members of a union apart from a mismatch → `intoSeveral` (`src/compiler/checker/types/fit.ts`)
- narrow an expected union to the member a directly built value takes → `memberBuilt` (`src/compiler/checker/types/expected.ts`), which `BodyContext.expression` runs for every expression
- take an expected type apart for a value built from it (a struct, tuple, array or map literal, a lambda, a function value, a bare variant or fieldless generic struct, lambdas inferred inside an argument) → `builtFrom`, `expectedTuple`, `collectionTarget`, `expectedFunction`, `sameNominal`, `enumsExpected`, `expectedNominal` (`src/compiler/checker/types/expected.ts`); never strip the expected optionals in a construct
- build a parameter `Type`, fill default type arguments, check type argument constraints, or resolve declared fields → `parameterType`, `typeArgumentsFor`, `defaultArgument`, `constrainArguments`, `declaredFields` (`src/compiler/checker/types/resolve-type.ts`)
- compute how a value fits an expected type → `fitOf`, `matchConversion`, `isExact`, `exactFit` (`src/compiler/checker/types/fit.ts`)
- unwrap a 1-element tuple type or test if a `Fit` reshapes a value → `singleElement`, `reshapes` (`src/compiler/checker/types/fit.ts`)
- check and record how a body value fits an expected type → `BodyContext.expect`, `BodyContext.fit` (`src/compiler/checker/context.ts`)
- check and record how an assignment or spread fits an expected type → `BodyContext.fitWritten`, `BodyContext.fitUnwrapped` (`src/compiler/checker/context.ts`)
- agree on one type across producers → `agreedType`, `settleAgreement`, `decidedSoFar`, `fitProduced` (`src/compiler/checker/rules/agreement.ts`)
- combine `Accepts` predicates across composite parts or producers → `partsAccept`, `agreedAccepts` (`src/compiler/checker/rules/agreement.ts`)
- collect and agree on branch bodies (`if`, `match`, `select`) → `Branches`, `branchesAccepts`, `blockAccepts` (`src/compiler/checker/rules/branches.ts`)
- check `==` / `!=` operands, either fitting the other's type → `comparable`, `checkEqualSides` (`src/compiler/checker/types/equality.ts`)
- hint `?.`, `?.[`, `?.(` or `?->` when a step of a link's form fails on `T?` → `insideOptional` (`src/compiler/checker/types/inside-optional.ts`)
- search whether a type holds a matching part at any depth (`Future`, `Result`, disposable) → `heldType`, `heldParts` (`src/compiler/checker/types/held.ts`)
- check whether a declaration or type is host-provided (non-std `extern`) → `isHostExtern`, `isHostType` (`src/compiler/checker/host-externs.ts`)
- check whether an extern's types cross the host JSON boundary → `checkHostBoundary`, `crossesToHost` (`src/compiler/checker/rules/host-boundary.ts`)
- check whether a type is `Sendable` → `isSendable` (`src/compiler/checker/traits/sendable.ts`)
- check whether a trait is a well-known one → `isWellKnownTrait` (`src/compiler/checker/types/well-known.ts`)
- check whether a type is `Disposable` or a function is `dispose` → `isDisposable`, `disposalOf`, `isDisposeFunction` (`src/compiler/checker/rules/disposal.ts`)
- get a well-known constraint or a trait's members → `wellKnownConstraint`, `requiredFunctions`, `requiredFields` (`src/compiler/checker/traits/constraints.ts`)
- find the field `x.f` reads and how → `fieldOf` (`src/compiler/checker/traits/constraints.ts`); a struct's field, or a required one on a concrete type → `structFieldOf`, `requiredFieldRead` (`src/compiler/checker/checked-field.ts`)
- record a field read in a body, with the field its member names → `recordFieldRead` (`src/compiler/checker/expressions/member-access.ts`); a field named in a literal, pattern or target → `BodyContext.recordField`
- read a written type's type without resolving (or reporting) anything → `CheckerContext.resolvedTypeOf` (`src/compiler/checker/context.ts`)
- map or list constraints on a parameter or `any` → `constraintSubstitution`, `substituteConstraint`, `knownConstraints`, `constraintOn` (`src/compiler/checker/traits/constraints.ts`)
- look up required functions or field types on a constrained type → `requirementsNamed`, `requiredFieldType` (`src/compiler/checker/traits/constraints.ts`)
- check or resolve `any` conformance and witnesses, a union's member by member → `meetsAny`, `reportUnmet`, `memberWitnesses` (`src/compiler/checker/resolution/trait-objects.ts`)
- decide whether a trait can be met through values whose type is known only when they run (object safety, §3.10) → `objectUnsafety` (`src/compiler/checker/traits/object-safety.ts`)
- walk patterns or destructuring targets → `walkPattern`, `walkTargets` (`src/compiler/checker/patterns/walk.ts`); declare a declaration's, `for`'s or comprehension's targets in a body → `declareTargets` (`src/compiler/checker/patterns/targets.ts`)
- find a struct item's field index → `itemField` (`src/compiler/checker/struct-items.ts`)
- take a tuple or struct target apart into its element or field parts → `takeTargets`, `takeApart`, `takeFields` (`src/compiler/checker/patterns/taking.ts`)
- analyze `match` exhaustiveness → `analyze` (`src/compiler/checker/patterns/exhaustiveness.ts`); a union's members as its constructors → `memberShape` (`patterns/shapes.ts`)
- what a pattern selects of its part before taking it apart (a downcast of an `any` value, members of a union's) → `selectionOf` (`src/compiler/checker/patterns/selections.ts`); a union's members, as a pattern names them → `memberTaken`, `unionPart` (`patterns/members.ts`); what a case's binder has left of a union → `remainingType` (`patterns/remaining.ts`), `leftOf` (`patterns/members.ts`)
- which members of a union a name, type arguments, a literal or a tuple, array or `struct{…}` pattern selects (the checker's and completion's one rule) → `membersNamed`, `variantOwners`, `instancesWith`, `literalMembers`, `kindMembers` (`src/compiler/checker/types/named-types.ts`)
- what an or-pattern's alternatives bind and select between them → `sameNames`, `partSelected` (`src/compiler/checker/patterns/alternatives.ts`); an array pattern's items → `takeArray` (`patterns/arrays.ts`)
- the literal type a literal written in place has (a string, a Bool, a maybe negated integer) → `writtenLiteral` (`src/compiler/checker/types/unions.ts`); the type it has where a type is expected → `literalOrBase`, or against a parameter still inferred → `Inference.literalType`
- the union a member parameter (`T in U`) stands for one member of → `CheckerContext.memberUnionOf` (`src/compiler/checker/context.ts`), `Fitting.memberUnionOf` where fitting reads it
- list names bound by a checked pattern → `namesBound` (`src/compiler/checker/checked-pattern.ts`)
- run forward data-flow analysis over a body → `flowThrough`, `FlowRule` (`src/compiler/checker/flow/forward.ts`)

## One-way rules

- Fit every value through `BodyContext.expect` / `fit` (`fitWritten` for assignments, `fitUnwrapped` for spreads) so conversions are recorded once.
- Recognize well-known types by binder entity via `src/compiler/checker/types/well-known.ts`, never by declaration name string; an optional is a union holding `None` (`optionalInner`, `unions.ts`).
- Key types and identities through `checker.typeKeys` (`src/compiler/checker/types/type-keys.ts`), whose numbers are the module's, alike in every checker; never write those numbers into lowering's output.
- Every pattern goes through `src/compiler/checker/patterns/walk.ts`, and every body flow rule goes through `flowThrough` (`flow/forward.ts`).
