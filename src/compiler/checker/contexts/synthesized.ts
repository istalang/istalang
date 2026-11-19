/**
 * The nodes a desugaring builds (checker/desugaring/), which no text wrote.
 *
 * - Each knows what it stands for (`originOf`): the sugar, and its part in the sugar's core, so
 *   what checking reports while it checks one is worded for that part; a written operand inside it
 *   is no such node, so its own mistakes read as written. A function built has no head a message
 *   could ask to mark, and is named as its sugar says.
 * - Each takes the span of the written code it stands for, so a report at it points there.
 * - A name one introduces is bound by the desugaring, to a declaration it chose (the prelude's
 *   `panic`, which a local one may shadow, §7.1) or a constant it declares; every phase reads it
 *   through the checker's bindings (`withSynthesizedNames`) as it reads a written one.
 */

import type { Bindings, Entity } from '../../binder/entities.ts';
import type { SyntaxNode } from '../../syntax/tree/index.ts';
import type { Identifier } from '../../syntax/tree/node.ts';
import type { Sugar } from '../surface/checked-body.ts';

/** What a node built for a sugar stands for. */
export interface Origin {
  readonly sugar: Sugar;
  /** Its part in the sugar's core, which the sugar's wording reads. */
  readonly role: string;
  /** How messages name it, a function built having no name of its own. */
  readonly named?: string;
}

const origins = new WeakMap<SyntaxNode, Origin>();
const names = new WeakMap<Identifier, Entity>();

/** `node`, built as `origin` says. */
export function synthesized<Node extends SyntaxNode>(origin: Origin, node: Node): Node {
  origins.set(node, origin);
  return node;
}

/** What `node` was built for; undefined for a written node. */
export function originOf(node: SyntaxNode): Origin | undefined {
  return origins.get(node);
}

/** `name`, a name built for a sugar, bound to `entity`. */
export function bound(name: Identifier, entity: Entity): Identifier {
  names.set(name, entity);
  return name;
}

/** `bindings`, answering for the names desugarings bound as for written ones. */
export function withSynthesizedNames(bindings: Bindings): Bindings {
  return {
    ...bindings,
    entityOf: (module, name) => names.get(name) ?? bindings.entityOf(module, name),
  };
}
