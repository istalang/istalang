## src/editor/language-service/completion/candidate.ts — completion candidate model (name + subject) before presentation
- Candidate — offered name, Subject, and optional covered flag; [exp]; callers: 15 outside folder
- Subject — discriminated union of what a candidate names (entity, keyword, field, function, variant, literal, argument, etc.); [exp]; callers: 1 outside folder

## src/editor/language-service/completion/cursor.ts — completion cursor state (checked module, offset, trigger, surrounding tokens, std modules)
- Cursor — CheckedModule plus offset, trigger, written name token, preceding token, and importable std module names; [exp]; callers: 18 outside folder
- cursorAt(checked, offset, trigger, stdModules) -> Cursor — builds Cursor with the name token at offset and token before it; [exp]; callers: 0 outside folder
- touchingBefore(cursor) -> Token | undefined — returns cursor.before when it touches cursor's name/offset with no space; [exp]; callers: 3 outside folder
- adjoinsBefore(cursor) -> Token | undefined — returns cursor.before when only inline whitespace separates it from cursor; [exp]; callers: 1 outside folder
- adjoins(tree, token, offset) -> boolean — tests whether only spaces/tabs lie between token.span.end and offset; [exp]; callers: 1 outside folder

## src/editor/language-service/completion/expected.ts — expected type, bare variants, and expected literals at a completion place
- expectedTypeAt(cursor, place) -> Type | undefined — memoized expected type of the value or pattern written at place; [exp]; callers: 2 outside folder
- expectedVariants(cursor, place) -> readonly Candidate[] — bare variants and function-result variant constructors for expected type; [exp]; callers: 1 outside folder
- variantsOf(checker, expected, admits) -> readonly Candidate[] — collects variants of enumsExpected(expected) matching admits; callers: 0 outside folder
- expectedLiterals(cursor, place) -> readonly Candidate[] — non-boolean literal candidates from membersOf(expectedTypeAt); [exp]; callers: 2 outside folder
- isBareVariant(candidate) -> boolean — tests whether candidate is a bare variant entity; [exp]; callers: 2 outside folder
- expecters — Handlers<Cursor, Place, [], Type | undefined> dispatching expected-type lookup by place kind; callers: 0 outside folder
- expectedOfQualified(cursor, place) -> Type | undefined — expected type of a type-qualified value MemberAccess; callers: 0 outside folder
- expectedOfValue(cursor, place) -> Type | undefined — expected type of placeholder or written identifier (or its call parameter); callers: 0 outside folder
- expectedOfString(cursor, place) -> Type | undefined — expected type of StringLiteral at cursor (or its call parameter); callers: 0 outside folder
- parameterGiven(cursor, parsed, value) -> Type | undefined — parameter type when value's holder in chain is Call or NamedArgument; callers: 0 outside folder
- expectedOfPatternStart(cursor, place) -> Type | undefined — matchedTypeOf the pattern started at place; callers: 0 outside folder
- expectedOfWritten(cursor, written) -> Type | undefined — expected type of an already-written identifier in cursor.tree; callers: 0 outside folder
- valueNamedBy(chain, name) -> Expression — struct/variant literal named by name in chain, else name itself; callers: 0 outside folder
- expectedOfPlaceholder(cursor, tree, value) -> Type | undefined — runs tentative checkProgram with tree and reads expectedOf(value); callers: 0 outside folder
- withTree(program, module, tree) -> Program — shallow copy of program replacing module's tree; callers: 0 outside folder

## src/editor/language-service/completion/index.ts — completion entry point coordinating place detection, offer providers, and presentation
- CompletionRequest — optional trigger character and importable stdModules list; [exp]; callers: 0 outside folder
- completionsAt(program, module, offset, request?) -> readonly Completion[] — returns ranked completions at offset in module; [exp]; callers: 1 outside folder
- offers — Handlers<Cursor, Place, [], readonly Candidate[]> mapping each Place kind to its provider; callers: 0 outside folder

## src/editor/language-service/completion/place.ts — completion place union and top-level place dispatcher
- Place — union of MemberPlace, LiteralFieldPlace, ParsedPlace, and NothingPlace; [exp]; callers: 3 outside folder
- PlaceKind — Place['kind'] string literal union; [exp]; callers: 2 outside folder
- placeAt(cursor) -> Place — classifies cursor into comment/nothing, member, literalField, or placeholder-parsed place; [exp]; callers: 0 outside folder

## src/editor/language-service/completion/placeholder.ts — placeholder-parse place classification for non-member, non-literal-field cursors
- PlaceholderParse — tree, root-to-placeholder node chain, and offset from parsing with placeholder inserted; [exp]; callers: 1 outside folder
- ParsedPlace — discriminated union of places carrying PlaceholderParse; [exp]; callers: 11 outside folder
- NothingPlace — `{ kind: 'nothing' }` place where no code completion applies; [exp]; callers: 0 outside folder
- nothingPlace — singleton NothingPlace constant; [exp]; callers: 0 outside folder
- parsedPlaceAt(cursor) -> ParsedPlace | NothingPlace — parses with placeholder and classifies the cursor's place kind; [exp]; callers: 0 outside folder
- kindAt(cursor, parsed) -> ParsedPlaceKind | 'nothing' — determines place kind from placeholder chain and surrounding tokens; callers: 0 outside folder
- placeholderParse(cursor) -> PlaceholderParse — parses with type-cased placeholder after `<` if type argument, else value placeholder; callers: 0 outside folder
- followsTypeArgumentsOpener(cursor) -> boolean — scans tokens on cursor line for `<` touching an identifier; callers: 0 outside folder
- parsedWith(cursor, name, at) -> PlaceholderParse — inserts name at offset, scans/parses incrementally, and returns chain at offset; callers: 0 outside folder
- isTypeArgument(chain) -> boolean — checks whether chain passes through TypeApplication/NamedType.typeArguments; callers: 0 outside folder
- isInComment(cursor) -> boolean — checks whether cursor.offset lies inside any comment span; [exp]; callers: 0 outside folder
- lineOpensWith(cursor, opener) -> boolean — checks whether the last firstOnLine token before cursor on its line has kind opener; callers: 0 outside folder
- followsNew(cursor) -> boolean — checks whether cursor.before is the contextual word `new`; [exp]; callers: 1 outside folder
- roleOf(parsed) -> ParsedPlaceKind | undefined — walks placeholder chain innermost-out calling roleIn; callers: 0 outside folder
- roleIn(link) -> ParsedPlaceKind | undefined — classifies link by declaresName, isWrittenType/builtNameRole, or roles table; callers: 0 outside folder
- builtNameRole(link) -> ParsedPlaceKind | undefined — classifies type node naming a struct literal or tested struct/call pattern; callers: 0 outside folder
- isTested(parsed, pattern) -> boolean — checks whether pattern is owned by MatchCase or Is rather than a target owner; callers: 0 outside folder
- roles — partial node-kind table mapping enclosing AST nodes to ParsedPlaceKind; callers: 0 outside folder
- argumentRole(call, child) -> ParsedPlaceKind | undefined — returns 'grammar' for `hold(...)` label, 'callArgument' for other call arguments; callers: 0 outside folder
- caseRole(link) -> ParsedPlaceKind | undefined — classifies MatchCase pattern, guard, or uncolon'd arm; callers: 0 outside folder
- opensTypeArguments(parsed, node) -> boolean — checks whether Binary `<` touches its left operand; callers: 0 outside folder
- declaresName(node, child) -> boolean — checks whether child is the declared name (or static owner) of node; callers: 0 outside folder

## src/editor/language-service/completion/places/annotation.ts — completion provider for `@` annotations
- offerAnnotation(cursor, place) -> readonly Candidate[] — offers annotation structs (or `@Waypoint` on waiting statements) after `@`; [exp]; callers: 1 outside folder
- annotationNames(cursor, parsed) -> readonly Candidate[] — filters visible entities to namespaces and valid annotation structs for target item; callers: 0 outside folder
- waypointOrStruct(statement) -> 'struct' | 'waypoint' | 'nothing' — whether a block statement takes `@Waypoint`, any struct, or nothing; callers: 0 outside folder
- isMisplaced(cursor, parsed) -> boolean — checks whether parser reported misplacedAnnotation at `@`; callers: 0 outside folder
- isCutShort(parsed, item, annotation) -> boolean — checks whether item has a Missing node before annotation; callers: 0 outside folder

## src/editor/language-service/completion/places/call-argument.ts — completion provider for call arguments and named-argument labels
- offerCallArgument(cursor, place) -> readonly Candidate[] — offers ungiven parameter labels, `...` for rest, and expression candidates; [exp]; callers: 1 outside folder
- argumentNames(checker, at, callees) -> readonly Candidate[] — builds `name:` argument candidates for ungiven parameters of callees; callers: 0 outside folder
- ungiven(checker, at, callee) -> readonly SignatureParameter[] — parameters of callee not yet given by other arguments (excluding `self`); callers: 0 outside folder

## src/editor/language-service/completion/places/declared-name.ts — completion provider at declaration name positions
- offerDeclaredName(cursor, place) -> readonly Candidate[] — offers head followers, static owners, `self`, or member keywords; [exp]; callers: 1 outside folder
- namesOwner(declaration, name) -> boolean — checks whether name is in static owner position of FunctionDeclaration; callers: 0 outside folder
- headWordsAfter(cursor) -> readonly Word[] | undefined — modifier followers in function or externStruct head forms; callers: 0 outside folder
- mayTakeSelf(declaration, holder) -> boolean — checks whether function is top-level or trait member without static owner; callers: 0 outside folder
- memberWords(member, holder) -> readonly Word[] — keywords (`type`, requirement head starts) that may start a struct/enum/trait member; callers: 0 outside folder
- staticOwners(cursor, holder) -> readonly Candidate[] — visible types admitting static functions in Module, or `Self` in TraitDeclaration; callers: 0 outside folder

