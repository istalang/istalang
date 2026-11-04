---
description: tokens, AST nodes, operators, places, chains, field defaults, templates and traversal — read before inspecting or adding syntax nodes or operators
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-29
last_updated: 2026-11-04
tags: [reuse, syntax, ast, scanner, parser, operators]
---

# Syntax trees and traversal

## Units

- scan a `SourceText` into tokens, comments and diagnostics → `scan` (`src/compiler/scanner/scan.ts`)
- parse a `SourceText` and `ScanResult` into a `SyntaxTree`, keeping a previous tree's nodes for every segment an edit left alike → `parse` (`src/compiler/parser/parse.ts`)
- print a `SyntaxTree`, a `SourceText` or a text in the canonical format, refusing one with syntax errors → `formatTree`, `formatSource`, `formatText` (`src/formatter/format.ts`)
- read a tree's tokens again, all of them or only its code's, or the bracket closing each opening one → `allTokensOf`, `codeTokensOf`, `closingBracketsOf` (`src/language-service/tokens.ts`)
- pair a token list's brackets as the parser does, and find where each one left open ends → `pairBrackets` (`src/compiler/parser/brackets.ts`)
- check whether a word is a reserved or contextual keyword → `isKeyword`, `isContextualWord`, `keywords`, `punctuators` (`src/compiler/syntax/tokens.ts`)
- get the last identifier of a `QualifiedName` or check for a missing identifier → `lastName`, `isMissingName` (`src/compiler/syntax/node.ts`)
- list a syntax node's direct children in source order, its field children alone, or a function's body → `childrenOf`, `fieldChildrenOf`, `bodyOf`, `isNode` (`src/compiler/syntax/tree.ts`)
- check whether an item may stand in a module or a block → `allowedInModule`, `allowedInBlock` (`src/compiler/syntax/placement.ts`)
- find a node's parent, or the nodes holding an offset from the root to the innermost → `parentOf`, `nodesAt` (`src/compiler/syntax/tree.ts`)
- read where a node stands in the text: its own span → `spanIn`; it and everything under it, through a function's body or a trait's members → `extentIn` (`src/compiler/syntax/positions.ts`, `src/compiler/syntax/tree.ts`)
- join or compare spans of one segment: first to last, covering several, the empty span at an end, containment, one place → `spanAcross`, `spanCovering`, `endOf`, `encloses`, `startTogether` (`src/compiler/syntax/positions.ts`)
- turn a phase's anchored diagnostic into one at text positions as it leaves → `diagnosticIn` (`src/compiler/syntax/positions.ts`)
- the text a lambda or local function covers, header and body → `nestedFunctionSpan` (`src/compiler/syntax/declarations.ts`); lowering's, from the tree → `nestedSpanOf` (`src/compiler/lowering/bodies.ts`)
- list a node and every node under it in source order, each before its children (explicit stack) → `nodesUnder` (`src/compiler/syntax/tree.ts`)
- list direct children that run in the same function body (skipping nested functions) → `bodyChildrenOf`, `nestsFunction` (`src/compiler/syntax/tree.ts`)
- look up operator precedence, associativity and meaning → `binaryOperators`, `unaryOperators`, `operatorLevels` (`src/compiler/syntax/operators.ts`)
- classify operators or unwrap a compound assignment's operator → `isAssignmentOperator`, `compoundOperator` (`src/compiler/syntax/operators.ts`)
- test whether a token kind is a comparison or chaining operator, or one calling `compare`/`includes` → `isComparisonOperator`, `isChainingOperator`, `isImplicitOperator` (`src/compiler/syntax/operators.ts`)
- compute precedence levels for operator parsing and printing → `tighterLevel`, `rightOperandLevel`, `bindingPower` (`src/compiler/syntax/operators.ts`)
- strip outer parentheses from an `Expression` → `unparenthesized` (`src/compiler/syntax/expressions/index.ts`)
- strip outer parentheses from a `Pattern` → `unparenthesizedPattern` (`src/compiler/syntax/patterns.ts`)
- strip outer parentheses from a `TypeNode` before asking its kind → `unparenthesizedType` (`src/compiler/syntax/types.ts`)
- read a `QualifiedName` from an `Identifier` or non-optional `MemberAccess` chain → `qualifiedPath` (`src/compiler/syntax/expressions/index.ts`)
- read the value or field name of a struct literal's `FieldItem` → `itemValue`, `itemName` (`src/compiler/syntax/expressions/index.ts`)
- read the number a literal writes, negated or not (`-5`, `-(5)`), as one signed value → `signedNumberOf` (`src/compiler/syntax/expressions/numbers.ts`)
- list valid `MatchCase`s of a `Match`, or `SelectCase`s of a `Select` → `casesOf`, `selectCasesOf` (`src/compiler/syntax/expressions/index.ts`); never filter `node.cases` by kind
- unwrap a `CallArgument`'s expression or find an out-of-order argument → `argumentValue`, `misplacedArgument` (`src/compiler/syntax/expressions/arguments.ts`)
- inspect an optional chain step, or spell a link form's operator, optional or not → `chainStepOf`, `isOptionalStep`, `linkOperator`, `optionalOperatorOf` (`src/compiler/syntax/expressions/chains.ts`)
- test whether an expression is inside an optional chain → `isOptionallyChained` (`src/compiler/syntax/expressions/chains.ts`)
- read a comparison as `ComparisonLink`s, a chain's (`a < b <= c`) or a single binary's, and a link's span → `comparisonLinksOf`, `comparisonLinkOf`, `linkSpan` (`src/compiler/syntax/expressions/comparisons.ts`)
- check whether an expression is a place or decompose it into `{ root, steps }` → `isPlace`, `placePath` (`src/compiler/syntax/expressions/places.ts`)
- get a constant template's text → `constantTextOf` (`src/compiler/syntax/expressions/templates.ts`)
- get the memoized `Call` node of a tagged template → `isTagged`, `taggedCall` (`src/compiler/syntax/expressions/templates.ts`)
- list valid `TypeParameter`s or declared `fn`s in a module → `typeParametersOf`, `declaredFunctions` (`src/compiler/syntax/declarations.ts`)
- check for a `self` method, a field default, or a struct declared with fields, shared or not → `isMethod`, `hasDefault`, `isDeclaredStruct` (`src/compiler/syntax/declarations.ts`); a shared struct is its own kind, `SharedStructDeclaration`, never a flag
- get the synthesized default function for a struct's or variant's fields → `fieldsFunctionOf`, `fieldsFunctionsOf` (`src/compiler/syntax/field-defaults.ts`)
- list all functions in a module or test for a fields function → `functionsOf`, `isFieldsFunction` (`src/compiler/syntax/field-defaults.ts`)
- list identifiers bound by a target pattern or check whether it contains `_` → `targetNames`, `hasUnnamedPart` (`src/compiler/syntax/patterns.ts`)
- decompose or validate an assignment target → `destructuringOf`, `destructures`, `targetParts`, `isTarget` (`src/compiler/syntax/statements.ts`)
- check whether an assignment target is or contains `_` → `isUnnamedTarget`, `hasUnnamedTarget` (`src/compiler/syntax/statements.ts`)
- get the identifier inside `drop x` or a `Block`'s tail expression/node → `droppedName`, `tailExpressionOf`, `tailNodeOf` (`src/compiler/syntax/statements.ts`)

