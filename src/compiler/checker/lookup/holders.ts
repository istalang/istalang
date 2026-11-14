/**
 * What holds a node, as tools read it: the top-level item, and the checked body
 * (contexts/holding-body.ts), the passes of the field loops around the node read as one.
 */

import type { ModuleId } from '../../program/program.ts';
import type { Declaration } from '../../syntax/declarations/index.ts';
import { ancestorsOf, type SyntaxNode, type SyntaxTree } from '../../syntax/tree/index.ts';
import type { CheckerContext } from '../contexts/context.ts';
import { type BodyOwners, checkedBodyHolding } from '../contexts/holding-body.ts';
import type { JoinedBody } from '../surface/denotation.ts';
import { passesAround } from './pass-views.ts';

/** The top-level item of `tree` holding `node`, or `node` itself; undefined for the root. */
export function itemHolding(tree: SyntaxTree, node: SyntaxNode): Declaration | undefined {
  const path = new Set(ancestorsOf(tree, node));
  return tree.root.items.find(
    (item): item is Declaration => item.kind !== 'Invalid' && path.has(item),
  );
}

/**
 * The checked body holding `node` of `module`, as the passes of the field loops around it read
 * it, joined (pass-views.ts); undefined outside every body.
 */
export function bodyHolding(
  checker: BodyOwners & Pick<CheckerContext, 'typeRules'>,
  module: ModuleId,
  node: SyntaxNode,
): JoinedBody | undefined {
  const body = checkedBodyHolding(checker, module, node);
  const path = ancestorsOf(checker.inputs.treeOf(module), node);
  return body === undefined ? undefined : passesAround(body, path, checker.typeRules);
}
