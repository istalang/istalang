/**
 * The nesting limit that keeps parsing total.
 *
 * Recursive descent spends host stack frames on every level of nesting, so hostile input such as
 * a thousand nested parentheses would overflow the stack and throw. Every grammar entry that can
 * recurse (expression, type, pattern, statement, field) therefore descends through here. Past the
 * limit, one diagnostic is reported and the rest of the over-deep construct is skipped as one
 * Invalid node: up to the end of the enclosing region, and then every following line indented
 * deeper than the line it started on, which can only belong to it. Skipping loops rather than
 * recursing (cursor.ts), so the skipped part may nest to any depth.
 */

import type { Invalid } from '../syntax/node.ts';
import { parserDiagnostics } from './diagnostics.ts';
import { skipDeeperLines } from './layout.ts';
import { nestingLimit, type Parser } from './parser.ts';
import { skipUntil } from './recovery.ts';

/** `parse` one level deeper; past the limit, the over-deep construct skipped instead. */
export function nested<Node>(parser: Parser, parse: () => Node): Node | Invalid {
  return parser.descend(parse) ?? skipTooDeep(parser);
}

function skipTooDeep(parser: Parser): Invalid {
  const { start } = parser.nextSpan;
  parser.report(parserDiagnostics.nestingTooDeep(parser.nextSpan, nestingLimit));
  skipUntil(parser, []);
  skipDeeperLines(parser, parser.indentationAt(start));
  return { kind: 'Invalid', span: parser.spanFrom(start) };
}
