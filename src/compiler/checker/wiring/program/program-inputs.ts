/**
 * What checking reads of its Program and its Bindings, as inputs of the checker's revision
 * (structures/entries/): each answer is recorded in the entry computing now, so a later revision
 * takes an entry over whenever what it read still answers alike, however much else changed
 * (docs/work/m6-m7/incremental-checking.md §1, §4).
 *
 * - A module is read in parts (its items, the modules its imports name, a function's body, its
 *   tree), never whole, so an entry depends only on the parts it used.
 * - Every Bindings answer is an input too. Entities compare by identity, which holds across
 *   revisions for every node a revision's tree kept (binder/entities.ts); lists and maps compare
 *   item by item.
 * - A bare variant is read as the one its expected type chooses, not as every variant so named, so
 *   an enum added elsewhere changes only the entries whose choice it changes.
 * - Which module declares each declaration is an input too (`DeclaringModules`): an item, a trait's
 *   member, a function the fields of an item read as (syntax/declarations/field-defaults.ts), which
 *   no tree holds, and the type parameters of each, whose constraints resolve there. What a tree
 *   declares is found once per tree, so a later Program reusing the tree reuses it; a Program's
 *   index joins its trees' the first time it is asked. A local declaration's module is the one
 *   whose tree holds it, found once on demand: only tools ask, since checking a body already knows
 *   its module.
 */

import type { LanguageModule } from '../../../../language/well-known/index.ts';
import type { Entries } from '../../../../structures/entries/index.ts';
import { sameEntries, sameItems } from '../../../../structures/equality.ts';
import { memo } from '../../../../structures/memo.ts';
import { unreachable } from '../../../../structures/unreachable.ts';
import type { Bindings, VariantEntity } from '../../../binder/entities.ts';
import type { ModuleId, Program } from '../../../program/program.ts';
import { isStdModule, programModule } from '../../../program/program.ts';
import { fieldsFunctionsOf } from '../../../syntax/declarations/field-defaults.ts';
import type { EnumDeclaration, FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import {
  type Declaration,
  type TypeParameter,
  typeParametersOf,
} from '../../../syntax/declarations/index.ts';
import type { NodeOf } from '../../../syntax/node.ts';
import type { VariableDeclaration } from '../../../syntax/statements/index.ts';
import { bodyOf, parentOf, type SyntaxTree } from '../../../syntax/tree.ts';
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
    aliasOf: entries.input({ name: 'alias of', read: bindings.aliasOf }),
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

const declaredByTree = new WeakMap<SyntaxTree, readonly NodeOf<string>[]>();

class DeclaringModules {
  readonly #program: Program;
  #items: ReadonlyMap<NodeOf<string>, ModuleId> | undefined;
  readonly #locals = new Map<NodeOf<string>, ModuleId>();

  constructor(program: Program) {
    this.#program = program;
  }

  /** The module whose item, or item's type parameter, `node` is; undefined for a local one. */
  readonly itemModuleOf = (node: NodeOf<string>): ModuleId | undefined => {
    this.#items ??= new Map(
      [...this.#program.modules].flatMap(([id, { tree }]) =>
        declaredBy(tree).map((each) => [each, id] as const),
      ),
    );
    return this.#items.get(node);
  };

  /**
   * The module declaring `declaration`, an item or a local declaration, or the type parameter of
   * either, a mapped struct type's among them (§3.1).
   */
  readonly moduleOf = (declaration: Declaration | VariableDeclaration | TypeParameter): ModuleId =>
    this.itemModuleOf(declaration) ??
    memo(this.#locals, declaration, () => this.#moduleHolding(declaration));

  #moduleHolding(node: Declaration | VariableDeclaration | TypeParameter): ModuleId {
    for (const [id, { tree }] of this.#program.modules) {
      if (parentOf(tree, node) !== undefined) {
        return id;
      }
    }
    return unreachable(`No module holds the ${node.kind} at ${node.span.from}.`);
  }
}

/** What `tree` declares at its top level, inside its items, and as their type parameters. */
function declaredBy(tree: SyntaxTree): readonly NodeOf<string>[] {
  return memo(declaredByTree, tree, () =>
    tree.root.items.flatMap((item) => (item.kind === 'Invalid' ? [] : declared(item))),
  );
}

/**
 * `item`, its type parameters, a trait's members with theirs, its associated types (§3.1), and the
 * functions it reads as.
 */
function declared(item: Declaration): readonly NodeOf<string>[] {
  const parameters = 'typeParameters' in item ? typeParametersOf(item.typeParameters) : [];
  const members =
    item.kind === 'TraitDeclaration'
      ? item.members.flatMap((member) => {
          if (member.kind === 'FunctionDeclaration') {
            return declared(member);
          }
          return member.kind === 'RequiredAssociatedType' ? [member] : [];
        })
      : [];
  const associated = 'associatedTypes' in item ? item.associatedTypes : [];
  return [item, ...parameters, ...members, ...associated, ...fieldsFunctionsOf(item)];
}
