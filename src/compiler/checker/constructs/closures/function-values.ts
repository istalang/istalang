/**
 * A function named as a value, checked (§3.14): the one the name means where its value is wanted,
 * chosen as resolution/choosing/named-functions.ts chooses it, then instantiated against what is
 * expected of it, made a closure with no captures and recorded as a site at the expression naming
 * it (check.ts), a variant's constructor (§3.11) as any function, which tools read the variant it
 * builds from. A name none of whose functions is chosen is reported: as needing a function type where none is expected, else as fitting none
 * of the one expected; a lone function that doesn't fit is its own value, which the expected type
 * reports as any value's.
 */

import type { BodyContext } from '../../contexts/body-context.ts';
import { useSite } from '../../contexts/use-site.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { recordChosen } from '../../resolution/calls/resolve.ts';
import {
  chosenValue,
  instantiatedValue,
  type NamedFunctions,
} from '../../resolution/choosing/named-functions.ts';
import { expectedFunction } from '../../types/fitting/expected.ts';
import type { Type } from '../../types/type/index.ts';
import { errorType, expectsError } from '../../types/type/primitives.ts';
import { typeText } from '../../types/type/type-text.ts';

/** The type of the function `named` names as a value; the error type after a report. */
export function checkFunctionValue(
  context: BodyContext,
  named: NamedFunctions,
  expected: Type | undefined,
): Type {
  const { site, name } = named;
  const shape = expectedFunction(expected);
  const application = chosenValue(context, named, shape);
  if (application === undefined) {
    if (!expectsError(expected)) {
      context.report(
        shape === undefined
          ? checkerDiagnostics.functionValueUnchosen(site.span, name)
          : checkerDiagnostics.functionValueMisfit(site.span, name, typeText(shape)),
      );
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
