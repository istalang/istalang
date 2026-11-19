/**
 * What a type `match` case's pattern declares (§4.6): its `infer` variables, at any depth, which
 * the binder makes visible in the case and the checker binds to the subject's parts; and where a
 * node stands among type `match`es, which decides where `infer` may be written (only in a case's
 * pattern) and where a use of a type `match` alias stays as written (inside one).
 */

import { fieldChildrenOf, parentOf, type SyntaxNode, type SyntaxTree } from '../tree/index.ts';
import type { InferType } from './index.ts';

/** The `infer` types `node` holds, at any depth, in the order written. */
export function inferTypesIn(node: SyntaxNode): readonly InferType[] {
  const inner = fieldChildrenOf(node).flatMap(inferTypesIn);
  return node.kind === 'InferType' ? [node, ...inner] : inner;
}

/**
 * Where a node stands among type `match`es: in a case's pattern, elsewhere inside one, or outside.
 */
type MatchPlace = 'pattern' | 'match' | 'outside';

/** Where `node` stands in `tree` among type `match`es: the innermost one holding it decides. */
export function matchPlaceOf(tree: SyntaxTree, node: SyntaxNode): MatchPlace {
  let child = node;
  for (let parent = parentOf(tree, node); parent !== undefined; parent = parentOf(tree, parent)) {
    if (parent.kind === 'TypeCase' && parent.pattern === child) {
      return 'pattern';
    }
    if (parent.kind === 'TypeMatch') {
      return 'match';
    }
    child = parent;
  }
  return 'outside';
}
