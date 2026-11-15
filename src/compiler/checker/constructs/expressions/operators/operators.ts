/**
 * Operator expressions (§3.9).
 *
 * - An operator's meaning (syntax/expressions/operators.ts) decides how it is checked. Arithmetic,
 *   negation, the orderings and `in` call functions (resolution/calls/operators.ts); an ordering is
 *   `Bool` whatever `compare` returns, since lowering turns its int into the relation. `item in c`
 *   calls `includes(c, item)`, which must give a `Bool`.
 * - An ordering's `compare` and a membership's `includes` are implicit calls, made at the right
 *   operand. A chain `a < b == c` is sugar for its links
 *   (checker/desugaring/chained-comparisons.ts).
 * - `==` and `!=` are built in for every type and can't be overloaded (types/unions/equality.ts).
 *   The left side's type is what the right one is expected to have, so `x == none` reads naturally.
 *   One whose sides' types fix its value is decided
 *   (constructs/expressions/operators/decided-conditions.ts).
 * - `and`, `or` and `not` take and give `Bool`; they short-circuit, so they are never calls.
 * - `??` works on optionals (access/optionals.ts).
 * - An operator that calls a function gives it the type expected of its result, as a call does.
 */

import { unreachable } from '../../../../../foundation/structures/unreachable.ts';
import { type Comparison, isComparison } from '../../../../syntax/expressions/comparisons.ts';
import type { Binary, Unary } from '../../../../syntax/expressions/index.ts';
import {
  type BinaryMeaning,
  binaryOperators,
  isImplicitOperator,
} from '../../../../syntax/expressions/operators.ts';
import type { AnchoredSpan } from '../../../../syntax/tree/positions.ts';
import type { BodyContext } from '../../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import { implicitOperatorCall } from '../../../resolution/applying/implicit.ts';
import {
  applied,
  type Operand,
  resolveOperator,
  unaryApplied,
} from '../../../resolution/calls/operators.ts';
import { stoppedOperation } from '../../../resolution/calls/stopped-operations.ts';
import type { Type } from '../../../types/type/index.ts';
import { boolType, isPrimitive } from '../../../types/type/primitives.ts';
import { typeText } from '../../../types/type/type-text.ts';
import { literalOrBase, writtenLiteral } from '../../../types/unions/unions.ts';
import { checkNullish } from '../access/optionals.ts';
import { checkEquality } from './decided-conditions.ts';

export function checkBinary(context: BodyContext, node: Binary, expected: Type | undefined): Type {
  if (isComparison(node)) {
    return checkComparison(context, node);
  }
  const { operator } = node;
  const { meaning }: { readonly meaning: BinaryMeaning } = binaryOperators[operator];
  if (meaning.kind === 'logic') {
    context.expect(node.left, boolType);
    context.expect(node.right, boolType);
    return boolType;
  }
  if (meaning.kind === 'coalesce') {
    return checkNullish(context, node, expected);
  }
  if (meaning.kind !== 'call') {
    unreachable(`'${operator}' is a comparison; isComparison should have matched it.`);
  }
  const operands = operandsOf(context, node);
  return (
    stoppedOperation(context, node, operands) ??
    resolveOperator(context, {
      site: node,
      operator: applied(operator, meaning),
      operands,
      expected,
    })
  );
}

export function checkUnary(context: BodyContext, node: Unary, expected?: Type): Type {
  if (node.operator === 'not') {
    context.expect(node.operand, boolType);
    return boolType;
  }
  const operands = [{ node: node.operand, type: context.expression(node.operand) }];
  const type =
    stoppedOperation(context, node, operands) ??
    resolveOperator(context, {
      site: node,
      operator: unaryApplied(node.operator),
      operands,
      expected,
    });
  const written = writtenLiteral(node);
  return written === undefined
    ? type
    : literalOrBase(written.value, expected, context.checker.fitting);
}

/**
 * `node`, a comparison: an equality, or its call made at its right operand, an ordering's
 * `compare` or `in`'s `includes`; an operand with no value stops it
 * (resolution/calls/stopped-operations.ts).
 */
function checkComparison(context: BodyContext, node: Comparison): Type {
  const { operator } = node;
  const left = { node: node.left, type: context.expression(node.left) };
  const rightExpected = isImplicitOperator(operator) ? undefined : left.type;
  const right = { node: node.right, type: context.expression(node.right, rightExpected) };
  const stopped = stoppedOperation(context, node, [left, right]);
  if (stopped !== undefined) {
    return stopped;
  }
  if (!isImplicitOperator(operator)) {
    checkEquality(context, left, right, node);
    return boolType;
  }
  const membership = binaryOperators[operator].meaning.kind === 'membership';
  const result = implicitOperatorCall(context, {
    node: node.right,
    span: node.span,
    operator,
    arguments: membership ? [right, left] : [left, right],
  });
  if (membership && result !== undefined) {
    expectBool(context, result, node.span);
  }
  return boolType;
}

/** `includes` must give a `Bool`, since `in` is one. */
function expectBool(context: BodyContext, result: Type, span: AnchoredSpan): void {
  if (result.kind !== 'error' && !isPrimitive(result, 'Bool')) {
    context.report(checkerDiagnostics.typeMismatch(span, 'Bool', typeText(result)));
  }
}

function operandsOf(context: BodyContext, node: Binary): readonly Operand[] {
  return [node.left, node.right].map((operand) => ({
    node: operand,
    type: context.expression(operand),
  }));
}
