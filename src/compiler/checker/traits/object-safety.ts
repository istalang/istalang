/**
 * Object safety (§3.10): whether a trait can be met by values whose own type is known only when
 * they run, as an `any` type's values are, so every call through it dispatches on its receiver.
 *
 * - A required function takes `Self` first, its receiver, by value or `&`, and nowhere else: not
 *   in another parameter, which would need a second value of the same unknown type, nor in its
 *   result, whose type no caller could know.
 * - No required function is static, since there is no value to take the type from.
 * - No required field mentions `Self`.
 *
 * A constraint is judged as written after `any`, its trait's own `Self` standing for each value's
 * type, so the trait's parameters count as `Self` where its arguments make them so (`C = Self`).
 * Its fields and functions are read through the constraint as conformance reads them
 * (constraints.ts).
 */

import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import type { CheckerContext } from '../context.ts';
import { parametersIn } from '../types/parts/type-parts.ts';
import { substitute } from '../types/substitution.ts';
import type { Constraint, Type } from '../types/type/index.ts';
import { parameterType } from '../types/written/resolve-type.ts';
import {
  constraintSubstitution,
  requiredFields,
  requiredFieldType,
  requiredFunctions,
} from './constraints.ts';

/**
 * Why `constraint`, written with its trait's own `Self` (as after `any`), can't be met through
 * values whose type is known only when they run; undefined when it is object safe.
 */
export function objectUnsafety(
  checker: CheckerContext,
  constraint: Constraint,
): string | undefined {
  const { trait } = constraint;
  const self = parameterType(trait);
  const mentionsSelf = (type: Type) => parametersIn(type).includes(trait);
  for (const field of requiredFields(trait)) {
    if (mentionsSelf(requiredFieldType(checker, constraint, field, self))) {
      return `its field '${field.name.text}' has a type built from Self`;
    }
  }
  const substitution = constraintSubstitution(constraint, self);
  const reading: SelfReading = {
    isSelf: (type) => {
      const written = substitute(type, substitution, checker.typeRules);
      return written.kind === 'parameter' && written.declaration === trait;
    },
    mentionsSelf: (type) => mentionsSelf(substitute(type, substitution, checker.typeRules)),
  };
  for (const required of requiredFunctions(trait)) {
    const unsafe = functionUnsafety(checker, required, reading);
    if (unsafe !== undefined) {
      return `'${required.name.text}' ${unsafe}`;
    }
  }
  return undefined;
}

/** How a required function's types read `Self`, its trait's parameters as the constraint maps them. */
interface SelfReading {
  readonly isSelf: (type: Type) => boolean;
  readonly mentionsSelf: (type: Type) => boolean;
}

/** Why the required function `required` can't be called through `any`; undefined when it can. */
function functionUnsafety(
  checker: CheckerContext,
  required: FunctionDeclaration,
  { isSelf, mentionsSelf }: SelfReading,
): string | undefined {
  if (required.owner !== undefined) {
    return 'is static';
  }
  const [receiver, ...others] = checker.parametersOf(required);
  if (receiver === undefined || !isSelf(receiver.type)) {
    return "doesn't take Self first";
  }
  if (others.some((parameter) => mentionsSelf(parameter.type))) {
    return 'takes Self after its receiver';
  }
  if (mentionsSelf(checker.resultOf(required))) {
    return 'gives a type built from Self';
  }
  return undefined;
}
