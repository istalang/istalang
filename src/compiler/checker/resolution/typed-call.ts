/**
 * A call the toolchain makes on its own to a function it knows by name, its type arguments given
 * rather than inferred from arguments: a json-module helper a codec calls (rules/json-forms/), or
 * the `dispose` a host declares for its type (rules/disposal.ts). It is chosen, instantiated and
 * made as a written call is (choice.ts, conformance.ts, calls-made.ts), each argument left for the
 * chosen function to decide, and its constraints' witnesses found in `module`, as a call written
 * there would find them.
 */

import type { ModuleId } from '../../program/program.ts';
import type { FunctionCall } from '../check.ts';
import type { CheckerContext } from '../context.ts';
import type { Type } from '../types/type.ts';
import { silent, useSite } from '../use-site.ts';
import { callMade } from './calls-made.ts';
import type { Candidate } from './candidates.ts';
import { choose } from './choice.ts';
import { instantiate } from './conformance.ts';

/**
 * The call to one of `candidates` with `typeArguments`, as made in `module`; undefined when none
 * takes them or a constraint isn't met there.
 */
export function callWithTypes(
  checker: CheckerContext,
  candidates: readonly Candidate[],
  typeArguments: readonly Type[],
  module: ModuleId,
): FunctionCall | undefined {
  const [candidate] = candidates;
  if (candidate === undefined) {
    return undefined;
  }
  const arity = checker.parametersOf(candidate.declaration).length;
  const decided = Array.from({ length: arity }, () => ({
    type: undefined,
    passing: 'value' as const,
  }));
  const written = typeArguments.length === 0 ? undefined : typeArguments;
  const choice = choose(checker, candidates, decided, written);
  if (choice.kind !== 'chosen') {
    return undefined;
  }
  const site = silent(useSite(checker, module, candidate.declaration.name.span));
  const instantiation = instantiate(site, choice.application, undefined);
  const call =
    instantiation === undefined
      ? undefined
      : callMade(choice.application.candidate, instantiation, arity);
  return call?.kind === 'function' ? call : undefined;
}
