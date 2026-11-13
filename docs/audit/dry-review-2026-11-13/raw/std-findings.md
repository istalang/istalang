# Findings: `std` (`src/stdlib`, `src/cli`, `src/runtime/natives.ts`, `src/runtime/scheduler/segment/native-calls.ts`)

### [high] 31 mixed numeric (`Int`/`Float` and `Decimal`/`Int`) and arithmetic overloads across `prelude`, `math`, and `decimal` are implemented as TS natives (`numeric.ts`, `decimal/natives.ts`, `math/natives.ts`, `prelude/natives.ts`) instead of 1-line `.ista` functions over `Float(x)` and `Decimal(x)`
- where: `src/stdlib/numeric.ts:14-45`, `src/stdlib/prelude/prelude.ista:344-368, 374, 379-382`, `src/stdlib/prelude/natives.ts:61-108`, `src/stdlib/math/math.ista:18, 26`, `src/stdlib/math/natives.ts:13-22`, `src/stdlib/decimal/decimal.ista:33-34, 36-37, 39-40, 47-48, 55-66, 70-71, 73-74, 77-78`, `src/stdlib/decimal/natives.ts:47, 61-82, 91-114`
- evidence:
  1. `prelude.ista:390` already declares `extern fn Float.from(value: Int) -> Float` (`Number(int(value))`), yet `src/stdlib/numeric.ts:14-45` (`numeric`, `asFloat`) generates 4 TS native entries (`(Int, Int)`, `(Float, Float)`, `(Int, Float)`, `(Float, Int)`) for `add`, `subtract`, `multiply`, `divide`, `power`, and `compare`. In all 10 mixed `(Int, Float)` / `(Float, Int)` overloads plus `divide(Int, Int)` (`prelude/natives.ts:78-81`), the TS native does nothing more than convert the `Int` operand via `asFloat` (`typeof value === 'bigint' ? Number(value) : float(value)`) and call the `(Float, Float)` operation.
  2. In `src/stdlib/math/natives.ts:13-16, 20`:
     - `abs(self: Int) -> Int` is `const value = int(x); return value < 0n ? -value : value;`, which in `math.ista` is `fn abs(self: Int) -> Int: if self < 0: -self else: self`.
     - `sqrt(self: Int) -> Float` is `Math.sqrt(asFloat(x))`, which in `math.ista` is `fn sqrt(self: Int) -> Float: Float(self).sqrt()`.
  3. In `src/stdlib/prelude/natives.ts:88-93`, `remainder(left: Int, right: Int) -> Int` is implemented in TypeScript as:
     ```ts
     [keys.of('remainder', 'Int', 'Int')]: ([left, right]) => {
       const dividend = int(left);
       const by = nonZero(int(right));
       return dividend - floorDivide(dividend, by) * by;
     },
     ```
     In `prelude.ista`, `fn remainder(left: Int, right: Int) -> Int: left - (left // right) * right` computes the exact same result and panics with the identical `Division by zero.` message when `right == 0`. Similarly, `bitNot(value: Int) -> Int` (`prelude/natives.ts:107`, `~int(value)`) is `fn bitNot(value: Int) -> Int: -value - 1` as documented in `prelude.ista:370`.
  4. `decimal.ista:15` already declares `extern fn Decimal.from(value: Int) -> Decimal`, yet `decimal.ista:33-78` declares 16 separate `extern fn` overloads for `(Decimal, Int)` and `(Int, Decimal)` across `add`, `subtract`, `multiply`, `divide` (both 2-arg and 4-arg), `floorDivide`, `remainder`, and `compare`, backed by `mixedOverloads` and `operand` (`typeof value === 'bigint' ? value : textPayloadOf(value)`) in `src/stdlib/decimal/natives.ts:91-114`.
- proposal: Write the 10 mixed `(Int, Float)`/`(Float, Int)` overloads, `divide(Int, Int)`, `remainder(Int, Int)`, and `bitNot(Int)` in `src/stdlib/prelude/prelude.ista`; write `abs(Int)` and `sqrt(Int)` in `src/stdlib/math/math.ista`; and write the 16 `(Decimal, Int)`/`(Int, Decimal)` overloads in `src/stdlib/decimal/decimal.ista` using `Decimal(x)`. Delete `numeric` and `asFloat` from `src/stdlib/numeric.ts`, and delete `mixedOverloads` and `bigint` handling in `operand` from `src/stdlib/decimal/natives.ts`.
- confidence: high

