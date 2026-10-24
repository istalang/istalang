/**
 * What a chosen, instantiated function becomes as a call (check.ts `ResolvedCall`), the one place
 * every call is made, whether written in a body or found as a witness of a constraint (§3.10). The
 * rules every call obeys live here, so no path that makes calls can skip them: an extern the host
 * implements can't run until the host boundary does, so the checker's frontier stops it.
 *
 * Refusing to call `dispose` (§7) is a rule about calls written in code (overloads/resolve.ts): a
 * witness of `Disposable` is `dispose` itself, and is only ever called by such a call.
 */

import type { FunctionCall, ResolvedCall } from '../check.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { frontier } from '../frontier.ts';
import type { UseSite } from '../use-site.ts';
import type { Candidate } from './candidates.ts';

/**
 * The call `candidate`, instantiated, makes with `arity` arguments; undefined after reporting at
 * the use site why it can't be made.
 */
export function callMade(
  site: UseSite,
  candidate: Candidate,
  instantiation: Pick<FunctionCall, 'typeArguments' | 'witnesses'>,
  arity: number,
): ResolvedCall | undefined {
  const { checker, at } = site;
  const { declaration, requirement } = candidate;
  if (requirement !== undefined) {
    return {
      kind: 'requirement',
      function: declaration,
      requirement: requirement.origin,
      typeArguments: instantiation.typeArguments,
    };
  }
  const module = checker.program.modules.get(checker.moduleOf(declaration));
  if (declaration.isExtern && module?.isStd !== true) {
    site.report(checkerDiagnostics.notSupportedYet(at, frontier.hostExtern));
    return undefined;
  }
  return {
    kind: 'function',
    function: declaration,
    typeArguments: instantiation.typeArguments,
    witnesses: instantiation.witnesses,
    arity,
  };
}
