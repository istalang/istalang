---
description: cross-area DRY, dead-code, feature-reduction and .ista-first audit at main @ 98218a1a, ranked by why changes touch many places — read before refactoring or planning debt paydown
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-13
last_updated: 2026-11-13
tags: [audit, dry-review, reduction, dead-code, ista-first, generality]
---

# DRY review (`main @ 98218a1a`)

Report only: no code changed. Twelve research agents each read one area in full (non-test `.ts`, plus std `.ista`) and wrote a
catalog of its functions, the sites special-casing each language concept, and findings; one read the spec for feature
reductions. The lead merged them, cross-correlated the concept footprints, and checked the top findings in the code. Raw
outputs, unedited, are in [`dry-review-2026-11-13/raw/`](dry-review-2026-11-13/raw/): `<area>-catalog.md`,
`<area>-findings.md`, `spec-features.md`, the briefs, the lead's notes and a token-window clone scan (`clones45.txt`).
Areas: `fnd` (foundation, definition, syntax, scanner, program, project), `prs` (parser, formatter), `typ` (checker/types),
`res` (binder, checker/resolution), `cons` (checker/constructs), `rules` (checker/rules), `surf` (checker contexts, surface,
wiring, lookup, diagnostics), `low` (lowering), `rt` (runtime), `std` (stdlib, cli), `edit` (editor), `spec`.

Marks: **[L]** the lead read the code and confirmed it; **[n×]** n areas found it independently; otherwise agent-verified
(each raw finding quotes its code). Knip reports nothing: the dead code below is logical, not unused files.

## Why a change touches many places (root causes)

Each root cause below explains a family of the ranked findings; fixing the root removes the family.

1. **No desugaring stage.** *(Now one: `checker/desugaring/`, a table the checker runs on reaching a sugar node, the core
   recorded as `coreOf` for every later phase, core nodes built in `core-nodes.ts`. In it: deferred calls, `a!`, chained
   comparisons, templates, ranges, indented values (`80c577da..16190a48`, −352 code; spec §2, §3.9 changed). Stay core:
   `??`, `?.`, `?->`, `?` (own typing); `for`, compound assignment, `x is P`, operators, a non-`Map` map literal (desugaring
   them grows code or loses `is` bindings).)* Sugar is given meaning separately in the checker, the flow IR, lowering, the editor and the
   formatter. A deferred call is ~50 sites in 22 files; `!`, `??`, `?.`, `?->`, `?` are each a checker handler, a flow
   handler and a lowering handler. The codebase already has the pattern that fixes it, used for a few constructs: a
   memoized core reading in `syntax/` (`taggedCall`, `fieldsFunctionOf`, `comparisonLinksOf`) or one record the checker
   makes that every later phase reads (`builtLiteralOf` for indented values). It is not applied systematically.
2. **Two lowerings of every body.** *(Fixed `2128668b..52eaef3f`: lowering writes each body from its flow IR and reads no
   checked body; `lowering/constructs/` deleted. B2a+B2b −897 code.)* `checker/rules/flow/build/` (2.7K lines) turns each construct into operations: order
   of evaluation, `Never` stops, optional chains, argument passing with `&` write-back, deferred calls' "computed now",
   releases. `lowering/constructs/` does the same again into instructions. `flow/build/scopes.ts`'s banner says it releases
   "as lowering releases it"; `flow/build/calls.ts:parametersOf` is `lowering/.../calls.ts:parametersByArgument` line for
   line. Every construct is added twice and must agree twice. **[L][2×]**
3. **Tools re-derive what the checker didn't record.** Completion has a 402-line second pattern-type walker
   (`completion/places/patterns/matched-type.ts`), its own function-value acceptability (`presenting.ts:givenAsValue`),
   its own argument-to-parameter mapping (`signatures/call-at.ts:writtenParameter`, `completion/expected.ts:parameterGiven`);
   lookup re-derives method candidates (`lookup/members.ts:methodNames`). Each copy drifts: `matched-type.ts` misses generic
   aliases, `members.ts` misses trait methods on unions.
