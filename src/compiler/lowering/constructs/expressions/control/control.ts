/**
 * Branching expressions (§4): every branch writes its value into one result register, so the `if`
 * is an expression; an `if` without `else` is unit.
 *
 * Each branch is a scope entered through its condition (constructs/statements/scopes.ts): the `is`
 * bindings of its condition live through its body and end with it, and the condition's temporaries
 * end before the body, or on the way to the next branch (§3.4, §3.11, §7).
 *
 * A condition its operands' types decide (§4): always false, it still runs for what it does, and
 * its branch isn't written; always true, its branch is the last written, the ones after it and the
 * `else` never reached.
 */

import type { Register } from '../../../../../definition/operands.ts';
import type { ConditionalBranch, If } from '../../../../syntax/expressions/index.ts';
import type { FunctionContext } from '../../../context.ts';
import type { Label } from '../../../functions/code-writer.ts';
import { lowerGuarded } from '../../statements/scopes.ts';

export function lowerIf(context: FunctionContext, node: If): Register {
  const { code } = context;
  const result = code.allocate();
  const end = code.newLabel();
  // Past a condition always true, no branch is reached.
  let reached = true;
  for (const branch of node.branches) {
    if (reached) {
      const decided = context.body.decidedOf(branch.condition);
      if (decided === false) {
        context.expression(branch.condition);
      } else {
        lowerBranch(context, branch, { result, end });
      }
      reached = decided !== true;
    }
  }
  const elseBody = node.elseClause?.body;
  const fallback =
    elseBody === undefined || context.body.isRuledOut(elseBody)
      ? context.constant(null, node.span)
      : context.block(elseBody);
  code.emit({
    kind: 'move',
    span: elseBody?.span ?? node.span,
    dst: result,
    src: fallback,
  });
  code.place(end);
  return result;
}

/** Writes `branch`: its condition's test, then its body's value into `result`, then on to `end`. */
function lowerBranch(
  context: FunctionContext,
  branch: ConditionalBranch,
  { result, end }: { readonly result: Register; readonly end: Label },
): void {
  const { code } = context;
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
