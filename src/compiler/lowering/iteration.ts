/**
 * The loop every iterating construct runs (§3.10, §4; docs/arch/definition.md, "How each
 * construct lowers"): a `for`, a comprehension, and a spread into a map literal of a declared type.
 * Each calls `iterate` on what it runs over, which gives an array, then reads the array's length
 * once and each element by index, counting an int register up from 0. The calls are the ones the
 * checker made for the construct (checker rules/iteration.ts), so there is one loop for all.
 */

import type { Register } from '../../definition/operands.ts';
import type { Iteration } from '../checker/check.ts';
import type { Comprehension, Expression } from '../syntax/expressions.ts';
import type { For } from '../syntax/statements.ts';
import type { FunctionContext } from './context.ts';
import { implicitCall } from './expressions/calls.ts';
import type { LoopTargets } from './statements/loops.ts';
import { bindTargets } from './statements/variables.ts';

/** The array `node` runs over: `iterate` called on `iterable`'s value. */
export function iteratedArray(
  context: FunctionContext,
  node: Iteration,
  iterable: Expression,
): Register {
  return implicitCall(context, node, 'iterate', [context.expression(iterable)]);
}

/**
 * Runs `body` for each element of `array`, which `node` runs over: `body` receives the element's
 * register and where `continue` (the next element) and `break` (past the loop) go.
 */
export function emitLoop(
  context: FunctionContext,
  node: Iteration,
  array: Register,
  body: (item: Register, targets: LoopTargets) => void,
): void {
  const { code } = context;
  const { span } = node;
  const length = implicitCall(context, node, 'length', [array]);
  const index = code.allocate();
  code.emit({ kind: 'move', span, dst: index, src: context.constant(0n, span) });
  const one = context.constant(1n, span);
  const test = code.newLabel();
  const element = code.newLabel();
  const next = code.newLabel();
  const exit = code.newLabel();
  code.place(test);
  const comparison = implicitCall(context, node, 'compare', [index, length]);
  const isLess = code.allocate();
  code.emit({ kind: 'order', span, dst: isLess, comparison, relation: 'less' });
  code.branch(isLess, element, exit, span);
  code.place(element);
  const { depth } = context.variables;
  body(implicitCall(context, node, 'element', [array, index]), { exit, next, depth });
  code.place(next);
  const counted = implicitCall(context, node, 'add', [index, one]);
  code.emit({ kind: 'move', span, dst: index, src: counted });
  code.jump(test, span);
  code.place(exit);
}

/**
 * Runs `body` for each item a `for` or a comprehension runs over, its targets bound to the item;
 * `body` receives where `continue` and `break` go.
 */
export function emitLoopOver(
  context: FunctionContext,
  node: For | Comprehension,
  body: (targets: LoopTargets) => void,
): void {
  emitLoop(context, node, iteratedArray(context, node, node.iterable), (item, targets) => {
    bindTargets(context, node, item, node.span);
    body(targets);
  });
}
