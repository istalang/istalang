/**
 * `a ?? b` (§4): the value inside `a`, or `a` itself when the result is optional, which it is
 * exactly when its type is `a`'s (`b` was a `T?`); `none` evaluates `b`, and only then.
 */

import type { Register } from '../../../definition/operands.ts';
import type { Binary } from '../../syntax/expressions/index.ts';
import type { FunctionContext } from '../context.ts';
import { presentOr } from '../optionals.ts';

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
