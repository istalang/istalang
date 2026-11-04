---
description: full-codebase DRY, generality, consistency, data-flow, modularity and spec audit at main @ a748669 — read before refactoring or planning debt paydown
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-30
last_updated: 2026-11-04
tags: [audit, dry-review, generality, consistency, architecture, spec]
---

# DRY Review (`main @ a748669`)

Report-only audit of `src/` (in layer order, lowest layer first) and `docs/spec.md` against `docs/reuse/` and `docs/work/tracker.md`.

## Ranked Summary

1. **`[high]` Redundant `Definition` JSON encode/decode/validate round-trips on every host operation and CLI run (`src/runtime/host.ts:75`, `src/runtime/testing/run-tests.ts:36`, `src/cli/commands/run.ts:116`, `src/cli/commands/test.ts:71`)**
   - `programBinder` (`src/runtime/host.ts:75–80`) runs `definitionFormat.read(text)` (including `checkReferences`) and then `definitionFormat.write(definition)` just to compute `hash` before consulting `memo(bound, hash, ...)`. Because `storedInstance` calls `bind(definition)` on every `wake`, `inspect`, `fill`, `retry`, and `terminate`, every host operation re-parses, re-validates, and re-serializes the entire `Definition` JSON even when it is already bound. On top of that, `cli/commands/run.ts:116` and `cli/commands/test.ts:71` serialize `compilation.definition` to text only for `deploy` / `runTests` to immediately re-parse and re-serialize it (four full passes on `ista run`).
   - **Fix:** Key `programBinder`'s outer memo by the raw `text` string (or pass a pre-verified `{ definition, text, hash }` bundle from `compileProgram` / `definitionFormat`), computing `definitionFormat.read` and `definitionFormat.write` at most once per unique `Definition`.
   - **Done** (`fast-wins`): `programBinder` keys its memo by the text, so each text is read, validated and written back once (`Format.readCanonical`) and each later host operation on it binds from the memo; `deploy` stores the canonical text that read gave. `inspect` on a finished instance (`runtime/host.bench.ts`): 1.94 ms → 14.6 µs mean. `runTests` reads through `readCanonical` too. Still open: the CLI writes a compiled Definition to text only for `deploy`/`runTests` to read it back, since both take text.

2. **`[high]` Unmemoized `extentIn(tree, node)` and repeated token re-scanning across parser and language service (`src/compiler/syntax/tree.ts:127`, `src/language-service/tokens.ts:24`, `src/compiler/parser/brackets.ts:34`; widens `B21`, `P17`)**
   - Despite `src/compiler/syntax/tree.ts`'s banner stating that a node's extent is memoized on the immutable node or tree, `extentIn(tree, node)` (`src/compiler/syntax/tree.ts:127–135`) is unmemoized and walks down `childrenOf` and `lastChildOf` to the leaves on every call — including at every sibling tested by `nodesAt(tree, offset)` (`tree.ts:141–156`).
   - Separately, `parse(source, scanned)` (`src/compiler/parser/parse.ts:28`) discards `scanned.tokens`, so `scannedOf(tree)` (`src/language-service/tokens.ts:24`) re-runs `scan(tree.source)` from scratch, and `pairBrackets` (`src/compiler/parser/brackets.ts:34`) re-walks the token stream a second time.
   - **Fix:** Memoize `extentIn` per `(tree, node)` via `WeakMap` in `tree.ts`; retain `tokens` on `SyntaxTree` (or memoize `scan(source)` on `SourceText` as `lineMapOf` does) and compute bracket pairs once.
   - **Done** (`fast-wins`): `extentIn` is memoized per (tree, node) in a `SequenceMemo`, as the banner says (formatter, language-service and `tree.test.ts` suites: 5.45 s → 3.38 s). The token re-scan and bracket re-walk stay open.

3. **`[high]` Unmemoized transitive-read graph traversal in `notesOfReads` (`src/structures/entries/entry.ts:74`, `src/structures/entries/index.ts:95`; widens `P10`)**
   - `notesOfReads(entry)` walks the full transitive `entry.reads` graph from scratch (allocating `seen = new Set`, `pending = [...entry.reads]`, and `notes = []`) on every call to `notesFrom(entry)`, `Entries.notesReached()`, and `#replays` (`case 'notes'`), even after an entry is closed (`!entry.running && !entry.open`) and multiple times within one computing entry.
   - **Fix:** Memoize transitive notes on closed `Entry` nodes and track visited read subgraphs across `notesReached()` calls within an active computation.

4. **`[high]` Three parallel static-function owner resolvers; `checkClashes` misses static overload clashes across type aliases (`src/compiler/checker/declarations/statics.ts:81`, `src/compiler/checker/rules/clashes.ts:121`, `src/language-service/completion/places/declared-name.ts:47`)**
   - `StaticFunctions.#ownerOf` (`declarations/statics.ts:81–93`) unwraps `TypeAliasDeclaration` via `checker.aliasedType(owner)` so `fn Alias.f()` and `fn Target.f()` share one `StaticOwner`.
   - `ownerKeyOf` (`rules/clashes.ts:121–131`) resolves `declaration.owner` separately using `checker.typeKeys.identityOf(entity.declaration)` *without* unwrapping `TypeAliasDeclaration`, so `checkClashes` misses overload clashes when one static function is declared on a type alias and another on the aliased type.
   - `ownsStatics` (`completion/places/declared-name.ts:47–59`) defines a third list (`staticOwnerKinds`) that also omits `TypeAliasDeclaration`.
   - **Fix:** Give static-owner resolution one home in the checker (`staticTargetOf` / `StaticFunctions`) and route `checkClashes` and `declared-name.ts` through it.
   - **Done** (`p2-structural`): `staticOwnerOf` and `declaredOwnerOf` (`types/named-types.ts`) are the one home: `StaticFunctions`, `checkClashes` (grouping by owner, so an alias's statics clash with its type's), `staticTargetOf` and completion's declared names all read them. `typeOfEntity` (`types/resolve-type.ts`) is the one dispatch from a name to its type, which `namedType` and `entityType` share. An alias of a shape owns statics as the shape (§3.17).

5. **`[medium]` Three parallel call-checking pipelines across `resolveCall`, `implicitCall`, and `checkValueCall` (`src/compiler/checker/calls/resolve.ts:103`, `src/compiler/checker/resolution/implicit.ts:69`, `src/compiler/checker/closures/value-calls.ts:28`)**
   - `resolveCall` (`complete` in `calls/resolve.ts:103–153`) and `implicitCall` (`resolution/implicit.ts:69–114`) duplicate the post-candidate pipeline (`choose`, `ambiguousCall` with `argumentListText`, `instantiate`, `fitArguments`, `callMade`, and result `substitute`), while `checkValueCall` (`closures/value-calls.ts:28–75`) duplicates the single-callee argument binding (`takenBy`), error reporting (`explain`), `fitArguments`, and `checkReferencedPlaces`.
   - Likewise in lowering, `lowerSpawn` (`src/compiler/lowering/expressions/calls.ts:69–113`) duplicates callee/argument preparation from `lowerCall` and `lowerValueCall` (`calls.ts:27–67, 115–136`).
   - **Fix:** Extract a shared resolved-application completion step in `checker/calls/` and a shared call-lowering preparation helper in `lowering/expressions/calls.ts`.
   - **Done** (`p2-structural`): `applyCall` (`resolution/applied-call.ts`) chooses, reports an ambiguity or the caller's `none`, instantiates, fits the arguments and gives the result, for `resolveCall` and `implicitCall` alike, so P2's conversion is fitted (`fitArguments`) and ranked (`choice.ts`) in one place for every call; `checkValueCall`, which chooses nothing, fits through the same `fitArguments` and explains through the same `explain`. In lowering, `preparedCall` (`lowering/expressions/calls.ts`) evaluates the callee and arguments for `lowerCall` and `lowerSpawn` (which passes all by value).

6. **`[medium]` Double standards in well-known type recognition and bare generic nominal values (`src/compiler/checker/types/type-text.ts:61`, `src/compiler/checker/types/well-known.ts:74`, `src/compiler/checker/expressions/names.ts:91`, `src/compiler/checker/expressions/variants.ts:61`)**
   - `nominalTypeText` (`types/type-text.ts:61`) checks `declaration.name.text === wellKnown.optional.name` by string instead of comparing `type.entity === checker.optionalEntity`, formatting any user-declared `enum Optional<T>` as `T?`. Meanwhile `optionalInner` (`types/fit.ts:57`) and `optionalArgument` (`types/well-known.ts:74`) provide two different functions to unwrap `T?`.
   - **Done** (`p3-unions`), the unwrapping: `optionalArgument` is gone, and every reader of `T?` asks `optionalInner` (`types/fit.ts`). `nominalTypeText`'s name check goes with `Optional` itself, which proposal 3 makes the alias `T | None`, printed structurally.
   - `enumTypeFor` (`expressions/variants.ts:61–85`) unwraps optionals on `expected` (`sameEnum`) and fills default type arguments for bare generic enum variants, whereas `bareStructValue` (`expressions/names.ts:91–116`) neither unwraps optionals on `expected` nor fills default type arguments for bare fieldless generic structs.
   - **Fix:** Route `nominalTypeText` and all `Optional<T>` unwrapping through `optionalInner` (`types/fit.ts`), and share the expected-nominal/default-type-argument resolution between `bareStructValue` and `enumTypeFor`.

7. **`[medium]` Duplicate JSON serialization, depth checks, and recursive `Value` walks in `definition/` and `runtime/` (`src/definition/json-values.ts:89`, `src/definition/format.ts:44`, `src/runtime/scheduler/mocks.ts:104`; widens `Q29`)**
   - `written` and `plainOfJson` in `src/definition/json-values.ts:89–162` duplicate the recursive fold over `Json` variants, and `written` hand-rolls a second canonical JSON serializer alongside `encodeJson` (`src/definition/codec.ts:24`). `defineFormat.read` (`src/definition/format.ts:44`) checks nesting depth *after* `decodeJson`, whereas `jsonOfText` (`json-values.ts:65`) checks `textDepth` *before* `decodeJson`.
   - In `src/runtime/scheduler/mocks.ts:104–144`, `asHostValue`, `leaving`, and `arriving` are three copies of the same recursive `withChildValues(value, childValues(value).map(...))` traversal on the JS call stack (violating the explicit-stack rule in `docs/reuse/structures-and-invariants.md`).
   - **Fix:** Serialize `Json` via `encodeJson(plainOfJson(...))`, run `textDepth` inside `decodeJson` (or `readEnvelope`) before `lossless-json` parses, and replace `asHostValue`/`leaving`/`arriving` with one iterative explicit-stack value mapper.

