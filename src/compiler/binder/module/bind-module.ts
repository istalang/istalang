/**
 * Binding one module on its own: every name its tree can resolve, and what it leaves for linking.
 *
 * This is the one module that knows every syntax category, so it wires them into the context
 * (local-binder.ts) and the categories never import one another for recursion.
 *
 * The result depends on the tree alone, so it is memoized on the tree. A Program snapshot that
 * reuses an unchanged tree reuses its bindings with it. An edited module is bound again whole, but
 * an entity is made once per node it stands for (../entities.ts), so every segment the edit left
 * alike keeps its entities, and every result derived from them, without anything being invalidated.
 *
 * A tree is bound as its own module only, as a program reuses a tree only under its module: every
 * entity binding makes is stamped with that module, and what the tree declared is kept with its
 * bindings (declared.ts), so neither is indexed again per program.
 */

import { memo } from '../../../foundation/structures/memo.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { ModuleId } from '../../program/program.ts';
import type { SyntaxTree } from '../../syntax/tree/index.ts';
import { bindDeclaration, bindFunction } from '../constructs/declarations.ts';
import { bindExpression } from '../constructs/expressions.ts';
import { bindPattern } from '../constructs/patterns.ts';
import { bindBlock } from '../constructs/statements.ts';
import { bindType } from '../constructs/types.ts';
import { type Declared, declaredBy } from './declared.ts';
import { LocalBinder, type LocalResult, type Walk } from './local-binder.ts';
import { defineModuleScope, type ModuleScope } from './module-scope.ts';
import { universe } from './scope.ts';

const walk: Walk = {
  expression: bindExpression,
  block: bindBlock,
  pattern: bindPattern,
  type: bindType,
  function: bindFunction,
};

/**
 * A module bound on its own: its top level, what each name the tree resolved denotes (named
 * imports still as placeholders), the names it left free, its qualified names, and what it
 * declared, as the module it was bound as.
 */
export interface ModuleBindings extends Omit<ModuleScope, 'scope'>, LocalResult {
  readonly module: ModuleId;
  readonly declared: Declared;
}

const bound = new WeakMap<SyntaxTree, ModuleBindings>();

export function bindModule(tree: SyntaxTree, module: ModuleId): ModuleBindings {
  const bindings = memo(bound, tree, () => {
    const binder = new LocalBinder(walk, tree, module);
    const { scope, ...moduleScope } = defineModuleScope(binder, tree.root, universe());
    const topLevel = scope.snapshot();
    binder.eachItem(tree.root.items, scope, (item) => bindDeclaration(binder, item, scope));
    const result = { ...moduleScope, ...binder.result(topLevel) };
    return { ...result, module, declared: declaredBy(tree, module, result) };
  });
  return bindings.module === module
    ? bindings
    : unreachable(`A tree bound as ${bindings.module} was asked for as ${module}.`);
}
