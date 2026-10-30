/**
 * The Pratt engine for expressions, and its two tables.
 *
 * The tables map a token kind to the parselet that handles it. Each parselet lives with its
 * construct family. Binary operators are derived from the precedence table in syntax/operators.ts,
 * so an operator's level has one home.
 *
 * An infix parselet applies when its level is at least the level being parsed. Operands of a
 * left-associative operator parse one level tighter, so equal levels group to the left. Type
 * arguments are tried before the table, because `f<T>(x)` must win over `<` at any level: inside
 * `a + f<T>(x)`, comparison is too loose to apply, but a postfix type application is not.
 */

import type { Expression } from '../../syntax/expressions/index.ts';
import {
  type BinaryOperator,
  binaryOperators,
  bindingPower,
  type PrecedenceLevel,
  type UnaryOperator,
  unaryOperators,
} from '../../syntax/operators.ts';
import type { CursorKind } from '../cursor/index.ts';
import { misplacedDocstring } from '../docstrings.ts';
import type { Parser } from '../parser.ts';
import { parseLiteral, parseName, parseParenthesized } from './atoms.ts';
import { parseBlockExpression, parseIf, parseMatch, parseSelect } from './branches.ts';
import { parseCollection } from './collections.ts';
import { parseLambda } from './lambdas.ts';
import {
  binaryParselet,
  isParselet,
  notInParselet,
  parseAwait,
  parseDereference,
  parseDoubleDereference,
  parseMisplacedReference,
  parseOpenRange,
  rangeParselet,
  unaryParselet,
} from './operators.ts';
import type { InfixParselet, PrefixParselet } from './parselet.ts';
import {
  arrowParselet,
  callParselet,
  indexParselet,
  memberParselet,
  optionalParselet,
  parseTypeApplication,
  propagateParselet,
  structLiteralParselet,
  unwrapParselet,
} from './postfix.ts';
import { parseAnonymousStructLiteral } from './struct-literals.ts';
import { parseTemplate, templateParselet } from './templates.ts';

const prefixParselets: Partial<Record<CursorKind, PrefixParselet>> = {
  identifier: parseName,
  integer: parseLiteral,
  float: parseLiteral,
  duration: parseLiteral,
  string: parseLiteral,
  template: parseTemplate,
  docstring: misplacedDocstring,
  true: parseLiteral,
  false: parseLiteral,
  none: parseLiteral,
  '(': parseParenthesized,
  '[': parseCollection,
  fn: parseLambda,
  async: parseLambda,
  struct: parseAnonymousStructLiteral,
  ...unaryParselets(),
  '*': parseDereference,
  '**': parseDoubleDereference,
  spawn: parseSpawn,
  await: parseAwait,
  '&': parseMisplacedReference,
  '..': parseOpenRange,
  '..=': parseOpenRange,
  '{': parseBlockExpression,
  if: parseIf,
  match: parseMatch,
  select: parseSelect,
};

/** A parselet per prefix operator of the table in syntax/operators.ts. */
function unaryParselets(): Record<UnaryOperator, PrefixParselet> {
  return Object.fromEntries(
    (Object.keys(unaryOperators) as UnaryOperator[]).map((operator) => [
      operator,
      unaryParselet(operator),
    ]),
  ) as Record<UnaryOperator, PrefixParselet>;
}

/** A parselet per binary operator spelled as one token; `not in`'s starts at its `not`. */
const binaryParselets = Object.fromEntries(
  (Object.keys(binaryOperators) as BinaryOperator[])
    .filter((operator) => operator !== 'not in')
    .map((operator) => [operator, binaryParselet(operator)]),
);

/** The postfix parselets a spawned callee is built of, before its call (§9). */
const spawnCalleeSteps: Partial<Record<CursorKind, InfixParselet>> = {
  '[': indexParselet,
  '.': memberParselet,
  '?.': optionalParselet,
  '->': arrowParselet(false),
  '?->': arrowParselet(true),
  '{': structLiteralParselet,
};

const infixParselets: Partial<Record<CursorKind, InfixParselet>> = {
  ...binaryParselets,
  ...spawnCalleeSteps,
  is: isParselet,
  not: notInParselet,
  '..': rangeParselet(false),
  '..=': rangeParselet(true),
  '(': callParselet,
  '?': propagateParselet,
  '!': unwrapParselet,
  template: templateParselet,
};

/** An expression whose operators all bind at least as tightly as `minLevel`. */
export function parseExpression(parser: Parser, minLevel: PrecedenceLevel): Expression {
  const parselet = prefixParselets[parser.cursor.kind];
  const first =
    parselet === undefined ? parser.missing('an expression') : parselet(parser, minLevel);
  return continueExpression(parser, first, minLevel);
}

/** Extends `left` with every following operator that binds at least as tightly as `minLevel`. */
export function continueExpression(
  parser: Parser,
  left: Expression,
  minLevel: PrecedenceLevel,
): Expression {
  let expression = left;
  let extended = extend(parser, expression, minLevel);
  while (extended !== undefined) {
    expression = extended;
    extended = extend(parser, expression, minLevel);
  }
  return expression;
}

function extend(
  parser: Parser,
  left: Expression,
  minLevel: PrecedenceLevel,
): Expression | undefined {
  if (parser.cursor.at('<')) {
    const application = parseTypeApplication(parser, left);
    if (application !== undefined) {
      return application;
    }
  }
  const parselet = infixParselets[parser.cursor.kind];
  if (parselet === undefined || bindingPower(parselet.level) < bindingPower(minLevel)) {
    return undefined;
  }
  return parselet.parse(parser, left);
}

/**
 * `spawn f(args)` (§9), binding as JavaScript's `new` does: the callee, with its members, elements
 * and type arguments, then one argument list. What follows applies to what the spawn gives, so
 * `spawn w.run(job).result()` reads the result of the spawn. Anything but a call after `spawn` is
 * kept as written, for the checker to refuse.
 */
function parseSpawn(parser: Parser): Expression {
  const { start } = parser.cursor.advance().span;
  const primary = prefixParselets[parser.cursor.kind];
  let callee: Expression =
    primary === undefined ? parser.missing('a call') : primary(parser, 'postfix');
  for (
    let step = calleeStep(parser, callee);
    step !== undefined;
    step = calleeStep(parser, callee)
  ) {
    callee = step;
  }
  const call =
    callee.kind !== 'Call' && parser.cursor.at('(')
      ? (callParselet.parse(parser, callee) ?? callee)
      : callee;
  return { kind: 'Spawn', span: parser.spanFrom(start), call };
}

/**
 * One step of a spawned callee: a member, an element, a struct literal, or type arguments; the
 * first call, which a `?.(` or type arguments may already have made, ends it.
 */
function calleeStep(parser: Parser, callee: Expression): Expression | undefined {
  const { kind } = parser.cursor;
  if (callee.kind === 'Call') {
    return undefined;
  }
  return kind === '<'
    ? parseTypeApplication(parser, callee)
    : spawnCalleeSteps[kind]?.parse(parser, callee);
}

/** Whether the next token can start an expression. */
export function startsExpression(parser: Parser): boolean {
  return prefixParselets[parser.cursor.kind] !== undefined;
}
