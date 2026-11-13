# typ-catalog — `src/compiler/checker/types`

## src/compiler/checker/types/fitting/expected.ts — Taking an expected type apart for values built without a type of their own
- takingUnfolded(accepts: Admits): Admits — wraps an admissibility predicate to unfold recursive types and try union members; [exp]; callers: 1 outside folder
- builtFrom(expected?: Type): Type | undefined — strips `None` from an optional expected type and unfolds a recursive type; [exp]; callers: 5 outside folder
- expectedTuple(expected, length: number) — element types of an expected tuple of `length`; [exp]; callers: 1 outside folder
- expectedFunction(expected?: Type): FunctionType | undefined — unwraps `expected` to a `FunctionType` if it is one; [exp]; callers: 6 outside folder
- plainResultExpected(expected: Type | undefined, futures): Type | undefined — expected result (or future value) for a plain function; [exp]; callers: 2 outside folder
- CollectionTarget — discriminated union (`array` | `map` | `declared`) of collection literal targets from an expected type; [exp]; callers: 0 outside folder
- collectionTarget(checker, expected?: Type): CollectionTarget | undefined — classifies `expected` as `Array`, `Map`, or other nominal; [exp]; callers: 6 outside folder
- sameNominal(expected: Type | undefined, declaration): NominalType | undefined — unique nominal instance of `declaration` in `expected`; [exp]; callers: 1 outside folder
- enumsExpected(expected?: Type): EnumDeclaration[] — enum declarations among the members of `expected`; [exp]; callers: 4 outside folder
- expectedNominal(context, at, entity, expected?: Type): Type — resolves unparameterized nominal value from `expected` or defaults; [exp]; callers: 2 outside folder
- writtenNominal(context, at, entity, written: readonly Type[]): Type — fills defaults and notes constraints for written nominal args; [exp]; callers: 2 outside folder
- Admits — `(bound: Type, isOpen: (part: Type) => boolean) => boolean` predicate for postponed expressions; [exp]; callers: 14 outside folder

## src/compiler/checker/types/fitting/fit/index.ts — Implicit conversions and fitting a value's type to an expected type
- Fit — `{ conversion: Conversion; into?: IntoUnion }` record of how a value converts and enters a union; [exp]; callers: 17 outside folder
- exactFit: Fit — identity `Fit` with `{ conversion: { kind: 'none' } }`; [exp]; callers: 2 outside folder
- Fitting — program seam extending `TypeRules` & `Futures` with `meetsAny`, `shapeOf`, `memberUnionOf`, `qualifierOf`, `varianceOf`; [exp]; callers: 17 outside folder
- ConversionRules — `Fitting` plus leaf `exact`, `same`, `ordered`, `attempt`, and `trial` hooks for `matchConversion`; [exp]; callers: 1 outside folder
- fitOf(found: Type, expected: Type, fitting: Fitting): Fit | undefined — computes how `found` fits `expected` under `fitting`; [exp]; callers: 4 outside folder
- matchConversion(found: Type, expected: Type, rules) — fits `found` to `expected` under custom leaf rules; [exp]; callers: 1 outside folder
- matchingWith(rules: ConversionRules): Matching — fills default `same`, `ordered`, `attempt`, `trial`, and recursive `fits` for one match
- ownConversion(found: Type, expected: Type, rules: Matching): Fit | undefined — fits `found` to `expected` directly, into a union, or member-by-member
- intoOneMember(found: Type, expected: UnionType, rules: Matching): Fit | undefined — fits non-union `found` into its unique matching or converting union member
- memberParameterFit(found: Type, expected: Type, rules: Matching): Fit | undefined — fits a member-parameter value via its member union
- convertedInto(found: Type, expected: Type, rules: Matching): Conversion | undefined — tries `async`, single-tuple, `any`, `shape`, `base`, or `parts` conversion
- hasParts(type: Type): boolean — whether `type` is `nominal`, `tuple`, `anonymous`, or `function` (convertible by parts)
- isLiteralOf(found: Type, base: Type, futures): boolean — whether every member of `found` is a literal or `keys` type assignable to `base`
- intoAnyMember(found: UnionType, expected: UnionType, rules: Matching): Fit | undefined — converts a whole union into the unique `any` member of `expected` it meets
- intoMember(member: Type, expected: UnionType, rules: ConversionRules): Type | undefined — finds own, literal-base, or absorbing `any` member in `expected`
- ownMember(found: Type, expected: UnionType, rules: ConversionRules): Type | undefined — finds exact member in `expected`, trying non-generic members before generic
- membersConverting(found: Type, expected: UnionType, rules: Matching): readonly Type[] — filters members of `expected` that `found` converts into under `trial`
- intoSeveral(found: Type, expected: Type, fitting: Fitting): boolean — whether `found` ambiguously converts into multiple members of union `expected`
- singleConversion(found: Type, expected: Type, exact): 'tupled' | 'untupled' | undefined — checks 1-element tuple wrapping/unwrapping conversion
- singleElement(type: Type): Type | undefined — returns element type of a 1-element tuple, else `undefined`; [exp]; callers: 1 outside folder
- reshapes(fit: Fit): boolean — whether `fit` is `async`, `tupled`, `untupled`, `shape`, or `parts`; [exp]; callers: 1 outside folder
- asyncFitOf(source: Type, target: Type, rules): FunctionType | undefined — wraps sync function `source` into async function matching `target`
- constraintFits(found, expected, fitting: Fitting) — whether `found` satisfies `expected` by trait variance; [exp]; callers: 1 outside folder
- isExact(fit: Fit): boolean — whether `fit` performs no conversion and enters no union; [exp]; callers: 5 outside folder
- misfitOf(fitting: Fitting, at, found: Type, expected: Type): Diagnostic — builds `severalConversions` or `typeMismatch` diagnostic; [exp]; callers: 4 outside folder

## src/compiler/checker/types/fitting/fit/parts.ts — Variance-directed part-by-part type fitting
- PartsRelation — match callbacks (`relating`, `same`, `ordered`, `fits`, `attempt`) and `Fitting` slice for part-wise fitting; [exp]; callers: 1 outside folder
- fitsByParts(found: Type, expected: Type, relation) — relates nominal, tuple, shape, or function types part by part; [exp]; callers: 1 outside folder
- argumentsFit(found: NominalType, expected: NominalType, relation: PartsRelation): boolean — checks same declaration and variance-wise type arguments
- argumentsFitAs(variances, found, expected, relation) — relates type argument lists by variance; [exp]; callers: 1 outside folder
- fitsAs(variance: Variance, found: Type, expected: Type, relation: PartsRelation): boolean — dispatches `covariant`, `contravariant`, or `invariant` part check
- fieldsFit(found: AnonymousStructType, expected: AnonymousStructType, relation: PartsRelation): boolean — checks field-by-field name equality and `fits`
- functionFitsByParts(found: FunctionType, expected: FunctionType, relation: PartsRelation): boolean — checks function contravariant params, result/future fit, mark/send

## src/compiler/checker/types/fitting/holds.ts — The type containment order (`holder` holds `type` iff `type` fits `holder`)
- holds(holder: Type, type: Type, fitting: Fitting): boolean — returns `fitOf(type, holder, fitting) !== undefined`; [exp]; callers: 2 outside folder

## src/compiler/checker/types/fitting/member-arguments.ts — Checking that an argument to a member parameter (`T in U`) stands for one member
- isOneMember(union: Type, type: Type, memberUnionOf) — whether `type` is a member of `union` or ranges over a subset of `union`; [exp]; callers: 3 outside folder
- standsForMember(site, parameter, argument, substitution) — checks and reports member-parameter argument; [exp]; callers: 2 outside folder

## src/compiler/checker/types/fitting/met-instantiation.ts — Result models for trait instantiations a type meets in an `any` constraint
- MetInstantiation — discriminated union (`met` | `none` | `several`) of trait instantiations met through variance; [exp]; callers: 3 outside folder
- ProposedInstantiation — `{ self: Type; constraint: Constraint }` candidate trait instantiation for inference; [exp]; callers: 4 outside folder

## src/compiler/checker/types/fitting/part-pairs.ts — Pairing corresponding source and target child types for part-by-part conversions
- PartRules — `Pick<Checker, 'fitOf' | 'fieldsOf' | 'variantsOf' | 'wellKnownType'>` seam for pairing parts; [exp]; callers: 1 outside folder
- PartPair — `readonly [from: Type, to: Type]` pair of corresponding part types; [exp]; callers: 1 outside folder
- partPairs(rules: PartRules, given: Type, target: Type): readonly PartPair[] — lists `[from, to]` part pairs for a `parts` conversion; [exp]; callers: 2 outside folder
- resultFitBetween(rules, from, to: FunctionType) — how `from.result` fits `to.result` (`value`, `resolved`, `awaited`); [exp]; callers: 3 outside folder
- functionPairs(rules: PartRules, from: FunctionType, to: FunctionType): readonly PartPair[] — pairs contravariant value parameters and results of two functions
- collectionPairs(rules: PartRules, from: NominalType, to: NominalType): readonly PartPair[] | undefined — pairs `Array` element or `Map` value type arguments
- paired(from: readonly FieldMember[], to: readonly FieldMember[]): readonly PartPair[] — zips two field lists' types by index
- zipped(from: readonly Type[], to: readonly Type[]): readonly PartPair[] — zips two type lists up to their shared length

## src/compiler/checker/types/identity/folding.ts — Folding a type holding recursion back to an equal labelled recursive type node
- folded(type: Type): Type — replaces a type holding recursion with an equal labelled `RecursiveType` node from its graphs if one exists; [exp]; callers: 4 outside folder
- graphsIn(type: Type): ReadonlySet<RecursiveGraph> — collects all `RecursiveGraph`s reached in `type`

## src/compiler/checker/types/identity/identity.ts — Type identity (by canonical key), constraint equality, and exact assignability
- sameType(first: Type, second: Type): boolean — whether two types have the same canonical `typeKey`; [exp]; callers: 54 outside folder
- sameConstraint(first: Constraint, second: Constraint): boolean — whether two constraints name the same trait and `sameType` arguments; [exp]; callers: 6 outside folder
- isAssignable(source, target, futures) — exact fit allowing `Never`, `Future<Never>`, error, and looser function headers; [exp]; callers: 3 outside folder
- isAssignableInvariantly(source, target, futures) — `isAssignable` requiring identical function mark and sendability; [exp]; callers: 1 outside folder
- assignableWith(source: Type, target: Type, futures, slots): boolean — shared implementation of `isAssignable` and `isAssignableInvariantly`
- neverFutureFits(source: Type, target: Type, futures): boolean — whether `source` is `Future<Never, K>` and `target` is `Future<T, K>`
- resultAssignable(given: Type, declared: Type, futures): boolean — whether function result `given` is assignable to `declared` without `madeAsync`

## src/compiler/checker/types/identity/recursive-terms.ts — Minimized equi-recursive term graphs and canonical keys for recursive types
- Slot — `{ kind: 'leaf', type, key } | { kind: 'term', term }` target of a term graph edge; [exp]; callers: 0 outside folder
- TermSource — input callbacks (`bodies`, `placeholderOf`, `leafKey`, `spell`, `rules`) for `TermGraph`; [exp]; callers: 0 outside folder
- ImportedNode — `{ graph, node, term }` record of an existing recursive graph node imported into a `TermGraph`; [exp]; callers: 0 outside folder
- TermGraph — builds, flattens unions in, and partition-refines an equi-recursive term graph; [exp]; callers: 0 outside folder
- TermGraph.imported: readonly ImportedNode[] — existing recursive graph nodes reached while building; [exp]; callers: 0 outside folder
- TermGraph.slotOf(type: Type): Slot — resolves or creates a `Slot` (`leaf` or `term`) for `type`; [exp]; callers: 0 outside folder
- TermGraph.bodySlot(index: number): Slot — resolves the `Slot` for group body `index`, following forwarding chains; [exp]; callers: 0 outside folder
- TermGraph.#forwardedBody(index: number): number | undefined — follows body-to-body placeholder chains, returning `undefined` on a cycle
- TermGraph.resolved(slot: Slot): Slot — follows single-member union redirects to the target `Slot`; [exp]; callers: 0 outside folder
- TermGraph.classOf(term: number): number — equivalence class rank of `term` after `minimize()`; [exp]; callers: 0 outside folder
- TermGraph.typeOf(term: number): Type — original `Type` from which `term` was created; [exp]; callers: 0 outside folder
- TermGraph.partsOf(term: number): readonly Slot[] — resolved child slots of `term`, deduplicating union members by class/key; [exp]; callers: 0 outside folder
- TermGraph.minimize(): void — flattens unions and runs partition refinement until no class splits or collapses; [exp]; callers: 0 outside folder
- TermGraph.canonicalKey(slot: Slot): string — spells reachable equivalence classes from `slot` in canonical rank order; [exp]; callers: 0 outside folder
- TermGraph.#canonicalParts(term: number): readonly Slot[] — orders a union term's parts canonically (leaves by key, terms by rank)
- TermGraph.#partId(part: Slot): string — string identifier for deduplicating a union part (`L<key>`, `T<term>`, or `C<rank>`)
- TermGraph.#nodeSlot(graph: RecursiveGraph, node: number): Slot — imports node `node` of `graph` into the term graph
- TermGraph.#isTerm(type: Type): boolean — whether `type` holds recursion or a group placeholder
- TermGraph.#flatten(): void — flattens nested union terms/leaves and normalizes union members via `normalizedMembers`
- TermGraph.#membersOf(term: number, inside: ReadonlySet<number>): readonly Slot[] — recursively collects non-cyclic union member slots
- TermGraph.#refine(): void — runs `refinedRanks` over non-redirected terms
- TermGraph.#spelled(term: number, spellPart): string — spells `term`'s structure with resolved parts spelled by `spellPart`
- canonicalKey(type: Type, leafKey, spell): string — minimizes a `TermGraph` for `type` and returns its canonical key; [exp]; callers: 0 outside folder

## src/compiler/checker/types/identity/recursive-types.ts — Constructing and substituting minimized equi-recursive type graphs
- RecursiveGroup — `{ bodies, placeholderOf, labels, rules }` input for `closeRecursive`; [exp]; callers: 0 outside folder
- closeRecursive(group: RecursiveGroup): readonly Type[] — closes a group of recursive bodies into minimized `RecursiveType`s; [exp]; callers: 2 outside folder
- closedOnce(group: RecursiveGroup): Closed — builds and minimizes one `TermGraph` and extracts cyclic `RecursiveGraph` nodes
- withTermsReduced(closed: Closed, group: RecursiveGroup): readonly Type[] — reduces computed types over graph nodes and re-closes the group
- termsOver(type: Type, graph: RecursiveGraph): readonly Type[] — finds outermost computed types in `type` mentioning a node of `graph`
- reducedOver(type: Type, graph: RecursiveGraph, rules: TypeRules): Type — reduces computed types in `type` over `graph` innermost-first
- GraphNodes.name(slot: Slot, label?: RecursiveLabel): void — registers `slot`'s equivalence class as a graph node if it reaches itself
- GraphNodes.#reachesItself(term: number): boolean — DFS over term parts checking whether `term`'s class can reach itself
- GraphNodes.breakCycles(roots: readonly Slot[]): void — names unlabelled nodes to break any remaining cycles not passing a named node
- GraphNodes.build(roots: readonly Slot[]): Closed — materializes the `RecursiveGraph` and root `Type`s from named classes
- mapRecursive(type, map, rules: TypeRules) — maps external parts/labels of `type` and re-closes; [exp]; callers: 1 outside folder
- rebuiltFrom(type: Type, children: readonly Type[], rules: TypeRules): Type — rebuilds `type` from `children`, normalizing non-recursive unions

## src/compiler/checker/types/identity/term-signatures.ts — Partition refinement and lexicographic signature ordering for term graphs
- Signature — `readonly (number | string)[]` tuple compared item-by-item for partition refinement; [exp]; callers: 0 outside folder
- rankedBy(terms: readonly number[], signatureOf, size: number): number[] — sorts `terms` by signature and assigns dense rank numbers
- uniqueSorted(signatures: readonly Signature[]): readonly Signature[] — sorts and deduplicates `Signature`s
- compareSignatures(first: Signature, second: Signature): number — compares two `Signature`s item-by-item, then by length; [exp]; callers: 0 outside folder
- compareItems(first: number | string, second: number | string): number — compares two signature items (numbers numerically, strings lexically)
- Refinable — graph interface (`size`, `nodes`, `unions`, `spelled`, `membersOf`) for `refinedRanks`; [exp]; callers: 0 outside folder
- refinedRanks(graph: Refinable): number[] — refines non-union node classes to fixpoint, then ranks unions by member class sets; [exp]; callers: 0 outside folder
- classesSpelled(graph: Refinable, ranks: readonly number[]): (part: PartRef) => string — spells a part as the sorted set of its members' classes

## src/compiler/checker/types/identity/type-keys.ts — Canonical and spelled string keys for types and numeric object identities
- TypeKeys — `{ identityOf, typeKey, shapeKey, structureKey, spelledKey }` interface; [exp]; callers: 4 outside folder
- ShapeKey — `` `{${string}` | `~[${string}` `` key of an anonymous struct or recursive type; [exp]; callers: 1 outside folder
- identityOf(object: object): number — assigns a monotonic numeric identity per object via `WeakMap`
- keyAt(type: Type, positions?: ReadonlyMap<ParameterKey, number>): string — computes `type`'s structural or recursive term-graph key
- termGraphKey(type: Type, positions?: ReadonlyMap<ParameterKey, number>): string — computes `canonicalKey` for a recursive type
- keptCanonicalKey(type: Type): string — memoizes `termGraphKey` by `preKeyOf(type)` on the first reached `RecursiveGraph`
- preKeyOf(type: Type): { preKey: string; graph?: RecursiveGraph } — spells `type` down to `@graph#node` references
- structureKeyOf(type: Type, positions, key: (each: Type) => string): string — spells one level of `type`'s canonical key
- mappedKeyOf(type: MappedParts, positions): string — spells an unreduced mapped struct type with de Bruijn index for its bound parameter
- functionKeyOf(type: FunctionType, key: (type: Type) => string): string — spells `fn<mark,send>(params)->result`
- spelledGraph(graph: RecursiveGraph): string — spells a `RecursiveGraph` preserving node spellings and labels
- spelledKindKey(type: Type, key: (part: Type) => string): string — spells `type` preserving declaration origins, member order, and `unreduced`
- spelledFieldKey(field: FieldMember, key: (part: Type) => string): string — spells a field with its declaring node, module, and declared type
- aliasKeyOf(alias: AliasUse | undefined, key: (part: Type) => string): string — spells `as Alias<...>`, `as T.Name`, or `as keyof S`
- typeKeys: TypeKeys — singleton `TypeKeys` implementation shared across checkers; [exp]; callers: 13 outside folder

## src/compiler/checker/types/identity/unfolding-pairs.ts — Coinductive pair guard for relating two unfolding recursive types
- UnfoldingPairs — tracks active `typeKey ~ typeKey` pairs so coinductive unfolding relations terminate; [exp]; callers: 8 outside folder
- UnfoldingPairs.relate(first, second, holds, relate) — returns `holds` if same or active, else unfolds both and calls `relate`; [exp]; callers: 7 outside folder

