/**
 * What a link of an optional chain runs beside its step (§4): the link's parts other than the
 * step's target, which the flow model runs before the step, as the chain evaluates them.
 */

import { fieldChildrenOf, type SyntaxNode } from '../../../syntax/tree/index.ts';

/**
 * The parts of `node` other than its step's `target`, a child or, for a method call, the callee's
 * child (`chainStepOf`): a callee holding the target is opened up into its other parts, through
 * the type arguments written after its name.
 */
export function partsBeside(node: SyntaxNode, target: SyntaxNode): readonly SyntaxNode[] {
  return fieldChildrenOf(node).flatMap((child) => {
    if (child === target) {
      return [];
    }
    const parts = fieldChildrenOf(child);
    if (parts.includes(target)) {
      return parts.filter((part) => part !== target);
    }
    return child.kind === 'TypeApplication' ? partsBeside(child, target) : [child];
  });
}
