/**
 * Array comprehensions (§4): the loop every iterating construct runs (iteration.ts), appending the
 * body's value for each item the condition keeps. Appending builds the next array from the last
 * with `array`, as values are immutable anyway.
 */

import type { Register } from '../../../definition/operands.ts';
import type { Comprehension } from '../../syntax/expressions.ts';
import type { FunctionContext } from '../context.ts';
import { emitLoopOver } from '../iteration.ts';

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
    const value = context.expression(node.body);
    code.emit({
      kind: 'array',
      span,
      dst: result,
      elements: [
        { kind: 'spread', value: result },
        { kind: 'item', value },
      ],
    });
  });
  return result;
}
