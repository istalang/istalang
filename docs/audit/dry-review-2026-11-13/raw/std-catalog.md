## src/cli/cli.ts — Commander CLI entry point wiring subcommands and mapping usage/system errors to exit codes
- commands — list of subcommand definitions (`check`, `fmt`, `lsp`, `run`, `test`); callers: 0 outside folder
- runCli(args, environment) — parses CLI arguments and runs the chosen subcommand in-process, returning its `ExitCode`; [exp]; callers: 0 outside folder

## src/cli/clock.ts — Real-time `Clock` implementation for `ista run` and `ista test`
- clock — `Clock` backed by `Date.now()` and abortable `timers/promises` `setTimeout`; [exp]; callers: 2 outside folder

## src/cli/command.ts — Subcommand environment seam and exit code definitions
- CliEnvironment — process environment seam (`cwd`, `write`, `writeError`, `idle`, `stdio`, `heapCheck`); [exp]; callers: 4 outside folder
- exitCodes — CLI exit codes (`clean: 0`, `problems: 1`, `couldNotRun: 2`); [exp]; callers: 5 outside folder
- ExitCode — union of CLI exit code numbers (`0 | 1 | 2`); [exp]; callers: 4 outside folder
- CommandDefinition — function signature registering one subcommand on the root `Command`; [exp]; callers: 5 outside folder

## src/cli/commands/check.ts — `ista check [files…]` subcommand reporting compiler diagnostics
- defineCheckCommand(cli, {environment, exitWith}) — registers the `check` subcommand on `cli`; [exp]; callers: 1 outside folder
- check(files, environment) — loads project roots, reports diagnostics, and returns the exit code; callers: 0 outside folder

## src/cli/commands/fmt.ts — `ista fmt [--check] [files…]` subcommand formatting source files canonically
- defineFmtCommand(cli, {environment, exitWith}) — registers the `fmt` subcommand on `cli`; [exp]; callers: 1 outside folder
- fmt(files, check, environment) — formats named or project `.ista` files (or lists unformatted ones with `--check`); callers: 0 outside folder

## src/cli/commands/lsp.ts — `ista lsp [--stdio]` subcommand running the LSP server over stdio
- defineLspCommand(cli, {environment, exitWith}) — registers the `lsp` subcommand and serves LSP until stdin closes; [exp]; callers: 1 outside folder

## src/cli/commands/run.ts — `ista run [--store] [--host] <entry>` subcommand compiling and running `main()`
- defineRunCommand(cli, {environment, exitWith}) — registers the `run` subcommand on `cli`; [exp]; callers: 1 outside folder
- run(entry, options, environment) — loads optional `--host` module, creates store and runtime, and starts `entry`; callers: 0 outside folder
- errorStreamReports(environment) — builds `HostReports` writing JSON log lines and unheard instance panics to `writeError`; callers: 0 outside folder
- start(session, entry, options) — loads and compiles `entry`, deploys Definition, and runs `main()` until idle; callers: 0 outside folder
- untilIdle({environment}, running) — races `main`'s live run against `environment.idle` to detect stuck waits; callers: 0 outside folder
- finish(session, program, {state, logs}) — writes committed logs and outcome JSON or panic/stuck error messages; callers: 0 outside folder
- waitsOf(runtime, store) — formats waiting waypoints/locations of all waiting instances in `store`; callers: 0 outside folder
- unlessRefused(environment, action) — runs `action`, catching `Refusal`/`FormatError` to report to `writeError`; callers: 0 outside folder

## src/cli/commands/test.ts — `ista test [--filter] [--timeout] [paths…]` subcommand compiling and running `@Suite` tests
- defineTestCommand(cli, {environment, exitWith}) — registers the `test` subcommand on `cli`; [exp]; callers: 1 outside folder
- test(paths, options, environment) — locates test modules, compiles suites, runs tests, and prints per-test outcomes and summary; callers: 0 outside folder
- reportOf({title, outcome}) — formats one test's result line and indented failure message, trace, and logs; callers: 0 outside folder
- testModulesOf(cwd, paths) — resolves file and directory arguments into `*.test.ista` module paths and unreadable paths; callers: 0 outside folder

## src/cli/directory-store.ts — Atomic file-backed `InstanceStore` for `ista run --store <dir>`
- directoryStore(directory) — creates an `InstanceStore` persisting definitions, snapshots, and externs in `directory`; [exp]; callers: 1 outside folder
- storedNames(directory) — lists instance names decoded from `instances/*.json` filenames; callers: 0 outside folder
- readIfPresent(file) — reads UTF-8 file text or returns `undefined` on `ENOENT`; callers: 0 outside folder
- writeAtomically(directory, file, text) — writes `text` to a PID-suffixed temp file and renames it over `file`; callers: 0 outside folder

## src/cli/host-module.ts — Dynamic JS module loader for `ista run --host <module>`
- LoadedHostModule — discriminated union (`loaded` with `HostExterns` | `unfit` with problem message); [exp]; callers: 0 outside folder
- loadHostModule(path) — imports JS module at `path` and wraps its default export's functions as `HostExterns`; [exp]; callers: 1 outside folder
- spreading(entries) — adapts `(...args) => result` module functions to `(args: readonly unknown[]) => result`; callers: 0 outside folder

## src/cli/log-lines.ts — Canonical single-line JSON formatter for runtime `LogRecord`s
- logLine(record) — encodes a `LogRecord` as one line of canonical JSON with ISO 8601 `time`; [exp]; callers: 2 outside folder

## src/cli/main.ts — Node executable entry point binding `runCli` to `process` streams and `beforeExit`
- (top-level script) — invokes `runCli(process.argv.slice(2), ...)` and sets `process.exitCode`; callers: 0 outside folder

## src/cli/report.ts — CLI diagnostic and unreadable-path rendering with error/warning summary
- reportDiagnostics(results, write) — renders all module diagnostics with source excerpts and summary, returning error count; [exp]; callers: 4 outside folder
- reportUnreadable(paths, writeError) — writes `ista: no such file: <path>` for each unreadable path; [exp]; callers: 4 outside folder

## src/runtime/natives.ts — The `Natives` seam, `NativeContext`, capability interfaces, and `Panic` error class
- NativeContext — base per-call context handed to every native (name, resultType, typeArguments, types, now, changes, traces); [exp]; callers: 25 outside folder
- NativeFutures — capability creating resolved, timer, or live resolvable futures; [exp]; callers: 1 outside folder
- NativeWaits — capability registering `onAwait` and creating/resolving/cancelling `Resolver`s; [exp]; callers: 1 outside folder
- ResolverState — `'pending' | 'resolved' | 'cancelled'`; [exp]; callers: 1 outside folder
- NativeResolver — one-shot resolver for a live future (`tryResolve`, `fail`, `panic`, `onCancel`); [exp]; callers: 2 outside folder
- Resolvable — `{ future, resolver }` pair for a live future; [exp]; callers: 1 outside folder
- NativeSlots — capability creating slots and queuing `put`, `take`, and `read` futures; [exp]; callers: 1 outside folder
- NativeWeakSide — capability creating weak references, dereferencing them, and watching disposal; [exp]; callers: 1 outside folder
- NativeResources — capability creating and reading heap resource handles for disposable host types; [exp]; callers: 1 outside folder
- NativeInstances — capability spawning child instances and watching their end `Result`; [exp]; callers: 1 outside folder
- NativeContexts — capability accessing `hostStore`, opening runtimes, calling contexts, and serving jobs in a live run; [exp]; callers: 1 outside folder
- NativeTesting — capability installing mocks, reading mock calls, inspecting/watching instances, and making host handles; [exp]; callers: 1 outside folder
- NativeRandom — capability drawing deterministic 32-byte random chunks for the segment; [exp]; callers: 1 outside folder
- NativeLogs — capability appending structured log entries to the segment; [exp]; callers: 1 outside folder
- WithFutures — capability mixin carrying `futures: NativeFutures`; [exp]; callers: 2 outside folder
- WithWaits — capability mixin carrying `waits: NativeWaits`; [exp]; callers: 2 outside folder
- WithSlots — capability mixin carrying `slots: NativeSlots`; [exp]; callers: 2 outside folder
- WithWeakSide — capability mixin carrying `weak: NativeWeakSide`; [exp]; callers: 2 outside folder
- WithResources — capability mixin carrying `resources: NativeResources`; [exp]; callers: 1 outside folder
- WithRandom — capability mixin carrying `random: NativeRandom`; [exp]; callers: 1 outside folder
- WithLogs — capability mixin carrying `logs: NativeLogs`; [exp]; callers: 1 outside folder
- WithInstances — capability mixin carrying `instances: NativeInstances`; [exp]; callers: 4 outside folder
- WithTesting — capability mixin carrying `testing: NativeTesting`; [exp]; callers: 1 outside folder
- WithContexts — capability mixin carrying `contexts: NativeContexts`; [exp]; callers: 1 outside folder
- NativeCapabilities — intersection of all 10 `With*` capability interfaces; [exp]; callers: 1 outside folder
- FullNativeContext — `NativeContext & NativeCapabilities`; [exp]; callers: 1 outside folder
- Native<Context> — function signature `(argumentValues, context) => Value` for a native; [exp]; callers: 10 outside folder
- Natives<Context> — record mapping extern keys to `Native<Context>` functions; [exp]; callers: 24 outside folder
- Panic — error thrown by natives or limits to panic the running instance with an optional trace; [exp]; callers: 19 outside folder

## src/runtime/scheduler/segment/native-calls.ts — Building `FullNativeContext` and invoking natives within a segment
- NativeCalls — per-segment native caller binding capabilities once and building per-call context; [exp]; callers: 2 outside folder
- NativeCalls.call(callee, native, contents) — unwraps `&` args, runs `native` (with heap audit and extern const pinning), returns `Value`; callers: 0 outside folder
- NativeCalls.#checked(call, called) — wraps native execution with `loaded.heapCheck.native` audit; callers: 0 outside folder
- referenceAt(contents, position) — returns the `Reference` at argument `position` or calls `unreachable`; callers: 0 outside folder
- capabilitiesOf(instance, side) — constructs all 10 `NativeCapabilities` for a segment of `instance`; callers: 0 outside folder
- nativeFuturesOf(instance, {waiting, trace}) — builds `NativeFutures` (`resolved`, `timer`, `resolvable`); callers: 0 outside folder
- nativeWaitsOf({waits, futures}) — builds `NativeWaits` delegating to `instance.waits`; callers: 0 outside folder
- nativeSlotsOf(slots) — builds `NativeSlots` delegating to `instance.slots`; callers: 0 outside folder
- nativeResourcesOf(heap) — builds `NativeResources` adding/reading `'resource'` heap objects; callers: 0 outside folder
- nativeInstancesOf(instance, waiting) — builds `NativeInstances` (`spawn` with outcome encoder, `ended` watch future); callers: 0 outside folder
- nativeTestingOf(instance) — builds `NativeTesting` (`mock`, `calls`, `inspect`, `watch`, `handle`); callers: 0 outside folder

