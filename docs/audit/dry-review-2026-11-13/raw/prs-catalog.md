## src/compiler/parser/cursor/brackets.ts — Bracket pairing, grouping openers, and indentation-based unclosed bracket endings
- openers — Map from opener token (`(`, `[`, `{`, `<`) to closer and whether it is a grouping bracket; [exp]; callers: 0 outside folder (2 in cursor/)
- Opener — Union of opener tokens (`(`, `[`, `{`, `<`); [exp]; callers: 0 outside folder (2 in cursor/)
- BracketOpener — Opener excluding `<` (`(`, `[`, `{`); [exp]; callers: 0 outside folder (2 in cursor/)
- Closer — Union of closer tokens (`)`, `]`, `}`, `>`); [exp]; callers: 0 outside folder (3 in cursor/)
- bracketClosers — Map from bracket opener (`(`, `[`, `{`) to its closer; [exp]; callers: 0 outside folder (1 in cursor/)
- isBracketOpener(kind: string): kind is BracketOpener — Tests whether a token kind opens a bracket group; [exp]; callers: 1 outside folder
- pairBrackets(tokens, columnOf?): BracketPairs — Pairs brackets in a token list and computes where unmatched openers end; [exp]; callers: 1 outside folder
- BracketPairs — Paired bracket lookup and unclosed-opener end map; [exp]; callers: 0 outside folder (1 in test)
- unclosedBracketEnds(tokens, columnOf): ReadonlyMap<number, number> — Maps each unclosed bracket's region start index to its end token; [exp]; callers: 1 outside folder
- pairByKind(tokens, partners): Map<number, number | undefined> — Pairs each closer with the innermost open bracket of its kind; callers: 0 outside folder
- OpenBrackets.open(index, closer): void — Pushes an opened bracket and increments its closer count; callers: 0 outside folder
- OpenBrackets.close(kind, at, unmatched): number — Closes innermost matching bracket and marks inner open brackets unmatched; callers: 0 outside folder
- endUnmatched(tokens, partners, unmatched, columnOf): ReadonlyMap — Ends unmatched openers by indentation and re-pairs aligned closers; callers: 0 outside folder
- endedAgain(unmatched, ends, opener, closer): readonly number[] — Resets unmatched openers inside a re-paired group to end again; callers: 0 outside folder
- linesOf(tokens, columnOf): Lines — Collects line-heading token indices and their columns; callers: 0 outside folder
- lineEnding(layout, opener, endedBy): Ending — Finds the first later line no deeper than opener's that ends or closes its bracket; callers: 0 outside folder
- endingAt(layout, opener, line): Ending | undefined — Decides whether a shallow line ends opener's bracket, re-pairs, or stays inside; callers: 0 outside folder

## src/compiler/parser/cursor/index.ts — Token stream cursor, lookahead, angle-splitting (`>=`/`>>`/`>>=`), and line-break regions
- CursorToken — Token or synthetic `lineBreak` pseudo-token; [exp]; callers: 2 outside folder
- CursorKind — Kind of a `CursorToken` (`TokenKind | 'lineBreak'`); [exp]; callers: 13 outside folder
- CursorMark — Saved cursor state (`index`, `remainder`, `regionStart`) for speculation rollback; [exp]; callers: 0 outside folder
- Indentation — Unclosed bracket end map and token column callback for indentation-aware regions; [exp]; callers: 0 outside folder
- Cursor — Token stream reader with nested line-break regions and angle-closer splitting; [exp]; callers: 1 outside folder (parser.ts; 38 via parser.cursor)
- Cursor.peek(ahead: number): CursorToken — Returns token `ahead` positions on, stopping at a line break or `end`; callers: 5 outside folder
- Cursor.previousEnd: number — End offset of the last consumed token (or split remainder start); callers: 4 outside folder
- Cursor.advance(): CursorToken — Consumes next token, splitting `>=`/`>>`/`>>=` when closing `<…>`; callers: 25 outside folder
- Cursor.eat(kind: TokenKind): Token | undefined — Consumes and returns next token if it matches `kind`; callers: 24 outside folder
- Cursor.mark(): CursorMark — Captures current index, split remainder, and region start for speculation; callers: 1 outside folder
- Cursor.reset(mark: CursorMark): void — Restores cursor state to `mark`; callers: 1 outside folder
- Cursor.lineHead(offset: number): Token — Finds the first token on the line holding `offset`; callers: 1 outside folder
- Cursor.lineStart: Token | undefined — Returns first token of next line when stopped at a crossable line break; callers: 4 outside folder
- Cursor.crossLineBreak(): void — Advances current region start to expose the next line's tokens; callers: 3 outside folder
- Cursor.skipGroup(): void — Iteratively skips a balanced bracket group, stopping at enclosing closers or unclosed ends; callers: 0 outside folder (1 in cursor/)
- Cursor.startsLineInList(ahead = 0): boolean — Tests if token at `ahead` starts a new line inside a `betweenItems` list region; callers: 4 outside folder
- Cursor.within(opener, parse): Result — Runs `parse` inside a bracket region where line breaks are ignored; callers: 0 outside folder (1 in cursor/)
- Cursor.withinList(opener, parse): Result — Runs `parse` inside a list region (`(`, `[`, `{`, `<`); callers: 0 outside folder (1 in cursor/)
- Cursor.withinBlockBraces(column, parse): Result — Runs `parse` inside `{…}` whose lines form a block at `column`; callers: 1 outside folder
- Cursor.inBlock(column, parse): Result — Runs `parse` inside an indented block region at `column`; callers: 3 outside folder
- Cursor.ignoringLineBreaks(parse): Result — Runs `parse` ignoring line breaks without a closing bracket (template values); callers: 1 outside folder
- Cursor.onOneLine(parse): Result — Runs `parse` in a region ended by the next line break; callers: 2 outside folder
- Cursor.closesEnclosing(kind: CursorKind): boolean — Tests if `kind` closes any enclosing region; callers: 1 outside folder
- Cursor.closesAny(kind: CursorKind): boolean — Tests if `kind` closes the current or any enclosing region; callers: 1 outside folder
- Cursor.#inRegion(region, parse): Result — Pushes `region` bounded by outer `until`, runs `parse`, and pops; callers: 0 outside folder
- Cursor.#tokenAt(index: number): CursorToken — Returns `lineBreak` pseudo-token if `index` breaks the line, else the read token; callers: 0 outside folder
- Cursor.#breaksLine(index: number): boolean — Decides if token at `index` acts as a line break in the current region; callers: 0 outside folder
- Cursor.#endsAngleList(opener, index): boolean — Tests if line at `index` is no deeper than `<` opener's line and not headed by `>`; callers: 0 outside folder
- Cursor.#readAt(index: number): Token — Splits leading `>` off `>=`/`>>`/`>>=` when current region closes with `>`; callers: 0 outside folder
- Cursor.#rawAt(index: number): Token — Returns active split `#remainder` at `#index` or raw token from `#tokens`; callers: 0 outside folder

## src/compiler/parser/cursor/recovery.ts — Bracketed construct parsing, comma/line-break lists, tuple/group disambiguation, and token skipping
- Enclosed<Value> — Parsed value and anchored span from opener to closer; [exp]; callers: 2 outside folder
- CommaSeparated<Item> — Parsed list items (including `Invalid`) and whether any comma was written; [exp]; callers: 0 outside folder
- DelimitedList<Item> — `CommaSeparated<Item>` with its enclosing `AnchoredSpan`; [exp]; callers: 0 outside folder
- parseEnclosed(parser, opener, parseInner): Enclosed<Value> — Parses `opener`, `parseInner` in bracket region, and matching closer; [exp]; callers: 3 outside folder
- parseList(parser, opener, parseInner): Enclosed<Value> — Parses `opener`, `parseInner` in list region, and matching closer; [exp]; callers: 2 outside folder
- parseEnclosedIn(parser, opener, enter, parseInner): Enclosed — Parses opener, `parseInner` in `enter`, skips unexpected, eats closer; [exp]; callers: 1 outside folder
- parseDelimited(parser, opener, parseItem): DelimitedList<Item> — Parses comma/newline-separated items inside `opener…closer`; [exp]; callers: 7 outside folder
- GroupShapes<Item, Node> — Builders for a tuple vs a single parenthesized item; [exp]; callers: 0 outside folder
- parseGroup(parser, parseItem, shapes): Node — Parses `(…)` and builds a grouped node for `(x)` or tuple for `()`/`(x,)`/`(x, y)`; [exp]; callers: 3 outside folder
- parseCommaSeparated(parser, parseItem): CommaSeparated — Parses items parted by `,` (or reported `;`) or separating line breaks; [exp]; callers: 2 outside folder
- takeListSeparator(parser): ',' | 'lineBreak' | undefined — Consumes `,` or misplaced `;` (reporting 2038), or detects separating line break; callers: 0 outside folder
- ItemSeparator — Block item separator kind (`';' | ',' | 'lineBreak'`); [exp]; callers: 1 outside folder
- skipToSeparator(parser, reported, separator): Invalid[] — Reports and skips unexpected tokens after a block item up to separator; [exp]; callers: 2 outside folder
- atRegionEnd(parser): boolean — Tests if cursor is at current/enclosing closer, `lineBreak`, or `end`; [exp]; callers: 2 outside folder
- skipUnexpected(parser, reported, expected, isStop): Invalid[] — Reports expected token if none reported since `reported` and skips to stop; callers: 0 outside folder
- skipUntil(parser, stops): Invalid[] — Skips tokens and balanced bracket groups up to `stops` or region end as `Invalid`; [exp]; callers: 4 outside folder
- skipTo(parser, isStop): Invalid[] — Core skipping loop (no-op while speculating) wrapping skipped span in `Invalid`; callers: 0 outside folder

## src/compiler/parser/cursor/regions.ts — Line-break region descriptors for top-level, brackets, blocks, lists, `<…>`, and one-line suites
- Region — Region state: `lineBreaks` mode, `start`, `closer`, `ownsCloser`, `column`, `until`, `angleOpener`; [exp]; callers: 0 outside folder (1 in cursor/)
- LineRegionShape — `Region` without `start` (filled with current cursor index on entry); [exp]; callers: 0 outside folder (1 in cursor/)
- topLevelRegion(): Region — Creates module top-level region where line breaks end constructs; [exp]; callers: 0 outside folder (1 in cursor/)
- bracketRegion(start, closer, until): Region — Creates bracket region ignoring line breaks up to `closer` or `until`; [exp]; callers: 0 outside folder (1 in cursor/)
- blockBracesRegion(column, until): LineRegionShape — Creates `{…}` block region separating items at `column`; [exp]; callers: 0 outside folder (1 in cursor/)
- listRegion(start, closer, until): Region — Creates list region where line breaks may separate items; [exp]; callers: 0 outside folder (1 in cursor/)
- angleListRegion(start): Region — Creates `<…>` list region recording `angleOpener` for indentation termination; [exp]; callers: 0 outside folder (1 in cursor/)
- blockRegion(closer, column): LineRegionShape — Creates indented block region at `column` inheriting outer `closer`; [exp]; callers: 0 outside folder (1 in cursor/)
- unbracketedRegion(start): Region — Creates line-break-ignoring region without a closer (for template interpolations); [exp]; callers: 0 outside folder (1 in cursor/)
- oneLineRegion(closer): LineRegionShape — Creates region ended by the next line break, inheriting outer `closer`; [exp]; callers: 0 outside folder (1 in cursor/)
- entered(region, outer): Region — Clamps `region.until` to `outer.until` when entering a nested region; [exp]; callers: 0 outside folder (1 in cursor/)

## src/compiler/parser/diagnostics.ts — Parser diagnostic catalog (codes 2001–2310)
- parserDiagnostics — Typed diagnostic factories for syntax and layout errors (2001–2310); [exp]; callers: 27 outside folder (1 outside parser/)

## src/compiler/parser/grammar/declarations/declaration.ts — Top-level declaration dispatch, modified heads (`extern`/`shared`/`ista const`), and module root
- parseModified(parser): Declaration | undefined — Dispatches modified heads (`ista const`, `extern …`, `shared struct`, `struct`); callers: 0 outside folder
- parseContextConstant(parser): ContextConstantDeclaration — Parses `ista const name: T = value` and reports `live const` (2080); callers: 0 outside folder
- parseExtern(parser, modifiers, keyword): Declaration — Dispatches `extern` constant, function, or struct from head modifiers/keyword; callers: 0 outside folder
- parseTopLevelDeclaration(parser): Declaration | undefined — Parses a module-only declaration at its opening keyword or modifier; [exp]; callers: 1 outside folder
- parseModule(parser): Module — Parses a whole source file as a column-0 block of declarations with optional docstring; [exp]; callers: 1 outside folder

## src/compiler/parser/grammar/declarations/externs.ts — Host-implemented `extern` constant and `extern struct` declarations
- parseExternConstant(parser): ExternConstantDeclaration — Parses `extern name: Type`; [exp]; callers: 0 outside folder (1 in declarations/)
- parseExternStruct(parser): ExternStructDeclaration — Parses `[handle] extern struct Name<T>` and associated types; [exp]; callers: 0 outside folder (1 in dir)

## src/compiler/parser/grammar/declarations/functions.ts — Function declarations (top-level, local, static `Owner.name`, trait requirement, `extern fn`)
- parseFunction(parser, place): FunctionDeclaration — Parses function head, `Owner.name`, params, return type, and body; [exp]; callers: 0 outside folder (2 in dir)
- formOf(place, isExtern): FunctionForm — Maps function place (`item` vs `trait`) and `isExtern` to `'defined' | 'requirement' | 'extern'`; callers: 0 outside folder
- parseItemFunction(parser): FunctionDeclaration — Forwards `parseFunction(parser, 'item')`; [exp]; callers: 1 outside folder
- parseFunctionName(parser): { owner, name } — Parses `name` or static `Owner.name`; callers: 0 outside folder
- parseFunctionBody(parser, form, options): WithDocstring<Block | undefined> — Parses `: body` in its own segment or docstring below; callers: 0 outside folder

