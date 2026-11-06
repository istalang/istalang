/**
 * Calls the toolchain makes on its own to plain functions it knows (§3.9, §3.10), with no written
 * call to report at: a type's `dispose` (rules/disposal/disposal.ts), a json-module helper a codec calls
 * (rules/boundary/json-forms.ts), or the defaults a struct literal leaves fields to
 * (expressions/literal-fields.ts). Each is chosen, instantiated and made as a written call is
 * (choice.ts, conformance.ts, calls-made.ts), its constraints' witnesses found as anywhere, but
 * nothing is reported: failing gives undefined, and each caller says what that means.
 *
 * - The candidates are plain functions, never a type parameter's requirement, so the call made is
 *   always a function call.
 * - A call given its type arguments leaves every argument for the chosen function to decide, so
 *   candidates are chosen per arity, each with as many arguments as it takes.
 */

import { unreachable } from '../../../structures/unreachable.ts';
import type { CheckerContext } from '../context.ts';
import type { FunctionCall } from '../resolved-call.ts';
import type { Type } from '../types/type.ts';
import { searchSite } from '../use-site.ts';
import type { CallArgument } from './call-arguments.ts';
import { callMade } from './calls-made.ts';
import type { Candidate } from './candidates.ts';
import { type Application, choose } from './choice.ts';
import { instantiate } from './conformance.ts';

/**
 * The call to the one function of `candidates` taking `callArguments`; undefined when none or
 * several do, or a constraint isn't met.
 */
export function silentCall(
  checker: CheckerContext,
  candidates: readonly Candidate[],
  callArguments: readonly CallArgument[],
): FunctionCall | undefined {
  const choice = choose(checker, candidates, callArguments, undefined);
  return choice.kind === 'chosen' ? functionCallOf(checker, choice.application) : undefined;
}

/**
 * The call to one of `candidates` with `typeArguments`; undefined when none takes them, several
 * do, or a constraint isn't met.
 */
export function callWithTypes(
  checker: CheckerContext,
  candidates: readonly Candidate[],
  typeArguments: readonly Type[],
): FunctionCall | undefined {
  const written = typeArguments.length === 0 ? undefined : typeArguments;
  const byArity = Map.groupBy(
    candidates,
    (candidate) => checker.parametersOf(candidate.declaration).length,
  );
  const applications: Application[] = [];
  for (const [arity, group] of byArity) {
    const decided = Array.from({ length: arity }, () => ({
      type: undefined,
      passing: 'value' as const,
    }));
    const choice = choose(checker, group, decided, written);
    if (choice.kind === 'several') {
      return undefined;
    }
    if (choice.kind === 'chosen') {
      applications.push(choice.application);
    }
  }
  const [only] = applications;
  return applications.length === 1 && only !== undefined
    ? functionCallOf(checker, only)
    : undefined;
}

/** The call `application` makes, instantiated; undefined when a constraint isn't met. */
function functionCallOf(
  checker: CheckerContext,
  application: Application,
): FunctionCall | undefined {
  const instantiation = instantiate(searchSite(checker), application, undefined);
  if (instantiation === undefined) {
    return undefined;
  }
  const call = callMade(application, instantiation);
  return call.kind === 'function'
    ? call
    : unreachable(`The toolchain called '${call.function.name.text}', a requirement, on its own.`);
}
