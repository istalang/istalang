/**
 * The parsing context every grammar function receives: cursor, diagnostics, speculation, and the
 * entry points of each grammar category.
 *
 * Grammar categories (expressions, types, patterns) call one another in cycles: an `is` expression
 * holds a pattern, and a pattern compares a field against an expression. So a category reaches
 * another only through this context, which grammar.ts wires once. What several categories share
 * without calling a category (qualified names, literals, parameters, struct parts) lives in
 * `parts/`, which every category may import. dependency-cruiser enforces both rules.
 *
 * Speculation exists for one ambiguity, `name<…>(` (gap G9). An attempt that reports anything is
 * undone completely, cursor and diagnostics together, and while speculating, recovery gives up
 * instead of skipping tokens. A failed guess therefore costs only the tokens a well-formed one
 * would have read.
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import type { SourceText } from '../../text/source-text.ts';
import { type Span, textOf } from '../../text/span.ts';
import type { Expression } from '../syntax/expressions.ts';
import type { Identifier, Missing } from '../syntax/node.ts';
import type { PrecedenceLevel } from '../syntax/operators.ts';
import type { Pattern } from '../syntax/patterns.ts';
import type { Token, TokenKind } from '../syntax/tokens.ts';
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
  /** A parameter's type, the one place `&T` is allowed (gap G11). */
  readonly parameterType: (parser: Parser) => TypeNode;
  /** `<A, B>`, starting at the `<`. */
  readonly typeArguments: (parser: Parser) => readonly TypeNode[];
  readonly pattern: (parser: Parser) => Pattern;
}

export class Parser {
  readonly cursor: Cursor;
  readonly #source: SourceText;
  readonly #grammar: Grammar;
  readonly #diagnostics: Diagnostic[] = [];
  #speculationDepth = 0;

  constructor(source: SourceText, tokens: readonly Token[], grammar: Grammar) {
    this.cursor = new Cursor(tokens);
    this.#source = source;
    this.#grammar = grammar;
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

  /** Runs `attempt`; if it returns undefined or reports anything, undoes all it did. */
  speculate<Result>(attempt: () => Result | undefined): Result | undefined {
    const { index } = this.cursor;
    const reported = this.#diagnostics.length;
    this.#speculationDepth += 1;
    const result = attempt();
    this.#speculationDepth -= 1;
    if (result === undefined || this.#diagnostics.length > reported) {
      this.cursor.rewind(index);
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

  textOf(token: Token): string {
    return textOf(this.#source, token.span);
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
        return 'the end of the input';
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
