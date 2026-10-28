/**
 * `e?` on a `Result` (§3.12): a `switch` on the result. `Ok` gives its value; `Err` returns from
 * the function a new `Err` of the function's own `Result` type, holding the same error, since the
 * two `Result` types differ in their `Ok` type.
 */

import type { Register } from '../../../definition/operands.ts';
import { resultVariants } from '../../../language/well-known.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { Propagate } from '../../syntax/expressions/index.ts';
import type { FunctionContext } from '../context.ts';
import { branchOnVariant, buildVariant, isEnum, payloadOf, variantTestOf } from './variants.ts';

export function lowerPropagate(context: FunctionContext, node: Propagate): Register {
  const { code } = context;
  const operand = context.expression(node.operand);
  const operandType = context.body.typeOf(node.operand);
  const returned = context.result;
  if (!(isEnum(operandType) && isEnum(returned))) {
    unreachable(`'?' needs two Results at ${node.span.start}; the checker should have said so.`);
  }
  const ok = code.newLabel();
  const err = code.newLabel();
  const isOk = variantTestOf(context.checker, operand, operandType, resultVariants.ok);
  branchOnVariant(context, isOk, { matched: ok, otherwise: err }, node.span);
  code.place(err);
  const error = payloadOf(context, operand, node.span);
  const passed = { type: returned, name: resultVariants.err };
  const value = buildVariant(context, passed, [error], node.span);
  code.emit({ kind: 'return', span: node.span, value });
  code.place(ok);
  return payloadOf(context, operand, node.span);
}
