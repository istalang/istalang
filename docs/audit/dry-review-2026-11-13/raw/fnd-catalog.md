## src/foundation/diagnostics/catalog.ts — Declares a phase's diagnostic codes and typed message factories in one validated table
- defineDiagnostics(phase, templates): Catalog<Templates> — builds typed diagnostic factories validated against phase block; [exp]; callers: 5 outside folder

## src/foundation/diagnostics/code-blocks.ts — Assigns each compiler phase its 1000-code diagnostic block
- codeBlocks: Record<DiagnosticPhase, number> — starting code number per phase (scanner..checker); [exp]; callers: 0 outside folder (1 in folder)
- DiagnosticPhase — union of phase names owning diagnostic blocks; [exp]; callers: 0 outside folder (1 in folder)
- codeBlockSize: 1000 — number of codes per phase block; [exp]; callers: 0 outside folder (1 in folder)

## src/foundation/diagnostics/diagnostic.ts — Diagnostic value model, related locations, severity predicate, and canonical sort order
- Severity — `'error' | 'warning'`; [exp]; callers: 1 outside folder
- Diagnostic<Where, Module> — diagnostic record with code, severity, message, span, related locations; [exp]; callers: 47 outside folder
- compareDiagnostics(first, second): number — orders diagnostics by span start/end, code, then message; [exp]; callers: 2 outside folder
- isError(diagnostic): boolean — true when diagnostic severity is `'error'`; [exp]; callers: 2 outside folder

## src/foundation/diagnostics/render.ts — Formats diagnostics with 1-based path:line:column headers, source line, and caret underline
- renderDiagnostic(source, diagnostic, sourceOf?): string — formats one diagnostic and its related notes; [exp]; callers: 0 outside folder (test-only)
- Diagnosed — `{ source, diagnostics }` pair for a module; [exp]; callers: 1 outside folder
- renderDiagnostics(modules, keep?): readonly string[] — renders all kept diagnostics across modules; [exp]; callers: 1 outside folder
- excerpt(source, span, head): string — renders `path:line:col: head` plus numbered source line and `^` underline; callers: internal

## src/foundation/language/call-rule.ts — Call rule over code marks (code calls simple or its own mark)
- mayCall(code, callee): boolean — true when code of mark `code` may call `callee`; [exp]; callers: 2 outside folder

## src/foundation/language/import-paths.ts — Parses import path strings into leading `./`/`../` climbs and segment names
- ImportPath — `{ climbs, names }` of a parsed import path; [exp]; callers: 0 outside folder
- importPathOf(path): ImportPath | undefined — parses valid import or folder path, rejecting empty/platform separators; [exp]; callers: 2 outside folder

## src/foundation/language/naming.ts — Naming conventions (PascalCase/camelCase), privacy prefix `_`, `_` wildcard, and built-in type names
- Convention — `'type' | 'value'`; [exp]; callers: 4 outside folder
- followsConvention(name, convention): boolean — checks PascalCase/camelCase ignoring leading `_` (`_` matches all); [exp]; callers: 3 outside folder
- isBuiltInTypeName(name): boolean — true for primitive names and `Self`; [exp]; callers: 2 outside folder
- isUnnamed(name): boolean — true when `name === '_'`; [exp]; callers: 9 outside folder
- casedAsType(name): boolean — true when first letter after optional `_` is uppercase; [exp]; callers: 1 outside folder
- bindsInPattern(name): boolean — true when bare pattern name binds a variable (`!casedAsType(name)`); [exp]; callers: 4 outside folder
- isPrivate(name): boolean — true when name starts with `_`; [exp]; callers: 2 outside folder

## src/foundation/language/order.ts — Canonical ordering of bigints and UTF-16 strings for `<` and canonical JSON keys
- compareOrdered(left, right): number — returns -1, 0, or 1 for `bigint | string`; [exp]; callers: 8 outside folder

## src/foundation/language/primitives.ts — Built-in primitive type names and legacy lowercase primitive lookup
- primitiveNames — tuple `['Int', 'Float', 'Bool', 'String', 'Unit', 'Never', 'None']`; [exp]; callers: 2 outside folder
- PrimitiveName — union of built-in primitive type names; [exp]; callers: 6 outside folder
- primitiveOnceSpelled(name): PrimitiveName | undefined — matches lowercase primitive name (`int` -> `Int`) for diagnostics; [exp]; callers: 2 outside folder

## src/foundation/language/starts.ts — Shared predicate for whether a function signature may be started by the host or as `main`
- StartShape — `{ hasBody, isStatic, isGeneric, parameters, awaits, isIsta }`; [exp]; callers: 3 outside folder
- isStartable(shape): boolean — true for non-ista, non-static, non-generic function with body and value-only params; [exp]; callers: 2 outside folder
- isMainShaped(shape): boolean — true when `isStartable(shape) && shape.awaits && shape.parameters.length === 0`; [exp]; callers: 2 outside folder

## src/foundation/language/static-names.ts — Canonical `Owner.name` spelling for static functions
- staticName(owner, name): string — formats `${owner}.${name}`; [exp]; callers: 7 outside folder

## src/foundation/language/time-units.ts — Fixed bigint millisecond ratios for duration literals and ISO 8601 time/duration formatting
- millisecondsPerSecond: 1000n — ms per second; [exp]; callers: 2 outside folder
- secondsPerMinute: 60n — seconds per minute; [exp]; callers: 1 outside folder
- minutesPerHour: 60n — minutes per hour; [exp]; callers: 1 outside folder
- hoursPerDay: 24n — hours per day; [exp]; callers: 1 outside folder
- millisecondsPerMinute: 60000n — ms per minute; [exp]; callers: 2 outside folder
- millisecondsPerHour: 3600000n — ms per hour; [exp]; callers: 2 outside folder
- millisecondsPerDay: 86400000n — ms per day; [exp]; callers: 2 outside folder

## src/foundation/language/values.ts — Representation-independent `==` and structural hash-table map operations over `ValueView`
- Primitive — `null | boolean | string | bigint | number`; [exp]; callers: 0 outside folder (test-only)
- MapOf<Value> — `{ kind: 'map', entries: readonly [Value, Value][] }`; [exp]; callers: 3 outside folder
- ValueView<Value> — `{ shapeOf, sameHead, headKey }` adapter for a value representation; [exp]; callers: 1 outside folder
- ValueSemantics<Value> — provides `equal`, `entryPosition`, `entryValue`, `setEntryInPlace`, `deleteEntryInPlace`, `copiedMap`, `forget`, `mapOf`; [exp]; callers: 2
- ValueSemantics.equal(first, second): boolean — explicit-stack structural `==` with backtracking over map hash buckets; callers: via ValueSemantics
- ValueSemantics.entryPosition(map, key): number | undefined — finds index of `key` in `map` via hash bucket + `equal`; callers: via ValueSemantics
- ValueSemantics.setEntryInPlace(map, key, value) — updates or appends `[key, value]` in `map`, maintaining its hash table; callers: via ValueSemantics
- ValueSemantics.deleteEntryInPlace(map, key) — removes `key`'s entry from `map` and invalidates its cached table/hash; callers: via ValueSemantics
- ValueSemantics.copiedMap(map): MapOf<Value> — clones `map` entries and its cached hash bucket table; callers: via ValueSemantics
- ValueSemantics.mapOf(entries): MapOf<Value> — builds a `MapOf<Value>` by inserting entries in order; callers: via ValueSemantics
- ValueSemantics.#step(step, steps, frames): boolean — runs one pair or map-entry comparison step; callers: internal
- ValueSemantics.#agreeAtTop(left, right, steps): boolean — compares two values' top shapes/heads and pushes child steps; callers: internal
- ValueSemantics.#hashOf(value): number — explicit-stack 32-bit FNV-1a structural hash, memoized per object in WeakMap; callers: internal
- ValueSemantics.#visitHashValue(value, hashes, steps): void — pushes cached/primitive hash or schedules composite/map hash steps; callers: internal
- ValueSemantics.#tableOf(map): ReadonlyMap<number, readonly number[]> — builds/caches hash-to-entry-indices map for `map`; callers: internal
- candidateFrame(candidates): EqualFrame<Value> | undefined — starts a comparison frame for the current candidate map entry; callers: internal
- backtrack(frames): boolean — advances the nearest map-entry candidate search frame on mismatch; callers: internal
- partSteps(view, value, shape): readonly HashStep<Value>[] — builds join + reversed child visit steps for hashing; callers: internal
- hashText(text): number — 32-bit FNV-1a hash of a string; callers: internal
- mapHash(hashes): number — order-independent 32-bit hash of key/value hash pairs; callers: internal

## src/foundation/language/well-known/codecs.ts — Names of `json` module trait methods, compiler-derived codecs, and boundary helpers
- codecFunctions — `{ write: 'toJson', read: 'fromJson' }`; [exp]; callers: 1 outside folder
- derivedCodecs — `{ write: '_toJson', read: '_fromJson' }`; [exp]; callers: 2 outside folder
- codecHelpers — record of `_encodeBigInt`, `_decodeBigInt`, `_fields`, `_tag`, `_hostResult`, etc.; [exp]; callers: 5 outside folder
- CodecHelper — union of `codecHelpers` values; [exp]; callers: 4 outside folder
- CodecName — union of derived codec and helper function names; [exp]; callers: 1 outside folder

## src/foundation/language/well-known/implicit-calls.ts — Names of functions implicitly called by language constructs
- collectionFunctions — `{ index: 'index', setIndex: 'setIndex', iterate: 'iterate' }`; [exp]; callers: 3 outside folder
- templateFunctions — `{ toString: 'toString', join: 'join' }`; [exp]; callers: 1 outside folder
- inclusiveEndFunction: '_inclusiveEnd' — prelude helper for `..=`; [exp]; callers: 1 outside folder
- arrayPatternFunctions — `{ length: 'length', item: '_patternItem', rest: '_patternRest' }`; [exp]; callers: 1 outside folder
- partConversionFunctions — `{ items: 'map', values: '_mapValues' }`; [exp]; callers: 1 outside folder
- conversionFunction: 'from' — static conversion function name `T.from`; [exp]; callers: 4 outside folder
- panicFunction: 'panic' — prelude panic function name; [exp]; callers: 1 outside folder
- awaitFunction: 'onAwait' — awaitable protocol function name; [exp]; callers: 3 outside folder
- disposeFunction: 'dispose' — `Disposable` protocol function name; [exp]; callers: 1 outside folder

## src/foundation/language/well-known/index.ts — Language-role std modules, well-known declarations, marks, sendabilities, and fixed names
- languageModules — `{ prelude, time, json, lifetimes, testing }`; [exp]; callers: 6 outside folder
- LanguageModule — union of language-role std module names; [exp]; callers: 6 outside folder
- runtimeModule: 'runtime' — name of the `runtime` std module; [exp]; callers: 1 outside folder
- stdScheme: 'std' — URL scheme for std modules; [exp]; callers: 3 outside folder
- WellKnownDeclaration — `{ module: LanguageModule, name: string }`; [exp]; callers: 12 outside folder
- wellKnown — catalog of well-known declarations (`future`, `resolver`, `fn`, `optional`, `result`, `json`, etc.); [exp]; callers: 50 outside folder
- qualifiedName({ module, name }): string — formats `${module}.${name}`; [exp]; callers: 4 outside folder
- persistences — `['live', 'ista']`; [exp]; callers: 2 outside folder
- Persistence — `'live' | 'ista'`; [exp]; callers: 4 outside folder
- marks — `['simple', 'live', 'ista']`; [exp]; callers: 3 outside folder
- Mark — `'simple' | 'live' | 'ista'`; [exp]; callers: 4 outside folder
- sendabilities — `['sendable', 'plain']`; [exp]; callers: 2 outside folder
- Sendability — `'sendable' | 'plain'`; [exp]; callers: 2 outside folder
- entryFunction: 'main' — entry function name; [exp]; callers: 3 outside folder
- receiverParameter: 'self' — method receiver parameter name; [exp]; callers: 3 outside folder
- selfType: 'Self' — trait self type name; [exp]; callers: 3 outside folder

## src/foundation/language/well-known/jobs.ts — Well-known names for `runtime.delegate`, `_serve`, and the `job` waypoint
- jobFunctions — `{ delegate: 'delegate', server: '_serve' }`; [exp]; callers: 1 outside folder
- jobWaypoint: 'job' — waypoint label where code awaits a delegated job; [exp]; callers: 1 outside folder

## src/foundation/language/well-known/testing.ts — Well-known `testing` module function names and `.test.ista` suffix check
- testingFunctions — `{ list: '_list', run: '_run', mock: 'mock', handle: 'handle' }`; [exp]; callers: 2 outside folder
- testModuleSuffix: '.test.ista' — file suffix of test modules; [exp]; callers: 2 outside folder
- isTestModulePath(path): boolean — true when `path` ends with `.test.ista`; [exp]; callers: 1 outside folder

## src/foundation/language/well-known/variants.ts — Well-known variant and field names for union enums, `Result`, and `Step`
- unionLayout — `{ noneVariant: 'None', valueField: 'value' }`; [exp]; callers: 2 outside folder
- resultVariants — `{ ok: 'Ok', err: 'Err' }`; [exp]; callers: 4 outside folder
- resultFields — `{ ok: 'value', err: 'error' }`; [exp]; callers: 1 outside folder
- stepVariants — `{ next: 'Next', done: 'Done' }`; [exp]; callers: 1 outside folder

## src/foundation/structures/entries/entry.ts — Single revision entry state, cycle stand-in resolution, and transitive note collection
- TableOptions<Key, Value, Context> — `{ name, compute, equal?, cyclic? }`; [exp]; callers: 0 outside folder (1 in folder)
- Table<Note> — `{ options, entries }` map for one revision table; [exp]; callers: 0 outside folder (1 in folder)
- Input — `{ read, equal }` for a recorded revision input; [exp]; callers: 0 outside folder (1 in folder)
- Read<Note> — discriminated union of logged reads (`entry`, `input`, `notes`); [exp]; callers: 0 outside folder (1 in folder)
- Entry<Note> — mutable state of one table entry (value, reads, log, notes, Tarjan SCC state); [exp]; callers: 0 outside folder (1 in folder)
- readsFirst(entry, read): boolean — records input read tuple in `entry.inputsRead`, returning true if first time; [exp]; callers: 0 outside folder (1 in folder)
- isMember(entry): boolean — true when finished entry lies on a dependency cycle; [exp]; callers: 0 outside folder (1 in folder)
- answerOf(entry): unknown — returns entry's value, or its memoized cycle stand-in when running/cyclic; [exp]; callers: 0 outside folder (1 in folder)
- notesFrom(entry): readonly Note[] — returns `entry`'s notes plus transitive `notesOfReads(entry)`; [exp]; callers: 0 outside folder (1 in folder)
- notesOfReads(entry): readonly Note[] — explicit-stack DFS collecting notes from all entries `entry` read; [exp]; callers: 0 outside folder (1 in folder)

## src/foundation/structures/entries/index.ts — Incremental revision tables with read logging, early cutoff replay, and online Tarjan cycle stand-ins
- EntryTable<Note, Key, Value, Context> — `{ get, computed, running, notesFrom }` handle for one table; [exp]; callers: 25 outside folder
- InputOptions<Args, Value> — `{ name, read, equal? }` for registering a tracked input; [exp]; callers: 0 outside folder
- RevisionOptions<Note> — `{ previous?, observe? }` options when constructing `Entries`; [exp]; callers: 0 outside folder
- Entries<Note> — manages tables, inputs, active entry stack, cycle detection, and incremental replay; [exp]; callers: 3 outside folder
- Entries.table(options): EntryTable — registers a named `EntryTable` in this revision; callers: via Entries
- Entries.input(options): (...args) => Value — registers a named input reader that logs reads to the active entry; callers: via Entries
- Entries.notesReached(): readonly Note[] — returns active entry's notes plus logged transitive notes of its reads; callers: via Entries
- Entries.#readNotes(): readonly Note[] — collects and logs notes of entries read so far by active entry; callers: internal
- Entries.#get(table, key, context): unknown — returns existing entry's answer or starts and produces a new entry; callers: internal
- Entries.#readInput(name, input, args): unknown — invokes `input.read` and logs first occurrence on active entry; callers: internal
- Entries.#read(target): unknown — records dependency edge from active entry to `target`, updating Tarjan lowlink; callers: internal
- Entries.#start(table, key, context): Entry<Note> — initializes a new running `Entry` and records read edge; callers: internal
- Entries.#produce(entry): unknown — takes over `entry` from `#previous` or computes it and closes its Tarjan SCC; callers: internal
- Entries.#takeOver(entry): boolean — replays `before.log` from previous revision, adopting value/notes if all match; callers: internal
- Entries.#replays(read): boolean — checks whether one logged `entry`, `input`, or `notes` read still produces an equal answer; callers: internal
- Entries.#takeable(name, key): Entry<Note> | undefined — finds non-running, non-cyclic entry for `(name, key)` in `#previous` chain; callers: internal
- register(registry, name, value): void — inserts `name` into `registry` or fails with `unreachable` on duplicate; callers: internal

## src/foundation/structures/entries/tuple-set.ts — Prefix-tree set of unknown[] tuples compared by `Object.is` identity
- TupleSet — prefix tree with `add(tuple): boolean` returning true when tuple is new; [exp]; callers: 0 outside folder (2 in folder)
- TupleSet.add(tuple): boolean — walks/extends prefix tree for `tuple` items and marks terminal node added; callers: via TupleSet