4. **Recording a body fact is ceremony.** Eight per-node facts are plain `PassTable`s in `bodyRecords`; ten others
   (`CheckedPatterns`, `Iterations`, `FieldReads`, `CollectionForms`, `ValueCalls`, `StructLiterals`, `CallRecords`,
   `ImplicitCalls`, `FlowDecisions`, `Deferrals`) each wrap one table in a class with a `*Record` interface in
   `body-context.ts`, a property on `BodyChecker`, an accessor in `recorded-body.ts` and an entry in `facts/index.ts`: about
   six files per fact. **[2×]**
5. **Kind lists kept by hand.** Declaration and member kinds are listed in at least seven places (`semantic-tokens/
   name-types.ts`, `outline/symbols.ts`, `outline/folding.ts`, `completion/placeholder.ts:declaringKinds`, the formatter's
   `itemLists`, `laysOutLines`, `opensBody`), and already miss `AssociatedType`, `RequiredAssociatedType`, `MemberType`,
   `TypeMatch`, `IndentedValue` **[L]**. A checker `Type` is rebuilt from its parts by two parallel switches
   (`types/parts/type-children.ts:withTypeChildren`, `types/parts/type-parts.ts:mapParts`).
6. **Native signatures written twice.** Every native's signature is spelled twice: once in its `.ista` `extern` and again as
   a key in its natives table (`keys.of('indexOf', 'String', 'String', 'Int')`) **[L]**. (The ~58 natives that are one-liners
   over existing functions stay native, for speed: finding 7 is cancelled.)

## Ranked findings

