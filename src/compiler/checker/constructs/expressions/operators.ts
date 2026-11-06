/**
 * Operator expressions (§3.9).
 *
 * - An operator's meaning (syntax/operators.ts) decides how it is checked. Arithmetic, negation,
 *   the orderings and `in` call functions (resolution/calls/operators.ts); an ordering is `Bool`
 *   whatever `compare` returns, since lowering turns its int into the relation. `item in c` calls
 *   `includes(c, item)`, which must give a `Bool`.
 * - A chain `a < b == c`, `in` and `not in` included, compares each operand with the next, each
 *   operand checked once. Its orderings' `compare` and its memberships' `includes` calls are
 *   implicit, at their right operands, since the chain is one node.
 *   An operand between two links is compared on both sides, so it is never wrapped into an
 *   optional for one of them; the first and the last may be, as in a single comparison.
 * - `==` and `!=` are built in for every type and can't be overloaded (types/unions/equality.ts).
 *   The left side's type is what the right one is expected to have, so `x == none` reads naturally.
 *   One whose sides' types fix its value is decided (constructs/expressions/decided-conditions.ts).
 * - `and`, `or` and `not` take and give `Bool`; they short-circuit, so they are never calls.
 * - `??` works on optionals (access/optionals.ts).
 */

import { unreachable } from '../../../../structures/unreachable.ts';
import {
  type ComparisonLink,
  comparisonLinkOf,
  comparisonLinksOf,
  linkSpan,
} from '../../../syntax/expressions/comparisons.ts';
import type {
  Binary,
  ChainedComparison,
  Expression,
  Unary,
} from '../../../syntax/expressions/index.ts';
import {
  type BinaryMeaning,
  binaryOperators,
  type ImplicitOperator,
  isImplicitOperator,
} from '../../../syntax/operators.ts';
import type { AnchoredSpan } from '../../../syntax/positions.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import {
  applied,
  type Operand,
  resolveOperator,
  unaryApplied,
} from '../../resolution/calls/operators.ts';
import { stoppedOperation } from '../../resolution/calls/stopped-operations.ts';
import { type ImplicitOperand, implicitOperatorCall } from '../../resolution/implicit.ts';
import type { Type } from '../../types/type/index.ts';
import { boolType, isPrimitive } from '../../types/type/primitives.ts';
import { typeText } from '../../types/type-text.ts';
import { literalOrBase, writtenLiteral } from '../../types/unions/unions.ts';
import { checkNullish } from './access/optionals.ts';
import { checkEquality } from './decided-conditions.ts';

export function checkBinary(context: BodyContext, node: Binary, expected: Type | undefined): Type {
  const link = comparisonLinkOf(node);
  if (link !== undefined) {
    return checkComparisons(context, node, [link]);
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
    unreachable(`'${operator}' is a comparison; comparisonLinkOf should have matched it.`);
  }
  const operands = operandsOf(context, node);
  return (
    stoppedOperation(context, node, operands) ??
    resolveOperator(context, node, applied(operator, meaning), operands)
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
    resolveOperator(context, node, unaryApplied(node.operator), operands);
  const written = writtenLiteral(node);
  return written === undefined ? type : literalOrBase(written.value, expected);
}

/** `a < b <= c`: each operand compared with the next (§3.9). */
export function checkChainedComparison(context: BodyContext, node: ChainedComparison): Type {
  return checkComparisons(context, node, comparisonLinksOf(node));
}

/**
 * Checks one or more comparison links of `comparison` in sequence, checking shared operands once;
 * an operand with no value stops it (resolution/calls/stopped-operations.ts).
 */
function checkComparisons(
  context: BodyContext,
  comparison: Expression,
  links: readonly ComparisonLink[],
): Type {
  const checked = new Map<Expression, Type>();
  const operand = (expression: Expression, expected?: Type): Operand => {
    const type = checked.get(expression) ?? context.expression(expression, expected);
    checked.set(expression, type);
    return { node: expression, type };
  };
  const [first, last] = [links[0]?.left, links.at(-1)?.right];
  const wrappable = (side: Operand): ImplicitOperand =>
    side.node === first || side.node === last ? side : { type: side.type, node: undefined };
  for (const link of links) {
    const { operator } = link;
    const left = operand(link.left);
    const right = operand(link.right, isImplicitOperator(operator) ? undefined : left.type);
    const stopped = stoppedOperation(
      context,
      comparison,
      [...checked].map(([node, type]) => ({ node, type })),
    );
    if (stopped !== undefined) {
      return stopped;
    }
    if (isImplicitOperator(operator)) {
      checkLinkCall(context, link, operator, [wrappable(left), wrappable(right)]);
    } else {
      checkEquality(context, wrappable(left), wrappable(right), {
        comparison: links.length === 1 ? comparison : undefined,
        span: linkSpan(link),
        operator,
      });
    }
  }
  return boolType;
}

/** A link's call, made at its right operand: an ordering's `compare`, or `in`'s `includes`. */
function checkLinkCall(
  context: BodyContext,
  link: ComparisonLink,
  operator: ImplicitOperator,
  [left, right]: readonly [ImplicitOperand, ImplicitOperand],
): void {
  const membership = binaryOperators[operator].meaning.kind === 'membership';
  const span = linkSpan(link);
  const result = implicitOperatorCall(context, {
    node: link.right,
    span,
    operator,
    arguments: membership ? [right, left] : [left, right],
  });
  if (membership && result !== undefined) {
    expectBool(context, result, span);
  }
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
