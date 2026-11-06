/**
 * The parsing context every grammar function receives: cursor, diagnostics, speculation, and the
 * entry points of each grammar category.
 *
 * Grammar categories (expressions, types, patterns, statements, declarations) call one another in
 * cycles: an `is` expression holds a pattern, and a pattern compares a field against an expression.
 * So a category reaches another only through this context, which grammar/index.ts wires once. What
 * several categories share without calling a category (qualified names, literals, parameters,
 * struct parts) lives in `grammar/parts/`, which every category may import. dependency-cruiser
 * enforces both rules.
 *
 * The parser reads text positions: tokens carry them, and so do its own decisions. A node it makes
 * gets its span anchored to the segment being parsed (syntax/tree/positions.ts), and reading a
 * node's position back goes through the segments' starts, which the tree keeps. Layout starts a
 * header segment for each item of a module or a trait standing on lines of its own, and a function
 * that is such an item parses its body as a segment of its own (`inFunctionBody`).
 *
 * Speculation settles two ambiguities: `name<…>(` against a comparison (§3.5), and `a, b = …`
 * against a comma that belongs to an enclosing call. An attempt that reports anything is undone
 * completely, cursor (cursor/index.ts) and diagnostics together, and while speculating, recovery
 * gives up instead of skipping tokens. A failed guess therefore costs only the tokens a well-formed
 * one would have read.
 */

import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { lineMapOf } from '../../foundation/text/line-map.ts';
import type { SourceText } from '../../foundation/text/source-text.ts';
import { type Span, textOf } from '../../foundation/text/span.ts';
import {
  type Declaration,
  type FunctionDeclaration,
  nestedFunctionSpan,
} from '../syntax/declarations/index.ts';
import type { Expression } from '../syntax/expressions/index.ts';
import type { PrecedenceLevel } from '../syntax/expressions/operators.ts';
import type { Pattern } from '../syntax/patterns.ts';
import type { Block, Statement } from '../syntax/statements/index.ts';
import type { ContextualWord, TemplateValue, Token, TokenKind } from '../syntax/tokens/index.ts';
import type { SyntaxNode } from '../syntax/tree/index.ts';
import type { Identifier, Invalid, Missing } from '../syntax/tree/node.ts';
import {
  type AnchoredSpan,
  type Segment,
  type SegmentBases,
  spanIn,
} from '../syntax/tree/positions.ts';
import type { TypeNode } from '../syntax/types/index.ts';
import { unclosedBracketEnds } from './cursor/brackets.ts';
import { Cursor, type CursorKind } from './cursor/index.ts';
import { parserDiagnostics } from './diagnostics.ts';

/** The entry point of each grammar category, wired in by grammar/index.ts. */
export interface Grammar {
  readonly expression: (parser: Parser, minLevel: PrecedenceLevel) => Expression;
  /**
   * Continues an expression whose leftmost operand is already parsed. This and `startsExpression`
   * sit here so that parselets can re-enter the Pratt engine without importing it, which would be
   * a cycle.
   */
  readonly continueExpression: (
    parser: Parser,
    left: Expression,
    minLevel: PrecedenceLevel,
  ) => Expression;
  readonly startsExpression: (parser: Parser) => boolean;
  /**
   * The value after `=`, `return` or a key's `:`, `opener` starting its line or entry: an indented
   * value when the line ends there or in `T:` (§2), else an expression.
   */
  readonly value: (parser: Parser, opener: number) => Expression;
  /**
   * Whether a token of `kind`, first on its line inside a list, starts an item rather than
   * continuing the one before (layout/item-breaks.ts), given the `next` token's kind, and `spaced`
   * when a space parts the two on one line.
   */
  readonly startsItemOnNewLine: (kind: CursorKind, next: CursorKind, spaced: boolean) => boolean;
  readonly type: (parser: Parser) => TypeNode;
  /** A parameter's type, the one place `&T` is allowed (§3.7). */
  readonly parameterType: (parser: Parser) => TypeNode;
  /** A parameter's pattern (§3.3), the one place `{…}` stands for `struct{…}`. */
  readonly parameterPattern: (parser: Parser) => Pattern;
  /** `<A, B>`, starting at the `<`. */
  readonly typeArguments: (parser: Parser) => readonly TypeNode[];
  readonly pattern: (parser: Parser) => Pattern;
  readonly statement: (parser: Parser) => Statement | Invalid;
  /** A declaration only the top level allows, or undefined if none starts here. */
  readonly topLevelDeclaration: (parser: Parser) => Declaration | undefined;
  /** A function with a body, starting at `fn` or `async`: top-level or local. */
  readonly functionDeclaration: (parser: Parser) => FunctionDeclaration;
}