## src/foundation/structures/equality.ts — Structural equality combinators for arrays, maps, sets, records, and deduplication
- Equality<Value> — `(first: Value, second: Value) => boolean`; [exp]; callers: 2 outside folder
- sameItems(items?): Equality<readonly Item[]> — pairwise array equality with identity fast-path; [exp]; callers: 27 outside folder
- sameEntries(values?): Equality<ReadonlyMap<Key, Value>> — map key/value equality with identity fast-path; [exp]; callers: 3 outside folder
- sameMembers(first, second): boolean — set equality with identity fast-path; [exp]; callers: 1 outside folder
- sameProperties(first, second): boolean — shallow `Object.is` property equality on records; [exp]; callers: 3 outside folder
- distinctItems(items, same): readonly Item[] — keeps first occurrence of each item under `same`; [exp]; callers: 5 outside folder

## src/foundation/structures/groups.ts — Appends an item to a key's array in a Map in place
- addToGroup(groups, key, item): void — pushes `item` onto `groups.get(key)` or initializes `[item]`; [exp]; callers: 7 outside folder

## src/foundation/structures/kind-table.ts — Exhaustive handler tables keyed by discriminated union `kind`
- Handlers<Context, Item, Args, Result> — mapped type requiring a handler per `Item['kind']`; [exp]; callers: 31 outside folder
- handlerOf(handlers, item): Fn — selects the handler for `item.kind`; [exp]; callers: 29 outside folder

## src/foundation/structures/memo.ts — Single-key WeakMap/Map memoization (preserving `undefined`) and object-sequence trie memoization
- MemoCache<Key, Value> — `{ get, set }` cache interface; [exp]; callers: 0 outside folder
- memo(cache, key, compute): Value — returns cached value for `key` (using sentinel for `undefined`) or computes it; [exp]; callers: 44 outside folder
- SequenceMemo<Item, Value> — WeakMap trie caching a value per sequence of object keys via `get(items, compute)`; [exp]; callers: 4 outside folder

## src/foundation/structures/reachable.ts — Explicit-stack DFS collecting all edges reachable from root nodes
- edgesReachedFrom(roots, edgesOf, targetOf): readonly Edge[] — collects edges from `roots` visiting each node once; [exp]; callers: 2 outside folder

## src/foundation/structures/revision-memo.ts — Revision-keyed memo cache with online Tarjan cycle stand-ins for mutable owners
- RevisionMemo<Key, Value> — caches per `(revision, key)` via `get(revision, key, compute, whileComputing)`; [exp]; callers: 1 outside folder
- RevisionMemo.get(revision, key, compute, whileComputing): Value — clears on new revision, runs online Tarjan SCC to assign `whileComputing` to cycles; callers: 1

## src/foundation/structures/sorted.ts — Binary search over sorted arrays
- lastIndexAtMost(items, keyOf, value): number — bisects `items` for last index with `keyOf(item) <= value` (-1 if none); [exp]; callers: 6 outside folder

## src/foundation/structures/stack.ts — Scoped stack push/empty helpers and stack-safe iterable push
- withPushed(stack, item, work): Result — pushes `item` onto `stack` and pops in `finally`; [exp]; callers: 6 outside folder
- withEmptied(stack, work): Result — splices `stack` empty for `work` and restores items in `finally`; [exp]; callers: 1 outside folder
- pushAll(stack, items): void — pushes `items` one by one without spreading onto the JS call stack; [exp]; callers: 5 outside folder

## src/foundation/structures/strongly-connected.ts — Explicit-stack Tarjan strongly connected components over a directed edge list
- GraphEdge<Node> — `{ from: Node, to: Node }`; [exp]; callers: 0 outside folder (test-only)
- stronglyConnected(edges): (node: Node) => Node | undefined — maps each node on an edge to its SCC representative; [exp]; callers: 3 outside folder
- Components.#visit(start): void — explicit-stack Tarjan DFS from `start`; callers: internal
- Components.#enter(node) — assigns discovery order/lowlink and pushes `node` onto Tarjan stack; callers: internal
- Components.#leave(node, parent): void — closes SCC if `node` is root and propagates lowlink to `parent`; callers: internal
- Components.#close(root): void — pops SCC members up to `root` and assigns `root` as their component; callers: internal

## src/foundation/structures/unreachable.ts — Toolchain invariant failure error and throw helper
- Unreachable — `Error` subclass thrown on broken toolchain invariants; [exp]; callers: 0 outside folder (test-only)
- unreachable(message): never — throws `new Unreachable(message)`; [exp]; callers: 137 outside folder

## src/foundation/text/code-points.ts — Unicode code-point widths, counts, slices, and monotonic UTF-16 <-> code-point cursor conversions
- codePoints(s): string[] — splits `s` into an array of code-point strings; [exp]; callers: 1 outside folder
- codePointWidth(text, offset): number — returns 2 for surrogate pair at `offset`, else 1; [exp]; callers: 2 outside folder
- utf16Offset(s, position): number — converts non-negative code-point `position` to UTF-16 offset; [exp]; callers: 1 outside folder
- codePointCount(s): number — counts Unicode code points in `s` without allocating an array; [exp]; callers: 2 outside folder
- codePointAtPosition(s, position): string — returns code point at `position` (`''` if out of bounds); [exp]; callers: 1 outside folder
- codePointsAt(s): (position: number) => string — stateful cursor reading code points at monotonic positions in O(n); [exp]; callers: 1 outside folder
- codePointSlice(s, start, end): string — slices `s` between code-point indices `[start, end)`; [exp]; callers: 2 outside folder
- codePointPositions(s): (offset: number) => number — stateful cursor mapping increasing UTF-16 offsets to code-point indices; [exp]; callers: 2 outside folder

## src/foundation/text/line-map.ts — Line-break recognition, line splitting, leading space count, and memoized offset <-> line/column mapping
- Position — `{ line: number, column: number }` (0-based UTF-16); [exp]; callers: 0 outside folder
- lineBreakLength(text, offset): number — returns 2 for `\r\n`, 1 for `\n` or `\r`, 0 otherwise; [exp]; callers: 3 outside folder
- splitLines(text): string[] — splits `text` into lines stripped of `\r\n`/`\n`/`\r`; [exp]; callers: 2 outside folder
- lineStartAt(text, offset): number — scans backward from `offset` to start of its line; [exp]; callers: 6 outside folder
- leadingSpaceCount(text): number — counts leading `' '` characters of `text`; [exp]; callers: 1 outside folder
- indentationAt(text, offset): number — counts leading spaces on the line holding `offset` up to `offset`; [exp]; callers: 3 outside folder
- LineMap — precomputed line starts/ends with `positionAt`, `offsetAt`, `lineSpan`, `lineCount`, `lineStarts`; [exp]; callers: 2 outside folder
- lineMapOf(source): LineMap — returns `LineMap` memoized per `SourceText`; [exp]; callers: 10 outside folder
- positionIn(lineStarts, offset): Position — bisects `lineStarts` to convert `offset` to `{ line, column }`; [exp]; callers: 1 outside folder
- lineBounds(text): { starts, ends } — scans `text` once to collect line start and content-end offsets; callers: internal

## src/foundation/text/source-text.ts — Branded immutable SourceText stripping a leading UTF-8 BOM
- SourceText — branded `{ path, text }` of one module; [exp]; callers: 14 outside folder
- createSourceText(path, contents): SourceText — strips leading `\uFEFF` BOM and returns branded `SourceText`; [exp]; callers: 7 outside folder

## src/foundation/text/span.ts — Half-open UTF-16 `[start, end)` Span, text slicing, and containment check
- Span — `{ start: number, end: number }`; [exp]; callers: 27 outside folder
- textOf(source, span): string — slices `source.text` over `[span.start, span.end)`; [exp]; callers: 7 outside folder
- encloses(outer, inner): boolean — true when `outer.start <= inner.start && inner.end <= outer.end`; [exp]; callers: 2 outside folder

## src/definition/definition.ts — Top-level Definition schema and versioned persisted format (`istalang-definition` v1)
- Definition — validated compiled program IR (`Tables` refined with `checkReferences`); [exp]; callers: 18 outside folder
- definitionFormat: Format<typeof definition> — version 1 persisted format for `Definition`; [exp]; callers: 4 outside folder

## src/definition/extern-key.ts — Canonical persisted extern and startable function signature keys (`module.name(ParamTypes)`)
- KeyType — discriminated union of declared types as spelled in extern keys; [exp]; callers: 4 outside folder
- ExternSignature — `{ module, name, parameters }` input to `externKey`; [exp]; callers: 1 outside folder
- WrittenType — `KeyType | PrimitiveName` shorthand for native key builders; [exp]; callers: 1 outside folder
- namedKey(name, ...typeArguments): KeyType — builds a `named` `KeyType`; [exp]; callers: 2 outside folder
- functionKey(parameters, result, persistence?): KeyType — builds a `function` `KeyType`; [exp]; callers: 4 outside folder
- tupleKey(...elements): KeyType — builds a `tuple` `KeyType`; [exp]; callers: 1 outside folder
- parameterKey(name): KeyType — builds a type-parameter `KeyType`; [exp]; callers: 9 outside folder
- ReferenceKey — `{ reference: KeyType }` wrapper for `&` native parameters; [exp]; callers: 0 outside folder
- referenceKey(type): ReferenceKey — marks a native parameter as passed by `&`; [exp]; callers: 2 outside folder
- RestKey — `{ rest: KeyType }` wrapper for `...` native parameters; [exp]; callers: 0 outside folder
- restKey(type): RestKey — marks a native parameter as a `...` rest parameter; [exp]; callers: 1 outside folder
- NativeParameter — `WrittenType | ReferenceKey | RestKey`; [exp]; callers: 3 outside folder
- nativeKey(module, name, ...parameters): string — builds an extern key from native table parameter descriptors; [exp]; callers: 1 outside folder
- externKey(signature): string — formats `module.name(param1, &param2, ...param3)`; [exp]; callers: 1 outside folder
- keyTypeText(type): string — formats a `KeyType` into its canonical key string; [exp]; callers: 1 outside folder
- keyParameterOf(parameter): KeyParameter — normalizes `NativeParameter` to `{ type, passing }`; callers: internal
- markerOf(parameter): string — returns `'&'`, `'...'`, or `''` for `parameter.passing`; callers: internal

## src/definition/formats/codec.ts — Canonical sorted-key lossless-bigint JSON encoding, depth-bounded decoding, and SHA-256 content hashing
- contentHashText — zod schema for 64-char lowercase hex SHA-256 hash; [exp]; callers: 1 outside folder
- encodeJson(value): string — encodes JSON value (with bigints) deterministically with UTF-16 sorted object keys; [exp]; callers: 6 outside folder
- NestingError — `Error` subclass thrown when JSON text exceeds `deepest` bracket nesting; [exp]; callers: 1 outside folder
- decodeJson(text, deepest?): unknown — checks bracket depth then parses JSON (unsafe integers as bigints); [exp]; callers: 1 outside folder
- jsonDepth(value): number — explicit-stack measurement of array/object nesting depth; [exp]; callers: 0 outside folder (1 in folder)
- contentHash(text): string — SHA-256 hex digest of `text`; [exp]; callers: 0 outside folder (1 in folder)
- written(value): string — recursive canonical JSON serializer sorting object entries by `compareOrdered`; callers: internal
- textDepth(text): number — counts maximum `[`/`{` nesting in raw JSON text outside string literals; callers: internal
- decodeNumber(text): number | bigint — parses JSON number text as `number` if safe integer or float, else `bigint`; callers: internal

## src/definition/formats/format.ts — Versioned `{ format, version, body }` persistence envelope with depth and zod validation
- FormatError — `Error` subclass thrown on invalid format envelope, unsupported version, or schema failure; [exp]; callers: 1 outside folder
- Format<Body> — `{ name, version, read, write, readCanonical }` persistence codec; [exp]; callers: 0 outside folder (test-only)
- defineFormat(name, version, body): Format<Body> — wraps a zod schema in a versioned, depth-guarded JSON format; [exp]; callers: 3 outside folder
- readEnvelope(text, name) — decodes JSON within `maximumTextDepth + 1` and validates `{ format, version, body }` object; callers: internal

## src/definition/instructions/calls.ts — `call` and `currentCall` instruction schemas
- Callee — `{ kind: 'function', function } | { kind: 'value', register }`; [exp]; callers: 2 outside folder
- callInstructions — `[call, currentCall]` instruction schema tuple; [exp]; callers: 0 outside folder (1 in folder)

## src/definition/instructions/control.ts — `jump`, `branch`, `switch`, and `return` instruction schemas
- controlInstructions — `[jump, branch, switchVariant, returnValue]` instruction schema tuple; [exp]; callers: 0 outside folder (1 in folder)

## src/definition/instructions/data.ts — Data construction, field/cell/contextConstant access, closure, equality, `not`, and `order` instruction schemas
- dataInstructions — tuple of all 18 data instruction schemas; [exp]; callers: 0 outside folder (1 in folder)

## src/definition/instructions/define-instruction.ts — Helper building a strict zod object schema with `kind` and `span` for an instruction
- defineInstruction(kind, shape) — returns `z.strictObject({ kind: z.literal(kind), span, ...shape })`; [exp]; callers: 0 outside folder (6 in folder)

## src/definition/instructions/flow.ts — Identifies instructions that suspend on a wait register or terminate straight-line control flow
- waitRegister(instruction): Register | undefined — returns `instruction.wait` for `await` or blocking `select`; [exp]; callers: 2 outside folder
- waits(instruction): boolean — true when `waitRegister(instruction) !== undefined`; [exp]; callers: 2 outside folder
- terminates(instruction): boolean — true for `return`, `jump`, `branch`, `switch`, `select`; [exp]; callers: 1 outside folder

## src/definition/instructions/instruction.ts — Combined `Instruction` union schema and exhaustive `operandsOf` table
- instruction — discriminated union zod schema of all instruction families; [exp]; callers: 1 outside folder
- Instruction — inferred type of a Definition instruction; [exp]; callers: 6 outside folder
- InstructionKind — union of all instruction `kind` strings; [exp]; callers: 0 outside folder (1 in folder)
- Operands — `{ registers, labels, functions, types, constants }` referenced by an instruction; [exp]; callers: 2 outside folder
- operandsOf(subject): Operands — exhaustive `Handlers` dispatch returning all table/frame indexes in `subject`; [exp]; callers: 1 outside folder
- argumentOperands(argument): Partial<Operands> — extracts register operands from a `call` `Argument`; callers: internal
- merge(...parts): Operands — concatenates partial `Operands` lists into a complete `Operands`; callers: internal

## src/definition/instructions/lifetimes.ts — `release` and `keep` instruction schemas for deterministic register lifetime management
- lifetimeInstructions — `[release, keep]` instruction schema tuple; [exp]; callers: 0 outside folder (1 in folder)

## src/definition/instructions/places.ts — Schemas for register-plus-fieldPath `Place` and call `Argument` (`value`, `reference`, `omitted`)
- fieldPath — `z.array(fieldIndex)` schema; [exp]; callers: 1 outside folder
- place — `z.strictObject({ register, path: fieldPath })` schema; [exp]; callers: 0 outside folder (1 in folder)
- Place — `{ register: number, path: number[] }`; [exp]; callers: 2 outside folder
- argument — discriminated union schema for `value`, `reference`, `omitted` call arguments; [exp]; callers: 0 outside folder (1 in folder)
- Argument — inferred call argument type; [exp]; callers: 9 outside folder

## src/definition/instructions/prologue.ts — `given` and `body` prologue instruction schemas for default parameter evaluation
- prologueInstructions — `[given, body]` instruction schema tuple; [exp]; callers: 0 outside folder (1 in folder)

## src/definition/instructions/suspension.ts — `wait`, `resolver`, `await`, and `select` suspension instruction schemas
- suspensionInstructions — `[wait, resolver, awaitWait, select]` instruction schema tuple; [exp]; callers: 0 outside folder (1 in folder)

## src/definition/operands.ts — Non-negative integer index schemas and types for registers, labels, table IDs, offsets, counts, and spans
- register — `z.int().nonnegative()` register index schema; [exp]; callers: 9 outside folder
- label — `z.int().nonnegative()` instruction label index schema; [exp]; callers: 5 outside folder
- moduleId — `z.int().nonnegative()` module table index schema; [exp]; callers: 1 outside folder
- functionId — `z.int().nonnegative()` function table index schema; [exp]; callers: 7 outside folder
- typeId — `z.int().nonnegative()` type table index schema; [exp]; callers: 5 outside folder
- constantId — `z.int().nonnegative()` constant table index schema; [exp]; callers: 1 outside folder
- objectId — `z.int().nonnegative()` heap object ID schema; [exp]; callers: 3 outside folder
- fieldIndex — `z.int().nonnegative()` struct/tuple/variant field index schema; [exp]; callers: 2 outside folder
- variantIndex — `z.int().nonnegative()` enum variant index schema; [exp]; callers: 2 outside folder
- offset — `z.int().nonnegative()` UTF-16 source offset schema; [exp]; callers: 1 outside folder
- count — `z.int().nonnegative()` size/arity schema; [exp]; callers: 4 outside folder
- span — `z.strictObject({ start: offset, end: offset })`; [exp]; callers: 2 outside folder
- Register — `number` register index type; [exp]; callers: 57 outside folder
- Label — `number` instruction index type; [exp]; callers: 1 outside folder
- FunctionId — `number` function table index type; [exp]; callers: 31 outside folder
- TypeId — `number` type table index type; [exp]; callers: 14 outside folder
- ConstantId — `number` constant table index type; [exp]; callers: 1 outside folder

