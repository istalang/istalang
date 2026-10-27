/**
 * Loops (§4): `for x in xs: …`, whose targets destructure as a declaration's do, and `while c: …`,
 * either maybe after a label, `outer: for …`, which `break outer` and `continue outer` name. Both
 * are statements of type unit, so they are not expressions.
 */

import type { Identifier } from '../../syntax/node.ts';
import type { For, While } from '../../syntax/statements.ts';
import type { Parser } from '../parser.ts';
import { parseHeaderBody } from '../parts/blocks.ts';
import { parseTargets } from '../parts/names.ts';

export function parseFor(parser: Parser): For {
  return parseForAfter(parser, parser.cursor.token.span.start, undefined);
}

export function parseWhile(parser: Parser): While {
  return parseWhileAfter(parser, parser.cursor.token.span.start, undefined);
}

/** Whether a label stands at the cursor: a name, `:`, and the loop it labels. */
export function atLabel(parser: Parser): boolean {
  const { cursor } = parser;
  const loop = cursor.kindAt(2);
  return (
    cursor.at('identifier') && cursor.kindAt(1) === ':' && (loop === 'for' || loop === 'while')
  );
}

/** `outer: for …` or `outer: while …`, starting at the label. */
export function parseLabelledLoop(parser: Parser): For | While {
  const label = parser.identifier('a label');
  parser.expect(':');
  const { start } = label.span;
  return parser.cursor.at('for')
    ? parseForAfter(parser, start, label)
    : parseWhileAfter(parser, start, label);
}

function parseForAfter(parser: Parser, start: number, label: Identifier | undefined): For {
  parser.cursor.advance();
  const targets = parseTargets(parser);
  parser.expect('in');
  const iterable = parser.expression();
  const body = parseHeaderBody(parser, start);
  return { kind: 'For', span: parser.spanFrom(start), label, targets, iterable, body };
}

function parseWhileAfter(parser: Parser, start: number, label: Identifier | undefined): While {
  parser.cursor.advance();
  const condition = parser.expression();
  const body = parseHeaderBody(parser, start);
  return { kind: 'While', span: parser.spanFrom(start), label, condition, body };
}
