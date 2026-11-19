/**
 * Random operator trees and two printers for them, for the precedence property.
 *
 * Both printers read their levels from syntax/expressions/operators.ts, the table the parser uses:
 * - The full printer parenthesizes every operator.
 * - The minimal printer parenthesizes only where the grammar requires it: levels, the operands an
 *   operator refuses without parentheses, `**`'s right-associativity and its refusal of a prefix
 *   before it (§10.3), comparisons in a row chaining so a comparison under another is wrapped, and
 *   `name < name > (…)` reading as a generic call (§8.1) so its comparison is wrapped.
 * A deferred call, `g f(…)` (§6.5), is an operator at the prefix level whose operand is a call, or
 * another deferred call, read from the right; the operator tree stands in the call's argument.
 * `shapeOf` turns a parsed expression back into a tree, ignoring parentheses, so the printed text
 * can be compared with the tree it came from.
 */

import fc from 'fast-check';
import type { Expression } from '../../../syntax/expressions/index.ts';
import {
  type BinaryOperator,
  type BinaryOperatorEntry,
  binaryOperators,
  bindingPower,
  isChainingOperator,
  operatorLevels,
  type PrecedenceLevel,
  tighterLevel,
  type UnaryOperator,
  unaryOperators,
} from '../../../syntax/expressions/operators.ts';

type Prefix = UnaryOperator | '*' | 'await';

const prefixes: readonly Prefix[] = [
  ...(Object.keys(unaryOperators) as UnaryOperator[]),
  '*',
  'await',
];

export type OperatorTree =
  | { readonly atom: string }
  | { readonly binary: BinaryOperator; readonly left: OperatorTree; readonly right: OperatorTree }
  | { readonly prefix: Prefix; readonly operand: OperatorTree }
  | { readonly range: boolean; readonly start: OperatorTree; readonly end: OperatorTree }
  | { readonly isSubject: OperatorTree }
  | { readonly deferring: OperatorTree };

const binaryOperatorList = Object.keys(binaryOperators) as BinaryOperator[];

export const operatorTree: fc.Arbitrary<OperatorTree> = fc.letrec<{ tree: OperatorTree }>(
  (tie) => ({
    tree: fc.oneof(
      { depthSize: 'small', withCrossShrink: true },
      fc.constantFrom('a', 'b', 'c', 'd', '1', '2').map((atom) => ({ atom })),
      fc.record({
        binary: fc.constantFrom(...binaryOperatorList),
        left: tie('tree'),
        right: tie('tree'),
      }),
      fc.record({
        prefix: fc.constantFrom(...prefixes),
        operand: tie('tree'),
      }),
      fc.record({ range: fc.boolean(), start: tie('tree'), end: tie('tree') }),
      fc.record({ isSubject: tie('tree') }),
      fc.record({ deferring: tie('tree') }),
    ),
  }),
).tree;

function levelOf(tree: OperatorTree): PrecedenceLevel {
  if ('binary' in tree) {
    return binaryOperators[tree.binary].level;
  }
  if ('prefix' in tree) {
    return prefixLevel(tree.prefix);
  }
  if ('range' in tree) {
    return operatorLevels.range;
  }
  if ('deferring' in tree) {
    return operatorLevels.deferredCall;
  }
  return 'isSubject' in tree ? operatorLevels.is : 'postfix';
}

function prefixLevel(prefix: Prefix): PrecedenceLevel {
  switch (prefix) {
    case '*':
      return operatorLevels.dereference;
    case 'await':
      return operatorLevels.await;
    default:
      return unaryOperators[prefix].level;
  }
}

const wordOperator = /^\w/u;

function prefixText(prefix: Prefix): string {
  return wordOperator.test(prefix) ? `${prefix} ` : prefix;
}

function rangeText(isInclusive: boolean): string {
  return isInclusive ? ' ..= ' : ' .. ';
}

/** Prints with every operator in parentheses. */
export function printFull(tree: OperatorTree): string {
  if ('atom' in tree) {
    return tree.atom;
  }
  if ('binary' in tree) {
    return `(${printFull(tree.left)} ${tree.binary} ${printFull(tree.right)})`;
  }
  if ('prefix' in tree) {
    return `(${prefixText(tree.prefix)}${printFull(tree.operand)})`;
  }
  if ('range' in tree) {
    return `(${printFull(tree.start)}${rangeText(tree.range)}${printFull(tree.end)})`;
  }
  if ('deferring' in tree) {
    return `(${deferredText(tree.deferring, printFull)})`;
  }
  return `(${printFull(tree.isSubject)} is P)`;
}

/**
 * `g` given the call `deferring` stands for: another deferred call as it is, without the
 * parentheses that would make it `g`'s argument, or `f` called with the tree.
 */
function deferredText(deferring: OperatorTree, print: (tree: OperatorTree) => string): string {
  if ('deferring' in deferring) {
    return `g ${deferredText(deferring.deferring, print)}`;
  }
  return `g f(${print(deferring)})`;
}