## src/compiler/parser/grammar/declarations/imports.ts — Named (`import a, b as c from 'path'`), parenthesized, and namespace (`import * as m`) imports
- parseImport(parser): ImportDeclaration — Parses `NamespaceImport` (`* as alias`) or `NamedImport` (grouped or bare); [exp]; callers: 0 outside folder (1 in dir)
- parseBareNames(parser): readonly (ImportedName | Invalid)[] — Parses comma-separated imported names on one line; callers: 0 outside folder
- parseImportedName(parser): ImportedName — Parses `name` or `name as alias`; callers: 0 outside folder
- exportedName(parser): Identifier — Parses imported identifier, recovering before `from '…'` or past a typed keyword; callers: 0 outside folder
- parseFrom(parser): StringLiteral | Missing — Parses contextual `from` and module path string literal; callers: 0 outside folder

## src/compiler/parser/grammar/declarations/type-declarations.ts — `struct`, `shared struct`, `enum`, `trait`, `type` alias, and associated type declarations
- parseStruct(parser): StructDeclaration — Parses `struct Name<T>` with fields and associated types; [exp]; callers: 0 outside folder (1 in declarations/)
- parseSharedStruct(parser): SharedStructDeclaration — Parses `shared struct Name<T>` with fields and associated types; [exp]; callers: 0 outside folder (1 in dir)
- parseStructFrom(parser, form): Omit<DeclaredStruct, 'kind'> — Shared parser for `struct` and `shared struct` declarations; callers: 0 outside folder
- parseEnum(parser): EnumDeclaration — Parses `enum Name<T>` with variants and associated types; [exp]; callers: 0 outside folder (1 in declarations/)
- withAssociatedTypes(rules): ItemRules<Item | AssociatedType> — Wraps member rules to also parse `type Name = T` associated types; callers: 0 outside folder
- associatedTypesApart(members): { associatedTypes, others } — Splits parsed members into `AssociatedType[]` and fields/variants; callers: 0 outside folder
- parseAssociatedType(parser): AssociatedType — Parses `type Name = AliasBody` inside a struct, enum, or extern struct; callers: 0 outside folder
- parseRequiredAssociatedType(parser): RequiredAssociatedType — Parses `type Name [in U] [is C]` inside a trait; callers: 0 outside folder
- parseExternStructMembers(parser, headerStart): WithDocstring — Parses extern struct body and reports fields (2060); [exp]; callers: 0 outside folder (1 in dir)
- parseAssociatedHead(parser): { start, name } — Parses `type Name` and reports any `<…>` type parameters on an associated type (2028); callers: 0 outside folder
- parseTrait(parser): TraitDeclaration — Parses `trait Name<T>` and its member segments; [exp]; callers: 0 outside folder (1 in declarations/)
- parseTypeAlias(parser): TypeAliasDeclaration — Parses `type Name<T> = AliasBody`; [exp]; callers: 0 outside folder (1 in declarations/)
- parseMembers(parser, rules, headerStart): WithDocstring<Items<Item>> — Parses `: indented` or `{ braced }` members and docstring; callers: 0 outside folder
- parseVariant(parser): Variant — Parses enum variant `Name` or `Name(fields)`; callers: 0 outside folder
- parseVariantFields(parser, name): Variant['fields'] — Parses variant `(fields)` or reports and recovers `{fields}` (2043); callers: 0 outside folder
- parseTraitMember(parser): TraitMember | Invalid — Dispatches trait member to function requirement, required associated type, or field; callers: 0 outside folder

## src/compiler/parser/grammar/declarations/type-matches.ts — Type alias and associated type bodies: plain types or `match Subject:` type matches
- parseAliasBody(parser): AliasBody — Parses a `TypeMatch` at `match` or a `TypeNode` after `=`; [exp]; callers: 0 outside folder (1 in declarations/)
- parseTypeMatch(parser): TypeMatch — Parses `match Subject:` and its indented `case` branches; callers: 0 outside folder
- parseTypeCase(parser): TypeCase | Invalid — Parses `case Pattern: Type` and reports extra types in case body (2029); callers: 0 outside folder
- parseCasePattern(parser): CasePattern — Parses `_` (`WildcardPattern`), `struct { … }` (`StructConstraint`), or a `TypeNode`; callers: 0 outside folder

## src/compiler/parser/grammar/declarations/type-parameters.ts — Generic `<…>` type parameters with variance (`gives`/`takes`), packs (`...T`), `in`, `is`, and `=`
- parseTypeParameters(parser): TypeParameters — Parses `<…>` type parameter list if at `<`, else `[]`; [exp]; callers: 0 outside folder (3 in declarations/)
- parseTypeParameter(parser): TypeParameter — Parses `[gives|takes] [...]Name [in U] [is C] [= Default]` and checks variance/bounds; callers: 0 outside folder
- eatVariance(parser): VarianceMarker | undefined — Consumes contextual `gives` or `takes` before an identifier or `...`; callers: 0 outside folder

## src/compiler/parser/grammar/expressions/atoms.ts — Parenthesized expressions `(x)` and tuple expressions `()`, `(x,)`, `(x, y)`
- parseParenthesized(parser): Expression — Parses `(` list `)` into `Parenthesized` or `Tuple` via `parseGroup`; [exp]; callers: 0 outside folder (1 in expressions/)

## src/compiler/parser/grammar/expressions/branches.ts — Expressions with bodies: `if`/`elif`/`else`, `match`, `select`/`await select`, and `{…}` block expressions
- parseIf(parser): Expression — Parses `if` branch, aligned `elif` branches, and optional `else` clause; [exp]; callers: 0 outside folder (1 in expressions/)
- parseBranch(parser): ConditionalBranch — Parses `if cond: body` or `elif cond: body`; callers: 0 outside folder
- parseElse(parser): ElseClause — Parses `else: body`; callers: 0 outside folder
- parseMatch(parser): Expression — Parses `match subject:` and its indented `MatchCase`s; [exp]; callers: 0 outside folder (1 in expressions/)
- parseMatchCase(parser): MatchCase | Invalid — Parses `case pattern [if guard]: body`; callers: 0 outside folder
- parseSelect(parser): Expression — Parses non-waiting `select:`; [exp]; callers: 0 outside folder (1 in expressions/)
- parseSelectFrom(parser, start, awaits): Expression — Parses `select:` body, extracts final `else`, and reports non-final `else` (2020); [exp]; callers: 0 outside folder
- parseSelectLine(parser): SelectCase | ElseClause | Invalid — Parses `else: body` or `case future [as name]: body`; callers: 0 outside folder
- parseBlockExpression(parser): Expression — Parses `{ statements }` and reports single-line block without `;` (2012); [exp]; callers: 0 outside folder (1 in dir)

## src/compiler/parser/grammar/expressions/deferred-calls.ts — Deferred calls `taker call(args)` (§3.14) on the taker's line
- deferredCallParselet — Infix parselet at `deferredCall` (`prefix`) level parsing `taker call` on the taker's line; [exp]; callers: 0 outside folder (1 in expressions/)
- startsDeferredCall(parser, taker): boolean — Checks `isTakerShaped(taker)`, `onOperandLine(parser, 'identifier')`, and not `by`; callers: 0 outside folder

## src/compiler/parser/grammar/expressions/expression.ts — Pratt expression parser, prefix/infix parselet tables, and list-item-start derivation
- parseName(parser): Expression — Dispatches contextual operand words (`new`, `live`, `ista`), modified lambdas, or plain `Identifier`; callers: 0 outside folder
- unaryParselets(): Record<UnaryOperator, PrefixParselet> — Builds prefix parselets from `unaryOperators` table; callers: 0 outside folder
- parseExpression(parser, minLevel): Expression — Parses prefix operand and extends with infix/postfix operators at `>= minLevel`; [exp]; callers: 1 outside folder
- continueExpression(parser, left, minLevel): Expression — Loops `extend` to attach operators at `>= minLevel` to `left`; [exp]; callers: 1 outside folder (3 via parser)
- extend(parser, left, minLevel): Expression | undefined — Stops at item break, tries `<…>` type application, then dispatches `infixParselets`; callers: 0 outside folder
- startsExpression(parser): boolean — Tests if next token is in `prefixParselets` and doesn't spell `not in`; [exp]; callers: 1 outside folder (3 via parser)
- startsItemOnNewLine(kind, next, spaced): boolean — Derives from parselet tables whether `kind` at line start begins a new list item; [exp]; callers: 1 outside folder

## src/compiler/parser/grammar/expressions/lambdas.ts — Lambda expressions `fn(x): body`, `fn name(x): body`, and `fn x: body`
- parseLambda(parser): Expression — Parses lambda qualifiers, optional name, params, return type, and `: body`; [exp]; callers: 0 outside folder (1 in expressions/)
- parseLambdaParameters(parser): readonly (Parameter | Invalid)[] — Parses `(params)` or single bare identifier parameter; callers: 0 outside folder

## src/compiler/parser/grammar/expressions/literals/collections.ts — Bracket literals: `[a, b]`, `[k: v]`, `[:]`, `[for x in xs: body]`, and `[for k, v in ...s: body]`
- parseCollection(parser): Expression — Parses `[…]` into `ArrayLiteral`, `MapLiteral`, `Comprehension`, or `FieldComprehension`; [exp]; callers: 1 outside folder
- parseContents(parser): Contents — Dispatches after `[` to `for` comprehension, `:]` empty map, or comma-separated items; callers: 0 outside folder
- parseItem(parser): CollectionItem — Parses `...spread`, `key: value` (`MapEntry`), or element expression; callers: 0 outside folder
- toLiteral(parser, items, span): Expression — Builds `ArrayLiteral` or `MapLiteral`, reporting mixed elements/entries (2007); callers: 0 outside folder
- toMapItem(item): MapLiteral['entries'][number] — Wraps a stray plain expression in a `MapEntry` with a `Missing` value; callers: 0 outside folder
- parseComprehension(parser): ComprehensionParts — Parses `for targets in ...subject: body` or `for targets in iterable [if cond]: body`; callers: 0 outside folder

## src/compiler/parser/grammar/expressions/literals/indented-values.ts — Indented block values (`=`, `return`, `key:`, `T:`, `new T:`, `- item`)
- parseValue(parser, opener): Expression — Parses an `IndentedValue` when line ends at cursor or in `[new] T:`, else an expression; [exp]; callers: 1 outside folder
- parseNamedValue(parser, opener): IndentedValue | undefined — Speculates `[new] T:`, reports trailing tokens (2040), and parses block below; callers: 0 outside folder
- namedOpening(parser): Named | undefined — Parses `[new] NamedType:` for speculation; callers: 0 outside folder
- parseBlockValue(parser, opener, named): IndentedValue — Parses indented `entryRules` block below `columnAbove` and checks comprehensions; callers: 0 outside folder
- columnAbove(parser, opener): number — Computes minimum indentation column from `opener` line and enclosing block column; callers: 0 outside folder
- checkedEntries(parser, entries): readonly IndentedEntry[] — Calls `reportAfterComprehension` and returns `entries`; callers: 0 outside folder
- parseEntry(parser): IndentedEntry — Parses `- item`, `...spread`, `for` comprehension, `name: val`, shorthand `name`, or `"key": val`; callers: 0 outside folder
- parseItem(parser): IndentedItem — Parses `- value` entry starting at `-`; callers: 0 outside folder
- parseItemValue(parser, dash): IndentedItem['value'] — Parses value after `-`: nested block, spread, reported `- -`, keyed block, or expr; callers: 0 outside folder
- startsKeyedValue(parser): boolean — Tests if token after `-` starts `key: value` (string or non-type-cased identifier before `:`); callers: 0 outside folder
- parseKeyedValue(parser): IndentedValue — Parses `- key: value` and subsequent entries aligned with `key`'s column; callers: 0 outside folder

## src/compiler/parser/grammar/expressions/literals/struct-literals.ts — Struct literals `T{…}`, `struct{…}`, `new T{…}`, and struct comprehensions
- structComprehensionOpener — Token kind `'for'` opening a struct comprehension; [exp]; callers: 1 outside folder
- parseStructLiteralBody(parser, type, start): StructLiteral — Parses `{ items }` of a `StructLiteral`; [exp]; callers: 1 outside folder
- parseNew(parser): Expression — Parses `new Name<T>{…}` into `NewStructLiteral` or reports missing literal (2025); [exp]; callers: 1 outside folder
- parseAnonymousStructLiteral(parser): Expression — Parses `struct{…}` into `StructLiteral` with `type: undefined`; [exp]; callers: 1 outside folder
- parseItems(parser): FieldsLiteral['items'] — Parses `{…}` items and reports non-alone positional (2006) or bad comprehension (2032); callers: 0 outside folder
- reportAfterComprehension(parser, items): void — Reports any item after a `StructComprehension` or any `Spread` beside it (2032); [exp]; callers: 0 outside folder
- parseItem(parser): FieldsLiteral['items'][number] — Parses `...spread`, `for` comprehension, `name: val`, shorthand, or positional; callers: 0 outside folder
- parseStructComprehension(parser): StructComprehension — Parses `for k, v in ...x: [k]: value` and checks `[k]` matches key (2033); [exp]; callers: 0 outside folder

