/**
 * Operator expressions (§3.9).
 *
 * - An operator's meaning (syntax/operators.ts) decides how it is checked. Arithmetic, negation,
 *   the orderings and `in` call functions (calls/operators.ts); an ordering is `bool` whatever
 *   `compare` returns, since lowering turns its int into the relation. `item in c` calls
 *   `includes(c, item)`, which must give a `bool`.
 * - A chain `a < b == c`, `in` and `not in` included, compares each operand with the next, each
 *   operand checked once. Its orderings' `compare` and its memberships' `includes` calls are
 *   implicit, at their right operands, since the chain is one node.
 *   An operand between two links is compared on both sides, so it is never wrapped into an
 *   optional for one of them; the first and the last may be, as in a single comparison.
 * - `==` and `!=` are built in for every type and can't be overloaded (types/equality.ts). The
 *   left side's type is what the right one is expected to have, so `x == none` reads naturally.
 * - `and`, `or` and `not` take and give `bool`; they short-circuit, so they are never calls.
 * - `??` works on optionals (optionals.ts).
 */

import { unreachable } from '../../../structures/unreachable.ts';
import type { Span } from '../../../text/span.ts';
import {
  type ComparisonLink,
  comparisonLinkOf,
  comparisonLinksOf,
  linkSpan,
} from '../../syntax/expressions/comparisons.ts';
import type {
  Binary,
  ChainedComparison,
  Expression,
  Unary,
} from '../../syntax/expressions/index.ts';
import {
  type BinaryMeaning,
  binaryOperators,
  type ImplicitOperator,
  isImplicitOperator,
} from '../../syntax/operators.ts';
import { applied, type Operand, resolveOperator, unaryApplied } from '../calls/operators.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { type ImplicitOperand, implicitOperatorCall } from '../resolution/implicit.ts';
import { checkEqualSides } from '../types/equality.ts';
import { boolType, isPrimitive, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { checkNullish } from './optionals.ts';

export function checkBinary(context: BodyContext, node: Binary, expected: Type | undefined): Type {
  const link = comparisonLinkOf(node);
  if (link !== undefined) {
    return checkComparisons(context, [link]);
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
  return resolveOperator(context, node, applied(operator, meaning), operandsOf(context, node));
}

export function checkUnary(context: BodyContext, node: Unary): Type {
  if (node.operator === 'not') {
    context.expect(node.operand, boolType);
    return boolType;
  }
  return resolveOperator(context, node, unaryApplied(node.operator), [
    { node: node.operand, type: context.expression(node.operand) },
  ]);
}

/** `a < b <= c`: each operand compared with the next (§3.9). */
export function checkChainedComparison(context: BodyContext, node: ChainedComparison): Type {
  return checkComparisons(context, comparisonLinksOf(node));
}

/** Checks one or more comparison links in sequence, checking shared operands once. */
function checkComparisons(context: BodyContext, links: readonly ComparisonLink[]): Type {
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
    if (isImplicitOperator(operator)) {
      const right = operand(link.right);
      checkLinkCall(context, link, operator, [wrappable(left), wrappable(right)]);
    } else {
      const right = operand(link.right, left.type);
      checkEqualSides(context, wrappable(left), wrappable(right), {
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

/** `includes` must give a `bool`, since `in` is one. */
function expectBool(context: BodyContext, result: Type, span: Span): void {
  if (result.kind !== 'error' && !isPrimitive(result, 'bool')) {
    context.report(checkerDiagnostics.typeMismatch(span, 'bool', typeText(result)));
  }
}

function operandsOf(context: BodyContext, node: Binary): readonly Operand[] {
  return [node.left, node.right].map((operand) => ({
    node: operand,
    type: context.expression(operand),
  }));
}