/**
 * Prints `child`, in parentheses when it binds looser than `minLevel`, the level its position
 * parses at, or when a grammar rule demands them (`mustGroup`).
 */
function operand(child: OperatorTree, minLevel: PrecedenceLevel, mustGroup = false): string {
  const text = printMinimal(child);
  const looser = bindingPower(levelOf(child)) < bindingPower(minLevel);
  return looser || mustGroup ? `(${text})` : text;
}

const genericLookalike = /[A-Za-z_]\w* < [A-Za-z_]\w*$/u;

function printBinary(tree: Extract<OperatorTree, { binary: BinaryOperator }>): string {
  const entry: BinaryOperatorEntry = binaryOperators[tree.binary];
  const refused = (child: OperatorTree) =>
    'binary' in child && (entry.refusesUnparenthesized ?? []).some((kind) => kind === child.binary);
  // A comparison right after another would extend it into a chain, so the tree's own needs
  // grouping.
  const chains = (child: OperatorTree) =>
    'binary' in child && isChainingOperator(tree.binary) && isChainingOperator(child.binary);
  const isRightAssociative = tree.binary === '**';
  const leftLevel = isRightAssociative ? tighterLevel(entry.level) : entry.level;
  // `**` groups to the right and accepts a prefix on its right (`2 ** -1`, §10.3).
  const rightLevel = isRightAssociative ? 'prefix' : tighterLevel(entry.level);
  let left = operand(tree.left, leftLevel, refused(tree.left) || chains(tree.left));
  const right = operand(tree.right, rightLevel, refused(tree.right));
  if (tree.binary === '>' && right.startsWith('(') && genericLookalike.test(left)) {
    left = `(${left})`;
  }
  return `${left} ${tree.binary} ${right}`;
}

/**
 * Whether `child`, the operand of a prefix at `level`, is `**`, which refuses a prefix before it
 * (§10.3).
 */
function refusesPrefix(child: OperatorTree, level: PrecedenceLevel): boolean {
  return 'binary' in child && child.binary === '**' && level === 'prefix';
}

/** Prints with only the parentheses the grammar requires. */
export function printMinimal(tree: OperatorTree): string {
  if ('atom' in tree) {
    return tree.atom;
  }
  if ('binary' in tree) {
    return printBinary(tree);
  }
  if ('prefix' in tree) {
    const level = levelOf(tree);
    return (
      prefixText(tree.prefix) + operand(tree.operand, level, refusesPrefix(tree.operand, level))
    );
  }
  if ('range' in tree) {
    const start = operand(tree.start, operatorLevels.range);
    return start + rangeText(tree.range) + operand(tree.end, tighterLevel(operatorLevels.range));
  }
  if ('deferring' in tree) {
    return deferredText(tree.deferring, printMinimal);
  }
  return `${operand(tree.isSubject, operatorLevels.is)} is P`;
}

/** The operator tree an expression denotes, parentheses ignored; other nodes show their kind. */
export function shapeOf(expression: Expression): OperatorTree | { readonly unexpected: string } {
  switch (expression.kind) {
    case 'Parenthesized':
      return shapeOf(expression.expression);
    case 'Identifier':
      return { atom: expression.text };
    case 'IntegerLiteral':
      return { atom: String(expression.value) };
    case 'Binary':
      return {
        binary: expression.operator,
        left: shapeOf(expression.left) as OperatorTree,
        right: shapeOf(expression.right) as OperatorTree,
      };
    case 'Unary':
      return { prefix: expression.operator, operand: shapeOf(expression.operand) as OperatorTree };
    case 'Dereference':
      return { prefix: '*', operand: shapeOf(expression.operand) as OperatorTree };
    case 'Await':
      return { prefix: 'await', operand: shapeOf(expression.operand) as OperatorTree };
    case 'Range':
      return expression.start === undefined || expression.end === undefined
        ? { unexpected: 'open Range' }
        : {
            range: expression.isInclusive,
            start: shapeOf(expression.start) as OperatorTree,
            end: shapeOf(expression.end) as OperatorTree,
          };
    case 'Is':
      return { isSubject: shapeOf(expression.subject) as OperatorTree };
    case 'DeferredCall':
      return { deferring: deferredShape(expression.call) as OperatorTree };
    default:
      return { unexpected: expression.kind };
  }
}

/** What a deferred call's `call` stands for: another deferred call's shape, or `f`'s argument's. */
function deferredShape(call: Expression): OperatorTree | { readonly unexpected: string } {
  if (call.kind === 'DeferredCall') {
    return shapeOf(call);
  }
  const [argument] = call.kind === 'Call' ? call.arguments : [];
  return argument === undefined || argument.kind === 'Spread' || argument.kind === 'NamedArgument'
    ? { unexpected: call.kind }
    : shapeOf(argument);
}
