/**
 * Rules of no program, for unit tests of types/ built without a checker: no `any` member takes
 * another, and no type has an associated type or a field a computed type could reduce to.
 */

import { errorType } from './type.ts';
import type { TypeRules } from './type-rules.ts';

/** TypeRules of a program declaring nothing. */
export const noProgramRules: TypeRules = {
  absorbs: () => false,
  associatedType: () => errorType,
  fieldType: () => errorType,
};
