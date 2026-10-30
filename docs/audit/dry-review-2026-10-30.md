---
description: full-codebase DRY, generality, consistency, data-flow, modularity and spec audit at main @ a748669 — read before refactoring or planning debt paydown
owner: tech-lead
status: in-progress
applies_to: istalang
last_verified: 2026-10-30
last_updated: 2026-10-30
tags: [audit, dry-review, generality, consistency, architecture, spec]
---

# DRY Review (`main @ a748669`)

Report-only audit of `src/` (in layer order, lowest layer first) and `docs/spec.md` against `docs/reuse/` and `docs/work/tracker.md`.

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
- [ ] 17. `src/compiler/checker/patterns/` & `src/compiler/checker/flow/`
- [ ] 18. `src/compiler/checker/rules/` (including `rules/json-forms/`)
- [ ] 19. `src/compiler/checker/declarations/` & `src/compiler/checker/closures/`
- [ ] 20. `src/compiler/checker/expressions/`, `src/compiler/checker/statements/` & `src/compiler/checker/lookup/`
- [ ] 21. `src/compiler/lowering/` — core, tables & function lowering (`lower.ts`, `context.ts`, `tables.ts`, `type-table.ts`, `names.ts`, `constants.ts`, `instances.ts`, `filling-entry.ts`, `async-fits.ts`, `bodies.ts`, `code-writer.ts`, `synthesized-code.ts`, `emit-call.ts`, `iteration.ts`, `places.ts`, `optional-chains.ts`, `patterns.ts`, `packs.ts`, `never-lowered.ts`, `function-lowering/`)
- [ ] 22. `src/compiler/lowering/boundary/` & `src/compiler/lowering/trait-objects/`
- [ ] 23. `src/compiler/lowering/expressions/` & `src/compiler/lowering/statements/`
- [ ] 24. `src/compiler/compile.ts`
- [ ] 25. `src/runtime/` — core, values, snapshot, lifetimes & interpreter (`natives.ts`, `store.ts`, `refusal.ts`, `random-seed.ts`, `instance-state.ts`, `instance-group.ts`, `settle.ts`, `host.ts`, `values/`, `snapshot/`, `lifetimes/`, `interpreter/`)
- [ ] 26. `src/runtime/scheduler/`, `src/runtime/boundary/` & `src/runtime/testing/`
- [ ] 27. `src/stdlib/` — infrastructure & prelude (`std-sources.ts`, `stdlib-loader.ts`, `std-module.ts`, `std-modules.ts`, `natives.ts`, `native-values.ts`, `numeric.ts`, `positions.ts`, `ranges.ts`, `prelude/`)
- [ ] 28. `src/stdlib/` — standard library modules (`collections/`, `crypto/`, `decimal/`, `fanout/`, `futures/`, `inbox/`, `json/`, `log/`, `math/`, `random/`, `regex/`, `rpc/`, `runtime/`, `strings/`, `testing/`, `time/`)
- [ ] 29. `src/formatter/`
- [ ] 30. `src/project/`
- [ ] 31. `src/language-service/` — core, navigation, semantic-tokens & editor queries (`workspace.ts`, `checked-module.ts`, `tokens.ts`, `identifier-at.ts`, `call-at.ts`, `signatures.ts`, `docstrings.ts`, `namespaces.ts`, `folding.ts`, `symbols.ts`, `hover.ts`, `inlay-hints.ts`, `signature-help.ts`, `navigation/`, `semantic-tokens/`)
- [ ] 32. `src/language-service/completion/` (including `grammar/` and `places/`)
- [ ] 33. `src/lsp/` (including `providers/`)
- [ ] 34. `src/cli/` (including `commands/`) & `src/vscode-client/`
- [ ] 35. `docs/spec.md` — Cheat sheet, §1 Overview, §2 Lexical structure and types
- [ ] 36. `docs/spec.md` — §3 Declarations
- [ ] 37. `docs/spec.md` — §4 Expressions and control flow, §5 Persistence, §6 Slots and inboxes, §7 Lifetimes and disposal, §8 `select`
- [ ] 38. `docs/spec.md` — §9 Program structure, §10 Testing, §11 Packages, §12 Examples, §13 Open questions, §14 Future work

---

## Findings by Unit

### 1. `src/structures/` (including `entries/`)

