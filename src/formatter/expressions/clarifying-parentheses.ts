/**
 * Parentheses the formatter adds where the precedence table (spec §10.3) reads an operation one
 * way and people often read it another, though the language needs none there:
 * - `and` inside `or`: `a or (b and c)`;
 * - a bitwise operator or a shift beside an operator of another level: `(a & b) == c`, which C
 *   reads as `a & (b == c)`, `(a & b) | c`, `a << (b + c)`;
 * - `%` beside `*`, `/` or `//`: `(a * b) % c`;
 * - `not` over a comparison: `not (a == b)`, never `(not a) == b`.
 * Each wraps an operand that binds tighter than its operator, so the parentheses change nothing
 * the program means. Parentheses written in the source are kept as any node is (Parenthesized).
 */

import type { Expression } from '../../compiler/syntax/expressions/index.ts';
import {
  type BinaryOperator,
  binaryOperators,
  type PrecedenceLevel,
} from '../../compiler/syntax/expressions/operators.ts';
import { parentOf, type SyntaxNode, type SyntaxTree } from '../../compiler/syntax/tree/index.ts';

/** The level of the operation `node` is, for the operations this file wraps; else undefined. */
function operationLevel(node: SyntaxNode): PrecedenceLevel | undefined {
  switch (node.kind) {
    case 'Binary':
      return binaryOperators[node.operator].level;
    case 'ChainedComparison':
    case 'Is':
      return 'comparison';
    default:
      return;
  }
}

const bitwiseLevels: ReadonlySet<PrecedenceLevel> = new Set([
  'bitwiseOr',
  'bitwiseXor',
  'bitwiseAnd',
  'shift',
]);

/** Whether `outer` and `inner` differ, one of them bitwise or a shift. */
function mixesBitwise(outer: PrecedenceLevel, inner: PrecedenceLevel): boolean {
  return outer !== inner && (bitwiseLevels.has(outer) || bitwiseLevels.has(inner));
}

/** Whether two binary operators read better apart: `and` inside `or`, `%` beside `*`, `/`, `//`. */
function mixesOperators(outer: BinaryOperator, inner: BinaryOperator): boolean {
  if (outer === 'or') {
    return inner === 'and';
  }
  const multiplicative = [outer, inner].every(
    (operator) => binaryOperators[operator].level === 'multiplicative',
  );
  return multiplicative && outer !== inner && (outer === '%' || inner === '%');
}

/** Whether `operand`, an operand of `operation`, takes clarifying parentheses (banner). */
function clarifies(operation: SyntaxNode, operand: Expression): boolean {
  const inner = operationLevel(operand);
  if (operation.kind === 'Unary') {
    return operation.operator === 'not' && inner === 'comparison';
  }
  const outer = operationLevel(operation);
  if (outer === undefined || inner === undefined) {
    return false;
  }
  return (
    mixesBitwise(outer, inner) ||
    (operation.kind === 'Binary' &&
      operand.kind === 'Binary' &&
      mixesOperators(operation.operator, operand.operator))
  );
}

/** Whether `node` prints in clarifying parentheses as an operand of its parent (banner). */
export function isClarified(tree: SyntaxTree, node: Expression): boolean {
  const parent = parentOf(tree, node);
  return parent !== undefined && clarifies(parent, node);
}
