/**
 * Statements (§7.1, §11.1, §16), dispatched on their first token: a word of `statementWords`
 * (syntax/tokens/grammar-words.ts), or else a name or an expression.
 *
 * Two kinds of first token need a look further ahead:
 * - A function's head (`fn`, `async fn`, ../parts/heads.ts) starts a local function when a name
 *   follows its `fn` (`fn name…`), or else a lambda expression (`fn(x): …`, `fn x: …`).
 * - A name starts a held variable when it is the word `hold` before one (`hold let`,
 *   `hold(outer) _ =`), a transient one when it is `transient` before `let`, a label when `:`
 *   follows it (loops.ts), and else an expression, a call of a function named `hold` included.
 * Declarations only the top level allows are not statements; a block rejects them
 * (grammar/parts/blocks.ts).
 *
 * Anything else is an expression, which becomes an assignment if an assignment operator follows.
 * Several targets (`a, b = (b, a)`) are recognized speculatively: inside a one-line body within a
 * call, a comma belongs to the call, not to a list of targets. A target is parsed as the
 * expression it looks like: a tuple or struct literal of targets destructures (§4.5), which only
 * `=` can do.
 */

import type { Expression } from '../../../syntax/expressions/index.ts';
import { isAssignmentOperator } from '../../../syntax/expressions/operators.ts';
import type { Statement } from '../../../syntax/statements/index.ts';
import { destructures, isTarget } from '../../../syntax/statements/targets.ts';
import type { StatementWord } from '../../../syntax/tokens/grammar-words.ts';
import type { Invalid } from '../../../syntax/tree/node.ts';
import type { CursorKind } from '../../cursor/index.ts';
import { parserDiagnostics } from '../../diagnostics.ts';
import type { Parser } from '../../parser.ts';
import { headAhead } from '../parts/heads.ts';
import { type StartParselets, type WordParselets, wordParseletAt } from '../word-parselets.ts';
import { atLabel, parseFor, parseLabelled, parseWhile } from './loops.ts';
import { parseBreak, parseContinue, parseDrop, parseReturn } from './simple.ts';
import {
  atHold,
  atTransient,
  parseHeldVariable,
  parseTransientVariable,
  parseVariable,
} from './variables.ts';

type StatementParselet = (parser: Parser) => Statement | Invalid;

const statementParselets: Partial<Record<CursorKind, StatementParselet>> = {
  let: parseVariable,
  const: parseVariable,
  fn: (parser) => parseLocalFunction(parser) ?? parseExpressionStatement(parser),
  async: (parser) => parseLocalFunction(parser) ?? parseExpressionStatement(parser),
  return: parseReturn,
  break: parseBreak,
  continue: parseContinue,
  for: parseFor,
  while: parseWhile,
  drop: parseDrop,
  identifier: parseNamedStatement,
} satisfies StartParselets<StatementWord, StatementParselet>;

/** Each contextual word's statement, or undefined, with nothing consumed, where it is a name. */
const wordParselets = {
  hold: (parser) => (atHold(parser) ? parseHeldVariable(parser) : undefined),
  transient: (parser) => (atTransient(parser) ? parseTransientVariable(parser) : undefined),
  live: parseLocalFunction,
  ista: parseLocalFunction,
} satisfies WordParselets<StatementWord, (parser: Parser) => Statement | undefined>;

export function parseStatement(parser: Parser): Statement | Invalid {
  const parselet = statementParselets[parser.cursor.kind] ?? parseExpressionStatement;
  return parselet(parser);
}

/**
 * A local function, at its head, where a name follows its `fn`; undefined, with nothing consumed,
 * otherwise. The head may start with any modifier, one no table holds included (`sendable fn f`).
 */
function parseLocalFunction(parser: Parser): Statement | undefined {
  const head = headAhead(parser, true);
  return head?.keyword === 'fn' && namesFunctionAt(parser, head.length)
    ? parser.functionDeclaration()
    : undefined;
}

/**
 * A contextual word's statement, a local function whose head starts with a modifier, a labelled
 * loop or block, or an expression, each at a name.
 */
function parseNamedStatement(parser: Parser): Statement | Invalid {
  const worded = (wordParseletAt(parser, wordParselets) ?? parseLocalFunction)(parser);
  if (worded !== undefined) {
    return worded;
  }
  return atLabel(parser)
    ? parseLabelled(parser, () => parseStatement(parser))
    : parseExpressionStatement(parser);
}

/**
 * Whether a function's name stands `ahead` tokens on. A name directly followed by `:` is instead
 * the one parameter of a lambda, `fn x: x > 0`.
 */
function namesFunctionAt(parser: Parser, ahead: number): boolean {
  const { cursor } = parser;
  return cursor.kindAt(ahead) === 'identifier' && cursor.kindAt(ahead + 1) !== ':';
}

function parseExpressionStatement(parser: Parser): Statement {
  const { cursor } = parser;
  const first = parser.expression();
  const start = parser.startOf(first);
  const targets = cursor.at(',')
    ? (parser.speculate(() => parseMoreTargets(parser, first)) ?? [first])
    : [first];
  const operator = cursor.kind;
  if (!isAssignmentOperator(operator)) {
    return { kind: 'ExpressionStatement', span: first.span, expression: first };
  }
  if (operator !== '=' && (targets.length > 1 || targets.some(destructures))) {
    parser.report(parserDiagnostics.compoundDestructuring(cursor.token.span, operator));
  }
  cursor.advance();
  for (const target of targets.filter((each) => !isTarget(each))) {
    parser.report(parserDiagnostics.invalidAssignmentTarget(parser.textSpanOf(target.span)));
  }
  const value = parser.value(start);
  return { kind: 'Assignment', span: parser.spanFrom(start), targets, operator, value };
}

/** `, b, c` after the first target, but only if an assignment follows. */
function parseMoreTargets(parser: Parser, first: Expression): Expression[] | undefined {
  const { cursor } = parser;
  const targets = [first];
  while (cursor.eat(',') !== undefined) {
    targets.push(parser.expression());
  }
  return isAssignmentOperator(cursor.kind) ? targets : undefined;
}
