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
  binaryOperatorLevels,
  bindingPower,
  type PrecedenceLevel,
} from '../../syntax/operators.ts';
import type { CursorKind } from '../cursor.ts';
import type { Parser } from '../parser.ts';
import { parseLiteral, parseName, parseParenthesized } from './atoms.ts';
import { parseBlockExpression, parseIf, parseMatch, parseSelect } from './branches.ts';
import { parseCollection } from './collections.ts';
import { parseLambda } from './lambdas.ts';
import {
  binaryParselet,
  isParselet,
  parseAwait,
  parseDereference,
  parseMisplacedReference,
  parseNegation,
  parseNot,
  parseOpenRange,
  rangeParselet,
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
} from './postfix.ts';
import { parseAnonymousStructLiteral } from './struct-literals.ts';

const prefixParselets: Partial<Record<CursorKind, PrefixParselet>> = {
  identifier: parseName,
  integer: parseLiteral,
  float: parseLiteral,
  duration: parseLiteral,
  string: parseLiteral,
  true: parseLiteral,
  false: parseLiteral,
  none: parseLiteral,
  '(': parseParenthesized,
  '[': parseCollection,
  fn: parseLambda,
  async: parseLambda,
  struct: parseAnonymousStructLiteral,
  '-': parseNegation,
  '*': parseDereference,
  not: parseNot,
  await: parseAwait,
  '&': parseMisplacedReference,
  '..': parseOpenRange,
  '..=': parseOpenRange,
  '{': parseBlockExpression,
  if: parseIf,
  match: parseMatch,
  select: parseSelect,
};

const binaryParselets = Object.fromEntries(
  (Object.keys(binaryOperatorLevels) as BinaryOperator[]).map((operator) => [
    operator,
    binaryParselet(operator),
  ]),
);

const infixParselets: Partial<Record<CursorKind, InfixParselet>> = {
  ...binaryParselets,
  is: isParselet,
  '..': rangeParselet(false),
  '..=': rangeParselet(true),
  '(': callParselet,
  '[': indexParselet,
  '.': memberParselet,
  '?.': optionalParselet,
  '->': arrowParselet('->'),
  '?->': arrowParselet('?->'),
  '?': propagateParselet,
  '{': structLiteralParselet,
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

/** Whether the next token can start an expression. */
export function startsExpression(parser: Parser): boolean {
  return prefixParselets[parser.cursor.kind] !== undefined;
}