## src/stdlib/collections/collections.ista — `WeakMap<K, V>` keeping entries only while their disposable keys remain alive
- WeakMap<K is Disposable, V> — shared struct holding `_Store<K, V>` of weak-keyed entries; [exp]; callers: 0 outside folder
- dispose(self: _Store<K, V>) — no-op disposer making `_Store` disposable so disposal watches can hold `WeakRef<_Store>`; [exp]; callers: 0 outside folder
- WeakMap.create<K, V>() — creates a new empty `WeakMap<K, V>`; [exp]; callers: 0 outside folder
- get(self: WeakMap<K, V>, key: K) — returns the value for `key` if present, else `none`; [exp]; callers: 0 outside folder
- has(self: WeakMap<K, V>, key: K) — tests whether `self` holds an entry for `key`; [exp]; callers: 0 outside folder
- includes(self: WeakMap<K, V>, key: K) — `in` operator support forwarding to `self.has(key)`; [exp]; callers: 0 outside folder
- set(self: WeakMap<K, V>, key: K, value: V) — stores `value` under `WeakRef(key)` and spawns `_deleteOnDisposal` watch if new; [exp]; callers: 0 outside folder
- delete(self: WeakMap<K, V>, key: K) — deletes `key`'s entry and cancels its watch; [exp]; callers: 0 outside folder
- _deleteOnDisposal(store, key) — async watch awaiting `key.disposed()` and deleting `key` from `store`; callers: 0 outside folder

## src/stdlib/crypto/crypto.ista — Cryptographic digests, HMACs, constant-time string equality, and hex/base64 encodings
- Hash — enum of digest algorithms (`Sha1`, `Sha256`, `Sha384`, `Sha512`); [exp]; callers: 0 outside folder
- Encoding — enum of binary-to-text encodings (`Hex`, `Base64`, `Base64Url`); [exp]; callers: 0 outside folder
- hash(algorithm, data, encoding) — extern computing digest of UTF-8 `data` in `encoding`; [exp]; callers: 0 outside folder
- hmac(algorithm, key, data, encoding) — extern computing HMAC of UTF-8 `data` with `key` in `encoding`; [exp]; callers: 0 outside folder
- timingSafeEqual(a, b) — extern comparing two strings in constant time when equal-length; [exp]; callers: 0 outside folder
- encode(text, encoding) — extern encoding UTF-8 `text` into `encoding`; [exp]; callers: 0 outside folder
- decode(text, encoding) — extern decoding canonical `encoding` text back to UTF-8 `Result<String>`; [exp]; callers: 0 outside folder

## src/stdlib/crypto/natives.ts — Node `crypto` and `Buffer` natives for the `crypto` std module
- cryptoNatives(keys) — builds the native table for `crypto.hash`, `hmac`, `timingSafeEqual`, `encode`, and `decode`; [exp]; callers: 1 outside folder

## src/stdlib/decimal/arithmetic.ts — Exact arbitrary-precision decimal arithmetic and canonical formatting over `decimal.js`
- Decimal — type alias for `DecimalJs`; [exp]; callers: 0 outside folder
- DecimalRounding — type alias for `DecimalJs.Rounding`; [exp]; callers: 0 outside folder
- decimalRoundings — table mapping `math.Rounding` variant names to `DecimalJs` rounding constants; [exp]; callers: 0 outside folder
- decimalOf(value) — constructs an exact-precision `Decimal` from canonical text or `bigint`; [exp]; callers: 0 outside folder
- readDecimal(source) — parses `source` if it matches `/^-?\d+(?:\.\d+)?$/u`, else `undefined`; [exp]; callers: 0 outside folder
- canonicalText(value) — formats `value` linearly from its base-1e7 words without exponent, trailing zeros, or `-0`; [exp]; callers: 0 outside folder
- fixedText(value, places, mode) — formats `value` rounded to `places` decimal places in `mode`; [exp]; callers: 0 outside folder
- truncatedInt(value) — truncates `value` toward zero as a `bigint`; [exp]; callers: 0 outside folder
- nearestFloat(value) — converts `value` to its nearest IEEE 754 `number`; [exp]; callers: 0 outside folder
- roundedTo(value, places, mode) — rounds `value` to `places` decimal places in `mode`; [exp]; callers: 0 outside folder
- divided(left, right) — divides `left / right` rounded half-even to 34 significant digits; [exp]; callers: 0 outside folder
- dividedTo(left, right, places, mode) — divides `left / right` rounded to `places` decimal places in `mode`; [exp]; callers: 0 outside folder
- floorDivided(left, right) — computes floored integer quotient `(left - left % right) / right`; [exp]; callers: 0 outside folder
- remainderOf(left, right) — computes floored modulo `left % right` with divisor's sign; [exp]; callers: 0 outside folder
- power(base, exponent) — raises `base` to integer `exponent` via `bigint` power or 100-digit guard division; [exp]; callers: 0 outside folder
- exactPower(base, exponent) — computes exact non-negative integer power via `bigint` exponentiation; callers: 0 outside folder
- powerBelowZero(base, magnitude) — computes negative integer power rounded to 34 significant digits; callers: 0 outside folder
- significantDigits(value) — joins `value.d` base-1e7 words in 4096-word blocks and strips trailing zeros; callers: 0 outside folder
- placesOf(places) — validates `0 <= places <= maximumDigits` or throws `Panic`; callers: 0 outside folder

## src/stdlib/decimal/decimal.ista — `Decimal` extern type, conversions, JSON codecs, and arithmetic/comparison declarations
- Decimal — extern struct representing an exact decimal number by its canonical text; [exp]; callers: 0 outside folder
- Decimal.from(value: Int) / Int.from(value: Decimal) / Float.from(value: Decimal) — numeric conversions; [exp]; callers: 0 outside folder
- toString(self: Decimal) / Decimal.parse(text: String) / toFixed(self, places, mode) — text formatting and parsing; [exp]; callers: 0 outside folder
- toJson(self: Decimal) / Decimal.fromJson(value, path) — JSON codecs delegating to `json.encodeText` / `decodeText`; [exp]; callers: 0 outside folder
- add / subtract / multiply / negate / divide / floorDivide / remainder / compare — decimal arithmetic and ordering; [exp]; callers: 0 outside folder
- abs / round / floor / ceil / power — decimal rounding, magnitude, and integer exponentiation; [exp]; callers: 0 outside folder

## src/stdlib/decimal/natives.ts — Natives binding `decimal.ista` externs to `decimal/arithmetic.ts`
- decimalNatives(keys, mathKeys) — builds the native table for `decimal` module externs; [exp]; callers: 1 outside folder
- mixedOverloads(keys, decimal) — generates `(Decimal, Decimal)`, `(Decimal, Int)`, and `(Int, Decimal)` native entries; callers: 0 outside folder

## src/stdlib/fanout/fanout.ista — `Bus<M>` broadcast pub-sub stream built on a linked chain of `Slot`s
- Bus<M> — shared struct holding the tail `Slot<_Link<M>>` of the broadcast stream; [exp]; callers: 0 outside folder
- create<M>() — creates a new `Bus<M>`; [exp]; callers: 0 outside folder
- send<M>(self: Bus<M>, message: M) — publishes `message` to all current subscribers; [exp]; callers: 0 outside folder
- sendRevertible<M>(self: Bus<M>, message: M) — publishes `message` with a `Revertible<M>` that marks it retracted on disposal; [exp]; callers: 0 outside folder
- subscribe<M>(self: Bus<M>, handler) — spawns `_follow` to run `handler` on each non-retracted message until bus/future disposal; [exp]; callers: 0 outside folder
- dispose<M>(self: Bus<M>) — makes `Bus<M>` disposable so subscribers can watch `WeakRef(self).disposed()`; [exp]; callers: 0 outside folder
- _publish<M>(bus, message) — appends a `_Link` to `bus->_end` and advances `_end` to a fresh slot; callers: 0 outside folder
- _follow<M>(start, bus, handler) — async loop reading slot links or exiting when `bus.disposed()` resolves; callers: 0 outside folder

## src/stdlib/futures/futures.ista — Concurrency combinators (`first`, `all`, `allSettled`, `race`, `any`, `quorum`, `timeout`, `retry`)
- First<T, K> — `Awaitable` struct racing `futures` at `positions` via `Resolver.at`; [exp]; callers: 0 outside folder
- first<T, K>(futures) — builds a `First<T, K>` over all positions of `futures`; [exp]; callers: 0 outside folder
- onAwait<T, K>(self: First<T, K>, done) — registers `Resolver.at(done, position)` on each future in `self.positions`; [exp]; callers: 0 outside folder
- all<T, E, K>(futures) — awaits all `Ok` values in position order or returns the first `Err` to arrive; [exp]; callers: 0 outside folder
- allSettled<T, K>(futures) — awaits every future and returns their values in position order; [exp]; callers: 0 outside folder
- race<T, K>(futures) — awaits `first(futures)` and returns the winning value; [exp]; callers: 0 outside folder
- any<T, E, K>(futures) — returns the first `Ok` value to arrive or `Err` of all errors in position order; [exp]; callers: 0 outside folder
- quorum<T, E, K>(n, futures) — returns the first `n` `Ok` values in arrival order or `Err` once `n` is unreachable; [exp]; callers: 0 outside folder
- timeout<T, K>(future, limit) — selects between `future` and `time.delay(limit)`, returning `T?`; [exp]; callers: 0 outside folder
- retry<T, E, K>(attempt, times, backoff) — retries `attempt` up to `times` times with exponential backoff; [exp]; callers: 0 outside folder

