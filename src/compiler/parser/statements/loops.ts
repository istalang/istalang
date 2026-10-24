/**
 * Loops (§4): `for x in xs: …`, whose targets destructure as a declaration's do, and `while c: …`.
 * Both are statements of type unit, so they are not expressions.
 */

import type { For, While } from '../../syntax/statements.ts';
import type { Parser } from '../parser.ts';
import { parseHeaderBody } from '../parts/blocks.ts';
import { parseTargets } from '../parts/names.ts';

export function parseFor(parser: Parser): For {
  const { start } = parser.cursor.advance().span;
  const targets = parseTargets(parser);
  parser.expect('in');
  const iterable = parser.expression();
  const body = parseHeaderBody(parser, start);
  return { kind: 'For', span: parser.spanFrom(start), targets, iterable, body };
}

export function parseWhile(parser: Parser): While {
  const { start } = parser.cursor.advance().span;
  const condition = parser.expression();
  const body = parseHeaderBody(parser, start);
  return { kind: 'While', span: parser.spanFrom(start), condition, body };
}
