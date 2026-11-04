/**
 * Static functions by the type they are declared on (§3.7): `fn Duration.zero()` belongs to
 * `Duration`, not to an overload set of `zero`. Each module's are indexed once, by the declaration
 * of the type, or the primitive's name, that the owner resolves to where it is written; an owner
 * that is an alias belongs to the type the alias stands for.
 */

import type { EntryTable } from '../../../structures/entries/index.ts';
import { sameEntries, sameItems } from '../../../structures/equality.ts';
import { addToGroup } from '../../../structures/groups.ts';
import type { ModuleId } from '../../program/program.ts';
import { declaredFunctions, type FunctionDeclaration } from '../../syntax/declarations.ts';
import type { CheckerContext, CheckerNote, StaticOwner } from '../context.ts';
import { isNominalEntity } from '../types/type.ts';

export class StaticFunctions {
  readonly #checker: CheckerContext;
  readonly #byModule: EntryTable<
    CheckerNote,
    ModuleId,
    ReadonlyMap<StaticOwner, readonly FunctionDeclaration[]>
  >;

  constructor(checker: CheckerContext) {
    this.#checker = checker;
    this.#byModule = checker.entries.table({
      name: 'statics',
      compute: (module) => this.#index(module),
      equal: sameEntries(sameItems()),
    });
  }

  /** The static functions declared on `owner` in `module`. */
  in(module: ModuleId, owner: StaticOwner): readonly FunctionDeclaration[] {
    return this.#byModule.get(module).get(owner) ?? [];
  }

  #index(module: ModuleId): ReadonlyMap<StaticOwner, readonly FunctionDeclaration[]> {
    const index = new Map<StaticOwner, FunctionDeclaration[]>();
    const items = this.#checker.inputs.itemsOf(module);
    const statics = declaredFunctions({ items }).filter((declared) => declared.owner !== undefined);
    for (const item of statics) {
      const owner = this.#ownerOf(module, item);
      if (owner !== undefined) {
        addToGroup(index, owner, item);
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
    return isNominalEntity(entity) ? entity.declaration : undefined;
  }
}