8. **`[medium]` Why `DeclaringModules` (`Checker.moduleOf`) duplicates `Bindings.moduleOf`, plus parallel AST-to-member lookups (`src/compiler/checker/declaring-modules.ts:26`, `src/compiler/binder/link.ts:49`, `src/compiler/checker/rules/annotations.ts:175`, `src/compiler/checker/lookup/denotations.ts:103`; widens `Q30`)**
   - `DeclaringModules` (`declaring-modules.ts:26–63`) exists alongside `Bindings.moduleOf` (`binder/link.ts:49`) because trait member `FunctionDeclaration`s and synthesized `FieldsFunction`s (`syntax/field-defaults.ts`) have no top-level `Entity` in `Bindings`, and `Checker.moduleOf` is queried with syntax nodes (`Declaration | VariableDeclaration`).
   - Similarly, `Annotations.#fieldType` (`rules/annotations.ts:175–201`) and `declaredField` (`lookup/denotations.ts:103–138`) independently map a field syntax node to its enclosing declaration's `FieldMember`, and `variableType` (`expressions/names.ts:118`) and `declaredVariableType` (`lookup/denotations.ts:91`) independently resolve a `VariableEntity`'s type.
   - **Fix:** Record declaration-to-module ownership once during binding (covering trait members and `FieldsFunction`s) and centralize `fieldMemberOf` and `variableTypeOf` on `Checker`.
   - **Done** (`p2-structural`): fields and variables. `declaredFieldOf` (`types/declared-fields.ts`) maps a field's declaring node and its owner to its `FieldMember`, which annotations (owner from the module's items) and denotations (owner from the node's ancestors) both read; `declaredOutsideBodies` (`expressions/names.ts`) is the one rule for an extern or top-level constant's type, which `variableType` and `declaredVariableType` both read. `DeclaringModules` stays (`Q30` open): trait members and fields functions have no entity, so the binder would need a node-to-module index of its own, a second map rather than one.

9. **`[medium]` Formatter exponential re-printing of huggable call arguments and duplicated `LineMap` / indentation / bracket helpers (`src/formatter/expressions.ts:198`, `src/formatter/bodies.ts:74`, `src/text/line-map.ts:27`, `src/diagnostics/render.ts:77`, `src/lsp/providers/semantic-tokens.ts:53`)**
   - `callArguments` (`src/formatter/expressions.ts:198–221`) prints every argument in `bracketed(...)` and then, when the last argument is huggable, prints `front` and `last` a second time ($O(2^d)$ work on nested huggable calls).
   - `LineMap` (`src/text/line-map.ts:27`) duplicates `splitLines` (`line-map.ts:92`) and hides `#lineEnds`, forcing both `renderDiagnostic` (`src/diagnostics/render.ts:77`) and `linesOf` (`src/lsp/providers/semantic-tokens.ts:53`) to pass `column: Number.MAX_SAFE_INTEGER` to `lines.offsetAt`.
   - **Fix:** Reuse the already-printed argument `Doc`s in `callArguments`, and expose `lineSpan(line)` on `LineMap`.
   - **Done** (`fast-wins`): Formatter part: `TreePrinter.print` keeps each node's doc, so `callArguments` (and `body`, which printed a hugged block twice too) reuse what they printed. `formatter/format.bench.ts`, calls hugging their last argument 16 deep: 458 ms → 0.39 ms mean. The `LineMap` part is done under unit 3.

10. **`[medium]` Spec (`docs/spec.md`) internal contradictions and table/syntax drift (`docs/spec.md:178`, `docs/spec.md:457`, `docs/spec.md:616`, `docs/spec.md:694`, `docs/spec.md:752`, `docs/spec.md:919`, `docs/spec.md:1293`)**
    - **§3.3 vs. §3.7 (`docs/spec.md:360`, `docs/spec.md:457`):** §3.3 states *"a by-value parameter can't be ... passed by `&`"*, while §3.7 says *"What can be referenced. A `let` variable or a parameter..."* where it means *"a `&` parameter"*.
    - **§3.9 vs. §3.10 (`docs/spec.md:571–587`, `docs/spec.md:616`, `docs/spec.md:694–713`):** §3.10's Built-in traits table omits `Container`, `Powerable`, `Bitwise`, and `Shiftable` from §3.9, and §3.9 writes `Powerable<E = Self>` (1 type parameter) where `prelude.ista:281` declares `Powerable<E = Self, T = Self>`.
    - **§9 (`docs/spec.md:1293`):** Writes `Err(Error{message, code: "panic", trace})` with parentheses instead of braces (`Err{Error{...}}`), violating §3.11.
    - **§3.11 vs. §3.15 (`docs/spec.md:752`, `docs/spec.md:919`):** Splits the list of refutable patterns across two partial lists (`alternative, array pattern, range` in §3.11 vs. `literal, comparison, enum variant` in §3.15, with neither mentioning `any` downcast patterns from §3.10).
   - **Done** (`fast-wins`): §3.7 says a `&` parameter; §3.9 writes `Powerable<E = Self, T = Self>`; §3.10's table gains `Container`, `Powerable`, `Bitwise` and `Shiftable`; §9 writes `Err{Error{…}}`.
   - **Done** (`p3-unions`): the refutable-pattern split: §3.11's "Patterns that can fail" is the one list (with the `any` type pattern), and §3.15 refers to it.

## Checklist

- [x] 1. `src/structures/` (including `entries/`)
- [x] 2. `src/language/`
- [x] 3. `src/text/`
- [x] 4. `src/diagnostics/`
- [x] 5. `src/definition/` (including `instructions/`)
- [x] 6. `src/compiler/syntax/` (including `expressions/`)
- [x] 7. `src/compiler/scanner/`
- [x] 8. `src/compiler/parser/` — machinery & shared parts (`parse.ts`, `parser.ts`, `grammar.ts`, `brackets.ts`, `held-bodies.ts`, `reuse.ts`, `recovery.ts`, `nesting.ts`, `annotations.ts`, `docstrings.ts`, `diagnostics.ts`, `cursor/`, `layout/`, `parts/`)
- [x] 9. `src/compiler/parser/` — grammar categories (`types.ts`, `patterns.ts`, `expressions/`, `statements/`, `declarations/`)
- [x] 10. `src/compiler/program/`
- [x] 11. `src/compiler/binder/`
- [x] 12. `src/compiler/checker/` — root contracts, contexts & wiring (`check.ts`, `context.ts`, `program-inputs.ts`, `program-checker.ts`, `body-checker.ts`, `use-site.ts`, `resolved-call.ts`, `checked-pattern.ts`, `checked-field.ts`, `constant-form.ts`, `json-form.ts`, `checked-annotation.ts`, `struct-items.ts`, `denotation.ts`, `host-externs.ts`, `declaring-modules.ts`, `diagnostics/`)
- [x] 13. `src/compiler/checker/types/`
- [x] 14. `src/compiler/checker/inference/` & `src/compiler/checker/traits/`
- [x] 15. `src/compiler/checker/resolution/`
- [x] 16. `src/compiler/checker/calls/`
- [x] 17. `src/compiler/checker/patterns/` & `src/compiler/checker/flow/`
- [x] 18. `src/compiler/checker/rules/` (including `rules/json-forms/`)
- [x] 19. `src/compiler/checker/declarations/` & `src/compiler/checker/closures/`
- [x] 20. `src/compiler/checker/expressions/`, `src/compiler/checker/statements/` & `src/compiler/checker/lookup/`
- [x] 21. `src/compiler/lowering/` — core, tables & function lowering (`lower.ts`, `context.ts`, `tables.ts`, `type-table.ts`, `names.ts`, `constants.ts`, `instances.ts`, `filling-entry.ts`, `async-fits.ts`, `bodies.ts`, `code-writer.ts`, `synthesized-code.ts`, `emit-call.ts`, `iteration.ts`, `places.ts`, `optional-chains.ts`, `patterns.ts`, `packs.ts`, `never-lowered.ts`, `function-lowering/`)
- [x] 22. `src/compiler/lowering/boundary/` & `src/compiler/lowering/trait-objects/`
- [x] 23. `src/compiler/lowering/expressions/` & `src/compiler/lowering/statements/`
- [x] 24. `src/compiler/compile.ts`
- [x] 25. `src/runtime/` — core, values, snapshot, lifetimes & interpreter (`natives.ts`, `store.ts`, `refusal.ts`, `random-seed.ts`, `instance-state.ts`, `instance-group.ts`, `settle.ts`, `host.ts`, `values/`, `snapshot/`, `lifetimes/`, `interpreter/`)
- [x] 26. `src/runtime/scheduler/`, `src/runtime/boundary/` & `src/runtime/testing/`
- [x] 27. `src/stdlib/` — infrastructure & prelude (`std-sources.ts`, `stdlib-loader.ts`, `std-module.ts`, `std-modules.ts`, `natives.ts`, `native-values.ts`, `numeric.ts`, `positions.ts`, `ranges.ts`, `prelude/`)
- [x] 28. `src/stdlib/` — standard library modules (`collections/`, `crypto/`, `decimal/`, `fanout/`, `futures/`, `inbox/`, `json/`, `log/`, `math/`, `random/`, `regex/`, `rpc/`, `runtime/`, `strings/`, `testing/`, `time/`)
- [x] 29. `src/formatter/`
- [x] 30. `src/project/`
- [x] 31. `src/language-service/` — core, navigation, semantic-tokens & editor queries (`workspace.ts`, `checked-module.ts`, `tokens.ts`, `identifier-at.ts`, `call-at.ts`, `signatures.ts`, `docstrings.ts`, `namespaces.ts`, `folding.ts`, `symbols.ts`, `hover.ts`, `inlay-hints.ts`, `signature-help.ts`, `navigation/`, `semantic-tokens/`)
- [x] 32. `src/language-service/completion/` (including `grammar/` and `places/`)
- [x] 33. `src/lsp/` (including `providers/`)
- [x] 34. `src/cli/` (including `commands/`) & `src/vscode-client/`
- [x] 35. `docs/spec.md` — Cheat sheet, §1 Overview, §2 Lexical structure and types
- [x] 36. `docs/spec.md` — §3 Declarations
- [x] 37. `docs/spec.md` — §4 Expressions and control flow, §5 Persistence, §6 Slots and inboxes, §7 Lifetimes and disposal, §8 `select`
- [x] 38. `docs/spec.md` — §9 Program structure, §10 Testing, §11 Packages, §12 Examples, §13 Open questions, §14 Future work

---

## Findings by Unit

### 1. `src/structures/` (including `entries/`)

- **Duplicate prefix-tree (trie) implementations: `TupleSet` (`src/structures/entries/tuple-set.ts`) vs. `SequenceMemo` (`src/structures/memo.ts`):**
  - `SequenceMemo` and `TupleSet` both implement prefix trees keyed by a sequence of items (`for (const item of items)` walking down `node.next`). `SequenceMemo` uses `memo(node.next, item, ...)` over `WeakMap` and stores `found?: { readonly value: Value }`, while `TupleSet` hand-rolls the lookup/insert (`let next = prefix.next.get(item); if (next === undefined) ...`) over `Map` and stores `added: boolean` — bypassing `memo` (`src/structures/memo.ts`) and duplicating the trie traversal.
- **Unmemoized, repeated transitive-read graph traversal in `notesOfReads` (`src/structures/entries/entry.ts`, `index.ts`; widens `P10`):**
  - `notesOfReads(entry)` walks the full transitive `entry.reads` graph from scratch (allocating `seen = new Set`, `pending = [...entry.reads]`, and `notes = []`) on every call to `notesFrom(entry)`, `Entries.notesReached()`, and `#replays` (`case 'notes'`). Even after an entry finishes computing (`!entry.running && !entry.open`), its transitive notes are never memoized on the `Entry`, and multiple `notesReached()` calls within one computing entry re-walk the entire subgraph already visited.
- **Quadratic array-spreading multimap construction in `Components` (`src/structures/strongly-connected.ts`):**
  - `Components.constructor` builds adjacency lists with `this.#successors.set(from, [...(this.#successors.get(from) ?? []), to])`, copying the entire neighbor array on every edge ($O(d^2)$ in out-degree) instead of pushing onto a mutable array or using a shared group-by helper (the same pattern recurs in `ValueSemantics.#tableOf` and `#carryTable` in `src/language/values.ts`).
  - **Done** (`fast-wins`): `Components`, `SegmentReuse`, `Linker.#index`, `CodeWriter.#refer`, `StaticFunctions.#index`, `checkClashes` and the LSP rename's `workspaceEdit` fill their groups with `addToGroup` (`structures/groups.ts`); `functionSets` and `callWithTypes` use `Map.groupBy`; the LSP test kit and two tests use `addToGroup` too. `#tableOf` pushes in place by hand, since `language/` imports nothing. `#carryTable` keeps its copy: the old map keeps its bucket (persistent update, `P8`). `mocksOf` is unit 26's.

### 2. `src/language/`

- **Double standard for case classification in `followsConvention` vs. `bindsInPattern` (`src/language/naming.ts`):**
  - The banner states that both functions *"read the same first letter, so they share this module"*. Yet `followsConvention` tests `shapes.type` (`/^[A-Z][A-Za-z0-9]*$/u`) and `shapes.value` (`/^[a-z][A-Za-z0-9]*$/u`), while `bindsInPattern` computes `const first = withoutPrivacy(name).charAt(0); return first !== first.toUpperCase()`. Because `'' !== ''.toUpperCase()` and `'1' !== '1'.toUpperCase()` are `false`, `bindsInPattern('_')` and `bindsInPattern('_1')` return `false` (classifying them as non-binding variant/type names), disagreeing with `followsConvention(..., 'type')`.
  - **Done** (`fast-wins`): `bindsInPattern` reads the first letter through `shapes.type`, so `_`, `_1` and every name not cased as a type bind (`naming.test.ts`).
- **`ValueSemantics.withoutEntry` drops the cached hash table and `partSteps` over-allocates (`src/language/values.ts`; widens `P8`):**
  - `withEntry` carries/updates `#tables` via `#carryTable` (whose full-map copy and bucket spread are tracked in `P8`), whereas `withoutEntry` discards `#tables` completely, forcing the next lookup after a removal to re-hash/re-index the entire map in `#tableOf`.
  - In addition, `partSteps` allocates `shape.map.entries.flat()`, then `.toReversed()`, then `.map(...)`, and spreads `[join, ...]` on every uncached composite/map hash, instead of pushing `visit` steps onto `steps` in reverse order directly.

### 3. `src/text/`

- **Three overlapping UTF-16 ↔ code-point stepping loops (`src/text/code-points.ts`):**
  - `utf16Offset(s, position)`, `codePointsAt(s)`, and `codePointSlice(s, start, end)` each write their own `codePointWidth(s, offset)` stepping loop. `codePointPositions(s)` provides a stateful monotonic UTF-16-offset → code-point-index cursor, and `codePointsAt(s)` already embeds a bidirectional code-point-index ↔ UTF-16-offset cursor internally; extracting that bidirectional cursor as `utf16Offsets(s): (position: number) => number` would let `utf16Offset`, `codePointSlice`, and `codePointsAt` share one stepping implementation.
- **Duplicate line-break scanning in `splitLines` and `LineMap`, and hidden `#lineEnds` (`src/text/line-map.ts`, `src/diagnostics/render.ts`):**
  - `splitLines(text)` and `new LineMap(text)` run identical `while (offset < text.length)` loops calling `lineBreakLength(text, offset)` to find every line's `[start, end)` bounds.
  - Although `LineMap` computes and stores `#lineStarts` and `#lineEnds`, it exposes no `lineSpan(line)` or `lineText(source, line)` method, forcing `renderDiagnostic` (`src/diagnostics/render.ts`) to reconstruct a line's bounds via `lines.offsetAt({ line, column: 0 })` and `lines.offsetAt({ line, column: Number.MAX_SAFE_INTEGER })`.
  - **Done** (`fast-wins`): `splitLines` and `LineMap` share one scan (`lineBounds`); `LineMap.lineSpan(line)` exposes a line's bounds, which `offsetAt` reads too.

### 4. `src/diagnostics/`

- **Workaround for missing `LineMap` line-span query in `renderDiagnostic` (`src/diagnostics/render.ts`):**
  - Covered under Unit 3 (`LineMap`): `renderDiagnostic` passes `Number.MAX_SAFE_INTEGER` as a synthetic column to `lines.offsetAt` to recover `#lineEnds[line]`.
  - **Done** (`fast-wins`): `renderDiagnostic` reads `lines.lineSpan(line)`.

### 5. `src/definition/` (including `instructions/`)

- **Duplicate array/map narrowing and JSON serialization in `json-values.ts` (`src/definition/json-values.ts`, `values.ts`, `codec.ts`):**
  - `listItems(field)` and `objectEntries(field)` in `src/definition/json-values.ts` duplicate `elementsOf(field)` and `mapValueOf(field).entries` from `src/definition/values.ts`.
  - `written(json, shape, depth)` and `plainOfJson(json, shape, depth)` duplicate the recursive fold over `Json` variants (`Null`, `Bool`, `Integer`, `Number`, `Text`, `List`, `Object`). Furthermore, `written` hand-rolls a second canonical JSON serializer (formatting `bigint` digits, finite float checks, and sorting object keys with `compareOrdered`), when `encodeJson(plainOfJson(json, shape))` in `src/definition/codec.ts` already performs the exact same canonical serialization via `lossless-json`.
  - `partsOf` in `src/definition/json-values.ts` linearly scans `(Object.keys(shape.variants) as JsonVariant[]).find((name) => shape.variants[name] === json.variant)` at every visited `Json` node instead of `JsonType` storing the inverse `variant → JsonVariant` array once in `findJsonType`.
- **Double standard for JSON nesting-depth checks before vs. after `decodeJson` (`src/definition/format.ts`, `src/definition/json-values.ts`):**
  - `defineFormat.read` (`src/definition/format.ts`) calls `decodeJson(text)` inside `readEnvelope` *before* checking `jsonDepth(contents) > maximumTextDepth` in `requireShallow` (so deeply nested input hits `lossless-json`'s recursive parser before the depth guard).
  - By contrast, `jsonOfText` (`src/definition/json-values.ts`) runs a regex bracket scanner `textDepth(text) > maximumDepth` *before* `decodeJson(text)`, and then `jsonOfPlain` checks `depth > maximumDepth` again during conversion.
- **`hasRole` narrowed to `ExternRole` only (`src/definition/types.ts`, `src/definition/json-values.ts`):**
  - `hasRole(types, type, role)` only accepts `ExternRole` (`'shared' | 'cell' | 'future' | 'instance'`) and checks `entry?.kind === 'extern'`, forcing `findJsonType` (`src/definition/json-values.ts`) to hand-write `candidate.kind === 'enum' && candidate.role === 'json'` instead of calling `hasRole(types, index, 'json')`.
- **Hard-coded variant/struct field names in `declared-values.ts` (`src/definition/declared-values.ts`, `src/language/well-known.ts`):**
  - `optionalOf`, `okTypeOf`, `okOf`, `errOf`, and `errorOf` import `optionalVariants` and `resultVariants` from `src/language/well-known.ts`, but hard-code the field names `'value'` and `'error'` as string literals.
  - **Done** (`p3-unions`): `resultFields` and `optionalValueField` (`language/well-known.ts`) name the fields once; `optionalValueOf` (`declared-values.ts`) reads an optional by its declared variant and field.

### 6. `src/compiler/syntax/` (including `expressions/`)

- **Unmemoized `extentIn(tree, node)` despite banner contract (`src/compiler/syntax/tree.ts`; widens `B21`):**
  - The banner of `src/compiler/syntax/tree.ts` states: *"What tools ask of a tree by position derives from the same children, memoized on the immutable node or tree: a node's parent, the text a node and everything under it cover (its extent, as its own span is anchored to its segment: positions.ts), and the nodes at an offset."*
  - However, `extentIn(tree, node)` is not memoized: every call walks down `childrenOf(tree, first)` and `lastChildOf(tree, last)` to the leaves, and `nodesAt(tree, offset)` calls `extentIn` on every sibling tested at every level of the tree (contributing to the `tree.test.ts` `nodesAt` timeout in `B21`).
  - **Done** (`fast-wins`): See ranked summary #2.
- **Ad-hoc `bare.text === '_'` check in `isUnnamedTarget` (`src/compiler/syntax/statements.ts`):**
  - `isUnnamedTarget` checks `bare.kind === 'Identifier' && bare.text === '_'` instead of calling `isUnnamed(bare.text)` (`src/language/naming.ts`).
  - **Done** (`fast-wins`): `isUnnamedTarget` calls `isUnnamed`.
- **Missing `unparenthesizedType` helper for `TypeNode` (`src/compiler/syntax/types.ts`):**
  - `syntax/expressions/index.ts` exports `unparenthesized(node: Expression)` and `syntax/patterns.ts` exports `unparenthesizedPattern(node: Pattern)`, but `syntax/types.ts` keeps `ParenthesizedType` private and provides no `unparenthesizedType(node: TypeNode)` helper for callers inspecting type nodes.
  - **Done** (`fast-wins`): `unparenthesizedType` sits in `syntax/types.ts`, as the human decided (2026-11-04): `resolveConstraint` sees through it, so `T is (Comparable)` is legal, and `writtenByReference` and a function type's parameters read `(&T)` as a reference, though the parser still refuses the `&` there. `any (T)` and `new (T){…}` stay refused: `any` and `new` are keywords only before a name (§2).

### 7. `src/compiler/scanner/`

- **Bracket pairing re-scans the token stream instead of deriving from the scanner's pass (`src/compiler/scanner/scan.ts`, `src/compiler/parser/brackets.ts`, `src/language-service/tokens.ts`; widens `P17`):**
  - `Scanner.#scanTokens` already walks every token in order and tracks brace depth (`braceChange`), yet `unclosedBracketEnds` (`src/compiler/parser/brackets.ts`) and `closingBracketsOf` (`src/language-service/tokens.ts`) re-walk the entire token array from scratch in `pairBrackets`.
- **Repeated `[...run]` allocations in `scanRadixInteger` (`src/compiler/scanner/numbers.ts`):**
  - `scanRadixInteger` spreads the ASCII identifier run `[...run]` twice (once for `.filter(radix.isDigit)` and once for `.findIndex(...)`) and adds the code-point index `invalidAt` to the UTF-16 offset `digitsStart`.

### 8. `src/compiler/parser/` — machinery & shared parts

- **Two hand-rolled binary searches duplicating `lastIndexAtMost` (`src/compiler/parser/brackets.ts`, `src/compiler/parser/cursor/index.ts`, `src/structures/sorted.ts`):**
  - `lineOf` in `src/compiler/parser/brackets.ts` and `Cursor.lineHead` in `src/compiler/parser/cursor/index.ts` each write their own `while (low < high)` binary search loop (`Math.ceil((low + high) / 2)`), duplicating `lastIndexAtMost` (`src/structures/sorted.ts`).
  - **Done** (`fast-wins`): `lineOf` and `Cursor.lineHead` call `lastIndexAtMost`.
- **Duplicate node-field reflection walk in `bodiesHeldBy` (`src/compiler/parser/held-bodies.ts`, `src/compiler/syntax/tree.ts`):**
  - `bodiesHeldBy` inspects `Object.values(node)` with `Array.isArray(value)` and `isNode` directly instead of sharing the field-child extraction in `src/compiler/syntax/tree.ts` (`fieldChildrenOf`).
- **Repeated array-spreading multimap insertion in `SegmentReuse` (`src/compiler/parser/reuse.ts`):**
  - `SegmentReuse.constructor` builds `#unused` with `this.#unused.set(run.text.text, [...(this.#unused.get(run.text.text) ?? []), run])`, repeating the same copying multimap pattern as `strongly-connected.ts` and `language/values.ts`.
  - **Done** (`fast-wins`): Uses `addToGroup` (unit 1).

### 9. `src/compiler/parser/` — grammar categories

- **Ad-hoc `'_'` string checks instead of `isUnnamed` (`src/compiler/parser/patterns.ts`, `src/compiler/parser/statements/variables.ts`, `src/language/naming.ts`):**
  - `parseWildcard` (`patterns.ts`) and `startsHeldVariableAt` (`statements/variables.ts`) both test `parser.textOf(...) === '_'` directly instead of calling `isUnnamed` (`src/language/naming.ts`), just as `isUnnamedTarget` does in `syntax/statements.ts`.
  - **Done** (`fast-wins`): `parseWildcard` and `startsHeldVariableAt` call `isUnnamed`.
- **Duplicate `RangePattern` construction in `parseRangePattern` and `parseOpenRangePattern` (`src/compiler/parser/patterns.ts`):**
  - Unlike `expressions/operators.ts` (where `parseOpenRange` and `rangeParselet` delegate to `parseRangeRest`), `parseRangePattern` and `parseOpenRangePattern` in `patterns.ts` duplicate the operator-kind check, `parseRangeBound`, and `RangePattern` node construction.
- **Closed parselet dispatch tables duplicated in completion (`src/compiler/parser/`, `src/language-service/completion/grammar/words.ts`; tracked as `Q35`):**
  - `typeParselets`/`wordParselets`, `patternParselets`, `prefixParselets`/`infixParselets`, `statementParselets`, and `topLevelParselets` are internal to `parser/`, forcing `completion/grammar/words.ts` to restate the keyword sets (`Q35`).
  - **Done** (`p3-unions`): each position's words have one home, `syntax/grammar-words.ts` (`declarationWords`, `statementWords`, `operandWords`, `infixWords`, `typeWords`, `PatternWord`, `followers`). Every parselet table above `satisfies` its list both ways (`StartParselets` for keywords, `WordParselets` for contextual words, `parser/word-parselets.ts`), and the lookaheads of `shared`, `sendable`, `hold` and `async` read `followers`. Completion offers the lists and names only the words that need surroundings (`wordNeeds`). Its property test now runs both ways: each keyword the parser takes at a corpus statement or operand is offered, unless it needs surroundings.

### 10. `src/compiler/program/`

- **Unconditional `read()` and import re-resolution for unchanged modules in `buildProgram` (`src/compiler/program/program.ts`):**
  - For every reachable module, `buildProgram` calls `createSourceText(label, read())` and compares `before?.source.text === source.text && before.source.path === source.path`, and even when `reusableTree` reuses `before` by identity, `buildProgram` still re-runs `resolveImports(tree, id, options.loaders)` over `tree.root.items` on every build.

### 11. `src/compiler/binder/`

- **Three ad-hoc `name.text === '_'` checks in `LocalBinder` instead of `isUnnamed` (`src/compiler/binder/local-binder.ts`, `src/language/naming.ts`):**
  - `LocalBinder.use` (twice) and `LocalBinder.declare` check `name.text === '_'` directly instead of calling `isUnnamed(name.text)` (`src/language/naming.ts`).
  - **Done** (`fast-wins`): `use` and `declare` call `isUnnamed`; `docs/reuse/modules-and-names.md` gains the one-way rule.
- **Duplicate qualification predicates `mayQualify` and `qualifies` (`src/compiler/binder/local-binder.ts`, `src/compiler/binder/link.ts`; related to `B25`):**
  - `mayQualify(head)` in `local-binder.ts` and `qualifies(entity)` in `link.ts` duplicate the check `entity.kind === 'namespace' || (entity.kind === 'type' && entity.declaration.kind === 'EnumDeclaration')` instead of sharing `qualifies` from `entities.ts`.
  - **Done** (`fast-wins`): `qualifies` moved to `entities.ts`; `mayQualify` adds only what a head unlinked yet may be (none, or an import) and asks `qualifies` for the rest.
- **Duplicate namespace-to-module resolution in `Linker.#importedBy` and `language-service/namespaces.ts` (`src/compiler/binder/link.ts`, `src/language-service/namespaces.ts`):**
  - `Linker.#importedBy(namespace)` (`link.ts`) and `importedModule(program, bindings, namespace)` (`language-service/namespaces.ts`) compute the exact same lookup (`program.modules.get(importer)?.imports.get(namespace.declaration)`). Exposing `importedBy` on `Bindings` would eliminate the duplicate helper in `language-service/`.
- **`bindTrait` misses annotations on `Invalid` trait members (`src/compiler/binder/declarations.ts`; widens `Q36`):**
  - `Q36` notes that list sites skipping `Invalid` items must remember to bind their rejected annotations (`bindModule`, `bindBlock`, `bindRejectedAnnotations` in `expressions.ts`). In `bindTrait` (`declarations.ts`), `bindFields` binds annotations on non-function members (including `Invalid` only because `Invalid !== 'FunctionDeclaration'`), which is fragile and implicit compared to a single generic rule for `Invalid` annotations.
- **Repeated array-spreading multimaps in `functionSets` and `Linker.#index` (`src/compiler/binder/module-scope.ts`, `src/compiler/binder/link.ts`):**
  - `functionSets` (`sets.set(name, [...(sets.get(name) ?? []), declared])`) and `Linker.#index` (`this.#variantsByName.set(name, [...this.variantsNamed(name), variant])`) repeat the copying multimap pattern.
  - **Done** (`fast-wins`): `functionSets` uses `Map.groupBy` (`functionsEntity` takes the name it is grouped by); `Linker.#index` uses `addToGroup` (unit 1).

### 12. `src/compiler/checker/` — root contracts, contexts & wiring

- **Inconsistent `partsOf` and `headKey` in `ConstantForm` (`src/compiler/checker/constant-form.ts`):**
  - Unlike `childValues(composite)` in `src/definition/values.ts` (which handles `'map'` via `composite.entries.flat()`), `partsOf(form)` in `constant-form.ts` omits `'map'`, forcing both `formAt` and `sameForm` to repeat `form.kind === 'map' ? form.entries.flat() : partsOf(form)`.
  - `formAt` recurses on the JS stack while `sameForm` in the same file uses an explicit stack.
  - `formSemantics` sets `headKey: (form) => form.kind`, giving every struct constant in a compile-time map key the identical head hash `'struct'` regardless of its nominal type.
- **Why `DeclaringModules` duplicates `Bindings.moduleOf` (`src/compiler/checker/declaring-modules.ts`, `src/compiler/binder/link.ts`; widens `Q30`):**
  - `Q30` notes that `Checker.moduleOf` (`DeclaringModules`) and `Bindings.moduleOf` both answer a declaration's module. The root cause is that `Bindings.moduleOf` is keyed by `Entity`, whereas trait member `FunctionDeclaration`s and synthesized `FieldsFunction`s (`syntax/field-defaults.ts`) have no top-level `Entity` in `Bindings`, and `Checker.moduleOf` takes syntax nodes (`Declaration | VariableDeclaration`) rather than entities. Unifying module ownership on `Bindings` (including trait members and fields functions, or resolving local declarations through their `VariableEntity`) deletes `DeclaringModules` and its `parentOf(tree, node)` search across all program modules.
- **Unenforced incremental-checking invariants on `CheckerContext` and `EntryTable` (`src/compiler/checker/context.ts`, `program-checker.ts`; tracked as `Q31`):**
  - `CheckerContext extends Checker` exposes `readonly program: Program` to all checker units, and `EntryTable` passes unverified side contexts (`module` in `#resolvedTypes`, `NominalType` in `#disposals`).

### 13. `src/compiler/checker/types/`

- **`nominalTypeText` recognizes `Optional<T>` by declaration name string instead of entity (`src/compiler/checker/types/type-text.ts`, `well-known.ts`):**
  - Violating the one-way rule in `docs/reuse/types-and-fitting.md` (*"Recognize well-known types by binder entity via `src/compiler/checker/types/well-known.ts` or `optionalInner` (`fit.ts`), never by declaration name string"*), `nominalTypeText` tests `declaration.kind === 'EnumDeclaration' && declaration.name.text === wellKnown.optional.name`, so any user-declared `enum Optional<T>` is formatted as `T?`.
- **Two homes for unwrapping `T?`: `optionalInner` (`src/compiler/checker/types/fit.ts`) vs. `optionalArgument` (`src/compiler/checker/types/well-known.ts`):**
  - `optionalInner(type, checker.optionalEntity)` checks `type.entity === optional` using `ProgramChecker`'s cached `#optional` entry, whereas `optionalArgument(checker, type)` calls `wellKnownArguments(checker, wellKnown.optional, type)` (allocating a fresh `NominalType` via `checker.wellKnownType(wellKnown.optional)` on every call) to answer the exact same question.
- **Duplicate array equality (`sameTypes`), anonymous-struct child extraction, and function compatibility (`src/compiler/checker/types/type.ts`, `type-parts.ts`, `src/structures/equality.ts`):**
  - `sameTypes` in `type.ts` re-implements `sameItems(sameType)` (`src/structures/equality.ts`).
  - `sameType`'s `'anonymous'` branch manually compares `isSharedValueType(first) ? first.arguments : []` and `first.fields.map((field) => field.type)` instead of comparing `typeChildren` (`type-parts.ts`), which `Inference.#matchExact` (`inference/infer.ts`) uses.
  - `isAssignable` (`type.ts`) and `Inference.#matchFunction` (`inference/infer.ts`) duplicate the function-header check `given.isAsync === declared.isAsync && (given.isSendable || !declared.isSendable) && sameShape(...)`.
  - **Done** (`fast-wins`): `sameTypes` is `sameItems(sameType)`.
  - **Done** (`p2-structural`): `sameType` is key equality (`types/identity.ts`), with no structural walk left, and the shared value's arguments are gone from shapes; `functionFits` (`types/type.ts`) is the one function-header rule, which `isAssignable` and `Inference.#matchFunction` both call.
- **`heldType` hand-rolls a visited set instead of using `TypeCycle` (`src/compiler/checker/types/held.ts`, `type-cycle.ts`; widens `Q7`):**
  - `heldType` maintains `const walked = new Set<string>()` keyed by `checker.typeKeys.typeKey(part)` instead of using `TypeCycle` (`type-cycle.ts`).
  - **Done** (`fast-wins`): `heldType` guards its walk with `TypeCycle`. A type reached on two branches is walked on each (the visited set walked it once); the answer is the same.

### 14. `src/compiler/checker/inference/` & `src/compiler/checker/traits/`

- **Duplicate `isPack` predicate (`src/compiler/checker/inference/infer.ts`, `src/compiler/checker/types/type.ts`):**
  - `infer.ts` defines a local `isPack(parameter: ParameterKey)` alongside `isPack(type: Type)` in `types/type.ts`.
  - **Done** (`fast-wins`): `infer.ts` asks `types/type.ts`'s `isPack` of `parameterType(parameter)`.
- **`unsafetyOf` manually resolves and substitutes trait fields instead of using `requiredFieldType` / `constraintSubstitution` (`src/compiler/checker/traits/any-types.ts`, `constraints.ts`):**
  - `unsafetyOf` (`any-types.ts`) manually builds `substitutionFor(trait.typeParameters, constraint.arguments)` and calls `checker.resolveType(checker.moduleOf(trait), field.type)` instead of calling `requiredFieldType(checker, constraint, field, parameterType(trait))` and `constraintSubstitution(constraint, parameterType(trait))` from `constraints.ts`.
  - **Done** (`p3-unions`): object safety is one exported rule, `objectUnsafety` (`traits/object-safety.ts`), reading a trait's fields and functions through `requiredFieldType` and `constraintSubstitution` with the trait's own `Self`; `any` types ask it (`any-types.ts`), and so will a union meeting a trait through its members (proposal 3, §6).

### 15. `src/compiler/checker/resolution/`

- **Duplicated call-completion pipeline between `implicitCall` (`src/compiler/checker/resolution/implicit.ts`) and `resolveCall` (`src/compiler/checker/calls/resolve.ts`):**
  - `implicitCall` and `resolveCall` (`complete`) both check for `error` argument types, run `choose`, report `checkerDiagnostics.ambiguousCall(..., argumentListText(...))` on `'several'`, call `instantiate(useSite(...), application, expected)`, call `fitArguments(context, request.arguments, filledTypes(...))`, build `callMade(application, instantiation)`, and return `substitute(application.signature.result(), instantiation.substitution)`.
  - **Done** (`p2-structural`): see Ranked Summary item 5.
- **Duplicate entity-to-type dispatch in `entityType` (`src/compiler/checker/resolution/named.ts`) vs. `namedType` (`src/compiler/checker/types/resolve-type.ts`):**
  - Both switch on `entity.kind` (`primitive`, `type`) and `entity.declaration.kind` (`TypeParameter`, `TypeAliasDeclaration`, `TraitDeclaration`, nominal declarations) to construct a `Type`, with `entityType` hard-coding `arguments: []` on `TypeAliasDeclaration` without filling default type parameters.
  - **Done** (`p2-structural`): both go through `typeOfEntity` (`types/resolve-type.ts`), given the arguments each finds: a written type's, defaults filled, or none for a name in a value's place, which names a generic declaration, an alias too, as a whole.
- **Derived traits if-chain in `conform` (`src/compiler/checker/resolution/conformance.ts`; tracked as `Q7`):**
  - `conform` branches on `isSendableTrait`, then `jsonDirectionOf` (`codecWitness`), before checking trait fields and functions (`Q7`).
  - **Done** (`p3-unions`): the derived traits are one table (`derivationOf`, `resolution/derived-traits.ts`): each well-known trait's `Derivation` says what it asks of every type (`lacking`: Sendable's rule; the codecs' implied Sendable, except at the host, and the nested-optional refusal) and derives the witness of a required function none is declared for (`derive`). `conform` asks the table and branches on no trait; a form with nothing to derive from says nothing (`DerivedCodec.missing`), so a missing codec is reported as any missing function is. Each rule switches on the type's kind (`traits/sendable.ts`, `rules/json-forms/`), so a new kind of type is one case per rule. `isSendableTrait` is gone, and `traits/sendable.ts` no longer imports `json-form.ts`.

### 16. `src/compiler/checker/calls/`

- **Second recursive walk over composite expressions in `inferNestedLambdas` (`src/compiler/checker/calls/lambda-arguments.ts`):**
  - `inferNestedLambdas` and `branchBodiesOf` switch over `Lambda`, `BlockExpression`, `If`, `Match`, `Select`, `Tuple`, `ArrayLiteral`, and `MapLiteral`, duplicating the composite expected-type decomposition and branch collection already implemented for `Accepts` in `expressions/` and `rules/branches.ts`.
  - **Done** (`p3-unions`): `types/expected.ts` is the one home for taking an expected type apart (`builtFrom`, `expectedTuple`, `collectionTarget`, `expectedFunction`, `sameNominal`, `enumsExpected`), which the literals, lambdas, function values and `inferNestedLambdas` all read; `valueBranchesOf` (`syntax/expressions/branches.ts`) lists the blocks giving an `if`, `match` or `select` its value, for their `Accepts` and for the lambdas inferred in them.
- **Repeated `operands.join(' and ')` formatting for `operatorTypes` (`src/compiler/checker/calls/resolve.ts`, `resolution/implicit.ts`, `types/equality.ts`):**
  - `explainNone` (`calls/resolve.ts`), `implicitOperatorCall` (`resolution/implicit.ts`), and `checkEqualSides` (`types/equality.ts`) each format operand type lists with `.join(' and ')` at the call site instead of `checkerDiagnostics.operatorTypes` formatting an array of operand strings.
  - **Done** (`fast-wins`): `operatorTypes` takes the operand list and joins it.

### 17. `src/compiler/checker/patterns/` & `src/compiler/checker/flow/`

- **Manual `MatchCase` / `SelectCase` filtering in `FlowWalk` (`src/compiler/checker/flow/forward.ts`, `src/compiler/syntax/expressions/index.ts`):**
  - `constructs.Match` in `flow/forward.ts` writes `node.cases.filter((each) => each.kind === 'MatchCase')` instead of calling `casesOf(node)` (`src/compiler/syntax/expressions/index.ts`).
  - Similarly, `Select` has no `selectCasesOf(node)` helper alongside `casesOf(node)` in `syntax/expressions/index.ts`, so `flow/forward.ts`, `binder/expressions.ts`, `checker/calls/lambda-arguments.ts`, `checker/expressions/select.ts`, and `lowering/expressions/select.ts` each filter `each.kind === 'SelectCase'` by hand.
  - **Done** (`fast-wins`): `FlowWalk` calls `casesOf`; `selectCasesOf` beside it serves the five select sites.
- **Three separate implementations of negative numeric literal unwrapping (`src/compiler/checker/patterns/matching.ts`, `patterns/shapes.ts`, `rules/computation.ts`):**
  - `intValueOf` (`patterns/matching.ts`), `literalKey` (`patterns/shapes.ts`), and `Computation.#own` / `isNumberLiteral` (`rules/computation.ts`) each inspect `Unary` with `operator === '-'` over numeric literals independently (and `literalKey` formats `-0` as `'-IntegerLiteral:0'` vs. `'IntegerLiteral:0'` for `0`, even though `-0 == 0`).
  - **Done** (`fast-wins`): `intValueOf`, `literalKey` and `Computation.#own` read through `signedNumberOf` (`syntax/expressions/numbers.ts`); `-0` keys as `0`, so `case -0` after `case 0` is unreachable (`patterns.test.ts`).

### 18. `src/compiler/checker/rules/` (including `rules/json-forms/`)

- **Duplicate target binding in `bindLoopTargets` (`src/compiler/checker/rules/iteration.ts`) vs. `declareTargets` (`src/compiler/checker/statements/variables.ts`):**
  - `bindLoopTargets` in `rules/iteration.ts` (`walkTargets(bodyScope(context), node.targets, ...)` followed by `context.variables.declare` and `context.variables.recordTargets`) is an exact copy of `declareTargets` in `statements/variables.ts`.
  - **Done** (`fast-wins`): `bindLoopTargets` is gone; declarations, `for` and comprehensions call `declareTargets`, which moved to `checker/patterns/targets.ts` because `rules/` sits beneath `statements/` in the checker layers.
- **Duplicate string-field extraction in `Annotations.jsonNameOf` vs. `Annotations.#textOf` (`src/compiler/checker/rules/annotations.ts`):**
  - `jsonNameOf(field)` manually extracts `named?.form.kind === 'struct' ? named.form.fields[0] : undefined` and checks `value?.kind === 'primitive' && typeof value.value === 'string'`, duplicating `this.#textOf(this.ofField(field), 'jsonName') ?? field.name` right below it.
  - **Done** (`fast-wins`): `jsonNameOf` reads through `#textOf`.
- **Double `defaultWitness` resolution for `@JsonSkip` fields (`src/compiler/checker/rules/annotations.ts`, `src/compiler/checker/rules/json-forms/index.ts`; widens `Q9`):**
  - `Annotations.#problem` resolves `defaultWitness(searchSite(this.#seams.checker), held)` to validate `@JsonSkip` on a field, and `JsonForms.#field` resolves `defaultWitness(searchSite(checker), field.type)` a second time to populate `JsonField.skipped`.
  - **Done** (`p3-unions`): what a skipped field reads back as has one home, `JsonForms.skippedDefaultOf` (`JsonCodecs.skippedDefaultOf`, `json-form.ts`): the form asks it of the field's type in each instance, and annotations ask it, through the checker's `json`, of the type the field is declared with to tell whether `@JsonSkip` may stand there. The two ask of different types, so both stay; the rule is written once.

### 19. `src/compiler/checker/declarations/` & `src/compiler/checker/closures/`

- **Three separate implementations of static-function owner resolution; `checkClashes` misses type aliases (`src/compiler/checker/declarations/statics.ts`, `rules/clashes.ts`, `resolution/named.ts`):**
  - `StaticFunctions.#ownerOf` (`declarations/statics.ts`) unwraps `TypeAliasDeclaration` via `checker.aliasedType(owner)` so `fn Duration.zero()` and `fn MyDuration.zero()` (for `type MyDuration = Duration`) index under the same `StaticOwner`.
  - `ownerKeyOf` (`rules/clashes.ts`) resolves `declaration.owner` separately using `checker.typeKeys.identityOf(entity.declaration)` without unwrapping `TypeAliasDeclaration`, so `checkClashes` misses overload clashes when one static function is declared through a type alias.
  - Both duplicate `entityType(checker, entity)` (`resolution/named.ts`) + `staticTargetOf(checker, type)` (`resolution/candidates.ts`).
  - **Done** (`p2-structural`): see Ranked Summary item 4.
- **Duplicate reachable-edges graph walk in `Expansion` and `TypeExpansion` (`src/compiler/checker/rules/expansion.ts`, `declarations/type-expansion.ts`):**
  - `Expansion.#reachedFrom` and `TypeExpansion.#reachedFrom` implement the identical DFS worklist traversal (`visited`, `pending`, `edges`) before passing the collected edges to `endlessEdges` (`types/expansion-edges.ts`).
  - **Done** (`p4-computed`): `endlessEdgesFrom` (`types/expansion-edges.ts`) walks from the judged nodes through `edgesReachedFrom` (`structures/reachable.ts`); each user supplies its nodes' edges and the node an edge leads to.
- **Third parallel call-checking pipeline in `checkValueCall` (`src/compiler/checker/closures/value-calls.ts`, `calls/resolve.ts`):**
  - `checkValueCall` duplicates the error-argument guard, `takenBy` invocation, `explain` reporting, `fitArguments`, and `checkReferencedPlaces` of `resolveCall` (`calls/resolve.ts`).
  - **Done** (`p2-structural`): see Ranked Summary item 5; a value call has one callee and chooses nothing, so it takes `takenBy` directly and shares the rest by calling the same units.

### 20. `src/compiler/checker/expressions/`, `src/compiler/checker/statements/` & `src/compiler/checker/lookup/`

- **Double standard between bare generic fieldless structs (`bareStructValue`) and bare generic enum variants (`enumTypeFor`) (`src/compiler/checker/expressions/names.ts`, `expressions/variants.ts`):**
  - `enumTypeFor` (`variants.ts`) unwraps optionals on `expected` via `sameEnum` and fills default type arguments via `typeArgumentsFor` when all type parameters have defaults.
  - `bareStructValue` (`names.ts`) checks `expected?.kind === 'nominal' && expected.entity.declaration === declaration` without unwrapping optionals (`withoutOptionals`), and rejects any generic fieldless struct when `expected` is absent even when all of its type parameters have defaults.
  - **Done** (`p3-unions`): `expectedNominal` (`types/expected.ts`) gives a value named without type arguments, a bare variant or a fieldless generic struct, the type the expected one asks for through its optionals, else its declaration's defaults; generic struct literals read their type arguments through the expected optionals too (`builtFrom`).
- **Duplicate field-declaration resolution in `Annotations.#fieldType` (`src/compiler/checker/rules/annotations.ts`) vs. `declaredField` (`src/compiler/checker/lookup/denotations.ts`):**
  - Both map a `DeclaredField | FieldDeclaration` syntax node back to its resolved `FieldMember` in its enclosing `StructDeclaration`, `SharedStructDeclaration`, `EnumDeclaration` (`Variant`), or `TraitDeclaration`, using two different lookup mechanisms (`itemsOf(module).find(declaresField)` vs. `ancestorsOf`).
  - **Done** (`p2-structural`): see Ranked Summary item 8.
- **Duplicate variable-type resolution in `variableType` (`src/compiler/checker/expressions/names.ts`) and `declaredVariableType` (`src/compiler/checker/lookup/denotations.ts`):**
  - Both switch on `variable.owner.kind` (`ExternConstantDeclaration` vs. body/constant variables) to resolve a `VariableEntity`'s declared type.
  - **Done** (`p2-structural`): see Ranked Summary item 8.
- **Inconsistent method recognition between `noField` / `callMethod` and `lookup/members.ts` (`src/compiler/checker/expressions/structs.ts`, `calls.ts`, `lookup/members.ts`; tracked as `B22`) and duplicate struct-literal constraint checks (`literal-fields.ts`; tracked as `Q6`).**

### 21. `src/compiler/lowering/` — core, tables & function lowering

- **`SynthesizedCode` duplicates instruction builders (`struct`, `tuple`, `equal`) instead of sharing `CodeContext` helpers (`src/compiler/lowering/synthesized-code.ts`, `expressions/structs.ts`, `expressions/tuples.ts`, `expressions/operators.ts`):**
  - `SynthesizedCode` delegates `variant`, `constant`, and `call` to shared `CodeContext` helpers (`buildVariant`, `emitConstant`, `emitCall`), but re-implements `struct`, `tuple`, and `equal` because `construct` (`expressions/structs.ts`), `tupleOf` (`expressions/tuples.ts`), and `equal` (`expressions/operators.ts`) are typed as taking `FunctionContext` despite only using `CodeContext`.
  - **Done** (`p2-structural`): the three take `CodeContext`, and `SynthesizedCode` delegates to them.
- **Duplicate parameter-forwarding logic in `asyncFitEntry`, `fillingEntry`, and `dispatchEntry` (`src/compiler/lowering/async-fits.ts`, `filling-entry.ts`, `trait-objects/trait-objects.ts`):**
  - `asyncFitEntry` and `fillingEntry` both map `code.parameters.map((register, index) => references[index] === true ? referenceTo(register) : register)`, and `dispatchEntry` defines its own `passed(register, path, index)` helper for the same reference-forwarding pattern.
  - **Done** (`p2-structural`): `SynthesizedCode.passedOn(index, references, path?)` is the one rule; all three call it.
- **Quadratic array-spreading multimap in `CodeWriter.#refer` (`src/compiler/lowering/code-writer.ts`):**
  - `CodeWriter.#refer` appends forward-jump patches with `this.#patches.set(label.id, [...(this.#patches.get(label.id) ?? []), patch])`, copying the patch array on every branch targeting the same unplaced label.
  - **Done** (`fast-wins`): Uses `addToGroup` (unit 1).

### 22. `src/compiler/lowering/boundary/` & `src/compiler/lowering/trait-objects/`

- **`Encoder.#text` builds a `Json.Text` variant by positional array literal (`src/compiler/lowering/boundary/encoder.ts`, `src/definition/declared-values.ts`):**
  - Violating the one-way rule in `docs/reuse/values-and-equality.md` (build variants by declared name, never by positional index), `Encoder.#text` constructs `{ kind: 'variant', type: tables.types.index(this.#json), variant: variantIndexOf(checker, this.#json, jsonVariants.text), fields: [name] }` directly.
  - **Done** (`p2-structural`): the tag is built by name, through the encoder's `#variant` (`SynthesizedCode.variant`); `#text` is gone.
- **`DerivedForm` lacks its `Type`, and `derivedCodecEntry` dispatches on function name (`src/compiler/lowering/boundary/codecs.ts`, `encoder.ts`, `decoder.ts`; tracked as `Q9`).**
  - **Done** (`p3-unions`): each `DerivedForm` carries its type, of the kind it is (a record's a struct type, an enum's and a host type's nominal, a tuple's a tuple type, whose elements it no longer copies), and a type with nothing to derive from is the checker's alone (`FormOrNone`, `rules/json-forms/`), so `JsonFormQueries.formOf` guards it once and `Encoder.write` and `Decoder.read` take only the form, with no `unreachable` left in their cases. `derivedCodecDirection` (`codecs.ts`) tells an instance's direction by `derivedCodecs`, a typed table (`bodyWriters`) picks its writer, and its parameter count is its declaration's. `inboundOf` (`inbound.ts`) takes where JSON comes from (`result` or `input`), not a helper name.

### 23. `src/compiler/lowering/expressions/` & `src/compiler/lowering/statements/`

- **Duplicated callee/argument preparation between `lowerCall` / `lowerValueCall` and `lowerSpawn` (`src/compiler/lowering/expressions/calls.ts`):**
  - `lowerSpawn` re-implements the `valueCalls.has(...)` branch, `valueCallee`, `receiverAt`, `parametersByArgument`, `Passing` construction, `passedArguments`, and `valueArguments` already in `lowerCall` and `lowerValueCall`.
  - **Done** (`p2-structural`): see Ranked Summary item 5 (`preparedCall`).
- **Repeated `Result` / `Optional` variant branch-and-unwrap boilerplate (`src/compiler/lowering/expressions/propagate.ts`, `unwrap.ts`, `nullish.ts`, `optional-chains.ts`, `iteration.ts`, `synthesized-code.ts`):**
  - `lowerPropagate` (`expressions/propagate.ts`) is an open-coded copy of `SynthesizedCode.ok` (`synthesized-code.ts`), and `lowerUnwrap`, `lowerNullish`, `OptionalChains.target`, and `emitLoop` each repeat the `newLabel` + `variantTestOf` + `branchOnVariant` + `place` + `payloadOf` sequence for `Optional.Some`.
  - **Done** (`p3-unions`): `payloadOr` (`lowering/expressions/variants.ts`) is the one test-and-unwrap of a variant, which `lowerPropagate` and `SynthesizedCode.ok` share; `lowering/optionals.ts` is the one home of how a `T?` is read and built (`noneOf`, `someOf`, `presentOr`, `presentOrJump`), which `none`, the conversion into `T?`, `!`, `??`, optional chains, a range's left-out end and cursor loops all go through, over the union layout of `lowering/unions.ts` once proposal 3 made `T?` the union `T | None`.

### 24. `src/compiler/compile.ts`

- **Double standard for diagnostic sorting between `diagnoseModule` (`src/compiler/compile.ts`) and `diagnosticsIn` (`src/compiler/checker/declarations/module-checks.ts`):**
  - `diagnosticsIn` (`module-checks.ts`) sorts diagnostics by `span.start`, then `span.end`, then `code`, then `compareOrdered(message)`, whereas `diagnoseModule` (`compile.ts`) sorts only by `first.span.start - second.span.start`.
  - **Done** (`fast-wins`): Both sort with `compareDiagnostics` (`diagnostics/diagnostic.ts`).

### 25. `src/runtime/` — core, values, snapshot, lifetimes & interpreter

- **Redundant `definitionFormat.read` + `definitionFormat.write` round-trips in `programBinder` and `runTests` (`src/runtime/host.ts`, `src/runtime/testing/run-tests.ts`):**
  - In `src/runtime/host.ts`, `programBinder` calls `definitionFormat.read(text)` and then `definitionFormat.write(definition)` just to compute `hash` before consulting `memo(bound, hash, ...)`. Because `storedInstance` calls `bind(definition)` on every `wake`, `inspect`, `fill`, `retry`, and `terminate`, every host operation re-decodes, re-validates (`checkReferences`), and re-encodes the entire `Definition` JSON even when it was already bound! And on `deploy(text)`, `definitionFormat.write(program.definition)` is called a second time when `isNew` is true.
  - `runTests` (`src/runtime/testing/run-tests.ts`) repeats the same `definitionFormat.read(text)` + `definitionFormat.write(definition)` pair.
  - **Done** (`fast-wins`): See ranked summary #1.
- **Duplicate `call` capture/argument validation in `callProblems` (`src/runtime/snapshot/check.ts`) vs. `instruction-rules.ts` (`src/definition/instruction-rules.ts`):**
  - `callProblems` in `snapshot/check.ts` re-implements the capture-count, parameter-count, and `takesReference` checks already in `closureProblem` and `argumentsProblem` (`src/definition/instruction-rules.ts`).
- **Repeated `closureOf(v) ?? unreachable(...)` unpacking across 4 runtime modules (`src/runtime/interpreter/instructions.ts`, `lifetimes/disposal.ts`, `scheduler/mocks.ts`, `scheduler/native-calls.ts`):**
  - `calledFunction` (`instructions.ts`), `callOf` (`disposal.ts`), `replacementOf` (`mocks.ts`), and `nativeInstancesOf.spawn` (`native-calls.ts`) each narrow a `Value` with `closureOf` and throw `unreachable` on non-closures.

### 26. `src/runtime/scheduler/`, `src/runtime/boundary/` & `src/runtime/testing/`

- **`asHostValue`, `leaving`, and `arriving` duplicate recursive `Value` mapping on the JS stack (`src/runtime/scheduler/mocks.ts`; widens `Q29`):**
  - `Q29` notes that `asHostValue` and `leaving` share the same walk. `arriving` in the same file is a third copy of the same composite `withChildValues(value, childValues(value).map(...))` walk, and all three recurse on the host JS call stack instead of an explicit stack (violating the one-way rule in `docs/reuse/structures-and-invariants.md`, since in-memory values within a segment can exceed `maximumDepth` before commit).
- **Redundant multimap + `reachingMock` in `mocksOf` (`src/runtime/testing/world/index.ts`, `src/runtime/scheduler/mocks.ts`):**
  - `mocksOf` groups `snapshot.objects` by `object.target` using `byTarget.set(object.target, [...(byTarget.get(object.target) ?? []), object])` and then calls `reachingMock(mocks)` (which picks the mock with the largest `id`). Because `snapshot.objects` is already in ascending `id` order (`snapshot.ts`), the last mock for each `target` in `snapshot.objects` is always `reachingMock`.
  - **Done** (`fast-wins`): `mocksOf` maps each target to its last mock in `snapshot.objects`, which ascend by id.
- **Whole-heap disposable scan on commit (`P4`), encode-then-decode commit round-trip (`P1`), and module-global `decodedByStore` cache (`P7`) (`src/runtime/scheduler/instance/index.ts`, `wake.ts`, `instance-ends.ts`; tracked in `tracker.md`).**

### 27. `src/stdlib/` — infrastructure & prelude

- **`optionalValue` reads `Optional` by positional field index `0` (`src/stdlib/native-values.ts`, `src/definition/declared-values.ts`):**
  - `optionalValue` returns `value.fields[0]` directly without checking the variant (`Some` vs. `None`) or field name, relying on `None` having no fields and `Some` having 1 field.
  - **Done** (`p3-unions`): it reads through `optionalValueOf` (`definition/declared-values.ts`), by the declared variant and field.
- **Repeated optional `end` unwrapping in `arrayNatives.slice` and `stringsNatives.slice` (`src/stdlib/prelude/arrays.ts`, `src/stdlib/strings/natives.ts`, `src/stdlib/positions.ts`):**
  - Both natives unwrap `const last = optionalValue(end); ... last === undefined ? undefined : int(last)` before calling `sliced` / `sliceBounds`.
  - **Done** (`p3-unions`): `optionalInt` (`stdlib/native-values.ts`) reads an optional `Int` argument, for both slices and a range's ends.

### 28. `src/stdlib/` — standard library modules

- **Repeated `parseResult` native wrapper across `prelude/text-forms.ts`, `time/natives.ts`, `time/zones.ts`, and `decimal/natives.ts`:**
  - Six `parse` natives (`int.parse`, `float.parse`, `bool.parse`, `Time.parse`, `Duration.parse`, `Zone.parse`, `DateTime.parse`, `Decimal.parse`) repeat `([source], context) => { const raw = text(source); ... return parseResult(context, raw, what, parsed); }`. Extracting `parsedNative(what, read)` in `src/stdlib/native-values.ts` gives all `Parsable` natives one home.
- **Repeated `toJson` / `fromJson` forwarding pairs across `time.ista`, `decimal.ista`, and `regex.ista` (`src/stdlib/time/time.ista`, `decimal/decimal.ista`, `regex/regex.ista`):**
  - Six types (`Time`, `Duration`, `Zone`, `DateTime`, `Decimal`, `Regex`) repeat the identical `fn toJson(self: T) -> json.Json: json.encodeText(self)` and `fn T.fromJson(value: json.Json, path: string) -> Result<T>: json.decodeText(value, path)` pair.
- **Duplicate one-shot disposable holder retraction in `Revertible.holding` (`src/stdlib/inbox/inbox.ista`) and `FakeReceipts.revertibleSender` (`src/stdlib/testing/testing.ista`):**
  - Both construct `const held = new Shared<R?>{value: ...}; fn retract(): held->value = none` to release a disposable when `retract()` is called.
- **Missing outcome `encoder` on `runtime.isolate` and `testing.spawnCrashingEveryAwait` (`B4`), `lossless-json` duplicate-key refusal (`B5`), and per-arity `testing.setups` overloads (`F3`) (`src/stdlib/runtime/natives.ts`, `testing/natives.ts`, `testing/testing.ista`; tracked in `tracker.md`).**

### 29. `src/formatter/`

- **Three separate implementations of leading-space indentation counting (`src/formatter/literals.ts`, `src/compiler/binder/visibility.ts`, `src/compiler/scanner/multi-line.ts`):**
  - `lineIndentation` (`formatter/literals.ts`), `indentationAt` (`binder/visibility.ts`), and `leadingSpaceCount` (`scanner/multi-line.ts`) each match leading spaces with a regex on a line slice, and `literals.ts` (`lineIndentation`) and `comments.ts` (`describeComment`) compute `offset - columnOf(source, offset)` instead of calling `lineStartAt(source.text, offset)` (`src/text/line-map.ts`).
- **Duplicate bracketed-child classification between `formatter/bodies.ts` (`bracketKinds`, `unbracketedChildren`) and `formatter/brackets.ts` (`inBracketsUnder`):**
  - `unbracketedChildren` (`bodies.ts`) and `inBracketsUnder` (`brackets.ts`) independently list which node kinds (`ArrayLiteral`, `MapLiteral`, `Comprehension`, `Tuple`, `Parenthesized`, `StructLiteral`, `NewStructLiteral`) and which child positions (`Call.callee`, `Index.target`) stand inside vs. outside brackets.
  - **Done** (`p4-computed`): `standingIn` (`brackets.ts`) is the one list of which delimiters enclose which children; brackets derive from it where a line break means nothing, `bodies.ts` the children an `else` could continue a body of.
- **Literal `?.`, `->`, and `?->` strings in `formatter/expressions.ts` instead of `linkOperator` (`src/formatter/expressions.ts`, `src/compiler/syntax/expressions/chains.ts`):**
  - Violating the one-way rule in `docs/reuse/syntax-and-trees.md` (*"its operator is spelled by `linkOperator`/`optionalOperatorOf` (`chains.ts`), never as a literal"*), `link(...)` and the `Dereference` printer in `formatter/expressions.ts` spell `'?.` and `node.isOptional ? '?->' : '->'` as string literals.
  - **Done** (`fast-wins`): Member links and `Dereference` print `linkOperator`; an optional call's or index's `?.` before its bracket is `optionalOperatorOf('.')`.
- **Double printing of call arguments in `callArguments` (`src/formatter/expressions.ts`):**
  - `callArguments` first builds `const expanded = bracketed(printer, node, ['(', ')'], node.arguments)` (which calls `printer.print` on every argument) and then, when the last argument is huggable, calls `front.map((argument) => printer.print(argument))` and `printer.print(last)` a second time ($O(2^d)$ work on nested huggable calls).
  - **Done** (`fast-wins`): See ranked summary #9: `TreePrinter.print` keeps each node's doc.
- **Duplicate tree-descent loop in `surroundingsOf` (`src/formatter/comment-placement.ts`) vs. `nodesAt` (`src/compiler/syntax/tree.ts`):**
  - `surroundingsOf` descends `childrenOf(tree, ...).find(encloserOf(tree, comment))` from `tree.root`, duplicating `nodesAt(tree, comment.span.start)`.

### 30. `src/project/`

- **`projectRoot` hard-coded to `cwd` (`src/project/project.ts`; tracked as `F1`).**

### 31. `src/language-service/` — core, navigation, semantic-tokens & editor queries

- **Re-scanning `tree.source` in `scannedOf(tree)` instead of memoizing `scan` on `SourceText` or keeping tokens on `SyntaxTree` (`src/language-service/tokens.ts`, `src/compiler/scanner/scan.ts`):**
  - `parse(source, scanned)` (`src/compiler/parser/parse.ts`) receives `scanned: ScanResult` and keeps `scanned.comments` and `scanned.diagnostics` on `SyntaxTree`, but drops `scanned.tokens`. As a result, `scannedOf(tree)` in `language-service/tokens.ts` has to re-run `scan(tree.source)` from scratch whenever any language-service feature requests tokens or bracket pairs. Memoizing `scan(source)` on the branded, immutable `SourceText` (as `lineMapOf(source)` does in `src/text/line-map.ts`) eliminates the duplicate scan.
- **Manual `Owner.name` string formatting in `symbols.ts` and `signatures.ts` instead of `staticName` (`src/language-service/symbols.ts`, `src/language-service/signatures.ts`, `src/language/static-names.ts`):**
  - Violating the one-way rule in `docs/reuse/modules-and-names.md` (*"Spell `Owner.name` with `staticName`"*), `symbolsOfDeclaration.FunctionDeclaration` (`symbols.ts`) formats `` `${owner.text}.${name.text}` `` directly, and `signatureOf` (`signatures.ts`) formats ``owner === undefined ? '' : `${owner.text}.` `` directly.
  - **Done** (`fast-wins`): Both spell it with `staticName`.
- **`isName(text)` in `rename.ts` runs `createSourceText` + `scan` to validate an identifier (`src/language-service/navigation/rename.ts`, `src/compiler/scanner/characters.ts`):**
  - `isName` constructs a `SourceText` and runs the full scanner instead of checking `isIdentifierStart(text[0]) && identifierRunEnd(text, 0) === text.length && !isKeyword(text)`.
  - **Done** (`fast-wins`): `isName` checks `isIdentifierStart`, `identifierRunEnd` and `isKeyword`.
- **Rename missing JSON-codec fields and externs (`B19`), and inlay hints checking `type.kind !== 'error'` instead of `!mentionsError(type)` (`B20`) (`src/language-service/navigation/rename.ts`, `inlay-hints.ts`; tracked in `tracker.md`).**

### 32. `src/language-service/completion/` (including `grammar/` and `places/`)

- **Duplicate `ownsStatics` / `staticOwnerKinds` in `completion/places/declared-name.ts` vs. `isNominalEntity` (`src/compiler/checker/types/type.ts`):**
  - `declared-name.ts` defines `staticOwnerKinds = new Set(['StructDeclaration', 'SharedStructDeclaration', 'ExternStructDeclaration', 'EnumDeclaration'])` and `ownsStatics`, duplicating `isNominalEntity` (`src/compiler/checker/types/type.ts`) and omitting type aliases (`StaticFunctions.#ownerOf` in `checker/declarations/statics.ts`).
  - **Done** (`p2-structural`): `staticOwners` asks `staticOwnerOf(entityType(…))` (`types/named-types.ts`), so an alias, of a shape too, is offered.
- **Hard-coded `'self'` string literal in `completion/places/declared-name.ts` (`src/language-service/completion/places/declared-name.ts`, `src/language/well-known.ts`):**
  - `declared-name.ts` writes `const receiver: Candidate = { name: 'self', subject: { kind: 'keyword' } }` instead of importing `receiverParameter` from `src/language/well-known.ts` (violating the one-way rule in `docs/reuse/modules-and-names.md`).
  - **Done** (`fast-wins`): `receiver` names `receiverParameter`.
- **Duplicate `isChangeable` in `completion/places/grammar.ts` vs. `VariableScope.isChangeable` / `writtenByReference` (`src/language-service/completion/places/grammar.ts`, `src/compiler/checker/statements/variables.ts`, `declarations/signatures.ts`):**
  - `isChangeable` in `completion/places/grammar.ts` re-implements `owner.kind === 'VariableDeclaration' && owner.isMutable` and `owner.kind === 'Parameter' && owner.type?.kind === 'ReferenceType'` (missing lambda parameters whose `&` reference comes from an expected function type).
- **Duplicate inline-whitespace check between `goesOn` (`src/language-service/completion/triggers.ts`) and `adjoins` (`src/language-service/completion/grammar/position.ts`):**
  - Both slice `tree.source.text` from `before.span.end` to `name?.span.start ?? offset` and test `[...between].every(isInlineWhitespace)`. Placing `adjoinsBefore(cursor)` beside `touchingBefore(cursor)` in `completion/cursor.ts` unifies both.
  - **Done** (`fast-wins`): `adjoinsBefore(cursor)` in `completion/cursor.ts` serves both.
- **Duplicate `any` downcast target rules across `completion/places/matched-type.ts` (`downcastTo`), `completion/places/pattern.ts` (`mayRefer`), and `checker/patterns/downcasts.ts` (`namedTypeOf`).**
- **Tracked completion items (`P13`–`P16`, `P19`, `Q34`, `Q35`, `B23`, `F14`, `F15`; tracked in `tracker.md`).**

### 33. `src/lsp/` (including `providers/`)

- **Second `Number.MAX_SAFE_INTEGER` column workaround for `LineMap` line bounds in `linesOf` (`src/lsp/providers/semantic-tokens.ts`, `src/text/line-map.ts`, `src/diagnostics/render.ts`):**
  - `linesOf` in `semantic-tokens.ts` reconstructs each line's `[start, end)` bounds via `lines.offsetAt({ line, column: 0 })` and `lines.offsetAt({ line, column: Number.MAX_SAFE_INTEGER })`, repeating the same workaround as `renderDiagnostic` (`src/diagnostics/render.ts`) because `LineMap` does not expose its stored `#lineEnds`.
  - **Done** (`fast-wins`): `linesOf` reads `lines.lineSpan(line)`.
- **Duplicate offset-to-LSP-`Position` conversion in `rangeOf` (`src/lsp/locations.ts`) and `inlayHints` (`src/lsp/providers/inlay-hints.ts`):**
  - `rangeOf` and `inlayHints` both convert `lines.positionAt(offset)` to `{ line, character: column }`.
- **Full-project `globSync`, `statSync`, and `readFileSync` on every editor keystroke in `projectProgramLoader` (`src/lsp/project-loader.ts`, `src/project/project.ts`, `src/compiler/program/program.ts`; widens `F11`):**
  - On every edit, `projectProgramLoader` runs `findProjectSources(root)` (`globSync`), `locateFile` (`statSync` on every non-open file), and `buildProgram` (`readFileSync` on every non-open module).

### 34. `src/cli/` (including `commands/`) & `src/vscode-client/`

- **Quadruple `Definition` validation/serialization across `cli/commands/run.ts` (`test.ts`) and `runtime/host.ts` (`runtime/testing/run-tests.ts`):**
  - `start` (`src/cli/commands/run.ts`) encodes `compilation.definition` via `definitionFormat.write(compilation.definition)` and passes `text` to `runtime.deploy(text)`, which calls `definitionFormat.read(text)`, then `definitionFormat.write(definition)` (in `programBinder`), and then `definitionFormat.write(program.definition)` (in `deploy`). `test` (`src/cli/commands/test.ts`) and `runTests` (`src/runtime/testing/run-tests.ts`) do the same encode-then-decode-then-encode sequence.
  - **Done** (`fast-wins`): Host operations after the first no longer read the text again (ranked summary #1); the CLI write before `deploy`/`runTests` stays, as both take text.
- **Unexported `memoryStore` / `directoryStore` on package surface (`B7`) and VS Code client Windows / reload gaps (`F10`) (`src/cli/directory-store.ts`, `src/runtime/store.ts`, `src/vscode-client/`; tracked in `tracker.md`).**

### 35. `docs/spec.md` — Cheat sheet, §1 Overview, §2 Lexical structure and types

- **Reserved-name rules split between §2 (`docs/spec.md:163`) and §3.10 (`docs/spec.md:656`):**
  - §2 (`docs/spec.md:163`) lists the 33 scanner keywords and the 8 contextual words (`type`, `shared`, `new`, `from`, `sendable`, `any`, `hold`, `by`), but does not mention that the primitive type names (`int`, `float`, `bool`, `string`, `unit`, `never`) and `Self` (§3.10) are also reserved against declaration naming (`isReservedDeclarationName` in `src/compiler/binder/naming.ts`).
  - §2 (`docs/spec.md:163`) also says the 8 contextual words *"are keywords only in one position"*, even though the same sentence gives two positions for `sendable` (*"right after `extern` or before a function type's `fn` or `async`"*) and `hold` stands before `let`/`const`, `_ =`, and `hold(name)` (§3.4).
- **Incomplete built-in/type overview table in §2 (`docs/spec.md:178–194`):**
  - The Cheat Sheet (`docs/spec.md:27`) lists `WeakRef<T>` alongside `Array<T>  Map<K, V>  Range  Future<T>  Slot<T>  Shared<T>  WeakRef<T>  Instance<T>`, and the prose right above the §2 table (`docs/spec.md:174`) introduces `any T`, yet the §2 summary table (`docs/spec.md:178–194`) omits `WeakRef<T>`, `any Trait` types (§3.10), and `shared struct` types (§3.18, beyond `Shared<T>`).
  - **Done** (`fast-wins`): The §2 table gains `WeakRef<T>`, shared struct types and `any` types.

### 36. `docs/spec.md` — §3 Declarations

- **Contradiction between §3.3 (`docs/spec.md:360`) and §3.7 (`docs/spec.md:457`) on whether a parameter can be referenced with `&`:**
  - §3.3 (`docs/spec.md:360`) states: *"Parameters are immutable, as if declared `const` (§3.4): a by-value parameter can't be reassigned, changed in part or passed by `&`. Only a reference parameter (`&T`, §3.7) changes..."*
  - §3.7 (`docs/spec.md:457`) then states: *"What can be referenced. A `let` variable or a parameter, a field or tuple element path of one (`&self.items`, `&t.0`)..."* before saying two sentences later *"A reference parameter passed on with `&` passes the same reference."* Saying *"a parameter"* in the first sentence contradicts §3.3; it means *"a `&` parameter"* (as enforced by `src/compiler/checker/calls/places.ts`).
  - **Done** (`fast-wins`): §3.7 says "a `&` parameter".
- **Incomplete Built-in traits table in §3.10 (`docs/spec.md:694–713`) vs. §3.9 (`docs/spec.md:571–587`, `616`) and `prelude.ista`:**
  - §3.9's operator table (`docs/spec.md:571–587`) lists `Powerable`, `Bitwise`, `Shiftable`, and `Container`, but §3.10's Built-in traits summary table (`docs/spec.md:694–713`) omits all four (`Container` is absent from the table, and the operator row at `docs/spec.md:713` lists only `Addable, Subtractable, Multipliable, Divisible, FloorDivisible, Negatable, Comparable`).
  - §3.9 (`docs/spec.md:616`) writes `Powerable<E = Self>` with one type parameter, whereas `src/stdlib/prelude/prelude.ista:281` declares `trait Powerable<E = Self, T = Self>` with two type parameters (matching `Iterable<T, C = Self>`, `Container<T, C = Self>`, and `Convertible<From, T = Self>`).
  - **Done** (`fast-wins`): The table gains a `Container` row, and `Powerable`, `Bitwise` and `Shiftable` join the operator row; §3.9 writes `Powerable<E = Self, T = Self>`.
- **Split and partial definition of irrefutable ("can't fail") patterns between §3.11 (`docs/spec.md:752`) and §3.15 (`docs/spec.md:919`):**
  - §3.11 (`docs/spec.md:752`) states: *"Targets must always match. A declaration's or loop's target (§3.15) can't hold an alternative, an array pattern or a range, since each can fail; they belong in `match` and `is`."*
  - §3.15 (`docs/spec.md:919`) states: *"A pattern that could fail (a literal, a comparison, an enum variant) is a compile error here; it belongs in `match` or `is`."*
  - Each section lists only half of the refutable pattern forms, and neither mentions a type-narrowing pattern on an `any` value (§3.10). Defining irrefutable vs. refutable patterns in one place (§3.11) and referencing it from §3.15 removes the split enumeration.
  - **Done** (`p3-unions`): §3.11's "Patterns that can fail" holds the list; §3.15 refers to it.

### 37. `docs/spec.md` — §4 Expressions and control flow, §5 Persistence, §6 Slots and inboxes, §7 Lifetimes and disposal, §8 `select`

- **Restated must-use rules across §3.3 (`docs/spec.md:358`), §3.12 (`docs/spec.md:786`), §7 (`docs/spec.md:1141`), and §8 (`docs/spec.md:1265`):**
  - The rule for what types must be used (`Future`, `Result`, and `Disposable`) and how to consume or discard them (`_ = expr`, `hold _ = expr`, `drop expr`) is stated in full in §7 (`docs/spec.md:1141`) and repeated for `Future` in §3.3 (`docs/spec.md:358`) and for `Result` in §3.12 (`docs/spec.md:786`). Cross-referencing §7 as the single list of must-use types keeps the rule in one home.
  - **Done** (`p3-unions`): §7's "Unnamed and dropped values" lists the must-use types; §3.3, §3.12 and §8 refer to it.

### 38. `docs/spec.md` — §9 Program structure, §10 Testing, §11 Packages, §12 Examples, §13 Open questions, §14 Future work

- **Invalid enum variant syntax in §9 (`docs/spec.md:1293`):**
  - `docs/spec.md:1293` writes `Err(Error{message, code: "panic", trace})` with parentheses instead of braces (`Err{Error{message, code: "panic", trace}}` or `Err{error: Error{...}}`), contradicting §3.11 (*"Variants are declared with a field list ... and built like structs"* / *"It never clashes with construction, which uses braces"* in §3.10).
  - **Done** (`fast-wins`): Now `Err{Error{message, code: "panic", trace}}`.
- **Partial overlap between §3.8 stdlib JSON codecs (`docs/spec.md:505–510`) and §9's JSON mapping table (`docs/spec.md:1360–1375`):**
  - §9's JSON mapping table (`docs/spec.md:1360–1375`) includes `Decimal | string` and `Time, Duration | ISO 8601, their toString (§3.8)` alongside language primitives and compiler-derived codecs, but omits `Zone`, `DateTime` (from `time`, which §3.8 says cross as text), and `Regex` (from `regex`, which §3.8 says crosses as its pattern text) — all of which use the exact same `json.encodeText` / `json.decodeText` mechanism described at `docs/spec.md:1352`. Grouping all text-codec stdlib types (`Decimal`, `Time`, `Duration`, `Zone`, `DateTime`, `Regex`) under one row in §9's table avoids two out-of-sync lists between §3.8 and §9.
  - **Done** (`p3-unions`): §9's table has one row for the std types that cross as their text (`Decimal`, `Regex`, `Time`, `Duration`, `Zone`, `DateTime`); §3.8 refers to it.















