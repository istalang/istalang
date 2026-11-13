### [high] Double standard & bug in speculative `<…>` type-arguments disambiguation between expressions and patterns
- where: `src/compiler/parser/grammar/expressions/postfix.ts:46-55, 95-129`, `src/compiler/parser/grammar/patterns.ts:289-306`
- evidence: Both `parseTypeApplication` (`postfix.ts`) and `parsePatternTypeArguments` (`patterns.ts`) solve the `<…>` vs comparison `<` ambiguity speculatively, using two incompatible designs:
  - `postfix.ts:46-55, 95-129` requires `namesTypesOnly(parsed) && endsTypeArguments(parser)`:
    ```ts
    function namesTypesOnly(types: readonly SyntaxNode[]): boolean {
      return types.every(
        (type) =>
          typeNamesOf(type).every(({ text }) => casedAsType(text)) &&
          namesTypesOnly(fieldChildrenOf(type)),
      );
    }
    function endsTypeArguments(parser: Parser): boolean {
      return (
        atPostfix(parser, '(') ||
        atPostfix(parser, '{') ||
        breakSeparatesItems(parser) ||
        !(parser.startsExpression() || parser.cursor.atRestAfterAngle)
      );
    }
    ```
  - `patterns.ts:289-306` omits both `namesTypesOnly` and `atRestAfterAngle`, checking only `!continuingOperators.has(parser.cursor.kind)`:
    ```ts
    function parsePatternTypeArguments(parser: Parser): readonly TypeNode[] {
      if (!atPostfix(parser, '<')) {
        return [];
      }
      const typeArguments = parser.speculate(() => {
        const written = parser.typeArguments();
        return continuingOperators.has(parser.cursor.kind) ? undefined : written;
      });
      return typeArguments ?? [];
    }
    const continuingOperators: ReadonlySet<string> = new Set(
      Object.keys(binaryOperators).filter((operator) => !['and', 'or', '|'].includes(operator)),
    );
    ```
  Because `parsePatternTypeArguments` does not check `namesTypesOnly(written)` or `parser.cursor.atRestAfterAngle`:
  1. In `[x is a < b, c > d]` or `f(x is a < b, c > d)`, `< b, c >` is misparsed as type arguments of `a` (since after `>`, `d` is an `'identifier'`, not in `continuingOperators`), even though `b` and `c` are lowercase variables.
  2. In `x is P < T >= y`, `>=` is split by `Cursor` into `>` and `#remainder = '='` (`cursor.atRestAfterAngle === true`); `'='` is not in `continuingOperators`, so `< T >` is consumed as type arguments and `= y` is left as a syntax error.
- proposal: Move `namesTypesOnly` and `typeNamesOf` into `src/compiler/parser/grammar/parts/names.ts` alongside a shared speculative type-arguments helper that enforces `namesTypesOnly(parsed)` and `!parser.cursor.atRestAfterAngle`, parameterized only by what may legitimately follow `<…>` in an expression vs a pattern; call it from both `src/compiler/parser/grammar/expressions/postfix.ts` and `src/compiler/parser/grammar/patterns.ts`.
- confidence: high

### [high] `attachAnnotations` erases the item-start boundary, forcing regex/token re-scans in formatter and completion
- where: `src/compiler/parser/layout/index.ts:210-260`, `src/compiler/parser/layout/annotations.ts:53-68`, `src/formatter/layout/bodies.ts:154-179`, `src/formatter/comments/comment-placement.ts:276-286`, `src/editor/language-service/completion/places/grammar/item-starts.ts:62-71`
- evidence:
  1. `parseLineItem` (`src/compiler/parser/layout/index.ts:210-228`) already parses `leading` and `trailing` annotations separately around the item, and `item.span` holds the item's own span before `annotate` calls `attachAnnotations(parser, item, [...leading, ...trailing])` (`src/compiler/parser/layout/annotations.ts:53-68`), which merges them into a single `annotations` array and overwrites `item.span` with `spanCovering(item.span, ...annotations.map((annotation) => annotation.span))`.
  2. Because `item.span.from` is overwritten with the first leading annotation's start, `annotated` in `src/formatter/layout/bodies.ts:154-179` has to re-lex raw source text with its own sticky regex `const trivia = /(?:\s|#[^\r\n]*)*/uy` (`tokenAfter`) to reconstruct which annotations stood before the item vs after it:
     ```ts
     const trivia = /(?:\s|#[^\r\n]*)*/uy;
     function tokenAfter(text: string, offset: number): number {
       trivia.lastIndex = offset;
       trivia.exec(text);
       return trivia.lastIndex;
     }
     ```
  3. Meanwhile, `src/formatter/comments/comment-placement.ts:276-286` defines a second comment-stripping regex `const commentText = /#[^\r\n]*/gu` (`codeBetween`, `onlyCommentsBetween`) to test the exact same condition (`onlyCommentsBetween(text, offset, written.start)` is equivalent to `tokenAfter(text, offset) === written.start`).
  4. In `src/editor/language-service/completion/places/grammar/item-starts.ts:62-71`, `ownStartOf(tree, item)` has to scan `codeTokensOf(tree)` and filter out `annotation` spans to recover where the item's own text starts past its leading annotations.
