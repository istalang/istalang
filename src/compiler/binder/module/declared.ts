/**
 * What one module's bindings declared, fixed when bindModule makes them: the entities (each
 * stamped with its module as it is made, entities.ts), and its declaration nodes, items' and
 * local ones, by which the checker asks which module declares a node.
 *
 * - A node outlives its tree: an edit keeps the nodes it left alike, so the next tree of the module
 *   declares them too. A tree is bound only as its own module, so a node's module, stamped when
 *   its tree is bound, never changes; it is a program's when that program's bindings of the module
 *   declare the node, as a stale one must answer no module.
 * - The stamps are read only through `declaringModuleOf`.
 */

import type { ModuleId } from '../../program/program.ts';
import { fieldsFunctionsOf } from '../../syntax/declarations/field-defaults.ts';
import { type Declaration, typeParametersOf } from '../../syntax/declarations/index.ts';
import { nodesUnder, type SyntaxTree } from '../../syntax/tree/index.ts';
import type { NodeOf } from '../../syntax/tree/node.ts';
import type { Entity } from '../entities.ts';
import type { LocalResult } from './local-binder.ts';
import type { ModuleScope } from './module-scope.ts';

/** What one module's bindings declared. */
export interface Declared {
  /** Every entity its tree made, locals and variants included. */
  readonly entities: ReadonlySet<Entity>;
  /** Of those, its top-level names'. */
  readonly topLevel: ReadonlySet<Entity>;
  /** Its items, their type parameters, a trait's members, associated types and field functions. */
  readonly items: ReadonlySet<NodeOf<string>>;
  /** Its other declarations: variables, local functions and type parameters inside its items. */
  readonly locals: ReadonlySet<NodeOf<string>>;
}

const modulesOfNodes = new WeakMap<NodeOf<string>, ModuleId>();

/**
 * What `tree`, bound as `module` into `bound`, declared, each declaration node stamped with
 * `module`.
 */
export function declaredBy(
  tree: SyntaxTree,
  module: ModuleId,
  bound: Omit<ModuleScope, 'scope'> & LocalResult,
): Declared {
  // What the tree's names denote and its scopes define is the tree's own, locals included, but
  // for what no module declares: placeholders, the shared primitives, a bare name's candidates.
  const entities = new Set<Entity>(
    [...bound.entities.values(), ...bound.defined].filter(
      (entity) =>
        entity.kind !== 'import' && entity.kind !== 'primitive' && entity.kind !== 'variants',
    ),
  );
  for (const variants of bound.variants.values()) {
    for (const variant of variants.values()) {
      entities.add(variant);
    }
  }
  const topLevel = new Set<Entity>(
    [...bound.topLevel.values()].flatMap(({ entity }) =>
      entity.kind === 'import' ? [] : [entity],
    ),
  );
  for (const entity of topLevel) {
    entities.add(entity);
  }
  const items = new Set<NodeOf<string>>(
    tree.root.items.flatMap((item) => (item.kind === 'Invalid' ? [] : itemDeclarations(item))),
  );
  const locals = new Set<NodeOf<string>>(
    nodesUnder(tree, tree.root).filter(
      (node) => localDeclarationKinds.has(node.kind) && !items.has(node),
    ),
  );
  for (const node of [...items, ...locals]) {
    modulesOfNodes.set(node, module);
  }
  return { entities, topLevel, items, locals };
}

/** The kinds of node a declaration inside an item may be. */
const localDeclarationKinds: ReadonlySet<string> = new Set([
  'VariableDeclaration',
  'FunctionDeclaration',
  'TypeParameter',
]);

/** The module whose tree declared `node` when it was bound, whichever program holds it now. */
export function declaringModuleOf(node: NodeOf<string>): ModuleId | undefined {
  return modulesOfNodes.get(node);
}

/**
 * `item`, its type parameters, a trait's members with theirs, its associated types (§5.2), and the
 * functions it reads as.
 */
function itemDeclarations(item: Declaration): readonly NodeOf<string>[] {
  const parameters = 'typeParameters' in item ? typeParametersOf(item.typeParameters) : [];
  const members =
    item.kind === 'TraitDeclaration'
      ? item.members.flatMap((member) => {
          if (member.kind === 'FunctionDeclaration') {
            return itemDeclarations(member);
          }
          return member.kind === 'RequiredAssociatedType' ? [member] : [];
        })
      : [];
  const associated = 'associatedTypes' in item ? item.associatedTypes : [];
  return [item, ...parameters, ...members, ...associated, ...fieldsFunctionsOf(item)];
}
