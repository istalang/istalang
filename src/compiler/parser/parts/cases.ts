/**
 * A case of a `match`, a `select` or a type `match` (§3.11, §3.17, §8): `case`, then what the
 * construct reads after it. The constructs differ in what a case holds, never in how a line that
 * isn't one recovers, so that lives here once.
 */

import type { Invalid } from '../../syntax/node.ts';
import type { Parser } from '../parser.ts';
import { skipToSeparator } from '../recovery.ts';

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
  const [skipped] = skipToSeparator(parser, reported);
  return skipped ?? { kind: 'Invalid', span: parser.anchor({ start: at, end: at }) };
}
