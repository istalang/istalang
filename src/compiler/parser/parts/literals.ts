/**
 * The literal a token denotes. Expressions and patterns accept the same literals (§2, §3.11).
 */

import type { Literal } from '../../syntax/expressions/index.ts';
import type { CursorToken } from '../cursor.ts';
import type { Parser } from '../parser.ts';

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
