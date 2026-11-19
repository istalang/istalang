/**
 * The Pratt engine for expressions, and its tables.
 *
 * The tables map a token kind to the parselet that handles it, and a contextual word (`new`) to the
 * one it starts where a name stands. Each parselet lives with its construct family. The words they
 * take are the operand's and the infix ones of syntax/tokens/grammar-words.ts, which completion
 * offers. Binary operators are derived from the precedence table in
 * syntax/expressions/operators.ts, so an operator's level has one home.
 *
 * An infix parselet applies when its level is at least the level being parsed. Operands of a
 * left-associative operator parse one level tighter, so equal levels group to the left. Type
 * arguments are tried before the table, because `f<T>(x)` must win over `<` at any level: inside
 * `a + f<T>(x)`, comparison is too loose to apply, but a postfix type application is not.
 */

import type { Expression } from '../../../syntax/expressions/index.ts';
import {
  type BinaryOperator,
  binaryOperators,
  bindingPower,
  type PrecedenceLevel,
  type UnaryOperator,
  unaryOperators,
} from '../../../syntax/expressions/operators.ts';
import type { InfixWord, OperandWord } from '../../../syntax/tokens/grammar-words.ts';
import { isKeyword } from '../../../syntax/tokens/index.ts';
import type { CursorKind } from '../../cursor/index.ts';
import { misplacedDocstring } from '../../layout/docstrings.ts';
import { atPostfix, breakSeparatesItems } from '../../layout/item-breaks.ts';
import type { Parser } from '../../parser.ts';
import { headAhead } from '../parts/heads.ts';
import { parseLiteral } from '../parts/literals.ts';
import { spreadOpener } from '../parts/spreads.ts';
import { type StartParselets, type WordParselets, wordParseletAt } from '../word-parselets.ts';
import { parseParenthesized } from './atoms.ts';
import { parseBlockExpression, parseIf, parseMatch, parseSelect } from './branches.ts';
import { deferredCallParselet } from './deferred-calls.ts';
import { parseLambda } from './lambdas.ts';
import { parseCollection } from './literals/collections.ts';
import {
  parseAnonymousStructLiteral,
  parseNew,
  structComprehensionOpener,
} from './literals/struct-literals.ts';
import { parseTemplate, templateParselet } from './literals/templates.ts';
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
  await: parseAwait,
  '&': parseMisplacedReference,
  '..': parseOpenRange,
  '..=': parseOpenRange,
  '{': parseBlockExpression,
  if: parseIf,
  match: parseMatch,
  select: parseSelect,
} satisfies StartParselets<OperandWord, PrefixParselet>;

/**
 * `new` before a name starts a shared struct's literal (§5.4), and a kind a lambda's head;
 * undefined where the word is a name.
 */
const wordParselets = {
  new: (parser) => (parser.cursor.kindAt(1) === 'identifier' ? parseNew(parser) : undefined),
  live: parseModifiedLambda,
  ista: parseModifiedLambda,
} satisfies WordParselets<OperandWord, (parser: Parser) => Expression | undefined>;

/** A contextual word's operand, a lambda whose head starts with a modifier, or else a name. */
function parseName(parser: Parser): Expression {
  return (
    (wordParseletAt(parser, wordParselets) ?? parseModifiedLambda)(parser) ?? parser.identifier()
  );
}

/**
 * A lambda whose head starts with a modifier no table holds here, which its head reports
 * (`sendable fn(x): x`); undefined, with nothing consumed, where no head starts.
 */
function parseModifiedLambda(parser: Parser): Expression | undefined {
  return headAhead(parser)?.keyword === 'fn' ? parseLambda(parser) : undefined;
}

/** A parselet per prefix operator of the table in syntax/expressions/operators.ts. */
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
) as Record<Exclude<BinaryOperator, 'not in'>, InfixParselet>;

const infixParselets: Partial<Record<CursorKind, InfixParselet>> = {
  ...binaryParselets,
  '[': indexParselet,
  '.': memberParselet,
  '?.': optionalParselet,
  '->': arrowParselet(false),
  '?->': arrowParselet(true),
  '{': structLiteralParselet,
  identifier: deferredCallParselet,
  is: isParselet,
  not: notInParselet,
  '..': rangeParselet(false),
  '..=': rangeParselet(true),
  '(': callParselet,
  '?': propagateParselet,
  '!': unwrapParselet,
  template: templateParselet,
} satisfies StartParselets<InfixWord, InfixParselet>;

/** An expression whose operators all bind at least as tightly as `minLevel`. */
export function parseExpression(parser: Parser, minLevel: PrecedenceLevel): Expression {
  const parselet = prefixParselets[parser.cursor.kind];
  const first =
    parselet === undefined
      ? (parseModifiedLambda(parser) ?? parser.missing('an expression'))
      : parselet(parser, minLevel);
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
  if (breakSeparatesItems(parser)) {
    return undefined;
  }
  if (atPostfix(parser, '<')) {
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
 * Whether the next token can start an expression: one the prefix table has, unless it is a word
 * spelling a binary operator with the token after it (`not in`).
 */
export function startsExpression(parser: Parser): boolean {
  const { cursor } = parser;
  return prefixParselets[cursor.kind] !== undefined && !spellsBinary(cursor.kind, cursor.kindAt(1));
}

/** Whether a word of `kind` spells a binary operator with the `next` token (`not in`). */
function spellsBinary(kind: CursorKind, next: CursorKind): boolean {
  return isKeyword(kind) && `${kind} ${next}` in binaryOperators;
}

/**
 * What opens an item only a list holds, beyond an operand: a spread or a rest, a struct
 * comprehension.
 */
const listItemOpeners: ReadonlySet<CursorKind> = new Set([spreadOpener, structComprehensionOpener]);

/**
 * Whether a token of `kind`, first on its line inside a list, starts an item rather than
 * continuing the one before (§2.1), as the item parsers and the tables say: what opens an item only
 * a list holds starts one, and so does a token only the prefix table has. One both tables have
 * starts one where it applies to an operand only on the operand's line (a postfix bracket, a
 * template, or a name starting a deferred call's call); where it is a word, unless it spells a
 * binary operator with the `next` token (`not in`); and where it is a symbol no space parts from
 * the rest of its line (`spaced`), as `-1` and a lone `..` aren't, and `- 1` is.
 */
export function startsItemOnNewLine(kind: CursorKind, next: CursorKind, spaced: boolean): boolean {
  if (listItemOpeners.has(kind)) {
    return true;
  }
  if (prefixParselets[kind] === undefined) {
    return false;
  }
  const infix = infixParselets[kind];
  if (infix === undefined || infix.level === 'postfix' || infix.onOperandLine === true) {
    return true;
  }
  return isKeyword(kind) ? !spellsBinary(kind, next) : !spaced;
}
