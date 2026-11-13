---
description: building, narrowing and reading language values, structs, variants, closures, maps and JSON from TypeScript — read before working with Value
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-13
last_updated: 2026-11-13
tags: [reuse, values, equality, maps, json, natives, runtime]
---

# Values, equality and JSON

## Units

- narrow a `Value` to composite, array, map or closure → `isComposite`, `elementsOf`, `mapValueOf`, `handleTarget`, `closureOf` (`src/definition/values/values.ts`)
- make a handle to a heap object → `handleTo` (`src/definition/values/values.ts`)
- read or replace a composite's children or depth, or get the maximum persisted value depth → `childValues`, `withChildValues`, `handlesIn`, `depthOf`, `maximumDepth`, `samePayload` (`src/definition/values/values.ts`)
- rebuild a value with some of its parts replaced, at any depth, on a stack of its own → `replacingParts` (`src/definition/values/replacing.ts`)
- read or build a struct or variant `Value` by declared name → `fieldValueOf`, `structOf`, `variantOf` (`src/definition/values/declared-values.ts`)
- build an optional (a union holding `None`, laid out as `unionLayout` says), a `Result` (`Ok`, `Err`) or `Error` `Value` → `optionalOf`, `okOf`, `errOf`, `errorOf`, `okTypeOf` (`src/definition/values/declared-values.ts`)
- look up a field's `TypeReference`, a type argument, or a named `TypeId` → `fieldTypeOf`, `typeArgumentOf`, `namedType`, `namedTypeOf` (`src/definition/values/declared-values.ts`)
- read primitive, optional `Int`, enum (by its variant's name, from a table) or extern native arguments, or build an array result → `given`, `int`, `float`, `text`, `optionalInt`, `variantEntry`, `externPayloadOf`, `textPayloadOf`, `arrayOf` (`src/stdlib/values/arguments.ts`)
- read an optional by its declared variant → `optionalValueOf` (`src/definition/values/declared-values.ts`); an optional `Int` native argument → `optionalInt`, or map an enum argument by variant name → `variantEntry` (`src/stdlib/values/arguments.ts`)
- build array, struct, variant or extern results → `arrayOf` (`src/stdlib/values/arguments.ts`), `resultStruct`, `resultVariant`, `resultExtern`, `resultOptional` (`src/stdlib/values/results.ts`)
- the type entry a native's declared result names → `declaredResult` (`src/stdlib/values/results.ts`)
- make or read an `Instance<T>` handle (the instance's name) → `instanceHandle`, `instanceNameOf` (`src/definition/values/instance-handles.ts`)
- read a result's type argument or build `Ok` native results → `resultTypeArgument`, `resultOk`, `okStruct`, `okExtern` (`src/stdlib/values/results.ts`)
- build `Err` or `parse` native return values → `resultErr`, `resultError`, `parseFailure`, `parseResult` (`src/stdlib/values/results.ts`)
- read or build `time.Time` and `time.Duration` millisecond values → `millisecondsOf`, `resultMilliseconds`, `okMilliseconds` (`src/stdlib/time/fields.ts`)
- read a nested part of a `Value` along field positions → `partAt` (`src/runtime/interpreter/parts.ts`); write one, or change an array or map a native takes by `&`, in place where nothing else holds it → the instance's `InPlace` (`src/runtime/lifetimes/in-place.ts`): `withPart`, `appended`, `withEntries`, `changesAt` (the `ValueChanges` a native's `context.changes` gives), and `made` for a value an instruction builds; copy a value for a holder no count sees → `copied` (`src/definition/values/replacing.ts`)
- read a nested part of a compile-time `ConstantForm` along a target's steps (a struct pattern's rest built by name), or build a duration form → `formAt`, `durationForm`; the value a literal writes, `Unit`'s and `none`'s → `literalForm`, `unitForm` (`src/compiler/checker/surface/constant-form.ts`)
- compare runtime `Value`s with `==` or build a `MapValue` → `valuesEqual`, `mapOf` (`src/definition/values/equality.ts`)
- look up an entry in a runtime `MapValue`, or build one → `entryPosition`, `entryValue`, `mapOf`; set or delete an entry of a map nothing else holds, keeping its table → `setEntryInPlace`, `deleteEntryInPlace`; copy a map with its table → `copiedMap`; forget what was derived from a value changed in place → `forgetDerived` (`src/definition/values/equality.ts`), `forgetSummary` (`src/definition/values/values.ts`)
- compare compile-time `ConstantForm`s with `==` or build constant maps → `formSemantics` (`src/compiler/checker/surface/constant-form.ts`)
- tell whether a constant computed again has the form lowering emits alike (map order and lambdas by identity) → `sameForm` (`src/compiler/checker/surface/constant-form.ts`)
- define `==` and structural map hashing over a value representation → `ValueSemantics` (`src/foundation/language/values.ts`)
- order two `bigint`s or UTF-16 `string`s → `compareOrdered` (`src/foundation/language/order.ts`)
- find the `json.Json` type entry, the variant each of its union's members is (found by what the variant holds), or test if a `Value` is `Json` → `jsonTypeIn`, `jsonTypeOf`, `isJsonValue` (`src/definition/values/json-values.ts`)
- convert between `json.Json` values, JSON text, and host JS values → `jsonText`, `jsonOfText`, `plainOfJson`, `jsonOfPlain` (`src/definition/values/json-values.ts`)

## One-way rules

- Build and read structs, variants, `Optional`, `Result` and `Error` by declared name (`declared-values.ts`, `values/arguments.ts`, `values/results.ts`), never by positional index.
- Narrow closures with `closureOf` and handles with `handleTarget`, and make handles with `handleTo` (`src/definition/values/values.ts`), never with ad-hoc `isComposite(v) && v.kind === ...` checks or `{ kind: 'handle', … }` literals.
- Values are immutable to everything but `InPlace` (`src/runtime/lifetimes/in-place.ts`) and `mapOf`'s own build: never mutate `fields`, `elements`, `entries` or `captures` elsewhere; write through the instance's `InPlace`, or rebuild with `withChildValues`.
- A composite is shared by identity: a copy, a part a rebuild kept, a constant every instance reads, and a value in a snapshot restored twice in memory can be one object. Data keyed by a composite's identity (a `WeakMap`, as `values.ts`'s summaries) describes the value wherever it is; what describes one place or one instance's use of it is kept per instance, never on the value.
- Handles compare and hash by the object id they name (`equality.ts`): `==` on handles is identity, never their objects' contents.
- Built-in `==` and map hashing live in `ValueSemantics` (`src/foundation/language/values.ts`), shared by `definition/values/equality.ts` and `checker/surface/constant-form.ts`. A head compares no instantiated type id: a value converted part by part keeps its own where its layout stays (§3.5).