### [high] 23 collection, string, range, random, and regex natives (`Array`, `Map`, `String`, `Range`, `random.integer`, `strings`, `regex`) are implemented in TypeScript instead of `.ista` on top of existing primitives
- where: `src/stdlib/prelude/prelude.ista:178, 181-185, 187, 193, 197-198, 201, 203, 205-207, 210, 213, 309`, `src/stdlib/prelude/arrays.ts:35-55, 88-98`, `src/stdlib/prelude/maps.ts:25-39, 49`, `src/stdlib/prelude/strings.ts:26-33`, `src/stdlib/prelude/range-natives.ts:1-21`, `src/stdlib/positions.ts:22-56`, `src/stdlib/ranges.ts:1-91`, `src/stdlib/random/random.ista:10`, `src/stdlib/random/natives.ts:35-42`, `src/stdlib/strings/strings.ista:13, 16, 19-20, 24-25`, `src/stdlib/strings/natives.ts:55-60, 64, 71-80, 91-103, 109-118`, `src/stdlib/regex/regex.ista:30, 39`, `src/stdlib/regex/natives.ts:57-58, 73-74`, `src/stdlib/regex/split.ts:1-31`
- evidence:
  1. **`Array` (`src/stdlib/prelude/arrays.ts` & `prelude.ista`)**:
     - `Array.default<T>()` (`arrays.ts:55`: `() => arrayOf([])`) is `fn Array.default<T>() -> Array<T>: []` in `prelude.ista` (matching `fn Optional.default<T>() -> T?: none` at `prelude.ista:143`).
     - `indexOf`, `lastIndexOf`, and `includes` (`arrays.ts:43-50`) call JS `.findIndex`, `.findLastIndex`, and `.some` with `valuesEqual`, even though `prelude.ista:232-242` already implements `findIndex`, `findLastIndex`, and `some` in `.ista` and `==` is built-in structural equality (`valuesEqual`) for every type `T`:
       ```ista
       fn indexOf<T>(self: Array<T>, item: T) -> Int: self.findIndex(fn(each): each == item)
       fn lastIndexOf<T>(self: Array<T>, item: T) -> Int: self.findLastIndex(fn(each): each == item)
       fn includes<T>(self: Array<T>, item: T) -> Bool: self.indexOf(item) >= 0
       ```
     - `flat<T>(self: Array<Array<T>>)` (`arrays.ts:47-48`) is `let flat: Array<T> = []; for inner in self: for item in inner: flat.push(item); flat` (mutating the unshared local `flat` in place via `InPlace`).
     - `at<T>(self: Array<T>, index: Int) -> T?` (`arrays.ts:35-39`) is `const pos = if index < 0: self.length() + index else: index; if 0 <= pos < self.length(): self[pos] else: none`.
     - `_patternItem` and `_patternRest` (`arrays.ts:88-98`): called only after the array pattern's length test has passed (`matching.ts:161-167`), so `_patternItem` is `self[if offset < 0: self.length() + offset else: offset]` and `_patternRest` is `self[before..self.length() - after]`, deleting `patternNatives` from `arrays.ts`.
  2. **`Map` (`src/stdlib/prelude/maps.ts` & `prelude.ista`)**:
     - `Map.default<K, V>()` (`maps.ts:49`: `() => ({ kind: 'map', entries: [] })`) is `fn Map.default<K, V>() -> Map<K, V>: [:]`.
     - `includes<K, V>(self: Map<K, V>, key: K)` (`maps.ts:32`) registers a duplicate native entry `hasKey`, whereas `collections.ista:38` writes `ista fn includes<K is Disposable, V>(self: WeakMap<K, V>, key: K) -> Bool: self.has(key)` in `.ista` (a double standard).
     - `keys`, `values`, and `entries` (`maps.ts:35-37`) are 1-line comprehensions/spreads over `Map`'s existing `iterate` in `prelude.ista`: `[for (k, _) in self: k]`, `[for (_, v) in self: v]`, and `[...self]`.
     - `get<K, V>(self: Map<K, V>, key: K) -> V?` (`maps.ts:29-30`) is `if self.has(key): self[key] else: none` (which works even when `V` is `None` or `T?` holding `none`, because `self.has(key)` distinguishes a present `none` from a missing key).
  3. **`Range` & `random.integer` (`src/stdlib/prelude/range-natives.ts`, `src/stdlib/ranges.ts`, `src/stdlib/random/natives.ts`)**:
     - `Range` (`prelude.ista:161`: `struct Range: start: Int?, end: Int?, step: Int = 1`) is a plain `.ista` struct, not an `extern` type. Yet `range-natives.ts` (`_steps`, `includes`) and `ranges.ts` (`rangeOf`, `bounded`, `countOf`, `reaches`, `textOf`) unpack its fields by name in TypeScript via `fieldValueOf` and `optionalInt` just to run integer arithmetic.
     - Writing `_steps`, `includes`, and `_text` on `Range` in `prelude.ista` deletes `src/stdlib/prelude/range-natives.ts` completely; and exposing `extern fn _below(bound: Int) -> Int` in `random` lets `random.integer(range: Range)` (`random/natives.ts:36-42`) be written in `random.ista`.
  4. **`String` & `strings` (`src/stdlib/prelude/strings.ts`, `src/stdlib/strings/natives.ts`, `src/stdlib/positions.ts`)**:
     - `at(self: String, index: Int) -> String?` (`prelude/strings.ts:26-32`) and `slice` on both `Array<T>` (`arrays.ts:40-42`) and `String` (`strings/natives.ts:55-59`) reduce to `self[pos]` and `self[from..to]` after clamping indices in `.ista`, which leaves `atPosition`, `sliceBounds`, and `sliced` in `src/stdlib/positions.ts` with 0 callers.
     - `strings.trim(self: String)` (`strings/natives.ts:64`) is `self.trimStart().trimEnd()`.
     - `strings.padStart` and `strings.padEnd` (`strings/natives.ts:71-74, 109-118`) re-implement `codePointCount`, `repeat`, and `codePointSlice` in TS (`padding`), which in `strings.ista` is `fill.repeat(missing // fillLength) + fill[..missing % fillLength]`.
     - `strings.replace` (`strings/natives.ts:76-77, 91-94`) is `const found = self.indexOf(search); if found < 0: self else: self[..found] + replacement + self[found + search.length()..]`.
     - `strings.replaceAll` (`strings/natives.ts:78-79, 96-103`) is `(if search == "": ["", ...self.split(""), ""] else: self.split(search)).join(replacement)`.
  5. **`regex` (`src/stdlib/regex/natives.ts`, `src/stdlib/regex/split.ts`)**:
     - `regex.test(self: Regex, s: String) -> Bool` (`regex/natives.ts:57-58`) is `self.find(s) != none`.
     - `regex.split(self: Regex, s: String) -> Array<String>` (`src/stdlib/regex/split.ts:12-30`) iterates `matchAll(s)` using match start/end offsets and slices `s` — which in `regex.ista` is a 12-line loop over `self.findAll(s)` using `found.index`, `found.text.length()`, and `s[pieceStart..start]`, eliminating `src/stdlib/regex/split.ts`.
