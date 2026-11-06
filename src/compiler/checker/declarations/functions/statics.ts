/**
 * Static functions by the type they are declared on (§3.7): `fn Duration.zero()` belongs to
 * `Duration`, not to an overload set of `zero`. Each module's are indexed once, by what their owner
 * names where it is written, as types/written/named-types.ts keys it: an alias's owner is the type it
 * stands for, a shape among them (§3.17).
 */

import type { EntryTable } from '../../../../structures/entries/index.ts';
import { sameEntries, sameItems } from '../../../../structures/equality.ts';
import { addToGroup } from '../../../../structures/groups.ts';
import type { ModuleId } from '../../../program/program.ts';
import { declaredFunctions, type FunctionDeclaration } from '../../../syntax/declarations.ts';
import type { CheckerContext, CheckerNote } from '../../context.ts';
import { declaredOwnerOf, type StaticOwner } from '../../types/written/named-types.ts';

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
      const owner = declaredOwnerOf(this.#checker, module, item);
      if (owner !== undefined) {
        addToGroup(index, owner, item);
      }
    }
    return index;
  }
}