- **Duplicate prefix-tree (trie) implementations: `TupleSet` (`src/structures/entries/tuple-set.ts`) vs. `SequenceMemo` (`src/structures/memo.ts`):**
  - `SequenceMemo` and `TupleSet` both implement prefix trees keyed by a sequence of items (`for (const item of items)` walking down `node.next`). `SequenceMemo` uses `memo(node.next, item, ...)` over `WeakMap` and stores `found?: { readonly value: Value }`, while `TupleSet` hand-rolls the lookup/insert (`let next = prefix.next.get(item); if (next === undefined) ...`) over `Map` and stores `added: boolean` — bypassing `memo` (`src/structures/memo.ts`) and duplicating the trie traversal.
- **Unmemoized, repeated transitive-read graph traversal in `notesOfReads` (`src/structures/entries/entry.ts`, `index.ts`; widens `P10`):**
  - `notesOfReads(entry)` walks the full transitive `entry.reads` graph from scratch (allocating `seen = new Set`, `pending = [...entry.reads]`, and `notes = []`) on every call to `notesFrom(entry)`, `Entries.notesReached()`, and `#replays` (`case 'notes'`). Even after an entry finishes computing (`!entry.running && !entry.open`), its transitive notes are never memoized on the `Entry`, and multiple `notesReached()` calls within one computing entry re-walk the entire subgraph already visited.
- **Quadratic array-spreading multimap construction in `Components` (`src/structures/strongly-connected.ts`):**
  - `Components.constructor` builds adjacency lists with `this.#successors.set(from, [...(this.#successors.get(from) ?? []), to])`, copying the entire neighbor array on every edge ($O(d^2)$ in out-degree) instead of pushing onto a mutable array or using a shared group-by helper (the same pattern recurs in `ValueSemantics.#tableOf` and `#carryTable` in `src/language/values.ts`).

### 2. `src/language/`

- **Double standard for case classification in `followsConvention` vs. `bindsInPattern` (`src/language/naming.ts`):**
  - The banner states that both functions *"read the same first letter, so they share this module"*. Yet `followsConvention` tests `shapes.type` (`/^[A-Z][A-Za-z0-9]*$/u`) and `shapes.value` (`/^[a-z][A-Za-z0-9]*$/u`), while `bindsInPattern` computes `const first = withoutPrivacy(name).charAt(0); return first !== first.toUpperCase()`. Because `'' !== ''.toUpperCase()` and `'1' !== '1'.toUpperCase()` are `false`, `bindsInPattern('_')` and `bindsInPattern('_1')` return `false` (classifying them as non-binding variant/type names), disagreeing with `followsConvention(..., 'type')`.
- **`ValueSemantics.withoutEntry` drops the cached hash table and `partSteps` over-allocates (`src/language/values.ts`; widens `P8`):**
  - `withEntry` carries/updates `#tables` via `#carryTable` (whose full-map copy and bucket spread are tracked in `P8`), whereas `withoutEntry` discards `#tables` completely, forcing the next lookup after a removal to re-hash/re-index the entire map in `#tableOf`.
  - In addition, `partSteps` allocates `shape.map.entries.flat()`, then `.toReversed()`, then `.map(...)`, and spreads `[join, ...]` on every uncached composite/map hash, instead of pushing `visit` steps onto `steps` in reverse order directly.

### 3. `src/text/`

- **Three overlapping UTF-16 ↔ code-point stepping loops (`src/text/code-points.ts`):**
  - `utf16Offset(s, position)`, `codePointsAt(s)`, and `codePointSlice(s, start, end)` each write their own `codePointWidth(s, offset)` stepping loop. `codePointPositions(s)` provides a stateful monotonic UTF-16-offset → code-point-index cursor, and `codePointsAt(s)` already embeds a bidirectional code-point-index ↔ UTF-16-offset cursor internally; extracting that bidirectional cursor as `utf16Offsets(s): (position: number) => number` would let `utf16Offset`, `codePointSlice`, and `codePointsAt` share one stepping implementation.
