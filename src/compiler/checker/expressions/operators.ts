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

import type { Span } from '../../../text/span.ts';
import {
  type Binary,
  type ChainedComparison,
  type ComparisonLink,
  comparisonLinksOf,
  type Expression,
  type Unary,
} from '../../syntax/expressions/index.ts';
import { type BinaryMeaning, binaryOperators } from '../../syntax/operators.ts';
import {
  type AppliedOperator,
  applied,
  type Operand,
  resolveOperator,
  unaryApplied,
} from '../calls/operators.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { topLevelCandidates } from '../resolution/candidates.ts';
import { implicitCall } from '../resolution/implicit.ts';
import { checkEqualSides } from '../types/equality.ts';
import { boolType, isPrimitive, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { checkNullish } from './optionals.ts';

export function checkBinary(context: BodyContext, node: Binary, expected: Type | undefined): Type {
  const { operator } = node;
  const { meaning } = binaryOperators[operator];
  switch (meaning.kind) {
    case 'logic':
      context.expect(node.left, boolType);
      context.expect(node.right, boolType);
      return boolType;
    case 'equality':
      return checkEquality(context, node);
    case 'coalesce':
      return checkNullish(context, node, expected);
    case 'membership':
      return checkMembership(context, node, applied(operator, meaning));
    case 'order':
    case 'call': {
      const operation = applied(operator, meaning);
      const result = resolveOperator(context, node, operation, operandsOf(context, node));
      return meaning.kind === 'call' || result.kind === 'error' ? result : boolType;
    }
    default: {
      const unhandled: never = meaning;
      return unhandled;
    }
  }
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

/** `item in container`: `includes(container, item)`, its operands checked as written. */
function checkMembership(context: BodyContext, node: Binary, operation: AppliedOperator): Type {
  const [item, container] = operandsOf(context, node);
  if (item === undefined || container === undefined) {
    return boolType;
  }
  expectBool(context, resolveOperator(context, node, operation, [container, item]), node.span);
  return boolType;
}

/** `a < b <= c`: each operand compared with the next (§3.9). */
export function checkChainedComparison(context: BodyContext, node: ChainedComparison): Type {
  const checked = new Map<Expression, Type>();
  const operand = (expression: Expression, expected?: Type): Operand => {
    const type = checked.get(expression) ?? context.expression(expression, expected);
    checked.set(expression, type);
    return { node: expression, type };
  };
  const [first, last] = [node.operands[0], node.operands.at(-1)];
  const wrappable = (side: Operand) =>
    side.node === first || side.node === last ? side : { type: side.type, node: undefined };
  for (const link of comparisonLinksOf(node)) {
    const { meaning } = binaryOperators[link.operator];
    const left = operand(link.left);
    const right = operand(link.right, meaning.kind === 'equality' ? left.type : undefined);
    if (meaning.kind === 'equality') {
      checkEqualSides(context, wrappable(left), wrappable(right), linkAt(link));
    } else {
      checkLinkCall(context, link, meaning, [left.type, right.type]);
    }
  }
  return boolType;
}

/** Where a link stands, for its reports: from its left operand to its right one. */
function linkAt(link: ComparisonLink): { readonly span: Span; readonly operator: string } {
  return {
    span: { start: link.left.span.start, end: link.right.span.end },
    operator: link.operator,
  };
}

/** A link's call, made at its right operand: an ordering's `compare`, or `in`'s `includes`. */
function checkLinkCall(
  context: BodyContext,
  link: ComparisonLink,
  meaning: Extract<BinaryMeaning, { kind: 'order' | 'membership' }>,
  [left, right]: readonly [Type, Type],
): void {
  const membership = meaning.kind === 'membership';
  const types = membership ? [right, left] : [left, right];
  const at = linkAt(link);
  const result = implicitCall(context, {
    node: link.right,
    role: membership ? 'includes' : 'compare',
    candidates: topLevelCandidates(context.checker, context.module, meaning.function, types),
    arguments: types.map((type) => ({ type, passing: 'value' }) as const),
    failure: () =>
      checkerDiagnostics.operatorTypes(at.span, at.operator, types.map(typeText).join(' and ')),
  });
  if (membership && result !== undefined) {
    expectBool(context, result, at.span);
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

function checkEquality(context: BodyContext, node: Binary): Type {
  const left = context.expression(node.left);
  const right = context.expression(node.right, left);
  checkEqualSides(
    context,
    { type: left, node: node.left },
    { type: right, node: node.right },
    node,
  );
  return boolType;
}
