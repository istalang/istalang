/**
 * Choosing a call no written call stands for (§3.9, §3.10): one function among candidates, for the
 * arguments' types, instantiated, with nothing reported, since there is no call written to point
 * at. Each caller says what failing means: a call the language makes for a construct reports the
 * construct (implicit.ts), while finding a type's `dispose` or the type `x$` reads simply finds
 * nothing.
 */

import { substitute, type Type } from '../types/type.ts';
import { silent, type UseSite } from '../use-site.ts';
import type { Candidate } from './candidates.ts';
import { type Application, type CallArgument, choose } from './choice.ts';
import { type Instantiation, instantiate } from './conformance.ts';

/** A call chosen and instantiated: the candidate it applies, how, and the type it gives. */
export interface SilentChoice {
  readonly application: Application;
  readonly instantiation: Instantiation;
  readonly result: Type;
}

/**
 * The one function of `candidates` taking `callArguments`, instantiated at `site` for `expected`;
 * undefined when none or several do, or its instantiation fails.
 */
export function chooseSilently(
  site: UseSite,
  candidates: readonly Candidate[],
  callArguments: readonly CallArgument[],
  expected?: Type,
): SilentChoice | undefined {
  const choice = choose(site.checker, candidates, callArguments, undefined);
  if (choice.kind !== 'chosen') {
    return undefined;
  }
  const { application } = choice;
  const instantiation = instantiate(silent(site), application, expected);
  return instantiation === undefined
    ? undefined
    : {
        application,
        instantiation,
        result: substitute(application.signature.result(), instantiation.substitution),
      };
}
