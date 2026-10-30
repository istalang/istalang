/**
 * The checked tree's node standing where a node of the placeholder parse (placeholder.ts) stands,
 * which checker queries know. Before the cursor both trees read the same text, so a node ending
 * there has a twin of the same kind and extent; one reaching past the cursor may have none, as the
 * text after the cursor reads differently without the placeholder.
 */

import { extentIn, nodesAt, type SyntaxNode, type SyntaxTree } from '../../compiler/syntax/tree.ts';
import type { Cursor } from './cursor.ts';

/** `node` of `parsed`, the placeholder parse, as the checked tree holds it; undefined for none. */
export function checkedTwinOf<Node extends SyntaxNode>(
  { tree, offset }: Cursor,
  parsed: SyntaxTree,
  node: Node,
): Node | undefined {
  const { start, end } = extentIn(parsed, node);
  if (end > offset) {
    return undefined;
  }
  return nodesAt(tree, start).find((each): each is Node => {
    const extent = extentIn(tree, each);
    return each.kind === node.kind && extent.start === start && extent.end === end;
  });
}
