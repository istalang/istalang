/**
 * Calling a function value (§3.14): a variable, a field or any expression of a function type.
 * Its type says everything: there is one function to call, so nothing is chosen, but its
 * arguments are judged, reported and fitted as a chosen function's are (overloads/), as one
 * signature with no type parameters, so every argument rule has one home.
 *
 * - Calling an async function value starts it and yields its future, `Future<R>` for an
 *   `async fn(…) -> R`, as calling a declared async function does (§3.3).
 * - Type arguments can't be given: a function value is one instance, never generic.
 */

import type { Call, Expression } from '../../syntax/expressions.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { takenBy } from '../overloads/choice.ts';
import { explain, fitArguments, type WrittenArgument } from '../overloads/resolve.ts';
import { futureOf } from '../rules/futures.ts';
import { errorType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';

/** A call as written: where it stands, with its arguments and any type arguments. */
export interface ValueCall {
  readonly node: Call;
  readonly typeArguments: readonly Type[] | undefined;
  readonly written: readonly WrittenArgument[];
}

/** A call of `callee`, whose type, if already checked, is `calleeType`. */
export function checkValueCall(
  context: BodyContext,
  call: ValueCall,
  callee: Expression,
  calleeType: Type = context.expression(callee),
): Type {
  if (calleeType.kind === 'error') {
    return errorType;
  }
  if (calleeType.kind !== 'function') {
    context.report(checkerDiagnostics.notFunction(callee.span, typeText(calleeType)));
    return errorType;
  }
  const { node, written, typeArguments } = call;
  if (written.some(({ type }) => type?.kind === 'error')) {
    return errorType;
  }
  const { parameters } = calleeType;
  const takes = {
    typeParameters: [],
    parameters: parameters.map((slot) => ({ ...slot, hasDefault: false })),
  };
  const taken = takenBy(context.checker, takes, written, typeArguments);
  if (!('inference' in taken)) {
    const name = callee.kind === 'Identifier' ? callee.text : typeText(calleeType);
    explain(context, { site: node, name, arguments: written, typeArguments }, taken);
    return errorType;
  }
  fitArguments(
    context,
    written,
    parameters.map(({ type }) => type),
  );
  const { result } = calleeType;
  return calleeType.isAsync ? futureOf(context.checker, result) : result;
}
