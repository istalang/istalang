/**
 * `a!` (§4): a `switch` on `a`. `Some` gives the value inside; `None` calls the prelude's `panic`,
 * which never returns, so nothing runs after it.
 */

import type { Register } from '../../../definition/operands.ts';
import { optionalVariants } from '../../../language/well-known.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { Unwrap } from '../../syntax/expressions/index.ts';
import type { FunctionContext } from '../context.ts';
import { emitImplicitCall } from '../emit-call.ts';
import { branchOnVariant, isEnum, payloadOf, variantTestOf } from './variants.ts';

/** The panic's message; the trace gives where it happened (§3.12). */
const unwrappedNone = 'Force-unwrapped none.';

export function lowerUnwrap(context: FunctionContext, node: Unwrap): Register {
  const { code } = context;
  const optional = context.expression(node.operand);
  const type = context.body.typeOf(node.operand);
  if (!isEnum(type)) {
    unreachable(`'!' needs an optional at ${node.span.start}; the checker should have said so.`);
  }
  const some = code.newLabel();
  const none = code.newLabel();
  const isSome = variantTestOf(context.checker, optional, type, optionalVariants.some);
  branchOnVariant(context, isSome, { matched: some, otherwise: none }, node.span);
  code.place(none);
  emitImplicitCall(context, node, 'panic', [context.constant(unwrappedNone, node.span)]);
  code.place(some);
  return payloadOf(context, optional, node.span);
}
