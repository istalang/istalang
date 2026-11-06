/**
 * A comparison read as its links (§4): `a < b <= c` compares `a` with `b`, then `b` with `c`, and
 * a single `a < b` is one link. The checker and lowering both walk these, so the pairing has one
 * home.
 */

import { type AnchoredSpan, spanAcross } from '../tree/positions.ts';
import type { Binary, ChainedComparison, Expression } from './index.ts';
import { type ChainingOperator, isChainingOperator } from './operators.ts';

/** One comparison of a chain: an operand, the operator after it, and the operand after that. */
export interface ComparisonLink {
  readonly left: Expression;
  readonly operator: ChainingOperator;
  readonly right: Expression;
}

/** The comparisons a chain makes, in order; neighbouring ones share an operand. */
export function comparisonLinksOf(chain: ChainedComparison): readonly ComparisonLink[] {
  return chain.operators.flatMap((operator, index) => {
    const [left, right] = [chain.operands[index], chain.operands[index + 1]];
    return left === undefined || right === undefined ? [] : [{ left, operator, right }];
  });
}

/** A binary's one comparison when its operator chains (`a < b`, `x in c`); undefined otherwise. */
export function comparisonLinkOf(node: Binary): ComparisonLink | undefined {
  const { left, operator, right } = node;
  return isChainingOperator(operator) ? { left, operator, right } : undefined;
}

/** Where a link stands: from its left operand to its right one. */
export function linkSpan(link: ComparisonLink): AnchoredSpan {
  return spanAcross(link.left.span, link.right.span);
}
