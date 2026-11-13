/**
 * The nodes a desugaring builds (index.ts), which no text wrote.
 *
 * - Each knows the sugar it stands in for (`originOf`), so what checking reports while it checks
 *   one is worded for that sugar; a written operand inside it is no such node, so its own mistakes
 *   read as written.
 * - Each takes the span of the written code it stands for, so a report at it points there.
 * - A name one introduces is bound by the desugaring, to a declaration it chose (the prelude's
 *   `panic`, which a local one may shadow, §3.4) or a variable it declares; every phase reads it
 *   through the checker's bindings (`withSynthesizedNames`) as it reads a written one.
 */

import type { Bindings, Entity } from '../../binder/entities.ts';
import type { SyntaxNode } from '../../syntax/tree/index.ts';
import type { Identifier } from '../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { Sugar } from '../surface/checked-body.ts';

const origins = new WeakMap<SyntaxNode, Sugar>();
const names = new WeakMap<Identifier, Entity>();

/** `node`, built for `sugar`. */
export function synthesized<Node extends SyntaxNode>(sugar: Sugar, node: Node): Node {
  origins.set(node, sugar);
  return node;
}

/** The sugar `node` was built for; undefined for a written node. */
export function originOf(node: SyntaxNode): Sugar | undefined {
  return origins.get(node);
}

/** A name built for `sugar`, spelled `text` at `span`, denoting `entity`. */
export function boundName(
  sugar: Sugar,
  text: string,
  span: AnchoredSpan,
  entity: Entity,
): Identifier {
  const name = synthesized(sugar, { kind: 'Identifier', span, text } satisfies Identifier);
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
