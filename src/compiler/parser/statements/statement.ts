/**
 * Statements (§3.4, §4, §7), dispatched on their first token: a word of `statementWords`
 * (syntax/grammar-words.ts), or else a name or an expression.
 *
 * Three first tokens need a look further ahead:
 * - `fn` starts a local function (`fn name…`), or else a lambda expression (`fn(x): …`,
 *   `fn x: …`).
 * - `async` starts a local function only when a name follows `fn`.
 * - A name starts a held variable when it is the word `hold` before one (`hold let`,
 *   `hold(outer) _ =`), a label when `:` follows it (loops.ts), and else an expression, a call
 *   of a function named `hold` included.
 * Declarations only the top level allows are not statements; a block rejects them
 * (parts/blocks.ts).
 *
 * Anything else is an expression, which becomes an assignment if an assignment operator follows.
 * Several targets (`a, b = (b, a)`) are recognized speculatively: inside a one-line body within a
 * call, a comma belongs to the call, not to a list of targets. A target is parsed as the
 * expression it looks like: a tuple or struct literal of targets destructures (§3.15), which only
 * `=` can do.
 */

import type { Expression } from '../../syntax/expressions/index.ts';
import type { StatementWord } from '../../syntax/grammar-words.ts';
import type { Invalid } from '../../syntax/node.ts';
import { isAssignmentOperator } from '../../syntax/operators.ts';
import { destructures, isTarget, type Statement } from '../../syntax/statements.ts';
import type { CursorKind } from '../cursor/index.ts';
import { parserDiagnostics } from '../diagnostics.ts';
import type { Parser } from '../parser.ts';
import {
  followsModifier,
  type StartParselets,
  type WordParselets,
  wordParseletAt,
} from '../word-parselets.ts';
import { atLabel, parseFor, parseLabelled, parseWhile } from './loops.ts';
import { parseBreak, parseContinue, parseDefer, parseDrop, parseReturn } from './simple.ts';
import { atHold, parseHeldVariable, parseVariable } from './variables.ts';

type StatementParselet = (parser: Parser) => Statement | Invalid;

const statementParselets: Partial<Record<CursorKind, StatementParselet>> = {
  let: parseVariable,
  const: parseVariable,
  fn: parseFnStatement,
  async: parseAsyncStatement,
  return: parseReturn,
  break: parseBreak,
  continue: parseContinue,
  for: parseFor,
  while: parseWhile,
  defer: parseDefer,
  drop: parseDrop,
  identifier: parseNamedStatement,
} satisfies StartParselets<StatementWord, StatementParselet>;

/** Each contextual word's statement, or undefined, with nothing consumed, where it is a name. */
const wordParselets = {
  hold: (parser) => (atHold(parser) ? parseHeldVariable(parser) : undefined),
} satisfies WordParselets<StatementWord, (parser: Parser) => Statement | undefined>;

export function parseStatement(parser: Parser): Statement | Invalid {
  const parselet = statementParselets[parser.cursor.kind] ?? parseExpressionStatement;
  return parselet(parser);
}

function parseFnStatement(parser: Parser): Statement | Invalid {
  return namesFunctionAt(parser, 1)
    ? parser.functionDeclaration()
    : parseExpressionStatement(parser);
}

/** A contextual word's statement, a labelled loop or block, or an expression, each at a name. */
function parseNamedStatement(parser: Parser): Statement | Invalid {
  const worded = wordParseletAt(parser, wordParselets)?.(parser);
  if (worded !== undefined) {
    return worded;
  }
  return atLabel(parser)
    ? parseLabelled(parser, () => parseStatement(parser))
    : parseExpressionStatement(parser);
}

/** `async fn name(…)` declares a function; any other `async fn` is a lambda. */
function parseAsyncStatement(parser: Parser): Statement | Invalid {
  const declares = followsModifier(parser, 'async') && namesFunctionAt(parser, 2);
  return declares ? parser.functionDeclaration() : parseExpressionStatement(parser);
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
