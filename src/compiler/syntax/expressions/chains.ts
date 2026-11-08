/**
 * Optional chains as the syntax shows them (§4): which expressions are links, the step each takes,
 * and whether one reads through an optional. Whether a link really is one is the checker's to say
 * (a call through a namespace has a link's shape and never is), so this module only reads shapes.
 */

import type { Call, Expression } from './index.ts';
import { calledName } from './readings.ts';

/**
 * The forms of a link of an optional chain (§4), each with its operator taking the step on the
 * value inside an optional: `.` (a field, a tuple element or a method), `->` (the value behind a
 * handle), `[` (an element) and `(` (a call of the function, a link only through an optional).
 */
const optionalOperators = { '.': '?.', '->': '?->', '[': '?.[', '(': '?.(' } as const;

/** A form of link, as `optionalOperators` lists them. */
export type LinkForm = keyof typeof optionalOperators;

/** An operator taking a link's step on the value inside an optional. */
export type OptionalOperator = (typeof optionalOperators)[LinkForm];

/** The operator a link of an optional chain takes its step with (§4). */
export type ChainOperator = Exclude<LinkForm, '('> | OptionalOperator;

/** The operator taking a step of `form` on the value inside an optional: `?.[` for `[`. */
export function optionalOperatorOf(form: LinkForm): OptionalOperator {
  return optionalOperators[form];
}

/** The operator a link of `form` is written with, `?`-prefixed when it `isOptional`. */
export function linkOperator(form: Exclude<LinkForm, '('>, isOptional: boolean): ChainOperator {
  return isOptional ? optionalOperatorOf(form) : form;
}

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
      return { target: node.target, operator: linkOperator('.', node.isOptional) };
    case 'Index':
      return { target: node.target, operator: linkOperator('[', node.isOptional) };
    case 'Call':
      return callStepOf(node);
    case 'Dereference':
      return node.operator === '*'
        ? undefined
        : { target: node.operand, operator: linkOperator('->', node.isOptional) };
    default:
      return undefined;
  }
}

/** A call's step: through the optional function it calls, or a method's to its receiver. */
function callStepOf(node: Call): ChainStep | undefined {
  if (node.isOptional) {
    return { target: node.callee, operator: optionalOperatorOf('(') };
  }
  const callee = calledName(node);
  return callee.kind === 'MemberAccess'
    ? { target: callee.target, operator: linkOperator('.', callee.isOptional) }
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
