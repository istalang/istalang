/**
 * `if` as an expression (§4): its branches agree on its type (expressions/control/branches.ts). An `if` without
 * `else` produces nothing, so its branches must be `Unit`.
 *
 * A condition its operands' types decide (expressions/decided-conditions.ts) rules out the branch that
 * never runs: its own when always false, every one after it when always true. A branch ruled out is
 * neither checked nor lowered, and doesn't take part in the `if`'s type.
 */

import { valueBranchesOf } from '../../syntax/expressions/branches.ts';
import type { Expression, If } from '../../syntax/expressions/index.ts';
import type { Accepts, BodyContext } from '../body-context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { isAssignable } from '../types/identity/identity.ts';
import { boolType, unitType } from '../types/primitives.ts';
import type { Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { Branches, branchesAccepts } from './control/branches.ts';
import { decidedValue } from './decided-conditions.ts';

export function checkIf(context: BodyContext, node: If, expected: Type | undefined): Type {
  const branches = new Branches(context, expected);
  let decidedTrue = false;
  for (const branch of node.branches) {
    const decided: boolean | undefined = decidedTrue
      ? false
      : checkCondition(context, branch.condition);
    if (decided === false) {
      context.ruleOut(branch.body);
    } else {
      branches.add(branch.body);
    }
    decidedTrue ||= decided === true;
  }
  const elseBody = node.elseClause?.body;
  if (elseBody !== undefined && decidedTrue) {
    context.ruleOut(elseBody);
  } else if (elseBody !== undefined) {
    branches.add(elseBody);
  }
  if (elseBody !== undefined) {
    return branches.agreedType();
  }
  for (const { type, span } of branches.produced) {
    if (!isAssignable(type, unitType)) {
      context.report(checkerDiagnostics.ifWithoutElse(span, typeText(type)));
    }
  }
  return unitType;
}

/**
 * Checks `condition`, recording the value its operands' types fix, if any; the comparison or `is`
 * deciding it warned of it where it stands (expressions/decided-conditions.ts).
 */
function checkCondition(context: BodyContext, condition: Expression): boolean | undefined {
  context.expect(condition, boolType);
  const decided = decidedValue(context, condition);
  if (decided !== undefined) {
    context.decide(condition, decided);
  }
  return decided;
}

/** An `if` with `else` takes what its branches agree on; one without has a type of its own. */
export function ifAccepts(context: BodyContext, node: If): Accepts | undefined {
  return node.elseClause === undefined
    ? undefined
    : branchesAccepts(context, valueBranchesOf(node));
}