### 1. [high] The flow IR builder and lowering are two lowerings of every construct  **[L][2×: rules, lead]**
- **Fixed** (`2128668b..52eaef3f`, option A, −897 code): the flow IR made exact and typed (the punned `type: undefined` bug,
  branch tests, computations, releases, field passes, `select` holds, spreads, struct parts' fields), lowering written from it
  (`lowering/flow/`, one writer per operation and exit) and `lowering/constructs/` deleted. A struct literal leaving fields to
  defaults is one call of its fields function; an instance's field loop is one pass per field. Fixed with it: a struct
  comprehension's fields released early, an element's part written back stale, a hold scope left unreleased by an earlier
  `break`, an instance's implicit-call results typed generically.
- where: `checker/rules/flow/build/{calls,literals,statements,scopes,chains,control}.ts` vs
  `lowering/constructs/{expressions,statements,parts}/`; clone pairs in `raw/clones45.txt` (`flow/build/literals.ts:73-127`
  ~ `lowering/.../structs.ts:90-96`, `collections.ts:74-112`; `flow/build/calls.ts:194-207` ~ `lowering/.../calls.ts:161-171`).
- proposal: one decomposition of a checked body. Either lowering consumes `FlowFunction` (the flow IR becomes the mid-level
  IR: lowering maps operations to instructions and reads releases from it), or both read shared per-construct plans recorded
  once (call argument order and passing, deferred-call captures, struct literal sources, place paths, release points). The
  first removes the parallel construct tables; the second at least removes the parallel rules.

### 2. [high] Deferred calls carry their own machinery instead of reducing to a closure  **[3×: res, rules, spec]**
- **Fixed** (`9bbfc22c..d2d7c71f`): a deferred call is sugar, desugared once by `checker/desugaring/deferred-calls.ts` into
  `g(…, given: { const v… = what runs now; fn(): f(v…) })`; its function's mark is a lambda's (spec §3.3, §3.14, §7). Every
  phase after the checker reads the core (`coreOf`); the deferred-call code of the checker, flow IR and lowering is gone.
- where: `checker/constructs/expressions/deferred-calls.ts` (`laterMarkOf` repeats `markMaking`'s join and `kindsHeld`
  report), `checker/resolution/calls/deferred-arguments.ts` (capture sendability beside `capturedSend`), `Deferrals` threaded
  into `resolve/index.ts`, `value-calls.ts`, `argument-fit.ts`, `data-kinds.ts`, `disposal.ts`; `rules/flow/build/calls.ts`;
  `lowering/constructs/expressions/deferred-calls.ts` (an entry of its own).
- proposal: §3.14 already defines `g f(args)` as `g` given a function making `f(args)` from what it computes now. Desugar it
  once (consts holding what is computed now, then a lambda) or record one plan the flow IR and lowering both read; closures'
  capture, mark and sendability rules then apply unchanged. ~50 sites, 3 whole files.

### 3. [high] Editor features re-derive checker facts  **[2×: edit, res/surf]**
- where: `editor/.../completion/places/patterns/matched-type.ts` (second pattern walker: `membersSelected`, `downcastOf`,
  `fieldsOf` repeat `walk/members.ts`, `walk/kinds/downcasts.ts`, `walk/parts.ts`); `completion/presentation/presenting.ts`
  (`givenAsValue`, `functionGivenAsValue`, `variantGivenAsValue` repeat `named-functions.ts`); `completion/expected.ts`
  (`parameterGiven`, `argumentParameter`: a fallback from before `expectWrittenArguments`, giving uninstantiated types);
  `checker/lookup/members.ts:methodNames`/`staticsOf` (rebuild `topLevelCandidates`' sources, missing `visibleTraits`).
- proposal: the pattern walk records each pattern node's matched type and a struct or call pattern's fields in
  `CheckedBody` (joined over passes as `expectedOf` is), and completion asks the tentative checker as it does for expressions;
  `named-functions.ts` exposes "can this declaration be passed as a value of type X"; `candidates.ts` exports the enumeration
  of methods and statics of a type seen from a module, which `members.ts` calls.

### 4. [high] Argument-to-parameter binding is implemented four times  **[3×: res, surf, edit]**
- where: `checker/resolution/choosing/binding.ts` (`bindArguments`, the home); `checker/surface/struct-items.ts:argumentsReach`
  (60 lines recomputing rest, spread, positional and named reach for call patterns); `editor/.../signatures/call-at.ts:
  writtenParameter` (ignores spreads before positionals); `completion/expected.ts:parameterGiven`. `explanations.ts:
  bindingReport` and `variant-calls.ts:failureReport` both switch over `BindingFailure` with their own `namedAt`.
- proposal: `binding.ts` gains a partial (best-effort) binding beside the strict one and carries the first missing slot's name
  on `BindingFailure`; the other three are deleted.

### 5. [high] Function-value calls run a parallel call pipeline  **[L][2×: res, cons]**
- where: `checker/constructs/closures/value-calls.ts:applyValueCall`/`completeValueCall` vs `resolution/calls/resolve/
  index.ts:resolveCall`/`completeResolved` and `applying/applied-call.ts:completeCall` (same scope commit/abandon/
  `whenSolved`, same `fitArguments` + `filledTypes`, same `checkReferencedPlaces` block); `CheckedBody` keeps `valueCalls`
  beside `resolved`.
- proposal: a value call is a call with one candidate whose signature has no type parameters; send it through
  `applyCall`/`completeCall`, record the callee type with it (dropping `calledValueType`'s reconstruction).

### 6. [high] Two ways to record a body fact; a new fact costs ~6 files  **[2×: surf, cons]**
- where: `checker/wiring/body/body-records.ts` vs the ten wrapper classes named in root cause 4; `contexts/body-context.ts:
  232-405`, `wiring/body/body-checker.ts`, `wiring/body/facts/{recorded-body,index}.ts`.
- proposal: every passive per-node fact is a `PassTable` in `bodyRecords`, recorded through `BodyContext` and read in
  `facts/index.ts` as `records.<fact>.get(node, pass)`; wrapper classes stay only where they hold logic.

### 7. [cancelled] ~58 std natives belong in `.ista`  **[2×: std, spec]**
- **Cancelled:** these natives are native for speed; they stay.
- Mixed-number overloads (31): `prelude` `add`/`subtract`/`multiply`/`divide`/`power`/`compare` over `(Int, Float)` and
  `(Float, Int)`, `divide(Int, Int)`, `remainder`, `bitNot`; `math.abs(Int)`, `math.sqrt(Int)`; 16 `decimal` overloads over
  `(Decimal, Int)`/`(Int, Decimal)`: one-liners over `Float.from` and `Decimal(x)`. Deletes `stdlib/numeric.ts` (`numeric`,
  `asFloat`) and `decimal/natives.ts:mixedOverloads`.
- Collections, strings, ranges, regex (23): `Array.default`, `indexOf`/`lastIndexOf`/`includes` (over the `.ista`
  `findIndex`/`findLastIndex`), `flat`, `at`, `_patternItem`, `_patternRest`; `Map.default`, `includes` (a second native for
  `has`), `keys`/`values`/`entries`, `get`; `Range._steps`/`includes`/text (a plain `.ista` struct read by name in TS:
  `range-natives.ts`, `ranges.ts`); `random.integer`; `String.at`, `slice`, `strings.trim`/`padStart`/`padEnd`/`replace`/
  `replaceAll`; `regex.test`/`split` (`regex/split.ts`).
- Others: `runtime.commit` and `_Runtime.open`'s resolved future (removes `NativeFutures.resolved` from the runtime seam);
  `toString(Bool)`, `Bool.parse`, `toString(Duration)`, `time.utc` (deletes `time/fields.ts`, `iso.ts:durationText`);
  `testing._mock`/`_calls` (forwarding wrappers left from before `Fn<A, R, M>`).
- `.ista`-side duplication: `futures.any` repeats `quorum`'s loop (`quorum(1, …)`); `testing` `_Opened`/`_Inboxes`/`_Receipts`
  keep parallel arrays where a `Map` fits; `json.Map.fromJson` repeats `_fields`; `runtime._call`/`_jobCall` differ by one flag.
- details: `raw/std-findings.md`, `raw/spec-features.md` (Rank 6).

### 8. [high] Two cell mechanisms in the Definition and runtime  **[L][spec]**
- where: a register listed in `CodeFunction.cells` (a `&`-passed or captured `let`, `prelude._Cell<T>`, role `cell`) is made
  on its first write and read through on every access (`runtime/interpreter/registers.ts:readRegister`/`writeRegister`
  check `frame.code.cells` on each call); a shared struct's cell is the explicit `newCell`/`readCell`/`writeCell`
  (role `shared`).
- proposal: lower a cell variable with the explicit instructions (its `&` a reference into that cell); `CodeFunction.cells`,
  `_Cell`, `wellKnown.cell` and the per-access check go. Needs the Definition format's version bumped.

### 9. [high] `async` and `shape` conversions are special cases of `parts`; `AsyncFit` duplicates `wrappingEntry`  **[L][2×: low, spec]**
- where: `checker/types/fitting/fit/index.ts` (`Conversion` kinds `shape`, `async`, `parts`); `lowering/functions/fits/
  index.ts:asyncFitEntry` is `wrappingEntry` with no parameter fit and a `resolved` result; `AsyncFit`, `asyncFitKey`,
  `asyncFitName`, `asyncFitHeader`, `asyncFitIndex`, pending kind `asyncFit`, `lower.ts`'s case; `fits/parts.ts:rebuiltStruct`
  is `values/struct-values.ts:rebuiltAs` with a per-field conversion.
- proposal: lower `async` through `conversionIndex({ kind: 'wrapping' })` now (no spec change); then fold `shape` and `async`
  into `parts` in the checker, keeping their rank in `reshapes`. ~23 sites, 9 files.

### 10. [high] Every std native's signature is spelled twice  **[L]**
- where: `src/stdlib/*/natives.ts` keys (`keys.of(name, ...types)`, `knownTypeKey`, `futureKey`) restate each `.ista`
  `extern`'s parameter types; `definition/extern-key.ts` builders exist for it.
- proposal: derive std native keys from the declarations (the natives table names each extern by name and, for overloads, by
  the parameter list the `.ista` declares, checked once at load) so a signature is written once; host externs keep keys,
  since a host can't read `.ista`.

### 11. [med] Hand-kept declaration and layout kind lists miss newer constructs  **[L][2×: edit, prs]**
- where: root cause 5. Bugs today: `name-types.ts` highlights `AssociatedType`, `RequiredAssociatedType`, `MemberType`
  names as plain identifiers; `outline/symbols.ts` ignores `membersAsWritten` and calls a `RequiredAssociatedType` a field;
  the formatter's `itemLists` omits `TypeMatch` and `IndentedValue`.
- proposal: `syntax/` gains `declaredNamesOf(node)` (the identifiers a node declares, by role) and one classification of
  which nodes lay out items one per line; editor and formatter read them. Add `PartialHandlers`/`partialHandlerOf` to
  `kind-table.ts` for the six partial node tables written with `as` casts.

### 12. [med] Type rebuilding has two switches  **[typ]**
- where: `checker/types/parts/type-children.ts:withTypeChildren` and `types/parts/type-parts.ts:mapParts`.
- proposal: one switch rebuilds a type from its children in `typeChildren` order; the other is a mapper over it. A new type
  kind is then one case.

### 13. [med] Constraint checking and constraint-set resolution are repeated  **[3×: res, cons, typ]**
- where: `resolution/conformance/admits.ts:admitting` vs `resolution/choosing/receivers.ts:meetsWhereFound` (one checks
  `isOneMember`, neither checks struct constraints); `conformance.ts:witnessesOf` vs `type-parameters.ts:#check` (the same
  three checks); `type-parameters.ts:resolveConstraints`/`resolveStructConstraints` re-implement `resolveConstraintSet` and
  call `impliedConstraints` twice per parameter; `memberOf` resolved in three places; struct-constraint field rules
  aggregated in `traits/known-constraints.ts` and again in `conformance/shortfalls.ts`, which disagree on `[_]` rules.
- proposal: one `admits` for a found bound (member union, struct and trait constraints); `TypeParameters` keeps one
  `AssociatedBounds` per parameter from one `resolveConstraintSet`; field rules aggregated only in `known-constraints.ts`.

### 14. [med] One walk, written four times: a node's enclosing type `match` case  **[2×: res, typ]**
- where: `resolution/type-matches/implied-constraints.ts:casePatternOf`, `types/written/type-match.ts:structCaseOf` (+ its
  caller `written-matches.ts:asWrittenInMatch`), `syntax/types/type-matches.ts:matchPlaceOf`.
- proposal: `syntax/types/type-matches.ts:typeCaseAt(tree, node)` → `{ typeCase, alias, inPattern }`, and one
  `casePatternAt` in `type-match.ts`.

### 15. [med] Struct literal items and struct comprehension passes are each checked by three loops  **[cons]**
- where: `checker/constructs/expressions/structs/` (known fields, opaque fields, fresh anonymous fields).
- proposal: one item walker and one comprehension-pass walker taking a field-lookup strategy.

### 16. [med] Compile-time constants have an evaluator of their own  **[spec, lead]**
- where: `checker/rules/computation/{index,forms}.ts` (855 lines), `checker/surface/constant-form.ts` (`ConstantForm`,
  a second value model beside `definition/values`), `lowering/tables/constants.ts`; `forms.ts:partsForm` re-implements
  `types/fitting/part-pairs.ts:partPairs`; `computation/index.ts` switches with `default`.
- proposal: annotations need compile-time values, so the walk stays for them; check whether a top-level `const` used at run
  time could be made as a context constant is (at first read, by code), leaving `ConstantForm` to annotations and patterns.
  Needs a spec decision (§3, §3.4).

### 17. [med] Lowering-local duplication  **[low]**
- `wrappingEntry` vs `trait-objects.ts:dispatchEntry` (parameter conversion; `convertedResult` repeats `returnedAs`).
- `fittedInto` (`keyed-fields.ts`), `returnedError` (`propagate.ts`), `fitBetween` repeat `fitOf ?? unreachable` + `fitted`;
  four rival shapes for a typed register (`TypedValue`, `TypedRegister`, `ValueOf`, `UnionValue`).
- `closure` emission hand-written at five sites (three local helpers); `substitute(resultOf(instance.declaration), …)` at six;
  `inBlock` + `endScope` at five (no `void` twin of `valueInBlock`); `TypeTable` slot-reserving interning at three;
  `branchOnVariant` vs `holdings.ts:branchOnAnyVariants`; `presentOr` vs `payloadOr` (one "held, else" shape over a union and an
  enum); `hostNativeEntry` vs `constantNativeEntry` (same interning key); `lower`/`lowerNested`/`bodyEntry`/`startEntry`
  body lookup; `Encoder`/`Decoder` field-codec resolution; `part-paths.ts`/`keyed-fields.ts` re-find fields by name instead
  of `structFieldOf`; cell tracking in both `VariableRegisters` and `SynthesizedCode`.

### 18. [med] Runtime-local duplication and double standards  **[rt]**
- Root-call start split over `Instance.start`, `Resident.take`, `wake.ts`, `SegmentRunner.#started`, `RootOutcome`;
  `RootOutcome` repeats `Futures`' future-following.
- `nativeResourcesOf.create` makes a new resource for a payload `arriving` would intern by `samePayload`.
- `Counts.#hold`/`#release` repeat the explicit-stack walk; earliest-timer reduction four times (`inspect.ts`, `futures.ts`,
  `instance-group.ts`, `live-run.ts`); `instructionAt(frame)` and wait-register reads four times; panic `Result` built twice;
  `storedSnapshot` bypassed in `stored-instances.ts` and `wake.ts`; `hasEnded` isn't a type guard, so `contexts.ts` adds
  `runs`.

### 19. [med] Foundation units re-implemented by hand across areas  **[6×]**
- `sameItems`/`sameMembers`/`sameEntries`/`distinctItems`: six in `fnd`, more in `rules` and `typ`; `addToGroup` (`values.ts`,
  `tuple-set.ts`, `DisposalNotices.onDisposed` copies on append); `memo`; `compareOrdered` (`futures.ts`, `settle-order.ts`);
  `encloses`; `lastIndexAtMost` (eight editor token lookups scan linearly); `nodesUnder`/`childrenOf` (`parser/.../
  bodiesHeldBy` reflects `Object.values`); `handleObject` (`native-calls.ts`); `structFieldOf`; `awaits`; `TypeCycle`;
  `substitutionOf` (a `ResolvedCall`'s substitution built by hand at 5+ sites: add `callSubstitutionOf`); `partPairs`;
  `unparenthesized*` loops written by hand; `isDeclaredStruct`; `writesType`.
- The rule exists (`docs/reuse/`); these are violations. Per-site lists: each area's raw findings.

### 20. [med] One meaning, several definitions; one name, two meanings
- Copies: `GenericDeclaration`/`isGenericDeclaration` in `checker/types/type/function-kinds.ts:197-223` (verbatim
  `syntax/declarations/index.ts`) **[2×]**; `TargetOwner` in syntax, binder and checker; the ordering `Relation` union in
  `syntax/expressions/operators.ts` and `definition/instructions/data.ts`; `constraintKey` in `witness-outcomes.ts` and twice
  in `type-keys.ts`; `ruleText` twice; `passingOf` re-spelled three times; the witness slot rule
  (`!reference && literal ? baseOf : type`) in `declared-witness.ts` and `witness-bindings.ts`; `keyName` inlined nine times;
  `kind === 'variant' || kind === 'variants'` sixteen times (add `namesVariant`); `writtenFieldsOf` in `value-kinds.ts`
  and `expansion/types.ts`; well-known trait lookup in three files; `inDeclaredOrder` vs `laidOut`; extern payload and
  variant-name readers in both `definition/values` and `stdlib/values`.
- Clashes: two exported `isKnown(type)` with different meanings (`unions/equality.ts`, `parts/type-parts.ts`).

### 21. [med] Smaller reductions to weigh  **[spec]**
- `await` is a one-case `select` in the Definition: the `await` instruction, its runtime handler and snapshot checks could go.
- Extern constants pinned per instance (`Snapshot.pinned`, `SegmentEffects.pinned`) and context constants made at first
  read keep two "made once, kept" mechanisms.
- `worker.disposing()`'s own-call variable (binder `own-calls.ts`, checker `closures/own-calls.ts`, `currentCall`
  instruction) could be a prelude extern reading the running call.
- Language changes the spec agent proposed are listed in `raw/spec-features.md` (dropping `hold(label)`, `RangePattern`,
  `x!`, chained comparisons, bare indented-map keys). They remove features rather than reduce one to another, so they are
  out of this audit's scope.

### 22. [low] Parser and formatter duplication  **[prs]**
- `<…>` speculation: expressions require `namesTypesOnly` and `atRestAfterAngle`, patterns neither (a double standard and a
  misparse risk); `parseListItem` is `parseAnnotatedItems`; `in`/`is` bounds parsed and printed twice (`TypeParameter`,
  `RequiredAssociatedType`); member parsing with associated types written twice in `type-declarations.ts`; `fieldList` is
  `commaList` with other padding; `comment-placement.ts` computes a line start as `offset - column`; `attachAnnotations`
  loses the item's own start, so the formatter and completion rescan tokens for it.

## Bugs found on the way

Agent-verified; **[L]** the lead confirmed.
- `lookup/members.ts` misses trait methods on a union receiver (no `visibleTraits`). **[L]**
- `name-types.ts`, `outline/symbols.ts`, formatter `itemLists`: newer node kinds missing (finding 11). **[L]**
- `known-constraints.ts` and `shortfalls.ts` aggregate struct-constraint field rules differently for `[_]` (finding 13).
- `rules/lifetimes`: the escaping-cycle check runs three ways and two skip substituting a generic function value's or a
  witness's types.
- `rules/flow/build`: temporaries with `type: undefined` mean both "unknown" and "not typed by the builder", defeating
  `holdsNothingRelevant` in lifetimes (a punned sentinel, against the project's "no punning" rule).
- `rules/disposal/disposal.ts:checkSelfStays` and `rules/kinds/data-kinds.ts` walk the AST themselves instead of the flow
  IR / `nestsFunction` (against a one-way rule).
- `constructs/declarations/aliases/alias-recursion.ts:typeChildrenOf` (a `switch`, not `Handlers`) skips a mapped field's
  `memberOf`.
- `constructs/statements/assignments.ts:assignedPlace` skips the report `checkChangedPlace` makes for a non-variable root.
- `binder/link/qualifiers.ts`: `type IntResult = Result<Int, String>; IntResult.Ok(1)` fails to qualify (the binder follows
  aliases only without type arguments), while statics through the same alias resolve in the checker.
- `syntax/expressions/arguments.ts:misplacedArgument` takes an `Invalid` recovery node for a positional argument.
- `ProgramInputs` records no `parentOf` input, so entries reading a header's parent may survive an edit they depend on
  (`surf`, needs a test).
- `runtime`: `nativeResourcesOf.create` duplicates resources `arriving` would share (finding 18).

## Dead code (logical)

**Fixed** (`5e17c4ab..fb7486c3`; −229 code lines). Kept on purpose: `mainOf` (a test-kit reuses the main-function rule),
`ValueOnDisk` (the public runtime API's `.d.ts` needs it), exports `docs/reuse` names as contract parts, and test-only exports
that are test seams (unexporting would copy knowledge or drop property tests).

- `runtime/snapshot/objects.ts` `execution.disposing`: persisted, always `false`, never read **[L]**; `RunStack.callFutures`;
  `WithResources` in `host-natives.ts`; `Driving.wait` in `testing/world/drive.ts` always returns `false`.
- `checker`: `JoinedBody.implicitCallsOf` (no caller) with `pass-joins.ts`'s `firstListed`/`inEveryPass`; diagnostic
  `noneNeedsType` (5108); `CallVariables.isVariable`; `AnnotationChecks.suiteTitleOf` duplicate; `constant-form.ts:formStep`'s
  `map` branch; `indented-values.ts` `collections`/`isWellKnown` (excluded by `isDeclaredStruct`); `lifetimes` `Label`/
  `anyField` and test-only `Lifetimes.findingsOf`; `PatternScope`/`PatternTests` indirection over `BodyContext`.
- `lowering`: `Startable.isAsync`; `emitVariant`'s constant parameter; one-line forwarders (`lowerStructLiteral`/
  `lowerNewStructLiteral`, `lowerName`, `nestedEntryOf`, `variantOf`).
- `editor`: `VariantEntity` branches completion can't reach; `visibleCandidates`; `parameterGiven` (finding 3).
- `foundation`/`project`: `ProjectPlaces`' three-level cache for one root; `renderDiagnostic`'s second overload; `mainOf`.
- Stale comments naming `Some` (an enum variant `Optional` no longer has): `lowering/.../structs/variants.ts:70`,
  `collections/collections.ts:261`.
- Over 130 exported types and interfaces no module imports (per-area lists in `raw/*-findings.md`), and several exports only
  tests import.

## Found while fixing

- `checker/constructs/patterns/walk/index.ts` is ~465 lines, over the 400 limit.
- `lowering/tables/type-table.ts`: `#roleOf(enumRoles, …)` on an `EnumDeclaration` can never match.
- `definition/values/json-values.ts`: `plainOfJson`/`jsonOfPlain` expose their internal depth parameter.
- An inapplicable overload's explanation shows uninferred type arguments as `Never` (`spawn<R>` reads `async fn() -> Never`);
  `explainedCaptures` ignores the result to work around it.
- `rules/lifetimes/analysis/index.ts:isAsyncSite` re-implements `nestsFunction`; `disposal.ts:checkSelfStays` still walks the
  AST (reading `flowOf` would fix it).
- Flow IR `??`/`!`, `?`, `?.` each hand-roll "branch on present, else …, read inside" (one `presentOr` builder; B2a).
- `contexts/use-site.ts:bodySite` reports and notes constraints straight to the program checker, past `BodyContext.report`:
  two reporting seams, so pass holding and sugar wording are skipped for `completeCall`/`instantiate`/`reportedFits`.
- Inference: a type variable that met the error type settles to its other bounds, so a mistake inside a type
  (`Future<?>`) can still cascade.
- Comments over 100 columns, which Biome doesn't check (`tsm wrap-comments`).
- Lifetimes reports a false write cycle for names bound from an input's parts (`const a = p.a; const b = p.b; a->next = b`)
  while `p.a->next = p.b` is accepted.
- `runtime/lifetimes/shared-values.test.ts` is flaky: a seed can generate `xs.pop()` ×3 then `xs[0] = 9`, which rightly
  panics.
- `lowering/flow/writer.ts:waypointAt` finds a wait's `@Waypoint` by walking syntax ancestors: the last syntax read in
  lowering; `suspend`/`select` could carry it.
- A default's flow takes apart the patterns of the parameters before it again (extra moves in such prologues).
- A labelled loop or block gets one extra goto block per exit leaving it even when no `hold` names it.
- `docs/reuse` has 9 stale mentions predating B2b.
- Fixed on the way: a trait called as a function was accepted silently and crashed lowering (`8a578aee`).

## Rejected proposals

- Merging `SharedStructDeclaration` into `StructDeclaration` and `NewStructLiteral` into `StructLiteral` as flags (`fnd`,
  `prs`, `spec`): the project's rule is "a shared struct is its own kind, never a flag" (one representation per meaning).
  The flags would move the dispatch into every handler. The cell-mechanism half of the spec agent's rank 1 stands (finding 8).
- Requiring quoted keys in indented maps to desugar `IndentedValue` at parse time (`spec` rank 2): a language change.

## Reuse index changes made with this audit

Stale entries corrected (symbols renamed, moved, made private, or with no caller outside their file), missing cross-folder
units added, and one-way rules added naming the one home of each duplicated job above (binding, pattern types for tools,
body facts, declaration kinds, `.ista`-first natives). See `docs/reuse/*.md`, `last_updated: 2026-11-13`.
