/**
 * The parsing context every grammar function receives: cursor, diagnostics, speculation, and the
 * entry points of each grammar category.
 *
 * Grammar categories (expressions, types, patterns, statements, declarations) call one another in
 * cycles: an `is` expression
 * holds a pattern, and a pattern compares a field against an expression. So a category reaches
 * another only through this context, which grammar.ts wires once. What several categories share
 * without calling a category (qualified names, literals, parameters, struct parts) lives in
 * `parts/`, which every category may import. dependency-cruiser enforces both rules.
 *
 * Speculation settles two ambiguities: `name<…>(` against a comparison (§3.5), and `a, b = …`
 * against a comma that belongs to an enclosing call. An attempt that reports anything is undone
 * completely, cursor (cursor.ts) and diagnostics together, and while speculating, recovery gives
 * up instead of skipping tokens. A failed guess therefore costs only the tokens a well-formed one
 * would have read.
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import { lineMapOf } from '../../text/line-map.ts';
import type { SourceText } from '../../text/source-text.ts';
import { type Span, textOf } from '../../text/span.ts';
import type { Declaration, FunctionDeclaration } from '../syntax/declarations.ts';
import type { Expression } from '../syntax/expressions/index.ts';
import type { Identifier, Invalid, Missing } from '../syntax/node.ts';
import type { PrecedenceLevel } from '../syntax/operators.ts';
import type { Pattern } from '../syntax/patterns.ts';
import type { Block, Statement } from '../syntax/statements.ts';
import type { ContextualWord, TemplateValue, Token, TokenKind } from '../syntax/tokens.ts';
import type { TypeNode } from '../syntax/types.ts';
import { Cursor } from './cursor.ts';
import { parserDiagnostics } from './diagnostics.ts';

/** The entry point of each grammar category, wired in by grammar.ts. */
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
  readonly type: (parser: Parser) => TypeNode;
  /** A parameter's type, the one place `&T` is allowed (§3.7). */
  readonly parameterType: (parser: Parser) => TypeNode;
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

export class Parser {
  #cursor: Cursor;
  readonly #source: SourceText;
  readonly #grammar: Grammar;
  readonly #diagnostics: Diagnostic[] = [];
  readonly #bodies = new Map<FunctionDeclaration, Block>();
  #speculationDepth = 0;
  #nesting = 0;

  constructor(source: SourceText, tokens: readonly Token[], grammar: Grammar) {
    this.#cursor = new Cursor(tokens);
    this.#source = source;
    this.#grammar = grammar;
  }

  get cursor(): Cursor {
    return this.#cursor;
  }

  /**
   * Runs `parse` over a template value's own tokens (syntax/tokens.ts), whose `end` stands where
   * its `}` does; line breaks there are ignored, as in brackets (§2).
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
   * The body of each function parsed, which the tree holds apart from the function (syntax/tree.ts),
   * functions the parser let go of since included: a parse undone, a node made Invalid.
   */
  get recordedBodies(): ReadonlyMap<FunctionDeclaration, Block> {
    return this.#bodies;
  }

  /** Records `body` as `declaration`'s. */
  addBody(declaration: FunctionDeclaration, body: Block): void {
    this.#bodies.set(declaration, body);
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
   * limit is reached (nesting.ts).
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

  type(): TypeNode {
    return this.#grammar.type(this);
  }

  parameterType(): TypeNode {
    return this.#grammar.parameterType(this);
  }

  typeArguments(): readonly TypeNode[] {
    return this.#grammar.typeArguments(this);
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

  /** The column layout sees a token at. For the first token on a line, that is the line's indentation. */
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
  spanFrom(start: number): Span {
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
      return { kind: 'Identifier', span: token.span, text: this.textOf(token) };
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

  #emptySpan(): Span {
    const at = this.cursor.previousEnd;
    return { start: at, end: at };
  }
}
