/**
 * A case of a `match`, a `select` or a type `match` (§11.3, §4.6, §15.4): `case`, then what the
 * construct reads after it. The constructs differ in what a case holds, never in how a line that
 * isn't one recovers, so that lives here once.
 */

import type { Invalid } from '../../../syntax/tree/node.ts';
import { skipToSeparator } from '../../cursor/recovery.ts';
import type { Parser } from '../../parser.ts';

/**
 * `case`, then whatever `parseRest` reads from where the case starts. A line that doesn't start
 * with `case` is reported and skipped whole, as one Invalid node.
 */
export function parseCase<Case>(
  parser: Parser,
  parseRest: (start: number) => Case,
): Case | Invalid {
  const reported = parser.diagnostics.length;
  const keyword = parser.expect('case');
  if (keyword !== undefined) {
    return parseRest(keyword.span.start);
  }
  const at = parser.cursor.previousEnd;
  const [skipped] = skipToSeparator(parser, reported, 'lineBreak');
  return skipped ?? { kind: 'Invalid', span: parser.anchor({ start: at, end: at }) };
}