- proposal: Move these 23 operations to `prelude.ista`, `random.ista`, `strings.ista`, and `regex.ista`; delete `src/stdlib/prelude/range-natives.ts` and `src/stdlib/regex/split.ts`; and delete `atPosition`, `sliceBounds`, and `sliced` from `src/stdlib/positions.ts`.
- confidence: high

### [high] `runtime.commit()` and `_Runtime.open`'s resolved-future wrapping are the sole callers of `NativeFutures.resolved`; moving resolved-future creation to `.ista` `async fn` deletes `NativeFutures.resolved` from the runtime seam
- where: `src/stdlib/runtime/runtime.ista:45, 67-70, 78`, `src/stdlib/runtime/natives.ts:30, 39-40`, `src/runtime/natives.ts:62`, `src/runtime/scheduler/segment/native-calls.ts:146`
- evidence:
  1. `NativeFutures.resolved` (`src/runtime/natives.ts:62`, implemented in `src/runtime/scheduler/segment/native-calls.ts:146` as `futures.createHandle({ kind: 'resolved', value })`) has only 2 callers in the entire repository, both in `src/stdlib/runtime/natives.ts`:
     - `[keys.of('commit')]: (_arguments, context) => context.futures.resolved(null)` (`runtime/natives.ts:30`)
     - `[keys.ofStatic('_Runtime', 'open', keys.type('Store'))]: ([store], context) => context.futures.resolved(context.contexts.open(given(store), resultTypeArgument(context, 0)))` (`runtime/natives.ts:39-40`)
  2. In the interpreter (`src/runtime/scheduler/segment/returns.ts:97-99`), any `async` `.ista` function that returns without awaiting inside its body pops its execution and calls `instance.futures.resolve(future, returned)`, returning a `Future` handle already in `{ kind: 'resolved', value }` state.
  3. Writing `ista async fn commit(): ()` in `src/stdlib/runtime/runtime.ista` gives the exact same signature `ista fn() -> Future<Unit, "ista">` and returns an already-resolved `Future<Unit, "ista">` without any native.
  4. `context.contexts.open` (`src/runtime/scheduler/segment/native-contexts.ts:45-57`) is synchronous; `_Runtime.open` only wrapped its return value in `context.futures.resolved` so `Runtime.open` (`runtime.ista:67-70`) could `await` once to yield the live segment and let `runLive` (`src/runtime/scheduler/live-run.ts:71-75`) drive resumed contexts before `Runtime.open` returns. Declaring `extern live fn _Runtime.open(store: Store) -> _Runtime` as a synchronous extern (using `declaredResult(context)` instead of `resultTypeArgument(context, 0)`) and awaiting `live async fn _yield(): ()` in `Runtime.open` eliminates the last caller of `context.futures.resolved`.