## src/compiler/checker/types/inference/binding.ts — Recording lower, upper, and equal bounds on inference variables from matches
- BindingTarget — system callbacks (`store`, `notes`, `fitting`, `joining`, `callOf`, `tentative`, `match`) for `VariableBinding`; [exp]; callers: 0 outside folder
- VariableBinding — validates fillings for packs/member variables and records bounds on a `BoundStore`; [exp]; callers: 0 outside folder
- VariableBinding.lower(variable, given: Type) — records a lower bound (or equality on receiver), noting fresh literals/shapes; [exp]; callers: 0 outside folder
- VariableBinding.upper(variable, expected: Type) — records an upper bound (or equality on receiver), checking packs; [exp]; callers: 0 outside folder
- VariableBinding.equal(variable: ParameterKey, given: Type): boolean — records an exact equality bound (noting `Never` on non-packs); [exp]; callers: 0 outside folder
- VariableBinding.join(variable: ParameterKey, lower, upper): Type | undefined — joins lower bounds by qualifier order or `joinedLower`; [exp]; callers: 0 outside folder
- VariableBinding.#added(variable: ParameterKey, added: boolean): boolean — notes `variable` as `disagreed` when `added` is false
- VariableBinding.#filling(variable: ParameterKey, given: Type): Type | undefined — computes `fillingOf(variable, given, ...)` and notes `severalMembers`
- VariableBinding.#memberUnionOf(variable: ParameterKey): Type | undefined — looks up the member union carried by `variable`'s `CallVariables`

## src/compiler/checker/types/inference/bounds.ts — Mutable store of variable bounds, transitive variable relations, and rollback
- BoundRules — callbacks (`fits`, `orderOf`, `takesShape`, `same`, `isOpen`, `constrain`, `equate`, `constrainShape`) for `BoundStore`; [exp]; callers: 0 outside folder
- BoundStore — stores per-variable bounds, variable-to-variable `<:` links, admissibility predicates, and undo log; [exp]; callers: 0 outside folder
- BoundStore.adopt(other: BoundStore): void — copies `other`'s bounds, links, and admissibility predicates into this store; [exp]; callers: 0 outside folder
- BoundStore.admit(parameter: ParameterKey, admits: Admits): void — registers an admissibility filter for `parameter`; [exp]; callers: 0 outside folder
- BoundStore.of(parameter: ParameterKey): VariableBounds — returns `{ equal, lower, upper }` bounds recorded for `parameter`; [exp]; callers: 0 outside folder
- BoundStore.relatedOf(parameter: ParameterKey): Related — returns `{ below, above }` variables linked to `parameter`; [exp]; callers: 0 outside folder
- BoundStore.revision: number — monotonic revision counter bumped on every mutation or rollback; [exp]; callers: 0 outside folder
- BoundStore.mark(): number — returns current undo-stack position for `rollback`; [exp]; callers: 0 outside folder
- BoundStore.rollback(mark: number): void — undoes all mutations recorded since `mark`; [exp]; callers: 0 outside folder
- BoundStore.relate(lower: ParameterKey, upper: ParameterKey): boolean — links `lower <: upper` and propagates existing bounds both ways; [exp]; callers: 0 outside folder
- BoundStore.addLower(parameter, bound: LowerBound) — checks and adds a lower bound, propagating to `above` variables; [exp]; callers: 0 outside folder
- BoundStore.addUpper(parameter, bound: Bound) — checks admissibility and adds an upper bound, propagating to `below`; [exp]; callers: 0 outside folder
- BoundStore.#isSame(first: Bound, second: Bound): boolean — whether two bounds have identical `advice`, `by`, and `same(type)`
- BoundStore.#advised(parameter: ParameterKey, before: VariableBounds, added: Bound, as): void — incorporates a new required bound against prior advice bounds
- BoundStore.#link(links, from: ParameterKey, to: ParameterKey): void — appends `to` to `links.get(from)` with undo registration
- BoundStore.addEqual(parameter, bound: Bound) — checks and adds an equality bound, propagating to `below` and `above`; [exp]; callers: 0 outside folder
- BoundStore.#agree(parameter: ParameterKey, below: Bound | LowerBound, above: Bound): boolean — checks `below <= above` directly or by incorporating open bounds
- BoundStore.#equate(parameter: ParameterKey, first: Bound, second: Bound): boolean — checks equality of two `equal` bounds directly or via `equate`
- BoundStore.#deeper(parameter, types, relate) — guards recursive bound incorporation against self-mention and depth
- BoundStore.#set(parameter: ParameterKey, bounds: VariableBounds): void — updates `#bounds` for `parameter` with undo registration
- copyInto(from: ReadonlyMap<ParameterKey, Value>, to: Map<ParameterKey, Value>): void — copies map entries from `from` into `to`

## src/compiler/checker/types/inference/complete.ts — Completing type argument inference with declaration defaults and constraint checks
- Completion — `{ kind: 'complete', typeArguments, substitution } | { kind: 'open', parameter }` result of `completeInference`; [exp]; callers: 1 outside folder
- Admits — `(parameter: TypeParameter, type: Type) => boolean` constraint check for settling; [exp]; callers: 1 outside folder
- settlingOf(checker, declaration, parameters, admits?) — builds `Settling` with `admits` and `defaultArgument`; [exp]; callers: 3 outside folder
- completeInference(checker, parameters, inference, settling) — settles all `parameters`; [exp]; callers: 3 outside folder

## src/compiler/checker/types/inference/equal.ts — Exact structural type equality matching with inference variables on either side
- Equating — `{ unfolding, isUnknown, bind, meetError }` callbacks for `equalTypes`; [exp]; callers: 0 outside folder
- equalTypes(declared: Type, given: Type, equating: Equating): boolean — equates `declared` and `given`, binding unknown variables; [exp]; callers: 0 outside folder
- equalParts(declared: Type, given: Type, equating: Equating): boolean — equates nominal, anonymous, tuple, function, or `any` types part by part
- equalUnion(declared: UnionType, given: Type, equating: Equating): boolean — matches fixed union members and binds open union members to remainder
- equalConstraints(declared: AnyType, given: AnyType, all): boolean — checks whether two `any` types have equal constraint sets
- sameFieldNames(first: AnonymousStructType, second: AnonymousStructType): boolean — whether two shapes have identical field names in order
- givesNothing(declared: Type): boolean — whether `declared` is written through an associated type alias (`Field<T>.Data`); [exp]; callers: 0 outside folder

## src/compiler/checker/types/inference/fillings.ts — Validating pack/member-parameter fillings and joining lower bounds
- Filling — `{ kind: 'fills', type } | { kind: 'none' } | { kind: 'severalMembers' }` outcome of `fillingOf`; [exp]; callers: 0 outside folder
- fillingOf(parameter, given: Type, union, fitting) — validates pack or member-union filling; [exp]; callers: 0 outside folder
- joinedLower(isMember, lower, upper, joining) — widens fresh literals and joins lower bounds; [exp]; callers: 0 outside folder

## src/compiler/checker/types/inference/fixing-toward.ts — Fixing stuck non-placeholder variables from bounds free of waiting placeholders
- fixingToward(waiting, reading, view, settlingOf) — settles stuck non-placeholder variables from bounds free of `waiting`; [exp]; callers: 0 outside folder
- settledByFree(variable: ParameterKey, settling: Settling, fixing: Fixing): Type | undefined — settles `variable` using only bounds free of `near` placeholders

## src/compiler/checker/types/inference/infer.ts — Per-call type parameter inference facade over `CallVariables` and `CallSystem`
- InferenceSite — `{ site?: object; copying?: Inference }` options when creating an `Inference`; [exp]; callers: 0 outside folder
- InferringCall — `{ inference: Inference; settling: Settling }` pair for joint scope solving; [exp]; callers: 0 outside folder
- Inference — per-call inference translating declared `ParameterKey`s to twin variables in a `CallSystem`; [exp]; callers: 18 outside folder
- Inference.commitTo(scope: Inference): void — adopts this inference's `CallSystem` into `scope`'s system; [exp]; callers: 2 outside folder
- Inference.match(declared: Type, given: Type): boolean — matches argument type `given` against `declared` allowing conversions; [exp]; callers: 12 outside folder
- Inference.matchLiteral(declared: Type, literal) — matches a written literal, keeping it fresh when widened to base; [exp]; callers: 4 outside folder
- Inference.matchShape(declared: Type, shape: Type): boolean — matches a struct literal's `shape` against `declared`; [exp]; callers: 1 outside folder
- Inference.matchApart(declared: Type, given: Type): boolean — matches a collection item without propagating across related variables; [exp]; callers: 1 outside folder
- Inference.matchExactly(declared: Type, given: Type): boolean — equates `declared` and `given` invariantly; [exp]; callers: 5 outside folder
- Inference.matchReceiver(declared, given, byReference) — matches method receiver and fixes bound variables as given; [exp]; callers: 2 outside folder
- Inference.expect(result: Type, expected?: Type): void — marks top-of-result variables and advises `result` by `expected`; [exp]; callers: 9 outside folder
- Inference.abandon(type: Type): void — marks unbound variables reached from `type` as having met `errorType`; [exp]; callers: 6 outside folder
- Inference.open(declared: Type): Type — substitutes given arguments and replaces remaining parameters with twin variables; [exp]; callers: 8 outside folder
- Inference.mentionsVariables(type: Type): boolean — whether open `type` mentions any variable in the system; [exp]; callers: 1 outside folder
- Inference.isUnknown(parameter: ParameterKey): boolean — whether `parameter` is inferred by this `Inference`; [exp]; callers: 3 outside folder
- Inference.boundOf(parameter: ParameterKey): Type | undefined — returns given or tentative type found so far for `parameter`; [exp]; callers: 4 outside folder
- Inference.guided(type: Type, settling: Settling): Type — substitutes settled types and rule-2 expected choices into `type`; [exp]; callers: 1 outside folder
- Inference.settlingsOf(calls: readonly InferringCall[]): SettlingOf — maps each call's twin variables to its `Settling`; [exp]; callers: 1 outside folder
- Inference.solveJointly(calls: readonly InferringCall[]): void — solves all variables in the system jointly using `calls`' settlings; [exp]; callers: 1 outside folder
- Inference.admitOpen(open: Type, admits: Admits): void — attaches `admits` filter to placeholder variable `open`; [exp]; callers: 1 outside folder
- Inference.settleAs(open: Type, type: Type): void — matches placeholder `open` against `type` and marks it given; [exp]; callers: 1 outside folder
- Inference.tentativeIn(type: Type): Type | undefined — substitutes tentative variable bounds into open `type`; [exp]; callers: 1 outside folder
- Inference.expectationOf(type: Type, siblings?: boolean): Type | undefined — returns expected type so far for placeholder `type`; [exp]; callers: 3 outside folder
- Inference.waitsOn(inputs: Type, given: readonly Type[]): boolean — whether open variables in `inputs` reach open variables in `given`; [exp]; callers: 1 outside folder
- Inference.fixToward(waiting: readonly Type[], settlingOf: SettlingOf): boolean — fixes variables stuck on `waiting` placeholders; [exp]; callers: 1 outside folder
- Inference.fixDefaults(types, settlingOf: SettlingOf) — fixes un-bounded variables in `types` to their defaults; [exp]; callers: 3 outside folder
- Inference.fixIn(type: Type, settlingOf: SettlingOf): void — settles and fixes all open variables mentioned in `type`; [exp]; callers: 1 outside folder
- Inference.fixedIn(type: Type): Type — substitutes given and fixed variables into open `type`; [exp]; callers: 1 outside folder
- Inference.guidedIn(type: Type, settlingOf) — substitutes fixed variables and rule-2 expected choices into open `type`; [exp]; callers: 1 outside folder
- Inference.solved(type: Type): Type — substitutes solved types (or `errorType`) into open `type`; [exp]; callers: 7 outside folder
- Inference.settle(parameters, settling: Settling) — settles `parameters` and restores names; [exp]; callers: 2 outside folder
- Inference.conflicts: ReadonlySet<ParameterKey> — parameters whose bounds disagreed; [exp]; callers: 2 outside folder
- Inference.severalMembers: ReadonlyMap<ParameterKey, Type> — member parameters given a multi-member union; [exp]; callers: 1 outside folder
- Inference.literalType(value: LiteralValue, declared: Type): Type — literal or base type for `value` where `declared` is expected; [exp]; callers: 1 outside folder
- Inference.solution(): Substitution — maps each parameter to its solved type (or `errorType`); [exp]; callers: 1 outside folder
- Inference.substitution(): Substitution — maps each parameter to its `boundOf` type found so far; [exp]; callers: 7 outside folder
- Inference.substituted(declared: Type): Type — substitutes `this.substitution()` into `declared`; [exp]; callers: 5 outside folder
- Inference.settledIn(declared: Type): Type — substitutes only given and fixed variables into `declared`; [exp]; callers: 2 outside folder
- Inference.#found(read): Map<ParameterKey, Type> — builds a parameter map starting from `#givenTypes()` and filling with `read`
- Inference.#givenTypes(): Map<ParameterKey, Type> — collects parameters that have a given type in `#system`

## src/compiler/checker/types/inference/matching.ts — Match context metadata (argument, expected, or receiver; literal, shape, or apart)
- MatchKind — `'argument' | 'expected' | 'receiver'` kind of inference match; [exp]; callers: 0 outside folder
- Matching — `{ kind: MatchKind; by: CallVariables | undefined; written: Written | undefined }` match descriptor; [exp]; callers: 0 outside folder
- expectedMatch: Matching — `{ kind: 'expected', by: undefined, written: undefined }` constant; [exp]; callers: 0 outside folder
- Written — `{ kind: 'literal', literal } | { kind: 'shape' } | { kind: 'apart' }` tag for special lower bounds; [exp]; callers: 0 outside folder
- relatingMatch(role: BoundRole): Matching — builds the `Matching` used when incorporating two bounds of a variable; [exp]; callers: 0 outside folder

## src/compiler/checker/types/inference/notes.ts — Side notes recorded during inference (conflicts, met `Never`/`error`, `severalMembers`)
- MatchNotes — tracks variables with conflicting bounds, `Never`/`error` fallbacks, and multi-member union mismatches; [exp]; callers: 0 outside folder
- MatchNotes.conflicts: ReadonlySet<ParameterKey> — variables whose bounds disagreed; [exp]; callers: 0 outside folder
- MatchNotes.severalMembers: ReadonlyMap<ParameterKey, Type> — member variables given a union of several members; [exp]; callers: 0 outside folder
- MatchNotes.conflict(variable: ParameterKey): void — records a bound conflict on `variable`; [exp]; callers: 0 outside folder
- MatchNotes.metNever(variable: ParameterKey): void — records that `Never` was given for `variable`; [exp]; callers: 0 outside folder
- MatchNotes.metError(variable: ParameterKey): void — records that `errorType` was given for `variable`; [exp]; callers: 0 outside folder
- MatchNotes.severalMembersGiven(variable: ParameterKey, given: Type): void — records multi-member `given` for `variable`; [exp]; callers: 0 outside folder
- MatchNotes.fallbackOf(variable: ParameterKey): Type | undefined — returns `errorType` or `neverType` if recorded for `variable`; [exp]; callers: 0 outside folder
- MatchNotes.adopt(other: MatchNotes): void — merges all notes from `other` into this instance; [exp]; callers: 0 outside folder

## src/compiler/checker/types/inference/relate.ts — Relating leaf and composite types containing inference variables during fitting
- Relating — callbacks (`fitting`, `unfolding`, `isUnknown`, `bindLower`, `bindUpper`, `bindBetween`, `equal`, ...) for `relatedAsIs`; [exp]; callers: 0 outside folder
- relatedAsIs(expected: Type, found: Type, relating: Relating): boolean — relates `found` to `expected` without top-level conversion; [exp]; callers: 0 outside folder
- boundVariables(expected: Type, found: Type, relating: Relating): boolean | undefined — binds when either or both sides are inference variables
- orderedAsIs(order, lower: Type, upper: Type, relating) — relates mark or sendability slots by `order`; [exp]; callers: 0 outside folder
- intoUnionHolding(expected: UnionType, found: Type, relating: Relating): boolean — matches a union `found` into a union `expected` holding variables
- fromUnionHolding(expected: UnionType, found: UnionType, relating: Relating): boolean — matches a union `found` holding variables into `expected`
- intoOneMember(expected: UnionType, found: Type, relating: Relating): boolean — constrains `found` holding variables into the unique compatible member of `expected`
- relatedByParts(expected: Type, found: Type, relating: Relating): boolean — relates composite types containing variables via `fitsByParts`
- partsRelation(relating: Relating): PartsRelation — adapts `Relating` into a `PartsRelation` for `fitsByParts`
- convertsIntoAny(declared: AnyType, found: Type, relating: Relating): boolean — relates `found` converting into `any` type `declared`; [exp]; callers: 0 outside folder
- relatedThroughProposed(target: AnyType, found: Type, relating: Relating): boolean — relates `found` and `target` through `proposedInstantiations`

## src/compiler/checker/types/inference/settle.ts — The 6-step policy for settling inference variables from their bounds in dependency order
- Settling — `{ admits, defaultOf }` callbacks for settling a parameter; [exp]; callers: 5 outside folder
- settlesFreely: Settling — default `Settling` admitting all types with no defaults; [exp]; callers: 1 outside folder
- SettlingView — view of system bounds, top-of-result set, qualifier orders, and joins for `settleAll`/`settleOne`; [exp]; callers: 0 outside folder
- settleAll(parameters, given, view, settling) — settles `parameters` in dependency order; [exp]; callers: 0 outside folder
- nextToSettle(pending: ReadonlySet<ParameterKey>, view: SettlingView, given: Substitution): ParameterKey | undefined — picks next ready variable to settle
- firstOf(items: Iterable<Item>, passes: (item: Item) => boolean): Item | undefined — returns first item in `items` satisfying `passes`
- hasBounds(bounds: VariableBounds): boolean — whether `bounds` has an `equal`, `lower`, or `upper` bound; [exp]; callers: 0 outside folder
- ownBoundedBelow(parameter: ParameterKey, view): readonly ParameterKey[] — variables below `parameter` that have non-apart bounds of their own
- waitedOn(parameter: ParameterKey, view): readonly ParameterKey[] — variables mentioned by `parameter`'s bounds plus `ownBoundedBelow`; [exp]; callers: 0 outside folder
- settleOne(parameter, settled, general, settling) — settles one variable by rules 1-6; [exp]; callers: 0 outside folder
- settledBelow(parameter: ParameterKey, bounds: VariableBounds, view: SettlingView, settled: Substitution): Type | undefined — joins settled types of `below` variables
- expectedChoiceOf(parameter, settled, view, settling) — rule 2 consumer choice alone; [exp]; callers: 0 outside folder
- viewFor(parameter: ParameterKey, view: SettlingView): SettlingView — overrides `view.fits` with `order.below` when `parameter` is a qualifier
- leastAllowed(bounds: VariableBounds, qualifier: QualifierParameter, view: SettlingView, admits): Type | undefined — least allowed mark for a mark variable
- expectedChoice(parameter: ParameterKey, bounds: VariableBounds, view: SettlingView, settling: Settling): Type | undefined — rule 2 consumer upper-bound choice
- lowerJoin(parameter: ParameterKey, bounds: VariableBounds, view: SettlingView): Type | undefined — rule 3 join of lower bounds if accepted by upper bounds
- agreesWith(candidate: Type, bounds: VariableBounds, view: SettlingView): boolean — whether every lower bound fits `candidate` and every upper bound takes it
- closedBounds(bounds: VariableBounds, settled: Substitution, rules: TypeRules): VariableBounds — substitutes `settled` into all bounds in `bounds`
- withRelatives(bounds: VariableBounds, related: Related, context): VariableBounds — augments `bounds` with settled types of `below`/`above` variables
- SettlingOf — `(variable: ParameterKey) => Settling` lookup; [exp]; callers: 1 outside folder

