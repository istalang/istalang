/**
 * Operators (spec §3.9) as data: each one's precedence, associativity, what it means, and the
 * operands it refuses without parentheses. The language fixes them, so they live with the syntax
 * contract: the parser builds its operator parselets from these tables, the checker and lowering
 * dispatch on an operator's meaning, and the formatter will decide where parentheses are needed
 * from the same levels. An operator is spelled once, here.
 *
 * Levels are listed from loosest to tightest, the §3.9 table read bottom-up, so a level's position
 * is its binding power. Operators on one level associate to the left unless their entry says
 * otherwise.
 */

import type { TokenKind } from './tokens.ts';

const precedenceLevels = [
  'coalesce',
  'or',
  'and',
  'not',
  'comparison',
  'range',
  'bitwiseOr',
  'bitwiseXor',
  'bitwiseAnd',
  'shift',
  'additive',
  'multiplicative',
  'prefix',
  'power',
  'postfix',
] as const;

export type PrecedenceLevel = (typeof precedenceLevels)[number];

/** The relation `compare`'s int is in for an ordering operator (§3.9). */
export type Relation = 'less' | 'lessOrEqual' | 'greater' | 'greaterOrEqual';

/** What a binary operator does (§3.9). */
type BinaryMeaning =
  /** Calls `function` with both operands, so a type gives it meaning through the function's trait. */
  | { readonly kind: 'call'; readonly function: string }
  /** Calls `function`, `compare`, and is whether its int is in `relation`. */
  | { readonly kind: 'order'; readonly function: 'compare'; readonly relation: Relation }
  /** The built-in `==` every type has, negated for `!=`. */
  | { readonly kind: 'equality'; readonly negated: boolean }
  /** `and` and `or`: on bools, the right side run, and given, only when the left one is `rightWhen`. */
  | { readonly kind: 'logic'; readonly rightWhen: boolean }
  /** `??`: the left side's value inside an optional, else the right side (§4). */
  | { readonly kind: 'coalesce' }
  /** `in` and `not in`: whether the right side contains the left. */
  | { readonly kind: 'membership'; readonly negated: boolean };

export interface BinaryOperatorEntry {
  readonly level: PrecedenceLevel;
  /** Left unless stated: `2 ** 3 ** 2` is `2 ** (3 ** 2)`. */
  readonly associativity?: 'right';
  readonly meaning: BinaryMeaning;
  /** Operators an operand of this one may not use unless parenthesized (§3.9). */
  readonly refusesUnparenthesized?: readonly string[];
}

const call = (name: string) => ({ kind: 'call', function: name }) as const;
const order = (relation: Relation) => ({ kind: 'order', function: 'compare', relation }) as const;

/**
 * Every binary operator, by its spelling. Every spelling but `not in` is a token kind; that one is
 * two words.
 */
export const binaryOperators = {
  '??': { level: 'coalesce', meaning: { kind: 'coalesce' }, refusesUnparenthesized: ['and', 'or'] },
  or: { level: 'or', meaning: { kind: 'logic', rightWhen: false } },
  and: { level: 'and', meaning: { kind: 'logic', rightWhen: true } },
  '<': { level: 'comparison', meaning: order('less') },
  '<=': { level: 'comparison', meaning: order('lessOrEqual') },
  '>': { level: 'comparison', meaning: order('greater') },
  '>=': { level: 'comparison', meaning: order('greaterOrEqual') },
  '==': { level: 'comparison', meaning: { kind: 'equality', negated: false } },
  '!=': { level: 'comparison', meaning: { kind: 'equality', negated: true } },
  in: { level: 'comparison', meaning: { kind: 'membership', negated: false } },
  'not in': { level: 'comparison', meaning: { kind: 'membership', negated: true } },
  '|': { level: 'bitwiseOr', meaning: call('bitOr') },
  '^': { level: 'bitwiseXor', meaning: call('bitXor') },
  '&': { level: 'bitwiseAnd', meaning: call('bitAnd') },
  '<<': { level: 'shift', meaning: call('shiftLeft') },
  '>>': { level: 'shift', meaning: call('shiftRight') },
  '+': { level: 'additive', meaning: call('add') },
  '-': { level: 'additive', meaning: call('subtract') },
  '*': { level: 'multiplicative', meaning: call('multiply') },
  '/': { level: 'multiplicative', meaning: call('divide') },
  '//': { level: 'multiplicative', meaning: call('floorDivide') },
  '%': { level: 'multiplicative', meaning: call('remainder') },
  '**': { level: 'power', associativity: 'right', meaning: call('power') },
} as const satisfies Record<string, BinaryOperatorEntry>;