## src/editor/language-service/completion/places/grammar/chain.ts — parent lookup in a root-to-leaf node chain
- holderIn(chain, node) -> SyntaxNode | undefined — returns the element immediately preceding node in chain; [exp]; callers: 4 outside folder

## src/editor/language-service/completion/places/grammar/expression.ts — operand and expression start candidates
- expressionCandidates(cursor, place) -> readonly Candidate[] — offers operand candidates in the surroundings of place; [exp]; callers: 1 outside folder
- operandCandidates(cursor, place, surroundings) -> readonly Candidate[] — operandNames, expectedVariants, expectedLiterals, and words; [exp]; callers: 0 outside folder
- operandNames(cursor) -> readonly Candidate[] — visible non-trait, non-bare-variant value/type/namespace names; [exp]; callers: 0 outside folder

## src/editor/language-service/completion/places/grammar/index.ts — grammar-place completion dispatcher
- offerGrammar(cursor, place) -> readonly Candidate[] — dispatches on grammarPositionAt for words, statements, operands, `&`, or labels; [exp]; callers: 1 outside folder
- byPosition — Handlers<Cursor, GrammarPosition, [GrammarPlace], readonly Candidate[]> for each GrammarPosition kind; callers: 0 outside folder
- isChangeable(entity) -> boolean — checks whether entity is a mutable VariableDeclaration or `&T`-typed Parameter; callers: 0 outside folder

## src/editor/language-service/completion/places/grammar/item-starts.ts — detecting whether a cursor or token starts a module/block/trait item
- startsItem(cursor) -> boolean — checks whether cursor is at line start or after `;`, `:`, `{`; [exp]; callers: 0 outside folder
- opens(tree, before, at) -> boolean — checks whether before is undefined, in `;`/`:`/`{`, or separated by newline from at; callers: 0 outside folder
- startsItemOf(holder, tree, word) -> boolean — checks whether word is the first non-annotation token of an item in holder; [exp]; callers: 0 outside folder
- ownStartOf(tree, item) -> number | undefined — start offset of item's first code token outside its annotations; callers: 0 outside folder
- itemStartedBy(parsed, name) -> { block, node } | undefined — outermost node in Block whose ownStartOf matches name's start; [exp]; callers: 0 outside folder

## src/editor/language-service/completion/places/grammar/position.ts — grammar position classification within a `grammar` place
- GrammarPosition — union of words, deferredCall, statement, operand, referenced, and labels positions; [exp]; callers: 0 outside folder
- grammarPositionAt(cursor, place) -> GrammarPosition — determines the GrammarPosition at cursor from tokens and placeholder parse; [exp]; callers: 0 outside folder
- positionAfter(cursor, parsed, parent, node) -> GrammarPosition | undefined — position dictated by preceding modifier, loop target, or operand; callers: 0 outside folder
- startsDeferredCall(parsed, name) -> boolean — checks whether chain contains a DeferredCall whose call starts at name; callers: 0 outside folder
- heldIn(parsed, parent, node, surroundings) -> GrammarPosition — classifies Break/Continue/hold labels, `&` arguments, or general operands; callers: 0 outside folder
- unplacedIn(cursor, parsed, unplaced, surroundings) -> GrammarPosition — classifies an Invalid node inside Match, Select, Module, or Block; callers: 0 outside folder
- modifierBefore(cursor, parsed) -> { text, word } | undefined — returns modifier before cursor when standsAsModifier holds; callers: 0 outside folder
- standsAsModifier — Record<Modifier, (tree, word) => boolean> testing whether a modifier token stands in modifier position; callers: 0 outside folder
- startsHead(tree, word) -> boolean — checks whether word starts a declaration/trait/block item, type, deferred taker, or follows a modifier; callers: 0 outside folder
- takesAlone(tree, word) -> boolean — checks whether word is the identifier taker of a DeferredCall; callers: 0 outside folder
- heldLabelOf(tree, closing) -> Token | undefined — finds the `hold` token of `hold(label)` when closing is its `)`; callers: 0 outside folder
- goingOn(cursor) -> readonly Word[] — infixWords plus `by` after stepless Range and `as` after SelectCase.future; callers: 0 outside folder
- continuesIf(tree, block, item) -> boolean — checks whether previous statement in Block ends in an If with no elseClause; callers: 0 outside folder
- endsInOpenIf(tree, node) -> boolean — walks last children outside Blocks to test for an If without elseClause; callers: 0 outside folder
- writesIn(parsed, loop) -> boolean — checks whether an `in` token already appears in loop before cursor; callers: 0 outside folder

## src/editor/language-service/completion/places/grammar/surroundings.ts — enclosing function body kind (`none` | `sync` | `async`) and labelled scopes
- Surroundings — `{ body: 'none' | 'sync' | 'async', scopes: readonly LabelledScope[] }`; [exp]; callers: 0 outside folder
- surroundingsOf(tree, chain) -> Surroundings — walks chain to innermost function/constant/default and collects labelled scopes; [exp]; callers: 0 outside folder

## src/editor/language-service/completion/places/grammar/words.ts — filtering grammar-position keywords by surroundings (`await`, `select`, `new`, `break`, `continue`)
- wordNeeds — Partial<Record<Word, Need>> gating `select`, `new`, `await`, `break`, `continue` on Surroundings; [exp]; callers: 0 outside folder
- operandWordsIn(surroundings) -> readonly Word[] — operandWords filtered by wordNeeds; [exp]; callers: 0 outside folder
- statementWordsIn(surroundings) -> readonly Word[] — statement-only words filtered by wordNeeds; [exp]; callers: 0 outside folder
- ifClauseWords — `['elif', 'else']`; [exp]; callers: 0 outside folder
- wordCandidates(words) -> readonly Candidate[] — wraps word strings as `{ kind: 'keyword' }` Candidates; [exp]; callers: 3 outside folder

## src/editor/language-service/completion/places/imports/import.ts — completion provider inside `import` declarations
- offerImport(cursor, place) -> readonly Candidate[] — offers module paths, unimported exports of target module, `as`, or `from`; [exp]; callers: 1 outside folder
- startsName(cursor, statement, before) -> boolean — checks whether cursor is at a position starting an imported name; callers: 0 outside folder
- awaitsFrom(cursor, last) -> boolean — checks whether last ends the import's names and no `from` follows on the line; callers: 0 outside folder
- endsNames(tokens, start, at) -> boolean — checks whether tokens[at] is a name after `import`/`,`/`as`/`(` or closing `)` of import; callers: 0 outside folder
- importable(cursor, start) -> readonly Candidate[] — exports of the module loaded by the import at start not yet imported by name; callers: 0 outside folder

## src/editor/language-service/completion/places/imports/module-paths.ts — module and folder path segment completion for import specifiers
- modulePathsAt(cursor, written) -> readonly Candidate[] — offers std module names (except `testing`) and project module/folder segments; [exp]; callers: 0 outside folder
- folderOf(text, importer) -> readonly string[] | undefined — resolves relative climbs (`importPathOf`) against importer's folder; callers: 0 outside folder
- projectPaths(program, importer) -> readonly (readonly string[])[] — split canonical names of non-std modules other than importer; callers: 0 outside folder

## src/editor/language-service/completion/places/literal-field.ts — place detection and completion for struct/shared-struct literal fields and indented values
- LiteralFieldPlace — `{ kind: 'literalField', literal, item, opens }`; [exp]; callers: 1 outside folder
- literalFieldPlaceAt(cursor) -> LiteralFieldPlace | undefined — detects struct literal or indented value field position in tree; [exp]; callers: 1 outside folder
- indentedEntryPlaceAt(tree, before, start) -> LiteralFieldPlace | undefined — detects entry start on a new line at an IndentedValue's column; callers: 0 outside folder
- literalWithItemBefore(tree, before, start) -> FieldsLiteral | undefined — detects item start on a new line after a previous braced item; callers: 0 outside folder
- offerLiteralFields(cursor, place) -> readonly Candidate[] — offers ungiven struct fields (shorthands, `...`, values) or map keys; [exp]; callers: 1 outside folder
- mapKeys(type, others) -> readonly Candidate[] — offers ungiven String literal keys from an indented map's key type; callers: 0 outside folder
- literalItems(cursor, slot) -> readonly Candidate[] — builds shorthand, field, `...` spread, and single-field value candidates; callers: 0 outside folder
- shorthandFor(visible, name) -> readonly Candidate[] — filters visible candidates to a variable matching field name; callers: 0 outside folder

