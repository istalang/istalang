/**
 * Operators (§3.9; docs/arch/definition.md, "How each construct lowers"), by their meaning in
 * syntax/operators.ts.
 *
 * - An operator that calls a function calls the one the checker resolved; an ordering calls
 *   `compare` and turns its int into the relation with `order`.
 * - `==` and `!=` are the built-in `equal`, `not` its own instruction.
 * - `and` and `or` short-circuit through `branch`, so their right side runs only when needed;
 *   `??` through a `switch` (nullish.ts).
 */

import type { Register } from '../../../definition/operands.ts';
import type { Span } from '../../../text/span.ts';
import type { Binary, Unary } from '../../syntax/expressions/index.ts';
import { binaryOperators, type Relation, unaryOperators } from '../../syntax/operators.ts';
import type { FunctionContext } from '../context.ts';
import { call } from './calls.ts';
import { lowerNullish } from './nullish.ts';

export function lowerBinary(context: FunctionContext, node: Binary): Register {
  const { meaning } = binaryOperators[node.operator];
  switch (meaning.kind) {
    case 'logic':
      return shortCircuit(context, node, meaning.rightWhen);
    case 'coalesce':
      return lowerNullish(context, node);
    case 'equality': {
      const dst = context.code.allocate();
      const [left, right] = operands(context, node);
      context.code.emit({ kind: 'equal', span: node.span, dst, left, right });
      return meaning.negated ? negated(context, dst, node.span) : dst;
    }
    case 'order':
      return ordered(
        context,
        node.span,
        call(context, node, operands(context, node)),
        meaning.relation,
      );
    case 'call':
      return call(context, node, operands(context, node));
    default: {
      const unhandled: never = meaning;
      return unhandled;
    }
  }
}

/**
 * Whether `compare`'s int, in `comparison`, is in `relation`: what an ordering gives, whether an
 * operator or a pattern's field test (§3.11) compared.
 */
export function ordered(
  context: FunctionContext,
  span: Span,
  comparison: Register,
  relation: Relation,
): Register {
  const dst = context.code.allocate();
  context.code.emit({ kind: 'order', span, dst, comparison, relation });
  return dst;
}

export function lowerUnary(context: FunctionContext, node: Unary): Register {
  const operand = context.expression(node.operand);
  return unaryOperators[node.operator].meaning.kind === 'negation'
    ? negated(context, operand, node.span)
    : call(context, node, [operand]);
}

function operands(context: FunctionContext, node: Binary): [Register, Register] {
  return [context.expression(node.left), context.expression(node.right)];
}

function negated(context: FunctionContext, src: Register, span: Span): Register {
  const dst = context.code.allocate();
  context.code.emit({ kind: 'not', span, dst, src });
  return dst;
}

/** `a and b` is `b` when `a` is true, else `a`; `a or b` is `a` when `a` is true, else `b`. */
function shortCircuit(context: FunctionContext, node: Binary, rightWhen: boolean): Register {
  const result = context.code.allocate();
  context.code.emit({
    kind: 'move',
    span: node.left.span,
    dst: result,
    src: context.expression(node.left),
  });
  const right = context.code.newLabel();
  const end = context.code.newLabel();
  if (rightWhen) {
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