## src/stdlib/inbox/inbox.ista — `Inbox<T>` unbounded FIFO queue built on a `Slot<T>` and `Revertible<T>` message handle
- Inbox<T> — shared struct holding the receiver `Slot<T>`, queued put futures, and sent counter; [exp]; callers: 0 outside folder
- Revertible<T> — shared struct wrapping a `retract: ista fn() -> Unit` callback invoked on disposal; [exp]; callers: 3 outside folder
- Revertible.holding<T, R is Disposable>(resource: R) — wraps a disposable host resource in a `Revertible<T>`; [exp]; callers: 0 outside folder
- Inbox.create<T>() — creates a new empty `Inbox<T>`; [exp]; callers: 2 outside folder
- send<T>(self: Inbox<T>, message: T) — queues `message` into `self`; [exp]; callers: 2 outside folder
- sendRevertible<T>(self: Inbox<T>, message: T) — queues `message` and returns a `Revertible<T>` retracting it if unread; [exp]; callers: 2 outside folder
- receive<T>(self: Inbox<T>) — returns `self->slot.take()` future for the next message; [exp]; callers: 3 outside folder
- pending<T>(self: Inbox<T>) — drains and re-queues waiting messages in one step to return them without consuming; [exp]; callers: 1 outside folder
- dispose<T>(self: Inbox<T>) / dispose<T>(self: Revertible<T>) — disposers for `Inbox` and `Revertible`; [exp]; callers: 0 outside folder
- _queue<T>(self, message) — prunes received puts and appends `slot.put(message)` to `self->queued`; callers: 0 outside folder
- _forgetReceived<T>(self) — drops settled puts from `self->queued`, keeping the one still in the full slot; callers: 0 outside folder
- _retract<T>(inbox, number) — removes message `number` from `inbox` (and takes it from the slot if already moved in); callers: 0 outside folder
- _settles<T>(operation) — non-waiting `select` testing whether `operation` settles immediately; callers: 0 outside folder

## src/stdlib/ista-source.d.ts — Ambient TypeScript module declaration for importing `*.ista` files as string text
- '*.ista' — ambient module declaration exporting `source: string`; callers: 0 outside folder

## src/stdlib/json/json.ista — `Json` recursive union, `Encodable`/`Decodable` traits, field annotations, and codecs
- Json — recursive union `None | Bool | Int | Float | String | Array<Json> | Map<String, Json>`; [exp]; callers: 3 outside folder
- Encodable / Decodable — traits for types that convert to/from `Json` (`toJson`, `Self.fromJson`); [exp]; callers: 3 outside folder
- JsonName / JsonSkip / JsonBigInt — field annotations controlling derived JSON codecs; [exp]; callers: 0 outside folder
- encode<T>(value) / decode<T>(json) / stringify<T>(value) / parse<T>(text) — public JSON conversion and text entry points; [exp]; callers: 3 outside folder
- encodeText<T is Stringable>(value) / decodeText<T is Parsable>(json, path) — JSON codec helpers for text-serialized types; [exp]; callers: 3 outside folder
- _toJson<T> / _fromJson<T> — compiler-synthesized derived codec declarations; callers: 2 outside folder
- _hostResult<T>(read) / _hostInput<T>(read) — boundary acceptors panicking on bad host output or refusing bad host input; callers: 1 outside folder
- toJson / fromJson (Int, Float, Bool, String, Unit, None, Json, Never, Array, Optional, Map) — built-in type codecs; [exp]; callers: 0 outside folder
- _encodeBigInt / _decodeBigInt / _encodeHandle / _decodeHandle — helpers for `@JsonBigInt` and host handle codecs; callers: 3 outside folder
- _fields / _field / _optionalField / _tag / _unknownVariant / _notAmong — derived struct/enum/literal decoder helpers; callers: 1 outside folder
- _elements / _element / _fieldPath / _elementPath / _parsed / _mismatch / _failure / _error — tuple, path, and error helpers; callers: 1 outside folder
- _kind(json) — returns human-readable article + kind name for a `Json` value in mismatch errors; callers: 0 outside folder

## src/stdlib/json/natives.ts — Natives for JSON text serialization, host refusal, and host handle payloads
- hostPayloadOf(value, context) — extracts raw JSON payload from an extern value or heap resource handle; callers: 0 outside folder
- jsonNatives(keys) — builds the native table for `_write`, `_read`, `_refuse`, `_encodeHandle`, and `_decodeHandle`; [exp]; callers: 1 outside folder

## src/stdlib/lifetimes/lifetimes.ista — `@Holds` and `@Keeps` annotations declaring lifetime edges on std externs
- Holds<T> — annotation on an extern struct stating what values it holds; [exp]; callers: 1 outside folder
- Keeps — annotation on an extern function mapping receiver/target parameter names to kept parameter names; [exp]; callers: 1 outside folder

## src/stdlib/log/log.ista — Structured logging API (`Level`, `write`, `debug`, `info`, `warn`, `error`)
- Level — enum of log levels (`Debug`, `Info`, `Warn`, `Error`); [exp]; callers: 0 outside folder
- write(level, message, fields) — extern appending a structured log record to the current segment; [exp]; callers: 0 outside folder
- debug / info / warn / error — overloads logging a message with empty fields or an `Encodable` fields value; [exp]; callers: 0 outside folder

## src/stdlib/log/natives.ts — Native implementation of `log.write`
- logNatives(keys) — builds the native table for `log.write`, converting `Level` and `Json` fields for `context.logs.write`; [exp]; callers: 1 outside folder

## src/stdlib/math/math.ista — `Rounding` modes and numeric functions (`abs`, `round`, `floor`, `ceil`, `sqrt`, `min`, `max`, `clamp`)
- Rounding — enum of rounding modes (`Floor`, `Ceiling`, `TowardZero`, `AwayFromZero`, `HalfEven`, `HalfAwayFromZero`); [exp]; callers: 1 outside folder
- abs / round / floor / ceil / sqrt / min / max / clamp — numeric and `Comparable` functions; [exp]; callers: 0 outside folder

## src/stdlib/math/natives.ts — Natives for `math.abs`, `math.round`, and `math.sqrt`
- mathNatives(keys) — builds the native table for `math` externs; [exp]; callers: 1 outside folder

## src/stdlib/math/rounding.ts — `math.Rounding` variant names and IEEE 754 float rounding functions
- Rounding — string literal union of the 6 `math.Rounding` variant names; [exp]; callers: 1 outside folder
- roundingType(mathKeys) — returns the `KeyType` for `math.Rounding`; [exp]; callers: 1 outside folder
- floatRoundings — table mapping each `Rounding` variant name to its float rounding function; [exp]; callers: 0 outside folder

## src/stdlib/natives.ts — Combined `Natives` table across all std modules
- stdNatives — flat `Natives` map merging every std module's natives by extern key; [exp]; callers: 2 outside folder

## src/stdlib/numeric.ts — Four-overload `Int`/`Float` binary native generator and division-by-zero panic
- numeric(keys, name, onInts, onFloats) — builds the 4 `(Int|Float, Int|Float)` native entries for `name`; [exp]; callers: 1 outside folder
- asFloat(value) — reads a `bigint` or `number` `Value` as a JS `number`; [exp]; callers: 1 outside folder
- divisionByZero() — returns `new Panic('Division by zero.')`; [exp]; callers: 2 outside folder

## src/stdlib/positions.ts — Sequence index validation, negative-index resolution, clamping slices, and range selections
- checkedIndex(key, length, what) — returns `Number(key)` if `0 <= key < length`, else throws `Panic`; [exp]; callers: 3 outside folder
- atPosition(key, length) — resolves a possibly-negative index in `0..length`, or `undefined` if out of bounds; [exp]; callers: 2 outside folder
- sliceBounds(length, start, end) — clamps `start` and optional `end` (supporting negative offsets) to `0..length`; [exp]; callers: 1 outside folder
- sliced<T>(items, start, end) — slices `items` using `sliceBounds`; [exp]; callers: 1 outside folder
- Selection — discriminated union (`span` | `stepped`) of sequence positions selected by a `Range`; [exp]; callers: 0 outside folder
- selectionOf(range, length, what) — validates `range` against `length` and returns a `span` or `stepped` `Selection`; [exp]; callers: 2 outside folder
- selected<T>(items, selection) — extracts the elements of `items` designated by `selection`; [exp]; callers: 1 outside folder
- Splice<T> — `{ start, count, items }` descriptor for array range assignment; [exp]; callers: 0 outside folder
- splicesOf<T>(selection, replacement) — builds `Splice<T>[]` for `selection` and `replacement`, panicking on length mismatch; [exp]; callers: 1 outside folder

## src/stdlib/prelude/arrays.ts — Prelude natives for `Array<T>` reading, mutation, indexing, and array patterns
- arrayNatives(keys) — builds the prelude's `Array<T>` native table; [exp]; callers: 0 outside folder
- changingNatives(keys) — builds `&Array<T>` mutating natives (`push`, `pop`, `reverse`, `setIndex`); callers: 0 outside folder
- patternNatives(keys) — builds `_patternItem` and `_patternRest` natives for array destructuring patterns; callers: 0 outside folder

## src/stdlib/prelude/instance-natives.ts — Prelude natives for `spawn` and `Instance.result`
- instanceNatives(keys) — builds `spawn` and `Instance.result` natives over `context.instances`; [exp]; callers: 0 outside folder

## src/stdlib/prelude/maps.ts — Prelude natives for `Map<K, V>` reading, mutation, indexing, and iteration
- mapNatives(keys) — builds the prelude's `Map<K, V>` native table; [exp]; callers: 0 outside folder

## src/stdlib/prelude/natives.ts — Assembled prelude `Natives` table and primitive arithmetic/bitwise/comparison natives
- preludeNatives(keys) — merges all prelude sub-tables with primitive arithmetic, string concat/compare, `panic`, and `_trace`; [exp]; callers: 1 outside folder
- arithmeticNatives(keys) — builds `Int`/`Float` arithmetic, comparison, negation, and `from` conversion natives; callers: 0 outside folder
- bitwiseNatives(keys) — builds `Int` bitwise (`bitAnd`, `bitOr`, `bitXor`, `bitNot`, `shiftLeft`, `shiftRight`) natives; callers: 0 outside folder
- floorDivide(dividend, by) — computes floored `bigint` quotient rounding toward negative infinity; callers: 0 outside folder
- intPower(base, exponent) — computes `base ** exponent` for non-negative `bigint` exponent, panicking if negative; callers: 0 outside folder
- shiftCount(count) — reads a non-negative `bigint` shift count or panics; callers: 0 outside folder
- truncated(value) — truncates a finite `number` to `bigint` or panics on `NaN`/`Infinity`; callers: 0 outside folder

