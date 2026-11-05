/**
 * `==` and `!=` (§3.9): built in for every type, they take two values when either fits the
 * other's type (§2), or two literals of one base, and compare them as values of that type. So a side may go into a union the
 * other is, as in `x == none` or `maybe == 5`, or a literal's value be taken as its base, as in
 * `status == name`; the conversion is recorded on that side's expression. A union's values compare
 * their members' types, then the values, as an enum's variants do, so a union may be a map key. A
 * side with no expression of its own, such as the field a pattern compares (§3.11), is never
 * converted.
 */

import type { Expression } from '../../syntax/expressions/index.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import type { BodyContext } from '../body-context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { sameType } from './identity.ts';
import { isPrimitive, type Type } from './type.ts';
import { typeText } from './type-text.ts';
import { baseOf } from './unions.ts';

/**
 * Whether `==` and `!=` compare values of these types as they are (§3.9): one type on both sides,
 * or two literal types of one base, a constant comparison, as a field loop's key, each pass the
 * literal of its field, is compared with another field's name (§4). The error type compares with
 * anything, so one mistake is reported once, and so does `Never`, which a side that doesn't
 * produce a value has.
 */
export function comparable(first: Type, second: Type): boolean {
  const unchecked = (type: Type) => type.kind === 'error' || isPrimitive(type, 'Never');
  const literals =
    first.kind === 'literal' &&
    second.kind === 'literal' &&
    sameType(baseOf(first), baseOf(second));
  return unchecked(first) || unchecked(second) || literals || sameType(first, second);
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
  at: { readonly span: AnchoredSpan; readonly operator: string },
): void {
  if (!fitEqualSides(context, left, right)) {
    const types = [typeText(left.type), typeText(right.type)];
    context.report(checkerDiagnostics.operatorTypes(at.span, at.operator, types));
  }
}

/**
 * Whether `left` and `right` compare by `==` (the module's banner), a literal pattern's value and
 * its part too (§3.11); a side that goes into the other's type has its conversion recorded.
 */
export function fitEqualSides(
  context: BodyContext,
  left: EqualitySide,
  right: EqualitySide,
): boolean {
  if (comparable(left.type, right.type)) {
    return true;
  }
  for (const [side, other] of [
    [right, left],
    [left, right],
  ] as const) {
    if (side.node !== undefined && context.checker.fitOf(side.type, other.type) !== undefined) {
      context.fit(side.type, other.type, side.node);
      return true;
    }
  }
  return false;
}