## src/compiler/parser/grammar/expressions/literals/templates.ts — Untagged `` `…` `` and tagged `` tag`…` `` template literals
- parseTemplate(parser): Expression — Parses an untagged `TemplateLiteral`; [exp]; callers: 1 outside folder
- templateParselet — Postfix parselet attaching a `TemplateLiteral` to its `tag` expression; [exp]; callers: 1 outside folder
- templateLiteral(parser, tag): Expression — Builds `TemplateLiteral` from scanned text segments and interpolated `${…}` token lists; callers: 0 outside folder
- parseValue(parser, value): Expression — Parses one `${…}` interpolation's tokens, reporting empty `${}` (2100) or trailing tokens; callers: 0 outside folder

## src/compiler/parser/grammar/expressions/operators.ts — Prefix (`-`, `~`, `not`, `*`, `**`, `await`, `&`, `..`), binary,chained comparison, `is`, and range parselets
- advancePrefix(parser, level, minLevel): Prefix — Advances prefix operator token and reports if looser than `minLevel` (2005); callers: 0 outside folder
- prefixOperand(parser, prefix, level): Expression — Parses prefix operand at `level` and reports unparenthesized prefix before `**` (2070); callers: 0 outside folder
- unaryParselet(operator): PrefixParselet — Creates prefix parselet for `-`, `~`, or `not`; [exp]; callers: 0 outside folder (1 in expressions/)
- parseDereference — Prefix parselet for `*x` (`Dereference`); [exp]; callers: 0 outside folder (1 in expressions/)
- parseDoubleDereference — Prefix parselet splitting `**x` into two nested `Dereference` nodes; [exp]; callers: 0 outside folder (1 in expressions/)
- parseAwait — Prefix parselet for `await expr` and `await select:`; [exp]; callers: 0 outside folder (1 in expressions/)
- parseReference(parser): Reference — Parses `&expr` at `reference` precedence level; [exp]; callers: 0 outside folder (1 in expressions/)
- parseMisplacedReference — Parses `&expr` outside a call argument and reports 2004; [exp]; callers: 0 outside folder (1 in expressions/)
- parseOpenRange — Prefix parselet for `..b`, `..=b`, and `..`; [exp]; callers: 0 outside folder (1 in expressions/)
- parseRangeRest(parser, start, first, isInclusive): Range — Parses optional range end and `by step`; callers: 0 outside folder
- parseRangeEnd(parser, isInclusive): Expression | undefined — Parses range end unless at `by` or item break, reporting missing `..=` end; callers: 0 outside folder
- rangeParselet(isInclusive): InfixParselet — Creates infix parselet for `a..b` or `a..=b`; [exp]; callers: 0 outside folder (1 in expressions/)
- isParselet — Infix parselet for `expr is pattern`; [exp]; callers: 0 outside folder (1 in expressions/)
- binaryParselet(operator): InfixParselet — Creates infix parselet for single-token binary operators; [exp]; callers: 0 outside folder (1 in expressions/)
- notInParselet — Infix parselet for two-word `not in` operator; [exp]; callers: 0 outside folder (1 in expressions/)
- parseBinaryRest(parser, left, operator): Expression — Parses right operand, reports mixed operators (2003), and builds `Binary`/chain; callers: 0 outside folder
- comparisonsOf(node): Pick<ChainedComparison, 'operands' | 'operators'> | undefined — Extracts chainable comparison parts from `left`; callers: 0 outside folder
- reportMixed(parser, operator, refused, operands): void — Reports unparenthesized operands using operators in `refused` (2003); callers: 0 outside folder

## src/compiler/parser/grammar/expressions/parselet.ts — Prefix and infix Pratt parselet types
- PrefixParselet — `(parser: Parser, minLevel: PrecedenceLevel) => Expression`; [exp]; callers: 0 outside folder (2 in expressions/)
- InfixParselet — `{ level, parse, onOperandLine? }` descriptor for infix/postfix operators; [exp]; callers: 1 outside folder

## src/compiler/parser/grammar/expressions/postfix.ts — Postfix parselets: `<…>` type applications, calls, indexing, `.`/`?.`/`->`/`?->`, `.0`, `?`, `!`, and `T{…}`
- parseTypeApplication(parser, left): Expression | undefined — Speculatively parses `name<…>[{…}]` when type-cased and not compared; [exp]; callers: 0 outside folder
- parseCommittedTypeApplication(parser, left): Expression | undefined — Parses `name<…>[{…}]` in annotations without comparison check; [exp]; callers: 1 outside folder
- appliedName(parser, left, parse): Expression | undefined — Attaches `<…>` parsed by `parse` (and trailing `{…}`) to a qualified name; callers: 0 outside folder
- namesTypesOnly(types): boolean — Checks that every `NamedType` and `MemberType` in `types` is cased as a type; callers: 0 outside folder
- typeNamesOf(node): readonly Identifier[] — Extracts type-name identifiers from a `NamedType` (past namespace prefix) or `MemberType`; callers: 0 outside folder
- endsTypeArguments(parser): boolean — Tests if token after `>` ends type arguments (`(`, `{`, item break, or non-expression without split `>`); callers: 0 outside folder
- parseCall(parser, callee, isOptional): Call — Parses `(arguments)` and reports positional argument after named (2050); callers: 0 outside folder
- parseArgument(parser): CallArgument — Parses `...spread`, `name: value` (`NamedArgument`), or value argument; callers: 0 outside folder
- parseArgumentValue(parser): Expression — Parses argument value, validating `&place` (2004, 2023); callers: 0 outside folder
- callParselet — Postfix parselet for `callee(…)`; [exp]; callers: 0 outside folder (1 in expressions/)
- indexParselet — Postfix parselet for `target[index]`; [exp]; callers: 0 outside folder (1 in expressions/)
- parseIndex(parser, target, isOptional): Index — Parses `[index]` into `Index`; callers: 0 outside folder
- memberParselet — Postfix parselet for `target.member` and `target.0`; [exp]; callers: 0 outside folder (1 in expressions/)
- optionalParselet — Postfix parselet for `target?.member`, `target?.0`, `target?.(…)`, and `target?.[…]`; [exp]; callers: 0 outside folder (1 in expressions/)
- arrowParselet(isOptional): InfixParselet — Postfix parselet desugaring `x->f` / `x?->f` into `MemberAccess` on `Dereference`; [exp]; callers: 0 outside folder
- parseMember(parser, target, isOptional): Expression — Parses `.member` (`MemberAccess`) or `.0` / `.0.1` (`TupleElement`); callers: 0 outside folder
- parseTupleElements(parser, left, isOptional): Expression — Parses number token after `.` into one or two `TupleElement` nodes (2200); callers: 0 outside folder
- propagateParselet — Postfix parselet for `operand?` (`Propagate`); [exp]; callers: 0 outside folder (1 in expressions/)
- unwrapParselet — Postfix parselet for `operand!` (`Unwrap`); [exp]; callers: 0 outside folder (1 in expressions/)
- structLiteralParselet — Postfix parselet for `Name{…}` after a qualified name; [exp]; callers: 0 outside folder (1 in expressions/)

## src/compiler/parser/grammar/index.ts — Grammar category wiring into `Parser`
- createParser(source, scanned): Parser — Instantiates `Parser` wired with all grammar category entry points wrapped in `nested`; [exp]; callers: 1 outside folder

## src/compiler/parser/grammar/nesting.ts — Recursion depth guard (`nestingLimit = 200`) keeping recursive descent total
- nested(parser, parse): Node | Invalid — Runs `parse` one nesting level deeper or skips over-deep construct as `Invalid` (2022); [exp]; callers: 2 outside folder
- skipTooDeep(parser): Invalid — Reports `nestingTooDeep` (2022) and skips current region and deeper following lines; callers: 0 outside folder

## src/compiler/parser/grammar/parts/blocks.ts — Module and block items, misplaced item recovery, and statement `Block` bodies
- statementRules — `ItemRules<Statement>` for `;`-separated annotated block statements; [exp]; callers: 1 outside folder
- parseHeaderBody(parser, headerStart): Block — Expects `:` and parses a statement `Block` body; [exp]; callers: 2 outside folder
- parseStatementBody(parser, headerStart): Block — Parses a statement body via `parseBody` and wraps in `Block`; callers: 0 outside folder
- parseDocumentedStatementBody(parser, headerStart, enter): WithDocstring<Block> — Parses function's documented `Block` body; [exp]; callers: 1 outside folder
- parseModuleItem(parser): Declaration | Invalid — Parses any item and reports statements disallowed at module level (2013); [exp]; callers: 1 outside folder
- parseBlockItem(parser): Statement | Invalid — Parses any item and reports declarations disallowed in a block (2014); callers: 0 outside folder
- misplaced(parser, item, diagnostic): Invalid — Reports misplaced item (unless empty `Missing`) and wraps full span in `Invalid`; callers: 0 outside folder

## src/compiler/parser/grammar/parts/cases.ts — Shared `case` line wrapper and error recovery for `match`, `select`, and type `match`
- parseCase(parser, parseRest): Case | Invalid — Expects `case` and runs `parseRest`, or skips bad line to `lineBreak` as `Invalid`; [exp]; callers: 2 outside folder

## src/compiler/parser/grammar/parts/constraints.ts — Trait and `struct { … }` constraints after `is`
- parseConstraints(parser): ConstraintNode[] — Parses `&`-joined trait types or `struct` constraints after `is`; [exp]; callers: 3 outside folder
- parseStructConstraint(parser): StructConstraint — Parses `struct` or `struct { entries }`; [exp]; callers: 2 outside folder
- parseConstraintEntry(parser): FieldEntry — Parses `name: Type`, `name is C`, `[_]: Type`, or `[_] is C`; [exp]; callers: 0 outside folder (1 in parts/)
- parseEntryField(parser): EntryField — Parses field identifier or `[_]` (`OtherFields`); callers: 0 outside folder

## src/compiler/parser/grammar/parts/field-headers.ts — Shared `for key, value in ...subject` header for field loops and comprehensions
- parseFieldHeaderAfter(parser, start, targets): FieldHeader — Parses `...subject`, reports `if` (2037) or bad targets (2030, 2031); [exp]; callers: 3 outside folder

## src/compiler/parser/grammar/parts/functions.ts — Function and lambda parameter lists `(a: Int, Point{x, y} as p, ...rest = d)`
- parseParameters(parser): readonly (Parameter | Invalid)[] — Parses comma-delimited `(…)` parameter list; [exp]; callers: 2 outside folder
- parseParameter(parser): Parameter — Parses `[...]name` or parameter pattern (`as name`), `: parameterType`, and `= defaultValue`; callers: 0 outside folder
- startsPattern(parser): boolean — Tests if parameter binding starts a pattern rather than a plain identifier; callers: 0 outside folder
- bindingOf(pattern): ParameterBinding — Splits `AsPattern` into `{ name, pattern }` or `{ name: undefined, pattern }`; callers: 0 outside folder

## src/compiler/parser/grammar/parts/heads.ts — Declaration, function, lambda, and type heads: order-free modifiers and named marks (`M fn`, `Self.Mode fn`)
- HeadAhead — Lookahead summary of a head: `modifiers`, `named` mark flag, `keyword`, and token `length`; [exp]; callers: 0 outside folder
- headAhead(parser, withMark = false): HeadAhead | undefined — Looks past modifiers (and optional mark name) to `fn`/`struct`/`const`; [exp]; callers: 5 outside folder
- wordsAhead(parser, withMark): Omit<HeadAhead, 'keyword'> — Scans consecutive modifier words and optional mark path ahead of cursor; callers: 0 outside folder
- parseHead(parser, form): Modifiers — Parses modifiers and keyword for `form`, reporting misplaced/repeated/conflicting words; [exp]; callers: 5 outside folder
- parseFunctionHead(parser, form): { modifiers, mark } — Parses a declared function's modifiers, optional named mark, and `fn`; [exp]; callers: 1 outside folder
- readHead(parser, form, withMark): { modifiers, mark } — Core loop consuming modifiers and optional mark name before expecting `form.keyword`; callers: 0 outside folder
- readModifier(parser, form, word, head): void — Records modifier in its group or reports misplaced (2046), repeated (2044), or conflicting; callers: 0 outside folder
- readMark(parser, head): void — Parses named mark `NamedType` and records it or reports conflict with existing kind/mark (2045); callers: 0 outside folder
- markNameLength(parser, ahead): number — Measures token length of `M` or `A.B` mark path before `fn` or another modifier; callers: 0 outside folder
- parseMarkName(parser): NamedType — Parses dot-separated mark identifiers into a `NamedType`; callers: 0 outside folder

## src/compiler/parser/grammar/parts/levels.ts — Fixed-level operator loop shared by pattern and type grammars
- LeveledParselet<Level, Node> — `{ level, parse }` operator extension descriptor for `leveledGrammar`; [exp]; callers: 2 outside folder
- leveledGrammar(levels, primary, operators): (parser, minLevel) => Node — Builds precedence parser for fixed operator levels; [exp]; callers: 2 outside folder

## src/compiler/parser/grammar/parts/literals.ts — Scalar literals and negative number literals (`-1`) for expressions, patterns, and types
- literalFrom(parser, token): Literal | undefined — Converts a literal token (`integer`, `float`, `duration`, `string`, bool, `none`) to AST; [exp]; callers: 1 outside folder
- parseLiteral(parser): Literal — Consumes literal token at cursor and returns its `Literal` node; [exp]; callers: 3 outside folder
- Negatable — Allowed number token kinds and expected description after `-`; [exp]; callers: 2 outside folder
- parseNegativeLiteral(parser, negatable): Unary — Parses `-` followed by a literal of `negatable.kinds` into `Unary`; [exp]; callers: 2 outside folder