## src/stdlib/prelude/prelude.ista — The language prelude: core types, traits, collections, iterators, and primitive operators
- Array<T> / Map<K, V> / Slot<T> / WeakRef<T> / Future<T, K> / Resolver<T, K> — core collection and concurrency types; [exp]; callers: 20 outside folder
- Fn<Args, Result, Kind, Send> / Instance<T> / _Call / Shared<T> / _Cell<T> / Deferred<M> — function, instance, and cell types; [exp]; callers: 16 outside folder
- Mark / Persistence / Sendability / Optional<T> — core type aliases; [exp]; callers: 12 outside folder
- Awaitable<T> / Sendable / DataKind<K> / Disposable / Iterable / Container — concurrency, lifetime, and iteration traits; [exp]; callers: 18 outside folder
- Indexable / IndexAssignable / Convertible / Default / Comparable / Stringable / Parsable — access, conversion, and text traits; [exp]; callers: 14 outside folder
- Addable / Subtractable / Multipliable / Divisible / FloorDivisible / Negatable / Powerable / Bitwise / Shiftable — operator traits; [exp]; callers: 6 outside folder
- Result<T, E> / Step<T> / Error / Range / Waypoint — core enum and struct declarations; [exp]; callers: 15 outside folder
- defer / dispose / spawn / result / panic / _inclusiveEnd / _trace — core control, lifetime, and range helpers; [exp]; callers: 8 outside folder
- length / at / push / pop / slice / indexOf / lastIndexOf / includes / reverse / flat / join — sequence operations; [exp]; callers: 14 outside folder
- index / setIndex / Array.default / _patternItem / _patternRest — indexing, default, and array pattern helpers; [exp]; callers: 10 outside folder
- size / get / has / delete / keys / values / entries / Map.default / Map.groupBy / _mapValues — map operations; [exp]; callers: 10 outside folder
- map / filter / flatMap / find / findLast / findIndex / findLastIndex / some / every / reduce / sort — higher-order array methods; [exp]; callers: 12 outside folder
- iterate / _steps / _entryAt / _characterAt — collection and sequence cursor factories and step primitives; [exp]; callers: 4 outside folder
- _sorted<T, M>(items, order) / _merged<T, M>(left, right, order) — stable merge sort helpers for `Array.sort`; callers: 0 outside folder
- _cursor<T>(count, item) — builds a stateful `fn() -> Step<T>` closure over `0..count`; callers: 0 outside folder
- add / subtract / multiply / divide / floorDivide / remainder / power — arithmetic operators; [exp]; callers: 10 outside folder
- bitAnd / bitOr / bitXor / bitNot / shiftLeft / shiftRight / negate / compare — bitwise, unary, and ordering operators; [exp]; callers: 10 outside folder
- Float.from / Int.from / String.from / toString / Int.parse / Float.parse / Bool.parse / String.parse — primitive conversions; [exp]; callers: 10 outside folder

## src/stdlib/prelude/range-natives.ts — Prelude natives for `Range._steps` and `Range.includes`
- rangeNatives(keys) — builds `_steps` and `includes` natives for `Range`; [exp]; callers: 0 outside folder

## src/stdlib/prelude/slot-natives.ts — Prelude natives for `Slot.create`, `put`, `take`, and `read`
- slotNatives(keys) — builds `Slot` natives delegating to `context.slots`; [exp]; callers: 0 outside folder

## src/stdlib/prelude/strings.ts — Prelude natives for `String` length, indexing, range slicing, and iteration
- stringNatives(keys) — builds `length`, `at`, `includes`, `index`, and `_characterAt` natives for `String`; [exp]; callers: 0 outside folder

## src/stdlib/prelude/text-forms.ts — Primitive `toString` and `parse` natives for `Int`, `Float`, and `Bool`
- primitiveText(value) — formats a primitive `Value` as text, keeping `.0` on whole floats; [exp]; callers: 0 outside folder
- ParsedPrimitive — `'Int' | 'Float' | 'Bool'`; [exp]; callers: 0 outside folder
- readPrimitive(type, source) — parses `source` as `Int`, `Float`, or `Bool`, returning `undefined` if invalid; [exp]; callers: 0 outside folder
- textFormNatives(keys) — builds `toString` and `parse` natives for `Int`, `Float`, and `Bool`; [exp]; callers: 0 outside folder

## src/stdlib/prelude/wait-natives.ts — Prelude natives for `Future.onAwait` and `Resolver` operations
- waitNatives(keys) — builds `onAwait`, `resolve`, `tryResolve`, `Resolver.of`, `Resolver.at`, and `onCancel` natives; [exp]; callers: 0 outside folder

## src/stdlib/prelude/weak-natives.ts — Prelude natives for `WeakRef` and `_Call.disposing`
- weakNatives(keys) — builds `WeakRef.from`, `deref`, `disposed`, and `disposing` natives over `context.weak`; [exp]; callers: 0 outside folder

## src/stdlib/random/natives.ts — Deterministic PRNG natives for `random.integer` and `random.uuid`
- randomNatives(keys) — builds `integer(Range)` and `uuid()` natives drawing from `context.random.draw`; [exp]; callers: 1 outside folder
- uniformBelow(bound, draw) — rejection-samples a uniform `bigint` in `0..bound` from 32-byte draws; [exp]; callers: 0 outside folder
- drawn(count, draw) — fills a `Uint8Array(count)` from as many 32-byte `draw()` calls as needed; callers: 0 outside folder
- uuidOf(draw) — formats 16 drawn bytes as a lowercase RFC 9562 v4 UUID; callers: 0 outside folder

## src/stdlib/random/random.ista — Deterministic random integer, UUID, and float generation
- integer(range: Range) — extern drawing a uniform integer from a bounded non-empty `Range`; [exp]; callers: 0 outside folder
- uuid() — extern drawing a lowercase version 4 UUID; [exp]; callers: 0 outside folder
- fraction() — draws a uniform `Float` in `[0, 1)` with 53-bit precision over `integer(0..2^53)`; [exp]; callers: 0 outside folder

## src/stdlib/ranges.ts — Reading, bounding, counting, membership-testing, and formatting prelude `Range` values
- RangeValue — `{ start: bigint | undefined, end: bigint | undefined, step: bigint }`; [exp]; callers: 0 outside folder
- rangeOf(context, range) — reads `start`, `end`, and non-zero `step` from a `Range` struct `Value`; [exp]; callers: 4 outside folder
- BoundedRange — `{ start: bigint, end: bigint, step: bigint }`; [exp]; callers: 0 outside folder
- bounded(range, doing) — requires both `start` and `end` on `range` or throws `Panic`; [exp]; callers: 2 outside folder
- countOf({start, end, step}) — computes the number of steps `start, start + step, …` before `end`; [exp]; callers: 2 outside folder
- reaches(range, value) — tests whether `range` reaches `value`, panicking on an open start with `|step| != 1`; [exp]; callers: 1 outside folder
- textOf({start, end, step}) — formats a `RangeValue` as `a..b` or `a..b by s`; [exp]; callers: 1 outside folder

## src/stdlib/regex/natives.ts — RE2 regular expression natives over `re2js` with LRU-cached compiled patterns
- regexNatives(keys) — builds `Regex.parse`, `test`, `find`, `findAll`, `replace`, `replaceAll`, `split`, and `escape` natives; [exp]; callers: 1 outside folder
- compile(pattern) — compiles `pattern` with `RE2JS.compile` (memoized in a 256-entry `LRUCache`), returning `RE2JS` or error string; callers: 0 outside folder
- programOf(context, regex) — reads `regex.pattern` and returns its compiled `RE2JS` program or throws `Panic`; callers: 0 outside folder
- matchBuilder(types, match, whole) — builds a function converting each `RegExpMatchArray` to a `regex.Match` struct with code-point index; callers: 0 outside folder

## src/stdlib/regex/regex.ista — `Regex` and `Match` structs, JSON codecs, and RE2 matching/replacement declarations
- Regex — struct holding `pattern: String`; [exp]; callers: 0 outside folder
- Match — struct holding `text`, code-point `index`, positional `captures`, and `named` capture map; [exp]; callers: 0 outside folder
- Regex.parse / toString / toJson / Regex.fromJson / test / find / findAll / replace / replaceAll / split / escape — regex operations; [exp]; callers: 0 outside folder

## src/stdlib/regex/split.ts — JavaScript-compatible `regex.split` over `RE2JS` without capture groups
- split(program, s) — splits `s` around matches of `program` keeping trailing empty strings; [exp]; callers: 0 outside folder

## src/stdlib/rpc/rpc.ista — Intra-instance typed RPC `Method<P, R>` over an `Inbox` with automatic `unanswered` disposal replies
- Method<P, R> — shared struct wrapping an `Inbox<_Call<P, R>>`; [exp]; callers: 0 outside folder
- create<P, R>() — creates a new `Method<P, R>`; [exp]; callers: 0 outside folder
- call<P, R>(self: Method<P, R>, message: P) — sends `message` revertibly with a reply slot and awaits the `Result<R>`; [exp]; callers: 0 outside folder
- onMessage<P, R>(self: Method<P, R>, handler) — async server loop receiving calls and filling their reply slots; [exp]; callers: 0 outside folder
- dispose<R>(self: _Reply<R>) — sends `Err(Error{code: "unanswered", ...})` into the reply slot if dropped unanswered; [exp]; callers: 0 outside folder

## src/stdlib/runtime/natives.ts — Natives for instance metadata, `commit`, `isolate`, contexts, and job serving
- runtimeNatives(keys) — builds `runtime` module natives (`id`, `version`, `commit`, `_isolated`, `_raise`, contexts, jobs); [exp]; callers: 1 outside folder
- contextCall(maker) — builds the native for `_call` (`'program'`) or `_jobCall` (`'jobs'`); callers: 0 outside folder

## src/stdlib/runtime/runtime.ista — Instance metadata, `commit`, `isolate`, live `Runtime` contexts, and `delegate` job server
- id() / version() / commit() / isolate<T>(f) — instance identity, commit point, and isolated child instance execution; [exp]; callers: 0 outside folder
- Store / hostStore() / Runtime / Runtime.open(store) / Call<R> / call(self: Runtime, key, f) / run(key, f) — live context management; [exp]; callers: 0 outside folder
- delegate<R>(job) — queues a live `job` in context constant `_jobs` to run after commit and awaits its JSON-decoded result; [exp]; callers: 1 outside folder
- _decoded<R>(number, result) — awaits job `number`'s reply slot at `@Waypoint{"job"}` with `defer _release(number)`; callers: 0 outside folder
- _takeOver() — rings out any previous job server loop, re-queues taken unanswered jobs, and increments server number; callers: 0 outside folder
- _nextWork(server) — awaits the next `_Work` from `_jobs->queue` or exits if `takenOver` resolves; callers: 0 outside folder
- _release(number) / _reply(number, result) — removes job `number` from `unanswered`/`taken` and delivers its result; callers: 0 outside folder
- _serve(host) / _serveInstance(host, key) / _runJob(host, key, job) — live job server loops invoked when `Runtime.open` runs; callers: 1 outside folder