## src/definition/tables/functions.ts — Function-table entry schemas (`code` vs `extern`) and parameter/prologue/encoder queries
- codeMode — `z.enum(marks)` schema; [exp]; callers: 0 outside folder (test-only)
- CodeMode — `'simple' | 'live' | 'ista'`; [exp]; callers: 3 outside folder
- functionDefinition — discriminated union schema of `code` and `extern` function entries; [exp]; callers: 0 outside folder (1 in folder)
- FunctionDefinition — inferred union type of a function-table entry; [exp]; callers: 7 outside folder
- CodeFunction — narrowed `code` function-table entry type; [exp]; callers: 13 outside folder
- takesReference(entry, index): boolean — true when parameter `index` of `entry` has `reference: true`; [exp]; callers: 2 outside folder
- mayLeaveOut(entry, index): boolean — true when `entry` is `code` and parameter `index` has `hasDefault: true`; [exp]; callers: 1 outside folder
- bodyStart(entry): number — memoized pc of `entry`'s `body` instruction, or 0 if none; [exp]; callers: 1 outside folder
- returnsAtOnce(entry): boolean — true for externs and `simple` code entries; [exp]; callers: 1 outside folder
- takesArguments(entry, given): boolean — true when `given <= params.length` and all trailing params `mayLeaveOut`; [exp]; callers: 1 outside folder
- capturesOf(entry): number — returns `entry.captures` for `code`, 0 for `extern`; [exp]; callers: 2 outside folder
- encoderProblem(entry): string | undefined — returns error string if `entry` cannot encode a 1-arg outcome at once with 0 captures; [exp]; callers: 2 outside folder

## src/definition/tables/index.ts — Top-level `tables` schema (`modules`, `types`, `functions`, `constants`, `main`, `jobServer`, `starts`, `tests`)
- tables — zod schema for the unrefined Definition tables; [exp]; callers: 1 outside folder
- Tables — inferred type of `tables`; [exp]; callers: 4 outside folder

## src/definition/tables/test-runner.ts — Builds argument lists and arities for the testing runner's `_list` and `_run` entries
- ListedTest — `{ suite, title, position, expected }` test descriptor; [exp]; callers: 0 outside folder
- listingArguments(suite, title): readonly [Value, string] — builds `[closure(suite), title]` for `_list`; [exp]; callers: 1 outside folder
- runningArguments(test): readonly [Value, string, bigint, string] — builds arguments for `_run`; [exp]; callers: 1 outside folder
- runnerArity — `{ list: 2, run: 4 }`; [exp]; callers: 1 outside folder

## src/definition/tables/types.ts — Type-table entry schemas (`struct`, `enum`, `extern`, `alias`), roles, and resource/cell/encoder queries
- typeReference — recursive discriminated union schema (`primitive`, `named`, `tuple`, `function`); [exp]; callers: 0 outside folder (1 in folder)
- TypeReference — inferred type reference in a Definition; [exp]; callers: 3 outside folder
- typesIn(reference): readonly number[] — lists all `TypeId`s referenced inside `reference`; [exp]; callers: 1 outside folder
- EnumRole — `'json'`; [exp]; callers: 1 outside folder
- ExternRole — `'shared' | 'cell' | 'future' | 'instance'`; [exp]; callers: 1 outside folder
- typeDefinition — discriminated union schema of `struct`, `enum`, `extern`, `alias` entries; [exp]; callers: 0 outside folder (1 in folder)
- TypeDefinition — inferred type-table entry; [exp]; callers: 9 outside folder
- isResourceType(types, type): boolean — true for non-`shared` extern entry with `disposal.kind === 'function'`; [exp]; callers: 2 outside folder
- outcomeEncoderOf(types, type): number | undefined — returns `entry.encoder` for an extern (`Instance<T>`) entry; [exp]; callers: 1 outside folder
- isCellType(types, type): boolean — true when type entry has role `'shared'` or `'cell'`; [exp]; callers: 1 outside folder
- hasRole(types, type, role): boolean — true when `extern` or `enum` entry at `type` has `entry.role === role`; [exp]; callers: 4 outside folder

## src/definition/validation/entries.ts — Validates Definition root entries (`main`, `jobServer`, `starts`, `tests`) against call/start rules
- checkEntries(context): void — validates `main`, `jobServer`, `starts`, and `tests` entries in `context.tables`; [exp]; callers: 0 outside folder (1 in folder)
- checkEncoder(context, encoder, path): void — validates that `encoder` is in range and passes `encoderProblem`; [exp]; callers: 0 outside folder (1 in folder)
- checkMain(context): void — checks `tables.main` is in range and `isMainShaped`; callers: internal
- checkJobServer(context): void — checks `tables.jobServer` is `live` code taking 1 value argument with 0 captures; callers: internal
- checkCalledEntry(context, path, function_, called): void — checks entry is `code` in `modes` with 0 captures and `parameters` value args; callers: internal
- checkStarts(context): void — checks `tables.starts` have unique keys, `isStartable` code entries, and valid encoders; callers: internal
- checkTests(context): void — checks `tables.tests` `list`, `run`, and `suites` entries are callable from `ista` code; callers: internal
- startShapeOf(entry): StartShape — projects a `CodeFunction` to `StartShape`; callers: internal

## src/definition/validation/instruction-rules.ts — Per-instruction and per-value arity, role, capture, and execution-mode validation rules
- Construction — `{ shape: 'struct' | 'variant', type, variant, arity }`; [exp]; callers: 0 outside folder
- instructionProblem(tables, owner, instruction): string | undefined — exhaustive `Handlers` check for one instruction; [exp]; callers: 0 outside folder (1 in folder)
- constructionProblem(tables, construction): string | undefined — checks struct/variant construction matches type entry's field count; [exp]; callers: 0 (1 in folder)
- closureProblem(tables, functionId, captures): string | undefined — checks closure capture count matches target function; [exp]; callers: 0 outside folder (1 in folder)
- directCallProblem(callee, args): string | undefined — checks direct call target has 0 captures and matching arguments; callers: internal
- argumentsProblem(callee, args): string | undefined — checks call argument count and value/reference/omitted passing; callers: internal

## src/definition/validation/ranges.ts — Table and frame index bounds checking for Definition validation
- Path — `readonly (string | number)[]` zod issue path; [exp]; callers: 0 outside folder (2 in folder)
- Context — `{ tables, report }` validation context; [exp]; callers: 0 outside folder (2 in folder)
- outOfRange(tables, indexes, frame?): readonly string[] — lists error messages for any index exceeding table/frame size; [exp]; callers: 0 outside folder (1 in folder)
- inRange(context, indexes, path, frame?): boolean — reports all `outOfRange` problems at `path` and returns true if none; [exp]; callers: 0 outside folder (2 in folder)

## src/definition/validation/references.ts — Cross-table Definition refinement: lineStarts, types, functions, prologues, instructions, and values
- checkReferences(tables, refinement): void — zod `superRefine` callback validating all cross-table references; [exp]; callers: 1 outside folder
- ValueProblem — `{ path: readonly number[], message: string }`; [exp]; callers: 0 outside folder
- valueProblems(tables, value): readonly ValueProblem[] — explicit-stack validation of `value` and its children against `tables`; [exp]; callers: 1 outside folder
- checkType(context, type, path): void — validates type arguments, extern encoder/disposal functions, and field types/annotations; callers: internal
- checkFunction(context, entry, path): void — validates function module, annotations, and extern types or code body; callers: internal
- checkCode(context, entry, path): void — validates register count, cells, final terminator, prologue, and each instruction; callers: internal
- checkPrologue(context, entry, path): void — validates `body` marker presence/uniqueness and `given` placement before `body`; callers: internal
- ownValueProblems(tables, value, path): readonly ValueProblem[] — checks table index bounds and construction/closure rules on one composite; callers: internal
- pushChildren(value, pending): void — pushes enter/visit/leave steps for `childValues(value)` in reverse order; callers: internal
- indexesOf(value): Operands — returns `types` or `functions` indexes directly referenced by `value`; callers: internal
- valueProblem(tables, value): string | undefined — validates struct/variant field count, closure captures, or extern type kind; callers: internal

## src/definition/values/declared-values.ts — Builds and reads struct, variant, `Optional`, `Result`, and `Error` `Value`s by declared field/variant name
- NamedFields — `Readonly<Record<string, Value>>`; [exp]; callers: 2 outside folder
- namedTypeOf(reference): TypeId | undefined — extracts `reference.type` when `reference.kind === 'named'`; [exp]; callers: 1 outside folder
- namedType(reference): TypeId — returns `namedTypeOf(reference)` or fails with `unreachable`; [exp]; callers: 1 outside folder
- fieldTypeOf(types, type, name): TypeReference — looks up declared `TypeReference` of field `name` on struct `type`; [exp]; callers: 1 outside folder
- typeArgumentOf(types, type, position): TypeId — returns `namedType` of type argument `position` on `types[type]`; [exp]; callers: 2 outside folder
- structOf(types, type, fields): Value — builds a `struct` `Value` ordering `fields` by `types[type].fields`; [exp]; callers: 2 outside folder
- fieldValueOf(types, candidate, name): Value — reads field `name` from struct `Value` `candidate` by declared field name; [exp]; callers: 6 outside folder
- variantOf(types, type, name, fields): Value — builds a `variant` `Value` for variant `name` of enum `type`; [exp]; callers: 1 outside folder
- optionalOf(types, type, value): Value — wraps `value` (or `undefined` as `None`) into optional union enum `type`; [exp]; callers: 2 outside folder
- optionalValueOf(types, optional): Value | undefined — unwraps optional union `Value`, returning `undefined` for `None`; [exp]; callers: 1 outside folder
- ErrorFields — `{ message: string, code: string, trace: string }`; [exp]; callers: 0 outside folder
- okTypeOf(types, result): TypeId — returns the `TypeId` of `Ok`'s `value` field in `Result` entry `result`; [exp]; callers: 1 outside folder
- okOf(types, result, value): Value — builds `Ok(value)` of `Result` entry `result`; [exp]; callers: 3 outside folder
- errOf(types, result, error): Value — builds `Err(error)` of `Result` entry `result`; [exp]; callers: 1 outside folder
- errorOf(types, result, fields): Value — builds `Err(Error{ message, code, trace })` of `Result` entry `result`; [exp]; callers: 3 outside folder
- inDeclaredOrder(declared, fields): Value[] — maps `declared` field names to `fields[name]` or fails with `unreachable`; callers: internal
- variantFieldType(types, type, variant, field): TypeReference — looks up declared `TypeReference` of `field` on `variant`; callers: internal
- variantShape(types, type, name) — finds variant index and declared fields of variant `name` in enum `type`; callers: internal
- variantFieldOf(types, value, name): Value — reads field `name` of variant `Value` `value`; callers: internal

## src/definition/values/equality.ts — Instantiates `ValueSemantics` over runtime `Value`s (`valuesEqual`, `mapOf`, in-place map mutations)
- MapValue — `MapOf<Value>`; [exp]; callers: 0 outside folder (test-only)
- valuesEqual(first, second): boolean — structural `==` over runtime `Value`s; [exp]; callers: 2 outside folder
- entryPosition(map, key): number | undefined — finds entry index of `key` in runtime `MapValue`; [exp]; callers: 1 outside folder
- entryValue(map, key): Value | undefined — looks up value of `key` in runtime `MapValue`; [exp]; callers: 1 outside folder
- mapOf(entries): MapOf<Value> — builds a runtime `MapValue` deduplicating equal keys in order; [exp]; callers: 2 outside folder (1 in folder)
- setEntryInPlace(map, key, value) — sets `key` to `value` in unshared `map`, preserving its hash table; [exp]; callers: 1 outside folder
- deleteEntryInPlace(map, key) — deletes `key` from unshared `map` and forgets its cached hash table; [exp]; callers: 1 outside folder
- copiedMap(map): MapOf<Value> — copies `map` and its cached hash bucket table; [exp]; callers: 1 outside folder
- forgetDerived(composite): void — evicts `composite`'s cached structural hash and map table; [exp]; callers: 1 outside folder
- sameHead(left, right): boolean — compares composite heads (handles by object id, externs by `samePayload`, variants by index, closures by fn); callers: internal
- headKey(value): string — formats composite head string for structural hashing; callers: internal

## src/definition/values/instance-handles.ts — Constructs and unwraps `Instance<T>` extern `Value` handles carrying an instance name string
- instanceHandle(type, name): Value — builds `{ kind: 'extern', type, payload: name }`; [exp]; callers: 1 outside folder
- instanceNameOf(handle): string — extracts string `payload` from an `Instance<T>` extern `Value`; [exp]; callers: 2 outside folder

## src/definition/values/json-values.ts — Locates `json.Json` in a Definition's type table and converts between `Json` `Value`s, JS values, and JSON text
- JsonType — `{ type: TypeId, variants: Record<JsonMember, number>, members: readonly JsonMember[] }`; [exp]; callers: 1 outside folder
- jsonTypeIn(types): JsonType | undefined — memoized lookup of the `role: 'json'` enum entry and its member variants; [exp]; callers: 2 outside folder
- jsonTypeOf(types): JsonType — returns `jsonTypeIn(types)` or fails with `unreachable`; [exp]; callers: 5 outside folder
- JsonError — `Error` subclass thrown when JSON text or JS value cannot convert to/from `json.Json`; [exp]; callers: 3 outside folder
- jsonText(json, shape): string — converts a `Json` `Value` to canonical JSON text; [exp]; callers: 2 outside folder
- jsonOfText(text, shape): Value — parses JSON text (up to `maximumDepth`) into a `Json` `Value`; [exp]; callers: 1 outside folder
- plainOfJson(json, shape, depth?): unknown — converts a `Json` `Value` to a host JS value (integers as bigints); [exp]; callers: 4 outside folder
- jsonOfPlain(plain, shape, depth?): Value — converts a host JS value to a `Json` `Value`; [exp]; callers: 4 outside folder
- isJsonValue(value, shape): boolean — true when `value` is a variant of `shape.type`; [exp]; callers: 2 outside folder
- findJsonType(types): JsonType | undefined — finds `hasRole(types, index, 'json')` and maps each variant's field type to `JsonMember`; callers: internal
- memberHolding(types, reference): JsonMember — identifies which `JsonMember` a union variant's field `TypeReference` holds; callers: internal
- unreadMessage(error): string — formats `NestingError` or parse error message for `JsonError`; callers: internal
- partsOf(json, shape, depth): [JsonMember, Value | undefined] — validates depth and extracts `[member, json.fields[0]]`; callers: internal

## src/definition/values/replacing.ts — Explicit-stack bottom-up composite `Value` rebuilder and deep copier
- replacingParts(value, replace): Value — rebuilds `value` replacing any composite where `replace(part)` returns a `Value`; [exp]; callers: 1 outside folder
- copied(value): Value — deep-clones all composites of `value` (`replacingParts(value, () => undefined)`); [exp]; callers: 1 outside folder

## src/definition/values/values.ts — Persisted `Value` zod codecs (`bigint` ints, tagged floats) and composite child/handle/depth traversal
- integer — zod codec between `int | bigint` on disk and `bigint` in memory; [exp]; callers: 2 outside folder
- Value — in-memory runtime/constant value union; [exp]; callers: 68 outside folder
- ValueOnDisk — on-disk JSON representation of `Value` with tagged `{ kind: 'float', value }`; [exp]; callers: 0 outside folder
- value: z.ZodType<Value, ValueOnDisk> — recursive zod codec for `Value`; [exp]; callers: 6 outside folder
- elementsOf(candidate): readonly Value[] — narrows `candidate` to `array` and returns `elements`; [exp]; callers: 5 outside folder
- mapValueOf(candidate): MapOf<Value> — narrows `candidate` to `map`; [exp]; callers: 3 outside folder
- CompositeValue — non-primitive `Value` union (`tuple`, `struct`, `variant`, `array`, `map`, `closure`, `extern`, `handle`); [exp]; callers: 6 outside folder
- samePayload(first, second): boolean — compares extern payloads by canonical JSON (`encodeJson`); [exp]; callers: 1 outside folder
- handleTo(object): Value — builds `{ kind: 'handle', object }`; [exp]; callers: 13 outside folder
- handleTarget(candidate): number | undefined — extracts `object` id from a `handle` `Value`; [exp]; callers: 9 outside folder
- closureOf(candidate): ClosureOf<Value> | undefined — narrows `candidate` to a `closure` `Value`; [exp]; callers: 7 outside folder
- isComposite(candidate): candidate is CompositeValue — true when `candidate !== null && typeof candidate === 'object'`; [exp]; callers: 6 outside folder
- childValues(composite): readonly Value[] — returns direct child `Value`s of `composite`; [exp]; callers: 5 outside folder
- withChildValues(composite, children): CompositeValue — rebuilds `composite` with replaced direct `children`; [exp]; callers: 1 outside folder
- maximumDepth: 256 — maximum persisted composite nesting depth; [exp]; callers: 2 outside folder
- handlesIn(contents): readonly number[] — returns deduplicated heap object IDs reachable in `contents` (memoized); [exp]; callers: 2 outside folder
- depthOf(candidate): number — returns nesting depth of `candidate` (0 for primitive, memoized for composites); [exp]; callers: 2 outside folder
- forgetSummary(composite): void — evicts `composite`'s cached `{ depth, handles }` summary after in-place mutation; [exp]; callers: 1 outside folder
- summaryOf(candidate): Summary — explicit-stack post-order computation of `{ depth, handles }` memoized in `summaries` WeakMap; callers: internal
- summaryOver(composite, parts): Summary — combines child `Summary` records for `composite`; callers: internal
- floatOnDisk(number): number | SpecialFloat — encodes `-0`, `NaN`, `±Infinity` as their `SpecialFloat` strings; callers: internal