## src/compiler/parser/grammar/parts/names.ts — Qualified names `a.b.C`, `NamedType` builder, and comma-separated binding targets
- parseQualifiedName(parser): QualifiedName — Parses `a.b.c` dot-separated identifiers; [exp]; callers: 2 outside folder
- parseTargets(parser): Pattern[] — Parses `p1, p2, …` comma-separated target patterns; [exp]; callers: 4 outside folder
- namedTypeFrom(parser, path, typeArguments): NamedType — Builds `NamedType` spanning from `path[0]` to cursor end; [exp]; callers: 3 outside folder

## src/compiler/parser/grammar/parts/spreads.ts — `...` opener token and `Spread` expression parser
- spreadOpener — Token kind `'...'` opening spreads and rests; [exp]; callers: 8 outside folder
- parseSpread(parser): Spread — Parses `...expression` into `Spread`; [exp]; callers: 4 outside folder

## src/compiler/parser/grammar/parts/structs.ts — `struct` keyword before `{`, struct/variant field declarations, mapped fields `[F in U]: T`, and field blocks
- afterStructKeyword(parser, parseBraced): Body | Missing — Eats optional `struct`, reports missing `{` after it, or runs `parseBraced`; [exp]; callers: 3 outside folder
- parseField(parser): FieldDeclaration — Parses `name: Type` (or indented field block) and reports misplaced `= default` (2024); [exp]; callers: 1 outside folder
- parseDeclaredField(parser, parseType): DeclaredField — Parses `name: Type [= default]` or `name = default` for struct/variant declarations; callers: 0 outside folder
- parseMappedField(parser): MappedField — Parses `[F in U]: Type` mapped field entry in an anonymous struct type; callers: 0 outside folder
- parseMappedParameter(parser): TypeParameter — Parses `F in U` inside `[…]` into a member `TypeParameter`; callers: 0 outside folder
- parseFieldEntry(parser): FieldDeclaration | MappedField | Invalid — Dispatches struct type entry to constraint entry, mapped field, or field; callers: 0 outside folder
- startsConstraintEntry(parser): boolean — Tests if entry starts with `[_]` or `name is`; callers: 0 outside folder
- parseMisplacedConstraintEntry(parser): Invalid — Parses struct constraint entry inside a struct type and reports 2035; callers: 0 outside folder
- declaredFieldRules — `ItemRules<DeclaredField>` for struct declaration fields; [exp]; callers: 1 outside folder
- parseVariantField(parser): DeclaredField — Parses `[...]name: Type [= default]` for an enum variant field; callers: 0 outside folder
- variantFieldRules — `ItemRules<DeclaredField>` for enum variant fields; [exp]; callers: 1 outside folder
- parseFieldEntries(parser): Enclosed<StructType['fields']> — Parses `{ a: A, b: B }` field list for a `StructType`; [exp]; callers: 1 outside folder

## src/compiler/parser/grammar/patterns.ts — Pattern grammar (`|`, ranges, `as`, tuples, arrays, struct patterns, variant call patterns, parameter `{…}`)
- withAsName(parser, pattern): Pattern — Attaches trailing `as name` (`AsPattern`) if present; callers: 0 outside folder
- patternGrammar(starts): NestedPattern — Instantiates leveled pattern parser over `starts` (`parsePattern` vs `parseParameterPattern`); callers: 0 outside folder
- parsePattern(parser): Pattern — Parses a general pattern (§3.11); [exp]; callers: 0 outside folder (1 in grammar/)
- parseParameterPattern(parser): Pattern — Parses a parameter pattern where `{…}` is short for `struct{…}` (§3.3); [exp]; callers: 0 outside folder (1 in grammar/)
- parseOrPattern(parser, first, alternative): Pattern — Parses `A | B | C` into `OrPattern`; callers: 0 outside folder
- parseArrayPattern(parser, inner): Pattern — Parses `[elements]` with `...rest` and reports extra rests (2071); callers: 0 outside folder
- parseRestPattern(parser): RestPattern — Parses `...name` or `..._`; callers: 0 outside folder
- parseWildcard(parser): WildcardPattern | undefined — Consumes `_` identifier as `WildcardPattern`; callers: 0 outside folder
- parseRangePattern(parser, start): Pattern — Parses `start..[=]end` range pattern and validates literal bounds (2026); callers: 0 outside folder
- parseOpenRangePattern(parser): Pattern — Parses `..end` or `..=end` open-start range pattern; callers: 0 outside folder
- parseRangeBound(parser, required): LiteralPattern | undefined — Parses range pattern's upper literal bound; callers: 0 outside folder
- boundOf(parser, bound): LiteralPattern | undefined — Verifies range bound is a `LiteralPattern` or reports 2026; callers: 0 outside folder
- parseNamedPattern(parser, inner): Pattern — Parses `_`, `Path<T>(args)`, `Path<T>{fields}`, or `NamePattern`; callers: 0 outside folder
- parseVariantCallPattern(parser, inner, callee): VariantCallPattern — Parses `(args)` of call pattern and checks rests/order; callers: 0 outside folder
- givenAs(argument): 'name' | 'position' | undefined — Classifies call pattern argument for positional-after-named check; callers: 0 outside folder
- parsePatternArgument(parser, inner): PatternArgument — Parses `...rest`, lone `...` (`OtherFieldsPattern`), `name: pattern`, or pattern; callers: 0 outside folder
- parsePatternTypeArguments(parser): readonly TypeNode[] — Speculatively parses `<…>` after a pattern name when no operator continues; callers: 0 outside folder
- parseStructPattern(parser, inner, head, start?): Pattern — Parses `{fields, ...rest}` and reports misplaced or extra `...rest` (2034); callers: 0 outside folder
- parseFieldPattern(parser, inner): StructPattern['fields'][number] — Parses `field [as alias]`, `field op expr`, or `field is pattern`; callers: 0 outside folder
- parseTuplePattern(parser, inner): Pattern — Parses `(…)` into `TuplePattern` or `ParenthesizedPattern`; callers: 0 outside folder

## src/compiler/parser/grammar/statements/loops.ts — `for`, `for k, v in ...x` (`FieldLoop`), `while`, and `label:` statements
- parseFor(parser): For | FieldLoop — Parses unlabeled `for` or `FieldLoop`; [exp]; callers: 0 outside folder (1 in statements/)
- parseWhile(parser): While — Parses unlabeled `while`; [exp]; callers: 0 outside folder (1 in statements/)
- atLabel(parser): boolean — Tests if cursor is at `identifier :`; [exp]; callers: 0 outside folder (1 in statements/)
- parseLabelled(parser, statement): Statement | Invalid — Parses `label:` before block, `for`, `while`, or reports 2130; [exp]; callers: 0 outside folder (1 in dir)
- parseForAfter(parser, start, label): For | FieldLoop — Parses `for targets in ...x: body` (`FieldLoop`) or `for targets in xs: body` (`For`); callers: 0 outside folder
- parseWhileAfter(parser, start, label): While — Parses `while condition: body`; callers: 0 outside folder

## src/compiler/parser/grammar/statements/simple.ts — `return`, `break`, `continue`, and `drop` statements
- parseReturn(parser): Return — Parses `return [value]` (inline expression or indented value below); [exp]; callers: 0 outside folder (1 in statements/)
- returnsValue(parser, start): boolean — Tests if an expression or deeper indented line follows `return`; callers: 0 outside folder
- parseBreak(parser): Break — Parses `break [label]`; [exp]; callers: 0 outside folder (1 in statements/)
- parseContinue(parser): Continue — Parses `continue [label]`; [exp]; callers: 0 outside folder (1 in statements/)
- parseDrop(parser): Drop — Parses `drop expression`; [exp]; callers: 0 outside folder (1 in statements/)

## src/compiler/parser/grammar/statements/statement.ts — Statement dispatch, local functions, held variables, labels, expressions, and assignments
- parseStatement(parser): Statement | Invalid — Dispatches statement keyword, identifier, or expression/assignment statement; [exp]; callers: 1 outside folder
- parseLocalFunction(parser): Statement | undefined — Parses local `FunctionDeclaration` when a `fn` head is followed by a name; callers: 0 outside folder
- parseNamedStatement(parser): Statement | Invalid — Dispatches `hold`, modified local `fn`, `label:`, or expression/assignment; callers: 0 outside folder
- parseExpressionStatement(parser): Statement — Parses expression, optional `, target` list and assignment (`Assignment`), or statement; callers: 0 outside folder
- parseMoreTargets(parser, first): Expression[] | undefined — Speculatively parses `, target2, …` when followed by an assignment operator; callers: 0 outside folder

## src/compiler/parser/grammar/statements/variables.ts — `let`, `const`, and `hold` / `hold(label)` variable declarations
- parseVariable(parser): VariableDeclaration — Parses `let` or `const` declaration; [exp]; callers: 0 outside folder (1 in statements/)
- startsHeldVariableAt(parser, ahead): boolean — Tests if `let`, `const`, or `_ =` stands at `ahead`; callers: 0 outside folder
- atHold(parser): boolean — Tests if `hold` or `hold(name)` at cursor starts a held variable declaration; [exp]; callers: 0 outside folder (1 in statements/)
- parseHeldVariable(parser): VariableDeclaration — Parses `hold [(label)] [let|const] targets [: T] = value`; [exp]; callers: 0 outside folder (1 in statements/)
- parseVariableAfter(parser, start, hold): VariableDeclaration — Parses `[let|const] targets [: T] = value` after optional `hold`; callers: 0 outside folder

## src/compiler/parser/grammar/types.ts — Type grammar: unions, `?`/`??`, `.Name`, `[K]`, `keyof`, `infer`, tuples, `fn`, `any`, `{…}`, `&T`, literals
- parseType(parser): TypeNode — Parses a type at the loosest (`union`) level; [exp]; callers: 0 outside folder (1 in grammar/)
- parsePrimaryType(parser): TypeNode — Dispatches primary type token or modified function type; callers: 0 outside folder
- parseUnionType(parser, first): TypeNode — Parses `A | B | C` into `UnionType`; callers: 0 outside folder
- parseParameterType(parser): TypeNode — Parses `&T` (`ReferenceType`) or a regular `TypeNode`; [exp]; callers: 0 outside folder (1 in grammar/)
- parseWordType(parser): TypeNode — Dispatches contextual type words (`sendable`, `live`, `ista`, `any`, `keyof`, `infer`) or `NamedType`; callers: 0 outside folder
- parseOptionalType(parser, inner): TypeNode — Parses `T?` or splits `T??` into two nested `OptionalType` nodes; callers: 0 outside folder
- parseMemberType(parser, owner): TypeNode — Parses `.Name` associated type access after a non-path type; callers: 0 outside folder
- parseIndexedType(parser, owner): TypeNode — Parses `Owner[Key]` (`IndexedType`); callers: 0 outside folder
- parseKeyofType(parser): TypeNode — Parses `keyof Owner` (`KeyofType`) at postfix level; callers: 0 outside folder
- parseInferType(parser): TypeNode — Parses `infer T [is C]` (`InferType`) in a type match pattern; callers: 0 outside folder
- parseTypeArguments(parser): readonly TypeNode[] — Parses `<A, B>` comma-delimited type arguments; [exp]; callers: 0 outside folder (1 in grammar/)
- parseNamedType(parser): TypeNode — Parses `QualifiedName` and optional `<…>` type arguments into `NamedType`; callers: 0 outside folder
- parseTupleType(parser): TypeNode — Parses `(…)` into `TupleType` or `ParenthesizedType` (reporting `(&T)` in grouping parens, 2004); callers: 0 outside folder
- parseFunctionType(parser): TypeNode — Parses `[modifiers] fn(params) [-> ReturnType]`; callers: 0 outside folder
- parseParameterTypes(parser): FunctionType['parameters'] — Parses `(paramTypes)` allowing `&T` and `...RestType`; callers: 0 outside folder
- parseRestType(parser): RestType — Parses `...Type` rest parameter type; callers: 0 outside folder
- parseAnyType(parser): TypeNode — Parses `any Trait1 & Trait2` into `AnyType`; callers: 0 outside folder
- parseAnyTrait(parser): TypeNode — Parses trait `NamedType` after `any`, or reports `struct` constraint after `any` (2036); callers: 0 outside folder
- parseStructType(parser): TypeNode — Parses `[struct] { fields }` into `StructType`; callers: 0 outside folder
- parseReferenceType(parser): ReferenceType — Parses `&Type` into `ReferenceType`; callers: 0 outside folder
- parseMisplacedReferenceType(parser): TypeNode — Parses `&Type` outside parameter position and reports 2004; callers: 0 outside folder

## src/compiler/parser/grammar/word-parselets.ts — Type-checked parselet tables keyed by `syntax/tokens/grammar-words.ts`
- StartParselets<Words, Parselet> — Table type requiring a parselet for every `Keyword` in `Words`; [exp]; callers: 3 outside folder
- WordParselets<Words, Parselet> — Table type requiring a parselet for every `ContextualWord` in `Words`; [exp]; callers: 3 outside folder
- wordParseletAt(parser, parselets): Parselet | undefined — Looks up the contextual word at the cursor in `parselets`; [exp]; callers: 3 outside folder
- followsModifier(parser, modifier, ahead = 1): boolean — Tests if token at `ahead` is in `followers[modifier]`; [exp]; callers: 1 outside folder

## src/compiler/parser/incremental/held-bodies.ts — Filtering recorded function bodies to those reachable from the final syntax tree
- bodiesHeldBy(nodes, recorded): Map<FunctionDeclaration, Block> — Keeps `recorded` bodies of reachable `FunctionDeclaration`s; [exp]; callers: 1 outside folder

