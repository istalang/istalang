/**
 * `*x` (§3.9): the value in the cell the handle `x` names, read by the instruction for it, since
 * `*` is built in.
 */

import type { Register } from '../../../definition/operands.ts';
import type { Dereference } from '../../syntax/expressions.ts';
import type { FunctionContext } from '../context.ts';

export function lowerDereference(context: FunctionContext, node: Dereference): Register {
  const cell = context.expression(node.operand);
  const dst = context.code.allocate();
  context.code.emit({ kind: 'readCell', span: node.span, dst, cell });
  return dst;
}
