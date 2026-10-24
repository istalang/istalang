/**
 * Binding one module on its own: every name its tree can resolve, and what it leaves for linking.
 *
 * This is the one module that knows every syntax category, so it wires them into the context
 * (local-binder.ts) and the categories never import one another for recursion.
 *
 * The result depends on the tree alone, so it is memoized on the tree. A Program snapshot that
 * reuses an unchanged tree reuses its bindings and its entities with it, and every result derived
 * from those entities, without anything being invalidated.
 */

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
  let bindings = bound.get(tree);
  if (bindings === undefined) {
    const binder = new LocalBinder(walk);
    const { scope, ...moduleScope } = defineModuleScope(binder, tree.root, universe());
    for (const item of tree.root.items) {
      if (item.kind !== 'Invalid') {
        bindDeclaration(binder, item, scope);
      }
    }
    bindings = { ...moduleScope, ...binder.result() };
    bound.set(tree, bindings);
  }
  return bindings;
}
