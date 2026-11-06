/**
 * Reading the nodes that hold a position, from a tree's root down to the innermost
 * (`nodesAt`), as a placeholder's parse gives them: a node's role is decided by what holds it.
 */

import type { SyntaxNode } from '../../../../compiler/syntax/tree/index.ts';

/** The node holding `node` in `chain`; undefined for the root. */
export function holderIn(chain: readonly SyntaxNode[], node: SyntaxNode): SyntaxNode | undefined {
  return chain[chain.indexOf(node) - 1];
}
