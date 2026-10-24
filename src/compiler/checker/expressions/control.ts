/**
 * Branching expressions (§4): every branch of an `if` must have the same type, and that is the
 * `if`'s type. A branch ending in `return`, `break` or `continue` has type `never`, which fits any.
 *
 * - The branches agree on a type as every producer of one value does (rules/agreement.ts): the
 *   expected type decides when there is one, else the first branch with a value.
 * - An `if` without `else` produces nothing, so its branches must be `unit`.
 */

import type { If } from '../../syntax/expressions.ts';
import { type Block, tailExpressionOf, tailNodeOf } from '../../syntax/statements.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { agreedType, type Produced } from '../rules/agreement.ts';
import { boolType, isAssignable, neverType, type Type, unitType } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';

export function checkIf(context: BodyContext, node: If, expected: Type | undefined): Type {
  const produced = node.branches.map((branch) => {
    context.expect(branch.condition, boolType);
    return producedBy(context, branch.body, expected);
  });
  const elseBody = node.elseClause?.body;
  if (elseBody === undefined) {
    for (const { type, span } of produced) {
      if (!isAssignable(type, unitType)) {
        context.report(checkerDiagnostics.ifWithoutElse(span, typeText(type)));
      }
    }
    return unitType;
  }
  produced.push(producedBy(context, elseBody, expected));
  const { decided, disagreeing } = agreedType(produced, context.checker.wrapsToFit, expected);
  if (decided === undefined) {
    return neverType;
  }
  for (const { type, span, node: value } of disagreeing) {
    if (expected === undefined && context.checker.wrapsToFit(type, decided) === undefined) {
      context.report(checkerDiagnostics.branchTypes(span, typeText(decided), typeText(type)));
    } else {
      context.fit(type, decided, value ?? span);
    }
  }
  return decided;
}

/** A branch's type, reported at its tail (§4). */
function producedBy(context: BodyContext, body: Block, expected: Type | undefined): Produced {
  return {
    type: context.block(body, expected),
    span: tailNodeOf(body).span,
    node: tailExpressionOf(body),
  };
}