## src/editor/language-service/completion/places/member.ts — place detection and completion after `.`, `?.`, `->`, `?->` and qualified names
- MemberPlace — `{ kind: 'member', head, owner?, access, names: 'value' | 'type' | 'variant' }`; [exp]; callers: 2 outside folder
- namedBy(tree, holder) -> 'type' | 'variant' — returns 'variant' for NamePattern or VariantCallPattern.callee, else 'type'; callers: 0 outside folder
- memberPlaceAt(cursor) -> MemberPlace | undefined — detects member access or qualified path/member-type position at cursor; [exp]; callers: 1 outside folder
- memberPlaceOf(tree, node, offset) -> MemberPlace | undefined — checks MemberAccess, NamedType, NamePattern, or MemberType at offset; callers: 0 outside folder
- offerMembers(cursor, place) -> readonly Candidate[] — offers associated types, namespace exports, statics/variants, or value members; [exp]; callers: 1 outside folder
- exportsNaming(checker, namespace, names) -> readonly Candidate[] — exports of namespace's module filtered to types when names !== 'value'; callers: 0 outside folder
- typeMembers(checker, module, type, names) -> readonly Candidate[] — associated types, variants, and (when names === 'value') statics of type; callers: 0 outside folder
- valueMembers(checker, module, tree, access) -> readonly Candidate[] — fields and callable methods of access's target (or optional chain link); callers: 0 outside folder
- linkOf(tree, access) -> Expression — returns enclosing Call if it shares access's optional chain step, else access; callers: 0 outside folder
- functionsThrough(through, functions) -> readonly Candidate[] — deduplicates FunctionDeclarations by name into function Candidates; callers: 0 outside folder

## src/editor/language-service/completion/places/patterns/matched-type.ts — deriving matched types and struct/variant fields for patterns in placeholder parses
- patternStartedBy(chain, holder) -> HeadedPattern | undefined — NamePattern or StructPattern/VariantCallPattern headed by holder; [exp]; callers: 1 outside folder
- matchedTypeOf(cursor, parsed, pattern) -> Type | undefined — walks chain from MatchCase/Is/Parameter to pattern for matched type; [exp]; callers: 1 outside folder
- fieldsMatchedBy(cursor, parsed, pattern) -> readonly FieldMember[] — fields of the struct or variant matched by pattern; [exp]; callers: 0 outside folder
- fieldsOf(cursor, parsed, pattern, type) -> readonly FieldMember[] — resolves downcast/union selection and returns struct or variant fields; callers: 0 outside folder
- memberSelected(cursor, parsed, pattern, type) -> Type | undefined — narrows union type to the single member selected by TakingPattern; callers: 0 outside folder
- membersSelected(cursor, parsed, pattern, members) -> readonly Type[] — selects union members by tuple/array/shape kind or named type/variant; callers: 0 outside folder
- membersNamedBy(cursor, parsed, named, members) -> readonly Type[] — selects union members named by NamedType and its typeArguments; callers: 0 outside folder
- variantFieldsOf(checker, own, info) -> readonly FieldMember[] — fields of variant on nominal enum type own when chosen by name or denoted; callers: 0 outside folder
- denotationOf(cursor, parsed, name) -> Denotation | undefined — looks up denotation of name's checkedTwinOf in cursor.tree; callers: 0 outside folder
- entityNamed(cursor, parsed, name) -> Entity | undefined — looks up binder entity of name's checkedTwinOf in cursor.tree; callers: 0 outside folder
- downcastOf(cursor, parsed, pattern, from) -> Type | undefined — resolves downcast target type of pattern head against AnyType from; callers: 0 outside folder
- subjectType(link, subject) -> Type | undefined — expression type of subject's checkedTwinOf in cursor.tree; callers: 0 outside folder
- parameterTypeAt(link) -> Type | undefined — parameter type at cursor offset in FunctionDeclaration or Lambda (joined across passes); callers: 0 outside folder
- steps — partial node-kind table stepping matched Type from parent node to child pattern; callers: 0 outside folder
- checkedTwinOf(cursor, parsed, node) -> Node | undefined — finds node of same kind and extent in cursor.tree when ending before cursor.offset; callers: 0 outside folder

## src/editor/language-service/completion/places/patterns/pattern-field.ts — completion provider for struct pattern field names
- offerPatternFields(cursor, place) -> readonly Candidate[] — offers untaken fields of the struct matched by enclosing StructPattern; [exp]; callers: 1 outside folder

## src/editor/language-service/completion/places/patterns/pattern.ts — completion provider for `case` and `is` patterns
- offerPattern(cursor, place) -> readonly Candidate[] — offers call-pattern field labels, pattern starts, `as`/`is`, or `if`/`as`; [exp]; callers: 1 outside folder
- patternStarts(cursor, place, pattern) -> readonly Candidate[] — offers field labels, variants (marking covered), referring names, words; callers: 0 outside folder
- fieldLabels(cursor, parsed, argument) -> { names, namedOnward } — ungiven `field:` labels and named-onward flag for VariantCallPattern; callers: 0 outside folder
- mayRefer(checker, entity, type) -> boolean — checks whether entity is namespace, own type, union-selecting type, or downcast target; callers: 0 outside folder
- variantsCovered(parsed, pattern, fieldsOf) -> ReadonlySet<string> — variant names already matched whole by unguarded cases of enclosing Match; callers: 0 outside folder
- variantsTakenWhole(pattern, fieldsOf) -> readonly string[] — recursively collects variant names matched unconditionally by pattern; callers: 0 outside folder
- argumentBindsOnly(argument) -> boolean — checks whether a call-pattern argument binds any value without testing; callers: 0 outside folder
- followsFieldName(cursor, parsed, pattern, item) -> boolean — checks whether cursor follows a bare field name in a StructPattern; callers: 0 outside folder
- followsWholePattern(cursor, parsed) -> boolean — checks whether cursor follows a complete MatchCase pattern after whitespace; callers: 0 outside folder
- isWhole(pattern) -> boolean — checks whether pattern is non-Missing/Invalid and not an unended RangePattern; callers: 0 outside folder

## src/editor/language-service/completion/places/string-text.ts — completion provider inside String literals
- offerStringText(cursor, place) -> readonly Candidate[] — offers unquoted string values from expectedLiterals(cursor, place); [exp]; callers: 1 outside folder

## src/editor/language-service/completion/places/type.ts — completion provider at type positions
- offerType(cursor, place) -> readonly Candidate[] — offers shared structs after `new`, traits in bounds/`any`, or types and typeWords; [exp]; callers: 1 outside folder
- offeredTypeWords(parsed) -> readonly TypeWord[] — typeWords excluding `struct`, and `infer` except inside a type-match pattern; callers: 0 outside folder
- asksForTrait(chain) -> boolean — checks whether type is inside AnyType or TypeParameter/RequiredAssociatedType/FieldConstraintEntry; callers: 0 outside folder

## src/editor/language-service/completion/presentation/entity-items.ts — presenting scope-offered binder entities as completion items
- shownEntity(presenting, entity, name) -> Shown — computes RankGroup and dispatches to entityItems for presentation details; [exp]; callers: 0 outside folder
- groupOf(checker, module, entity) -> RankGroup — classifies entity origin into 'local', 'module', 'imported', or 'prelude'; [exp]; callers: 0 outside folder
- typeKinds — Record mapping each TypeEntity declaration kind to `[CompletionKind, detail]`; callers: 0 outside folder
- entityItems — Handlers<Presenting, Entity, [name: string], Shown> formatting each Entity variant; callers: 0 outside folder
- variableKind(checker, entity) -> CompletionKind — 'function' for local fn/lambda, 'constant' for top/extern/context const, else 'variable'; callers: 0 outside folder
- variableType(checker, entity) -> Type | undefined — looks up variable's type via denotationsOf in its declaring module; callers: 0 outside folder

## src/editor/language-service/completion/presentation/item.ts — protocol-independent completion item and ranking model
- CompletionKind — union of 15 completion item kinds; [exp]; callers: 1 outside folder
- Completion — protocol-independent completion item with name, kind, detail, doc, insert, next, rank, preselect, commit; [exp]; callers: 2 outside folder
- Insertion — plain text or snippet insertion; [exp]; callers: 1 outside folder
- FollowUp — `'completion' | 'signatureHelp'` follow-up action; [exp]; callers: 1 outside folder
- Rank — `{ fitsExpected, group?, priority?, order? }`; [exp]; callers: 1 outside folder
- rankGroups — `['local', 'module', 'imported', 'prelude', 'keyword']`; [exp]; callers: 0 outside folder
- RankGroup — element type of rankGroups; [exp]; callers: 0 outside folder
- lowestPriority — `999` cap for priority and order; [exp]; callers: 1 outside folder
- rankKeys(rank) -> readonly number[] — numeric tuple `[fit, group, priority, order]` for sorting; [exp]; callers: 1 outside folder
- ranksBefore(a, b) -> boolean — lexicographic comparison by rankKeys then item name; [exp]; callers: 0 outside folder

## src/editor/language-service/completion/presentation/present.ts — turning Candidates into ranked, preselected Completions
- present(cursor, place, candidates) -> readonly Completion[] — presents each candidate by Subject, ranks, and marks preselected item; [exp]; callers: 1 outside folder
- presenters — Handlers<Presenting, Subject, [name: string], Shown> formatting each Subject kind; callers: 0 outside folder
- labelled(presenting, name, labelledText) -> Partial<Shown> — inserts name alone when `:` follows on line, else labelledText + completion; callers: 0 outside folder
- withFirstPreselected(items) -> readonly Completion[] — marks the highest-ranked fitting item in local/module/ungrouped with preselect: true; callers: 0 outside folder

