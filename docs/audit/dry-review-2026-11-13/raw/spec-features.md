# Feature-Reduction Research (Spec, Compiler, Runtime & Stdlib)

Scope: Every language construct in `docs/spec.md`, `docs/guide.md`, `docs/arch/{architecture,definition,boundary}.md`, all 18 non-test stdlib modules (`src/stdlib/**/*.ista`), and all 792 non-test TypeScript source files (`src/**/*.ts` excluding `*.test.ts`, `*.test-kit.ts`, `*.bench.ts`).

Legend for classification (item 3 of brief):
- **(a) Already a desugaring** of another feature (either in syntax/checker or lowering/IR).
- **(b) Reducible** to another feature (can be desugared earlier or unified with an overlapping feature, eliminating dedicated AST/checker/lowering/IR/runtime machinery).
- **(c) Genuinely primitive** (irreducible core semantics).

---

## 1. Types, Type-Level Computation, Marks & Generics (§2, §3.1, §3.3, §3.5, §3.10, §3.14, §3.17)

### 1.1 Primitive types (`Int`, `Float`, `Bool`, `String`, `Unit`, `Never`, `None`) — §2
1. **What it is:** The 7 built-in scalar/bottom/unit types (`Unit` is `()`, `Bool` is `true | false`, `None`'s sole value is `none`, `Never` is the bottom type).
2. **Implementation footprint:** **37 files, 52 sites** (`PrimitiveType`, `primitiveNames`, `isPrimitive`).
   - Foundation & Definition: `foundation/language/primitives.ts` (`primitiveNames`, `PrimitiveName`, `primitiveOnceSpelled`), `foundation/language/naming.ts:builtInTypeNames`, `definition/tables/types.ts:primitive`.
   - Binder & Checker types: `compiler/binder/module/scope.ts:primitives`, `compiler/checker/types/type/index.ts:PrimitiveType`, `compiler/checker/types/type/primitives.ts` (`primitiveType`, `isPrimitive`, `tupleElements`), `compiler/checker/types/type/type-text.ts:unionText`, `compiler/checker/types/unions/unions.ts` (`optionalInner`, `presentType`, `hasOneValue`), `compiler/checker/types/unions/union-members.ts:distinctMembers`, `compiler/checker/types/unions/common-type.ts` (`commonType`, `presentPart`), `compiler/checker/types/unions/equality.ts` (`unchecked`, `isKnown`, `literalsOf`), `compiler/checker/types/fitting/fit/index.ts:ownConversion`, `compiler/checker/types/identity/identity.ts` (`assignableWith`, `neverFutureFits`), `compiler/checker/types/inference/{binding,equal,fillings,relate,system}.ts`, `compiler/checker/types/traits/{known-constraints,struct-keys}.ts`, `compiler/checker/types/written/pattern-types.ts:patternTypeOf`.
   - Checker constructs/rules & Lowering: `compiler/checker/resolution/calls/stopped-operations.ts:stoppedOperation`, `compiler/checker/resolution/type-matches/type-matches.ts:TypeMatchReductions.#reduced`, `compiler/checker/rules/agreement.ts` (`joinedAgreement`, `decidedSoFar`), `compiler/checker/constructs/expressions/{access/optionals,deferred-calls,operators/operators,postponed}.ts`, `compiler/checker/constructs/loops/field-passes.ts:fieldPassesOver`, `compiler/checker/constructs/patterns/{exhaustiveness/shapes,matching,walk/index,walk/kinds/ranges}.ts`, `compiler/lowering/constructs/loops/field-passes.ts:fieldsVisited`, `compiler/lowering/synthesized/boundary/encoder.ts:Encoder.#enum`, `compiler/lowering/values/{optionals,unions}.ts`.
3. **Classification:** **(c) Genuinely primitive** (`Int`, `Float`, `String`, `Never`), while `Unit` is already normalized to the empty tuple `()` (`tupleType([])` in `primitives.ts`) and `Bool` expands to `"true" | "false"` for exhaustiveness (`true | false`).
   - **Overlap:** `None` (a primitive type with literal `none`) vs empty struct `struct None` (`Unit` is already `()`). Keeping `None` as a primitive is small, though `None` and `Unit` both lower to `null` at runtime (`definition/values/values.ts`).

### 1.2 Unions (`A | B`) — §2
1. **What it is:** Set-theoretic untagged union type normalized at construction, laid out at runtime as a synthesized `enum` with one variant per member sorted by spelled name.
2. **Implementation footprint:** **46 files, 103 sites** (`UnionType`, `unionOf`, `intoUnion`, `outOfUnion`).
   - Syntax/Parser/Binder/Formatter: `compiler/syntax/types/index.ts:UnionType`, `compiler/parser/grammar/types.ts:parseUnionType`, `compiler/binder/constructs/types.ts:typeHandlers.UnionType`, `formatter/types.ts:typePrinters.UnionType`.
   - Checker type model & unions: `compiler/checker/types/type/index.ts:UnionType`, `compiler/checker/types/unions/unions.ts` (`unionOf`, `optionalOf`), `compiler/checker/types/unions/union-members.ts` (`distinctMembers`, `absorbingMember`), `compiler/checker/types/unions/common-type.ts`, `compiler/checker/types/unions/equality.ts:comparableAsMembers`, `compiler/checker/types/written/resolve-type.ts` (`typeHandlers.UnionType`, `unionTypeOf`), `compiler/checker/types/parts/{substitution,type-parts}.ts`, `compiler/checker/types/identity/recursive-types.ts:rebuiltFrom`.
   - Checker fitting, inference & conformance: `compiler/checker/types/fitting/fit/index.ts` (`IntoUnion`, `intoOneMember`, `membersConverted`, `intoAnyMember`, `intoMember`, `baseMember`, `ownMember`, `membersConverting`), `compiler/checker/types/inference/{equal,fillings,infer,relate}.ts`, `compiler/checker/resolution/conformance/union-traits.ts` (`MembersMeeting`, `membersCall`, `traitCallsOn`), `compiler/checker/resolution/type-matches/{type-match-patterns,type-matches}.ts`.
   - Checker constructs & Lowering: `compiler/checker/constructs/patterns/walk/{members,named-members,parts,kinds/alternatives}.ts`, `compiler/checker/constructs/patterns/exhaustiveness/shapes.ts:memberWitness`, `compiler/checker/constructs/expressions/structs/{structs,struct-comprehensions}.ts`, `compiler/checker/constructs/loops/field-passes.ts`, `compiler/checker/rules/boundary/json-forms.ts:literalsForm`, `compiler/checker/surface/constant-form.ts`, `compiler/lowering/tables/{names,type-table}.ts`, `compiler/lowering/values/{unions,holdings,optionals}.ts`, `compiler/lowering/constructs/parts/patterns.ts`, `compiler/lowering/functions/fits/index.ts:appliedFit`, `compiler/lowering/synthesized/{trait-objects,boundary/encoder}.ts`.
3. **Classification:** **(c) Genuinely primitive** in the type system; **(a) Already a desugaring** at runtime (lowered to an `enum` in `lowering/tables/type-table.ts:#unionLayout`, so the runtime interpreter has no union instruction or value kind).

### 1.3 Optionals (`T?` / `Optional<T>`) — §2, §3.8, §3.11, §4
1. **What it is:** `T?` is syntax sugar for `T | None` (aliased as `type Optional<T> = T?` in `prelude.ista`).
2. **Implementation footprint:** **24 files, 36 sites** (`OptionalType`, `wellKnown.optional`, `optionalOf`, `optionalInner`, `presentType`).
   - Syntax/Parser/Binder/Formatter: `compiler/syntax/types/index.ts:OptionalType`, `compiler/parser/grammar/types.ts:parseOptionalType`, `compiler/binder/constructs/types.ts:typeHandlers.OptionalType`, `formatter/types.ts:typePrinters.OptionalType`.
   - Checker: `compiler/checker/types/written/resolve-type.ts:typeHandlers.OptionalType`, `compiler/checker/types/written/named-types.ts:staticOwnerOf`, `compiler/checker/types/unions/unions.ts` (`optionalOf`, `optionalInner`, `presentType`), `compiler/checker/types/unions/common-type.ts` (`presentPart`, `optionalOver`, `withinOptional`), `compiler/checker/types/unions/inside-optional.ts:insideOptional`, `compiler/checker/types/fitting/expected.ts:builtFrom`, `compiler/checker/constructs/declarations/aliases/alias-recursion.ts`, `compiler/checker/constructs/expressions/access/{member-access,optionals}.ts`, `compiler/checker/constructs/patterns/matching.ts:valueShape`, `compiler/checker/rules/boundary/json-forms.ts:JsonForms.#field`.
   - Lowering & Stdlib: `compiler/lowering/tables/names.ts` (`namedUnionOf`, `optionalOfOne`), `compiler/lowering/values/optionals.ts`, `compiler/lowering/constructs/expressions/collections/collections.ts:optionalInt`, `definition/values/declared-values.ts:optionalOf`, `stdlib/values/results.ts:resultOptional`, `stdlib/{prelude/arrays,regex/natives,strings/natives}.ts`.
3. **Classification:** **(a) Already a desugaring** of `T | None` (`UnionType`). The remaining sites are for the `?.` / `??` / `!` operators (see §4.11–4.13), common-type inference with `None` (`if c: 1 else: none` -> `Int?`), and spelling `T | None` as `prelude.Optional<T>` in extern keys and static lookup (`Optional.default`, `Optional.fromJson`).

### 1.4 Literal types (`"draft"`, `42`, `-1`, `true`) — §2
1. **What it is:** Singleton types of `String`, `Int`, or `Bool` literals that widen to their base primitive when mutable or agreeing, and fit their base type.
2. **Implementation footprint:** **50 files, 77 sites** (`LiteralType`, `literalType`, `baseOf`).
   - Syntax/Parser/Binder/Formatter: `compiler/syntax/types/index.ts:LiteralType`, `compiler/parser/grammar/types.ts` (`parseLiteralType`, `literalType`), `compiler/binder/constructs/types.ts:typeHandlers.LiteralType`, `formatter/types.ts:typePrinters.LiteralType`.
   - Checker types/unions/fitting/inference: `compiler/checker/types/type/index.ts:LiteralType`, `compiler/checker/types/type/primitives.ts` (`literalType`, `markType`, `sendType`), `compiler/checker/types/written/resolve-type.ts:typeHandlers.LiteralType`, `compiler/checker/types/written/pattern-types.ts` (`membersOfType`, `literalMembers`), `compiler/checker/types/unions/union-members.ts` (`baseOf`, `absorbingMember`), `compiler/checker/types/unions/unions.ts` (`writtenLiteral`, `literalOrBase`, `literalsBase`), `compiler/checker/types/unions/widening.ts:widened`, `compiler/checker/types/unions/equality.ts:comparable`, `compiler/checker/types/fitting/fit/index.ts:isLiteralOf`, `compiler/checker/types/inference/{binding,fillings,infer,matching}.ts`, `compiler/checker/types/traits/{known-constraints,known-fields,struct-keys}.ts`.
   - Checker constructs/resolution/rules: `compiler/checker/constructs/expressions/{access/optionals,collections/joining-literals,literals/indented-values,structs/literal-fields/items,structs/struct-comprehensions}.ts`, `compiler/checker/constructs/patterns/walk/{selections,named-members,kinds/struct-fields}.ts`, `compiler/checker/resolution/{applying/argument-fit,calls/resolve/index,choosing/call-arguments,conformance/declared-witness,conformance/met-instantiations/witness-bindings,conformance/shortfalls,type-matches/type-match-patterns}.ts`, `compiler/checker/rules/boundary/json-forms.ts` (`JsonForms.#form`, `literalsForm`), `compiler/checker/surface/json-form.ts:LiteralGroup`, `compiler/checker/lookup/key-denotations.ts`.
   - Lowering & Editor: `compiler/lowering/values/{unions,holdings}.ts`, `compiler/lowering/functions/fits/index.ts:baseOfAll`, `compiler/lowering/constructs/parts/patterns.ts:lowerMemberTest`, `compiler/lowering/synthesized/boundary/{encoder,decoder}.ts`, `compiler/lowering/tables/{instances,names,type-table}.ts`, `editor/language-service/completion/{candidate,places/patterns/pattern}.ts`.
3. **Classification:** **(c) Genuinely primitive** in the type system (powers `Mark`, `Persistence`, `Sendability`, `keyof S`, and string/int/bool literal unions); **(a) Already a desugaring** at runtime (a lone literal type is its base primitive value; a union of literals is an enum with fieldless variants).

### 1.5 Tuple types (`(A, B)`, `(A,)`, `()`) & one-element tuple conversion — §3.15
1. **What it is:** Positional product type `(A, B)` (`()` is `Unit`), plus a bidirectional top-level implicit conversion between `(T,)` and `T` (`tupled` / `untupled`).
2. **Implementation footprint:** **19 files, 30 sites** (`TupleType`, `tupleType`, `singleElement`, `singleConversion`, `tupled`, `untupled`).
   - Syntax/Parser/Binder/Formatter: `compiler/syntax/types/index.ts:TupleType`, `compiler/parser/grammar/types.ts:parseTupleType`, `compiler/binder/constructs/types.ts:typeHandlers.TupleType`, `formatter/types.ts:typePrinters.TupleType`, `formatter/layout/brackets.ts:standingIn`.
   - Checker & Lowering: `compiler/checker/types/type/index.ts:TupleType`, `compiler/checker/types/type/primitives.ts:tupleType`, `compiler/checker/types/written/resolve-type.ts` (`typeHandlers.TupleType`, `referenceItems`, `referent`), `compiler/checker/types/fitting/fit/index.ts` (`singleConversion`, `singleElement`, `retuples`, `reshapes`), `compiler/checker/types/type/function-types.ts:restOf`, `compiler/checker/resolution/choosing/packs.ts:packOf`, `compiler/checker/constructs/{declarations/aliases/alias-recursion,expressions/collections/literals,loops/field-passes,statements/assignments}.ts`, `compiler/checker/rules/computation/forms.ts:convertedForm`, `compiler/checker/surface/json-form.ts:DerivedForm`, `compiler/lowering/functions/fits/index.ts:convertedValue`, `compiler/lowering/functions/fits/parts.ts:rebuiltTuple`, `compiler/lowering/tables/names.ts:structureKeyType`.
3. **Classification:**
   - Tuple types themselves: **(c) Genuinely primitive** (though note overlap with anonymous structs `{ _0: A, _1: B }`).
   - Bidirectional `(T,)` <-> `T` implicit conversion (`tupled` / `untupled`): **(b) Reducible / removable**! It is used **0 times** in `src/stdlib/**/*.ista` and exists only for a spec remark ("so a pack of one reads as its value"), yet requires special non-compositional guards (`retuples` in `fit/index.ts` to stop `Array<(T,)>` <-> `Array<T>` from creating a subtyping cycle, `singleConversion`, `singleElement`, `tupled`/`untupled` in `forms.ts` and `lowering/functions/fits/index.ts` — **4 files, 10 sites**).

### 1.6 Anonymous struct types / shapes (`{ a: Int, b: String }` / `struct { … }`) & nominal-to-shape conversion — §3.1
1. **What it is:** Structural record type identified by its field names and types in sorted order, plus implicit conversion from an unannotated nominal `struct` to its equal shape.
2. **Implementation footprint:** **35 files, 72 sites** (`StructType`, `AnonymousStructType`, `shapeType`, `rebuiltAs`, `nominalShapeOf`).
   - Syntax/Parser/Binder/Formatter: `compiler/syntax/types/index.ts:StructType`, `compiler/parser/grammar/parts/structs.ts`, `compiler/binder/constructs/types.ts` (`typeHandlers.StructType`, `bindStructType`), `formatter/types.ts:typePrinters.StructType`.
   - Checker: `compiler/checker/types/type/index.ts` (`AnonymousStructType`, `shapeType`), `compiler/checker/types/written/key-types.ts:structWritten`, `compiler/checker/constructs/declarations/layout/index.ts` (`Layouts.sharedValueOf`, `Layouts.nominalShapeOf`), `compiler/checker/constructs/expressions/structs/{structs,literal-types}.ts`, `compiler/checker/types/fitting/fit/index.ts:convertedInto` (`kind: 'shape'`), `compiler/checker/types/fitting/fit/parts.ts:fitsByParts`, `compiler/checker/types/inference/{infer,matching}.ts`, `compiler/checker/rules/computation/forms.ts` (`convertedForm`, `structForm`), `compiler/checker/rules/boundary/json-forms.ts:JsonForms.#form`, `compiler/checker/wiring/body/facts/instantiation.ts`.
   - Lowering: `compiler/lowering/functions/fits/index.ts:convertedValue` (`case 'shape'`), `compiler/lowering/functions/fits/parts.ts:rebuiltStruct`, `compiler/lowering/values/struct-values.ts:rebuiltAs`, `compiler/lowering/tables/{names,type-table}.ts`.
3. **Classification:**
   - Anonymous struct types (`AnonymousStructType`): **(c) Genuinely primitive** (structural record type used by mapped types, struct comprehensions, rest patterns, and shared struct value shapes).
   - **Internal duplication in nominal-to-shape conversion (`Conversion` `{ kind: 'shape' }` vs `{ kind: 'parts' }`):** **(b) Reducible!** `fitsByParts` (`checker/types/fitting/fit/parts.ts:56`), `rebuilt` (`lowering/functions/fits/parts.ts:151`), and `partsForm` (`checker/rules/computation/forms.ts:155`) **already** handle converting a nominal struct to an `AnonymousStructType` (both when field types are identical and when field types convert part-by-part!). The separate `{ readonly kind: 'shape'; readonly to: AnonymousStructType }` variant in `Conversion` (`fit/index.ts`, `instantiation.ts`, `forms.ts`, `lowering/functions/fits/index.ts`) is 100% redundant with `{ readonly kind: 'parts'; readonly to: Type }`.

### 1.7 Function types (`fn(A) -> R`, `Fn<Args, Result, Kind, Send>`) & plain-to-async conversion — §3.14
1. **What it is:** Structural function type parameterized by parameter tuple/pack `Args`, `Result`, mark `Kind in Mark = "simple"`, and `Send in Sendability = "plain"`, where `K async fn(A) -> R` is `Fn<(A,), Future<R, K>, K>` and plain `fn(A) -> R` converts to `K async fn(A) -> R`.
2. **Implementation footprint:** **47 files, 102 sites** (`FunctionType`, `wellKnown.fn`, `functionType`, `AsyncFit`, `madeAsync`).
   - Syntax/Parser/Binder/Formatter: `compiler/syntax/types/index.ts` (`FunctionType`, `RestType`), `compiler/parser/grammar/types.ts:parseFunctionType`, `compiler/binder/constructs/types.ts:typeHandlers.FunctionType`, `formatter/types.ts:typePrinters.FunctionType`.
   - Checker: `compiler/checker/types/type/index.ts:FunctionType`, `compiler/checker/types/type/function-types.ts` (`functionType`, `functionFits`, `resultFitOf`, `madeAsync`), `compiler/checker/types/written/resolve-type.ts:writtenFunctionType`, `compiler/checker/types/fitting/fit/index.ts:asyncFitOf`, `compiler/checker/types/fitting/fit/parts.ts:functionFitsByParts`, `compiler/checker/types/fitting/part-pairs.ts` (`functionPairs`, `resultFitBetween`), `compiler/checker/constructs/closures/{lambdas,function-values,nested-types,value-calls}.ts`, `compiler/checker/resolution/choosing/named-functions.ts`.
   - Lowering: `compiler/lowering/functions/fits/index.ts` (`asyncFitClosure`, `asyncFitEntry`, `wrappingEntry`, `returnedAs`), `compiler/lowering/tables/{instances,tables}.ts` (`AsyncFit`, `asyncFitIndex`, `asyncFitHeader`), `compiler/lowering/lower.ts` (`case 'asyncFit'`).
3. **Classification:**
   - `Fn<Args, Result, Kind, Send>` as the single function type representation: **(a) Already a desugaring** (`fn(...) -> R` and `K async fn(...) -> R` both resolve to `FunctionType`).
   - **Internal duplication in plain-to-async conversion (`Conversion` `{ kind: 'async' }` / `AsyncFit` vs `{ kind: 'parts' }` / `wrappingEntry`):** **(b) Reducible!** In `checker/types/fitting/fit/parts.ts:functionFitsByParts` and `lowering/functions/fits/index.ts:wrappingEntry` (`returnedAs`), `{ kind: 'parts' }` **already** wraps a plain function into an async function (and converts parameters/results when needed). Even inside `lowering/functions/fits/index.ts:applyingIn` (line 195), `madeAsync` literally delegates to `{ kind: 'wrapping', from: plain, to, at }`! Eliminating `{ kind: 'async' }` and `AsyncFit` removes **9 files, 23 sites** (`asyncFitOf`, `madeAsync`, `AsyncFit`, `asyncFitKey`, `asyncFitName`, `asyncFitHeader`, `asyncFitIndex`, `asyncFitClosure`, `asyncFitEntry`).

### 1.8 Existential trait objects (`any A & B`) — §3.10
1. **What it is:** Type of values of any concrete type meeting object-safe traits `A & B`, lowered to a closed per-`any`-type `enum` with one variant per concrete type converted into it and synthesized `switch` dispatch entries.
2. **Implementation footprint:** **45 files, 100 sites** (`AnyType`, `intoAny`, `convertedIntoAny`, `traitObjects`, `dispatchEntry`, `anyConversionEntry`, `anyFieldEntry`).
   - Syntax/Parser/Binder/Formatter: `compiler/syntax/types/index.ts:AnyType`, `compiler/parser/grammar/types.ts:parseAnyType`, `compiler/binder/constructs/types.ts:typeHandlers.AnyType`, `formatter/types.ts:typePrinters.AnyType`.
   - Checker: `compiler/checker/types/type/index.ts:AnyType`, `compiler/checker/types/traits/object-safety.ts`, `compiler/checker/types/traits/any-types.ts`, `compiler/checker/resolution/conformance/met-instantiations/index.ts`, `compiler/checker/types/fitting/fit/index.ts` (`convertedInto`, `intoAnyMember`), `compiler/checker/constructs/patterns/walk/{selections,kinds/downcasts,kinds/alternatives}.ts`, `compiler/checker/rules/lifetimes/dispatch.ts`.
   - Lowering: `compiler/lowering/values/into-any.ts:convertedIntoAny`, `compiler/lowering/values/holdings.ts`, `compiler/lowering/synthesized/trait-objects.ts` (`dispatchEntry`, `anyConversionEntry`, `anyFieldEntry`), `compiler/lowering/tables/type-table.ts` (`anyMembers`, `anyVariant`).
3. **Classification:** **(a) Already a desugaring** at runtime (lowered to an `enum` + synthesized `switch` functions in `lowering/synthesized/trait-objects.ts`; the runtime interpreter has no vtable or trait-object value kind). **(c) Genuinely primitive** in the checker (open existential vs closed union).

### 1.9 Associated types (`type Data = T`, `T.Data`) — §3.1, §3.6, §3.10
1. **What it is:** Type member declared inside a `struct`, `shared struct`, `extern struct`, or `enum` (`AssociatedType`), required in a `trait` (`RequiredAssociatedType`), and projected via `T.Name` (`MemberType` / `NamedType` / `AssociatedOfType`).
2. **Implementation footprint:** **35 files, 78 sites** (`AssociatedType`, `RequiredAssociatedType`, `MemberType`, `AssociatedOfType`, `ownAssociatedType`).
   - Syntax/Parser/Binder/Formatter: `compiler/syntax/declarations/index.ts` (`AssociatedType`, `RequiredAssociatedType`), `compiler/syntax/types/index.ts:MemberType`, `compiler/parser/grammar/declarations/type-declarations.ts`, `compiler/parser/grammar/types.ts`, `compiler/binder/constructs/{declarations,types}.ts`, `formatter/{declarations,types}.ts`.
   - Checker: `compiler/checker/types/type/computed-types.ts` (`AssociatedOfType`, `ownAssociatedType`), `compiler/checker/constructs/declarations/aliases/index.ts`, `compiler/checker/constructs/declarations/type-parameters.ts` (`associatedBoundsOf`, `resolveAssociatedBounds`), `compiler/checker/types/traits/{data-kind,known-constraints,member-bounds}.ts`, `compiler/checker/types/parts/computed-reduction.ts`, `compiler/checker/resolution/conformance/{conformance,shortfalls}.ts`, `compiler/checker/resolution/type-matches/reduction-requirements.ts`.
3. **Classification:** **(c) Genuinely primitive** in the type system; erased before runtime (reduced by `computed-reduction.ts` per instantiation so lowering never sees `AssociatedOfType`).
   - **Minor AST overlap:** `T.Data` is represented as `NamedType` (when `T` is a plain path) OR `MemberType` (when the owner has type arguments `Field<Int>.Data` or parentheses `(A).Data`). Unifying qualified type access so `MemberType` handles any `owner.Name` (or `NamedType` holds an optional `owner: TypeNode`) would remove the split between `NamedType` trailing path segments and `MemberType`.

### 1.10 Key types (`keyof S`), indexed field types (`S[K]`), and mapped struct types (`{ [F in keyof S]: T }`) — §3.1, §3.5
1. **What it is:** Compile-time reflection over a struct's field names (`keyof S` -> union of String literal types), field types (`S[K]`), and structural record mapping (`{ [F in K]: T }`).
2. **Implementation footprint:**
   - `KeyofType` & `IndexedType` (`KeysType`, `FieldOfType`, runtime `s[k]`): **28 files, 54 sites**.
   - `MappedField` & `MappedType`: **10 files, 22 sites**.
   - Key files: `compiler/syntax/types/index.ts` (`KeyofType`, `IndexedType`, `MappedField`), `compiler/parser/grammar/{types,parts/structs}.ts`, `compiler/binder/constructs/types.ts`, `compiler/checker/types/type/computed-types.ts` (`KeysType`, `FieldOfType`, `MappedType`), `compiler/checker/types/written/key-types.ts` (`structWritten`, `mappedKeysWritten`, `fieldWritten`), `compiler/checker/types/traits/struct-keys.ts` (`keysOf`, `withoutKeys`, `fieldTypeOf`, `mappedTypeOf`), `compiler/checker/types/parts/computed-reduction.ts`, `compiler/lowering/values/keyed-fields.ts` (`readKeyed`, `writeKeyed`, `lowerKeyRead`, `eachKeyedField`).
3. **Classification:** **(c) Genuinely primitive** in the type checker for generic form/schema programming; erased at instantiation time (`KeysType` reduces to a union of String literals, `FieldOfType` to the field's type, `MappedType` to an `AnonymousStructType`). At runtime, `s[k]` lowers to a `field` instruction (when `k` is a single key) or a `switch` on the key union's tag (`lowering/values/keyed-fields.ts`).

### 1.11 Struct constraints (`S is struct { title: String, [_] is FormNode }`) — §3.5
1. **What it is:** Constraint on a type parameter requiring it to be a declared struct whose named fields and remaining `[_]` fields match specified types or constraints.
2. **Implementation footprint:** **21 files, 71 sites** (`StructConstraint`, `FieldTypeEntry`, `FieldConstraintEntry`, `OtherFields`, `StructConstraintModel`).
   - Syntax/Parser/Binder/Formatter: `compiler/syntax/types/index.ts` (`StructConstraint`, `OtherFields`, `FieldTypeEntry`, `FieldConstraintEntry`), `compiler/parser/grammar/parts/constraints.ts`, `compiler/binder/constructs/types.ts:bindStructConstraint`, `formatter/types.ts`.
   - Checker: `compiler/checker/types/type/struct-constraint.ts:StructConstraintModel`, `compiler/checker/types/traits/{struct-constraints,known-constraints,known-fields,struct-keys}.ts`, `compiler/checker/constructs/declarations/type-parameters.ts:resolveStructConstraints`, `compiler/checker/resolution/conformance/shortfalls.ts:structShortfall`, `compiler/checker/resolution/type-matches/type-match-patterns.ts`.
3. **Classification:** **(c) Genuinely primitive** in the type system; erased at runtime.
   - **Overlap:** Trait field requirements (`trait HasTitle { title: String }`, §3.10) vs struct constraints (`S is struct { title: String }`, §3.5). Both constrain a type parameter to have `title: String`, except a trait field requirement is read-only (since `any HasTitle` can satisfy it) and allows nominal or shape structs, whereas `struct { title: String }` allows mutation (`s.title = ...`) and `[_]` rest constraints and `keyof S` / field loops.

### 1.12 Type `match` (`type Out<D> = match D: case Field<infer T>: T`) & `infer` — §3.17
1. **What it is:** Pattern-matching conditional type alias / associated type body with `infer T` type variables, union distribution, and equi-recursive fixed-point closure.
2. **Implementation footprint:** **20 files, 55 sites** (`TypeMatch`, `TypeCase`, `InferType`, `MatchType`, `isTypeMatchBodied`, `reduceTypeMatch`).
   - Syntax/Parser/Binder/Formatter: `compiler/syntax/types/index.ts` (`TypeMatch`, `TypeCase`, `InferType`), `compiler/syntax/types/type-matches.ts`, `compiler/parser/grammar/declarations/type-matches.ts:parseTypeMatch`, `compiler/binder/constructs/types.ts` (`bindAliasBody`, `bindTypeCase`, `typeHandlers.InferType`), `formatter/types.ts`.
   - Checker: `compiler/checker/types/type/computed-types.ts:MatchType`, `compiler/checker/types/written/{type-match,written-matches}.ts`, `compiler/checker/resolution/type-matches/{type-matches,type-match-patterns,reduction-requirements}.ts`, `compiler/checker/constructs/declarations/aliases/{index,alias-recursion,recursive-bodies}.ts`, `compiler/checker/rules/expansion/type-matches.ts`.
3. **Classification:** **(c) Genuinely primitive** in the type checker; erased before lowering once concrete type arguments are substituted.

### 1.13 Type aliases & recursive aliases (`type Tree<T> = T | Array<Tree<T>>`) — §3.17
1. **What it is:** Transparent type synonym (`TypeAliasDeclaration`) and equi-recursive structural types (`RecursiveType`) represented as minimized DFA/term graphs.
2. **Implementation footprint:** **40 files, 110 sites** (`TypeAliasDeclaration`, `RecursiveType`, `aliasRecursion`, `unfolded`, `foldType`).
   - Syntax/Parser/Binder/Formatter: `compiler/syntax/declarations/index.ts:TypeAliasDeclaration`, `compiler/parser/grammar/declarations/type-declarations.ts`, `compiler/binder/constructs/declarations.ts`, `compiler/binder/link/qualifiers.ts:aliasedEntity`, `formatter/declarations.ts`.
   - Checker & Lowering: `compiler/checker/constructs/declarations/aliases/{index,alias-recursion,recursive-bodies}.ts`, `compiler/checker/types/identity/{recursive-types,recursive-terms,folding,unfolding-pairs,type-keys}.ts`, `compiler/checker/types/type/{computed-types,alias-uses}.ts`, `compiler/lowering/tables/{type-table,names}.ts`, `definition/tables/types.ts:recursiveAlias`.
3. **Classification:** Non-recursive aliases are **(a) Already a desugaring** (transparent `WrittenThrough` annotation on `Type`); recursive types are **(c) Genuinely primitive** (minimized equi-recursive graph in checker, index-referential table entry in `Definition.types`).

### 1.14 Generics, Variance (`gives`/`takes`), Packs (`<...A>`), and Member Type Parameters (`<K in U>`) — §3.5
1. **What it is:** Parametric polymorphism monomorphized per concrete instantiation, with derived/written variance, tuple packs `<...A>`, and union-member parameters `<K in U>`.
2. **Implementation footprint:**
   - Variance (`VarianceMarker`, `varianceOf`, `partPairs`, `changesLayout`, `rebuilt`): **21 files, 41 sites**.
   - Packs (`isPack`, `PackType`, `packElements`): **22 files, 31 sites** (`compiler/lowering/calls/packs.ts`, `compiler/checker/resolution/choosing/packs.ts`, etc.).
   - Member parameters (`memberOf`, `isMemberParameter`, `namesOneType`): **23 files, 33 sites**.
3. **Classification:** **(c) Genuinely primitive** in the checker; **(a) Already a desugaring** at lowering/runtime (generics monomorphize per instantiation; packs flatten into concrete tuple parameters in `lowering/calls/packs.ts`; member parameters instantiate to each concrete literal/member type).

### 1.15 Marks (`simple`, `live`, `ista`), `Mark` / `Persistence`, and `DataKind` — §3.3, §3.5, §3.10
1. **What it is:** Effect/data-color discipline keeping persistent (`ista`) and in-memory (`live`) code and data apart, with unmarked (`simple`) code below both in the `Mark` partial order, plus the compiler-derived `DataKind<K>` trait for associated types.
2. **Implementation footprint:** **38 files, 71 sites** (`Mark`, `Persistence`, `wellKnown.dataKind`, `markOrder`, `valueKindsOf`, `kindOfFunction`, `call-kinds.ts`, `mark-orders.ts`, `data-kinds.ts`).
   - Foundation & Definition: `foundation/language/well-known/index.ts` (`marks`, `persistences`, `wellKnown.dataKind`), `foundation/language/call-rule.ts`, `definition/tables/functions.ts:codeMode`, `definition/validation/entries.ts`.
   - Checker & Lowering: `compiler/checker/types/type/{function-kinds,mark-orders}.ts`, `compiler/checker/types/properties/{value-kinds,qualifiers}.ts`, `compiler/checker/types/traits/data-kind.ts`, `compiler/checker/resolution/applying/call-kinds.ts`, `compiler/checker/resolution/conformance/{kind-settling,derived-traits}.ts`, `compiler/checker/rules/kinds/data-kinds.ts`, `compiler/lowering/functions/modes.ts`.
3. **Classification:** **(c) Genuinely primitive** (core workflow safety invariant). Note that `Mark` and `Sendability` already share the generic `QualifierOrder` lattice in `compiler/checker/types/type/mark-orders.ts`.

### 1.16 `Sendable` and `Sendability` (`sendable fn`) — §3.1, §3.10, §3.14
1. **What it is:** Compiler-derived marker trait `Sendable` for values that can cross instances (`spawn`) or the host boundary (via `Encodable`/`Decodable`), plus the `"sendable" < "plain"` qualifier order on function types (`Fn<Args, Result, Kind, Send>`).
2. **Implementation footprint:** **12 files, 19 sites** (`wellKnown.sendable`, `Sendability`, `sendFits`, `capturedSend`, `isSendable`).
   - `compiler/checker/types/traits/sendability.ts` (`isSendable`, `capturedSend`), `compiler/checker/resolution/conformance/derived-traits.ts`, `compiler/checker/types/traits/constraint-implication.ts`, `compiler/checker/rules/boundary/host-boundary.ts`, `compiler/checker/resolution/calls/deferred-arguments.ts`.
3. **Classification:** **(c) Genuinely primitive** rule in the checker; erased at runtime.

---

## 2. Declarations, References, Closures & Modules (§3.1–§3.18)

### 2.1 Struct declarations (`struct Pair<A, B>: …`) — §3.1
1. **What it is:** Nominal value-type record declaration with typed fields (optional defaults/annotations) and optional associated types, laid out in alphabetical field-name order.
2. **Implementation footprint:** **36 files, 52 sites** (`StructDeclaration`).
   - Syntax/Parser/Binder/Formatter: `compiler/syntax/declarations/index.ts:StructDeclaration`, `compiler/parser/grammar/declarations/type-declarations.ts:parseStruct`, `compiler/binder/constructs/declarations.ts:declarationHandlers.StructDeclaration`, `formatter/declarations.ts:declarationPrinters.StructDeclaration`.
   - Checker & Lowering: `compiler/checker/constructs/declarations/declarations.ts:declarationHandlers.StructDeclaration`, `compiler/checker/constructs/declarations/layout/{index,struct-rules}.ts`, `compiler/checker/rules/boundary/json-forms.ts:JsonForms.#nominal`, `compiler/lowering/tables/type-table.ts`, `definition/tables/types.ts:struct`.
3. **Classification:** **(c) Genuinely primitive** nominal product type.
   - **Overlap:** Overlaps heavily with `SharedStructDeclaration` (`shared struct`), which has the exact same AST shape (`StructOf<Kind>` in `compiler/syntax/declarations/index.ts:156`) — see §2.2.

### 2.2 Shared structs (`shared struct X`), `new X{…}`, and dereference (`*x`, `x->f`, `x?->f`) — §3.18, §3.9
1. **What it is:** Nominal handle type backed by a mutable heap cell holding an anonymous struct of its declared fields, constructed exclusively with `new X{…}` (`NewStructLiteral`) and accessed/mutated exclusively via `*x`, `x->f`, and `x?->f` (`Dereference`).
2. **Implementation footprint:** **65 files, 116 sites** (`SharedStructDeclaration`: 30 files/39 sites; `NewStructLiteral`: 17 files/25 sites; `Dereference`: 17 files/30 sites; `newCell`/`readCell`/`writeCell`: 9 files/22 sites).
   - Syntax/Parser/Binder/Formatter: `compiler/syntax/declarations/index.ts:SharedStructDeclaration`, `compiler/syntax/expressions/index.ts` (`NewStructLiteral`, `Dereference`), `compiler/parser/grammar/declarations/type-declarations.ts:parseSharedStruct`, `compiler/parser/grammar/expressions/literals/struct-literals.ts:parseNew`, `compiler/parser/grammar/expressions/{operators,postfix}.ts` (`parseDereference`, `arrowParselet`), `compiler/binder/constructs/{declarations,expressions}.ts`, `formatter/{declarations,expressions/index}.ts`.
   - Checker: `compiler/checker/constructs/declarations/declarations.ts:declarationHandlers.SharedStructDeclaration`, `compiler/checker/constructs/declarations/layout/index.ts:Layouts.sharedValueOf`, `compiler/checker/constructs/expressions/structs/structs.ts:checkNew`, `compiler/checker/constructs/expressions/access/dereference.ts` (`checkDereference`, `valueBehind`), `compiler/checker/resolution/calls/places.ts` (`changePlace`, `checkReferencedPlaces`, `throughShared`, `placeIdentity`, `accessorsOf`), `compiler/checker/rules/flow/build/{expressions,literals,places}.ts`.
   - Lowering, Definition IR & Runtime: `compiler/lowering/constructs/expressions/structs/structs.ts:lowerNewStructLiteral`, `compiler/lowering/values/struct-values.ts:structValue`, `compiler/lowering/constructs/parts/places.ts` (`locate`, `lowerDereference`, `sharedAccessor`), `definition/instructions/data.ts` (`newCell`, `readCell`, `writeCell`), `definition/tables/types.ts` (`externRole` `'shared'`), `runtime/interpreter/{instructions,registers}.ts` (`newCell`, `readCell`, `writeCell`).
3. **Classification:** **(b) Reducible (3-level reduction opportunity):**
   - **Level 1 (AST node unification):** `SharedStructDeclaration` and `StructDeclaration` have identical fields (`StructOf<Kind>`), and `NewStructLiteral` and `StructLiteral` have identical fields (`type`, `items`; note `IndentedValue` already uses a boolean `readonly isNew: boolean` instead of a second node kind!). Replacing `SharedStructDeclaration` with `isShared: boolean` on `StructDeclaration` and `NewStructLiteral` with `isNew: boolean` on `StructLiteral` eliminates 2 AST node kinds across **42 files, 64 sites**.
   - **Level 2 (IR/Runtime cell unification with `_Cell<T>`):** The Definition IR and runtime maintain two parallel mutable-cell mechanisms: (i) explicit `newCell`/`readCell`/`writeCell` instructions + `role: 'shared'`, and (ii) `CodeFunction.cells` + `wellKnown.cell` (`_Cell<T>`) + `role: 'cell'` + implicit cell checks on every `readRegister`/`writeRegister`/`capturedContents` in `runtime/interpreter/registers.ts` (**22 files, 45 sites**). Unifying variable cells onto `newCell`/`readCell`/`writeCell` (or `Shared<T>`) eliminates `CodeFunction.cells`, `prelude._Cell`, `wellKnown.cell`, `role: 'cell'`, and the per-register branch in `readRegister`/`writeRegister`.
   - **Level 3 (Spec-level overlap with `struct` + `Shared<T>`):** Every `shared struct X { f: A, g: B }` is isomorphic to a nominal `struct X` wrapping `Shared<{ f: A, g: B }>` (or `shared struct` being a `struct` whose storage is a cell without needing separate `new` and `->` syntax, since the declaration `shared struct X` already statically determines whether `X` is a handle).

### 2.3 Enum declarations (`enum Result<T, E = Error>`) & variant constructors — §3.11
1. **What it is:** Nominal sum type whose variants carry positional/named/defaulted/rest fields (`Variant`) and act as static constructor functions (`fn E.V<P…>(fields) -> E<P…>`).
2. **Implementation footprint:** **60 files, 149 sites** (`EnumDeclaration`, `Variant`, `variantsOf`, `buildVariant`, `calledVariant`, `constructorEntry`).
   - Syntax/Parser/Binder/Formatter: `compiler/syntax/declarations/index.ts` (`EnumDeclaration`, `Variant`), `compiler/syntax/declarations/field-defaults.ts` (`ConstructedVariant`, `constructedVariant`, `fieldsFunctionOf`), `compiler/parser/grammar/declarations/type-declarations.ts:parseEnum`, `compiler/binder/constructs/declarations.ts:bindEnum`, `compiler/binder/entities.ts:VariantEntity`, `formatter/declarations.ts`.
   - Checker & Lowering: `compiler/checker/constructs/declarations/layout/index.ts:Layouts.variantsOf`, `compiler/checker/constructs/expressions/structs/variants.ts`, `compiler/checker/resolution/choosing/named-functions.ts:variantConstructors`, `compiler/lowering/values/variant-values.ts`, `compiler/lowering/constructs/expressions/structs/variants.ts`, `compiler/lowering/functions/built-entries.ts:constructorEntry`, `definition/instructions/data.ts:variant`, `definition/tables/types.ts:enumeration`.
3. **Classification:** **(c) Genuinely primitive** runtime sum type (every union and `any` type also lowers to an `enum`). Variant constructors with fields are **(a) Already a desugaring** into `FieldsFunction` (`syntax/declarations/field-defaults.ts`), sharing parameter checking and prologue default lowering with functions and struct field defaults!

### 2.4 Field defaults & `FieldsFunction` (`struct Retry { times: Int = 3, backoff = times * 2 }`) — §3.1, §3.11
1. **What it is:** Default expressions on struct or enum variant fields, where each default can reference earlier fields and omit its type annotation.
2. **Implementation footprint:** **26 files, 50 sites** (`FieldsFunction`, `fieldsFunctionOf`, `isFieldsFunction`, `constructedVariant`, `structEntry`, `constructorEntry`).
   - `compiler/syntax/declarations/field-defaults.ts` synthesizes a `FunctionDeclaration` (`FieldsFunction`) whose parameters are the struct's or variant's fields, so parameter type inference, cycle detection, lifetime analysis, data-kind checking, and prologue `given`/`body` lowering are shared with function parameter defaults.
3. **Classification:** **(a) Already a desugaring** into `FunctionDeclaration` (`FieldsFunction`).

### 2.5 Traits (`trait Addable<T = Self>`) & structural conformance — §3.10
1. **What it is:** Structural interface requiring functions (methods, free functions, or static functions on `Self`), read-only fields, and associated types, satisfied by coherence-checked functions declared in the type's or trait's module.
2. **Implementation footprint:** **57 files, 124 sites** (`TraitDeclaration`, `RequiredAssociatedType`, `witnessesFor`, `conformance.ts`, `declared-witness.ts`).
   - Syntax/Parser/Binder/Formatter: `compiler/syntax/declarations/index.ts:TraitDeclaration`, `compiler/parser/grammar/declarations/type-declarations.ts:parseTrait`, `compiler/binder/constructs/declarations.ts:bindTrait`, `compiler/binder/entities.ts:SelfEntity`, `formatter/declarations.ts`.
   - Checker: `compiler/checker/constructs/declarations/declarations.ts:declarationHandlers.TraitDeclaration`, `compiler/checker/resolution/conformance/{conformance,declared-witness,default-witness,derived-traits,shortfalls,union-traits,witnesses}.ts`, `compiler/checker/resolution/choosing/candidates.ts`.
3. **Classification:** **(c) Genuinely primitive** in the checker; **(a) Already erased** at runtime (all trait-constrained calls close to concrete `FunctionInstance`s during monomorphization in `compiler/checker/surface/witness-closing.ts` and `compiler/lowering/calls/closed-calls.ts`).

### 2.6 Functions (`fn`, `async fn`), methods (`self`), static functions (`fn Type.name()`), and overloading — §3.3, §3.7
1. **What it is:** Top-level, static, or local function declarations, overloaded by parameter types/arity, where `self` as first parameter enables `x.f()` method call syntax and `Type.name` enables static call syntax.
2. **Implementation footprint:** **119 files, 375 sites** (`FunctionDeclaration`, `isMethod`, `owner`, `clashes.ts`, `choosing/`).
3. **Classification:** **(c) Genuinely primitive** (`FunctionDeclaration`). Methods (`self` as parameter 0) and static functions (`owner` qualifier) are **(a) Already a desugaring** into ordinary function table entries (`definition/tables/functions.ts`).

### 2.7 Default parameters (`fn retry(times: Int = 3)`) & rest parameters (`...parts: Array<T>`) — §3.3
1. **What it is:** Trailing parameter default expressions evaluated in the callee's prologue (`given` and `body` instructions) when omitted by the caller, plus variadic `...rest: Array<T>` parameters.
2. **Implementation footprint:** **21 files, 42 sites** (`hasDefault`, `mayLeaveOut`, `computeLeftOut`, `externDefaultsEntry`, `given`, `body`).
   - Checker & Lowering: `compiler/checker/constructs/declarations/functions/{parameters,signatures}.ts`, `compiler/checker/resolution/choosing/binding.ts`, `compiler/lowering/functions/frame-variables.ts` (`mayBeLeftOut`, `enterParameters`, `computeLeftOut`, `defaultOf`), `compiler/lowering/functions/built-entries.ts:externDefaultsEntry`, `definition/instructions/prologue.ts` (`given`, `body`), `definition/tables/functions.ts:mayLeaveOut`, `runtime/interpreter/instructions.ts` (`handlers.given`, `handlers.body`).
3. **Classification:** **(c) Genuinely primitive** in the function prologue (`given`/`body` allow function values of shorter arity, `spawn`, `defer`, and mocks to compute defaults in the callee without wrapper frames in stack traces). Rest parameters (`...name: Array<T>`) are **(a) Already a desugaring** (the caller packs positional/spread arguments into an `array` instruction in `lowering/calls/emit-call.ts`, and when omitted, `defaultOf` in `frame-variables.ts` initializes the parameter to `[]` using the exact same `given` prologue mechanism!).

### 2.8 Parameter patterns (`fn norm(Point{x, y} as self) -> Float`) — §3.3
1. **What it is:** Irrefutable destructuring pattern in place of a parameter's name, optionally inferring the parameter's type from a named struct pattern `Point{x, y}` and optionally naming the whole parameter via `as name`.
2. **Implementation footprint:** **6 files, 10 sites** (`ParameterBinding`, `patternNamedType`, `typingPattern`, `takeApart` in `frame-variables.ts`).
   - `compiler/syntax/expressions/{index,parameters}.ts`, `compiler/parser/grammar/parts/functions.ts:bindingOf`, `compiler/checker/constructs/declarations/functions/signatures.ts:namedByPattern`, `compiler/checker/constructs/patterns/targets.ts:declareTargets`, `compiler/lowering/functions/frame-variables.ts:takeApart`, `editor/language-service/signatures/signatures.ts:parameterText`.
3. **Classification:** **(a) Already a desugaring** of `VariableDeclaration` target destructuring (`declaredTargets` in `syntax/statements/targets.ts` and `bindTargets` in `lowering/constructs/statements/variables.ts`).

### 2.9 References (`&T`, `&x`) & copy-in/copy-out accessors — §3.7
1. **What it is:** Second-class mutable alias `&T` valid only as a parameter type and `&x` at call sites (implicit for `&self`), implemented as `{ cell, path }` references for variables/fields and copy-in/copy-out around the call for indexed elements (`&m[k]`) and shared struct dereferences (`&u->f`).
2. **Implementation footprint:** **18 files, 33 sites** (`ReferenceType`, `Reference`, `writtenByReference`, `enterReferenced`, `takesReference`, `checkReferencedPlaces`).
   - `compiler/syntax/types/index.ts:ReferenceType`, `compiler/syntax/expressions/calls.ts:Reference`, `compiler/checker/resolution/calls/places.ts` (`checkChangedPlace`, `checkReferencedPlaces`), `compiler/lowering/constructs/parts/places.ts:enterReferenced`, `compiler/lowering/calls/emit-call.ts`, `definition/instructions/places.ts`, `runtime/interpreter/registers.ts` (`argumentContents`, `writeReference`, `readThrough`, `changesAt`).
3. **Classification:** **(c) Genuinely primitive** (enables in-place mutation under value semantics without heap-allocating pointers as first-class values).

### 2.10 Lambdas (`fn(x): x * 2`), named lambdas (`fn f(n): …`), local `fn`, and closures — §3.14
1. **What it is:** First-class anonymous or local functions capturing `const` variables by copy and `let` variables by shared cell, lowered to top-level code entries plus `closure` instructions (and `currentClosure` for self-reference).
2. **Implementation footprint:** **82 files, 151 sites** (`Lambda`, `closure`, `currentClosure`, `NestedInstance`, `nestedLowering`).
   - Syntax/Parser/Binder/Formatter: `compiler/syntax/expressions/index.ts:Lambda`, `compiler/parser/grammar/expressions/lambdas.ts`, `compiler/binder/module/local-binder.ts`, `formatter/expressions/index.ts`.
   - Checker & Lowering: `compiler/checker/constructs/closures/{lambdas,functions,function-scope,enclosing-scopes,function-values,nested-types,returns,value-calls}.ts`, `compiler/lowering/constructs/expressions/closures.ts` (`lowerLambda`, `lowerLocalFunction`, `lowerFunctionValue`), `compiler/lowering/functions/{frames,frame-variables,index}.ts`, `definition/instructions/data.ts` (`closure`, `currentClosure`), `runtime/interpreter/instructions.ts` (`handlers.closure`, `handlers.currentClosure`).
3. **Classification:**
   - Lambdas & closures: **(c) Genuinely primitive**.
   - Local `fn` vs `const f = fn f(...): ...`: **(b) Overlapping!** Spec §3.14 explicitly notes: *"A local `fn` declaration is the same as binding a lambda to a `const` at that point."* Yet local `fn` is kept as a `FunctionDeclaration` statement node in `Statement` (`compiler/syntax/statements/index.ts`), requiring `Lambda | FunctionDeclaration` unions across `nestsFunction`, `NestedFunction`, `checkNested`, `closureOf`, `nestedSpanOf`, `bodyChildrenOf`, and `flow-builder.ts`! Even minor differences (a local `fn` writes its parameter types and mark, just like a typed lambda) are trivial to check or desugar to `const name = fn name(...): ...`.
   - Also note: `declareFrame` (`compiler/lowering/functions/frame-variables.ts:88`) unconditionally emits a `currentClosure` instruction into a register for **every** local `fn` and named `Lambda`, even when the body never references its own name!

### 2.11 Top-level `const` & compile-time constant evaluation (`ConstantForm`) — §3
1. **What it is:** Module-level `const` declaration whose initializer must be computable at compile time into a constant pool entry.
2. **Implementation footprint:** **12 files, 53 sites** (`ConstantForm`, `computeConstant`, `Computation`, `fittedForm`, `convertedForm`, `partsForm`, `structForm`, `formAt`, `formSemantics`, `sameForm`, `constantValue`).
   - `compiler/checker/constructs/declarations/constants.ts`, `compiler/checker/rules/computation/{index,forms}.ts`, `compiler/checker/surface/constant-form.ts`, `compiler/lowering/tables/constants.ts`.
3. **Classification:** **(b) Reducible (parallel evaluator + converter + destructurer in the checker):**
   - Today, the checker contains a complete, hand-rolled AST interpreter (`Computation` in `checker/rules/computation/index.ts`), a parallel type-directed value converter (`fittedForm`, `convertedForm`, `partsForm`, `structForm` in `checker/rules/computation/forms.ts` duplicating `lowering/functions/fits/`), a parallel destructuring extractor (`formAt`, `formStep` in `checker/surface/constant-form.ts` duplicating `lowering/constructs/parts/part-paths.ts`), a parallel equality/map-key engine (`formSemantics` in `constant-form.ts` duplicating `definition/values/equality.ts`), and a translator `constantValue` (`lowering/tables/constants.ts`) from `ConstantForm` to `Value`!
   - Worse, because `Computation` is a separate evaluator from lowering/runtime, top-level `const` arbitrarily refuses enum variants (`const x = Ok(1)`), arithmetic (`const x = 1 + 2`), and union wraps in spreads, even though they are pure constants!
   - The checker only ever needs a string/map value from `@JsonName`, `@Waypoint`, `@Suite`, and `@Keeps` annotations (which are simple literals). For top-level `const`s, the checker only needs to validate that the expression is constant (a simple AST check), while lowering (or running the lowered initializer once) produces the `Value` directly without `ConstantForm`, `fittedForm`, `partsForm`, `formAt`, or `formSemantics`!

### 2.12 Context constants (`ista const`) — §3.4
1. **What it is:** Per-instance (context) lazily-initialized constant evaluated on first read inside a segment and persisted in the instance's heap, disposed in reverse creation order after all other instance objects when the instance ends.
2. **Implementation footprint:** **30 files, 53 sites** (`ContextConstantDeclaration`, `contextConstants`, `contextConstant`, `makeContextConstant`, `accessorLowering`, `ContextConstants`).
   - Syntax/Parser/Binder/Formatter: `compiler/syntax/declarations/index.ts:ContextConstantDeclaration`, `compiler/parser/grammar/declarations/declaration.ts:parseContextConstant`, `compiler/binder/constructs/declarations.ts:declarationHandlers.ContextConstantDeclaration`, `formatter/declarations.ts:declarationPrinters.ContextConstantDeclaration`.
   - Checker: `compiler/checker/constructs/declarations/context-constants.ts:ContextConstantChecks`, `compiler/checker/check.ts:ContextConstantQueries`, `compiler/checker/constructs/expressions/access/names.ts:contextConstantRead`, `compiler/checker/rules/kinds/data-kinds.ts:checkConstantKinds`, `compiler/checker/rules/lifetimes/{declared,finding,lifetimes}.ts`, `compiler/checker/wiring/{body/body-kinds,program/program-checker}.ts`.
   - Lowering, Definition IR & Runtime: `compiler/lowering/functions/{index,frames,code-writer,frame-variables}.ts` (`accessorLowering`, `accessorFrame`, `contextConstant`), `compiler/lowering/tables/{instances,names,tables}.ts`, `definition/instructions/data.ts` (`contextConstant`, `makeContextConstant`), `definition/instructions/instruction.ts`, `definition/validation/instruction-rules.ts`, `runtime/interpreter/instructions.ts`, `runtime/scheduler/instance/{context-constants,heap-indexes,index}.ts`, `runtime/snapshot/{objects,holdings,check/index}.ts`, `runtime/lifetimes/disposal.ts`.
3. **Classification:** **(b) Reducible (both AST-wise and IR/runtime-wise, and overlaps with `ExternConstantDeclaration`):**
   - Used only **once** in the entire standard library (`ista const _jobs = new _Jobs{}` in `src/stdlib/runtime/runtime.ista`).
   - In the AST, `ContextConstantDeclaration` is a separate node kind from `VariableDeclaration` (which already handles top-level `const` and local `let`/`const`).
   - In the Definition IR, `contextConstant` and `makeContextConstant` are two dedicated bytecode instructions emitted in **only one place** (`FunctionLowering.lowerAccessor`), which could be a single prelude/runtime native or merged with `ExternConstantDeclaration`'s `pinned` cache (see §2.13).

### 2.13 Extern declarations (`extern fn`, `extern struct`, `extern name: Type`) — §3.6
1. **What it is:** Host-provided or runtime-provided functions (`FunctionDeclaration` with `isExtern: true`), types (`ExternStructDeclaration` with optional `shared`/`sendable`/`live` handle modifier), and per-instance pinned constants (`ExternConstantDeclaration`).
2. **Implementation footprint:**
   - `ExternStructDeclaration`: **37 files, 55 sites**.
   - `ExternConstantDeclaration` & `pinned`: **23 files, 38 sites** (`ExternConstantDeclaration`, `hostConstantEntry`, `constantNativeEntry`, `SegmentEffects.pinned`, `Snapshot.pinned`).
3. **Classification:**
   - `extern fn` and `extern struct`: **(c) Genuinely primitive** host/runtime boundary declarations.
   - `ExternConstantDeclaration` (`extern approvalDeadline: Duration`) vs `ContextConstantDeclaration` (`ista const`) and `extern fn`: **(b) Reducible overlap!**
     - The runtime has **two** separate per-instance constant caches in `Snapshot`: `Snapshot.pinned` (for `extern name: T`, storing the raw host `Json` and re-running `fromJson` decoding in `hostConstantEntry` on **every** read!) and `contextConstant` heap objects (for `ista const`, storing the decoded/evaluated `Value` once on first read via `contextConstant`/`makeContextConstant`).
     - If `hostConstantEntry` (`compiler/lowering/synthesized/boundary/host-externs.ts:68`) uses `contextConstant`/`makeContextConstant` around its native call + `fromJson` decode, then `Snapshot.pinned`, `SegmentEffects.pinned`, `NativeCalls.call`'s `declared?.constant === true` check, and `FunctionDefinition.extern.constant: z.boolean()` all disappear, AND host extern constants decode their JSON only once per instance instead of on every read!

### 2.14 Modules, imports (`import a, b as c from 'p'`, `import * as m from 'p'`), and ADL — §3.13
1. **What it is:** File-based module system with named/aliased imports (`NamedImport`, `ImportedName`), namespace imports (`NamespaceImport`), `_`-prefixed privacy, implicit prelude import, and argument-dependent lookup (ADL).
2. **Implementation footprint:** **16 files, 40 sites** (`NamedImport`, `NamespaceImport`, `ImportedName`, `compiler/binder/link/`, `compiler/checker/resolution/choosing/candidates.ts`).
3. **Classification:** **(c) Genuinely primitive** in binder/checker; **(a) Already erased** at runtime (`Definition.modules` carries only module names and line-start offsets for stack traces).

### 2.15 Annotations (`@JsonName{"user_id"}`, `@Suite`, `@Waypoint`, `@Holds`, `@Keeps`) & Docstrings (`"""…"""`) — §2, §3.16
1. **What it is:** Compile-time struct values attached to declarations, fields, or waiting statements (`Annotation`), and raw documentation strings (`Docstring`).
2. **Implementation footprint:**
   - `Annotation`: **20 files, 70 sites** (`compiler/parser/layout/annotations.ts`, `compiler/checker/rules/annotations.ts`, etc.).
   - `Docstring`: **8 files, 18 sites** (`compiler/parser/layout/docstrings.ts`, `editor/language-service/reading/docstrings.ts`, `formatter/`).
3. **Classification:** **(c) Genuinely primitive** metadata syntax (annotations reuse ordinary `struct` declarations and `StructLiteral` checking).

---

## 3. Literals, Expressions, Operators, Comprehensions & Control Flow (§2, §3.1, §3.9, §3.12, §3.14, §3.15, §4)

### 3.1 Primitive literals (`42`, `3.14`, `"text"`, `true`, `false`, `none`) — §2
1. **What it is:** Scalar literals decoded once in the scanner/parser into `IntegerLiteral`, `FloatLiteral`, `StringLiteral`, `BooleanLiteral`, and `NoneLiteral`.
2. **Implementation footprint:** **40 files, 81 sites** (`IntegerLiteral`, `FloatLiteral`, `StringLiteral`, `BooleanLiteral`, `NoneLiteral`).
   - `compiler/syntax/expressions/literals/literals.ts`, `compiler/parser/grammar/parts/literals.ts`, `compiler/checker/constructs/expressions/literals/literals.ts`, `compiler/lowering/constructs/expressions/expressions.ts`, `formatter/expressions/literals.ts`.
3. **Classification:** **(c) Genuinely primitive** (lowered to `constant` instructions).

### 3.2 Duration literals (`500ms`, `30s`, `15m`, `2h`, `5d`) — §2
1. **What it is:** Integer literal suffixed with a time unit (`ms`, `s`, `m`, `h`, `d`), evaluated by the scanner/parser into milliseconds and typed as `time.Duration{value: ms}`.
2. **Implementation footprint:** **14 files, 16 sites** (`DurationLiteral`, `wellKnown.duration`, `durationForm`).
   - `foundation/language/time-units.ts`, `compiler/scanner/numbers.ts`, `compiler/syntax/expressions/literals/literals.ts:DurationLiteral`, `compiler/parser/grammar/parts/literals.ts:literalFrom`, `compiler/checker/constructs/expressions/literals/literals.ts:checkDurationLiteral`, `compiler/checker/rules/computation/index.ts:Computation.#own`, `compiler/checker/surface/constant-form.ts:durationForm`, `compiler/checker/rules/flow/build/expressions.ts:expressionFlows.DurationLiteral`, `compiler/checker/wiring/body/scope-protocol.ts:standings.DurationLiteral`, `compiler/lowering/constructs/expressions/literals/literals.ts:lowerDurationLiteral`, `formatter/expressions/literals.ts:literalPrinters.DurationLiteral`.
3. **Classification:** **(a) Already a desugaring** at runtime (lowered to a `time.Duration` struct constant in `lowerDurationLiteral`); **(b) Reducible further** in the compiler if `DurationLiteral` is desugared in syntax/checker or if `time` is not a mandatory compiler role (`languageModules.time` exists solely for `DurationLiteral` and ISO `Time` host boundary).

### 3.3 Templates (`` `a ${x} b` ``) & tagged templates (`` tag`a ${x} b` ``) — §2
1. **What it is:** Multi-line string interpolation calling `toString` on each `${…}` and joining non-empty parts with prelude `join`, or, when tagged, calling `tag(["a ", " b"], x)`.
2. **Implementation footprint:** **19 files, 39 sites** (`TemplateLiteral`, `TemplateText`, `templateFunctions`, `taggedCall`, `constantTextOf`).
   - `compiler/scanner/templates.ts`, `compiler/syntax/expressions/index.ts:TemplateLiteral`, `compiler/syntax/expressions/literals/templates.ts` (`isTagged`, `constantTextOf`, `taggedCall`), `compiler/parser/grammar/expressions/literals/templates.ts`, `compiler/binder/constructs/expressions.ts`, `compiler/checker/constructs/expressions/literals/templates.ts` (`checkTemplate`, `join`, `interpolate`), `compiler/checker/rules/computation/index.ts`, `compiler/checker/rules/flow/build/{expressions,literals}.ts`, `compiler/checker/lookup/denotations/index.ts`, `compiler/lowering/constructs/expressions/literals/templates.ts:lowerTemplate`, `formatter/expressions/literals.ts`.
3. **Classification:**
   - Tagged templates (`tag\`...\``) and constant templates (`\`plain\``): **(a) Already a desugaring** in `compiler/syntax/expressions/literals/templates.ts` (`taggedCall` synthesizes a `Call` node, and `constantTextOf` extracts the constant string).
   - Untagged interpolated templates (`\`a ${x} b\``): **(b) Partially reducible!** Since `prelude.ista` already declares `fn add<T is Stringable>(left: String, right: T) -> String` and `fn String.from<T is Stringable>(value: T) -> String`, an untagged template `` `a ${x} b` `` has its own implicit call roles (`interpolate` -> `toString`, `join` -> `Array<String>.join`), flow builder (`literals.ts:template`), and lowering (`lowerTemplate`), all of which just call `toString` and `join`!

### 3.4 Array literals (`[1, 2, ...xs]`), Map literals (`["a": 1, ...m]`, `[:]`), and Spread (`...xs`) — §2, §3.10
1. **What it is:** Collection literals for `Array<T>`, `Map<K, V>`, or any user type meeting `Default & IndexAssignable<K, V>`, with `...xs` spreading any `Iterable`.
2. **Implementation footprint:**
   - `ArrayLiteral`: **32 files, 60 sites**.
   - `MapLiteral` & `MapEntry`: **34 files, 78 sites**.
   - `Spread`: **38 files, 98 sites**.
   - Key files: `compiler/checker/constructs/expressions/collections/{collections,literals,joining-literals,empty-collections}.ts`, `compiler/lowering/constructs/expressions/collections/collections.ts` (`lowerArrayLiteral`, `lowerMapLiteral`, `lowerDeclaredLiteral`, `built`, `spreadArray`), `definition/instructions/data.ts` (`array`, `map`), `runtime/interpreter/instructions.ts` (`handlers.array`, `handlers.map`).
3. **Classification:** **(c) Genuinely primitive** for `Array` and `Map`; **(a) Already a desugaring** for user `Default & IndexAssignable` types (`lowerDeclaredLiteral` lowers `[k: v]` to `C.default()` + `setIndex(&c, k, v)`) and for non-same-collection spreads (lowered to `emitLoop` over `iterate` cursor in `collections.ts:built`).

### 3.5 Tuples (`(a, b)`) & tuple element access (`t.0`, `t?.0`) — §3.15
1. **What it is:** Positional tuple construction (`Tuple`) and 0-indexed element access/mutation (`TupleElement`).
2. **Implementation footprint:** **25 files, 39 sites** (`Tuple`, `TupleElement`, `tupleOf`).
   - `compiler/syntax/expressions/index.ts` (`Tuple`, `TupleElement`), `compiler/parser/grammar/expressions/{atoms,postfix}.ts`, `compiler/checker/constructs/expressions/literals/tuples.ts` (`checkTuple`, `checkTupleElement`), `compiler/lowering/constructs/expressions/literals/tuples.ts` (`lowerTuple`, `lowerTupleElement`, `tupleOf`), `definition/instructions/data.ts` (`tuple`, `field`).
3. **Classification:** **(c) Genuinely primitive** in syntax/checker; at runtime, `TupleElement` lowers to the same `field` / `store` instruction as struct field access!
   - **AST unification opportunity:** In the AST, `TupleElement` (`t.0`, `t?.0`) and `MemberAccess` (`a.b`, `a?.b`) are separate node kinds even though both represent a named/positional field projection with `target: Expression` and `isOptional: boolean`.

### 3.6 Ranges (`a..b`, `a..=b`, `..b`, `a..`, `..`, `by step`) — §2, §3.8
1. **What it is:** Integer range expression with optional `start`/`end`, inclusive flag `..=`, and optional `by step`, producing a value of the prelude struct `Range{start: Int?, end: Int?, step: Int = 1}`.
2. **Implementation footprint:** **19 files, 26 sites** (`Range`, `wellKnown.range`, `inclusiveEndFunction`, `checkRange`, `lowerRange`).
   - `compiler/syntax/expressions/index.ts:Range`, `compiler/parser/grammar/expressions/operators.ts:parseRangeRest`, `compiler/binder/constructs/expressions.ts:expressionHandlers.Range`, `compiler/checker/constructs/expressions/collections/literals.ts:checkRange`, `compiler/checker/rules/flow/build/{expressions,literals}.ts`, `compiler/checker/wiring/body/scope-protocol.ts:standings.Range`, `compiler/lowering/constructs/expressions/collections/collections.ts:lowerRange`, `formatter/expressions/index.ts:expressionPrinters.Range`, `stdlib/prelude/range-natives.ts`, `stdlib/ranges.ts`.
3. **Classification:** **(a) Already a desugaring** at lowering/runtime into `struct Range` + `prelude._inclusiveEnd(end, step)`. **(b) Reducible in stdlib** (see Section 5: `prelude._steps(Range)` and `prelude.includes(Range, Int)` are currently TS natives in `src/stdlib/prelude/range-natives.ts` + `src/stdlib/ranges.ts`, even though `Range` is an ordinary `.ista` struct!).

### 3.7 Struct literals (`Pair{first: 1, second}`, `UserId{"u-1"}`, `Req{...r, a: 2}`, `struct{…}`) — §3.1
1. **What it is:** Named, shorthand, positional (single-field), spread-updated, or anonymous struct construction (`StructLiteral`, `FieldInitializer`, `PositionalInitializer`), plus bare fieldless struct construction (`Marker`).
2. **Implementation footprint:** **37 files, 84 sites** (`StructLiteral`, `FieldInitializer`, `PositionalInitializer`, `sourcesOf`, `literalFieldsOf`).
   - `compiler/syntax/expressions/index.ts`, `compiler/parser/grammar/expressions/literals/struct-literals.ts`, `compiler/checker/constructs/expressions/structs/{structs,literal-types,literal-sources,literal-fields/index,literal-fields/items}.ts`, `compiler/lowering/constructs/expressions/structs/structs.ts`, `compiler/lowering/values/struct-values.ts`, `definition/instructions/data.ts:struct`.
3. **Classification:** **(c) Genuinely primitive** (`StructLiteral` with named `FieldInitializer`s); shorthand `first`, updated copy `...r`, and field defaults are **(a) Already a desugaring** into `FieldSource`s in `literal-sources.ts` and `struct` / `structEntry` in `lowering/constructs/expressions/structs/structs.ts`.

### 3.8 Indented values (`const api = Service:\n  name: "api"`) — §2
1. **What it is:** Off-side indented block literal after `=`, `return`, `:`, `-`, or `T:` / `new T:` that builds a `StructLiteral`, `NewStructLiteral`, `MapLiteral` (with bare identifiers treated as String keys!), or `ArrayLiteral` (`- item` lines), chosen by `T` or the expected type.
2. **Implementation footprint:** **26 files, 75 sites** (`IndentedValue`, `QuotedEntry`, `IndentedItem`, `literalOf`, `bareKeyOf`, `builtLiteralOf`, `recordBuilt`, `indentedAccepts`).
   - Syntax & Parser: `compiler/syntax/expressions/index.ts` (`QuotedEntry`, `IndentedItem`, `IndentedEntry`, `IndentedValueOf`, `IndentedValue`), `compiler/syntax/expressions/literals/indented-values.ts` (`isItem`, `isKeyed`, `untypedForm`, `literalOf`, `bareKeyOf`, `entriesLeftOut`, `builders`), `compiler/syntax/expressions/literals/built-types.ts`, `compiler/syntax/expressions/readings.ts:isItemsLiteral`, `compiler/parser/grammar/expressions/literals/indented-values.ts` (`parseNamedValue`, `parseBlockValue`, `parseEntry`, `parseItem`, `parseItemValue`, `parseKeyedValue`).
   - Binder, Checker & Lowering: `compiler/binder/constructs/expressions.ts` (`bindLiteral`, `expressionHandlers.IndentedValue`), `compiler/checker/constructs/expressions/expressions.ts:expressionHandlers.IndentedValue`, `compiler/checker/constructs/expressions/literals/indented-values.ts` (`checkIndentedValue`, `buildingOf`, `anonymousForm`, `reportLeftOut`, `leftOutDiagnostic`, `keysFit`, `checkValuesAlone`, `indentedAccepts`), `compiler/checker/constructs/expressions/postponed.ts` (`postponed`, `ownAdmits`), `compiler/checker/contexts/body-context.ts:BodyContext`, `compiler/checker/surface/checked-body.ts:BodyFacts`, `compiler/checker/wiring/body/{body-checker,body-records,scope-protocol,facts/index}.ts`, `compiler/checker/rules/computation/index.ts:Computation.#own`, `compiler/checker/rules/flow/build/expressions.ts:expressionFlows.IndentedValue`, `compiler/checker/lookup/denotations/index.ts:itemNamed`, `compiler/lowering/constructs/expressions/expressions.ts:expressionHandlers.IndentedValue`.
   - Editor & Formatter: `editor/language-service/semantic-tokens/built-keys.ts:builtKeyTypesOf`, `editor/language-service/completion/places/literal-field.ts`, `editor/language-service/navigation/rename.ts` (`shapeWriters`, `writerOf`), `editor/language-service/outline/folding.ts:layoutStarts.IndentedValue`, `formatter/expressions/indented-values.ts`, `formatter/expressions/index.ts`, `formatter/layout/brackets.ts`.
3. **Classification:** **(b) Major reduction candidate!**
   - Even though `literalOf(node, form)` eventually builds a `StructLiteral | NewStructLiteral | MapLiteral | ArrayLiteral`, `IndentedValue` is kept as a distinct AST node through the **entire** pipeline ONLY because a `key: value` block with bare identifier keys can build either a `struct` (`key` = field name) or a `Map<String, V>` (`key` = `"key"` string literal)!
   - As `docs/arch/architecture.md` notes, this one rule (`LOG_LEVEL: "debug"` in an indented map) is also the **sole reason** `editor/language-service/semantic-tokens/` has to run the type checker (`built-keys.ts`)!
   - If indented maps quote their string keys (`"LOG_LEVEL": "debug"`, matching bracket map literals `["LOG_LEVEL": "debug"]` where unquoted `k` is an expression, not a string!), then every indented block's form is 100% syntactically determined (`- item` -> `ArrayLiteral`, `"k": v` -> `MapLiteral`, `field: v` -> `StructLiteral`/`NewStructLiteral`), and the parser can produce `ArrayLiteral` / `MapLiteral` / `StructLiteral` directly (with a formatting flag if desired), eliminating `IndentedValue`, `QuotedEntry`, `IndentedItem`, `literalOf`, `bareKeyOf`, `builtLiteralOf`, `checkIndentedValue`, and `built-keys.ts` across **24+ files (~65 sites)**!

### 3.9 Calls (`f(a, b: 2, ...xs)`), type applications (`f<Int>`), and conversions (`T(x)`) — §3.3, §3.5, §3.10
1. **What it is:** Function, method, static, variant constructor, function-value, and `T(x)` (`T.from(x)`) invocations, plus explicit type argument application `f<Int>` (`TypeApplication`).
2. **Implementation footprint:**
   - `Call`, `TypeApplication`, `NamedArgument`: **99 files, 218 sites**.
   - `T(x)` conversion (`conversionFunction` `'from'`, `checkConversion`, `callConversion`): **8 files, 12 sites** (`compiler/checker/constructs/expressions/calls.ts`, `compiler/checker/resolution/choosing/candidates.ts`, etc.).
3. **Classification:** `Call` and `TypeApplication` are **(c) Genuinely primitive**; `T(x)` is **(a) Already a desugaring** of a static call `T.from(x)` resolved by the checker into a standard `ResolvedCall`, and `NamedArgument` is **(a) Already a desugaring** bound by `resolution/choosing/binding.ts` into positional parameter order before lowering.

### 3.10 Deferred calls (`g f(args)`, `g(opts) f(args)`) — §3.14, §7, §9
1. **What it is:** Prefix call syntax `g f(args)` that evaluates `f`'s receiver/callee and written arguments eagerly by value and passes a 0-argument closure `fn(): f(args)` into `g`'s first unfilled `fn() -> X` parameter (used by `spawn f(args)`, `_ = defer f(args)`, `runtime.delegate f(args)`, `rt.call(k) f(args)`, `runtime.run(k) f(args)`, `futures.retry f(args)`).
2. **Implementation footprint:** **34 files, 71 sites** (`DeferredCall`, `Deferrals`, `deferredFunctionOf`, `deferredEntry`, `DeferredPlan`, `DeferredFunction`, `deferredIndex`, `deferredHeader`, `checkDeferredArguments`).
   - Syntax/Parser/Binder/Formatter: `compiler/syntax/expressions/calls.ts:DeferredCall`, `compiler/syntax/expressions/readings.ts` (`isTakerShaped`, `takerCallOf`, `calledName`, `callTypeArguments`, `writtenArgumentsOf`, `callOfCallee`, `makerOf`, `deferredOf`), `compiler/syntax/tree/index.ts:bodyChildrenOf`, `compiler/parser/grammar/expressions/deferred-calls.ts`, `compiler/binder/constructs/expressions.ts:expressionHandlers.DeferredCall`, `formatter/expressions/index.ts:expressionPrinters.DeferredCall`.
   - Checker: `compiler/checker/constructs/expressions/deferred-calls.ts` (`Deferrals`, `checkDeferredCall`, `missingComma`, `deferredFunction`, `laterMarkOf`, `laterCallKind`, `unmade`, `refused`, `computedNow`), `compiler/checker/resolution/calls/deferred-arguments.ts` (`DeferredArgument`, `unsendable`, `checkDeferredArguments`), `compiler/checker/resolution/choosing/binding.ts` (unfilled `fn() -> X` slot matching), `compiler/checker/rules/flow/build/calls.ts` (`deferredFunction`, `closureMaking`, `isMade`, `computedNow`, `madeLater`), `compiler/checker/rules/kinds/data-kinds.ts:laterOf`, `compiler/checker/rules/boundary/outcome-codecs.ts:isCalling`, `compiler/checker/rules/disposal/disposal.ts:checkSelfStays`, `compiler/checker/lookup/denotations/index.ts`, `compiler/checker/wiring/body/{body-checker,scope-protocol,facts/index,facts/recorded-body}.ts`.
   - Lowering & Editor: `compiler/lowering/constructs/expressions/deferred-calls.ts` (`lowerDeferredCall`, `deferredFunction`, `isMade`, `computedNow`, `givenFunction`, `deferredEntry`, `capturedBy`, `madeCall`), `compiler/lowering/constructs/expressions/calls.ts:preparedCall`, `compiler/lowering/tables/{instances,tables}.ts` (`DeferredFunction`, `DeferredPlan`, `deferredKey`, `deferredName`, `deferredHeader`, `deferredIndex`), `compiler/lowering/lower.ts:pendingEntry`, `editor/language-service/{hover,semantic-tokens/name-types,completion/places/grammar/position}.ts`.
3. **Classification:** **(b) Major reduction candidate!**
   - Spec §3.14 states: `retry fetchUser(id) # retry((fn(x): fn(): fetchUser(x))(id))`.
   - Instead of desugaring `g f(a, b)` into `{ const _a = a; const _b = b; g(fn(): f(_a, _b)) }` (where `const` bindings are **already** captured by copy in lambdas, lambdas **already** infer their mark and `"sendable"` from their captures, and lambdas **already** convert plain results to resolved futures when expected as `async fn() -> R`), the compiler implements a **complete second closure-capture, mark-inference, sendability-checking, flow-IR, and entry-synthesis pipeline** (`Deferrals`, `laterMarkOf`, `laterCallKind`, `deferred-arguments.ts`, `DeferredPlan`, `DeferredFunction`, `deferredEntry`, `madeCall`).
   - Desugaring `DeferredCall` into `const` bindings + a `Lambda` (or unify its checker/lowering with `Lambda`) eliminates `Deferrals`, `DeferredPlan`, `DeferredFunction`, `deferredEntry`, `deferred-arguments.ts`, and `flow/build/calls.ts:deferredFunction` (~**20 files, 45+ sites**).

### 3.11 Member access (`a.b`), indexing & slicing (`x[k]`, `x[a..b]`), and keyed struct field access (`s[k]`) — §3.1, §3.9
1. **What it is:** Field/method/static/namespace access (`MemberAccess`), collection indexing/slicing via `Indexable`/`IndexAssignable` (`index`/`setIndex`), and built-in struct field indexing by key `k: K in keyof S` (`s[k]`).
2. **Implementation footprint:**
   - `MemberAccess`: **48 files, 101 sites**.
   - `Index`: **24 files, 44 sites**.
3. **Classification:** `MemberAccess` is **(c) Genuinely primitive**; collection `x[k]` and `x[k] = v` are **(a) Already a desugaring** of calls to `index(x, k)` and `setIndex(&x, k, v)`; struct `s[k]` is **(c) Genuinely primitive** for dynamic union keys `k: keyof S` (lowered to a `switch` on `k` in `lowering/values/keyed-fields.ts`) and **(a) Already a desugaring** to `s.field` when `k` is a single literal key.

### 3.12 Optional chaining (`a?.b`, `a?->b`, `a?.[i]`, `f?.(x)`), nullish coalescing (`a ?? b`), and force-unwrap (`a!`) — §4
1. **What it is:** Short-circuiting optional access chains (`OptionalChains`), fallback on `none` (`??`), and panicking unwrap on `none` (`!`).
2. **Implementation footprint:**
   - `OptionalChains` (`isOptional`, `chainStepOf`, `chainOf`): **31 files, 64 sites**.
   - `??` (`coalesce`, `checkNullish`, `lowerNullish`): **7 files, 10 sites**.
   - `a!` (`Unwrap`, `checkUnwrap`, `lowerUnwrap`): **11 files, 15 sites**.
3. **Classification:**
   - `?.` and `??`: **(a) Already a desugaring** at lowering into `switch` on the optional's variants (`lowering/values/optionals.ts:presentOrJump` / `presentOr`).
   - `a!` (`Unwrap`): **(b) Reducible!** Every use of `a!` emits a compiler warning (`checkerDiagnostics.forceUnwrap`), it is used **0 times** in `src/stdlib/**/*.ista`, and `a ?? panic("Force-unwrapped none.")` already has the exact same type (`T`, since `panic` returns `Never`) and runtime behavior! Desugaring `a!` to `a ?? panic(...)` (or removing `Unwrap` as a distinct post-parse construct) eliminates `Unwrap`, `checkUnwrap`, `lowerUnwrap`, `flow/build/control.ts:unwrap`, and `role: 'panic'` in `implicit.ts` (**11 files, 15 sites**).

### 3.13 Error propagation (`e?` / `Propagate`) — §3.12
1. **What it is:** Postfix `?` on `Result<T, E>` that yields the `Ok` value or early-returns `Err(error)` (fitted to the enclosing function's error type).
2. **Implementation footprint:** **11 files, 16 sites** (`Propagate`, `checkPropagate`, `lowerPropagate`, `returnedError`).
   - `compiler/syntax/expressions/index.ts:Propagate`, `compiler/parser/grammar/expressions/postfix.ts:propagateParselet`, `compiler/binder/constructs/expressions.ts`, `compiler/checker/constructs/expressions/control/propagate.ts`, `compiler/checker/constructs/closures/returns.ts:propagate`, `compiler/checker/rules/flow/build/{control,expressions}.ts`, `compiler/checker/wiring/body/scope-protocol.ts`, `compiler/lowering/constructs/expressions/control/propagate.ts`, `formatter/expressions/index.ts`.
3. **Classification:** **(a) Already a desugaring** at lowering (`lowerPropagate` emits a variant test on `Ok` and a branch building `Err` + `return`, equivalent to `match e: case Ok(v): v; case Err(err): return Err(err)`).

### 3.14 Operators (`+`, `-`, `*`, `/`, `//`, `%`, `**`, `&`, `|`, `^`, `~`, `<<`, `>>`, `<`, `<=`, `>`, `>=`, `==`, `!=`, `in`, `not in`, `and`, `or`, `not`) & chained comparisons (`a < b <= c`) — §3.9
1. **What it is:** Arithmetic/bitwise operators (resolved as calls to named functions via `syntax/expressions/operators.ts`), ordering `<`/`<=`/`>`/`>=` (calls `compare` + `order` instruction), membership `in`/`not in` (calls `includes`), built-in structural/handle equality `==`/`!=` (`equal` instruction), short-circuit `and`/`or`/`not` (`branch`/`not` instructions), and Python-style comparison chains `a < b <= c` (`ChainedComparison`).
2. **Implementation footprint:**
   - Operators table & `Binary`/`Unary`: **26 files, 58 sites**.
   - `ChainedComparison`: **12 files, 22 sites** (`compiler/syntax/expressions/index.ts:ChainedComparison`, `compiler/syntax/expressions/comparisons.ts`, `compiler/parser/grammar/expressions/operators.ts:comparisonsOf`, `compiler/binder/constructs/expressions.ts`, `compiler/checker/constructs/expressions/operators/operators.ts:checkChainedComparison`, `compiler/checker/rules/flow/build/{control,expressions}.ts`, `compiler/checker/wiring/body/scope-protocol.ts`, `compiler/lowering/constructs/expressions/operators.ts:lowerChainedComparison`, `formatter/expressions/index.ts`).
3. **Classification:**
   - Calling operators, orderings, and `in`/`not in`: **(a) Already a desugaring** into resolved function calls driven by a single declarative table (`compiler/syntax/expressions/operators.ts:binaryOperators` and `unaryOperators`).
   - **IR-level `order` instruction (`definition/instructions/control.ts`, `runtime/interpreter/instructions.ts:handlers.order`):** `a < b` calls `compare(a, b) -> Int` (which returns `-1`, `0`, or `1`) and then emits a dedicated `order` bytecode instruction (`less`, `lessOrEqual`, `greater`, `greaterOrEqual`) to compare that `Int` against `0n`!
   - **`ChainedComparison` vs `Binary`:** **(b) Reducible!** Notice that `checkBinary` in `compiler/checker/constructs/expressions/operators/operators.ts:53` **already** delegates single comparisons to `checkComparisons(context, node, [link])`! Having `ChainedComparison` as a separate AST node from `Binary` (instead of either desugaring chains or unifying comparison nodes) requires `ChainedComparison` handlers in 12 files (22 sites).

### 3.15 Branching expressions (`if`/`elif`/`else`, `match`, `x is P`, `{ … }` block expressions) & conditions decided by types — §3.11, §4
1. **What it is:** Expression-oriented control flow where all branches agree on one type (`Branches` / `agreement.ts`), plus static dead-branch ruling-out when `==`, `!=`, or `is` is decided by operand types (`decided-conditions.ts`).
2. **Implementation footprint:**
   - `If` / `ConditionalBranch` / `ElseClause`: **18 files, 31 sites**.
   - `Match` / `MatchCase` / `Is`: **28 files, 56 sites**.
   - `BlockExpression` & `Block`: **32 files, 68 sites**.
   - Conditions decided by types (`decidedOf`, `decideComparison`, `decidedValue`, `isRuledOut`): **11 files, 24 sites** (`compiler/checker/constructs/expressions/operators/decided-conditions.ts`, etc.).
3. **Classification:**
   - `If`, `Match`, and `Block` are **(c) Genuinely primitive** in the checker, and **(a) Already a desugaring** in lowering to `branch`, `switch`, and `jump` instructions (`lowering/constructs/expressions/control/{control,matching}.ts`).
   - `x is P` (`Is`) is **(a) Already a desugaring** of `Match` pattern tests (`lowerIs` runs `lowerMatching` and produces `true`/`false`).
   - Note that `If` (`if c: a else: b`) is itself semantically a 2-case `Match` (`match c: case true: a; case false: b`) except for `is`-binding flow in `c` (`if x is Ok(v) and v > 0:`).

### 3.16 Array comprehensions (`[for x in xs if c: e]`), field comprehensions (`[for k, v in ...s: e]`), and struct comprehensions (`struct{for k, v in ...s: [k]: e}`) — §3.1, §4
1. **What it is:**
   - `Comprehension`: `[for x in xs if c: e]` iterating an `Iterable` and collecting `e` into an `Array`.
   - `FieldComprehension`: `[for k, v in ...s: e]` unrolling over a struct's fields in name order and collecting `e` into an `Array`.
   - `StructComprehension`: `struct{id, for k, v in ...s: [k]: e}` unrolling over a struct's fields in name order to build a struct's fields.
2. **Implementation footprint:** **36 files, 93 sites** (`Comprehension`: 25 files/40 sites; `FieldComprehension`: 15 files/25 sites; `StructComprehension`: 19 files/48 sites).
   - `compiler/syntax/expressions/index.ts` (`Comprehension`, `FieldHeader`, `FieldComprehension`, `StructComprehension`), `compiler/parser/grammar/expressions/literals/{collections,struct-literals}.ts`, `compiler/binder/constructs/expressions.ts`, `compiler/checker/constructs/expressions/collections/comprehensions.ts` (`checkComprehension`, `checkFieldComprehension`), `compiler/checker/constructs/expressions/structs/struct-comprehensions.ts`, `compiler/checker/constructs/loops/field-passes.ts`, `compiler/checker/rules/flow/build/{expressions,literals}.ts`, `compiler/lowering/constructs/expressions/collections/comprehensions.ts` (`lowerComprehension`, `lowerFieldComprehension`), `compiler/lowering/constructs/expressions/structs/structs.ts:comprehendedFields`.
3. **Classification:**
   - `Comprehension` (`[for x in xs if c: e]`): **(a) Already a desugaring** in lowering to `emitLoopOver` + `appendElement`, and **(b) Reducible** to a block expression `{ let _a = []; for x in xs: if c: _a.push(e); _a }`.
   - `FieldComprehension` (`[for k, v in ...s: e]`) vs `FieldLoop` (`for k, v in ...s:`): **(b) Reducible!** `FieldComprehension` is a dedicated AST node kind (`FieldComprehension`, 15 files, 25 sites) that is used **0 times** in `src/stdlib/**/*.ista` and is trivially expressible as either a `FieldLoop` pushing to an array (`{ let out = []; for k, v in ...s: out.push(e); out }`) or by unifying `Comprehension` and `FieldComprehension` into one node with a union loop header (`ForHeader | FieldHeader`).
   - `StructComprehension` (`struct{for k, v in ...s: [k]: e}`): **(c) Genuinely primitive** for constructing a generic mapped struct type `{ [F in keyof S]: ... }` where the field set is opaque until instantiation.

---

## 4. Statements, Loops, Patterns, Concurrency, Lifetimes, Boundary & Testing (§3.4, §3.11, §4–§10)

### 4.1 Variable declarations (`let`, `const`), destructuring targets, and unnamed `_ = expr` — §3.4, §3.15, §7
1. **What it is:** Block-scoped mutable (`let`) or deeply immutable (`const`) variable declarations with irrefutable destructuring targets (`VariableDeclaration`), plus `_ = expr` holding a value in an unnamed block-scoped register.
2. **Implementation footprint:** **34 files, 74 sites** (`VariableDeclaration`, `checkVariableDeclaration`, `lowerVariableDeclaration`, `declareTargets`, `bindTargets`).
3. **Classification:** **(c) Genuinely primitive** (`VariableDeclaration`); `_ = expr` is parsed as an `Assignment` to `_` (`isUnnamedTarget` in `syntax/statements/targets.ts`) and lowered to an unnamed block register (`declareUnnamed`), which is **(a) Already unified** with block-scoped variable lifetimes.

### 4.2 Assignments (`x = v`, `a, b = (b, a)`, `Pair{first: p.x, second} = q`) & compound assignments (`x += v`) — §3.4, §3.9, §3.15
1. **What it is:** Mutation of a variable or place (`p.f`, `t.0`, `xs[i]`, `*u`, `u->f`), destructuring assignment into multiple places, and compound operator assignment (`+=`, `-=`, `*=`, `/=`, `//=`, `%=`, `**=`, `&=`, `|=`, `^=`, `<<=`, `>>=`).
2. **Implementation footprint:** **22 files, 48 sites** (`Assignment`, `CompoundAssignment`, `compoundOperator`, `checkAssignment`, `lowerAssignment`, `enterAssigned`).
3. **Classification:** Plain place assignment is **(c) Genuinely primitive** (`move` / `store` / `setIndex` / `writeCell`); destructuring assignment is **(a) Already unified** with pattern destructuring via `takeApart` (`checker/constructs/patterns/walk/taking.ts`); compound assignment `x op= y` is **(a) Already a desugaring** of reading place `x` once, calling `op`'s resolved function, and writing the place back (`checkCompound` / `lowerCompound`).

### 4.3 `while`, `for x in c` (`Iterable` / `Step<T>`), `for k, v in ...s` (`FieldLoop`), `break`, `continue`, and `return` — §3.10, §4
1. **What it is:** Condition loop (`While`), cursor-based iterator loop (`For` calling `iterate(c) -> fn() -> Step<T>`), compile-time unrolled struct field loop (`FieldLoop`), loop exits (`Break`, `Continue` with optional label), and function exit (`Return`).
2. **Implementation footprint:**
   - `For` (`checkLoopOver`, `emitLoop`, `emitLoopOver`, `wellKnown.step`): **19 files, 34 sites**.
   - `FieldLoop` (`FieldHeader`, `checkedFieldPasses`, `inFieldPasses`, `fieldsVisited`, `inFieldScope`): **15 files, 25 sites**.
   - `While`, `Break`, `Continue`, `Return`: **24 files, 52 sites**.
3. **Classification:**
   - `While`, `Break`, `Continue`, `Return`: **(c) Genuinely primitive** (lowered to `branch`, `jump`, `release`, `return`).
   - `For`: **(a) Already a desugaring** of calling `iterate(c)` once and looping over `cursor()` until `Step.Done` (`lowering/constructs/loops/iteration.ts:emitLoop`, shared by `For`, `Comprehension`, and `Spread`).
   - `FieldLoop` vs `For`: **(b) AST unification candidate:** In `syntax/statements/index.ts`, `For` and `FieldLoop` are two separate statement kinds (just as `Comprehension` and `FieldComprehension` are two separate expression kinds), requiring duplicate `For` / `FieldLoop` entries across parser, binder, checker, flow IR, lowering, formatter, and editor.

### 4.4 `hold` (`hold let`, `hold const`, `hold _`, `hold(name)`), `LabelledBlock` (`batch: …`), and `keep` — §3.4, §7
1. **What it is:** Extends the lifetime of values held by a block-scoped variable until the enclosing function ends (`hold`), or until a labelled loop or `LabelledBlock` (`batch:`) named by `hold(batch)` ends, lowered via the `keep` bytecode instruction into a hidden list register.
2. **Implementation footprint:** **25 files, 50 sites** (`Hold`, `LabelledBlock`, `HoldScopes`, `heldUntil`, `isHoldScope`, `declareFunctionWide`, `keep`).
   - Syntax/Parser/Binder/Formatter: `compiler/syntax/statements/index.ts` (`Hold`, `LabelledBlock`, `LabelledScope`), `compiler/parser/grammar/statements/{variables,loops}.ts` (`parseHeldVariable`, `parseLabelled`), `compiler/binder/constructs/statements.ts:statementHandlers.LabelledBlock`, `formatter/statements.ts` (`statementPrinters.Hold`, `statementPrinters.LabelledBlock`).
   - Checker: `compiler/checker/constructs/statements/loops.ts` (`checkLabelledBlock`, `checkLoopExit`, `checkHoldScope`, `LabelTargets`), `compiler/checker/contexts/body-context.ts:LabelRecord`, `compiler/checker/surface/checked-body.ts:LabelResolution`, `compiler/checker/lookup/denotations/index.ts` (`chosenIn.Hold`, `heldFunction`), `compiler/checker/rules/flow/build/statements.ts:statementFlows.LabelledBlock`.
   - Lowering, Definition IR & Runtime: `compiler/lowering/constructs/statements/holds.ts:HoldScopes`, `compiler/lowering/constructs/statements/loops.ts:lowerLabelledBlock`, `compiler/lowering/constructs/statements/variables.ts` (`Lifetime`, `Kept`, `BlockScope`, `declareFunctionWide`), `compiler/lowering/constructs/statements/scopes.ts:endScope`, `definition/instructions/lifetimes.ts:keep`, `definition/instructions/instruction.ts:operandTable.keep`, `definition/validation/instruction-rules.ts:rules.keep`, `runtime/interpreter/instructions.ts:handlers.keep`.
3. **Classification:** **(b) Multi-level reduction candidate:**
   - **IR level (`keep` instruction vs `array` instruction):** In `runtime/interpreter/instructions.ts:242`, `handlers.keep` appends registers to an array in `instruction.into` using `frame.heap.values.appended` — the **exact same operation** `handlers.array` (`growsInPlace`) already performs for `[...into, reg]`! Initializing the hold scope's register to `[]` and emitting `array` (`[{ kind: 'spread', value: into }, ...items]`) eliminates the `keep` instruction from `definition/` and `runtime/` completely.
   - **Language level (`hold(label)` and `LabelledBlock`):** `LabelledBlock` (`batch:`) exists in the grammar **solely** so `hold(batch)` can name a block (`break` and `continue` are forbidden on it, §3.4). Neither `LabelledBlock` nor `hold(label)` is used anywhere in `src/stdlib/**/*.ista` (0 uses), and holding values across a loop inside a block is already trivially done by a block expression or helper function with plain `hold _ = ...` or an array `held.push(...)`. Removing `LabelledBlock` and `hold(label)` (keeping only function-scoped `hold`) eliminates `LabelledBlock`, `Hold.label`, `LabelTargets.recordHold`/`heldUntil`/`isHoldScope`, `HoldScopes.#labelled`, and `lookup/denotations/index.ts:heldFunction` (**18 files, 36 sites**).

### 4.5 `drop expr` / `drop x` & must-use checking — §7
1. **What it is:** Statement `drop expr` (discards a must-use expression temporary at statement end) or `drop x` (releases local variable `x` early via `release` and forbids subsequent reads of `x` on any control-flow path until reassigned).
2. **Implementation footprint:** **11 files, 16 sites** (`Drop`, `droppedName`, `checkDrop`, `lowerDrop`, `checkDiscarded`, `compiler/checker/rules/disposal/dropped.ts`, `compiler/checker/rules/disposal/must-use.ts`).
3. **Classification:** **(c) Genuinely primitive** for early variable release (`drop x` -> `release [x]` + forward dataflow definite-unassignment check in `rules/disposal/dropped.ts`). Note that `drop expr` on a non-variable expression is a no-op in lowering (`lowerDrop` just evaluates `node.value` and lets normal statement-end temporary release dispose it).

### 4.6 Patterns (`_`, bindings, literals, `as`, tuples, `VariantCallPattern`, `StructPattern`, `OrPattern`, `ArrayPattern`, `RangePattern`) — §3.11
1. **What it is:** Unified pattern language for `match`, `is`, variable declarations, `for` loops, and parameters, with exhaustiveness/usefulness analysis (`exhaustiveness.ts`).
2. **Implementation footprint:**
   - Core patterns (`WildcardPattern`, `NamePattern`, `LiteralPattern`, `TuplePattern`, `AsPattern`, `CheckedPattern`, `lowerMatching`): **40 files, 119 sites**.
   - `StructPattern` & parts (`BindFieldPattern`, `CompareFieldPattern`, `NestedFieldPattern`, `RestPattern`): **29 files, 115 sites**.
   - `VariantCallPattern` & parts (`NamedPatternArgument`, `OtherFieldsPattern`): **20 files, 70 sites**.
   - `OrPattern`: **9 files, 16 sites**.
   - `ArrayPattern` (`_patternItem`, `_patternRest`): **13 files, 20 sites**.
   - `RangePattern`: **10 files, 15 sites**.
3. **Classification & Overlaps:**
   - **Overlap 1 (`BindFieldPattern` + `NestedFieldPattern` + `CompareFieldPattern` in `StructPattern` vs `NamedPatternArgument` in `VariantCallPattern`):** **(b) Reducible!**
     In `StructPattern`, field items have **three** bespoke AST node kinds:
     1. `BindFieldPattern` (`field` or `field as alias`)
     2. `NestedFieldPattern` (`field is Pattern`)
     3. `CompareFieldPattern` (`field == expr`, `field != expr`, `field < expr`, etc.)
     Whereas `VariantCallPattern` has `NamedPatternArgument` (`field: Pattern`), `StructLiteral` has `FieldInitializer` (`field: expr` or `field`), and destructuring assignment has `Pair{first: p.x, second} = q`!
     Furthermore, `CompareFieldPattern` (`case Verdict{ok == false}`, `case Order{amount > 1000}`) duplicates literal pattern equality AND operator resolution inside `matching.ts:comparison` (lines 209–250) ONLY for struct fields (not tuple elements or variant arguments!), even though `ok is false` (or `ok: false`) is already a `LiteralPattern` and `case Order{amount} if amount > 1000:` is already a `match` guard! Replacing `BindFieldPattern`, `NestedFieldPattern`, and `CompareFieldPattern` with a single `FieldPattern` (`field: Pattern` with shorthand `field` -> `field: NamePattern(field)` and `field as alias` -> `field: _ as alias`) eliminates 2–3 AST node kinds and `matching.ts:comparison` across **14 files, 35 sites**.
   - **Overlap 2 (`RangePattern` `0..=59` vs `Range` + guard):** **(b) Reducible!** `RangePattern` (`compiler/checker/constructs/patterns/walk/kinds/ranges.ts`) only accepts integer literals, does not participate in exhaustiveness (`shape: undefined`, acting as a guard per §3.11), and duplicates `Range` bounds checking (**10 files, 15 sites**).

### 4.7 `await` and `select` (`await select:` / `select:` with `else:`) — §5, §8
1. **What it is:** Suspension/commit point (`await expr`, `await select:`) or non-blocking poll (`select:` with `else:`), operating on any `Awaitable<T>` via its `onAwait(self, done: Resolver<T, Mode>)` method.
2. **Implementation footprint:**
   - `Await`: **16 files, 24 sites** (`compiler/syntax/expressions/index.ts:Await`, `compiler/checker/constructs/expressions/control/await.ts`, `compiler/lowering/constructs/expressions/control/await.ts`, `compiler/lowering/calls/waits.ts:awaitWait`, `definition/instructions/suspension.ts:awaitWait`, `runtime/interpreter/{instructions,suspension}.ts`).
   - `Select` & `SelectCase`: **26 files, 52 sites** (`compiler/syntax/expressions/index.ts:Select`, `compiler/checker/constructs/expressions/control/select.ts`, `compiler/lowering/constructs/expressions/control/select.ts`, `definition/instructions/suspension.ts:select`, `runtime/interpreter/{instructions,suspension}.ts`).
3. **Classification:** **(b) Reducible overlap (especially in lowering, Definition IR & runtime)!**
   - `await expr` is semantically identical to a 1-case blocking `select`:
     `await select: case expr as v: v` (with the sole difference in `checkAwait` that `expected` propagates down to `expr` as `Future<expected, codeKind>`).
   - Both `lowerAwait` and `lowerSelect` already call `openWait(context, cases, span)` (`compiler/lowering/calls/waits.ts`).
   - Yet the Definition IR defines **both** an `await` instruction (`{ dst, wait, waypoint }`) and a `select` instruction (`{ wait, cases, otherwise, waypoint }`), forcing `definition/instructions/{suspension,flow,instruction}.ts`, `definition/validation/instruction-rules.ts`, `runtime/interpreter/{instructions,suspension}.ts`, `runtime/scheduler/inspect.ts`, and `runtime/snapshot/check/waits.ts` (**11 files, 18 sites**) to branch on `instruction.kind === 'await' || instruction.kind === 'select'`!
   - Lowering `Await` to `select` with 1 case `[{ holds: [], bind: dst, target: nextLabel }]` (or unifying `Await` into `Select` after checking) eliminates the `await` bytecode instruction and all dual `await`/`select` handling in `definition/` and `runtime/`.

### 4.8 Futures (`Future<T, K>`), Resolvers (`Resolver<T, K>`, `Resolver.of`, `Resolver.at`, `onCancel`), and `Awaitable<T>` — §3.8, §5, §6
1. **What it is:** One-shot wait handles (`Future`) and wait-decision handles (`Resolver`) that decouple `await`/`select` from concrete asynchronous sources via `trait Awaitable<T> { type Mode in Persistence; Self.Mode fn onAwait(self: Self, done: Resolver<T, Self.Mode>) }`.
2. **Implementation footprint:** **11 files, 17 sites** in compiler/stdlib (`wellKnown.future`, `wellKnown.resolver`, `openWait`, `waitNatives`), plus `runtime/scheduler/instance/{futures,waits/index,waits/resolvers,waits/settle-order,waits/endings}.ts` and `runtime/scheduler/live-resolvers.ts`.
3. **Classification:** **(c) Genuinely primitive** runtime wait mechanism (already enabled `futures.first`, `futures.all`, `futures.race`, `futures.any`, `futures.quorum`, `futures.timeout`, `futures.retry`, and `runtime.Call` to be written in pure `.ista` library code!).

### 4.9 Slots (`Slot<T>`, `put`, `take`, `read`), Inboxes (`Inbox<T>`, `Revertible<T>`), `rpc`, and `fanout` — §3.2, §3.8, §6
1. **What it is:** The runtime's single synchronization primitive (`Slot<T>`), upon which `inbox.ista`, `rpc.ista`, and `fanout.ista` are built in pure Istalang.
2. **Implementation footprint:** `Slot<T>` has only **5 files, 6 sites** in stdlib/wiring (`stdlib/prelude/slot-natives.ts`, `runtime/scheduler/instance/slots.ts`); `inbox`, `rpc`, and `fanout` have **0 compiler or runtime sites**!
3. **Classification:** `Slot<T>` is **(c) Genuinely primitive**; `Inbox<T>`, `Revertible<T>`, `rpc.Method<P, R>`, and `fanout.Bus<M>` are **(a) Already 100% library code in `.ista`**.

### 4.10 Disposal (`Disposable`, `dispose`), static cycle analysis (`@Holds`, `@Keeps`), `WeakRef<T>`, `worker.disposing()`, and `defer` — §3.8, §3.16, §7
1. **What it is:** Deterministic reference-counted scope-exit disposal with compile-time cycle rejection (`rules/lifetimes/`), weak references (`WeakRef`, `deref`, `disposed`), graceful call cancellation watch (`worker.disposing()`), and scope-exit callbacks (`defer`).
2. **Implementation footprint:**
   - `Disposable` & static lifetime cycle analysis (`disposeFunction`, `disposalOf`, `reachesDisposable`, `wellKnown.holds`, `wellKnown.keeps`): **26 files, 68 sites** (`compiler/checker/rules/disposal/disposal.ts`, `compiler/checker/rules/lifetimes/**`, `runtime/lifetimes/**`).
   - `defer`: **0 compiler/runtime sites** — **(a) Already 100% library code** in `prelude.ista` (`Deferred<M>` shared struct + `defer` function + `DeferredCall`)!
   - `WeakRef<T>`: **4 files, 6 sites** (`wellKnown.weakRef`, `stdlib/prelude/weak-natives.ts`, `runtime/scheduler/instance/weak-side.ts`) — **(c) Genuinely primitive** runtime handle.
   - `worker.disposing()` (`ownCallOf`, `declareOwnCall`, `ownCallerOf`, `watchesOwnDisposal`, `wellKnown.call`, `wellKnown.disposing`, `currentCall` instruction): **17 files, 23 sites**.
3. **Classification of `worker.disposing()` (`OwnCall` / `currentCall`):** **(b) Reducible!**
   - Today, writing `worker.disposing()` inside `ista async fn worker()` requires:
     1. Special binder lookahead `useBeforeMember` (`compiler/binder/module/local-binder.ts`) that intercepts `worker` before `.` and binds it to a synthetic `OwnCall` entity (`compiler/binder/module/own-calls.ts`) instead of the function `worker`!
     2. `Bindings.ownCallOf` on the binder contract (`compiler/binder/entities.ts`, `compiler/checker/wiring/program/program-inputs.ts`).
     3. `declareOwnCall` and `ownCallerOf` in the checker (`compiler/checker/constructs/closures/own-calls.ts`).
     4. `declareOwnCall` in lowering (`compiler/lowering/functions/frame-variables.ts`).
     5. A dedicated `currentCall` instruction in the Definition IR (`definition/instructions/calls.ts`, `instruction.ts`, `instruction-rules.ts`) and interpreter (`runtime/interpreter/instructions.ts:handlers.currentCall`).
   - If `currentCall()` (or `disposing()`) is a prelude extern `extern K fn currentCall<K in Persistence>() -> Call` (or `currentCall` instruction is replaced by a prelude extern), the dedicated `currentCall` IR instruction disappears; and if `disposing()` / `currentCall()` is called directly rather than overloading the enclosing function's name before `.`, the entire `OwnCall` binder/checker/lowering pipeline (**17 files, 23 sites**) disappears!

### 4.11 `spawn`, `Instance<T>`, `runtime.isolate`, `runtime.delegate` (jobs), and `Runtime` contexts — §5, §9
1. **What it is:** Spawning independent persistent instances (`spawn`, `Instance.result`, `runtime.isolate`), delegating live work after commit (`runtime.delegate`, `runtime._serve`), and driving persistent contexts from live code (`Runtime.open`, `rt.call`, `runtime.run`).
2. **Implementation footprint:**
   - `spawn` & `Instance<T>`: **7 files, 7 sites** (`wellKnown.instance`, `stdlib/prelude/instance-natives.ts`, `compiler/checker/rules/boundary/outcome-codecs.ts`, `definition/tables/types.ts:outcomeEncoderOf`).
   - `runtime.delegate` & `_serve`: **9 files, 11 sites** (`foundation/language/well-known/jobs.ts`, `compiler/lowering/lower.ts:jobDeclarationsOf`, `definition/tables/index.ts:jobServer`).
3. **Classification:** **(a) Already library code** over minimal runtime primitives (`spawn` is a prelude extern called via `DeferredCall`; `isolate` is 1 line in `runtime.ista`; `delegate` and `_serve` are written in `runtime.ista` over `Inbox` and `Slot`).

### 4.12 Host boundary & JSON codecs (`Json`, `Encodable`, `Decodable`, `_toJson`, `_fromJson`, `@JsonName`, `@JsonSkip`, `@JsonBigInt`) — §3.6, §3.16, §9
1. **What it is:** Value conversion across the host boundary and `json.encode`/`decode`/`stringify`/`parse` via `toJson` and `fromJson` trait witnesses, compiler-derived for structs, shapes, enums, tuples, host types, and literal types/unions.
2. **Implementation footprint:** **15 files, 34 sites** (`wellKnown.json`, `wellKnown.encodable`, `wellKnown.decodable`, `codecFunctions`, `derivedCodecs`, `codecHelpers`, `JsonForms`, `Encoder`, `Decoder`, `hostExternEntry`, `starts.ts`).
   - `compiler/checker/rules/boundary/{json-forms,host-boundary,outcome-codecs}.ts`, `compiler/checker/surface/{json-form,host-externs}.ts`, `compiler/lowering/synthesized/boundary/{codecs,codec-calls,encoder,decoder,host-externs,inbound,starts}.ts`, `definition/values/json-values.ts`, `stdlib/json/{json.ista,natives.ts}`.
3. **Classification:**
   - Primitives, `Array`, `Optional`, `Map`, `Time`, `Duration`, `DateTime`, `Zone`, `Decimal`, `Regex`: **(a) Already written in `.ista`** (`json.ista`, `time.ista`, `decimal.ista`, `regex.ista`).
   - Structs, enums, tuples, literal unions (`Encoder` and `Decoder` in `compiler/lowering/synthesized/boundary/{encoder,decoder}.ts`): **(b) Partially reducible!**
     Notice that Istalang **already** has field loops (`for k, v in ...s`) and struct comprehensions (`struct{for k, v in ...s: [k]: ...}`)! For unannotated structs/shapes (`S is struct { [_] is Encodable }` / `[_] is Decodable`), `toJson` and `fromJson` can be expressed in `json.ista` using a field loop / struct comprehension, leaving compiler synthesis only for `@JsonName`/`@JsonSkip`/`@JsonBigInt`, enums, tuples, and literal unions (or as spec §14 notes, moving codecs into `.ista`).

### 4.13 Testing (`@Suite`, `Test`, `mock`, `Mock<F>`, `handle<T>()`, `spawnCrashingEveryAwait`, `idle`, `reaches`, `waitingAt`, `state`) — §10
1. **What it is:** Built-in test runner (`ista test`) and mocking/inspection primitives in `testing.ista`.
2. **Implementation footprint:** **6 files, 7 sites** in compiler/stdlib (`wellKnown.suite`, `wellKnown.test`, `testingFunctions`, `compiler/checker/rules/testing.ts`, `compiler/lowering/lower.ts:lowerTests`, `stdlib/testing/natives.ts`), plus `runtime/testing/**` and `runtime/scheduler/testing/**`.
3. **Classification:** **(a) Already mostly in `testing.ista`** (`test`, `group`, `skip`, `only`, `Setup`, `setups`, `FakeClock`, `FakeQueue`, `FakeReceipts`, `assert`, `assertEq`, `expectPanic`, `_list`, `_run` are all pure `.ista` code in `src/stdlib/testing/testing.ista`).

---

## 5. Stdlib `.ista` Functions Done by TS Natives or Compiler Special-Cases That Could Move to `.ista`

Every `extern fn` below is currently declared `extern` in `src/stdlib/**/*.ista` and implemented in TypeScript in `src/stdlib/**/*.ts`, even though it requires **zero** host/runtime capabilities and can be written directly in `.ista`:

### 5.1 `decimal/decimal.ista` — 18 `extern fn`s replaceable by `.ista` (`src/stdlib/decimal/natives.ts`)
- **16 mixed `(Decimal, Int)` and `(Int, Decimal)` overloads:**
  - `add(Decimal, Int)`, `add(Int, Decimal)`
  - `subtract(Decimal, Int)`, `subtract(Int, Decimal)`
  - `multiply(Decimal, Int)`, `multiply(Int, Decimal)`
  - `divide(Decimal, Int)`, `divide(Int, Decimal)`
  - `divide(Decimal, Int, Int, Rounding)`, `divide(Int, Decimal, Int, Rounding)`
  - `floorDivide(Decimal, Int)`, `floorDivide(Int, Decimal)`
  - `remainder(Decimal, Int)`, `remainder(Int, Decimal)`
  - `compare(Decimal, Int)`, `compare(Int, Decimal)`
  - **Evidence:** In `src/stdlib/decimal/natives.ts:96–117`, `mixedOverloads` and `operand` literally convert the `Int` argument via `decimalOf(value)` (`Decimal(i)`) and call the `(Decimal, Decimal)` operation! Writing `fn add(left: Decimal, right: Int) -> Decimal: left + Decimal(right)` (etc.) in `decimal.ista` eliminates `mixedOverloads` and 16 native entries.
- **`abs(self: Decimal) -> Decimal` and `remainder(left: Decimal, right: Decimal) -> Decimal`:**
  - `fn abs(self: Decimal) -> Decimal: if self < Decimal(0): -self else: self`
  - `fn remainder(left: Decimal, right: Decimal) -> Decimal: left - (left // right) * right` (matching `src/stdlib/decimal/arithmetic.ts:remainderOf`!).

### 5.2 `prelude/prelude.ista` (Numeric & Boolean) — 15 `extern fn`s replaceable by `.ista` (`src/stdlib/prelude/natives.ts`, `src/stdlib/numeric.ts`, `src/stdlib/prelude/text-forms.ts`)
- **11 mixed `(Int, Float)` / `(Float, Int)` and `divide(Int, Int)` overloads:**
  - `add(Int, Float)`, `add(Float, Int)`
  - `subtract(Int, Float)`, `subtract(Float, Int)`
  - `multiply(Int, Float)`, `multiply(Float, Int)`
  - `divide(Int, Int)`, `divide(Int, Float)`, `divide(Float, Int)`
  - `power(Int, Float)`, `power(Float, Int)`
  - **Evidence:** `src/stdlib/numeric.ts:numeric` (`asFloat`) converts any `Int` operand with `Number(a)` (`Float(a)`) and runs the `(Float, Float)` operation! Writing these in `prelude.ista` as `Float(left) + right`, etc. deletes `src/stdlib/numeric.ts` (`numeric` helper) and 11 native entries.
- **`remainder(left: Int, right: Int) -> Int` and `bitNot(value: Int) -> Int`:**
  - In `src/stdlib/prelude/natives.ts:106`, `remainder` is `dividend - floorDivide(dividend, by) * by` -> in `prelude.ista`: `fn remainder(left: Int, right: Int) -> Int: left - (left // right) * right`.
  - `fn bitNot(value: Int) -> Int: -value - 1`.
- **`toString(self: Bool) -> String` and `Bool.parse(text: String) -> Result<Bool>`:**
  - Currently in `src/stdlib/prelude/text-forms.ts:44,58`. In `prelude.ista`:
    `fn toString(self: Bool) -> String: if self: "true" else: "false"`
    `fn Bool.parse(text: String) -> Result<Bool>: match text: case "true": Ok(true); case "false": Ok(false); case _: Err(Error{message: "'" + text + "' is not a Bool.", code: "parse"})`.

### 5.3 `prelude/prelude.ista` (`Range`) — 2 `extern fn`s replaceable by `.ista`, deleting `src/stdlib/prelude/range-natives.ts`
- **`extern fn _steps(self: Range) -> (Int, Int, Int)`** and **`extern fn includes(self: Range, value: Int) -> Bool`:**
  - **Evidence:** `Range` is a plain `.ista` struct declared in `prelude.ista` (`struct Range { start: Int?, end: Int?, step: Int = 1 }`). Yet `_steps` and `includes` are implemented as TS natives in `src/stdlib/prelude/range-natives.ts` and `src/stdlib/ranges.ts` (`rangeOf`, `bounded`, `countOf`, `reaches`, `textOf`), which have to inspect the `Range` struct's fields by name from TypeScript (`fieldValueOf(context.types, range, 'start')`)!
  - Moving `_steps` and `includes` into `prelude.ista` deletes `src/stdlib/prelude/range-natives.ts` completely!

### 5.4 `prelude/prelude.ista` (`Array` and `Map`) — 13 `extern fn`s replaceable by `.ista` (`src/stdlib/prelude/arrays.ts`, `src/stdlib/prelude/maps.ts`)
- **Collection defaults:**
  - `extern fn Array.default<T>() -> Array<T>` -> `fn Array.default<T>() -> Array<T>: []`
  - `extern fn Map.default<K, V>() -> Map<K, V>` -> `fn Map.default<K, V>() -> Map<K, V>: [:]`
  - (`Optional.default` is already `fn Optional.default<T>() -> T?: none` in `prelude.ista`!)
- **Array pattern helpers (compiler implicit calls in `arrayPatternFunctions`):**
  - `extern fn _patternItem<T>(self: Array<T>, offset: Int) -> T` -> `fn _patternItem<T>(self: Array<T>, offset: Int) -> T: self[if offset < 0: self.length() + offset else: offset]`
  - `extern fn _patternRest<T>(self: Array<T>, before: Int, after: Int) -> Array<T>` -> `fn _patternRest<T>(self: Array<T>, before: Int, after: Int) -> Array<T>: self[before..(self.length() - after)]`
  - Moving these two to `prelude.ista` deletes `patternNatives` from `src/stdlib/prelude/arrays.ts`!
- **Array methods:**
  - `extern fn at<T>(self: Array<T>, index: Int) -> T?`: `const i = if index < 0: self.length() + index else: index; if 0 <= i < self.length(): self[i] else: none`
  - `extern fn indexOf<T>(self: Array<T>, item: T) -> Int`: `self.findIndex(fn(each): each == item)`
  - `extern fn lastIndexOf<T>(self: Array<T>, item: T) -> Int`: `self.findLastIndex(fn(each): each == item)`
  - `extern fn includes<T>(self: Array<T>, item: T) -> Bool`: `self.indexOf(item) >= 0`
  - `extern fn flat<T>(self: Array<Array<T>>) -> Array<T>`: `let out: Array<T> = []; for inner in self: out = [...out, ...inner]; out`
  - `extern fn slice<T>(self: Array<T>, start: Int = 0, end: Int? = none) -> Array<T>`: clamped range index `self[from..to]`.
- **Map methods:**
  - `extern fn includes<K, V>(self: Map<K, V>, key: K) -> Bool`: `self.has(key)` (just as `collections.ista` already writes for `WeakMap`!)
  - `extern fn keys<K, V>(self: Map<K, V>) -> Array<K>`: `[for k, _ in self: k]`
  - `extern fn values<K, V>(self: Map<K, V>) -> Array<V>`: `[for _, v in self: v]`
  - `extern fn entries<K, V>(self: Map<K, V>) -> Array<(K, V)>`: `[...self]`

### 5.5 `math/math.ista` — 2 `extern fn`s replaceable by `.ista` (`src/stdlib/math/natives.ts`)
- `extern fn abs(self: Int) -> Int` -> `fn abs(self: Int) -> Int: if self < 0: -self else: self`
- `extern fn sqrt(self: Int) -> Float` -> `fn sqrt(self: Int) -> Float: Float(self).sqrt()`

### 5.6 `strings/strings.ista` — 7 `extern fn`s replaceable by `.ista`, deleting `src/stdlib/strings/format.ts` (`src/stdlib/strings/natives.ts`)
- `extern fn format(template: String, ...values: Array<String>) -> String`: `src/stdlib/strings/format.ts` (`formatted`) is 35 lines of pure string scanning (`{{`, `}}`, `{}`, `{n}`) with zero host/runtime dependencies; moving it to `strings.ista` deletes `src/stdlib/strings/format.ts`.
- `extern fn startsWith(self: String, prefix: String) -> Bool`: `self.slice(0, prefix.length()) == prefix`
- `extern fn endsWith(self: String, suffix: String) -> Bool`: `suffix.length() <= self.length() and self.slice(self.length() - suffix.length()) == suffix`
- `extern fn padStart(self: String, length: Int, fill: String = " ") -> String` and `padEnd`: pure `.ista` over `repeat`, `length`, and `slice` (matching `padding` in `src/stdlib/strings/natives.ts:116–126`).
- `extern fn replace(self: String, search: String, replacement: String) -> String` and `replaceAll`: pure `.ista` over `indexOf`, `slice`, `split`, and `join` (matching `replacedFirst` and `replacedAll` in `src/stdlib/strings/natives.ts:89–106`).

### 5.7 `time/time.ista` — `toString(self: Duration)` replaceable by `.ista` (`src/stdlib/time/iso.ts`)
- `extern fn toString(self: Duration) -> String`: `durationText` in `src/stdlib/time/iso.ts:68–84` is 16 lines of pure integer division/modulo on `self.value` (`hours`, `minutes`, `seconds`, `milliseconds`) and string formatting. Moving it to `time.ista` removes `durationText` from `src/stdlib/time/iso.ts`.

---

## Reduction candidates

Ranked by concrete payoff (number of `file:function` sites and whole modules that disappear, plus cross-phase coupling eliminated).

### Rank 1: Unify `SharedStructDeclaration` / `NewStructLiteral` / `Dereference` (`shared struct`, `new`, `->`, `*`) and merge the two IR/runtime cell mechanisms (`CodeFunction.cells` / `_Cell<T>` vs `newCell` / `readCell` / `writeCell`)
- **Spec §:** §3.18 (`shared struct`, `new`), §3.9 (`*x`, `x->f`, `x?->f`), §3.7 (`&`), §3.14 (closure `let` capture).
- **What overlaps / why it is redundant:**
  1. **AST split (`SharedStructDeclaration` vs `StructDeclaration`, `NewStructLiteral` vs `StructLiteral`):** `SharedStructDeclaration` and `StructDeclaration` have the exact same fields (`StructOf<Kind>` in `compiler/syntax/declarations/index.ts:156`), and `NewStructLiteral` and `StructLiteral` have the exact same fields (`type`, `items`; note `IndentedValue` already uses `readonly isNew: boolean` rather than a second node kind). Keeping separate node kinds forces every phase (parser, binder, checker, flow IR, lowering, formatter, language-service) to duplicate handlers.
  2. **Dual cell mechanisms in Definition IR & Runtime (`CodeFunction.cells` / `prelude._Cell` / `role: 'cell'` vs `newCell` / `readCell` / `writeCell` / `role: 'shared'`):** In `runtime/interpreter/registers.ts`, every single `readRegister` and `writeRegister` on every instruction checks `isCell(frame, register)` (`frame.code.cells.some(...)`) to implicitly allocate/read/write a heap cell of `role: 'cell'` (`prelude._Cell<T>`), while right below it `newCell`, `readCell`, and `writeCell` explicitly allocate/read/write a heap cell of `role: 'shared'`. If `inCell` local variables use `newCell`/`readCell`/`writeCell` (or `Shared<T>`), then `CodeFunction.cells`, `prelude._Cell`, `wellKnown.cell`, `role: 'cell'`, and the per-register cell check in `readRegister`/`writeRegister`/`capturedContents` all disappear.
  3. **Spec-level reduction:** If `shared struct` uses ordinary construction `Lease{...}` and `.` field access (since `shared struct Lease` already statically declares that `Lease` is a cell handle, and methods are already called with `lease.renew()`), `new`, `->`, `?->`, and `Dereference` disappear completely too.
- **Evidence (`file:function` list — 65 files, 116 sites for `SharedStructDeclaration`/`NewStructLiteral`/`Dereference` + 22 files, 45 sites for `_Cell`/`cells`):**
  - AST & Syntax: `compiler/syntax/declarations/index.ts` (`SharedStructDeclaration`, `DeclaredStruct`, `isDeclaredStruct`), `compiler/syntax/declarations/field-defaults.ts:fieldsFunctionsOf`, `compiler/syntax/expressions/index.ts` (`NewStructLiteral`, `FieldsLiteral`, `Dereference`), `compiler/syntax/expressions/chains.ts:chainStepOf`, `compiler/syntax/expressions/places.ts:isPlace`, `compiler/syntax/expressions/literals/{built-types,indented-values}.ts`, `compiler/syntax/items.ts:placeOf`.
  - Parser & Binder: `compiler/parser/grammar/declarations/type-declarations.ts:parseSharedStruct`, `compiler/parser/grammar/expressions/literals/struct-literals.ts:parseNew`, `compiler/parser/grammar/expressions/{operators,postfix}.ts` (`parseDereference`, `parseDoubleDereference`, `arrowParselet`), `compiler/binder/constructs/declarations.ts:declarationHandlers.SharedStructDeclaration`, `compiler/binder/constructs/expressions.ts` (`expressionHandlers.NewStructLiteral`, `expressionHandlers.Dereference`), `compiler/binder/entities.ts:TypeDeclaration`.
  - Checker: `compiler/checker/constructs/declarations/declarations.ts:declarationHandlers.SharedStructDeclaration`, `compiler/checker/constructs/declarations/layout/index.ts:Layouts.sharedValueOf`, `compiler/checker/constructs/declarations/variance-markers.ts:checkMarker`, `compiler/checker/constructs/expressions/structs/structs.ts` (`checkNew`, `namedLiteralType`, `declaredShape`), `compiler/checker/constructs/expressions/access/dereference.ts` (`checkDereference`, `valueBehind`), `compiler/checker/constructs/expressions/access/member-access.ts:noField`, `compiler/checker/resolution/calls/places.ts` (`changePlace`, `checkReferencedPlaces`, `throughShared`, `placeIdentity`, `accessorsOf`), `compiler/checker/rules/flow/build/{expressions,literals,places}.ts`, `compiler/checker/types/type/well-known.ts:cellTypeOf`, `compiler/checker/constructs/statements/variables.ts:VariableScope.inCell`.
  - Lowering, Definition IR & Runtime: `compiler/lowering/constructs/expressions/structs/structs.ts:lowerNewStructLiteral`, `compiler/lowering/values/struct-values.ts:structValue`, `compiler/lowering/constructs/parts/places.ts` (`locate`, `lowerDereference`, `sharedAccessor`, `cellRegister`, `cellTypeIndex`), `compiler/lowering/constructs/statements/variables.ts` (`VariableRegisters.addCell`, `declareVariable`), `compiler/lowering/tables/type-table.ts` (`externRoles.cell`, `TypeTable.#layout`), `definition/tables/functions.ts:cell`, `definition/tables/types.ts` (`externRole`, `isCellType`), `runtime/interpreter/registers.ts` (`readRegister`, `writeRegister`, `capturedContents`, `isCell`).
  - Editor & Formatter: `editor/language-service/{hover,navigation/rename,outline/folding,outline/symbols,semantic-tokens/name-types,completion/places/literal-field,completion/places/type,completion/presentation/entity-items}.ts`, `formatter/{declarations,expressions/index,comments/comment-placement,layout/bodies,layout/brackets}.ts`.
- **Payoff:**
  - **64 sites across 42 files** disappear from merging `SharedStructDeclaration` into `StructDeclaration` and `NewStructLiteral` into `StructLiteral`.
  - **45 sites across 22 files** disappear from unifying `_Cell<T>` / `CodeFunction.cells` with `newCell`/`readCell`/`writeCell`.
  - **30 additional sites across 17 files** (including all of `compiler/checker/constructs/expressions/access/dereference.ts`) disappear if `x->f` / `*x` are unified with `.` / `Shared<T>`.

---

### Rank 2: Desugar `IndentedValue` at parse time (by requiring quoted keys in indented maps, matching `[ "k": v ]`)
- **Spec §:** §2 ("Indented values").
- **What overlaps / why it is redundant:**
  - Every `IndentedValue` (`Service:\n  name: "api"`) is converted by `literalOf(node, form)` (`compiler/syntax/expressions/literals/indented-values.ts:62`) into a `StructLiteral`, `NewStructLiteral`, `MapLiteral`, or `ArrayLiteral`.
  - The **only** reason `IndentedValue` cannot be desugared in the parser and instead survives as a separate AST node across binder, checker, scope-protocol, flow IR, constant computation, lowering, and language-service is that `LOG_LEVEL: "debug"` with an unquoted identifier key can mean either a struct field `LOG_LEVEL` or a `Map<String, V>` entry `"LOG_LEVEL": "debug"`, depending on the expected type!
  - As `docs/arch/architecture.md` states, this single ambiguity is also the **only** reason `editor/language-service/semantic-tokens/` has to invoke the type checker (`built-keys.ts`)!
  - If indented maps quote their string keys (`"LOG_LEVEL": "debug"`, consistent with bracket map literals `["LOG_LEVEL": "debug"]`), then `- item` is always an `ArrayLiteral`, `"k": v` is always a `MapLiteral`, and `field: v` is always a `StructLiteral`/`NewStructLiteral`.
- **Evidence (`file:function` list — 26 files, 75 sites):**
  - `compiler/syntax/expressions/index.ts` (`QuotedEntry`, `IndentedItem`, `IndentedEntry`, `IndentedValueOf`, `IndentedValue`),
  - `compiler/syntax/expressions/literals/indented-values.ts` (`isItem`, `isKeyed`, `untypedForm`, `literals`, `literalOf`, `bareKeyOf`, `entriesLeftOut`, `holds`, `builders`),
  - `compiler/syntax/expressions/literals/built-types.ts` (`NamingLiteral`, `literalNaming`, `buildsShared`),
  - `compiler/syntax/expressions/readings.ts:isItemsLiteral`,
  - `compiler/binder/constructs/expressions.ts` (`bindLiteral`, `expressionHandlers.IndentedValue`),
  - `compiler/checker/constructs/expressions/expressions.ts:expressionHandlers.IndentedValue`,
  - `compiler/checker/constructs/expressions/literals/indented-values.ts` (`checkIndentedValue`, `buildingOf`, `anonymousForm`, `namesStruct`, `formOf`, `isStructType`, `reportLeftOut`, `leftOutDiagnostic`, `keysFit`, `takesStrings`, `checkValuesAlone`, `indentedAccepts` — **entire 218-line file**),
  - `compiler/checker/constructs/expressions/postponed.ts` (`postponed`, `ownAdmits`),
  - `compiler/checker/contexts/body-context.ts:BodyContext.recordBuilt`,
  - `compiler/checker/surface/checked-body.ts:BodyFacts.builtLiteralOf`,
  - `compiler/checker/wiring/body/{body-checker,body-records,scope-protocol,facts/index,facts/body-instantiation,facts/pass-joins,facts/recorded-body}.ts`,
  - `compiler/checker/rules/computation/index.ts:Computation.#own`,
  - `compiler/checker/rules/flow/build/{expressions,literals}.ts` (`expressionFlows.IndentedValue`, `indentedValue`),
  - `compiler/checker/lookup/{denotations/index,key-denotations}.ts`,
  - `compiler/lowering/constructs/expressions/expressions.ts:expressionHandlers.IndentedValue`,
  - `editor/language-service/semantic-tokens/built-keys.ts:builtKeyTypesOf` (**entire file**),
  - `editor/language-service/{completion/places/literal-field,navigation/rename,outline/folding}.ts`.
- **Payoff:** **~65 sites across 24 files** disappear (including 3 entire files: `compiler/checker/constructs/expressions/literals/indented-values.ts`, `compiler/syntax/expressions/literals/indented-values.ts`, and `editor/language-service/semantic-tokens/built-keys.ts`), and semantic tokens become 100% syntax-only.

---

### Rank 3: Desugar `DeferredCall` (`g f(args)`) into `const` captures + `Lambda` (`{ const _0 = args; g(fn(): f(_0)) }`)
- **Spec §:** §3.14 ("Deferred calls"), §7 (`defer`), §9 (`spawn`).
- **What overlaps / why it is redundant:**
  - `g f(args)` evaluates `f`'s receiver/callee and arguments eagerly by copy and passes a 0-argument closure `fn(): f(args)` to `g`.
  - Because `const` bindings in Istalang (§3.14) are **already** captured by copy in a `Lambda` (never in a `_Cell`), and `Lambda` **already** infers its mark (`laterMarkOf`) and `"sendable"` (`capturedSend`) from its captures and body, and **already** wraps a synchronous result into an async entry when expected as `Fn<(), Future<R, K>, K>`, the entire parallel `DeferredCall` checking/flow/lowering/table pipeline duplicates `Lambda`!
- **Evidence (`file:function` list — 34 files, 71 sites):**
  - `compiler/checker/constructs/expressions/deferred-calls.ts` (`Deferrals`, `checkDeferredCall`, `missingComma`, `deferredFunction`, `laterMarkOf`, `laterCallKind`, `unmade`, `refused`, `computedNow` — **entire 266-line file**),
  - `compiler/checker/resolution/calls/deferred-arguments.ts` (`DeferredArgument`, `unsendable`, `checkDeferredArguments` — **entire file**),
  - `compiler/checker/rules/flow/build/calls.ts` (`deferredFunction`, `closureMaking`, `isMade`, `computedNow`, `madeLater`),
  - `compiler/checker/rules/kinds/data-kinds.ts:laterOf`,
  - `compiler/checker/rules/boundary/outcome-codecs.ts:isCalling`,
  - `compiler/checker/rules/disposal/disposal.ts:checkSelfStays`,
  - `compiler/checker/contexts/body-context.ts:DeferralRecord`,
  - `compiler/checker/surface/checked-body.ts:BodyFacts.deferredFunctionOf`,
  - `compiler/checker/wiring/body/{body-checker,scope-protocol,facts/index,facts/recorded-body,facts/body-instantiation,facts/pass-joins}.ts`,
  - `compiler/lowering/constructs/expressions/deferred-calls.ts` (`lowerDeferredCall`, `deferredFunction`, `isMade`, `computedNow`, `givenFunction`, `deferredEntry`, `capturedBy`, `madeCall` — **entire 186-line file**),
  - `compiler/lowering/tables/instances.ts` (`DeferredFunction`, `DeferredPlan`, `deferredKey`, `deferredName`),
  - `compiler/lowering/tables/tables.ts` (`PendingEntry` `'deferred'`, `deferredHeader`, `deferredIndex`),
  - `compiler/lowering/lower.ts:pendingEntry` (`case 'deferred'`),
  - `compiler/lowering/functions/index.ts:FunctionLowering.deferredIndex`.
- **Payoff:** **~50 sites across 22 files** (including 3 entire files: `checker/constructs/expressions/deferred-calls.ts`, `checker/resolution/calls/deferred-arguments.ts`, and `lowering/constructs/expressions/deferred-calls.ts`) disappear when `DeferredCall` desugars to `const` bindings + `Lambda`.

---

### Rank 4: Unify `ContextConstantDeclaration` (`ista const`) and `ExternConstantDeclaration` (`extern name: T` / `Snapshot.pinned`)
- **Spec §:** §3.4 ("Context constants"), §3.6 ("Extern declarations").
- **What overlaps / why it is redundant:**
  1. **Runtime/Snapshot duplication:** The runtime maintains **two** separate per-instance constant stores in `Snapshot`:
     - `Snapshot.pinned` (`runtime/snapshot/snapshot.ts:102`, `runtime/scheduler/instance/segment-effects.ts:41–56`, `runtime/scheduler/segment/native-calls.ts:101`) for `extern name: T`, which caches the raw host `Json` and re-runs `fromJson` decoding in `hostConstantEntry` on **every** read;
     - `contextConstant` heap objects (`runtime/scheduler/instance/context-constants.ts`, `definition/instructions/data.ts:contextConstant` & `makeContextConstant`) for `ista const`, which caches the evaluated `Value` on first read via an accessor entry.
     If `hostConstantEntry` (`compiler/lowering/synthesized/boundary/host-externs.ts:68`) uses the same memoized accessor mechanism as `ista const`, then `Snapshot.pinned`, `SegmentEffects.pinned`, `NativeCalls.call`'s `declared?.constant === true` branch, and `FunctionDefinition.extern.constant: z.boolean()` all disappear!
  2. **AST/Checker/IR footprint of `ista const`:** `ContextConstantDeclaration` is used only **once** in `src/stdlib/` (`runtime.ista`: `ista const _jobs = new _Jobs{}`), yet has its own AST node (`ContextConstantDeclaration`, separate from `VariableDeclaration`), its own checker unit (`ContextConstantChecks`), its own `BodyOwner` variant, and two dedicated bytecode instructions (`contextConstant`, `makeContextConstant`) that only ever appear in one 4-instruction synthesized accessor function (`FunctionLowering.lowerAccessor`).
- **Evidence (`file:function` list — 55 files, 118 sites combined; 30 files, 53 sites for `ContextConstantDeclaration`; 23 files, 38 sites for `ExternConstantDeclaration`/`pinned`):**
  - `compiler/syntax/declarations/index.ts` (`ContextConstantDeclaration`, `ExternConstantDeclaration`),
  - `compiler/checker/constructs/declarations/context-constants.ts` (`ContextConstantChecks`),
  - `compiler/lowering/functions/{index,frames,code-writer}.ts` (`accessorLowering`, `accessorFrame`, `lowerAccessor`),
  - `compiler/lowering/synthesized/boundary/host-externs.ts` (`hostConstantEntry`, `constantNativeEntry`),
  - `definition/tables/functions.ts` (`external.constant`),
  - `definition/instructions/data.ts` (`contextConstant`, `makeContextConstant`),
  - `runtime/scheduler/instance/context-constants.ts` (`ContextConstants`),
  - `runtime/scheduler/instance/segment-effects.ts` (`#pinned`, `pinned`, `committing`),
  - `runtime/scheduler/segment/native-calls.ts:NativeCalls.call`,
  - `runtime/snapshot/snapshot.ts:snapshotContents.pinned`.
- **Payoff:** Unifying `pinned` into `contextConstant` immediately removes **12 sites across 7 files** (and avoids re-decoding `fromJson` on every extern constant read); merging `ContextConstantDeclaration` into `VariableDeclaration` and replacing the `contextConstant`/`makeContextConstant` instructions with a runtime native or unified constant table removes **~40 sites across 25 files**.

---

### Rank 5: Replace the Checker's Parallel Constant Evaluator (`ConstantForm` / `Computation` / `fittedForm` / `formAt` / `formSemantics`) with Lowering
- **Spec §:** §3 ("Declarations"), §3.16 ("Annotations").
- **What overlaps / why it is redundant:**
  - `compiler/checker/rules/computation/index.ts` (`Computation`), `forms.ts` (`fittedForm`, `convertedForm`, `partsForm`, `structForm`), and `surface/constant-form.ts` (`ConstantForm`, `formAt`, `formStep`, `formSemantics`) implement a complete second interpreter, value representation (`ConstantForm`), type-directed value converter, destructuring reader, and map-key equality engine inside the checker, which `compiler/lowering/tables/constants.ts:constantValue` then translates into `definition/values/values.ts:Value`.
  - The checker itself only ever reads the string field of `@JsonName`, `@Waypoint`, and `@Suite`, and the map literal of `@Keeps` (on stdlib externs). All other constant evaluation is solely for lowering's constant pool!
- **Evidence (`file:function` list — 12 files, 53 sites):**
  - `compiler/checker/rules/computation/index.ts` (`computeConstant`, `Computation`, `#own`, `#fitted`, `#struct`, `#field`, `#default`, `#defaultValue`, `#tuple`, `#array`, `#map`),
  - `compiler/checker/rules/computation/forms.ts` (`fittedForm`, `convertedForm`, `partsForm`, `structForm`, `allFitted`, `fittedPart`, `itemsOf`, `pairOf`),
  - `compiler/checker/surface/constant-form.ts` (`ConstantForm`, `typesIn`, `durationForm`, `formAt`, `formStep`, `formSemantics`, `sameForm`, `sameHeads`, `partsOf`),
  - `compiler/checker/constructs/declarations/constants.ts` (`ConstantChecks`),
  - `compiler/checker/rules/annotations.ts` (`Annotations.#value`),
  - `compiler/lowering/tables/constants.ts` (`constantValue`, `annotationValues`).
- **Payoff:** **~45 sites across 8 files** (including `checker/rules/computation/forms.ts` and most of `surface/constant-form.ts` and `checker/rules/computation/index.ts`) disappear when the checker only validates constantness and lowering builds `Value`s directly.

---

### Rank 6: Move 58 Pure Stdlib `extern fn`s from TypeScript Natives (`src/stdlib/**/*.ts`) into `.ista` (`src/stdlib/**/*.ista`)
- **Spec §:** §3.8 ("Prelude and standard library"), §3.9, §3.11.
- **What overlaps / why it is redundant:**
  - 58 functions declared `extern fn` in `decimal.ista` (18), `prelude.ista` (30), `math.ista` (2), `strings.ista` (7), and `time.ista` (1) are currently implemented in TypeScript in `src/stdlib/**/*.ts` even though they need zero host/runtime capabilities and can be 1–5 lines of `.ista` code each (see Section 5 for the complete list).
- **Evidence (`file:function` list — 11 files, 58 native entries):**
  - `stdlib/decimal/natives.ts` (`mixedOverloads`, `operand`, `abs`, `remainder` — 18 natives),
  - `stdlib/numeric.ts` (`numeric`, `asFloat` — **entire file**),
  - `stdlib/prelude/natives.ts` (11 mixed `Int`/`Float` natives, `remainder`, `bitNot`),
  - `stdlib/prelude/text-forms.ts` (`Bool` `toString` and `parse`),
  - `stdlib/prelude/range-natives.ts` (`_steps`, `includes` — **entire file**),
  - `stdlib/prelude/arrays.ts` (`Array.default`, `_patternItem`, `_patternRest`, `at`, `indexOf`, `lastIndexOf`, `includes`, `flat`, `slice`),
  - `stdlib/prelude/maps.ts` (`Map.default`, `includes`, `keys`, `values`, `entries`),
  - `stdlib/math/natives.ts` (`abs(Int)`, `sqrt(Int)`),
  - `stdlib/strings/format.ts` (`formatted` — **entire file**),
  - `stdlib/strings/natives.ts` (`format`, `startsWith`, `endsWith`, `padStart`, `padEnd`, `replace`, `replaceAll`, `padding`, `replacedFirst`, `replacedAll`),
  - `stdlib/time/iso.ts` (`durationText`).
- **Payoff:** **58 native entries and 3 entire TypeScript files** (`src/stdlib/numeric.ts`, `src/stdlib/prelude/range-natives.ts`, `src/stdlib/strings/format.ts`) disappear.

---

### Rank 7: Unify `StructPattern` Field Items (`BindFieldPattern`, `NestedFieldPattern`, `CompareFieldPattern`) with `NamedPatternArgument` (`field: Pattern`) and Remove `RangePattern`
- **Spec §:** §3.11 ("Patterns").
- **What overlaps / why it is redundant:**
  - `StructPattern` uses 3 separate AST node kinds for its fields (`BindFieldPattern` `field as x`, `NestedFieldPattern` `field is P`, `CompareFieldPattern` `field == expr` / `field > expr`), whereas `VariantCallPattern` uses `NamedPatternArgument` (`field: P`) and `StructLiteral` uses `FieldInitializer` (`field: expr` or `field`).
  - `CompareFieldPattern` duplicates literal equality and operator resolution inside `compiler/checker/constructs/patterns/matching.ts:comparison` (42 lines) exclusively for struct fields, whereas `field is Literal` (or `field: Literal`) already matches literals/variants and `if field > 1000` (a `match` guard) already handles arbitrary comparisons!
  - `RangePattern` (`0..=59`) only works on integer literals, acts as a guard (`shape: undefined`, no exhaustiveness contribution), and duplicates `Range` bounds checking (`x in 0..=59`).
- **Evidence (`file:function` list — 18 files, 50 sites):**
  - `compiler/syntax/patterns.ts` (`BindFieldPattern`, `CompareFieldPattern`, `NestedFieldPattern`, `RangePattern`, `targetLeafHandlers`),
  - `compiler/parser/grammar/patterns.ts` (`parseFieldPattern`, `parseRangePattern`, `parseOpenRangePattern`),
  - `compiler/binder/constructs/patterns.ts` (`patternHandlers.BindFieldPattern`, `CompareFieldPattern`, `NestedFieldPattern`, `RangePattern`),
  - `compiler/checker/constructs/patterns/matching.ts` (`testsIn`, `comparison`),
  - `compiler/checker/constructs/patterns/walk/index.ts` (`patternHandlers.BindFieldPattern`, `NestedFieldPattern`, `CompareFieldPattern`, `RangePattern`),
  - `compiler/checker/constructs/patterns/walk/kinds/ranges.ts:rangeLeaf` (**entire file**),
  - `compiler/checker/lookup/denotations/index.ts`,
  - `editor/language-service/{completion/places/patterns/pattern,navigation/rename,semantic-tokens/name-types}.ts`,
  - `formatter/patterns.ts`.
- **Payoff:** **~40 sites across 16 files** (including `compiler/checker/constructs/patterns/walk/kinds/ranges.ts` and `matching.ts:comparison`) disappear.

---

### Rank 8: Unify Loop & Comprehension AST Nodes (`For` + `FieldLoop`, `Comprehension` + `FieldComprehension`)
- **Spec §:** §4 ("Expressions and control flow").
- **What overlaps / why it is redundant:**
  - `For` (`for x in xs:`) and `FieldLoop` (`for k, v in ...s:`) are two separate statement node kinds that differ only in their header (`Iterable` vs `FieldHeader`).
  - `Comprehension` (`[for x in xs if c: e]`) and `FieldComprehension` (`[for k, v in ...s: e]`) are two separate expression node kinds that also differ only in their header (and `FieldComprehension` has 0 uses in `src/stdlib/` and is trivially `{ let a = []; for k, v in ...s: a.push(e); a }`).
- **Evidence (`file:function` list — 15 files, 25 sites for `FieldComprehension` alone; 15 files, 25 sites for `FieldLoop`):**
  - `compiler/syntax/expressions/index.ts` (`Comprehension`, `FieldComprehension`), `compiler/syntax/statements/index.ts` (`For`, `FieldLoop`), `compiler/parser/grammar/expressions/literals/collections.ts`, `compiler/parser/grammar/statements/loops.ts`, `compiler/binder/constructs/{expressions,statements}.ts`, `compiler/checker/constructs/expressions/collections/comprehensions.ts` (`checkComprehension`, `checkFieldComprehension`), `compiler/checker/constructs/statements/loops.ts` (`checkFor`, `checkFieldLoop`), `compiler/checker/rules/flow/build/{expressions,literals,statements}.ts`, `compiler/checker/wiring/body/scope-protocol.ts`, `compiler/lowering/constructs/expressions/collections/comprehensions.ts` (`lowerComprehension`, `lowerFieldComprehension`), `compiler/lowering/constructs/statements/loops.ts` (`lowerFor`, `lowerFieldLoop`), `formatter/{expressions/index,statements}.ts`.
- **Payoff:** Removing or unifying `FieldComprehension` eliminates **25 sites across 15 files**; unifying `For` and `FieldLoop` headers eliminates another **~15 sites across 10 files**.

---

### Rank 9: Eliminate Redundant `Conversion` Variants `{ kind: 'shape' }` and `{ kind: 'async' }` (`AsyncFit`) in Favor of `{ kind: 'parts' }` (`fitsByParts` / `wrappingEntry`)
- **Spec §:** §3.1 ("Nominal to shape"), §3.5 ("Variance"), §3.14 ("Async function types").
- **What overlaps / why it is redundant:**
  - In `compiler/checker/types/fitting/fit/parts.ts:fitsByParts` (lines 56–64), `{ kind: 'parts' }` **already** checks `place.kind === 'anonymous'` (nominal struct -> shape) and `value.kind === 'function' && place.kind === 'function'` (plain function -> async function via `resultFitOf`).
  - In `compiler/lowering/functions/fits/parts.ts:rebuilt` (line 151) and `lowering/functions/fits/index.ts:partsConverted` / `wrappingEntry`, `{ kind: 'parts' }` **already** rebuilds a nominal struct into an `AnonymousStructType` (`rebuiltStruct`) and **already** wraps a plain function into an async entry (`wrappingEntry` + `returnedAs`). Even inside `lowering/functions/fits/index.ts:applyingIn` (line 195), `madeAsync` literally delegates to `tables.conversionIndex({ kind: 'wrapping', from: plain, to, at })`!
  - And in `compiler/checker/rules/computation/forms.ts:partsForm` (line 155), `partsForm` **already** handles `target.kind === 'anonymous'` (`structForm`) and returns `undefined` for functions!
  - Thus `{ kind: 'shape' }` and `{ kind: 'async' }` (`AsyncFit`) are 100% subsumed by `{ kind: 'parts' }`.
- **Evidence (`file:function` list — 9 files, 23 sites):**
  - `compiler/checker/types/fitting/fit/index.ts` (`Conversion` `'shape'` & `'async'`, `convertedInto`, `asyncFitOf`),
  - `compiler/checker/types/type/function-types.ts:madeAsync`,
  - `compiler/checker/wiring/body/facts/instantiation.ts` (`case 'shape'`, `case 'async'`),
  - `compiler/checker/rules/computation/forms.ts:convertedForm` (`case 'shape'`, `case 'async'`),
  - `compiler/lowering/functions/fits/index.ts` (`Applying.madeAsync`, `fittedValue`, `convertedValue` `case 'async'` & `case 'shape'`, `applyingIn`, `asyncFitClosure`, `asyncFitEntry`),
  - `compiler/lowering/values/struct-values.ts:rebuiltAs`,
  - `compiler/lowering/tables/instances.ts` (`AsyncFit`, `asyncFitKey`, `asyncFitName`),
  - `compiler/lowering/tables/tables.ts` (`PendingEntry` `'asyncFit'`, `asyncFitHeader`, `asyncFitIndex`),
  - `compiler/lowering/lower.ts:pendingEntry` (`case 'asyncFit'`).
- **Payoff:** **23 sites across 9 files** disappear with zero spec change!

---

### Rank 10: Eliminate `keep` Instruction, `LabelledBlock`, and `hold(label)` (Keep Function-Scoped `hold`)
- **Spec §:** §3.4 ("Lifetimes follow blocks too"), §7 ("Holders").
- **What overlaps / why it is redundant:**
  1. **IR level (`keep` vs `array`):** In `runtime/interpreter/instructions.ts:242`, `handlers.keep` appends registers to an array in `instruction.into` via `frame.heap.values.appended` — the exact same in-place array append `handlers.array` (`growsInPlace`) already performs for `[...into, reg]`.
  2. **Language level (`LabelledBlock` & `hold(label)`):** `LabelledBlock` (`batch:`) cannot be used with `break` or `continue` and exists solely as a target for `hold(batch)`. Neither `LabelledBlock` nor `hold(label)` is used anywhere in `src/stdlib/**/*.ista` (0 uses).
- **Evidence (`file:function` list — 25 files, 50 sites):**
  - `definition/instructions/lifetimes.ts:keep`, `definition/instructions/instruction.ts:operandTable.keep`, `definition/validation/instruction-rules.ts:rules.keep`, `runtime/interpreter/instructions.ts:handlers.keep`,
  - `compiler/syntax/statements/index.ts` (`Hold.label`, `LabelledBlock`, `LabelledScope`), `compiler/parser/grammar/statements/{loops,variables}.ts`, `compiler/binder/constructs/statements.ts:statementHandlers.LabelledBlock`, `compiler/checker/constructs/statements/loops.ts` (`checkLabelledBlock`, `checkHoldScope`, `LabelTargets`), `compiler/checker/lookup/denotations/index.ts` (`chosenIn.Hold`, `heldFunction`), `compiler/lowering/constructs/statements/{holds,loops}.ts`.
- **Payoff:** Removing `keep` eliminates 1 bytecode instruction across **5 files, 6 sites**; removing `LabelledBlock` and `hold(label)` eliminates **36 sites across 18 files**.

---

### Rank 11: Unify `await` and `select` in Lowering, Definition IR, and Runtime
- **Spec §:** §5 ("Persistence"), §8 ("select").
- **What overlaps / why it is redundant:**
  - `await expr` is a 1-case blocking `select` (`cases: [{ holds: [], bind: dst, target: nextLabel }]`, `otherwise: undefined`).
  - Both `lowerAwait` and `lowerSelect` already open their wait via `openWait(context, cases, span)` (`compiler/lowering/calls/waits.ts`).
  - Having a separate `await` bytecode instruction beside `select` forces `definition/` and `runtime/` to handle both instructions at every suspension/inspection/validation site.
- **Evidence (`file:function` list — 11 files, 18 sites):**
  - `definition/instructions/suspension.ts` (`awaitWait`), `definition/instructions/flow.ts:waitRegister`, `definition/instructions/instruction.ts:operandTable.await`, `definition/validation/instruction-rules.ts:rules.await`, `compiler/lowering/calls/waits.ts:awaitWait`, `compiler/lowering/constructs/expressions/control/await.ts:lowerAwait`, `compiler/lowering/functions/code-writer.ts:CodeWriter.await`, `runtime/interpreter/instructions.ts:handlers.await`, `runtime/interpreter/suspension.ts` (`waitAt`, `takeWait`, `resume`), `runtime/scheduler/inspect.ts:waitingAtOf`, `runtime/snapshot/check/waits.ts:waitProblems`.
- **Payoff:** **18 sites across 11 files** disappear when `await` lowers to a 1-case `select` instruction.

---

### Rank 12: Replace `worker.disposing()` (`OwnCall` / `currentCall` instruction) with a Prelude Extern
- **Spec §:** §7 ("Graceful disposal").
- **What overlaps / why it is redundant:**
  - Overloading the enclosing async function's own name before a dot (`worker.disposing()`) requires special binder lookahead (`useBeforeMember`), a synthetic `OwnCall` entity owner kind, `Bindings.ownCallOf`, hidden variable declarations in both checker (`declareOwnCall`) and lowering (`declareOwnCall`), and a dedicated `currentCall` bytecode instruction in the Definition IR and interpreter (and doesn't work in anonymous async lambdas).
  - A prelude extern `extern K fn currentCall<K in Persistence>() -> Call` (or `disposing()`) uses ordinary function call resolution with zero binder/checker/IR special cases.
- **Evidence (`file:function` list — 17 files, 23 sites):**
  - `compiler/binder/module/own-calls.ts`, `compiler/binder/module/local-binder.ts` (`useBeforeMember`, `#ownCallOf`), `compiler/binder/entities.ts` (`OwnCall`, `ownCalls`, `ownCallEntity`, `Bindings.ownCallOf`), `compiler/binder/link/index.ts`, `compiler/checker/constructs/closures/own-calls.ts` (`declareOwnCall`, `ownCallerOf`), `compiler/checker/constructs/expressions/control/select.ts:watchesOwnDisposal`, `compiler/checker/wiring/{body/body-checker,program/program-inputs}.ts`, `compiler/lowering/functions/frame-variables.ts:declareOwnCall`, `definition/instructions/calls.ts:currentCall`, `definition/instructions/instruction.ts:operandTable.currentCall`, `definition/validation/instruction-rules.ts:rules.currentCall`, `runtime/interpreter/instructions.ts:handlers.currentCall`.
- **Payoff:** **23 sites across 17 files** (including 2 entire files: `compiler/binder/module/own-calls.ts` and `compiler/checker/constructs/closures/own-calls.ts`, plus the `currentCall` bytecode instruction) disappear.

---

### Rank 13: Desugar or Remove `Unwrap` (`x!`), `ChainedComparison` (`a < b <= c`), and One-Element Tuple Conversion (`(T,)` <-> `T`)
- **Spec §:** §4 (`x!`), §3.9 (`a < b <= c`), §3.15 (`(T,)` <-> `T`).
- **What overlaps / why it is redundant:**
  1. **`Unwrap` (`x!`):** Every use emits a compiler warning (`forceUnwrap`), it has 0 uses in `src/stdlib/`, and `x ?? panic("Force-unwrapped none.")` already has identical semantics and typing.
  2. **`ChainedComparison` (`a < b <= c`):** `checkBinary` in `compiler/checker/constructs/expressions/operators/operators.ts:53` already delegates single comparisons to `checkComparisons(context, node, [link])`; unifying `ChainedComparison` with `Binary` (or desugaring in parser) removes a separate AST node kind across 12 files.
  3. **One-element tuple conversion (`tupled` / `untupled`):** Has 0 uses in `src/stdlib/` and requires special non-compositional `retuples` guards in `fit/index.ts`.
- **Evidence (`file:function` list — 25 files, 40 sites combined):**
  - `Unwrap` (11 files, 15 sites): `compiler/syntax/expressions/index.ts:Unwrap`, `compiler/parser/grammar/expressions/postfix.ts:unwrapParselet`, `compiler/binder/constructs/expressions.ts`, `compiler/checker/constructs/expressions/access/optionals.ts:checkUnwrap`, `compiler/checker/rules/flow/build/{control,expressions}.ts`, `compiler/checker/wiring/body/scope-protocol.ts`, `compiler/lowering/constructs/expressions/access/optionals.ts:lowerUnwrap`, `formatter/expressions/index.ts`.
  - `ChainedComparison` (12 files, 22 sites): `compiler/syntax/expressions/{index,comparisons}.ts`, `compiler/parser/grammar/expressions/operators.ts:comparisonsOf`, `compiler/binder/constructs/expressions.ts`, `compiler/checker/constructs/expressions/operators/operators.ts:checkChainedComparison`, `compiler/checker/rules/flow/build/{control,expressions}.ts`, `compiler/checker/wiring/body/scope-protocol.ts`, `compiler/lowering/constructs/expressions/operators.ts:lowerChainedComparison`, `formatter/expressions/index.ts`.
  - `tupled` / `untupled` (4 files, 10 sites): `compiler/checker/types/fitting/fit/index.ts` (`singleConversion`, `singleElement`, `retuples`), `compiler/checker/rules/computation/forms.ts:convertedForm`, `compiler/lowering/functions/fits/index.ts:convertedValue`.
- **Payoff:** **40 sites across 25 files** disappear.




