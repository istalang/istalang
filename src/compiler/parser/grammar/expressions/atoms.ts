/**
 * Expressions that are complete in themselves: parentheses and tuples. A name is read where the
 * contextual words are (expression.ts), and a literal as patterns and types read one
 * (grammar/parts/literals.ts).
 */

import type { Expression } from '../../../syntax/expressions/index.ts';
import { parseGroup } from '../../cursor/recovery.ts';
import type { Parser } from '../../parser.ts';

/** `(x)` groups; `()`, `(x,)` and `(x, y)` are tuples (§3.15). */
export function parseParenthesized(parser: Parser): Expression {
  return parseGroup<Expression, Expression>(parser, () => parser.expression(), {
    tuple: (span, elements) => ({ kind: 'Tuple', span, elements }),
    grouped: (span, expression) => ({ kind: 'Parenthesized', span, expression }),
  });
}
