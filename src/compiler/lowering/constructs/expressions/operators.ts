/**
 * Operators (§3.9; docs/arch/definition.md, "How each construct lowers"), by their meaning in
 * syntax/expressions/operators.ts.
 *
 * - An operator that calls a function calls the one the checker resolved; an ordering calls
 *   `compare` and turns its int into the relation with `order`. `item in c` calls
 *   `includes(c, item)`, its operands evaluated as written.
 * - A chain compares each operand with the next, evaluating each once, in order, and stops at the
 *   first comparison that fails, as `and` would.
 * - `==` and `!=` are the built-in `equal`, `not` its own instruction. One whose sides' types fix
 *   its value (§4) is that value, its sides still run.
 * - `and` and `or` short-circuit through `branch`, so their right side runs only when needed;
 *   `??` through a `switch` (access/optionals.ts).
 */

import type { Register } from '../../../../definition/operands.ts';
import {
  type ComparisonLink,
  comparisonLinkOf,
  comparisonLinksOf,
  linkSpan,
} from '../../../syntax/expressions/comparisons.ts';
import type {
  Binary,
  ChainedComparison,
  Expression,
  Unary,
} from '../../../syntax/expressions/index.ts';
import {
  binaryOperators,
  type Relation,
  unaryOperators,
} from '../../../syntax/expressions/operators.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import { emitCallAt, emitFunctionCall } from '../../calls/emit-call.ts';
import type { CodeContext, FunctionContext } from '../../context.ts';
import { lowerNullish } from './access/optionals.ts';

export function lowerBinary(context: FunctionContext, node: Binary): Register {
  const link = comparisonLinkOf(node);
  const decided = context.body.decidedOf(node);
  if (link !== undefined && decided !== undefined) {
    // Its sides' types fix its value (§4): they run for what they do, and nothing compares them.
    operands(context, node);
    return context.constant(decided, node.span);
  }
  if (link !== undefined) {
    return compared(context, link, operands(context, node));
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

export function lowerChainedComparison(
  context: FunctionContext,
  node: ChainedComparison,
): Register {
  const { code } = context;
  const evaluated = new Map<Expression, Register>();
  const operand = (expression: Expression): Register => {
    const register = evaluated.get(expression) ?? context.expression(expression);
    evaluated.set(expression, register);
    return register;
  };
  const result = code.allocate();
  const end = code.newLabel();
  for (const [index, link] of comparisonLinksOf(node).entries()) {
    if (index > 0) {
      const next = code.newLabel();
      code.branch(result, next, end, node.span);
      code.place(next);
    }
    const holds = compared(context, link, [operand(link.left), operand(link.right)]);
    code.emit({ kind: 'move', span: node.span, dst: result, src: holds });
  }
  code.place(end);
  return result;
}

/**
 * Whether a link holds: the built-in `==`, or the `compare` or `includes` the checker made at its
 * right operand.
 */
function compared(
  context: FunctionContext,
  link: ComparisonLink,
  [left, right]: readonly [Register, Register],
): Register {
  const { meaning } = binaryOperators[link.operator];
  const span = linkSpan(link);
  if (meaning.kind === 'equality') {
    return equal(context, span, [left, right], meaning.negated);
  }
  const call = (role: 'includes' | 'compare', argumentList: readonly Register[]) =>
    emitFunctionCall(context, {
      span,
      call: context.implicitCallAt(link.right, role),
      arguments: argumentList,
    });
  if (meaning.kind === 'membership') {
    const includes = call('includes', [right, left]);
    return meaning.negated ? negated(context, includes, span) : includes;
  }
  return ordered(context, span, call('compare', [left, right]), meaning.relation);
}

/** Whether `left` and `right` are `==`, or `!=` when `isNegated`. */
export function equal(
  context: CodeContext,
  span: AnchoredSpan,
  [left, right]: readonly [Register, Register],
  isNegated = false,
): Register {
  const dst = context.code.equal(left, right, span);
  return isNegated ? negated(context, dst, span) : dst;
}

/**
 * Whether `compare`'s int, in `comparison`, is in `relation`: what an ordering gives, whether an
 * operator or a pattern's field test (§3.11) compared.
 */
export function ordered(
  context: FunctionContext,
  span: AnchoredSpan,
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
    : emitCallAt(context, node, [operand]);
}

function operands(context: FunctionContext, node: Binary): [Register, Register] {
  return [context.expression(node.left), context.expression(node.right)];
}

function negated(context: CodeContext, src: Register, span: AnchoredSpan): Register {
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
