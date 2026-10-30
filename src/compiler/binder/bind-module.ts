/**
 * Binding one module on its own: every name its tree can resolve, and what it leaves for linking.
 *
 * This is the one module that knows every syntax category, so it wires them into the context
 * (local-binder.ts) and the categories never import one another for recursion.
 *
 * The result depends on the tree alone, so it is memoized on the tree. A Program snapshot that
 * reuses an unchanged tree reuses its bindings with it. An edited module is bound again whole, but
 * an entity is made once per node it stands for (entities.ts), so every segment the edit left alike
 * keeps its entities, and every result derived from them, without anything being invalidated.
 */

import { memo } from '../../structures/memo.ts';
import type { SyntaxTree } from '../syntax/tree.ts';
import { bindDeclaration, bindFunction } from './declarations.ts';
import { bindExpression } from './expressions.ts';
import { LocalBinder, type LocalResult, type Walk } from './local-binder.ts';
import { defineModuleScope, type ModuleScope } from './module-scope.ts';
import { bindPattern } from './patterns.ts';
import { universe } from './scope.ts';
import { bindBlock } from './statements.ts';
import { bindType } from './types.ts';

const walk: Walk = {
  expression: bindExpression,
  block: bindBlock,
  pattern: bindPattern,
  type: bindType,
  function: bindFunction,
};

/**
 * A module bound on its own: its top level, what each name the tree resolved denotes (named
 * imports still as placeholders), the names it left free, and its qualified names.
 */
export interface ModuleBindings extends Omit<ModuleScope, 'scope'>, LocalResult {}

const bound = new WeakMap<SyntaxTree, ModuleBindings>();

export function bindModule(tree: SyntaxTree): ModuleBindings {
  return memo(bound, tree, () => {
    const binder = new LocalBinder(walk, tree);
    const { scope, ...moduleScope } = defineModuleScope(binder, tree.root, universe());
    const topLevel = scope.snapshot();
    for (const item of tree.root.items) {
      if (item.kind === 'Invalid') {
        binder.annotations(item, scope);
      } else {
        bindDeclaration(binder, item, scope);
      }
    }
    return { ...moduleScope, ...binder.result(topLevel) };
  });
}