## src/editor/language-service/completion/presentation/presenting.ts — shared presentation helpers for call/constructor insertion and function-value fitting
- Presenting — request context for presenters (cursor, place, writesValue, follows token kind, expected type); [exp]; callers: 0 outside folder
- Shown — presenter output before name, rank, and preselect are attached; [exp]; callers: 0 outside folder
- presentingAt(cursor, place) -> Presenting — builds Presenting with next token on line and expectedTypeAt; [exp]; callers: 0 outside folder
- fitsExpected(presenting, found) -> boolean — checks whether non-error, non-Never found type fits presenting.expected; [exp]; callers: 0 outside folder
- givenAsValue(presenting, fn) -> readonly Type[] — returns `[expected]` when function/constructor binds and fits expected FunctionType; callers: 0 outside folder
- functionGivenAsValue(presenting, declaration) -> readonly Type[] — givenAsValue for a non-generic, non-method FunctionDeclaration; [exp]; callers: 0 outside folder
- variantGivenAsValue(presenting, variant, enumType) -> readonly Type[] — givenAsValue for a variant with fields as its enum constructor; [exp]; callers: 0 outside folder
- constructorOf(variant, enumType) -> FieldsFunction | undefined — finds Variant node on EnumDeclaration and returns fieldsFunctionOf; callers: 0 outside folder
- called(presenting, name) -> Partial<Shown> — inserts `${name}($0)` snippet with follow-up when writesValue and `(` doesn't follow; [exp]; callers: 0 outside folder
- calledOrNamed(presenting, name, results) -> Partial<Shown> — inserts name when expected is FunctionType no result fits, else called; [exp]; callers: 0 outside folder
- constructed(presenting, name, options) -> Partial<Shown> — calls calledOrNamed when variant hasFields and `{` doesn't follow; [exp]; callers: 0 outside folder
- annotationValue(presenting, name, hasFields) -> Partial<Shown> — inserts `${name}{$0}` when struct has fields and `{` doesn't follow; [exp]; callers: 0 outside folder
- documented(doc) -> Pick<Shown, 'documentation'> — wraps optional docstring into `{ documentation }`; [exp]; callers: 0 outside folder

## src/editor/language-service/completion/triggers.ts — trigger characters and fast token/place gating for auto-opened completion
- PlaceTest — `(place: Place) => boolean` predicate; [exp]; callers: 0 outside folder
- startsPatternArgument(place) -> boolean — checks whether pattern place is a positional NamePattern inside VariantCallPattern; callers: 0 outside folder
- startsLabelledValue(place) -> boolean — checks whether place is the value of a FieldInitializer, NamedArgument, or NamedPatternArgument; callers: 0 outside folder
- completionTriggers — `['.', '>', '{', ',', ' ', '@', "'", '"', '/']`; [exp]; callers: 1 outside folder
- placesOpenedAt(cursor) -> PlaceTest | undefined — returns PlaceTest for cursor.trigger (or anyPlace when invoked explicitly); [exp]; callers: 0 outside folder

## src/editor/language-service/completion/visible.ts — visible scope names and fallback keyword candidates at cursor
- visibleNames(cursor, keeps?) -> readonly Candidate[] — wraps Bindings.visibleAt(module, start) entities matching keeps as Candidates; [exp]; callers: 5 outside folder
- visibleCandidates(cursor) -> readonly Candidate[] — visibleNames(cursor) followed by all reserved keywords; [exp]; callers: 2 outside folder

## src/editor/language-service/edit.bench.ts — vitest benchmark measuring incremental edit-to-diagnostics latency on Workspace
- workspace() -> Workspace — creates single-module test Workspace over stdlibLoader; callers: 0 outside folder
- repeated(text, times) -> string — duplicates and renames top-level declarations in text `times` times; callers: 0 outside folder

## src/editor/language-service/hover.ts — hover query for names, key literals, call-pattern positional arguments, expressions, and written types
- Hover — `{ span, code: readonly string[], doc: string | undefined }`; [exp]; callers: 0 outside folder
- hoverAt(program, module, offset) -> Hover | undefined — computes hover at offset in module; [exp]; callers: 1 outside folder
- innermostHover(checked, nodes) -> Hover | undefined — returns first defined nodeHover from innermost to root; callers: 0 outside folder
- positionalArgumentOf(chain) -> PositionalArgument | undefined — finds innermost VariantCallPattern positional argument in chain; callers: 0 outside folder
- argumentHover(checked, position) -> Hover | undefined — prepends variant field given by a positional call-pattern argument to its hover; callers: 0 outside folder
- shownText(checker, type) -> string — formats type with writtenAndNamedText plus `is ...` trait bounds when opaque; callers: 0 outside folder
- shownAs(node) -> SyntaxNode | undefined — unwraps `->` Dereference to undefined and DeferredCall to node.call; [exp]; callers: 0 outside folder
- nodeHover(checked, node) -> Hover | undefined — computes nameHover or expression/type hover for node after shownAs; callers: 0 outside folder
- nameHover(checked, name) -> Hover | undefined — formats denotations and first docstring of an Identifier or key StringLiteral; callers: 0 outside folder
- typeAt(checked, node) -> Type | undefined — looks up expression type in bodyHolding or written type via typeOfNode; callers: 0 outside folder
- denotationLines(checker, name, denotation) -> readonly string[] — formats Denotation as code lines (signature, constructor, type, module); callers: 0 outside folder

## src/editor/language-service/inlay-hints.ts — inline `: Type` hints for untyped variables, loop bindings, and lambda parameters
- InlayHint — `{ offset: number, label: string }`; [exp]; callers: 0 outside folder
- inlayHintsIn(program, module, span) -> readonly InlayHint[] — returns type hints for untyped declarations within span; [exp]; callers: 1 outside folder
- untypedNames(tree, node, span) -> readonly Identifier[] — recursively collects untyped declared identifiers overlapping span; callers: 0 outside folder
- ownUntypedNames(node) -> readonly Identifier[] — untyped identifiers from VariableDeclaration, ContextConstant, For, FieldHeader, Lambda; callers: 0 outside folder

## src/editor/language-service/navigation/declarations.ts — resolving the name or key literal at an offset to its declaring names and targets
- WrittenName — `Identifier | StringLiteral` union; [exp]; callers: 0 outside folder
- spelledName(name) -> string — returns `name.text` for Identifier or `name.value` for StringLiteral; [exp]; callers: 1 outside folder
- NamePlace — `{ module: ModuleId, name: WrittenName }`; [exp]; callers: 0 outside folder
- DeclaredAt — `{ declared: Denotation['declared'], at: NamePlace }`; [exp]; callers: 0 outside folder
- declarationsOf(checker, module, name) -> readonly DeclaredAt[] — maps denotationsOf/keyDenotationsOf to deduplicated DeclaredAt places; callers: 0 outside folder
- actedOnBy(checker, module, name) -> readonly DeclaredAt[] — replaces non-field declaring places with import alias for renamed imports; [exp]; callers: 0 outside folder
- isSamePlace(first, second) -> boolean — checks whether two NamePlaces are in the same module and startTogether; [exp]; callers: 0 outside folder
- spanOfUse(program, place) -> Span — converts a NamePlace's anchored span to text Span in its module's tree; [exp]; callers: 0 outside folder
- NameAt — `{ name: WrittenName, declarations: readonly DeclaredAt[], targets: readonly DeclaredAt[] }`; [exp]; callers: 0 outside folder
- nameAt(program, module, offset) -> NameAt | undefined — resolves identifier or key literal at offset to declarations and targets; [exp]; callers: 1 outside folder
- declaringNames — Handlers<Checker, Declared, [], NamePlace | undefined> finding the declaring Identifier of each Declared variant; callers: 0 outside folder

## src/editor/language-service/navigation/references.ts — program-wide reference index and find-references query
- Reference — NamePlace plus `declares: boolean`; [exp]; callers: 0 outside folder
- namesDenoting(program, declaring) -> readonly NamePlace[] — memoized lookup of all NamePlaces in program acting on declaring; [exp]; callers: 0 outside folder
- referencesAt(program, module, offset) -> readonly Reference[] — deduplicated references to targets of nameAt(program, module, offset); [exp]; callers: 1 outside folder
- indexOf(program) -> ReadonlyMap<PlaceKey, readonly NamePlace[]> — indexes all modules' identifiers and key/annotation StringLiterals; callers: 0 outside folder
- isName(program, module, tree, node) -> node is WrittenName — accepts Identifiers and non-std (or std-annotation) StringLiterals; callers: 0 outside folder

## src/editor/language-service/navigation/rename.ts — prepare-rename validation, refusal rules, and rename edit generation
- Renaming — `{ kind: 'renamable', name, target } | Refusal`; [exp]; callers: 0 outside folder
- Refusal — `{ kind: 'refused', reason: string }`; [exp]; callers: 1 outside folder
- Renamed — `{ kind: 'renamed', edits: readonly NameEdit[] }`; [exp]; callers: 0 outside folder
- NameEdit — `{ module: ModuleId, span: Span, text: string }`; [exp]; callers: 1 outside folder
- renamingAt(program, module, offset) -> Renaming | undefined — checks whether the name at offset can be renamed or returns a Refusal; [exp]; callers: 1 outside folder
- asDeclared(program, target) -> DeclaredAt — re-resolves target at its own declaring offset so OwnCall variables are judged as their function; callers: 0 outside folder
- renameEdits(program, module, offset, newName) -> Renamed | Refusal | undefined — validates newName and builds NameEdits across program; [exp]; callers: 1 outside folder
- targetRefusal(program, declaredAt) -> string | undefined — refuses std items, special/trait/constraint names, shared shapes, multi-targets; callers: 0 outside folder
- newNameRefusal(program, declaredAt, newName) -> string | undefined — refuses non-names, `_`, built-ins, special names, privacy/case changes; callers: 0 outside folder
- meansMoreAs — Handlers<Naming, DeclaredAt['declared'], [], boolean> checking whether a name carries language/trait/constraint meaning; callers: 0 outside folder
- isAssociated(entity) -> boolean — checks whether TypeEntity is AssociatedType or RequiredAssociatedType; callers: 0 outside folder
- namesCalledByName(program) -> ReadonlySet<string> — memoized set of `main`, codecs, trait member names, and StructConstraint field names; callers: 0 outside folder
- sharesShape(program, at) -> boolean — checks whether field belongs to a StructType or a struct sharing field names with a shape; callers: 0 outside folder
- shapeWriters(program) -> ReadonlyMap<string, Writers> — counts shape and struct writers per sorted field-name key across all modules; callers: 0 outside folder
- writerOf(node, built) -> { key, kind } | undefined — sorted field-name key and writer kind from struct/shape declarations, types, or literals; callers: 0 outside folder
- spelledAnew(program, use, target, newName) -> string — replacement text (JSON string for key literal, expanded shorthand, or newName); callers: 0 outside folder