- proposal: Replace `extern ista fn commit() -> Future<Unit, "ista">` in `src/stdlib/runtime/runtime.ista` with `ista async fn commit(): ()`, make `_Runtime.open` synchronous with `await _yield()` in `Runtime.open`, and delete `commit` from `src/stdlib/runtime/natives.ts` and `NativeFutures.resolved` from `src/runtime/natives.ts` and `src/runtime/scheduler/segment/native-calls.ts`.
- confidence: high

### [high] Primitive, time, regex, and decimal `parse` / formatting helpers (`Bool.parse`, `toString(Bool)`, `toString(Duration)`, `time.utc`, and `time/fields.ts`) duplicate `.ista` struct/error handling in TypeScript natives
- where: `src/stdlib/prelude/prelude.ista:402, 408`, `src/stdlib/prelude/text-forms.ts:30-75`, `src/stdlib/time/time.ista:10-41, 59`, `src/stdlib/time/fields.ts:1-29`, `src/stdlib/time/iso.ts:76-91`, `src/stdlib/time/natives.ts:30-63`, `src/stdlib/time/zones.ts:64-76, 90-98, 128-140`, `src/stdlib/decimal/natives.ts:56-60`, `src/stdlib/values/results.ts:52-97`
- evidence:
  1. `toString(self: Bool)` and `Bool.parse(text: String)` in `src/stdlib/prelude/text-forms.ts:30-42` are trivial in `prelude.ista` (`if self: "true" else: "false"`, and matching `"true"` / `"false"`).
  2. `Duration` and `Time` (`time.ista:10-14`) are plain `.ista` structs (`struct Duration: value: Int`, `struct Time: value: Int`), not `extern` types. Yet `src/stdlib/time/fields.ts` (`millisecondsOf`, `resultMilliseconds`, `okMilliseconds`) exists solely so `time/natives.ts` and `time/zones.ts` can unpack `.value` via `fieldValueOf` and repack `{ value: milliseconds }` via `resultStruct`/`okStruct` in TypeScript. Moreover, `toString(self: Duration) -> String` (`durationText` in `src/stdlib/time/iso.ts:76-91`, which has 0 callers outside `time/natives.ts`) is pure integer division/remainder on `self.value` and can be written directly in `time.ista`, and `utc() -> Zone` (`zones.ts:64`) is `Zone.parse("UTC")` unwrapped in `time.ista`.
  3. Among the TS `parse` natives, `parsedStruct` in `src/stdlib/time/natives.ts:54-63` is re-written inline in `src/stdlib/time/zones.ts:65-69` (`Zone.parse`), `zones.ts:72-76` (`DateTime.parse`), `src/stdlib/decimal/natives.ts:56-60` (`Decimal.parse`), and `src/stdlib/prelude/text-forms.ts:62-70`:
     - `time/natives.ts:58-60`: `const milliseconds = read(text(source)); const parsed = milliseconds === undefined ? undefined : okMilliseconds(context, milliseconds); return parseResult(context, text(source), what, parsed);`
     - `zones.ts:66-68`: `const id = canonicalZone(text(source)); const zone = id === undefined ? undefined : okExtern(context, id); return parseResult(context, text(source), 'an IANA time zone', zone);`
     - `zones.ts:73-75`: `const read = readPlain(text(source)); const dateTime = read === undefined ? undefined : okStruct(context, fieldsOf(read)); return parseResult(context, text(source), 'an ISO 8601 date and time', dateTime);`
     - `decimal/natives.ts:57-59`: `const read = readDecimal(text(source)); const value = read && okExtern(context, canonicalText(read)); return parseResult(context, text(source), 'a decimal number', value);`
  4. There is also a double standard in how stdlib modules construct `Error` for external input failures: `json.parse` (`src/stdlib/json/json.ista:39-43, 228`) calls `extern fn _read(text: String) -> Result<Json, String>` and builds `Error{message, code: "json"}` in `.ista` (so its trace starts at `json._error`), whereas `Int.parse`, `Regex.parse`, `Time.parse`, and `crypto.decode` build `Error` in TypeScript via `resultError(context, ...)` (`src/stdlib/values/results.ts:72-74`, whose `context.trace()` omits the native call itself, tested in `src/stdlib/prelude/error-trace.test.ts:81`).