## src/compiler/checker/types/inference/system-reading.ts — Pure queries over a `CallSystem` (tentative, fixed, solved, readiness, shapes)
- SystemReading — read-only facet of `CallSystem` used by queries and `fixingToward`; [exp]; callers: 0 outside folder
- abandonedFrom(type: Type, reading: SystemReading): readonly ParameterKey[] — unbound variables reachable from `type`; [exp]; callers: 0 outside folder
- reachedFrom(types: readonly Type[], reading: SystemReading, passes?): Generator<ParameterKey> — BFS/DFS of variables reachable via bounds and relations
- tentativeOf(variable, reading: SystemReading) — tentative type of `variable` from equal, joined lower, or upper bounds; [exp]; callers: 0 outside folder
- tentativeIn(type: Type, reading: SystemReading, seen?): Type | undefined — recursively substitutes `tentativeOf` into `type`; [exp]; callers: 0 outside folder
- fixedByBounds(variable, reading: SystemReading) — returns `givenOf` or non-advice `equal` if all its variables are fixed; [exp]; callers: 0 outside folder
- solvedIn(type: Type, solved, reading: SystemReading) — substitutes `solved` (or `errorType`); [exp]; callers: 0 outside folder
- takesShape(target: Type, shape: Type, fitting: Fitting): boolean — whether nominal struct `target` accepts a struct literal of `shape`; [exp]; callers: 1 outside folder
- shapeTaking(target: Type, shape: Type, fitting: Fitting): Type | undefined — shape of `target`'s required and `shape`-provided fields; [exp]; callers: 0 outside folder
- openIn(type: Type, reading: SystemReading): readonly ParameterKey[] — system variables in `type` that are not yet `fixedOf`; [exp]; callers: 0 outside folder
- waitsOn(inputs: Type, given, reading: SystemReading) — whether open variables reached from `inputs` and `given` overlap; [exp]; callers: 0 outside folder
- defaultsIn(type: Type, reading, settlingOf) — defaults for completely unconstrained reached variables; [exp]; callers: 0 outside folder
- fixedIn(type: Type, reading: SystemReading): Type — substitutes `fixedOf` for fixed variables in `type`; [exp]; callers: 0 outside folder
- expectationOf(variable, reading, siblings?, seen?) — expected type for placeholder `variable`; [exp]; callers: 0 outside folder
- tentativeSubstitution(reading, variables) — maps `variables` to `givenOf ?? tentativeOf`; [exp]; callers: 0 outside folder
- settledBefore(variable, reading: SystemReading) — unfixed variables that `variable` waits on to settle; [exp]; callers: 0 outside folder
- fixedSubstitution(reading: SystemReading, variables: Iterable<ParameterKey>): Substitution — maps `variables` to `fixedOf`; [exp]; callers: 0 outside folder
- settlingViewOf(reading: SystemReading, atTop: ReadonlySet<ParameterKey>): SettlingView — adapts `SystemReading` into `SettlingView`; [exp]; callers: 0 outside folder
- atTopOf(result: Type, reading: SystemReading) — system variables occurring as `result` or a direct union member of it; [exp]; callers: 0 outside folder
- settledAmong(solved, variables: readonly ParameterKey[]) — slices `solved` to `variables`; [exp]; callers: 0 outside folder

## src/compiler/checker/types/inference/system.ts — The joint constraint system of variables, bounds, notes, and solving for a scope
- CallSystem — owns the `BoundStore`, `VariableBinding`, `MatchNotes`, and `SettlingView` for one or more joined `Inference`s; [exp]; callers: 0 outside folder
- CallSystem.add(variables, given: Substitution) — registers a call's twin `variables` and its `given` type arguments; [exp]; callers: 0 outside folder
- CallSystem.give(variable: ParameterKey, type: Type): void — records `type` as given outright for `variable`; [exp]; callers: 0 outside folder
- CallSystem.admit(variable: ParameterKey, admits: Admits): void — registers an admissibility predicate on `variable`; [exp]; callers: 0 outside folder
- CallSystem.givenOf(variable: ParameterKey): Type | undefined — returns the type given outright for `variable`, if any; [exp]; callers: 0 outside folder
- CallSystem.match(declared: Type, given: Type, matching: Matching): boolean — constrains `given` to fit `declared` under `matching`; [exp]; callers: 0 outside folder
- CallSystem.matchExactly(declared: Type, given: Type, matching: Matching): boolean — equates `declared` and `given` under `matching`; [exp]; callers: 0 outside folder
- CallSystem.yields(result: Type, expected?: Type): void — records top-of-result variables in `result` and advises by `expected`; [exp]; callers: 0 outside folder
- CallSystem.boundsOf(variable: ParameterKey): VariableBounds — returns current `VariableBounds` of `variable`; [exp]; callers: 0 outside folder
- CallSystem.expectedChoiceFor(variable, settling) — computes rule-2 expected choice for `variable`; [exp]; callers: 0 outside folder
- CallSystem.fix(variable, settlingOf, fixing?) — settles `variable` (after `settledBefore`) and fixes it as equal; [exp]; callers: 0 outside folder
- CallSystem.fixAs(variable: ParameterKey, type: Type): void — adds a non-advice equality bound fixing `variable` to `type`; [exp]; callers: 0 outside folder
- CallSystem.fixDefaults(types, settlingOf: SettlingOf) — fixes unconstrained variables in `types` to their defaults; [exp]; callers: 0 outside folder
- CallSystem.fixedOf(variable: ParameterKey): Type | undefined — memoized `fixedByBounds` for `variable` at the current revision; [exp]; callers: 0 outside folder
- CallSystem.settle(variables, settling: Settling) — settles `variables` or slices `#solved`; [exp]; callers: 0 outside folder
- CallSystem.solve(settlingOf: SettlingOf): void — settles all variables in `#calls` together into `#solved`; [exp]; callers: 0 outside folder
- CallSystem.solved(type: Type): Type — substitutes `#solved` (or `errorType`) into `type`; [exp]; callers: 0 outside folder
- CallSystem.conflicts: ReadonlySet<ParameterKey> — variables whose bounds disagreed; [exp]; callers: 0 outside folder
- CallSystem.severalMembers: ReadonlyMap<ParameterKey, Type> — member variables given a union of several members; [exp]; callers: 0 outside folder
- CallSystem.#as(matching: Matching, match: () => Result): Result — runs `match` with `this.#matching` temporarily set to `matching`
- CallSystem.#readingOf(): SystemReading — constructs the `SystemReading` facet over this system
- CallSystem.#boundRules(): BoundRules — constructs the `BoundRules` callbacks for `this.#store`
- CallSystem.adopt(other: CallSystem): void — merges `other`'s variables, given types, top variables, bounds, and notes; [exp]; callers: 0 outside folder
- CallSystem.#trial(probe: () => boolean): boolean — runs `probe` and unconditionally rolls back any bounds it added
- CallSystem.#made(match: () => boolean): boolean — runs `match` and records `#lastConflict` in `#notes` if `match` returns false
- CallSystem.#atomic(probe: () => boolean): boolean — runs `probe` and rolls back bounds if `probe` returns false
- CallSystem.#equal(declared: Type, given: Type): boolean — invokes `equalTypes` against this system's `#binding`
- CallSystem.#meetError(declared: Type, given: Type): void — records `metError` on variables in `declared` when `given` is `errorType`
- CallSystem.abandon(type: Type): void — marks unbound variables reachable from `type` as `metError`; [exp]; callers: 0 outside folder
- CallSystem.mentionsVariable(type: Type): boolean — whether `type` mentions any variable in `this.#calls`; [exp]; callers: 0 outside folder

## src/compiler/checker/types/inference/variable-bounds.ts — Data types and pure helpers for per-variable bounds and roles
- BoundRole — `{ advice: boolean; by: CallVariables | undefined }` origin metadata on a bound; [exp]; callers: 0 outside folder
- isAdvice(bound: BoundRole): boolean — returns `bound.advice`; [exp]; callers: 0 outside folder
- fromConsumer(bound: BoundRole, call?: CallVariables): boolean — whether `bound` came from the expected type or an enclosing call; [exp]; callers: 0 outside folder
- LowerBound — `{ type, fresh, isShape, advice, by, isApart? }` lower bound on a variable; [exp]; callers: 0 outside folder
- Bound — `{ type, advice, by }` upper or equality bound on a variable; [exp]; callers: 0 outside folder
- VariableBounds — `{ equal: Bound | undefined; lower: readonly LowerBound[]; upper: readonly Bound[] }`; [exp]; callers: 0 outside folder
- Related — `{ below: readonly ParameterKey[]; above: readonly ParameterKey[] }` related variables; [exp]; callers: 0 outside folder
- isShape(bound: Bound | LowerBound): boolean — whether `bound` is a `LowerBound` with `isShape: true`; [exp]; callers: 0 outside folder
- requirementsOf(bounds: VariableBounds): VariableBounds — filters out `advice` bounds from `bounds`; [exp]; callers: 0 outside folder
- mentionedBy(bounds: VariableBounds): readonly ParameterKey[] — memoized list of `ParameterKey`s mentioned in `bounds`; [exp]; callers: 0 outside folder

## src/compiler/checker/types/inference/variables.ts — Site-keyed twin variables separating a call's inferred parameters from rigid ones
- twinOf(parameter: ParameterKey, site: object): ParameterKey — memoizes a shallow-cloned twin `ParameterKey` per `(site, parameter)`
- standingFor(key: Key): Key — returns the original `ParameterKey` that twin `key` stands for (or `key` itself); [exp]; callers: 2 outside folder
- isPlaceholder(type?: Type): type is TypeParameterType — whether `type` is a parameter whose `standingFor` is a `Placeholder`; [exp]; callers: 2 outside folder
- mentionsOnlyPlaceholders(type: Type): boolean — whether every inference variable in `type` is a `Placeholder`; [exp]; callers: 1 outside folder
- mentionsAnyVariable(type: Type): boolean — whether `type` mentions any twin inference variable; [exp]; callers: 2 outside folder
- CallVariables — maps one call's `ParameterKey`s to its site-keyed twin variables and back; [exp]; callers: 0 outside folder
- CallVariables.variableOf(parameter: ParameterKey): ParameterKey | undefined — twin variable for `parameter`; [exp]; callers: 0 outside folder
- CallVariables.typeOf(parameter: ParameterKey): TypeParameterType | undefined — twin variable as a `TypeParameterType`; [exp]; callers: 0 outside folder
- CallVariables.parameterOf(variable: ParameterKey): ParameterKey | undefined — original parameter for twin `variable`; [exp]; callers: 0 outside folder
- CallVariables.isVariable(key: ParameterKey): boolean — whether `key` is one of this call's twin variables; [exp]; callers: 0 outside folder
- CallVariables.variables: readonly ParameterKey[] — list of twin variables in parameter order; [exp]; callers: 0 outside folder
- CallVariables.freshened(type: Type, given?: Substitution): Type — substitutes `given` and renames inferred parameters to twins; [exp]; callers: 0 outside folder
- CallVariables.byVariable(byParameter) — rekeys a map from parameters to twins; [exp]; callers: 0 outside folder
- CallVariables.settlingFor(settling: Settling): Settling — adapts a parameter-keyed `Settling` to twin variables; [exp]; callers: 0 outside folder
- CallVariables.restored(type: Type): Type — substitutes original `ParameterKey`s back for twin variables in `type`; [exp]; callers: 0 outside folder

## src/compiler/checker/types/parts/computed-reduction.ts — One-step reduction of computed types through `TypeRules`
- reducedComputed(type: ComputedType, map: (child: Type) => Type, rules: TypeRules): Type — maps parts of `type` and reduces via `rules`; [exp]; callers: 1 outside folder
- mappedParts(type: MappedParts, map: (child: Type) => Type): MappedParts — maps `named`, `keys`, and `value` of `MappedParts`; [exp]; callers: 0 outside folder

## src/compiler/checker/types/parts/substitution.ts — Type parameter and `Self` substitution preserving aliases and normalizing unions
- Substitution — `ReadonlyMap<ParameterKey, Type>` mapping parameters to replacement types; [exp]; callers: 39 outside folder
- noSubstitution: Substitution — empty `Substitution` map; [exp]; callers: 4 outside folder
- substitutionFor(parameters: TypeParameters, typeArguments: readonly Type[]): Substitution — zips `parameters` with `typeArguments`; [exp]; callers: 21 outside folder
- substitute(type: Type, substitution: Substitution, rules: TypeRules): Type — substitutes `substitution` throughout `type`; [exp]; callers: 53 outside folder
- substituteMapped(type: MappedParts, substitution: Substitution, rules: TypeRules): Type — substitutes into a mapped type without touching its bound key parameter
- substituteAny(type: AnyType, substitution, rules) — substitutes into `AnyType` without touching its traits' `Self`; [exp]; callers: 3 outside folder
- substituteKept(type, substitution, rules: TypeRules) — substitutes into a non-collapsing `Type` keeping its kind; [exp]; callers: 1 outside folder
- asWritten(type: Type, substituted: Substituted, substitution: Substitution, rules: TypeRules): Substituted — substitutes into `type.alias` and reattaches it
- substituteConstraint(constraint, substitution, rules) — substitutes into `constraint.arguments`; [exp]; callers: 9 outside folder
- constraintOn(constraint: Constraint, type: Type, rules: TypeRules): Constraint — substitutes `type` for `constraint.trait` (`Self`); [exp]; callers: 6 outside folder