## src/editor/language-service/outline/folding.ts — line-based folding ranges from paired brackets and layout constructs
- LineRange — `{ start: number, end: number }` 0-based line range; [exp]; callers: 0 outside folder
- foldingRangesOf(tree) -> readonly LineRange[] — longest multi-line folding range per start line from brackets and layout nodes; [exp]; callers: 1 outside folder
- lineRangeOf(lines, span) -> LineRange — converts text Span to 0-based start/end lines; callers: 0 outside folder
- bracketSpans(tree) -> readonly Span[] — spans from each opening bracket to its paired closing bracket; callers: 0 outside folder
- layoutSpans(tree, tokens) -> readonly Span[] — spans for indented blocks, indented values, declarations with members, and match/select; callers: 0 outside folder
- layoutStarts — partial node-kind table computing fold start offset for layout constructs; callers: 0 outside folder
- layoutStart(tree, node, tokens) -> number | undefined — dispatches node to layoutStarts; callers: 0 outside folder

## src/editor/language-service/outline/symbols.ts — hierarchical document symbols for top-level declarations and their members
- SymbolKind — union of 12 outline symbol kinds; [exp]; callers: 1 outside folder
- DocumentSymbol — `{ name, kind, span, nameSpan, children }`; [exp]; callers: 1 outside folder
- symbol(name, kind, node, children?) -> readonly OutlineSymbol[] — builds OutlineSymbol when name is not Missing; callers: 0 outside folder
- fieldSymbols(fields) -> readonly OutlineSymbol[] — maps valid fields to `'field'` OutlineSymbols; callers: 0 outside folder
- variantSymbols(variants) -> readonly OutlineSymbol[] — maps valid variants and their fields to `'variant'` OutlineSymbols; callers: 0 outside folder
- symbolsOfDeclaration — table mapping each Declaration['kind'] to its OutlineSymbols; callers: 0 outside folder
- symbolsOf(tree) -> readonly DocumentSymbol[] — builds placed DocumentSymbols for all valid top-level items in tree; [exp]; callers: 1 outside folder
- placed(tree, found) -> DocumentSymbol — resolves OutlineSymbol nodes to text Spans (`extentIn` and `spanIn`); callers: 0 outside folder

## src/editor/language-service/reading/checked-module.ts — pairing a program's loaded module tree with the program's checker
- CheckedModule — `{ checker: Checker, module: ModuleId, tree: SyntaxTree }`; [exp]; callers: 5 outside folder
- checkedModule(program, module) -> CheckedModule | undefined — returns CheckedModule when module is in program.modules; [exp]; callers: 5 outside folder

## src/editor/language-service/reading/docstrings.ts — extracting docstrings from denoted declarations
- docstringOf(checker, declared) -> string | undefined — docstring text for function, type, namespace module, or local function; [exp]; callers: 3 outside folder

## src/editor/language-service/reading/identifier-at.ts — finding the Identifier or StringLiteral at or ending at a cursor offset
- identifierAt(tree, offset) -> Identifier | undefined — non-missing Identifier at offset or offset - 1; [exp]; callers: 3 outside folder
- stringLiteralAt(tree, offset) -> StringLiteral | undefined — StringLiteral at offset or offset - 1; [exp]; callers: 1 outside folder

## src/editor/language-service/reading/namespaces.ts — resolving the ProgramModule imported by a NamespaceEntity
- importedModule(checker, namespace) -> ProgramModule | undefined — ProgramModule loaded by namespace.declaration in its module; [exp]; callers: 3 outside folder

## src/editor/language-service/reading/tokens.ts — per-tree memoized scanning, template token flattening, and bracket pairing
- allTokensOf(tree) -> readonly Token[] — memoized flat token list including tokens inside template interpolations (excluding `end`); [exp]; callers: 1 outside folder
- codeTokensOf(tree) -> readonly Token[] — memoized allTokensOf excluding `template` and `docstring` tokens; [exp]; callers: 9 outside folder
- closingBracketsOf(tree) -> ReadonlyMap<Token, Token> — memoized map from each opening bracket to its paired closing bracket; [exp]; callers: 2 outside folder
- closingsIn(tokens, columnOf?) -> ReadonlyMap<Token, Token> — pairs brackets in tokens and recursively inside template values via pairBrackets; callers: 0 outside folder
- flatten(tokens) -> readonly Token[] — strips `end` tokens and splices template value tokens after their template token; callers: 0 outside folder
- tokenBefore(tree, token) -> Token | undefined — last code token ending at or before token.span.start; [exp]; callers: 2 outside folder

## src/editor/language-service/semantic-tokens/angle-brackets.ts — identifying `<`, `>`, `>>` tokens that bracket type parameter/argument lists
- angleBracketsOf(tree) -> ReadonlySet<Token> — memoized set of angle-bracket tokens enclosing typeParameters or typeArguments; [exp]; callers: 0 outside folder
- typeListOf(node) -> readonly SyntaxNode[] — returns node.typeParameters or node.typeArguments if present; callers: 0 outside folder
- bracketsAround(tree, types, tokens) -> readonly Token[] — finds `<` before first type and `>`/`>>` after last type via lastIndexAtMost; callers: 0 outside folder

## src/editor/language-service/semantic-tokens/built-keys.ts — semantic token overrides for bare keys of indented values built as maps
- builtKeyTypesOf(checked) -> ReadonlyMap<number, SemanticType> — maps bare keys of map IndentedValues to `'string'` or `'variable'`; [exp]; callers: 1 outside folder

## src/editor/language-service/semantic-tokens/name-types.ts — syntax-driven semantic token classification for identifiers
- calleeRoles(callee) -> readonly Role[] — classifies Identifier callee as `'function'` and MemberAccess.member as `'method'`; callers: 0 outside folder
- annotatedStruct(value) -> readonly Role[] — classifies annotation Identifier or MemberAccess.member (through TypeApplication) as `'type'`; callers: 0 outside folder
- rolesOf — partial node-kind table assigning SemanticTypes to identifiers held by AST nodes; callers: 0 outside folder
- nameTypesOf(tree) -> ReadonlyMap<number, SemanticType> — memoized map from identifier start offset to its SemanticType; [exp]; callers: 0 outside folder

## src/editor/language-service/semantic-tokens/semantic-tokens.ts — classifying all tokens and comments of a SyntaxTree for highlighting
- ClassifiedSpan — `{ span: Span, type: SemanticType }`; [exp]; callers: 0 outside folder
- semanticTokensOf(tree, checkedNames?) -> readonly ClassifiedSpan[] — classifies tokens and comments of tree in source order; [exp]; callers: 1 outside folder
- typeOf(token, context) -> SemanticType | undefined — classifies non-template token via nameTypesOf/checkedNames, literals, keywords; callers: 0 outside folder
- templateStrings(token) -> readonly ClassifiedSpan[] — slices template token around its `${...}` values into `'string'` ClassifiedSpans; callers: 0 outside folder

## src/editor/language-service/semantic-tokens/semantic-types.ts — legend of semantic token type names
- semanticTypes — tuple of 19 standard LSP/VS Code semantic token type names; [exp]; callers: 1 outside folder
- SemanticType — union of semanticTypes elements; [exp]; callers: 0 outside folder

## src/editor/language-service/signatures/call-at.ts — locating the enclosing call, active argument index, candidates, and parameter at an offset
- CallAt — `{ call: Call, maker: CallingNode, body: JoinedBody, argument: number }`; [exp]; callers: 1 outside folder
- callAt(checked, offset) -> CallAt | undefined — finds innermost Call whose parentheses hold offset and computes active argument index; [exp]; callers: 1 outside folder
- calleesOf(body, maker) -> readonly FunctionDeclaration[] — deduplicated resolved functions and overload candidates at maker; [exp]; callers: 1 outside folder
- argumentParameterAt(checked, offset) -> SignatureParameter | undefined — SignatureParameter of first callee for argument at offset; [exp]; callers: 2 outside folder
- writtenParameter(declaration, call, argument) -> number | undefined — maps written argument (name, position, rest) to parameter; [exp]; callers: 1 outside folder
- callAround(tree, offset) -> Call | undefined — finds innermost Call whose `(` and paired `)` (or next token) enclose offset; callers: 0 outside folder
- argumentAt(tree, call, offset) -> number — determines 0-based argument index at offset using argument spans and line starts; callers: 0 outside folder
- openingAfter(tokens, offset) -> Token | undefined — finds first `(` token at or after offset; callers: 0 outside folder

