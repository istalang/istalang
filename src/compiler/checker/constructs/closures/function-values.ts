/**
 * A function named as a value, checked (§3.14): the one the name means where its value is wanted,
 * chosen as resolution/choosing/named-functions.ts chooses it, then instantiated against what is
 * expected of it, made a closure with no captures and recorded as a site at the expression naming
 * it, type arguments and all, a variant's constructor (§3.11) as any function, which tools read the
 * variant it builds from.
 *
 * - Type arguments written after the name are a call's (§3.5): with one function, type arguments
 *   it can't take are reported as its call would report them.
 * - A name none of whose functions is chosen is reported: as needing a function type where none
 *   is expected, else as fitting none of the one expected; a lone function that doesn't fit is its
 *   own value, which the expected type reports as any value's.
 * - Type arguments after a name of anything but functions are reported, once the name is checked
 *   as it would be alone; a type's or a variant's without fields, which only a literal or a call
 *   gives type arguments (§3.1, §3.11), isn't checked alone, where type arguments would be asked
 *   of the type or enum.
 */

import type { TypeApplication } from '../../../syntax/expressions/index.ts';
import { qualifiedPath } from '../../../syntax/expressions/readings.ts';
import type { Accepts, BodyContext } from '../../contexts/body-context.ts';
import { useSite } from '../../contexts/use-site.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { explain, recordChosen } from '../../resolution/calls/resolve.ts';
import {
  chosenValue,
  type FunctionNaming,
  functionsAccepted,
  instantiatedValue,
  type NamedFunctions,
  namedFunctions,
  ownChoice,
} from '../../resolution/choosing/named-functions.ts';
import { expectedFunction } from '../../types/fitting/expected.ts';
import type { FunctionType, Type } from '../../types/type/index.ts';
import { errorType, expectsError } from '../../types/type/primitives.ts';
import { typeText } from '../../types/type/type-text.ts';

/** The type of the function `named` names as a value; the error type after a report. */
export function checkFunctionValue(
  context: BodyContext,
  named: NamedFunctions,
  expected: Type | undefined,
): Type {
  const { site } = named;
  const shape = expectedFunction(expected);
  const application = chosenValue(context, named, shape);
  if (application === undefined) {
    if (!expectsError(expected)) {
      reportUnchosen(context, named, shape);
    }
    return errorType;
  }
  const value = instantiatedValue(
    context,
    application,
    useSite(context.checker, context.module, site.span),
    shape?.result,
  );
  if (value === undefined) {
    return errorType;
  }
  recordChosen(context, { site, application, instantiation: value.instantiation });
  return value.type;
}

/**
 * The type of `node`, a name given type arguments, as a value: the function it names, instantiated
 * with them (§3.5); the error type after a report.
 */
export function checkAppliedFunction(
  context: BodyContext,
  node: TypeApplication,
  expected: Type | undefined,
): Type {
  const named = namedFunctions(context, node);
  if (named !== undefined && named.candidates(expected).length > 0) {
    return checkFunctionValue(context, named, expected);
  }
  const { target } = node;
  const entity = context.entityOf(target.kind === 'Identifier' ? target : target.member);
  const isNamedAlone = entity?.kind !== 'variant' && entity?.kind !== 'type';
  if (!isNamedAlone || context.expression(target, expected).kind !== 'error') {
    const name = (qualifiedPath(target) ?? []).map(({ text }) => text).join('.');
    context.report(checkerDiagnostics.typeArgumentsOnValue(target.span, name));
  }
  return errorType;
}

/**
 * Which types the functions `node` names can take as an argument when the call decides which
 * (`functionsAccepted`); undefined when it names none, or a function of one type of its own.
 */
export function namedFunctionsAccepted(
  context: BodyContext,
  node: FunctionNaming,
): Accepts | undefined {
  const functions = namedFunctions(context, node);
  return functions === undefined ? undefined : functionsAccepted(context, functions);
}

/**
 * Reports why `named` gives no value where `shape` is expected: the type arguments written for its
 * one function, which it can't take; else that it needs a function type, or fits none of `shape`.
 */
function reportUnchosen(
  context: BodyContext,
  named: NamedFunctions,
  shape: FunctionType | undefined,
): void {
  const { site, name, written } = named;
  const [only, ...others] = named.candidates(shape);
  const isOne = written !== undefined && only !== undefined && others.length === 0;
  const choice = isOne ? ownChoice(context, only, named) : undefined;
  const [reason] = choice?.kind === 'none' ? choice.reasons : [];
  if (reason !== undefined) {
    explain(context, { site, name, arguments: [], typeArguments: written }, reason);
    return;
  }
  context.report(
    shape === undefined
      ? checkerDiagnostics.functionValueUnchosen(site.span, name)
      : checkerDiagnostics.functionValueMisfit(site.span, name, typeText(shape)),
  );
}
