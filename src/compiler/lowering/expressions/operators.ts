/**
 * Operators (§3.9; docs/arch/definition.md, "How each construct lowers").
 *
 * - An overloadable operator calls the function the checker resolved; the four comparisons call
 *   `compare` and turn its int into the relation with `order`.
 * - `==` and `!=` are the built-in `equal`, `not` its own instruction.
 * - `and` and `or` short-circuit through `branch`, so their right side runs only when needed.
 */

import type { Register } from '../../../definition/operands.ts';
import type { Span } from '../../../text/span.ts';
import type { Binary, Unary } from '../../syntax/expressions.ts';
import type { FunctionContext } from '../context.ts';
import { call } from './calls.ts';

const relations = {
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
  const left = context.expression(node.left);
  const right = context.expression(node.right);
  switch (operator) {
    case '==':
    case '!=': {
      const dst = context.allocate();
      context.emit({ kind: 'equal', span: node.span, dst, left, right });
      return operator === '==' ? dst : negated(context, dst, node.span);
    }
    case '<':
    case '<=':
    case '>':
    case '>=': {
      const comparison = call(context, node, [left, right]);
      const dst = context.allocate();
      context.emit({
        kind: 'order',
        span: node.span,
        dst,
        comparison,
        relation: relations[operator],
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
  const dst = context.allocate();
  context.emit({ kind: 'not', span, dst, src });
  return dst;
}

/** `a and b` is `b` when `a` is true, else `a`; `a or b` is `a` when `a` is true, else `b`. */
function shortCircuit(context: FunctionContext, node: Binary, operator: 'and' | 'or'): Register {
  const result = context.allocate();
  context.emit({
    kind: 'move',
    span: node.left.span,
    dst: result,
    src: context.expression(node.left),
  });
  const right = context.newLabel();
  const end = context.newLabel();
  if (operator === 'and') {
    context.branch(result, right, end, node.span);
  } else {
    context.branch(result, end, right, node.span);
  }
  context.place(right);
  context.emit({
    kind: 'move',
    span: node.right.span,
    dst: result,
    src: context.expression(node.right),
  });
  context.place(end);
  return result;
}
