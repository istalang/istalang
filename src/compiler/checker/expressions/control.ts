/**
 * `if` as an expression (§4): its branches agree on its type (rules/branches.ts). An `if` without
 * `else` produces nothing, so its branches must be `unit`.
 */

import type { If } from '../../syntax/expressions.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { Branches } from '../rules/branches.ts';
import { boolType, isAssignable, type Type, unitType } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';

export function checkIf(context: BodyContext, node: If, expected: Type | undefined): Type {
  const branches = new Branches(context, expected);
  for (const branch of node.branches) {
    context.expect(branch.condition, boolType);
    branches.add(branch.body);
  }
  const elseBody = node.elseClause?.body;
  if (elseBody !== undefined) {
    branches.add(elseBody);
    return branches.agreedType();
  }
  for (const { type, span } of branches.produced) {
    if (!isAssignable(type, unitType)) {
      context.report(checkerDiagnostics.ifWithoutElse(span, typeText(type)));
    }
  }
  return unitType;
}
