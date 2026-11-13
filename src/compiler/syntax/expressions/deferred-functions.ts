/**
 * The function a deferred call gives its taker (§3.14), decided once for every phase that reads one:
 * the lambda `fn(): f(args)` making its call later. What that call computes now (its callee's value
 * or its receiver, then its arguments, as written) is computed where the deferred call stands and
 * captured, so the function's mark, sendability and captures are a lambda's
 * (checker/constructs/closures/).
 *
 * The tree keeps the deferred call as written, for tools and the formatter; the checker and the
 * later phases read the lambda derived here. It is one node per deferred call, memoized, so whatever
 * one phase records of it the next finds, and it knows the deferred call it stands for.
 */

import { memo } from '../../../foundation/structures/memo.ts';
import { unqualified } from '../tokens/modifiers.ts';
import type { CallingNode, DeferredCall } from './calls.ts';
import type { Lambda } from './index.ts';
import { deferredOf } from './readings.ts';

const lambdas = new WeakMap<DeferredCall, Lambda>();
const deferring = new WeakMap<Lambda, DeferredCall>();

/**
 * The function `node` gives its taker, a lambda taking nothing whose body is its call; undefined
 * where what follows the taker is no call, which the checker refuses.
 */
export function deferredLambdaOf(node: DeferredCall): Lambda | undefined {
  const call = deferredOf(node);
  if (call === undefined) {
    return undefined;
  }
  return memo(lambdas, node, () => {
    const lambda: Lambda = {
      kind: 'Lambda',
      span: call.span,
      qualifiers: unqualified,
      name: undefined,
      parameters: [],
      returnType: undefined,
      body: call,
    };
    deferring.set(lambda, node);
    return lambda;
  });
}

/**
 * Whether the function `node` gives makes its call later, each phase saying by `isMade` which calls
 * checking made: its call, and each call it defers in turn, was made; one that stops before it is
 * made, its callee or receiver having no value (§2), gives no function, and what it computes runs
 * where the deferred call stands.
 */
export function makesItsCall(node: DeferredCall, isMade: (call: CallingNode) => boolean): boolean {
  const call = deferredOf(node);
  return call !== undefined && isMade(call) && (call.kind === 'Call' || makesItsCall(call, isMade));
}

/** The deferred call `lambda` is the function of; undefined for a lambda written as one. */
export function deferredCallOf(lambda: Lambda): DeferredCall | undefined {
  return deferring.get(lambda);
}
