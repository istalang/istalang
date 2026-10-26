/**
 * `a ?? b` (§4): a `switch` on `a`. `Some` gives the value inside, or `a` itself when the result is
 * optional, which it is exactly when its type is `a`'s (`b` was a `T?`); `None` evaluates `b`, and
 * only then.
 */

import type { Register } from '../../../definition/operands.ts';
import { optionalVariants } from '../../../language/well-known.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import { sameType } from '../../checker/types/type.ts';
import type { Binary } from '../../syntax/expressions.ts';
import type { FunctionContext } from '../context.ts';
import { branchOnVariant, isEnum, payloadOf, variantTestOf } from './variants.ts';

export function lowerNullish(context: FunctionContext, node: Binary): Register {
  const { code, body } = context;
  const left = context.expression(node.left);
  const leftType = body.typeOf(node.left);
  if (!isEnum(leftType)) {
    unreachable(`'??' needs an optional at ${node.span.start}; the checker should have said so.`);
  }
  const result = code.allocate();
  const some = code.newLabel();
  const none = code.newLabel();
  const end = code.newLabel();
  const isSome = variantTestOf(context.checker, left, leftType, optionalVariants.some);
  branchOnVariant(context, isSome, { matched: some, otherwise: none }, node.span);
  code.place(some);
  const keeps = sameType(body.typeOf(node), leftType);
  const value = keeps ? left : payloadOf(context, left, node.left.span);
  code.emit({ kind: 'move', span: node.left.span, dst: result, src: value });
  code.jump(end, node.span);
  code.place(none);
  const fallback = context.expression(node.right);
  code.emit({ kind: 'move', span: node.right.span, dst: result, src: fallback });
  code.place(end);
  return result;
}
