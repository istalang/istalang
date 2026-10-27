/**
 * `e?` on a `Result` (§3.12): the `Ok` value, or an early return of the `Err` from the function,
 * whose result must hold the same error type (closures/returns.ts). An optional isn't taken
 * apart by `?`; `??` and `match` do that (§4).
 */

import { wellKnown } from '../../../language/well-known.ts';
import type { Propagate } from '../../syntax/expressions/index.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { errorType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { wellKnownArguments } from '../types/well-known.ts';

export function checkPropagate(context: BodyContext, node: Propagate): Type {
  const type = context.expression(node.operand);
  if (type.kind === 'error') {
    return errorType;
  }
  const [value, error] = wellKnownArguments(context.checker, wellKnown.result, type) ?? [];
  if (value === undefined || error === undefined) {
    context.report(checkerDiagnostics.propagateNeedsResult(node.operand.span, typeText(type)));
    return errorType;
  }
  context.returns.propagate(context, error, node.span);
  return value;
}
