/**
 * Finding the function declared to meet a trait's requirement for a type (§8.2): chosen among the
 * witness candidates (choosing/candidates.ts) by the required parameter types, taken exactly, so a
 * function taking the type only once wrapped into an optional is one for the optional. A field a
 * trait requires and the type stores none of is met so by a getter, read as `fn get name(self:
 * Self)` giving the field's type would be. Conformance
 * builds on it (conformance.ts); a derived codec or default may stand only where none is declared.
 *
 * A lone literal type's value is its base's (§4.3), so a parameter of a literal type taken by value
 * is taken as its base: `"draft"` meets `Stringable` with `String`'s `toString`. Through `&` a
 * place has its type exactly (§7.3), and the base's function could write any value of the base
 * there, so a `&Self` parameter stays the literal. A requirement giving `Self` still gives the
 * base, which is no literal, so it isn't met that way either.
 */

import type { CheckerContext } from '../../contexts/context.ts';
import type { RequiredField } from '../../surface/checked-field.ts';
import type { ResolvedCall } from '../../surface/resolved-call.ts';
import { sameType } from '../../types/identity/identity.ts';
import {
  constraintSubstitution,
  requiredFieldType,
  requiredFunctions,
} from '../../types/traits/constraints.ts';
import { isMarkVariable, isSimpleMark, simpleMark } from '../../types/type/function-kinds.ts';
import type { Constraint, Type } from '../../types/type/index.ts';
import { baseOf } from '../../types/unions/union-members.ts';
import { leastMarkMaking } from '../applying/call-kinds.ts';
import type { CallArgument } from '../choosing/call-arguments.ts';
import {
  type Candidate,
  fieldGetterCandidates,
  witnessCandidates,
} from '../choosing/candidates.ts';
import {
  type Choice,
  candidateSignature,
  chooseAsValue,
  type Signature,
  signatureOf,
} from '../choosing/choice.ts';

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
 * is, a rest parameter one array, since a call through the requirement passes it so (§8.2).
 */
export function chooseWitness(checker: CheckerContext, type: Type, required: Signature): Choice {
  const parameterTypes = required.parameters.map((parameter) => parameter.type);
  const candidates = witnessCandidates(checker, type, {
    required: required.declaration,
    parameterTypes,
  });
  return chooseWitnessAmong(checker, type, candidates, required);
}

/**
 * What a witness is chosen and judged by: a required function's signature, or a required field's
 * read as a getter's call (`fieldGetterSignature`), which has no declaration.
 */
export type RequiredSignature = Pick<
  Signature,
  'typeParameters' | 'parameters' | 'result' | 'kind'
>;

/**
 * A field a trait requires read as the getter meeting it is called (§8.2): on `self`, by value,
 * giving `fieldType`, an unmarked requirement, since any code reads a field.
 */
export function fieldGetterSignature(self: Type, fieldType: () => Type): RequiredSignature {
  const receiver = { name: undefined, type: self, reference: false, isReceiver: true };
  return {
    typeParameters: [],
    parameters: [{ ...receiver, hasDefault: false, rest: undefined }],
    result: fieldType,
    kind: () => simpleMark,
  };
}

/**
 * The getter declared to meet `required`'s field for `type`, which stores none of its name
 * (§8.2): chosen among the getters beside `type` or the trait as a witness of its read is.
 */
export function chooseFieldGetter(
  checker: CheckerContext,
  type: Type,
  { constraint, field }: RequiredField,
): { readonly choice: Choice; readonly signature: RequiredSignature } {
  const signature = fieldGetterSignature(type, () =>
    requiredFieldType(checker, constraint, field, type),
  );
  const name = field.name.text;
  const candidates = fieldGetterCandidates(checker, type, { trait: constraint.trait, name });
  return { choice: chooseWitnessAmong(checker, type, candidates, signature), signature };
}

/**
 * `chooseWitness` among `candidates`, as a witness is chosen wherever they come from: only those
 * whose kind may meet the requirement's (`meetsRequirementKind`); one generic over its mark is
 * judged once its instantiation is chosen (conformance.ts).
 */
export function chooseWitnessAmong(
  checker: CheckerContext,
  type: Type,
  given: readonly Candidate[],
  required: RequiredSignature,
): Choice {
  const candidates = given.filter((candidate) => {
    const kind = candidateSignature(checker, candidate).kind();
    return isMarkVariable(checker, kind) || meetsRequirementKind(checker, required, kind, type);
  });
  const callArguments = required.parameters.map(
    ({ type: each, reference }): CallArgument => ({
      type: !reference && each.kind === 'literal' ? baseOf(each) : each,
      passing: reference ? 'reference' : 'value',
      exact: true,
    }),
  );
  return chooseAsValue(checker, candidates, callArguments);
}

/**
 * Whether `call`, a witness chosen and instantiated to meet `required` for `self`, meets its kind
 * as the instantiation makes it: by the least mark of code making it, which one generic over its
 * mark is decided only here, and which its own witnesses and type arguments raise, since a call
 * through the requirement makes those too (Rule 3).
 */
export function instanceMeetsKind(
  checker: CheckerContext,
  required: Pick<RequiredSignature, 'kind'>,
  call: ResolvedCall,
  self: Type,
): boolean {
  const mark = leastMarkMaking(checker, call);
  return mark !== undefined && meetsRequirementKind(checker, required, mark, self);
}

/**
 * Whether a witness of kind `given` meets the kind of `required`, as its conformance instantiates
 * it, for `self`, the type meeting it (proposal 8, Rule 4): a simple
 * witness meets any, one of the requirement's kind meets it, and an unmarked requirement is met by
 * a witness of the kind `self`'s values are of, which handles that type's own data: `Socket`'s
 * `live fn dispose` meets `Disposable`'s unmarked one. A requirement of a kind is met by nothing of
 * the other, whatever `self` holds.
 */
function meetsRequirementKind(
  checker: Pick<CheckerContext, 'valueKindsOf'>,
  required: Pick<Signature, 'kind'>,
  given: Type,
  self: Type,
): boolean {
  // Most witnesses are simple: only one of a kind needs the requirement's, mapped for its trait.
  if (isSimpleMark(given)) {
    return true;
  }
  const kind = required.kind();
  return (
    sameType(given, kind) ||
    (isSimpleMark(kind) && checker.valueKindsOf(self).some((each) => sameType(each, given)))
  );
}
