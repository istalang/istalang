/**
 * What checking reads of its Program and its Bindings, as inputs of the checker's revision
 * (structures/entries.ts): each answer is recorded in the entry computing now, so a later revision
 * takes an entry over whenever what it read still answers alike, however much else changed
 * (docs/work/m6-m7/incremental-checking.md §1, §4).
 *
 * - A module is read in parts (its items, the modules its imports name, its tree), never whole, so
 *   an entry depends only on the parts it used.
 * - Every Bindings answer is an input too. Entities compare by identity, which holds across
 *   revisions for every module whose tree was reused (binder/entities.ts); lists and maps compare
 *   item by item.
 * - A bare variant is read as the one its expected type chooses, not as every variant so named, so
 *   an enum added elsewhere changes only the entries whose choice it changes.
 */

import type { LanguageModule } from '../../language/well-known.ts';
import type { Entries } from '../../structures/entries.ts';
import { sameEntries, sameItems } from '../../structures/equality.ts';
import type { Bindings, VariantEntity } from '../binder/entities.ts';
import type { ModuleId, Program } from '../program/program.ts';
import { isStdModule, programModule } from '../program/program.ts';
import type { EnumDeclaration } from '../syntax/declarations.ts';
import type { CheckerNote, ProgramInputs } from './context.ts';
import { DeclaringModules } from './declaring-modules.ts';

/** Checking's reads of `program`, recorded in `entries`. */
export function programInputs(
  entries: Entries<CheckerNote>,
  program: Program,
  bindings: Bindings,
): ProgramInputs {
  return {
    itemsOf: entries.input({
      name: 'items of',
      read: (module: ModuleId) => programModule(program, module).tree.root.items,
      equal: sameItems(),
    }),
    importedBy: entries.input({
      name: 'imported by',
      read: (module: ModuleId) => [...(program.modules.get(module)?.imports.values() ?? [])],
      equal: sameItems(),
    }),
    role: entries.input({
      name: 'role',
      read: (role: LanguageModule) => program.roles[role],
    }),
    treeOf: entries.input({
      name: 'tree of',
      read: (module: ModuleId) => programModule(program, module).tree,
    }),
    variantNamed: entries.input({
      name: 'variant named',
      read: (name: string, enums: readonly EnumDeclaration[]): VariantEntity | undefined =>
        bindings
          .candidatesOf({ kind: 'variants', name })
          .find((candidate) => enums.includes(candidate.enum)),
    }),
  };
}

/** `bindings`, each answer recorded in `entries`. */
export function recordedBindings(entries: Entries<CheckerNote>, bindings: Bindings): Bindings {
  const sameList = sameItems();
  const sameNames = sameEntries();
  return {
    entityOf: entries.input({ name: 'entity of', read: bindings.entityOf }),
    exportsOf: entries.input({ name: 'exports of', read: bindings.exportsOf, equal: sameNames }),
    moduleOf: entries.input({ name: 'module of entity', read: bindings.moduleOf }),
    isTopLevel: entries.input({ name: 'is top level', read: bindings.isTopLevel }),
    usesOf: entries.input({
      name: 'uses of',
      read: bindings.usesOf,
      equal: sameItems(
        (first, second) => first.module === second.module && first.name === second.name,
      ),
    }),
    visibleAt: entries.input({ name: 'visible at', read: bindings.visibleAt, equal: sameNames }),
    overloadsOf: entries.input({
      name: 'overloads of',
      read: bindings.overloadsOf,
      equal: sameList,
    }),
    candidatesOf: entries.input({
      name: 'candidates of',
      read: bindings.candidatesOf,
      equal: sameList,
    }),
    ownCallOf: entries.input({ name: 'own call of', read: bindings.ownCallOf }),
    topLevelNamed: entries.input({ name: 'top-level named', read: bindings.topLevelNamed }),
    diagnosticsOf: entries.input({
      name: 'binder diagnostics of',
      read: bindings.diagnosticsOf,
      equal: sameList,
    }),
  };
}

/** Which module declares what, and which modules are std, each answer recorded in `entries`. */
export function declaringInputs(entries: Entries<CheckerNote>, program: Program) {
  const modules = new DeclaringModules(program);
  return {
    moduleOf: entries.input({ name: 'module of', read: modules.moduleOf }),
    itemModuleOf: entries.input({ name: 'item module of', read: modules.itemModuleOf }),
    isStd: entries.input({
      name: 'is std',
      read: (module: ModuleId | undefined) => isStdModule(program, module),
    }),
  };
}
