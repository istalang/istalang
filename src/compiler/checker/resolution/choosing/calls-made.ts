/**
 * What a chosen, instantiated function becomes as a call (check.ts `ResolvedCall`), the one place
 * every call is made, whether written in a body or found as a witness of a constraint (§3.10). The
 * rules every call obeys live here, so no path that makes calls can skip them.
 *
 * Refusing to call `dispose` (§7) is a rule about calls written in code
 * (resolution/calls/resolve/index.ts): a witness of `Disposable` is `dispose` itself, and is only
 * ever called by such a call.
 */

import type { FunctionCall, ResolvedCall } from '../../surface/resolved-call.ts';
import type { Application } from './choice.ts';

/** The call the application's candidate, instantiated, makes, binding its arguments as chosen. */
export function callMade(
  application: Pick<Application, 'candidate' | 'binding'>,
  instantiation: Pick<FunctionCall, 'typeArguments' | 'witnesses'>,
): ResolvedCall {
  const { declaration, requirement } = application.candidate;
  if (requirement !== undefined) {
    return {
      kind: 'requirement',
      function: declaration,
      requirement: requirement.origin,
      substitution: requirement.substitution,
      typeArguments: instantiation.typeArguments,
      witnesses: instantiation.witnesses,
      binding: application.binding,
    };
  }
  return {
    kind: 'function',
    function: declaration,
    typeArguments: instantiation.typeArguments,
    witnesses: instantiation.witnesses,
    binding: application.binding,
  };
}
