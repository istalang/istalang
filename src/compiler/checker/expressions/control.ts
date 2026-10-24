/**
 * Branching expressions (§4): every branch of an `if` must have the same type, and that is the
 * `if`'s type. A branch ending in `return`, `break` or `continue` has type `never`, which fits any.
 *
 * - The branches agree on a type as every producer of one value does (rules/agreement.ts): the
 *   expected type decides when there is one, else the first branch with a value.
 * - An `if` without `else` produces nothing, so its branches must be `unit`.
 */

import type { If } from '../../syntax/expressions.ts';
import type { Block } from '../../syntax/statements.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { agreedType, type Produced } from '../rules/agreement.ts';
import { tailOf } from '../statements/statements.ts';
import {
  boolType,
  isAssignable,
  isPrimitive,
  neverType,
  type Type,
  unitType,
} from '../types/type.ts';
import { typeText } from '../types/type-text.ts';

export function checkIf(context: BodyContext, node: If, expected: Type | undefined): Type {
  const produced = node.branches.map((branch) => {
    context.expect(branch.condition, boolType);
    return producedBy(context, branch.body, expected);
  });
  const elseBody = node.elseClause?.body;
  if (elseBody === undefined) {
    for (const { type, span } of produced) {
      if (!(isAssignable(type, unitType) || isPrimitive(type, 'never'))) {
        context.report(checkerDiagnostics.ifWithoutElse(span, typeText(type)));
      }
    }
    return unitType;
  }
  produced.push(producedBy(context, elseBody, expected));
  const { decided, disagreeing } = agreedType(produced, expected);
  for (const { type, span } of disagreeing) {
    const agreed = typeText(decided ?? type);
    context.report(
      expected === undefined
        ? checkerDiagnostics.branchTypes(span, agreed, typeText(type))
        : checkerDiagnostics.typeMismatch(span, agreed, typeText(type)),
    );
  }
  return decided ?? neverType;
}

/** A branch's type, reported at its tail (§4). */
function producedBy(context: BodyContext, body: Block, expected: Type | undefined): Produced {
  return { type: context.block(body, expected), span: tailOf(body).span };
}
