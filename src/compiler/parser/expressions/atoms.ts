/**
 * Expressions that are complete in themselves: names, literals, parentheses and tuples.
 */

import type { Expression } from '../../syntax/expressions/index.ts';
import type { Parser } from '../parser.ts';
import { literalFrom } from '../parts/literals.ts';
import { parseGroup } from '../recovery.ts';
import { parseNew } from './struct-literals.ts';

/** A name, or `new` before one, which starts a shared struct's literal (§3.18). */
export function parseName(parser: Parser): Expression {
  if (parser.atWord('new') && parser.cursor.kindAt(1) === 'identifier') {
    return parseNew(parser);
  }
  return parser.identifier();
}

export function parseLiteral(parser: Parser): Expression {
  return literalFrom(parser, parser.cursor.advance()) ?? parser.missing('a literal');
}

/** `(x)` groups; `()`, `(x,)` and `(x, y)` are tuples (§3.15). */
export function parseParenthesized(parser: Parser): Expression {
  return parseGroup<Expression, Expression>(parser, () => parser.expression(), {
    tuple: (span, elements) => ({ kind: 'Tuple', span, elements }),
    grouped: (span, expression) => ({ kind: 'Parenthesized', span, expression }),
  });
}
