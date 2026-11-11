---
description: std modules, native keys/capabilities, sequence positions, ranges, text helpers and reusable .ista APIs — read before editing stdlib or natives
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-11
last_updated: 2026-11-11
tags: [reuse, stdlib, natives, ranges, positions, time, decimal]
---

# Std modules and natives

## Units

- register a std module or build its extern keys → `stdModule`, `nativeKeysOf`, `knownTypeKey`, `NativeKeys` (`src/stdlib/std-module.ts`)
- load std modules in the compiler, with sources laid over the shipped ones in tests → `stdlibLoader`, `stdRoles`, `preludeModule`, `StdSources`; a std module's shipped text by its `std:` id → `stdSourceOf`; the names an import may give a std module by → `importableStdModules` (`src/stdlib/stdlib-loader.ts`)
- list every std module's source by name, or name a std module → `stdModuleSources`, `StdModuleName` (`src/stdlib/std-sources.ts`)
- get the combined std natives table or the list of std module records → `stdNatives` (`src/stdlib/natives.ts`), `stdModules` (`src/stdlib/std-modules.ts`)
- type a native function/table by the capabilities it uses, or throw a language panic → `Native`, `Natives`, `NativeContext`, `Panic` (`src/runtime/natives.ts`)
- request futures, slots, weak refs or resources in a native's context → `WithFutures`, `WithSlots`, `WithWeakSide`, `WithResources` (`src/runtime/natives.ts`)
- register a language resolver on a future, resolve one, make a `Resolver.of` or `Resolver.at` one or give one an `onCancel` callback, in a native's context → `WithWaits`, `NativeWaits` (`src/runtime/natives.ts`)
- request random, logs, instances or testing in a native's context → `WithRandom`, `WithLogs`, `WithInstances`, `WithTesting` (`src/runtime/natives.ts`)
- generate the four `Int`/`Float` overloads of a binary native or throw division by zero → `numeric`, `asFloat`, `divisionByZero` (`src/stdlib/numeric.ts`)
- map `math.Rounding` variants to float rounding functions → `roundingType`, `floatRoundings` (`src/stdlib/math/rounding.ts`)
- map `math.Rounding` variants to decimal.js rounding modes → `decimalRoundings` (`src/stdlib/decimal/arithmetic.ts`)
- validate or compute sequence indices, `at(i)`, or `slice(start, end)` → `checkedIndex`, `atPosition`, `sliceBounds`, `sliced` (`src/stdlib/positions.ts`)
- select or replace sequence items by a prelude `Range` → `selectionOf`, `selected`, `replaced` (`src/stdlib/positions.ts`)
- read a prelude `Range`, require both ends, count steps, or test membership → `rangeOf`, `bounded`, `countOf`, `reaches`, `textOf` (`src/stdlib/ranges.ts`)
- format or parse primitive values (`Int`, `Float`, `Bool`) as text → `primitiveText`, `readPrimitive` (`src/stdlib/prelude/text-forms.ts`)
- format or parse ISO 8601 `Time` and `Duration` texts → `timeText`, `readTime`, `durationText`, `readDuration` (`src/stdlib/time/iso.ts`)
- draw a uniform random `bigint` below a bound from a 32-byte draw source → `uniformBelow` (`src/stdlib/random/natives.ts`)
- implement `Encodable`/`Decodable` in `.ista` for a `Stringable`/`Parsable` type → `json.encodeText`, `json.decodeText` (`src/stdlib/json/json.ista`)
- wrap a disposable host resource as a `Revertible<T>` in `.ista` → `Revertible.holding` (`src/stdlib/inbox/inbox.ista`)
- declare `.ista` test suites, cases, groups or setups → `@Suite`, `test`, `group`, `skip`, `only`, `setups` (`src/stdlib/testing/testing.ista`)
- assert conditions, equality or panics in `.ista` tests → `assert`, `assertEq`, `expectPanic` (`src/stdlib/testing/testing.ista`)
- mock functions or inspect spawned instances in `.ista` tests → `mock`, `calls`, `handle`, `spawnCrashingEveryAwait` (`src/stdlib/testing/testing.ista`)
- use deterministic fake clocks or fake queues in `.ista` tests → `withClock`, `FakeClock`, `FakeQueue` (`src/stdlib/testing/testing.ista`)

## One-way rules

- Every std module is listed once in `src/stdlib/std-sources.ts`; `stdlibLoader` reads it without natives (a cruiser rule), and `stdModules`, then `stdNatives`, attach the natives by name.
- Methods taking a function value (`map`, `filter`, `sort`, `futures.retry`) are written in `.ista`, never in TS natives (`docs/arch/architecture.md`).
- Extern types needing canonical equality (`decimal.Decimal`, `time.Zone`) keep their canonical string as the extern payload (`docs/arch/architecture.md`).
- External input failures (`parse`, `crypto.decode`, `json.parse`) return `Result`; broken preconditions throw `Panic`; broken invariants call `unreachable`.

## Recipes

### Add a std module

1. Create `src/stdlib/<name>/<name>.ista` (and `natives.ts` if it declares `extern`s, building keys with `keys.of`, `keys.ofStatic`, `keys.type`).
2. List its source in `src/stdlib/std-sources.ts`, and its natives, if any, in `src/stdlib/std-modules.ts` (and `src/foundation/language/well-known/index.ts` + `stdRoles` only if used by language role).
3. Add language tests in `src/stdlib/<name>/<name>.test.ista`.

### Add a native capability

1. Define `NativeXxx` and `WithXxx` in `src/runtime/natives.ts` and add `WithXxx` to `NativeCapabilities`.
2. Build and wire the capability for each segment in `capabilitiesOf` (`src/runtime/scheduler/segment/native-calls.ts`).
3. Type the natives that use it as `Native<NativeContext & WithXxx>` / `Natives<NativeContext & WithXxx>`.