- proposal: Write `toString(Bool)` in `prelude.ista`, `toString(Duration)` and `utc()` in `time.ista`, and pass `time.value` (`Int`) to `time`'s private externs so `src/stdlib/time/fields.ts` and `durationText` (`src/stdlib/time/iso.ts`) are deleted. Extract a single `parsedNative(what, read, toValue?)` helper in `src/stdlib/values/results.ts` shared by `text-forms.ts`, `time/natives.ts`, `time/zones.ts`, and `decimal/natives.ts`.
- confidence: high

### [med] `testing._mock` and `testing._calls` are leftover forwarding wrappers from before `Fn<A, R, M>` unified plain and async functions, and `expectPanic` has a single-use `_panicOf` helper
- where: `src/stdlib/testing/testing.ista:7-8, 88-98, 199-205`, `src/stdlib/testing/natives.ts:41-44`
- evidence:
  1. The banner of `src/stdlib/testing/testing.ista:7-8` states: `# mock and calls take a pack (§3.5), one declaration for plain functions and one for async ones.`
  2. Since `Fn<A, R, M>` unified plain and async function types, `testing.ista:88-98` now has only one `mock` and one `calls`, which are 1-line wrappers forwarding directly to private externs `_mock` and `_calls`:
     ```ista
     extern fn _mock<F>(target: F, replacement: F) -> Mock<F>
     extern fn _calls<F, A>(self: Mock<F>) -> Array<A>
     fn mock<...A, R, M in Mark = "simple">(target: Fn<A, R, M>, replacement: Fn<A, R, M>) -> Mock<Fn<A, R, M>>:
       _mock(target, replacement)
     fn calls<...A, R, M in Mark = "simple">(self: Mock<Fn<A, R, M>>) -> Array<A>: _calls(self)
     ```
  3. In `src/compiler/lowering/tables/names.ts:295-319`, `Fn<A, R, M>` (where `...A` is a pack and `M` is a mark parameter) lowers to `functionKey([parameterKey('...A')], parameterKey('R'))`, so `mock` and `calls` can be `extern fn` declarations directly without `_mock` and `_calls`.
  4. In `src/stdlib/testing/testing.ista:199-205`, `expectPanic` is `await _panicOf(spawn(f))`, where `_panicOf` is a 4-line helper with no other caller.
- proposal: Declare `mock` and `calls` directly as `extern fn` in `src/stdlib/testing/testing.ista` (keyed in `src/stdlib/testing/natives.ts` with `const fnType = functionKey([parameterKey('...A')], parameterKey('R'))`), delete `_mock` and `_calls`, update the stale banner comment at `testing.ista:7-8`, and inline `_panicOf` into `expectPanic`.
- confidence: high