## src/compiler/syntax/declarations/field-defaults.ts — Synthesizes `FieldsFunction`s for struct field defaults and enum variant constructors
- ConstructedVariant — `{ enumeration: EnumDeclaration, variant: Variant }`; [exp]; callers: 0 outside folder
- FieldsFunction — `FunctionDeclaration & { fieldsOwner: FieldsOwner }`; [exp]; callers: 3 outside folder
- functionsOf(module): readonly FunctionDeclaration[] — lists `declaredFunctions(module)` followed by `fieldsFunctionsOf` each item; [exp]; callers: 2 outside folder
- fieldsFunctionsOf(item): readonly FunctionDeclaration[] — returns synthesized `FieldsFunction`(s) for a struct or enum declaration; [exp]; callers: 1 outside folder
- isFieldsFunction(declaration): declaration is FieldsFunction — true when `'fieldsOwner' in declaration`; [exp]; callers: 6 outside folder
- constructedVariant(declaration): ConstructedVariant | undefined — returns `{ enumeration, variant }` if `declaration` is a variant constructor; [exp]; callers: 7
- takesArgumentsInOrder(declaration): boolean — false only for a struct's `FieldsFunction` (whose defaults needn't trail); [exp]; callers: 1 outside folder
- fieldsFunctionOf(declaration, variant?): FieldsFunction | undefined — memoized synthesis of `FieldsFunction` for a struct or variant; [exp]; callers: 10 outside folder
- declaredFunctionName(declaration): string — spells `name` or `Owner.name` (`staticName`) for a declared or fields function; [exp]; callers: 9 outside folder
- fieldsOwnerOf(declaration, variant): FieldsOwner | undefined — pairs struct or `(enumeration, variant)` into `FieldsOwner`; callers: internal
- fieldParameter(field): Parameter | Invalid — converts a `DeclaredField` into a `Parameter` (stripping any `&` on its type); callers: internal

## src/compiler/syntax/declarations/index.ts — Declaration AST nodes (`Module`, `FunctionDeclaration`, structs, enums, traits, aliases, imports) and helpers
- Docstring — `NodeOf<'Docstring'> & { value: string }`; [exp]; callers: 4 outside folder
- Documented — `{ doc?: Docstring }`; [exp]; callers: 2 outside folder
- TypeParameter — `NodeOf<'TypeParameter'>` (`variance`, `isPack`, `name`, `memberOf`, `constraints`, `defaultType`); [exp]; callers: 47 outside folder
- TypeParameters — `readonly (TypeParameter | Invalid)[]`; [exp]; callers: 8 outside folder
- typeParametersOf(parameters): readonly TypeParameter[] — filters `Invalid` nodes out of `TypeParameters`; [exp]; callers: 40 outside folder
- GenericDeclaration — union of the 7 declaration kinds taking `typeParameters`; [exp]; callers: 5 outside folder
- isGenericDeclaration(node): node is GenericDeclaration — true when `node.kind` is one of the 7 generic declaration kinds; [exp]; callers: 2 outside folder
- FunctionDeclaration — `NodeOf<'FunctionDeclaration'>` (`isExtern`, `qualifiers`, `mark`, `owner`, `name`, `typeParameters`, `parameters`); [exp]; callers: 95
- nestedFunctionSpan(declaration, body): AnchoredSpan — spans from `declaration.span` through `body.span`; [exp]; callers: 3 outside folder
- AssociatedType — `NodeOf<'AssociatedType'> & { name, type: AliasBody }`; [exp]; callers: 7 outside folder
- RequiredAssociatedType — `NodeOf<'RequiredAssociatedType'> & { name, memberOf, constraints }`; [exp]; callers: 10 outside folder
- StructDeclaration — `StructOf<'StructDeclaration'>`; [exp]; callers: 6 outside folder
- SharedStructDeclaration — `StructOf<'SharedStructDeclaration'>`; [exp]; callers: 2 outside folder
- DeclaredStruct — `StructDeclaration | SharedStructDeclaration`; [exp]; callers: 12 outside folder
- isDeclaredStruct(declaration): declaration is DeclaredStruct — true for `StructDeclaration` or `SharedStructDeclaration`; [exp]; callers: 3 outside folder
- DeclaredField — `NodeOf<'DeclaredField'> & { isRest, name, type, defaultValue }`; [exp]; callers: 5 outside folder
- Field — `DeclaredField | FieldDeclaration`; [exp]; callers: 6 outside folder
- hasDefault(field): boolean — true when `field` is a `DeclaredField` with `defaultValue !== undefined`; [exp]; callers: 4 outside folder
- isDefaultOf(holder, value): boolean — true when `value` is `holder.defaultValue` on a `Parameter` or `DeclaredField`; [exp]; callers: 2 outside folder
- isRestField(field): boolean — true when `field` is a `DeclaredField` with `isRest === true`; [exp]; callers: 3 outside folder
- ExternStructDeclaration — `NodeOf<'ExternStructDeclaration'> & { handle, name, typeParameters, fields, associatedTypes }`; [exp]; callers: 6 outside folder
- ExternConstantDeclaration — `NodeOf<'ExternConstantDeclaration'> & { name, type }`; [exp]; callers: 7 outside folder
- ContextConstantDeclaration — `NodeOf<'ContextConstantDeclaration'> & { name, type, initializer }`; [exp]; callers: 16 outside folder
- EnumDeclaration — `NodeOf<'EnumDeclaration'> & { name, typeParameters, variants, associatedTypes }`; [exp]; callers: 15 outside folder
- AliasDeclaration — `TypeAliasDeclaration | AssociatedType`; [exp]; callers: 11 outside folder
- AssociatingDeclaration — `DeclaredStruct | EnumDeclaration | ExternStructDeclaration`; [exp]; callers: 3 outside folder
- membersAsWritten(declaration): readonly (...)[] — merges fields/variants and `associatedTypes` sorted by `span.from`; [exp]; callers: 1 outside folder
- Variant — `NodeOf<'Variant'> & { name, fields }`; [exp]; callers: 8 outside folder
- TraitMember — `FunctionDeclaration | FieldDeclaration | RequiredAssociatedType`; [exp]; callers: 1 outside folder
- TraitDeclaration — `NodeOf<'TraitDeclaration'> & { name, typeParameters, members }`; [exp]; callers: 20 outside folder
- TypeAliasDeclaration — `NodeOf<'TypeAliasDeclaration'> & { name, typeParameters, type: AliasBody }`; [exp]; callers: 22 outside folder
- AliasBody — `TypeNode | TypeMatch`; [exp]; callers: 3 outside folder
- NamedImport — `NodeOf<'NamedImport'> & { names, isParenthesized, path }`; [exp]; callers: 2 outside folder
- ImportedName — `NodeOf<'ImportedName'> & { name, alias }`; [exp]; callers: 2 outside folder
- boundName({ name, alias }): Identifier — returns `alias ?? name` for an `ImportedName`; [exp]; callers: 3 outside folder
- importedNames(declaration): readonly ImportedName[] — filters `Invalid` nodes out of `NamedImport.names`; [exp]; callers: 4 outside folder
- NamespaceImport — `NodeOf<'NamespaceImport'> & { alias, path }`; [exp]; callers: 1 outside folder
- ImportDeclaration — `NamedImport | NamespaceImport`; [exp]; callers: 3 outside folder
- ConstantDeclaration — `VariableDeclaration & { isMutable: false, hold: undefined }`; [exp]; callers: 3 outside folder
- Declaration — union of all top-level declaration AST nodes; [exp]; callers: 19 outside folder
- Module — `NodeOf<'Module'> & { items: readonly (Declaration | Invalid)[] }`; [exp]; callers: 7 outside folder
- declaredFunctions(module): readonly FunctionDeclaration[] — filters `module.items` to `FunctionDeclaration`s; [exp]; callers: 4 outside folder
- DeclarationPart — `ImportedName | TypeParameter | Variant | DeclaredField | AssociatedType | RequiredAssociatedType | Docstring`; [exp]; callers: 2 outside folder
- listedMembers(declaration): readonly (DeclaredField | Variant | Invalid)[] — returns `variants` for `EnumDeclaration`, else `fields`; callers: internal

## src/compiler/syntax/declarations/methods.ts — Distinguishes `self` methods from variant constructors with a field named `self`
- isMethod(declaration): boolean — true when `!isFieldsFunction(declaration)` and first parameter is named `self`; [exp]; callers: 10 outside folder

## src/compiler/syntax/declarations/starts.ts — Projects a syntax `FunctionDeclaration` to `StartShape` and tests for `main`
- startShapeOf(declaration): StartShape — extracts `StartShape` from written `FunctionDeclaration`; [exp]; callers: 1 outside folder
- isMain(declaration): boolean — true when `declaration.name.text === 'main'` and `isMainShaped(startShapeOf(declaration))`; [exp]; callers: 4 outside folder

## src/compiler/syntax/expressions/arguments.ts — Unwraps call arguments and finds positional/spread arguments placed after a named argument
- misplacedArgument(callArguments): CallArgument | undefined — finds first positional/spread `CallArgument` after a `NamedArgument`; [exp]; callers: 2 outside folder
- givenOutOfOrder(items, givenAs): Item | undefined — finds first `'position'` item after a `'name'` item; [exp]; callers: 1 outside folder
- argumentValue(argument): Expression — unwraps `Spread.expression` or `NamedArgument.value`, else returns `argument`; [exp]; callers: 5 outside folder

## src/compiler/syntax/expressions/calls.ts — Call AST nodes (`Call`, `TypeApplication`, `NamedArgument`, `DeferredCall`, `Reference`)
- Call — `NodeOf<'Call'> & { callee, isOptional, arguments }`; [exp]; callers: 11 outside folder
- TypeApplication — `NodeOf<'TypeApplication'> & { target: Identifier | MemberAccess, typeArguments }`; [exp]; callers: 5 outside folder
- NamedArgument — `NodeOf<'NamedArgument'> & { name, value }`; [exp]; callers: 0 outside folder (1 in folder)
- CallArgument — `Expression | Spread | NamedArgument`; [exp]; callers: 5 outside folder
- DeferredCall — `NodeOf<'DeferredCall'> & { taker, call }`; [exp]; callers: 4 outside folder
- CallingNode — `Call | DeferredCall`; [exp]; callers: 12 outside folder
- Reference — `NodeOf<'Reference'> & { expression }`; [exp]; callers: 2 outside folder

## src/compiler/syntax/expressions/chains.ts — Decomposes optional-chain links (`?.`, `?->`, `?.[`, `?.(`) and tests whether an expression is chained
- LinkForm — `'.' | '->' | '[' | '('`; [exp]; callers: 1 outside folder
- OptionalOperator — `'?.' | '?->' | '?.[' | '?.('`; [exp]; callers: 0 outside folder
- ChainOperator — `'.' | '->' | '[' | OptionalOperator`; [exp]; callers: 0 outside folder
- optionalOperatorOf(form): OptionalOperator — maps `'.' | '->' | '[' | '('` to its `?`-prefixed operator; [exp]; callers: 2 outside folder
- linkOperator(form, isOptional): ChainOperator — returns `?`-prefixed operator when `isOptional`, else `form`; [exp]; callers: 2 outside folder
- ChainStep — `{ target: Expression, operator: ChainOperator }`; [exp]; callers: 1 outside folder
- isOptionalStep(step): boolean — true when `step.operator` starts with `'?'`; [exp]; callers: 3 outside folder
- chainStepOf(node): ChainStep | undefined — extracts `{ target, operator }` if `node` has a chain link's syntax shape; [exp]; callers: 6 outside folder
- isOptionallyChained(node): boolean — true when `node` or an ancestor link along `chainStepOf` has `isOptionalStep`; [exp]; callers: 0 outside folder (1 in folder)
- callStepOf(node): ChainStep | undefined — extracts chain step for `f?.()` or a method call's `MemberAccess` callee; callers: internal

## src/compiler/syntax/expressions/comparisons.ts — Reads a `ChainedComparison` or chaining `Binary` into `[left, operator, right]` `ComparisonLink`s
- ComparisonLink — `{ left: Expression, operator: ChainingOperator, right: Expression }`; [exp]; callers: 3 outside folder
- comparisonLinksOf(chain): readonly ComparisonLink[] — pairs adjacent operands of a `ChainedComparison`; [exp]; callers: 3 outside folder
- comparisonLinkOf(node): ComparisonLink | undefined — returns single `ComparisonLink` if `Binary.operator` is chaining; [exp]; callers: 3 outside folder
- linkSpan(link): AnchoredSpan — spans from `link.left.span` to `link.right.span`; [exp]; callers: 2 outside folder

## src/compiler/syntax/expressions/index.ts — Expression and ExpressionPart AST node interfaces and unions
- Spread — `NodeOf<'Spread'> & { expression }`; [exp]; callers: 12 outside folder
- ArrayLiteral — `NodeOf<'ArrayLiteral'> & { elements: readonly (Expression | Spread)[] }`; [exp]; callers: 11 outside folder
- MapLiteral — `NodeOf<'MapLiteral'> & { entries: readonly (MapEntry | Spread | Invalid)[] }`; [exp]; callers: 11 outside folder
- MapEntry — `NodeOf<'MapEntry'> & { key, value }`; [exp]; callers: 5 outside folder
- Comprehension — `NodeOf<'Comprehension'> & { targets, iterable, condition, body }`; [exp]; callers: 14 outside folder
- FieldHeader — `NodeOf<'FieldHeader'> & { key, value, subject }`; [exp]; callers: 17 outside folder
- FieldComprehension — `NodeOf<'FieldComprehension'> & { header: FieldHeader, body }`; [exp]; callers: 5 outside folder
- StructComprehension — `NodeOf<'StructComprehension'> & { header: FieldHeader, key, value }`; [exp]; callers: 7 outside folder
- Tuple — `NodeOf<'Tuple'> & { elements }`; [exp]; callers: 2 outside folder
- StructLiteral — `NodeOf<'StructLiteral'> & { type: NamedType | undefined, items }`; [exp]; callers: 8 outside folder
- NewStructLiteral — `NodeOf<'NewStructLiteral'> & { type: NamedType, items }`; [exp]; callers: 3 outside folder
- FieldsLiteral — `StructLiteral | NewStructLiteral`; [exp]; callers: 14 outside folder
- FieldInitializer — `NodeOf<'FieldInitializer'> & { name, value }`; [exp]; callers: 2 outside folder
- FieldItem — `FieldInitializer | PositionalInitializer`; [exp]; callers: 3 outside folder
- QuotedEntry — `NodeOf<'QuotedEntry'> & { key: StringLiteral, value }`; [exp]; callers: 1 outside folder
- IndentedItem — `NodeOf<'IndentedItem'> & { value: Expression | Spread }`; [exp]; callers: 2 outside folder
- IndentedEntry — `FieldInitializer | QuotedEntry | Spread | StructComprehension | IndentedItem | Invalid`; [exp]; callers: 4 outside folder
- IndentedValue — `NodeOf<'IndentedValue'> & { type, entries, isNew }`; [exp]; callers: 12 outside folder
- ParameterBinding — `{ name: Identifier, pattern: Pattern | undefined } | { name: undefined, pattern: Pattern }`; [exp]; callers: 1 outside folder
- Parameter — `NodeOf<'Parameter'> & { isRest, type, defaultValue } & ParameterBinding`; [exp]; callers: 16 outside folder
- Lambda — `NodeOf<'Lambda'> & { qualifiers, name, parameters, returnType, body }`; [exp]; callers: 19 outside folder
- TupleElement — `NodeOf<'TupleElement'> & { target, isOptional, element }`; [exp]; callers: 3 outside folder
- MemberAccess — `NodeOf<'MemberAccess'> & { target, isOptional, member }`; [exp]; callers: 20 outside folder
- Index — `NodeOf<'Index'> & { target, isOptional, index }`; [exp]; callers: 9 outside folder
- Propagate — `NodeOf<'Propagate'> & { operand }`; [exp]; callers: 3 outside folder
- Unwrap — `NodeOf<'Unwrap'> & { operand }`; [exp]; callers: 3 outside folder
- Dereference — `NodeOf<'Dereference'> & { operator: '*' | '->', operand, isOptional }`; [exp]; callers: 4 outside folder
- Unary — `NodeOf<'Unary'> & { operator: UnaryOperator, operand }`; [exp]; callers: 5 outside folder
- Await — `NodeOf<'Await'> & { operand }`; [exp]; callers: 3 outside folder
- Binary — `NodeOf<'Binary'> & { left, operator: BinaryOperator, right }`; [exp]; callers: 6 outside folder
- ChainedComparison — `NodeOf<'ChainedComparison'> & { operands, operators }`; [exp]; callers: 4 outside folder
- Is — `NodeOf<'Is'> & { subject, pattern }`; [exp]; callers: 3 outside folder
- Range — `NodeOf<'Range'> & { start, isInclusive, end, step }`; [exp]; callers: 4 outside folder
- TemplateLiteral — `NodeOf<'TemplateLiteral'> & { tag, texts, values }`; [exp]; callers: 5 outside folder
- If — `NodeOf<'If'> & { branches, elseClause }`; [exp]; callers: 4 outside folder
- ConditionalBranch — `NodeOf<'ConditionalBranch'> & { condition, body }`; [exp]; callers: 5 outside folder
- Match — `NodeOf<'Match'> & { subject, cases }`; [exp]; callers: 3 outside folder
- MatchCase — `NodeOf<'MatchCase'> & { pattern, guard, body }`; [exp]; callers: 3 outside folder
- ElseClause — `NodeOf<'ElseClause'> & { body }`; [exp]; callers: 1 outside folder
- Select — `NodeOf<'Select'> & { awaits, cases, elseClause }`; [exp]; callers: 3 outside folder
- SelectCase — `NodeOf<'SelectCase'> & { future, binding, body }`; [exp]; callers: 9 outside folder
- Expression — union of all expression AST nodes; [exp]; callers: 113 outside folder
- ExpressionPart — union of sub-expression AST nodes (`Spread`, `NamedArgument`, `MapEntry`, `Parameter`, etc.); [exp]; callers: 3 outside folder

## src/compiler/syntax/expressions/literals/built-types.ts — Identifies the `NamedType` a struct or indented literal builds and whether it uses `new`
- NamingLiteral — `StructLiteral | NewStructLiteral | IndentedValue`; [exp]; callers: 0 outside folder
- literalNaming(holder, type): NamingLiteral | undefined — returns `holder` when `type` is the `NamedType` `holder` builds; [exp]; callers: 4 outside folder
- buildsShared(literal): boolean — true for `NewStructLiteral` or `IndentedValue` with `isNew: true`; [exp]; callers: 1 outside folder

