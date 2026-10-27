/**
 * Array comprehensions (§4): the loop every iterating construct runs (iteration.ts), appending the
 * body's value for each item the condition keeps (collections.ts).
 */

import type { Register } from '../../../definition/operands.ts';
import type { Comprehension } from '../../syntax/expressions/index.ts';
import type { FunctionContext } from '../context.ts';
import { emitLoopOver } from '../iteration.ts';
import { appendElement } from './collections.ts';

export function lowerComprehension(context: FunctionContext, node: Comprehension): Register {
  const { code } = context;
  const { span } = node;
  const result = code.allocate();
  code.emit({ kind: 'array', span, dst: result, elements: [] });
  emitLoopOver(context, node, ({ next }) => {
    if (node.condition !== undefined) {
      const kept = code.newLabel();
      code.branch(context.expression(node.condition), kept, next, node.condition.span);
      code.place(kept);
    }
    appendElement(context, span, result, context.expression(node.body));
  });
  return result;
}
