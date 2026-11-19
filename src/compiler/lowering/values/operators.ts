/**
 * The operators the language computes itself on values in registers (§10.2): the built-in `==` and
 * `!=`, `not`, and whether a `compare`'s result is in a relation, as an ordering and a pattern's
 * comparison give it.
 */

import type { Register } from '../../../definition/operands.ts';
import type { Relation } from '../../syntax/expressions/operators.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { CodeContext } from '../context.ts';
import { boolType } from '../functions/code-writer.ts';

/** Whether `left` and `right` are `==`, or `!=` when `isNegated`. */
export function equal(
  context: CodeContext,
  span: AnchoredSpan,
  [left, right]: readonly [Register, Register],
  isNegated = false,
): Register {
  const dst = context.code.equal(left, right, span);
  return isNegated ? negated(context, dst, span) : dst;
}

export function negated(context: CodeContext, src: Register, span: AnchoredSpan): Register {
  const dst = context.code.allocate(boolType);
  context.code.emit({ kind: 'not', span, dst, src });
  return dst;
}

/**
 * Whether `compare`'s int, in `comparison`, is in `relation`: what an ordering gives, whether an
 * operator or a pattern's field test (§11.3) compared.
 */
export function ordered(
  context: CodeContext,
  span: AnchoredSpan,
  comparison: Register,
  relation: Relation,
): Register {
  const dst = context.code.allocate(boolType);
  context.code.emit({ kind: 'order', span, dst, comparison, relation });
  return dst;
}