- **Duplicate line-break scanning in `splitLines` and `LineMap`, and hidden `#lineEnds` (`src/text/line-map.ts`, `src/diagnostics/render.ts`):**
  - `splitLines(text)` and `new LineMap(text)` run identical `while (offset < text.length)` loops calling `lineBreakLength(text, offset)` to find every line's `[start, end)` bounds.
  - Although `LineMap` computes and stores `#lineStarts` and `#lineEnds`, it exposes no `lineSpan(line)` or `lineText(source, line)` method, forcing `renderDiagnostic` (`src/diagnostics/render.ts`) to reconstruct a line's bounds via `lines.offsetAt({ line, column: 0 })` and `lines.offsetAt({ line, column: Number.MAX_SAFE_INTEGER })`.

### 4. `src/diagnostics/`

- **Workaround for missing `LineMap` line-span query in `renderDiagnostic` (`src/diagnostics/render.ts`):**
  - Covered under Unit 3 (`LineMap`): `renderDiagnostic` passes `Number.MAX_SAFE_INTEGER` as a synthetic column to `lines.offsetAt` to recover `#lineEnds[line]`.

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

### 6. `src/compiler/syntax/` (including `expressions/`)

- **Unmemoized `extentIn(tree, node)` despite banner contract (`src/compiler/syntax/tree.ts`; widens `B21`):**
  - The banner of `src/compiler/syntax/tree.ts` states: *"What tools ask of a tree by position derives from the same children, memoized on the immutable node or tree: a node's parent, the text a node and everything under it cover (its extent, as its own span is anchored to its segment: positions.ts), and the nodes at an offset."*
  - However, `extentIn(tree, node)` is not memoized: every call walks down `childrenOf(tree, first)` and `lastChildOf(tree, last)` to the leaves, and `nodesAt(tree, offset)` calls `extentIn` on every sibling tested at every level of the tree (contributing to the `tree.test.ts` `nodesAt` timeout in `B21`).
- **Ad-hoc `bare.text === '_'` check in `isUnnamedTarget` (`src/compiler/syntax/statements.ts`):**
  - `isUnnamedTarget` checks `bare.kind === 'Identifier' && bare.text === '_'` instead of calling `isUnnamed(bare.text)` (`src/language/naming.ts`).
- **Missing `unparenthesizedType` helper for `TypeNode` (`src/compiler/syntax/types.ts`):**
  - `syntax/expressions/index.ts` exports `unparenthesized(node: Expression)` and `syntax/patterns.ts` exports `unparenthesizedPattern(node: Pattern)`, but `syntax/types.ts` keeps `ParenthesizedType` private and provides no `unparenthesizedType(node: TypeNode)` helper for callers inspecting type nodes.

### 7. `src/compiler/scanner/`

- **Bracket pairing re-scans the token stream instead of deriving from the scanner's pass (`src/compiler/scanner/scan.ts`, `src/compiler/parser/brackets.ts`, `src/language-service/tokens.ts`; widens `P17`):**
  - `Scanner.#scanTokens` already walks every token in order and tracks brace depth (`braceChange`), yet `unclosedBracketEnds` (`src/compiler/parser/brackets.ts`) and `closingBracketsOf` (`src/language-service/tokens.ts`) re-walk the entire token array from scratch in `pairBrackets`.
- **Repeated `[...run]` allocations in `scanRadixInteger` (`src/compiler/scanner/numbers.ts`):**
  - `scanRadixInteger` spreads the ASCII identifier run `[...run]` twice (once for `.filter(radix.isDigit)` and once for `.findIndex(...)`) and adds the code-point index `invalidAt` to the UTF-16 offset `digitsStart`.

### 8. `src/compiler/parser/` — machinery & shared parts

- **Two hand-rolled binary searches duplicating `lastIndexAtMost` (`src/compiler/parser/brackets.ts`, `src/compiler/parser/cursor/index.ts`, `src/structures/sorted.ts`):**
  - `lineOf` in `src/compiler/parser/brackets.ts` and `Cursor.lineHead` in `src/compiler/parser/cursor/index.ts` each write their own `while (low < high)` binary search loop (`Math.ceil((low + high) / 2)`), duplicating `lastIndexAtMost` (`src/structures/sorted.ts`).
- **Duplicate node-field reflection walk in `bodiesHeldBy` (`src/compiler/parser/held-bodies.ts`, `src/compiler/syntax/tree.ts`):**
  - `bodiesHeldBy` inspects `Object.values(node)` with `Array.isArray(value)` and `isNode` directly instead of sharing the field-child extraction in `src/compiler/syntax/tree.ts` (`fieldChildrenOf`).