export type BinaryOperator = keyof typeof binaryOperators;

/** A binary operator with the meaning `Kind`. */
type BinaryOperatorOf<Kind extends BinaryMeaning['kind']> = {
  [Operator in BinaryOperator]: (typeof binaryOperators)[Operator]['meaning']['kind'] extends Kind
    ? Operator
    : never;
}[BinaryOperator];

/**
 * The operators that compare two values: the orderings and equality. A struct pattern tests a
 * field with one (§3.11), and two or more of them in a row are one chain.
 */
export type ComparisonOperator = BinaryOperatorOf<'order' | 'equality'>;

/** What a prefix operator that builds a `Unary` node does: calls `function`, or negates a bool. */
type UnaryMeaning = ReturnType<typeof call> | { readonly kind: 'negation' };

/** Prefix operators that build a `Unary` node; `await`, `*` and `&` have nodes of their own. */
export const unaryOperators = {
  '-': { level: 'prefix', meaning: call('negate') },
  '~': { level: 'prefix', meaning: call('bitNot') },
  not: { level: 'not', meaning: { kind: 'negation' } },
} as const satisfies Record<
  string,
  { readonly level: PrecedenceLevel; readonly meaning: UnaryMeaning }
>;

export type UnaryOperator = keyof typeof unaryOperators;

/** A binary operator that calls a function, which gives it meaning for a type (§3.9). */
export type CallingBinaryOperator = BinaryOperatorOf<'call' | 'order'>;

/** A prefix operator that calls a function. */
export type CallingUnaryOperator = {
  [Operator in UnaryOperator]: (typeof unaryOperators)[Operator]['meaning']['kind'] extends 'call'
    ? Operator
    : never;
}[UnaryOperator];

/** Where the operators without an entry above sit. `is` shares the comparison level, `..` the range level. */
export const operatorLevels = {
  await: 'prefix',
  dereference: 'prefix',
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
  '**=',
  '&=',
  '|=',
  '^=',
  '<<=',
  '>>=',
] as const satisfies readonly TokenKind[];

export type AssignmentOperator = (typeof assignmentOperators)[number];

/** A compound assignment: one that applies a binary operator. */
export type CompoundAssignment = Exclude<AssignmentOperator, '='>;

const assignmentOperatorSet: ReadonlySet<string> = new Set(assignmentOperators);

/** Whether a token kind is an assignment operator. */
export function isAssignmentOperator(kind: string): kind is AssignmentOperator {
  return assignmentOperatorSet.has(kind);
}

/** The binary operator a compound assignment applies: `+` for `+=`. */
export function compoundOperator(assignment: CompoundAssignment): CompoundOf<CompoundAssignment> {
  return assignment.slice(0, -1) as CompoundOf<CompoundAssignment>;
}

/** The binary operator spelled before the `=` of a compound assignment. */
type CompoundOf<Assignment> = Assignment extends `${infer Operator}=`
  ? Extract<Operator, BinaryOperator>
  : never;

/** Whether a token kind is one of the operators comparing two values. */
export function isComparisonOperator(kind: string): kind is ComparisonOperator {
  if (!Object.hasOwn(binaryOperators, kind)) {
    return false;
  }
  const { meaning } = binaryOperators[kind as BinaryOperator];
  return meaning.kind === 'order' || meaning.kind === 'equality';
}

/** The level just above `level`. */
export function tighterLevel(level: PrecedenceLevel): PrecedenceLevel {
  return precedenceLevels[precedenceLevels.indexOf(level) + 1] ?? 'postfix';
}

/**
 * The level the right operand of `operator` parses at: one tighter than its own for a
 * left-associative operator, so equal levels group to the left; the prefix level for a
 * right-associative one, so its right side may itself be the operator.
 */
export function rightOperandLevel(operator: BinaryOperator): PrecedenceLevel {
  const entry: BinaryOperatorEntry = binaryOperators[operator];
  return entry.associativity === 'right' ? 'prefix' : tighterLevel(entry.level);
}

/** A level's binding power: higher binds tighter. */
export function bindingPower(level: PrecedenceLevel): number {
  return precedenceLevels.indexOf(level) + 1;
}
