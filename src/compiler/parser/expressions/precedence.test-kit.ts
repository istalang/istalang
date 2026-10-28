/**
 * Random operator trees and two printers for them, for the precedence property.
 *
 * Both printers read their levels from syntax/operators.ts, the table the parser uses:
 * - The full printer parenthesizes every operator.
 * - The minimal printer parenthesizes only where the table requires it: levels, associativity and
 *   the operands an operator refuses without parentheses, `**`'s refusing a prefix too (§3.9). Besides the table, it knows two
 *   grammar rules: comparisons in a row chain, so a comparison under another is wrapped, and
 *   `name < name > (…)` reads as a generic call (§3.5), so its comparison is wrapped.
 * `shapeOf` turns a parsed expression back into a tree, ignoring parentheses, so the printed text
 * can be compared with the tree it came from.
 */

import fc from 'fast-check';
import type { Expression } from '../../syntax/expressions/index.ts';
import {
  type BinaryOperator,
  type BinaryOperatorEntry,
  binaryOperators,
  bindingPower,
  isChainOperator,
  operatorLevels,
  type PrecedenceLevel,
  rightOperandLevel,
  tighterLevel,
  type UnaryOperator,
  unaryOperators,
} from '../../syntax/operators.ts';

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
  | { readonly isSubject: OperatorTree };

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
  return `(${printFull(tree.isSubject)} is P)`;
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
  // A comparison right after another would extend it into a chain, so the tree's own needs grouping.
  const chains = (child: OperatorTree) =>
    'binary' in child && isChainOperator(tree.binary) && isChainOperator(child.binary);
  const leftLevel = entry.associativity === 'right' ? tighterLevel(entry.level) : entry.level;
  let left = operand(tree.left, leftLevel, refused(tree.left) || chains(tree.left));
  const right = operand(tree.right, rightOperandLevel(tree.binary), refused(tree.right));
  if (tree.binary === '>' && right.startsWith('(') && genericLookalike.test(left)) {
    left = `(${left})`;
  }
  return `${left} ${tree.binary} ${right}`;
}

/** Whether `child`, the operand of a prefix at `level`, is an operator refusing a prefix before it. */
function refusesPrefix(child: OperatorTree, level: PrecedenceLevel): boolean {
  if (!('binary' in child) || level !== 'prefix') {
    return false;
  }
  const entry: BinaryOperatorEntry = binaryOperators[child.binary];
  return entry.refusesPrefixedLeft === true;
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
    default:
      return { unexpected: expression.kind };
  }
}
