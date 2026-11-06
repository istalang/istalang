/**
 * The operators reading inside an optional (§4), over optionals in lowered code
 * (../../../values/optionals.ts):
 *
 * - `a!`: the value inside `a`; `none` calls the prelude's `panic`, which never returns, so nothing
 *   runs after it.
 * - `a ?? b`: the value inside `a`, or `a` itself when the result is optional, which it is exactly
 *   when its type is `a`'s (`b` was a `T?`); `none` evaluates `b`, and only then.
 */

import type { Register } from '../../../../../definition/operands.ts';
import type { Binary, Unwrap } from '../../../../syntax/expressions/index.ts';
import { emitImplicitCall } from '../../../calls/emit-call.ts';
import type { FunctionContext } from '../../../context.ts';
import { presentOr } from '../../../values/optionals.ts';

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

export function lowerNullish(context: FunctionContext, node: Binary): Register {
  const { code } = context;
  const left = {
    register: context.expression(node.left),
    type: context.typeOf(node.left),
    to: context.typeOf(node),
  };
  const result = code.allocate();
  const end = code.newLabel();
  const value = presentOr(
    context,
    left,
    () => {
      const fallback = context.expression(node.right);
      code.emit({ kind: 'move', span: node.right.span, dst: result, src: fallback });
      code.jump(end, node.span);
    },
    node.span,
  );
  code.emit({ kind: 'move', span: node.left.span, dst: result, src: value });
  code.place(end);
  return result;
}