## src/compiler/parser/incremental/reuse.ts — Incremental AST segment reuse across edits
- reusingSegments(fresh, previous): SyntaxTree — Replaces unchanged header/body segments in `fresh` with `previous`'s AST nodes; [exp]; callers: 1 outside folder
- SegmentReuse.items(): readonly Item[] — Matches `fresh.root.items` runs against unused `previous` runs by line-start text and column; callers: 0 outside folder
- SegmentReuse.bodies(): ReadonlyMap<FunctionDeclaration, Block> — Collects bodies of kept new nodes and reused old functions; callers: 0 outside folder
- SegmentReuse.#taken(run): Run<Item> | undefined — Finds and consumes the first unused old run matching `run` and reuses its segments; callers: 0 outside folder
- SegmentReuse.#sameRun(old, run): boolean — Compares two segment runs by text, column, node count, and per-node structure; callers: 0 outside folder
- SegmentReuse.#sameNode(old, node): boolean — Checks kind, trait member runs, and function body presence equality; callers: 0 outside folder
- SegmentReuse.#reuse(old, run): void — Moves `run`'s header/member/body segment bases to `old`'s segments; callers: 0 outside folder
- SegmentReuse.#reuseBody(old, fresh): void — Reuses `old`'s body segment when text and column match, else records `fresh`'s body; callers: 0 outside folder
- runsOf(tree, nodes): readonly Run<Node>[] — Groups consecutive nodes sharing a `Segment` and extracts their header `SegmentText`; callers: 0 outside folder
- endInSegment(tree, node): number — Computes node's end offset within its segment (including inline function body); callers: 0 outside folder
- segmentText(tree, segment, to): SegmentText — Slices source text from line start of `segment` to `to` and computes its column; callers: 0 outside folder

## src/compiler/parser/layout/annotations.ts — `@Annotation` parsing, shape validation, and attachment to items
- annotationOpener — Token kind `'@'` opening an annotation; [exp]; callers: 0 outside folder (2 in layout/)
- parseAnnotation(parser): Annotation | undefined — Parses `@value` at postfix level and checks shape (2017); [exp]; callers: 0 outside folder (1 in layout/)
- isAnnotationShape(value): boolean — Checks if `value` is a typed `StructLiteral`, `TypeApplication` on a path, `Missing`, or qualified path; callers: 0 outside folder
- attachAnnotations(parser, item, annotations): Item | Invalid — Attaches `annotations`, widens span, and moves function body; [exp]; callers: 4 outside folder
- rejectAnnotations(parser, annotations, diagnostic): Invalid[] — Reports dangling/misplaced `annotations` as `Invalid`; [exp]; callers: 0 outside folder (1 in layout/)

## src/compiler/parser/layout/bodies.ts — Construct bodies after `:`, documented bodies/members, and trailing docstrings below headers
- Members<Item> — Parsed body items, `headedSegments` flag, and `headerEnd` offset; [exp]; callers: 0 outside folder
- Body<Item> — `Members<Item>` with an `AnchoredSpan` covering the items; [exp]; callers: 0 outside folder
- BodyEntry — Wrapper callback `(<Result>(parse: () => Result) => Result)` entering a body segment; [exp]; callers: 1 outside folder
- parseBody(parser, rules, headerStart): Body<Item> — Parses inline or indented body after `:` relative to `headerStart`'s indentation; [exp]; callers: 4 outside folder
- parseBlockBelow(parser, rules, column): Body<Item> — Parses inline or indented body right of `column`; [exp]; callers: 1 outside folder
- parseDocumentedBody(parser, rules, headerStart, enter): WithDocstring — Parses function body with optional leading docstring; [exp]; callers: 1 outside folder
- parseDocumentedMembers(parser, rules, headerStart): WithDocstring — Parses type declaration members with optional docstring; [exp]; callers: 1 outside folder
- parseDocstringBelow(parser, headerStart): Docstring | undefined — Parses docstring on next line deeper than `headerStart`; [exp]; callers: 2 outside folder
- parseBodyOf(parser, rules, reading): WithDocstring — Core body parser for indented blocks, inline bodies, and `;` after inline body (2011); callers: 0 outside folder
- entered(parser, enter, parse, describe): Members<Item> & Extra — Records `headerEnd` and runs `parse` and `describe` inside `enter`; callers: 0 outside folder
- spanOfItems(parser, items): AnchoredSpan — Computes span from first item to whole span of last item, or empty at `previousEnd`; callers: 0 outside folder

## src/compiler/parser/layout/continuations.ts — Construct continuations (`elif`, `else`) across line breaks and skipping deeper lines
- moveToContinuation(parser, keyword, constructStart): boolean — Crosses break if `keyword` starts next line at `constructStart` col; [exp]; callers: 1 outside folder
- skipDeeperLines(parser, indentation): void — Crosses and skips all following lines indented deeper than `indentation`; [exp]; callers: 1 outside folder

## src/compiler/parser/layout/docstrings.ts — Docstring node creation, misplaced docstring reporting, and optional `doc` property helper
- WithDocstring<Value> — `{ value, doc }` pair returned by documented body/module parsers; [exp]; callers: 3 outside folder
- parseDocstring(parser): Docstring | undefined — Consumes `'docstring'` token at cursor into a `Docstring` node; [exp]; callers: 0 outside folder (2 in layout/)
- misplacedDocstring(parser): Invalid — Advances docstring token, reports `misplacedDocstring` (2101), and returns `Invalid`; [exp]; callers: 1 outside folder
- documentedBy(doc): Documented — Returns `{ doc }` when defined or `{}` when undefined; [exp]; callers: 4 outside folder

## src/compiler/parser/layout/index.ts — Block layout engine: indentation columns, separators (`;` vs `,`), annotations, and docstrings
- ItemRules<Item> — Item parser, separator (`';' | ',' | 'lineBreak'`), `headsSegments`, and `annotate` hook; [exp]; callers: 8 outside folder
- Items<Item> — `readonly (Item | Invalid)[]`; [exp]; callers: 1 outside folder
- Lines<Item> — Block parse result: `items`, `headedSegments`, and `separated`; [exp]; callers: 0 outside folder
- parseAnnotatedItems(parser, rules): Items<Item> — Parses one line item with annotations and rejects dangling ones (2015); [exp]; callers: 0 outside folder (1 in dir)
- parseModuleLines(parser, rules): WithDocstring<Items<Item>> — Parses module block at col 0 (reporting indent, 2008) and docstring; [exp]; callers: 1 outside folder
- parseBlockBraces(parser, rules): Enclosed<Lines<Item>> — Parses `{ … }` block expression items at column of first inner token; [exp]; callers: 1 outside folder
- parseItemEntries(parser, opener, rules): Enclosed<Items<Item>> — Parses `{…}` or `(…)` comma/newline list of annotated items; [exp]; callers: 3 outside folder
- parseListItem(parser, rules): Items<Item> — Duplicate of `parseAnnotatedItems` for list items; callers: 0 outside folder
- parseLines(parser, rules): Lines<Item> — Parses all lines of current block, restoring segment if `rules.headsSegments`; [exp]; callers: 1 outside folder
- parseLinesOf(parser, rules, headsSegments): Lines<Item> — Main block loop advancing lines, starting header segments, skipping separators; callers: 0 outside folder
- parseLine(parser, rules, pending, headsSegment): LineItem<Item> — Parses one item on a one-line region and skips trailing tokens to separator; callers: 0 outside folder
- parseLineItem(parser, rules, pending, headsSegment): LineItem — Parses leading annotations, item (or bad docstring), and trailing annotations; callers: 0 outside folder
- parseAnnotationsWhile(parser, goesOn): Annotation[] — Loops `parseAnnotation` while at `@` and `goesOn()` holds; callers: 0 outside folder
- annotate(parser, rules, item, annotations): Items<Item> — Attaches annotations via `rules.annotate` or rejects as misplaced (2016); callers: 0 outside folder
- skipSeparators(parser, separator): boolean — Consumes `;` or `,` separators and reports wrong separator kind (2038, 2039); callers: 0 outside folder
- moveToItem(parser): boolean — Inspects next line's column via `placeOfNextLine`, reports 2008/2009, and crosses line break; callers: 0 outside folder
- placeOfNextLine(parser, next): 'sameBlock' | 'deeper' | 'strayDedent' | 'ownCloser' | 'outside' — Classifies next line relative to block; callers: 0 outside folder

## src/compiler/parser/layout/item-breaks.ts — Line-break item separation inside bracketed lists and same-line postfix attachment
- breakSeparatesItems(parser, ahead = 0): boolean — Tests if token at `ahead` starts a list line and begins a new item; [exp]; callers: 5 outside folder
- continues(parser): boolean — Tests if next token continues the current list item (`!breakSeparatesItems`); [exp]; callers: 2 outside folder
- eatContinuing(parser, kind): Token | undefined — Consumes `kind` only when `continues(parser)` holds; [exp]; callers: 2 outside folder
- atPostfix(parser, kind): boolean — Tests if `kind` is next on the operand's line (not starting a new line in a list); [exp]; callers: 7 outside folder
- onOperandLine(parser, kind): boolean — Tests if `kind` is next on the same line in any region; [exp]; callers: 1 outside folder

## src/compiler/parser/parse.ts — Parser phase entry point (`parse`)
- parse(source, scanned, previous?): SyntaxTree — Parses `source` + `scanned` into `SyntaxTree`, reusing segments from `previous`; [exp]; callers: 4 outside folder

## src/compiler/parser/parser.ts — `Parser` context: segments, bodies, diagnostics, speculation, nesting, and grammar category entry points
- Grammar — Record of grammar category entry points wired by `grammar/index.ts`; [exp]; callers: 1 outside folder
- nestingLimit — Maximum recursion depth (`200`); [exp]; callers: 1 outside folder
- Parser — Parsing state and helpers passed to all grammar functions; [exp]; callers: 46 outside folder
- Parser.withinTemplateValue(value, parse): Result — Swaps cursor to a template `${…}` value's token list and runs `parse`; callers: 1 outside folder
- Parser.anchor(span: Span): AnchoredSpan — Converts text `Span` to `AnchoredSpan` relative to current `Segment`; callers: 15 outside folder
- Parser.inFunctionBody(start, parse): Result — Enters a fresh `'body'` segment if `start` is the current header item, and runs `parse`; callers: 1 outside folder
- Parser.restoringSegment(parse): Result — Saves and restores current segment `Place` around `parse`; callers: 1 outside folder
- Parser.wholeSpanOf(node): AnchoredSpan — Returns `nestedFunctionSpan` (header + body) for a local `FunctionDeclaration`, else `node.span`; callers: 1 outside folder
- Parser.moveBody(from, to): void — Transfers recorded function body when `attachAnnotations` clones a `FunctionDeclaration`; callers: 1 outside folder
- Parser.descend(parse): Result | undefined — Increments `#nesting` around `parse` or returns `undefined` at `nestingLimit`; callers: 1 outside folder
- Parser.speculate(attempt): Result | undefined — Runs `attempt` and rolls back cursor and diagnostics if it returns `undefined` or reports; callers: 4 outside folder
- Parser.expect(kind: TokenKind): Token | undefined — Eats `kind` or reports `expected` diagnostic at `nextSpan`; callers: 19 outside folder
- Parser.identifier(what = 'a name'): Identifier — Eats `'identifier'` or reports `expected(what)` and returns empty `Identifier`; callers: 22 outside folder
- Parser.missing(what: string): Missing — Reports `expected(what)` and returns empty `Missing` node at `previousEnd`; callers: 9 outside folder
- Parser.placeholder(): Missing — Returns empty `Missing` node at `previousEnd` without reporting a diagnostic; callers: 9 outside folder
- Parser.describeNext(): string — Formats current token or `lineBreak`/`end` for diagnostic messages; callers: 1 outside folder

## src/formatter/comments/comment-placement.ts — Attaching comments to AST nodes as `leading`, `trailing`, or `dangling`
- placeComments(tree, isCopied): ReadonlyMap<SyntaxNode, CommentsOf> — Assigns each non-copied comment of `tree` to its node and slot; [exp]; callers: 1 outside folder
- surroundingsOf(tree, comment): Surroundings — Finds enclosing node path and preceding/following sibling children around `comment`; callers: 0 outside folder
- endOfLinePlace(context, around, comment): Placement — Places end-of-line comment as dangling after `:`, trailing, leading, or dangling; callers: 0 outside folder
- ownLinePlace(context, around, comment): Placement — Places own-line comment as leading, trailing closed item, dangling, or leading ancestor; callers: 0 outside folder
- leadingConstruct(context, path): Placement — Walks up `path` to the innermost ancestor before which a line may start; callers: 0 outside folder
- lineMayStartBefore(context, enclosing, offset, following): boolean — Tests if printer may break before `following` in `enclosing`; callers: 0 outside folder
- previousTokenEnd(context, offset): number — Walks backward from `offset` past whitespace and comments to the end of the previous token; callers: 0 outside folder
- closedItem(tree, node, column): SyntaxNode | undefined — Finds deepest last item of an `itemLists` ancestor starting a line at `<= column`; callers: 0 outside folder
- takeTrailingAfter(tree, placement, node): readonly PlacedComment[] — Steals trailing comments on ancestors of `node` that sit after `node`; callers: 0 outside folder