### [med] `futures.any` duplicates `futures.quorum`'s arrival loop, `testing.FakeQueue` / `FakeReceipts` hand-roll maps with parallel arrays, and `json.Map.fromJson` duplicates `json._fields`
- where: `src/stdlib/futures/futures.ista:62-97`, `src/stdlib/testing/testing.ista:272-355`, `src/stdlib/json/json.ista:161-169, 180-183`
- evidence:
  1. In `src/stdlib/futures/futures.ista:62-75`, `any` runs the exact same `_arrivals` + `First` + `_without` + `errors: Map<Int, E>` + `_inOrder(errors, futures.length())` loop as `quorum` (`futures.ista:78-97`) for the special case `n = 1`. When `futures.length() == 0`, `any` returns `Err([])`; when `futures.length() > 0`, `any(futures)` is simply `Ok(quorum(1, futures)?[0])`.
  2. In `src/stdlib/testing/testing.ista:280-320`, `_Opened<Q, K>` stores `keys: Array<K> = []` and `queues: Array<Q> = []`, and `_Inboxes<Q, T>` stores `queues: Array<Q> = []` and `inboxes: Array<Inbox<T>> = []`, with `_queueOf` and `_inboxOf` running manual `for index in 0..length()` loops comparing `keys[index] == key` and `queues[index] == queue` instead of using `Map<K, Q>` and `Map<Q, Inbox<T>>` (which support any `K` and any extern handle `Q` via built-in structural `==`). Similarly, `_Receipts<R>` (`testing.ista:327-355`) stores `Array<_Receipt<R>>` and partitions it manually in `_disposeReceipt` instead of `Map<R, Array<ista fn() -> Unit>>`.
  3. In `src/stdlib/json/json.ista:161-169`, `Map.fromJson` pattern-matches `case Map<String, Json> as fields:` and calls `_mismatch(json, path, "an object")`, duplicating `_fields(json, path)` defined immediately below at `json.ista:180-183`.
- proposal: Implement `futures.any` in `src/stdlib/futures/futures.ista` via `quorum(1, futures)`, replace the parallel arrays in `_Opened`, `_Inboxes`, and `_Receipts` (`src/stdlib/testing/testing.ista`) with `Map`, and use `_fields(json, path)?` in `Map.fromJson` (`src/stdlib/json/json.ista`).
- confidence: high

### [med] Spawning natives (`spawn`, `runtime._isolated`, `testing.spawnCrashingEveryAwait`) and context-call natives (`runtime._call`, `runtime._jobCall`) duplicate key construction and native bodies
- where: `src/stdlib/prelude/instance-natives.ts:16-20`, `src/stdlib/runtime/natives.ts:31-34, 42-64`, `src/stdlib/runtime/runtime.ista:103-117, 230, 232, 242`, `src/stdlib/testing/natives.ts:45-50`, `src/stdlib/std-module.ts:72-74`
- evidence:
  1. All 4 callers of `futureKey` in the repository (`prelude/instance-natives.ts:17`, `runtime/natives.ts:31, 53`, `testing/natives.ts:48`) construct the same `ista async fn() -> T` key `functionKey([], futureKey(parameterKey('T'), 'ista'), 'ista')`.
  2. Three of those (`spawn` in `prelude/instance-natives.ts:17-20`, `_isolated` in `runtime/natives.ts:31-34`, and `spawnCrashingEveryAwait` in `testing/natives.ts:45-50`) have the identical native implementation `([entry], context) => context.instances.spawn(given(entry), declaredResult(context), options)`, differing only in `SpawnOptions` (`{}`, `{ terminatesOnPanic: true }`, `{ crashEveryAwait: true }`).
  3. In `src/stdlib/runtime/runtime.ista:103-117` and `src/stdlib/runtime/natives.ts:42-64`, `_call` and `_jobCall` are two separate generic extern declarations with identical signatures `(runtime: _Runtime, key: String, f: sendable ista async fn() -> R) -> Future<Result<R>, "live">`, differing only in `maker: 'program' | 'jobs'` (`CallMaker`).
- proposal: Replace `futureKey` in `src/stdlib/std-module.ts` with `istaTaskKey(resultParameter = 'T')` and a `spawnNative(keys, name, options)` helper shared by `prelude/instance-natives.ts`, `runtime/natives.ts`, and `testing/natives.ts`; and unify `_call` and `_jobCall` in `runtime.ista` / `runtime/natives.ts` by passing `maker: "program" | "jobs"` (or `hearsPanic: Bool`).
- confidence: high

### [med] `variantName` in `src/stdlib/values/arguments.ts` duplicates enum variant lookup from `src/definition/values/declared-values.ts`, and `arrayOf` is misplaced in `arguments.ts` instead of `results.ts`
- where: `src/stdlib/values/arguments.ts:58-69`, `src/stdlib/values/results.ts:1-114`, `src/definition/values/declared-values.ts:105-168`
- evidence:
  1. `src/definition/values/declared-values.ts` is the home for reading and building struct/enum `Value`s by declared name (`fieldValueOf`, `structOf`, `variantOf`, `optionalOf`, `optionalValueOf`), and its internal `optionalOf` (`declared-values.ts:138`) looks up a variant's declared name via `enumVariants(types, value.type)[value.variant]?.name`.
  2. Because `declared-values.ts` does not export `variantNameOf(types, value)`, `src/stdlib/values/arguments.ts:62-69` re-implements `variantName(context, value)` from scratch (`isComposite(value) && value.kind === 'variant'`, `context.types[value.type]`, `declared.variants[value.variant]?.name`).
  3. `arrayOf` (`src/stdlib/values/arguments.ts:58-60`) builds an array `Value` (`{ kind: 'array', elements: [...elements] }`) for natives to return as a result (never to read an argument), yet it lives in `arguments.ts` instead of `results.ts`.
