/**
 * Operators (§3.9; docs/arch/definition.md, "How each construct lowers"), by their meaning in
 * syntax/expressions/operators.ts.
 *
 * - An operator that calls a function calls the one the checker resolved; an ordering calls
 *   `compare` and turns its int into the relation with `order`. `item in c` calls
 *   `includes(c, item)`, its operands evaluated as written.
 * - `==` and `!=` are the built-in `equal`, `not` its own instruction. One whose sides' types fix
 *   its value (§4) is that value, its sides still run.
 * - `and` and `or` short-circuit through `branch`, so their right side runs only when needed;
 *   `??` through a `switch` (access/optionals.ts).
 */

import type { Register } from '../../../../definition/operands.ts';
import { type Comparison, isComparison } from '../../../syntax/expressions/comparisons.ts';
import type { Binary, Unary } from '../../../syntax/expressions/index.ts';
import { binaryOperators, unaryOperators } from '../../../syntax/expressions/operators.ts';
import { emitCallAt, emitFunctionCall } from '../../calls/emit-call.ts';
import type { FunctionContext } from '../../context.ts';
import { equal, negated, ordered } from '../../values/operators.ts';
import { lowerNullish } from './access/optionals.ts';

export function lowerBinary(context: FunctionContext, node: Binary): Register {
  const decided = context.body.decidedOf(node);
  if (isComparison(node) && decided !== undefined) {
    // Its sides' types fix its value (§4): they run for what they do, and nothing compares them.
    operands(context, node);
    return context.constant(decided, node.span);
  }
  if (isComparison(node)) {
    return compared(context, node, operands(context, node));
  }
  const { meaning } = binaryOperators[node.operator];
  if (meaning.kind === 'logic') {
    return shortCircuit(context, node, meaning.rightWhen);
  }
  if (meaning.kind === 'coalesce') {
    return lowerNullish(context, node);
  }
  return emitCallAt(context, node, operands(context, node));
}

/**
 * Whether a comparison holds: the built-in `==`, or the `compare` or `includes` the checker made at
 * its right operand.
 */
function compared(
  context: FunctionContext,
  node: Comparison,
  [left, right]: readonly [Register, Register],
): Register {
  const { meaning } = binaryOperators[node.operator];
  const { span } = node;
  if (meaning.kind === 'equality') {
    return equal(context, span, [left, right], meaning.negated);
  }
  const call = (role: 'includes' | 'compare', argumentList: readonly Register[]) =>
    emitFunctionCall(context, {
      span,
      call: context.implicitCallAt(node.right, role),
      arguments: argumentList,
    });
  if (meaning.kind === 'membership') {
    const includes = call('includes', [right, left]);
    return meaning.negated ? negated(context, includes, span) : includes;
  }
  return ordered(context, span, call('compare', [left, right]), meaning.relation);
}

export function lowerUnary(context: FunctionContext, node: Unary): Register {
  const operand = context.expression(node.operand);
  return unaryOperators[node.operator].meaning.kind === 'negation'
    ? negated(context, operand, node.span)
    : emitCallAt(context, node, [operand]);
}

function operands(context: FunctionContext, node: Binary): [Register, Register] {
  return [context.expression(node.left), context.expression(node.right)];
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
