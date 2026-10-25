/**
 * Branching expressions (§4): every branch writes its value into one result register, so the `if`
 * is an expression; an `if` without `else` is unit.
 *
 * Each branch is a scope entered through its condition (statements/scopes.ts): the `is` bindings
 * of its condition live through its body and end with it, and the condition's temporaries end
 * before the body, or on the way to the next branch (§3.4, §3.11, §7).
 */

import type { Register } from '../../../definition/operands.ts';
import type { If } from '../../syntax/expressions.ts';
import type { FunctionContext } from '../context.ts';
import { lowerGuarded } from '../statements/scopes.ts';

export function lowerIf(context: FunctionContext, node: If): Register {
  const { code } = context;
  const result = code.allocate();
  const end = code.newLabel();
  for (const branch of node.branches) {
    lowerGuarded(context, {
      header: () => context.expression(branch.condition),
      body: () => {
        code.emit({
          kind: 'move',
          span: branch.body.span,
          dst: result,
          src: context.block(branch.body),
        });
      },
      leave: () => {
        code.jump(end, branch.span);
      },
      span: branch.condition.span,
    });
  }
  const elseBody = node.elseClause?.body;
  const fallback =
    elseBody === undefined ? context.constant(null, node.span) : context.block(elseBody);
  code.emit({
    kind: 'move',
    span: elseBody?.span ?? node.span,
    dst: result,
    src: fallback,
  });
  code.place(end);
  return result;
}