## src/compiler/checker/types/parts/type-children.ts — Direct child types of a `Type`, rebuilding from children, and recursive graph parts
- typeChildren(type: Type): readonly Type[] — lists direct child types of `type` (or `graphParts` for a recursive type); [exp]; callers: 12 outside folder
- withTypeChildren(type: Type, children) — rebuilds non-union/non-recursive `type` from `children` in `typeChildren` order; [exp]; callers: 1 outside folder
- withPartsTaken(type: Type, child: () => Type): Type — pulls replacement children from `child()` for composite types
- withListedParts(type: Type, child: () => Type): Type — pulls replacement children from `child()` for list/simple types
- graphParts(graph: RecursiveGraph): readonly Type[] — memoized external non-node, non-bound-parameter subtrees of `graph`; [exp]; callers: 1 outside folder
- graphPlaceOf(type: Type, graph, bound) — classifies subtree in `graph` as `'part' | 'node' | 'bound' | 'built'`; [exp]; callers: 1 outside folder
- boundWithin(type: Type, bound: ReadonlySet<ParameterKey>): ReadonlySet<ParameterKey> — adds parameters bound by `type` to `bound`; [exp]; callers: 1 outside folder
- boundParameters(type: Type): readonly ParameterKey[] — parameters bound by `type` (`any` traits' `Self`, `mapped` parameter); [exp]; callers: 0 outside folder
- namesNodeOf(type: Type, graph: RecursiveGraph): boolean — whether `type` is or contains a node of `graph`; [exp]; callers: 1 outside folder
- mentionsAnyOf(type: Type, keys: ReadonlySet<ParameterKey>): boolean — whether `type` mentions any parameter in `keys`
- holdsRecursion(type: Type): boolean — memoized check whether `type` is or contains a `RecursiveType`; [exp]; callers: 5 outside folder

## src/compiler/checker/types/parts/type-parts.ts — Walking, querying, unaliasing, and mapping child types with identity preservation
- sameTypeSpelled(first: Type, second: Type): boolean — whether two types have equal `spelledKey`s; [exp]; callers: 18 outside folder
- sameConstraintSpelled(first, second: Constraint) — whether two constraints have the same trait and `sameTypeSpelled` args; [exp]; callers: 2 outside folder
- unaliased(type: Type): Type — strips `alias` annotations at every depth of `type`; [exp]; callers: 3 outside folder
- parametersIn(type: Type): readonly ParameterKey[] — memoized free `ParameterKey`s in `type` in appearance order; [exp]; callers: 28 outside folder
- nominalsIn(type: Type): readonly NominalType[] — all `NominalType`s in `type`, outermost first; [exp]; callers: 1 outside folder
- anyTypesIn(type: Type): readonly AnyType[] — memoized `AnyType`s in `type`, outermost first; [exp]; callers: 1 outside folder
- computedTypesIn(type: Type): readonly ComputedType[] — memoized unreduced `ComputedType`s in `type`, outermost first; [exp]; callers: 1 outside folder
- isKnown(type: Type): boolean — whether `type` has no `parametersIn` and no `computedTypesIn`; [exp]; callers: 3 outside folder
- mentionsError(type: Type): boolean — whether `type` is or contains `errorType`; [exp]; callers: 4 outside folder
- errorIn(type: Type): ErrorType | undefined — returns the first `ErrorType` in `type`, if any; [exp]; callers: 1 outside folder
- mapChildren(type: Type, map, rules: TypeRules) — maps direct children, normalizing unions and reducing computed types; [exp]; callers: 3 outside folder
- rebuiltBy(type: Type, map: (child: Type) => Type, rules: TypeRules): Type | undefined — rebuilds union, recursive, or computed `type` via `rules`
- mapParts(type, map: (child: Type) => Type) — maps direct children of non-union, non-recursive `type`, returning `type` if unchanged; [exp]; callers: 0 outside folder
- partsMapped(type: Exclude<Type, UnionType | RecursiveType>, map: (child: Type) => Type): Type — constructs a copy of `type` with children mapped by `map`

## src/compiler/checker/types/properties/finiteness.ts — Detecting infinite value-type cycles in structs and recursive aliases
- SelfHolding — `StructDeclaration | RecursiveType` target of a value-containment check; [exp]; callers: 0 outside folder
- StructFieldReader — `{ fieldsOf, unfold }` seam for reading fields during finiteness walks; [exp]; callers: 0 outside folder
- fieldReaderOf(checker): StructFieldReader — builds a `StructFieldReader` from `checker`; [exp]; callers: 2 outside folder
- holdsItself(reader: StructFieldReader, type: Type, target: SelfHolding): boolean — whether a value of `type` holds `target` by value; [exp]; callers: 1 outside folder
- selfHoldingField(reader, fields, target: SelfHolding) — first field in `fields` whose type holds `target` by value; [exp]; callers: 2 outside folder
- holds(reader: StructFieldReader, type: Type, target: SelfHolding, seen): boolean — recursive walk through tuples, shapes, recursive types, and structs
- fieldsHold(reader: StructFieldReader, fields: readonly FieldMember[], target: SelfHolding, seen): boolean — whether any field's type `holds` `target`

## src/compiler/checker/types/properties/handles.ts — Classifying nominal declarations and types as value vs instance/process/global handles
- identityOf(declaration: NominalDeclaration): Identity — classifies declaration as `'value' | 'instance' | 'global' | 'process'`
- isConfined(declaration: NominalDeclaration): boolean — whether handles of `declaration` stay in their instance or process; [exp]; callers: 3 outside folder
- staysInProcess(declaration: NominalDeclaration): boolean — whether `declaration` is an `extern live struct` (`'process'`); [exp]; callers: 0 outside folder
- isHandleDeclaration(declaration: NominalDeclaration): boolean — whether `declaration`'s values are handles (`identity !== 'value'`); [exp]; callers: 3 outside folder
- isHandleType(type: Type): type is NominalType — whether `type` is a nominal handle type; [exp]; callers: 4 outside folder

## src/compiler/checker/types/properties/held.ts — Walking the types a value of a type holds at any depth
- heldType(checker, type: Type, picks) — first held part of `type` matching `picks`; [exp]; callers: 2 outside folder
- heldTypes(checker: HeldReader, type: Type): readonly Type[] — all types held by `type` at any depth, itself first; [exp]; callers: 2 outside folder
- walkHeld(checker: HeldReader, type: Type, visit: (part: Type) => boolean): boolean — cycle-guarded DFS over `heldPartsOf`
- heldPartsOf(checker, type: Type): readonly Type[] — types held one level down by `type` (fields, variants, shared value, `@Holds`); [exp]; callers: 1 outside folder

## src/compiler/checker/types/properties/qualifiers.ts — Recognizing mark and sendability type parameters from their member union
- qualifierParameterOf(checker, parameter) — returns mark or sendability order for `parameter`; [exp]; callers: 1 outside folder
- literalsOf(union: Type): readonly string[] | undefined — extracts string literal values if every member of `union` is a string literal

## src/compiler/checker/types/properties/type-cycle.ts — Coinductive cycle guard keyed by `typeKey` for recursive type property walks
- TypeCycle — tracks active `typeKey`s on the current call stack; [exp]; callers: 1 outside folder
- TypeCycle.enter(type: Type, onCycle, step) — returns `onCycle` if `type` is active, else marks `type` active and runs `step`; [exp]; callers: 10 outside folder

## src/compiler/checker/types/properties/value-kinds.ts — Computing the data kinds (`live`, `ista`, mark variables) held by a type's values
- DeclaredKinds — `{ marks: readonly Type[]; dependent: readonly Type[] }` per-declaration data-kind summary; [exp]; callers: 0 outside folder
- declaredKindsOf(checker, entity: NominalEntity) — computes fixed marks and parameter-dependent parts of `entity`; [exp]; callers: 1 outside folder
- partsDecidedBy(checker, type: Type, parameters) — held parts of `type` decided by `parameters`; [exp]; callers: 1 outside folder
- dependentAmong(parts: readonly Type[], decided: (part: Type) => boolean): readonly Type[] — filters distinct parts decided by parameters that may add a kind
- heldKindsOf(checker, type: Type, kept: KeptKinds) — distinct data kinds held by `type`, using `kept` caches; [exp]; callers: 1 outside folder
- composedKindsOf(checker, type: Type, kept: KeptKinds) — composes `type`'s kinds from `declaredOf` and arguments; [exp]; callers: 1 outside folder
- instantiatedKindsOf(checker: CheckerContext, kept: KeptKinds, part: Type, instantiated: Type): readonly Type[] — kinds added by an instantiated dependent part
- KeptKinds — `{ declaredOf, composedOf, walkedOf }` entry-table callbacks for caching data kinds; [exp]; callers: 1 outside folder
- walkedKindsOf(checker: CheckerContext, type: Type): readonly Type[] — computes kinds of `type` by walking `writtenTypesOf` whole; [exp]; callers: 1 outside folder
- writtenTypesOf(checker: CheckerContext, type: Type): readonly Type[] — cycle- and depth-bounded walk of `writtenPartsOf`
- writtenPartsOf(checker: CheckerContext, type: Type): readonly Type[] — one-level written field/variant/argument/case types of `type`
- caseTypesOf(checker: CheckerContext, type: MatchType): readonly Type[] — instantiated case body types of an unreduced `MatchType`
- mayOwnKind(part: Type): part is NominalType — whether `part` is a process or confined handle that may have a data kind of its own
- ownValueKindsOf(checker: CheckerContext, part: Type): readonly Type[] — data kinds owned directly by `part` (`boundKindsOf`, `live`, `disposeKindsOf`)
- holdsNoKind(type: Type): boolean — fast-path check for `primitive`, `literal`, `function`, `parameter`, or `error`

## src/compiler/checker/types/traits/any-types.ts — Resolving `any A & B` types and checking object safety and duplicate traits
- resolveAnyType(checker, module, traits, argumentType) — resolves `any` type and checks duplicate traits/object safety; [exp]; callers: 1 outside folder

## src/compiler/checker/types/traits/constraint-implication.ts — Trait constraint implication (`Sendable` and `DataKind` entailment)
- constraintsImply(checker, given, needed: Constraint) — whether `given` constraints imply `needed`; [exp]; callers: 0 outside folder
- impliesSendable(checker, given: readonly Constraint[]) — whether `given` includes `Sendable`, `Encodable`, or `Decodable`; [exp]; callers: 0 outside folder
- marksAllowedBy(checker, given: readonly Constraint[]) — intersection of marks allowed by `given`; [exp]; callers: 0 outside folder
- marksOf(checker: CheckerContext, constraint: Constraint): readonly Type[] | undefined — members of `K` when `constraint` is `DataKind<K>`

## src/compiler/checker/types/traits/constraints.ts — Resolving trait constraints and inspecting trait requirements and substitutions
- wellKnownConstraint(checker, declaration) — builds 0-arg constraint for a well-known trait; [exp]; callers: 3 outside folder
- Requirement — `{ declaration, origin, substitution, inferred? }` required trait function with its substitution; [exp]; callers: 2 outside folder
- resolveAnyConstraints(checker, module, nodes, argumentType) — resolves trait constraints written after `any`; [exp]; callers: 0 outside folder
- ConstraintSite — `{ keyword: 'is' | 'any'; selfOf; argumentType? }` options for `resolveConstraint`; [exp]; callers: 0 outside folder
- resolveConstraint(checker, module, constraint, site) — resolves one trait constraint node; [exp]; callers: 1 outside folder
- requiredFunctions(trait: TraitDeclaration): readonly FunctionDeclaration[] — function members of `trait`; [exp]; callers: 7 outside folder
- requiredFields(trait: TraitDeclaration): readonly FieldDeclaration[] — field members of `trait`; [exp]; callers: 4 outside folder
- requiredAssociatedTypes(trait: TraitDeclaration): readonly RequiredAssociatedType[] — associated type members of `trait`; [exp]; callers: 1 outside folder
- traitAsAny(constraint: Constraint, on: Type): AnyType — converts `constraint` on `on` into a single-constraint `AnyType`; [exp]; callers: 1 outside folder
- constraintSubstitution(constraint, constrained: Type) — maps `constraint.trait` (`Self`) to `constrained` and params to args; [exp]; callers: 6 outside folder
- declaredFieldType(checker, trait: TraitDeclaration, field: FieldDeclaration): Type — resolves `field.type` in `trait`'s module; [exp]; callers: 2 outside folder
- requirementType(checker, required: FunctionDeclaration): FunctionType — function type of trait requirement `required`; [exp]; callers: 2 outside folder
- requiredFieldType(checker, constraint, field, constrained) — substituted required field type for `constrained`; [exp]; callers: 2 outside folder

## src/compiler/checker/types/traits/data-kind.ts — The derived `DataKind<K>` trait, default associated-type kind bounds, and shortfall wording
- boundKindsOf(checker, type: Type) — non-simple marks allowed by a constrained/associated `type`'s bounds; [exp]; callers: 1 outside folder
- mayBeOfKind(checker: CheckerContext, type: Type): boolean — whether an opaque `type` may hold non-simple data once instantiated; [exp]; callers: 1 outside folder
- withKindBound(checker, bounds: readonly Constraint[]) — appends `DataKind<"simple">` if no `DataKind` bound is present; [exp]; callers: 1 outside folder
- isSimpleKindBound(checker: CheckerContext, constraint: Constraint): boolean — whether `constraint` is `DataKind<"simple">`; [exp]; callers: 1 outside folder
- lackedKind(checker, type: Type, constraint: Constraint) — shortfall message when `type` violates `DataKind<K>`; [exp]; callers: 1 outside folder

## src/compiler/checker/types/traits/known-constraints.ts — Constraints, struct constraints, requirements, and associated types known on a type
- knownConstraints(checker, type: Type) — trait constraints met by `any`, parameter, associated, or field `type`; [exp]; callers: 4 outside folder
- structConstraintsOn(checker: CheckerContext, type: Type): readonly StructConstraintModel[] — struct constraints met by `type`; [exp]; callers: 3 outside folder
- mappedStructConstraint(checker: CheckerContext, type: MappedType): StructConstraintModel — derives the `StructConstraintModel` a `MappedType` satisfies
- fieldRule(checker: CheckerContext, type: Type): EntryRule — builds `'meets'` rule for opaque `type` or `'type'` rule for known `type`
- requirementsNamed(checker, on, name: string) — required trait functions named `name` on `on`; [exp]; callers: 1 outside folder
- associatedTypeOf(checker, of: Type, name, underWay) — resolves or reduces `of.name`, guarding cycles; [exp]; callers: 1 outside folder
- Expansion — `{ readonly key: string; reachesItself: boolean }` active associated-type expansion frame; [exp]; callers: 1 outside folder
- associatedDeclarationsOn(checker, of: Type) — associated types declared or required on `of`; [exp]; callers: 2 outside folder
- keyedFieldTypes(checker: CheckerContext, of: Type, key: Type): readonly Type[] | undefined — field types in known struct `of` for each member of opaque `key`
- keyMembers(checker: CheckerContext, key: Type): readonly Type[] — expands `key`'s union and member-parameter unions to leaf key types; [exp]; callers: 1 outside folder
- associatedDeclarationOf(checker: CheckerContext, of: Type, name: string): AssociatedType | RequiredAssociatedType | undefined — finds associated type `name` on `of`
- entryRules(checker: CheckerContext, type: Type): readonly EntryRule[] — struct-constraint `EntryRule`s governing `FieldOfType` `type`; [exp]; callers: 0 outside folder
- commonRules(checker: CheckerContext, each: readonly (readonly EntryRule[])[]): readonly EntryRule[] — intersects `EntryRule`s across multiple possible keys
- rulesImply(checker, given, trait: Constraint, meets) — whether field `EntryRule`s `given` imply `trait`; [exp]; callers: 1 outside folder
- requirementsDeclaring(checker, of: Type, name: string) — trait requirements declaring associated type `name`; [exp]; callers: 0 outside folder
- boundsOf(checker: CheckerContext, type: AssociatedOfType): { traits: Constraint[]; structs: StructConstraintModel[] } — substituted bounds of `type`

## src/compiler/checker/types/traits/known-fields.ts — Looking up a field on a struct, `any`, type parameter, or computed type
- fieldOf(checker, given: Type, name: string) — finds field `name` on `given` and how a read reaches it; [exp]; callers: 6 outside folder

## src/compiler/checker/types/traits/member-bounds.ts — Intersecting `type Mode in U` member bounds on associated types
- associatedMemberUnion(checker, type: AssociatedOfType) — shared member union of `type` across its declaring traits; [exp]; callers: 1 outside folder

## src/compiler/checker/types/traits/object-safety.ts — Checking whether a trait constraint can be used in an `any` type
- objectUnsafety(checker, constraint: Constraint) — reason `constraint` is not object-safe, or `undefined`; [exp]; callers: 1 outside folder
- functionUnsafety(checker: CheckerContext, required: FunctionDeclaration, reading: SelfReading): string | undefined — checks one required function for `Self` misuse

## src/compiler/checker/types/traits/sendable.ts — The derived `Sendable` rule over held types and closure capture sendability
- isSendable(checker: CheckerContext, type: Type): boolean — whether every part held by `type` may leave its instance; [exp]; callers: 4 outside folder
- capturedSend(checker, types: readonly Type[]) — `sendable`, shared sendability variable, or `plain` for captured `types`; [exp]; callers: 2 outside folder
- keepsInInstance(checker: CheckerContext, part: Type): boolean — whether `part` is a non-sendable function, confined handle, or non-Sendable opaque type

## src/compiler/checker/types/traits/struct-constraints.ts — Resolving `is struct { ... }` constraints and constraint sets from syntax
- resolveConstraintSet(checker, module, nodes, selfOf?) — splits and resolves trait and struct constraints; [exp]; callers: 2 outside folder
- resolveStructConstraint(checker, module, node) — resolves a `StructConstraint` syntax node into a `StructConstraintModel`; [exp]; callers: 1 outside folder

## src/compiler/checker/types/traits/struct-keys.ts — Reducing `keyof S`, `S[K]`, and mapped struct types, and tracking key owners
- isStructType(type: Type): type is StructValueType — whether `type` is an anonymous struct or non-shared, non-extern nominal struct; [exp]; callers: 2 outside folder
- keyName(key: Type): string | undefined — string value if `key` is a string `LiteralType`, else `undefined`; [exp]; callers: 1 outside folder
- keysOf(checker: CheckerContext, of: Type, without: readonly string[]): Type — reduces `keyof of` minus `without`; [exp]; callers: 2 outside folder
- withoutKeys(checker: CheckerContext, keys: Type, names: readonly string[]): Type — removes `names` from literal and `KeysType` members of `keys`
- mappedKeys(checker: CheckerContext, holding: StructType, union: Type): Type — removes sibling named fields of `holding` from a mapped entry's `union`
- memberUnionOf(checker, parameter: TypeParameter) — resolves `parameter.memberOf` (minus sibling fields if mapped); [exp]; callers: 1 outside folder
- namesMemberParameter(checker, parameter) — whether `parameter.memberOf` names a single-type member parameter/associated type; [exp]; callers: 1 outside folder
- isKeyWithin(checker: CheckerContext, key: Type, keys: Type): boolean — whether every possible key in `key` is contained in `keys`; [exp]; callers: 1 outside folder
- fieldTypeOf(checker, of: Type, key: Type) — reduces `of[key]` for known structs, mapped types, and constrained opaque types; [exp]; callers: 2 outside folder
- namedFieldType(checker: CheckerContext, of: Type, name: string): Type — field type for a concrete field `name` on `of`
- opaqueFieldType(checker: CheckerContext, of: Type, key: Type): Type | undefined — exact type or opaque `FieldOfType` from struct constraints on `of`
- mappedFieldType(checker: CheckerContext, of: MappedParts, key: Type, outer?): Type — substitutes `key` for `of.parameter` (plus `outer`) in `of.value`
- mappedTypeOf(checker, parts: MappedParts, outer?) — reduces `parts` to `shapeType` when keys are literals, else `MappedType`; [exp]; callers: 1 outside folder
- keyOwnerOfValue(context, value: Expression) — struct type that `value` is a key of (via `FieldHeader` or `keysOwner`); [exp]; callers: 2 outside folder
- recordPatternKeys(context, pattern: Pattern, owner?: Type): void — records string literals in `pattern` as keys of struct `owner`; [exp]; callers: 1 outside folder

## src/compiler/checker/types/type/alias-uses.ts — Tracking the alias, associated type, or `keyof` spelling a `Type` was written through
- DeclaredAliasUse — `{ kind: 'alias'; declaration: TypeAliasDeclaration; arguments: readonly Type[] }`; [exp]; callers: 1 outside folder
- AssociatedUse — `{ kind: 'associated'; of: Type; name: string }` spelling of a known associated type; [exp]; callers: 0 outside folder
- AliasUse — `DeclaredAliasUse | AssociatedUse | KeysUse` union of `WrittenThrough.alias` spellings; [exp]; callers: 1 outside folder
- RecursiveLabel — `DeclaredAliasUse | AssociatedUse` label on a `RecursiveGraph` node; [exp]; callers: 2 outside folder
- aliasedAs(type: Aliased, alias: AliasUse): Aliased — attaches `alias` to `type` unless `type` is `errorType`; [exp]; callers: 7 outside folder
- mapAliasUse(use: Use, map) — maps `map` over type arguments or `of` in `use`, preserving identity if unchanged; [exp]; callers: 2 outside folder

## src/compiler/checker/types/type/computed-types.ts — Model of opaque computed types (`T.Data`, `S[K]`, `keyof S`, mapped, `match`) and `RecursiveType`
- AssociatedOfType — `{ kind: 'associated'; of: Type; name: string }` opaque associated type; [exp]; callers: 1 outside folder
- ownAssociatedType(owner: NominalType, name: string) — finds associated type `name` on `owner`'s declaration; [exp]; callers: 2 outside folder
- FieldOfType — `{ kind: 'field'; of: Type; key: Type }` opaque indexed field type; [exp]; callers: 0 outside folder
- KeysType — `{ kind: 'keys'; of: Type; without: readonly string[] }` opaque remaining keys of `of`; [exp]; callers: 0 outside folder
- MappedType — `{ kind: 'mapped'; origin; named; parameter; keys; value }` unreduced mapped struct type; [exp]; callers: 0 outside folder
- MatchType — `{ kind: 'match'; declaration; arguments; owner? }` unreduced type `match` use; [exp]; callers: 4 outside folder
- MappedParts — `Omit<MappedType, 'kind' | 'alias'>` parts of a mapped struct type; [exp]; callers: 4 outside folder
- ComputedType — `AssociatedOfType | FieldOfType | KeysType | MappedType | MatchType`; [exp]; callers: 5 outside folder
- isComputed(type: Type): type is ComputedType — whether `type` is one of the 5 `ComputedType` kinds; [exp]; callers: 9 outside folder
- formDecidedBy(type: ComputedType): Type — returns `type.keys` for `mapped`, else `type`; [exp]; callers: 1 outside folder
- isOpaque(type: Type): type is TypeParameterType | ComputedType — whether `type` is a `parameter` or `ComputedType`; [exp]; callers: 10 outside folder
- RecursiveType — `{ kind: 'recursive'; graph: RecursiveGraph; node: number }` equi-recursive type node; [exp]; callers: 7 outside folder
- RecursiveGraph — `{ nodes: readonly Type[]; types: readonly RecursiveType[]; labels: readonly (RecursiveLabel | undefined)[] }`; [exp]; callers: 7 outside folder
- unfoldRecursive(type: RecursiveType): Type — returns `type.graph.nodes[type.node]`; [exp]; callers: 8 outside folder
- unfolded(type: Type): Type — unfolds `type` one step if `recursive`, else returns `type`; [exp]; callers: 26 outside folder
- isMatchAlias(declaration: AliasDeclaration): boolean — whether `declaration.type.kind === 'TypeMatch'`; [exp]; callers: 2 outside folder

## src/compiler/checker/types/type/field-defaults.ts — Checking whether a struct or variant `FieldMember` declares a default value
- declaresDefault(field?: FieldMember): boolean — whether `field.declared.node` is a `DeclaredField` with a default; [exp]; callers: 2 outside folder

## src/compiler/checker/types/type/field-order.ts — Canonical name-order sorting and positional layout mapping for struct fields
- inFieldOrder(fields: readonly Named[]): readonly Named[] — sorts `fields` by `compareOrdered` on `name`; [exp]; callers: 4 outside folder
- laidOut(fields: readonly { name: string }[], named: ReadonlyMap<string, Value>): Value[] — orders `named` values to match `fields`; [exp]; callers: 3 outside folder
- namedValues(fields, values: readonly Value[]) — maps `fields` names to positional `values`; [exp]; callers: 1 outside folder

## src/compiler/checker/types/type/function-kinds.ts — Function marks (`simple`, `live`, `ista`, mark variables) and the call rule over types
- simpleMark: Type — `"simple"` literal mark type; [exp]; callers: 12 outside folder
- isSimpleMark(mark: Type): boolean — whether `mark` is the literal `"simple"`; [exp]; callers: 8 outside folder
- KindLookup — `Pick<Checker, 'kindOf'>` seam for reading a function's mark; [exp]; callers: 1 outside folder
- KindNames — `Pick<CheckerContext, 'moduleOf' | 'resolveType' | 'valueKindsOf' | 'fitting' | 'inputs'>`; [exp]; callers: 0 outside folder
- kindAdmits(code: Type, callee: Type, same): boolean — whether code of mark `code` may call `callee` (`markOrder.below`); [exp]; callers: 4 outside folder
- fieldsKindOf(names: KindNames, declaration: FunctionDeclaration): Type — derives a fields function's mark from its written parameter types
- persistenceOf(kind: Type): Persistence | undefined — returns `'live'` or `'ista'` if `kind` is that literal, else `undefined`; [exp]; callers: 4 outside folder
- writtenKindOf(qualifiers: FunctionQualifiers): Type | undefined — literal mark type written on `qualifiers.kind`; [exp]; callers: 3 outside folder
- kindOfFunction(lookup, declaration: FunctionDeclaration) — returns `writtenKindOf` or cached `lookup.kindOf(declaration)`; [exp]; callers: 14 outside folder
- functionKindOf(names, declaration: FunctionDeclaration) — computes `declaration`'s mark (written, fields, named mark, or `simple`); [exp]; callers: 1 outside folder
- namedMarkOf(names, declaration: FunctionDeclaration): Type | undefined — resolves `declaration.mark` (`M fn` or `Self.Mode fn`); [exp]; callers: 1 outside folder
- kindHolderName(lookup, parameter: TypeParameter): string — formats the declaring item's name for `oneKindOfEither` diagnostics; [exp]; callers: 1 outside folder
- isOneKind(lookup: QualifierLookup, kind: Type): boolean — whether `kind` is `live`, `ista`, or a variable standing for one of them; [exp]; callers: 3 outside folder
- isMarkVariable(lookup: QualifierLookup, type: Type): boolean — whether `type` is a mark parameter or mark-bounded associated type; [exp]; callers: 3 outside folder
- isBoundTo(lookup: QualifierLookup, type: Type, members: readonly string[]): boolean — whether `type` is an associated type bounded to literals in `members`
- declaringOf(lookup, parameter: TypeParameter): GenericDeclaration | undefined — walks AST parents to find the generic declaration owning `parameter`
- QualifierLookup — `{ readonly fitting: Pick<Fitting, 'qualifierOf' | 'memberUnionOf'> }`; [exp]; callers: 1 outside folder
- isMarkParameter(lookup: QualifierLookup, parameter: TypeParameter): boolean — whether `parameter` has `markOrder`; [exp]; callers: 1 outside folder
- standsForOneKind(lookup: QualifierLookup, parameter: TypeParameter): boolean — whether `parameter` has `markOrder` and `!mayBeBottom`; [exp]; callers: 1 outside folder

## src/compiler/checker/types/type/function-types.ts — Constructing, inspecting, and relating `FunctionType`s, variadic packs, and async results
- plainSend: Type — `"plain"` sendability literal type; [exp]; callers: 4 outside folder
- sendableSend: Type — `"sendable"` sendability literal type; [exp]; callers: 4 outside folder
- sendOf(qualifiers: FunctionQualifiers): Type — returns `sendableSend` or `plainSend` from `qualifiers.send`; [exp]; callers: 1 outside folder
- isSendableFunction(type: FunctionType): boolean — whether `type.send` is `"sendable"`; [exp]; callers: 4 outside folder
- modifiersOf(type: FunctionType): Modifiers — extracts `{ send, kind }` modifiers from `type` for printing; [exp]; callers: 0 outside folder
- sendFits(given: Type, expected: Type, same): boolean — whether `given` is at or below `expected` in `sendabilityOrder`; [exp]; callers: 1 outside folder
- FunctionParts — input fields (`send`, `mark`, `parameters`, `pack?`, `result`, `alias?`) for `functionType`; [exp]; callers: 0 outside folder
- functionType(parts: FunctionParts): FunctionType — canonical `FunctionType` constructor flattening tuple/Unit packs; [exp]; callers: 12 outside folder
- packed(parameters: readonly ParameterSlot[], pack?: Type): Pick<FunctionType, 'parameters' | 'pack'> — flattens a tuple `pack` into `parameters`
- fnType(typeArguments, byReference: readonly boolean[]) — builds `FunctionType` for `Fn<Args, Result, Kind, Send>`; [exp]; callers: 1 outside folder
- RestSlot — `{ kind: 'array', item: Type } | { kind: 'pack' }` descriptor for a rest parameter; [exp]; callers: 8 outside folder
- packRestSlot: RestSlot — `{ kind: 'pack' }` constant; [exp]; callers: 3 outside folder
- isPack(type: Type): type is TypeParameterType — whether `type` is a `TypeParameter` with `isPack: true`; [exp]; callers: 7 outside folder
- fillsPack(type: Type): boolean — whether `type` is a tuple, `Unit`, pack, or `errorType`; [exp]; callers: 3 outside folder
- takesNothing(type: Type): type is FunctionType — whether `type` is a `FunctionType` with 0 parameters and no pack; [exp]; callers: 2 outside folder
- sameShape(declared: FunctionType, given: FunctionType, parts, results?): boolean — compares parameters (including packs) and results; [exp]; callers: 0 outside folder
- restOf(type: FunctionType, start: number): Type | undefined — packs trailing parameters of `type` from `start` into a tuple or pack
- FunctionRelation — `{ parts, results?, marks, sends }` callbacks for `functionFits`; [exp]; callers: 1 outside folder
- functionFits(declared, given, relation) — relates two `FunctionType`s across parameters, results, marks, and sends; [exp]; callers: 3 outside folder
- AwaitedType — `{ readonly value: Type; readonly mode: Type }` value and persistence mode of a future/resolver; [exp]; callers: 4 outside folder
- Futures — `{ futureOf, awaitedOf }` seam for constructing and unwrapping `Future<T, K>`; [exp]; callers: 3 outside folder
- ResultFit — `{ kind: 'value' } | { kind: 'resolved' | 'awaited'; value: Type; into: Type }`; [exp]; callers: 1 outside folder
- resultFitOf(given: Type, expected: Type, fits, futures) — how function result `given` fits `expected` (`value`/`resolved`/`awaited`); [exp]; callers: 2 outside folder
- sameMode(given: Type, expected: Type, fits): boolean — checks mutual fit of two futures' persistence modes
- resolvedInto(given: Type, expected: Type, futures): Type | undefined — future value `expected` when `given` is not a future; [exp]; callers: 1 outside folder
- madeAsync(type: FunctionType, futures: Futures, mode: Type) — wraps sync `type`'s result in `Future<R, mode>`; [exp]; callers: 1 outside folder
- headResult(futures, head, kind, value: Type) — wraps `value` in `Future` if `head` is `async`; [exp]; callers: 3 outside folder

## src/compiler/checker/types/type/index.ts — Core `Type` union, nominal/shape constructors, and type-parameter/member helpers
- WrittenThrough — `{ readonly alias?: AliasUse | undefined }` base interface carried by every `Type`; [exp]; callers: 0 outside folder
- PrimitiveType — `{ kind: 'primitive'; name: PrimitiveName }`; [exp]; callers: 0 outside folder
- NominalDeclaration — `DeclaredStruct | EnumDeclaration | ExternStructDeclaration`; [exp]; callers: 11 outside folder
- NominalEntity — `TypeEntity & { readonly declaration: NominalDeclaration }`; [exp]; callers: 8 outside folder
- Constraint — `{ readonly trait: TraitDeclaration; readonly arguments: readonly Type[] }`; [exp]; callers: 29 outside folder
- AnyType — `{ kind: 'any'; constraints: readonly Constraint[] }`; [exp]; callers: 31 outside folder
- NominalType — `{ kind: 'nominal'; entity: NominalEntity; arguments: readonly Type[] }`; [exp]; callers: 30 outside folder
- isNominalEntity(entity: TypeEntity) — whether `entity.declaration` is a struct, shared struct, enum, or extern struct; [exp]; callers: 7 outside folder
- nominalType(entity: TypeEntity, typeArguments: readonly Type[]): NominalType — checked `NominalType` constructor; [exp]; callers: 9 outside folder
- TupleType — `{ kind: 'tuple'; elements: readonly Type[] }`; [exp]; callers: 3 outside folder
- FieldMember — `{ name: string; type: Type; declared?: { node: Field; module: ModuleId; type: Type } }`; [exp]; callers: 40 outside folder
- AnonymousStructType — `{ kind: 'anonymous'; origin; fields: readonly FieldMember[] }`; [exp]; callers: 14 outside folder
- RecursiveUse — `{ declaration: AliasDeclaration; arguments: readonly Type[] }`; [exp]; callers: 2 outside folder
- shapeType(origin, fields: readonly FieldMember[]) — builds `AnonymousStructType` with `fields` in name order; [exp]; callers: 4 outside folder
- ParameterSlot — `{ readonly type: Type; readonly reference: boolean }`; [exp]; callers: 3 outside folder
- FunctionType — `{ kind: 'function'; mark; send; parameters; pack?; result }` branded function type; [exp]; callers: 27 outside folder
- PackType — `TypeParameterType | ErrorType`; [exp]; callers: 1 outside folder
- ParameterKey — `TypeParameter | TraitDeclaration | FieldHeader | RestPattern | TypeAliasDeclaration | Placeholder`; [exp]; callers: 36 outside folder
- Placeholder — `{ kind: 'Placeholder'; node: Expression }` key for a postponed expression; [exp]; callers: 1 outside folder
- TypeParameterType — `{ kind: 'parameter'; declaration: ParameterKey; within?: Type; meeting?: StructCaseConstraint }`; [exp]; callers: 4 outside folder
- namesOneType(type: Type): boolean — whether `type` has a member that is a member parameter or associated type; [exp]; callers: 3 outside folder
- isMemberParameter(type: Type): type is TypeParameterType — whether `type` is a parameter with `within` or `declaration.memberOf`
- UnreducedUse — `{ use; cause: 'unmatched' | 'itself' | 'holdsItself' | 'expandsItself' }` unreduced cause; [exp]; callers: 2 outside folder
- ErrorType — `{ kind: 'error'; unreduced?: UnreducedUse }`; [exp]; callers: 1 outside folder
- LiteralValue — `bigint | string | boolean`; [exp]; callers: 5 outside folder
- LiteralType — `{ kind: 'literal'; value: LiteralValue }`; [exp]; callers: 14 outside folder
- UnionType — `{ kind: 'union'; members: readonly Type[] }`; [exp]; callers: 19 outside folder
- StructValueType — `NominalType | AnonymousStructType`; [exp]; callers: 8 outside folder
- Type — discriminated union of all 16 checker type variants; [exp]; callers: 277 outside folder
- membersOf(type: Type): readonly Type[] — returns `type.members` if `type` is a union, else `[type]`; [exp]; callers: 33 outside folder

## src/compiler/checker/types/type/mark-orders.ts — The partial orders for `Mark` (`simple < live, ista`) and `Sendability` (`sendable < plain`)
- QualifierOrder — `{ bottom, below, join, settlesLeast }` order descriptor for qualifier literals; [exp]; callers: 3 outside folder
- QualifierParameter — `{ order: QualifierOrder; mayBeBottom: boolean }`; [exp]; callers: 3 outside folder
- aboveBottom(types: readonly Type[], bottom: Type, same: Same): readonly Type[] — distinct items in `types` not equal to `bottom`; [exp]; callers: 1 outside folder
- markOrder: QualifierOrder — `Mark` order with `"simple"` bottom, `"live"` and `"ista"` incomparable above it; [exp]; callers: 6 outside folder
- sendabilityOrder: QualifierOrder — `Sendability` order with `"sendable"` below `"plain"`; [exp]; callers: 2 outside folder
- sameMark(first: Type, second: Type): boolean — structural equality of two mark types (literal, parameter, or associated); [exp]; callers: 1 outside folder

## src/compiler/checker/types/type/primitives.ts — Built-in primitive types, `errorType`, tuple constructor (`()` = `Unit`), and literal helpers
- primitiveType(name: PrimitiveName): PrimitiveType — constructs `{ kind: 'primitive', name }`; [exp]; callers: 2 outside folder
- intType: PrimitiveType — `Int` primitive type; [exp]; callers: 4 outside folder
- floatType: PrimitiveType — `Float` primitive type; [exp]; callers: 2 outside folder
- boolType: PrimitiveType — `Bool` primitive type; [exp]; callers: 6 outside folder
- stringType: PrimitiveType — `String` primitive type; [exp]; callers: 2 outside folder
- unitType: PrimitiveType — `Unit` primitive type; [exp]; callers: 15 outside folder
- neverType: PrimitiveType — `Never` primitive type; [exp]; callers: 18 outside folder
- noneType: PrimitiveType — `None` primitive type; [exp]; callers: 6 outside folder
- errorType: ErrorType — singleton `{ kind: 'error' }`; [exp]; callers: 72 outside folder
- expectsError(expected?: Type): boolean — whether `expected?.kind === 'error'`; [exp]; callers: 5 outside folder
- isPrimitive(type: Type, name: PrimitiveName): boolean — whether `type` is the primitive `name`; [exp]; callers: 30 outside folder
- tupleType(elements: readonly Type[]): Type — returns `unitType` for `[]`, else `{ kind: 'tuple', elements }`; [exp]; callers: 5 outside folder
- tupleElements(type: Type): readonly Type[] | undefined — returns `type.elements` for a tuple, `[]` for `Unit`, else `undefined`; [exp]; callers: 6 outside folder
- literalType(value: LiteralValue): LiteralType — constructs `{ kind: 'literal', value }`; [exp]; callers: 10 outside folder
- markType(mark: Mark): Type — constructs `literalType(mark)`; [exp]; callers: 6 outside folder
- sendType(sendability: Sendability): Type — constructs `literalType(sendability)`; [exp]; callers: 0 outside folder

## src/compiler/checker/types/type/struct-constraint.ts — Model, substitution, spelled equality, and formatting of struct constraints
- StructConstraintModel — `{ named: readonly NamedEntry[]; others: EntryRule | undefined }`; [exp]; callers: 10 outside folder
- ConstraintSet — `{ traits: readonly Constraint[]; structs: readonly StructConstraintModel[] }`; [exp]; callers: 3 outside folder
- AssociatedBounds — `ConstraintSet & { readonly memberOf: Type | undefined }`; [exp]; callers: 3 outside folder
- EntryRule — `{ kind: 'type'; type: Type } | ({ kind: 'meets' } & ConstraintSet)`; [exp]; callers: 4 outside folder
- substituteStructConstraint(model, substitution, rules) — substitutes `substitution` into `model`; [exp]; callers: 4 outside folder
- sameStructConstraint(first, second: StructConstraintModel) — spelled equality of two struct constraints; [exp]; callers: 1 outside folder
- structConstraintText(model: StructConstraintModel): string — formats `model` as `struct { ... }`; [exp]; callers: 1 outside folder
- ruleText(rule: EntryRule): string — formats an `EntryRule` as `: Type` or ` is Constraints`
- constraintSetText(set: ConstraintSet): string — formats `set` as `A & struct { ... }`; [exp]; callers: 1 outside folder

## src/compiler/checker/types/type/type-rules.ts — Program-level seam (`TypeRules`) for union absorption and computed-type reduction
- TypeRules — `{ absorbs, associatedType, fieldType, keysOf, mappedType, matchType, isKeyOf }` seam; [exp]; callers: 27 outside folder

## src/compiler/checker/types/type/type-text.ts — Formatting `Type`s, function signatures, constraints, and alias spellings for diagnostics/hover
- unlabelledText(type: RecursiveType): string — prints an unlabelled recursive node as its body with `…` on cycle
- ownerText(type: Type): string — parenthesizes union, function, or `any` types before `.` or `[`
- writtenAndNamedText(type: Type): string — formats `written = named` when `type` carries an `alias` spelling; [exp]; callers: 1 outside folder
- typeText(given: Type): string — formats `given` as Istalang source text; [exp]; callers: 75 outside folder
- functionTypeParts(type: FunctionType) — splits function text into `{ head, parameters, tail }` for signature help; [exp]; callers: 1 outside folder
- fnParts(type: FunctionType): { head: string; parameters: readonly string[]; tail: string } — formats `Fn<...>` when mark or send is a variable
- ownFutureValue(type: FunctionType): Type | undefined — unwraps `Future<V, K>` result when `K` matches `type.mark`
- slotText(slot: ParameterSlot): string — formats a parameter slot as `T` or `&T`; [exp]; callers: 2 outside folder
- constraintText(constraint: Constraint): string — formats a trait constraint omitting trailing default `Self` arguments; [exp]; callers: 3 outside folder
- unionText(type: UnionType): string — formats `T?` for 2-member optional or `A | B` with function members parenthesized
- keysText(of: Type, without: readonly string[]): string — formats `keyof S` or `keyof S except "a" | "b"`
- parameterText(type: TypeParameterType): string — formats `Self`, `keyof …`, `_`, `F`, or parameter name; [exp]; callers: 1 outside folder
- spellingText(alias: AliasUse): string — formats an `AliasUse` (`Alias<...>`, `T.Name`, `keyof S`); [exp]; callers: 1 outside folder

## src/compiler/checker/types/type/well-known.ts — Recognizing and constructing prelude/stdlib well-known types by binder entity
- wellKnownArguments(checker, declaration, type: Type) — type args if `type` is `declaration`, else `undefined`; [exp]; callers: 12 outside folder
- wellKnownOf(checker, declaration, typeArguments?) — builds nominal well-known type or `errorType`; [exp]; callers: 2 outside folder
- cellTypeOf(checker, type: Type): NominalType — builds `_Cell<type>`; [exp]; callers: 1 outside folder
- futureOf(checker, value: Type, mode: Type): Type — builds `Future<value, mode>`; [exp]; callers: 2 outside folder
- awaitedOf(checker, type: Type): AwaitedType | undefined — extracts `{ value, mode }` if `type` is `Future<value, mode>`; [exp]; callers: 6 outside folder
- resolvedThrough(checker, type: Type): AwaitedType | undefined — extracts `{ value, mode }` if `type` is `Resolver<value, mode>`; [exp]; callers: 1 outside folder
- outcomeOf(checker, type: Type): Type — returns `awaitedOf(checker, type)?.value ?? type`; [exp]; callers: 4 outside folder
- futuresOf(checker): Futures — binds `{ futureOf, awaitedOf }` to `checker`; [exp]; callers: 3 outside folder
- arrayOf(checker: CheckerContext, element: Type): Type — builds `Array<element>`; [exp]; callers: 5 outside folder
- arrayElement(checker, type: Type): Type | undefined — extracts `T` if `type` is `Array<T>`; [exp]; callers: 12 outside folder
- isWellKnownTrait(checker: CheckerContext, trait: TraitDeclaration, declaration: WellKnownDeclaration): boolean — checks trait identity; [exp]; callers: 3 outside folder

## src/compiler/checker/types/unions/common-type.ts — Finding the common type of several producer types (holder, literal widening, or optional join)
- Joining — `Pick<CheckerContext, 'fitOf' | 'typeRules' | 'fitting'>` seam for `commonType`; [exp]; callers: 5 outside folder
- commonType(types: readonly Type[], joining) — finds first holder, widened holder, or optional join of `types`; [exp]; callers: 3 outside folder
- orWidened(candidate: Type, types, joining, widen) — `candidate` or `widen(candidate)` if it holds all `types`; [exp]; callers: 1 outside folder
- presentPart(type: Type): Type | undefined — returns `undefined` for `None`, `optionalInner(type)` for optionals, else `type`; [exp]; callers: 1 outside folder
- optionalOver(type: Type, joining: Joining): Type — makes `type` optional unless `presentType` is already defined; [exp]; callers: 1 outside folder
- joinWidened(type: Type, joining: Joining): Type — widens literals/member-bases/sendable functions (including inside an optional); [exp]; callers: 1 outside folder
- withinOptional(type: Type, change, joining: Joining) — applies `change` to `type` or its `optionalInner`; [exp]; callers: 1 outside folder
- optionalJoin(types: readonly Type[], joining: Joining): Type | undefined — joins `presentPart`s of `types` and wraps in `optionalOver` if any holds `none`

## src/compiler/checker/types/unions/equality.ts — Type compatibility and compile-time literal-set decisions for `==`, `!=`, and literal patterns
- comparable(first, second: Type) — whether `first` and `second` compare directly (same type, same-base literals, `Never`, `error`); [exp]; callers: 1 outside folder
- comparableAsMembers(context: SidesFitting, first: Type, second: Type): boolean — whether member-parameter types compare across all member pairs
- EqualitySide — `{ readonly type: Type; readonly node: Expression | undefined }` operand of `fitEqualSides`; [exp]; callers: 1 outside folder
- fitEqualSides(context, left: EqualitySide, right) — checks comparability or fits one side into the other; [exp]; callers: 2 outside folder
- decidedEquality(left, right, compare, memberUnionOf) — static `true`/`false` if decided by literal sets; [exp]; callers: 2 outside folder
- isKnown(type: Type): boolean — whether `type` is not `isOpaque`, not `error`, and not `Never`; [exp]; callers: 2 outside folder
- MemberUnionOf — `(type: Type) => Type | undefined` callback type; [exp]; callers: 0 outside folder
- ComparedSide — `{ readonly type: Type; readonly node: Expression | undefined }` operand of `decidedEquality`; [exp]; callers: 0 outside folder
- sideLiterals(side: ComparedSide, memberUnionOf: MemberUnionOf): KnownLiterals | undefined — literal set of `side` from syntax or `literalsOf(side.type)`
- literalsOf(type: Type, memberUnionOf: MemberUnionOf): KnownLiterals | undefined — extracts closed/open literal set from `type` or its member union
- decidedEqual(left?: KnownLiterals, right?: KnownLiterals): boolean | undefined — decides whether two `KnownLiterals` sets are always or never equal
- mayBe(known: KnownLiterals, value: LiteralValue): boolean — whether `value` is a possible value of `known`

## src/compiler/checker/types/unions/inside-optional.ts — Diagnostic hint suggesting `?.`, `?.[`, `?.(`, or `?->` when an operation fails on `T?`
- insideOptional(at, type: Type, form: LinkForm) — builds `insideOptional` diagnostic if `type` is optional; [exp]; callers: 6 outside folder

## src/compiler/checker/types/unions/union-members.ts — Generic union-member normalization (deduplication, `Never`, literal merging, `any` absorption)
- LiteralBase — `'Int' | 'String' | 'Bool'` primitive name of a literal's base type; [exp]; callers: 0 outside folder
- literalBase(value: LiteralValue): LiteralBase — returns `'Int'`, `'String'`, or `'Bool'` for `value`; [exp]; callers: 0 outside folder
- baseOf(type: Type): Type — widens a `literal` or `keys` type to its primitive base (`Int`, `String`, `Bool`), else returns `type`; [exp]; callers: 16 outside folder
- MemberRules — `Pick<TypeRules, 'absorbs'>` seam for `normalizedMembers`; [exp]; callers: 1 outside folder
- MemberReading — `{ typeOf, keyOf, memberOf }` adapter for normalizing `Type`s or `TermGraph` `Slot`s; [exp]; callers: 1 outside folder
- normalizedMembers(members, reading, rules: MemberRules) — normalizes union members (errors, duplicates, literals, `any`); [exp]; callers: 1 outside folder
- distinctMembers(members: readonly Member[], reading: MemberReading<Member>): readonly Member[] — drops `Never` and duplicate member keys
- mergedLiterals(members: readonly Member[], reading: MemberReading<Member>): readonly Member[] — merges literals into present base types and `true | false` into `Bool`
- absorbingMember(members, member: Type, rules) — finds `any` member in `members` that absorbs `member`; [exp]; callers: 3 outside folder

## src/compiler/checker/types/unions/unions.ts — Constructing normalized unions, optionals (`T | None`), and literal types
- unionOf(members: readonly Type[], rules: TypeRules) — flattens, normalizes, and folds `members` into a union, single type, or `Never`; [exp]; callers: 15 outside folder
- unionOfNormalized(members: readonly Type[]): Type — wraps already-normalized `members` into `neverType`, `members[0]`, or `UnionType`; [exp]; callers: 5 outside folder
- hasMember(type: Type, member: Type): boolean — whether `member` is equal by `typeKey` to one of `membersOf(type)`; [exp]; callers: 7 outside folder
- optionalOf(type: Type, rules: TypeRules): Type — returns `unionOf([type, noneType], rules)`; [exp]; callers: 4 outside folder
- optionalInner(type: Type): Type | undefined — returns `type` without `None` if `type` is a union containing `None`, else `undefined`; [exp]; callers: 6 outside folder
- presentType(type: Type, rules: TypeRules) — non-`none` type for `??`/`?.`/`!` (`Never` for `None`, unfolded inner, or absorbing `any`); [exp]; callers: 2 outside folder
- hasOneValue(member: Type): boolean — whether `member` is a `literal` type or `None`; [exp]; callers: 7 outside folder
- writtenLiteral(node: Expression) — extracts `LiteralType` from string, boolean, or signed integer literal syntax; [exp]; callers: 8 outside folder
- literalOrBase(value: LiteralValue, expected, fitting) — keeps `LiteralType` if `expected` wants a literal/member, else base; [exp]; callers: 5 outside folder
- literalsBase(type: Type): Type | undefined — common primitive base if every member of `type` is a `literal` or `keys` of the same base; [exp]; callers: 1 outside folder

## src/compiler/checker/types/unions/widening.ts — Dropping literal and `sendable` function refinements from a type
- widened(type: Type, rules: TypeRules): Type — widens top-level literal to its base, or widens `sendable` functions at any depth; [exp]; callers: 2 outside folder
- sendableWidened(type, rules: TypeRules) — recursively replaces `sendable` on function types with `plain`, dropping `alias` if changed; [exp]; callers: 1 outside folder

## src/compiler/checker/types/variance/lattice.ts — The 4-point usage/variance lattice (`unused ⊏ covariant, contravariant ⊏ invariant`)
- Variance — `'covariant' | 'contravariant' | 'invariant'`; [exp]; callers: 4 outside folder
- Usage — `'unused' | Variance`; [exp]; callers: 0 outside folder
- joined(first: Usage, second: Usage): Usage — least upper bound of two `Usage`s in the variance lattice; [exp]; callers: 0 outside folder
- composed(outer: Variance, inner: Usage): Usage — composes outer position variance with inner parameter usage; [exp]; callers: 0 outside folder
- flipped(usage: Seen): Usage — flips `covariant` and `contravariant`, keeping `unused` and `invariant`; [exp]; callers: 0 outside folder

## src/compiler/checker/types/variance/usage-walk.ts — Walking a declaration's held types to accumulate parameter variance usages
- UsageWalk — walks `Type` trees recording where each `TypeParameter` occurs and at what `Variance`; [exp]; callers: 0 outside folder
- UsageWalk.walk(type: Type, at: Variance): void — walks `type` at variance `at`, updating `this.usages`; [exp]; callers: 0 outside folder
- UsageWalk.#meet(parameter: ParameterKey, at: Variance): void — joins `at` into `this.usages` if `parameter` is one of `#parameters`
- UsageWalk.#arguments(declaration, given: readonly Type[], at: Variance): void — walks type arguments composed with `declaration`'s variances
- UsageWalk.#function(type: FunctionType, at: Variance): void — walks function mark/send/ref-params invariantly, value params flipped, and result/awaited at `at`
- UsageWalk.#recursive(type: RecursiveType, at: Variance): void — unfolds `type` once per `(graph, node, at)` state

## src/compiler/checker/types/variance/variance.ts — Deriving SCC fixpoint variances for structs/enums/traits/aliases and reading written ones
- VarianceReading — `{ partsOf, awaitedOf }` seam for `varianceOf`; [exp]; callers: 0 outside folder
- HeldPart — `{ readonly type: Type; readonly at: Variance }` part of a declaration with its initial variance; [exp]; callers: 1 outside folder
- VariedDeclaration — `NominalDeclaration | TypeAliasDeclaration | TraitDeclaration`; [exp]; callers: 2 outside folder
- DerivedDeclaration — `StructDeclaration | EnumDeclaration | TypeAliasDeclaration | TraitDeclaration`; [exp]; callers: 1 outside folder
- markerVariances — `{ gives: 'covariant', takes: 'contravariant' }` map from `VarianceMarker` to `Variance`; [exp]; callers: 1 outside folder
- varianceOf(declaration, reading: VarianceReading) — computes parameter variances for `declaration`; [exp]; callers: 1 outside folder
- isDerived(declaration: VariedDeclaration) — whether `declaration`'s variance is derived rather than written; [exp]; callers: 1 outside folder
- writtenVariance(declaration: NominalDeclaration, parameter: TypeParameter): Variance — returns `'invariant'` for handles, else `markerVariances`
- solvedVariances(root: DerivedDeclaration, reading: VarianceReading): readonly Variance[] — solves SCCs of derived declarations bottom-up
- settleGroup(solving: Solving, group: readonly Solved[], reading): void — converges `group` from `unused`, promotes remaining `unused` to `covariant`, and reconverges
- converge(solving: Solving, group: readonly Solved[], reading): void — iterates `usagesIn` over `group` until a fixpoint is reached
- unusedIn(group: readonly Solved[]): readonly { solved: Solved; index: number }[] — lists parameters in `group` still at `'unused'`
- occurs(solved: Solved, index: number): boolean — whether parameter `index` occurs anywhere in `solved.parts`
- reach(solving: Solving, declaration: DerivedDeclaration, reading: VarianceReading): void — collects reachable `DerivedDeclaration`s and initializes `usages`
- derivedHeld(type: Type): readonly DerivedDeclaration[] — extracts generic `DerivedDeclaration`s at the top of `type`
- usagesIn(solving: Solving, solved: Solved, reading): Usage[] — runs one `UsageWalk` over `solved.parts` using current `usagesSoFar`
- usagesSoFar(solving: Solving, declaration: VariedDeclaration): readonly Usage[] — returns current `usages` from `solving` or `writtenVariance`
- graphNodesOnce(reached: Set<RecursiveGraph>, graph: RecursiveGraph): readonly Type[] — returns `graph.nodes` the first time `graph` is visited

## src/compiler/checker/types/written/declared-fields.ts — Resolving written field declarations on structs, variants, shapes, and traits
- FieldOwner — `DeclaredStruct | EnumDeclaration | StructType | TraitDeclaration`; [exp]; callers: 1 outside folder
- declaredFieldOf(checker, module, owner, node: Field) — finds `FieldMember` for `node` on `owner`; [exp]; callers: 2 outside folder
- declaredFields(checker, module, fields, resolution?) — resolves `FieldMember`s for `fields`; [exp]; callers: 1 outside folder
- defaultedType(checker: CheckerContext, index: number, defaults?: FunctionDeclaration): Type — reads field `index`'s type from `defaults`'s parameters

## src/compiler/checker/types/written/key-types.ts — Resolving written `keyof S`, `S[K]`, and `{...}` (shape or mapped) types and finding key owners
- keysWritten(written: Written, node: TypeNode, owner: Type): Type — resolves `keyof owner` and reports `noStructKeys`; [exp]; callers: 0 outside folder
- fieldWritten(written: Written, node: IndexedType, owner: Type, key: Type): Type — resolves `owner[key]` and reports `notKeyOf`; [exp]; callers: 0 outside folder
- structWritten(written, node: StructType, resolve) — resolves `{...}` shape or mapped struct type; [exp]; callers: 0 outside folder
- mappedKeysWritten(written: Written, entry: MappedField): Type — validates and returns the key union of a `MappedField`
- isKey(checker: CheckerContext, key: Type): boolean — whether `key` is a string literal, `KeysType`, `Never`, or member parameter
- keysOwner(fitting: Pick<Fitting, 'memberUnionOf'>, type?: Type): Type | undefined — struct type whose keys `type` is (or ranges over); [exp]; callers: 2 outside folder
- givenKeysOwner(fitting, declared: Type, substitution) — `keysOwner` of `declared` under `substitution`; [exp]; callers: 3 outside folder

## src/compiler/checker/types/written/named-paths.ts — Splitting a `NamedType`'s path into its binder-resolved prefix and trailing associated types
- NamedPath — `{ name: Identifier | undefined; entity: Entity | undefined; members: readonly Identifier[] }`; [exp]; callers: 0 outside folder
- namedPathOf(bindings: Bindings, module: ModuleId, node: NamedType): NamedPath — splits `node.path` at the first unresolved identifier; [exp]; callers: 1 outside folder

## src/compiler/checker/types/written/named-types.ts — Resolving type names in value position, static owners, bare variants, and fieldless structs
- Aliases — `Pick<Checker, 'aliasedType' | 'typeRules' | 'wellKnownEntity'>`; [exp]; callers: 0 outside folder
- nominalEntityOf(checker, declaration: NominalDeclaration): NominalEntity — looks up the `NominalEntity` for `declaration`; [exp]; callers: 2 outside folder
- entityType(checker: Aliases, entity?: Entity): Type | undefined — resolves `entity` to a `Type` with `[]` type arguments; [exp]; callers: 3 outside folder
- StaticOwner — `NominalDeclaration | PrimitiveName | ShapeKey | 'T?'` key on which static functions are indexed; [exp]; callers: 5 outside folder
- staticOwnerOf(type?: Type): StaticOwner | undefined — returns the `StaticOwner` for `type`, or `undefined`; [exp]; callers: 2 outside folder
- declaredOwnerOf(checker, module, declaration) — resolves `declaration.owner` to `StaticOwner`; [exp]; callers: 2 outside folder
- Naming — `{ readonly checker: CheckerContext; readonly entityOf: (name: Identifier) => Entity | undefined }`; [exp]; callers: 0 outside folder
- namedType(context: Naming, node: Expression) — resolves `Identifier` or `MemberAccess` expression to the `Type` it names; [exp]; callers: 4 outside folder
- associatedNamed(context: Naming, access: MemberAccess): Type | undefined — resolves `R.Data` in value position via `associatedType`
- nameNodeOf(node: Expression): Identifier | undefined — returns `node` for `Identifier` or `node.member` for `MemberAccess`; [exp]; callers: 2 outside folder
- chooseVariant(context, at, naming, expected?: Type) — resolves qualified or expected-enum bare variant; [exp]; callers: 2 outside folder
- fieldlessStructOf(checker, entity: Entity) — returns `StructDeclaration` if `entity` is a 0-field struct; [exp]; callers: 2 outside folder

## src/compiler/checker/types/written/pattern-types.ts — Resolving types named in patterns, `any` downcast targets, and union member selection
- GenericDeclaration — `NominalDeclaration` alias; [exp]; callers: 1 outside folder
- PatternType — `{ kind: 'type', type } | { kind: 'generic', declaration } | { kind: 'genericAlias', declaration } | { kind: 'none' }`; [exp]; callers: 1 outside folder
- patternTypeOf(checker: Aliases, entity: Entity): PatternType — classifies the type `entity` names in a pattern; [exp]; callers: 6 outside folder
- DowncastTarget — `PatternType | { readonly kind: 'unheld'; readonly type: Type }`; [exp]; callers: 0 outside folder
- downcastTargetOf(checker, entity: Entity, from: AnyType) — checks whether `entity` names a valid downcast target from `from`; [exp]; callers: 3 outside folder
- namesOwnType(checker: Aliases, entity: Entity, type: Type) — whether `entity` names `type` itself (or its generic declaration); [exp]; callers: 6 outside folder
- membersNamed(checker, entity: Entity, members) — union `members` selected by naming `entity`; [exp]; callers: 3 outside folder
- variantOwners(checker, members: readonly Type[], name: string): readonly Type[] — enum members in `members` declaring a variant `name`; [exp]; callers: 3 outside folder
- typeMembers(checker: Aliases, entity: Entity, members: readonly Type[]): readonly Type[] — union `members` selected by a type `entity`
- membersOfType(checker, type: Type, members) — union `members` matching `type` (exact, sub-union, literal base, or `any`); [exp]; callers: 1 outside folder
- instancesWith(members, declaration, typeArguments) — members in `members` instantiating `declaration` with `typeArguments`
- instancesNamed(checker, entity, named, given) — filters `named` union members by `given` type arguments; [exp]; callers: 2 outside folder
- variantEnums(entity: Entity, owners: readonly Type[]): readonly GenericDeclaration[] — enum declarations for `entity` among `owners`; [exp]; callers: 1 outside folder
- instanceOf(type: Type, declaration: GenericDeclaration): readonly Type[] | undefined — type arguments if `type` (or its unfolding) is `declaration`
- literalMembers(members, literal: Type, rules: TypeRules) — union `members` selected by a literal pattern of `literal`; [exp]; callers: 3 outside folder
- PatternKind — `{ kind: 'tuple', count: number } | { kind: 'array' } | { kind: 'shape', fields: readonly string[] }`; [exp]; callers: 0 outside folder
- kindMembers(checker, pattern: PatternKind, members: readonly Type[]): readonly Type[] — union `members` matching structural `pattern`; [exp]; callers: 2 outside folder
- isOfKind(checker, pattern: PatternKind, member: Type): boolean — whether `member` matches structural `pattern` (`tuple`, `array`, or `shape`)

## src/compiler/checker/types/written/resolve-type.ts — Dispatching `TypeNode` syntax to `Type`s, `Fn<...>` sugar, and closing recursive alias groups
- ClosingGroup — `{ aliases: ReadonlySet<TypeAliasDeclaration>; writesUse: (node: TypeNode) => boolean }`; [exp]; callers: 0 outside folder
- resolveTypeNode(checker: CheckerContext, module: ModuleId, node: TypeNode): Type — resolves `node` in `module` via `typeHandlers`; [exp]; callers: 1 outside folder
- resolveClosing(checker, module, node: TypeNode, group) — resolves `node` with `group` aliases as placeholders; [exp]; callers: 1 outside folder
- parameterType(declaration: ParameterKey): Type — constructs `{ kind: 'parameter', declaration }`; [exp]; callers: 18 outside folder
- resolve(resolution: Resolution, node: TypeNode): Type — resolves `node` afresh if `closing.writesUse(node)`, else via `checker.resolveType`
- writtenFunctionType(resolution: Resolution, node: FunctionTypeNode): Type — resolves a `fn(...) -> ...` type node and checks pack/async rules
- packOf(resolution: Resolution, rest: RestType): PackType — resolves `...T` in a function type and reports `restNotPack` if not a pack
- namedType(resolution: Resolution, node: NamedType): Type — resolves a `NamedType` node, its type arguments, `Fn<...>`, and trailing `.Data` members
- associatedAt(resolution: Resolution, owner: Type, name: Identifier): Type — resolves `.name` on `owner` and reports `noAssociatedType`
- typeOfEntity(checker, entity, typeArgumentsOf, byReference?) — maps binder `entity` and `typeArgumentsOf` to `Type`; [exp]; callers: 1 outside folder
- argumentsOf(resolution: Resolution, node: NamedType, declaration): readonly Type[] | undefined — resolves, fills defaults, and notes constraints for `node`
- checkFnArguments(resolution: Resolution, node: NamedType, type: Type): void — reports `fnArgumentsNotTuple` when `Fn`'s first argument is invalid
- isFnType(checker, entity?: Entity): boolean — whether `entity` is the prelude's `wellKnown.fn`
- referenceItems(node: NamedType): readonly boolean[] — boolean mask of which tuple elements in `Fn<( ... ), ...>` are `ReferenceType`
- referent(resolution: Resolution, node: ReferenceType): Type — resolves `&T` to `T` and reports `misplacedReferenceItem` if not on a param or `Fn` tuple

## src/compiler/checker/types/written/type-arguments.ts — Completing written type argument lists with defaults and noting deferred instantiation checks
- ArgumentList — `{ at: AnchoredSpan; declaration: GenericDeclaration; types: readonly Type[]; self?: Type }`; [exp]; callers: 0 outside folder
- typeArgumentsFor(checker, module, list: ArgumentList) — checks count and fills default type arguments; [exp]; callers: 3 outside folder
- defaultArgument(checker, declaration, parameter, earlier) — resolves and substitutes `parameter`'s default type; [exp]; callers: 3 outside folder
- constrainArguments(checker, module, list: ArgumentList) — notes `'meets'` and `'reduces'` checks for `list`; [exp]; callers: 2 outside folder
- noteConstraints(checker, module, list: ArgumentList) — notes `'meets'` checks for constrained parameters in `list`; [exp]; callers: 0 outside folder

## src/compiler/checker/types/written/type-match.ts — Model and helpers for type `match` declarations, unreduced `MatchType` uses, and labels
- TypeMatchForm — `{ parameters, subject, subjectParameter, cases }` resolved form of a type `match`; [exp]; callers: 2 outside folder
- CaseForm — `{ node: TypeCase; pattern: CasePatternForm; variables: readonly InferVariable[] }`; [exp]; callers: 2 outside folder
- CasePatternForm — `{ kind: 'any' } | { kind: 'type', type: Type } | { kind: 'struct', constraint: StructConstraintModel }`; [exp]; callers: 4 outside folder
- InferVariable — `{ parameter: TypeParameter; constraints: ConstraintSet }`; [exp]; callers: 2 outside folder
- TypeMatchQueries — `{ typeMatchOf, caseTypeOf, isEndless, useOf }` checker queries for type `match`es; [exp]; callers: 5 outside folder
- matchUse(declaration: AliasDeclaration, typeArguments: readonly Type[], owner?: NominalEntity): MatchType — constructs `MatchType`; [exp]; callers: 1 outside folder
- labelOf(use: MatchType): RecursiveLabel | undefined — builds `DeclaredAliasUse` or `AssociatedUse` label for `use`; [exp]; callers: 1 outside folder
- aliasInstance(declaration, aliased, substitution, rules) — instantiates or reduces `declaration`; [exp]; callers: 2 outside folder
- structCaseOf(tree: SyntaxTree, node: SyntaxNode) — enclosing struct `TypeCase` and `alias` if `node` is in its body; [exp]; callers: 0 outside folder
- rebuilt(type: Type, rules: TypeRules): Type — recursively rebuilds `type` via `mapChildren` to reduce unreduced computed types; [exp]; callers: 1 outside folder

## src/compiler/checker/types/written/written-matches.ts — Handling type `match` uses, `infer T`, and struct-case subject narrowing when resolving `TypeNode`s
- unreducedUse(written, node: NamedType, entity, argumentsFor) — keeps type `match` alias use unreduced inside a type `match`; [exp]; callers: 0 outside folder
- unreducedAssociated(written, owner: Type, name: Identifier) — keeps type `match` associated type unreduced inside a type `match`; [exp]; callers: 0 outside folder
- asWrittenInMatch(written, node: NamedType, type?: Type) — attaches `meeting` struct constraint to subject parameter in a struct case; [exp]; callers: 0 outside folder
- inCasePattern(written: Written, node: SyntaxNode): boolean — whether `node` is inside a `TypeCase.pattern`; [exp]; callers: 0 outside folder
- inferWritten(written: Written, node: InferType): Type — resolves `infer T` in a case pattern or reports `inferOutsideCase`; [exp]; callers: 0 outside folder

## Concept footprint
- Optional/None: fitting/expected.ts:builtFrom, fitting/fit/index.ts:ownConversion, type/index.ts:UnionType, type/primitives.ts:noneType, type/type-text.ts:unionText, unions/common-type.ts:presentPart, unions/common-type.ts:optionalOver, unions/common-type.ts:withinOptional, unions/common-type.ts:optionalJoin, unions/equality.ts:decidedEquality, unions/inside-optional.ts:insideOptional, unions/unions.ts:optionalOf, unions/unions.ts:optionalInner, unions/unions.ts:presentType, unions/unions.ts:hasOneValue, written/named-types.ts:staticOwnerOf, written/resolve-type.ts:typeHandlers
- unions: fitting/expected.ts:takingUnfolded, fitting/expected.ts:candidatesOf, fitting/fit/index.ts:ownConversion, fitting/fit/index.ts:intoOneMember, fitting/fit/index.ts:memberParameterFit, fitting/fit/index.ts:membersConverted, fitting/fit/index.ts:intoAnyMember, fitting/fit/index.ts:intoMember, fitting/fit/index.ts:ownMember, fitting/fit/index.ts:membersConverting, fitting/fit/index.ts:intoSeveral, fitting/part-pairs.ts:partPairs, identity/recursive-terms.ts:TermGraph.partsOf, identity/recursive-terms.ts:TermGraph.minimize, identity/recursive-terms.ts:TermGraph.canonicalKey, identity/recursive-terms.ts:TermGraph.#canonicalParts, identity/recursive-terms.ts:TermGraph.#flatten, identity/recursive-terms.ts:TermGraph.#membersOf, identity/recursive-terms.ts:TermGraph.#refine, identity/recursive-types.ts:rebuiltFrom, identity/term-signatures.ts:refinedRanks, identity/type-keys.ts:structureKeyOf, identity/type-keys.ts:spelledKindKey, inference/equal.ts:equalUnion, inference/relate.ts:relatedAsIs, inference/relate.ts:intoUnionHolding, inference/relate.ts:fromUnionHolding, inference/relate.ts:intoOneMember, inference/relate.ts:relatedByParts, inference/relate.ts:relatedThroughProposed, parts/type-children.ts:typeChildren, parts/type-children.ts:withListedParts, parts/type-parts.ts:unaliased, parts/type-parts.ts:rebuiltBy, properties/finiteness.ts:holds, properties/held.ts:heldPartsOf, traits/struct-keys.ts:fieldTypeOf, type/index.ts:UnionType, type/index.ts:membersOf, type/type-text.ts:ownerText, type/type-text.ts:unionText, unions/common-type.ts:commonType, unions/union-members.ts:normalizedMembers, unions/union-members.ts:distinctMembers, unions/union-members.ts:mergedLiterals, unions/union-members.ts:absorbingMember, unions/unions.ts:unionOf, unions/unions.ts:memberTypesOf, unions/unions.ts:unionOfNormalized, unions/unions.ts:withoutMembers, unions/unions.ts:hasMember, variance/usage-walk.ts:UsageWalk.walk, written/pattern-types.ts:membersNamed, written/pattern-types.ts:membersOfType, written/pattern-types.ts:literalMembers, written/pattern-types.ts:kindMembers, written/resolve-type.ts:unionTypeOf
- literals & literal widening: fitting/fit/index.ts:isLiteralOf, fitting/fit/index.ts:intoMember, fitting/fit/index.ts:baseMember, identity/type-keys.ts:structureKeyOf, inference/binding.ts:VariableBinding.lower, inference/fillings.ts:fillingOf, inference/fillings.ts:joinedLower, inference/infer.ts:Inference.matchLiteral, inference/infer.ts:Inference.literalType, inference/matching.ts:Written, properties/finiteness.ts:holds, properties/held.ts:heldPartsOf, properties/qualifiers.ts:literalsOf, properties/value-kinds.ts:holdsNoKind, traits/known-constraints.ts:mappedStructConstraint, traits/known-constraints.ts:entryRules, traits/struct-keys.ts:keyName, traits/struct-keys.ts:keysOf, traits/struct-keys.ts:withoutKeys, traits/struct-keys.ts:mappedTypeOf, type/index.ts:LiteralType, type/primitives.ts:literalType, type/type-text.ts:typeText, unions/common-type.ts:joinWidened, unions/common-type.ts:memberBase, unions/equality.ts:comparable, unions/equality.ts:isLiteralLike, unions/equality.ts:decidedEquality, unions/equality.ts:sideLiterals, unions/equality.ts:literalsOf, unions/equality.ts:decidedEqual, unions/union-members.ts:literalBase, unions/union-members.ts:baseOf, unions/union-members.ts:mergedLiterals, unions/unions.ts:hasOneValue, unions/unions.ts:writtenLiteral, unions/unions.ts:literalOrBase, unions/unions.ts:literalsBase, unions/widening.ts:widened, written/key-types.ts:mappedKeysWritten, written/key-types.ts:isKey, written/pattern-types.ts:membersOfType, written/pattern-types.ts:literalMembers, written/resolve-type.ts:typeHandlers
- member parameters (`T in U`, `type Mode in U`): fitting/fit/index.ts:Fitting, fitting/fit/index.ts:memberParameterFit, fitting/fit/index.ts:baseMember, fitting/member-arguments.ts:isOneMember, fitting/member-arguments.ts:standsForMember, identity/type-keys.ts:structureKeyOf, inference/binding.ts:VariableBinding.join, inference/binding.ts:VariableBinding.#filling, inference/binding.ts:VariableBinding.#memberUnionOf, inference/fillings.ts:fillingOf, inference/fillings.ts:joinedLower, inference/infer.ts:Inference.severalMembers, inference/infer.ts:Inference.literalType, inference/notes.ts:MatchNotes, inference/variables.ts:CallVariables, parts/type-children.ts:typeChildren, parts/type-children.ts:withListedParts, parts/type-parts.ts:partsMapped, properties/qualifiers.ts:qualifierParameterOf, traits/data-kind.ts:boundKindsOf, traits/data-kind.ts:mayBeOfKind, traits/known-constraints.ts:keyMembers, traits/member-bounds.ts:associatedMemberUnion, traits/struct-keys.ts:withoutKeys, traits/struct-keys.ts:memberUnionOf, traits/struct-keys.ts:namesMemberParameter, traits/struct-keys.ts:isKeyWithin, traits/struct-keys.ts:fieldTypeOf, type/function-kinds.ts:isOneKind, type/function-kinds.ts:isMarkVariable, type/function-kinds.ts:isBoundTo, type/function-kinds.ts:isMarkParameter, type/function-kinds.ts:standsForOneKind, type/index.ts:TypeParameterType, type/index.ts:namesOneType, type/index.ts:isMemberParameter, type/struct-constraint.ts:AssociatedBounds, unions/common-type.ts:joinWidened, unions/common-type.ts:memberBase, unions/equality.ts:comparableAsMembers, unions/equality.ts:decidedEquality, unions/equality.ts:literalsOf, unions/unions.ts:literalOrBase, variance/variance.ts:reach, written/key-types.ts:mappedKeysWritten, written/key-types.ts:isKey, written/key-types.ts:keysOwner, written/key-types.ts:givenKeysOwner, written/type-arguments.ts:noteConstraints
- enums & variants: fitting/expected.ts:enumsExpected, fitting/part-pairs.ts:fieldPairs, properties/finiteness.ts:holds, properties/handles.ts:identityOf, properties/held.ts:heldPartsOf, properties/value-kinds.ts:writtenPartsOf, variance/variance.ts:isDerived, written/declared-fields.ts:declaredFieldOf, written/declared-fields.ts:declaredFields, written/named-types.ts:chooseVariant, written/named-types.ts:qualifiedHere, written/pattern-types.ts:downcastTargetOf, written/pattern-types.ts:membersNamed, written/pattern-types.ts:variantOwners, written/pattern-types.ts:instancesNamed, written/pattern-types.ts:variantEnums
- structs, anonymous shapes & field order: fitting/expected.ts:expectedNominal, fitting/fit/index.ts:convertedInto, fitting/fit/index.ts:reshapes, fitting/fit/parts.ts:fitsByParts, fitting/fit/parts.ts:fieldsFit, fitting/part-pairs.ts:partPairs, fitting/part-pairs.ts:fieldPairs, identity/type-keys.ts:structureKeyOf, identity/type-keys.ts:shapeKeyOf, identity/type-keys.ts:spelledKindKey, identity/type-keys.ts:spelledFieldKey, inference/binding.ts:VariableBinding.lower, inference/bounds.ts:BoundStore.#agree, inference/equal.ts:equalParts, inference/equal.ts:sameFieldNames, inference/infer.ts:Inference.matchShape, inference/matching.ts:Written, inference/settle.ts:agreesWith, inference/system-reading.ts:takesShape, inference/system-reading.ts:shapeTaking, inference/variable-bounds.ts:isShape, parts/type-children.ts:typeChildren, parts/type-children.ts:withPartsTaken, parts/type-parts.ts:partsMapped, properties/finiteness.ts:holds, properties/handles.ts:identityOf, properties/held.ts:heldPartsOf, properties/value-kinds.ts:writtenPartsOf, traits/known-fields.ts:fieldOf, traits/struct-keys.ts:isStructType, traits/struct-keys.ts:keysOf, traits/struct-keys.ts:namedFieldType, type/field-defaults.ts:declaresDefault, type/field-order.ts:inFieldOrder, type/field-order.ts:laidOut, type/field-order.ts:namedValues, type/index.ts:FieldMember, type/index.ts:AnonymousStructType, type/index.ts:shapeType, type/index.ts:StructValueType, type/type-text.ts:anonymousText, variance/usage-walk.ts:UsageWalk.walk, variance/variance.ts:isDerived, written/declared-fields.ts:declaredFieldOf, written/declared-fields.ts:declaredFields, written/key-types.ts:structWritten, written/named-types.ts:staticOwnerOf, written/named-types.ts:fieldlessStructOf, written/pattern-types.ts:kindMembers, written/pattern-types.ts:isOfKind
- tuples & 1-element tuple conversions: fitting/expected.ts:expectedTuple, fitting/fit/index.ts:retuples, fitting/fit/index.ts:convertedInto, fitting/fit/index.ts:hasParts, fitting/fit/index.ts:singleConversion, fitting/fit/index.ts:singleElement, fitting/fit/index.ts:reshapes, fitting/fit/parts.ts:fitsByParts, fitting/part-pairs.ts:partPairs, identity/type-keys.ts:structureKeyOf, identity/type-keys.ts:spelledKindKey, inference/equal.ts:equalParts, parts/type-children.ts:typeChildren, parts/type-children.ts:withListedParts, parts/type-parts.ts:partsMapped, properties/finiteness.ts:holds, properties/held.ts:heldPartsOf, type/function-types.ts:packed, type/function-types.ts:fnType, type/function-types.ts:fillsPack, type/function-types.ts:restOf, type/index.ts:TupleType, type/primitives.ts:tupleType, type/primitives.ts:tupleElements, type/type-text.ts:typeText, type/type-text.ts:fnParts, variance/usage-walk.ts:UsageWalk.walk, written/pattern-types.ts:isOfKind, written/resolve-type.ts:typeHandlers, written/resolve-type.ts:checkFnArguments, written/resolve-type.ts:referenceItems, written/resolve-type.ts:referent
- variadic type packs (`...P`): identity/type-keys.ts:functionKeyOf, inference/binding.ts:VariableBinding.upper, inference/binding.ts:VariableBinding.equal, inference/fillings.ts:fillingOf, fitting/fit/parts.ts:functionFitsByParts, parts/type-children.ts:typeChildren, parts/type-children.ts:withPartsTaken, parts/type-parts.ts:partsMapped, type/function-types.ts:functionType, type/function-types.ts:packed, type/function-types.ts:fnType, type/function-types.ts:packRestSlot, type/function-types.ts:isPack, type/function-types.ts:fillsPack, type/function-types.ts:takesNothing, type/function-types.ts:sameShape, type/function-types.ts:restOf, type/index.ts:FunctionType, type/index.ts:PackType, type/type-text.ts:functionTypeParts, type/type-text.ts:fnParts, variance/usage-walk.ts:UsageWalk.#function, written/resolve-type.ts:writtenFunctionType, written/resolve-type.ts:packOf, written/resolve-type.ts:checkFnArguments
- `any` trait objects & object safety: fitting/fit/index.ts:convertedInto, fitting/fit/index.ts:intoAnyMember, fitting/fit/index.ts:intoMember, fitting/met-instantiation.ts:MetInstantiation, fitting/met-instantiation.ts:ProposedInstantiation, identity/type-keys.ts:structureKeyOf, identity/type-keys.ts:spelledKindKey, inference/equal.ts:equalParts, inference/equal.ts:equalConstraints, inference/relate.ts:relatedByParts, inference/relate.ts:convertsIntoAny, inference/relate.ts:relatedThroughProposed, parts/substitution.ts:substitute, parts/substitution.ts:substituteAny, parts/type-children.ts:typeChildren, parts/type-children.ts:withPartsTaken, parts/type-children.ts:boundParameters, parts/type-parts.ts:anyTypesIn, parts/type-parts.ts:partsMapped, properties/finiteness.ts:holds, properties/held.ts:heldPartsOf, traits/any-types.ts:resolveAnyType, traits/constraints.ts:resolveAnyConstraints, traits/constraints.ts:traitAsAny, traits/known-constraints.ts:knownConstraints, traits/known-constraints.ts:requirementsNamed, traits/object-safety.ts:objectUnsafety, traits/object-safety.ts:functionUnsafety, traits/sendable.ts:keepsInInstance, type/index.ts:AnyType, type/type-rules.ts:TypeRules, type/type-text.ts:ownerText, type/type-text.ts:typeText, unions/union-members.ts:normalizedMembers, unions/union-members.ts:absorbingMember, unions/unions.ts:presentType, variance/usage-walk.ts:UsageWalk.walk, variance/variance.ts:derivedHeld, written/pattern-types.ts:downcastTargetOf, written/pattern-types.ts:membersOfType, written/pattern-types.ts:literalMembers, written/pattern-types.ts:takenWhole, written/resolve-type.ts:typeHandlers
- traits, witnesses & associated types (`T.Data`, `Self`): identity/type-keys.ts:structureKeyOf, identity/type-keys.ts:unreducedKeyOf, identity/type-keys.ts:aliasKeyOf, inference/equal.ts:givesNothing, inference/relate.ts:relatedAsIs, parts/computed-reduction.ts:reducedComputed, parts/substitution.ts:substitute, parts/substitution.ts:substituteConstraint, parts/substitution.ts:constraintOn, parts/type-children.ts:typeChildren, parts/type-children.ts:withListedParts, parts/type-parts.ts:sameConstraintSpelled, parts/type-parts.ts:partsMapped, properties/value-kinds.ts:ownValueKindsOf, traits/constraint-implication.ts:constraintsImply, traits/constraints.ts:wellKnownConstraint, traits/constraints.ts:resolveConstraint, traits/constraints.ts:requiredFunctions, traits/constraints.ts:requiredFields, traits/constraints.ts:requiredAssociatedTypes, traits/constraints.ts:constraintSubstitution, traits/constraints.ts:declaredFieldType, traits/constraints.ts:requirementType, traits/constraints.ts:requiredFieldType, traits/data-kind.ts:boundKindsOf, traits/data-kind.ts:withKindBound, traits/data-kind.ts:isSimpleKindBound, traits/known-constraints.ts:knownConstraints, traits/known-constraints.ts:structConstraintsOn, traits/known-constraints.ts:requirementsNamed, traits/known-constraints.ts:associatedTypeOf, traits/known-constraints.ts:associatedDeclarationsOn, traits/known-constraints.ts:associatedDeclarationOf, traits/known-constraints.ts:requirementsDeclaring, traits/known-constraints.ts:constraintsDeclaring, traits/known-constraints.ts:selfConstraint, traits/known-constraints.ts:boundsOf, traits/known-fields.ts:fieldOf, traits/member-bounds.ts:associatedMemberUnion, type/alias-uses.ts:AssociatedUse, type/alias-uses.ts:mapAliasUse, type/computed-types.ts:AssociatedOfType, type/computed-types.ts:ownAssociatedType, type/function-kinds.ts:namedMarkOf, type/function-kinds.ts:isBoundTo, type/index.ts:Constraint, type/index.ts:ParameterKey, type/index.ts:namesOneType, type/index.ts:UnreducedUse, type/mark-orders.ts:sameMark, type/type-rules.ts:TypeRules, type/type-text.ts:associatedText, type/type-text.ts:typeText, type/type-text.ts:constraintText, type/type-text.ts:parameterText, type/type-text.ts:spellingText, type/well-known.ts:isWellKnownTrait, variance/usage-walk.ts:UsageWalk.walk, variance/variance.ts:isDerived, variance/variance.ts:derivedHeld, written/declared-fields.ts:declaredFieldOf, written/named-paths.ts:namedPathOf, written/named-types.ts:associatedNamed, written/resolve-type.ts:typeHandlers, written/resolve-type.ts:namedType, written/resolve-type.ts:associatedAt, written/resolve-type.ts:typeOfEntity, written/type-arguments.ts:typeArgumentsFor, written/type-match.ts:labelOf, written/written-matches.ts:unreducedAssociated
- futures, `async` & `Resolver`: fitting/expected.ts:plainResultExpected, fitting/fit/index.ts:convertedInto, fitting/fit/index.ts:reshapes, fitting/fit/index.ts:asyncFitOf, fitting/fit/parts.ts:functionFitsByParts, fitting/part-pairs.ts:resultFitBetween, fitting/part-pairs.ts:functionPairs, identity/identity.ts:isAssignable, identity/identity.ts:neverFutureFits, identity/identity.ts:resultAssignable, type/function-types.ts:AwaitedType, type/function-types.ts:Futures, type/function-types.ts:ResultFit, type/function-types.ts:resultFitOf, type/function-types.ts:sameMode, type/function-types.ts:resolvedInto, type/function-types.ts:madeAsync, type/function-types.ts:headResult, type/type-text.ts:functionTypeParts, type/type-text.ts:ownFutureValue, type/well-known.ts:futureOf, type/well-known.ts:awaitedOf, type/well-known.ts:resolvedThrough, type/well-known.ts:outcomeOf, type/well-known.ts:futuresOf, variance/usage-walk.ts:UsageWalk.#function, written/resolve-type.ts:writtenFunctionType
- marks & data kinds (`simple`, `live`, `ista`, `DataKind`): fitting/fit/index.ts:matchingWith, fitting/fit/parts.ts:functionFitsByParts, fitting/member-arguments.ts:standsForMember, identity/identity.ts:isAssignable, identity/identity.ts:isAssignableInvariantly, identity/identity.ts:neverFutureFits, identity/type-keys.ts:functionKeyOf, inference/binding.ts:VariableBinding.join, inference/bounds.ts:BoundStore.#agree, inference/equal.ts:equalParts, inference/relate.ts:orderedAsIs, inference/settle.ts:settleOne, inference/settle.ts:viewFor, inference/settle.ts:leastAllowed, inference/system-reading.ts:tentativeOf, parts/type-children.ts:typeChildren, parts/type-children.ts:withPartsTaken, parts/type-parts.ts:partsMapped, properties/handles.ts:staysInProcess, properties/qualifiers.ts:qualifierParameterOf, properties/value-kinds.ts:declaredKindsOf, properties/value-kinds.ts:partsDecidedBy, properties/value-kinds.ts:heldKindsOf, properties/value-kinds.ts:composedKindsOf, properties/value-kinds.ts:walkedKindsOf, properties/value-kinds.ts:ownValueKindsOf, traits/constraint-implication.ts:constraintsImply, traits/constraint-implication.ts:marksAllowedBy, traits/constraint-implication.ts:marksOf, traits/constraints.ts:requirementType, traits/data-kind.ts:boundKindsOf, traits/data-kind.ts:mayBeOfKind, traits/data-kind.ts:withKindBound, traits/data-kind.ts:isSimpleKindBound, traits/data-kind.ts:lackedKind, traits/object-safety.ts:functionUnsafety, type/function-kinds.ts:simpleMark, type/function-kinds.ts:isSimpleMark, type/function-kinds.ts:kindAdmits, type/function-kinds.ts:fieldsKindOf, type/function-kinds.ts:persistenceOf, type/function-kinds.ts:writtenKindOf, type/function-kinds.ts:kindOfFunction, type/function-kinds.ts:functionKindOf, type/function-kinds.ts:namedMarkOf, type/function-kinds.ts:kindHolderName, type/function-kinds.ts:isOneKind, type/function-kinds.ts:isMarkVariable, type/function-kinds.ts:isBoundTo, type/function-kinds.ts:isMarkParameter, type/function-kinds.ts:standsForOneKind, type/function-types.ts:modifiersOf, type/function-types.ts:functionFits, type/function-types.ts:sameMode, type/function-types.ts:madeAsync, type/function-types.ts:headResult, type/index.ts:FunctionType, type/mark-orders.ts:QualifierOrder, type/mark-orders.ts:QualifierParameter, type/mark-orders.ts:aboveBottom, type/mark-orders.ts:markOrder, type/mark-orders.ts:sameMark, type/primitives.ts:markType, type/type-text.ts:functionTypeParts, type/type-text.ts:spelledAsFn, type/type-text.ts:fnParts, type/type-text.ts:ownFutureValue, variance/usage-walk.ts:UsageWalk.#function, written/resolve-type.ts:writtenFunctionType
- sendable & sendability (`Sendable`, `sendable fn`, `Sendability`): fitting/fit/parts.ts:functionFitsByParts, identity/identity.ts:isAssignable, identity/identity.ts:isAssignableInvariantly, identity/type-keys.ts:functionKeyOf, inference/binding.ts:VariableBinding.join, inference/bounds.ts:BoundStore.#agree, inference/equal.ts:equalParts, inference/relate.ts:orderedAsIs, inference/settle.ts:viewFor, inference/system-reading.ts:tentativeOf, parts/type-children.ts:typeChildren, parts/type-children.ts:withPartsTaken, parts/type-parts.ts:partsMapped, properties/handles.ts:identityOf, properties/handles.ts:isConfined, properties/qualifiers.ts:qualifierParameterOf, traits/constraint-implication.ts:constraintsImply, traits/constraint-implication.ts:impliesSendable, traits/constraint-implication.ts:marksAllowedBy, traits/sendable.ts:isSendable, traits/sendable.ts:capturedSend, traits/sendable.ts:keepsInInstance, type/function-types.ts:plainSend, type/function-types.ts:sendableSend, type/function-types.ts:sendOf, type/function-types.ts:isSendableFunction, type/function-types.ts:modifiersOf, type/function-types.ts:sendFits, type/function-types.ts:functionFits, type/index.ts:FunctionType, type/mark-orders.ts:sendabilityOrder, type/primitives.ts:sendType, type/type-text.ts:functionTypeParts, type/type-text.ts:spelledAsFn, type/type-text.ts:fnParts, unions/common-type.ts:joinWidened, unions/widening.ts:widened, unions/widening.ts:sendableWidened, variance/usage-walk.ts:UsageWalk.#function, written/resolve-type.ts:writtenFunctionType
- handles, shared structs & extern types: properties/finiteness.ts:holds, properties/handles.ts:identityOf, properties/handles.ts:isConfined, properties/handles.ts:staysInProcess, properties/handles.ts:isHandleDeclaration, properties/handles.ts:isHandleType, properties/held.ts:heldPartsOf, properties/value-kinds.ts:writtenPartsOf, properties/value-kinds.ts:mayOwnKind, properties/value-kinds.ts:ownValueKindsOf, traits/sendable.ts:keepsInInstance, traits/struct-keys.ts:isStructType, type/index.ts:NominalDeclaration, type/index.ts:isNominalEntity, variance/variance.ts:writtenVariance, variance/variance.ts:isDerived, written/declared-fields.ts:declaredFieldOf
- disposal & `@Holds`: properties/handles.ts:isConfined, properties/held.ts:heldPartsOf, properties/value-kinds.ts:mayOwnKind, properties/value-kinds.ts:ownValueKindsOf
- struct constraints, struct keys (`keyof S`, `S[K]`), mapped types & field loops: fitting/fit/index.ts:isLiteralOf, identity/type-keys.ts:structureKeyOf, identity/type-keys.ts:mappedKeyOf, identity/type-keys.ts:spelledKindKey, identity/type-keys.ts:aliasKeyOf, parts/computed-reduction.ts:reducedComputed, parts/computed-reduction.ts:mappedParts, parts/substitution.ts:substitute, parts/substitution.ts:substituteMapped, parts/type-children.ts:typeChildren, parts/type-children.ts:withPartsTaken, parts/type-children.ts:withListedParts, parts/type-children.ts:boundParameters, parts/type-parts.ts:partsMapped, properties/finiteness.ts:holds, properties/held.ts:heldPartsOf, traits/known-constraints.ts:knownConstraints, traits/known-constraints.ts:structConstraintsOn, traits/known-constraints.ts:mappedStructConstraint, traits/known-constraints.ts:fieldRule, traits/known-constraints.ts:associatedDeclarationsOn, traits/known-constraints.ts:keyedFieldTypes, traits/known-constraints.ts:keyMembers, traits/known-constraints.ts:entryRules, traits/known-constraints.ts:commonRules, traits/known-constraints.ts:rulesImply, traits/known-fields.ts:fieldOf, traits/struct-constraints.ts:resolveConstraintSet, traits/struct-constraints.ts:resolveStructConstraint, traits/struct-keys.ts:isStructType, traits/struct-keys.ts:keyName, traits/struct-keys.ts:keysOf, traits/struct-keys.ts:withoutKeys, traits/struct-keys.ts:mappedKeys, traits/struct-keys.ts:memberUnionOf, traits/struct-keys.ts:isKeyWithin, traits/struct-keys.ts:fieldTypeOf, traits/struct-keys.ts:namedFieldType, traits/struct-keys.ts:opaqueFieldType, traits/struct-keys.ts:mappedFieldType, traits/struct-keys.ts:mappedTypeOf, traits/struct-keys.ts:keyOwnerOfValue, traits/struct-keys.ts:recordPatternKeys, type/alias-uses.ts:KeysUse, type/alias-uses.ts:mapAliasUse, type/computed-types.ts:FieldOfType, type/computed-types.ts:KeysType, type/computed-types.ts:MappedType, type/computed-types.ts:formDecidedBy, type/index.ts:ParameterKey, type/index.ts:TypeParameterType, type/struct-constraint.ts:StructConstraintModel, type/struct-constraint.ts:ConstraintSet, type/struct-constraint.ts:EntryRule, type/struct-constraint.ts:substituteStructConstraint, type/struct-constraint.ts:sameStructConstraint, type/struct-constraint.ts:structConstraintText, type/struct-constraint.ts:constraintSetText, type/type-rules.ts:TypeRules, type/type-text.ts:typeText, type/type-text.ts:keysText, type/type-text.ts:mappedText, type/type-text.ts:parameterText, type/type-text.ts:boundName, type/type-text.ts:spellingText, unions/equality.ts:isLiteralLike, unions/equality.ts:literalsOf, unions/union-members.ts:baseOf, unions/unions.ts:literalsBase, written/key-types.ts:keysWritten, written/key-types.ts:fieldWritten, written/key-types.ts:structWritten, written/key-types.ts:mappedKeysWritten, written/key-types.ts:isKey, written/key-types.ts:keysOwner, written/key-types.ts:givenKeysOwner, written/resolve-type.ts:typeHandlers
- recursive aliases & type `match`: fitting/expected.ts:takingUnfolded, fitting/expected.ts:builtFrom, fitting/fit/index.ts:matched, fitting/fit/index.ts:intoOneMember, fitting/fit/index.ts:membersConverting, fitting/fit/parts.ts:fitsByParts, fitting/part-pairs.ts:partPairs, identity/folding.ts:folded, identity/folding.ts:graphsIn, identity/recursive-terms.ts:TermGraph, identity/recursive-terms.ts:canonicalKey, identity/recursive-types.ts:closeRecursive, identity/recursive-types.ts:closedOnce, identity/recursive-types.ts:withTermsReduced, identity/recursive-types.ts:termsOver, identity/recursive-types.ts:reducedOver, identity/recursive-types.ts:GraphNodes, identity/recursive-types.ts:mapRecursive, identity/term-signatures.ts:refinedRanks, identity/type-keys.ts:keyAt, identity/type-keys.ts:termGraphKey, identity/type-keys.ts:keptCanonicalKey, identity/type-keys.ts:preKeyOf, identity/type-keys.ts:structureKeyOf, identity/type-keys.ts:useKeyOf, identity/type-keys.ts:unreducedKeyOf, identity/type-keys.ts:spelledGraph, identity/type-keys.ts:spelledKindKey, identity/unfolding-pairs.ts:UnfoldingPairs, inference/equal.ts:equalTypes, parts/computed-reduction.ts:reducedComputed, parts/type-children.ts:typeChildren, parts/type-children.ts:withPartsTaken, parts/type-children.ts:withListedParts, parts/type-children.ts:graphParts, parts/type-children.ts:graphPlaceOf, parts/type-children.ts:namesNodeOf, parts/type-children.ts:holdsRecursion, parts/type-parts.ts:unaliased, parts/type-parts.ts:rebuiltBy, parts/type-parts.ts:partsMapped, properties/finiteness.ts:fieldReaderOf, properties/finiteness.ts:holds, properties/finiteness.ts:isTargetUse, properties/held.ts:heldPartsOf, properties/value-kinds.ts:heldKindsOf, properties/value-kinds.ts:writtenTypesOf, properties/value-kinds.ts:writtenPartsOf, properties/value-kinds.ts:caseTypesOf, traits/known-constraints.ts:associatedTypeOf, traits/known-fields.ts:fieldOf, traits/sendable.ts:keepsInInstance, type/alias-uses.ts:RecursiveLabel, type/computed-types.ts:MatchType, type/computed-types.ts:RecursiveType, type/computed-types.ts:RecursiveGraph, type/computed-types.ts:unfoldRecursive, type/computed-types.ts:unfolded, type/computed-types.ts:isMatchAlias, type/index.ts:RecursiveUse, type/index.ts:ParameterKey, type/index.ts:TypeParameterType, type/index.ts:UnreducedUse, type/type-rules.ts:TypeRules, type/type-text.ts:unlabelledText, type/type-text.ts:typeText, unions/unions.ts:unionOf, unions/unions.ts:memberTypesOf, unions/unions.ts:presentType, variance/usage-walk.ts:UsageWalk.#recursive, variance/variance.ts:reach, variance/variance.ts:graphNodesOnce, written/named-types.ts:staticOwnerOf, written/pattern-types.ts:membersOfType, written/pattern-types.ts:instanceOf, written/pattern-types.ts:kindMembers, written/resolve-type.ts:resolveClosing, written/resolve-type.ts:namedType, written/resolve-type.ts:typeOfEntity, written/resolve-type.ts:argumentsOf, written/type-arguments.ts:constrainArguments, written/type-match.ts:matchUse, written/type-match.ts:labelOf, written/type-match.ts:aliasInstance, written/type-match.ts:structCaseOf, written/type-match.ts:rebuilt, written/written-matches.ts:unreducedUse, written/written-matches.ts:unreducedAssociated, written/written-matches.ts:asWrittenInMatch, written/written-matches.ts:inCasePattern, written/written-matches.ts:inferWritten
- variance (`gives`, `takes`, derived SCC variance): fitting/fit/index.ts:constraintFits, fitting/fit/parts.ts:fitsByParts, fitting/fit/parts.ts:argumentsFit, fitting/fit/parts.ts:argumentsFitAs, fitting/fit/parts.ts:fitsAs, inference/relate.ts:relatedThroughProposed, variance/lattice.ts:joined, variance/lattice.ts:composed, variance/lattice.ts:flipped, variance/usage-walk.ts:UsageWalk, variance/variance.ts:varianceOf, variance/variance.ts:isDerived, variance/variance.ts:writtenVariance, variance/variance.ts:solvedVariances, variance/variance.ts:settleGroup, variance/variance.ts:converge
- references (`&T`, `_Cell<T>`): fitting/fit/parts.ts:functionFitsByParts, fitting/part-pairs.ts:functionPairs, identity/type-keys.ts:functionKeyOf, inference/binding.ts:VariableBinding.lower, inference/binding.ts:VariableBinding.upper, inference/infer.ts:Inference.matchExactly, inference/infer.ts:Inference.matchReceiver, type/function-types.ts:fnType, type/function-types.ts:sameShape, type/function-types.ts:restOf, type/index.ts:ParameterSlot, type/type-text.ts:slotText, type/well-known.ts:cellTypeOf, variance/usage-walk.ts:UsageWalk.#function, written/resolve-type.ts:writtenFunctionType, written/resolve-type.ts:referenceItems, written/resolve-type.ts:referent
- patterns & rest patterns: identity/type-keys.ts:structureKeyOf, traits/struct-keys.ts:recordPatternKeys, type/computed-types.ts:MappedType, type/index.ts:AnonymousStructType, type/index.ts:ParameterKey, type/type-text.ts:parameterText, type/type-text.ts:boundName, unions/equality.ts:fitEqualSides, unions/equality.ts:decidedEquality, written/named-types.ts:chooseVariant, written/pattern-types.ts:patternTypeOf, written/pattern-types.ts:downcastTargetOf, written/pattern-types.ts:namesOwnType, written/pattern-types.ts:membersNamed, written/pattern-types.ts:variantOwners, written/pattern-types.ts:membersOfType, written/pattern-types.ts:instancesNamed, written/pattern-types.ts:variantEnums, written/pattern-types.ts:literalMembers, written/pattern-types.ts:kindMembers
- deferred calls (`g f(args)`): type/function-types.ts:takesNothing
- field defaults & fields functions: inference/system-reading.ts:takesShape, inference/system-reading.ts:shapeTaking, properties/value-kinds.ts:writtenPartsOf, type/field-defaults.ts:declaresDefault, type/function-kinds.ts:fieldsKindOf, type/function-kinds.ts:functionKindOf, written/declared-fields.ts:declaredFields, written/declared-fields.ts:defaultedType
- JSON codecs (`Encodable`, `Decodable`): traits/constraint-implication.ts:impliesSendable, traits/constraint-implication.ts:sendableTraits