/**
 * How deeply grammar entries may nest. Each level costs a bounded number of host stack frames, so
 * this keeps parsing far from the stack's limit while exceeding anything written by hand.
 */
export const nestingLimit = 200;

/**
 * Where the parser is among segments: the one it anchors spans to, where it starts, and where the
 * item of a header segment starts, past its annotations.
 */
interface Place {
  readonly segment: Segment;
  readonly base: number;
  readonly itemStart: number | undefined;
}

export class Parser implements SegmentBases {
  #cursor: Cursor;
  readonly #source: SourceText;
  readonly #grammar: Grammar;
  readonly #diagnostics: Diagnostic[] = [];
  readonly #bodies = new Map<FunctionDeclaration, Block>();
  readonly #bases = new Map<Segment, number>();
  #place: Place;
  #speculationDepth = 0;
  #nesting = 0;

  constructor(source: SourceText, tokens: readonly Token[], grammar: Grammar) {
    this.#source = source;
    const tokenColumn = (token: Token) => this.columnOf(token);
    this.#cursor = new Cursor(tokens, undefined, {
      unclosedEnds: unclosedBracketEnds(tokens, tokenColumn),
      columnOf: tokenColumn,
    });
    this.#grammar = grammar;
    this.#place = { segment: { kind: 'module' }, base: 0, itemStart: undefined };
    this.#bases.set(this.#place.segment, 0);
  }

  get cursor(): Cursor {
    return this.#cursor;
  }

  /**
   * Runs `parse` over a template value's own tokens (syntax/tokens/index.ts), whose `end` stands
   * where its `}` does; line breaks there are ignored, as in brackets (§2).
   */
  withinTemplateValue<Result>(value: TemplateValue, parse: () => Result): Result {
    const outer = this.#cursor;
    this.#cursor = new Cursor(value.tokens, value);
    const result = this.#cursor.ignoringLineBreaks(parse);
    this.#cursor = outer;
    return result;
  }

  get diagnostics(): readonly Diagnostic[] {
    return this.#diagnostics;
  }

  get isSpeculating(): boolean {
    return this.#speculationDepth > 0;
  }

  report(diagnostic: Diagnostic): void {
    this.#diagnostics.push(diagnostic);
  }

  /**
   * The body of each function parsed, which the tree holds apart from the function
   * (syntax/tree/index.ts), functions the parser let go of since included: a parse undone, a node
   * made Invalid.
   */
  get recordedBodies(): ReadonlyMap<FunctionDeclaration, Block> {
    return this.#bodies;
  }

  /** Where each segment parsed starts in the text. */
  get bases(): ReadonlyMap<Segment, number> {
    return this.#bases;
  }

  /** `span`, text positions in the segment being parsed, anchored to that segment. */
  anchor({ start, end }: Span): AnchoredSpan {
    const { segment, base } = this.#place;
    // Before a header's first token is read, the end of the last one read lies in the segment
    // before; a position there, where an empty node is taken to stand, is the header's start.
    return { segment, from: Math.max(0, start - base), to: Math.max(0, end - base) };
  }

  /** Starts a header segment at the next token, where a module's or a trait's item starts. */
  startHeader(): void {
    this.#enter({ kind: 'header' }, this.cursor.token.span.start);
  }

  /** Marks the next token as where the item of the header segment begun last starts. */
  markItemStart(): void {
    this.#place = { ...this.#place, itemStart: this.cursor.token.span.start };
  }

  /**
   * Runs `parse`, the body of a function starting at `start`, from here on: as a segment of its
   * own when that function is the item of the header segment being parsed, in the segment around
   * it when it is nested in one, as a local function is.
   */
  inFunctionBody<Result>(start: number, parse: () => Result): Result {
    if (!this.isHeaderItem(start)) {
      return parse();
    }
    return this.restoringSegment(() => {
      this.#enter({ kind: 'body' }, this.cursor.previousEnd);
      return parse();
    });
  }

  /**
   * Whether the item starting at `start` is the one the header segment being parsed was begun
   * for, whose body or members then take segments of their own, as nothing nested does.
   */
  isHeaderItem(start: number): boolean {
    const { segment, itemStart } = this.#place;
    return segment.kind === 'header' && start === itemStart;
  }

  /** Runs `parse`, then parses on in the segment, and for the item, current before it. */
  restoringSegment<Result>(parse: () => Result): Result {
    const place = this.#place;
    const result = parse();
    this.#place = place;
    return result;
  }

  #enter(segment: Segment, base: number): void {
    this.#bases.set(segment, base);
    this.#place = { segment, base, itemStart: undefined };
  }

  /** The text positions of `span`, which this parser anchored. */
  textSpanOf(span: AnchoredSpan): Span {
    return spanIn(this, span);
  }

  /** Where `node`, which this parser made, starts in the text. */
  startOf(node: { readonly span: AnchoredSpan }): number {
    return this.textSpanOf(node.span).start;
  }

  /** Records `body` as `declaration`'s. */
  addBody(declaration: FunctionDeclaration, body: Block): void {
    this.#bodies.set(declaration, body);
  }

  /**
   * The span `node` covers with the body recorded for it: a local function's, header and body, in
   * one segment; any other node's own.
   */
  wholeSpanOf(node: SyntaxNode): AnchoredSpan {
    return node.kind === 'FunctionDeclaration'
      ? nestedFunctionSpan(node, this.#bodies.get(node))
      : node.span;
  }

  /** Gives `from`'s body, if it has one, to `to`, the same function made anew. */
  moveBody(from: FunctionDeclaration, to: FunctionDeclaration): void {
    const body = this.#bodies.get(from);
    if (body !== undefined) {
      this.#bodies.delete(from);
      this.#bodies.set(to, body);
    }
  }

  /**
   * Runs `parse` one level of nesting deeper, or returns undefined without running it once the
   * limit is reached (grammar/nesting.ts).
   */
  descend<Result>(parse: () => Result): Result | undefined {
    if (this.#nesting >= nestingLimit) {
      return undefined;
    }
    this.#nesting += 1;
    const result = parse();
    this.#nesting -= 1;
    return result;
  }

  /** Runs `attempt`; if it returns undefined or reports anything, undoes all it did. */
  speculate<Result>(attempt: () => Result | undefined): Result | undefined {
    const mark = this.cursor.mark();
    const reported = this.#diagnostics.length;
    this.#speculationDepth += 1;
    const result = attempt();
    this.#speculationDepth -= 1;
    if (result === undefined || this.#diagnostics.length > reported) {
      this.cursor.reset(mark);
      this.#diagnostics.length = reported;
      return undefined;
    }
    return result;
  }

  expression(minLevel: PrecedenceLevel = 'coalesce'): Expression {
    return this.#grammar.expression(this, minLevel);
  }

  continueExpression(left: Expression, minLevel: PrecedenceLevel = 'coalesce'): Expression {
    return this.#grammar.continueExpression(this, left, minLevel);
  }

  startsExpression(): boolean {
    return this.#grammar.startsExpression(this);
  }

  value(opener: number): Expression {
    return this.#grammar.value(this, opener);
  }

  /** The grammar's `startsItemOnNewLine`. */
  startsItemOnNewLine(kind: CursorKind, next: CursorKind, spaced: boolean): boolean {
    return this.#grammar.startsItemOnNewLine(kind, next, spaced);
  }

  type(): TypeNode {
    return this.#grammar.type(this);
  }

  parameterType(): TypeNode {
    return this.#grammar.parameterType(this);
  }

  typeArguments(): readonly TypeNode[] {
    return this.#grammar.typeArguments(this);
  }

  parameterPattern(): Pattern {
    return this.#grammar.parameterPattern(this);
  }

  pattern(): Pattern {
    return this.#grammar.pattern(this);
  }

  statement(): Statement | Invalid {
    return this.#grammar.statement(this);
  }

  topLevelDeclaration(): Declaration | undefined {
    return this.#grammar.topLevelDeclaration(this);
  }

  functionDeclaration(): FunctionDeclaration {
    return this.#grammar.functionDeclaration(this);
  }

  textOf(token: { readonly span: Span }): string {
    return textOf(this.#source, token.span);
  }

  /** Whether the cursor stands at `word`, a keyword only in one position, a name elsewhere (§2). */
  atWord(word: ContextualWord): boolean {
    return this.cursor.at('identifier') && this.textOf(this.cursor.token) === word;
  }

  /**
   * The column layout sees a token at. For the first token on a line, that is the line's
   * indentation.
   */
  columnOf(token: { readonly span: Span }): number {
    return lineMapOf(this.#source).positionAt(token.span.start).column;
  }

  /** The indentation of the line that `offset` is on: the column of its first token. */
  indentationAt(offset: number): number {
    return this.columnOf(this.cursor.lineHead(offset));
  }

  /** Whether two offsets lie on the same line. */
  onSameLine(first: number, second: number): boolean {
    const lineMap = lineMapOf(this.#source);
    return lineMap.positionAt(first).line === lineMap.positionAt(second).line;
  }

  /**
   * The span from `start` to the end of the last consumed token. A node starts at its first child
   * or its first consumed token, never at the next token's position taken beforehand: a missing
   * child sits before any whitespace, and would fall outside its parent.
   */
  spanFrom(start: number): AnchoredSpan {
    return this.anchor(this.textSpanFrom(start));
  }

  /** As `spanFrom`, in text positions: where a diagnostic about what was just read points. */
  textSpanFrom(start: number): Span {
    return { start, end: Math.max(start, this.cursor.previousEnd) };
  }

  /** Where the next token is, or just after the last one when a line break or the end is next. */
  get nextSpan(): Span {
    const { kind } = this.cursor;
    const at = this.cursor.previousEnd;
    return kind === 'lineBreak' || kind === 'end' ? { start: at, end: at } : this.cursor.token.span;
  }

  /** Reports that `expected` should come next, pointing at what is there instead. */
  reportExpected(expected: string): void {
    this.report(parserDiagnostics.expected(this.nextSpan, expected, this.describeNext()));
  }

  /** Consumes `kind`, or reports it missing without consuming anything. */
  expect(kind: TokenKind): Token | undefined {
    const token = this.cursor.eat(kind);
    if (token === undefined) {
      this.reportExpected(`'${kind}'`);
    }
    return token;
  }

  /** A required name: consumed, or reported and returned with empty text. */
  identifier(what = 'a name'): Identifier {
    const token = this.cursor.eat('identifier');
    if (token !== undefined) {
      return { kind: 'Identifier', span: this.anchor(token.span), text: this.textOf(token) };
    }
    this.reportExpected(what);
    return { kind: 'Identifier', span: this.#emptySpan(), text: '' };
  }

  /** A required node that isn't there: reported, and an empty Missing node returned. */
  missing(what: string): Missing {
    this.reportExpected(what);
    return this.placeholder();
  }

  /** A node an earlier diagnostic already explains as absent: empty, and not reported again. */
  placeholder(): Missing {
    return { kind: 'Missing', span: this.#emptySpan() };
  }

  /** How the next token reads in a message. */
  describeNext(): string {
    const { kind } = this.cursor;
    switch (kind) {
      case 'lineBreak':
        return 'the end of the line';
      case 'end':
        return this.cursor.inTemplateValue ? "'}'" : 'the end of the input';
      case 'template':
        return 'a template';
      case 'docstring':
        return 'a docstring';
      case 'identifier':
        return `name '${this.textOf(this.cursor.token)}'`;
      case 'integer':
      case 'float':
      case 'duration':
      case 'string':
      case 'unknown':
        return `'${this.textOf(this.cursor.token)}'`;
      default:
        return `'${kind}'`;
    }
  }

  #emptySpan(): AnchoredSpan {
    const at = this.cursor.previousEnd;
    return this.anchor({ start: at, end: at });
  }
}