## src/stdlib/std-module.ts — `StdModule` record and module-scoped `NativeKeys` builder
- StdModule — `{ name, source, natives }` record for a shipped std module; [exp]; callers: 0 outside folder
- NativeKeys — module-bound key builders (`type`, `of`, `ofStatic`); [exp]; callers: 23 outside folder
- stdModule(name, source, nativesOf) — builds a `StdModule` with keys bound to `name`; [exp]; callers: 0 outside folder
- nativeKeysOf(module) — creates `NativeKeys` qualifying types and functions with `module`; [exp]; callers: 0 outside folder
- knownTypeKey(declaration, ...typeArguments) — builds a `KeyType` for a `WellKnownDeclaration`; [exp]; callers: 15 outside folder
- futureKey(value, kind) — builds the `KeyType` for `prelude.Future<value, kind>`; [exp]; callers: 3 outside folder

## src/stdlib/std-modules.ts — Attaching each std module's `Natives` factory to its source
- stdModules — array of all `StdModule` records pairing `stdModuleSources` with `nativesOf`; [exp]; callers: 0 outside folder

## src/stdlib/std-sources.ts — Single registry of shipped std module names and embedded `.ista` source texts
- stdModuleSources — record mapping every std module name to its embedded `.ista` source string; [exp]; callers: 0 outside folder
- StdModuleName — union of all shipped std module names (`keyof typeof stdModuleSources`); [exp]; callers: 0 outside folder

## src/stdlib/stdlib-loader.ts — Compiler `ModuleLoader` and language-role map for std modules (free of runtime native imports)
- StdSources — `Readonly<Record<string, string>>` of std module sources by name; [exp]; callers: 1 outside folder
- preludeModule() — returns the `LocatedModule` for the shipped prelude; [exp]; callers: 0 outside folder
- stdRoles(sources) — returns the `Record<LanguageModule, LocatedModule>` for `prelude`, `time`, `json`, `lifetimes`, `testing`; [exp]; callers: 1 outside folder
- stdlibLoader(sources) — returns a `ModuleLoader` resolving importable std module names to `std:<name>` modules; [exp]; callers: 1 outside folder
- importableStdModules — list of shipped std module names excluding `prelude`, for completion; [exp]; callers: 1 outside folder
- stdSourceOf(id) — returns the shipped `.ista` source for a `std:<name>` `ModuleId`, or `undefined`; [exp]; callers: 1 outside folder

## src/stdlib/strings/format.ts — Template placeholder formatter backing `strings.format`
- formatted(template, values) — replaces `{}`, `{n}`, `{{`, and `}}` in `template` with `values`, panicking on bad braces; [exp]; callers: 0 outside folder

## src/stdlib/strings/natives.ts — Code-point-aware string manipulation natives for the `strings` module
- stringsNatives(keys) — builds the native table for `strings` externs; [exp]; callers: 1 outside folder
- reading(keys) — builds `indexOf`, `lastIndexOf`, `startsWith`, `endsWith`, and `utf16Length` natives; callers: 0 outside folder
- splitting(keys) — builds `slice`, `split`, `trim`, `trimStart`, `trimEnd`, and `graphemes` natives; callers: 0 outside folder
- building(keys) — builds `padStart`, `padEnd`, `repeat`, `replace`, `replaceAll`, `toUpperCase`, `toLowerCase`, and `format` natives; callers: 0 outside folder
- repeated(s, count) — repeats `s` `count` times or panics when `count < 0`; callers: 0 outside folder
- replacedAll(s, search, replacement) — replaces all occurrences of `search` in `s` without splitting surrogate pairs; callers: 0 outside folder
- padding(s, length, fill) — computes the code-point prefix/suffix of `fill` needed to reach `length` code points; callers: 0 outside folder

## src/stdlib/strings/strings.ista — Code-point-indexed string searching, slicing, padding, case mapping, formatting, and grapheme segmentation
- indexOf / lastIndexOf / startsWith / endsWith / slice / split / trim / trimStart / trimEnd — string searching and cutting; [exp]; callers: 0 outside folder
- padStart / padEnd / repeat / replace / replaceAll / toUpperCase / toLowerCase / format / graphemes / utf16Length — string building; [exp]; callers: 0 outside folder

## src/stdlib/testing/natives.ts — Natives for test mocks, spawned instance inspection/watches, and unique host handles
- testingNatives(keys) — builds `_mock`, `_calls`, `spawnCrashingEveryAwait`, `idle`, `reaches`, `waitingAt`, `state`, `handle`; [exp]; callers: 1 outside folder
- namedFunction(target) — extracts the `FunctionId` from a zero-capture closure `Value` or panics; callers: 0 outside folder

## src/stdlib/testing/testing.ista — Test suite declarations, runner entry points, mocks, assertions, `FakeClock`, `FakeQueue`, and `FakeReceipts`
- Suite / Test / Listed / InstanceState / Mock<F> / Setup<E> — test model types and annotations; [exp]; callers: 2 outside folder
- _list(suite, title) / _run(suite, title, position, expected) — test runner entry points flattening and executing suite cases; callers: 2 outside folder
- _entries(title, tests, skipping, focusing) — recursively flattens `Case` and `Group` trees with inherited `skip`/`only` flags; callers: 0 outside folder
- mock / calls / spawnCrashingEveryAwait / idle / reaches / waitingAt / state / handle — mocking, instance control, and host handle APIs; [exp]; callers: 1 outside folder
- test / group / skip / only / _marked / setups / _joined — suite construction and environment composition helpers; [exp]; callers: 0 outside folder
- assert / assertEq / expectPanic — test assertion helpers; [exp]; callers: 0 outside folder
- FakeClock / advance / withClock / _waitUntil / _deadlineAt / _passDue / _splitDue — deterministic fake clock for `time`; [exp]; callers: 0 outside folder
- FakeQueue / pending / post / sendRevertible / _queueOf / _inboxOf — deterministic fake host queues backed by `Inbox`; [exp]; callers: 0 outside folder
- FakeReceipts / revertibleSender / _disposeReceipt — deterministic fake receipts for revertible host sends; [exp]; callers: 0 outside folder

## src/stdlib/time/fields.ts — Reading and building `time.Time` and `time.Duration` struct `Value`s by field name
- millisecondsOf(context, value) — reads the `bigint` `value` field of a `Time` or `Duration` struct; [exp]; callers: 0 outside folder
- resultMilliseconds(context, milliseconds) — builds a `Time` or `Duration` struct of the native's declared result type; [exp]; callers: 0 outside folder
- okMilliseconds(context, milliseconds) — builds a `Time` or `Duration` struct of the native's declared `Ok` type; [exp]; callers: 0 outside folder

## src/stdlib/time/iso.ts — ISO 8601 formatting and parsing for `Time` instants and `Duration`s
- timeText(time) — formats epoch milliseconds as UTC ISO 8601 text via `Date.toISOString`, or `undefined` if out of range; [exp]; callers: 1 outside folder
- readTime(text) — parses an ISO 8601 instant with `Z` or UTC offset into epoch milliseconds, or `undefined`; [exp]; callers: 0 outside folder
- durationText(duration) — formats milliseconds as an ISO 8601 `PT…H…M…S` string; [exp]; callers: 0 outside folder
- readDuration(text) — parses an ISO 8601 duration (`P…DT…H…M…S`) into milliseconds, or `undefined`; [exp]; callers: 0 outside folder
- zoneOffset(parts) — computes the UTC offset in milliseconds from regex match groups, or `undefined` if `>= 24:00`; callers: 0 outside folder

## src/stdlib/time/natives.ts — Natives for `time.now`, `time.at`, and ISO 8601 `Time`/`Duration` text conversion
- timeNatives(keys) — builds `now`, `at`, `toString`, and `parse` natives for `Time` and `Duration` plus `zoneNatives`; [exp]; callers: 1 outside folder
- parsedStruct(what, read) — builds a `parse` native wrapping `read(source)` milliseconds in `okMilliseconds` and `parseResult`; callers: 0 outside folder

## src/stdlib/time/time.ista — `Time`, `Duration`, `Zone`, and `DateTime` types, operators, JSON codecs, and clock/zone declarations
- Duration / Time / Zone / DateTime — time, duration, IANA zone, and wall-clock date-time types; [exp]; callers: 2 outside folder
- now() / at<K>(time) / delay<K>(duration) — clock read and timer futures; [exp]; callers: 2 outside folder
- add / multiply / compare / toString / parse / toJson / fromJson — arithmetic, ordering, text, and JSON codecs; [exp]; callers: 0 outside folder
- utc() / weekday / addDays / inZone / Time.of / format — time-zone and calendar operations; [exp]; callers: 0 outside folder

## src/stdlib/time/zones.ts — IANA time-zone and `DateTime` natives backed by `temporal-polyfill`
- eachField<T>(read) — maps `read` over the 7 `DateTime` field names into a record; callers: 0 outside folder
- zoneNatives(keys) — builds `utc`, `Zone.parse`, `DateTime.parse`, `toString`, `weekday`, `addDays`, `inZone`, `Time.of`, `format`; [exp]; callers: 0 outside folder
- canonicalZone(id) — resolves an IANA zone name (rejecting fixed UTC offsets) to its canonical id via `Temporal`; callers: 0 outside folder
- readPlain(source) — parses a `Temporal.PlainDateTime` with no sub-millisecond fraction; callers: 0 outside folder
- zoneIdOf(zone) — extracts and validates the canonical IANA id of a `Zone` value or throws `Panic`; callers: 0 outside folder
- zonedOf(context, time, zone) — converts a `Time` and `Zone` to a `Temporal.ZonedDateTime` or panics if out of range; callers: 0 outside folder
- plainOf(context, dateTime) — converts a `DateTime` struct value to `Temporal.PlainDateTime` or panics if invalid; callers: 0 outside folder
- writtenFields(fields) — zero-pads `DateTime` fields as `YYYY-MM-DDTHH:mm:ss.SSS` for panic messages; callers: 0 outside folder
- withinRange<T>(what, read) — runs `read()`, converting a `Temporal` `RangeError` into a `Panic`; callers: 0 outside folder
- unlessRefused<T>(read) — runs `read()`, returning `undefined` on `RangeError`; callers: 0 outside folder

## src/stdlib/values/arguments.ts — Reading typed arguments passed to stdlib natives
- argumentOf<Name>(name) — builds a primitive argument reader checking `typeof value === name`; callers: 0 outside folder
- given(value) — returns `value` or calls `unreachable` if `undefined`; [exp]; callers: 9 outside folder
- int / float / text — primitive argument readers for `bigint`, `number`, and `string`; [exp]; callers: 14 outside folder
- externPayloadOf(value) — extracts `value.payload` from an `'extern'` composite `Value`; [exp]; callers: 1 outside folder
- textPayloadOf(value) — extracts a `string` payload from an `'extern'` composite `Value`; [exp]; callers: 2 outside folder
- arrayOf(elements) — builds an `{ kind: 'array', elements }` `Value`; [exp]; callers: 5 outside folder
- variantName(context, value) — returns the declared variant name of an enum `Value`; callers: 0 outside folder
- optionalInt(context, value) — reads a `bigint` from an optional `Int?` `Value`, or `undefined` for `None`; [exp]; callers: 3 outside folder
- variantEntry<Entry>(context, value, table) — looks up `value`'s declared variant name in `table`; [exp]; callers: 4 outside folder

