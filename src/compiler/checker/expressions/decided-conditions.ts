/**
 * Conditions decided by types (§4): an `==`, `!=` or `is` whose outcome the types of its operands
 * already fix (types/equality.ts, and for `is` a pattern its subject can't match, §3.11), and
 * an `if`'s condition built of them, whose ruled-out branch never runs, so it is neither checked
 * nor lowered. This is what lets a field loop's pass (§4), the body written out for one field, skip
 * the code another field's key selects, and the generic loop, its instantiations and the body
 * written out by hand agree.
 *
 * - Each comparison and `is` decides itself where it is checked, recording its value and warning
 *   of it there, at the one place the types fix it; a condition combines what its parts decided:
 *   `not`, and `and` and `or` as they run, so `false and x` is false whatever `x` is.
 * - A bare `true` or `false` decides nothing: `if true:` is a block written as a branch, and
 *   nothing it holds is ruled out.
 * - Nothing narrows: an undecided condition leaves its operands' types as they are.
 */

import type { Expression } from '../../syntax/expressions/index.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import type { BodyContext } from '../body-context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { keyOwnerOfValue } from '../traits/struct-keys.ts';
import { decidedEquality, type EqualitySide, fitEqualSides } from '../types/equality.ts';
import { typeText } from '../types/type-text.ts';

/** The value `condition` always has, by its operands' types; undefined when they don't fix it. */
export function decidedValue(context: BodyContext, condition: Expression): boolean | undefined {
  switch (condition.kind) {
    case 'Parenthesized':
      return decidedValue(context, condition.expression);
    case 'Unary': {
      const operand =
        condition.operator === 'not' ? decidedValue(context, condition.operand) : undefined;
      return operand === undefined ? undefined : !operand;
    }
    case 'Binary':
      return condition.operator === 'and' || condition.operator === 'or'
        ? decidedLogic(context, condition)
        : context.decidedAt(condition);
    case 'Is':
      return context.decidedAt(condition);
    default:
      return undefined;
  }
}

/** Where an `==` or `!=` stands: the comparison, unless it is a link of a chain, and its operator. */
export interface EqualityAt {
  readonly comparison: Expression | undefined;
  readonly span: AnchoredSpan;
  readonly operator: string;
}

/**
 * Checks that `left` and `right` compare by `==` (types/equality.ts), deciding the comparison by
 * their types where they fix it: a single comparison then records and warns of its value. Sides
 * that never compare are reported, unless their types decide them unequal (types/equality.ts),
 * which only a single comparison may be: a chain's link always runs.
 */
export function checkEquality(
  context: BodyContext,
  left: EqualitySide,
  right: EqualitySide,
  at: EqualityAt,
): void {
  const compare = fitEqualSides(context, left, right);
  for (const [side, other] of [
    [left, right],
    [right, left],
  ] as const) {
    if (side.node !== undefined && other.node !== undefined) {
      context.recordKey(side.node, keyOwnerOfValue(context, other.node));
    }
  }
  const { memberUnionOf } = context.checker.fitting;
  const equal = decidedEquality(left, right, compare, memberUnionOf);
  if (!compare && (equal === undefined || at.comparison === undefined)) {
    const types = [typeText(left.type), typeText(right.type)];
    context.report(checkerDiagnostics.operatorTypes(at.span, at.operator, types));
  } else if (equal !== undefined && at.comparison !== undefined) {
    decideComparison(context, at.comparison, equal === (at.operator === '=='));
  }
}

/** Records that `node`, a comparison or `is`, always has `value`, and warns of it there. */
export function decideComparison(context: BodyContext, node: Expression, value: boolean): void {
  context.decide(node, value);
  context.report(checkerDiagnostics.decidedCondition(node.span, value));
}

function decidedLogic(
  context: BodyContext,
  node: Extract<Expression, { kind: 'Binary' }>,
): boolean | undefined {
  const left = decidedValue(context, node.left);
  const right = decidedValue(context, node.right);
  const deciding = node.operator === 'or';
  if (left === deciding || right === deciding) {
    return deciding;
  }
  return left === undefined || right === undefined ? undefined : !deciding;
}
