/**
 * `e?` on a `Result` (§3.12): `Ok` gives its value; `Err` returns from the function a new `Err` of
 * the function's own `Result` type, since the two `Result` types differ in their `Ok` type, holding
 * the same error, put into the function's error union where that is one.
 */

import type { Register } from '../../../definition/operands.ts';
import { resultVariants } from '../../../language/well-known.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { NominalType, Type } from '../../checker/types/type.ts';
import type { Propagate } from '../../syntax/expressions/index.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import type { FunctionContext } from '../context.ts';
import { intoUnion } from '../unions.ts';
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
      const error = intoReturnedError(context, {
        register: payloadOf(context, operand, node.span),
        type: errorOf(operandType),
        returned: errorOf(returned),
        span: node.span,
      });
      const passed = { type: returned, name: resultVariants.err };
      const value = buildVariant(context, passed, [error], node.span);
      context.code.emit({ kind: 'return', span: node.span, value });
    },
    node.span,
  );
}

/** The error type of the `Result` type `result`, its second type argument. */
function errorOf(result: NominalType): Type {
  return result.arguments[1] ?? unreachable('A Result has an error type.');
}

/** An error of `type` as the error of the function's `Result`: put into its union, if it is one. */
function intoReturnedError(
  context: FunctionContext,
  error: {
    readonly register: Register;
    readonly type: Type;
    readonly returned: Type;
    readonly span: AnchoredSpan;
  },
): Register {
  const into = context.checker.fitOf(error.type, error.returned)?.into;
  return into === undefined
    ? error.register
    : intoUnion(
        context,
        { register: error.register, type: into.member ?? error.type },
        into.union,
        error.span,
      );
}
