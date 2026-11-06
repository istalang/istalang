/**
 * Which function bodies parsing leaves a tree: those of the functions its nodes reach, of all the
 * bodies the parser recorded (../parse.ts, reuse.ts).
 *
 * Recovery lets go of nodes in many places, undoing a parse or making a node Invalid, so a body
 * recorded may belong to a function no tree holds. Keeping only what the nodes reach leaves none,
 * however it was let go of. Order doesn't matter here, so the walk reads fields as they are.
 */

import { pushAll } from '../../../structures/stack.ts';
import type { FunctionDeclaration } from '../../syntax/declarations/index.ts';
import type { Block } from '../../syntax/statements/index.ts';
import { isNode, type SyntaxNode } from '../../syntax/tree.ts';

/** The bodies of the functions `nodes` reach, each read from `recorded`. */
export function bodiesHeldBy(
  nodes: readonly SyntaxNode[],
  recorded: ReadonlyMap<FunctionDeclaration, Block>,
): Map<FunctionDeclaration, Block> {
  const held = new Map<FunctionDeclaration, Block>();
  const pending = [...nodes];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        pushAll(pending, value.filter(isNode));
      } else if (isNode(value)) {
        pending.push(value);
      }
    }
    const body = node.kind === 'FunctionDeclaration' ? recorded.get(node) : undefined;
    if (node.kind === 'FunctionDeclaration' && body !== undefined) {
      held.set(node, body);
      pending.push(body);
    }
  }
  return held;
}
