/**
 * What may qualify the next part of a qualified name (§5.3, §13.1, §4.6): a module's namespace,
 * an enum, whose variants follow its `.`, or an alias standing for an enum, which names the enum
 * as any alias names its type, so `E.Red` is `Color.Red` for `type E = Color`.
 *
 * An alias is followed by the name its type is written with, through other aliases, each looked up
 * where it is declared; the binder resolves no types, so an alias written as anything but a plain
 * name (a `T?`, a tuple, an enum given type arguments), or with type parameters of its own, which a
 * name could be, stands for no enum here: a variant qualified by it would drop what its arguments
 * say. An alias reached twice is a cycle, which the checker reports (§4.6), and qualifies nothing.
 */

import type { ModuleId } from '../../program/program.ts';
import type { TypeAliasDeclaration } from '../../syntax/declarations/index.ts';
import { unparenthesizedType } from '../../syntax/types/index.ts';
import { type Entity, type NamespaceEntity, type Qualifier, qualifies } from '../entities.ts';

/** What following an alias needs of the linker. */
export interface AliasLookup {
  /** The module declaring `entity`. */
  readonly moduleOf: (entity: Entity) => ModuleId | undefined;
  /** What `name` denotes at the top level of `module`: its own name or import, or the prelude's. */
  readonly topLevelNamed: (module: ModuleId, name: string) => Entity | undefined;
  /** What the module `namespace` imported exports as `name`. */
  readonly exportOf: (namespace: NamespaceEntity, name: string) => Entity | undefined;
}

/** What `entity` qualifies the next part of a name through, an alias the enum it stands for. */
export function qualifierOf(lookup: AliasLookup, entity: Entity): Qualifier | undefined {
  const seen = new Set<TypeAliasDeclaration>();
  let current: Entity | undefined = entity;
  while (
    current?.kind === 'type' &&
    current.declaration.kind === 'TypeAliasDeclaration' &&
    !seen.has(current.declaration)
  ) {
    seen.add(current.declaration);
    current = aliasedEntity(lookup, current, current.declaration);
  }
  return current !== undefined && qualifies(current) ? current : undefined;
}

/** What the name `declaration`'s type is written with denotes, where the alias is declared. */
function aliasedEntity(
  lookup: AliasLookup,
  alias: Entity,
  declaration: TypeAliasDeclaration,
): Entity | undefined {
  const module = lookup.moduleOf(alias);
  const written =
    declaration.type.kind === 'TypeMatch' ? undefined : unparenthesizedType(declaration.type);
  const isPlainName =
    written?.kind === 'NamedType' &&
    written.typeArguments.length === 0 &&
    declaration.typeParameters.length === 0;
  if (module === undefined || !isPlainName) {
    return undefined;
  }
  const [head, ...rest] = written.path;
  let current = lookup.topLevelNamed(module, head.text);
  for (const part of rest) {
    current = current?.kind === 'namespace' ? lookup.exportOf(current, part.text) : undefined;
  }
  return current;
}