## src/compiler/syntax/expressions/literals/indented-values.ts — Desugars an `IndentedValue` into its `StructLiteral`, `NewStructLiteral`, `MapLiteral`, or `ArrayLiteral`
- LiteralForm — `'struct' | 'map' | 'array'`; [exp]; callers: 1 outside folder
- BuiltLiteral — `StructLiteral | NewStructLiteral | MapLiteral | ArrayLiteral`; [exp]; callers: 5 outside folder
- isItem(entry): boolean — true when `entry.kind === 'IndentedItem'`; [exp]; callers: 1 outside folder
- isKeyed(entry): boolean — true when `entry` is neither `IndentedItem` nor `Invalid`; [exp]; callers: 1 outside folder
- untypedForm(value): LiteralForm — infers `'array'`, `'map'`, or `'struct'` when no expected type guides `value`; [exp]; callers: 1 outside folder
- literalOf(value, form): LiteralsByForm[Form] — memoized conversion of `IndentedValue` into the literal of `form`; [exp]; callers: 1 outside folder
- bareKeyOf(entry): StringLiteral — memoized synthetic `StringLiteral` for a map's bare `FieldInitializer` key; [exp]; callers: 1 outside folder
- entriesLeftOut(value, form): readonly IndentedEntry[] — lists non-`Invalid` entries incompatible with `form`; [exp]; callers: 1 outside folder
- isStructItem(entry): entry is StructItem — true for `FieldInitializer`, `Spread`, `StructComprehension`, `Invalid`; callers: internal

## src/compiler/syntax/expressions/literals/literals.ts — Primitive and duration `Literal` AST node interfaces
- DurationLiteral — `NodeOf<'DurationLiteral'> & { value: bigint }`; [exp]; callers: 2 outside folder
- StringLiteral — `NodeOf<'StringLiteral'> & { value: string }`; [exp]; callers: 13 outside folder
- Literal — `IntegerLiteral | FloatLiteral | DurationLiteral | StringLiteral | BooleanLiteral | NoneLiteral`; [exp]; callers: 5 outside folder

## src/compiler/syntax/expressions/literals/numbers.ts — Reads a numeric literal or negated numeric literal (`-5`, `-(5)`) as one signed number
- SignedNumber — `{ kind: 'IntegerLiteral', value: bigint } | { kind: 'FloatLiteral', value: number }`; [exp]; callers: 0 outside folder
- signedNumberOf(node): SignedNumber | undefined — returns signed integer/float for literal or `-` unary over literal; [exp]; callers: 5 outside folder

## src/compiler/syntax/expressions/literals/templates.ts — Reads a constant template's text or synthesizes the memoized `Call` of a tagged template
- TaggedTemplate — `TemplateLiteral & { readonly tag: Expression }`; [exp]; callers: 0 outside folder
- isTagged(template): template is TaggedTemplate — true when `template.tag !== undefined`; [exp]; callers: 4 outside folder
- constantTextOf(template): string | undefined — returns `texts[0].value` when untagged and without interpolations; [exp]; callers: 3 outside folder
- taggedCall(template): Call — memoized synthetic `Call` `tag([texts...], ...values)` for a tagged template; [exp]; callers: 4 outside folder

## src/compiler/syntax/expressions/operators.ts — Precedence, associativity, semantic meaning, and mixing rules for all unary, binary, and assignment operators
- PrecedenceLevel — union of 15 operator precedence levels from `'coalesce'` to `'postfix'`; [exp]; callers: 4 outside folder
- Relation — `'less' | 'lessOrEqual' | 'greater' | 'greaterOrEqual'`; [exp]; callers: 3 outside folder
- BinaryMeaning — discriminated union of binary operator semantics (`call`, `order`, `equality`, `logic`, `coalesce`, `membership`); [exp]; callers: 1 outside folder
- BinaryOperatorEntry — `{ level, associativity?, meaning, refusesUnparenthesized?, refusesPrefixedLeft? }`; [exp]; callers: 1 outside folder
- binaryOperators — table of all binary operators with `level`, `associativity`, `meaning`, `refusesUnparenthesized`; [exp]; callers: 11 outside folder
- BinaryOperator — `keyof typeof binaryOperators`; [exp]; callers: 4 outside folder
- ComparisonOperator — ordering and equality binary operators; [exp]; callers: 1 outside folder
- ChainingOperator — comparison and membership (`in`, `not in`) operators; [exp]; callers: 0 outside folder (2 in folder)
- ImplicitOperator — ordering (`compare`) and membership (`includes`) operators; [exp]; callers: 2 outside folder
- unaryOperators — table of `-`, `~`, `not` with `level` and `meaning`; [exp]; callers: 5 outside folder
- UnaryOperator — `keyof typeof unaryOperators`; [exp]; callers: 4 outside folder
- CallingBinaryOperator — binary operators whose meaning is `call`; [exp]; callers: 1 outside folder
- CallingUnaryOperator — unary operators (`-`, `~`) whose meaning is `call`; [exp]; callers: 1 outside folder
- operatorLevels — precedence levels for `await`, `deferredCall`, `dereference`, `reference`, `is`, `range`; [exp]; callers: 3 outside folder
- AssignmentOperator — `'='` and compound assignment token kinds; [exp]; callers: 1 outside folder
- CompoundAssignment — `Exclude<AssignmentOperator, '='>`; [exp]; callers: 1 outside folder
- isAssignmentOperator(kind): kind is AssignmentOperator — true for `=` and compound assignment tokens; [exp]; callers: 1 outside folder
- compoundOperator(assignment): BinaryOperator — strips trailing `=` from a compound assignment token; [exp]; callers: 1 outside folder
- isComparisonOperator(kind): kind is ComparisonOperator — true for ordering and equality operators; [exp]; callers: 1 outside folder
- isChainingOperator(kind): kind is ChainingOperator — true for comparison and membership (`in`, `not in`) operators; [exp]; callers: 1 outside folder
- isImplicitOperator(kind): kind is ImplicitOperator — true for ordering (`compare`) and membership (`includes`) operators; [exp]; callers: 2 outside folder
- tighterLevel(level): PrecedenceLevel — returns the next tighter `PrecedenceLevel`; [exp]; callers: 2 outside folder
- rightOperandLevel(operator): PrecedenceLevel — precedence level for parsing `operator`'s right operand; [exp]; callers: 1 outside folder
- bindingPower(level): number — numeric 1-based binding power of `level`; [exp]; callers: 2 outside folder

## src/compiler/syntax/expressions/parameters.ts — Reads a `Parameter`'s diagnostic site, bound names, pattern-named type, defaults, and `&` reference syntax
- parameterSite(parameter): Identifier | Pattern — returns `parameter.name ?? parameter.pattern`; [exp]; callers: 3 outside folder
- parameterNames(parameter): readonly Identifier[] — lists `targetNames(pattern)` plus `parameter.name`; [exp]; callers: 1 outside folder
- patternNamedType(parameter): NamedType | undefined — returns `typingPattern(parameter)?.type`; [exp]; callers: 2 outside folder
- defaultValuesOf(parameters): readonly Expression[] — collects `defaultValue` expressions of valid `Parameter`s in order; [exp]; callers: 3 outside folder
- writesType(parameter): boolean — true when `parameter` has a type annotation or a pattern naming a type; [exp]; callers: 1 outside folder
- typingPattern(parameter): StructPattern | undefined — unwraps parentheses on `parameter.pattern` and narrows to `StructPattern`; [exp]; callers: 1 outside folder
- writtenByReference(node): boolean — true when `unparenthesizedType(node.type)` is a `ReferenceType`; [exp]; callers: 4 outside folder

## src/compiler/syntax/expressions/places.ts — Decomposes an expression into a `PlacePath` (`{ root, steps }`) and checks if it is a valid place
- PlaceStep — `MemberAccess | TupleElement | Index`; [exp]; callers: 3 outside folder
- PlacePath — `{ root: Expression, steps: readonly PlaceStep[] }`; [exp]; callers: 0 outside folder
- isPlace(node): boolean — true when `placePath(node).root` is an `Identifier`, `Missing`, or non-optionally-chained `Dereference`; [exp]; callers: 3 outside folder
- placePath(node): PlacePath — strips non-optional member/tuple/index accesses from `node` into `{ root, steps }`; [exp]; callers: 3 outside folder

## src/compiler/syntax/expressions/readings.ts — Semantic readings of struct items, qualified paths, calls/deferred calls, parentheses, cases, and item literals
- itemValue(item): Expression — returns `item.value ?? item.name` for a `FieldItem`; [exp]; callers: 7 outside folder
- itemName(item): Identifier | undefined — returns `item.name` for `FieldInitializer`, `undefined` for positional; [exp]; callers: 4 outside folder
- qualifiedPath(expression): QualifiedName | undefined — reads an `Identifier` + non-optional `MemberAccess` chain as `Identifier[]`; [exp]; callers: 6 outside folder
- isTakerShaped(expression): boolean — true when `expression` is a `qualifiedPath` or non-optional `Call` of one; [exp]; callers: 1 outside folder
- calledName(node): Expression — returns the callee/taker expression of a `CallingNode` stripped of call `TypeApplication`; [exp]; callers: 11 outside folder
- callTypeArguments(node): readonly TypeNode[] | undefined — returns type arguments of a non-optional `Call`'s `TypeApplication`; [exp]; callers: 1 outside folder
- writtenArgumentsOf(node): readonly CallArgument[] — returns written parenthesized arguments of a `Call` or `DeferredCall` taker; [exp]; callers: 4 outside folder
- callsThroughOptional(node): boolean — true when `node` is a `Call` with `isOptional: true`; [exp]; callers: 3 outside folder
- callOfCallee(node, holders): CallingNode | undefined — finds the `CallingNode` that `node` is the callee/taker of; [exp]; callers: 3 outside folder
- makerOf(call, holders): CallingNode — returns enclosing `DeferredCall` when `call` is its taker, else `call`; [exp]; callers: 3 outside folder
- deferredOf(node): CallingNode | undefined — unwraps parentheses on `node.call` and narrows to `CallingNode`; [exp]; callers: 4 outside folder
- unparenthesized(node): Expression — strips outer `Parenthesized` nodes from `node`; [exp]; callers: 16 outside folder
- casesOf(node): readonly MatchCase[] — filters `Invalid` nodes out of `Match.cases`; [exp]; callers: 5 outside folder
- selectCasesOf(node): readonly SelectCase[] — filters `Invalid` nodes out of `Select.cases`; [exp]; callers: 4 outside folder
- isItemsLiteral(node): boolean — true for tuple, array, map, or untyped struct/indented literal (parentheses aside); [exp]; callers: 1 outside folder

## src/compiler/syntax/items.ts — Item placement rules (`allowedInModule`, `allowedInBlock`, `moduleItemWords`) and `Annotation` node model
- Item — `Declaration | Statement`; [exp]; callers: 1 outside folder
- moduleItemWords — words that may start a module-level item; [exp]; callers: 1 outside folder
- allowedInModule(item): item is Declaration — true for declarations, non-mutable/non-held `const`, and top-level `fn`; [exp]; callers: 1 outside folder
- allowedInBlock(item): item is Statement — true for statements, local `fn` (non-extern, non-static), and `const`; [exp]; callers: 1 outside folder
- Annotation — `NodeOf<'Annotation'> & { value: Expression }`; [exp]; callers: 8 outside folder
- Annotatable — `{ annotations?: readonly Annotation[] }`; [exp]; callers: 10 outside folder
- placeOf(item): Place — classifies each `Item` kind as `'module'`, `'block'`, or `'both'`; callers: internal

## src/compiler/syntax/patterns.ts — Pattern AST nodes, `patternHead`, `unparenthesizedPattern`, and target leaf extraction (`targetNames`, `hasUnnamedPart`)
- WildcardPattern — `NodeOf<'WildcardPattern'>`; [exp]; callers: 3 outside folder
- NamePattern — `NodeOf<'NamePattern'> & { path: QualifiedName, typeArguments }`; [exp]; callers: 9 outside folder
- LiteralPattern — `NodeOf<'LiteralPattern'> & { value: Literal | Unary }`; [exp]; callers: 6 outside folder
- StructPattern — `NodeOf<'StructPattern'> & { type, isShort, fields, rest }`; [exp]; callers: 12 outside folder
- VariantCallPattern — `NodeOf<'VariantCallPattern'> & { callee: NamedType, arguments }`; [exp]; callers: 8 outside folder
- PatternArgument — `Pattern | RestPattern | NamedPatternArgument | OtherFieldsPattern`; [exp]; callers: 5 outside folder
- NamedPatternArgument — `NodeOf<'NamedPatternArgument'> & { name, pattern }`; [exp]; callers: 1 outside folder
- OtherFieldsPattern — `NodeOf<'OtherFieldsPattern'>`; [exp]; callers: 1 outside folder
- BindFieldPattern — `NodeOf<'BindFieldPattern'> & { field, alias }`; [exp]; callers: 1 outside folder
- CompareFieldPattern — `NodeOf<'CompareFieldPattern'> & { field, operator, value }`; [exp]; callers: 3 outside folder
- OrPattern — `NodeOf<'OrPattern'> & { alternatives }`; [exp]; callers: 1 outside folder
- ArrayPattern — `NodeOf<'ArrayPattern'> & { elements: readonly (Pattern | RestPattern)[] }`; [exp]; callers: 2 outside folder
- RestPattern — `NodeOf<'RestPattern'> & { target: Identifier | WildcardPattern }`; [exp]; callers: 7 outside folder
- RangePattern — `NodeOf<'RangePattern'> & { start, isInclusive, end }`; [exp]; callers: 2 outside folder
- AsPattern — `NodeOf<'AsPattern'> & { pattern, name }`; [exp]; callers: 1 outside folder
- Pattern — union of all pattern AST nodes; [exp]; callers: 28 outside folder
- PatternPart — union of sub-pattern AST nodes (`BindFieldPattern`, `CompareFieldPattern`, `RestPattern`, etc.); [exp]; callers: 8 outside folder
- HeadedPattern — `NamePattern | StructPattern | VariantCallPattern`; [exp]; callers: 2 outside folder
- isTakingApart(node): boolean — true when `node.kind` is `'StructPattern'` or `'VariantCallPattern'`; [exp]; callers: 2 outside folder
- patternHead(node): NamePattern | NamedType | undefined — returns `NamePattern`, `StructPattern.type`, or `VariantCallPattern.callee`; [exp]; callers: 5 outside folder
- unparenthesizedPattern(node): Pattern — strips outer `ParenthesizedPattern` nodes from `node`; [exp]; callers: 1 outside folder
- targetNames(node): readonly Identifier[] — lists `Identifier`s bound by a target pattern in source order; [exp]; callers: 9 outside folder
- hasUnnamedPart(node): boolean — true when target pattern contains a `WildcardPattern` (`_`); [exp]; callers: 2 outside folder

## src/compiler/syntax/statements/index.ts — Statement and `Block` AST node interfaces and unions (`VariableDeclaration`, `Assignment`, loops, `Hold`, `Drop`)
- Block — `NodeOf<'Block'> & { statements: readonly (Statement | Invalid)[] }`; [exp]; callers: 28 outside folder
- VariableDeclaration — `NodeOf<'VariableDeclaration'> & { hold, isMutable, targets, type, initializer }`; [exp]; callers: 23 outside folder
- Hold — `NodeOf<'Hold'> & { label: Identifier | undefined }`; [exp]; callers: 6 outside folder
- Assignment — `NodeOf<'Assignment'> & { targets, operator, value }`; [exp]; callers: 8 outside folder
- Return — `NodeOf<'Return'> & { value: Expression | undefined }`; [exp]; callers: 5 outside folder
- Break — `NodeOf<'Break'> & { label: Identifier | undefined }`; [exp]; callers: 5 outside folder
- Continue — `NodeOf<'Continue'> & { label: Identifier | undefined }`; [exp]; callers: 5 outside folder
- For — `NodeOf<'For'> & { label, targets, iterable, body }`; [exp]; callers: 12 outside folder
- FieldLoop — `NodeOf<'FieldLoop'> & { label, header: FieldHeader, body }`; [exp]; callers: 3 outside folder
- While — `NodeOf<'While'> & { label, condition, body }`; [exp]; callers: 5 outside folder
- LabelledBlock — `NodeOf<'LabelledBlock'> & { label, body }`; [exp]; callers: 2 outside folder
- Loop — `For | FieldLoop | While`; [exp]; callers: 3 outside folder
- LabelledScope — `Loop | LabelledBlock`; [exp]; callers: 11 outside folder
- Drop — `NodeOf<'Drop'> & { value: Expression }`; [exp]; callers: 3 outside folder
- Statement — union of all statement AST nodes; [exp]; callers: 20 outside folder
- StatementPart — `Hold`; [exp]; callers: 2 outside folder

## src/compiler/syntax/statements/readings.ts — Reads `drop` target identifier, field-pass constructs (`OverFields`), and a `Block`'s tail expression/node
- droppedName(node): Identifier | undefined — returns `Identifier` inside `drop x` (parentheses aside), else `undefined`; [exp]; callers: 3 outside folder
- OverFields — `FieldLoop | FieldComprehension | StructComprehension`; [exp]; callers: 2 outside folder
- isOverFields(node): node is OverFields — true for `FieldLoop`, `FieldComprehension`, `StructComprehension`; [exp]; callers: 1 outside folder
- passedParts(node): readonly (Block | Expression)[] — returns body or `[key, value]` checked per field pass; [exp]; callers: 1 outside folder
- tailExpressionOf(block): Expression | undefined — returns expression of `block`'s last statement if `ExpressionStatement`; [exp]; callers: 3 outside folder
- tailNodeOf(block): NodeOf<string> — returns `tailExpressionOf(block) ?? block.statements.at(-1) ?? block`; [exp]; callers: 1 outside folder

