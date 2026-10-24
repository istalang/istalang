/**
 * Operator expressions (§3.9).
 *
 * - Arithmetic, negation and the comparisons call functions (overloads/operators.ts); a comparison
 *   is `bool` whatever `compare` returns, since lowering turns its int into the relation.
 * - `==` and `!=` are built in for every type and can't be overloaded: both sides must be one type.
 * - `and`, `or` and `not` take and give `bool`; they short-circuit, so they are never calls.
 */

import type { Binary, Unary } from '../../syntax/expressions.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { frontier } from '../frontier.ts';
import { resolveOperator } from '../overloads/operators.ts';
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
      const operands = [context.expression(node.left), context.expression(node.right)];
      const compared = resolveOperator(context, node, operator, operands);
      return compared.kind === 'error' ? errorType : boolType;
    }
    default:
      return resolveOperator(context, node, operator, [
        context.expression(node.left),
        context.expression(node.right),
      ]);
  }
}

export function checkUnary(context: BodyContext, node: Unary): Type {
  if (node.operator === 'not') {
    context.expect(node.operand, boolType);
    return boolType;
  }
  return resolveOperator(context, node, 'negate', [context.expression(node.operand)]);
}

function checkEquality(context: BodyContext, node: Binary): Type {
  const left = context.expression(node.left);
  const right = context.expression(node.right, left);
  if (!comparable(left, right)) {
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
