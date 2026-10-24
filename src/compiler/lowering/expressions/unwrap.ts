/**
 * `x$` (§3.9): a call to the `unwrap` the checker resolved for it, like any other call.
 */

import type { Register } from '../../../definition/operands.ts';
import type { Unwrap } from '../../syntax/expressions.ts';
import type { FunctionContext } from '../context.ts';
import { call } from './calls.ts';

export function lowerUnwrap(context: FunctionContext, node: Unwrap): Register {
  return call(context, node, [context.expression(node.operand)]);
}
