/**
 * Statements (§3.4, §4, §7, §9), dispatched on their first token.
 *
 * Three first tokens need a look further ahead:
 * - `fn` starts a variable held by the function (`fn let`, `fn const`, `fn _ =`), a local
 *   function (`fn name…`), or else a lambda expression (`fn(x): …`, `fn x: …`).
 * - `async` starts a local function only when a name follows `fn`.
 * Declarations only the top level allows are not statements; a block rejects them
 * (parts/blocks.ts).
 *
 * Anything else is an expression, which becomes an assignment if an assignment operator follows.
 * Several targets (`a, b = (b, a)`) are recognized speculatively: inside a one-line body within a
 * call, a comma belongs to the call, not to a list of targets.
 */

import type { Expression } from '../../syntax/expressions.ts';
import type { Invalid } from '../../syntax/node.ts';
import { isAssignmentOperator } from '../../syntax/operators.ts';
import type { Statement } from '../../syntax/statements.ts';
import type { CursorKind } from '../cursor.ts';
import { parserDiagnostics } from '../diagnostics.ts';
import type { Parser } from '../parser.ts';
import { parseFor, parseWhile } from './loops.ts';
import {
  parseBreak,
  parseContinue,
  parseDefer,
  parseDrop,
  parseReturn,
  parseSpawn,
} from './simple.ts';
import { parseFunctionHeldVariable, parseVariable } from './variables.ts';

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
  spawn: parseSpawn,
};

export function parseStatement(parser: Parser): Statement | Invalid {
  const parselet = statementParselets[parser.cursor.kind] ?? parseExpressionStatement;
  return parselet(parser);
}

function parseFnStatement(parser: Parser): Statement | Invalid {
  const { cursor } = parser;
  const next = cursor.peek(1);
  const holdsVariable =
    next.kind === 'let' ||
    next.kind === 'const' ||
    (next.kind === 'identifier' && parser.textOf(next) === '_' && cursor.kindAt(2) === '=');
  if (holdsVariable) {
    return parseFunctionHeldVariable(parser);
  }
  return namesFunctionAt(parser, 1)
    ? parser.functionDeclaration()
    : parseExpressionStatement(parser);
}

/** `async fn name(…)` declares a function; any other `async fn` is a lambda. */
function parseAsyncStatement(parser: Parser): Statement | Invalid {
  const declares = parser.cursor.kindAt(1) === 'fn' && namesFunctionAt(parser, 2);
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
  const { start } = first.span;
  const targets = cursor.at(',')
    ? (parser.speculate(() => parseMoreTargets(parser, first)) ?? [first])
    : [first];
  const operator = cursor.kind;
  if (!isAssignmentOperator(operator)) {
    return { kind: 'ExpressionStatement', span: first.span, expression: first };
  }
  if (targets.length > 1 && operator !== '=') {
    parser.report(parserDiagnostics.compoundDestructuring(cursor.token.span, operator));
  }
  cursor.advance();
  for (const target of targets.filter((each) => !isAssignable(each))) {
    parser.report(parserDiagnostics.invalidAssignmentTarget(target.span));
  }
  const value = parser.expression();
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

/** What may stand left of `=`: a variable, a field, an index, or a `$` value (§3.9). */
function isAssignable(target: Expression): boolean {
  switch (target.kind) {
    case 'Identifier':
    case 'Index':
    case 'Unwrap':
    case 'Missing':
      return true;
    case 'MemberAccess':
      return !target.isOptional;
    default:
      return false;
  }
}
