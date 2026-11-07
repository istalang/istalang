/**
 * A function named as a value, checked (§3.14): the one the name means where its value is wanted,
 * chosen as resolution/choosing/named-functions.ts chooses it, then instantiated against what is
 * expected of it, made a closure with no captures and recorded as a site at the expression naming
 * it (check.ts). A name none of whose functions is chosen is reported. A function's type as a
 * value has the `T` an `await` yields as an async function's result.
 */

import type { BodyContext } from '../../contexts/body-context.ts';
import { useSite } from '../../contexts/use-site.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { recordChosen } from '../../resolution/calls/resolve.ts';
import {
  chosenFor,
  loneFunction,
  type NamedFunctions,
} from '../../resolution/choosing/named-functions.ts';
import { instantiate } from '../../resolution/conformance/conformance.ts';
import { expectedFunction } from '../../types/fitting/expected.ts';
import { substitute } from '../../types/parts/substitution.ts';
import { withPack } from '../../types/type/function-types.ts';
import type { Type } from '../../types/type/index.ts';
import { errorType, expectsError } from '../../types/type/primitives.ts';
import { futureArgument, futureOf } from '../../types/type/well-known.ts';

/** The type of the function `named` names as a value; the error type after a report. */
export function checkFunctionValue(
  context: BodyContext,
  named: NamedFunctions,
  expected: Type | undefined,
): Type {
  const { site, name } = named;
  const candidates = named.candidates(expected);
  const shape = expectedFunction(expected);
  const application =
    shape === undefined ? loneFunction(context, candidates) : chosenFor(context, candidates, shape);
  if (application === undefined) {
    if (!expectsError(expected)) {
      context.report(checkerDiagnostics.functionValueUnchosen(site.span, name));
    }
    return errorType;
  }
  const { checker } = context;
  const { signature, binding } = application;
  const expectedResult =
    shape === undefined || !signature.declaration.isAsync
      ? shape?.result
      : futureOf(checker, shape.result);
  const instantiation = instantiate(
    useSite(checker, context.module, site.span),
    application,
    expectedResult,
  );
  if (instantiation === undefined) {
    return errorType;
  }
  recordChosen(context, { site, application, instantiation });
  const { substitution } = instantiation;
  const result = substitute(signature.result(), substitution, checker.typeRules);
  const pack = signature.parameters.find((slot) => slot.rest?.kind === 'pack');
  return withPack(
    {
      kind: 'function',
      isSendable: true,
      isAsync: signature.declaration.isAsync,
      parameters: signature.parameters
        .filter((slot, index) => slot !== pack && binding[index]?.kind === 'argument')
        .map((slot) => ({
          type: substitute(slot.type, substitution, checker.typeRules),
          reference: slot.reference,
        })),
      result: signature.declaration.isAsync
        ? (futureArgument(checker, result) ?? errorType)
        : result,
    },
    pack === undefined ? undefined : substitute(pack.type, substitution, checker.typeRules),
  );
}
