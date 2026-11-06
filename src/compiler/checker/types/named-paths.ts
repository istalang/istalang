/**
 * How a named type's path splits (§3.1, §3.13): the one home every reader of a `NamedType`'s path
 * goes through, so a name a module's namespace qualifies (`lib.OrInt`) is read as what it names
 * everywhere, never by its first part.
 *
 * - The name is the last part the binder resolved: namespaces qualifying it resolve too, to the
 *   module they name.
 * - The parts past it are the associated types read through what it names (`T.Data`, §3.1), which
 *   the binder leaves unresolved, since only checking knows the type.
 */

import type { Bindings, Entity } from '../../binder/entities.ts';
import type { ModuleId } from '../../program/program.ts';
import type { Identifier } from '../../syntax/node.ts';
import type { NamedType } from '../../syntax/types.ts';

/** A named type's path split: its name and what that denotes, and the associated types past it. */
export interface NamedPath {
  /** The last part the binder resolved; undefined when even the first resolves to nothing. */
  readonly name: Identifier | undefined;
  readonly entity: Entity | undefined;
  readonly members: readonly Identifier[];
}

/** How `node`'s path in `module` splits (the banner). */
export function namedPathOf(bindings: Bindings, module: ModuleId, node: NamedType): NamedPath {
  const unresolved = node.path.findIndex((part) => bindings.entityOf(module, part) === undefined);
  const named = unresolved === -1 ? node.path.length : unresolved;
  const name = node.path[named - 1];
  return {
    name,
    entity: name === undefined ? undefined : bindings.entityOf(module, name),
    members: node.path.slice(named),
  };
}