## src/stdlib/values/results.ts — Building typed return `Value`s from `NativeContext.resultType`
- declaredResult(context) — returns `context.resultType` or calls `unreachable`; [exp]; callers: 3 outside folder
- resultStruct(context, fields) — builds a struct `Value` of `declaredResult(context)` by field names; [exp]; callers: 2 outside folder
- resultExtern(context, payload) — builds an extern `Value` of `declaredResult(context)` holding `payload`; [exp]; callers: 2 outside folder
- resultOptional(context, value) — builds an optional `Value` of `context.resultType` (or `null` when `resultType` is `None`); [exp]; callers: 6 outside folder
- resultOk(context, value) — builds `Ok(value)` of the native's declared `Result` type; [exp]; callers: 3 outside folder
- okStruct(context, fields) — builds a struct `Value` of the `Ok` payload type of `declaredResult(context)`; [exp]; callers: 3 outside folder
- okExtern(context, payload) — builds an extern `Value` of the `Ok` payload type of `declaredResult(context)`; [exp]; callers: 2 outside folder
- resultErr(context, error) — builds `Err(error)` of the native's declared `Result` type; [exp]; callers: 1 outside folder
- resultError(context, message, code) — builds `Err(Error{message, code, trace: context.trace()})`; [exp]; callers: 1 outside folder
- resultTypeArgument(context, position) — returns type argument `position` of `declaredResult(context)`; [exp]; callers: 3 outside folder
- parseFailure(context, message) — builds `resultError(context, message, 'parse')`; [exp]; callers: 1 outside folder
- parseResult(context, source, what, read) — returns `resultOk(context, read)` or `parseFailure` when `read === undefined`; [exp]; callers: 4 outside folder
- resultVariant(context, name, fields) — builds variant `name` of `declaredResult(context)`; [exp]; callers: 1 outside folder

