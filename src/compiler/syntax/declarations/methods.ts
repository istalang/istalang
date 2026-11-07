/**
 * Methods (§3.7): a function whose first parameter is `self` takes its receiver there. A variant
 * constructor's field named `self` is a parameter like any other. Telling a constructor apart takes
 * field-defaults.ts, which builds on the declarations index, so the rule stands here rather than in
 * it.
 */

import { receiverParameter } from '../../../foundation/language/well-known/index.ts';
import { isFieldsFunction } from './field-defaults.ts';
import type { FunctionDeclaration } from './index.ts';

/**
 * Whether `declaration` is a method: its first parameter is named `self` (§3.7); a field so named
 * of a variant's constructor is a parameter.
 */
export function isMethod(declaration: FunctionDeclaration): boolean {
  const [first] = declaration.parameters;
  return (
    !isFieldsFunction(declaration) &&
    first?.kind === 'Parameter' &&
    first.name?.text === receiverParameter
  );
}
