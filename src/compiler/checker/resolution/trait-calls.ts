/**
 * Calls on a union through a trait (§6, union-traits.ts), kept only where the union meets the
 * trait: through its members, as such a call dispatches, or through a function declared for the
 * union whole, which is called in its place. Choosing a call (applied-call.ts) and what tools offer
 * after a union (lookup/members.ts) read candidates through here, so they agree on what a call on a
 * union may mean.
 */

import type { CheckerContext } from '../context.ts';
import { searchSite } from '../use-site.ts';
import type { Candidate } from './candidates.ts';
import { callWitnessesFor } from './conformance.ts';
import { membersRequirementOf, traitMetBy } from './union-traits.ts';

/**
 * `candidates`, each call through a union's trait kept where the union meets the trait through
 * its members, replaced by the function declared to meet it for the union whole, or dropped.
 */
export function metThroughTraits(
  checker: CheckerContext,
  candidates: readonly Candidate[],
): readonly Candidate[] {
  const site = searchSite(checker);
  return candidates.flatMap((candidate): readonly Candidate[] => {
    const origin = membersRequirementOf(candidate);
    if (origin === undefined) {
      return [candidate];
    }
    const met = traitMetBy(origin.through, origin.on, checker.typeRules);
    const witness = callWitnessesFor(site, origin.on, met)?.[origin.member];
    if (witness === undefined) {
      return [];
    }
    if (witness.kind === 'requirement' && witness.requirement.kind === 'members') {
      return [candidate];
    }
    const declared = candidates.some(({ declaration }) => declaration === witness.function);
    return declared ? [] : [{ declaration: witness.function }];
  });
}
