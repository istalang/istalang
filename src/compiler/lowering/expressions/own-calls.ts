/**
 * `worker.disposing()` (§7; docs/arch/definition.md): a call to the prelude's watch with the
 * handle of the call it watches, which a hidden variable of the watched function holds. Its entry
 * fills the variable (`currentCall`, function-lowering.ts), and a function nested in it captures
 * the variable like any other.
 */

import type { Register } from '../../../definition/operands.ts';
import type { VariableEntity } from '../../binder/entities.ts';
import type { Call } from '../../syntax/expressions.ts';
import type { FunctionContext } from '../context.ts';
import { emitCall } from '../emit-call.ts';

/** `worker.disposing()` at `node`, watching the call `call` holds. */
export function lowerOwnCall(context: FunctionContext, node: Call, call: VariableEntity): Register {
  return emitCall(context, {
    span: node.span,
    callee: context.calleeIndex(node),
    arguments: [context.variables.registerOf(call.name)],
  });
}
