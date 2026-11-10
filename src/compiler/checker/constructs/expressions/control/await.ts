/**
 * `await` (§5): waits on a future and gives its value. Only an async function waits, because every
 * await is a point where the instance commits and may suspend. In a case cleaning up after the
 * function's call is disposed, an await stops the call instead (§7), which is warned about.
 */

import type { Await } from '../../../../syntax/expressions/index.ts';
import type { AnchoredSpan } from '../../../../syntax/tree/positions.ts';
import type { BodyContext } from '../../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import { callerName, kindText } from '../../../resolution/applying/call-kinds.ts';
import { stoppedOperation } from '../../../resolution/calls/stopped-operations.ts';
import { sameType } from '../../../types/identity/identity.ts';
import { persistenceOf } from '../../../types/type/function-kinds.ts';
import type { Type } from '../../../types/type/index.ts';
import { errorType } from '../../../types/type/primitives.ts';
import { typeText } from '../../../types/type/type-text.ts';
import { awaitedOf, futureOf } from '../../../types/type/well-known.ts';

export function checkAwait(context: BodyContext, node: Await, expected: Type | undefined): Type {
  reportWait(context, node.span);
  const expectedFuture =
    expected === undefined ? undefined : futureOf(context.checker, expected, context.codeKind);
  const operand = context.expression(node.operand, expectedFuture);
  const stopped = stoppedOperation(context, node, [{ node: node.operand, type: operand }]);
  if (stopped !== undefined) {
    return stopped;
  }
  const awaited = awaitedOf(context.checker, operand);
  if (awaited === undefined) {
    context.report(checkerDiagnostics.awaitNeedsFuture(node.operand.span, typeText(operand)));
    return errorType;
  }
  if (context.inAsync) {
    checkWaitKind(context, node.operand.span, operand, awaited.mode);
  }
  return awaited.value;
}

/**
 * Reports a wait at `at` on `found`, in `mode`, unless that is its function's kind: an `await`, and
 * a `select`'s case, blocking or not, waits in its function's kind (proposal 8, Rules 5 and 6), so
 * the kinds never meet.
 */
export function checkWaitKind(
  context: BodyContext,
  at: AnchoredSpan,
  found: Type,
  mode: Type,
): void {
  context.functions.current.relyOnKind();
  const { codeKind } = context;
  if (sameType(mode, codeKind)) {
    return;
  }
  context.report(
    persistenceOf(codeKind) === undefined && mode.kind === 'literal'
      ? checkerDiagnostics.unmarkedWaits(
          at,
          callerName(context.functions.current),
          kindText(mode),
          typeText(found),
          context.inAsync ? 'async fn' : 'fn',
        )
      : checkerDiagnostics.waitOfOtherKind(at, typeText(found), kindText(codeKind)),
  );
}

/** Reports a wait at `at` outside an async function, or where it stops a call being disposed. */
export function reportWait(context: BodyContext, at: AnchoredSpan): void {
  if (!context.inAsync) {
    context.report(checkerDiagnostics.awaitOutsideAsync(at));
  } else if (context.functions.current.inCleanup) {
    context.report(checkerDiagnostics.awaitInCleanup(at));
  }
}
