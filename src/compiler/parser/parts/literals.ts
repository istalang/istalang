/**
 * The literal a token denotes. Expressions and patterns accept the same literals (§2, §3.11).
 */

import type { Literal } from '../../syntax/expressions.ts';
import type { Token } from '../../syntax/tokens.ts';

/** The literal a token denotes, or undefined if it denotes none. */
export function literalFrom(token: Token): Literal | undefined {
  const { span } = token;
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