## src/editor/language-service/signatures/signature-help.ts — signature help for function calls, method calls, deferred calls, and function-value calls
- SignatureHelp — `{ signatures: readonly CallSignature[], active: number | undefined }`; [exp]; callers: 0 outside folder
- signatureHelpAt(program, module, offset) -> SignatureHelp | undefined — computes SignatureHelp for the call around offset; [exp]; callers: 1 outside folder
- valueCallHelp(checker, at) -> SignatureHelp | undefined — builds SignatureHelp from callee's FunctionType for a function-value call; callers: 0 outside folder
- slotOf(fnType, argument) -> number | undefined — maps argument index to parameter or pack index on FunctionType; callers: 0 outside folder
- functionCallHelp(checker, at) -> SignatureHelp | undefined — builds SignatureHelp across calleesOf using resolved binding or writtenParameter; callers: 0 outside folder

## src/editor/language-service/signatures/signatures.ts — formatting FunctionDeclaration and FunctionType signatures with parameter label offsets
- Signature — `{ label: string, parameters: readonly ParameterLabel[] }`; [exp]; callers: 0 outside folder
- signatureOf(checker, declaration) -> Signature — formats FunctionDeclaration header, parameters, and outcome return type; [exp]; callers: 3 outside folder
- functionTypeSignature(type) -> Signature — formats FunctionType via functionTypeParts into a Signature; [exp]; callers: 0 outside folder
- parameterText(tree, parameter) -> string — formats a SignatureParameter with rest `...`, pattern/name, `: slotText`, and `= …`; callers: 0 outside folder
- joined(head, parameters, tail) -> Signature — joins parameter strings with `, ` and records their `[start, end]` offsets in label; callers: 0 outside folder

## src/editor/language-service/workspace.ts — open-document state, incremental Program building, and incremental Checker handoff
- OpenTexts — `ReadonlyMap<ModuleId, string>`; [exp]; callers: 1 outside folder
- ProgramLoader — `(open: OpenTexts, previous: Program | undefined) => Program`; [exp]; callers: 1 outside folder
- ProgramChecking — `(program: Program, previous: Program | undefined) => Checker`; [exp]; callers: 0 outside folder
- Workspace — stateful workspace managing open texts, lazy Program/Checker snapshots, standalone syntax trees, and diagnostics; [exp]; callers: 5 outside folder
- Workspace.write(module, text) -> void — updates open text map when text changed; callers: 2 outside folder
- Workspace.close(module) -> void — removes module from open text map; callers: 1 outside folder
- Workspace.program -> Program — builds Program if needed and initializes its Checker from `#lastDiagnosed`; callers: 9 outside folder
- Workspace.#loaded() -> Program — memoizes Program build per `#open` map identity; callers: 0 outside folder
- Workspace.treeOf(module) -> SyntaxTree | undefined — returns module's tree from loaded Program or parses open standalone buffer (`std:`); callers: 7 outside folder
- Workspace.diagnosticsOf(module) -> ModuleDiagnostics | undefined — diagnoses module and updates `#lastDiagnosed` checkpoint; callers: 1 outside folder

## src/editor/lsp/diagnostics.ts — debounced LSP diagnostics publisher for all open workspace documents
- DiagnosticsPublisher — `{ schedule, clear, stop }`; [exp]; callers: 0 outside folder
- diagnosticsPublisher(connection, workspace) -> DiagnosticsPublisher — schedules 50ms-debounced diagnostics publishing across openModules; [exp]; callers: 0 outside folder
- lspDiagnostic(workspace, source, diagnostic) -> LspDiagnostic — converts toolchain Diagnostic and related locations to LSP Diagnostic; callers: 0 outside folder

## src/editor/lsp/locations.ts — converting between LSP URIs/Positions/Ranges and toolchain ModuleIds/Offsets/Spans
- moduleIdOfUri(uri) -> ModuleId — converts `file:` URI via fileURLToPath + moduleIdOfFile, or other URI via moduleIdOf; [exp]; callers: 6 outside folder
- rangeOf(source, span) -> Range — converts UTF-16 Span to 0-based LSP Range via LineMap; [exp]; callers: 4 outside folder
- spanOf(source, range) -> Span — converts LSP Range back to UTF-16 Span; [exp]; callers: 1 outside folder
- documentOffset(workspace, params) -> { module, offset } | undefined — resolves TextDocumentPositionParams to ModuleId and UTF-16 offset; [exp]; callers: 6 outside folder
- locationOf(program, module, span) -> Location — converts an AnchoredSpan in module to an LSP Location; [exp]; callers: 3 outside folder

## src/editor/lsp/project-loader.ts — ProgramLoader overlaying open file documents and `untitled:` buffers on disk project files
- projectProgramLoader(root) -> ProgramLoader — builds Program from project sources + open file overlays + `untitled:` buffer roots; [exp]; callers: 0 outside folder

## src/editor/lsp/providers/completion.ts — LSP `textDocument/completion` provider and item encoding
- completion — Provider registering `onCompletion` and triggerCharacters; [exp]; callers: 1 outside folder
- kinds — Record<CompletionKind, CompletionItemKind> mapping service kinds to LSP kinds; callers: 0 outside folder
- completionItem(offered) -> CompletionItem — encodes a language-service Completion as an LSP CompletionItem with sortText and follow-up Command; [exp]; callers: 0 outside folder

## src/editor/lsp/providers/formatting.ts — LSP `textDocument/formatting` provider
- formatting — Provider formatting whole document via `formatTree` when syntax-error-free; [exp]; callers: 1 outside folder

## src/editor/lsp/providers/hover.ts — LSP `textDocument/hover` provider
- hover — Provider rendering `hoverAt` code lines in an `ista` markdown fence followed by docstring; [exp]; callers: 1 outside folder

## src/editor/lsp/providers/inlay-hints.ts — LSP `textDocument/inlayHint` provider
- inlayHints — Provider mapping `inlayHintsIn` results to LSP Type InlayHints; [exp]; callers: 1 outside folder

## src/editor/lsp/providers/navigation/definition.ts — LSP `textDocument/definition` provider
- definition — Provider mapping `nameAt(...).declarations` to LSP Locations; [exp]; callers: 1 outside folder

## src/editor/lsp/providers/navigation/references.ts — LSP `textDocument/references` provider
- references — Provider mapping `referencesAt` (filtered by `includeDeclaration`) to LSP Locations; [exp]; callers: 1 outside folder

## src/editor/lsp/providers/navigation/rename.ts — LSP `textDocument/prepareRename` and `textDocument/rename` provider
- rename — Provider registering prepareRename and renameRequest handlers; [exp]; callers: 1 outside folder
- answerPreparing(connection, workspace) -> void — handles `onPrepareRename`, returning range/placeholder or ResponseError on Refusal; callers: 0 outside folder
- answerRenaming(connection, workspace) -> void — handles `onRenameRequest`, returning WorkspaceEdit or ResponseError on Refusal; callers: 0 outside folder
- workspaceEdit(program, edits) -> WorkspaceEdit — groups NameEdits by module URI into an LSP WorkspaceEdit; callers: 0 outside folder

## src/editor/lsp/providers/outline/document-symbols.ts — LSP `textDocument/documentSymbol` provider
- kinds — Record<SymbolKind, LspSymbolKind> mapping outline symbol kinds to LSP SymbolKinds; callers: 0 outside folder
- documentSymbols — Provider converting `symbolsOf(tree)` to recursive LSP DocumentSymbols; [exp]; callers: 1 outside folder
- lspSymbol(source, symbol) -> LspSymbol — converts one DocumentSymbol and its children to LSP DocumentSymbol; callers: 0 outside folder

## src/editor/lsp/providers/outline/folding-ranges.ts — LSP `textDocument/foldingRange` provider
- foldingRanges — Provider mapping `foldingRangesOf(tree)` to LSP `{ startLine, endLine }` ranges; [exp]; callers: 1 outside folder

## src/editor/lsp/providers/provider.ts — LSP feature provider interface
- Provider — `{ capabilities: ServerCapabilities, register: (connection, workspace) => void }`; [exp]; callers: 6 outside folder

## src/editor/lsp/providers/semantic-tokens.ts — LSP `textDocument/semanticTokens/full` provider
- semanticTokens — Provider encoding `semanticTokensOf(tree, builtKeyTypesOf(checked))` via SemanticTokensBuilder, splitting multi-line tokens per line; [exp]; callers: 1 outside folder
- linesOf(lines, span) -> readonly Span[] — splits a Span across each line it touches, dropping line breaks and empty pieces; callers: 0 outside folder

## src/editor/lsp/providers/signature-help.ts — LSP `textDocument/signatureHelp` provider
- signatureHelp — Provider encoding `signatureHelpAt` with `[start, end]` parameter label offsets and activeSignature/activeParameter; [exp]; callers: 1 outside folder

## src/editor/lsp/providers/std-source.ts — LSP `ista/source` request handler serving embedded std module source text
- stdSource — Provider answering `stdSourceRequest` via `stdSourceOf(moduleIdOfUri(uri))`; [exp]; callers: 1 outside folder

