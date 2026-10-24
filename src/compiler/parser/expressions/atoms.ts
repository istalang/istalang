/**
 * Expressions that are complete in themselves: names, literals, parentheses and tuples.
 */

import type { Expression } from '../../syntax/expressions.ts';
import type { Parser } from '../parser.ts';
import { literalFrom } from '../parts/literals.ts';
import { groupedItem, parseDelimited } from '../recovery.ts';

export function parseName(parser: Parser): Expression {
  return parser.identifier();
}

export function parseLiteral(parser: Parser): Expression {
  return literalFrom(parser.cursor.advance()) ?? parser.missing('a literal');
}

/** `(x)` groups; `()`, `(x,)` and `(x, y)` are tuples (§3.15). */
export function parseParenthesized(parser: Parser): Expression {
  const list = parseDelimited(parser, '(', () => parser.expression());
  const grouped = groupedItem(list);
  return grouped === undefined
    ? { kind: 'Tuple', span: list.span, elements: list.items }
    : { kind: 'Parenthesized', span: list.span, expression: grouped };
}
