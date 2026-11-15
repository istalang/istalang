/**
 * Loops (§4): `for x in xs: …`, whose targets destructure as a declaration's do, a field loop
 * `for key, value in ...x: …` or `for K in keyof S: …`, which what follows `in` tells apart
 * (parts/field-headers.ts), and `while c: …`,
 * each maybe after a label, `outer: for …`, which `break outer` and `continue outer` name. All
 * are statements of type unit, so they are not expressions.
 *
 * A label also stands before an indented block, `batch:` at the end of its line, which only
 * `hold(batch)` names (§3.4). The line break tells it from anything else a name and `:` start.
 * A name and `:` before anything else is a label in the wrong place: nothing else at the start of
 * a statement reads so. It is reported, and the statement after it parsed as if it weren't there.
 */

import type { FieldLoop, For, Statement, While } from '../../../syntax/statements/index.ts';
import type { Identifier, Invalid } from '../../../syntax/tree/node.ts';
import { parserDiagnostics } from '../../diagnostics.ts';
import type { Parser } from '../../parser.ts';
import { parseHeaderBody } from '../parts/blocks.ts';
import { atFieldLoopSource, parseFieldLoopHeaderAfter } from '../parts/field-headers.ts';
import { parseTargets } from '../parts/names.ts';

export function parseFor(parser: Parser): For | FieldLoop {
  return parseForAfter(parser, parser.cursor.token.span.start, undefined);
}

export function parseWhile(parser: Parser): While {
  return parseWhileAfter(parser, parser.cursor.token.span.start, undefined);
}

/** Whether a label stands at the cursor: a name and `:`. */
export function atLabel(parser: Parser): boolean {
  return parser.cursor.at('identifier') && parser.cursor.kindAt(1) === ':';
}

/**
 * `outer: for …`, `outer: while …` or `batch:` and a block, starting at the label; a label before
 * anything else is reported, and `statement` parses what follows it.
 */
export function parseLabelled(
  parser: Parser,
  statement: () => Statement | Invalid,
): Statement | Invalid {
  const label = parser.identifier('a label');
  const start = parser.startOf(label);
  const labelled = parser.cursor.kindAt(1);
  if (labelled === 'lineBreak') {
    const body = parseHeaderBody(parser, start);
    return { kind: 'LabelledBlock', span: parser.spanFrom(start), label, body };
  }
  parser.expect(':');
  if (labelled === 'for') {
    return parseForAfter(parser, start, label);
  }
  if (labelled === 'while') {
    return parseWhileAfter(parser, start, label);
  }
  parser.report(parserDiagnostics.misplacedLabel(parser.textSpanFrom(start)));
  return statement();
}

function parseForAfter(
  parser: Parser,
  start: number,
  label: Identifier | undefined,
): For | FieldLoop {
  parser.cursor.advance();
  const targets = parseTargets(parser);
  parser.expect('in');
  if (atFieldLoopSource(parser)) {
    const header = parseFieldLoopHeaderAfter(parser, start, targets);
    const body = parseHeaderBody(parser, start);
    return { kind: 'FieldLoop', span: parser.spanFrom(start), label, header, body };
  }
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
