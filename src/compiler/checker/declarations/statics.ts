/**
 * Static functions by the type they are declared on (§3.7): `fn Duration.zero()` belongs to
 * `Duration`, not to an overload set of `zero`. Each module's are indexed once, by the declaration
 * of the type, or the primitive's name, that the owner resolves to where it is written; an owner
 * that is an alias belongs to the type the alias stands for.
 */

import { memo } from '../../../structures/memo.ts';
import type { ModuleId } from '../../program/program.ts';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import type { CheckerContext, StaticOwner } from '../context.ts';

export class StaticFunctions {
  readonly #checker: CheckerContext;
  readonly #byModule = new Map<
    ModuleId,
    ReadonlyMap<StaticOwner, readonly FunctionDeclaration[]>
  >();

  constructor(checker: CheckerContext) {
    this.#checker = checker;
  }

  /** The static functions declared on `owner` in `module`. */
  in(module: ModuleId, owner: StaticOwner): readonly FunctionDeclaration[] {
    return memo(this.#byModule, module, () => this.#index(module)).get(owner) ?? [];
  }

  #index(module: ModuleId): ReadonlyMap<StaticOwner, readonly FunctionDeclaration[]> {
    const index = new Map<StaticOwner, FunctionDeclaration[]>();
    const items = this.#checker.program.modules.get(module)?.tree.root.items ?? [];
    const statics = items
      .filter((item) => item.kind === 'FunctionDeclaration')
      .filter((item) => item.owner !== undefined);
    for (const item of statics) {
      const owner = this.#ownerOf(module, item);
      if (owner !== undefined) {
        index.set(owner, [...(index.get(owner) ?? []), item]);
      }
    }
    return index;
  }

  #ownerOf(module: ModuleId, declaration: FunctionDeclaration): StaticOwner | undefined {
    const checker = this.#checker;
    const entity =
      declaration.owner === undefined
        ? undefined
        : checker.bindings.entityOf(module, declaration.owner);
    if (entity?.kind === 'primitive') {
      return entity.name;
    }
    if (entity?.kind !== 'type') {
      return undefined;
    }
    const { declaration: owner } = entity;
    if (owner.kind === 'TypeAliasDeclaration') {
      const aliased = checker.aliasedType(owner);
      if (aliased.kind === 'primitive') {
        return aliased.name;
      }
      return aliased.kind === 'nominal' ? aliased.entity.declaration : undefined;
    }
    return owner.kind === 'StructDeclaration' ||
      owner.kind === 'EnumDeclaration' ||
      owner.kind === 'ExternStructDeclaration'
      ? owner
      : undefined;
  }
}
