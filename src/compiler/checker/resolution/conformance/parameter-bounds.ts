/**
 * A type argument judged against every bound on its type parameter (§8.1), in one place for each
 * place one is given: a call's instantiation (conformance.ts), a written type's noted check
 * (constructs/declarations/type-parameters.ts) and a receiver probe (choosing/receivers.ts).
 *
 * - Its member union first, then its struct constraints, then its trait constraints, whose
 *   witnesses an instantiation calls. The first unmet ends it, so an argument is reported once.
 * - The goals are the asker's (`ArgumentGoals`): the program's root goals, or a witness search's,
 *   which also says what an unmet bound with no witness fails as.
 * - A probe whose inference left parameters open judges only a parameter whose bounds mention none
 *   of them (`boundParameters`); the call's own instantiation judges the rest once they are given.
 */

import type { TypeParameter } from '../../../syntax/declarations/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import type { UseSite } from '../../contexts/use-site.ts';
import type { ResolvedCall } from '../../surface/resolved-call.ts';
import { standsForMember } from '../../types/fitting/member-arguments.ts';
import {
  type Substitution,
  substitute,
  substituteConstraint,
} from '../../types/parts/substitution.ts';
import { parametersIn } from '../../types/parts/type-parts.ts';
import type { Constraint, ParameterKey, Type } from '../../types/type/index.ts';
import {
  parametersInStructConstraint,
  type StructConstraintModel,
  substituteStructConstraint,
} from '../../types/type/struct-constraint.ts';
import type { ArgumentGoals } from './root-goals.ts';
import { type Failure, isFailure } from './witness-outcomes.ts';

/** What bounds a type parameter (§8.1), read with the arguments given its other parameters. */
export interface ParameterBounds {
  readonly parameter: TypeParameter;
  readonly memberOf: Type | undefined;
  readonly structs: readonly StructConstraintModel[];
  readonly traits: readonly Constraint[];
}

/** `parameter`'s bounds, with `substitution` applied. */
export function parameterBounds(
  checker: CheckerContext,
  parameter: TypeParameter,
  substitution: Substitution,
): ParameterBounds {
  const rules = checker.typeRules;
  const memberOf = checker.memberUnionOf(parameter);
  return {
    parameter,
    memberOf: memberOf === undefined ? undefined : substitute(memberOf, substitution, rules),
    structs: checker
      .structConstraintsOf(parameter)
      .map((model) => substituteStructConstraint(model, substitution, rules)),
    traits: checker
      .constraintsOf(parameter)
      .map((constraint) => substituteConstraint(constraint, substitution, rules)),
  };
}

/** The type parameters `bounds` mention. */
export function boundParameters({
  memberOf,
  structs,
  traits,
}: ParameterBounds): readonly ParameterKey[] {
  return [
    ...(memberOf === undefined ? [] : parametersIn(memberOf)),
    ...structs.flatMap(parametersInStructConstraint),
    ...traits.flatMap((trait) => trait.arguments.flatMap(parametersIn)),
  ];
}

/**
 * The witnesses `argument`, given for the parameter `bounds` bound, has for each of their traits
 * once it meets their member union and struct constraints, asked of `goals`; the failure of the
 * first it doesn't.
 */
export function boundWitnesses(
  site: UseSite,
  argument: Type,
  { parameter, memberOf, structs, traits }: ParameterBounds,
  goals: ArgumentGoals,
): readonly (readonly ResolvedCall[])[] | Failure {
  if (
    !(
      standsForMember(site, parameter, argument, memberOf) &&
      structs.every((model) => goals.structMet(argument, model))
    )
  ) {
    return goals.unmet();
  }
  const met: (readonly ResolvedCall[])[] = [];
  for (const trait of traits) {
    const witnesses = goals.witnesses(argument, trait);
    if (isFailure(witnesses)) {
      return witnesses;
    }
    met.push(witnesses);
  }
  return met;
}
