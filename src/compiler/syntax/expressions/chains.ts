/**
 * Optional chains as the syntax shows them (§4): which expressions are links, the step each takes,
 * and whether one reads through an optional. Whether a link really is one is the checker's to say
 * (a call through a namespace has a link's shape and never is), so this module only reads shapes.
 */

import type { Call, Expression } from './index.ts';

/**
 * The operator a link of an optional chain takes its step with (§4): `.` (a field, a tuple
 * element or a method), `->` or `[` on its target's value, or `?.`, `?->`, `?.[` and `?.(` (a call
 * of the function) on the value inside an optional.
 */
export type ChainOperator = '.' | '->' | '[' | '?.' | '?->' | '?.[' | '?.(';

/** The step a link of an optional chain takes (§4): what it works on, and with which operator. */
export interface ChainStep {
  readonly target: Expression;
  readonly operator: ChainOperator;
}

/** Whether `step` reads through an optional, so meeting `none` ends its whole chain (§4). */
export function isOptionalStep(step: ChainStep): boolean {
  return step.operator.startsWith('?');
}

/**
 * The step `node` takes when it may be a link of an optional chain: a field read, a tuple
 * element, an index, a method call, a call of an optional function (`f?.()`, whose step works on
 * the function), or the value behind a handle read with `->`; undefined for any other
 * expression, `*x` among them, which ends a chain as parentheses do. Whether it is a link is the
 * checker's to say: a call through a namespace has the same shape and never is.
 */
export function chainStepOf(node: Expression): ChainStep | undefined {
  switch (node.kind) {
    case 'MemberAccess':
    case 'TupleElement':
      return { target: node.target, operator: node.isOptional ? '?.' : '.' };
    case 'Index':
      return { target: node.target, operator: node.isOptional ? '?.[' : '[' };
    case 'Call':
      return callStepOf(node);
    case 'Dereference':
      return node.operator === '*' ? undefined : { target: node.operand, operator: node.operator };
    default:
      return undefined;
  }
}

/** A call's step: through the optional function it calls, or a method's to its receiver. */
function callStepOf(node: Call): ChainStep | undefined {
  if (node.isOptional) {
    return { target: node.callee, operator: '?.(' };
  }
  return node.callee.kind === 'MemberAccess'
    ? { target: node.callee.target, operator: node.callee.isOptional ? '?.' : '.' }
    : undefined;
}

/** Whether `node` is a link of an optional chain at a `?.` or `?->`, or after one (§4). */
export function isOptionallyChained(node: Expression): boolean {
  for (let step = chainStepOf(node); step !== undefined; step = chainStepOf(step.target)) {
    if (isOptionalStep(step)) {
      return true;
    }
  }
  return false;
}
