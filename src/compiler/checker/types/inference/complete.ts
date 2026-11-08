/**
 * Finishing inference (§3.5): each parameter settled by the one policy (settle.ts), its default
 * read with what is settled before it. The first parameter left unsettled, or one whose bounds
 * disagreed, can't be inferred; calls and literals report it alike.
 */

import type { TypeParameter } from '../../../syntax/declarations/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { type Substitution, substitute } from '../parts/substitution.ts';
import type { ParameterKey, Type } from '../type/index.ts';
import { errorType } from '../type/primitives.ts';
import { defaultArgument, type GenericDeclaration } from '../written/type-arguments.ts';
import type { Inference } from './infer.ts';
import type { Settling } from './settle.ts';

export type Completion =
  | {
      readonly kind: 'complete';
      readonly typeArguments: readonly Type[];
      readonly substitution: Substitution;
    }
  | { readonly kind: 'open'; readonly parameter: TypeParameter };

/**
 * Whether a type may stand for a parameter, its constraints met; a declaration's parameters admit
 * anything unless the caller can say (rule 2 of settle.ts asks it).
 */
export type Admits = (parameter: TypeParameter, type: Type) => boolean;

const admitsAll: Admits = () => true;

/** How `declaration`'s `parameters` settle: by what `admits`, and their defaults. */
export function settlingOf(
  checker: CheckerContext,
  declaration: GenericDeclaration,
  parameters: readonly TypeParameter[],
  admits: Admits = admitsAll,
): Settling {
  const byKey = new Map<ParameterKey, TypeParameter>(
    parameters.map((parameter) => [parameter, parameter]),
  );
  return {
    admits: (key, type) => {
      const parameter = byKey.get(key);
      return parameter === undefined || admits(parameter, type);
    },
    defaultOf: (key, found) => {
      const parameter = byKey.get(key);
      return parameter?.defaultType === undefined
        ? undefined
        : defaultArgument(checker, declaration, parameter, found);
    },
  };
}

/** `inference` for `parameters`, settled as `settling` says. */
export function completeInference(
  checker: CheckerContext,
  parameters: readonly TypeParameter[],
  inference: Inference,
  settling: Settling,
): Completion {
  const settled = inference.settle(parameters, settling);
  const open = parameters.find(
    (parameter) => !settled.has(parameter) || inference.conflicts.has(parameter),
  );
  if (open !== undefined) {
    return { kind: 'open', parameter: open };
  }
  return {
    kind: 'complete',
    typeArguments: parameters.map((parameter) =>
      substitute(settled.get(parameter) ?? errorType, settled, checker.typeRules),
    ),
    substitution: settled,
  };
}
