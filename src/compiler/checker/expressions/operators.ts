/**
 * Operator expressions (§3.9).
 *
 * - An operator's meaning (syntax/operators.ts) decides how it is checked. Arithmetic, negation and
 *   the orderings call functions (calls/operators.ts); an ordering is `bool` whatever `compare`
 *   returns, since lowering turns its int into the relation.
 * - `==` and `!=` are built in for every type and can't be overloaded (types/equality.ts). The
 *   left side's type is what the right one is expected to have, so `x == none` reads naturally.
 * - `and`, `or` and `not` take and give `bool`; they short-circuit, so they are never calls.
 * - `??` works on optionals (optionals.ts).
 */

import type { Binary, Unary } from '../../syntax/expressions/index.ts';
import { binaryOperators } from '../../syntax/operators.ts';
import { applied, type Operand, resolveOperator, unaryApplied } from '../calls/operators.ts';
import type { BodyContext } from '../context.ts';
import { frontier } from '../frontier.ts';
import { checkEqualSides } from '../types/equality.ts';
import { boolType, type Type } from '../types/type.ts';
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
      return context.unsupported(node, frontier.membership);
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
