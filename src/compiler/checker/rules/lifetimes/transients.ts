/**
 * The program's transients (§3.4) as static lifetimes sees them: each the global its cell is. An
 * execution keeps the transients visible where it started, so every async call's future holds
 * every one of them (analysis/given.ts), a constant over-approximation that needs no mapping
 * between callers and callees. They are read off each module's function bodies, which a transient
 * leads; one whose cell reaches no disposable can close no cycle the rule rejects, so it is left
 * out.
 */

import type { ModuleId } from '../../../program/program.ts';
import { functionsOf } from '../../../syntax/declarations/field-defaults.ts';
import { targetNames } from '../../../syntax/patterns.ts';
import type { VariableDeclaration } from '../../../syntax/statements/index.ts';
import { nodesUnder, type SyntaxNode } from '../../../syntax/tree/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import type { Type } from '../../types/type/index.ts';
import type { Input } from './input.ts';

/**
 * The transients `module`'s functions declare, a lambda's and a local function's included, whose
 * cells `reachesDisposable` says may reach a disposable.
 */
export function transientsIn(
  checker: CheckerContext,
  module: ModuleId,
  reachesDisposable: (type: Type) => boolean,
): readonly Input[] {
  const tree = checker.inputs.treeOf(module);
  return functionsOf({ items: checker.inputs.itemsOf(module) }).flatMap((declaration) => {
    const block = checker.inputs.bodyOf(module, declaration);
    const declared = block === undefined ? [] : nodesUnder(tree, block).filter(isTransient);
    const body = declared.length === 0 ? undefined : checker.bodyOf(declaration);
    return declared.flatMap(({ targets }) =>
      targets.flatMap(targetNames).flatMap((name): readonly Input[] => {
        const entity = checker.bindings.entityOf(module, name);
        const written = body?.declaredTypeOf(name);
        const type = written === undefined ? undefined : checker.cellOf(written);
        return entity?.kind === 'variable' && type !== undefined && reachesDisposable(type)
          ? [{ kind: 'global', entity, type }]
          : [];
      }),
    );
  });
}

function isTransient(node: SyntaxNode): node is VariableDeclaration {
  return node.kind === 'VariableDeclaration' && node.isTransient;
}
