/**
 * A call the toolchain makes on its own to a function it knows by name, its type arguments given
 * rather than inferred from arguments: a json-module helper a codec calls (rules/json-forms/), or
 * the defaults a struct literal leaves fields to (expressions/literal-fields.ts). It is chosen, instantiated and
 * made as a written call is (choice.ts, conformance.ts, calls-made.ts), each argument left for the
 * chosen function to decide, and its constraints' witnesses found as anywhere (§3.10).
 */

import type { CheckerContext } from '../context.ts';
import type { FunctionCall } from '../resolved-call.ts';
import type { Type } from '../types/type.ts';
import { searchSite } from '../use-site.ts';
import { callMade } from './calls-made.ts';
import type { Candidate } from './candidates.ts';
import { type Application, choose } from './choice.ts';
import { instantiate } from './conformance.ts';

/**
 * The call to one of `candidates` with `typeArguments`; undefined when none takes them or a
 * constraint isn't met.
 */
export function callWithTypes(
  checker: CheckerContext,
  candidates: readonly Candidate[],
  typeArguments: readonly Type[],
): FunctionCall | undefined {
  const written = typeArguments.length === 0 ? undefined : typeArguments;
  const byArity = new Map<number, Candidate[]>();
  for (const candidate of candidates) {
    const arity = checker.parametersOf(candidate.declaration).length;
    const group = byArity.get(arity) ?? [];
    group.push(candidate);
    byArity.set(arity, group);
  }
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
  if (applications.length !== 1 || only === undefined) {
    return undefined;
  }
  const instantiation = instantiate(searchSite(checker), only, undefined);
  const call = instantiation === undefined ? undefined : callMade(only, instantiation);
  return call?.kind === 'function' ? call : undefined;
}