## src/formatter/comments/comments.ts — Comment metadata (`PlacedComment`) and Prettier doc builders for leading, trailing, and dangling comments
- PlacedComment — Comment span, text, `ownLine`, `blankBefore`, and `blankAfter` flags; [exp]; callers: 1 outside folder
- CommentsOf — `{ leading, trailing, dangling }` comment lists for a syntax node; [exp]; callers: 1 outside folder
- describeComment(source, comment): PlacedComment — Computes `ownLine`, `blankBefore`, and `blankAfter` around `comment`; [exp]; callers: 0 outside folder (1 in dir)
- columnOf(source, offset): number — Returns 0-based UTF-16 column of `offset` via `lineMapOf(source)`; [exp]; callers: 0 outside folder (1 in comments/)
- whitespaceStart(text, offset): number — Scans backward from `offset` to the start of contiguous whitespace; [exp]; callers: 0 outside folder (1 in comments/)
- whitespaceEnd(text, offset): number — Scans forward from `offset` to the end of contiguous whitespace; callers: 0 outside folder
- hasBlankLine(text, start, end): boolean — Tests whether `text.slice(start, end)` has a blank line between first and last line; [exp]; callers: 1 outside folder
- leadingDocs(comments): builders.Doc[] — Builds Prettier docs for comments printed before their node; [exp]; callers: 1 outside folder
- trailingDocs(comments, doc): builders.Doc[] — Builds docs for comments after `doc`, demoting second end-of-line comment; [exp]; callers: 1 outside folder
- suffixWaitsAfter(doc, waiting): boolean — Recursively checks if `doc` leaves an unflushed `line-suffix` at the end of its last line; callers: 0 outside folder
- danglingDocs(comments): builders.Doc — Builds Prettier docs for comments inside an empty construct or after a header `:`; [exp]; callers: 1 outside folder

## src/formatter/declarations.ts — Printers for `Module`, `Annotation`, and all top-level and member declarations
- named(printer, name, parameters): builders.Doc — Formats `name<T, U>` header prefix; callers: 0 outside folder
- functionDoc(printer, node): builders.Doc — Formats `FunctionDeclaration` modifiers, mark, signature, and `: body` or docstring below; callers: 0 outside folder
- members(printer, node, items): builders.Doc — Formats `: indentedBody` for declaration members or `docBelow` when empty; callers: 0 outside folder
- declarationPrinters — `Printers<DeclarationKind>` table for module, annotations, and all declarations; [exp]; callers: 1 outside folder

## src/formatter/expressions/branches.ts — Printers for `BlockExpression`, `If`/`ConditionalBranch`/`ElseClause`, `Match`/`MatchCase`, `Select`/`SelectCase`
- branch(printer, keyword, node): builders.Doc — Formats `if cond: body` or `elif cond: body` with `node`'s comments; callers: 0 outside folder
- ifChain(printer, node, separator): builders.Doc — Joins `if`, `elif`, and `else` clauses with `separator` (`line` vs `hardline`); [exp]; callers: 1 outside folder
- branchPrinters — `Printers<BranchKind>` table for `BlockExpression`, `If`, `ElseClause`, `Match`, `MatchCase`, `Select`, `SelectCase`; [exp]; callers: 1 outside folder

## src/formatter/expressions/indented-values.ts — Printers for `IndentedValue`, `QuotedEntry`, `IndentedItem`, and `opened` (`=`, `return`, `:`, `-`)
- keyedOnItemLine(printer, item): boolean — Tests if `IndentedItem` is the `- key: value` form starting on the `-`'s line; callers: 0 outside folder
- opened(printer, opening, value): builders.Doc — Formats `opening` (`=`, `return`, `:`, `-`) and `value` (no space if block below); [exp]; callers: 2 outside folder
- entries(printer, value): builders.Doc — Groups `IndentedValue` entries by source line (`, `-joined per row) and preserves blank lines; callers: 0 outside folder
- indentedValuePrinters — `Printers<IndentedValue | QuotedEntry | IndentedItem>` table; [exp]; callers: 1 outside folder

## src/formatter/expressions/index.ts — Printers for collections, comprehensions, tuples, struct literals, lambdas, calls, postfix links, and operators
- memberLink(target, isOptional): string — Returns `''` after `->`, else `.` or `?.`; callers: 0 outside folder
- operationChain(printer, node): readonly [Expression, ...Operation[]] — Flattens left-nested `Binary` operands without comments into one chain; callers: 0 outside folder
- laysOutLines(tree, node): boolean — Recursively checks if `node` contains `If`, `Match`, `Select`, or `BlockExpression`; callers: 0 outside folder
- operatorRun(printer, node, first, operations): builders.Doc — Formats binary/comparison chain (breakable in brackets, `oneLine` outside); callers: 0 outside folder
- huggable(printer, argument): boolean — Tests if last call argument is an uncommented collection, comprehension, or block/collection lambda; callers: 0 outside folder
- callArguments(printer, node): builders.Doc — Formats call `(arguments)`, hugging the last argument when `huggable`; callers: 0 outside folder
- expressionPrinters — `Printers<ExpressionKind>` table for all non-literal, non-branch expressions; [exp]; callers: 1 outside folder

## src/formatter/expressions/literals.ts — Printers for scalar literals, `Docstring`, and single-line/multi-line `TemplateLiteral`
- CopiedLiteral — `TemplateLiteral | Docstring`; [exp]; callers: 0 outside folder
- isMultiLine(tree, node): node is CopiedLiteral — Tests if `node` is a `TemplateLiteral` or `Docstring` spanning multiple lines; [exp]; callers: 1 outside folder
- literalPrinters — `Printers<LiteralNode | TemplateLiteral>` printing literals from source text and re-indenting multi-line ones; [exp]; callers: 1 outside folder
- oneLineTemplate(printer, node): builders.Doc — Formats single-line template with `${oneLine(value)}` or falls back to `asWritten`; callers: 0 outside folder
- copied(tree, node): builders.Doc — Emits multi-line template/docstring using `markAsRoot(literalline)` when `movedLines` holds value; callers: 0 outside folder
- movedLines(tree, node, first, later): readonly string[] | undefined — Strips first-line indent from `later` and verifies `decoded` equality; callers: 0 outside folder
- decoded(text): string | undefined — Rescans `text` and serializes token values to verify multi-line literal re-indentation; callers: 0 outside folder
- tokenValue(token): unknown — Extracts span-independent value of a scanned token for `decoded`; callers: 0 outside folder

## src/formatter/format.ts — Formatter entry (`formatTree`, `formatSource`, `formatText`) and `TreePrinter` coordinator
- TreePrinter.print(node): builders.Doc — Memoizes and wraps kind-table printer output for `node` with leading/trailing comments; callers: 10 outside folder
- TreePrinter.withComments(node, doc): builders.Doc — Marks and wraps `node`'s leading and trailing comments around `doc`; callers: 4 outside folder (via `Printer`)
- TreePrinter.dangling(node): builders.Doc — Marks and formats `node`'s dangling comments; callers: 6 outside folder (via `Printer`)
- TreePrinter.extentOf(node): Span — Returns `node`'s text extent widened to its placed leading and trailing comments; callers: 2 outside folder (via `Printer`)
- TreePrinter.inBrackets(node): boolean — Tests if `node` is in `#inBrackets` (`nodesInBrackets`); callers: 1 outside folder (via `Printer`)
- TreePrinter.unprinted(): readonly PlacedComment[] — Returns any placed comments not marked as printed; callers: 0 outside folder
- copiedSpans(tree, node): readonly Span[] — Collects spans of multi-line templates and docstrings whose comments are copied raw; callers: 0 outside folder
- formatTree(tree): string | undefined — Formats `tree` to canonical text (width 100, 2-space indent) or `undefined` on syntax errors; [exp]; callers: 1 outside folder
- FormattedSource — `{ tree, text }` result of `formatSource`; [exp]; callers: 0 outside folder (public package export)
- formatSource(source): FormattedSource — Scans, parses, and formats `source`; [exp]; callers: 1 outside folder
- formatText(text): string | undefined — Parses and formats raw `text` string; [exp]; callers: 0 outside folder (public package export; 16 test/bench files)

## src/formatter/layout/bodies.ts — Formatting bodies after `:`, docstrings, and leading/trailing item annotations
- undelimitedChildren(node): readonly SyntaxNode[] — Filters `fieldChildrenOf(node)` to children standing `'outside'` or on `'lines'`; callers: 0 outside folder
- opensBody(node): boolean — Recursively tests if `node` opens an undelimited body (`If`, `Match`, `Select`, loops, `fn`); [exp]; callers: 1 outside folder
- startsWithBrace(printer, block, statement): boolean — Tests if `block`'s only statement is an uncommented, unannotated `BlockExpression`; callers: 0 outside folder
- body(printer, block): builders.Doc — Formats `block` after `:` (inline if 1 non-body statement, hugged if bracketed, else indented); [exp]; callers: 2 outside folder
- hugsItsBrackets(printer, statement): boolean — Tests if `statement` is an uncommented collection/struct literal `ExpressionStatement`; callers: 0 outside folder
- indentedBlock(printer, block): builders.Doc — Formats `block` always indented on a new line (for `LabelledBlock`); [exp]; callers: 1 outside folder
- indentedBody(printer, doc, items): builders.Doc — Formats optional `doc` and `items` indented one per line after `:`; [exp]; callers: 3 outside folder
- functionBody(printer, doc, block): builders.Doc — Formats function's `body` or indents `doc` followed by `block`; [exp]; callers: 1 outside folder
- docBelow(printer, doc): builders.Doc — Formats docstring indented on the line below a bodyless declaration; [exp]; callers: 1 outside folder
- annotated(printer, node, core): builders.Doc — Prints leading annotations on lines above `core` and trailing ones after `core`; [exp]; callers: 3 outside folder

## src/formatter/layout/brackets.ts — Deriving which AST nodes stand inside brackets where expressions may break across lines
- Standing — Child delimiter relationship: `'outside' | 'brackets' | 'braces' | 'lines'`; [exp]; callers: 0 outside folder
- standingIn(parent, child): Standing — Classifies whether `child` stands in `parent`'s brackets, braces, lines, or outside; [exp]; callers: 0 outside folder (1 in dir)
- nodesInBrackets(tree): ReadonlySet<SyntaxNode> — Walks `tree` from root to collect all nodes standing inside brackets; [exp]; callers: 1 outside folder

## src/formatter/layout/lists.ts — Block item lines, bracketed comma lists, tuple lists, field lists, `<…>`, and hugged arguments
- itemLines(printer, items): builders.Doc — Joins `items` with `hardline` and preserves a single blank line where source had one; [exp]; callers: 2 outside folder
- blankBetween(printer, first, second): boolean — Tests if source text has a blank line between `first` and `second` (with comments); [exp]; callers: 1 outside folder
- bracketed(printer, owner, [open, close], items): builders.Doc — Formats comma list in `open…close` (omitting commas when broken); [exp]; callers: 4 outside folder
- bracketedWhenBroken(printer, owner, [open, close], items): builders.Doc — Formats list with `open…close` only when broken across lines; [exp]; callers: 1 outside folder
- tupleList(printer, owner, elements): builders.Doc — Formats tuple `(elements)` keeping trailing `,` on a 1-element tuple; [exp]; callers: 3 outside folder
- commaList(printer, owner, items, ends): builders.Doc — Core Prettier group for `bracketed`, `bracketedWhenBroken`, and `tupleList`; callers: 0 outside folder
- enclosed(printer, owner, [open, close], inner): builders.Doc — Formats single `inner` node in `open…close` with softline padding; [exp]; callers: 3 outside folder
- fieldList(printer, owner, fields): builders.Doc — Formats `{ a: Int, b: Int }` with spaces on one line or one field per line; [exp]; callers: 1 outside folder
- angled(printer, items): builders.Doc — Formats `<A, B>` on one line (`''` when empty); [exp]; callers: 4 outside folder
- oneLine(doc): string — Renders `doc` with `printWidth: Infinity` for positions where line breaks are forbidden; [exp]; callers: 2 outside folder
- hasComments(printer, node): boolean — Tests if `printer.extentOf(node)` differs from `extentIn(printer.tree, node)`; [exp]; callers: 1 outside folder
- hugging([before, last, after], expanded): builders.Doc — Builds `conditionalGroup` trying one-line, hugged `last`, then `expanded`; [exp]; callers: 1 outside folder

## src/formatter/patterns.ts — Printers for all `Pattern` and `PatternPart` AST nodes
- patternPrinters — `Printers<PatternKind>` table for all pattern and pattern-part AST nodes; [exp]; callers: 1 outside folder
- structHead(printer, node): builders.Doc — Returns printed `node.type`, `''` for `node.isShort` parameter pattern `{…}`, or `'struct'`; callers: 0 outside folder

## src/formatter/printer.ts — `Printer` seam and `Printers<Node>` handler table type
- Printer — Formatter context seam (`tree`, `print`, `withComments`, `dangling`, `extentOf`, `inBrackets`); [exp]; callers: 6 outside folder
- Printers<Node> — `Handlers<Printer, Node, [], builders.Doc>` exhaustive kind table type; [exp]; callers: 4 outside folder

## src/formatter/statements.ts — Printers for `Block`, statements, `VariableDeclaration`, and `Hold`
- isHeldWildcard(node): boolean — Tests if `VariableDeclaration` is the `hold _ = expr` short form (`hold const _ = expr` without type); callers: 0 outside folder
- declarationKeyword(node): string — Returns `''` for `isHeldWildcard`, `'let '`, or `'const '`; callers: 0 outside folder
- statementPrinters — `Printers<StatementKind>` table for `Block`, statements, `VariableDeclaration`, and `Hold`; [exp]; callers: 1 outside folder

## src/formatter/types.ts — Printers for all `TypeNode`, `TypePart`, `ConstraintNode`, and `TypeMatch` AST nodes
- typePrinters — `Printers<TypeKind>` table for all type, constraint, and type-match AST nodes; [exp]; callers: 1 outside folder
- constraintsAfterIs(printer, constraints): builders.Doc — Formats `' is A & B'` (or `''` when `constraints` is empty); [exp]; callers: 1 outside folder

