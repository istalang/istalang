/**
 * Finding the function declared to meet a trait's requirement for a type (§3.10): chosen among the
 * witness candidates (candidates.ts) by the required parameter types, taken exactly, so a function
 * taking the type only once wrapped into an optional is one for the optional. Conformance builds
 * on it (conformance.ts); a derived codec or default may stand only where none is declared.
 */

import type { CheckerContext } from '../context.ts';
import { constraintSubstitution, requiredFunctions } from '../traits/constraints.ts';
import type { Constraint, Type } from '../types/type.ts';
import { witnessCandidates } from './candidates.ts';
import { type CallArgument, type Choice, choose, type Signature, signatureOf } from './choice.ts';

/**
 * Whether a function declared for `type` meets one that `constraint` requires, whether or not its
 * own constraints are met: a declared witness, which nothing derived may stand beside.
 */
export function declaresWitness(
  checker: CheckerContext,
  type: Type,
  constraint: Constraint,
): boolean {
  const substitution = constraintSubstitution(constraint, type);
  return requiredFunctions(constraint.trait).some(
    (declaration) =>
      chooseWitness(checker, type, signatureOf(checker, declaration, substitution)).kind !== 'none',
  );
}

/**
 * The function declared to meet `required`, a requirement mapped for `type`: chosen among the
 * witness candidates by the required parameter types, taken exactly.
 */
export function chooseWitness(checker: CheckerContext, type: Type, required: Signature): Choice {
  const parameterTypes = required.parameters.map((parameter) => parameter.type);
  const candidates = witnessCandidates(checker, type, {
    required: required.declaration,
    parameterTypes,
  });
  const callArguments = required.parameters.map(
    ({ type: each, reference }): CallArgument => ({
      type: each,
      passing: reference ? 'reference' : 'value',
      exact: true,
    }),
  );
  return choose(checker, candidates, callArguments, undefined);
}
