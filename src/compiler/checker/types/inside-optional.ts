/**
 * A step written on an optional where its value was meant (§4): `b.c.count`, `t.0`, `xs[0]`,
 * `f(1)` and `p.size()` all fail on a `T?` that `?.`, `?.[`, `?.(` or `?->` would read inside. Each
 * link's handler asks here once its own rule failed, with its form, whose optional operator
 * (syntax/expressions/chains.ts) reaches inside. The rule is one whichever link fails: the step's target is optional. What the value
 * inside then takes is the next step's to say, so the hint never names a form that link lacks.
 */

import type { Diagnostic } from '../../../diagnostics/diagnostic.ts';
import type { Span } from '../../../text/span.ts';
import { type LinkForm, optionalOperatorOf } from '../../syntax/expressions/chains.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { optionalInner } from './fit.ts';
import type { Type } from './type.ts';
import { typeText } from './type-text.ts';

/**
 * The diagnostic pointing a step of `form` that failed on `type` at the operator taking it inside
 * the optional; undefined when `type` isn't optional, so the step's own failure stands.
 */
export function insideOptional(
  checker: Pick<CheckerContext, 'optionalEntity'>,
  at: Span,
  type: Type,
  form: LinkForm,
): Diagnostic | undefined {
  return optionalInner(type, checker.optionalEntity) === undefined
    ? undefined
    : checkerDiagnostics.insideOptional(at, typeText(type), optionalOperatorOf(form));
}