## Concept footprint
- Optional/None: `src/compiler/parser/grammar/expressions/expression.ts:prefixParselets` (`none`), `src/compiler/parser/grammar/expressions/postfix.ts:optionalParselet`, `src/compiler/parser/grammar/expressions/postfix.ts:arrowParselet` (`?->`), `src/compiler/parser/grammar/expressions/postfix.ts:propagateParselet` (`?`), `src/compiler/parser/grammar/expressions/postfix.ts:unwrapParselet` (`!`), `src/compiler/parser/grammar/parts/literals.ts:literalFrom` (`NoneLiteral`), `src/compiler/parser/grammar/patterns.ts:patternParselets` (`none`), `src/compiler/parser/grammar/types.ts:typeOperators` (`?`, `??`), `src/compiler/parser/grammar/types.ts:parseOptionalType`, `src/formatter/expressions/index.ts:memberLink`, `src/formatter/expressions/index.ts:optionalPrefix`, `src/formatter/expressions/index.ts:expressionPrinters.Call`, `src/formatter/expressions/index.ts:expressionPrinters.MemberAccess`, `src/formatter/expressions/index.ts:expressionPrinters.TupleElement`, `src/formatter/expressions/index.ts:expressionPrinters.Index`, `src/formatter/expressions/index.ts:expressionPrinters.Propagate`, `src/formatter/expressions/index.ts:expressionPrinters.Unwrap`, `src/formatter/expressions/index.ts:expressionPrinters.Dereference`, `src/formatter/expressions/literals.ts:literalPrinters.NoneLiteral`, `src/formatter/types.ts:typePrinters.OptionalType`
- Result: `src/compiler/parser/grammar/expressions/postfix.ts:propagateParselet` (`?`), `src/compiler/parser/grammar/expressions/postfix.ts:unwrapParselet` (`!`), `src/formatter/expressions/index.ts:expressionPrinters.Propagate`, `src/formatter/expressions/index.ts:expressionPrinters.Unwrap`
- unions: `src/compiler/parser/grammar/types.ts:typeOperators` (`|`), `src/compiler/parser/grammar/types.ts:parseUnionType`, `src/compiler/parser/grammar/declarations/type-parameters.ts:parseTypeParameter` (`in` member parameter), `src/compiler/parser/grammar/declarations/type-declarations.ts:parseRequiredAssociatedType` (`in` member bound), `src/compiler/parser/grammar/parts/structs.ts:parseMappedField` (`[F in U]: T`), `src/compiler/parser/grammar/parts/structs.ts:parseMappedParameter`, `src/formatter/types.ts:typePrinters.UnionType`, `src/formatter/types.ts:typePrinters.MappedField`, `src/formatter/declarations.ts:declarationPrinters.TypeParameter`, `src/formatter/declarations.ts:declarationPrinters.RequiredAssociatedType`
- enums/variants: `src/compiler/parser/grammar/declarations/declaration.ts:topLevelParselets` (`enum`), `src/compiler/parser/grammar/declarations/type-declarations.ts:parseEnum`, `src/compiler/parser/grammar/declarations/type-declarations.ts:parseVariant`, `src/compiler/parser/grammar/declarations/type-declarations.ts:parseVariantFields`, `src/compiler/parser/grammar/parts/structs.ts:parseVariantField`, `src/compiler/parser/grammar/parts/structs.ts:variantFieldRules`, `src/compiler/parser/grammar/patterns.ts:parseNamedPattern`, `src/compiler/parser/grammar/patterns.ts:parseVariantCallPattern`, `src/compiler/parser/grammar/patterns.ts:parsePatternArgument`, `src/compiler/parser/grammar/patterns.ts:givenAs`, `src/formatter/declarations.ts:declarationPrinters.EnumDeclaration`, `src/formatter/declarations.ts:declarationPrinters.Variant`, `src/formatter/layout/brackets.ts:standingIn` (`Variant`, `VariantCallPattern`), `src/formatter/patterns.ts:patternPrinters.VariantCallPattern`, `src/formatter/patterns.ts:patternPrinters.NamedPatternArgument`, `src/formatter/patterns.ts:patternPrinters.OtherFieldsPattern`, `src/formatter/comments/comment-placement.ts:itemLists` (`EnumDeclaration`)
- any/trait objects: `src/compiler/parser/grammar/types.ts:wordParselets` (`any`), `src/compiler/parser/grammar/types.ts:parseAnyType`, `src/compiler/parser/grammar/types.ts:parseAnyTrait`, `src/compiler/parser/diagnostics.ts:parserDiagnostics.structConstraintAfterAny`, `src/formatter/types.ts:typePrinters.AnyType`
- futures/await/select: `src/compiler/parser/grammar/declarations/functions.ts:parseFunction` (`qualifiersOf`), `src/compiler/parser/grammar/expressions/expression.ts:prefixParselets` (`async`, `await`, `select`), `src/compiler/parser/grammar/expressions/operators.ts:parseAwait`, `src/compiler/parser/grammar/expressions/branches.ts:parseSelect`, `src/compiler/parser/grammar/expressions/branches.ts:parseSelectFrom`, `src/compiler/parser/grammar/expressions/branches.ts:parseSelectLine`, `src/compiler/parser/grammar/expressions/branches.ts:misplacedElse`, `src/compiler/parser/grammar/statements/statement.ts:statementParselets` (`async`), `src/compiler/parser/grammar/types.ts:typeParselets` (`async`), `src/formatter/expressions/index.ts:expressionPrinters.Await`, `src/formatter/expressions/branches.ts:branchPrinters.Select`, `src/formatter/expressions/branches.ts:branchPrinters.SelectCase`, `src/formatter/expressions/index.ts:linedKinds` (`Select`), `src/formatter/layout/bodies.ts:bodyOpeners` (`Select`), `src/formatter/comments/comment-placement.ts:itemLists` (`Select`)
- marks/kinds (live/ista/simple): `src/compiler/parser/grammar/parts/heads.ts:headAhead`, `src/compiler/parser/grammar/parts/heads.ts:wordsAhead`, `src/compiler/parser/grammar/parts/heads.ts:parseHead`, `src/compiler/parser/grammar/parts/heads.ts:parseFunctionHead`, `src/compiler/parser/grammar/parts/heads.ts:readHead`, `src/compiler/parser/grammar/parts/heads.ts:readModifier`, `src/compiler/parser/grammar/parts/heads.ts:readMark`, `src/compiler/parser/grammar/parts/heads.ts:markNameLength`, `src/compiler/parser/grammar/parts/heads.ts:parseMarkName`, `src/compiler/parser/grammar/declarations/declaration.ts:parseContextConstant` (`ista const` vs `live`), `src/compiler/parser/grammar/declarations/functions.ts:parseFunction`, `src/compiler/parser/grammar/expressions/expression.ts:wordParselets` (`live`, `ista`), `src/compiler/parser/grammar/statements/statement.ts:wordParselets` (`live`, `ista`), `src/compiler/parser/grammar/types.ts:wordParselets` (`live`, `ista`), `src/formatter/declarations.ts:functionDoc` (`modifiersAroundMark`, `node.mark`), `src/formatter/declarations.ts:declarationPrinters.ExternStructDeclaration`, `src/formatter/declarations.ts:declarationPrinters.ContextConstantDeclaration`, `src/formatter/expressions/index.ts:expressionPrinters.Lambda`, `src/formatter/types.ts:typePrinters.FunctionType`
- sendable: `src/compiler/parser/grammar/parts/heads.ts:parseHead`, `src/compiler/parser/grammar/parts/heads.ts:readModifier`, `src/compiler/parser/grammar/types.ts:wordParselets` (`sendable`), `src/compiler/parser/grammar/declarations/externs.ts:parseExternStruct` (`handle`), `src/formatter/declarations.ts:functionDoc`, `src/formatter/declarations.ts:declarationPrinters.ExternStructDeclaration`, `src/formatter/expressions/index.ts:expressionPrinters.Lambda`, `src/formatter/types.ts:typePrinters.FunctionType`
- shared structs: `src/compiler/parser/grammar/declarations/declaration.ts:wordParselets` (`shared`), `src/compiler/parser/grammar/declarations/declaration.ts:parseModified`, `src/compiler/parser/grammar/declarations/type-declarations.ts:parseSharedStruct`, `src/compiler/parser/grammar/expressions/expression.ts:wordParselets` (`new`), `src/compiler/parser/grammar/expressions/expression.ts:prefixParselets` (`*`, `**`), `src/compiler/parser/grammar/expressions/expression.ts:infixParselets` (`->`, `?->`), `src/compiler/parser/grammar/expressions/literals/struct-literals.ts:parseNew`, `src/compiler/parser/grammar/expressions/literals/indented-values.ts:namedOpening` (`isNew`), `src/compiler/parser/grammar/expressions/operators.ts:parseDereference`, `src/compiler/parser/grammar/expressions/operators.ts:parseDoubleDereference`, `src/compiler/parser/grammar/expressions/postfix.ts:arrowParselet`, `src/formatter/declarations.ts:declarationPrinters.SharedStructDeclaration`, `src/formatter/expressions/index.ts:expressionPrinters.NewStructLiteral`, `src/formatter/expressions/index.ts:expressionPrinters.Dereference`, `src/formatter/expressions/index.ts:memberLink`, `src/formatter/expressions/indented-values.ts:indentedValuePrinters.IndentedValue` (`node.isNew`), `src/formatter/layout/bodies.ts:huggedKinds` (`NewStructLiteral`), `src/formatter/layout/brackets.ts:standingIn` (`NewStructLiteral`), `src/formatter/comments/comment-placement.ts:itemLists` (`SharedStructDeclaration`)
- extern types/declarations: `src/compiler/parser/grammar/declarations/declaration.ts:topLevelParselets` (`extern`), `src/compiler/parser/grammar/declarations/declaration.ts:parseModified`, `src/compiler/parser/grammar/declarations/declaration.ts:parseExtern`, `src/compiler/parser/grammar/declarations/declaration.ts:keywordWithout`, `src/compiler/parser/grammar/declarations/externs.ts:parseExternConstant`, `src/compiler/parser/grammar/declarations/externs.ts:parseExternStruct`, `src/compiler/parser/grammar/declarations/type-declarations.ts:parseExternStructMembers`, `src/compiler/parser/grammar/declarations/functions.ts:parseFunction` (`isExtern`), `src/compiler/parser/grammar/declarations/functions.ts:parseFunctionBody` (`externWithBody`), `src/formatter/declarations.ts:functionDoc`, `src/formatter/declarations.ts:declarationPrinters.ExternStructDeclaration`, `src/formatter/declarations.ts:declarationPrinters.ExternConstantDeclaration`, `src/formatter/comments/comment-placement.ts:itemLists` (`ExternStructDeclaration`)
- field loops/passes: `src/compiler/parser/grammar/parts/field-headers.ts:parseFieldHeaderAfter`, `src/compiler/parser/grammar/statements/loops.ts:parseForAfter` (`FieldLoop`), `src/compiler/parser/grammar/expressions/literals/collections.ts:parseComprehension` (`FieldComprehension`), `src/compiler/parser/grammar/expressions/literals/struct-literals.ts:parseStructComprehension` (`StructComprehension`), `src/formatter/expressions/index.ts:expressionPrinters.FieldHeader`, `src/formatter/expressions/index.ts:expressionPrinters.FieldComprehension`, `src/formatter/expressions/index.ts:expressionPrinters.StructComprehension`, `src/formatter/statements.ts:statementPrinters.FieldLoop`, `src/formatter/layout/bodies.ts:bodyOpeners` (`FieldLoop`), `src/formatter/layout/bodies.ts:huggedKinds` (`FieldComprehension`), `src/formatter/expressions/index.ts:huggedArguments` (`FieldComprehension`), `src/formatter/layout/brackets.ts:standingIn` (`FieldComprehension`, `StructComprehension`)
- comprehensions: `src/compiler/parser/grammar/expressions/literals/collections.ts:parseCollection`, `src/compiler/parser/grammar/expressions/literals/collections.ts:parseContents`, `src/compiler/parser/grammar/expressions/literals/collections.ts:parseComprehension`, `src/compiler/parser/grammar/expressions/literals/struct-literals.ts:parseStructComprehension`, `src/compiler/parser/grammar/expressions/literals/struct-literals.ts:reportAfterComprehension`, `src/compiler/parser/grammar/expressions/literals/indented-values.ts:checkedEntries`, `src/compiler/parser/grammar/expressions/literals/indented-values.ts:parseEntry`, `src/formatter/expressions/index.ts:expressionPrinters.Comprehension`, `src/formatter/expressions/index.ts:expressionPrinters.FieldComprehension`, `src/formatter/expressions/index.ts:expressionPrinters.StructComprehension`, `src/formatter/expressions/index.ts:huggedArguments`, `src/formatter/layout/bodies.ts:huggedKinds`, `src/formatter/layout/brackets.ts:standingIn`
- deferred calls: `src/compiler/parser/grammar/expressions/deferred-calls.ts:deferredCallParselet`, `src/compiler/parser/grammar/expressions/deferred-calls.ts:startsDeferredCall`, `src/compiler/parser/grammar/expressions/expression.ts:infixParselets` (`identifier`), `src/compiler/parser/grammar/expressions/expression.ts:startsItemOnNewLine` (`onOperandLine`), `src/compiler/parser/layout/item-breaks.ts:onOperandLine`, `src/formatter/expressions/index.ts:expressionPrinters.DeferredCall`
- context consts: `src/compiler/parser/grammar/declarations/declaration.ts:parseModified` (`keyword === 'const'`), `src/compiler/parser/grammar/declarations/declaration.ts:parseContextConstant`, `src/compiler/parser/diagnostics.ts:parserDiagnostics.contextConstantWord`, `src/formatter/declarations.ts:declarationPrinters.ContextConstantDeclaration`
- disposal/lifetimes/holders: `src/compiler/parser/grammar/statements/variables.ts:startsHeldVariableAt`, `src/compiler/parser/grammar/statements/variables.ts:atHold`, `src/compiler/parser/grammar/statements/variables.ts:parseHeldVariable`, `src/compiler/parser/grammar/statements/variables.ts:parseVariableAfter`, `src/compiler/parser/grammar/statements/simple.ts:parseDrop`, `src/compiler/parser/grammar/statements/loops.ts:parseLabelled` (`LabelledBlock`), `src/formatter/statements.ts:isHeldWildcard`, `src/formatter/statements.ts:declarationKeyword`, `src/formatter/statements.ts:statementPrinters.VariableDeclaration`, `src/formatter/statements.ts:statementPrinters.Hold`, `src/formatter/statements.ts:statementPrinters.LabelledBlock`, `src/formatter/statements.ts:statementPrinters.Drop`, `src/formatter/layout/bodies.ts:indentedBlock`, `src/formatter/layout/bodies.ts:bodyOpeners` (`LabelledBlock`)
- recursive aliases/type match: `src/compiler/parser/grammar/declarations/type-matches.ts:parseAliasBody`, `src/compiler/parser/grammar/declarations/type-matches.ts:parseTypeMatch`, `src/compiler/parser/grammar/declarations/type-matches.ts:parseTypeCase`, `src/compiler/parser/grammar/declarations/type-matches.ts:parseCasePattern`, `src/compiler/parser/grammar/types.ts:wordParselets` (`infer`), `src/compiler/parser/grammar/types.ts:parseInferType`, `src/formatter/types.ts:typePrinters.InferType`, `src/formatter/types.ts:typePrinters.TypeMatch`, `src/formatter/types.ts:typePrinters.TypeCase`
- struct keys/keyof/mapped & indexed types: `src/compiler/parser/grammar/types.ts:wordParselets` (`keyof`), `src/compiler/parser/grammar/types.ts:parseKeyofType`, `src/compiler/parser/grammar/types.ts:typeOperators` (`[`), `src/compiler/parser/grammar/types.ts:parseIndexedType`, `src/compiler/parser/grammar/parts/structs.ts:parseMappedField`, `src/compiler/parser/grammar/parts/structs.ts:parseMappedParameter`, `src/formatter/types.ts:typePrinters.KeyofType`, `src/formatter/types.ts:typePrinters.IndexedType`, `src/formatter/types.ts:typePrinters.MappedField`, `src/formatter/layout/brackets.ts:standingIn` (`IndexedType`, `MappedField`)
- variance: `src/compiler/parser/grammar/declarations/type-parameters.ts:parseTypeParameter`, `src/compiler/parser/grammar/declarations/type-parameters.ts:eatVariance`, `src/compiler/parser/diagnostics.ts:parserDiagnostics.twoVariances`, `src/formatter/declarations.ts:declarationPrinters.TypeParameter`
- packs/rests/spreads: `src/compiler/parser/grammar/parts/spreads.ts:parseSpread`, `src/compiler/parser/grammar/declarations/type-parameters.ts:parseTypeParameter` (`isPack`), `src/compiler/parser/grammar/parts/functions.ts:parseParameter` (`isRest`), `src/compiler/parser/grammar/parts/structs.ts:parseVariantField` (`isRest`), `src/compiler/parser/grammar/types.ts:parseParameterTypes`, `src/compiler/parser/grammar/types.ts:parseRestType`, `src/compiler/parser/grammar/patterns.ts:parseArrayPattern`, `src/compiler/parser/grammar/patterns.ts:parseRestPattern`, `src/compiler/parser/grammar/patterns.ts:parseVariantCallPattern`, `src/compiler/parser/grammar/patterns.ts:parsePatternArgument` (`OtherFieldsPattern`), `src/compiler/parser/grammar/patterns.ts:parseStructPattern`, `src/formatter/declarations.ts:declarationPrinters.TypeParameter` (`isPack`), `src/formatter/declarations.ts:declarationPrinters.DeclaredField` (`isRest`), `src/formatter/expressions/index.ts:expressionPrinters.Spread`, `src/formatter/expressions/index.ts:expressionPrinters.Parameter` (`isRest`), `src/formatter/types.ts:typePrinters.RestType`, `src/formatter/patterns.ts:patternPrinters.RestPattern`, `src/formatter/patterns.ts:patternPrinters.OtherFieldsPattern`, `src/formatter/patterns.ts:patternPrinters.StructPattern`
- indented values: `src/compiler/parser/grammar/expressions/literals/indented-values.ts:parseValue`, `src/compiler/parser/grammar/expressions/literals/indented-values.ts:parseNamedValue`, `src/compiler/parser/grammar/expressions/literals/indented-values.ts:namedOpening`, `src/compiler/parser/grammar/expressions/literals/indented-values.ts:parseBlockValue`, `src/compiler/parser/grammar/expressions/literals/indented-values.ts:columnAbove`, `src/compiler/parser/grammar/expressions/literals/indented-values.ts:parseEntry`, `src/compiler/parser/grammar/expressions/literals/indented-values.ts:parseItem`, `src/compiler/parser/grammar/expressions/literals/indented-values.ts:parseItemValue`, `src/compiler/parser/grammar/expressions/literals/indented-values.ts:startsKeyedValue`, `src/compiler/parser/grammar/expressions/literals/indented-values.ts:parseKeyedValue`, `src/compiler/parser/grammar/statements/simple.ts:returnsValue`, `src/formatter/expressions/indented-values.ts:keyedOnItemLine`, `src/formatter/expressions/indented-values.ts:isBlockBelow`, `src/formatter/expressions/indented-values.ts:opened`, `src/formatter/expressions/indented-values.ts:entries`, `src/formatter/expressions/indented-values.ts:indentedValuePrinters`, `src/formatter/layout/brackets.ts:standingIn` (`IndentedValue`)
- defaults/fields functions: `src/compiler/parser/grammar/parts/structs.ts:parseField` (`misplacedFieldDefault`), `src/compiler/parser/grammar/parts/structs.ts:parseDeclaredField`, `src/compiler/parser/grammar/parts/functions.ts:parseParameter` (`defaultValue`), `src/formatter/declarations.ts:declarationPrinters.DeclaredField`, `src/formatter/expressions/index.ts:expressionPrinters.Parameter`
- witnesses/traits/constraints/associated types: `src/compiler/parser/grammar/declarations/type-declarations.ts:parseTrait`, `src/compiler/parser/grammar/declarations/type-declarations.ts:parseTraitMember`, `src/compiler/parser/grammar/declarations/type-declarations.ts:withAssociatedTypes`, `src/compiler/parser/grammar/declarations/type-declarations.ts:associatedTypesApart`, `src/compiler/parser/grammar/declarations/type-declarations.ts:parseAssociatedType`, `src/compiler/parser/grammar/declarations/type-declarations.ts:parseRequiredAssociatedType`, `src/compiler/parser/grammar/declarations/type-declarations.ts:parseAssociatedHead`, `src/compiler/parser/grammar/parts/constraints.ts:parseConstraints`, `src/compiler/parser/grammar/parts/constraints.ts:parseStructConstraint`, `src/compiler/parser/grammar/parts/constraints.ts:parseConstraintEntry`, `src/compiler/parser/grammar/parts/constraints.ts:parseEntryField`, `src/compiler/parser/grammar/parts/structs.ts:startsConstraintEntry`, `src/compiler/parser/grammar/parts/structs.ts:parseMisplacedConstraintEntry`, `src/compiler/parser/grammar/types.ts:parseMemberType`, `src/formatter/declarations.ts:declarationPrinters.TraitDeclaration`, `src/formatter/declarations.ts:declarationPrinters.AssociatedType`, `src/formatter/declarations.ts:declarationPrinters.RequiredAssociatedType`, `src/formatter/types.ts:typePrinters.MemberType`, `src/formatter/types.ts:typePrinters.StructConstraint`, `src/formatter/types.ts:typePrinters.OtherFields`, `src/formatter/types.ts:typePrinters.FieldTypeEntry`, `src/formatter/types.ts:typePrinters.FieldConstraintEntry`, `src/formatter/types.ts:constraintsAfterIs`
- places/&refs: `src/compiler/parser/grammar/expressions/operators.ts:parseReference`, `src/compiler/parser/grammar/expressions/operators.ts:parseMisplacedReference`, `src/compiler/parser/grammar/expressions/postfix.ts:parseArgumentValue` (`isPlace`), `src/compiler/parser/grammar/statements/statement.ts:parseExpressionStatement` (`isTarget`, `destructures`), `src/compiler/parser/grammar/types.ts:parseParameterType`, `src/compiler/parser/grammar/types.ts:parseTupleType` (`misplacedReference`), `src/compiler/parser/grammar/types.ts:parseReferenceType`, `src/compiler/parser/grammar/types.ts:parseMisplacedReferenceType`, `src/formatter/expressions/index.ts:expressionPrinters.Reference`, `src/formatter/types.ts:typePrinters.ReferenceType`
- patterns: `src/compiler/parser/grammar/patterns.ts:patternGrammar`, `src/compiler/parser/grammar/patterns.ts:parsePattern`, `src/compiler/parser/grammar/patterns.ts:parseParameterPattern`, `src/compiler/parser/grammar/parts/functions.ts:parseParameter`, `src/compiler/parser/grammar/parts/functions.ts:startsPattern`, `src/compiler/parser/grammar/parts/functions.ts:bindingOf`, `src/compiler/parser/grammar/parts/names.ts:parseTargets`, `src/compiler/parser/grammar/expressions/operators.ts:isParselet`, `src/formatter/patterns.ts:patternPrinters`, `src/formatter/patterns.ts:structHead`, `src/formatter/expressions/index.ts:expressionPrinters.Parameter`, `src/formatter/expressions/index.ts:expressionPrinters.Is`
- templates: `src/compiler/parser/cursor/index.ts:Cursor.constructor` (`inTemplateValue`), `src/compiler/parser/parser.ts:Parser.withinTemplateValue`, `src/compiler/parser/parser.ts:Parser.describeNext` (`inTemplateValue`), `src/compiler/parser/grammar/expressions/literals/templates.ts:parseTemplate`, `src/compiler/parser/grammar/expressions/literals/templates.ts:templateParselet`, `src/compiler/parser/grammar/expressions/literals/templates.ts:templateLiteral`, `src/compiler/parser/grammar/expressions/literals/templates.ts:parseValue`, `src/formatter/expressions/literals.ts:isMultiLine`, `src/formatter/expressions/literals.ts:literalPrinters.TemplateLiteral`, `src/formatter/expressions/literals.ts:literalPrinters.TemplateText`, `src/formatter/expressions/literals.ts:oneLineTemplate`, `src/formatter/expressions/literals.ts:copied`, `src/formatter/expressions/literals.ts:movedLines`, `src/formatter/format.ts:copiedSpans`, `src/formatter/layout/brackets.ts:standingIn` (`TemplateLiteral`)
- ranges: `src/compiler/parser/grammar/expressions/operators.ts:parseOpenRange`, `src/compiler/parser/grammar/expressions/operators.ts:parseRangeRest`, `src/compiler/parser/grammar/expressions/operators.ts:parseRangeEnd`, `src/compiler/parser/grammar/expressions/operators.ts:parseRangeStep`, `src/compiler/parser/grammar/expressions/operators.ts:rangeParselet`, `src/compiler/parser/grammar/patterns.ts:parseRangePattern`, `src/compiler/parser/grammar/patterns.ts:parseOpenRangePattern`, `src/compiler/parser/grammar/patterns.ts:parseRangeBound`, `src/compiler/parser/grammar/patterns.ts:boundOf`, `src/formatter/expressions/index.ts:expressionPrinters.Range`, `src/formatter/patterns.ts:patternPrinters.RangePattern`
- comparisons: `src/compiler/parser/grammar/expressions/operators.ts:parseBinaryRest` (`ChainedComparison`), `src/compiler/parser/grammar/expressions/operators.ts:comparisonsOf`, `src/compiler/parser/grammar/patterns.ts:parseFieldPattern` (`CompareFieldPattern`), `src/compiler/parser/grammar/expressions/postfix.ts:parseTypeApplication` (vs `<`), `src/compiler/parser/grammar/patterns.ts:parsePatternTypeArguments` (vs `<`), `src/formatter/expressions/index.ts:expressionPrinters.ChainedComparison`, `src/formatter/patterns.ts:patternPrinters.CompareFieldPattern`
- annotations: `src/compiler/parser/layout/annotations.ts:parseAnnotation`, `src/compiler/parser/layout/annotations.ts:isAnnotationShape`, `src/compiler/parser/layout/annotations.ts:attachAnnotations`, `src/compiler/parser/layout/annotations.ts:rejectAnnotations`, `src/compiler/parser/layout/index.ts:parseAnnotatedItems`, `src/compiler/parser/layout/index.ts:parseLineItem`, `src/compiler/parser/layout/index.ts:parseLeadingAnnotations`, `src/compiler/parser/layout/index.ts:parseTrailingAnnotations`, `src/compiler/parser/layout/index.ts:annotate`, `src/compiler/parser/grammar/expressions/postfix.ts:parseCommittedTypeApplication`, `src/formatter/declarations.ts:declarationPrinters.Annotation`, `src/formatter/layout/bodies.ts:annotated`
- tuples: `src/compiler/parser/cursor/recovery.ts:parseGroup`, `src/compiler/parser/grammar/expressions/atoms.ts:parseParenthesized`, `src/compiler/parser/grammar/expressions/postfix.ts:parseTupleElements`, `src/compiler/parser/grammar/patterns.ts:parseTuplePattern`, `src/compiler/parser/grammar/types.ts:parseTupleType`, `src/formatter/layout/lists.ts:tupleList`, `src/formatter/expressions/index.ts:expressionPrinters.Tuple`, `src/formatter/expressions/index.ts:expressionPrinters.TupleElement`, `src/formatter/patterns.ts:patternPrinters.TuplePattern`, `src/formatter/types.ts:typePrinters.TupleType`
