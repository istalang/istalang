/**
 * The one order of types (§2, §3.7): a type holds another when the other's values fit it, as they
 * are or converted (fit/), a conversion inside a type included. Joining
 * (types/unions/common-type.ts), settling's lower bounds (types/inference/fillings.ts) and choosing
 * the most specific function (resolution/choosing/choice.ts), which overload clashes try calls
 * through (constructs/declarations/functions/clashes.ts), all read it, so none of them can call a
 * type narrower than another where the others don't.
 */

import type { Type } from '../type/index.ts';
import { type Fitting, fitOf } from './fit/index.ts';

/** Whether `holder` holds `type`: a value of `type` fits it. */
export function holds(holder: Type, type: Type, fitting: Fitting): boolean {
  return fitOf(type, holder, fitting) !== undefined;
}
