/**
 * Branching expressions (§4): every branch of an `if` must have the same type, and that is the
 * `if`'s type. A branch ending in `return`, `break` or `continue` has type `never`, which fits any.
 *
 * - The branches agree on a type as every producer of one value does (rules/agreement.ts): the
 *   expected type decides when there is one, else the first branch with a value. Without an
 *   expected type, that first branch's type is what the later branches are expected to have, so
 *   `if c: struct{a: 1} else: struct{a: 2}` builds one anonymous type, not two (§3.1).
 * - An `if` without `else` produces nothing, so its branches must be `unit`.
 */

import type { If } from '../../syntax/expressions.ts';
import { type Block, tailExpressionOf, tailNodeOf } from '../../syntax/statements.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { decidedSoFar, type Produced, settleAgreement } from '../rules/agreement.ts';
import { boolType, isAssignable, neverType, type Type, unitType } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';

export function checkIf(context: BodyContext, node: If, expected: Type | undefined): Type {
  const produced: Produced[] = [];
  for (const branch of node.branches) {
    context.expect(branch.condition, boolType);
    produced.push(producedBy(context, branch.body, expected ?? decidedSoFar(context, produced)));
  }
  const elseBody = node.elseClause?.body;
  if (elseBody === undefined) {
    checkWithoutElse(context, produced);
    return unitType;
  }
  produced.push(producedBy(context, elseBody, expected ?? decidedSoFar(context, produced)));
  const decided = settleAgreement(context, produced, expected, (span, agreed, found) =>
    checkerDiagnostics.branchTypes(span, typeText(agreed), typeText(found)),
  );
  return decided ?? neverType;
}

/** An `if` without `else` produces unit, so none of its branches may produce a value. */
function checkWithoutElse(context: BodyContext, produced: readonly Produced[]): void {
  for (const { type, span } of produced) {
    if (!isAssignable(type, unitType)) {
      context.report(checkerDiagnostics.ifWithoutElse(span, typeText(type)));
    }
  }
}

/** A branch's type, reported at its tail (§4). */
function producedBy(context: BodyContext, body: Block, expected: Type | undefined): Produced {
  return {
    type: context.block(body, expected),
    span: tailNodeOf(body).span,
    node: tailExpressionOf(body),
  };
}
