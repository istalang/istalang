/**
 * Whether a function takes a value as its receiver (§3.7, §3.10), whatever else its call is given:
 * its `self` takes the value as a call's receiver (applicability.ts), and the type parameters that
 * decides meet their constraints. What a member's name means asks it of a type's methods and getters
 * (member-meaning.ts), and indexing whether a struct declares an `index` of its own, which its keys
 * then give way to (§3.9), and which keys an `index` serves as members (keyed-indexes.ts).
 *
 * A probe: it chooses nothing and reports nothing, so asking leaves no trace.
 */

import type { TypeParameter } from '../../../syntax/declarations/index.ts';
import { isMethod } from '../../../syntax/declarations/methods.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { searchSite } from '../../contexts/use-site.ts';
import type { Inference } from '../../types/inference/infer.ts';
import type { ParameterKey, Type } from '../../types/type/index.ts';
import {
  boundParameters,
  boundWitnesses,
  parameterBounds,
} from '../conformance/parameter-bounds.ts';
import { rootGoalsAt } from '../conformance/root-goals.ts';
import { isFailure } from '../conformance/witness-outcomes.ts';
import { takenBy } from './applicability.ts';
import { bindArguments } from './binding.ts';
import type { Candidate } from './candidates.ts';
import { signatureOf } from './choice.ts';

/**
 * Whether `candidate` is a method a call through a value of `type` may choose, its other arguments
 * aside: its `self` takes the value as the call's receiver, and the type parameters that decides
 * meet their constraints.
 */
export function takesAsSelf(checker: CheckerContext, candidate: Candidate, type: Type): boolean {
  return selfTaking(checker, candidate, type) === 'met';
}

/**
 * How `candidate`'s `self` takes a value of `type` as a call's receiver, its other arguments aside:
 * with the type parameters that decides meeting their constraints (`met`), or not (`unmet`);
 * undefined where it takes none.
 */
export function selfTaking(
  checker: CheckerContext,
  candidate: Candidate,
  type: Type,
): 'met' | 'unmet' | undefined {
  const taken = selfInference(checker, candidate, type);
  if (taken === undefined) {
    return undefined;
  }
  return meetsWhereFound(checker, taken.typeParameters, taken.inference) ? 'met' : 'unmet';
}

/**
 * What `candidate`'s type parameters are where its `self` takes a value of `type` as a call's
 * receiver with their constraints met; undefined where it takes none so.
 */
export function metSelfInference(
  checker: CheckerContext,
  candidate: Candidate,
  type: Type,
): Inference | undefined {
  const taken = selfInference(checker, candidate, type);
  return taken !== undefined && meetsWhereFound(checker, taken.typeParameters, taken.inference)
    ? taken.inference
    : undefined;
}

/**
 * What `candidate`'s type parameters are where its `self` takes a value of `type` as a call's
 * receiver, whatever their constraints; undefined when it takes none.
 */
export function selfInference(
  checker: CheckerContext,
  candidate: Candidate,
  type: Type,
):
  | { readonly typeParameters: readonly TypeParameter[]; readonly inference: Inference }
  | undefined {
  const { declaration, requirement } = candidate;
  if (!isMethod(declaration)) {
    return undefined;
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
  return 'inference' in taken ? { typeParameters, inference: taken.inference } : undefined;
}

/**
 * Whether the type parameters `inference` found meet their bounds (conformance/parameter-bounds.ts).
 * A parameter still open, or one whose bounds mention one, waits for the arguments that decide it.
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
    if (found === undefined) {
      return true;
    }
    const bounds = parameterBounds(checker, parameter, substitution);
    return (
      boundParameters(bounds).some(isOpen) ||
      !isFailure(boundWitnesses(site, found, bounds, rootGoalsAt(site)))
    );
  });
}
