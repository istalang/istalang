/**
 * Lines that continue a construct across a line break its region would end at (§10.1): `elif` and
 * `else` lined up with their `if`'s line, and the deeper lines a construct being skipped holds.
 * Layout's other decisions to move past a line break are index.ts's and item-breaks.ts's.
 */

import type { CursorKind } from '../cursor/index.ts';
import { skipUntil } from '../cursor/recovery.ts';
import type { Parser } from '../parser.ts';

/**
 * Moves to `keyword` if it continues the construct that starts at `constructStart`: next on this
 * line, or first on the next line at the column where the construct's line starts (§10.1). Returns
 * whether it did.
 */
export function moveToContinuation(
  parser: Parser,
  keyword: CursorKind,
  constructStart: number,
): boolean {
  const { cursor } = parser;
  if (cursor.at(keyword)) {
    return true;
  }
  const next = cursor.lineStart;
  if (next?.kind !== keyword || parser.columnOf(next) !== parser.indentationAt(constructStart)) {
    return false;
  }
  cursor.crossLineBreak();
  return true;
}

/**
 * Skips every following line indented deeper than `indentation`: lines that can only belong to
 * a construct being skipped. While speculating, recovery skips nothing, so this crosses nothing.
 */
export function skipDeeperLines(parser: Parser, indentation: number): void {
  const { cursor } = parser;
  while (!parser.isSpeculating && deeperLineFollows(parser, indentation)) {
    cursor.crossLineBreak();
    skipUntil(parser, []);
  }
}

function deeperLineFollows(parser: Parser, indentation: number): boolean {
  const next = parser.cursor.lineStart;
  return next !== undefined && parser.columnOf(next) > indentation;
}