## Concept footprint
- Optional/None: stdlib/collections/collections.ista:get, stdlib/futures/futures.ista:timeout, stdlib/json/json.ista:toJson, stdlib/json/json.ista:Optional.fromJson, stdlib/json/json.ista:_optionalField, stdlib/prelude/arrays.ts:arrayNatives, stdlib/prelude/arrays.ts:changingNatives, stdlib/prelude/maps.ts:mapNatives, stdlib/prelude/prelude.ista:Optional, stdlib/prelude/prelude.ista:Optional.default, stdlib/prelude/prelude.ista:deref, stdlib/prelude/prelude.ista:at, stdlib/prelude/prelude.ista:pop, stdlib/prelude/prelude.ista:get, stdlib/prelude/prelude.ista:find, stdlib/prelude/prelude.ista:findLast, stdlib/prelude/prelude.ista:_itemAt, stdlib/prelude/prelude.ista:_characterAt, stdlib/prelude/strings.ts:stringNatives, stdlib/prelude/weak-natives.ts:weakNatives, stdlib/ranges.ts:rangeOf, stdlib/regex/natives.ts:regexNatives, stdlib/regex/natives.ts:matchBuilder, stdlib/runtime/natives.ts:runtimeNatives, stdlib/runtime/runtime.ista:_jobServer, stdlib/runtime/runtime.ista:_nextWork, stdlib/strings/natives.ts:splitting, stdlib/values/arguments.ts:optionalInt, stdlib/values/results.ts:resultOptional
- Result: stdlib/crypto/crypto.ista:decode, stdlib/crypto/natives.ts:cryptoNatives, stdlib/decimal/decimal.ista:Decimal.parse, stdlib/decimal/decimal.ista:Decimal.fromJson, stdlib/decimal/natives.ts:decimalNatives, stdlib/futures/futures.ista:all, stdlib/futures/futures.ista:any, stdlib/futures/futures.ista:quorum, stdlib/futures/futures.ista:retry, stdlib/json/json.ista:Decodable, stdlib/json/json.ista:decode, stdlib/json/json.ista:parse, stdlib/json/json.ista:decodeText, stdlib/json/json.ista:_fromJson, stdlib/json/json.ista:_hostResult, stdlib/json/json.ista:_hostInput, stdlib/json/json.ista:_read, stdlib/json/json.ista:Int.fromJson, stdlib/json/json.ista:Float.fromJson, stdlib/json/json.ista:Bool.fromJson, stdlib/json/json.ista:String.fromJson, stdlib/json/json.ista:Unit.fromJson, stdlib/json/json.ista:Json.fromJson, stdlib/json/json.ista:Array.fromJson, stdlib/json/json.ista:Optional.fromJson, stdlib/json/json.ista:Map.fromJson, stdlib/json/json.ista:_decodeBigInt, stdlib/json/json.ista:_decodeHandle, stdlib/json/json.ista:_fields, stdlib/json/json.ista:_field, stdlib/json/json.ista:_tag, stdlib/json/json.ista:_unknownVariant, stdlib/json/json.ista:_notAmong, stdlib/json/json.ista:_elements, stdlib/json/json.ista:_parsed, stdlib/json/json.ista:_mismatch, stdlib/json/json.ista:_failure, stdlib/json/natives.ts:jsonNatives, stdlib/prelude/instance-natives.ts:instanceNatives, stdlib/prelude/prelude.ista:Result, stdlib/prelude/prelude.ista:Error, stdlib/prelude/prelude.ista:_trace, stdlib/prelude/prelude.ista:result, stdlib/prelude/prelude.ista:Int.parse, stdlib/prelude/prelude.ista:Float.parse, stdlib/prelude/prelude.ista:Bool.parse, stdlib/prelude/prelude.ista:String.parse, stdlib/prelude/text-forms.ts:textFormNatives, stdlib/regex/natives.ts:regexNatives, stdlib/regex/regex.ista:Regex.parse, stdlib/regex/regex.ista:Regex.fromJson, stdlib/rpc/rpc.ista:call, stdlib/rpc/rpc.ista:dispose, stdlib/rpc/rpc.ista:_replyTo, stdlib/runtime/natives.ts:runtimeNatives, stdlib/runtime/runtime.ista:isolate, stdlib/runtime/runtime.ista:Call, stdlib/runtime/runtime.ista:_call, stdlib/runtime/runtime.ista:_jobCall, stdlib/runtime/runtime.ista:run, stdlib/runtime/runtime.ista:_raise, stdlib/runtime/runtime.ista:_decoded, stdlib/testing/testing.ista:expectPanic, stdlib/testing/testing.ista:_panicOf, stdlib/time/fields.ts:okMilliseconds, stdlib/time/natives.ts:timeNatives, stdlib/time/natives.ts:parsedStruct, stdlib/time/time.ista:Time.parse, stdlib/time/time.ista:Duration.parse, stdlib/time/time.ista:Zone.parse, stdlib/time/time.ista:DateTime.parse, stdlib/time/zones.ts:zoneNatives, stdlib/values/results.ts:resultOk, stdlib/values/results.ts:okStruct, stdlib/values/results.ts:okExtern, stdlib/values/results.ts:resultErr, stdlib/values/results.ts:resultError, stdlib/values/results.ts:parseFailure, stdlib/values/results.ts:parseResult
- unions: stdlib/json/json.ista:Json, stdlib/json/json.ista:_notAmong, stdlib/json/json.ista:_kind, stdlib/math/rounding.ts:Rounding, stdlib/prelude/prelude.ista:Mark, stdlib/prelude/prelude.ista:Persistence, stdlib/prelude/prelude.ista:Sendability, stdlib/prelude/prelude.ista:Optional, stdlib/values/results.ts:resultOptional
- enums/variants: stdlib/crypto/crypto.ista:Hash, stdlib/crypto/crypto.ista:Encoding, stdlib/crypto/natives.ts:cryptoNatives, stdlib/decimal/arithmetic.ts:decimalRoundings, stdlib/decimal/natives.ts:modeOf, stdlib/json/json.ista:_tag, stdlib/json/json.ista:_unknownVariant, stdlib/log/log.ista:Level, stdlib/log/natives.ts:logNatives, stdlib/math/math.ista:Rounding, stdlib/math/natives.ts:mathNatives, stdlib/math/rounding.ts:floatRoundings, stdlib/prelude/prelude.ista:Result, stdlib/prelude/prelude.ista:Step, stdlib/runtime/runtime.ista:_Work, stdlib/testing/natives.ts:stateVariants, stdlib/testing/natives.ts:testingNatives, stdlib/testing/testing.ista:Test, stdlib/testing/testing.ista:InstanceState, stdlib/testing/testing.ista:_entries, stdlib/testing/testing.ista:_marked, stdlib/values/arguments.ts:variantName, stdlib/values/arguments.ts:variantEntry, stdlib/values/results.ts:resultVariant
- futures/await/select: cli/clock.ts:clock, cli/commands/run.ts:untilIdle, cli/commands/run.ts:waitsOf, runtime/natives.ts:NativeFutures, runtime/natives.ts:NativeWaits, runtime/natives.ts:NativeResolver, runtime/natives.ts:Resolvable, runtime/natives.ts:NativeSlots, runtime/scheduler/segment/native-calls.ts:nativeFuturesOf, runtime/scheduler/segment/native-calls.ts:nativeWaitsOf, runtime/scheduler/segment/native-calls.ts:nativeSlotsOf, stdlib/collections/collections.ista:_deleteOnDisposal, stdlib/fanout/fanout.ista:Bus, stdlib/fanout/fanout.ista:subscribe, stdlib/fanout/fanout.ista:_publish, stdlib/fanout/fanout.ista:_follow, stdlib/futures/futures.ista:First, stdlib/futures/futures.ista:first, stdlib/futures/futures.ista:onAwait, stdlib/futures/futures.ista:all, stdlib/futures/futures.ista:allSettled, stdlib/futures/futures.ista:race, stdlib/futures/futures.ista:any, stdlib/futures/futures.ista:quorum, stdlib/futures/futures.ista:timeout, stdlib/futures/futures.ista:retry, stdlib/futures/futures.ista:_arrivals, stdlib/futures/futures.ista:_arrival, stdlib/inbox/inbox.ista:Inbox, stdlib/inbox/inbox.ista:receive, stdlib/inbox/inbox.ista:pending, stdlib/inbox/inbox.ista:_queue, stdlib/inbox/inbox.ista:_forgetReceived, stdlib/inbox/inbox.ista:_retract, stdlib/inbox/inbox.ista:_settles, stdlib/prelude/instance-natives.ts:instanceNatives, stdlib/prelude/prelude.ista:Slot, stdlib/prelude/prelude.ista:Future, stdlib/prelude/prelude.ista:Awaitable, stdlib/prelude/prelude.ista:onAwait, stdlib/prelude/prelude.ista:Resolver, stdlib/prelude/prelude.ista:resolve, stdlib/prelude/prelude.ista:tryResolve, stdlib/prelude/prelude.ista:Resolver.of, stdlib/prelude/prelude.ista:Resolver.at, stdlib/prelude/prelude.ista:onCancel, stdlib/prelude/prelude.ista:Slot.create, stdlib/prelude/prelude.ista:put, stdlib/prelude/prelude.ista:take, stdlib/prelude/prelude.ista:read, stdlib/prelude/prelude.ista:disposed, stdlib/prelude/prelude.ista:disposing, stdlib/prelude/prelude.ista:Waypoint, stdlib/prelude/slot-natives.ts:slotNatives, stdlib/prelude/wait-natives.ts:waitNatives, stdlib/prelude/weak-natives.ts:weakNatives, stdlib/rpc/rpc.ista:call, stdlib/rpc/rpc.ista:onMessage, stdlib/rpc/rpc.ista:_replyTo, stdlib/runtime/natives.ts:runtimeNatives, stdlib/runtime/runtime.ista:commit, stdlib/runtime/runtime.ista:Call, stdlib/runtime/runtime.ista:onAwait, stdlib/runtime/runtime.ista:delegate, stdlib/runtime/runtime.ista:_decoded, stdlib/runtime/runtime.ista:_nextWork, stdlib/std-module.ts:futureKey, stdlib/testing/natives.ts:testingNatives, stdlib/testing/testing.ista:idle, stdlib/testing/testing.ista:reaches, stdlib/testing/testing.ista:waitingAt, stdlib/testing/testing.ista:FakeClock, stdlib/testing/testing.ista:_waitUntil, stdlib/testing/testing.ista:_passDue, stdlib/time/natives.ts:timeNatives, stdlib/time/time.ista:at, stdlib/time/time.ista:delay
- marks/kinds (live/ista/simple): cli/commands/run.ts:start, runtime/natives.ts:NativeFutures, runtime/natives.ts:NativeInstances, runtime/natives.ts:NativeContexts, runtime/scheduler/segment/native-calls.ts:nativeFuturesOf, runtime/scheduler/segment/native-calls.ts:nativeInstancesOf, stdlib/collections/collections.ista:WeakMap, stdlib/fanout/fanout.ista:Bus, stdlib/futures/futures.ista:First, stdlib/futures/futures.ista:first, stdlib/futures/futures.ista:all, stdlib/futures/futures.ista:allSettled, stdlib/futures/futures.ista:race, stdlib/futures/futures.ista:any, stdlib/futures/futures.ista:quorum, stdlib/futures/futures.ista:timeout, stdlib/futures/futures.ista:retry, stdlib/inbox/inbox.ista:Inbox, stdlib/inbox/inbox.ista:Revertible, stdlib/prelude/prelude.ista:Mark, stdlib/prelude/prelude.ista:Persistence, stdlib/prelude/prelude.ista:Future, stdlib/prelude/prelude.ista:Awaitable, stdlib/prelude/prelude.ista:Resolver, stdlib/prelude/prelude.ista:Fn, stdlib/prelude/prelude.ista:Deferred, stdlib/prelude/prelude.ista:defer, stdlib/prelude/prelude.ista:DataKind, stdlib/prelude/prelude.ista:map, stdlib/prelude/prelude.ista:filter, stdlib/prelude/prelude.ista:flatMap, stdlib/prelude/prelude.ista:find, stdlib/prelude/prelude.ista:findLast, stdlib/prelude/prelude.ista:findIndex, stdlib/prelude/prelude.ista:findLastIndex, stdlib/prelude/prelude.ista:some, stdlib/prelude/prelude.ista:every, stdlib/prelude/prelude.ista:reduce, stdlib/prelude/prelude.ista:sort, stdlib/prelude/prelude.ista:Map.groupBy, stdlib/prelude/prelude.ista:_mapValues, stdlib/rpc/rpc.ista:Method, stdlib/runtime/natives.ts:runtimeNatives, stdlib/runtime/runtime.ista:Store, stdlib/runtime/runtime.ista:Runtime, stdlib/runtime/runtime.ista:Call, stdlib/runtime/runtime.ista:call, stdlib/runtime/runtime.ista:run, stdlib/runtime/runtime.ista:delegate, stdlib/runtime/runtime.ista:_serve, stdlib/std-module.ts:futureKey, stdlib/testing/testing.ista:mock, stdlib/testing/testing.ista:calls, stdlib/testing/testing.ista:FakeClock, stdlib/testing/testing.ista:FakeQueue, stdlib/testing/testing.ista:FakeReceipts, stdlib/time/time.ista:at, stdlib/time/time.ista:delay
- sendable: stdlib/json/json.ista:Encodable, stdlib/json/json.ista:Decodable, stdlib/prelude/prelude.ista:Sendability, stdlib/prelude/prelude.ista:Fn, stdlib/prelude/prelude.ista:Instance, stdlib/prelude/prelude.ista:result, stdlib/prelude/prelude.ista:spawn, stdlib/prelude/prelude.ista:Sendable, stdlib/runtime/runtime.ista:isolate, stdlib/runtime/runtime.ista:_isolated, stdlib/runtime/runtime.ista:call, stdlib/runtime/runtime.ista:_call, stdlib/runtime/runtime.ista:_jobCall, stdlib/runtime/runtime.ista:run, stdlib/runtime/runtime.ista:delegate, stdlib/runtime/runtime.ista:_Job, stdlib/testing/testing.ista:spawnCrashingEveryAwait, stdlib/testing/testing.ista:expectPanic, stdlib/testing/testing.ista:_panicOf
- shared structs: stdlib/collections/collections.ista:WeakMap, stdlib/collections/collections.ista:_Store, stdlib/fanout/fanout.ista:Bus, stdlib/fanout/fanout.ista:sendRevertible, stdlib/fanout/fanout.ista:_publish, stdlib/inbox/inbox.ista:Inbox, stdlib/inbox/inbox.ista:Revertible, stdlib/inbox/inbox.ista:Revertible.holding, stdlib/prelude/prelude.ista:Slot, stdlib/prelude/prelude.ista:WeakRef, stdlib/prelude/prelude.ista:Future, stdlib/prelude/prelude.ista:Resolver, stdlib/prelude/prelude.ista:_Call, stdlib/prelude/prelude.ista:Shared, stdlib/prelude/prelude.ista:_Cell, stdlib/prelude/prelude.ista:Deferred, stdlib/rpc/rpc.ista:Method, stdlib/rpc/rpc.ista:_Reply, stdlib/runtime/runtime.ista:Runtime, stdlib/runtime/runtime.ista:_Jobs, stdlib/testing/testing.ista:Mock, stdlib/testing/testing.ista:FakeClock, stdlib/testing/testing.ista:_Clock, stdlib/testing/testing.ista:_Opened, stdlib/testing/testing.ista:_Inboxes, stdlib/testing/testing.ista:_Receipts, stdlib/testing/testing.ista:revertibleSender
- extern types: cli/directory-store.ts:directoryStore, cli/host-module.ts:loadHostModule, runtime/natives.ts:NativeResources, runtime/natives.ts:NativeTesting, runtime/scheduler/segment/native-calls.ts:nativeResourcesOf, runtime/scheduler/segment/native-calls.ts:nativeTestingOf, stdlib/decimal/decimal.ista:Decimal, stdlib/decimal/natives.ts:decimalNatives, stdlib/json/json.ista:_encodeHandle, stdlib/json/json.ista:_decodeHandle, stdlib/json/natives.ts:hostPayloadOf, stdlib/json/natives.ts:jsonNatives, stdlib/lifetimes/lifetimes.ista:Holds, stdlib/prelude/prelude.ista:Array, stdlib/prelude/prelude.ista:Map, stdlib/prelude/prelude.ista:Slot, stdlib/prelude/prelude.ista:WeakRef, stdlib/prelude/prelude.ista:Future, stdlib/prelude/prelude.ista:Resolver, stdlib/prelude/prelude.ista:Fn, stdlib/prelude/prelude.ista:Instance, stdlib/prelude/prelude.ista:_Call, stdlib/prelude/prelude.ista:_Cell, stdlib/runtime/runtime.ista:Store, stdlib/runtime/runtime.ista:_Runtime, stdlib/std-module.ts:nativeKeysOf, stdlib/std-module.ts:knownTypeKey, stdlib/testing/natives.ts:testingNatives, stdlib/testing/testing.ista:Mock, stdlib/testing/testing.ista:handle, stdlib/time/time.ista:Zone, stdlib/time/zones.ts:zoneNatives, stdlib/values/arguments.ts:externPayloadOf, stdlib/values/arguments.ts:textPayloadOf, stdlib/values/results.ts:resultExtern, stdlib/values/results.ts:okExtern
- comprehensions: stdlib/futures/futures.ista:_arrivals, stdlib/futures/futures.ista:_everyPosition, stdlib/futures/futures.ista:_without, stdlib/futures/futures.ista:_inOrder, stdlib/inbox/inbox.ista:pending, stdlib/inbox/inbox.ista:_retract, stdlib/json/json.ista:toJson, stdlib/prelude/prelude.ista:map, stdlib/prelude/prelude.ista:filter, stdlib/testing/testing.ista:_list, stdlib/testing/testing.ista:_splitDue
- spawn/defer: cli/commands/run.ts:errorStreamReports, runtime/natives.ts:NativeInstances, runtime/scheduler/segment/native-calls.ts:nativeInstancesOf, stdlib/prelude/instance-natives.ts:instanceNatives, stdlib/prelude/prelude.ista:Instance, stdlib/prelude/prelude.ista:result, stdlib/prelude/prelude.ista:spawn, stdlib/prelude/prelude.ista:Deferred, stdlib/prelude/prelude.ista:defer, stdlib/prelude/prelude.ista:dispose, stdlib/runtime/natives.ts:runtimeNatives, stdlib/runtime/runtime.ista:isolate, stdlib/runtime/runtime.ista:_isolated, stdlib/runtime/runtime.ista:_decoded, stdlib/runtime/runtime.ista:_serveInstance, stdlib/runtime/runtime.ista:_runJob, stdlib/testing/natives.ts:testingNatives, stdlib/testing/testing.ista:spawnCrashingEveryAwait, stdlib/testing/testing.ista:expectPanic
- context consts: stdlib/runtime/runtime.ista:_jobs, stdlib/runtime/runtime.ista:delegate, stdlib/runtime/runtime.ista:_takeOver, stdlib/runtime/runtime.ista:_nextWork, stdlib/runtime/runtime.ista:_release, stdlib/runtime/runtime.ista:_reply
- disposal/lifetimes/holders: runtime/natives.ts:NativeWeakSide, runtime/natives.ts:NativeResources, runtime/scheduler/segment/native-calls.ts:NativeCalls.#checked, runtime/scheduler/segment/native-calls.ts:nativeResourcesOf, stdlib/collections/collections.ista:WeakMap, stdlib/collections/collections.ista:dispose, stdlib/collections/collections.ista:_deleteOnDisposal, stdlib/fanout/fanout.ista:Bus, stdlib/fanout/fanout.ista:sendRevertible, stdlib/fanout/fanout.ista:dispose, stdlib/fanout/fanout.ista:_follow, stdlib/inbox/inbox.ista:Revertible, stdlib/inbox/inbox.ista:Revertible.holding, stdlib/inbox/inbox.ista:sendRevertible, stdlib/inbox/inbox.ista:dispose, stdlib/inbox/inbox.ista:_retract, stdlib/json/natives.ts:hostPayloadOf, stdlib/json/natives.ts:jsonNatives, stdlib/lifetimes/lifetimes.ista:Holds, stdlib/lifetimes/lifetimes.ista:Keeps, stdlib/prelude/prelude.ista:Slot, stdlib/prelude/prelude.ista:WeakRef, stdlib/prelude/prelude.ista:Future, stdlib/prelude/prelude.ista:onAwait, stdlib/prelude/prelude.ista:Resolver, stdlib/prelude/prelude.ista:onCancel, stdlib/prelude/prelude.ista:put, stdlib/prelude/prelude.ista:WeakRef.from, stdlib/prelude/prelude.ista:deref, stdlib/prelude/prelude.ista:disposed, stdlib/prelude/prelude.ista:_Call, stdlib/prelude/prelude.ista:disposing, stdlib/prelude/prelude.ista:dispose, stdlib/prelude/prelude.ista:Deferred, stdlib/prelude/prelude.ista:Disposable, stdlib/prelude/weak-natives.ts:weakNatives, stdlib/rpc/rpc.ista:_Reply, stdlib/rpc/rpc.ista:dispose, stdlib/runtime/runtime.ista:Runtime, stdlib/runtime/runtime.ista:dispose, stdlib/runtime/runtime.ista:_decoded, stdlib/testing/testing.ista:Mock, stdlib/testing/testing.ista:dispose, stdlib/testing/testing.ista:withClock, stdlib/testing/testing.ista:FakeReceipts, stdlib/testing/testing.ista:revertibleSender, stdlib/testing/testing.ista:_disposeReceipt
- recursive aliases: stdlib/json/json.ista:Json
- variance: stdlib/prelude/prelude.ista:Array, stdlib/prelude/prelude.ista:Map, stdlib/prelude/prelude.ista:_mapValues
- packs: stdlib/prelude/prelude.ista:Fn, stdlib/strings/natives.ts:building, stdlib/strings/strings.ista:format, stdlib/testing/testing.ista:mock, stdlib/testing/testing.ista:calls
- defaults/fields functions: runtime/natives.ts:NativeContext, runtime/scheduler/segment/native-calls.ts:NativeCalls.call, stdlib/json/json.ista:JsonSkip, stdlib/prelude/arrays.ts:arrayNatives, stdlib/prelude/maps.ts:mapNatives, stdlib/prelude/natives.ts:preludeNatives, stdlib/prelude/prelude.ista:Optional.default, stdlib/prelude/prelude.ista:Error, stdlib/prelude/prelude.ista:Range, stdlib/prelude/prelude.ista:Array.default, stdlib/prelude/prelude.ista:Map.default, stdlib/prelude/prelude.ista:_trace, stdlib/prelude/prelude.ista:Default, stdlib/testing/testing.ista:FakeClock, stdlib/testing/testing.ista:FakeQueue, stdlib/testing/testing.ista:FakeReceipts
- codecs/JSON: cli/commands/run.ts:finish, cli/log-lines.ts:logLine, stdlib/decimal/decimal.ista:toJson, stdlib/decimal/decimal.ista:Decimal.fromJson, stdlib/json/json.ista:Json, stdlib/json/json.ista:Encodable, stdlib/json/json.ista:Decodable, stdlib/json/json.ista:JsonName, stdlib/json/json.ista:JsonSkip, stdlib/json/json.ista:JsonBigInt, stdlib/json/json.ista:encode, stdlib/json/json.ista:decode, stdlib/json/json.ista:stringify, stdlib/json/json.ista:parse, stdlib/json/json.ista:encodeText, stdlib/json/json.ista:decodeText, stdlib/json/json.ista:_toJson, stdlib/json/json.ista:_fromJson, stdlib/json/json.ista:_hostResult, stdlib/json/json.ista:_hostInput, stdlib/json/json.ista:_refuse, stdlib/json/json.ista:_write, stdlib/json/json.ista:_read, stdlib/json/json.ista:toJson, stdlib/json/json.ista:Int.fromJson, stdlib/json/json.ista:Float.fromJson, stdlib/json/json.ista:Bool.fromJson, stdlib/json/json.ista:String.fromJson, stdlib/json/json.ista:Unit.fromJson, stdlib/json/json.ista:Json.fromJson, stdlib/json/json.ista:Array.fromJson, stdlib/json/json.ista:Optional.fromJson, stdlib/json/json.ista:Map.fromJson, stdlib/json/json.ista:_encodeBigInt, stdlib/json/json.ista:_decodeBigInt, stdlib/json/json.ista:_encodeHandle, stdlib/json/json.ista:_decodeHandle, stdlib/json/natives.ts:jsonNatives, stdlib/log/log.ista:debug, stdlib/log/log.ista:info, stdlib/log/log.ista:warn, stdlib/log/log.ista:error, stdlib/log/natives.ts:logNatives, stdlib/regex/regex.ista:toJson, stdlib/regex/regex.ista:Regex.fromJson, stdlib/runtime/runtime.ista:delegate, stdlib/runtime/runtime.ista:_decoded, stdlib/testing/testing.ista:assertEq, stdlib/time/time.ista:toJson, stdlib/time/time.ista:Time.fromJson, stdlib/time/time.ista:Duration.fromJson, stdlib/time/time.ista:Zone.fromJson, stdlib/time/time.ista:DateTime.fromJson
- witnesses/traits: stdlib/json/json.ista:Encodable, stdlib/json/json.ista:Decodable, stdlib/math/math.ista:min, stdlib/math/math.ista:max, stdlib/math/math.ista:clamp, stdlib/prelude/prelude.ista:Awaitable, stdlib/prelude/prelude.ista:Sendable, stdlib/prelude/prelude.ista:DataKind, stdlib/prelude/prelude.ista:Disposable, stdlib/prelude/prelude.ista:Iterable, stdlib/prelude/prelude.ista:Container, stdlib/prelude/prelude.ista:Indexable, stdlib/prelude/prelude.ista:IndexAssignable, stdlib/prelude/prelude.ista:Convertible, stdlib/prelude/prelude.ista:Default, stdlib/prelude/prelude.ista:Addable, stdlib/prelude/prelude.ista:Subtractable, stdlib/prelude/prelude.ista:Multipliable, stdlib/prelude/prelude.ista:Divisible, stdlib/prelude/prelude.ista:FloorDivisible, stdlib/prelude/prelude.ista:Negatable, stdlib/prelude/prelude.ista:Powerable, stdlib/prelude/prelude.ista:Bitwise, stdlib/prelude/prelude.ista:Shiftable, stdlib/prelude/prelude.ista:Comparable, stdlib/prelude/prelude.ista:Stringable, stdlib/prelude/prelude.ista:Parsable
- places/&refs: runtime/natives.ts:NativeContext, runtime/scheduler/segment/native-calls.ts:NativeCalls.call, runtime/scheduler/segment/native-calls.ts:referenceAt, stdlib/prelude/arrays.ts:changingNatives, stdlib/prelude/maps.ts:mapNatives, stdlib/prelude/prelude.ista:_Cell, stdlib/prelude/prelude.ista:push, stdlib/prelude/prelude.ista:pop, stdlib/prelude/prelude.ista:reverse, stdlib/prelude/prelude.ista:setIndex, stdlib/prelude/prelude.ista:delete, stdlib/prelude/prelude.ista:sort, stdlib/prelude/prelude.ista:IndexAssignable
- patterns: stdlib/prelude/arrays.ts:patternNatives, stdlib/prelude/prelude.ista:_patternItem, stdlib/prelude/prelude.ista:_patternRest
- templates: stdlib/prelude/arrays.ts:arrayNatives, stdlib/prelude/prelude.ista:join, stdlib/prelude/prelude.ista:toString, stdlib/prelude/text-forms.ts:textFormNatives, stdlib/strings/format.ts:formatted, stdlib/strings/natives.ts:building, stdlib/strings/strings.ista:format
- ranges: stdlib/positions.ts:selectionOf, stdlib/positions.ts:selected, stdlib/positions.ts:splicesOf, stdlib/prelude/arrays.ts:arrayNatives, stdlib/prelude/arrays.ts:changingNatives, stdlib/prelude/prelude.ista:Range, stdlib/prelude/prelude.ista:_inclusiveEnd, stdlib/prelude/prelude.ista:includes, stdlib/prelude/prelude.ista:index, stdlib/prelude/prelude.ista:setIndex, stdlib/prelude/prelude.ista:iterate, stdlib/prelude/prelude.ista:_steps, stdlib/prelude/range-natives.ts:rangeNatives, stdlib/prelude/strings.ts:stringNatives, stdlib/random/natives.ts:randomNatives, stdlib/random/random.ista:integer, stdlib/random/random.ista:fraction, stdlib/ranges.ts:rangeOf, stdlib/ranges.ts:bounded, stdlib/ranges.ts:countOf, stdlib/ranges.ts:reaches, stdlib/ranges.ts:textOf
- comparisons: stdlib/decimal/decimal.ista:compare, stdlib/decimal/natives.ts:decimalNatives, stdlib/math/math.ista:min, stdlib/math/math.ista:max, stdlib/math/math.ista:clamp, stdlib/prelude/natives.ts:preludeNatives, stdlib/prelude/natives.ts:arithmeticNatives, stdlib/prelude/natives.ts:sign, stdlib/prelude/prelude.ista:sort, stdlib/prelude/prelude.ista:_merged, stdlib/prelude/prelude.ista:compare, stdlib/prelude/prelude.ista:Comparable, stdlib/time/time.ista:compare
