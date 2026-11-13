/**
 * Comparisons (§3.9): a binary whose operator could chain, `a < b`, `x in c`, `a == b`. A chain
 * of them is sugar for its links joined by `and` (checker/desugaring/chained-comparisons.ts), so
 * every phase after checking meets them one at a time.
 */

import type { Binary } from './index.ts';
import { type ChainingOperator, isChainingOperator } from './operators.ts';

/** A binary comparing its two operands. */
export type Comparison = Binary & { readonly operator: ChainingOperator };

export function isComparison(node: Binary): node is Comparison {
  return isChainingOperator(node.operator);
}
