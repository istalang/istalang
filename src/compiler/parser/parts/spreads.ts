/**
 * The token opening a spread (`...xs` in an array, a map, a call or a struct literal, §2) and a
 * rest (a pattern's, a parameter's, a function type's or a type parameter pack's, §3.3, §3.5,
 * §3.11): every list item it opens is read through this name, which also tells where a line
 * break before it starts an item (layout/item-breaks.ts).
 *
 * A spread, `...xs`, spreads into an array, a map, a call's arguments or a struct literal. It is
 * not an expression on its own, so only those lists offer it.
 */

import type { Spread } from '../../syntax/expressions/index.ts';
import type { Parser } from '../parser.ts';

export const spreadOpener = '...';

/** A spread, starting at its `...`. */
export function parseSpread(parser: Parser): Spread {
  const { start } = parser.cursor.advance().span;
  const expression = parser.expression();
  return { kind: 'Spread', span: parser.spanFrom(start), expression };
}
