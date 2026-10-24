/**
 * `await` (§5): waits on a future and gives its value. Only an async function waits, because every
 * await is a point where the instance commits and may suspend.
 */

import type { Await } from '../../syntax/expressions.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { futureArgument } from '../rules/futures.ts';
import { errorType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';

export function checkAwait(context: BodyContext, node: Await, expected: Type | undefined): Type {
  if (!context.inAsync) {
    context.report(checkerDiagnostics.awaitOutsideAsync(node.span));
  }
  const expectedFuture =
    expected === undefined ? undefined : context.checker.preludeType('Future', [expected]);
  const operand = context.expression(node.operand, expectedFuture);
  if (operand.kind === 'error') {
    return errorType;
  }
  const value = futureArgument(context.checker, operand);
  if (value === undefined) {
    context.report(checkerDiagnostics.awaitNeedsFuture(node.operand.span, typeText(operand)));
    return errorType;
  }
  return value;
}
