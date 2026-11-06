/**
 * Finishing inference (§3.5): what the arguments, the expected type or written type arguments
 * left open is filled from the declaration's defaults, then by the error type where it was met, a
 * mistake reported already, and then by `Never` where only it was met.
 * The first parameter still open, or one two different types were found for, can't be inferred;
 * calls and literals report it alike.
 */

import type { TypeParameter } from '../../syntax/declarations.ts';
import type { CheckerContext } from '../context.ts';
import { type Substitution, substitute } from '../types/substitution.ts';
import type { Type } from '../types/type/index.ts';
import { errorType } from '../types/type/primitives.ts';
import { defaultArgument, type GenericDeclaration } from '../types/written/type-arguments.ts';
import type { Inference } from './infer.ts';

export type Completion =
  | {
      readonly kind: 'complete';
      readonly typeArguments: readonly Type[];
      readonly substitution: Substitution;
    }
  | { readonly kind: 'open'; readonly parameter: TypeParameter };

/** `inference` for `declaration`'s `parameters`, completed by their defaults. */
export function completeInference(
  checker: CheckerContext,
  declaration: GenericDeclaration,
  parameters: readonly TypeParameter[],
  inference: Inference,
): Completion {
  for (const parameter of parameters) {
    if (inference.boundOf(parameter) === undefined && parameter.defaultType !== undefined) {
      inference.bindIfOpen(
        parameter,
        defaultArgument(checker, declaration, parameter, inference.substitution()),
      );
    }
  }
  inference.bindErrorWhereOpen();
  inference.bindNeverWhereOpen();
  const open = parameters.find(
    (parameter) => inference.boundOf(parameter) === undefined || inference.conflicts.has(parameter),
  );
  if (open !== undefined) {
    return { kind: 'open', parameter: open };
  }
  const substitution = inference.substitution();
  return {
    kind: 'complete',
    typeArguments: parameters.map((parameter) =>
      substitute(inference.boundOf(parameter) ?? errorType, substitution, checker.typeRules),
    ),
    substitution,
  };
}