## One-way rules

- Shared desugaring (`taggedCall`, `fieldsFunctionOf`, `comparisonLinksOf`, `placePath`, `destructuringOf`) lives in `src/compiler/syntax/`.
- A link reads through an optional when its node `isOptional` (member access, tuple element, index, call, `->`); its operator is spelled by `linkOperator`/`optionalOperatorOf` (`chains.ts`), never as a literal.
- Node fields hold only nodes, node arrays, optional nodes/arrays, a span or primitives, so `childrenOf` (`tree.ts`) derives traversal automatically.
- A node's span is anchored to its segment (`AnchoredSpan`, `positions.ts`): offsets of different segments never compare, and text positions come only through the tree (`spanIn`, `extentIn`). A function's own span covers its header alone, as does a top-level trait's whose members stand on lines of their own; use `extentIn` for all a node covers.
- In `src/compiler/parser/`, bracketed lists use `parseEnclosed` / `parseDelimited` (`recovery.ts`) and recursive entries use `nested` (`nesting.ts`).

## Recipes

### Add a syntax node kind

1. Declare the interface extending `NodeOf<'Kind'>` in `src/compiler/syntax/` and add it to its union in `src/compiler/syntax/tree.ts`.
2. Parse it in `src/compiler/parser/` using `nested` (`nesting.ts`) and `parseEnclosed` / `parseDelimited` (`recovery.ts`).
3. Add its handler to every exhaustive `Handlers` table across `binder/`, `checker/` (including `flow/forward.ts`), and `lowering/`.
