/**
 * What a type `match` case's pattern declares (§3.17): its `infer` variables, at any depth, which
 * the binder makes visible in the case and the checker binds to the subject's parts.
 */

import { fieldChildrenOf, type SyntaxNode } from './tree.ts';
import type { InferType } from './types.ts';

/** The `infer` types `node` holds, at any depth, in the order written. */
export function inferTypesIn(node: SyntaxNode): readonly InferType[] {
  const inner = fieldChildrenOf(node).flatMap(inferTypesIn);
  return node.kind === 'InferType' ? [node, ...inner] : inner;
}
