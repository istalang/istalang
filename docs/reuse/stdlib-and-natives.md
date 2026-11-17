---
description: std modules, native keys/capabilities, sequence positions, ranges, text helpers and reusable .ista APIs — read before editing stdlib or natives
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-13
last_updated: 2026-11-17
tags: [reuse, stdlib, natives, ranges, positions, time, decimal]
---

# Std modules and natives

## Units

- register a std module or build its extern keys → `stdModule`, `nativeKeysOf`, `knownTypeKey`, `NativeKeys` (`src/stdlib/std-module.ts`)
- load std modules in the compiler, with sources laid over the shipped ones in tests → `stdlibLoader`, `stdRoles`, `StdSources`; a std module's shipped text by its `std:` id → `stdSourceOf`; the names an import may give a std module by → `importableStdModules` (`src/stdlib/stdlib-loader.ts`)
- list every std module's source by name, or name a std module → `stdModuleSources`, `StdModuleName` (`src/stdlib/std-sources.ts`)
- get the combined std natives table or the list of std module records → `stdNatives` (`src/stdlib/natives.ts`), `stdModules` (`src/stdlib/std-modules.ts`)
- type a native function/table by the capabilities it uses, or throw a language panic → `Native`, `Natives`, `NativeContext`, `Panic` (`src/runtime/natives.ts`)
- request futures, weak refs, resources, instances, the random source, the log, contexts, testing or the JSON written in a native's context → `WithFutures`, `WithWeakSide`, `WithResources`, `WithInstances`, `WithRandom`, `WithLogs`, `WithContexts`, `WithTesting`, `WithEncodings` (`src/runtime/natives.ts`)
- register a resolver on a future, resolve one, make a `Resolver.of` or `Resolver.at` one, give one an `onCancel` callback, or use a slot → write it in Istalang over the prelude's futures, resolvers and `Slot<T>` (`src/stdlib/prelude/prelude.ista`), whose natives are the run's own (`src/runtime/run/run-natives.ts`); no native capability waits
- request random, logs, instances or testing in a native's context → `WithRandom`, `WithLogs`, `WithInstances`, `WithTesting` (`src/runtime/natives.ts`)
- reach a live run's contexts (open a runtime, call into a context, serve its jobs) in a native's context → `WithContexts`, `NativeContexts` (`src/runtime/natives.ts`)
- read or keep the JSON the instance wrote a value as, by type, in a native's context → `WithEncodings`, `NativeEncodings` (`src/runtime/natives.ts`)
- hold Istalang numbers or roundings to decimal.js in a test, by `math.Rounding` mode → `decimalJsRoundings`, `roundings`, `Rounding` (`src/stdlib/math/rounding-oracle.test-kit.ts`)
- validate or compute sequence indices, `at(i)`, or `slice(start, end)` → `checkedIndex`, `atPosition`, `sliceBounds`, `sliced` (`src/stdlib/positions.ts`)
- select or replace sequence items by a prelude `Range` → `selectionOf`, `selected`, `splicesOf` (`src/stdlib/positions.ts`)
- read a prelude `Range`, require both ends, count steps, or test membership → `rangeOf`, `bounded`, `countOf`, `reaches`, `textOf` (`src/stdlib/ranges.ts`)
- format or parse ISO 8601 `Time` and `Duration` texts → `String(t)`, `Time.parse`, `Duration.parse` (`src/stdlib/time/time.ista`); an independent oracle of them in a test → `timeText`, `readTime`, `durationText`, `readDuration` (`src/stdlib/time/iso-oracle.test-kit.ts`)
- search and cut a string by UTF-16 offset, so a loop reads on from the last step instead of counting code points from the start → `_find`, `_between` (`src/stdlib/strings/strings.ista`, the module's own)
- implement `Encodable`/`Decodable` in `.ista` for a `Stringable`/`Parsable` type → `json.encodeText`, `json.decodeText` (`src/stdlib/json/json.ista`)
- write a part of a value as JSON inside a codec → `json.encode(part)`, never `part.toJson()`, so a host gets the same object for a part kept (`src/stdlib/json/json.ista`)
- wrap a disposable host resource as a `Revertible<T>` in `.ista` → `Revertible.holding` (`src/stdlib/inbox/inbox.ista`)
- declare `.ista` test suites, cases, groups or setups → `@Suite`, `test`, `group`, `skip`, `only`, `setups` (`src/stdlib/testing/testing.ista`)
- assert conditions, equality or panics in `.ista` tests → `assert`, `assertEq`, `expectPanic` (`src/stdlib/testing/testing.ista`)
- mock functions or inspect spawned instances in `.ista` tests → `mock`, `calls`, `handle`, `spawnCrashingEveryAwait` (`src/stdlib/testing/testing.ista`)
- use deterministic fake clocks or fake queues in `.ista` tests → `withClock`, `FakeClock`, `FakeQueue` (`src/stdlib/testing/testing.ista`)

## One-way rules

- Every std module is listed once in `src/stdlib/std-sources.ts`; `stdlibLoader` reads it without natives (a cruiser rule), and `stdModules`, then `stdNatives`, attach the natives by name.
- A std function that can be written over existing functions and the language's operators is `.ista` (AGENTS.md, Reduce): methods taking a function value (`map`, `filter`, `sort`, `futures.retry`, `docs/arch/architecture.md`), defaults, and helpers over other externs. A native is a primitive every backend implements (`docs/work/ir-first/design.md`): an operation on two operands of one type, a collection's length, item, key lookup and change, a string's code points, search and cut, what host libraries define (Unicode case and graphemes, regex, crypto, time zones), and the runtime's seams. Rules over positions and ranges keep their one home in `positions.ts` and `ranges.ts`, so the natives reading by them (`at`, `slice`, indexing by a range, `random.integer`) stay native. A loop in std code reads a string by offset (`_find`, `_between`), never by code point position, so it stays linear (`src/stdlib/strings/linearity.sweep.test.ts`).
- A std native's key restates its `.ista` extern's signature (`docs/audit/dry-review-2026-11-13.md`, finding 10): change both in one commit.
- Extern types needing canonical equality keep their one form as the extern payload: `time.Zone` its canonical string, `decimal.Decimal` its units and scale, which only its module's code builds (`docs/arch/architecture.md`).
- External input failures (`parse`, `crypto.decode`, `json.parse`) return `Result`; broken preconditions throw `Panic`; broken invariants call `unreachable`.
- A native keeps no language value past its call outside the instance: it returns it, changes a value it takes by `&` through `NativeContext.changes`, or stores it through a capability (`NativeFutures`, `NativeWeakSide`, `NativeResources`, `NativeTesting`, `NativeEncodings`), never in a closure or module state. Lifetimes read holders from registers and heap objects alone (`src/runtime/run/lifetimes.ts`).

## Recipes

### Add a std module

1. Create `src/stdlib/<name>/<name>.ista` (and `natives.ts` if it declares `extern`s, building keys with `keys.of`, `keys.ofStatic`, `keys.type`).
2. List its source in `src/stdlib/std-sources.ts`, and its natives, if any, in `src/stdlib/std-modules.ts` (and `src/foundation/language/well-known/index.ts` + `stdRoles` only if used by language role).
3. Add language tests in `src/stdlib/<name>/<name>.test.ista`.

### Add a native capability

1. Define `NativeXxx` and `WithXxx` in `src/runtime/natives.ts` and add `WithXxx` to `NativeCapabilities`.
2. Build and wire the capability for a run in `contextOf` (`src/runtime/run/natives.ts`).
3. Type the natives that use it as `Native<NativeContext & WithXxx>` / `Natives<NativeContext & WithXxx>`.
