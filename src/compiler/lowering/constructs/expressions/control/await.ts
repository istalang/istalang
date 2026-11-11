/**
 * `await` (§5): the operand, a wait on it (calls/waits.ts), then an `await` of that wait. The
 * runtime commits there, or hands control back to an async caller that started this function in
 * its own segment. The operand stays in its register until the wait ends, so what it is awaited for
 * lives as long as it is.
 */

import type { Register } from '../../../../../definition/operands.ts';
import type { Await } from '../../../../syntax/expressions/index.ts';
import type { NodeOf } from '../../../../syntax/tree/node.ts';
import { emitImplicitCall } from '../../../calls/emit-call.ts';
import { awaitWait, openWait, type WaitCase } from '../../../calls/waits.ts';
import type { FunctionContext } from '../../../context.ts';

export function lowerAwait(context: FunctionContext, node: Await): Register {
  const operand = context.expression(node.operand);
  const wait = openWait(context, [awaitedAt(context, node, operand)], node.span);
  return awaitWait(context, wait, node.span);
}

/** The case waiting on `operand` through the `onAwait` call the checker recorded at `node`. */
export function awaitedAt(
  context: FunctionContext,
  node: NodeOf<string>,
  operand: Register,
): WaitCase {
  return (done) => {
    emitImplicitCall(context, node, 'onAwait', [operand, done]);
  };
}
