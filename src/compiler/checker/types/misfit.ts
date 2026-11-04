/**
 * Why a value doesn't fit where a type is expected (§2), worded once for every place that reports
 * it, a value's own check and a call's argument alike: it converts into several members of the
 * union expected, which makes no fit rather than a guess, or it doesn't fit at all.
 */

import type { Diagnostic } from '../../../diagnostics/diagnostic.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { type Fitting, intoSeveral } from './fit.ts';
import type { Type } from './type.ts';
import { typeText } from './type-text.ts';

/** The diagnostic for a value of `found` at `at` that doesn't fit `expected`. */
export function misfitOf(
  fitting: Fitting,
  at: AnchoredSpan,
  found: Type,
  expected: Type,
): Diagnostic<AnchoredSpan> {
  return intoSeveral(found, expected, fitting)
    ? checkerDiagnostics.severalConversions(at, typeText(found), typeText(expected))
    : checkerDiagnostics.typeMismatch(at, typeText(expected), typeText(found));
}
