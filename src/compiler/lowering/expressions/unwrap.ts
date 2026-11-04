/**
 * `a!` (§4): the value inside `a`; `none` calls the prelude's `panic`, which never returns, so
 * nothing runs after it.
 */

import type { Register } from '../../../definition/operands.ts';
import type { Unwrap } from '../../syntax/expressions/index.ts';
import type { FunctionContext } from '../context.ts';
import { emitImplicitCall } from '../emit-call.ts';
import { presentOr } from '../optionals.ts';

/** The panic's message; the trace gives where it happened (§3.12). */
const unwrappedNone = 'Force-unwrapped none.';

export function lowerUnwrap(context: FunctionContext, node: Unwrap): Register {
  const read = {
    register: context.expression(node.operand),
    type: context.typeOf(node.operand),
    to: context.typeOf(node),
  };
  return presentOr(
    context,
    read,
    () => emitImplicitCall(context, node, 'panic', [context.constant(unwrappedNone, node.span)]),
    node.span,
  );
}
