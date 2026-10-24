/**
 * Operator expressions (§3.9).
 *
 * - Arithmetic, negation and the comparisons call functions (overloads/operators.ts); a comparison
 *   is `bool` whatever `compare` returns, since lowering turns its int into the relation.
 * - `==` and `!=` are built in for every type and can't be overloaded: both sides must be one type,
 *   once the implicit wrap (§2) has made a `T` an optional where the other side is one. The left
 *   side's type is what the right one is expected to have, so `x == none` reads naturally.
 * - `and`, `or` and `not` take and give `bool`; they short-circuit, so they are never calls.
 */

import type { Binary, Unary } from '../../syntax/expressions.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { frontier } from '../frontier.ts';
import { type Operand, resolveOperator } from '../overloads/operators.ts';
import { boolType, comparable, errorType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';

export function checkBinary(context: BodyContext, node: Binary): Type {
  const { operator } = node;
  switch (operator) {
    case 'and':
    case 'or':
      context.expect(node.left, boolType);
      context.expect(node.right, boolType);
      return boolType;
    case '==':
    case '!=':
      return checkEquality(context, node);
    case '??':
      return context.unsupported(node, frontier.nullishOperator);
    case '<':
    case '<=':
    case '>':
    case '>=': {
      const compared = resolveOperator(context, node, operator, operandsOf(context, node));
      return compared.kind === 'error' ? errorType : boolType;
    }
    default:
      return resolveOperator(context, node, operator, operandsOf(context, node));
  }
}

export function checkUnary(context: BodyContext, node: Unary): Type {
  if (node.operator === 'not') {
    context.expect(node.operand, boolType);
    return boolType;
  }
  return resolveOperator(context, node, 'negate', [
    { node: node.operand, type: context.expression(node.operand) },
  ]);
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
  const { wrapsToFit } = context.checker;
  if (!comparable(left, right) && wrapsToFit(right, left) !== undefined) {
    context.fit(right, left, node.right);
  } else if (!comparable(left, right) && wrapsToFit(left, right) !== undefined) {
    context.fit(left, right, node.left);
  } else if (!comparable(left, right)) {
    context.report(
      checkerDiagnostics.operatorTypes(
        node.span,
        node.operator,
        `${typeText(left)} and ${typeText(right)}`,
      ),
    );
  }
  return boolType;
}
