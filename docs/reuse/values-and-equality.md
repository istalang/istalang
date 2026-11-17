---
description: building, narrowing and reading language values, structs, variants, closures, maps and JSON from TypeScript — read before working with Value
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-13
last_updated: 2026-11-17
tags: [reuse, values, equality, maps, json, natives, runtime]
---

# Values, equality and JSON

## Units

- narrow a `Value` to composite, array, map or closure → `isComposite`, `elementsOf`, `mapValueOf`, `handleTarget`, `closureOf` (`src/definition/values/values.ts`)
- make a handle to a heap object, or a value of an extern type holding its payload → `handleTo`, `externValue` (`src/definition/values/values.ts`)
- read or replace a composite's children or depth, or get the maximum persisted value depth → `childValues`, `withChildValues`, `depthOf`, `maximumDepth`, `samePayload` (`src/definition/values/values.ts`)
- rebuild a value with some of its parts replaced, at any depth, on a stack of its own → `replacingParts` (`src/definition/values/replacing.ts`)
- read or build a struct `Value` by declared name → `fieldValueOf`, `structOf` (`src/definition/values/declared-values.ts`)
- look up a type argument or a named `TypeId` → `typeArgumentOf`, `namedType` (`src/definition/values/declared-values.ts`)
- read primitive, optional `Int`, enum (by its variant's name, from a table) or extern native arguments, or build an array result → `given`, `int`, `float`, `text`, `optionalInt`, `variantEntry`, `externPayloadOf`, `textPayloadOf`, `arrayOf` (`src/stdlib/values/arguments.ts`)
- read an optional by its declared variant → `optionalValueOf` (`src/definition/values/declared-values.ts`); an optional `Int` native argument → `optionalInt`, or map an enum argument by variant name → `variantEntry` (`src/stdlib/values/arguments.ts`)
- build array, struct or extern results, or the struct or extern items of an array result → `arrayOf` (`src/stdlib/values/arguments.ts`), `resultStruct`, `resultExtern`, `itemStruct`, `itemExtern` (`src/stdlib/values/results.ts`); optionals, `Result`s and enums are built by the extern's Istalang wrapper, never by a native
- the type entry a native's declared result names → `declaredResult` (`src/stdlib/values/results.ts`)
- make or read an `Instance<T>` handle (the instance's name) → `instanceHandle`, `instanceNameOf` (`src/definition/values/instance-handles.ts`)
- read a result's type argument → `resultTypeArgument` (`src/stdlib/values/results.ts`)
- read or build `time.Time` and `time.Duration` millisecond values → `millisecondsOf`, `resultMilliseconds` (`src/stdlib/time/fields.ts`)
- write a part of a value in place where nothing else holds it, every value from its root down → `Lifetimes.withPart`, `Lifetimes.opened` (`src/runtime/run/lifetimes.ts`); change an array or map a native takes by `&` → the `ValueChanges` its `context.changes` gives (`src/runtime/run/natives.ts`), which keeps what it stores by type (`Lifetimes.keepItems`); copy a value for a holder no count sees → `copied` (`src/definition/values/replacing.ts`)
- read a nested part of a compile-time `ConstantForm` along a target's steps (a struct pattern's rest built by name), or build a duration form → `formAt`, `durationForm`; the value a literal writes, `Unit`'s and `none`'s → `literalForm`, `unitForm` (`src/compiler/checker/surface/constant-form.ts`)
- compare runtime `Value`s with `==` or build a `MapValue` → the run's `values` (`Run.values`, a native's `context.values`), the one `valueSemanticsOf(functions)` per program (`src/definition/values/equality.ts`): `equal`, `mapOf`; a map of keys known distinct (a JSON object's, a regex's group names) is built as its entries
- look up an entry in a runtime `MapValue`, or build one → `entryPosition`, `entryValue`, `mapOf`; set or delete an entry of a map nothing else holds, keeping its table → `setEntryInPlace`, `deleteEntryInPlace`; copy a map with its table → `copiedMap`; forget what was derived from a value changed in place → `forget`, all of the program's `RuntimeValues` (`src/definition/values/equality.ts`), and `forgetDepth` (`src/definition/values/values.ts`)
- compare compile-time `ConstantForm`s with `==` or build constant maps → `formSemantics` (`src/compiler/checker/surface/constant-form.ts`)
- tell whether a constant computed again has the form lowering emits alike (map order and lambdas by identity) → `sameForm` (`src/compiler/checker/surface/constant-form.ts`)
- define `==` and structural map hashing over a value representation → `ValueSemantics` (`src/foundation/language/values.ts`)
- order two `bigint`s or UTF-16 `string`s → `compareOrdered` (`src/foundation/language/order.ts`)
- find the `json.Json` type entry, the variant each of its union's members is (found by what the variant holds), or test if a `Value` is `Json` → `jsonTypeIn`, `jsonTypeOf`, `isJsonValue` (`src/definition/values/json-values.ts`)
- convert between `json.Json` values, JSON text, and host JS values → `jsonText`, `jsonOfText`, `plainOfJson` (deeply frozen, the same object for an array or map it met before; `forgetPlainOf` as one changes in place), `jsonOfPlain` (`src/definition/values/json-values.ts`)
- give the `Json` an instance wrote a value as before, per type, held for good and forgotten as the value changes in place → `WrittenJson` (`src/definition/values/written-json.ts`), a run's as `Lifetimes.written`, reached by natives as `NativeEncodings` (`src/runtime/natives.ts`)

## One-way rules

- Build and read structs, variants, `Optional`, `Result` and `Error` by declared name (`declared-values.ts`, `values/arguments.ts`, `values/results.ts`), never by positional index.
- Narrow closures with `closureOf` and handles with `handleTarget`, and make handles with `handleTo` and extern values with `externValue` (`src/definition/values/values.ts`), never with ad-hoc `isComposite(v) && v.kind === ...` checks or `{ kind: 'handle' | 'extern', … }` literals.
- Values are immutable to everything but `Lifetimes.owned` (`src/runtime/run/lifetimes.ts`) and `mapOf`'s own build: never mutate `fields`, `elements`, `entries` or `captures` elsewhere; write what `owned` gives, or rebuild with `withChildValues`.
- Data keyed by a node's identity (summaries, hashes, maps' tables, the JSON written of it, the host's object of it) is forgotten by `Lifetimes.owned` as it gives a node to change in place: a new cache keyed by a composite joins it there, and a cache keeping values holds them for good (`WrittenJson`, which shares them).
- A composite is shared by identity: a copy, a part a rebuild kept, a constant every instance reads, and a value in a snapshot restored twice in memory can be one object. Data keyed by a composite's identity (a `WeakMap`, as `values.ts`'s summaries) describes the value wherever it is; what describes one place or one instance's use of it is kept per instance, never on the value.
- Handles compare and hash by the object id they name (`equality.ts`): `==` on handles is identity, never their objects' contents. A closure compares by the body its entry runs (`bodyOf`, `src/definition/tables/functions.ts`, §3.14), so equality is per program: one `RuntimeValues` per function table, which every map of a run is hashed by.
- Built-in `==` and map hashing live in `ValueSemantics` (`src/foundation/language/values.ts`), shared by `definition/values/equality.ts` and `checker/surface/constant-form.ts`. A head compares no instantiated type id: a value converted part by part keeps its own where its layout stays (§3.5).