- proposal: Either record leading vs trailing annotations (or a helper in `src/compiler/syntax/items.ts` / preserving the item's own start) at construction in `attachAnnotations`, or at minimum unify `tokenAfter` (`src/formatter/layout/bodies.ts:154-160`) with `onlyCommentsBetween` (`src/formatter/comments/comment-placement.ts:276-286`) so `src/formatter/` does not maintain two separate comment/trivia regex scanners.
- confidence: high

### [high] `bodiesHeldBy` re-implements generic AST child reflection and traversal from `syntax/tree/index.ts`
- where: `src/compiler/parser/incremental/held-bodies.ts:16-35`, `src/compiler/syntax/tree/index.ts:82-135`
- evidence: `src/compiler/syntax/tree/index.ts` is the single home of generic AST child discovery (`fieldChildrenOf`, `childrenOf`, `nodesUnder` over `TreeBodies = Pick<SyntaxTree, 'bodies'>`), as stated in `docs/reuse/syntax-and-trees.md`. `bodiesHeldBy` in `src/compiler/parser/incremental/held-bodies.ts:16-35` re-implements `Object.values(node)` reflection, `Array.isArray` / `isNode` filtering, `FunctionDeclaration` body lookup, and the explicit-stack walk by hand (and tests `node.kind === 'FunctionDeclaration'` twice in a row on lines 29-30):
  ```ts
  export function bodiesHeldBy(
    nodes: readonly SyntaxNode[],
    recorded: ReadonlyMap<FunctionDeclaration, Block>,
  ): Map<FunctionDeclaration, Block> {
    const held = new Map<FunctionDeclaration, Block>();
    const pending = [...nodes];
    for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
          pushAll(pending, value.filter(isNode));
        } else if (isNode(value)) {
          pending.push(value);
        }
      }
      const body = node.kind === 'FunctionDeclaration' ? recorded.get(node) : undefined;
      if (node.kind === 'FunctionDeclaration' && body !== undefined) {
        held.set(node, body);
        pending.push(body);
      }
    }
    return held;
  }
  ```
- proposal: Implement `bodiesHeldBy` using `nodesUnder({ bodies: recorded }, root)` (or `childrenOf({ bodies: recorded }, node)`) from `src/compiler/syntax/tree/index.ts`. This removes the duplicate `Object.values(node)` reflection and pre-warms `fieldChildrenOf`'s `WeakMap` cache for subsequent phases.
- confidence: high

### [high] Feature reduction / double standard: `StructDeclaration` vs `SharedStructDeclaration` and `StructLiteral` vs `NewStructLiteral`
- where: `src/compiler/parser/grammar/declarations/type-declarations.ts:45-70`, `src/compiler/parser/grammar/expressions/literals/struct-literals.ts:36-57`, `src/compiler/parser/grammar/expressions/literals/indented-values.ts:61-106`, `src/formatter/declarations.ts:83-94`, `src/formatter/expressions/index.ts:210-217`, `src/formatter/expressions/indented-values.ts:86-90`, `src/formatter/layout/bodies.ts:89-96`, `src/formatter/layout/brackets.ts:50-53`, `src/formatter/comments/comment-placement.ts:175-185`
- evidence:
  1. For indented values, `new T:` vs `T:` is represented by a boolean `isNew: boolean` on a single `IndentedValue` node kind (`indented-values.ts:95, 105`; formatted in `formatter/expressions/indented-values.ts:87` as `[node.isNew ? 'new ' : '', printer.print(node.type), ':']`). For braced literals, however, `new T{…}` and `T{…}` are split into two separate AST node kinds (`NewStructLiteral` vs `StructLiteral`), forcing `syntax/expressions/literals/indented-values.ts:120` and `built-types.ts:31` to convert between `isNew` and `NewStructLiteral`, and forcing duplicate handlers in `formatter/expressions/index.ts:210-217`, `formatter/layout/bodies.ts:89-96` (`huggedKinds`), `formatter/layout/brackets.ts:50-51` (`standingIn`), `binder`, `checker`, and `language-service`.
  2. Similarly, `ExternStructDeclaration` represents `shared` via its `handle` field (`'shared' | 'sendable' | 'live' | undefined`), whereas `StructDeclaration` and `SharedStructDeclaration` are two separate node kinds with identical fields (`StructOf<'StructDeclaration'>` vs `StructOf<'SharedStructDeclaration'>`), parsed by the same `parseStructFrom` (`type-declarations.ts:53-70`) and formatted by two copy-pasted handlers in `formatter/declarations.ts:83-94`, while requiring every phase (and `comment-placement.ts:177-178`) to list both kinds.
- proposal: Unify `NewStructLiteral` into `StructLiteral` with `isNew: boolean` (matching `IndentedValue`), and unify `SharedStructDeclaration` into `StructDeclaration` with `isShared: boolean` (or `handle`), eliminating two redundant AST node kinds across parser, formatter, syntax, binder, checker, lowering, and editor tooling.
- confidence: high

### [high] Three separate body/item-list kind sets in `src/formatter/`, with `'TypeMatch'` and `'IndentedValue'` missing from `comment-placement.ts`
- where: `src/formatter/comments/comment-placement.ts:120-136, 175-206, 233-248`, `src/formatter/layout/bodies.ts:27-51`, `src/formatter/expressions/index.ts:81-91`
- evidence: `src/formatter/` maintains three separate lists of node kinds that lay out multi-line bodies or item lists:
  1. `itemLists` in `src/formatter/comments/comment-placement.ts:175-185`:
     ```ts
     const itemLists: ReadonlySet<SyntaxNode['kind']> = new Set([
       'Block', 'StructDeclaration', 'SharedStructDeclaration', 'ExternStructDeclaration',
       'EnumDeclaration', 'TraitDeclaration', 'Match', 'Select', 'If',
     ]);
     ```
     `TypeMatch` (formatted in `src/formatter/types.ts:63-68` with `indentedBody(printer, undefined, node.cases)`, identically to `Match` in `src/formatter/expressions/branches.ts:74-79`) and `IndentedValue` are missing from `itemLists`. As a result, `lineMayStartBefore` (`comment-placement.ts:199`) and `closedItem` (`comment-placement.ts:243`) fail to recognize comments after `match D:` or closing a `TypeMatch`! Furthermore, in `endOfLinePlace` (`comment-placement.ts:126`), `const opensBody = following?.kind === 'Block' || following?.kind === 'Docstring'` does not include `SelectCase`, `MatchCase`, `TypeCase`, or `IndentedEntry`, so an end-of-line comment after `select: # c` with cases is placed as `leading` on the first `SelectCase` instead of `dangling` on `Select` (`branches.ts:90`).
  2. `bodyOpeners` in `src/formatter/layout/bodies.ts:27-36` (`If`, `Match`, `Select`, `For`, `FieldLoop`, `While`, `LabelledBlock`, `FunctionDeclaration`) with `opensBody(node)`.
  3. `linedKinds` in `src/formatter/expressions/index.ts:81-91` (`If`, `Match`, `Select`, `BlockExpression`) with its own recursive `laysOutLines(tree, node)` walk.
  Similarly, `huggedArguments` (`src/formatter/expressions/index.ts:128-133`: `ArrayLiteral`, `MapLiteral`, `Comprehension`, `FieldComprehension`) is duplicated in `huggedKinds` (`src/formatter/layout/bodies.ts:89-96`, which adds `StructLiteral`, `NewStructLiteral`).
- proposal: Centralize the structural classification of nodes (which nodes open indented item lists after `:`, which open statement bodies, and which bracketed literals hug) in `src/formatter/layout/brackets.ts` (or `bodies.ts`), add `'TypeMatch'` and `'IndentedValue'` to `itemLists`, and derive `laysOutLines`, `opensBody`, `itemLists`, and `huggedArguments`/`huggedKinds` from one home.
- confidence: high

### [high] Exact duplicate function in `src/compiler/parser/layout/index.ts`: `parseAnnotatedItems` and `parseListItem`
- where: `src/compiler/parser/layout/index.ts:82-88, 132-146`
- evidence: `parseAnnotatedItems` and `parseListItem` sit 52 lines apart in the same file (`src/compiler/parser/layout/index.ts`) and have identical signatures and bodies:
  ```ts
  export function parseAnnotatedItems<Item extends SyntaxNode>(
    parser: Parser,
    rules: ItemRules<Item>,
  ): Items<Item> {
    const step = parseLineItem(parser, rules, [], false);
    return [...step.items, ...rejectAnnotations(parser, step.pending, danglingAnnotation)];
  }
  ```
  and
  ```ts
  function parseListItem<Item extends SyntaxNode>(
    parser: Parser,
    rules: ItemRules<Item>,
  ): Items<Item> {
    const step = parseLineItem(parser, rules, [], false);
    return [...step.items, ...rejectAnnotations(parser, step.pending, danglingAnnotation)];
  }
  ```
- proposal: Delete `parseListItem` in `src/compiler/parser/layout/index.ts` and call `parseAnnotatedItems(parser, rules)` in `parseItemEntries` (`src/compiler/parser/layout/index.ts:133`).
- confidence: high

### [med] Duplicated `in Union` and `is Constraints` bound parsing and formatting for `TypeParameter` and `RequiredAssociatedType`
- where: `src/compiler/parser/grammar/declarations/type-parameters.ts:39-45`, `src/compiler/parser/grammar/declarations/type-declarations.ts:130-135`, `src/formatter/declarations.ts:126-131, 174-181`, `src/formatter/types.ts:88-100`
- evidence:
  1. In the parser, `parseTypeParameter` (`type-parameters.ts:39-45`) and `parseRequiredAssociatedType` (`type-declarations.ts:130-135`) contain the exact same 6 lines to parse `memberOf` (`in Type`) and `constraints` (`is Constraints`) and report `memberParameterAlone` (2027):
     ```ts
     const memberOf = cursor.eat('in') === undefined ? undefined : parser.type();
     const besides = cursor.token.span.start;
     const constraints = cursor.eat('is') === undefined ? [] : parseConstraints(parser);
     if (memberOf !== undefined && constraints.length > 0) {
       parser.report(parserDiagnostics.memberParameterAlone(parser.textSpanFrom(besides)));
     }
     ```
  2. In the formatter, `RequiredAssociatedType` (`src/formatter/declarations.ts:129-130`) and `TypeParameter` (`src/formatter/declarations.ts:178-179`) both format:
     ```ts
     node.memberOf === undefined ? '' : [' in ', printer.print(node.memberOf)],
     constraintsAfterIs(printer, node.constraints),
     ```
- proposal: Add `parseTypeBounds(parser): { memberOf: TypeNode | undefined; constraints: readonly ConstraintNode[] }` to `src/compiler/parser/grammar/parts/constraints.ts` and call it from both `parseTypeParameter` and `parseRequiredAssociatedType`. In `src/formatter/types.ts`, add `typeBounds(printer, node)` (or extend `constraintsAfterIs`) and call it from both `RequiredAssociatedType` and `TypeParameter` in `src/formatter/declarations.ts`.
- confidence: high

### [med] `fieldList` in `src/formatter/layout/lists.ts` duplicates `commaList`, and `StructConstraint` relies on string-comparing `Doc === '{}'`
- where: `src/formatter/layout/lists.ts:88-112, 132-154`, `src/formatter/types.ts:74-77`, `src/formatter/declarations.ts:134-140`
- evidence:
  1. In `src/formatter/layout/lists.ts`, `fieldList` (lines 132-154) is a copy of `commaList` (lines 88-112), differing only in using `line` instead of `softline` inside `{` and `}`:
     ```ts
     export function fieldList(
       printer: Printer,
       owner: SyntaxNode,
       fields: readonly SyntaxNode[],
     ): builders.Doc {
       const inside = printer.dangling(owner);
       if (fields.length === 0) {
         return inside === '' ? '{}' : group(['{', indent(inside), softline, '}']);
       }
       return group([
         '{',
         indent([
           inside,
           line,
           join([ifBreak('', ','), line], fields.map((field) => printer.print(field))),
         ]),
         line,
         '}',
       ]);
     }
     ```
  2. In `src/formatter/types.ts:74-77`, `StructConstraint` checks whether its braces are empty by string-comparing the returned `Doc` against `'{}'`:
     ```ts
     StructConstraint: (printer, node) => {
       const entries = fieldList(printer, node, node.entries);
       return entries === '{}' ? 'struct' : ['struct ', entries];
     },
     ```
     whereas `Variant` in `src/formatter/declarations.ts:137` checks `node.fields.length === 0 && printer.dangling(node) === ''` before calling `bracketed`.
- proposal: Parameterize `commaList` in `src/formatter/layout/lists.ts` by `padding: builders.Doc` (`softline` vs `line`) so `fieldList` delegates to `commaList`, and change `StructConstraint` in `src/formatter/types.ts:74-77` to check `node.entries.length === 0 && printer.dangling(node) === ''` (matching `Variant`).
- confidence: high

### [med] Call-pattern argument validation in `patterns.ts` duplicates `secondRest`, mishandles `Invalid` in `givenAs`, and splits logic with `syntax/` and `checker/`
- where: `src/compiler/parser/grammar/patterns.ts:160-162, 245-270`, `src/compiler/parser/grammar/expressions/postfix.ts:140-143`, `src/compiler/syntax/expressions/arguments.ts:14-34`, `src/compiler/checker/surface/struct-items.ts:44-63`
- evidence:
  1. `parseArrayPattern` (`patterns.ts:160-162`) and `parseVariantCallPattern` (`patterns.ts:245-247`) repeat the identical loop reporting `secondRest` (2071):
     ```ts
     for (const extra of items.filter((item) => item.kind === 'RestPattern').slice(1)) {
       parser.report(parserDiagnostics.secondRest(parser.textSpanOf(extra.span)));
     }
     ```
  2. In `parseVariantCallPattern` (`patterns.ts:252-270`), `givenAs` returns `'position'` for `Invalid` (and `Missing`) nodes:
     ```ts
     function givenAs(argument: PatternArgument): 'name' | 'position' | undefined {
       switch (argument.kind) {
         case 'NamedPatternArgument':
           return 'name';
         case 'OtherFieldsPattern':
           return undefined;
         default:
           return 'position';
       }
     }
     ```
     Unlike `parseCall` (`postfix.ts:141`: `if (misplaced !== undefined && misplaced.kind !== 'Invalid')`) and `callPatternArguments` (`checker/surface/struct-items.ts:52`: `argument.kind === 'Invalid' || argument.kind === 'Missing'`), `parseVariantCallPattern` does not exclude `Invalid` nodes, so a syntax error recovered as `Invalid` after a named pattern argument triggers a spurious second diagnostic `positionalAfterNamed` (2050).
  3. `src/compiler/syntax/expressions/arguments.ts`'s banner states that it owns argument ordering for both calls and call patterns (`and where the order named arguments keep is broken, a call pattern's too (§3.11)`), yet `givenAs` for `PatternArgument` is in `parser/grammar/patterns.ts:264-272` and `callPatternArguments` in `checker/surface/struct-items.ts:44-63` re-implements the same refusal predicates (`NamedPatternArgument` order and `RestPattern` index) from scratch.
- proposal: Move call-pattern argument classification (`misplacedPatternArgument`, ignoring `Invalid` in `givenOutOfOrder`) into `src/compiler/syntax/expressions/arguments.ts`, share a `reportExtraRests` helper in `src/compiler/parser/grammar/patterns.ts`, and reuse the syntax helper in `callPatternArguments` (`src/compiler/checker/surface/struct-items.ts`).
- confidence: high

### [med] `comment-placement.ts` violates `docs/reuse/text-and-positions.md` (`offset - column` for line start) and duplicates `ownLine` from `comments.ts`
- where: `src/formatter/comments/comment-placement.ts:240-242`, `src/formatter/comments/comments.ts:38-45`, `docs/reuse/text-and-positions.md:30`
- evidence:
  - `docs/reuse/text-and-positions.md` states: `never a regex of your own, nor offset - column for a line start` (use `lineStartAt` from `src/foundation/text/line-map.ts`).
  - `closedItem` in `src/formatter/comments/comment-placement.ts:240-242` computes:
    ```ts
    const offset = extentIn(tree, last).start;
    const start = columnOf(source, offset);
    const startsLine = source.text.slice(offset - start, offset).trim() === '';
    ```
  - Meanwhile, `describeComment` in `src/formatter/comments/comments.ts:38-43` computes the exact same predicate (`ownLine`: whether only whitespace precedes an offset on its line) using `lineStartAt`:
    ```ts
    const lineStart = lineStartAt(text, comment.span.start);
    return {
      ...
      ownLine: text.slice(lineStart, comment.span.start).trim() === '',
    ```
  - Additionally, `columnOf(source, offset)` in `src/formatter/comments/comments.ts:51-53` and `Parser.columnOf(token)` in `src/compiler/parser/parser.ts:365-367` (and `tokens.ts:52` in `editor/language-service/reading/`) all repeat `lineMapOf(source).positionAt(offset).column`.
- proposal: Extract `startsLineAt(text: string, offset: number): boolean` (`text.slice(lineStartAt(text, offset), offset).trim() === ''`) in `src/formatter/comments/comments.ts` (or `src/foundation/text/line-map.ts`) and use it in both `describeComment` (`comments.ts:43`) and `closedItem` (`comment-placement.ts:242`).
- confidence: high

### [med] Duplicated member-parsing pipeline (`withAssociatedTypes` + `parseMembers` + `associatedTypesApart`) in `type-declarations.ts`
- where: `src/compiler/parser/grammar/declarations/type-declarations.ts:53-109, 143-156`
- evidence: `withAssociatedTypes` and `associatedTypesApart` have 3 call sites in `src/compiler/parser/grammar/declarations/type-declarations.ts` (`parseStructFrom`, `parseEnum`, `parseExternStructMembers`), and all 3 execute the identical 3-step sequence:
  - `parseStructFrom` (lines 57-62):
    ```ts
    const { value: members, doc } = parseMembers(parser, withAssociatedTypes(declaredFieldRules), start);
    const { associatedTypes, others: fields } = associatedTypesApart(members);
    ```
  - `parseEnum` (lines 74-75):
    ```ts
    const { value: members, doc } = parseMembers(parser, withAssociatedTypes(variantRules), start);
    const { associatedTypes, others: variants } = associatedTypesApart(members);
    ```
  - `parseExternStructMembers` (lines 147-149):
    ```ts
    const rules = withAssociatedTypes(declaredFieldRules);
    const { value: members, doc } = parseMembers(parser, rules, headerStart);
    const { associatedTypes, others: fields } = associatedTypesApart(members);
    ```
- proposal: Replace `withAssociatedTypes` and `associatedTypesApart` with a single `parseMembersWithAssociatedTypes<Item>(parser, rules, headerStart)` helper in `src/compiler/parser/grammar/declarations/type-declarations.ts` returning `{ members: others, associatedTypes, doc }`, used by `parseStructFrom`, `parseEnum`, and `parseExternStructMembers`.
- confidence: high

### [med] Duplicated printers and parsers across construct families (`declarations.ts`, `patterns.ts`, `types.ts`, `branches.ts`, `expressions/index.ts`)
- where: `src/formatter/declarations.ts:83-106, 117-123, 141-147`, `src/formatter/patterns.ts:20-26, 60-64, 67-71`, `src/formatter/types.ts:22-28, 32-37, 51-55, 63-68`, `src/formatter/expressions/branches.ts:74-79`, `src/formatter/expressions/index.ts:171-200, 229-237, 283-288`, `src/compiler/parser/grammar/parts/heads.ts:176-188`, `src/compiler/parser/grammar/parts/names.ts:16-39`, `src/compiler/parser/grammar/patterns.ts:174-179`, `src/compiler/parser/grammar/declarations/type-matches.ts:53-62`
- evidence:
  1. **Type declarations in `src/formatter/declarations.ts:83-106, 117-123, 141-147`**: `StructDeclaration`, `SharedStructDeclaration`, `ExternStructDeclaration`, `EnumDeclaration`, and `TraitDeclaration` all format `annotated(printer, node, [prefix, named(printer, node.name, node.typeParameters), members(printer, node, items)])`, with the first four all passing `membersAsWritten(node)`.
  2. **`NamePattern` (`src/formatter/patterns.ts:20-26`) and `NamedType` (`src/formatter/types.ts:22-28`)**: 100% identical printer body `[join('.', node.path.map((name) => printer.print(name))), angled(printer, node.typeArguments)]`.
  3. **`Match` (`src/formatter/expressions/branches.ts:74-79`) and `TypeMatch` (`src/formatter/types.ts:63-68`)**: 100% identical printer body `['match ', printer.print(node.subject), ':', indentedBody(printer, undefined, node.cases)]`.
  4. **`Comprehension` (`src/formatter/expressions/index.ts:171-190`) and `FieldComprehension` (`src/formatter/expressions/index.ts:191-200`)**: both wrap `[` + `indent([printer.dangling(node), softline, headerDoc, ': ', printer.print(node.body)])` + `softline` + `]` in `group(...)`.
  5. **`parseMarkName` (`src/compiler/parser/grammar/parts/heads.ts:176-188`) vs `parseQualifiedName` + `namedTypeFrom` (`src/compiler/parser/grammar/parts/names.ts:16-39`)**: `parseMarkName` manually loops `while (parser.cursor.eat('.') !== undefined)` and constructs a `NamedType` with `typeArguments: []`, duplicating `namedTypeFrom(parser, parseQualifiedName(parser), [])`.
  6. **`parseWildcard` (`src/compiler/parser/grammar/patterns.ts:174-179`) vs `parseCasePattern` (`src/compiler/parser/grammar/declarations/type-matches.ts:55-60`)**: both check `cursor.at('identifier') && isUnnamed(parser.textOf(cursor.token))` and build `{ kind: 'WildcardPattern', span: parser.anchor(cursor.advance().span) }`.
- proposal:
  - In `src/formatter/declarations.ts`, extract `memberDeclaration(printer, head, node, items = membersAsWritten(node))` for the 5 member-bearing type declarations.
  - In `src/formatter/layout/lists.ts`, add `qualifiedPathDoc(printer, node)` for `NamedType` and `NamePattern`.
  - In `src/formatter/expressions/index.ts`, extract `comprehensionDoc(printer, node, headerDoc)` for `Comprehension` and `FieldComprehension`.
  - In `src/compiler/parser/grammar/parts/names.ts`, export `parseWildcard(parser)` (used by `patterns.ts` and `type-matches.ts`) and reuse `parseQualifiedName` + `namedTypeFrom` in `heads.ts:parseMarkName`.
- confidence: high

### [low] Dead branches, redundant wrapper functions, and unreferenced exported types in `src/compiler/parser` and `src/formatter`
- where: `src/compiler/parser/layout/annotations.ts:34-38`, `src/compiler/parser/layout/index.ts:242-246`, `src/compiler/parser/grammar/expressions/literals/indented-values.ts:110-116, 152, 169-173`, `src/compiler/parser/grammar/expressions/literals/templates.ts:31-35`, `src/compiler/parser/grammar/declarations/functions.ts:68-70`, `src/compiler/parser/grammar/expressions/operators.ts:186-187`, `src/compiler/parser/parser.ts:330`, `src/compiler/parser/cursor/brackets.ts:74`, `src/compiler/parser/cursor/index.ts:69, 79`, `src/compiler/parser/cursor/recovery.ts:42, 48, 116`, `src/compiler/parser/grammar/parts/heads.ts:38`, `src/compiler/parser/layout/bodies.ts:25, 34`, `src/compiler/parser/layout/index.ts:73`, `src/formatter/expressions/literals.ts:33`, `src/formatter/layout/brackets.ts:26`
- evidence:
  1. **Unreachable `undefined` return in `parseAnnotation` (`src/compiler/parser/layout/annotations.ts:34-38`)**: `parseAnnotation` checks `if (at === undefined) return undefined;`, but its sole caller `parseAnnotationsWhile` (`src/compiler/parser/layout/index.ts:242`) already guards `while (parser.cursor.at(annotationOpener) && goesOn())`.
  2. **Unreachable fallback in `parseKey` (`src/compiler/parser/grammar/expressions/literals/indented-values.ts:169-173`)**: `parseKey` is called only at line 153 inside `if (cursor.at('string') && next === ':')`, so `token.kind === 'string'` is always true and `: ''` in `const value = token.kind === 'string' ? token.value : ''` is unreachable; `StringLiteral` construction also duplicates `literalFrom` (`grammar/parts/literals.ts:24-25`).
  3. **Unreachable branch in `templateLiteral` (`src/compiler/parser/grammar/expressions/literals/templates.ts:31-35`)**: `if (token.kind !== 'template') return parser.missing('a template');` is unreachable because `parseTemplate` and `templateParselet` are dispatched only on `'template'` tokens (unlike `parseLiteral` in `parts/literals.ts:39`, which uses `unreachable`).
  4. **Redundant forwarding wrappers**:
     - `checkedEntries` (`src/compiler/parser/grammar/expressions/literals/indented-values.ts:110-116`) only calls `reportAfterComprehension(parser, entries)` and returns `entries`, whereas `struct-literals.ts:74-75` calls `reportAfterComprehension(parser, items)` directly.
     - `parseItemFunction` (`src/compiler/parser/grammar/declarations/functions.ts:68-70`) only forwards `parseFunction(parser, 'item')` for `grammar/index.ts:38`, while `declaration.ts:104` calls `parseFunction(parser, 'item')` directly.
  5. **Redundant double condition in `parseBinaryRest` (`src/compiler/parser/grammar/expressions/operators.ts:186-187`)**: `isChainingOperator(operator)` is called twice in a row (`const chain = isChainingOperator(operator) ? comparisonsOf(left) : undefined; if (chain !== undefined && isChainingOperator(operator))`), just as `node.kind === 'FunctionDeclaration'` is tested twice in `held-bodies.ts:29-30`.
  6. **Inconsistent arrow-property method on `Parser` (`src/compiler/parser/parser.ts:330`)**: `readonly typeApplication = (left: Expression) => this.#grammar.typeApplication(this, left)` is an instance arrow property allocating a closure per `Parser`, whereas all other 12 grammar forwarders on `Parser` (lines 296-352) are prototype methods and its only caller (`annotations.ts:39`) invokes `parser.typeApplication(head)` as a method.
  7. **Exported types with zero non-test importers**: `BracketPairs` (`cursor/brackets.ts:74`, used only in `brackets.test.ts`), `CursorMark` and `Indentation` (`cursor/index.ts:69, 79`), `CommaSeparated`, `DelimitedList`, and `GroupShapes` (`cursor/recovery.ts:42, 48, 116`), `HeadAhead` (`grammar/parts/heads.ts:38`), `Members` and `Body` (`layout/bodies.ts:25, 34`), `Lines` (`layout/index.ts:73`), `CopiedLiteral` (`formatter/expressions/literals.ts:33`), and `Standing` (`formatter/layout/brackets.ts:26`).
- proposal: Remove the dead branches in `parseAnnotation`, `parseKey` (reusing `parseLiteral`), and `templateLiteral`; make `reportAfterComprehension` return `items` and delete `checkedEntries`; make `Parser.typeApplication` a prototype method; simplify the double `isChainingOperator` check in `operators.ts:186-187`; and unexport internal-only interfaces/types.
- confidence: high

## Missing from docs/reuse

### Wrong or stale entries in `docs/reuse/`
- `docs/reuse/syntax-and-trees.md` (One-way rules, line 106): states *"Where a line break separates two items of a list (spec §2) has one home, `layout/item-breaks.ts`: `breakSeparatesItems` (the next line can start an item), `startsLineInList` and `atPostfix`"*. **`startsLineInList` is not in `src/compiler/parser/layout/item-breaks.ts`**; it is a method on `Cursor` in `src/compiler/parser/cursor/index.ts:255`. Meanwhile, `onOperandLine` in `src/compiler/parser/layout/item-breaks.ts:75` is not listed.
- `docs/reuse/syntax-and-trees.md` (Units, line 23): lists `standingIn` (`src/formatter/layout/brackets.ts`) as the unit for *"which children stand in brackets"*, but `standingIn` is only called within `src/formatter/layout/` (`bodies.ts`), whereas `nodesInBrackets(tree)` (`src/formatter/layout/brackets.ts:81`, called by `src/formatter/format.ts` and tests) is the exported tree-level query and is not listed.

### Reusable exported units with callers outside their folder missing from `docs/reuse/`
- `src/compiler/parser/diagnostics.ts`: `parserDiagnostics` (27 callers outside its folder, including `src/editor/language-service/completion/places/annotation.ts`; missing from `docs/reuse/diagnostics.md` and `docs/reuse/syntax-and-trees.md`).
- `src/compiler/parser/cursor/brackets.ts`: `isBracketOpener` (called by `src/editor/language-service/reading/tokens.ts` alongside `pairBrackets`) and `unclosedBracketEnds` (called by `src/compiler/parser/parser.ts`).
- `src/compiler/parser/cursor/recovery.ts`: `parseGroup` (3 callers outside `cursor/`: `atoms.ts`, `patterns.ts`, `types.ts`), `skipUntil` (4 callers outside `cursor/`), `skipToSeparator` (2 callers outside `cursor/`), `atRegionEnd` (2 callers outside `cursor/`), `parseEnclosedIn` (1 caller outside `cursor/`).
- `src/compiler/parser/layout/annotations.ts`: `attachAnnotations` (4 callers outside `layout/`).
- `src/compiler/parser/layout/bodies.ts`: `parseDocumentedBody`, `parseDocumentedMembers`, `parseDocstringBelow` (called from `grammar/parts/blocks.ts`, `grammar/declarations/functions.ts`, `grammar/declarations/type-declarations.ts`; only `parseBody` and `parseBlockBelow` are listed).
- `src/compiler/parser/layout/docstrings.ts`: `documentedBy` (4 callers outside `layout/`), `misplacedDocstring` (called in `grammar/expressions/expression.ts`), `WithDocstring` (3 callers outside `layout/`).
- `src/compiler/parser/layout/index.ts`: `ItemRules` (8 callers outside `layout/`), `parseModuleLines`, `parseBlockBraces`, `parseLines` (only `parseItemEntries` is listed).
- `src/compiler/parser/layout/continuations.ts`: `moveToContinuation` (called in `grammar/expressions/branches.ts`), `skipDeeperLines` (called in `grammar/nesting.ts`).
- `src/compiler/parser/layout/item-breaks.ts`: `onOperandLine` (called in `grammar/expressions/deferred-calls.ts`).
- `src/compiler/parser/grammar/parts/names.ts`: `parseQualifiedName` (2 callers outside `parts/`), `parseTargets` (4 callers outside `parts/`), `namedTypeFrom` (3 callers outside `parts/`).
- `src/compiler/parser/grammar/parts/spreads.ts`: `parseSpread` (4 callers outside `parts/`; only `spreadOpener` is mentioned in prose).
- `src/compiler/parser/grammar/parts/structs.ts`: `afterStructKeyword` (3 callers outside `parts/`), `parseField`, `declaredFieldRules`, `variantFieldRules`, `parseFieldEntries` (called from `type-declarations.ts` and `types.ts`).
- `src/compiler/parser/grammar/parts/functions.ts`: `parseParameters` (2 callers outside `parts/`: `declarations/functions.ts`, `expressions/lambdas.ts`).
- `src/compiler/parser/grammar/parts/field-headers.ts`: `parseFieldHeaderAfter` (3 callers outside `parts/`: `collections.ts`, `struct-literals.ts`, `loops.ts`).
- `src/compiler/parser/grammar/parts/constraints.ts`: `parseStructConstraint` (2 callers outside `parts/`: `types.ts`, `declarations/type-matches.ts`; only `parseConstraints` is listed).
- `src/compiler/parser/grammar/parts/blocks.ts`: `parseHeaderBody` (2 callers outside `parts/`), `parseDocumentedStatementBody`, `parseModuleItem`, `statementRules`.
- `src/compiler/parser/incremental/reuse.ts` & `held-bodies.ts`: `reusingSegments` (mentioned in `architecture.md`, not in `docs/reuse/syntax-and-trees.md`), `bodiesHeldBy`.
- `src/formatter/layout/lists.ts`: `tupleList` (3 callers outside `layout/`), `enclosed` (3 callers outside `layout/`), `angled` (4 callers outside `layout/`), `itemLines` (2 callers outside `layout/`), `oneLine` (2 callers outside `layout/`), `fieldList`, `hugging`, `blankBetween`, `hasComments` (only `bracketed` and `bracketedWhenBroken` are listed).
- `src/formatter/layout/bodies.ts`: `annotated` (3 callers outside `layout/`), `indentedBody` (3 callers outside `layout/`), `body` (2 callers outside `layout/`), `indentedBlock`, `functionBody`, `docBelow`, `opensBody`.
- `src/formatter/layout/brackets.ts`: `nodesInBrackets` (called in `src/formatter/format.ts`).
- `src/formatter/expressions/indented-values.ts`: `opened` (2 callers outside `expressions/`: `declarations.ts`, `statements.ts`).
- `src/formatter/expressions/branches.ts`: `ifChain` (called in `src/formatter/statements.ts`).
- `src/formatter/comments/comment-placement.ts` & `comments.ts`: `placeComments`, `leadingDocs`, `trailingDocs`, `danglingDocs`, `hasBlankLine`.
