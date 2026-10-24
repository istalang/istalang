/**
 * `...xs`: spreading into an array, a map, a call's arguments or a struct literal. It is not an
 * expression on its own, so only those lists offer it.
 */

import type { Spread } from '../../syntax/expressions.ts';
import type { Parser } from '../parser.ts';

/** A spread, starting at its `...`. */
export function parseSpread(parser: Parser): Spread {
  const { start } = parser.cursor.advance().span;
  const expression = parser.expression();
  return { kind: 'Spread', span: parser.spanFrom(start), expression };
}
