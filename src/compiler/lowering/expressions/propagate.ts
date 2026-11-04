/**
 * `e?` on a `Result` (§3.12): `Ok` gives its value; `Err` returns from the function a new `Err` of
 * the function's own `Result` type, holding the same error, since the two `Result` types differ in
 * their `Ok` type.
 */

import type { Register } from '../../../definition/operands.ts';
import { resultVariants } from '../../../language/well-known.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { Propagate } from '../../syntax/expressions/index.ts';
import type { FunctionContext } from '../context.ts';
import { buildVariant, isEnum, payloadOf, payloadOr } from './variants.ts';

export function lowerPropagate(context: FunctionContext, node: Propagate): Register {
  const operand = context.expression(node.operand);
  const operandType = context.typeOf(node.operand);
  const returned = context.result;
  if (!(isEnum(operandType) && isEnum(returned))) {
    unreachable(`'?' needs two Results at ${node.span.from}; the checker should have said so.`);
  }
  const tested = { register: operand, type: operandType, name: resultVariants.ok };
  return payloadOr(
    context,
    tested,
    () => {
      const error = payloadOf(context, operand, node.span);
      const passed = { type: returned, name: resultVariants.err };
      const value = buildVariant(context, passed, [error], node.span);
      context.code.emit({ kind: 'return', span: node.span, value });
    },
    node.span,
  );
}
