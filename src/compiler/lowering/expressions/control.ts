/**
 * Branching expressions (§4): every branch writes its value into one result register, so the `if`
 * is an expression; an `if` without `else` is unit.
 */

import type { Register } from '../../../definition/operands.ts';
import type { If } from '../../syntax/expressions.ts';
import type { FunctionContext } from '../context.ts';

export function lowerIf(context: FunctionContext, node: If): Register {
  const result = context.allocate();
  const end = context.newLabel();
  for (const branch of node.branches) {
    const body = context.newLabel();
    const next = context.newLabel();
    context.branch(context.expression(branch.condition), body, next, branch.condition.span);
    context.place(body);
    context.emit({
      kind: 'move',
      span: branch.body.span,
      dst: result,
      src: context.block(branch.body),
    });
    context.jump(end, branch.span);
    context.place(next);
  }
  const elseBody = node.elseClause?.body;
  const fallback =
    elseBody === undefined ? context.constant(null, node.span) : context.block(elseBody);
  context.emit({ kind: 'move', span: elseBody?.span ?? node.span, dst: result, src: fallback });
  context.place(end);
  return result;
}
