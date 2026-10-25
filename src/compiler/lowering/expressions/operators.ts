/**
 * Operators (§3.9; docs/arch/definition.md, "How each construct lowers").
 *
 * - An overloadable operator calls the function the checker resolved; the four comparisons call
 *   `compare` and turn its int into the relation with `order`.
 * - `==` and `!=` are the built-in `equal`, `not` its own instruction.
 * - `and` and `or` short-circuit through `branch`, so their right side runs only when needed;
 *   `??` through a `switch` (nullish.ts).
 */

import type { Register } from '../../../definition/operands.ts';
import type { Span } from '../../../text/span.ts';
import type { Binary, Unary } from '../../syntax/expressions.ts';
import type { FunctionContext } from '../context.ts';
import { call } from './calls.ts';
import { lowerNullish } from './nullish.ts';

/** The relation `order` turns `compare`'s int into, by comparison operator (§3.9). */
export const comparisonRelations = {
  '<': 'less',
  '<=': 'lessOrEqual',
  '>': 'greater',
  '>=': 'greaterOrEqual',
} as const;

export function lowerBinary(context: FunctionContext, node: Binary): Register {
  const { operator } = node;
  if (operator === 'and' || operator === 'or') {
    return shortCircuit(context, node, operator);
  }
  if (operator === '??') {
    return lowerNullish(context, node);
  }
  const left = context.expression(node.left);
  const right = context.expression(node.right);
  switch (operator) {
    case '==':
    case '!=': {
      const dst = context.code.allocate();
      context.code.emit({ kind: 'equal', span: node.span, dst, left, right });
      return operator === '==' ? dst : negated(context, dst, node.span);
    }
    case '<':
    case '<=':
    case '>':
    case '>=': {
      const comparison = call(context, node, [left, right]);
      const dst = context.code.allocate();
      context.code.emit({
        kind: 'order',
        span: node.span,
        dst,
        comparison,
        relation: comparisonRelations[operator],
      });
      return dst;
    }
    default:
      return call(context, node, [left, right]);
  }
}

export function lowerUnary(context: FunctionContext, node: Unary): Register {
  const operand = context.expression(node.operand);
  return node.operator === 'not'
    ? negated(context, operand, node.span)
    : call(context, node, [operand]);
}

function negated(context: FunctionContext, src: Register, span: Span): Register {
  const dst = context.code.allocate();
  context.code.emit({ kind: 'not', span, dst, src });
  return dst;
}

/** `a and b` is `b` when `a` is true, else `a`; `a or b` is `a` when `a` is true, else `b`. */
function shortCircuit(context: FunctionContext, node: Binary, operator: 'and' | 'or'): Register {
  const result = context.code.allocate();
  context.code.emit({
    kind: 'move',
    span: node.left.span,
    dst: result,
    src: context.expression(node.left),
  });
  const right = context.code.newLabel();
  const end = context.code.newLabel();
  if (operator === 'and') {
    context.code.branch(result, right, end, node.span);
  } else {
    context.code.branch(result, end, right, node.span);
  }
  context.code.place(right);
  context.code.emit({
    kind: 'move',
    span: node.right.span,
    dst: result,
    src: context.expression(node.right),
  });
  context.code.place(end);
  return result;
}
