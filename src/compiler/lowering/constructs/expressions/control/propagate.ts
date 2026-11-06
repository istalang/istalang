/**
 * `e?` on a `Result` (§3.12): `Ok` gives its value; `Err` returns from the function a new `Err` of
 * the function's own `Result` type, since the two `Result` types differ in their `Ok` type, holding
 * the same error, fitted to the function's error type as the checker fits it (§2): converted, then
 * put into its union where that is one. The types are the instance's, so a union an instantiation
 * collapsed is fitted as what it collapsed into.
 */

import type { Register } from '../../../../../definition/operands.ts';
import { resultVariants } from '../../../../../language/well-known/variants.ts';
import { unreachable } from '../../../../../structures/unreachable.ts';
import type { NominalType, Type } from '../../../../checker/types/type/index.ts';
import type { Propagate } from '../../../../syntax/expressions/index.ts';
import type { FunctionContext } from '../../../context.ts';
import { buildVariant, isEnum, payloadOf, payloadOr } from '../structs/variants.ts';

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
      const error = returnedError(context, {
        register: payloadOf(context, operand, node.span),
        type: errorOf(operandType),
        returned: errorOf(returned),
        site: node,
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

/** An error of `type` as the error `returned` of the function's `Result`, fitted at `site`. */
function returnedError(
  context: FunctionContext,
  error: {
    readonly register: Register;
    readonly type: Type;
    readonly returned: Type;
    readonly site: Propagate;
  },
): Register {
  const fit =
    context.checker.fitOf(error.type, error.returned) ??
    unreachable(
      `'?' at ${error.site.span.from} passes an error that doesn't fit; the checker should have said so.`,
    );
  return context.fitted(error.register, error.type, fit, error.site);
}
