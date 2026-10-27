/**
 * Random operator trees and two printers for them, for the precedence property.
 *
 * Both printers read their levels from syntax/operators.ts, the table the parser uses:
 * - The full printer parenthesizes every operator.
 * - The minimal printer parenthesizes only where the table requires it. Besides levels, it knows
 *   two grammar rules: `??` operands that are `and`/`or` need parentheses (§3.9), and
 *   `name < name > (…)` reads as a generic call (§3.5), so its comparison is wrapped.
 * `shapeOf` turns a parsed expression back into a tree, ignoring parentheses, so the printed text
 * can be compared with the tree it came from.
 */

import fc from 'fast-check';
import type { Expression } from '../../syntax/expressions/index.ts';
import {
  type BinaryOperator,
  binaryOperatorLevels,
  bindingPower,
  operatorLevels,
  type PrecedenceLevel,
} from '../../syntax/operators.ts';

type Prefix = '-' | '*' | 'not' | 'await';

export type OperatorTree =
  | { readonly atom: string }
  | { readonly binary: BinaryOperator; readonly left: OperatorTree; readonly right: OperatorTree }
  | { readonly prefix: Prefix; readonly operand: OperatorTree }
  | { readonly range: boolean; readonly start: OperatorTree; readonly end: OperatorTree }
  | { readonly isSubject: OperatorTree };

const binaryOperators = Object.keys(binaryOperatorLevels) as BinaryOperator[];

export const operatorTree: fc.Arbitrary<OperatorTree> = fc.letrec<{ tree: OperatorTree }>(
  (tie) => ({
    tree: fc.oneof(
      { depthSize: 'small', withCrossShrink: true },
      fc.constantFrom('a', 'b', 'c', 'd', '1', '2').map((atom) => ({ atom })),
      fc.record({
        binary: fc.constantFrom(...binaryOperators),
        left: tie('tree'),
        right: tie('tree'),
      }),
      fc.record({
        prefix: fc.constantFrom<Prefix>('-', '*', 'not', 'await'),
        operand: tie('tree'),
      }),
      fc.record({ range: fc.boolean(), start: tie('tree'), end: tie('tree') }),
      fc.record({ isSubject: tie('tree') }),
    ),
  }),
).tree;

function levelOf(tree: OperatorTree): PrecedenceLevel {
  if ('binary' in tree) {
    return binaryOperatorLevels[tree.binary];
  }
  if ('prefix' in tree) {
    return tree.prefix === 'not' ? operatorLevels.not : operatorLevels.unaryMinus;
  }
  if ('range' in tree) {
    return operatorLevels.range;
  }
  return 'isSubject' in tree ? operatorLevels.is : 'postfix';
}

function prefixText(prefix: Prefix): string {
  return prefix === '-' || prefix === '*' ? prefix : `${prefix} `;
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
 * Prints `child`, in parentheses when it binds looser than `level` (or as loose, if `strict`), or
 * when a grammar rule demands them (`mustGroup`).
 */
function operand(
  child: OperatorTree,
  level: PrecedenceLevel,
  strict: boolean,
  mustGroup = false,
): string {
  const text = printMinimal(child);
  const childPower = bindingPower(levelOf(child));
  const looser = strict ? childPower <= bindingPower(level) : childPower < bindingPower(level);
  return looser || mustGroup ? `(${text})` : text;
}

const genericLookalike = /[A-Za-z_]\w* < [A-Za-z_]\w*$/u;

function printBinary(tree: Extract<OperatorTree, { binary: BinaryOperator }>): string {
  const level = binaryOperatorLevels[tree.binary];
  const isLogicUnderCoalesce = (child: OperatorTree) =>
    tree.binary === '??' && 'binary' in child && (child.binary === 'and' || child.binary === 'or');
  let left = operand(tree.left, level, false, isLogicUnderCoalesce(tree.left));
  const right = operand(tree.right, level, true, isLogicUnderCoalesce(tree.right));
  if (tree.binary === '>' && right.startsWith('(') && genericLookalike.test(left)) {
    left = `(${left})`;
  }
  return `${left} ${tree.binary} ${right}`;
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
    return prefixText(tree.prefix) + operand(tree.operand, levelOf(tree), false);
  }
  if ('range' in tree) {
    const start = operand(tree.start, operatorLevels.range, false);
    return start + rangeText(tree.range) + operand(tree.end, operatorLevels.range, true);
  }
  return `${operand(tree.isSubject, operatorLevels.is, false)} is P`;
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