## src/compiler/syntax/statements/targets.ts — Assignment destructuring decomposition (`destructuringOf`, `isTarget`) and `declaredTargets` of a `TargetOwner`
- Destructuring<Target> — `{ kind: 'tuple', elements, span } | { kind: 'struct', type, items, span }`; [exp]; callers: 2 outside folder
- FieldTarget<Target> — `{ name: Identifier | undefined, span, target }`; [exp]; callers: 2 outside folder
- destructuringOf(target): Destructuring<Expression> | undefined — decomposes tuple or struct-literal assignment target; [exp]; callers: 1 outside folder
- isTarget(target): boolean — true when `target` is a valid place or recursive tuple/struct destructuring of targets; [exp]; callers: 1 outside folder
- destructures(target): boolean — true when `destructuringOf(target) !== undefined`; [exp]; callers: 2 outside folder
- isUnnamedTarget(target): boolean — true when `unparenthesized(target)` is `_`; [exp]; callers: 1 outside folder
- hasUnnamedTarget(target): boolean — true when `target` is or destructures into `_`; [exp]; callers: 2 outside folder
- targetParts(target): readonly Expression[] — direct child target expressions of a destructuring target; [exp]; callers: 1 outside folder
- TargetOwner — `VariableDeclaration | For | Comprehension | FieldHeader | Parameter`; [exp]; callers: 1 outside folder
- ownsTargets(node): node is Extract<Node, TargetOwner> — true when `node` is a `TargetOwner`; [exp]; callers: 1 outside folder
- declaredTargets(owner): readonly Pattern[] — returns pattern targets declared by `owner`; [exp]; callers: 3 outside folder

## src/compiler/syntax/tokens/grammar-words.ts — Words each grammar position starts or continues with (`declarationWords`, `statementWords`, `operandWords`, etc.)
- Word — `Keyword | ContextualWord`; [exp]; callers: 4 outside folder
- declarationWords — words starting a module-only declaration; [exp]; callers: 1 outside folder
- DeclarationWord — `(typeof declarationWords)[number]`; [exp]; callers: 2 outside folder
- statementWords — words starting a statement; [exp]; callers: 2 outside folder
- StatementWord — `(typeof statementWords)[number]`; [exp]; callers: 2 outside folder
- operandWords — words starting an expression operand; [exp]; callers: 1 outside folder
- OperandWord — `(typeof operandWords)[number]`; [exp]; callers: 1 outside folder
- infixWords — words continuing after an operand (`and`, `or`, `in`, `not`, `is`); [exp]; callers: 1 outside folder
- InfixWord — `(typeof infixWords)[number]`; [exp]; callers: 1 outside folder
- clauseWordsAfterOperand — `['by']`; [exp]; callers: 1 outside folder
- typeWords — words starting a type; [exp]; callers: 1 outside folder
- TypeWord — `(typeof typeWords)[number]`; [exp]; callers: 2 outside folder
- PatternWord — `'struct' | 'true' | 'false' | 'none'`; [exp]; callers: 2 outside folder
- followers — map of modifier word to allowed following words; [exp]; callers: 2 outside folder
- Modifier — `keyof typeof followers`; [exp]; callers: 1 outside folder
- topLevelFollowers — `{ ista: ['const'] }` for top-level `ista const`; [exp]; callers: 1 outside folder
- KeywordModifier — modifiers in `followers` followed only by reserved keywords; [exp]; callers: 1 outside folder
- varianceMarkers — `['gives', 'takes']`; [exp]; callers: 1 outside folder
- VarianceMarker — `'gives' | 'takes'`; [exp]; callers: 4 outside folder

## src/compiler/syntax/tokens/index.ts — Reserved keywords, punctuators, contextual words, and `Token`/`Comment`/`ScanResult` types
- keywords — tuple of 31 reserved keywords; [exp]; callers: 1 outside folder
- punctuators — tuple of 52 punctuator tokens; [exp]; callers: 1 outside folder
- ContextualWord — union of the 14 contextual words; [exp]; callers: 2 outside folder
- isContextualWord(word): word is ContextualWord — true for the 14 contextual words; [exp]; callers: 1 outside folder
- Keyword — `(typeof keywords)[number]`; [exp]; callers: 1 outside folder
- Punctuator — `(typeof punctuators)[number]`; [exp]; callers: 1 outside folder
- TokenKind — `Keyword | Punctuator | LiteralKind | 'identifier' | 'unknown' | 'end'`; [exp]; callers: 7 outside folder
- Token — discriminated union of scanned tokens with `span` and `firstOnLine`; [exp]; callers: 19 outside folder
- TemplateValue — `{ span: Span, tokens: readonly Token[] }` for a template `${…}` interpolation; [exp]; callers: 4 outside folder
- Comment — `{ span: Span }` for a `#` comment; [exp]; callers: 4 outside folder
- ScanResult — `{ tokens, comments, diagnostics }`; [exp]; callers: 4 outside folder
- isKeyword(word): word is Keyword — true when `word` is in `keywords`; [exp]; callers: 9 outside folder

## src/compiler/syntax/tokens/modifiers.ts — Head modifier groups, `HeadForm`s, `FunctionQualifiers`, `awaits`, and canonical modifier printing
- modifierGroups — `{ extern, handle, shared, send, kind, async }` in print order; [exp]; callers: 0 outside folder (1 in folder, 2 in tests)
- ModifierGroup — `keyof typeof modifierGroups`; [exp]; callers: 1 outside folder
- ModifierWord<Group> — word belonging to `modifierGroups[Group]`; [exp]; callers: 4 outside folder
- Modifiers — `{ readonly [Group in ModifierGroup]?: ModifierWord<Group> }`; [exp]; callers: 2 outside folder
- FunctionQualifiers — `{ send, kind, async }`; [exp]; callers: 6 outside folder
- unqualified: FunctionQualifiers — `{ send: undefined, kind: undefined, async: undefined }`; [exp]; callers: 1 outside folder
- awaits(qualifiers): boolean — true when `qualifiers.async !== undefined`; [exp]; callers: 16 outside folder
- isModifierWord(word): word is ModifierWord — true when `word` is in any `modifierGroups` entry; [exp]; callers: 3 outside folder
- HeadForm — `{ keyword: 'fn' | 'struct' | 'const', groups, name }`; [exp]; callers: 3 outside folder
- headForms — table of `HeadForm` descriptors (`function`, `requirement`, `lambda`, `functionType`, structs, `contextConstant`); [exp]; callers: 7 outside folder
- groupIn(form, word): ModifierGroup | undefined — returns the group in `form` that accepts `word`; [exp]; callers: 2 outside folder
- followersIn(form, word): readonly (Keyword | ContextualWord)[] — words that may follow `word` in `form` in print order; [exp]; callers: 1 outside folder
- startsOf(form): readonly (...)[] — keyword and all modifier words that may start `form`; [exp]; callers: 1 outside folder
- qualifiersOf(modifiers): FunctionQualifiers — extracts `{ send, kind, async }` from `Modifiers`; [exp]; callers: 3 outside folder
- modifiersText(modifiers, mark?): string — formats `modifiers` (and optional named `mark`) in print order with trailing spaces; [exp]; callers: 5 outside folder
- modifiersAroundMark(modifiers): readonly [string, string] — formats modifier text before and after the `kind` slot; [exp]; callers: 1 outside folder

## src/compiler/syntax/tree/index.ts — `SyntaxNode`/`SyntaxTree` contracts and generic field-derived child, parent, ancestor, extent, and offset queries
- SyntaxNode — union of all AST node interfaces; [exp]; callers: 67 outside folder
- SyntaxTree — `{ source, root, bodies, bases, comments, diagnostics }`; [exp]; callers: 42 outside folder
- TreeBodies — `Pick<SyntaxTree, 'bodies'>`; [exp]; callers: 0 outside folder (test-only)
- TreePlaces — `Pick<SyntaxTree, 'bodies' | 'bases'>`; [exp]; callers: 0 outside folder (test-only)
- bodyOf(tree, declaration): Block | undefined — looks up `declaration`'s body in `tree.bodies`; [exp]; callers: 7 outside folder
- isNode(value): value is SyntaxNode — true when `value` is an object with `kind` and `span`; [exp]; callers: 1 outside folder
- childrenOf(tree, node): readonly SyntaxNode[] — returns `fieldChildrenOf(node)` plus `bodyOf(tree, node)` for a `FunctionDeclaration`; [exp]; callers: 8 outside folder
- fieldChildrenOf(node): readonly SyntaxNode[] — memoized extraction of child nodes from `node`'s fields, sorted within segment; [exp]; callers: 5 outside folder
- parentOf(tree, node): SyntaxNode | undefined — memoized parent lookup in `tree`; [exp]; callers: 16 outside folder
- ancestorsOf(tree, node): readonly SyntaxNode[] — returns `[node, ...parents]` innermost first; [exp]; callers: 5 outside folder
- nodesUnder(tree, node): readonly SyntaxNode[] — explicit-stack pre-order list of `node` and all descendants in `tree`; [exp]; callers: 9 outside folder
- nodesAt(tree, offset): readonly SyntaxNode[] — descends `tree` from root to innermost node whose `extentIn` contains `offset`; [exp]; callers: 11 outside folder
- extentIn(tree, node): Span — `SequenceMemo`-cached text `Span` covering `node` and all its children/body/members; [exp]; callers: 12 outside folder
- nestsFunction(node): node is Lambda | FunctionDeclaration — true for `Lambda` or `FunctionDeclaration`; [exp]; callers: 2 outside folder
- bodyChildrenOf(node): readonly SyntaxNode[] — returns direct children that execute in the enclosing body (skipping nested fns/deferred calls); [exp]; callers: 2
- parentsIn(tree): ReadonlyMap<SyntaxNode, SyntaxNode> — builds child -> parent map over `nodesUnder(tree, tree.root)`; callers: internal

## src/compiler/syntax/tree/node.ts — Base `NodeOf<Kind>`, `Identifier`, `QualifiedName`, `Missing`, and `Invalid` node shapes
- NodeOf<Kind> — `{ readonly kind: Kind, readonly span: AnchoredSpan }`; [exp]; callers: 41 outside folder
- Identifier — `NodeOf<'Identifier'> & { text: string }`; [exp]; callers: 94 outside folder
- QualifiedName — `readonly [Identifier, ...Identifier[]]`; [exp]; callers: 6 outside folder
- lastName(path): Identifier — returns last `Identifier` of a `QualifiedName`; [exp]; callers: 17 outside folder
- isMissingName(name): boolean — true when `name.text === ''`; [exp]; callers: 17 outside folder
- Missing — `NodeOf<'Missing'>`; [exp]; callers: 7 outside folder
- Invalid — `NodeOf<'Invalid'> & Annotatable`; [exp]; callers: 47 outside folder

## src/compiler/syntax/tree/positions.ts — Segment-anchored spans (`AnchoredSpan`) and conversion to text `Span`s (`spanIn`, `diagnosticIn`)
- Segment — `{ readonly kind: 'module' | 'header' | 'body' }`; [exp]; callers: 2 outside folder
- AnchoredSpan — `{ readonly segment: Segment, readonly from: number, readonly to: number }`; [exp]; callers: 97 outside folder
- SegmentBases — `{ readonly bases: ReadonlyMap<Segment, number> }`; [exp]; callers: 3 outside folder
- spanIn(tree, span): Span — resolves `AnchoredSpan` against `tree.bases` into a text `Span`; [exp]; callers: 25 outside folder
- diagnosticIn(tree, diagnostic, treeOf?): Diagnostic — converts anchored span (and related locations) of `diagnostic` to text `Span`s; [exp]; callers: 3 outside folder
- spanAcross(first, last): AnchoredSpan — spans from `first.from` to `last.to` in the same segment; [exp]; callers: 8 outside folder
- spanCovering(first, ...rest): AnchoredSpan — least `AnchoredSpan` covering `first` and `rest` in one segment; [exp]; callers: 1 outside folder
- spanBetween(first, last): AnchoredSpan — spans `[first.to, last.from)` in the same segment; [exp]; callers: 1 outside folder
- endOf(span): AnchoredSpan — empty `AnchoredSpan` at `span.to`; [exp]; callers: 5 outside folder
- startTogether(first, second): boolean — true when `first` and `second` share segment and `from`; [exp]; callers: 1 outside folder
- encloses(outer, inner): boolean — true when `inner` lies within `outer` in the same segment; [exp]; callers: 1 outside folder
- segmentOf(first, second): Segment — returns shared `Segment` or fails with `unreachable`; callers: internal

## src/compiler/syntax/types/index.ts — Type and constraint AST node interfaces, `unparenthesizedType`, `isWrittenType`, and `namedTypeText`
- NamedType — `NodeOf<'NamedType'> & { path: QualifiedName, typeArguments }`; [exp]; callers: 25 outside folder
- FunctionType — `NodeOf<'FunctionType'> & { qualifiers, parameters, returnType }`; [exp]; callers: 2 outside folder
- RestType — `NodeOf<'RestType'> & { type: TypeNode }`; [exp]; callers: 2 outside folder
- StructType — `NodeOf<'StructType'> & { fields: readonly (FieldDeclaration | MappedField | Invalid)[] }`; [exp]; callers: 8 outside folder
- MappedField — `NodeOf<'MappedField'> & { parameter: TypeParameter, type: TypeNode }`; [exp]; callers: 3 outside folder
- FieldDeclaration — `NodeOf<'FieldDeclaration'> & { name: Identifier, type: TypeNode }`; [exp]; callers: 7 outside folder
- UnionType — `NodeOf<'UnionType'> & { members: readonly TypeNode[] }`; [exp]; callers: 1 outside folder
- LiteralType — `NodeOf<'LiteralType'> & { value: Literal | Unary }`; [exp]; callers: 2 outside folder
- ReferenceType — `NodeOf<'ReferenceType'> & { referent: TypeNode }`; [exp]; callers: 2 outside folder
- IndexedType — `NodeOf<'IndexedType'> & { owner: TypeNode, key: TypeNode }`; [exp]; callers: 1 outside folder
- unparenthesizedType(node): TypeNode — strips outer `ParenthesizedType` nodes from `node`; [exp]; callers: 7 outside folder
- TypeNode — union of all type AST nodes; [exp]; callers: 36 outside folder
- StructConstraint — `NodeOf<'StructConstraint'> & { entries: readonly (FieldEntry | Invalid)[] }`; [exp]; callers: 4 outside folder
- EntryField — `Identifier | OtherFields`; [exp]; callers: 1 outside folder
- FieldEntry — `FieldTypeEntry | FieldConstraintEntry`; [exp]; callers: 2 outside folder
- ConstraintNode — `TypeNode | StructConstraint`; [exp]; callers: 6 outside folder
- InferType — `NodeOf<'InferType'> & { parameter: TypeParameter }`; [exp]; callers: 1 outside folder
- TypeMatch — `NodeOf<'TypeMatch'> & { subject: TypeNode, cases: readonly (TypeCase | Invalid)[] }`; [exp]; callers: 4 outside folder
- TypeCase — `NodeOf<'TypeCase'> & { pattern: CasePattern, type: TypeNode }`; [exp]; callers: 4 outside folder
- CasePattern — `TypeNode | StructConstraint | WildcardPattern`; [exp]; callers: 1 outside folder
- TypePart — union of sub-type AST nodes (`TypeMatch`, `TypeCase`, `FieldDeclaration`, `MappedField`, `RestType`, etc.); [exp]; callers: 2 outside folder
- isWrittenType(node): node is WrittenType — true when `node.kind` is a non-error `TypeNode` or `RestType`; [exp]; callers: 2 outside folder
- namedTypeText({ path }): string — joins `path` identifiers with `'.'`; [exp]; callers: 4 outside folder

## src/compiler/syntax/types/type-matches.ts — Collects `infer` variables in a type `match` pattern and determines where a node stands among type `match`es
- inferTypesIn(node): readonly InferType[] — pre-order list of `InferType` nodes under `node`'s fields; [exp]; callers: 3 outside folder
- MatchPlace — `'pattern' | 'match' | 'outside'`; [exp]; callers: 0 outside folder
- matchPlaceOf(tree, node): MatchPlace — climbs `parentOf` to tell if `node` is in a `TypeCase.pattern`, elsewhere in a `TypeMatch`, or `'outside'`; [exp]; callers: 2

## src/compiler/scanner/characters.ts — ASCII lexical character predicates, `identifierRunEnd`, and `spellsName`
- isInlineWhitespace(char): boolean — true for `' '` or `'\t'`; [exp]; callers: 1 outside folder (1 in folder)
- isDecimalDigit(char): boolean — true for `'0'..'9'`; [exp]; callers: 0 outside folder (2 in folder)
- isHexDigit(char): boolean — true for `'0'..'9'`, `'a'..'f'`, `'A'..'F'`; [exp]; callers: 0 outside folder (2 in folder)
- isIdentifierStart(char): boolean — true for ASCII letter or `'_'`; [exp]; callers: 0 outside folder (1 in folder)
- isQuote(char): boolean — true for `'"'` or `"'"`; [exp]; callers: 0 outside folder (1 in folder)
- identifierRunEnd(text, offset): number — advances past ASCII identifier-part characters from `offset`; [exp]; callers: 0 outside folder (2 in folder)
- spellsName(text): boolean — true when `text` scans as a single identifier and is not a reserved keyword; [exp]; callers: 2 outside folder

## src/compiler/scanner/diagnostics.ts — Scanner diagnostic catalog (codes 1001–1014)
- scannerDiagnostics — catalog of 14 scanner diagnostic factories; [exp]; callers: 0 outside folder (4 in folder)

## src/compiler/scanner/lexeme.ts — `ScannedLexeme` return shape for sub-scanners (`end` offset + token fields without `span`/`firstOnLine`)
- ScannedLexeme — `{ end: number, token: Omit<Token, 'span' | 'firstOnLine'> }`; [exp]; callers: 0 outside folder (4 in folder)

