/**
 * A chained comparison read as its links (§4): `a < b <= c` compares `a` with `b`, then `b` with
 * `c`. The checker and lowering both walk these, so the pairing has one home.
 */

import type { ChainingOperator } from '../operators.ts';
import type { ChainedComparison, Expression } from './index.ts';

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