## src/editor/lsp/server.ts — LSP server composition root wiring Workspace, document sync, diagnostics, and all providers
- serveLanguage(connection, cwd) -> void — initializes Workspace, document sync, and all Providers on connection; [exp]; callers: 1 outside folder
- syncDocuments(connection, workspace) -> void — wires open/change/close/shutdown notifications to Workspace and DiagnosticsPublisher; callers: 0 outside folder

## src/editor/lsp/std-source-request.ts — shared `ista/source` JSON-RPC RequestType definition
- stdSourceRequest — `RequestType<{ uri: string }, string | null, void>('ista/source')` shared by server and VS Code client; [exp]; callers: 2 outside folder

## src/editor/vscode-client/extension.ts — VS Code extension entry point starting LanguageClient and `std:` content provider
- activate(context) -> Promise<void> — waits for workspace trust, starts LanguageClient for `file`/`untitled`/`std`, and registers `std:` provider; [exp]; callers: 0 outside folder
- deactivate() -> Promise<void> | undefined — stops running LanguageClient; [exp]; callers: 0 outside folder

## src/editor/vscode-client/server-command.ts — resolving the `ista lsp --stdio` executable for a workspace folder
- serverExecutable(setting, folder) -> Executable — builds Executable for `ista lsp --stdio` from setting, local `node_modules/.bin/ista`, or PATH; [exp]; callers: 0 outside folder
- istaCommand(setting, folder) -> string — picks setting if non-empty, else workspace-local `.bin/ista` if present, else `'ista'`; callers: 0 outside folder