## src/compiler/scanner/multi-line.ts — Shared multi-line layout (delimiter-line trimming and common indentation stripping) for templates and docstrings
- LinePiece — `{ kind: 'text', text } | { kind: 'escape', text } | { kind: 'break' }`; [exp]; callers: 0 outside folder (1 in folder)
- PieceReader — accumulates plain-text runs, escapes, and line breaks for a multi-line literal; [exp]; callers: 0 outside folder (1 in folder)
- layOutLines(texts): readonly string[] — trims blank opening/closing delimiter lines and strips shared indentation; [exp]; callers: 0 outside folder (1 in folder)
- PieceReader.#endRun(offset): void — flushes pending plain-text slice `[#runStart, offset)` into `#pieces`; callers: internal
- sharedIndentation(texts): number — computes minimum leading spaces across all non-blank lines after the first; callers: internal
- lineIndentation(pieces, from, isLastText): number | undefined — leading spaces of line at `from`, or `undefined` if blank; callers: internal
- decode(pieces, indentation, startsAfterBreak): string — strips up to `indentation` leading spaces per line and joins pieces; callers: internal

## src/compiler/scanner/numbers.ts — Scans decimal, hex (`0x`), binary (`0b`), float, and duration (`ms`, `s`, `m`, `h`, `d`) literals
- scanNumber(text, start, diagnostics): ScannedLexeme — dispatches to `scanRadixInteger` or `scanDecimal`; [exp]; callers: 0 outside folder (1 in folder)
- scanRadixInteger(text, start, radix, diagnostics): ScannedLexeme — scans `0x`/`0b` integer, reporting missing/invalid digits or bad `_`; callers: internal
- scanDecimal(text, start, diagnostics): ScannedLexeme — scans decimal integer, float, or duration literal and validates suffixes/`_`; callers: internal
- exponentGroupAt(text, offset): DigitGroup | undefined — matches `e`/`E` with optional `+`/`-` and digits; callers: internal
- digitGroupEnd(text, offset): number — advances past decimal digits and `'_'`; callers: internal
- reportMisplacedSeparators(text, start, end, diagnostics): void — reports leading, trailing, or doubled `'_'` runs in `[start, end)`; callers: internal

## src/compiler/scanner/punctuators.ts — Longest-match punctuator lookup derived from `syntax/tokens`'s `punctuators` list
- matchPunctuator(text, offset): Punctuator | undefined — returns longest `Punctuator` starting at `offset`; [exp]; callers: 0 outside folder (1 in folder)

## src/compiler/scanner/scan.ts — Main lossless, total scanner loop (trivia, comments, tab indentation, words, literals, and template `${…}` values)
- scan(source): ScanResult — scans `source` into `{ tokens, comments, diagnostics }`; [exp]; callers: 7 outside folder
- Scanner.#scanTokens(isValue): ScannedValue — scans tokens up to EOF or closing `}` of a template value; callers: internal
- Scanner.#scanValue(from): ScannedValue | undefined — scans a template's `${…}` value tokens with nesting-depth guard; callers: internal
- Scanner.#skipTrivia(): void — advances past spaces, tabs (recording indentation tabs), line breaks, and `#` comments; callers: internal
- Scanner.#skipComment(): void — scans `#` comment to end of line and records `Comment`; callers: internal
- Scanner.#scanToken(): Token — scans one lexeme or unknown-character run and attaches `span` and `firstOnLine`; callers: internal
- Scanner.#lexemeScannerAt(start) — selects sub-scanner for word, number, docstring, string, template, or punctuator; callers: internal
- Scanner.#scanUnknownRun(start): ScannedLexeme — groups consecutive unrecognized code points into one `unknown` token and diagnostic; callers: internal

## src/compiler/scanner/strings.ts — Scans single-line `"…"`/`'…'` string literals and decodes `\n`, `\t`, `\\`, quote, `` \` ``, `\$`, and `\u{…}` escapes
- validEscapes: string — formatted list of valid escape sequences for diagnostic messages; [exp]; callers: 0 outside folder (1 in folder)
- scanString(text, start, diagnostics): ScannedLexeme — scans single-line quoted string literal; [exp]; callers: 0 outside folder (1 in folder)
- scanEscape(text, backslash, diagnostics): Decoded | undefined — decodes escape at `backslash` (`undefined` before line break/EOF); [exp]; callers: 0 (1 in folder)
- scanUnicodeEscape(text, backslash, diagnostics): Decoded — decodes `\u{1..6 hex digits}` scalar value or reports `invalidUnicodeEscape`; callers: internal

