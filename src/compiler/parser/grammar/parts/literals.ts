/**
 * Literals as expressions and patterns write them (§3.1, §11.3): the literal a token denotes, and
 * a negative number, which no literal is, so `-1` is `-` applied to `1`, the node an expression
 * builds. Where a literal stands alone, as a pattern, a minus negates only the numbers that
 * position allows.
 */

import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import type { Unary } from '../../../syntax/expressions/index.ts';
import type { Literal } from '../../../syntax/expressions/literals/literals.ts';
import type { CursorKind, CursorToken } from '../../cursor/index.ts';
import type { Parser } from '../../parser.ts';

/** The literal a token denotes, or undefined if it denotes none. */
export function literalFrom(parser: Parser, token: CursorToken): Literal | undefined {
  const span = parser.anchor(token.span);
  switch (token.kind) {
    case 'integer':
      return { kind: 'IntegerLiteral', span, value: token.value };
    case 'duration':
      return { kind: 'DurationLiteral', span, value: token.value };
    case 'float':
      return { kind: 'FloatLiteral', span, value: token.value };
    case 'string':
      return { kind: 'StringLiteral', span, value: token.value };
    case 'true':
    case 'false':
      return { kind: 'BooleanLiteral', span, value: token.kind === 'true' };
    case 'none':
      return { kind: 'NoneLiteral', span };
    default:
      return undefined;
  }
}

/** The literal at the cursor, which its caller's table found to start one. */
export function parseLiteral(parser: Parser): Literal {
  const literal = literalFrom(parser, parser.cursor.token);
  if (literal === undefined) {
    return unreachable('A literal starts at a literal token.');
  }
  parser.cursor.advance();
  return literal;
}

/** The numbers a minus may negate where a literal stands alone, and how to ask for one. */
export interface Negatable {
  readonly kinds: ReadonlySet<CursorKind>;
  readonly expected: string;
}

/** `-1`, at its minus: only a number of `negatable`'s kinds may follow it. */
export function parseNegativeLiteral(parser: Parser, negatable: Negatable): Unary {
  const { start } = parser.cursor.advance().span;
  const operand = negatable.kinds.has(parser.cursor.kind)
    ? literalFrom(parser, parser.cursor.advance())
    : undefined;
  const value = operand ?? parser.missing(negatable.expected);
  return { kind: 'Unary', span: parser.spanFrom(start), operator: '-', operand: value };
}
