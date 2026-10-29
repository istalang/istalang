/**
 * Expressions with bodies (§4, §8): `if`, `match`, `select`, and `{…}` blocks.
 *
 * Each body follows layout (layout.ts): one statement on the construct's line, or an indented
 * block. Layout also decides when `elif` and `else` continue an `if` (§4), which covers a
 * multi-line `if` used as a value, whose `else` lines up with the statement rather than the `if`.
 *
 * A `{…}` block in an expression has layout inside it, even within parentheses, so a lambda's
 * block can span lines as a call argument. Written on one line, it needs a `;` (§4): braces around
 * one expression add nothing.
 *
 * `if` and `select` end the same way, with an optional ElseClause. In a select, `else` is one of
 * the lines among the cases, so it is read as one and then must be the last: an `else` with cases
 * after it is reported and kept as Invalid. Whether a select may have an `else` at all depends on
 * `await`, which is the checker's to judge.
 */

import type {
  ConditionalBranch,
  ElseClause,
  Expression,
  MatchCase,
  SelectCase,
} from '../../syntax/expressions/index.ts';
import type { Invalid } from '../../syntax/node.ts';
import { parserDiagnostics } from '../diagnostics.ts';
import { parseBody } from '../layout/bodies.ts';
import { type ItemRules, moveToContinuation, parseBlockBraces } from '../layout/index.ts';
import type { Parser } from '../parser.ts';
import { parseHeaderBody, statementRules } from '../parts/blocks.ts';
import { skipToSeparator } from '../recovery.ts';

export function parseIf(parser: Parser): Expression {
  const { start } = parser.cursor.token.span;
  const branches = [parseBranch(parser)];
  while (moveToContinuation(parser, 'elif', start)) {
    branches.push(parseBranch(parser));
  }
  const elseClause = moveToContinuation(parser, 'else', start) ? parseElse(parser) : undefined;
  return { kind: 'If', span: parser.spanFrom(start), branches, elseClause };
}

/** `if c: body` or `elif c: body`, starting at the keyword. */
function parseBranch(parser: Parser): ConditionalBranch {
  const { start } = parser.cursor.advance().span;
  const condition = parser.expression();
  const body = parseHeaderBody(parser, start);
  return { kind: 'ConditionalBranch', span: parser.spanFrom(start), condition, body };
}

/** `else: body`, starting at `else`. */
function parseElse(parser: Parser): ElseClause {
  const { start } = parser.cursor.advance().span;
  const body = parseHeaderBody(parser, start);
  return { kind: 'ElseClause', span: parser.spanFrom(start), body };
}

export function parseMatch(parser: Parser): Expression {
  const { start } = parser.cursor.advance().span;
  const subject = parser.expression();
  parser.expect(':');
  const { items: cases } = parseBody(parser, matchCaseRules, start);
  return { kind: 'Match', span: parser.spanFrom(start), subject, cases };
}

/** `case pattern if guard: body`. */
function parseMatchCase(parser: Parser): MatchCase | Invalid {
  return parseCase(parser, (start) => {
    const pattern = parser.pattern();
    const guard = parser.cursor.eat('if') === undefined ? undefined : parser.expression();
    const body = parseHeaderBody(parser, start);
    return { kind: 'MatchCase', span: parser.spanFrom(start), pattern, guard, body };
  });
}

const matchCaseRules: ItemRules<MatchCase> = { parseItem: parseMatchCase, annotate: undefined };

/** `select:`, which never waits (§8). */
export function parseSelect(parser: Parser): Expression {
  return parseSelectFrom(parser, parser.cursor.token.span.start, false);
}

/**
 * The `select` the cursor stands at, starting at `start`; `awaits` when `await` came before it,
 * making it the select that waits (§8).
 */
export function parseSelectFrom(parser: Parser, start: number, awaits: boolean): Expression {
  parser.cursor.advance();
  parser.expect(':');
  const { items } = parseBody(parser, selectLineRules, start);
  const last = items.at(-1);
  const elseClause = last?.kind === 'ElseClause' ? last : undefined;
  const cases = (elseClause === undefined ? items : items.slice(0, -1)).map((item) =>
    item.kind === 'ElseClause' ? misplacedElse(parser, item) : item,
  );
  return { kind: 'Select', span: parser.spanFrom(start), awaits, cases, elseClause };
}

function misplacedElse(parser: Parser, clause: ElseClause): Invalid {
  parser.report(parserDiagnostics.elseNotLast(parser.textSpanOf(clause.span)));
  return { kind: 'Invalid', span: clause.span };
}

/** A line of a select: `case future as name: body`, or `else: body`. */
function parseSelectLine(parser: Parser): SelectCase | ElseClause | Invalid {
  const { cursor } = parser;
  if (cursor.at('else')) {
    return parseElse(parser);
  }
  return parseCase(parser, (start) => {
    const future = parser.expression();
    const binding =
      cursor.eat('as') === undefined ? undefined : parser.identifier('a name to bind');
    const body = parseHeaderBody(parser, start);
    return { kind: 'SelectCase', span: parser.spanFrom(start), future, binding, body };
  });
}

const selectLineRules: ItemRules<SelectCase | ElseClause> = {
  parseItem: parseSelectLine,
  annotate: undefined,
};

/**
 * `case`, then whatever `parseRest` reads from where the case starts. A line that doesn't start
 * with `case` is reported and skipped whole, as one Invalid node.
 */
function parseCase<Case>(parser: Parser, parseRest: (start: number) => Case): Case | Invalid {
  const reported = parser.diagnostics.length;
  const keyword = parser.expect('case');
  if (keyword !== undefined) {
    return parseRest(keyword.span.start);
  }
  const at = parser.cursor.previousEnd;
  const [skipped] = skipToSeparator(parser, reported);
  return skipped ?? { kind: 'Invalid', span: parser.anchor({ start: at, end: at }) };
}

/** `{ a; b }`, or the same over several lines, as an expression. */
export function parseBlockExpression(parser: Parser): Expression {
  const { start } = parser.cursor.token.span;
  const enclosed = parseBlockBraces(parser, statementRules);
  const { items, separated } = enclosed.value;
  const { span } = enclosed;
  const { end } = parser.textSpanOf(span);
  if (!separated && parser.onSameLine(start, end)) {
    parser.report(parserDiagnostics.blockWithoutSemicolon(parser.textSpanOf(span)));
  }
  return { kind: 'BlockExpression', span, block: { kind: 'Block', span, statements: items } };
}
