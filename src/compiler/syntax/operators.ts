/**
 * Operator precedence (spec §3.9): fixed by the language, so it lives with the syntax contract.
 * The parser builds its operator tables from it, and the formatter will use it to decide where
 * parentheses are needed.
 *
 * Levels are listed from loosest to tightest, the §3.9 table read bottom-up, so a level's position
 * is its binding power. Operators on one level associate to the left.
 */

import type { TokenKind } from './tokens.ts';

const precedenceLevels = [
  'coalesce',
  'or',
  'and',
  'not',
  'comparison',
  'range',
  'additive',
  'multiplicative',
  'prefix',
  'postfix',
] as const;

export type PrecedenceLevel = (typeof precedenceLevels)[number];

export const binaryOperatorLevels = {
  '??': 'coalesce',
  or: 'or',
  and: 'and',
  '<': 'comparison',
  '<=': 'comparison',
  '>': 'comparison',
  '>=': 'comparison',
  '==': 'comparison',
  '!=': 'comparison',
  '+': 'additive',
  '-': 'additive',
  '*': 'multiplicative',
  '/': 'multiplicative',
  '//': 'multiplicative',
  '%': 'multiplicative',
} as const satisfies Partial<Record<TokenKind, PrecedenceLevel>>;

export type BinaryOperator = keyof typeof binaryOperatorLevels;

type LevelOperators<Level extends PrecedenceLevel> = {
  [Operator in BinaryOperator]: (typeof binaryOperatorLevels)[Operator] extends Level
    ? Operator
    : never;
}[BinaryOperator];

/** The operators a struct pattern may use to test a field (§3.11). */
export type ComparisonOperator = LevelOperators<'comparison'>;

/** Prefix operators that build a `Unary` node; `await` and `&` have nodes of their own. */
export type UnaryOperator = '-' | 'not';

/** Where the non-binary operators sit. `is` shares the comparison level, `..` the range level. */
export const operatorLevels = {
  unaryMinus: 'prefix',
  not: 'not',
  await: 'prefix',
  reference: 'prefix',
  is: 'comparison',
  range: 'range',
} as const satisfies Record<string, PrecedenceLevel>;

/** `=` and the compound assignments; `x += y` means `x = x + y` (§3.9). */
const assignmentOperators = [
  '=',
  '+=',
  '-=',
  '*=',
  '/=',
  '//=',
  '%=',
] as const satisfies readonly TokenKind[];

export type AssignmentOperator = (typeof assignmentOperators)[number];

const assignmentOperatorSet: ReadonlySet<string> = new Set(assignmentOperators);

/** Whether a token kind is an assignment operator. */
export function isAssignmentOperator(kind: string): kind is AssignmentOperator {
  return assignmentOperatorSet.has(kind);
}

/** Whether a token kind is a binary operator. */
function isBinaryOperator(kind: string): kind is BinaryOperator {
  return Object.hasOwn(binaryOperatorLevels, kind);
}

/** Whether a token kind is one of the comparison operators. */
export function isComparisonOperator(kind: string): kind is ComparisonOperator {
  return isBinaryOperator(kind) && binaryOperatorLevels[kind] === 'comparison';
}

/** The level just above `level`: an operand of a left-associative operator parses at it. */
export function tighterLevel(level: PrecedenceLevel): PrecedenceLevel {
  return precedenceLevels[precedenceLevels.indexOf(level) + 1] ?? 'postfix';
}

/** A level's binding power: higher binds tighter. */
export function bindingPower(level: PrecedenceLevel): number {
  return precedenceLevels.indexOf(level) + 1;
}
