/**
 * Calls on a union through a trait (§6, union-traits.ts), kept only where the union meets the
 * trait: through its members, as such a call dispatches, or through a function declared for the
 * union whole, which is called in its place. Choosing a call (../applied-call.ts) and what tools
 * offer after a union (lookup/members.ts) read candidates through here, so they agree on what a
 * call on a union may mean.
 *
 * A trait's arguments the call infers (`Requirement.inferred`) are known only once it is chosen, so
 * such a candidate is kept for choosing, and `closedThroughMembers` judges it the same way once
 * they are: one rule (`reachedThrough`), before choosing or after.
 */

import type { FunctionDeclaration, TypeParameter } from '../../../syntax/declarations/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { searchSite, type UseSite } from '../../contexts/use-site.ts';
import type { MembersRequirement } from '../../surface/resolved-call.ts';
import { type Substitution, substituteAny } from '../../types/substitution.ts';
import { constraintSubstitution } from '../../types/traits/constraints.ts';
import { errorType } from '../../types/type/primitives.ts';
import type { Candidate } from '../choosing/candidates.ts';
import { callWitnessesFor, type Instantiation } from './conformance.ts';
import { membersRequirementOf, traitMetBy } from './union-traits.ts';

/**
 * `candidates`, each call through a union's trait kept where the union meets the trait through
 * its members, replaced by the function declared to meet it for the union whole, or dropped; one
 * whose trait arguments the call infers is kept, judged once they are known.
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
    const inferred = candidate.requirement?.inferred;
    if (inferred !== undefined) {
      return mayMeetThroughMembers(site, origin, inferred) ? [candidate] : [];
    }
    const reached = reachedThrough(site, origin);
    if (reached === undefined || reached === 'members') {
      return reached === undefined ? [] : [candidate];
    }
    const declared = candidates.some(({ declaration }) => declaration === reached);
    return declared ? [] : [{ declaration: reached }];
  });
}

/**
 * Whether `origin`'s union may meet its trait through its members with some arguments for the
 * `inferred` parameters, which a call finds only once chosen: it does with each standing for the
 * error type, which fits any, so a union none of whose arguments could make it meet the trait
 * offers no call through it.
 */
function mayMeetThroughMembers(
  site: UseSite,
  origin: MembersRequirement,
  inferred: readonly TypeParameter[],
): boolean {
  const anyArguments = new Map(inferred.map((parameter) => [parameter, errorType] as const));
  const through = substituteAny(origin.through, anyArguments, site.checker.typeRules);
  return reachedThrough(site, { ...origin, through }) === 'members';
}

/**
 * How a call through `origin`'s trait on its union reaches the function it calls: through the
 * union's members, or the function declared for the union whole; undefined, after reporting at
 * `site` why, when the union doesn't meet the trait.
 */
function reachedThrough(
  site: UseSite,
  origin: MembersRequirement,
): 'members' | FunctionDeclaration | undefined {
  const met = traitMetBy(origin.through, origin.on, site.checker.typeRules);
  const witness = callWitnessesFor(site, origin.on, met)?.[origin.member];
  if (witness === undefined) {
    return undefined;
  }
  return witness.kind === 'requirement' && witness.requirement.kind === 'members'
    ? 'members'
    : witness.function;
}

/** A call through a union's trait closed with the trait's arguments it inferred. */
export type ClosedTraitCall =
  | {
      readonly kind: 'members';
      readonly candidate: Candidate;
      readonly instantiation: Instantiation;
    }
  | { readonly kind: 'declared'; readonly declaration: FunctionDeclaration };

/**
 * `candidate`, a call through a union's trait whose `inferred` parameters it found, as
 * `instantiation` found them: the trait named with them, and the function's own type arguments
 * alone; or the function declared for the union whole that meets the trait so. Undefined after
 * reporting at `site` that the union doesn't meet the trait with them.
 */
export function closedThroughMembers(
  site: UseSite,
  candidate: Candidate,
  inferred: readonly TypeParameter[],
  instantiation: Instantiation,
): ClosedTraitCall | undefined {
  const { declaration } = candidate;
  const origin = membersRequirementOf(candidate);
  if (origin === undefined) {
    return undefined;
  }
  const { typeRules } = site.checker;
  const through = substituteAny(origin.through, instantiation.substitution, typeRules);
  const closed: MembersRequirement = { ...origin, through };
  const reached = reachedThrough(site, closed);
  if (reached === undefined || reached !== 'members') {
    return reached === undefined ? undefined : { kind: 'declared', declaration: reached };
  }
  const own = instantiation.typeArguments.length - inferred.length;
  const substitution: Substitution = constraintSubstitution(
    traitMetBy(through, origin.on, typeRules),
    origin.on,
  );
  return {
    kind: 'members',
    candidate: { declaration, requirement: { declaration, origin: closed, substitution } },
    instantiation: {
      typeArguments: instantiation.typeArguments.slice(0, own),
      substitution: instantiation.substitution,
      witnesses: new Map(
        [...instantiation.witnesses].filter(([parameter]) => !inferred.includes(parameter)),
      ),
    },
  };
}
