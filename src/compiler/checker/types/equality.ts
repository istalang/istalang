/**
 * `==` and `!=` (§3.9): built in for every type, they compare values of one type. The implicit
 * wrap (§2) may make a side an optional where the other is one, as in `x == none` or
 * `maybe == 5`; the wrap is recorded on that side's expression. A side with no expression of its
 * own, such as the field a pattern compares (§3.11), is never wrapped.
 */

import type { Span } from '../../../text/span.ts';
import type { Expression } from '../../syntax/expressions/index.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { isPrimitive, sameType, type Type } from './type.ts';
import { typeText } from './type-text.ts';

/**
 * Whether `==` and `!=` may compare values of these types (§3.9): one type on both sides. The
 * error type compares with anything, so one mistake is reported once, and so does `never`, which a
 * side that doesn't produce a value has.
 */
export function comparable(first: Type, second: Type): boolean {
  const unchecked = (type: Type) => type.kind === 'error' || isPrimitive(type, 'never');
  return unchecked(first) || unchecked(second) || sameType(first, second);
}

/** A side of `==`: its type, and the expression giving it, if one does. */
export interface EqualitySide {
  readonly type: Type;
  readonly node: Expression | undefined;
}

/** Checks that `left` and `right` compare by `operator`, reporting at `at` when they can't. */
export function checkEqualSides(
  context: BodyContext,
  left: EqualitySide,
  right: EqualitySide,
  at: { readonly span: Span; readonly operator: string },
): void {
  if (comparable(left.type, right.type)) {
    return;
  }
  for (const [side, other] of [
    [right, left],
    [left, right],
  ] as const) {
    if (side.node !== undefined && context.checker.fitOf(side.type, other.type) !== undefined) {
      context.fit(side.type, other.type, side.node);
      return;
    }
  }
  const types = `${typeText(left.type)} and ${typeText(right.type)}`;
  context.report(checkerDiagnostics.operatorTypes(at.span, at.operator, types));
}
