---
description: building, narrowing and reading language values, structs, variants, closures, maps and JSON from TypeScript — read before working with Value
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-28
last_updated: 2026-10-28
tags: [reuse, values, equality, maps, json, natives, runtime]
---

# Values, equality and JSON

## Units

- narrow a `Value` to composite, array, map or closure → `isComposite`, `elementsOf`, `mapValueOf`, `handleTarget`, `closureOf` (`src/definition/values.ts`)
- make a handle to a heap object → `handleTo` (`src/definition/values.ts`)
- read or replace a composite's children or depth → `childValues`, `withChildValues`, `handlesIn`, `depthOf`, `samePayload` (`src/definition/values.ts`)
- read or build a struct or variant `Value` by declared name → `fieldValueOf`, `structOf`, `variantOf`, `variantShape` (`src/definition/declared-values.ts`)
- build an `Optional`, `Result` (`Ok`, `Err`) or `Error` `Value` → `optionalOf`, `okOf`, `errOf`, `errorOf`, `okTypeOf` (`src/definition/declared-values.ts`)
- look up a field's `TypeReference`, a type argument, or a named `TypeId` → `fieldTypeOf`, `typeArgumentOf`, `namedType`, `namedTypeOf` (`src/definition/declared-values.ts`)
- read primitive, tuple or extern native arguments → `given`, `int`, `float`, `text`, `elementOf`, `textPayloadOf` (`src/stdlib/native-values.ts`)
- read an optional native argument or map an enum argument by variant name → `optionalValue`, `variantEntry` (`src/stdlib/native-values.ts`)
- build array, struct, variant or extern results → `arrayOf`, `resultStruct`, `resultVariant`, `resultExtern`, `resultOptional` (`src/stdlib/native-values.ts`)
- the type entry a native's declared result names → `declaredResult` (`src/stdlib/native-values.ts`)
- make or read an `Instance<T>` handle (the instance's name) → `instanceHandle`, `instanceNameOf` (`src/definition/instance-handles.ts`)
- read a result's type argument or build `Ok` native results → `resultTypeArgument`, `resultOk`, `okStruct`, `okExtern` (`src/stdlib/native-values.ts`)
- build `Err` or `parse` native return values → `resultErr`, `resultError`, `parseFailure`, `parseResult` (`src/stdlib/native-values.ts`)
- read or build `time.Time` and `time.Duration` millisecond values → `millisecondsOf`, `resultMilliseconds`, `okMilliseconds` (`src/stdlib/time/fields.ts`)
- read or write a nested part of an immutable `Value` along field positions → `partAt`, `withPart` (`src/runtime/values/parts.ts`)
- read a nested part of a compile-time `ConstantForm` or build a duration form → `formAt`, `durationForm` (`src/compiler/checker/constant-form.ts`)
- compare runtime `Value`s with `==` or build a `MapValue` → `valuesEqual`, `mapOf` (`src/definition/equality.ts`)
- look up, insert or remove an entry in a runtime `MapValue` → `entryPosition`, `entryValue`, `withEntry`, `withoutEntry` (`src/definition/equality.ts`)
- compare compile-time `ConstantForm`s with `==` or build constant maps → `formSemantics` (`src/compiler/checker/constant-form.ts`)
- define `==` and structural map hashing over a value representation → `ValueSemantics` (`src/language/values.ts`)
- order two `bigint`s or UTF-16 `string`s → `compareOrdered` (`src/language/order.ts`)
- find the `json.Json` type entry or test if a `Value` is `Json` → `jsonTypeIn`, `jsonTypeOf`, `isJsonValue` (`src/definition/json-values.ts`)
- convert between `json.Json` values, JSON text, and host JS values → `jsonText`, `jsonOfText`, `plainOfJson`, `jsonOfPlain` (`src/definition/json-values.ts`)

## One-way rules

- Build and read structs, variants, `Optional`, `Result` and `Error` by declared name (`declared-values.ts`, `native-values.ts`), never by positional index.
- Narrow closures with `closureOf` and handles with `handleTarget`, and make handles with `handleTo` (`src/definition/values.ts`), never with ad-hoc `isComposite(v) && v.kind === ...` checks or `{ kind: 'handle', … }` literals.
- Values are immutable: never mutate `fields`, `elements`, `entries` or `captures`; rebuild with `withPart`, `withChildValues`, or `withEntry`/`withoutEntry`.
- Built-in `==` and map hashing live in `ValueSemantics` (`src/language/values.ts`), shared by `definition/equality.ts` and `checker/constant-form.ts`.
