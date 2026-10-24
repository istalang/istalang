/**
 * Branching expressions (§4): every branch writes its value into one result register, so the `if`
 * is an expression; an `if` without `else` is unit.
 */

import type { Register } from '../../../definition/operands.ts';
import type { If } from '../../syntax/expressions.ts';
import type { FunctionContext } from '../context.ts';

export function lowerIf(context: FunctionContext, node: If): Register {
  const result = context.code.allocate();
  const end = context.code.newLabel();
  for (const branch of node.branches) {
    const body = context.code.newLabel();
    const next = context.code.newLabel();
    context.code.branch(context.expression(branch.condition), body, next, branch.condition.span);
    context.code.place(body);
    context.code.emit({
      kind: 'move',
      span: branch.body.span,
      dst: result,
      src: context.block(branch.body),
    });
    context.code.jump(end, branch.span);
    context.code.place(next);
  }
  const elseBody = node.elseClause?.body;
  const fallback =
    elseBody === undefined ? context.constant(null, node.span) : context.block(elseBody);
  context.code.emit({
    kind: 'move',
    span: elseBody?.span ?? node.span,
    dst: result,
    src: fallback,
  });
  context.code.place(end);
  return result;
}
