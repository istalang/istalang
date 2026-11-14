/**
 * Why a closure doesn't fit where a sendable or inert function is taken (§3.14, §9): it captures a
 * value that sendability doesn't allow (types/traits/sendability.ts). Where a lambda doesn't fit the
 * expected function type only for its sendability, each capture of a type beyond the expected one
 * is reported where the function first uses it, rather than the two function types; the function a
 * deferred call gives uses its constants at the operands they hold
 * (checker/desugaring/deferred-calls.ts). A captured `let` of a sendable type is a cell, which only
 * the two types explain where a sendable function is taken.
 */

import type { Expression } from '../../../syntax/expressions/index.ts';
import { unparenthesized } from '../../../syntax/expressions/readings.ts';
import { tailExpressionOf } from '../../../syntax/statements/readings.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { isCapturableBy } from '../../types/traits/sendability.ts';
import { functionType, modifiersOf } from '../../types/type/function-types.ts';
import type { FunctionType, Type } from '../../types/type/index.ts';
import { typeText } from '../../types/type/type-text.ts';

/**
 * Reports each value the closure `node` captures beyond the sendability of `expected`, a sendable
 * or inert function; whether that explained why it doesn't fit there.
 */
export function explainedCaptures(context: BodyContext, node: Expression, expected: Type): boolean {
  const closure = closureIn(node);
  const sendability = expected.kind === 'function' ? modifiersOf(expected).send : undefined;
  if (closure?.kind !== 'Lambda' || expected.kind !== 'function' || sendability === undefined) {
    return false;
  }
  const checked = context.functions.checkedOf(closure);
  // Only where its captures are why: of the expected sendability, it would fit.
  if (checked === undefined || !fitsWithSendabilityOf(context, checked.type, expected)) {
    return false;
  }
  const beyond = checked.captures.filter(
    ({ type }) => type.kind !== 'error' && !isCapturableBy(context.checker, type, expected.send),
  );
  for (const { site, type } of beyond) {
    context.report(
      checkerDiagnostics.captureBeyondSendability(site.span, sendability, typeText(type)),
    );
  }
  return beyond.length > 0;
}

/**
 * Whether a function of type `found` would fit `expected` were it of its sendability, its
 * parameters and mark judged: what it gives is left out, since an overload not taken expects of it
 * what its type arguments, never inferred, make it.
 */
function fitsWithSendabilityOf(
  context: BodyContext,
  found: FunctionType,
  expected: FunctionType,
): boolean {
  const resent = functionType({ ...found, send: expected.send, result: expected.result });
  return context.checker.fitOf(resent, expected) !== undefined;
}

/** What `node` gives as written: itself, or a block's value (§4), the one a deferred call gives. */
function closureIn(node: Expression): Expression | undefined {
  const value = unparenthesized(node);
  if (value.kind !== 'BlockExpression') {
    return value;
  }
  const tail = tailExpressionOf(value.block);
  return tail === undefined ? undefined : closureIn(tail);
}
