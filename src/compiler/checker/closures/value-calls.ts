/**
 * Calling a function value (§3.14): a variable, a field or any expression of a function type.
 * Its type says everything: there is one function to call, so nothing is chosen, but its
 * arguments are judged, reported and fitted as a chosen function's are (calls/resolve.ts), as one
 * signature with no type parameters, so every argument rule has one home.
 *
 * - Calling an async function value starts it and yields its future, `Future<R>` for an
 *   `async fn(…) -> R`, as calling a declared async function does (§3.3).
 * - Type arguments can't be given: a function value is one instance, never generic.
 * - Its type names no parameters, so its call gives every argument by position, with no name;
 *   a spread only fills a pack its type ends in (§3.3, §3.5).
 */

import type { Call, Expression } from '../../syntax/expressions/index.ts';
import { checkReferencedPlaces } from '../calls/places.ts';
import { callArgumentOf, explain, fitArguments, type WrittenArgument } from '../calls/resolve.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { takenBy } from '../resolution/applicability.ts';
import { bindArguments, packRestSlot } from '../resolution/binding.ts';
import { insideOptional } from '../types/inside-optional.ts';
import { errorType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { futureOf } from '../types/well-known.ts';

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
    context.report(
      insideOptional(context.checker, callee.span, calleeType, '?.(') ??
        checkerDiagnostics.notFunction(callee.span, typeText(calleeType)),
    );
    return errorType;
  }
  const { node, written, typeArguments } = call;
  if (written.some(({ type }) => type?.kind === 'error')) {
    return errorType;
  }
  const unpositional = written.find(
    ({ name, isSpread }) =>
      name !== undefined || (isSpread === true && calleeType.pack === undefined),
  );
  if (unpositional !== undefined) {
    const form = unpositional.isSpread === true ? 'spread' : 'named argument';
    context.report(checkerDiagnostics.valueCallArgument(unpositional.node.span, form));
    return errorType;
  }
  const { parameters, pack } = calleeType;
  const unnamed = { name: undefined, hasDefault: false };
  const fixed = parameters.map((slot) => ({ ...slot, ...unnamed, rest: undefined }));
  const packed =
    pack === undefined ? [] : [{ type: pack, reference: false, ...unnamed, rest: packRestSlot }];
  const takes = { typeParameters: [], parameters: [...fixed, ...packed] };
  const callArguments = written.map(callArgumentOf);
  const binder = bindArguments;
  const taken = takenBy(context.checker, takes, { callArguments, written: typeArguments, binder });
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
  checkReferencedPlaces(context, written, {
    name: callee.kind === 'Identifier' ? callee.text : typeText(calleeType),
    isAsync: calleeType.isAsync,
    slots: parameters,
  });
  const { result } = calleeType;
  return calleeType.isAsync ? futureOf(context.checker, result) : result;
}