- proposal: Export `variantNameOf(types, value)` from `src/definition/values/declared-values.ts` and call it in both `optionalOf` (`declared-values.ts:138`) and `variantEntry` (`src/stdlib/values/arguments.ts:87`), and move `arrayOf` from `src/stdlib/values/arguments.ts` to `src/stdlib/values/results.ts`.
- confidence: high

### [med] CLI file-existence checks in `test.ts` and `host-module.ts` bypass `project-files.ts`'s `statOnDisk` / `diskFiles.isFile`
- where: `src/cli/commands/test.ts:14, 113-121`, `src/cli/host-module.ts:9, 25-27`, `src/cli/commands/fmt.ts:20, 44`, `src/project/project-files.ts:20-37`
- evidence:
  1. `src/project/project-files.ts:29-37` defines `statOnDisk(path)`, which wraps `statSync(path, { throwIfNoEntry: false })` and catches `ENOTDIR` (`isSystemError(error) && error.code === 'ENOTDIR'`) so a path traversing through a non-directory file (e.g. `file.ista/sub`) returns `undefined` ("no such file") instead of crashing. `diskFiles.isFile` (`fmt.ts:44`) and `locateFile` (`check.ts`, `run.ts`) both go through `statOnDisk`.
  2. By contrast, `testModulesOf` in `src/cli/commands/test.ts:114` calls `statSync(resolve(cwd, path), { throwIfNoEntry: false })` directly from `node:fs` without catching `ENOTDIR`.
  3. Similarly, `loadHostModule` in `src/cli/host-module.ts:25` calls `existsSync(path)` from `node:fs` instead of `diskFiles.isFile(path)`, so passing a directory to `--host` passes `existsSync` and fails inside `import()` instead of reporting `no such file`.
- proposal: Use `statOnDisk(resolve(cwd, path))` in `src/cli/commands/test.ts:114` and `diskFiles.isFile(path)` in `src/cli/host-module.ts:25`.
- confidence: high

### [low] Unused exports, test-only exports, and duplicated `importableStdModules` filtering across `src/stdlib/` and `src/cli/`
- where: `src/stdlib/prelude/text-forms.ts:29, 45, 48`, `src/stdlib/random/natives.ts:47`, `src/stdlib/stdlib-loader.ts:25, 30-38`, `src/stdlib/positions.ts:59, 98`, `src/stdlib/ranges.ts:39`, `src/cli/host-module.ts:14`, `src/stdlib/std-modules.test-kit.ts:16`
- evidence:
  1. 5 exported types/interfaces have 0 importers anywhere in `src/` or `test/`: `ParsedPrimitive` (`src/stdlib/prelude/text-forms.ts:45`), `Selection` and `Splice` (`src/stdlib/positions.ts:59, 98`), `BoundedRange` (`src/stdlib/ranges.ts:39`), and `LoadedHostModule` (`src/cli/host-module.ts:14`).
  2. 4 exported functions have 0 non-test importers in `src/`:
     - `primitiveText` and `readPrimitive` (`src/stdlib/prelude/text-forms.ts:29, 48`) are imported only by `src/stdlib/prelude/text-forms.test.ts`.
     - `uniformBelow` (`src/stdlib/random/natives.ts:47`) is imported only by `src/stdlib/random/natives.test.ts`.
     - `preludeModule` (`src/stdlib/stdlib-loader.ts:25`) is imported only by `src/compiler/binder/bind.test-kit.ts` (`preludeProgramOf`).
  3. In `src/stdlib/stdlib-loader.ts:30-38`, `stdRoles` spells out all 5 keys (`prelude`, `time`, `json`, `lifetimes`, `testing`) by hand instead of mapping over `Object.values(languageModules)`.
  4. In `src/stdlib/std-modules.test-kit.ts:16`, `everyStdModule` re-computes `Object.keys(stdModuleSources).filter((name) => name !== languageModules.prelude)` instead of importing `importableStdModules` from `src/stdlib/stdlib-loader.ts:48`.
