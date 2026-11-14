/**
 * The program's transients (§3.4) as static lifetimes sees them: each the global its cell is. An
 * execution keeps the transients visible where it started, so every async call's future holds
 * every one of them (analysis/given.ts), a constant over-approximation that needs no mapping
 * between callers and callees. Binding lists each module's, whatever body the function they lead
 * stands in, so finding them reads no tree and checks only the bodies declaring one, for its type.
 * One whose cell reaches no disposable can close no cycle the rule rejects, so it is left out.
 */

import type { ModuleId } from '../../../program/program.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { checkedBodyHolding } from '../../contexts/holding-body.ts';
import type { Type } from '../../types/type/index.ts';
import type { Input } from './input.ts';

/** The transients `module` declares whose cells `reachesDisposable` says may reach a disposable. */
export function transientsIn(
  checker: CheckerContext,
  module: ModuleId,
  reachesDisposable: (type: Type) => boolean,
): readonly Input[] {
  return checker.bindings.transientsOf(module).flatMap((entity): readonly Input[] => {
    const { name } = entity;
    const written = checkedBodyHolding(checker, module, name)?.declaredTypeOf(name);
    const type = written === undefined ? undefined : checker.cellOf(written);
    return type !== undefined && reachesDisposable(type) ? [{ kind: 'global', entity, type }] : [];
  });
}
