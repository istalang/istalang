/**
 * Deferred calls, `g f(args)` (§3.14): `g` is given a function making the call `f(args)` later,
 * with everything written in it computed now.
 *
 * - That function is the lambda the deferred call reads as (syntax/expressions/deferred-functions.ts),
 *   checked as any lambda argument is, against the parameter it fills, so its mark, sendability and
 *   captures are a lambda's. What its call computes now, it captures (closures/made-later.ts).
 * - The taker is called as any callee is (calls.ts), the function given after the arguments its
 *   parentheses write, filling the parameter binding gives it (resolution/choosing/binding.ts). A
 *   taker that is a value but no function is likely an item before a missing comma, `[a b(c)]`, so
 *   that is reported, and what follows it is checked as a value of its own.
 * - What follows the taker must be a call; anything else gives no function.
 */

import { argumentValue } from '../../../syntax/expressions/arguments.ts';
import type { DeferredCall } from '../../../syntax/expressions/calls.ts';
import { deferredLambdaOf } from '../../../syntax/expressions/deferred-functions.ts';
import {
  calledName,
  qualifiedPath,
  writtenArgumentsOf,
} from '../../../syntax/expressions/readings.ts';
import { spanBetween } from '../../../syntax/tree/positions.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import type { WrittenArgument } from '../../resolution/calls/resolve/index.ts';
import type { Type } from '../../types/type/index.ts';
import { errorType, isPrimitive } from '../../types/type/primitives.ts';
import { calledValue, checkCallMade } from './calls.ts';

export function checkDeferredCall(
  context: BodyContext,
  node: DeferredCall,
  expected: Type | undefined,
): Type {
  const value = calledValue(context, node);
  if (value?.type !== undefined && !mayBeCalled(value.type)) {
    return missingComma(context, node);
  }
  return checkCallMade(context, {
    node,
    expected,
    value,
    given: () => deferredFunction(context, node),
  });
}

/** Whether a value of `type` may be called, or has no type to say it can't. */
function mayBeCalled(type: Type): boolean {
  return type.kind === 'function' || type.kind === 'error' || isPrimitive(type, 'Never');
}

/**
 * `node` read as two items with no `,` between: what its taker's parentheses hold and what follows
 * it are checked as values of their own, and the missing comma is reported.
 */
function missingComma(context: BodyContext, node: DeferredCall): Type {
  for (const argument of writtenArgumentsOf(node)) {
    context.expression(argumentValue(argument));
  }
  context.expression(node.call);
  const taker = qualifiedPath(calledName(node))?.map(({ text }) => text) ?? [];
  context.report(
    checkerDiagnostics.missingComma(spanBetween(node.taker.span, node.call.span), taker.join('.')),
  );
  return errorType;
}

/**
 * The function `node` gives its taker, as an argument after those its parentheses write: the
 * lambda it reads as; of the error type after a report where what follows the taker is no call.
 */
function deferredFunction(context: BodyContext, node: DeferredCall): WrittenArgument {
  const lambda = deferredLambdaOf(node);
  if (lambda === undefined) {
    context.expression(node.call);
    context.report(checkerDiagnostics.deferredNeedsCall(node.call.span));
    return { node: node.call, passing: 'value', type: errorType, isDeferred: true };
  }
  return { node: lambda, passing: 'value', type: context.expression(lambda), isDeferred: true };
}