- **Repeated array-spreading multimap insertion in `SegmentReuse` (`src/compiler/parser/reuse.ts`):**
  - `SegmentReuse.constructor` builds `#unused` with `this.#unused.set(run.text.text, [...(this.#unused.get(run.text.text) ?? []), run])`, repeating the same copying multimap pattern as `strongly-connected.ts` and `language/values.ts`.

### 9. `src/compiler/parser/` — grammar categories

- **Ad-hoc `'_'` string checks instead of `isUnnamed` (`src/compiler/parser/patterns.ts`, `src/compiler/parser/statements/variables.ts`, `src/language/naming.ts`):**
  - `parseWildcard` (`patterns.ts`) and `startsHeldVariableAt` (`statements/variables.ts`) both test `parser.textOf(...) === '_'` directly instead of calling `isUnnamed` (`src/language/naming.ts`), just as `isUnnamedTarget` does in `syntax/statements.ts`.
- **Duplicate `RangePattern` construction in `parseRangePattern` and `parseOpenRangePattern` (`src/compiler/parser/patterns.ts`):**
  - Unlike `expressions/operators.ts` (where `parseOpenRange` and `rangeParselet` delegate to `parseRangeRest`), `parseRangePattern` and `parseOpenRangePattern` in `patterns.ts` duplicate the operator-kind check, `parseRangeBound`, and `RangePattern` node construction.
- **Closed parselet dispatch tables duplicated in completion (`src/compiler/parser/`, `src/language-service/completion/grammar/words.ts`; tracked as `Q35`):**
  - `typeParselets`/`wordParselets`, `patternParselets`, `prefixParselets`/`infixParselets`, `statementParselets`, and `topLevelParselets` are internal to `parser/`, forcing `completion/grammar/words.ts` to restate the keyword sets (`Q35`).

### 10. `src/compiler/program/`

- **Unconditional `read()` and import re-resolution for unchanged modules in `buildProgram` (`src/compiler/program/program.ts`):**
  - For every reachable module, `buildProgram` calls `createSourceText(label, read())` and compares `before?.source.text === source.text && before.source.path === source.path`, and even when `reusableTree` reuses `before` by identity, `buildProgram` still re-runs `resolveImports(tree, id, options.loaders)` over `tree.root.items` on every build.

### 11. `src/compiler/binder/`

- **Three ad-hoc `name.text === '_'` checks in `LocalBinder` instead of `isUnnamed` (`src/compiler/binder/local-binder.ts`, `src/language/naming.ts`):**
  - `LocalBinder.use` (twice) and `LocalBinder.declare` check `name.text === '_'` directly instead of calling `isUnnamed(name.text)` (`src/language/naming.ts`).
- **Duplicate qualification predicates `mayQualify` and `qualifies` (`src/compiler/binder/local-binder.ts`, `src/compiler/binder/link.ts`; related to `B25`):**
  - `mayQualify(head)` in `local-binder.ts` and `qualifies(entity)` in `link.ts` duplicate the check `entity.kind === 'namespace' || (entity.kind === 'type' && entity.declaration.kind === 'EnumDeclaration')` instead of sharing `qualifies` from `entities.ts`.
- **Duplicate namespace-to-module resolution in `Linker.#importedBy` and `language-service/namespaces.ts` (`src/compiler/binder/link.ts`, `src/language-service/namespaces.ts`):**
  - `Linker.#importedBy(namespace)` (`link.ts`) and `importedModule(program, bindings, namespace)` (`language-service/namespaces.ts`) compute the exact same lookup (`program.modules.get(importer)?.imports.get(namespace.declaration)`). Exposing `importedBy` on `Bindings` would eliminate the duplicate helper in `language-service/`.
- **`bindTrait` misses annotations on `Invalid` trait members (`src/compiler/binder/declarations.ts`; widens `Q36`):**
  - `Q36` notes that list sites skipping `Invalid` items must remember to bind their rejected annotations (`bindModule`, `bindBlock`, `bindRejectedAnnotations` in `expressions.ts`). In `bindTrait` (`declarations.ts`), `bindFields` binds annotations on non-function members (including `Invalid` only because `Invalid !== 'FunctionDeclaration'`), which is fragile and implicit compared to a single generic rule for `Invalid` annotations.
