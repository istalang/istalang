/**
 * Whether a function takes a value as its receiver (§3.7, §3.10), whatever else its call is given:
 * its `self` takes the value as a call's receiver (applicability.ts), and the type parameters that
 * decides meet their constraints. Completion asks it of a type's methods, and indexing whether a
 * struct declares an `index` of its own, which its keys then give way to (§3.9).
 *
 * A probe: it chooses nothing and reports nothing, so asking leaves no trace.
 */

import type { TypeParameter } from '../../syntax/declarations.ts';
import { isMethod } from '../../syntax/declarations.ts';
import type { CheckerContext } from '../context.ts';
import type { Inference } from '../inference/infer.ts';
import { substituteConstraint } from '../types/substitution.ts';
import type { ParameterKey, Type } from '../types/type.ts';
import { parametersIn } from '../types/type-parts.ts';
import { searchSite } from '../use-site.ts';
import { takenBy } from './applicability.ts';
import { bindArguments } from './binding.ts';
import type { Candidate } from './candidates.ts';
import { signatureOf } from './choice.ts';
import { meets } from './conformance.ts';

/**
 * Whether `candidate` is a method a call through a value of `type` may choose, its other arguments
 * aside: its `self` takes the value as the call's receiver, and the type parameters that decides
 * meet their constraints.
 */
export function takesAsSelf(checker: CheckerContext, candidate: Candidate, type: Type): boolean {
  const { declaration, requirement } = candidate;
  if (!isMethod(declaration)) {
    return false;
  }
  const { typeParameters, parameters } = signatureOf(
    checker,
    declaration,
    requirement?.substitution,
  );
  const taken = takenBy(
    checker,
    { typeParameters, parameters: parameters.slice(0, 1) },
    {
      callArguments: [{ type, passing: 'receiver' }],
      written: undefined,
      binder: bindArguments,
    },
  );
  return 'inference' in taken && meetsWhereFound(checker, typeParameters, taken.inference);
}

/**
 * Whether the type parameters `inference` found meet their constraints. A parameter still open, or
 * a constraint mentioning one, waits for the arguments that decide it.
 */
function meetsWhereFound(
  checker: CheckerContext,
  parameters: readonly TypeParameter[],
  inference: Inference,
): boolean {
  const site = searchSite(checker);
  const substitution = inference.substitution();
  const isOpen = (parameter: ParameterKey) =>
    inference.isUnknown(parameter) && inference.boundOf(parameter) === undefined;
  return parameters.every((parameter) => {
    const found = inference.boundOf(parameter);
    return (
      found === undefined ||
      checker.constraintsOf(parameter).every((constraint) => {
        const mapped = substituteConstraint(constraint, substitution, checker.typeRules);
        return mapped.arguments.flatMap(parametersIn).some(isOpen) || meets(site, found, mapped);
      })
    );
  });
}
