/**
 * What checking reads of its Program and its Bindings, as inputs of the checker's revision
 * (foundation/structures/entries/): each answer is recorded in the entry computing now, so a later
 * revision takes an entry over whenever what it read still answers alike, however much else changed
 * (docs/work/done/m6-m7/incremental-checking.md §1, §4).
 *
 * - A module is read in parts (its items, the modules its imports name, a function's body, the
 *   nodes holding a node, its tree), never whole, so an entry depends only on the parts it used.
 * - Every Bindings answer is an input too. Entities compare by identity, which holds across
 *   revisions for every node a revision's tree kept (binder/entities.ts); lists and maps compare
 *   item by item.
 * - A bare variant is read as the one its expected type chooses, not as every variant so named, and
 *   one no enum is expected of as those its module can qualify it through, so an enum added
 *   elsewhere changes only the entries whose choice it changes.
 * - Which module declares each declaration is a Bindings answer too (`itemModuleOf`,
 *   `declarationModuleOf`): binding stamps every declaration of a tree with its module, items' parts
 *   and local ones, a function the fields of an item read as among them, and keeps what the tree
 *   declared with its bindings (binder/module/declared.ts), so nothing is indexed per Program.
 */

import type { LanguageModule } from '../../../../foundation/language/well-known/index.ts';
import type { Entries } from '../../../../foundation/structures/entries/index.ts';
import { sameEntries, sameItems } from '../../../../foundation/structures/equality.ts';
import type { Bindings, VariantEntity } from '../../../binder/entities.ts';
import type { ModuleId, Program } from '../../../program/program.ts';
import { isStdModule, programModule } from '../../../program/program.ts';
import type { EnumDeclaration, FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import { ancestorsOf, bodyOf, type SyntaxNode } from '../../../syntax/tree/index.ts';
import type { CheckerNote, ProgramInputs } from '../../contexts/context.ts';

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
    modules: entries.input({
      name: 'modules',
      read: () => [...program.modules.keys()].sort((first, second) => first.localeCompare(second)),
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
    bodyOf: entries.input({
      name: 'body of',
      read: (module: ModuleId, declaration: FunctionDeclaration) =>
        bodyOf(programModule(program, module).tree, declaration),
    }),
    holdersOf: entries.input({
      name: 'holders of',
      read: (module: ModuleId, node: SyntaxNode) => {
        const path = ancestorsOf(programModule(program, module).tree, node);
        return path.at(-1)?.kind === 'Module' ? path.slice(0, -1) : [];
      },
      equal: sameItems(),
    }),
    variantNamed: entries.input({
      name: 'variant named',
      read: (name: string, enums: readonly EnumDeclaration[]): VariantEntity | undefined =>
        bindings
          .candidatesOf({ kind: 'variants', name })
          .find((candidate) => enums.includes(candidate.enum)),
    }),
    variantsQualifiableIn: entries.input({
      name: 'variants qualifiable in',
      read: (module: ModuleId, name: string): readonly VariantEntity[] =>
        bindings.candidatesOf({ kind: 'variants', name }).filter((candidate) => {
          const named = bindings.topLevelNamed(module, candidate.enum.name.text);
          return named?.kind === 'type' && named.declaration === candidate.enum;
        }),
      equal: sameItems(),
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
    itemModuleOf: entries.input({ name: 'item module of', read: bindings.itemModuleOf }),
    declarationModuleOf: entries.input({
      name: 'declaration module of',
      read: bindings.declarationModuleOf,
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
    topLevelNames: entries.input({
      name: 'top-level names',
      read: bindings.topLevelNames,
      equal: sameList,
    }),
    transientsOf: entries.input({
      name: 'transients of',
      read: bindings.transientsOf,
      equal: sameList,
    }),
    aliasOf: entries.input({ name: 'alias of', read: bindings.aliasOf }),
    diagnosticsOf: entries.input({
      name: 'binder diagnostics of',
      read: bindings.diagnosticsOf,
      equal: sameList,
    }),
  };
}

/** Whether a module is std, each answer recorded in `entries`. */
export function isStdInput(entries: Entries<CheckerNote>, program: Program) {
  return entries.input({
    name: 'is std',
    read: (module: ModuleId | undefined) => isStdModule(program, module),
  });
}
