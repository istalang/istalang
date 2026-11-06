/**
 * `e?` on a `Result` (§3.12): the `Ok` value, or an early return of the `Err` from the function,
 * whose result must hold the same error type (closures/returns.ts). An optional isn't taken
 * apart by `?`; `??` and `match` do that (§4).
 */

import { wellKnown } from '../../../../language/well-known/index.ts';
import type { Propagate } from '../../../syntax/expressions/index.ts';
import { stoppedOperation } from '../../calls/stopped-operations.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import type { Type } from '../../types/type/index.ts';
import { errorType } from '../../types/type/primitives.ts';
import { typeText } from '../../types/type-text.ts';
import { wellKnownArguments } from '../../types/well-known.ts';

export function checkPropagate(context: BodyContext, node: Propagate): Type {
  const type = context.expression(node.operand);
  const stopped = stoppedOperation(context, node, [{ node: node.operand, type }]);
  if (stopped !== undefined) {
    return stopped;
  }
  const [value, error] = wellKnownArguments(context.checker, wellKnown.result, type) ?? [];
  if (value === undefined || error === undefined) {
    context.report(checkerDiagnostics.propagateNeedsResult(node.operand.span, typeText(type)));
    return errorType;
  }
  context.returns.propagate(context, error, node.span);
  return value;
}
