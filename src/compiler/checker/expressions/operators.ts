/**
 * Operator expressions (§3.9).
 *
 * - Arithmetic, negation and the comparisons call functions (calls/operators.ts); a comparison
 *   is `bool` whatever `compare` returns, since lowering turns its int into the relation.
 * - `==` and `!=` are built in for every type and can't be overloaded (types/equality.ts). The
 *   left side's type is what the right one is expected to have, so `x == none` reads naturally.
 * - `and`, `or` and `not` take and give `bool`; they short-circuit, so they are never calls.
 * - `??` works on optionals (optionals.ts).
 */

import type { Binary, Unary } from '../../syntax/expressions.ts';
import { type Operand, resolveOperator } from '../calls/operators.ts';
import type { BodyContext } from '../context.ts';
import { checkEqualSides } from '../types/equality.ts';
import { boolType, errorType, type Type } from '../types/type.ts';
import { checkNullish } from './optionals.ts';

export function checkBinary(context: BodyContext, node: Binary, expected: Type | undefined): Type {
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
      return checkNullish(context, node, expected);
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
  checkEqualSides(
    context,
    { type: left, node: node.left },
    { type: right, node: node.right },
    node,
  );
  return boolType;
}
