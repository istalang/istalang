/** The top-level item holding a node, as tools read it. */

import type { Declaration } from '../../syntax/declarations/index.ts';
import { ancestorsOf, type SyntaxNode, type SyntaxTree } from '../../syntax/tree/index.ts';

/** The top-level item of `tree` holding `node`, or `node` itself; undefined for the root. */
export function itemHolding(tree: SyntaxTree, node: SyntaxNode): Declaration | undefined {
  const path = new Set(ancestorsOf(tree, node));
  return tree.root.items.find(
    (item): item is Declaration => item.kind !== 'Invalid' && path.has(item),
  );
}
