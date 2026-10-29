/**
 * Every name of a program that denotes each entity, for tools: "find references" lists them and a
 * rename edits them all. It derives from the trees and `entityOf` alone, so whatever any name
 * denotes, its declaring names included, is indexed by the one rule that says what names denote.
 */

import { memo } from '../../structures/memo.ts';
import type { Program } from '../program/program.ts';
import type { Identifier } from '../syntax/node.ts';
import { nodesUnder, type SyntaxNode } from '../syntax/tree.ts';
import type { Bindings, Entity, EntityUse } from './entities.ts';

/** Each entity's names across `program`, in module order, then source order. */
export function usesByEntity(
  program: Program,
  entityOf: Bindings['entityOf'],
): ReadonlyMap<Entity, readonly EntityUse[]> {
  const uses = new Map<Entity, EntityUse[]>();
  for (const [module, { tree }] of program.modules) {
    for (const name of nodesUnder(tree, tree.root).filter(isIdentifier)) {
      const entity = entityOf(module, name);
      if (entity !== undefined) {
        memo(uses, entity, (): EntityUse[] => []).push({ module, name });
      }
    }
  }
  return uses;
}

function isIdentifier(node: SyntaxNode): node is Identifier {
  return node.kind === 'Identifier';
}
