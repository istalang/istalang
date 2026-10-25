/**
 * `await` (§5): the operand's future, then an `await` that waits on it. The runtime commits there,
 * or hands control back to an async caller that started this function in its own segment.
 */

import type { Register } from '../../../definition/operands.ts';
import type { Await } from '../../syntax/expressions.ts';
import type { FunctionContext } from '../context.ts';

export function lowerAwait(context: FunctionContext, node: Await): Register {
  const future = context.expression(node.operand);
  const dst = context.code.allocate();
  context.code.await(dst, future, node.span);
  return dst;
}