## src/compiler/scanner/templates.ts — Scans multi-line backtick templates (with `${…}` values) and raw `"""…"""` docstrings
- ScannedValue — `{ tokens, end, closed }` returned by `ValueScanner`; [exp]; callers: 0 outside folder (1 in folder)
- ValueScanner — `(from: number) => ScannedValue | undefined`; [exp]; callers: 0 outside folder
- docstringDelimiter: '"""' — opening/closing delimiter for docstrings; [exp]; callers: 0 outside folder (1 in folder)
- scanTemplate(text, start, diagnostics, scanValue): ScannedLexeme — scans backtick template literal; [exp]; callers: 0 outside folder (1 in folder)
- scanDocstring(text, start, diagnostics): ScannedLexeme — scans `"""…"""` docstring and lays out its lines; [exp]; callers: 0 outside folder (1 in folder)
- TemplateScanner.scan(): ScannedLexeme — loops over template characters/interpolations until closing `` ` `` or EOF; callers: internal
- TemplateScanner.#step(): boolean — handles line break, escape, `${…}` value, or plain character; callers: internal
- TemplateScanner.#scanEscape(backslash): number — decodes escape or reports trailing-backslash escape error; callers: internal
- TemplateScanner.#addValue(value): boolean — ends preceding text run, records `TemplateValue`, and starts next `PieceReader`; callers: internal
- TemplateScanner.#endText(end): void — pushes `{ span, pieces }` for the current template text segment; callers: internal
- TemplateScanner.#lexeme(end): ScannedLexeme — runs `layOutLines` across all text segments and returns `template` lexeme; callers: internal

## src/compiler/program/diagnostics.ts — Program-loading diagnostic catalog (codes 3000–3001: unresolved and ambiguous imports)
- programDiagnostics — `{ unresolvedImport, ambiguousImport }` diagnostic factories; [exp]; callers: 0 outside folder (1 in folder)

## src/compiler/program/program.ts — Builds an immutable `Program` module graph from roots, roles, and `ModuleLoader`s, reusing unchanged trees
- ModuleId — branded URL string identifying a module; [exp]; callers: 79 outside folder
- moduleIdOf(url): ModuleId — brands `url.href` as `ModuleId`; [exp]; callers: 2 outside folder
- stdModuleIdOf(name): ModuleId — builds `std:<name>` `ModuleId`; [exp]; callers: 2 outside folder
- LocatedModule — `{ id, name, label, isStd?, isTest?, read }` returned by a `ModuleLoader`; [exp]; callers: 4 outside folder
- ModuleLoader — `(path: string, importer: ModuleId) => LocatedModule | undefined`; [exp]; callers: 2 outside folder
- ProgramModule — loaded module record `{ id, name, isStd, isTest, tree, imports, diagnostics }`; [exp]; callers: 1 outside folder
- Program — `{ roots, roles, modules }` immutable program snapshot; [exp]; callers: 22 outside folder
- programModule(program, module): ProgramModule — returns `program.modules.get(module)` or fails with `unreachable`; [exp]; callers: 15 outside folder
- isTestModule(program, module): boolean — true when `program.modules.get(module)?.isTest === true`; [exp]; callers: 2 outside folder
- isStdModule(program, module): boolean — true when `program.modules.get(module)?.isStd === true`; [exp]; callers: 4 outside folder
- ProgramOptions — `{ roots, loaders, roles? }` input to `buildProgram`; [exp]; callers: 0 outside folder (test-only)
- buildProgram(options, previous?): Program — BFS-loads reachable modules, reusing unchanged `SyntaxTree`s from `previous`; [exp]; callers: 1 outside folder
- resolveImports(tree, importer, loaders): ResolvedImports — resolves all `NamedImport`/`NamespaceImport` paths in `tree.root.items`; callers: internal
- locateImport(pathLiteral, importer, loaders): LocatedModule | Diagnostic<AnchoredSpan> — queries all loaders, deduplicating by `id`; callers: internal

## src/compiler/compile.ts — Pipeline coordinator memoizing `diagnose`, `diagnoseModule`, `compileProgram`, and `compileTests` per `Program`
- ModuleDiagnostics — `{ source, diagnostics }` for one module; [exp]; callers: 1 outside folder
- diagnose(program): ReadonlyMap<ModuleId, ModuleDiagnostics> — memoized map of all phase diagnostics for every module in `program`; [exp]; callers: 3 outside folder
- diagnoseModule(program, id): ModuleDiagnostics — memoized sorted syntax + program + binder + checker diagnostics for module `id`; [exp]; callers: 1 outside folder
- Compilation — `{ kind: 'compiled', definition } | { kind: 'failed' } | { kind: 'noMain' }`; [exp]; callers: 0 outside folder
- compileProgram(program, entry): Compilation — memoized compilation of `program` starting at `entry`'s `main`; [exp]; callers: 1 outside folder
- TestCompilation — `{ kind: 'compiled', definition } | { kind: 'failed' } | { kind: 'noTests' }`; [exp]; callers: 0 outside folder
- compileTests(program): TestCompilation — memoized compilation of all `@Suite` functions in `program`'s non-std modules; [exp]; callers: 1 outside folder
- mainOf(program, entry): FunctionDeclaration | undefined — finds exported `isMain` overload of `main` in `entry`; [exp]; callers: 0 outside folder (test-only)
- compile(program, entry): Compilation — checks `hasErrors(program)` and `mainOf(program, entry)`, then runs `lower`; callers: internal

## src/project/errno.ts — Predicate narrowing an unknown error to a Node `SystemError` with `errno` and `code`
- SystemError — `Error & { readonly errno: number, readonly code: string }`; [exp]; callers: 0 outside folder
- isSystemError(error): error is SystemError — true when `error` is an `Error` with `errno` and string `code`; [exp]; callers: 2 outside folder (1 in folder)

## src/project/file-loader.ts — `ModuleLoader` resolving project `.ista` files on disk or editor overlay with memoized `file:` URLs and names
- sourceExtension: '.ista' — source file extension; [exp]; callers: 0 outside folder (1 in folder)
- ProjectPlaces — `{ projectRoot: string, cwd: string }`; [exp]; callers: 0 outside folder
- fileLoader(places, files?): ModuleLoader — resolves relative (`./`/`../`) or root-relative import paths to `.ista` files; [exp]; callers: 0 outside folder (1 in folder)
- locateFile(file, places, files?): LocatedModule | undefined — returns `LocatedModule` if `files.isFile(file)`; [exp]; callers: 0 outside folder (1 in folder)
- moduleIdOfFile(file): ModuleId — converts absolute file path to `file:` `ModuleId`; [exp]; callers: 1 outside folder
- fileOfModule(id): string | undefined — converts `file:` `ModuleId` back to file path, or `undefined` for non-`file:` IDs; [exp]; callers: 1 outside folder
- namesOf(file, places): ModuleNames — memoizes `{ id, name, label, isTest }` per `(projectRoot, cwd, file)`; callers: internal
- filePathOf(path, importer, projectRoot): string | undefined — resolves parsed `importPathOf(path)` against `projectRoot` or `importer` dir; callers: internal

## src/project/project-files.ts — `ProjectFiles` seam for reading `.ista` files from disk (`diskFiles`, `statOnDisk`) or editor overlays (`overlaidFiles`)
- ProjectFiles — `{ isFile, read }` filesystem seam; [exp]; callers: 0 outside folder (2 in folder)
- diskFiles: ProjectFiles — reads files from disk via `statOnDisk` and `readFileSync`; [exp]; callers: 1 outside folder (2 in folder)
- statOnDisk(path): Stats | undefined — `statSync(path, { throwIfNoEntry: false })`, returning `undefined` on `ENOTDIR`; [exp]; callers: 0 outside folder (1 in folder)
- overlaidFiles(open, files?): ProjectFiles — overlays `open` in-memory file map over `files`; [exp]; callers: 1 outside folder

## src/project/project.ts — Discovers project `.ista` sources (with directory-mtime caching) and loads a project `Program` with stdlib roles
- findProjectSources(cwd): readonly string[] — finds all `.ista` files under `cwd` excluding `node_modules` and `vendor`; [exp]; callers: 3 outside folder
- findSources(directory, suffix): readonly string[] — finds files ending in `suffix` under `directory`, caching when dir mtimes are settled; [exp]; callers: 1
- Project — `{ program: Program, unreadable: readonly string[] }`; [exp]; callers: 0 outside folder (test-only)
- ProjectOptions — `{ files?, std?, previous?, buffers? }` options for `loadProject`; [exp]; callers: 0 outside folder
- loadProject(cwd, paths, options?): Project — locates root `paths`, builds `Program` with `fileLoader` + `stdlibLoader` + `stdRoles`; [exp]; callers: 4 outside folder
- scanned(root, suffix): Scan — runs `globSync` once to collect sorted matching source paths and directory mtimes; callers: internal

## Concept footprint
- Optional/None: `src/foundation/language/primitives.ts:primitiveNames`, `src/foundation/language/well-known/index.ts:wellKnown`, `src/foundation/language/well-known/variants.ts:unionLayout`, `src/foundation/language/well-known/implicit-calls.ts:panicFunction`, `src/definition/extern-key.ts:KeyType`, `src/definition/values/declared-values.ts:optionalOf`, `src/definition/values/declared-values.ts:optionalValueOf`, `src/compiler/syntax/expressions/chains.ts:optionalOperatorOf`, `src/compiler/syntax/expressions/chains.ts:linkOperator`, `src/compiler/syntax/expressions/chains.ts:isOptionalStep`, `src/compiler/syntax/expressions/chains.ts:chainStepOf`, `src/compiler/syntax/expressions/chains.ts:callStepOf`, `src/compiler/syntax/expressions/chains.ts:isOptionallyChained`, `src/compiler/syntax/expressions/readings.ts:callsThroughOptional`, `src/compiler/syntax/expressions/operators.ts:binaryOperators`, `src/compiler/syntax/expressions/index.ts:Unwrap`, `src/compiler/syntax/types/index.ts:OptionalType`
- Result: `src/foundation/language/well-known/index.ts:wellKnown`, `src/foundation/language/well-known/variants.ts:resultVariants`, `src/foundation/language/well-known/variants.ts:resultFields`, `src/definition/values/declared-values.ts:okTypeOf`, `src/definition/values/declared-values.ts:okOf`, `src/definition/values/declared-values.ts:errOf`, `src/definition/values/declared-values.ts:errorOf`, `src/compiler/syntax/expressions/index.ts:Propagate`
- unions: `src/foundation/language/well-known/variants.ts:unionLayout`, `src/definition/extern-key.ts:keyTypeText`, `src/definition/values/declared-values.ts:optionalOf`, `src/definition/values/json-values.ts:findJsonType`, `src/compiler/syntax/types/index.ts:UnionType`, `src/compiler/syntax/declarations/index.ts:TypeParameter`, `src/compiler/syntax/declarations/index.ts:RequiredAssociatedType`
- enums/variants: `src/foundation/language/naming.ts:casedAsType`, `src/foundation/language/naming.ts:bindsInPattern`, `src/foundation/language/well-known/variants.ts:unionLayout`, `src/foundation/language/well-known/variants.ts:resultVariants`, `src/foundation/language/well-known/variants.ts:stepVariants`, `src/definition/instructions/data.ts:dataInstructions`, `src/definition/instructions/control.ts:controlInstructions`, `src/definition/tables/types.ts:typeDefinition`, `src/definition/validation/instruction-rules.ts:constructionProblem`, `src/definition/values/declared-values.ts:variantOf`, `src/definition/values/declared-values.ts:variantShape`, `src/definition/values/declared-values.ts:variantFieldType`, `src/definition/values/declared-values.ts:variantFieldOf`, `src/definition/values/equality.ts:sameHead`, `src/definition/values/equality.ts:headKey`, `src/compiler/syntax/declarations/field-defaults.ts:fieldsFunctionsOf`, `src/compiler/syntax/declarations/field-defaults.ts:constructedVariant`, `src/compiler/syntax/declarations/field-defaults.ts:fieldsFunctionOf`, `src/compiler/syntax/declarations/field-defaults.ts:declaredFunctionName`, `src/compiler/syntax/declarations/methods.ts:isMethod`, `src/compiler/syntax/patterns.ts:VariantCallPattern`, `src/compiler/syntax/patterns.ts:patternHead`, `src/compiler/syntax/patterns.ts:isTakingApart`
- any/trait objects: `src/definition/extern-key.ts:keyTypeText`, `src/compiler/syntax/tokens/grammar-words.ts:typeWords`, `src/compiler/syntax/types/index.ts:AnyType`
- futures/await/select: `src/foundation/language/well-known/index.ts:wellKnown`, `src/foundation/language/well-known/implicit-calls.ts:awaitFunction`, `src/foundation/language/starts.ts:isMainShaped`, `src/definition/instructions/flow.ts:waitRegister`, `src/definition/instructions/flow.ts:waits`, `src/definition/instructions/flow.ts:terminates`, `src/definition/instructions/suspension.ts:suspensionInstructions`, `src/definition/instructions/calls.ts:callInstructions`, `src/definition/tables/types.ts:typeDefinition`, `src/definition/validation/instruction-rules.ts:instructionProblem`, `src/compiler/syntax/tokens/modifiers.ts:awaits`, `src/compiler/syntax/expressions/readings.ts:selectCasesOf`, `src/compiler/syntax/expressions/index.ts:Await`, `src/compiler/syntax/expressions/index.ts:Select`, `src/compiler/syntax/expressions/index.ts:SelectCase`
- marks/kinds (live/ista/simple): `src/foundation/language/well-known/index.ts:persistences`, `src/foundation/language/well-known/index.ts:marks`, `src/foundation/language/well-known/index.ts:wellKnown`, `src/foundation/language/call-rule.ts:mayCall`, `src/foundation/language/starts.ts:isStartable`, `src/definition/extern-key.ts:functionKey`, `src/definition/extern-key.ts:keyTypeText`, `src/definition/tables/functions.ts:codeMode`, `src/definition/tables/functions.ts:returnsAtOnce`, `src/definition/validation/entries.ts:checkMain`, `src/definition/validation/entries.ts:checkJobServer`, `src/definition/validation/entries.ts:checkStarts`, `src/definition/validation/entries.ts:checkTests`, `src/definition/validation/entries.ts:startShapeOf`, `src/definition/validation/instruction-rules.ts:instructionProblem`, `src/compiler/syntax/tokens/modifiers.ts:modifierGroups`, `src/compiler/syntax/tokens/modifiers.ts:headForms`, `src/compiler/syntax/tokens/modifiers.ts:modifiersText`, `src/compiler/syntax/tokens/modifiers.ts:modifiersAroundMark`, `src/compiler/syntax/declarations/starts.ts:startShapeOf`, `src/compiler/syntax/declarations/index.ts:FunctionDeclaration`
- sendable: `src/foundation/language/well-known/index.ts:wellKnown`, `src/foundation/language/well-known/index.ts:sendabilities`, `src/compiler/syntax/tokens/modifiers.ts:modifierGroups`, `src/compiler/syntax/tokens/modifiers.ts:headForms`, `src/compiler/syntax/tokens/grammar-words.ts:followers`
- shared structs: `src/definition/instructions/data.ts:dataInstructions`, `src/definition/tables/types.ts:isResourceType`, `src/definition/tables/types.ts:isCellType`, `src/definition/validation/instruction-rules.ts:instructionProblem`, `src/compiler/syntax/tokens/modifiers.ts:modifierGroups`, `src/compiler/syntax/tokens/modifiers.ts:headForms`, `src/compiler/syntax/declarations/index.ts:SharedStructDeclaration`, `src/compiler/syntax/declarations/index.ts:isDeclaredStruct`, `src/compiler/syntax/expressions/index.ts:NewStructLiteral`, `src/compiler/syntax/expressions/index.ts:Dereference`, `src/compiler/syntax/expressions/literals/built-types.ts:literalNaming`, `src/compiler/syntax/expressions/literals/built-types.ts:buildsShared`, `src/compiler/syntax/expressions/literals/indented-values.ts:literalOf`, `src/compiler/syntax/expressions/chains.ts:chainStepOf`, `src/compiler/syntax/expressions/places.ts:isPlace`
- extern types/functions: `src/definition/extern-key.ts:externKey`, `src/definition/extern-key.ts:nativeKey`, `src/definition/tables/functions.ts:functionDefinition`, `src/definition/tables/types.ts:typeDefinition`, `src/definition/tables/types.ts:isResourceType`, `src/definition/tables/types.ts:hasRole`, `src/definition/validation/references.ts:checkType`, `src/definition/validation/references.ts:checkFunction`, `src/definition/validation/references.ts:valueProblem`, `src/definition/values/values.ts:samePayload`, `src/definition/values/equality.ts:sameHead`, `src/definition/values/equality.ts:headKey`, `src/compiler/syntax/tokens/modifiers.ts:modifierGroups`, `src/compiler/syntax/tokens/modifiers.ts:headForms`, `src/compiler/syntax/declarations/index.ts:ExternStructDeclaration`, `src/compiler/syntax/declarations/index.ts:ExternConstantDeclaration`, `src/compiler/syntax/items.ts:placeOf`
- field loops/passes: `src/compiler/syntax/expressions/index.ts:FieldHeader`, `src/compiler/syntax/expressions/index.ts:FieldComprehension`, `src/compiler/syntax/expressions/index.ts:StructComprehension`, `src/compiler/syntax/statements/index.ts:FieldLoop`, `src/compiler/syntax/statements/readings.ts:isOverFields`, `src/compiler/syntax/statements/readings.ts:passedParts`, `src/compiler/syntax/statements/targets.ts:ownsTargets`, `src/compiler/syntax/statements/targets.ts:declaredTargets`
- comprehensions: `src/compiler/syntax/expressions/index.ts:Comprehension`, `src/compiler/syntax/expressions/index.ts:FieldComprehension`, `src/compiler/syntax/expressions/index.ts:StructComprehension`, `src/compiler/syntax/statements/readings.ts:isOverFields`, `src/compiler/syntax/statements/readings.ts:passedParts`, `src/compiler/syntax/statements/targets.ts:ownsTargets`, `src/compiler/syntax/statements/targets.ts:declaredTargets`, `src/compiler/syntax/expressions/literals/indented-values.ts:isStructItem`
- deferred calls: `src/compiler/syntax/expressions/calls.ts:DeferredCall`, `src/compiler/syntax/expressions/operators.ts:operatorLevels`, `src/compiler/syntax/expressions/chains.ts:chainStepOf`, `src/compiler/syntax/expressions/readings.ts:isTakerShaped`, `src/compiler/syntax/expressions/readings.ts:calledName`, `src/compiler/syntax/expressions/readings.ts:callTypeArguments`, `src/compiler/syntax/expressions/readings.ts:writtenArgumentsOf`, `src/compiler/syntax/expressions/readings.ts:callsThroughOptional`, `src/compiler/syntax/expressions/readings.ts:callOfCallee`, `src/compiler/syntax/expressions/readings.ts:makerOf`, `src/compiler/syntax/expressions/readings.ts:deferredOf`, `src/compiler/syntax/tree/index.ts:bodyChildrenOf`
- spawn/instances/jobs: `src/foundation/language/well-known/index.ts:wellKnown`, `src/foundation/language/well-known/index.ts:runtimeModule`, `src/foundation/language/well-known/jobs.ts:jobFunctions`, `src/foundation/language/well-known/jobs.ts:jobWaypoint`, `src/definition/tables/types.ts:outcomeEncoderOf`, `src/definition/validation/entries.ts:checkJobServer`, `src/definition/validation/references.ts:checkType`, `src/definition/values/instance-handles.ts:instanceHandle`, `src/definition/values/instance-handles.ts:instanceNameOf`
- context consts: `src/definition/instructions/data.ts:dataInstructions`, `src/definition/instructions/instruction.ts:operandsOf`, `src/compiler/syntax/tokens/modifiers.ts:headForms`, `src/compiler/syntax/tokens/grammar-words.ts:topLevelFollowers`, `src/compiler/syntax/declarations/index.ts:ContextConstantDeclaration`, `src/compiler/syntax/items.ts:placeOf`
- disposal/lifetimes/holders: `src/foundation/language/well-known/index.ts:languageModules`, `src/foundation/language/well-known/index.ts:wellKnown`, `src/foundation/language/well-known/implicit-calls.ts:disposeFunction`, `src/definition/instructions/lifetimes.ts:lifetimeInstructions`, `src/definition/tables/types.ts:typeDefinition`, `src/definition/tables/types.ts:isResourceType`, `src/definition/validation/references.ts:checkType`, `src/definition/validation/instruction-rules.ts:instructionProblem`, `src/compiler/syntax/statements/index.ts:VariableDeclaration`, `src/compiler/syntax/statements/index.ts:Hold`, `src/compiler/syntax/statements/index.ts:LabelledBlock`, `src/compiler/syntax/statements/index.ts:Drop`, `src/compiler/syntax/statements/readings.ts:droppedName`, `src/compiler/syntax/patterns.ts:hasUnnamedPart`, `src/compiler/syntax/statements/targets.ts:isUnnamedTarget`, `src/compiler/syntax/statements/targets.ts:hasUnnamedTarget`
- recursive aliases/type match: `src/definition/tables/types.ts:typeDefinition`, `src/compiler/syntax/declarations/index.ts:TypeAliasDeclaration`, `src/compiler/syntax/declarations/index.ts:AssociatedType`, `src/compiler/syntax/types/index.ts:InferType`, `src/compiler/syntax/types/index.ts:TypeMatch`, `src/compiler/syntax/types/index.ts:TypeCase`, `src/compiler/syntax/types/type-matches.ts:inferTypesIn`, `src/compiler/syntax/types/type-matches.ts:matchPlaceOf`, `src/compiler/syntax/tokens/grammar-words.ts:typeWords`
- struct keys/keyof/mapped types: `src/compiler/syntax/types/index.ts:StructType`, `src/compiler/syntax/types/index.ts:MappedField`, `src/compiler/syntax/types/index.ts:IndexedType`, `src/compiler/syntax/types/index.ts:KeyofType`, `src/compiler/syntax/types/index.ts:StructConstraint`, `src/compiler/syntax/tokens/grammar-words.ts:typeWords`, `src/compiler/syntax/expressions/literals/indented-values.ts:bareKeyOf`
- variance: `src/compiler/syntax/tokens/grammar-words.ts:varianceMarkers`, `src/compiler/syntax/declarations/index.ts:TypeParameter`
- packs/rest parameters: `src/definition/extern-key.ts:restKey`, `src/definition/extern-key.ts:markerOf`, `src/compiler/syntax/declarations/index.ts:TypeParameter`, `src/compiler/syntax/declarations/index.ts:DeclaredField`, `src/compiler/syntax/declarations/index.ts:isRestField`, `src/compiler/syntax/expressions/index.ts:Parameter`, `src/compiler/syntax/types/index.ts:RestType`
- indented values: `src/compiler/syntax/expressions/index.ts:QuotedEntry`, `src/compiler/syntax/expressions/index.ts:IndentedItem`, `src/compiler/syntax/expressions/index.ts:IndentedValue`, `src/compiler/syntax/expressions/literals/indented-values.ts:isItem`, `src/compiler/syntax/expressions/literals/indented-values.ts:isKeyed`, `src/compiler/syntax/expressions/literals/indented-values.ts:untypedForm`, `src/compiler/syntax/expressions/literals/indented-values.ts:literalOf`, `src/compiler/syntax/expressions/literals/indented-values.ts:bareKeyOf`, `src/compiler/syntax/expressions/literals/indented-values.ts:entriesLeftOut`, `src/compiler/syntax/expressions/literals/built-types.ts:literalNaming`, `src/compiler/syntax/expressions/literals/built-types.ts:buildsShared`, `src/compiler/syntax/expressions/readings.ts:isItemsLiteral`
- defaults/fields functions: `src/definition/instructions/prologue.ts:prologueInstructions`, `src/definition/tables/functions.ts:mayLeaveOut`, `src/definition/tables/functions.ts:bodyStart`, `src/definition/tables/functions.ts:takesArguments`, `src/definition/validation/references.ts:checkPrologue`, `src/definition/validation/instruction-rules.ts:instructionProblem`, `src/definition/validation/instruction-rules.ts:argumentsProblem`, `src/compiler/syntax/declarations/index.ts:hasDefault`, `src/compiler/syntax/declarations/index.ts:isDefaultOf`, `src/compiler/syntax/declarations/field-defaults.ts:functionsOf`, `src/compiler/syntax/declarations/field-defaults.ts:fieldsFunctionsOf`, `src/compiler/syntax/declarations/field-defaults.ts:isFieldsFunction`, `src/compiler/syntax/declarations/field-defaults.ts:constructedVariant`, `src/compiler/syntax/declarations/field-defaults.ts:takesArgumentsInOrder`, `src/compiler/syntax/declarations/field-defaults.ts:fieldsFunctionOf`, `src/compiler/syntax/declarations/field-defaults.ts:declaredFunctionName`, `src/compiler/syntax/expressions/parameters.ts:defaultValuesOf`
- codecs/JSON: `src/foundation/language/well-known/index.ts:languageModules`, `src/foundation/language/well-known/index.ts:wellKnown`, `src/foundation/language/well-known/codecs.ts:codecFunctions`, `src/foundation/language/well-known/codecs.ts:derivedCodecs`, `src/foundation/language/well-known/codecs.ts:codecHelpers`, `src/definition/formats/codec.ts:encodeJson`, `src/definition/formats/codec.ts:decodeJson`, `src/definition/tables/functions.ts:encoderProblem`, `src/definition/tables/types.ts:outcomeEncoderOf`, `src/definition/validation/entries.ts:checkStarts`, `src/definition/validation/entries.ts:checkEncoder`, `src/definition/values/json-values.ts:jsonTypeIn`, `src/definition/values/json-values.ts:jsonTypeOf`, `src/definition/values/json-values.ts:jsonText`, `src/definition/values/json-values.ts:jsonOfText`, `src/definition/values/json-values.ts:plainOfJson`, `src/definition/values/json-values.ts:jsonOfPlain`, `src/definition/values/json-values.ts:isJsonValue`
- witnesses/traits: `src/foundation/language/well-known/index.ts:selfType`, `src/foundation/language/naming.ts:isBuiltInTypeName`, `src/compiler/syntax/declarations/index.ts:TraitDeclaration`, `src/compiler/syntax/declarations/index.ts:RequiredAssociatedType`, `src/compiler/syntax/tokens/modifiers.ts:headForms`
- places/&refs/cells: `src/definition/extern-key.ts:referenceKey`, `src/definition/extern-key.ts:markerOf`, `src/definition/instructions/places.ts:place`, `src/definition/instructions/places.ts:argument`, `src/definition/instructions/data.ts:dataInstructions`, `src/definition/tables/functions.ts:takesReference`, `src/definition/tables/types.ts:isCellType`, `src/definition/validation/references.ts:checkCode`, `src/definition/validation/instruction-rules.ts:argumentsProblem`, `src/compiler/syntax/declarations/field-defaults.ts:fieldParameter`, `src/compiler/syntax/expressions/calls.ts:Reference`, `src/compiler/syntax/expressions/parameters.ts:writtenByReference`, `src/compiler/syntax/expressions/places.ts:isPlace`, `src/compiler/syntax/expressions/places.ts:placePath`, `src/compiler/syntax/statements/targets.ts:destructuringOf`, `src/compiler/syntax/statements/targets.ts:isTarget`, `src/compiler/syntax/types/index.ts:ReferenceType`
- patterns: `src/foundation/language/naming.ts:bindsInPattern`, `src/foundation/language/well-known/implicit-calls.ts:arrayPatternFunctions`, `src/compiler/syntax/patterns.ts:targetLeaves`, `src/compiler/syntax/patterns.ts:isTakingApart`, `src/compiler/syntax/patterns.ts:patternHead`, `src/compiler/syntax/patterns.ts:unparenthesizedPattern`, `src/compiler/syntax/patterns.ts:targetNames`, `src/compiler/syntax/patterns.ts:hasUnnamedPart`, `src/compiler/syntax/expressions/parameters.ts:parameterSite`, `src/compiler/syntax/expressions/parameters.ts:parameterNames`, `src/compiler/syntax/expressions/parameters.ts:patternNamedType`, `src/compiler/syntax/expressions/parameters.ts:typingPattern`, `src/compiler/syntax/statements/targets.ts:declaredTargets`
- templates/docstrings: `src/foundation/language/well-known/implicit-calls.ts:templateFunctions`, `src/compiler/scanner/multi-line.ts:PieceReader`, `src/compiler/scanner/multi-line.ts:layOutLines`, `src/compiler/scanner/templates.ts:scanTemplate`, `src/compiler/scanner/templates.ts:scanDocstring`, `src/compiler/scanner/scan.ts:Scanner`, `src/compiler/syntax/expressions/literals/templates.ts:isTagged`, `src/compiler/syntax/expressions/literals/templates.ts:constantTextOf`, `src/compiler/syntax/expressions/literals/templates.ts:taggedCall`
- ranges: `src/foundation/language/well-known/index.ts:wellKnown`, `src/foundation/language/well-known/implicit-calls.ts:inclusiveEndFunction`, `src/compiler/syntax/expressions/index.ts:Range`, `src/compiler/syntax/patterns.ts:RangePattern`, `src/compiler/syntax/expressions/operators.ts:operatorLevels`, `src/compiler/syntax/tokens/grammar-words.ts:clauseWordsAfterOperand`
- comparisons/equality/maps: `src/foundation/language/order.ts:compareOrdered`, `src/foundation/language/values.ts:ValueSemantics`, `src/definition/instructions/data.ts:dataInstructions`, `src/definition/values/equality.ts:valuesEqual`, `src/definition/values/equality.ts:mapOf`, `src/compiler/syntax/expressions/operators.ts:binaryOperators`, `src/compiler/syntax/expressions/operators.ts:isComparisonOperator`, `src/compiler/syntax/expressions/operators.ts:isChainingOperator`, `src/compiler/syntax/expressions/operators.ts:isImplicitOperator`, `src/compiler/syntax/expressions/comparisons.ts:comparisonLinksOf`, `src/compiler/syntax/expressions/comparisons.ts:comparisonLinkOf`, `src/compiler/syntax/expressions/comparisons.ts:linkSpan`
- testing: `src/foundation/language/well-known/index.ts:languageModules`, `src/foundation/language/well-known/index.ts:wellKnown`, `src/foundation/language/well-known/testing.ts:testingFunctions`, `src/foundation/language/well-known/testing.ts:testModuleSuffix`, `src/foundation/language/well-known/testing.ts:isTestModulePath`, `src/definition/tables/index.ts:tables`, `src/definition/tables/test-runner.ts:listingArguments`, `src/definition/tables/test-runner.ts:runningArguments`, `src/definition/tables/test-runner.ts:runnerArity`, `src/definition/validation/entries.ts:checkTests`, `src/compiler/program/program.ts:isTestModule`, `src/compiler/compile.ts:compileTests`, `src/project/file-loader.ts:namesOf`