- **Repeated array-spreading multimaps in `functionSets` and `Linker.#index` (`src/compiler/binder/module-scope.ts`, `src/compiler/binder/link.ts`):**
  - `functionSets` (`sets.set(name, [...(sets.get(name) ?? []), declared])`) and `Linker.#index` (`this.#variantsByName.set(name, [...this.variantsNamed(name), variant])`) repeat the copying multimap pattern.

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
- **`heldType` hand-rolls a visited set instead of using `TypeCycle` (`src/compiler/checker/types/held.ts`, `type-cycle.ts`; widens `Q7`):**
  - `heldType` maintains `const walked = new Set<string>()` keyed by `checker.typeKeys.typeKey(part)` instead of using `TypeCycle` (`type-cycle.ts`).

### 14. `src/compiler/checker/inference/` & `src/compiler/checker/traits/`

- **Duplicate `isPack` predicate (`src/compiler/checker/inference/infer.ts`, `src/compiler/checker/types/type.ts`):**
  - `infer.ts` defines a local `isPack(parameter: ParameterKey)` alongside `isPack(type: Type)` in `types/type.ts`.
- **`unsafetyOf` manually resolves and substitutes trait fields instead of using `requiredFieldType` / `constraintSubstitution` (`src/compiler/checker/traits/any-types.ts`, `constraints.ts`):**
  - `unsafetyOf` (`any-types.ts`) manually builds `substitutionFor(trait.typeParameters, constraint.arguments)` and calls `checker.resolveType(checker.moduleOf(trait), field.type)` instead of calling `requiredFieldType(checker, constraint, field, parameterType(trait))` and `constraintSubstitution(constraint, parameterType(trait))` from `constraints.ts`.

### 15. `src/compiler/checker/resolution/`

- **Duplicated call-completion pipeline between `implicitCall` (`src/compiler/checker/resolution/implicit.ts`) and `resolveCall` (`src/compiler/checker/calls/resolve.ts`):**
  - `implicitCall` and `resolveCall` (`complete`) both check for `error` argument types, run `choose`, report `checkerDiagnostics.ambiguousCall(..., argumentListText(...))` on `'several'`, call `instantiate(useSite(...), application, expected)`, call `fitArguments(context, request.arguments, filledTypes(...))`, build `callMade(application, instantiation)`, and return `substitute(application.signature.result(), instantiation.substitution)`.
- **Duplicate entity-to-type dispatch in `entityType` (`src/compiler/checker/resolution/named.ts`) vs. `namedType` (`src/compiler/checker/types/resolve-type.ts`):**
  - Both switch on `entity.kind` (`primitive`, `type`) and `entity.declaration.kind` (`TypeParameter`, `TypeAliasDeclaration`, `TraitDeclaration`, nominal declarations) to construct a `Type`, with `entityType` hard-coding `arguments: []` on `TypeAliasDeclaration` without filling default type parameters.
- **Derived traits if-chain in `conform` (`src/compiler/checker/resolution/conformance.ts`; tracked as `Q7`):**
  - `conform` branches on `isSendableTrait`, then `jsonDirectionOf` (`codecWitness`), before checking trait fields and functions (`Q7`).

### 16. `src/compiler/checker/calls/`

- **Second recursive walk over composite expressions in `inferNestedLambdas` (`src/compiler/checker/calls/lambda-arguments.ts`):**
  - `inferNestedLambdas` and `branchBodiesOf` switch over `Lambda`, `BlockExpression`, `If`, `Match`, `Select`, `Tuple`, `ArrayLiteral`, and `MapLiteral`, duplicating the composite expected-type decomposition and branch collection already implemented for `Accepts` in `expressions/` and `rules/branches.ts`.
- **Repeated `operands.join(' and ')` formatting for `operatorTypes` (`src/compiler/checker/calls/resolve.ts`, `resolution/implicit.ts`, `types/equality.ts`):**
  - `explainNone` (`calls/resolve.ts`), `implicitOperatorCall` (`resolution/implicit.ts`), and `checkEqualSides` (`types/equality.ts`) each format operand type lists with `.join(' and ')` at the call site instead of `checkerDiagnostics.operatorTypes` formatting an array of operand strings.