- proposal: Unexport `ParsedPrimitive`, `Selection`, `Splice`, `BoundedRange`, `LoadedHostModule`, `primitiveText`, `readPrimitive`, and `uniformBelow`; derive `stdRoles` from `Object.values(languageModules)`; and reuse `importableStdModules` in `src/stdlib/std-modules.test-kit.ts`.
- confidence: high

## Missing from docs/reuse

### Exported units in `std` with callers outside their folder not listed in `docs/reuse/*.md`
- `src/cli/command.ts`: `CommandDefinition` (5 callers outside folder), `ExitCode` (4 callers outside folder)
- `src/cli/commands/check.ts`: `defineCheckCommand` (1 caller outside folder: `src/cli/cli.ts`)
- `src/cli/commands/fmt.ts`: `defineFmtCommand` (1 caller outside folder: `src/cli/cli.ts`)
- `src/cli/commands/lsp.ts`: `defineLspCommand` (1 caller outside folder: `src/cli/cli.ts`)
- `src/cli/commands/run.ts`: `defineRunCommand` (1 caller outside folder: `src/cli/cli.ts`)
- `src/cli/commands/test.ts`: `defineTestCommand` (1 caller outside folder: `src/cli/cli.ts`)
- `src/runtime/natives.ts`: `NativeCapabilities` (1 caller), `FullNativeContext` (1 caller), `NativeResolver` (2 callers), `Resolvable` (1 caller), `ResolverState` (1 caller)
- `src/runtime/scheduler/segment/native-calls.ts`: `NativeCalls` (2 callers outside folder)
- `src/stdlib/std-module.ts`: `futureKey` (3 callers outside folder: `prelude/instance-natives.ts`, `runtime/natives.ts`, `testing/natives.ts`)
- `src/stdlib/math/rounding.ts`: `Rounding` (1 caller outside folder: `decimal/arithmetic.ts`)
- `src/stdlib/std-externs.test-kit.ts`: `stdExterns`, `stdNativeKeeps` (called in `src/runtime/lifetimes/native-audit.test-kit.ts`, missing from `docs/reuse/testing.md`)
- `src/stdlib/testing/testing.ista`: `FakeReceipts`, `revertibleSender` (reusable `.ista` test helper alongside `FakeClock` and `FakeQueue`)

### Stale or inaccurate entries in `docs/reuse/*.md` for `std` (and adjacent value/key docs)
- `docs/reuse/stdlib-and-natives.md:27` lists `replaced` (`src/stdlib/positions.ts`), which does not exist; the function was renamed to `splicesOf`.
- `docs/reuse/stdlib-and-natives.md:29` lists `primitiveText` and `readPrimitive` (`src/stdlib/prelude/text-forms.ts`) as reusable units, but both have 0 non-test callers.
- `docs/reuse/stdlib-and-natives.md:31` lists `uniformBelow` (`src/stdlib/random/natives.ts`) as a reusable unit, but it has 0 non-test callers.
- `docs/reuse/stdlib-and-natives.md:14` lists `preludeModule` (`src/stdlib/stdlib-loader.ts`), which has 0 non-test callers (used only in `src/compiler/binder/bind.test-kit.ts`).
- `docs/reuse/stdlib-and-natives.md:13, 15, 16, 24, 25, 30` and `docs/reuse/values-and-equality.md:28` list `stdModule`, `nativeKeysOf` (`src/stdlib/std-module.ts`), `stdModules` (`src/stdlib/std-modules.ts`), `stdModuleSources`, `StdModuleName` (`src/stdlib/std-sources.ts`), `floatRoundings` (`src/stdlib/math/rounding.ts`), `decimalRoundings` (`src/stdlib/decimal/arithmetic.ts`), `readTime`, `durationText`, `readDuration` (`src/stdlib/time/iso.ts`), and `millisecondsOf`, `resultMilliseconds`, `okMilliseconds` (`src/stdlib/time/fields.ts`), all of which have 0 callers outside their own folder.
- `docs/reuse/values-and-equality.md:18` lists `variantShape` (`src/definition/values/declared-values.ts`), which is a private (non-exported) function in `declared-values.ts`.
- `docs/reuse/modules-and-names.md:19` lists `primitiveKey` (`src/definition/extern-key.ts`), which is a private (non-exported) function in `extern-key.ts`.
