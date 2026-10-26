/**
 * A step written on an optional where its value was meant (§4): `b.c.count`, `t.0`, `xs[0]`,
 * `f(1)` and `p.size()` all fail on a `T?` that `?.`, `?.[`, `?.(` or `?->` would read inside. Each
 * link's handler asks here once its own rule failed, with the operator its form reaches inside
 * with, so the hint is one rule whichever link fails, and only ever names a form that link has.
 */

import type { Diagnostic } from '../../../diagnostics/diagnostic.ts';
import type { Span } from '../../../text/span.ts';
import type { ChainOperator } from '../../syntax/expressions.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { optionalInner } from './fit.ts';
import type { Type } from './type.ts';
import { typeText } from './type-text.ts';

/** The operators that read inside an optional, one per form of link. */
type InsideOperator = Extract<ChainOperator, `?${string}`>;

/**
 * The diagnostic pointing a step that failed on `type` at `operator`, which reaches inside it;
 * undefined when `type` isn't optional, so the step's own failure stands.
 */
export function insideOptional(
  checker: Pick<CheckerContext, 'optionalEntity'>,
  at: Span,
  type: Type,
  operator: InsideOperator,
): Diagnostic | undefined {
  return optionalInner(type, checker.optionalEntity) === undefined
    ? undefined
    : checkerDiagnostics.insideOptional(at, typeText(type), operator);
}
