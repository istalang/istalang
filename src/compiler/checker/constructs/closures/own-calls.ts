/**
 * An async function's own call (§16): the function's name before a `.` denotes the handle of the
 * enclosing call of that function, a `_Call`, whose members are the prelude's like any type's, so
 * `worker.disposing()` is an ordinary method call on it.
 *
 * - Which name denotes a call, and where none does, is the binder's (`useBeforeMember`): it binds
 *   the name to a hidden variable of the function, so a function nested in it captures it like
 *   any variable (functions.ts), and a closure watches the call it was made in, wherever it runs.
 * - The function's entry declares the variable beside its parameters, and lowering fills it there
 *   (`currentCall`).
 */

import { wellKnown } from '../../../../foundation/language/well-known/index.ts';
import type { Expression } from '../../../syntax/expressions/index.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import type { NestedFunction } from '../../surface/checked-body.ts';

/**
 * Declares the variable the function being entered holds its own call in, when its name reads
 * that call; asked at the entry of each function, after its parameters.
 */
export function declareOwnCall(context: BodyContext): void {
  const owner = context.functions.current.function;
  const variable =
    owner === undefined ? undefined : context.checker.bindings.ownCallOf(context.module, owner);
  const handle = context.checker.wellKnownType(wellKnown.call);
  if (variable !== undefined && handle !== undefined) {
    context.variables.declare(variable.name, handle);
  }
}

/** The function whose own call `node` reads; undefined when it reads anything else. */
export function ownCallerOf(context: BodyContext, node: Expression): NestedFunction | undefined {
  const entity = node.kind === 'Identifier' ? context.entityOf(node) : undefined;
  return entity?.kind === 'variable' && entity.owner.kind === 'OwnCall'
    ? entity.owner.function
    : undefined;
}
