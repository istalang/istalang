/**
 * A number written in place (§3.1): a literal, or one negated. No literal is negative, so `-5` is
 * `-` applied to `5`; compile time still reads it as one value: a range pattern's bound, a
 * literal pattern's key for exhaustiveness, a constant's form. Each reads it here, so `-0` is `0`
 * to all of them. Parentheses around the negated literal are seen through, as `-(5)` is still a
 * number written in place.
 */

import type { Expression } from '../index.ts';
import { unparenthesized } from '../readings.ts';

/** A number written in place, with its literal's kind and its signed value. */
type SignedNumber =
  | { readonly kind: 'IntegerLiteral'; readonly value: bigint }
  | { readonly kind: 'FloatLiteral'; readonly value: number };

/** The number `node` writes, a literal negated or not; undefined for any other expression. */
export function signedNumberOf(node: Expression): SignedNumber | undefined {
  if (node.kind === 'IntegerLiteral' || node.kind === 'FloatLiteral') {
    return node;
  }
  if (node.kind !== 'Unary' || node.operator !== '-') {
    return undefined;
  }
  const operand = unparenthesized(node.operand);
  switch (operand.kind) {
    case 'IntegerLiteral':
      return { kind: operand.kind, value: -operand.value };
    case 'FloatLiteral':
      return { kind: operand.kind, value: -operand.value };
    default:
      return undefined;
  }
}
