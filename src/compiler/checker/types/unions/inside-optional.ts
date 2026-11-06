/**
 * A step written on an optional where its value was meant (§4): `b.c.count`, `t.0`, `xs[0]`, `f(1)`
 * and `p.size()` all fail on a `T?` that `?.`, `?.[`, `?.(` or `?->` would read inside. Each link's
 * handler asks here once its own rule failed, with its form, whose optional operator
 * (syntax/expressions/chains.ts) reaches inside. The rule is one whichever link fails: the step's
 * target is optional. What the value inside then takes is the next step's to say, so the hint never
 * names a form that link lacks.
 */

import type { Diagnostic } from '../../../../foundation/diagnostics/diagnostic.ts';
import { type LinkForm, optionalOperatorOf } from '../../../syntax/expressions/chains.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import type { Type } from '../type/index.ts';
import { typeText } from '../type/type-text.ts';
import { optionalInner } from './unions.ts';

/**
 * The diagnostic pointing a step of `form` that failed on `type` at the operator taking it inside
 * the optional; undefined when `type` isn't optional, so the step's own failure stands.
 */
export function insideOptional(
  at: AnchoredSpan,
  type: Type,
  form: LinkForm,
): Diagnostic<AnchoredSpan> | undefined {
  return optionalInner(type) === undefined
    ? undefined
    : checkerDiagnostics.insideOptional(at, typeText(type), optionalOperatorOf(form));
}
