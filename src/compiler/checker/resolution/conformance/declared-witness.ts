/**
 * Finding the function declared to meet a trait's requirement for a type (§3.10): chosen among the
 * witness candidates (choosing/candidates.ts) by the required parameter types, taken exactly, so a
 * function taking the type only once wrapped into an optional is one for the optional. Conformance
 * builds on it (conformance.ts); a derived codec or default may stand only where none is declared.
 *
 * A lone literal type's value is its base's (§2), so a parameter of a literal type taken by value
 * is taken as its base: `"draft"` meets `Stringable` with `String`'s `toString`. Through `&` a place
 * has its type exactly (§3.7), and the base's function could write any value of the base there,
 * so a `&Self` parameter stays the literal. A requirement giving `Self` still gives the base, which
 * is no literal, so it isn't met that way either.
 */

import type { CheckerContext } from '../../context.ts';
import { constraintSubstitution, requiredFunctions } from '../../traits/constraints.ts';
import type { Constraint, Type } from '../../types/type/index.ts';
import { baseOf } from '../../types/unions/union-members.ts';
import type { CallArgument } from '../choosing/call-arguments.ts';
import { type Candidate, witnessCandidates } from '../choosing/candidates.ts';
import { type Choice, chooseAsValue, type Signature, signatureOf } from '../choosing/choice.ts';

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
 * witness candidates by the required parameter types, taken exactly and bound as a function value
 * is, a rest parameter one array, since a call through the requirement passes it so (§3.10).
 */
export function chooseWitness(checker: CheckerContext, type: Type, required: Signature): Choice {
  const parameterTypes = required.parameters.map((parameter) => parameter.type);
  const candidates = witnessCandidates(checker, type, {
    required: required.declaration,
    parameterTypes,
  });
  return chooseWitnessAmong(checker, candidates, required);
}

/** `chooseWitness` among `candidates`, as a witness is chosen wherever they come from. */
export function chooseWitnessAmong(
  checker: CheckerContext,
  candidates: readonly Candidate[],
  required: Signature,
): Choice {
  const callArguments = required.parameters.map(
    ({ type: each, reference }): CallArgument => ({
      type: !reference && each.kind === 'literal' ? baseOf(each) : each,
      passing: reference ? 'reference' : 'value',
      exact: true,
    }),
  );
  return chooseAsValue(checker, candidates, callArguments);
}