## Concept footprint
- Optional/None & optional chains (`?.`, `?->`, `none`): `completion/expected.ts:expectedVariants`, `completion/places/member.ts:memberOperators`, `completion/places/member.ts:memberOnlyOperators`, `completion/places/member.ts:valueMembers`, `completion/places/member.ts:linkOf`, `completion/places/patterns/pattern.ts:startWordLiterals`, `completion/triggers.ts:endsArrow`, `signatures/signature-help.ts:valueCallHelp`
- unions: `completion/expected.ts:expectedLiterals`, `completion/places/literal-field.ts:mapKeys`, `completion/places/patterns/matched-type.ts:memberSelected`, `completion/places/patterns/matched-type.ts:membersSelected`, `completion/places/patterns/matched-type.ts:membersNamedBy`, `completion/places/patterns/matched-type.ts:parameterTypeAt`, `completion/places/patterns/pattern.ts:patternStarts`, `completion/places/patterns/pattern.ts:mayRefer`
- enums/variants & variant constructors: `completion/candidate.ts:Subject`, `completion/expected.ts:expectedVariants`, `completion/expected.ts:variantsOf`, `completion/expected.ts:isBareVariant`, `completion/expected.ts:isVariantEntity`, `completion/expected.ts:valueNamedBy`, `completion/placeholder.ts:builtNameRole`, `completion/placeholder.ts:declaringKinds`, `completion/places/declared-name.ts:offerDeclaredName`, `completion/places/declared-name.ts:memberWords`, `completion/places/grammar/expression.ts:operandNames`, `completion/places/literal-field.ts:literalItems`, `completion/places/member.ts:MemberPlace`, `completion/places/member.ts:namedBy`, `completion/places/member.ts:typeMembers`, `completion/places/patterns/matched-type.ts:fieldsMatchedBy`, `completion/places/patterns/matched-type.ts:fieldsOf`, `completion/places/patterns/matched-type.ts:membersSelected`, `completion/places/patterns/matched-type.ts:variantFieldsOf`, `completion/places/patterns/matched-type.ts:steps`, `completion/places/patterns/pattern.ts:offerPattern`, `completion/places/patterns/pattern.ts:patternStarts`, `completion/places/patterns/pattern.ts:fieldLabels`, `completion/places/patterns/pattern.ts:mayRefer`, `completion/places/patterns/pattern.ts:variantsCovered`, `completion/places/patterns/pattern.ts:variantsTakenWhole`, `completion/places/patterns/pattern.ts:argumentBindsOnly`, `completion/presentation/entity-items.ts:groupOf`, `completion/presentation/entity-items.ts: typeKinds`, `completion/presentation/entity-items.ts:entityItems`, `completion/presentation/present.ts:presenters`, `completion/presentation/presenting.ts:variantGivenAsValue`, `completion/presentation/presenting.ts:constructorOf`, `completion/presentation/presenting.ts:called`, `completion/presentation/presenting.ts:writesPattern`, `completion/presentation/presenting.ts:calledOrNamed`, `completion/presentation/presenting.ts:constructed`, `completion/triggers.ts:startsPatternArgument`, ` completion/triggers.ts:startsLabelledValue`, `hover.ts:hoverAt`, `hover.ts:positionalArgumentOf`, `hover.ts:argumentHover`, `hover.ts:denotationLines`, `navigation/declarations.ts:declaringNames`, `navigation/rename.ts:meansMoreAs`, `outline/folding.ts:layoutStarts`, `outline/symbols.ts:variantSymbols`, `outline/symbols.ts:symbolsOfDeclaration`, `semantic-tokens/name-types.ts:rolesOf`
- any/trait objects & downcasts: `completion/places/patterns/matched-type.ts:fieldsOf`, `completion/places/patterns/matched-type.ts:downcastOf`, `completion/places/patterns/pattern.ts:mayRefer`, `completion/places/type.ts:offerType`, `completion/places/type.ts:asksForTrait`
- futures/await/select & async: `completion/expected.ts:expectedVariants`, `completion/placeholder.ts:kindAt`, `completion/placeholder.ts:roles`, `completion/places/grammar/position.ts:unplacedIn`, `completion/places/grammar/position.ts:standsAsModifier`, `completion/places/grammar/position.ts:goingOn`, `completion/places/grammar/surroundings.ts:Surroundings`, `completion/places/grammar/surroundings.ts:surroundingsOf`, `completion/places/grammar/surroundings.ts:bodyKind`, `completion/places/grammar/words.ts:waits`, `completion/places/grammar/words.ts:runsInInstance`, `completion/places/grammar/words.ts:wordNeeds`, `navigation/rename.ts:asDeclared`, `outline/folding.ts:layoutStarts`, `signatures/signatures.ts:signatureOf`
- marks/kinds (`live`/`ista`/named marks): `completion/places/declared-name.ts:headWordsAfter`, `completion/places/grammar/position.ts:modifierBefore`, `completion/places/grammar/position.ts:standsAsModifier`, `completion/places/grammar/position.ts:startsHead`, `completion/places/grammar/position.ts:takesAlone`, `completion/presentation/presenting.ts:givenAsValue`, `completion/presentation/presenting.ts:functionGivenAsValue`, `completion/presentation/presenting.ts:variantGivenAsValue`, `signatures/signatures.ts:signatureOf`
- sendable: `completion/places/grammar/position.ts:standsAsModifier`, `completion/presentation/presenting.ts:givenAsValue`
- shared structs (`shared struct`, `new`, `->`, `?->`, `*`): `completion/placeholder.ts:kindAt`, `completion/placeholder.ts:followsNew`, `completion/placeholder.ts:builtNameRole`, `completion/placeholder.ts:declaringKinds`, `completion/places/declared-name.ts:headWordsAfter`, `completion/places/grammar/position.ts:standsAsModifier`, `completion/places/grammar/words.ts:wordNeeds`, `completion/places/literal-field.ts:isFieldsLiteral`, `completion/places/member.ts:memberOperators`, `completion/places/type.ts:offerType`, `completion/presentation/entity-items.ts:typeKinds`, `completion/triggers.ts:endsArrow`, `hover.ts:showsAs`, `navigation/rename.ts:sharesShape`, `navigation/rename.ts:writerOf`, `outline/folding.ts:layoutStarts`, `outline/symbols.ts:symbolsOfDeclaration`, `semantic-tokens/name-types.ts:rolesOf`
- extern types & extern constants/functions: `completion/placeholder.ts:declaringKinds`, `completion/places/declared-name.ts:offerDeclaredName`, `completion/places/declared-name.ts:headWordsAfter`, `completion/presentation/entity-items.ts:typeKinds`, `completion/presentation/entity-items.ts:variableKind`, `navigation/references.ts:isName`, `outline/folding.ts:layoutStarts`, `outline/symbols.ts:symbolsOfDeclaration`, `semantic-tokens/name-types.ts:rolesOf`
- field loops/passes (`for [k, v] in s`, `JoinedBody`): `completion/places/grammar/surroundings.ts:surroundingsOf`, `completion/places/patterns/matched-type.ts:parameterTypeAt`, `inlay-hints.ts:ownUntypedNames`, `semantic-tokens/name-types.ts:rolesOf`, `signatures/call-at.ts:calleesOf`, `signatures/signature-help.ts:functionCallHelp`
- comprehensions: `completion/placeholder.ts:roles`, `completion/places/grammar/position.ts:iteratesOver`
- deferred calls (`g f(args)`): `completion/places/grammar/expression.ts:operandNames`, `completion/places/grammar/index.ts:byPosition`, `completion/places/grammar/position.ts:GrammarPosition`, `completion/places/grammar/position.ts:positionAfter`, `completion/places/grammar/position.ts:startsDeferredCall`, `completion/places/grammar/position.ts:takesAlone`, `hover.ts:showsAs`, `semantic-tokens/name-types.ts:rolesOf`, `signatures/call-at.ts:CallAt`, `signatures/call-at.ts:callAt`
- context consts (`ista const`): `completion/placeholder.ts:declaringKinds`, `completion/places/grammar/position.ts:positionAfter`, `completion/places/grammar/surroundings.ts:surroundingsOf`, `completion/presentation/entity-items.ts:variableKind`, `inlay-hints.ts:ownUntypedNames`, `outline/symbols.ts:symbolsOfDeclaration`
- disposal/lifetimes/holders (`hold`, `@Holds`, `@Keeps`): `completion/placeholder.ts:argumentRole`, `completion/places/grammar/position.ts:heldIn`, `completion/places/grammar/position.ts:holds`, `completion/places/grammar/position.ts:modifierBefore`, `completion/places/grammar/position.ts:standsAsModifier`, `completion/places/grammar/position.ts:heldLabelOf`, `navigation/references.ts:isName`, `semantic-tokens/name-types.ts:rolesOf`
- recursive aliases & type `match` (`infer`, `StructConstraint`): `completion/places/type.ts:offeredTypeWords`, `hover.ts:shownText`, `navigation/rename.ts:namesCalledByName`
- struct keys / `keyof` / key String literals: `completion/candidate.ts:Subject`, `completion/expected.ts:expectedLiterals`, `completion/expected.ts:expecters`, `completion/expected.ts:expectedOfString`, `completion/placeholder.ts:kindAt`, `completion/places/string-text.ts:offerStringText`, `completion/triggers.ts:opens`, `hover.ts:isName`, `hover.ts:nameHover`, `navigation/declarations.ts:WrittenName`, `navigation/declarations.ts:spelledName`, `navigation/declarations.ts:declarationsOf`, `navigation/declarations.ts:nameAt`, `navigation/references.ts:isName`, `navigation/rename.ts:spelledAnew`, `reading/identifier-at.ts:stringLiteralAt`
- packs (`...T`): `completion/presentation/presenting.ts:givenAsValue`, `signatures/signature-help.ts:slotOf`, `signatures/signatures.ts:signatureOf`
- indented values: `completion/places/literal-field.ts:LiteralFieldPlace`, `completion/places/literal-field.ts:literalFieldPlaceAt`, `completion/places/literal-field.ts:indentedEntryPlaceAt`, `completion/places/literal-field.ts:offerLiteralFields`, `completion/places/literal-field.ts:mapKeys`, `completion/places/literal-field.ts:keyText`, `navigation/rename.ts:shapeWriters`, `navigation/rename.ts:writerOf`, `outline/folding.ts:layoutStarts`, `semantic-tokens/built-keys.ts:builtKeyTypesOf`
- defaults & fields functions: `completion/places/grammar/surroundings.ts:surroundingsOf`, `completion/presentation/present.ts:presenters`, `completion/presentation/presenting.ts:givenAsValue`, `completion/presentation/presenting.ts:functionGivenAsValue`, `completion/presentation/presenting.ts:variantGivenAsValue`, `completion/presentation/presenting.ts:constructorOf`, `hover.ts:denotationLines`, `signatures/signatures.ts:parameterText`
- codecs/JSON (`encodeJson`, `decodeJson`): `navigation/rename.ts:namesCalledByName`
- witnesses/traits & associated types (`Self`, `T.Data`): `completion/placeholder.ts:declaringKinds`, `completion/places/declared-name.ts:offerDeclaredName`, `completion/places/declared-name.ts:mayTakeSelf`, `completion/places/declared-name.ts:memberWords`, `completion/places/declared-name.ts:staticOwners`, `completion/places/grammar/expression.ts:namesValue`, `completion/places/grammar/item-starts.ts:startsItemOf`, `completion/places/grammar/position.ts:startsHead`, `completion/places/member.ts:MemberPlace`, `completion/places/member.ts:memberPlaceOf`, `completion/places/member.ts:offerMembers`, `completion/places/member.ts:typeMembers`, `completion/places/type.ts:offerType`, `completion/places/type.ts:asksForTrait`, `completion/presentation/entity-items.ts:typeKinds`, `completion/presentation/entity-items.ts:entityItems`, `hover.ts:shownText`, `navigation/declarations.ts:declaringNames`, `navigation/rename.ts:meansMoreAs`, `navigation/rename.ts:isAssociated`, `navigation/rename.ts:namesCalledByName`, `outline/folding.ts:layoutStarts`, `outline/symbols.ts:symbolsOfDeclaration`, `semantic-tokens/name-types.ts:rolesOf`
- places & `&` references (`&self`, `&x`): `completion/places/declared-name.ts:offerDeclaredName`, `completion/places/grammar/index.ts:byPosition`, `completion/places/grammar/index.ts:isChangeable`, `completion/places/grammar/position.ts:heldIn`, `completion/places/grammar/position.ts:passesArgument`, `completion/places/member.ts:valueMembers`, `completion/presentation/present.ts:presenters`, `completion/presentation/presenting.ts:givenAsValue`
- patterns (match/is/target/parameter patterns, shorthands): `completion/expected.ts:expecters`, `completion/expected.ts:expectedOfPatternStart`, `completion/placeholder.ts:builtNameRole`, `completion/placeholder.ts:isTested`, `completion/placeholder.ts:holdsTargets`, `completion/placeholder.ts:roles`, `completion/placeholder.ts:fieldRole`, `completion/placeholder.ts:caseRole`, `completion/placeholder.ts:declaringKinds`, `completion/places/patterns/matched-type.ts:patternStartedBy`, `completion/places/patterns/matched-type.ts:matchedTypeOf`, `completion/places/patterns/matched-type.ts:fieldsMatchedBy`, `completion/places/patterns/matched-type.ts:fieldsOf`, `completion/places/patterns/matched-type.ts:memberSelected`, `completion/places/patterns/matched-type.ts:membersSelected`, `completion/places/patterns/matched-type.ts:membersNamedBy`, `completion/places/patterns/matched-type.ts:variantFieldsOf`, `completion/places/patterns/matched-type.ts:downcastOf`, `completion/places/patterns/matched-type.ts:parameterTypeAt`, `completion/places/patterns/matched-type.ts:steps`, `completion/places/patterns/pattern-field.ts:offerPatternFields`, `completion/places/patterns/pattern.ts:offerPattern`, `completion/places/patterns/pattern.ts:patternStarts`, `completion/places/patterns/pattern.ts:fieldLabels`, `completion/places/patterns/pattern.ts:mayRefer`, `completion/places/patterns/pattern.ts:variantsCovered`, `completion/places/patterns/pattern.ts:variantsTakenWhole`, `completion/places/patterns/pattern.ts:argumentBindsOnly`, `completion/places/patterns/pattern.ts:followsFieldName`, `completion/places/patterns/pattern.ts:followsWholePattern`, `completion/places/patterns/pattern.ts:isWhole`, `completion/presentation/presenting.ts:writesPattern`, `completion/triggers.ts:startsPatternArgument`, `completion/triggers.ts:startsLabelledValue`, `hover.ts:positionalArgumentOf`, `hover.ts:argumentHover`, `inlay-hints.ts:ownUntypedNames`, `navigation/declarations.ts:nameAt`, `navigation/rename.ts:spelledAnew`, `outline/symbols.ts:symbolsOfDeclaration`, `semantic-tokens/name-types.ts:rolesOf`, `signatures/signatures.ts:parameterText`, `signatures/signatures.ts:patternText`
- templates (`${…}`, tagged templates): `completion/placeholder.ts:isLiteralText`, `reading/tokens.ts:codeTokensOf`, `reading/tokens.ts:closingsIn`, `reading/tokens.ts:flatten`, `semantic-tokens/name-types.ts:rolesOf`, `semantic-tokens/semantic-tokens.ts:semanticTokensOf`, `semantic-tokens/semantic-tokens.ts:templateStrings`
- ranges (`..`, `..=`, `by`): `completion/places/grammar/position.ts:goingOn`, `completion/places/patterns/pattern.ts:isWhole`
- annotations (`@`, `@Waypoint`, `@Keeps`): `completion/placeholder.ts:kindAt`, `completion/placeholder.ts:roles`, `completion/places/annotation.ts:offerAnnotation`, `completion/places/annotation.ts:annotationNames`, `completion/places/annotation.ts:waypointOrStruct`, `completion/places/annotation.ts:isMisplaced`, `completion/places/annotation.ts:isCutShort`, `completion/places/grammar/item-starts.ts:ownStartOf`, `completion/presentation/entity-items.ts:entityItems`, `completion/presentation/present.ts:givesValue`, `completion/presentation/presenting.ts:valuePlaces`, `completion/presentation/presenting.ts:annotationValue`, `completion/triggers.ts:listedNames`, `completion/triggers.ts:opens`, `navigation/references.ts:isName`, `semantic-tokens/name-types.ts:annotatedStruct`, `semantic-tokens/name-types.ts:rolesOf`, `semantic-tokens/semantic-tokens.ts:typeOf`
- anonymous structs / shapes (`{…}`, `struct{…}`, shorthands): `completion/places/declared-name.ts:memberWords`, `completion/places/literal-field.ts:literalItems`, `completion/places/literal-field.ts:shorthandFor`, `completion/places/patterns/matched-type.ts:fieldsOf`, `completion/places/patterns/matched-type.ts:membersSelected`, `completion/places/type.ts:offeredTypeWords`, `navigation/declarations.ts:declaringNames`, `navigation/rename.ts:targetRefusal`, `navigation/rename.ts:sharesShape`, `navigation/rename.ts:shapeWriters`, `navigation/rename.ts:writerOf`, `navigation/rename.ts:shapeLiteralWriter`, `navigation/rename.ts:spelledAnew`
